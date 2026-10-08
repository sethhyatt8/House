// Overlook pass: the wooded summit behind the east crag overlook. It replaces the bare 1.6 m wall (the top of the crag
// boxes) that stood behind the overlook with nothing past it.
// - a rock massif under the summit outline (overlookshape.js): faceted walls that overhang the crag pillar and only
//   reach the ground east of x 11, so the cell gate and the clearing keep their trees
// - a cap: open rock behind the lip (the bear's arena), forest floor beyond, rising behind the den
// - pines and ground cover handed to forest.js (patchForest), so they share its instanced meshes and materials
import * as THREE from 'three';
import { applyWorldUv } from './uv.js';
import { patchForest, patchMaterial } from './forest.js';
import { SUMMIT, FOOT_X, inPoly, edgeDist, clampToPoly, summitRise, treeOk, inMassif, bearGround } from './overlookshape.js';

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Pines on the summit: a jittered 1.85 m grid, denser toward the edges and the back so every line of sight east ends
// in trunks, crowns or rising ground. Deterministic (crag.js turns the same list into trunk colliders).
let treeCache = null;
export function summitTrees(deckY = 0) {
  if (!treeCache) {
    treeCache = [];
    const step = 1.85;
    for (let x = 6.6; x <= 21; x += step) {
      for (let z = -9; z <= 8.6; z += step) {
        const px = x + (hash(x * 3.1, z * 1.3) - 0.5) * step * 0.8;
        const pz = z + (hash(z * 2.7, x * 0.9) - 0.5) * step * 0.8;
        if (!treeOk(px, pz)) continue;
        const rim = edgeDist(SUMMIT, px, pz) < 2.6 || px > 15;
        if (!rim && hash(px * 4.2, pz * 8.6) > 0.72) continue;
        const roll = hash(px * 1.7, pz * 3.3);
        treeCache.push({
          x: px,
          z: pz,
          h: (4.6 + roll * 3.2) * (1 + 0.25 * smooth(11, 19, px)),
          r: 0.85 + roll * 0.7,
          trunk: 0.22 + roll * 0.12,
          spin: roll * 6.2,
          band: 0,
        });
      }
    }
  }
  return treeCache.map((t) => ({ ...t, y: deckY + summitRise(t.x, t.z) }));
}

function summitCover(deckY, trees) {
  const out = [];
  const step = 1.05;
  for (let x = 3.8; x <= 21; x += step) {
    for (let z = -9; z <= 8.6; z += step) {
      const px = x + (hash(x * 3.3, z * 1.7) - 0.5) * step * 0.9;
      const pz = z + (hash(z * 2.9, x * 4.1) - 0.5) * step * 0.9;
      if (!inPoly(SUMMIT, px, pz) || edgeDist(SUMMIT, px, pz) < 0.35) continue;
      let trunk = 99;
      for (const t of trees) trunk = Math.min(trunk, Math.hypot(t.x - px, t.z - pz) - t.trunk * 0.6);
      if (trunk < 0.35) continue;
      const r = hash(px * 7.7, pz * 5.1);
      const open = bearGround(px, pz);
      // the arena stays mostly bare rock (a few stones and tufts at its edges); the woods get the full mix
      if (open && (px < 6.5 ? hash(pz, px) > 0.12 : hash(pz, px) > 0.3)) continue;
      if (!open && hash(pz * 1.3, px * 9.2) > 0.78) continue;
      let name;
      if (open) name = r < 0.4 ? 'rock_b' : r < 0.7 ? 'grass' : 'rock_a';
      else if (trunk < 1.2) name = r < 0.45 ? 'fern' : r < 0.75 ? 'groundleaf' : r < 0.85 ? 'mushroom' : r < 0.93 ? 'plant' : 'rock_a';
      else name = r < 0.28 ? 'fern' : r < 0.5 ? 'groundleaf' : r < 0.62 ? 'grass' : r < 0.74 ? 'plant' : r < 0.9 ? 'bush' : 'rock_a';
      out.push({ name, x: px, y: deckY + summitRise(px, pz) + 0.02, z: pz, seed: r * 97.3 });
    }
  }
  return out;
}

// outline resampled every `step` m, with outward normals; `lip` marks the climb edge (x 3.42)
function ring(step) {
  const pts = [];
  for (let i = 0; i < SUMMIT.length; i += 1) {
    const [ax, az] = SUMMIT[i];
    const [bx, bz] = SUMMIT[(i + 1) % SUMMIT.length];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k += 1) pts.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n });
  }
  pts.forEach((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[(i + 1) % pts.length];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    p.nx = tz / l; // outline is counter-clockwise (x right, z down): outward is (tz, -tx)
    p.nz = -tx / l;
    p.lip = p.x < 3.5;
  });
  return pts;
}

function buildMassif(rock, deckY) {
  const pts = ring(0.9);
  const n = pts.length;
  const pos = [];
  const col = [];
  // rim, bulge, four rough rings down the overhang, the foot of the overhang (12 m up, x >= FOOT_X), the ground
  const T = [0, 0.06, 0.25, 0.45, 0.65, 0.85, 1, 1.35];
  const rings = T.length;
  let arc = 0;
  pts.forEach((p, i) => {
    if (i) arc += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const w = (k) => (hash(i * 1.37 + k, k * 7.1) - 0.5);
    const pillar = p.x < 5.6 && p.z > -3.7 && p.z < 3.4;
    const top = deckY + summitRise(p.x, p.z) + 0.03;
    const yFoot = 12 + w(4) * 2;
    const footX = Math.max(p.x, FOOT_X + w(2) * 0.9);
    // ribs: buttresses every ~4 m along the outline
    const rib = 0.9 * Math.max(0, Math.sin(arc * 1.55 + w(9) * 1.5)) ** 2;
    T.forEach((t, j) => {
      let x;
      let y;
      let z;
      if (j === 0) {
        x = p.lip ? 3.5 : p.x;
        y = top;
        z = p.z;
      } else if (p.lip && j <= 2) {
        // under the climb lip the band tucks back into the crag pillar, behind the face skin
        x = 3.5 + 0.5 * j;
        y = deckY - 0.6 * j;
        z = p.z;
      } else if (t <= 1) {
        const k = (t - 0.06) / 0.94;
        const bulge = pillar ? 0 : (j === 1 ? 0.4 : 0.3 + rib) + w(10 + j) * 0.7;
        const bx = p.lip ? 4.6 : p.x;
        x = bx + (footX - bx) * k + p.nx * bulge;
        z = p.z + p.nz * bulge;
        y = deckY - 1.5 + (yFoot - deckY + 1.5) * k + (j > 1 && j < rings - 2 ? w(20 + j) * 1.6 : 0);
        if (j === 1) y = deckY - 1.5 + w(5) * 0.4;
      } else {
        const out = 0.2 + rib + w(30) * 0.8;
        x = footX + p.nx * out;
        z = p.z + p.nz * out;
        y = -0.6;
      }
      pos.push(x, y, z);
      const v = (0.6 + 0.4 * Math.max(0, y) / deckY) * (0.88 + 0.24 * hash(i, j));
      col.push(v, v * 0.98, v * 0.95);
    });
  });
  const index = [];
  for (let i = 0; i < n; i += 1) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < rings - 1; j += 1) {
      const a = i * rings + j;
      const b = i2 * rings + j;
      const c = i * rings + j + 1;
      const d = i2 * rings + j + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  const mat = rock.clone();
  mat.vertexColors = true;
  mat.flatShading = true;
  mat.name = 'summit_wall';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'summit_massif';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  applyWorldUv(mesh, 2.6);
  return { mesh, tris: geo.attributes.position.count / 3 };
}

// Cap: a grid shrink-wrapped onto the outline (outside points slide to the nearest edge point). Triangles behind the
// lip are rock (the arena), the rest forest floor.
function buildCap(rock, floorMat, deckY) {
  const x0 = 3.42;
  const x1 = 21.1;
  const z0 = -9.1;
  const z1 = 8.7;
  const nx = 24;
  const nz = 24;
  const pos = [];
  const uv = [];
  const col = [];
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      let x = x0 + ((x1 - x0) * i) / nx;
      let z = z0 + ((z1 - z0) * j) / nz;
      [x, z] = clampToPoly(SUMMIT, x, z);
      const y = deckY + summitRise(x, z) + 0.03;
      pos.push(x, y, z);
      uv.push(x / 3.2, z / 3.2);
      const e = Math.min(1, Math.max(0, edgeDist(SUMMIT, x, z)) / 1.5);
      const v = (0.55 + 0.45 * e) * (0.9 + 0.2 * hash(x * 2.1, z * 1.7));
      col.push(v, v, v * 0.97);
    }
  }
  const rockIdx = [];
  const soilIdx = [];
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      const cx = (pos[a * 3] + pos[d * 3]) / 2;
      const cz = (pos[a * 3 + 2] + pos[d * 3 + 2]) / 2;
      const list = cx + (hash(cz * 0.7, 3.3) - 0.5) * 1.6 < 7.2 ? rockIdx : soilIdx;
      list.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex([...rockIdx, ...soilIdx]);
  geo.addGroup(0, rockIdx.length, 0);
  geo.addGroup(rockIdx.length, soilIdx.length, 1);
  geo.computeVertexNormals();
  const rockMat = rock.clone();
  rockMat.vertexColors = true;
  rockMat.name = 'summit_rock';
  const mesh = new THREE.Mesh(geo, [rockMat, floorMat]);
  mesh.name = 'summit_cap';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, tris: (rockIdx.length + soilIdx.length) / 3 };
}

export function createSummit({ group, rock, deckY, assets }) {
  const summit = new THREE.Group();
  summit.name = 'overlook_summit';
  group.add(summit);
  const kit = assets?.gltf?.('forest_kit')?.scene || null;
  const map = kit?.getObjectByName('forest_floor')?.material?.map || null;
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
  }
  const floorMat = patchMaterial(new THREE.MeshStandardMaterial({
    color: map ? 0x7d8274 : 0x1a261e, map, roughness: 1, metalness: 0, vertexColors: true,
  }), { kind: 'ground' });
  floorMat.name = 'SummitFloor';
  const massif = buildMassif(rock, deckY);
  const cap = buildCap(rock, floorMat, deckY);
  summit.add(massif.mesh, cap.mesh);
  const trees = summitTrees(deckY);
  const cover = summitCover(deckY, trees);
  patchForest({ trees, cover, exclude: (x, z) => inMassif(x, z, 0.5) });
  return { group: summit, stats: { massifTris: massif.tris, capTris: cap.tris, trees: trees.length, cover: cover.length } };
}
