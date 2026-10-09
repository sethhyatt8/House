// src/raptor.js - the overlook raptor: a cliff-top fight that starts when you top out of the east crag climb. It
// replaces the bear (?legacy=bear brings the bear back).
// Model: "PBR Velociraptor (Animated)" by Ferocious Industries, CC-BY 4.0 (models/enemies/raptor.glb: 15 fight clips,
// meshopt + KTX2). It is used at 1:1 scale: 3.6 m nose to tail, head 1.9 m up, a Utahraptor-sized animal.
//
// den (back of the old bear clearing, out of sight) -> hidden (~15 s: calls from three places around the woods and moves between
// them out of sight, rustling the undergrowth; eyeshine at most) -> emerge (steps out of the tree line, roars) ->
// stalk/circle <-> bite | snap (lunging bite) | leap (crouch + hiss, then a pounce at where you stood: dodge sideways) |
// tackle (head down, scrape, short charge that shoves you; the shove never ends within 0.5 m of an edge) -> hurt /
// knocked down (a missed leap or a solid club hit: a long punish window) -> dead (saved; back in its den after
// RESPAWN_H hours). Leaving the overlook breaks the fight off: it walks back to its den, keeping its wounds.
//
// Movement never teleports. It walks a 0.25 m navigation grid built from the same ground the player walks
// (crag.deckAt, the summit outline and its tree trunks): its feet stay 0.6 m in from every edge, its body clears every
// trunk, and its tail follows the trail its body already cleared.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { proxyMaterial } from './assets.js';
import { DEN as CLEARING, bearOpen } from './overlookshape.js';
import { summitTrees } from './overlookwoods.js';

const SAVE_KEY = 'house.raptor.v1';
export const RESPAWN_H = 24;
const RAPTOR_HP = 140;
const HIDE_S = 15;                         // hidden intro length (?raptorhide=)
// damage to the player (x ?raptordmg=) and shove distance (m)
const HURT = { bite: 14, snap: 18, leap: 26, tackle: 20 };
const SHOVE = { bite: 0.3, snap: 0.4, leap: 0.85, tackle: 1.1 };
// damage to the raptor
const ARROW = { head: 24, neck: 16, chest: 13, body: 11, hips: 9, leg: 6, arm: 5, tail: 4 };
const ZONE_MULT = { head: 1.5, neck: 1.25, chest: 1, body: 1, hips: 0.85, leg: 0.6, arm: 0.5, tail: 0.4 };
// hit zones: name, bone (prefix), model-space centre in the bind pose (faces +Z, feet at y 0) or null = the bone itself, radius
const ZONES = [
  ['head', 'Head_', [-0.14, 1.7, 1.08], 0.25],
  ['neck', 'Neck_2_', [-0.11, 1.42, 0.64], 0.22],
  ['chest', 'Spine_3_', [-0.02, 1.05, 0.36], 0.36],
  ['body', 'Spine_1_', [0.01, 1.13, -0.2], 0.38],
  ['hips', 'Spine_1_', [0.02, 1.12, -0.62], 0.32],
  ['tail', 'Tail_2_', [0.05, 1.5, -1.05], 0.2],
  ['tail', 'Tail_5_', [0.09, 1.68, -1.55], 0.15],
  ['leg', 'LowerLegL_', null, 0.18],
  ['leg', 'LowerLegR_', null, 0.18],
  ['arm', 'HandL_', null, 0.14],
  ['arm', 'HandR_', null, 0.14],
];
// root motion baked into these clips (metres along +Z at 1:1) is stripped from the bones and driven by the AI instead,
// so every step of a leap / tackle / fall is checked against trunks and edges
const ROOT_MOTION = ['Leap_01', 'Tackle', 'Knocked Down', 'Death_01', 'Death_02', 'Roar_02'];
const ONCE = ['Call_Alert', 'Roar_01', 'Roar_02', 'Bite_01', 'Bite_02', 'Leap_01', 'Tackle', 'Hurt_01', 'Knocked Down', 'Death_01', 'Death_02'];
const GAIT = { Walk: 1.5, Jog: 3.1, Sprint: 5.4 };   // ground speed (m/s) at clip time scale 1
// body points (metres ahead of the root): [ahead, trunk clearance, ground margin (-1 = no ground needed: the head)]
const BODY = [[0, 0.42, 0.6], [0.6, 0.36, 0.35], [-0.4, 0.36, 0.35], [1.35, 0.24, -1]];
const TAIL = { base: 0.45, len: 1.75, clear: 0.12, max: 1.1 };

export function createRaptor(scene, { assets, crag, golf = null, gear = null, targets = null, hockey = null }) {
  const params = new URLSearchParams(location.search);
  const flag = (k) => params.get('raptor' + k) ?? params.get('bear' + k);
  if (!assets?.feature('raptor') || params.get('bear') === '0' || !crag?.deckAt || !crag.summit) return null;
  const DEBUG = flag('debug') === '1';
  const rawDmg = flag('dmg');
  const DMG = rawDmg == null || rawDmg === '' || !Number.isFinite(Number(rawDmg)) ? 1 : Math.max(0, Number(rawDmg));
  const MAX_HP = Math.max(1, Number(flag('hp')) || RAPTOR_HP);
  const HIDE = Math.max(3, Number(flag('hide')) || HIDE_S);
  const deckY = crag.deckY;
  const ladder = crag.ladder?.userData || {};
  const climbBaseY = ladder.shaft?.base ?? deckY - 25;
  if (params.get('raptor') === 'reset' || params.get('bear') === 'reset') save(null);
  const trunks = summitTrees().map((t) => ({ x: t.x, z: t.z, r: Math.max(0.16, t.trunk) }));

  // --- ground + navigation grid -------------------------------------------------
  // ground height under (x, z) for the raptor: the summit floor (flat arena, rising woods) and the flat crown/shoulder
  // west of the lip; never a climbing ledge
  function gY(x, z) {
    if (x >= 3.42) return crag.deckAt(x, z);
    const y = crag.bearDeckAt ? crag.bearDeckAt(x, z) : crag.deckAt(x, z);
    return y != null && Math.abs(y - deckY) < 0.01 ? y : null;
  }
  function trunkClear(x, z) {
    let best = 99;
    for (const t of trunks) { const d = Math.hypot(t.x - x, t.z - z) - t.r; if (d < best) best = d; }
    return best;
  }
  // ground under (x,z) and all round it at radius m, no step over 0.3 m (feet), not up the steep back of the woods
  function standOk(x, z, m) {
    const y = gY(x, z);
    if (y == null) return false;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      const yy = gY(x + Math.cos(a) * m, z + Math.sin(a) * m);
      if (yy == null || Math.abs(yy - y) > Math.max(0.3, m * 0.8)) return false;   // up to ~38 deg (the slope behind the den)
    }
    return y - deckY < 3;
  }
  const G = { x0: 1.4, z0: -9.4, s: 0.25, nx: 0, nz: 0, ok: null, clr: null, nav: null };
  function buildGrid() {
    G.nx = Math.ceil((20.6 - G.x0) / G.s); G.nz = Math.ceil((9.4 - G.z0) / G.s);
    G.ok = new Uint8Array(G.nx * G.nz); G.clr = new Float32Array(G.nx * G.nz);
    for (let j = 0; j < G.nz; j += 1) {
      for (let i = 0; i < G.nx; i += 1) {
        const x = G.x0 + (i + 0.5) * G.s; const z = G.z0 + (j + 0.5) * G.s;
        const c = trunkClear(x, z);
        G.clr[j * G.nx + i] = c;
        G.ok[j * G.nx + i] = c >= BODY[0][1] && standOk(x, z, BODY[0][2]) ? 1 : 0;
      }
    }
  }
  // nav cells: room to pivot. The whole animal (any tail swing) fits there at 5+ of 8 headings, so a path through
  // nav cells never leads it into a gap it can't turn round in.
  // built a few rows per frame (~4 ms) while you climb; finished at once if it's needed before that
  function navStep(budgetMs) {
    const t0 = Date.now();
    while (G.navRow < G.nz && Date.now() - t0 < budgetMs) { navRow(G.navRow); G.navRow += 1; }
    s.navMs = (s.navMs ?? 0) + (Date.now() - t0);
  }
  function navRow(j) {
    {
      for (let i = 0; i < G.nx; i += 1) {
        if (!G.ok[j * G.nx + i]) continue;
        const x = G.x0 + (i + 0.5) * G.s; const z = G.z0 + (j + 0.5) * G.s;
        let n = 0;
        for (let k = 0; k < 8 && n + (8 - k) >= 6; k += 1) {
          const yaw = (k / 8) * Math.PI * 2;
          for (const b of [0, 0.55, -0.55, 1.1, -1.1]) if (fits(x, z, yaw, b)) { n += 1; break; }
        }
        if (n >= 6) G.nav[j * G.nx + i] = 1;
      }
    }
  }
  function navOk(i, j) { return i >= 0 && j >= 0 && i < G.nx && j < G.nz && G.nav[j * G.nx + i] === 1; }
  const navAt = (x, z) => navOk(...cellOf(x, z));
  const cellOf = (x, z) => [Math.floor((x - G.x0) / G.s), Math.floor((z - G.z0) / G.s)];
  function cellOk(i, j) { return i >= 0 && j >= 0 && i < G.nx && j < G.nz && G.ok[j * G.nx + i] === 1; }
  function rootOk(x, z) { const [i, j] = cellOf(x, z); return cellOk(i, j) && trunkClear(x, z) >= BODY[0][1] && standOk(x, z, BODY[0][2]); }
  // the whole animal at (x, z, yaw): feet, chest and hips on ground, every body point clear of the trunks, and the
  // tail (bent by `bend`) clear of the trunks too
  function fits(x, z, yaw, bend = s.bend) {
    const fx = Math.sin(yaw); const fz = Math.cos(yaw);
    for (const [ahead, clr, edge] of BODY) {
      const px = x + fx * ahead; const pz = z + fz * ahead;
      if (ahead === 0) { if (!rootOk(px, pz)) return false; continue; }
      if (trunkClear(px, pz) < clr) return false;
      if (edge >= 0 && !standOk(px, pz, edge)) return false;
    }
    const t = tailPoints(x, z, yaw, bend);
    return trunkClear(t[0], t[1]) >= TAIL.clear + 0.06 && trunkClear(t[2], t[3]) >= TAIL.clear;
  }
  const tailOut = [0, 0, 0, 0];
  function tailPoints(x, z, yaw, bend) {   // [midX, midZ, tipX, tipZ]
    const c = Math.cos(yaw); const sn = Math.sin(yaw);
    const bx = x - sn * TAIL.base; const bz = z - c * TAIL.base;
    const lx = -Math.sin(bend); const lz = -Math.cos(bend);
    const wx = lx * c + lz * sn; const wz = -lx * sn + lz * c;
    tailOut[0] = bx + wx * TAIL.len * 0.5; tailOut[1] = bz + wz * TAIL.len * 0.5;
    tailOut[2] = bx + wx * TAIL.len; tailOut[3] = bz + wz * TAIL.len;
    return tailOut;
  }
  function lineOk(ax, az, bx, bz) {   // every cell on the segment is a valid root cell
    const len = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.ceil(len / 0.2));
    for (let k = 1; k <= n; k += 1) { const [i, j] = cellOf(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n); if (!navOk(i, j)) return false; }
    return true;
  }
  // A* over the grid (8-neighbour), with optional per-cell extra cost; returns string-pulled world points or null
  function plan(ax, az, bx, bz, extra = null) {
    let [si, sj] = cellOf(ax, az); let [ti, tj] = cellOf(bx, bz);
    [si, sj] = nearestOk(si, sj); [ti, tj] = nearestOk(ti, tj);
    if (si < 0 || ti < 0) return null;
    const N = G.nx * G.nz; const gs = new Float32Array(N).fill(Infinity); const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N); const heap = [];
    const push = (f, n) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const s0 = sj * G.nx + si; const goal = tj * G.nx + ti;
    gs[s0] = 0; push(0, s0);
    let found = false; let n = 0;
    while (heap.length && n < 20000) {
      const [, cur] = pop(); n += 1;
      if (closed[cur]) continue; closed[cur] = 1;
      if (cur === goal) { found = true; break; }
      const ci = cur % G.nx; const cj = (cur - ci) / G.nx;
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          if (!di && !dj) continue;
          const ni = ci + di; const nj = cj + dj;
          if (!navOk(ni, nj) || (di && dj && (!navOk(ci + di, cj) || !navOk(ci, cj + dj)))) continue;
          const nn = nj * G.nx + ni;
          if (closed[nn]) continue;
          const stepCost = (di && dj ? 1.414 : 1) * G.s * (1 + Math.max(0, 1.0 - G.clr[nn]) * 5 + (extra ? extra(ni, nj) : 0));
          const g = gs[cur] + stepCost;
          if (g < gs[nn]) { gs[nn] = g; from[nn] = cur; push(g + Math.hypot(ti - ni, tj - nj) * G.s, nn); }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => { const i = c % G.nx; const j = (c - i) / G.nx; return [G.x0 + (i + 0.5) * G.s, G.z0 + (j + 0.5) * G.s]; });
    if (navOk(...cellOf(bx, bz))) pts[pts.length - 1] = [bx, bz];
    // string-pull (a stealth path only pulls short spans so it keeps its detours behind the trunks)
    const out = []; let a = [ax, az]; let k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let m = Math.min(pts.length - 1, k + (extra ? 6 : 40)); m > k + 1; m -= 1) if (lineOk(a[0], a[1], pts[m][0], pts[m][1])) { far = m; break; }
      out.push(pts[far]); a = pts[far]; k = far;
    }
    return out.length ? out : [[bx, bz]];
  }
  function nearestOk(i, j) {
    if (navOk(i, j)) return [i, j];
    for (let r = 1; r < 8; r += 1) for (let dj = -r; dj <= r; dj += 1) for (let di = -r; di <= r; di += 1) if (Math.max(Math.abs(di), Math.abs(dj)) === r && navOk(i + di, j + dj)) return [i + di, j + dj];
    return [-1, -1];
  }

  // --- sight lines (hidden phase) -----------------------------------------------
  // a line from the player's eye to a point is blocked by a trunk (2D) or by the ground between them
  function blocked(ex, ey, ez, px, py, pz) {
    const dx = px - ex; const dz = pz - ez; const len2 = dx * dx + dz * dz || 1;
    for (const t of trunks) {
      const k = THREE.MathUtils.clamp(((t.x - ex) * dx + (t.z - ez) * dz) / len2, 0, 1);
      if (k < 0.02 || k > 0.995) continue;
      if (Math.hypot(ex + dx * k - t.x, ez + dz * k - t.z) < t.r + 0.04) return true;
    }
    for (let k = 1; k < 10; k += 1) {
      const f = k / 10; const y = gY(ex + dx * f, ez + dz * f);
      if (y != null && y + 0.2 > ey + (py - ey) * f) return true;
    }
    return false;
  }

  const root = new THREE.Group();
  root.name = 'raptor';
  root.rotation.order = 'YXZ';
  scene.add(root);
  const listeners = {};
  const emit = (type, data = {}) => (listeners[type] || []).forEach((fn) => fn({ type, bear: api, raptor: api, ...data }));
  const DEN = { x: 12.5, z: 1.15, yaw: -Math.PI / 2 };   // back of the old bear clearing (in the trees' shadow), facing west
  const s = {
    state: 'off', t: 0, clock: 0, hp: MAX_HP, x: DEN.x, z: DEN.z, y: deckY, yaw: DEN.yaw, bend: 0, pitch: 0,
    engaged: 0, lastAttack: -99, cool: 1.5, struck: false, attack: null, arrived: false, lastClimb: -99, away: 0,
    flinch: 0, kills: 0, ballAt: -99, chopAt: -99, rewarded: false, ready: false,
    lastLeap: -99, lastTackle: -99, lastHurt: -99, lastKnock: -99, rageQueued: false, rage: 0, circle: 1, circleT: 0,
    path: null, pathTo: [0, 0], pathT: 0, stuck: 0, backT: 0, turnLong: 0, turnBlocked: 0, bendHold: 0, bendWant: 0, unstuck: 0, crouch: 0, opacity: 1, veil: 0, exposure: 0, maxExposure: 0, eyes: 0,
    hideT: 0, spots: [], leg: 0, legPhase: 'go', calls: [], rmScale: 1, rmPrev: 0, lockX: 0, lockZ: 0, hidden: false,
  };
  root.position.set(s.x, s.y, s.z); root.rotation.set(0, s.yaw, 0, 'YXZ');
  const saved = load();
  s.kills = saved?.kills ?? 0;
  const gone = saved?.killedAt && Date.now() - saved.killedAt < RESPAWN_H * 3600e3;
  let model = null; let claw = null;
  if (gone) { s.state = 'gone'; claw = spawnClaw(CLEARING.x - 0.6, CLEARING.z + 0.2); }

  // --- model ---------------------------------------------------------------------
  let mixer = null; const actions = {}; let current = null; const skins = []; const mats = [];
  const bones = {}; const zones = []; const rest = new Map(); const animated = new Set();
  const axisUp = {}; const axisSide = {}; const rm = {}; const byPrefix = {};
  const B = (prefix) => (byPrefix[prefix] ??= Object.keys(bones).find((n) => n.startsWith(prefix)));
  let eyes = null; let leaves = null;
  function stripRootMotion(gltf, vis) {
    if (gltf.userData.raptorRM) { Object.assign(rm, gltf.userData.raptorRM); return; }
    const rootBone = Object.values(bones).find((b) => /^Root_/.test(b.name));
    if (!rootBone) return;
    vis.updateMatrixWorld(true);
    const parentW = rootBone.parent.matrixWorld.clone(); const inv = parentW.clone().invert();
    const v = new THREE.Vector3(); const w0 = new THREE.Vector3();
    for (const clip of gltf.animations) {
      if (!ROOT_MOTION.includes(clip.name)) continue;
      const tr = clip.tracks.find((t) => t.name === `${rootBone.name}.position`);
      if (!tr) continue;
      const vals = tr.values; const n = tr.times.length;
      w0.fromArray(vals, 0).applyMatrix4(parentW);
      const zs = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        v.fromArray(vals, i * 3).applyMatrix4(parentW);
        zs[i] = v.z - w0.z;
        v.x = w0.x; v.z = w0.z;
        v.applyMatrix4(inv).toArray(vals, i * 3);
      }
      rm[clip.name] = { times: Float32Array.from(tr.times), z: zs, total: zs[n - 1] };
    }
    gltf.userData.raptorRM = { ...rm };
  }
  function rmAt(name, t) {
    const c = rm[name];
    if (!c) return 0;
    const ts = c.times; if (t <= ts[0]) return c.z[0]; if (t >= ts[ts.length - 1]) return c.z[ts.length - 1];
    let lo = 0; let hi = ts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
    const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
    return c.z[lo] + (c.z[hi] - c.z[lo]) * f;
  }
  function build(gltf) {
    if (model || !gltf) return;
    const vis = skeletonClone(gltf.scene);
    vis.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (o.isSkinnedMesh) {
        skins.push(o);
        o.material = o.material.clone();
        o.material.userData.base = o.material.color.clone();
        mats.push(o.material);
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.raycast = () => {};
      }
    });
    if (!skins.length) return;
    stripRootMotion(gltf, vis);
    root.add(vis);
    root.position.set(s.x, s.y, s.z); root.rotation.set(0, s.yaw, 0, 'YXZ');
    root.updateMatrixWorld(true);
    const wq = new THREE.Quaternion(); const rootInv = root.quaternion.clone().invert();
    for (const [name, b] of Object.entries(bones)) {
      rest.set(b, b.quaternion.clone());
      b.getWorldQuaternion(wq); wq.premultiply(rootInv).invert();
      axisUp[name] = new THREE.Vector3(0, 1, 0).applyQuaternion(wq).normalize();
      axisSide[name] = new THREE.Vector3(1, 0, 0).applyQuaternion(wq).normalize();
    }
    for (const clip of gltf.animations) for (const tr of clip.tracks) if (tr.name.endsWith('.quaternion')) animated.add(tr.name.split('.')[0]);
    const tmp = new THREE.Vector3(); const ws = new THREE.Vector3();
    for (const [name, prefix, c, r] of ZONES) {
      const b = bones[B(prefix)];
      if (!b) continue;
      const zone = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), proxyMaterial);
      if (c) zone.position.copy(b.worldToLocal(root.localToWorld(tmp.set(...c))));
      b.getWorldScale(ws);
      zone.scale.setScalar(r / ws.x);
      Object.assign(zone.userData, { foeZone: name, foe: api, noTarget: true, r });
      b.add(zone);
      zones.push(zone);
    }
    if (DEBUG) {
      const wire = new THREE.MeshBasicMaterial({ color: 0xff3050, wireframe: true, depthTest: false });
      zones.forEach((z) => { const w = new THREE.Mesh(z.geometry, wire); w.raycast = () => {}; z.add(w); });
    }
    mixer = new THREE.AnimationMixer(vis);
    for (const clip of gltf.animations) {
      const a = mixer.clipAction(clip);
      if (ONCE.includes(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions[clip.name] = a;
    }
    eyes = makeEyes(); root.add(eyes.group);
    leaves = makeLeaves(); scene.add(leaves.points);
    const t0 = Date.now(); buildGrid(); s.gridMs = Date.now() - t0;
    G.nav = new Uint8Array(G.nx * G.nz); G.navRow = 0; navStep(4);
    model = vis;
    s.ready = true;
    if (s.state === 'off') { setState('den'); play('Idle_01', 0, 0.6); }
    mixer.update(0);
    visibility(0);
    emit('ready');
  }
  function prefetch() {
    if (model || s.state === 'gone' || s.loading) return;
    s.loading = true;
    assets.whenReady('raptor').then((gltf) => build(gltf));
  }
  function play(name, fade = 0.25, timeScale = 1, from = null) {
    const next = actions[name];
    if (!next) return null;
    next.setEffectiveTimeScale(timeScale);
    if (current === next && from == null) return next;
    next.reset();
    if (from != null) next.time = from * next.getClip().duration;
    next.setEffectiveWeight(1).play();
    if (current && current !== next) current.crossFadeTo(next, fade, false);
    current = next;
    s.rmPrev = rmAt(name, next.time);
    return next;
  }
  function norm(a = current) { return a ? Math.min(1, a.time / a.getClip().duration) : 0; }

  // eyeshine: two small additive glints on the eye bones (the only part of it you may see clearly while it hides)
  function makeEyes() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const g2 = cv.getContext('2d');
    if (g2) {
      const gr = g2.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(230,255,120,0.9)'); gr.addColorStop(1, 'rgba(120,160,20,0)');
      g2.fillStyle = gr; g2.fillRect(0, 0, 32, 32);
    }
    const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), color: 0xe6ff8a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false });
    const group = new THREE.Group();
    const l = new THREE.Sprite(mat); const r = new THREE.Sprite(mat);
    l.scale.setScalar(0.075); r.scale.setScalar(0.075);
    l.raycast = () => {}; r.raycast = () => {};
    group.add(l, r);
    group.visible = false;
    return { group, l, r, mat };
  }
  // falling needles/leaves where it pushes through the undergrowth
  function makeLeaves() {
    const N = 48;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3).fill(-999), 3));
    const mat = new THREE.PointsMaterial({ color: 0x3d4a2a, size: 0.045, transparent: true, opacity: 0.95, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false; points.raycast = () => {};
    return { points, N, life: new Float32Array(N), vel: new Float32Array(N * 3), next: 0 };
  }
  function shedLeaves(x, y, z, n = 8) {
    const L = leaves; if (!L) return;
    const pos = L.points.geometry.attributes.position;
    for (let k = 0; k < n; k += 1) {
      const i = L.next; L.next = (L.next + 1) % L.N;
      pos.setXYZ(i, x + (Math.random() - 0.5) * 1.2, y + 1.3 + Math.random() * 1.4, z + (Math.random() - 0.5) * 1.2);
      L.vel[i * 3] = (Math.random() - 0.5) * 0.4; L.vel[i * 3 + 1] = -0.25 - Math.random() * 0.4; L.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      L.life[i] = 1.6 + Math.random() * 0.8;
    }
    pos.needsUpdate = true;
  }
  function tickLeaves(dt) {
    const L = leaves; if (!L) return;
    const pos = L.points.geometry.attributes.position; let any = false;
    for (let i = 0; i < L.N; i += 1) {
      if (L.life[i] <= 0) continue;
      any = true;
      L.life[i] -= dt;
      if (L.life[i] <= 0) { pos.setXYZ(i, -999, -999, -999); continue; }
      const sway = Math.sin((L.life[i] + i) * 5) * 0.25;
      pos.setXYZ(i, pos.getX(i) + (L.vel[i * 3] + sway) * dt, pos.getY(i) + L.vel[i * 3 + 1] * dt, pos.getZ(i) + L.vel[i * 3 + 2] * dt);
    }
    if (any) pos.needsUpdate = true;
  }

  // --- player tracking --------------------------------------------------------
  const P = { x: 0, z: 0, headY: 0, feetY: -99, onGround: false, inZone: false, inWoods: false };
  function readPlayer(p) {
    if (!p) return false;
    P.x = p.x; P.z = p.z; P.headY = p.headY ?? p.feetY + 1.6; P.feetY = p.feetY ?? P.headY - 1.6;
    const g = crag.deckAt(P.x, P.z);
    P.onGround = g != null && Math.abs(P.feetY - g) < 0.4 && g > deckY - 0.3;
    P.inZone = P.feetY > deckY - 2.5 && P.x > -4.5 && P.x < 21.5 && P.z > -9.5 && P.z < 9;
    P.inWoods = P.onGround && P.x >= 3.42 && !bearOpen(P.x, P.z);
    const climbing = P.x > 2.75 && P.z > -3.1 && P.z < -1.3 && P.feetY < deckY - 0.2 && P.feetY > climbBaseY - 0.5;
    if (climbing) s.lastClimb = s.clock;
    if ((climbing && P.feetY > deckY - 15) || P.inZone) prefetch();
    if (P.onGround && !s.arrived && (s.clock - s.lastClimb < 4 || DEBUG)) s.arrived = true;   // topped out of the climb
    return true;
  }
  const dist = () => Math.hypot(P.x - s.x, P.z - s.z);
  function angleTo(x, z) { const a = Math.atan2(x - s.x, z - s.z) - s.yaw; return Math.atan2(Math.sin(a), Math.cos(a)); }

  // --- locomotion -------------------------------------------------------------
  const crumbs = [];   // trail of root positions (the tail follows it)
  // a tail bend that fits at (x, z, yaw): the one that trails it back along the path first, then straighter/other
  // sides (the tail swings when it pivots); null = nothing fits
  function bendFits(x, z, yaw) {
    const pref = tailBendFor(x, z, yaw);
    for (const b of [pref, s.bend, 0, pref * 0.5, 0.55, -0.55, 1.1, -1.1]) if (fits(x, z, yaw, b)) return b;
    return null;
  }
  function holdBend(b) { if (b !== s.bend) { s.bendWant = b; s.bendHold = 0.7; } }
  function step(nx, nz) {
    for (const [x, z, r] of [[nx, nz, true], [nx, s.z, 'slide'], [s.x, nz, 'slide']]) {
      if (fits(x, z, s.yaw)) { s.x = x; s.z = z; return r; }
      const b = bendFits(x, z, s.yaw);
      if (b != null) { s.x = x; s.z = z; holdBend(b); return r; }
    }
    return false;
  }
  // turn toward heading `want` (rad) only while body and tail fit (the tail may swing); if the short way round is
  // blocked it pivots the long way. Returns the angle still to turn.
  function turn(want, rate, dt) {
    let d = want - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 1e-4) return 0;
    const short = THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
    const long = -Math.sign(d) * rate * dt;
    // short way first; once it has had to swing the long way round it keeps going that way (no dithering)
    const order = s.turnLong > 0 && Math.abs(d) > 0.6 ? [long, short] : [short, long];
    s.turnLong = Math.max(0, (s.turnLong ?? 0) - dt);
    // pivot on the spot, else pivot while shuffling back or forward a little (a three-point turn in tight trees)
    const fx = Math.sin(s.yaw); const fz = Math.cos(s.yaw);
    for (const [st, mv] of [[order[0], 0], [order[0], -0.8 * dt], [order[0], 0.5 * dt], [order[1], 0], [order[1], -0.8 * dt], [order[1], 0.5 * dt]]) {
      const nx = s.x + fx * mv; const nz = s.z + fz * mv;
      const b = bendFits(nx, nz, s.yaw + st);
      if (b == null) continue;
      s.x = nx; s.z = nz; s.yaw += st; holdBend(b);
      if (st === long && st !== short && order[0] === short && Math.abs(d) > rate * dt) s.turnLong = 0.6;   // had to: commit
      let r = want - s.yaw; r = Math.atan2(Math.sin(r), Math.cos(r));
      return Math.abs(r);
    }
    s.turnBlocked = (s.turnBlocked ?? 0) + dt;
    return Math.abs(d);
  }
  const turnTo = (x, z, rate, dt) => turn(Math.atan2(x - s.x, z - s.z), rate, dt);
  // walk toward (tx, tz) along a planned path: true while moving, 'arrived', or false (blocked this frame)
  function travel(tx, tz, speed, dt, { stealth = false, stop = 0.35, rate = 3 } = {}) {
    const dd = Math.hypot(tx - s.x, tz - s.z);
    if (dd < stop) { s.path = null; s.stuck = 0; return 'arrived'; }
    if (s.backT > 0) {   // unsticking: back off along the way it came while turning toward the next waypoint
      s.backT -= dt;
      const moved = backUp(dt);
      if (s.path?.length) turnTo(s.path[0][0], s.path[0][1], rate, dt);
      if (!moved) sidestep(dt);
      return true;
    }
    s.pathT -= dt;
    if (!stealth && lineOk(s.x, s.z, tx, tz)) s.path = [[tx, tz]];
    else if (!s.path || s.pathT <= 0 || Math.hypot(s.pathTo[0] - tx, s.pathTo[1] - tz) > 0.8) {
      s.path = plan(s.x, s.z, tx, tz, stealth ? exposureCost : null);
      s.pathT = stealth ? 1.2 : 0.6; s.progM = Infinity;
      if (!s.path) { s.stuck += dt; return false; }
    }
    s.pathTo = [tx, tz];
    while (s.path.length > 1 && Math.hypot(s.path[0][0] - s.x, s.path[0][1] - s.z) < 0.45) s.path.shift();
    const [wx, wz] = s.path[0];
    const left = turnTo(wx, wz, rate, dt);
    const sp = left > 1.0 ? 0 : left > 0.5 ? speed * 0.4 : speed;   // pivot first (it is long), then go
    const x0 = s.x; const z0 = s.z;
    const ok = step(s.x + Math.sin(s.yaw) * sp * dt, s.z + Math.cos(s.yaw) * sp * dt);
    const prog = Math.hypot(s.x - x0, s.z - z0);
    // stuck = not getting anywhere: blocked, sliding along something, or unable to turn toward the path
    // stuck = not getting anywhere over half a second (blocked, sliding along something, or pivoting back and forth)
    s.progT = (s.progT ?? 0) + dt;
    if (s.progT >= 0.5) {
      const metric = Math.hypot(wx - s.x, wz - s.z) + 0.6 * left;
      const gain = (s.progM ?? Infinity) - metric;
      s.progT = 0; s.progM = metric;
      if (gain < 0.08 && gain !== -Infinity) {
        s.stuck += 0.5;
        if (s.stuck >= 0.5) { s.stuck = 0; s.pathT = 0; s.progM = Infinity; s.backT = 0.45 + Math.random() * 0.35; s.unstuck = (s.unstuck ?? 0) + 1; }
      } else s.stuck = 0;
    }
    if (!ok) return false;
    s.turnBlocked = 0;
    return true;
  }
  function backUp(dt) {   // stuck: shuffle back the way it came (that ground was clear)
    const bx = s.x - Math.sin(s.yaw) * 0.9 * dt; const bz = s.z - Math.cos(s.yaw) * 0.9 * dt;
    if (fits(bx, bz, s.yaw)) { s.x = bx; s.z = bz; return true; }
    const b = bendFits(bx, bz, s.yaw);
    if (b != null) { s.x = bx; s.z = bz; holdBend(b); return true; }
    return false;
  }
  function sidestep(dt) {   // last resort: a small step sideways (either side) that fits
    const c = Math.cos(s.yaw); const sn = Math.sin(s.yaw);
    for (const k of [1, -1]) {
      const x = s.x + c * k * 0.7 * dt; const z = s.z - sn * k * 0.7 * dt;
      const b = bendFits(x, z, s.yaw);
      if (b != null) { s.x = x; s.z = z; holdBend(b); return true; }
    }
    return false;
  }
  function gaitFor(speed) {   // clip + time scale for a ground speed
    const name = speed < 2.2 ? 'Walk' : speed < 4.2 ? 'Jog' : 'Sprint';
    return [name, THREE.MathUtils.clamp(speed / GAIT[name], 0.55, 1.5)];
  }
  function moveAnim(moved, speed) {
    if (!moved) { play('Idle_01', 0.3); return; }
    const [name, ts] = gaitFor(speed);
    play(name, 0.3, ts);
  }
  function rootMotion(scale = 1) {   // advance along the facing by the clip's stripped root motion (collision-checked)
    const name = current?.getClip().name;
    if (!rm[name]) return true;
    const now = rmAt(name, current.time);
    const dz = (now - s.rmPrev) * scale; s.rmPrev = now;
    if (Math.abs(dz) < 1e-5) return true;
    return step(s.x + Math.sin(s.yaw) * dz, s.z + Math.cos(s.yaw) * dz) === true;
  }
  // tail bend that points the tail back along the trail (clamped); unchanged while there's no trail yet
  function tailBendFor(x, z, yaw) {
    let acc = 0; let px = x; let pz = z; let tx = null; let tz = null;
    for (let i = crumbs.length - 1; i >= 0; i -= 1) {
      const c = crumbs[i]; acc += Math.hypot(c[0] - px, c[1] - pz); px = c[0]; pz = c[1];
      if (acc >= 1.3) { tx = c[0]; tz = c[1]; break; }
    }
    if (tx == null) return THREE.MathUtils.clamp(s.bend, -TAIL.max, TAIL.max);
    const dx = tx - x; const dz = tz - z; const c = Math.cos(yaw); const sn = Math.sin(yaw);
    const lx = dx * c - dz * sn; const lz = dx * sn + dz * c;
    return THREE.MathUtils.clamp(Math.atan2(-lx, -lz), -TAIL.max, TAIL.max);
  }
  function laneFits(tx, tz, extra = 0) {   // straight run at (tx,tz) and `extra` past it: metres that fit (0.3 m steps)
    const dx = tx - s.x; const dz = tz - s.z; const len = Math.hypot(dx, dz) + extra; const yaw = Math.atan2(dx, dz);
    for (let k = 0.3; k <= len; k += 0.3) if (!fits(s.x + Math.sin(yaw) * k, s.z + Math.cos(yaw) * k, yaw, 0)) return k - 0.3;
    return len;
  }

  // --- hidden phase -------------------------------------------------------------
  const eye = new THREE.Vector3();
  function viewFromPlayer(out = eye) { return out.set(P.x, P.headY, P.z); }
  const expMemo = { at: [1e9, 1e9], v: null };   // per-cell sight cost, reused until you move 0.5 m
  function exposureCost(i, j) {   // stealth path cost: cells you could see it in from where you stand
    if (!expMemo.v || Math.hypot(expMemo.at[0] - P.x, expMemo.at[1] - P.z) > 0.5) { expMemo.v = new Int8Array(G.nx * G.nz).fill(-1); expMemo.at = [P.x, P.z]; }
    const k = j * G.nx + i;
    if (expMemo.v[k] < 0) {
      const x = G.x0 + (i + 0.5) * G.s; const z = G.z0 + (j + 0.5) * G.s;
      const y = gY(x, z) ?? deckY;
      expMemo.v[k] = blocked(P.x, P.headY, P.z, x, y + 1.3, z) ? 0 : 6;
    }
    return expMemo.v[k];
  }

  // three calling places around the woods (north, east, south of the arena) with the fewest open sight lines from
  // where you stand, the top-out and the middle of the arena
  function pickSpots() {
    const views = [[P.x, P.headY, P.z], [3.7, deckY + 1.6, -2.0], [5.6, deckY + 1.6, 0.2]];
    const sectors = { north: [], east: [], south: [] };
    for (let j = 0; j < G.nz; j += 2) for (let i = 0; i < G.nx; i += 2) {
      if (!navOk(i, j)) continue;
      const x = G.x0 + (i + 0.5) * G.s; const z = G.z0 + (j + 0.5) * G.s;
      if ((bearOpen(x, z) && x < 11) || x < 6) continue;   // the woods (and the back of the old den clearing)
      const r = Math.hypot(x - 5.6, z);
      if (r < 5 || r > 11.5 || !fits(x, z, Math.atan2(P.x - x, P.z - z), 0)) continue;
      const y = gY(x, z);
      let seen = 0;
      for (const v of views) for (const h of [0.9, 1.4, 1.9]) if (!blocked(v[0], v[1], v[2], x, y + h, z)) seen += 1;
      const ang = Math.atan2(z, x - 5.6);
      const sec = ang > 0.75 ? 'north' : ang < -0.75 ? 'south' : 'east';
      sectors[sec].push({ x, z, seen: seen + Math.abs(r - 8.5) * 0.15 });
    }
    // a chain of three: each one 3.5-7.5 m (by path) from the last, the fewest sight lines first
    const all = [...sectors.north.map((o) => ({ ...o, sector: 'north' })), ...sectors.east.map((o) => ({ ...o, sector: 'east' })), ...sectors.south.map((o) => ({ ...o, sector: 'south' }))]
      .sort((p, q) => p.seen - q.seen);
    const pathLen = (ax, az, bx, bz) => {
      const pl = plan(ax, az, bx, bz); if (!pl) return Infinity;
      let L = 0; let px = ax; let pz = az; for (const [x, z] of pl) { L += Math.hypot(x - px, z - pz); px = x; pz = z; } return L;
    };
    const out = []; let cx = s.x; let cz = s.z;
    for (let leg = 0; leg < 3; leg += 1) {
      let pick = null; let tries = 0;
      for (const c of all) {
        const dd = Math.hypot(c.x - cx, c.z - cz);
        if (leg === 0 ? dd > 6 : dd < 3.6 || dd > 6.5) continue;
        if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 3.5)) continue;
        if (++tries > 10) break;
        const L = pathLen(cx, cz, c.x, c.z);
        if (L < (leg === 0 ? 7.5 : 8.5)) { pick = c; break; }
      }
      if (!pick) break;
      out.push(pick); cx = pick.x; cz = pick.z;
    }
    return out;
  }
  // where it steps out of the tree line: a woods cell on the edge of the open ground, ~6.5 m from you
  function pickExit() {
    let best = null; let bestScore = Infinity;
    for (let j = 0; j < G.nz; j += 1) for (let i = 0; i < G.nx; i += 1) {
      if (!navOk(i, j)) continue;
      const x = G.x0 + (i + 0.5) * G.s; const z = G.z0 + (j + 0.5) * G.s;
      if (bearOpen(x, z) || x < 5) continue;
      if (!bearOpen(x - 0.6, z) && !bearOpen(x, z + 0.6) && !bearOpen(x, z - 0.6) && !bearOpen(x + 0.6, z)) continue;
      const d = Math.hypot(P.x - x, P.z - z);
      if (d < 4.5 || d > 9.5) continue;
      const score = Math.abs(d - 6.5) + Math.hypot(s.x - x, s.z - z) * 0.35;
      if (score < bestScore) { bestScore = score; best = [x, z]; }
    }
    return best || [s.x, s.z];
  }
  const sample = []; const bonePts = ['Head_', 'Neck_2_', 'Spine_3_', 'Spine_1_', 'Tail_3_', 'Tail_6_', 'UpperLegL_', 'UpperLegR_'];
  function exposure() {   // share of eight body points with a clear line to your eye
    if (!model) return 0;
    root.updateMatrixWorld(true);
    let open = 0; let n = 0;
    viewFromPlayer();
    for (const pre of bonePts) {
      const b = bones[B(pre)]; if (!b) continue;
      b.getWorldPosition(sample[n] ||= new THREE.Vector3());
      if (!blocked(eye.x, eye.y, eye.z, sample[n].x, sample[n].y, sample[n].z)) open += 1;
      n += 1;
    }
    return n ? open / n : 0;
  }
  function startHidden() {
    if (G.navRow < G.nz) navStep(1e9);
    setState('hidden'); s.engaged = 0.001; s.hideT = 0; s.leg = 0; s.legPhase = 'go'; s.calls = []; s.hidden = true;
    s.spots = pickSpots(); s.maxExposure = 0; s.path = null; s.exit = null; s.lingerUntil = null; s.lingerGrowl = false; s.emergeReason = null;
    emit('wake', { position: root.position.clone(), hidden: true });
    emit('hidden', { spots: s.spots.map((o) => [o.x, o.z]) });
  }
  function emergeNow(reason) {
    if (!s.exit || reason !== 'time') s.exit = [s.x, s.z];
    s.emergeReason = reason; s.roarStart = false; s.path = null;
    setState('emerge');
  }
  function etaTo([x, z]) { return (Math.hypot(x - s.x, z - s.z) * 1.35) / 2.6 + 0.6; }
  function rustle(dt, speed, moving) {
    s.rustleT = (s.rustleT ?? 0) - dt;
    if (!moving || s.rustleT > 0) return;
    s.rustleT = 0.55 + Math.random() * 0.45;
    emit('rustle', { position: new THREE.Vector3(s.x, s.y + 0.8, s.z), strength: Math.min(1, speed / 3) });
    shedLeaves(s.x + Math.sin(s.yaw) * 0.6, s.y, s.z + Math.cos(s.yaw) * 0.6, 6);
  }
  // the ~15 s intro: call from three places, moving between them out of sight, linger, then come out
  function hiddenTick(dt, d) {
    s.hideT += dt;
    // walking into the woods or coming close brings it out early (so does shooting into the dark, see hit())
    if (P.inWoods || d < 4.5) { emergeNow(P.inWoods ? 'woods' : 'close'); return; }
    const callTimes = [0.05, 0.33, 0.58].map((f) => f * HIDE);
    const spot = s.spots[s.leg];
    if (!spot || s.legPhase === 'exit') {
      if (!s.exit) { s.exit = pickExit(); s.lingerUntil = HIDE - etaTo(s.exit) - 1.3; }   // the walk-out and the roar's wind-up take ~1.3 s
      if (s.hideT < s.lingerUntil) {   // waits out of sight, growls once
        turnTo(P.x, P.z, 1.5, dt);
        play('Idle_01', 0.3, 0.7);
        if (!s.lingerGrowl && s.lingerUntil - s.hideT < 1.6) { s.lingerGrowl = true; emit('growl', { position: jaw().clone(), hidden: true }); }
        return;
      }
      const r = travel(s.exit[0], s.exit[1], 2.6, dt, { stealth: true, stop: 0.45 });
      moveAnim(r === true, 2.6);
      rustle(dt, 2.6, r === true);
      if (r === 'arrived' || s.hideT > HIDE + 3) emergeNow('time');
      return;
    }
    if (s.legPhase === 'go') {
      const r = travel(spot.x, spot.z, 3.6, dt, { stealth: true, stop: 0.45 });
      moveAnim(r === true, 3.6);
      rustle(dt, 3.6, r === true);
      const late = s.hideT > callTimes[s.leg] + 1.5 && s.calls.every((c) => Math.hypot(c.x - s.x, c.z - s.z) > 3.5);
      if (r === 'arrived' || late || (s.t > 6 && s.unstuck > 2) || s.t > 9) { s.legPhase = 'face'; s.t = 0; s.unstuck = 0; }
      return;
    }
    if (s.legPhase === 'face') {
      const left = turnTo(P.x, P.z, 2.4, dt);
      play(left > 0.3 ? 'Walk' : 'Idle_01', 0.3, 0.6);
      if ((left < 0.3 || s.t > 0.8) && s.hideT >= callTimes[s.leg]) { s.legPhase = 'call'; s.t = 0; play('Call_Alert', 0.25, 1.25, 0); s.called = false; }
      return;
    }
    // 'call'
    turnTo(P.x, P.z, 1.0, dt);
    if (!s.called && norm() > 0.18) {
      s.called = true;
      s.calls.push({ t: +s.hideT.toFixed(2), x: +s.x.toFixed(2), z: +s.z.toFixed(2) });
      emit('call', { position: jaw().clone(), n: s.calls.length });
      s.eyes = 1;
    }
    if (norm() >= 1) {
      s.leg += 1; s.t = 0;
      s.legPhase = s.spots[s.leg] ? 'go' : 'exit';
      play('Idle_01', 0.3);
      if (s.spots[s.leg]) emit('growl', { position: jaw().clone(), hidden: true });
    }
  }

  // --- state machine ----------------------------------------------------------
  function setState(name) { s.state = name; s.t = 0; s.struck = false; s.intent = null; }
  function startAttack(kind) {
    s.attack = kind; setState(kind);
    s.lockX = P.x; s.lockZ = P.z; s.teleDone = false; s.airborne = false; s.charging = false; s.landed = false;
    emit('telegraph', { kind, position: root.position.clone() });
  }
  function endAttack(next = 'stalk') {
    s.lastAttack = s.clock;
    s.cool = (1.1 + Math.random() * 0.7) * (1 - 0.12 * s.rage);
    s.attack = null; s.crouch = 0; s.airborne = false; s.charging = false;
    setState(next);
    if (next === 'stalk') play('Idle_01', 0.3);
  }
  const tmpJ = new THREE.Vector3(); const tmpC = new THREE.Vector3();
  function jaw(out = tmpJ) { const b = bones[B('Jaw_2_end')] || bones[B('Head_')]; return b ? b.getWorldPosition(out) : out.set(s.x, s.y + 1.6, s.z); }
  function chest(out = tmpC) { const b = bones[B('Spine_3_')]; return b ? b.getWorldPosition(out) : out.set(s.x, s.y + 1.1, s.z); }
  // Hit test: your body (a vertical line at your head's x,z from feet + 0.25 to head + 0.35) against the segment from
  // its chest to the jaw tip pushed `ahead` metres on, radius `reach`
  function strike(kind, reach, ahead = 0.1) {
    if (s.struck || !P.onGround) return false;
    root.updateMatrixWorld(true);
    const a = chest(); const b = jaw();
    const fx = Math.sin(s.yaw); const fz = Math.cos(s.yaw);
    const bx = b.x + fx * ahead; const bz = b.z + fz * ahead;
    const ax = bx - a.x; const az = bz - a.z; const len2 = ax * ax + az * az || 1;
    const k = THREE.MathUtils.clamp(((P.x - a.x) * ax + (P.z - a.z) * az) / len2, 0, 1);
    const d = Math.hypot(P.x - (a.x + ax * k), P.z - (a.z + az * k));
    const y = a.y + (b.y - a.y) * k;
    if (d > reach || y < P.feetY + 0.25 || y > P.headY + 0.35) return false;
    s.struck = true;
    const damage = Math.round(HURT[kind] * DMG);
    const body = kind === 'tackle' || kind === 'leap';
    const shove = safeShove(P.x, P.z, body ? fx * 0.7 + (P.x - s.x) * 0.3 : P.x - s.x, body ? fz * 0.7 + (P.z - s.z) * 0.3 : P.z - s.z, SHOVE[kind]);
    emit('strike', { kind, damage, shove, position: b.clone() });
    return true;
  }
  // The player's deck under (x,z) with margin m all round (crag.deckAt: the ground you walk on)
  function onDeck(x, z, m) {
    if (crag.deckAt(x, z) == null) return false;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      if (crag.deckAt(x + Math.cos(a) * m, z + Math.sin(a) * m) == null) return false;
    }
    return true;
  }
  // Shove that can never put you near an edge: the whole path and the end point keep 0.5 m from every edge; otherwise
  // it shrinks (60%, 30%) or is dropped. raptorfight.js eases it in over 0.15 s.
  function safeShove(px, pz, dx, dz, d0) {
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    if (!onDeck(px, pz, 0.15)) return { x: 0, z: 0 };
    for (const k of [1, 0.6, 0.3]) {
      const d = d0 * k;
      let ok = true;
      for (let i = 1; i <= 5 && ok; i += 1) ok = onDeck(px + dx * d * (i / 5), pz + dz * d * (i / 5), 0.5);
      if (ok) return { x: dx * d, z: dz * d };
    }
    return { x: 0, z: 0 };
  }

  function update(dt, p) {
    s.clock += dt;
    const have = readPlayer(p);
    if (s.state === 'gone' || !model) return;
    if (G.navRow < G.nz) navStep(s.state === 'den' ? (P.onGround ? 8 : 2.5) : 1e9);   // in its den it can wait a moment for the grid
    const busy = s.state === 'return' || s.state === 'dead' || s.engaged > 0;
    if (!have || (!P.inZone && !busy)) { if (!P.inZone) s.arrived = false; return; }
    s.t += dt;
    s.flinch = Math.max(0, s.flinch - dt);
    const d = dist();
    if (!['den', 'dead', 'return'].includes(s.state)) {
      s.engaged += dt;
      s.away = P.inZone && P.feetY > deckY - 0.6 ? 0 : s.away + dt;
      if (s.away > 1.5) { emit('leave'); s.attack = null; s.hidden = false; s.crouch = 0; setState('return'); s.engaged = 0; s.arrived = false; s.path = null; }
    }
    const x0 = s.x; const z0 = s.z;
    switch (s.state) {
      case 'den': {
        play('Idle_01', 0.4, 0.6);
        if (P.onGround && (s.arrived || d < 4.5) && G.navRow >= G.nz) startHidden();   // topped out (or walked right up to its den)
        break;
      }
      case 'hidden': hiddenTick(dt, d); break;
      case 'emerge': emergeTick(dt); break;
      case 'stalk': stalkTick(dt, d); break;
      case 'bite': case 'snap': biteTick(dt); break;
      case 'leap': leapTick(dt); break;
      case 'tackle': tackleTick(dt); break;
      case 'hurt': if (norm() >= 0.92 || s.t > 1.2) endAttack(); break;
      case 'knocked': {   // big punish window: falls, struggles, gets up (its root motion checked against trunks/edges)
        rootMotion(0.55);
        if (norm() >= 1) { endAttack(); s.cool = 0.6; }
        break;
      }
      case 'rage': {
        rootMotion(1);
        turnTo(P.x, P.z, 1.2, dt);
        if (!s.roared && norm() > 0.25) { s.roared = true; emit('roar', { position: jaw().clone(), rage: true }); }
        if (norm() >= 1) { s.roared = false; endAttack(); }
        break;
      }
      case 'return': {
        const r = travel(DEN.x, DEN.z, 1.5, dt, { stop: 0.3 });
        moveAnim(r === true, 1.5);
        if (r === 'arrived' || s.t > 40) {
          if (turn(DEN.yaw, 1.6, dt) < 0.1 || s.t > 45) { setState('den'); play('Idle_01', 0.5, 0.6); }
          else play('Walk', 0.3, 0.5);
        }
        break;
      }
      case 'dead': {
        rootMotion(0.9);
        if (!s.rewarded && s.t > 2.2) {
          s.rewarded = true;
          const fx = Math.sin(s.yaw); const fz = Math.cos(s.yaw);
          let cx = s.x + fx * 1.6; let cz = s.z + fz * 1.6;
          if (!onDeck(cx, cz, 0.25)) { cx = s.x + Math.cos(s.yaw) * 0.8; cz = s.z - Math.sin(s.yaw) * 0.8; }
          if (!onDeck(cx, cz, 0.25)) { cx = s.x; cz = s.z; }
          claw = spawnClaw(cx, cz);
          emit('reward', { object: claw });
        }
        break;
      }
      default: break;
    }
    if (s.state !== 'den' && s.state !== 'dead' && s.state !== 'return') checkWeapons();
    // trail + tail
    const last = crumbs[crumbs.length - 1];
    if (!last || Math.hypot(last[0] - s.x, last[1] - s.z) > 0.1) { crumbs.push([s.x, s.z]); if (crumbs.length > 60) crumbs.shift(); }
    s.moved = Math.hypot(s.x - x0, s.z - z0);
    s.bendHold = Math.max(0, (s.bendHold ?? 0) - dt);
    { const want = s.bendHold > 0 ? s.bendWant : tailBendFor(s.x, s.z, s.yaw);
      const nb = THREE.MathUtils.damp(s.bend, want, 6, dt);
      if (fits(s.x, s.z, s.yaw, nb)) s.bend = nb; else if (fits(s.x, s.z, s.yaw, want)) s.bend = want; }
    // ground + slope
    const gy = gY(s.x, s.z) ?? s.y;
    s.y = THREE.MathUtils.damp(s.y, gy, 10, dt);
    const fx = Math.sin(s.yaw); const fz = Math.cos(s.yaw);
    const ya = gY(s.x + fx * 0.9, s.z + fz * 0.9) ?? gy; const yb = gY(s.x - fx * 0.6, s.z - fz * 0.6) ?? gy;
    s.pitch = THREE.MathUtils.damp(s.pitch, THREE.MathUtils.clamp(-Math.atan2(ya - yb, 1.5), -0.3, 0.3), 6, dt);
    root.position.set(s.x, s.y, s.z);
    root.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    mixer.update(dt);
    procedural(dt);
    visibility(dt);
    tickLeaves(dt);
  }

  function emergeTick(dt) {   // steps out of the trees toward you (fading in out of the dark), then roars
    if (!s.roarStart) {
      const tx = s.exit[0] + (P.x - s.exit[0]) * 0.25; const tz = s.exit[1] + (P.z - s.exit[1]) * 0.25;
      const r = s.t < 1.4 && dist() > 3.2 ? travel(tx, tz, 1.4, dt, { stop: 0.5 }) : false;
      if (r !== true) turnTo(P.x, P.z, 2.2, dt);
      moveAnim(r === true, 1.4);
      if ((s.t > 1.2 && Math.abs(angleTo(P.x, P.z)) < 0.35) || s.t > 3.5) { s.roarStart = true; play('Roar_01', 0.3, 1, 0); s.roared = false; }
      return;
    }
    turnTo(P.x, P.z, 0.8, dt);
    if (!s.roared && norm() > 0.28) {
      s.roared = true; s.hidden = false;
      emit('roar', { position: jaw().clone(), intro: true });
      emit('emerge', { position: root.position.clone(), reason: s.emergeReason || 'time', at: +s.hideT.toFixed(2) });
    }
    if (norm() >= 1) { s.roarStart = false; s.hidden = false; setState('stalk'); s.lastAttack = s.clock; s.cool = 0.8; s.fightT = 0; play('Idle_01', 0.3); }
  }
  function stalkTick(dt, d) {
    s.fightT = (s.fightT ?? 0) + dt;
    if (s.rageQueued && s.clock - s.lastAttack > 0.6) { s.rageQueued = false; s.rage += 1; setState('rage'); s.attack = 'rage'; s.roared = false; play('Roar_02', 0.25, 1, 0); return; }
    const face = Math.abs(angleTo(P.x, P.z));
    const ready = s.clock - s.lastAttack > s.cool && P.onGround;
    const early = s.fightT < 4;
    const quick = 1 + 0.12 * s.rage;
    if (ready && face < 0.45 && d < 2.15) { startAttack('bite'); play('Bite_01', 0.2, 1.15 * quick, 0); return; }
    if (ready && face < 0.35 && d >= 2.15 && d < 2.6) { startAttack('snap'); play('Bite_02', 0.2, quick, 0); return; }
    // leap / tackle: pick one by range, square up to you (up to 1.2 s), then go if the lane is clear
    if (!s.intent && ready && !early && P.onGround) {
      if (d > 3.2 && d < 7 && s.clock - s.lastLeap > 5 && Math.random() < dt * 1.0) { s.intent = 'leap'; s.intentT = 0; }
      else if (d > 2.6 && d < 5 && s.clock - s.lastTackle > 4 && Math.random() < dt * 0.8) { s.intent = 'tackle'; s.intentT = 0; }
      else if (Math.random() < dt * 0.45) { s.intent = 'close'; s.intentT = 0; }   // come in for a bite
    }
    if (s.intent === 'leap' || s.intent === 'tackle') {
      s.intentT += dt;
      const left = turnTo(P.x, P.z, 3.2, dt);
      play('Idle_01', 0.25, 1.3);
      const inRange = s.intent === 'leap' ? d > 3.0 && d < 7.2 : d > 2.4 && d < 5.2;
      if (left < 0.3 && inRange && P.onGround) {
        const kind = s.intent; s.intent = null;
        if (kind === 'leap' && laneFits(P.x, P.z, 1.2) >= Math.min(d - 0.3, 6.2)) { startAttack('leap'); s.lastLeap = s.clock; play('Leap_01', 0.25, 0.18, 0); return; }
        if (kind === 'tackle' && laneFits(P.x, P.z, 0.6) >= d - 0.2) { startAttack('tackle'); s.lastTackle = s.clock; play('Tackle', 0.25, 0.1, 0); return; }
        if (kind === 'leap') s.lastLeap = s.clock - 3; else s.lastTackle = s.clock - 2;   // lane blocked: try again soon
      }
      if (s.intentT > 1.2 || !inRange) s.intent = null;
      return;
    }
    if (s.intent === 'close') { s.intentT += dt; if (s.intentT > 3 || d < 2.2) s.intent = null; }
    // movement: back off if you're inside its chest, square up in bite range, circle at mid range, close in from far
    if (d < 1.5) {
      turnTo(P.x, P.z, 2.5, dt);
      const bx = s.x - Math.sin(s.yaw) * 0.9 * dt; const bz = s.z - Math.cos(s.yaw) * 0.9 * dt;
      if (fits(bx, bz, s.yaw)) { s.x = bx; s.z = bz; play('Walk', 0.3, -0.7); } else play('Idle_01', 0.3);
      return;
    }
    if (d < 2.6) { turnTo(P.x, P.z, 3, dt); play('Idle_01', 0.3, 1.2); growl(dt); return; }
    let tx = P.x; let tz = P.z; let speed = 3.2 * quick;
    if (d < 6.5 && !P.inWoods && s.intent !== 'close') {
      s.circleT -= dt;
      if (s.circleT <= 0) { s.circleT = 2.5 + Math.random() * 2.5; if (Math.random() < 0.4) s.circle *= -1; }
      const a = Math.atan2(s.x - P.x, s.z - P.z) + s.circle * 0.55;
      const r = THREE.MathUtils.clamp(d - 0.4, 3.4, 4.6);
      tx = P.x + Math.sin(a) * r; tz = P.z + Math.cos(a) * r;
      if (!navAt(tx, tz)) { s.circle *= -1; tx = P.x; tz = P.z; }
      speed = 1.7 * quick;
    } else if (d > 9) speed = 5.0 * quick;
    const moved = travel(tx, tz, speed, dt, { stop: 0.3, rate: 3.2 });
    moveAnim(moved === true, speed);
    growl(dt);
  }
  function growl(dt) {
    s.growlT = (s.growlT ?? 3) - dt;
    if (s.growlT <= 0) { s.growlT = 3.5 + Math.random() * 3.5; emit('growl', { position: jaw().clone() }); }
  }
  function biteTick(dt) {   // bite: head back ~0.65 s then a snap; snap: a lunging bite that reaches ~2.2 m
    const n = norm();
    const snap = s.state === 'snap';
    const tele = snap ? 0.25 : 0.33;
    const win = snap ? [0.27, 0.56] : [0.34, 0.54];
    if (n < tele) turnTo(P.x, P.z, 2.0, dt);
    else if (!s.teleDone) { s.teleDone = true; current.setEffectiveTimeScale((snap ? 1.25 : 1.35) * (1 + 0.12 * s.rage)); emit('snap', { position: jaw().clone() }); }
    if (n > win[0] && n < win[1]) strike(snap ? 'snap' : 'bite', 0.42, 0.08);
    if (n >= 0.82) { if (!s.struck) emit('miss', { kind: s.state }); endAttack(); }
  }
  function leapTick(dt) {   // crouch + hiss ~0.8 s (aiming), then a pounce at where you stood when it left the ground
    const n = norm();
    if (!s.airborne && s.t < 0.8) {   // aims for the first 0.55 s, then it's committed: step aside now
      if (s.t < 0.55) { turnTo(P.x, P.z, 1.6, dt); s.lockX = P.x; s.lockZ = P.z; }
      s.crouch = Math.min(1, s.t / 0.35);
      return;
    }
    if (!s.airborne) {
      s.airborne = true; s.crouch = 0;
      const dd = Math.hypot(s.lockX - s.x, s.lockZ - s.z);
      const want = THREE.MathUtils.clamp(dd - 1.2 + 0.9, 2.2, 6.3);   // its jaws land ~0.9 m past where you stood
      const room = Math.max(0, laneFits(s.lockX, s.lockZ, 1.5) - 0.2);
      const go = Math.min(want, room);
      const total = (rm.Leap_01?.total ?? 6.3) - rmAt('Leap_01', current.time);
      s.rmScale = go > 0.5 ? go / Math.max(0.5, total) : 0;
      s.rmPrev = rmAt('Leap_01', current.time);
      current.setEffectiveTimeScale(1.05);
      emit('leap', { position: root.position.clone(), distance: +go.toFixed(2) });
    }
    rootMotion(s.rmScale);
    if (n > 0.5 && n < 0.97) strike('leap', 0.55, 0.15);
    if (n > 0.86 && !s.landed) { s.landed = true; emit('land', { position: root.position.clone() }); }
    if (n >= 1) {
      s.airborne = false;
      if (!s.struck) { emit('miss', { kind: 'leap' }); knockDown('miss'); } else endAttack();
    }
  }
  function tackleTick(dt) {   // head down + two scrapes 0.55 s, then a short charge that runs through where you were
    const n = norm();
    if (!s.charging && s.t < 0.55) {
      turnTo(P.x, P.z, 1.8, dt);
      if (s.t > 0.15 && !s.scr1) { s.scr1 = true; emit('scrape', { position: root.position.clone() }); }
      if (s.t > 0.4 && !s.scr2) { s.scr2 = true; emit('scrape', { position: root.position.clone() }); }
      return;
    }
    if (!s.charging) {
      s.charging = true; s.scr1 = s.scr2 = false;
      const dd = Math.hypot(P.x - s.x, P.z - s.z);
      const want = THREE.MathUtils.clamp(dd + 0.6, 2, 4.4);
      const room = laneFits(P.x, P.z, 0.8);
      const total = (rm.Tackle?.total ?? 3.5) - rmAt('Tackle', current.time);
      s.rmScale = Math.min(want, room) / Math.max(0.5, total);
      s.rmPrev = rmAt('Tackle', current.time);
      current.setEffectiveTimeScale(1.25);
      emit('charge', { position: root.position.clone() });
      s.stepT = 0;
    }
    if (n < 0.35 && !s.struck) turnTo(P.x, P.z, 0.9, dt);   // a little homing early on: sidestep late and it can't follow
    const ok = rootMotion(s.struck ? 0.15 : s.rmScale);
    s.stepT -= dt;
    if (s.stepT <= 0 && n < 0.8) { s.stepT = 0.2; emit('step', { position: root.position.clone() }); }
    if (n > 0.1 && n < 0.78) strike('tackle', 0.62, 0.1);
    if (n >= 0.9 || (!ok && n > 0.3)) {
      if (!s.struck) emit('miss', { kind: 'tackle' });
      endAttack(); s.cool = 0.9;
    }
  }
  function knockDown(why) {
    s.attack = null; s.airborne = false; s.charging = false; s.crouch = 0;
    setState('knocked'); s.lastKnock = s.clock;
    play('Knocked Down', 0.15, 0.85, 0);
    emit('knocked', { position: root.position.clone(), why });
  }

  // --- procedural layer: tail follows the trail, head aims at you, crouch, breathing, flinch ---------------
  const mq = new THREE.Quaternion();
  const touched = new Set();
  function addRot(prefix, axis, angle) {
    const name = B(prefix); const b = bones[name];
    if (!b || Math.abs(angle) < 1e-5) return;
    if (!animated.has(name) && !touched.has(b)) b.quaternion.copy(rest.get(b));
    touched.add(b);
    b.quaternion.multiply(mq.setFromAxisAngle(axis[name], angle));
  }
  const pm = { aim: 0, breath: 0 };
  const TAILW = [['Tail_1_', 0.22], ['Tail_2_', 0.22], ['Tail_3_', 0.2], ['Tail_4_', 0.16], ['Tail_5_', 0.12], ['Tail_6_', 0.08]];
  function procedural(dt) {
    touched.clear();
    pm.breath += dt * 2.4;
    addRot('Spine_2_', axisSide, Math.sin(pm.breath) * 0.012);
    for (const [pre, w] of TAILW) addRot(pre, axisUp, s.bend * w);
    let aim = 0;
    if (['stalk', 'hidden', 'emerge', 'hurt'].includes(s.state) || (s.state === 'leap' && !s.airborne) || (s.state === 'tackle' && !s.charging) || ((s.state === 'bite' || s.state === 'snap') && norm() < 0.3)) {
      aim = THREE.MathUtils.clamp(angleTo(P.x, P.z), -0.9, 0.9);
    }
    pm.aim = THREE.MathUtils.damp(pm.aim, aim, 5, dt);
    addRot('Neck_1_', axisUp, pm.aim * 0.3);
    addRot('Neck_2_', axisUp, pm.aim * 0.25);
    addRot('Neck_3_', axisUp, pm.aim * 0.2);
    addRot('Head_', axisUp, pm.aim * 0.2);
    if (s.flinch > 0) addRot('Neck_2_', axisSide, Math.sin(s.flinch * 40) * 0.1 * s.flinch / 0.3);
    s.crouchV = THREE.MathUtils.damp(s.crouchV ?? 0, s.crouch, 8, dt);
    model.position.y = -0.16 * s.crouchV;
  }

  // --- what you can see of it -----------------------------------------------------
  // While it hides: if more than half of it is in clear view from your eye it isn't drawn at all; otherwise it is a
  // dark shape (22% albedo) at most, plus eyeshine when it looks your way. It fades in out of the dark as it steps out.
  function visibility(dt) {
    const hiding = s.state === 'hidden' || s.state === 'den';
    s.exposure = hiding ? exposure() : 0;
    let target = 1; let veil = 0;
    if (hiding) { target = s.exposure > 0.5 ? 0 : 1; veil = 0.78; }
    else if (s.state === 'emerge' && !s.roarStart) veil = Math.max(0, 0.78 * (1 - s.t / 1.3));
    // fades in slowly where it's mostly behind trunks; gone at once the moment more than half of it is in the open
    s.opacity = target === 0 && hiding ? 0 : THREE.MathUtils.damp(s.opacity, target, target < s.opacity ? 14 : 5, dt);
    if (target === 0 && s.opacity < 0.03) s.opacity = 0;
    if (target === 1 && s.opacity > 0.995) s.opacity = 1;
    s.veil = THREE.MathUtils.damp(s.veil, veil, 4, dt);
    s.drawn = s.opacity > 0.02;
    if (s.state === 'hidden' && s.drawn) s.maxExposure = Math.max(s.maxExposure, s.exposure);
    for (const m of mats) {
      const fade = s.opacity < 1;
      if (m.transparent !== fade) { m.transparent = fade; m.needsUpdate = true; }
      m.opacity = s.opacity;
      m.color.copy(m.userData.base).multiplyScalar(1 - s.veil);
    }
    model.visible = s.drawn;
    // eyeshine: head turned your way, more than 5 m off, eyes not behind a trunk
    s.eyes = Math.max(0, s.eyes - dt * 0.35);
    let glint = 0;
    if ((s.state === 'hidden' || (s.state === 'emerge' && !s.roarStart)) && dist() > 5) {
      const el = bones[B('EyeL_')]; const er = bones[B('EyeR_')];
      if (el && er) {
        el.getWorldPosition(eyes.l.position); er.getWorldPosition(eyes.r.position);
        const look = Math.cos(angleTo(P.x, P.z) - pm.aim * 0.95);
        viewFromPlayer();
        const clear = !blocked(eye.x, eye.y, eye.z, eyes.l.position.x, eyes.l.position.y, eyes.l.position.z);
        glint = clear && look > 0.55 ? ((0.35 + 0.65 * s.eyes) * (look - 0.55)) / 0.45 : 0;
        root.updateMatrixWorld(true);
        root.worldToLocal(eyes.l.position); root.worldToLocal(eyes.r.position);
      }
    }
    eyes.mat.opacity = THREE.MathUtils.damp(eyes.mat.opacity, glint, 6, dt);
    eyes.group.visible = eyes.mat.opacity > 0.02;
  }

  // --- damage in --------------------------------------------------------------
  function hit(zone, point, source = 'arrow', o = {}) {
    if (!model || s.state === 'off' || s.state === 'gone') return null;
    if (s.state === 'dead') return source === 'arrow' ? { damage: 0, killed: false } : null;   // arrows stick in the carcass
    let dmg;
    if (source === 'arrow') dmg = ARROW[zone] ?? 10;
    else if (source === 'hatchet') dmg = THREE.MathUtils.clamp(10 + ((o.speed ?? 3) - 3) * 2.4, 10, 22) * (ZONE_MULT[zone] ?? 1);
    else if (source === 'club' || source === 'stick') dmg = Math.min(26, (8 + 0.6 * (o.speed ?? 0)) * (zone === 'head' ? 1.2 : ZONE_MULT[zone] ?? 1));
    else if (source === 'ball') dmg = 6;
    else dmg = 5;
    if (s.state === 'knocked') dmg *= 1.75;
    else if (s.state === 'leap' && !s.airborne) dmg *= 1.25;   // caught in the crouch
    if (s.state === 'hidden' || s.state === 'den') dmg *= 0.6;
    dmg = Math.max(1, Math.round(dmg));
    const crit = zone === 'head' || s.state === 'knocked';
    const before = s.hp;
    s.hp = Math.max(0, s.hp - dmg);
    s.flinch = 0.3;
    if (s.hp > 0 && (s.state === 'den' || s.state === 'return')) { s.arrived = true; startHidden(); emergeNow('shot'); }
    else if (s.hp > 0 && s.state === 'hidden') emergeNow('shot');
    if (s.hp <= 0) {
      s.attack = null; s.airborne = false; s.charging = false; s.crouch = 0; s.hidden = false;
      // falls back (Death_01) or forward (Death_02), whichever has room (its root motion is still collision-checked)
      const fx = Math.sin(s.yaw); const fz = Math.cos(s.yaw);
      const back = fits(s.x - fx * 1.6, s.z - fz * 1.6, s.yaw); const fwd = fits(s.x + fx * 1.7, s.z + fz * 1.7, s.yaw);
      const clip = fwd && (!back || Math.random() < 0.5) ? 'Death_02' : 'Death_01';
      setState('dead'); s.engaged = 0;
      play(clip, 0.15, 0.9, 0);
      s.opacity = 1; s.veil = 0;
      emit('hurt', { zone, damage: dmg, crit, source, hp: 0, killed: true, point: (point || root.position).clone() });
      emit('death', { position: root.position.clone(), clip });
      s.kills += 1;
      save({ killedAt: Date.now(), kills: s.kills });
      return { damage: dmg, crit, killed: true };
    }
    emit('hurt', { zone, damage: dmg, crit, source, hp: s.hp, killed: false, point: (point || root.position).clone() });
    for (const f of [2 / 3, 1 / 3]) if (before > MAX_HP * f && s.hp <= MAX_HP * f) s.rageQueued = true;
    const melee = source === 'club' || source === 'stick' || source === 'hatchet';
    const committed = (s.state === 'leap' && s.airborne) || (s.state === 'tackle' && s.charging) || ['knocked', 'rage', 'emerge', 'hidden', 'dead'].includes(s.state);
    // a solid swing (club/stick >= 16 m/s to the head or neck, or any melee hit of 18+) knocks it down
    if (melee && !['knocked', 'emerge', 'hidden'].includes(s.state) && s.clock - s.lastKnock > 6
      && (((o.speed ?? 0) >= 16 && (zone === 'head' || zone === 'neck')) || dmg >= 18)) {
      knockDown('club');
      return { damage: dmg, crit, killed: false, knocked: true };
    }
    if (!committed && dmg >= 10 && s.clock - s.lastHurt > 1.6) {
      s.lastHurt = s.clock; s.attack = null; s.crouch = 0; s.charging = false;
      setState('hurt'); play('Hurt_01', 0.12, 1.3, 0); emit('stagger', { position: root.position.clone() });
    }
    return { damage: dmg, crit, killed: false };
  }
  const seg = new THREE.Line3(); const near = new THREE.Vector3(); const zp = new THREE.Vector3();
  function sweep(a, b, pad) {
    seg.set(a, b);
    let best = null; let bestD = Infinity;
    for (const z of zones) {
      z.getWorldPosition(zp);
      seg.closestPointToPoint(zp, true, near);
      const dd = near.distanceTo(zp) - z.userData.r - pad;
      if (dd < 0 && dd < bestD) { bestD = dd; best = { zone: z.userData.foeZone, point: near.clone() }; }
    }
    return best;
  }
  function chop(a, b, speed = 3) {   // hatchet blade segment (gear.js), one hit per swing
    if (!model || !model.visible || s.state === 'dead' || s.state === 'gone' || speed < 2.5 || s.clock - s.chopAt < 0.4) return null;
    root.updateMatrixWorld(true);
    const best = sweep(a, b, 0.05);
    if (!best) return null;
    s.chopAt = s.clock;
    return hit(best.zone, best.point, 'hatchet', { speed });
  }
  // golf club / hockey stick faces and driven balls (golf.js / hockey.js face + ball state)
  const sticks = [
    { kit: () => golf, tool: () => golf?.club, src: 'club', prev: new THREE.Vector3(), now: new THREE.Vector3(), seen: false, at: -99 },
    { kit: () => hockey, tool: () => hockey?.stick, src: 'stick', prev: new THREE.Vector3(), now: new THREE.Vector3(), seen: false, at: -99 },
  ];
  const balls = [
    { get: () => golf?.ballState, prev: new THREE.Vector3(), now: new THREE.Vector3(), seen: false },
    { get: () => hockey?.ballState, prev: new THREE.Vector3(), now: new THREE.Vector3(), seen: false },
  ];
  function checkWeapons() {
    if (!zones.length || !model.visible) return;
    root.updateMatrixWorld(true);
    for (const w of sticks) {
      const f = w.kit()?.face; const tool = w.tool();
      if (!f || !tool?.userData.carried) { w.seen = false; continue; }
      w.now.set(f.c.x, f.c.y, f.c.z);
      const speed = Math.hypot(f.v.x, f.v.y, f.v.z);
      if (w.seen && speed > 4 && s.clock - w.at > 0.35) {
        const best = sweep(w.prev, w.now, 0.06);
        if (best) { w.at = s.clock; hit(best.zone, best.point, w.src, { speed }); }
      }
      w.prev.copy(w.now); w.seen = true;
    }
    for (const b of balls) {
      const ball = b.get();
      if (!ball) continue;
      b.now.set(ball.p.x, ball.p.y, ball.p.z);
      const v = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
      if (b.seen && v > 6 && s.clock - s.ballAt > 0.4) {
        const best = sweep(b.prev, b.now, 0.025);
        if (best) {
          s.ballAt = s.clock;
          hit(best.zone, best.point, 'ball', { speed: v });
          ball.v.x *= -0.25; ball.v.z *= -0.25; ball.v.y = Math.abs(ball.v.y) * 0.3;   // thuds off the hide
        }
      }
      b.prev.copy(b.now); b.seen = true;
    }
  }

  // --- reward + save ----------------------------------------------------------
  // trophy: the big sickle claw off its second toe (built in code, CC0): a curved, tapered horn blade on a toe stub
  function spawnClaw(x, z) {
    const g = new THREE.Group();
    const horn = new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 0.38, metalness: 0.05 });
    const hide = new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: 0.85 });
    const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.07, 4, 10), hide);
    toe.rotation.z = Math.PI / 2; toe.position.set(-0.05, 0.03, 0);
    g.add(toe);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0.1, 0.05, 0), new THREE.Vector3(0.11, 0.15, 0));
    const geo = new THREE.TubeGeometry(curve, 16, 0.022, 8, false);
    const pos = geo.attributes.position; const v = new THREE.Vector3(); const c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {   // taper to a point and flatten into a blade
      const t = Math.floor(i / 9) / 16;
      curve.getPoint(Math.min(1, t), c);
      v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(1 - 0.92 * t);
      v.z *= 0.55;
      pos.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
    }
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, horn));
    const holder = new THREE.Group();   // lies on its side
    holder.add(g); g.rotation.x = Math.PI / 2; g.position.y = 0.02;
    holder.rotation.y = (x * 7.1 + z * 3.3) % 6.28;
    holder.position.set(x, (crag.deckAt(x, z) ?? deckY) + 0.02, z);
    holder.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    holder.userData = { type: 'prop', label: 'raptor claw', role: 'loose', floorY: 0.02 };
    scene.add(holder);
    targets?.push(holder);
    return holder;
  }
  function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; } }
  function save(v) { try { if (v) localStorage.setItem(SAVE_KEY, JSON.stringify(v)); else localStorage.removeItem(SAVE_KEY); } catch { /* private mode */ } }

  const api = {
    kind: 'raptor',
    root, zones, update, hit, chop, safeShove, onDeck, prefetch,
    on(type, fn) { (listeners[type] ||= []).push(fn); return api; },
    state: () => s.state,
    den: () => DEN,
    hp: () => s.hp,
    maxHp: MAX_HP,
    hideSeconds: HIDE,
    alive: () => s.state !== 'dead' && s.state !== 'gone',
    engaged: () => s.engaged > 0 && !['den', 'dead', 'gone', 'return'].includes(s.state),
    hiding: () => s.state === 'hidden' || (s.state === 'emerge' && s.hidden),
    ready: () => !!model,
    claw: () => claw,
    mouth: () => jaw(new THREE.Vector3()),
    clip: () => (current ? `${current.getClip().name}@${norm().toFixed(2)}` : null),
    // test hooks (headless harness / ?raptordebug=1)
    debugPlace(x, z, yaw, state = 'stalk') {
      s.x = x; s.z = z; s.yaw = yaw; s.y = gY(x, z) ?? deckY; crumbs.length = 0; s.bend = 0; s.path = null; s.hidden = false; s.crouch = 0;
      setState(state); if (state !== 'den') s.engaged = Math.max(s.engaged, 0.001); s.fightT = 10;
      root.position.set(x, s.y, z); root.rotation.set(0, yaw, 0, 'YXZ');
    },
    debugAttack(kind) {   // start one attack now (harness): 'bite' | 'snap' | 'leap' | 'tackle'
      const clip = { bite: 'Bite_01', snap: 'Bite_02', leap: 'Leap_01', tackle: 'Tackle' }[kind];
      startAttack(kind); s.lastAttack = s.clock; if (kind === 'leap') s.lastLeap = s.clock; if (kind === 'tackle') s.lastTackle = s.clock;
      play(clip, 0.2, kind === 'leap' ? 0.18 : kind === 'tackle' ? 0.1 : kind === 'bite' ? 1.15 : 1, 0);
    },
    debugPose(name, n) { mixer.stopAllAction(); current = null; play(name, 0, 1, n); mixer.update(0); procedural(0); },
    debugBuild: build,
    debug: () => ({
      state: s.state, x: +s.x.toFixed(3), z: +s.z.toFixed(3), y: +s.y.toFixed(3), yaw: +s.yaw.toFixed(3), hp: s.hp, clip: api.clip(),
      exposure: +s.exposure.toFixed(2), opacity: +s.opacity.toFixed(2), drawn: !!s.drawn, veil: +s.veil.toFixed(2), eyes: +(eyes?.mat.opacity ?? 0).toFixed(2),
      bend: +s.bend.toFixed(2), hideT: +s.hideT.toFixed(2), calls: s.calls, spots: s.spots.map((o) => [+o.x.toFixed(2), +o.z.toFixed(2), o.sector]),
      maxExposure: +s.maxExposure.toFixed(2), navMs: s.navMs, gridMs: s.gridMs, navDone: G.navRow >= G.nz, airborne: !!s.airborne, legPhase: s.legPhase, emergeReason: s.emergeReason ?? null,
    }),
    clearance() {   // body/tail clearance right now: min distance to a trunk, and whether feet/chest/hips are on ground
      const fx = Math.sin(s.yaw); const fz = Math.cos(s.yaw); let trunk = 99; let ground = true;
      for (const [ahead, , edge] of BODY) {
        const px = s.x + fx * ahead; const pz = s.z + fz * ahead;
        trunk = Math.min(trunk, trunkClear(px, pz) - (ahead === 0 ? 0.35 : ahead > 1 ? 0.12 : 0.3));
        if (edge >= 0 && !standOk(px, pz, ahead === 0 ? 0.45 : 0.2)) ground = false;
      }
      const t = tailPoints(s.x, s.z, s.yaw, s.bend);
      return { trunk: +trunk.toFixed(3), tail: +Math.min(trunkClear(t[0], t[1]), trunkClear(t[2], t[3])).toFixed(3), ground };
    },
    _fits: (x, z, yaw, b = 0) => fits(x, z, yaw, b),
    _trunks: trunks,
    _why(x, z, yaw) {   // which part of fits() fails at (x, z, yaw)
      const fx = Math.sin(yaw); const fz = Math.cos(yaw); const out = [];
      for (const [ahead, clr, edge] of BODY) {
        const px = x + fx * ahead; const pz = z + fz * ahead;
        out.push({ ahead, cell: cellOk(...cellOf(px, pz)), clr: +trunkClear(px, pz).toFixed(2), need: clr, stand: edge >= 0 ? standOk(px, pz, ahead === 0 ? BODY[0][2] : edge) : null, y: gY(px, pz) });
      }
      const t = tailPoints(x, z, yaw, s.bend);
      out.push({ tail: [+trunkClear(t[0], t[1]).toFixed(2), +trunkClear(t[2], t[3]).toFixed(2)], bend: s.bend });
      return out;
    },
    _plan: (ax, az, bx, bz) => plan(ax, az, bx, bz),
    _grid: G,
    _navAt: navAt,
    _s: s,
  };
  return api;
}
