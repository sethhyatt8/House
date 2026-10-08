// Inland cliff on the east edge of the roof. The climb is the same notch hardware as the cave route,
// on the north side of the face. The nose is a level overhang pointing west, out over the sea.
import * as THREE from 'three';
import { notchClimb, notchDress } from './notches.js';
import { applyWorldUv } from './uv.js';
import { legacy } from './flags.js';
import { dressCrag, faceSkin } from './cragrock.js';

// Clubs/cliff pass: rock holds on a displaced rock skin (cragrock.js). ?legacy=crag keeps the cut notch line.
export const CRAG_ROCK = !legacy('crag');

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
  const wallH = deckY - roof.y + 1.6;
  const wallY = roof.y + wallH / 2;
  // West edges sit near x 3.5. No ledges to walk up.
  box(1.7, wallH, 2.5, 4.35, wallY, -2.15);
  box(1.85, wallH, 3.3, 4.48, wallY + 0.15, 1.35);
  box(1.35, 2.4, 2.5, 4.22, deckY + 0.35, 0.05);

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
  const slot = { x0: 2.95, x1: 3.5, z0: -2.85, z1: -2.0 };
  if (CRAG_ROCK) {
    box(1.4, 0.55, 2.0, 2.25, deckY - 0.275, -1.85);
    box(0.5, 0.55, 1.15, 3.2, deckY - 0.275, -1.425);
  } else box(1.9, 0.55, 2.0, 2.5, deckY - 0.275, -1.85);

  const faceX0 = CRAG_ROCK ? 3.42 : 3.5; // the rock skin stands up to 8 cm proud of the boxes at walking height
  const colliders = [
    { x0: faceX0, x1: 5.4, z0: -3.5, z1: -0.85, y0: roof.y - 0.2, y1: deckY + 2.2, why: 'back cliff' },
    { x0: faceX0, x1: 5.6, z0: 0.4, z1: 3.2, y0: roof.y - 0.2, y1: deckY + 2.2, why: 'back cliff' },
    { x0: faceX0, x1: 5.1, z0: -0.95, z1: 0.7, y0: roof.y - 0.2, y1: deckY + 1.6, why: 'back cliff' },
  ];
  if (CRAG_ROCK) colliders.push({ ...slot, y0: deckY - 0.3, y1: deckY + 1.8, why: 'cliff edge' });

  // Notch line on the north side of the face, beside the nose, not up through it.
  // Rock mode: holds every 0.28 m (was 0.23), alternating 15 cm either side with a little jitter.
  const y0 = roof.y + 0.95;
  const y1 = deckY - 0.45;
  const zLine = (y) => -2.05 + ((y - y0) / (y1 - y0)) * -0.4;
  const holds = [];
  if (CRAG_ROCK) {
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
      path: { zBase: -2.7, zTop: -1.7 },
      zAt: zLine,
      topSpot: { x: 2.45, y: deckY, z: -2.15 },
      baseSpot: { x: 2.5, y: roof.y, z: -2.05 },
      topStatus: 'On the shoulder beside the point.',
      baseStatus: 'Back on the roof.',
    },
  });

  let dressing = null;
  if (CRAG_ROCK) {
    group.add(faceSkin({ material: faceMat, roofY: roof.y, deckY, zLine, lineY0: y0, lineY1: y1 }));
    // the scanned holds stream in after boot (crag_kit is a deferred model); the cut notches are the fallback
    const kitReady = assets?.enabled ? assets.whenReady('crag_kit') : Promise.resolve(null);
    dressing = kitReady.then((kit) => {
      const done = kit ? dressCrag({ group, kit, ladder, roofY: roof.y, deckY, zLine }) : null;
      if (!done) notchDress(ladder);
      return done;
    });
  }

  const shoulder = { x0: 1.55, x1: 3.5, z0: -2.85, z1: -0.85 };
  function deckAt(x, z) {
    if (CRAG_ROCK && x > slot.x0 && x <= slot.x1 && z >= slot.z0 && z < slot.z1) return null;
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

  return { ladder, colliders, deckAt, deckY, dressing };
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
