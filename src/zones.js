// src/zones.js - zone/portal visibility, update gating, one pooled zone lamp, texture residency and asset prefetch.
// ?zones=0 turns all of it off (the scene is left exactly as createWorld built it).
//
// How it works
// - Zones are axis-aligned volumes (ZONE_BOXES). The camera's zone is the first box that contains the eye;
//   otherwise "outdoor" (y >= -1.5) or "sea" (below).
// - Static top-level scene objects are sorted into one Group per zone at start-up, but only when their bounding box
//   sits fully inside one zone (indoor) or fully above/below y -1.5 (outdoor/sea). Anything that straddles zones,
//   lights, the camera, and anything that is or contains a pick target stays a direct scene child ("shared", always
//   drawn). Objects added later are never moved unless code calls zones.adopt(object).
// - Each frame the visible set is a breadth-first walk from the camera zone through portals (doorways, the lift
//   gate, the landings, the tunnel mouths, the cave mouth) whose box is inside the view frustum and whose screen
//   rectangle overlaps the rectangle the current zone is seen through (the cave mouth only from below y -2.9). outdoor<->sea are
//   always linked (open air). Zone groups that aren't reached are hidden (visible = false on the group only, so game
//   code that toggles its own objects is unaffected). A zone stays visible 0.3 s after it was last reached.
// - isAwake(id) tells world.update which systems to tick (sharks/fish/birds, gallery, puddles, croc).
// - Lights tagged userData.zoneLamp ('cell', 'cave') are replaced by ONE pooled PointLight that takes the settings
//   of the lamp for the camera's zone (and follows the lift car while riding). The light count never changes, so no
//   shader recompiles.
// - Residency: textures of hidden zones are disposed (GPU only; the image data stays in JS and re-uploads on the next
//   draw) once total estimated texture memory is over budget (?vram=MB, default 192) and the zone has been hidden for
//   60 s, least recently seen first. Zones adjacent to the camera zone get their textures uploaded ahead of time
//   (renderer.initTexture, one per frame) so walking through a door doesn't hitch.
// - Prefetch: entering a zone asks the asset manager to fetch the assets of that zone and its neighbours first.
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
export const ZONES_ON = params.get('zones') !== '0';
const SPLIT_Y = -1.5;
const HOLD = 0.3;

const box = (x0, x1, y0, y1, z0, z1) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
const STOPS = [0, -3.6, -7.2, -10.8, -14.4];
// Order matters: the first box that contains the eye wins.
const ZONE_BOXES = [
  // gallery and tunnel first: the lift:2 box (-7.2 landing) overlaps the paint tunnel, so a walker halfway down the
  // tunnel used to count as 'lift:2' and the tunnel, gallery and cave were hidden around them.
  ['gallery', box(10.55, 15.8, -8.7, -4.3, -1.0, 4.7)],
  ['tunnel', box(4.0, 10.55, -8.7, -4.6, 0.95, 2.72)],
  ['liftshaft', box(5.1, 6.72, -15, 2.5, -0.68, 0.92)],
  ...STOPS.slice(1).map((y, i) => [`lift:${i + 1}`, box(6.55, 9.45, y - 0.4, y + 2.45, -3.05, 3.3)]),
  // x from 2.64 (just inside the choppable door at x 2.6, cell.js START_CELL.floor.x0 2.55): the whole cell floor is
  // 'cell'. From 3.3 the west strip of the cell counted as outdoor, so with the door still boarded the portal walk
  // never reached the cell or the lift and the gate showed the forest behind the shaft.
  ['cell', box(2.64, 5.1, -0.2, 2.3, -0.8, 1.02)],
  ['cave', box(-1.7, 4.65, -9.6, -2.6, -7.0, 3.1)],
];
// Asset ids worth fetching early when the camera is in (or next to) a zone.
const PREFETCH = {
  cell: ['rock_cliff', 'rock_floor', 'boulder', 'lift_kit'],
  liftshaft: ['lift_kit'],
  outdoor: ['rock_cliff', 'rock_floor', 'boulder', 'chest'],
  sea: ['rock_floor'],
  cave: ['fire_pit', 'paint_can'],
  tunnel: ['fire_pit', 'paint_can'],
  gallery: ['fire_pit', 'paint_can'],
};

export function createZones({ scene, targets = [], lift = null, isCellOpen = () => true, renderer = null, assets = null, vramBudgetMB = null }) {
  const api = {
    enabled: ZONES_ON,
    current: 'outdoor',
    visible: new Set(),
    isAwake: () => true,
    update() {},
    adopt() {},
    stats: () => ({ enabled: false }),
  };
  scene.userData.zones = api;
  if (!ZONES_ON) return api;

  const roots = new Map();
  const zoneIds = [...ZONE_BOXES.map(([id]) => id), 'outdoor', 'sea'];
  for (const id of zoneIds) {
    const g = new THREE.Group();
    g.name = `zone:${id}`;
    g.userData.zoneRoot = id;
    roots.set(id, g);
  }

  // ---- portals ----
  const portals = [
    { a: 'cell', b: 'outdoor', box: box(2.4, 2.8, 0, 2.06, -0.42, 0.66), open: isCellOpen },
    { a: 'cell', b: 'liftshaft', box: box(4.82, 5.28, -0.05, 2.1, -0.36, 0.6) },
    ...STOPS.slice(1).map((y, i) => ({ a: 'liftshaft', b: `lift:${i + 1}`, box: box(6.45, 6.78, y, y + 2.1, -0.56, 0.8) })),
    { a: 'cave', b: 'tunnel', box: box(3.9, 4.5, -8.0, -5.5, 1.1, 2.55) },
    { a: 'tunnel', b: 'gallery', box: box(10.4, 11.5, -8.0, -5.5, 1.1, 2.55) },
    // the cave interior sits under the cliff overhang: only looked into from below the mouth's top (beach, boat, sea)
    { a: 'cave', b: 'sea', box: box(-2.0, -1.35, -8.9, -2.9, -6.4, 2.5), below: -2.9 },
  ];
  const linked = [['outdoor', 'sea']];
  const neighbours = new Map(zoneIds.map((id) => [id, new Set()]));
  for (const p of portals) { neighbours.get(p.a).add(p.b); neighbours.get(p.b).add(p.a); }
  for (const [a, b] of linked) { neighbours.get(a).add(b); neighbours.get(b).add(a); }

  // ---- classification ----
  const targetSet = new Set(targets);
  const holdsTarget = (object) => {
    let found = false;
    object.traverse((o) => { if (!found && (targetSet.has(o) || o.userData?.type === 'gear' || o.userData?.type === 'prop')) found = true; });
    return found;
  };
  const tmp = new THREE.Box3();
  function zoneFor(object) {
    const tag = object.userData?.zone;
    if (tag === 'shared' || tag === 'dynamic') return null;
    if (tag && roots.has(tag)) return tag;
    if (object.isLight || object.isCamera || object.userData?.zoneRoot) return null;
    if (object.userData?.backdrop) return 'outdoor';
    if (object.isInstancedMesh && object.frustumCulled === false) return null; // e.g. props4 followers: carried anywhere
    if (holdsTarget(object)) return null;
    tmp.setFromObject(object);
    if (tmp.isEmpty()) return null;
    const size = tmp.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.z) > 80) return tmp.getCenter(new THREE.Vector3()).y < SPLIT_Y ? 'sea' : 'outdoor';
    for (const [id, zb] of ZONE_BOXES) if (zb.containsBox(tmp)) return id;
    for (const [, zb] of ZONE_BOXES) if (zb.intersectsBox(tmp)) return null; // straddles an indoor zone: shared
    if (tmp.min.y >= SPLIT_Y) return 'outdoor';
    if (tmp.max.y < SPLIT_Y) return 'sea';
    return null;
  }
  // lift parts are tagged by lift.js (shaft, car, cable, floors)
  if (lift?.shaftGroup) {
    lift.shaftGroup.userData.zone = 'liftshaft';
    lift.car.userData.zone = 'liftshaft';
    lift.floorGroups.forEach((g, i) => { g.userData.zone = i === 0 ? 'liftshaft' : `lift:${i}`; });
  }
  const counts = {};
  scene.updateMatrixWorld(true);
  for (const child of [...scene.children]) {
    const id = zoneFor(child);
    if (!id) { counts.shared = (counts.shared || 0) + 1; continue; }
    roots.get(id).add(child); // world transform is unchanged: zone groups sit at the origin
    counts[id] = (counts[id] || 0) + 1;
  }
  for (const g of roots.values()) scene.add(g);
  // the lift cable is a direct scene child created by lift.js; it rides with the shaft group
  scene.children.forEach((c) => { if (c.isMesh && c.material?.name === 'lift_steel') roots.get('liftshaft').attach(c); });

  // ---- pooled zone lamp ----
  const lampSpecs = {};
  scene.traverse((o) => {
    if (o.isPointLight && o.userData.zoneLamp) {
      lampSpecs[o.userData.zoneLamp] = { color: o.color.clone(), intensity: o.intensity, distance: o.distance, decay: o.decay, pos: o.getWorldPosition(new THREE.Vector3()) };
      o.visible = false;
    }
  });
  lampSpecs.lift = { color: new THREE.Color(0xffc9a0), intensity: 2.2, distance: 3.2, decay: 2, pos: new THREE.Vector3() };
  const zoneLamp = new THREE.PointLight(0xffffff, 0, 1, 2);
  zoneLamp.name = 'zoneLamp';
  scene.add(zoneLamp);
  const lampFor = (zone) => {
    if (zone === 'cell') return lampSpecs.cell;
    if (zone === 'liftshaft' || zone.startsWith('lift:')) return lampSpecs.lift;
    if (zone === 'gallery') return null; // the fire light does the gallery
    return lampSpecs.cave;
  };

  // ---- residency ----
  const budget = (Number(params.get('vram')) || vramBudgetMB || 192) * 1024 * 1024;
  const texOf = new Map(); // zone -> Set(texture)
  const owners = new Map(); // texture -> Set(zone|'shared')
  const bytesOf = (t) => {
    if (t.isCompressedTexture && t.mipmaps?.length) return t.mipmaps.reduce((s, m) => s + (m.data?.byteLength || 0), 0);
    const w = t.image?.width || 0; const h = t.image?.height || 0;
    return w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1);
  };
  const collect = (root, into) => root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v?.isTexture && !v.isRenderTargetTexture) into.add(v);
    }
  });
  function indexTextures() {
    texOf.clear(); owners.clear();
    for (const [id, g] of roots) { const s = new Set(); collect(g, s); texOf.set(id, s); s.forEach((t) => { if (!owners.has(t)) owners.set(t, new Set()); owners.get(t).add(id); }); }
    const shared = new Set();
    scene.children.forEach((c) => { if (!c.userData?.zoneRoot) collect(c, shared); });
    shared.forEach((t) => { if (!owners.has(t)) owners.set(t, new Set()); owners.get(t).add('shared'); });
  }
  indexTextures();
  let reindexIn = 5;
  const lastSeen = new Map(zoneIds.map((id) => [id, 0]));
  const resident = new Set();
  const evicted = new Set();
  let residentBytes = 0;
  const warmQueue = [];
  function residency(now) {
    if (!renderer) return;
    if (warmQueue.length) {
      const t = warmQueue.shift();
      if (!resident.has(t)) { renderer.initTexture(t); resident.add(t); residentBytes += bytesOf(t); evicted.delete(t); }
    }
    if (residentBytes <= budget) return;
    const candidates = zoneIds.filter((id) => !api.visible.has(id) && now - lastSeen.get(id) > 60).sort((a, b) => lastSeen.get(a) - lastSeen.get(b));
    for (const id of candidates) {
      for (const t of texOf.get(id) || []) {
        const own = owners.get(t);
        if (!resident.has(t) || own.has('shared') || [...own].some((z) => api.visible.has(z))) continue;
        t.dispose(); resident.delete(t); evicted.add(t); residentBytes -= bytesOf(t);
      }
      if (residentBytes <= budget) break;
    }
  }

  // ---- per-frame ----
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const grown = new THREE.Box3();
  const until = new Map(zoneIds.map((id) => [id, -1]));
  const reach = new Set();
  let clock = 0;
  let lastZone = null;
  function zoneAt(p) {
    for (const [id, zb] of ZONE_BOXES) if (zb.containsPoint(p)) return id;
    return p.y >= SPLIT_Y ? 'outdoor' : 'sea';
  }
  // Portal walk with screen-rect clipping: a zone behind a portal is only reached if that portal's projected
  // rectangle overlaps the rectangle through which its parent zone is seen.
  const corner = new THREE.Vector3();
  const rects = new Map();
  function portalRect(b, cam, parent) {
    let x0 = 1; let x1 = -1; let y0 = 1; let y1 = -1;
    for (let i = 0; i < 8; i += 1) {
      corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      corner.applyMatrix4(cam.matrixWorldInverse);
      if (corner.z > -0.05) return parent; // a corner is behind the eye: keep the parent rectangle (conservative)
      corner.applyMatrix4(cam.projectionMatrix);
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
    }
    const r = [Math.max(x0, parent[0]), Math.min(x1, parent[1]), Math.max(y0, parent[2]), Math.min(y1, parent[3])];
    return r[0] < r[1] && r[2] < r[3] ? r : null;
  }
  function walk(start, cam) {
    reach.clear(); reach.add(start); rects.clear(); rects.set(start, [-1, 1, -1, 1]);
    projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const queue = [start];
    for (let depth = 0; depth < 4 && queue.length; depth += 1) {
      const next = [];
      for (const z of queue) {
        const parent = rects.get(z);
        for (const [a, b] of linked) {
          const other = a === z ? b : b === z ? a : null;
          if (other && !reach.has(other)) { reach.add(other); rects.set(other, parent); next.push(other); }
        }
        for (const p of portals) {
          const other = p.a === z ? p.b : p.b === z ? p.a : null;
          if (!other || reach.has(other)) continue;
          if (p.open && !p.open()) continue;
          if (p.below != null && cam.position.y > p.below) continue;
          grown.copy(p.box).expandByScalar(0.25);
          let r = null;
          if (grown.containsPoint(cam.position)) r = parent;
          else if (frustum.intersectsBox(grown)) r = portalRect(grown, cam, parent);
          if (r) { reach.add(other); rects.set(other, r); next.push(other); }
        }
      }
      queue.length = 0; queue.push(...next);
    }
  }

  api.update = (eye, dt, cam = null) => {
    clock += dt;
    const zone = zoneAt(eye);
    api.current = zone;
    if (cam) { cam.updateMatrixWorld(); walk(zone, cam); } else { reach.clear(); reach.add(zone); neighbours.get(zone).forEach((n) => reach.add(n)); }
    for (const id of zoneIds) if (reach.has(id)) until.set(id, clock + HOLD);
    api.visible.clear();
    for (const id of zoneIds) {
      const on = until.get(id) >= clock;
      roots.get(id).visible = on;
      if (on) { api.visible.add(id); lastSeen.set(id, clock); }
    }
    // pooled lamp
    const spec = lampFor(zone);
    if (spec) {
      zoneLamp.color.copy(spec.color); zoneLamp.intensity = spec.intensity; zoneLamp.distance = spec.distance; zoneLamp.decay = spec.decay;
      if (spec === lampSpecs.lift && lift?.lampWorld) zoneLamp.position.copy(lift.lampWorld); else zoneLamp.position.copy(spec.pos);
    } else zoneLamp.intensity = 0;
    if (zone !== lastZone) {
      lastZone = zone;
      if (assets?.prefetch) {
        const ids = new Set(PREFETCH[zone] || []);
        neighbours.get(zone).forEach((n) => (PREFETCH[n] || []).forEach((id) => ids.add(id)));
        assets.prefetch([...ids], { urgent: true });
      }
      // upload neighbours' textures ahead of time
      for (const n of [zone, ...neighbours.get(zone)]) for (const t of texOf.get(n) || []) if (!resident.has(t)) warmQueue.push(t);
    }
    for (const id of api.visible) for (const t of texOf.get(id) || []) if (!resident.has(t)) { resident.add(t); residentBytes += bytesOf(t); evicted.delete(t); }
    reindexIn -= dt;
    if (reindexIn < 0) { reindexIn = 5; indexTextures(); }
    residency(clock);
  };
  // Awake = visible or the camera's own zone. Sea life also runs while the outdoor area is visible.
  api.isAwake = (id) => api.visible.has(id) || api.current === id;
  api.adopt = (object, id = null) => {
    const zone = id || zoneFor(object);
    if (zone && roots.has(zone)) roots.get(zone).attach(object);
    return zone;
  };
  api.stats = () => ({ enabled: true, current: api.current, visible: [...api.visible], counts, residentMB: +(residentBytes / 1048576).toFixed(1), budgetMB: budget / 1048576, evicted: evicted.size });
  api.roots = roots;
  api.zoneLamp = zoneLamp;
  return api;
}
