// Inland cliff on the east edge of the roof. The climb is the same notch hardware as the cave route,
// on the north side of the face. The nose is a level overhang pointing west, out over the sea.
import * as THREE from 'three';
import { notchClimb, notchDress } from './notches.js';
import { applyWorldUv } from './uv.js';
import { legacy } from './flags.js';
import { dressCrag, faceSkin } from './cragrock.js';
import { SUMMIT, LIP, inPoly, edgeDist, summitRise, bearGround } from './overlookshape.js';
import { createSummit, summitTrees } from './overlookwoods.js';

// Clubs/cliff pass: rock holds on a displaced rock skin (cragrock.js). ?legacy=crag keeps the cut notch line.
export const CRAG_ROCK = !legacy('crag');
// Overlook pass: the bare back wall becomes a wooded summit, the route is a sparser zigzag with two rest ledges and a
// lip you haul yourself over. ?legacy=overlook keeps the clubs-pass slab, holds and top-out slot.
export const OVERLOOK = CRAG_ROCK && !legacy('overlook');

// Overlook pass route: [height over the roof, z] waypoints (the last one is just under the lip), and two rest ledges
// on the line ([height over the roof, z centre]). Steps between holds are 0.3..0.6 m; the two near-level legs are the
// sideways moves.
const ROUTE = [
  [0.95, -2.05], [4.6, -2.65], [4.95, -1.55], [9.7, -1.45], [13.8, -2.35], [16.4, -2.75], [16.75, -1.65],
  [21.0, -1.5], [24.8, -2.55], [27.3, -1.8], [-0.55, -2.15],
];
const LEDGES = [[10.35, -1.62], [21.55, -1.68]];

function routeLine(roofY, deckY) {
  const pts = ROUTE.map(([h, z]) => [h < 0 ? deckY + h : roofY + h, z]);
  const zAt = (y) => {
    if (y <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i += 1) {
      if (y <= pts[i][0]) {
        const [y0, z0] = pts[i - 1];
        const [y1, z1] = pts[i];
        return z0 + ((y - y0) / (y1 - y0)) * (z1 - z0);
      }
    }
    return pts[pts.length - 1][1];
  };
  const rnd = (i, k) => {
    const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const holds = [];
  const push = (y, z, side, size) => holds.push({ y, z: zAt(y), dz: side + (z - zAt(y)), size });
  let i = 0;
  let carry = 0; // how far into the next leg the next hold goes
  for (let s = 1; s < pts.length; s += 1) {
    const [y0, z0] = pts[s - 1];
    const [y1, z1] = pts[s];
    const dy = y1 - y0;
    const dz = z1 - z0;
    const sideways = Math.abs(dz) > dy; // traverse leg: step along it, mostly sideways
    const len = sideways ? Math.hypot(dy, dz) : dy;
    let at = carry;
    while (at <= len + 1e-6) {
      if (!sideways) {
        // nothing buried in a rest ledge: a hold that would land on one goes just above it, and the line carries on
        // from there
        const y = y0 + (dy * at) / len;
        const ledge = LEDGES.find(([lh]) => Math.abs(y - (roofY + lh)) < 0.15);
        if (ledge) at = ((roofY + ledge[0] + 0.16 - y0) / dy) * len;
        if (at > len + 1e-6) break;
      }
      const f = at / len;
      const side = sideways ? 0 : (i % 2 ? 1 : -1) * (0.1 + 0.08 * rnd(i, 2));
      const size = sideways ? 1.15 + 0.3 * rnd(i, 3) : 0.75 + 0.7 * rnd(i, 3) ** 1.4;
      push(y0 + dy * f, z0 + dz * f, side, size);
      i += 1;
      at += sideways ? 0.48 + 0.1 * rnd(i, 4) : 0.3 + 0.3 * rnd(i, 5) ** 0.35;
    }
    carry = at - len;
  }
  const [yEnd, zEnd] = pts[pts.length - 1];
  if (holds[holds.length - 1].y < yEnd - 0.05) push(yEnd, zEnd, 0.12, 1.2);
  // jugs on the moves off each rest ledge
  for (const h of holds) {
    for (const [lh] of LEDGES) if (h.y > roofY + lh + 0.1 && h.y < roofY + lh + 1.4) h.size = Math.max(h.size, 1.3);
  }
  return { holds, zAt, pts };
}

export function createBackCrag({ scene, targets, rock, roof, assets = null }) {
  const faceMat = rock || new THREE.MeshStandardMaterial({ color: 0x8a8176, roughness: 1 });

  const group = new THREE.Group();
  group.name = 'back_crag';
  scene.add(group);

  function add(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    applyWorldUv(mesh, 2.3);
    return mesh;
  }

  function box(w, h, d, x, y, z, mat = faceMat, rot = null) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    return add(mesh);
  }

  // The old stair scramble rose about 7.5 m off the roof. This face is four times that.
  const deckY = roof.y + (10.8 - roof.y) * 4;
  // Overlook pass: the boxes used to stand 1.6 m over the deck (the bare wall behind the overlook); now they stop just
  // under it and the summit (overlookwoods.js) caps them.
  const wallH = OVERLOOK ? deckY - 0.03 - roof.y : deckY - roof.y + 1.6;
  const wallY = roof.y + wallH / 2;
  // West edges sit near x 3.5. No ledges to walk up.
  box(1.7, wallH, 2.5, 4.35, wallY, -2.15);
  box(1.85, wallH, 3.3, 4.48, OVERLOOK ? wallY : wallY + 0.15, 1.35);
  if (!OVERLOOK) box(1.35, 2.4, 2.5, 4.22, deckY + 0.35, 0.05);

  // Broken curb along the roof edge so the cliff meets the roof.
  [[3.15, 0.55, -2.4], [2.6, 0.7, -0.7], [2.9, 0.48, 1.1], [2.2, 0.62, 2.55]].forEach(([d, h, z]) => {
    box(0.42, h, d, 3.4, roof.y + h / 2, z, faceMat, [0, (z % 1) * 0.2, 0]);
  });

  // Level nose. The crown stays at one height; the belly still hangs below it over the drop.
  const spine = [
    { x: -2.7, y: deckY, hw: 0.48, thick: 0.55 },
    { x: -2.1, y: deckY, hw: 0.55, thick: 0.66 },
    { x: -1.55, y: deckY, hw: 0.62, thick: 0.78 },
    { x: -0.9, y: deckY, hw: 0.7, thick: 0.88 },
    { x: -0.35, y: deckY, hw: 0.78, thick: 1.0 },
    { x: 0.28, y: deckY, hw: 0.86, thick: 1.1 },
    { x: 0.9, y: deckY, hw: 0.95, thick: 1.2 },
    { x: 1.5, y: deckY, hw: 1.04, thick: 1.3 },
    { x: 2.05, y: deckY, hw: 1.12, thick: 1.4 },
    { x: 2.75, y: deckY, hw: 1.18, thick: 1.5 },
    { x: 3.4, y: deckY, hw: 1.22, thick: 1.6 },
  ];
  buildNose(spine, add, faceMat);
  // North shoulder, clear of the nose, where the notch line arrives.
  // Rock mode: the climber now hangs 20 cm further out than the old slab allowed (head at x ~3.2), so the shoulder
  // keeps a slot (x 2.95..3.5, z < -2.0) where the line tops out; a collider stops walking into the slot from above.
  // Overlook pass: the climb tops out east onto the summit, so the slot runs the whole width of the shoulder (the
  // zigzag ends anywhere in z -2.65..-1.45) and the little block east of it is gone.
  const slot = OVERLOOK ? { x0: 2.95, x1: 3.5, z0: -2.85, z1: -1.15 } : { x0: 2.95, x1: 3.5, z0: -2.85, z1: -2.0 };
  if (CRAG_ROCK) {
    box(1.4, 0.55, 2.0, 2.25, deckY - 0.275, -1.85);
    if (!OVERLOOK) box(0.5, 0.55, 1.15, 3.2, deckY - 0.275, -1.425);
  } else box(1.9, 0.55, 2.0, 2.5, deckY - 0.275, -1.85);

  const faceX0 = CRAG_ROCK ? 3.42 : 3.5; // the rock skin stands up to 8 cm proud of the boxes at walking height
  // Overlook pass: the back cliff stops at the deck (you walk onto the summit over it); the slot collider only keeps
  // you from walking into the slot from above, and main.js ignores it while you're on the climb (climbThrough).
  const cliffTop = OVERLOOK ? deckY - 0.02 : null;
  const colliders = [
    { x0: faceX0, x1: 5.4, z0: -3.5, z1: -0.85, y0: roof.y - 0.2, y1: cliffTop ?? deckY + 2.2, why: 'back cliff' },
    { x0: faceX0, x1: 5.6, z0: 0.4, z1: 3.2, y0: roof.y - 0.2, y1: cliffTop ?? deckY + 2.2, why: 'back cliff' },
    { x0: faceX0, x1: 5.1, z0: -0.95, z1: 0.7, y0: roof.y - 0.2, y1: cliffTop ?? deckY + 1.6, why: 'back cliff' },
  ];
  if (CRAG_ROCK) colliders.push({ ...slot, y0: deckY - 0.3, y1: deckY + 1.8, why: 'cliff edge', climbThrough: true });

  // Notch line on the north side of the face, beside the nose, not up through it.
  // Rock mode: holds every 0.28 m (was 0.23), alternating 15 cm either side with a little jitter.
  const y0 = roof.y + 0.95;
  const y1 = OVERLOOK ? deckY - 0.55 : deckY - 0.45;
  const route = OVERLOOK ? routeLine(roof.y, deckY) : null;
  const zLine = route ? route.zAt : (y) => -2.05 + ((y - y0) / (y1 - y0)) * -0.4;
  const holds = [];
  const exitZ = route ? zLine(deckY) : -2.15;
  if (route) {
    holds.push(...route.holds);
    // the lip: three grab points along the top edge of the face over the end of the line
    [-0.32, 0, 0.32].forEach((dz) => holds.push({ y: deckY - 0.04, z: exitZ, dz, size: 1.15, lip: true }));
  } else if (CRAG_ROCK) {
    const n = Math.round((y1 - y0) / 0.28);
    for (let i = 0; i <= n; i += 1) {
      const y = y0 + ((y1 - y0) * i) / n;
      const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      holds.push({ y, z: zLine(y), dz: (i % 2 ? 0.15 : -0.15) + jitter * 0.03 });
    }
  } else for (let y = y0; y <= y1; y += 0.23) holds.push({ y, z: zLine(y) });
  const ladder = notchClimb({
    scene,
    targets,
    surfaceX: 3.5,
    holds,
    standOff: CRAG_ROCK ? 0.12 : 0.22,
    dress: !CRAG_ROCK,
    userData: {
      crag: CRAG_ROCK,
      roofY: deckY,
      shaft: { top: deckY - 0.2, base: roof.y },
      path: OVERLOOK ? { zBase: -2.9, zTop: -1.35 } : { zBase: -2.7, zTop: -1.7 },
      zAt: zLine,
      // overlook pass: main.js hauls you over the lip onto the summit (feet at spot) instead of the old snap
      lip: OVERLOOK ? { y: deckY, x: LIP.x, z0: LIP.z0, z1: LIP.z1, spot: { x: 4.2, y: deckY, z: exitZ } } : null,
      topSpot: OVERLOOK ? { x: 4.2, y: deckY, z: exitZ } : { x: 2.45, y: deckY, z: -2.15 },
      baseSpot: { x: 2.5, y: roof.y, z: -2.05 },
      topStatus: OVERLOOK ? 'On top of the crag. The woods start behind you.' : 'On the shoulder beside the point.',
      baseStatus: 'Back on the roof.',
    },
  });

  let dressing = null;
  if (CRAG_ROCK) {
    group.add(faceSkin({ material: faceMat, roofY: roof.y, deckY, zLine, lineY0: y0, lineY1: y1, top: OVERLOOK ? deckY - 0.05 : null }));
    // the scanned holds stream in after boot (crag_kit is a deferred model); the cut notches are the fallback
    const kitReady = assets?.enabled ? assets.whenReady('crag_kit') : Promise.resolve(null);
    dressing = kitReady.then((kit) => {
      const done = kit ? dressCrag({ group, kit, ladder, roofY: roof.y, deckY, zLine, ledges: OVERLOOK ? LEDGES.map(([h, z]) => ({ y: roof.y + h, z })) : null }) : null;
      if (!done) notchDress(ladder);
      return done;
    });
  }

  // Overlook pass: the wooded summit east of the lip (rim boulders and tree trunks are colliders), and two rest ledges
  // on the line: let go with your feet at or just over one and you stand on it.
  let summit = null;
  const ledges = OVERLOOK ? LEDGES.map(([h, z]) => ({ y: roof.y + h, x0: 2.9, x1: 3.5, z0: z - 0.5, z1: z + 0.5 })) : [];
  if (OVERLOOK) {
    summit = createSummit({ group, rock: faceMat, deckY, assets });
    for (const t of summitTrees()) {
      const r = Math.max(0.16, t.trunk);
      colliders.push({ x0: t.x - r, x1: t.x + r, z0: t.z - r, z1: t.z + r, y0: deckY - 0.5, y1: deckY + 6, why: 'tree' });
    }
    // rim: a ring of colliders just inside every summit edge except the lip edge (x 3.42, where the nose joins too)
    for (let i = 0, j = SUMMIT.length - 1; i < SUMMIT.length; j = i, i += 1) {
      const [ax, az] = SUMMIT[j];
      const [bx, bz] = SUMMIT[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (ax < 3.5 && bx < 3.5) continue;
      const n = Math.max(1, Math.round(len / 0.7));
      for (let k = 0; k <= n; k += 1) {
        const px = ax + ((bx - ax) * k) / n;
        const pz = az + ((bz - az) * k) / n;
        if (px < 3.7) continue;
        const nx = (az - bz) / len; // inward normal (outline runs counter-clockwise in x/z)
        const nz = (bx - ax) / len;
        const cx = px + nx * 0.3;
        const cz = pz + nz * 0.3;
        colliders.push({ x0: cx - 0.3, x1: cx + 0.3, z0: cz - 0.3, z1: cz + 0.3, y0: deckY - 0.5, y1: deckY + 6, why: 'summit rim' });
      }
    }
  }
  const shoulder = OVERLOOK ? { x0: 1.55, x1: 2.95, z0: -2.85, z1: -0.85 } : { x0: 1.55, x1: 3.5, z0: -2.85, z1: -0.85 };
  function deckAt(x, z) {
    if (CRAG_ROCK && x > slot.x0 && x <= slot.x1 && z >= slot.z0 && z < slot.z1) {
      for (const l of ledges) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return l.y;
      return null;
    }
    for (const l of ledges) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return l.y;
    // (from x 3.38: the nose crown ends at x 3.4, and a 2 cm seam used to read as a drop)
    if (OVERLOOK && x >= 3.38 && inPoly(SUMMIT, Math.max(x, 3.43), z)) return deckY + summitRise(x, z);
    if (x >= shoulder.x0 && x <= shoulder.x1 && z >= shoulder.z0 && z <= shoulder.z1) return deckY;
    if (x < spine[0].x || x > spine[spine.length - 1].x) return null;
    let i = 1;
    while (i < spine.length && spine[i].x < x) i += 1;
    if (i >= spine.length) return null;
    const a = spine[i - 1];
    const b = spine[i];
    const t = (x - a.x) / (b.x - a.x);
    if (Math.abs(z) > a.hw + (b.hw - a.hw) * t) return null;
    return deckY;
  }

  // the bear's rock: nose crown, shoulder and (overlook pass) the flat arena/path/den on the summit, never a ledge
  const trunkGrid = new Map(); // 1 m cells -> trunks, so the bear's many ground tests stay cheap
  if (OVERLOOK) {
    for (const t of summitTrees()) {
      for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) {
        const k = `${Math.floor(t.x) + i},${Math.floor(t.z) + j}`;
        if (!trunkGrid.has(k)) trunkGrid.set(k, []);
        trunkGrid.get(k).push(t);
      }
    }
  }
  function bearDeckAt(x, z) {
    if (OVERLOOK && x >= 3.42) {
      if (!bearGround(x, z)) return null;
      for (const t of trunkGrid.get(`${Math.floor(x)},${Math.floor(z)}`) || []) if (Math.hypot(t.x - x, t.z - z) < 0.3) return null;
      return deckY;
    }
    if (x < 3.42 && x > 2.9 && z < -0.85) return null;
    const y = deckAt(x, z);
    return y === deckY ? y : null;
  }

  return { ladder, colliders, deckAt, bearDeckAt, deckY, dressing, summit, ledges, overlook: OVERLOOK };
}

// Tapered promontory. The crown is the walkable line; the sides and belly bulge past it, and the west end comes to a point.
function buildNose(spine, add, material) {
  const n = 8;
  const rings = spine.map((s, i) => {
    const wobble = (k) => Math.sin(i * 1.4 + k * 1.7) * 0.035 * Math.max(s.hw, 0.3);
    const hw = s.hw;
    const y = s.y;
    const drop = s.thick;
    return [
      [s.x, y, -hw * 0.55],
      [s.x + wobble(1), y - drop * 0.05, -hw],
      [s.x + wobble(2), y - drop * 0.42, -hw * 1.15],
      [s.x + wobble(3), y - drop, -hw * 0.2],
      [s.x + wobble(4), y - drop * 0.95, hw * 0.45],
      [s.x + wobble(5), y - drop * 0.38, hw * 1.12],
      [s.x + wobble(6), y - drop * 0.04, hw],
      [s.x, y, hw * 0.55],
    ];
  });
  const pos = [];
  rings.forEach((ring) => ring.forEach((p) => pos.push(p[0], p[1], p[2])));
  const idx = [];
  for (let i = 0; i < rings.length - 1; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      const c = (i + 1) * n + j;
      const d = (i + 1) * n + ((j + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  }
  const tip = spine[0];
  const tipAt = pos.length / 3;
  pos.push(tip.x - 0.7, tip.y - tip.thick * 0.3, 0);
  for (let j = 0; j < n; j += 1) idx.push(j, (j + 1) % n, tipAt);
  const root = spine[spine.length - 1];
  const rootAt = pos.length / 3;
  pos.push(root.x + 0.9, root.y - root.thick * 0.45, 0);
  const last = (rings.length - 1) * n;
  for (let j = 0; j < n; j += 1) idx.push(last + j, rootAt, last + ((j + 1) % n));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'pride_rock';
  add(mesh);
}
