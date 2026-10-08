import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildReefKit, PALETTE } from './reefkit.js';

// Coral reef on the seabed under and around the big sea rocks in the middle of the shark/swordfish water.
// Quest budget: one draw call for the seabed shelf + one InstancedMesh per coral variant (9), no textures
// (the corals carry baked vertex colours, so they cost 0 bytes of texture memory), Draco geometry, no
// shadows, no raycasts. ?reef=0 (or ?models=0) leaves the sea exactly as before.
// Underwater look (feedback pass): coral and shelf colours are absorbed with depth (reds first), desaturated, and
// fade to the dark open-sea colour with distance from the eye, so from the cliff top or the beach the reef reads as
// dark shapes under the water and only shows its colour when you're out over it in the canoe. Past REEF_HIDE metres
// from every patch the coral meshes are hidden outright (shelf stays: the water bake and the dark floor need it).
// ?reeflook=old restores the bright look; ?reefnear= / ?reeffar= / ?reefhide= tune the distances (metres).
// Swim/boat/reef pass (default): a much denser reef in a muted natural palette (ochre, dusty pink, olive, brown, pale
// purple, bleached accents): procedural brain / staghorn / table / fan / soft corals, barrel + tube sponges, rubble
// and sand clearings (src/reefkit.js) plus the recoloured glb pieces. ~1,500 corals + ~700 rubble, one InstancedMesh
// per kind (13 draw calls), instance colours, no textures. Per-instance distance culling (8-16 m by kind and size,
// re-packed only when the eye moves 0.75 m) keeps the drawn triangles in budget. Still dark from the cliff: same fade
// to the open-sea colour and the same hide distance. ?reefstyle=old = the previous 105 neon corals.

// Patches around SEA_OUTCROPS in world.js: the (-24, -9) + (-22.5, -4.2) pair, (-29, 2.4) and (-36, 4).
const PATCHES = [
  { x: -23.6, z: -6.8, r: 5.6, seed: 11 },
  { x: -29.2, z: 2.2, r: 3.6, seed: 23 },
  { x: -36.2, z: 4.2, r: 5.0, seed: 37 },
];
const VARIANTS = [ // [mesh name in reef_corals.glb, weight, base scale]
  ['coral_branch', 1.4, 1.0],
  ['coral_staghorn', 1.2, 1.1],
  ['coral_tube', 1.0, 0.9],
  ['coral_bubble', 1.1, 1.0],
  ['coral_plate', 1.2, 1.15],
  ['coral_anemone', 0.6, 0.6],
  ['coral_fan', 1.0, 1.0],
  ['coral_redbranch', 1.0, 0.9],
  ['urchin', 0.5, 1.3],
];
const CENTRE_DEPTH = 2.0; // metres below WATER_Y in the middle of a patch
const RIM_DEPTH = 3.4; // at the patch edge, where it fades into the dark open-sea floor
const MIN_TIP_DEPTH = 0.6; // coral tips stay at least this far under the surface (waves, shark bellies)
const REEF_NEAR = 6; // metres from the eye: full (absorbed) colour inside this
const REEF_FAR = 15; // metres: fully faded to the open-sea dark by here
const REEF_HIDE = 18; // metres from the nearest patch edge: coral meshes not drawn at all
const ABYSS = 0x0b1114; // same dark as the shelf rim / unlit open-sea floor

// Patches a MeshStandardMaterial with the underwater look. Uses three's built-in cameraPosition, so in WebXR each eye
// fades from its own position and no per-frame CPU work is needed for the colour.
function underwaterLook(material, uniforms, { glow = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vReefW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vec4 reefW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    reefW = instanceMatrix * reefW;
  #endif
  vReefW = (modelMatrix * reefW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uReefGlow;
uniform float uReefOn;
uniform float uReefWaterY;
uniform vec2 uReefFade;
uniform vec3 uReefAbyss;
varying vec3 vReefW;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float reefNear = 1.0 - smoothstep(uReefFade.x, uReefFade.y, distance(vReefW, cameraPosition));
  ${glow ? '#ifdef USE_COLOR\n  totalEmissiveRadiance += vColor.rgb * uReefGlow * mix(1.0, reefNear * reefNear, uReefOn);\n  #endif' : ''}`)
      .replace('#include <opaque_fragment>', `if (uReefOn > 0.5) {
    float reefDepth = max(uReefWaterY - vReefW.y, 0.0);
    vec3 reefAbsorb = exp(-reefDepth * vec3(0.75, 0.3, 0.2)); // water eats red first, then green
    float reefLum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
    vec3 reefCol = mix(vec3(reefLum), outgoingLight, 0.45) * reefAbsorb * 0.7;
    outgoingLight = mix(uReefAbyss, reefCol, reefNear);
  }
  #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => (glow ? 'reef-uw-glow' : 'reef-uw');
}

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

export function createReef(scene, { assets, waterY, rocks = [] } = {}) {
  const gltf = assets?.feature('reef') ? assets.gltf('reef_corals') : null;
  if (!gltf) return null;
  const params = new URLSearchParams(location.search);
  const oldLook = params.get('reeflook') === 'old';
  const glow = Number(params.get('reefglow') ?? (oldLook ? 0.14 : 0.05));
  const near = Number(params.get('reefnear') ?? REEF_NEAR);
  const far = Math.max(near + 0.5, Number(params.get('reeffar') ?? REEF_FAR));
  const hideAt = oldLook ? Infinity : Number(params.get('reefhide') ?? REEF_HIDE);
  const look = {
    uReefGlow: { value: glow },
    uReefOn: { value: oldLook ? 0 : 1 },
    uReefWaterY: { value: waterY },
    uReefFade: { value: new THREE.Vector2(near, far) },
    uReefAbyss: { value: new THREE.Color(ABYSS) },
  };
  const density = THREE.MathUtils.clamp(Number(params.get('reefdensity') ?? 1) || 1, 0.1, 2); // ?reefdensity=0.5 halves the corals
  const styleOld = params.get('reefstyle') === 'old';
  const cullScale = Number(params.get('reefcull') ?? 1) || 1; // ?reefcull=0.7 culls sooner
  // sand clearings (new style): open sand inside each patch, no coral, lighter shelf
  const clearings = [];
  if (!styleOld) {
    PATCHES.forEach((p) => {
      const n = 2 + Math.round(hash(p.seed * 3.3) * 2);
      for (let i = 0; i < n; i += 1) {
        const a = hash(p.seed * 7 + i * 13.1) * Math.PI * 2;
        const t = 0.25 + 0.55 * hash(p.seed * 5 + i * 3.7);
        clearings.push({ x: p.x + Math.cos(a) * t * p.r, z: p.z + Math.sin(a) * t * p.r, r: 0.6 + hash(p.seed + i * 9.1) * 0.8 });
      }
    });
  }
  const inClearing = (x, z, pad = 0) => clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);

  // Seabed height: patch bowls plus a mound under each rock that buries the rock's base (the boulder
  // instances in createSeaRocks() reach about 0.55 * scale below the water).
  function depthAt(x, z) {
    let best = Infinity;
    for (const p of PATCHES) {
      const t = Math.hypot(x - p.x, z - p.z) / p.r;
      if (t > 1.2) continue;
      const wob = (Math.sin(x * 1.7 + p.seed) * Math.cos(z * 1.3 - p.seed) + Math.sin((x + z) * 3.1)) * 0.08;
      best = Math.min(best, CENTRE_DEPTH + (RIM_DEPTH - CENTRE_DEPTH) * smooth(0.45, 1.0, t) + (t > 1 ? (t - 1) * 8 : 0) + wob);
    }
    if (!Number.isFinite(best)) best = RIM_DEPTH + 1.2; // outside every patch
    for (const [rx, rz, scale] of rocks) {
      const d = Math.hypot(x - rx, z - rz) / (scale * 1.25);
      const top = (styleOld ? 0.5 : 0.62) * scale; // new style: the rock skirts reach the bed, the mound can sit lower
      if (d < 1) best = Math.min(best, top + (best - top) * smooth(0.35, 1.0, d));
    }
    return best;
  }
  const floorY = (x, z) => waterY - depthAt(x, z);

  // Shelf: one merged, vertex-coloured mesh (sand with darker rubble).
  const sand = new THREE.Color(0x6a604c);
  const rubble = new THREE.Color(0x2f2b25);
  const abyss = new THREE.Color(0x0b1114);
  const clearSand = new THREE.Color(0x7d725a);
  const sediment = new THREE.Color(0x24231d);
  const tint = new THREE.Color();
  const discs = PATCHES.map((p) => {
    // Polar grid (rings x segments) so the bowl and the rock mounds have vertices to bend.
    const rings = 14;
    const segs = 48;
    const pos = [];
    const col = [];
    const idx = [];
    for (let i = 0; i <= rings; i += 1) {
      const rr = (i / rings) * p.r * 1.15;
      for (let j = 0; j < segs; j += 1) {
        const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
        const x = p.x + Math.cos(a) * rr;
        const z = p.z + Math.sin(a) * rr;
        pos.push(x, floorY(x, z), z);
        const n = 0.5 + 0.5 * Math.sin(x * 2.3 + z * 1.1 + p.seed) * Math.cos(z * 2.9 - x * 0.7);
        tint.copy(sand).lerp(rubble, smooth(0.35, 0.8, n) * 0.8);
        if (!styleOld) {
          // sand clearings read as open pale sand; the rock mounds as dark sediment / rubble (no pale cone)
          if (inClearing(x, z, 0.25)) tint.lerp(clearSand, 0.75);
          for (const [rx, rz, scale] of rocks) {
            const d = Math.hypot(x - rx, z - rz) / (scale * 1.25);
            if (d < 1.1) tint.lerp(sediment, (1 - smooth(0.45, 1.1, d)) * 0.85);
          }
        }
        // Darker with depth and toward the rim, so the patch edge melts into the unlit open-sea floor.
        tint.lerp(abyss, Math.max(smooth(0.6, 1.15, i / rings * 1.15), smooth(2.2, 3.6, depthAt(x, z)) * 0.8));
        col.push(tint.r, tint.g, tint.b);
      }
    }
    for (let i = 0; i < rings; i += 1) {
      for (let j = 0; j < segs; j += 1) {
        const a = i * segs + j;
        const b = i * segs + ((j + 1) % segs);
        const c = (i + 1) * segs + j;
        const d = (i + 1) * segs + ((j + 1) % segs);
        if (i > 0) idx.push(a, b, c); // counter-clockwise seen from above: normals up (the water bake treats back faces as land)
        idx.push(b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  });
  const shelfMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  underwaterLook(shelfMat, look);
  const shelf = new THREE.Mesh(mergeGeometries(discs), shelfMat);
  discs.forEach((geo) => geo.dispose());
  shelf.name = 'reefShelf';
  shelf.userData.shore = true; // seen by the water shore bake (src/water.js): lighter, clearer water over the reef
  shelf.raycast = () => {};
  scene.add(shelf);

  // Corals: one InstancedMesh per variant, sharing one vertex-colour material with a faint glow.
  const coralMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  underwaterLook(coralMat, look, { glow: true });
  const meshes = new Map();
  gltf.scene.traverse((o) => {
    if (o.isMesh) meshes.set(o.name, o.geometry);
  });
  const group = new THREE.Group();
  group.name = 'reef';
  let instances = 0;
  let tris = 0;
  const kinds = []; // new style: per-kind cull lists
  const perKind = {};
  const dummy = new THREE.Object3D();
  if (styleOld) {
    const total = VARIANTS.reduce((s, v) => s + v[1], 0);
    const picks = VARIANTS.map(() => []);
    const dummy = new THREE.Object3D();
    let serial = 0;
    for (const p of PATCHES) {
      const count = Math.round(p.r * p.r * 1.6 * density);
      for (let k = 0; k < count; k += 1) {
        serial += 1;
        const h1 = hash(p.seed * 101 + k * 7.13);
        const h2 = hash(p.seed * 53 + k * 3.71);
        const t = 0.12 + 0.8 * Math.sqrt(h1);
        const a = h2 * Math.PI * 2;
        const x = p.x + Math.cos(a) * t * p.r;
        const z = p.z + Math.sin(a) * t * p.r;
        if (rocks.some(([rx, rz, scale]) => Math.hypot(x - rx, z - rz) < scale * 0.55)) continue;
        let w = hash(serial * 9.7) * total;
        let v = 0;
        while (w > VARIANTS[v][1] && v < VARIANTS.length - 1) {
          w -= VARIANTS[v][1];
          v += 1;
        }
        const geo = meshes.get(VARIANTS[v][0]);
        if (!geo) continue;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const y = floorY(x, z) - 0.04;
        let s = VARIANTS[v][2] * (0.95 + hash(serial * 4.1) * 0.75) * (1.2 - 0.35 * t);
        const room = waterY - MIN_TIP_DEPTH - y;
        if (geo.boundingBox.max.y * s > room) s = room / geo.boundingBox.max.y;
        if (s < 0.25) continue;
        picks[v].push({ x, y, z, s, yaw: hash(serial * 2.3) * Math.PI * 2, tx: (hash(serial * 5.9) - 0.5) * 0.25, tz: (hash(serial * 6.7) - 0.5) * 0.25 });
      }
    }
    VARIANTS.forEach(([name], v) => {
      const list = picks[v];
      const geo = meshes.get(name);
      if (!geo || !list.length) return;
      const mesh = new THREE.InstancedMesh(geo, coralMat, list.length);
      list.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(it.tx, it.yaw, it.tz);
        dummy.scale.setScalar(it.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = () => {};
      mesh.name = `reef_${name}`;
      group.add(mesh);
      instances += list.length;
      tris += list.length * (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3);
    });

  } else {
    // ---- new style: dense, muted ----
    const kit = buildReefKit();
    // the glb pieces join in, re-shaded to grey so the muted palette shows instead of their baked neon
    const greyed = (geo) => {
      const g = geo.clone();
      const c = g.attributes.color;
      if (c) {
        for (let i = 0; i < c.count; i += 1) {
          const l = 0.299 * c.getX(i) + 0.587 * c.getY(i) + 0.114 * c.getZ(i);
          const v = Math.min(0.95, 0.38 + l * 0.65);
          c.setXYZ(i, v, v, v);
        }
      }
      g.computeBoundingBox();
      return g;
    };
    const P = (...n) => n.map((k) => new THREE.Color(PALETTE[k]));
    for (const [name, w, colors, size, cull] of [
      ['coral_bubble', 0.35, P('sage', 'tan', 'olive', 'brown'), [0.7, 1.2], 11],
      ['coral_plate', 0.6, P('olive', 'brown', 'ochre'), [0.8, 1.3], 14],
      ['urchin', 0.25, P('maroon', 'brown', 'slate'), [0.8, 1.3], 7],
    ]) {
      const geo = meshes.get(name);
      if (geo) kit.push({ name, geo: greyed(geo), colors, size, w, cull, tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3 });
    }
    const totalW = kit.reduce((sum, k) => sum + k.w, 0);
    const pick = (h) => { let w = h * totalW; for (const k of kit) { if (w <= k.w) return k; w -= k.w; } return kit[kit.length - 1]; };
    kit.forEach((k) => { k.list = []; if (!k.geo.boundingBox) k.geo.computeBoundingBox(); });
    const CELL = 0.3;
    let serial = 0;
    for (const p of PATCHES) {
      const n = Math.ceil((p.r * 1.05) / CELL);
      for (let i = -n; i <= n; i += 1) {
        for (let j = -n; j <= n; j += 1) {
          serial += 1;
          const x = p.x + (i + (hash(serial * 1.7 + p.seed) - 0.5) * 0.9) * CELL;
          const z = p.z + (j + (hash(serial * 2.9 + p.seed) - 0.5) * 0.9) * CELL;
          const t = Math.hypot(x - p.x, z - p.z) / p.r;
          if (t > 1.02) continue;
          // denser toward the middle and round the rock mounds (bommies), thin at the rim
          let dens = 0.78 * (1 - smooth(0.55, 1.02, t)) + 0.12;
          let nearRock = false;
          for (const [rx, rz, scale] of rocks) {
            const d = Math.hypot(x - rx, z - rz);
            if (d < scale * 0.78) { dens = 0; break; }
            if (d < scale * 1.7) { dens = Math.min(1, dens + 0.25); nearRock = true; }
          }
          if (inClearing(x, z)) dens = 0.06; // a rubble piece or two on the open sand
          dens *= density;
          if (hash(serial * 3.3 + 0.7) > dens) continue;
          let k = inClearing(x, z) ? kit.find((q) => q.rubble) : pick(hash(serial * 9.7));
          if (!k) continue;
          if (nearRock && k.name === 'table' && hash(serial) < 0.5) k = kit.find((q) => q.name === 'brain') || k;
          const y = floorY(x, z) - 0.03;
          const sz = k.size[0] + (k.size[1] - k.size[0]) * hash(serial * 4.1);
          let s = sz * (1.12 - 0.35 * t);
          const room = waterY - MIN_TIP_DEPTH - y;
          const top = k.geo.boundingBox.max.y;
          if (top * s > room) s = room / top;
          if (s < (k.rubble ? 0.06 : 0.18)) continue;
          const yaw = k.name === 'fan' ? 0.35 + (hash(serial * 2.3) - 0.5) * 0.9 : hash(serial * 2.3) * Math.PI * 2; // fans face the current
          const stretch = 0.85 + hash(serial * 7.7) * 0.3;
          const col = k.colors[Math.floor(hash(serial * 5.3) * k.colors.length) % k.colors.length].clone();
          col.multiplyScalar(0.72 + hash(serial * 6.1) * 0.28);
          k.list.push({ x, y, z, s, sx: s * stretch * (hash(serial * 8.3) < 0.5 ? -1 : 1), sy: s * (0.9 + hash(serial * 1.1) * 0.25), sz2: s / stretch, yaw, tx: (hash(serial * 5.9) - 0.5) * 0.2, tz: (hash(serial * 6.7) - 0.5) * 0.2, col, cull: k.cull * (0.6 + 0.4 * Math.min(1, s / k.size[1])) * cullScale });
        }
      }
    }
    // a skirt of rubble and small coral round each rock base inside a patch (breaks the line where rock meets sand)
    const rub = kit.find((q) => q.rubble);
    for (const [rx, rz, scale] of rocks) {
      if (!PATCHES.some((p) => Math.hypot(rx - p.x, rz - p.z) < p.r + scale)) continue;
      for (let i = 0; i < 26; i += 1) {
        serial += 1;
        const a = hash(serial * 1.3) * Math.PI * 2;
        const d = scale * (0.8 + hash(serial * 2.1) * 0.35);
        const x = rx + Math.cos(a) * d; const z = rz + Math.sin(a) * d;
        const y = floorY(x, z) - 0.02;
        const s = 0.12 + hash(serial * 3.9) * 0.22;
        const col = rub.colors[Math.floor(hash(serial * 5.3) * rub.colors.length) % rub.colors.length].clone().multiplyScalar(0.7);
        rub.list.push({ x, y, z, s, sx: s, sy: s, sz2: s * 1.2, yaw: a, tx: 0, tz: 0, col, cull: rub.cull * cullScale });
      }
    }
    for (const k of kit) {
      if (!k.list.length) continue;
      const mesh = new THREE.InstancedMesh(k.geo, coralMat, k.list.length);
      const mats = new Float32Array(k.list.length * 16);
      const cols = new Float32Array(k.list.length * 3);
      k.list.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(it.tx, it.yaw, it.tz);
        dummy.scale.set(it.sx, it.sy, it.sz2);
        dummy.updateMatrix();
        dummy.matrix.toArray(mats, i * 16);
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, it.col);
        cols[i * 3] = mesh.instanceColor.array[i * 3]; cols[i * 3 + 1] = mesh.instanceColor.array[i * 3 + 1]; cols[i * 3 + 2] = mesh.instanceColor.array[i * 3 + 2];
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = () => {};
      mesh.name = `reef_${k.name}`;
      group.add(mesh);
      instances += k.list.length;
      tris += k.list.length * k.tris;
      kinds.push({ mesh, list: k.list, mats, cols, tris: k.tris, name: k.name });
      perKind[k.name] = { n: k.list.length, tris: Math.round(k.tris) };
    }
  }
  scene.add(group);

  // Hide the coral meshes when the eye is far from every patch (cliff top, beach, start room): 9 fewer draw calls.
  const eye = new THREE.Vector3();
  const lastCull = new THREE.Vector3(1e9, 0, 0);
  const centres = PATCHES.map((p) => ({ v: new THREE.Vector3(p.x, waterY - CENTRE_DEPTH, p.z), r: p.r }));
  const live = { tris: 0, instances: 0 };
  function cull() {
    live.tris = 0; live.instances = 0;
    for (const k of kinds) {
      let n = 0;
      const im = k.mesh.instanceMatrix.array;
      const ic = k.mesh.instanceColor.array;
      for (let i = 0; i < k.list.length; i += 1) {
        const it = k.list[i];
        const dx = it.x - eye.x; const dy = it.y - eye.y; const dz = it.z - eye.z;
        if (dx * dx + dy * dy + dz * dz > it.cull * it.cull) continue;
        if (n !== i) {
          for (let e = 0; e < 16; e += 1) im[n * 16 + e] = k.mats[i * 16 + e];
          ic[n * 3] = k.cols[i * 3]; ic[n * 3 + 1] = k.cols[i * 3 + 1]; ic[n * 3 + 2] = k.cols[i * 3 + 2];
        } else {
          for (let e = 0; e < 16; e += 1) im[n * 16 + e] = k.mats[i * 16 + e];
          ic[n * 3] = k.cols[i * 3]; ic[n * 3 + 1] = k.cols[i * 3 + 1]; ic[n * 3 + 2] = k.cols[i * 3 + 2];
        }
        n += 1;
      }
      k.mesh.count = n;
      k.mesh.visible = n > 0;
      k.mesh.instanceMatrix.needsUpdate = true;
      k.mesh.instanceColor.needsUpdate = true;
      live.tris += n * k.tris;
      live.instances += n;
    }
  }
  function update(camera) {
    if (!camera) return;
    camera.getWorldPosition(eye);
    if (Number.isFinite(hideAt)) {
      let nearest = Infinity;
      for (const c of centres) nearest = Math.min(nearest, eye.distanceTo(c.v) - c.r);
      group.visible = nearest < hideAt;
    }
    if (kinds.length && group.visible && eye.distanceToSquared(lastCull) > 0.75 * 0.75) {
      lastCull.copy(eye);
      cull();
    }
  }

  return {
    group,
    shelf,
    floorY,
    update,
    look,
    stats: { instances, tris, drawCalls: group.children.length + 1, shelfTris: shelf.geometry.index.count / 3, live, perKind },
  };
}
