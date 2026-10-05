// Inland cliff on the east edge of the roof (the side away from the water). The face is a stack of
// offset rock, climbed by grabbing the lips and knobs. The top is a nose pointing west, out over the sea.
import * as THREE from 'three';
import { proxyMaterial } from './assets.js';
import { applyWorldUv } from './uv.js';

// Body stands at FACE_X - 0.42 (main.js). The solid rock starts east of that.
const FACE_X = 3.52;

export function createBackCrag({ scene, targets, rock, roof }) {
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

  function knob(radius, x, y, z, rot) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), faceMat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    return add(mesh);
  }

  // Offset masses so the west face is a broken cliff, not one plane. West edges sit near x 3.4.
  const masses = [
    [1.45, 9.2, 2.05, 4.22, 7.5, -2.2, 0.04, 0.22, -0.05],
    [1.2, 8.4, 1.55, 4.02, 7.05, -0.2, -0.03, -0.4, 0.07],
    [1.6, 9.6, 2.2, 4.35, 7.65, 1.9, 0.05, 0.18, 0.04],
    [0.85, 3.8, 1.05, 3.9, 5.05, -1.2, 0.12, 0.55, -0.06],
    [0.75, 3.2, 0.9, 3.82, 8.7, 0.9, -0.1, 0.35, 0.06],
    [1.15, 2.6, 6.7, 4.6, 11.7, 0.05, 0.02, 0.08, 0],
    [1.35, 3.1, 2.7, 4.2, 12.05, 0, 0.03, 0.06, 0],
    [0.7, 5.5, 0.55, 3.95, 6.4, 2.7, 0.2, -0.3, 0.15],
    [0.6, 4.2, 0.5, 3.88, 8.2, -2.85, -0.15, 0.4, -0.1],
  ];
  for (const [w, h, d, x, y, z, rx, ry, rz] of masses) box(w, h, d, x, y, z, faceMat, [rx, ry, rz]);

  // Broken curb along the roof edge so the cliff meets the roof.
  [[3.15, 0.55, -2.4], [2.6, 0.7, -0.7], [2.9, 0.48, 1.1], [2.2, 0.62, 2.55]].forEach(([d, h, z]) => {
    box(0.42, h, d, 3.4, roof.y + h / 2, z, faceMat, [0, (z % 1) * 0.2, 0]);
  });

  // Knobs buried in the face so only the west side sticks out.
  [
    [3.72, 4.7, -1.55, 0.32, 0.4, 0.2, 1.1],
    [3.68, 6.3, 1.55, 0.36, 0.8, 1.4, 0.3],
    [3.74, 7.6, -0.7, 0.28, 1.2, 0.5, 0.7],
    [3.7, 9.05, 1.85, 0.34, 0.3, 2.1, 0.6],
    [3.78, 5.55, 2.35, 0.4, 0.6, 0.9, 1.3],
  ].forEach(([x, y, z, r, rx, ry, rz]) => knob(r, x, y, z, [rx, ry, rz]));

  // One tapering nose, high at the point over the water. hw is the walkable half-width.
  const spine = [
    { x: -2.7, y: 11.86, hw: 0.48, thick: 0.55 },
    { x: -2.1, y: 11.72, hw: 0.55, thick: 0.66 },
    { x: -1.55, y: 11.55, hw: 0.62, thick: 0.78 },
    { x: -0.9, y: 11.4, hw: 0.7, thick: 0.88 },
    { x: -0.35, y: 11.28, hw: 0.78, thick: 1.0 },
    { x: 0.28, y: 11.14, hw: 0.86, thick: 1.1 },
    { x: 0.9, y: 11.02, hw: 0.95, thick: 1.2 },
    { x: 1.5, y: 10.9, hw: 1.04, thick: 1.3 },
    { x: 2.05, y: 10.8, hw: 1.12, thick: 1.4 },
    { x: 2.75, y: 10.7, hw: 1.18, thick: 1.5 },
    { x: 3.4, y: 10.64, hw: 1.22, thick: 1.6 },
  ];
  buildNose(spine, add, faceMat);
  knob(0.55, 0.7, 9.7, -0.1, [0.7, 0.3, 0.9]);
  knob(0.4, -0.8, 10.35, 0.25, [1.0, 0.4, 0.2]);
  knob(0.28, 1.85, 10.95, 0.95, [0.4, 0.7, 0.3]);
  knob(0.24, 0.15, 11.2, -0.82, [0.8, 0.2, 1.1]);

  const colliders = [
    { x0: 3.46, x1: 5.4, z0: -3.62, z1: -0.4, y0: 3.02, y1: 12.7, why: 'back cliff' },
    { x0: 3.46, x1: 5.55, z0: 0.36, z1: 3.62, y0: 3.02, y1: 12.9, why: 'back cliff' },
    { x0: 3.46, x1: 4.9, z0: -0.72, z1: 0.64, y0: 3.02, y1: 13.1, why: 'back cliff' },
    { x0: 1.55, x1: 2.15, z0: 0.7, z1: 1.25, y0: 10.8, y1: 11.4, why: 'crag' },
    { x0: -0.15, x1: 0.45, z0: -1.15, z1: -0.58, y0: 11.15, y1: 11.7, why: 'crag' },
  ];

  // y, z, width, depth, thickness. The line wanders, and a few holds are real protruding crags.
  const holds = [
    [3.95, 0.12, 0.32, 0.2, 0.11],
    [4.36, 0.32, 0.22, 0.14, 0.09],
    [4.74, 0.08, 0.4, 0.24, 0.14],
    [5.18, -0.14, 0.24, 0.15, 0.1],
    [5.56, 0.1, 0.3, 0.18, 0.11],
    [6.02, 0.28, 0.5, 0.28, 0.16],
    [6.44, 0.06, 0.22, 0.14, 0.09],
    [6.86, -0.16, 0.36, 0.2, 0.12],
    [7.3, 0.08, 0.26, 0.16, 0.1],
    [7.72, 0.26, 0.46, 0.26, 0.15],
    [8.16, 0.04, 0.2, 0.13, 0.09],
    [8.58, -0.12, 0.38, 0.22, 0.13],
    [9.02, 0.1, 0.48, 0.28, 0.16],
    [9.44, -0.06, 0.24, 0.15, 0.1],
    [9.84, 0.14, 0.34, 0.2, 0.12],
    [10.26, 0.0, 0.46, 0.26, 0.15],
  ];

  const ladder = new THREE.Group();
  ladder.position.set(FACE_X, 0, 0);
  const rungs = [];
  holds.forEach(([y, z, w, depth, thick], index) => {
    const bury = 0.34 + depth;
    const tall = 0.12 + thick;
    const tip = 3.16;
    box(bury, tall, w, tip + bury / 2, y, z, faceMat, [0.02, (index % 2) * 0.1, -0.03]);
    if (w >= 0.4) knob(tall * 0.7, tip + 0.08, y + tall * 0.15, z, [0.4, index * 0.3, 0.6]);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, Math.max(0.24, w)), proxyMaterial);
    grip.position.set(tip - FACE_X, y + tall * 0.25, z);
    grip.userData = { type: 'rung', ladder, index };
    ladder.add(grip);
    rungs.push(y);
  });

  function zAt(y) {
    if (y <= holds[0][0]) return holds[0][1];
    for (let i = 1; i < holds.length; i += 1) {
      if (y <= holds[i][0]) {
        const span = holds[i][0] - holds[i - 1][0];
        const t = span > 0 ? (y - holds[i - 1][0]) / span : 0;
        return holds[i - 1][1] + t * (holds[i][1] - holds[i - 1][1]);
      }
    }
    return holds[holds.length - 1][1];
  }

  const zs = holds.map((hold) => hold[1]);
  ladder.userData = {
    rungs,
    crag: true,
    roofY: 10.8,
    shaft: { top: 10.5, base: roof.y },
    path: { zBase: Math.min(...zs), zTop: Math.max(...zs) },
    zAt,
    topSpot: { x: 2.05, y: 10.8, z: 0.02 },
    baseSpot: { x: 2.35, y: roof.y, z: 0.4 },
    topStatus: 'On the rock above the house. The point looks out over the water.',
    baseStatus: 'Back on the roof.',
  };
  scene.add(ladder);
  targets.push(ladder);

  function deckAt(x, z) {
    if (x < spine[0].x || x > spine[spine.length - 1].x) return null;
    let i = 1;
    while (i < spine.length && spine[i].x < x) i += 1;
    if (i >= spine.length) return null;
    const a = spine[i - 1];
    const b = spine[i];
    const t = (x - a.x) / (b.x - a.x);
    if (Math.abs(z) > a.hw + (b.hw - a.hw) * t) return null;
    return a.y + (b.y - a.y) * t;
  }

  return { ladder, colliders, deckAt };
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
