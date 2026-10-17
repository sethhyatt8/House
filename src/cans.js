// Can pyramid (cans pass). Rigid-body cylinders with a small sequential-impulse solver, replacing the capsule
// stand-in of 1d63970 (?cans=old keeps that file, src/cans_old.js, verbatim).
//
// Each can is a real cylinder (radius R, height CAN_H): rim/edge contact points against the floor, walls, posts and
// other cans, plus an axis-axis test for crossed cans, so a can stands flat on its base, wobbles on its rim, rolls on
// its side and stacks cap-on-cap. Mass is a real can's (15 g empty aluminium shell, 350 g full), restitution 0.3,
// Coulomb friction, rolling resistance and spin damping on the floor. The stack sleeps until something hits it;
// sleeping cans are static to awake ones until a contact is hard enough to wake them, and a can that wakes wakes the
// cans resting on it, so a hard hit cascades down the pyramid. Fixed 120 Hz substeps (max 3 per frame).
//
// Flags: ?cans=old (original), ?canmass=empty|full|<kg> (default empty 0.015), ?canlayers=<n> (default 6 = 56 cans;
// 12 = the original 364), ?canrest=<e> (0.3), ?canfric=<mu> (0.45).
import * as THREE from 'three';
import { createCans as createCansOld } from './cans_old.js';

export const CAN_H = 6 * 0.0254; // 0.1524 m
export const CAN_D = 2.6 * 0.0254;
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const CANS_OLD = params.get('cans') === 'old';
const massFlag = params.get('canmass');
export const CAN_MASS = massFlag === 'full' ? 0.35 : massFlag && Number(massFlag) > 0 ? Number(massFlag) : 0.015;
const FULL = CAN_MASS > 0.1;
export const CAN_LAYERS = Math.max(1, Math.min(14, Math.round(Number(params.get('canlayers') ?? 6)) || 6));
const E_REST = Number(params.get('canrest') ?? 0.3);
const MU = Number(params.get('canfric') ?? 0.45);
const MU_CAN = MU * 0.7; // aluminium on aluminium is slicker than can on floor

const R = CAN_D * 0.5;
const HH = CAN_H * 0.5;
const GRAV = 9.81;
const STEP = 1 / 120;
const MAX_SUB = 3;
const ITER = 8;
const BUDGET = Number(params.get('canbudget') ?? 3); // ms of physics per frame before substeps are dropped
const SLOP = 0.0008;
const MARGIN = 0.002; // speculative contact distance
const MAXC = 6000;
const RING = 6;
const ROLL_DAMP = 0.55; // 1/s on angular velocity across the floor normal while touching it (rolling resistance)
const SPIN_DAMP = 3.2; // 1/s on spin about the floor normal (a can spinning on its base stops quickly)
const SLEEP_V = 0.035;
const SLEEP_W = 0.7;
const SLEEP_T = 0.45;
const WAKE_V = 0.12; // approach speed (m/s) at which an awake can wakes a sleeping one it touches
const RINGC = Array.from({ length: RING }, (_, k) => Math.cos((k / RING) * Math.PI * 2));
const RINGS = Array.from({ length: RING }, (_, k) => Math.sin((k / RING) * Math.PI * 2));

function buildSpots(room, layers) {
  const rowStep = CAN_D * Math.sqrt(3) / 2;
  const triIndex = (edge, row, col) => row * edge - (row * (row - 1)) / 2 + col;
  const bottom = [];
  for (let row = 0; row < layers; row += 1) for (let col = 0; col < layers - row; col += 1) bottom.push({ x: (col + row * 0.5) * CAN_D, z: row * rowStep });
  const levels = [bottom];
  for (let level = 1; level < layers; level += 1) {
    const below = levels[level - 1];
    const edge = layers - level + 1;
    const above = [];
    for (let row = 0; row < edge - 1; row += 1) {
      for (let col = 0; col < edge - 1 - row; col += 1) {
        const a = below[triIndex(edge, row, col)]; const b = below[triIndex(edge, row, col + 1)]; const c = below[triIndex(edge, row + 1, col)];
        above.push({ x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3 });
      }
    }
    levels.push(above);
  }
  let sx = 0; let sz = 0;
  for (const p of bottom) { sx += p.x; sz += p.z; }
  sx /= bottom.length; sz /= bottom.length;
  // same spot as 1d63970: in front of the vestibule door, a step back from the near wall
  const ox = room.x0 + 0.6;
  const oz = (room.z0 + room.z1) / 2 + 0.12;
  const spots = [];
  for (let level = 0; level < levels.length; level += 1) {
    const y = room.y + CAN_H * (level + 0.5) + 0.0004 * level; // a hair of air so no cap starts interpenetrated
    for (const p of levels[level]) spots.push({ x: ox + (p.x - sx), y, z: oz + (p.z - sz), level });
  }
  return spots;
}

// ---------- visuals: lathed metal ends with bevelled chime + neck, printed wall, six label designs ----------
const LABELS = [
  { bg: '#b4232a', band: '#f4f1ea', text: 'COLA', ink: '#ffffff' },
  { bg: '#1d4f9c', band: '#c9d6e8', text: 'FIZZ', ink: '#ffe14d' },
  { bg: '#2f8a3a', band: '#e8f2d0', text: 'LIME', ink: '#ffffff' },
  { bg: '#f2c230', band: '#1b1b1b', text: 'ZEST', ink: '#1b1b1b' },
  { bg: '#1a1a1e', band: '#d33', text: 'VOLT', ink: '#7cf0ff' },
  { bg: '#d9dde2', band: '#6a2c8c', text: 'TIN', ink: '#6a2c8c' },
];

function labelTexture(L, k) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = L.bg; g.fillRect(0, 0, 256, 128);
  g.fillStyle = L.band;
  if (k % 2) { g.fillRect(0, 86, 256, 12); g.fillRect(0, 102, 256, 4); } else { g.beginPath(); g.moveTo(0, 96); for (let x = 0; x <= 256; x += 8) g.lineTo(x, 92 + Math.sin(x / 40.7) * 10); g.lineTo(256, 128); g.lineTo(0, 128); g.fill(); }
  g.fillStyle = L.ink; g.font = 'bold 46px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(L.text, 64, 52); g.fillText(L.text, 192, 52);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 6, 256, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildGeos() {
  // profile (radius, y) from the bottom centre up: domed base, rounded chime, wall, tapered neck, rolled lip, lid.
  const r = R; const h = HH;
  const lower = [
    [0, -h + 0.010], [r * 0.55, -h + 0.006], [r * 0.80, -h + 0.0005], [r * 0.86, -h], [r * 0.93, -h + 0.0012],
    [r * 0.985, -h + 0.006], [r, -h + 0.012],
  ];
  const upper = [
    [r, h - 0.016], [r * 0.975, h - 0.011], [r * 0.90, h - 0.005], [r * 0.875, h - 0.0018], [r * 0.885, h], [r * 0.86, h + 0.0006],
    [r * 0.82, h - 0.0015], [r * 0.80, h - 0.003], [0, h - 0.003],
  ];
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(x, 1e-4), y)), 20);
  const ends = [lathe(lower), lathe(upper)];
  const tab = new THREE.BoxGeometry(r * 0.5, 0.0015, r * 0.26);
  tab.translate(r * 0.2, h - 0.0018, 0);
  const wall = new THREE.CylinderGeometry(r, r, CAN_H - 0.028, 20, 1, true);
  wall.translate(0, (-h + 0.012 + h - 0.016) / 2, 0);
  const metal = mergeSimple([...ends, tab]);
  return { metal, wall };
}

function mergeSimple(geos) { // BufferGeometryUtils.mergeGeometries without the import (non-indexed, position+normal+uv)
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3); const nor = new Float32Array(total * 3); const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

function makeMesh(geo, mat, count, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  mesh.count = count;
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

export function createCans(scene, opts = {}) {
  if (CANS_OLD) {
    const old = createCansOld(scene, opts);
    old.legacy = true;
    return old;
  }
  const { room, vestibule = null } = opts;
  const spots = buildSpots(room, CAN_LAYERS);
  const n = spots.length;
  const F = (k = 1) => new Float64Array(n * k);
  const P = F(3); const Q = F(4); const V = F(3); const W = F(3); const A = F(3); const IW = F(9);
  const home = F(7);
  const awake = new Uint8Array(n); const floorTouch = new Uint8Array(n);
  const sleepT = new Float32Array(n); const sndAt = new Float32Array(n).fill(-1);
  const rollSpeed = new Float32Array(n);
  const label = new Uint8Array(n);
  const invM = 1 / CAN_MASS;
  // empty: thin aluminium shell (mass in the wall), full: solid cylinder
  const Iax = FULL ? 0.5 * CAN_MASS * R * R : CAN_MASS * R * R;
  const Itr = FULL ? CAN_MASS * (3 * R * R + CAN_H * CAN_H) / 12 : CAN_MASS * (R * R / 2 + CAN_H * CAN_H / 12);
  const iIax = 1 / Iax; const iItr = 1 / Itr;
  for (let i = 0; i < n; i += 1) {
    const s = spots[i];
    P[i * 3] = s.x; P[i * 3 + 1] = s.y; P[i * 3 + 2] = s.z;
    const yaw = ((i * 47) % 360) * Math.PI / 180;
    Q[i * 4 + 1] = Math.sin(yaw / 2); Q[i * 4 + 3] = Math.cos(yaw / 2);
    for (let k = 0; k < 3; k += 1) home[i * 7 + k] = P[i * 3 + k];
    for (let k = 0; k < 4; k += 1) home[i * 7 + 3 + k] = Q[i * 4 + k];
    label[i] = (i * 7 + s.level * 3) % LABELS.length;
  }

  // ---- meshes ----
  const geos = buildGeos();
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.28, envMapIntensity: 1.25, side: THREE.DoubleSide });
  const metal = makeMesh(geos.metal, metalMat, n, 'canMetal');
  const walls = LABELS.map((L, k) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: labelTexture(L, k), metalness: 0.92, roughness: 0.3, envMapIntensity: 1.2 });
    let c = 0; for (let i = 0; i < n; i += 1) if (label[i] === k) c += 1;
    return makeMesh(geos.wall, mat, c, 'canWall' + k);
  });
  const slot = new Int32Array(n);
  { const used = new Array(LABELS.length).fill(0); for (let i = 0; i < n; i += 1) slot[i] = used[label[i]]++; }
  const group = new THREE.Group();
  group.name = 'canPyramid';
  group.userData.zone = 'lift:2';
  group.add(metal, ...walls);
  scene.add(group);

  // ---- static world: floor, ceiling, room walls with the door gap, vestibule stop, posts ----
  const floorY = room.y;
  const ceilY = room.y + 2.02;
  const doorX0 = room.x0 + 0.2;
  const doorX1 = room.x0 + 1.0;
  const stopZ = (vestibule?.z0 ?? room.z0 - 0.8) + 0.28;
  const posts = [];
  for (let x = room.x0 + 0.45; x < room.x1 - 0.2; x += 0.8) { posts.push([x, room.z0 + 0.07, 0.07]); posts.push([x, room.z1 - 0.07, 0.07]); }
  const anchor = { x: P[(n - 1) * 3], z: P[(n - 1) * 3 + 2] };

  // ---- contacts (struct of arrays) ----
  const cA = new Int32Array(MAXC); const cB = new Int32Array(MAXC); // b >= 0 can, -1 static, <= -2 probe (-2 - k)
  const cN = new Float64Array(MAXC * 3); const cRA = new Float64Array(MAXC * 3); const cRB = new Float64Array(MAXC * 3);
  const cT1 = new Float64Array(MAXC * 3); const cT2 = new Float64Array(MAXC * 3);
  const cD = new Float64Array(MAXC); const cMN = new Float64Array(MAXC); const cMT1 = new Float64Array(MAXC); const cMT2 = new Float64Array(MAXC);
  const cJN = new Float64Array(MAXC); const cJT1 = new Float64Array(MAXC); const cJT2 = new Float64Array(MAXC);
  const cTgt = new Float64Array(MAXC); const cMu = new Float64Array(MAXC); const cKind = new Uint8Array(MAXC); // 0 floor,1 wall,2 can,3 probe
  let nc = 0;

  // probes: kinematic (hands, clubs, player) or light (arrows, thrown items) shapes pushed in from main.js
  const probes = []; // {key, ax..bz (segment now), pax..pbz (segment last frame), r, invMass, vx.., kind}
  const probePrev = new Map();
  let bodyRef = null;
  const events = [];
  let time = 0; let acc = 0; let anyAwake = false;
  const stats = { steps: 0, stepMs: 0, maxStepMs: 0, contacts: 0, awake: 0, wakes: 0, frames: 0 };

  // grid broadphase (xz)
  const CELL = CAN_H * 1.1; const GW = 64; const GD = 64;
  const OX = room.x0 - 1.0; const OZ = (vestibule?.z0 ?? room.z0) - 1.0;
  const gridHead = new Int32Array(GW * GD); const gridNext = new Int32Array(n);
  const cellOf = (x, z) => { const ix = Math.floor((x - OX) / CELL); const iz = Math.floor((z - OZ) / CELL); return ix < 0 || iz < 0 || ix >= GW || iz >= GD ? -1 : ix + iz * GW; };
  function rebuildGrid() {
    gridHead.fill(-1);
    for (let i = 0; i < n; i += 1) { const c = cellOf(P[i * 3], P[i * 3 + 2]); gridNext[i] = -1; if (c < 0) continue; gridNext[i] = gridHead[c]; gridHead[c] = i; }
  }

  function axisOf(i) {
    const x = Q[i * 4]; const y = Q[i * 4 + 1]; const z = Q[i * 4 + 2]; const w = Q[i * 4 + 3];
    A[i * 3] = 2 * (x * y - w * z); A[i * 3 + 1] = 1 - 2 * (x * x + z * z); A[i * 3 + 2] = 2 * (y * z + w * x);
    // world inverse inertia: Iinv = iItr*I + (iIax - iItr) a a^T
    const ax = A[i * 3]; const ay = A[i * 3 + 1]; const az = A[i * 3 + 2]; const d = iIax - iItr; const o = i * 9;
    IW[o] = iItr + d * ax * ax; IW[o + 1] = d * ax * ay; IW[o + 2] = d * ax * az;
    IW[o + 3] = IW[o + 1]; IW[o + 4] = iItr + d * ay * ay; IW[o + 5] = d * ay * az;
    IW[o + 6] = IW[o + 2]; IW[o + 7] = IW[o + 5]; IW[o + 8] = iItr + d * az * az;
  }
  // local X axis (for ring points)
  const e1 = [0, 0, 0]; const e2 = [0, 0, 0];
  function basis(i) {
    const x = Q[i * 4]; const y = Q[i * 4 + 1]; const z = Q[i * 4 + 2]; const w = Q[i * 4 + 3];
    e1[0] = 1 - 2 * (y * y + z * z); e1[1] = 2 * (x * y + w * z); e1[2] = 2 * (x * z - w * y);
    e2[0] = 2 * (x * z + w * y); e2[1] = 2 * (y * z - w * x); e2[2] = 1 - 2 * (x * x + y * y);
  }

  function wake(i) {
    if (awake[i]) return;
    awake[i] = 1; sleepT[i] = 0; anyAwake = true; stats.wakes += 1;
    // cans resting on this one lose their support: wake those above that touch it
    const px = P[i * 3]; const py = P[i * 3 + 1]; const pz = P[i * 3 + 2];
    forNear(px, pz, (j) => {
      if (awake[j]) return;
      const dy = P[j * 3 + 1] - py;
      if (dy < CAN_H * 0.5 || dy > CAN_H * 1.3) return;
      const dx = P[j * 3] - px; const dz = P[j * 3 + 2] - pz;
      if (dx * dx + dz * dz < (CAN_D * 0.98) ** 2) pendingWake.push(j);
    });
  }
  const pendingWake = [];
  function forNear(x, z, fn) {
    const ix = Math.floor((x - OX) / CELL); const iz = Math.floor((z - OZ) / CELL);
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const gx = ix + dx; const gz = iz + dz; if (gx < 0 || gz < 0 || gx >= GW || gz >= GD) continue;
      for (let j = gridHead[gx + gz * GW]; j >= 0; j = gridNext[j]) fn(j);
    }
  }

  let feat = 0; // feature id of the next contact (for warm starting)
  const cKey = new Float64Array(MAXC);
  const warm = new Map(); const warmJ = new Float64Array(MAXC * 3);
  function addContact(a, b, nx, ny, nz, px, py, pz, depth, kind, mu) {
    if (nc >= MAXC) return;
    const k = nc++;
    cKey[k] = (a * (n + 100) + (b + 100)) * 4096 + feat;
    cA[k] = a; cB[k] = b; cKind[k] = kind; cMu[k] = mu;
    cN[k * 3] = nx; cN[k * 3 + 1] = ny; cN[k * 3 + 2] = nz; cD[k] = depth;
    cRA[k * 3] = px - P[a * 3]; cRA[k * 3 + 1] = py - P[a * 3 + 1]; cRA[k * 3 + 2] = pz - P[a * 3 + 2];
    if (b >= 0) { cRB[k * 3] = px - P[b * 3]; cRB[k * 3 + 1] = py - P[b * 3 + 1]; cRB[k * 3 + 2] = pz - P[b * 3 + 2]; } else {
      cRB[k * 3] = px; cRB[k * 3 + 1] = py; cRB[k * 3 + 2] = pz; // static/probe: keep the world point
    }
  }

  // contact points of can i against a half-space n.x >= d (static)
  function planeContacts(i, nx, ny, nz, d, kind, plane = 0) {
    const o = i * 3; const ax = A[o]; const ay = A[o + 1]; const az = A[o + 2];
    const an = ax * nx + ay * ny + az * nz;
    // lowest point of the can along n: the cap facing -n
    for (let s = -1; s <= 1; s += 2) {
      if (Math.abs(an) > 0.2 && s * an > 0) continue; // the far cap can't touch (unless lying across n)
      const cx = P[o] + s * ax * HH; const cy = P[o + 1] + s * ay * HH; const cz = P[o + 2] + s * az * HH;
      let ux = -(nx - an * ax); let uy = -(ny - an * ay); let uz = -(nz - an * az);
      const ul = Math.hypot(ux, uy, uz);
      if (ul < 0.25) { // standing on this cap: a ring of rim points
        basis(i);
        for (let k = 0; k < RING; k += 1) {
          const px = cx + R * (RINGC[k] * e1[0] + RINGS[k] * e2[0]); const py = cy + R * (RINGC[k] * e1[1] + RINGS[k] * e2[1]); const pz = cz + R * (RINGC[k] * e1[2] + RINGS[k] * e2[2]);
          const depth = d - (px * nx + py * ny + pz * nz);
          feat = plane * 32 + (s > 0 ? 8 : 0) + k;
          if (depth > -MARGIN) addContact(i, -1, nx, ny, nz, px, py, pz, depth, kind, MU);
        }
      } else {
        ux /= ul; uy /= ul; uz /= ul;
        const px = cx + R * ux; const py = cy + R * uy; const pz = cz + R * uz;
        const depth = d - (px * nx + py * ny + pz * nz);
        feat = plane * 32 + 16 + (s > 0 ? 1 : 0);
        if (depth > -MARGIN) addContact(i, -1, nx, ny, nz, px, py, pz, depth, kind, MU);
      }
    }
  }

  function staticContacts(i) {
    const o = i * 3; const x = P[o]; const y = P[o + 1]; const z = P[o + 2];
    const ext = HH + R; // conservative extent
    if (y - ext < floorY + MARGIN) planeContacts(i, 0, 1, 0, floorY, 0);
    if (y + ext > ceilY) planeContacts(i, 0, -1, 0, -ceilY, 1, 1);
    if (x - ext < room.x0) planeContacts(i, 1, 0, 0, room.x0, 1, 2);
    if (x + ext > room.x1) planeContacts(i, -1, 0, 0, -room.x1, 1, 3);
    if (z + ext > room.z1) planeContacts(i, 0, 0, -1, -room.z1, 1, 4);
    const inDoor = x > doorX0 + R && x < doorX1 - R;
    if (z - ext < room.z0) {
      if (!inDoor) planeContacts(i, 0, 0, 1, room.z0, 1, 5);
      else {
        if (z - ext < stopZ) planeContacts(i, 0, 0, 1, stopZ, 1, 6);
        if (x - ext < doorX0) planeContacts(i, 1, 0, 0, doorX0, 1, 7);
        if (x + ext > doorX1) planeContacts(i, -1, 0, 0, -doorX1, 1, 8);
      }
    }
    for (let p = 0; p < posts.length; p += 1) {
      const [qx, qz, qr] = posts[p];
      const dx = x - qx; const dz = z - qz; const dd = Math.hypot(dx, dz);
      if (dd > qr + ext || dd < 1e-6) continue;
      const nx = dx / dd; const nz = dz / dd;
      planeContacts(i, nx, 0, nz, (qx + nx * qr) * nx + (qz + nz * qr) * nz, 1, 9 + p);
    }
  }

  // point (px,py,pz) of can a tested against cylinder b; contact normal points from b toward a
  function pointInCan(a, b, px, py, pz, capPref = false) {
    const o = b * 3; const ax = A[o]; const ay = A[o + 1]; const az = A[o + 2];
    const rx = px - P[o]; const ry = py - P[o + 1]; const rz = pz - P[o + 2];
    const h = rx * ax + ry * ay + rz * az;
    if (Math.abs(h) > HH + MARGIN) return;
    const sx = rx - h * ax; const sy = ry - h * ay; const sz = rz - h * az;
    const rho = Math.hypot(sx, sy, sz);
    if (rho > R + MARGIN) return;
    const dc = HH - Math.abs(h); const ds = R - rho;
    let nx; let ny; let nz; let depth;
    if (dc < ds || rho < 1e-6 || (capPref && dc < 0.01)) { const sg = h >= 0 ? 1 : -1; nx = sg * ax; ny = sg * ay; nz = sg * az; depth = dc; } else { nx = sx / rho; ny = sy / rho; nz = sz / rho; depth = ds; }
    addContact(a, b, nx, ny, nz, px, py, pz, depth, 2, MU_CAN); // point of a inside b: push a out along +n
  }
  // test a's rim feature points against b
  function rimVs(a, b) {
    const o = a * 3; const ax = A[o]; const ay = A[o + 1]; const az = A[o + 2];
    let dx = P[b * 3] - P[o]; let dy = P[b * 3 + 1] - P[o + 1]; let dz = P[b * 3 + 2] - P[o + 2];
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const ad = ax * dx + ay * dy + az * dz;
    let ux = dx - ad * ax; let uy = dy - ad * ay; let uz = dz - ad * az; const ul = Math.hypot(ux, uy, uz);
    if (ul > 1e-4) { ux /= ul; uy /= ul; uz /= ul; }
    for (let s = -1; s <= 1; s += 2) {
      const cx = P[o] + s * ax * HH; const cy = P[o + 1] + s * ay * HH; const cz = P[o + 2] + s * az * HH;
      feat = 16 + (s > 0 ? 1 : 0);
      if (ul > 1e-4) pointInCan(a, b, cx + R * ux, cy + R * uy, cz + R * uz);
      if (s * ad > 0.35) { // this cap faces b: ring points (cap-on-cap stacking)
        basis(a);
        for (let k = 0; k < RING; k += 1) feat = (s > 0 ? 8 : 0) + k, pointInCan(a, b, cx + R * (RINGC[k] * e1[0] + RINGS[k] * e2[0]), cy + R * (RINGC[k] * e1[1] + RINGS[k] * e2[1]), cz + R * (RINGC[k] * e1[2] + RINGS[k] * e2[2]), true);
      }
    }
  }
  const ss = { s: 0, t: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, d: 0 };
  function segSeg(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
    const abx = bx - ax; const aby = by - ay; const abz = bz - az; const cdx = dx - cx; const cdy = dy - cy; const cdz = dz - cz;
    const rx = ax - cx; const ry = ay - cy; const rz = az - cz;
    const AA = abx * abx + aby * aby + abz * abz; const EE = cdx * cdx + cdy * cdy + cdz * cdz;
    const FF = cdx * rx + cdy * ry + cdz * rz; const CC = abx * rx + aby * ry + abz * rz; const BB = abx * cdx + aby * cdy + abz * cdz;
    const den = AA * EE - BB * BB;
    let s = den > 1e-12 ? Math.min(1, Math.max(0, (BB * FF - CC * EE) / den)) : 0;
    let t = EE > 1e-12 ? (BB * s + FF) / EE : 0;
    if (t < 0) { t = 0; s = AA > 1e-12 ? Math.min(1, Math.max(0, -CC / AA)) : 0; } else if (t > 1) { t = 1; s = AA > 1e-12 ? Math.min(1, Math.max(0, (BB - CC) / AA)) : 0; }
    ss.s = s; ss.t = t;
    ss.ax = ax + abx * s; ss.ay = ay + aby * s; ss.az = az + abz * s; ss.bx = cx + cdx * t; ss.by = cy + cdy * t; ss.bz = cz + cdz * t;
    ss.d = Math.hypot(ss.ax - ss.bx, ss.ay - ss.by, ss.az - ss.bz);
  }
  function canCan(i, j) {
    const oi = i * 3; const oj = j * 3;
    const dx = P[oj] - P[oi]; const dy = P[oj + 1] - P[oi + 1]; const dz = P[oj + 2] - P[oi + 2];
    const reach = 2 * Math.hypot(R, HH) + MARGIN;
    if (dx * dx + dy * dy + dz * dz > reach * reach) return;
    rimVs(i, j); rimVs(j, i);
    // crossed cans touching side to side (closest axis points inside both segments)
    const dot = Math.abs(A[oi] * A[oj] + A[oi + 1] * A[oj + 1] + A[oi + 2] * A[oj + 2]);
    if (dot < 0.97) {
      segSeg(P[oi] - A[oi] * HH, P[oi + 1] - A[oi + 1] * HH, P[oi + 2] - A[oi + 2] * HH, P[oi] + A[oi] * HH, P[oi + 1] + A[oi + 1] * HH, P[oi + 2] + A[oi + 2] * HH,
        P[oj] - A[oj] * HH, P[oj + 1] - A[oj + 1] * HH, P[oj + 2] - A[oj + 2] * HH, P[oj] + A[oj] * HH, P[oj + 1] + A[oj + 1] * HH, P[oj + 2] + A[oj + 2] * HH);
      if (ss.s > 0.02 && ss.s < 0.98 && ss.t > 0.02 && ss.t < 0.98 && ss.d < 2 * R + MARGIN && ss.d > 1e-6) {
        const nx = (ss.ax - ss.bx) / ss.d; const ny = (ss.ay - ss.by) / ss.d; const nz = (ss.az - ss.bz) / ss.d;
        feat = 40;
        addContact(i, j, nx, ny, nz, ss.bx + nx * R, ss.by + ny * R, ss.bz + nz * R, 2 * R - ss.d, 2, MU_CAN);
      }
    }
  }

  // sphere (c, r) vs can i; used for probes. normal from probe toward can.
  function sphereCan(i, cx, cy, cz, r, pk) {
    const o = i * 3; const ax = A[o]; const ay = A[o + 1]; const az = A[o + 2];
    const rx = cx - P[o]; const ry = cy - P[o + 1]; const rz = cz - P[o + 2];
    const h = rx * ax + ry * ay + rz * az;
    const sx = rx - h * ax; const sy = ry - h * ay; const sz = rz - h * az; const rho = Math.hypot(sx, sy, sz);
    const hc = Math.max(-HH, Math.min(HH, h)); const rc = Math.min(R, rho);
    let qx; let qy; let qz; let nx; let ny; let nz; let depth;
    if (Math.abs(h) < HH && rho < R) { // centre inside the can: push out the nearest face
      const dc = HH - Math.abs(h); const ds = R - rho;
      if (dc < ds) { const sg = h >= 0 ? 1 : -1; nx = -sg * ax; ny = -sg * ay; nz = -sg * az; depth = dc + r; } else { const k = rho > 1e-6 ? 1 / rho : 0; nx = -sx * k; ny = -sy * k; nz = -sz * k; depth = ds + r; }
      qx = cx; qy = cy; qz = cz;
    } else {
      const k = rho > 1e-6 ? rc / rho : 0;
      qx = P[o] + hc * ax + sx * k; qy = P[o + 1] + hc * ay + sy * k; qz = P[o + 2] + hc * az + sz * k;
      const ex = qx - cx; const ey = qy - cy; const ez = qz - cz; const el = Math.hypot(ex, ey, ez);
      if (el > r + MARGIN || el < 1e-7) return false;
      nx = ex / el; ny = ey / el; nz = ez / el; depth = r - el;
    }
    feat = 50;
    addContact(i, -2 - pk, nx, ny, nz, qx, qy, qz, depth, 3, 0.6);
    return true;
  }
  function probeContacts(i, frac0, frac1) {
    const o = i * 3;
    for (let k = 0; k < probes.length; k += 1) {
      const pr = probes[k];
      // sweep: sample the probe segment along its motion this substep (fast arrows / club heads don't tunnel)
      const travel = Math.max(Math.hypot(pr.ax - pr.pax, pr.ay - pr.pay, pr.az - pr.paz), Math.hypot(pr.bx - pr.pbx, pr.by - pr.pby, pr.bz - pr.pbz)) * (frac1 - frac0);
      const nS = Math.min(8, Math.max(1, Math.ceil(travel / (R + pr.r))));
      for (let s = 1; s <= nS; s += 1) {
        const f = frac0 + (frac1 - frac0) * (s / nS);
        const ax = pr.pax + (pr.ax - pr.pax) * f; const ay = pr.pay + (pr.ay - pr.pay) * f; const az = pr.paz + (pr.az - pr.paz) * f;
        const bx = pr.pbx + (pr.bx - pr.pbx) * f; const by = pr.pby + (pr.by - pr.pby) * f; const bz = pr.pbz + (pr.bz - pr.pbz) * f;
        const mx = (ax + bx) / 2 - P[o]; const my = (ay + by) / 2 - P[o + 1]; const mz = (az + bz) / 2 - P[o + 2];
        const half = Math.hypot(bx - ax, by - ay, bz - az) / 2;
        if (Math.hypot(mx, my, mz) > half + pr.r + HH + R) continue;
        segSeg(ax, ay, az, bx, by, bz, P[o] - A[o] * HH, P[o + 1] - A[o + 1] * HH, P[o + 2] - A[o + 2] * HH, P[o] + A[o] * HH, P[o + 1] + A[o + 1] * HH, P[o + 2] + A[o + 2] * HH);
        if (sphereCan(i, ss.ax, ss.ay, ss.az, pr.r, k)) { if (!awake[i]) wake(i); break; }
      }
    }
  }

  // velocity of body b at world offset r (b<0: static/probe)
  const vtmp = [0, 0, 0];
  function velAt(b, k, isA) {
    if (b >= 0) {
      const o = b * 3; const r = isA ? cRA : cRB;
      const rx = r[k * 3]; const ry = r[k * 3 + 1]; const rz = r[k * 3 + 2];
      vtmp[0] = V[o] + W[o + 1] * rz - W[o + 2] * ry; vtmp[1] = V[o + 1] + W[o + 2] * rx - W[o] * rz; vtmp[2] = V[o + 2] + W[o] * ry - W[o + 1] * rx;
    } else if (b <= -2) { const pr = probes[-2 - b]; vtmp[0] = pr.vx; vtmp[1] = pr.vy; vtmp[2] = pr.vz; } else { vtmp[0] = vtmp[1] = vtmp[2] = 0; }
  }
  function dyn(b) { return b >= 0 && awake[b]; }
  // effective inverse mass along direction d at contact k
  function effMass(k, dx, dy, dz) {
    let m = 0;
    for (let side = 0; side < 2; side += 1) {
      const b = side ? cB[k] : cA[k];
      if (b <= -2) { m += probes[-2 - b].invMass; continue; }
      if (!dyn(b)) continue;
      const r = side ? cRB : cRA; const rx = r[k * 3]; const ry = r[k * 3 + 1]; const rz = r[k * 3 + 2];
      const cx = ry * dz - rz * dy; const cy = rz * dx - rx * dz; const cz = rx * dy - ry * dx;
      const o = b * 9;
      const ix = IW[o] * cx + IW[o + 1] * cy + IW[o + 2] * cz; const iy = IW[o + 3] * cx + IW[o + 4] * cy + IW[o + 5] * cz; const iz = IW[o + 6] * cx + IW[o + 7] * cy + IW[o + 8] * cz;
      m += invM + cx * ix + cy * iy + cz * iz;
    }
    return m > 1e-12 ? 1 / m : 0;
  }
  function applyImp(b, k, isA, jx, jy, jz) {
    if (!dyn(b)) return;
    const o = b * 3; const r = isA ? cRA : cRB; const rx = r[k * 3]; const ry = r[k * 3 + 1]; const rz = r[k * 3 + 2];
    V[o] += jx * invM; V[o + 1] += jy * invM; V[o + 2] += jz * invM;
    const tx = ry * jz - rz * jy; const ty = rz * jx - rx * jz; const tz = rx * jy - ry * jx; const m = b * 9;
    W[o] += IW[m] * tx + IW[m + 1] * ty + IW[m + 2] * tz; W[o + 1] += IW[m + 3] * tx + IW[m + 4] * ty + IW[m + 5] * tz; W[o + 2] += IW[m + 6] * tx + IW[m + 7] * ty + IW[m + 8] * tz;
  }
  const rvo = [0, 0, 0];
  function relVel(k) {
    velAt(cA[k], k, true); const ax = vtmp[0]; const ay = vtmp[1]; const az = vtmp[2];
    velAt(cB[k], k, false); rvo[0] = ax - vtmp[0]; rvo[1] = ay - vtmp[1]; rvo[2] = az - vtmp[2]; return rvo;
  }

  function emit(i, kind, speed, k) {
    if (speed < 0.32 || time - sndAt[i] < 0.07) return;
    sndAt[i] = time;
    const o = i * 3;
    events.push({ type: kind, i, x: P[o] + cRA[k * 3], y: P[o + 1] + cRA[k * 3 + 1], z: P[o + 2] + cRA[k * 3 + 2], speed });
  }

  function prepare(dt) {
    for (let k = 0; k < nc; k += 1) {
      const nx = cN[k * 3]; const ny = cN[k * 3 + 1]; const nz = cN[k * 3 + 2];
      // tangent basis
      let tx; let ty; let tz;
      if (Math.abs(nx) < 0.57) { tx = 0; ty = nz; tz = -ny; } else { tx = -nz; ty = 0; tz = nx; }
      const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      cT1[k * 3] = tx; cT1[k * 3 + 1] = ty; cT1[k * 3 + 2] = tz;
      cT2[k * 3] = ny * tz - nz * ty; cT2[k * 3 + 1] = nz * tx - nx * tz; cT2[k * 3 + 2] = nx * ty - ny * tx;
      cMN[k] = effMass(k, nx, ny, nz); cMT1[k] = effMass(k, tx, ty, tz); cMT2[k] = effMass(k, cT2[k * 3], cT2[k * 3 + 1], cT2[k * 3 + 2]);
      cJN[k] = cJT1[k] = cJT2[k] = 0;
      const rv = relVel(k); const vn = rv[0] * nx + rv[1] * ny + rv[2] * nz;
      // restitution above 0.35 m/s approach; speculative contacts (depth<0) only remove the gap's worth of approach
      // restitution above 0.35 m/s approach; a speculative contact (gap > 0) lets the gap close this substep
      cTgt[k] = cD[k] < 0 ? cD[k] / dt : (vn < -0.35 ? -E_REST * vn : 0);
      // wake / sound
      const a = cA[k]; const b = cB[k];
      if (b >= 0 && awake[a] !== awake[b] && (-vn > WAKE_V || cD[k] > 0.004)) { wake(awake[a] ? b : a); }
      if (-vn > 0.32) {
        const kind = cKind[k] === 0 ? 'floor' : cKind[k] === 1 ? 'wall' : cKind[k] === 2 ? 'can' : 'hit';
        if (awake[a] || cKind[k] === 3) emit(a, kind, -vn, k);
      }
    }
    // contacts whose dynamic side went to sleep need effective masses recomputed after wakes
    for (let k = 0; k < nc; k += 1) cMN[k] = effMass(k, cN[k * 3], cN[k * 3 + 1], cN[k * 3 + 2]);
  }
  // warm start: last substep's impulses for the same (a, b, feature)
  function warmStart() {
    for (let k = 0; k < nc; k += 1) {
      const wi = warm.get(cKey[k]);
      if (wi === undefined) continue;
      const jn = warmJ[wi * 3] * 0.95; const j1 = warmJ[wi * 3 + 1] * 0.95; const j2 = warmJ[wi * 3 + 2] * 0.95;
      cJN[k] = jn; cJT1[k] = j1; cJT2[k] = j2;
      const jx = cN[k * 3] * jn + cT1[k * 3] * j1 + cT2[k * 3] * j2; const jy = cN[k * 3 + 1] * jn + cT1[k * 3 + 1] * j1 + cT2[k * 3 + 1] * j2; const jz = cN[k * 3 + 2] * jn + cT1[k * 3 + 2] * j1 + cT2[k * 3 + 2] * j2;
      applyImp(cA[k], k, true, jx, jy, jz); applyImp(cB[k], k, false, -jx, -jy, -jz);
    }
  }
  function storeWarm() {
    warm.clear();
    for (let k = 0; k < nc; k += 1) if (cJN[k] > 0) { warm.set(cKey[k], k); warmJ[k * 3] = cJN[k]; warmJ[k * 3 + 1] = cJT1[k]; warmJ[k * 3 + 2] = cJT2[k]; }
  }

  // bottom-up order (contact height) so the stack's weight propagates in one Gauss-Seidel sweep
  const order = new Int32Array(MAXC); const keyY = new Float64Array(MAXC);
  function sortContacts() {
    for (let k = 0; k < nc; k += 1) { order[k] = k; keyY[k] = P[cA[k] * 3 + 1] + cRA[k * 3 + 1]; }
    const sub = order.subarray(0, nc);
    sub.sort((a, b) => keyY[a] - keyY[b]);
  }
  function solve() {
    sortContacts();
    for (let it = 0; it < ITER; it += 1) {
      for (let kk = 0; kk < nc; kk += 1) {
        const k = order[kk];
        const a = cA[k]; const b = cB[k];
        if (!dyn(a) && !dyn(b)) continue;
        const nx = cN[k * 3]; const ny = cN[k * 3 + 1]; const nz = cN[k * 3 + 2];
        let rv = relVel(k);
        const vn = rv[0] * nx + rv[1] * ny + rv[2] * nz;
        let dj = (cTgt[k] - vn) * cMN[k];
        const old = cJN[k]; cJN[k] = Math.max(0, old + dj); dj = cJN[k] - old;
        if (dj !== 0) { applyImp(a, k, true, nx * dj, ny * dj, nz * dj); applyImp(b, k, false, -nx * dj, -ny * dj, -nz * dj); }
        // friction (circular cone)
        rv = relVel(k);
        const t1x = cT1[k * 3]; const t1y = cT1[k * 3 + 1]; const t1z = cT1[k * 3 + 2];
        const t2x = cT2[k * 3]; const t2y = cT2[k * 3 + 1]; const t2z = cT2[k * 3 + 2];
        const v1 = rv[0] * t1x + rv[1] * t1y + rv[2] * t1z; const v2 = rv[0] * t2x + rv[1] * t2y + rv[2] * t2z;
        let j1 = cJT1[k] - v1 * cMT1[k]; let j2 = cJT2[k] - v2 * cMT2[k];
        const lim = cMu[k] * cJN[k]; const jl = Math.hypot(j1, j2);
        if (jl > lim) { const s = lim / jl; j1 *= s; j2 *= s; }
        const d1 = j1 - cJT1[k]; const d2 = j2 - cJT2[k]; cJT1[k] = j1; cJT2[k] = j2;
        const jx = t1x * d1 + t2x * d2; const jy = t1y * d1 + t2y * d2; const jz = t1z * d1 + t2z * d2;
        if (jx || jy || jz) { applyImp(a, k, true, jx, jy, jz); applyImp(b, k, false, -jx, -jy, -jz); }
      }
    }
  }

  // positional correction (linear only, split from velocities so it adds no energy)
  function correct() {
    for (let pass = 0; pass < 2; pass += 1) {
      for (let k = 0; k < nc; k += 1) {
        const a = cA[k]; const b = cB[k];
        const da = dyn(a); const db = dyn(b);
        if (!da && !db) continue;
        const pen = cD[k] - SLOP; if (pen <= 0) continue;
        const wa = da ? invM : 0; const wb = db ? invM : 0; const ws = wa + wb + (b <= -2 ? 0 : 0);
        const kb = b <= -2 ? 1 : 0; // probes are kinematic: the can takes all of it
        const nx = cN[k * 3]; const ny = cN[k * 3 + 1]; const nz = cN[k * 3 + 2];
        const corr = Math.min(0.02, pen * 0.5);
        if (da) { const f = kb ? 1 : wa / ws; P[a * 3] += nx * corr * f; P[a * 3 + 1] += ny * corr * f; P[a * 3 + 2] += nz * corr * f; }
        if (db) { const f = wb / ws; P[b * 3] -= nx * corr * f; P[b * 3 + 1] -= ny * corr * f; P[b * 3 + 2] -= nz * corr * f; }
        cD[k] -= corr;
      }
    }
  }

  function integrate(i, dt) {
    const o = i * 3;
    V[o + 1] -= GRAV * dt;
    const ld = Math.exp(-0.08 * dt); const ad = Math.exp(-0.12 * dt);
    V[o] *= ld; V[o + 1] *= ld; V[o + 2] *= ld; W[o] *= ad; W[o + 1] *= ad; W[o + 2] *= ad;
    const sp = Math.hypot(V[o], V[o + 1], V[o + 2]); if (sp > 14) { const s = 14 / sp; V[o] *= s; V[o + 1] *= s; V[o + 2] *= s; }
    const ws = Math.hypot(W[o], W[o + 1], W[o + 2]); if (ws > 60) { const s = 60 / ws; W[o] *= s; W[o + 1] *= s; W[o + 2] *= s; }
  }
  function advance(i, dt) {
    const o = i * 3; const q = i * 4;
    P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
    const x = Q[q]; const y = Q[q + 1]; const z = Q[q + 2]; const w = Q[q + 3];
    const hx = W[o] * dt * 0.5; const hy = W[o + 1] * dt * 0.5; const hz = W[o + 2] * dt * 0.5;
    const X = x + hx * w + hy * z - hz * y; const Y = y - hx * z + hy * w + hz * x; const Z = z + hx * y - hy * x + hz * w; const Wq = w - hx * x - hy * y - hz * z;
    const inv = 1 / (Math.hypot(X, Y, Z, Wq) || 1);
    Q[q] = X * inv; Q[q + 1] = Y * inv; Q[q + 2] = Z * inv; Q[q + 3] = Wq * inv;
  }

  // floor rolling resistance + spin damping, rolling speed for the roll loop
  function floorFriction(dt) {
    floorTouch.fill(0);
    for (let k = 0; k < nc; k += 1) if (cKind[k] === 0 && cJN[k] > 0) floorTouch[cA[k]] = 1;
    const kr = Math.exp(-ROLL_DAMP * dt); const ks = Math.exp(-SPIN_DAMP * dt);
    for (let i = 0; i < n; i += 1) {
      rollSpeed[i] = 0;
      if (!awake[i] || !floorTouch[i]) continue;
      const o = i * 3;
      const wy = W[o + 1];
      W[o] *= kr; W[o + 2] *= kr; W[o + 1] = wy * ks;
      const lying = Math.abs(A[o + 1]) < 0.35;
      if (lying) rollSpeed[i] = Math.hypot(V[o], V[o + 2]);
      else rollSpeed[i] = Math.abs(A[o + 1]) < 0.97 ? Math.hypot(W[o], W[o + 2]) * R * 0.6 : 0; // rim wobble/roll
    }
  }

  function trySleep(dt) {
    let any = false;
    for (let i = 0; i < n; i += 1) {
      if (!awake[i]) continue;
      const o = i * 3;
      const v2 = V[o] * V[o] + V[o + 1] * V[o + 1] + V[o + 2] * V[o + 2]; const w2 = W[o] * W[o] + W[o + 1] * W[o + 1] + W[o + 2] * W[o + 2];
      if (v2 < SLEEP_V * SLEEP_V && w2 < SLEEP_W * SLEEP_W) {
        sleepT[i] += dt;
        if (sleepT[i] > SLEEP_T) { awake[i] = 0; V[o] = V[o + 1] = V[o + 2] = W[o] = W[o + 1] = W[o + 2] = 0; continue; }
      } else sleepT[i] = 0;
      if (P[o + 1] < floorY - 0.5 || !Number.isFinite(P[o] + P[o + 1] + P[o + 2])) resetCan(i); // safety net
      any = true;
    }
    anyAwake = any;
  }
  function resetCan(i) {
    for (let k = 0; k < 3; k += 1) { P[i * 3 + k] = home[i * 7 + k]; V[i * 3 + k] = 0; W[i * 3 + k] = 0; }
    for (let k = 0; k < 4; k += 1) Q[i * 4 + k] = home[i * 7 + 3 + k];
    awake[i] = 0;
  }

  function substep(dt, f0, f1) {
    rebuildGrid();
    for (let i = 0; i < n; i += 1) axisOf(i);
    nc = 0;
    if (probes.length) for (let i = 0; i < n; i += 1) probeContacts(i, f0, f1);
    while (pendingWake.length) wake(pendingWake.pop());
    for (let i = 0; i < n; i += 1) if (awake[i]) integrate(i, dt);
    for (let i = 0; i < n; i += 1) {
      if (!awake[i]) continue;
      staticContacts(i);
      forNear(P[i * 3], P[i * 3 + 2], (j) => { if (j === i || (awake[j] && j < i)) return; canCan(i, j); });
    }
    // probe contacts were added before the static ones; re-do them for cans woken by probes this substep is fine
    prepare(dt);
    while (pendingWake.length) wake(pendingWake.pop());
    // a can woken during prepare: its contacts with other sleeping cans weren't generated; next substep picks them up
    for (let k = 0; k < nc; k += 1) { cMT1[k] = effMass(k, cT1[k * 3], cT1[k * 3 + 1], cT1[k * 3 + 2]); cMT2[k] = effMass(k, cT2[k * 3], cT2[k * 3 + 1], cT2[k * 3 + 2]); }
    warmStart();
    solve();
    storeWarm();
    floorFriction(dt);
    for (let i = 0; i < n; i += 1) if (awake[i]) advance(i, dt);
    correct();
    trySleep(dt);
    stats.contacts = Math.max(stats.contacts * 0.9, nc);
  }

  const _m = new THREE.Matrix4(); const _p = new THREE.Vector3(); const _q = new THREE.Quaternion(); const _one = new THREE.Vector3(1, 1, 1);
  const dirty = new Uint8Array(n).fill(1);
  function writeMatrices() {
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      if (!dirty[i] && !awake[i]) continue;
      _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); _q.set(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]);
      _m.compose(_p, _q, _one);
      metal.setMatrixAt(i, _m); walls[label[i]].setMatrixAt(slot[i], _m);
      dirty[i] = awake[i]; // one more write after it falls asleep
      changed = true;
    }
    if (!changed) return;
    metal.instanceMatrix.needsUpdate = true;
    for (const w of walls) w.instanceMatrix.needsUpdate = true;
  }
  writeMatrices();
  rebuildGrid();

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function update(dt) {
    events.length = 0;
    const b = bodyRef;
    const near = !!(b && Math.abs(b.x - anchor.x) < 5 && Math.abs(b.z - anchor.z) < 5 && b.y1 > floorY - 0.3 && b.y0 < floorY + 2.6);
    // build probe list: the player capsule + whatever main.js passed in
    probes.length = 0;
    if (near) {
      probes.push(probeFrom('body', b.x, b.y0 + 0.26, b.z, b.x, b.y1 - 0.1, b.z, 0.26, 0, b.vx, 0, b.vz, dt));
      for (const p of extProbes) probes.push(probeFrom(p.key, p.ax, p.ay, p.az, p.bx ?? p.ax, p.by ?? p.ay, p.bz ?? p.az, p.r, p.invMass ?? 0, null, null, null, dt));
    } else probePrev.clear();
    if (!anyAwake && !probes.length) { time += dt; return events; }
    const t0 = now();
    acc += Math.min(Math.max(dt, 0), 0.05);
    let steps = Math.floor(acc / STEP);
    if (steps > MAX_SUB) { steps = MAX_SUB; acc = 0; } else acc -= steps * STEP;
    for (let s = 0; s < steps; s += 1) {
      substep(STEP, s / steps, (s + 1) / steps); time += STEP;
      // frame budget: past BUDGET ms, drop the remaining substeps this frame (a brief slow-down beats a dropped frame)
      if (s < steps - 1 && now() - t0 > BUDGET) { stats.skipped = (stats.skipped || 0) + steps - 1 - s; break; }
    }
    if (!steps) time += dt;
    for (const p of probes) probePrev.set(p.key, [p.ax, p.ay, p.az, p.bx, p.by, p.bz]);
    writeMatrices();
    const ms = now() - t0;
    stats.frames += 1; stats.steps += steps; stats.stepMs = stats.stepMs * 0.9 + ms * 0.1; stats.maxStepMs = Math.max(stats.maxStepMs, ms);
    return events;
  }
  function probeFrom(key, ax, ay, az, bx, by, bz, r, invMass, vx, vy, vz, dt) {
    const prev = probePrev.get(key);
    const p = { key, ax, ay, az, bx, by, bz, r, invMass, pax: ax, pay: ay, paz: az, pbx: bx, pby: by, pbz: bz, vx: vx ?? 0, vy: vy ?? 0, vz: vz ?? 0 };
    if (prev && Math.hypot(prev[0] - ax, prev[1] - ay, prev[2] - az) < 2.5) {
      [p.pax, p.pay, p.paz, p.pbx, p.pby, p.pbz] = prev;
      if (vx == null) { const s = 1 / Math.max(dt, 1 / 120); p.vx = ((ax + bx) - (prev[0] + prev[3])) * 0.5 * s; p.vy = ((ay + by) - (prev[1] + prev[4])) * 0.5 * s; p.vz = ((az + bz) - (prev[2] + prev[5])) * 0.5 * s; }
    }
    return p;
  }
  let extProbes = [];

  // for the roll loops: the fastest rolling cans
  function rollers(max = 3) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      if (rollSpeed[i] < 0.05) continue;
      out.push({ i, speed: rollSpeed[i], x: P[i * 3], y: P[i * 3 + 1], z: P[i * 3 + 2] });
    }
    out.sort((a, b) => b.speed - a.speed);
    out.length = Math.min(out.length, max);
    return out;
  }

  function debug() {
    let awakeN = 0; let moved = 0; let nan = 0; let minY = Infinity; let maxDisp = 0; let fast = 0; let onFloor = 0; let maxSpeed = 0; let below = 0; let outside = 0;
    for (let i = 0; i < n; i += 1) {
      const o = i * 3;
      if (awake[i]) awakeN += 1;
      if (!Number.isFinite(P[o] + P[o + 1] + P[o + 2] + Q[i * 4 + 3])) nan += 1;
      const d = Math.hypot(P[o] - home[i * 7], P[o + 1] - home[i * 7 + 1], P[o + 2] - home[i * 7 + 2]);
      maxDisp = Math.max(maxDisp, d); if (d > 0.02) moved += 1;
      minY = Math.min(minY, P[o + 1]);
      const sp = Math.hypot(V[o], V[o + 1], V[o + 2]); maxSpeed = Math.max(maxSpeed, sp); if (sp > 0.25) fast += 1;
      if (P[o + 1] < floorY + R + 0.01) onFloor += 1;
      if (P[o + 1] < floorY + Math.min(R, HH) - 0.01) below += 1;
      if (P[o] < room.x0 - 0.01 || P[o] > room.x1 + 0.01 || P[o + 2] > room.z1 + 0.01 || P[o + 2] < stopZ - 0.6) outside += 1;
    }
    return { room: { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y: room.y }, count: n, layers: CAN_LAYERS, mass: CAN_MASS, awake: awakeN, moved, maxDisp, minY, nan, fast, maxSpeed, onFloor, below, outside, topY: P[(n - 1) * 3 + 1], topHome: home[(n - 1) * 7 + 1], floorY, anchor, stats: { ...stats } };
  }

  return {
    group,
    count: n,
    impacts: events,
    update,
    debug,
    rollers,
    legacy: false,
    mass: CAN_MASS,
    setBody(b) { bodyRef = b; },
    setProbes(list) { extProbes = list || []; },
    // test / gameplay hooks
    wakeAll() { for (let i = 0; i < n; i += 1) wake(i); },
    kick(i, vx, vy, vz, wx = 0, wy = 0, wz = 0) { wake(i); V[i * 3] += vx; V[i * 3 + 1] += vy; V[i * 3 + 2] += vz; W[i * 3] += wx; W[i * 3 + 1] += wy; W[i * 3 + 2] += wz; },
    position: (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]],
    reset() { for (let i = 0; i < n; i += 1) { resetCan(i); dirty[i] = 1; } anyAwake = false; writeMatrices(); },
  };
}
