// Clubs/cliff pass: the east crag as rock instead of boxes and cut notches.
// - faceSkin(): one displaced grid wrapped over the west face and both flanks of the crag boxes (bulges, strata
//   bands, vertical cracks, baked vertex AO), kept flat in a corridor along the climb line, at walking height on the
//   roof and around the shoulder/nose so it never pokes into the player.
// - dressCrag(): decimated Poly Haven scans (models/nature/crag_kit.glb, CC0) placed on the existing grab proxies
//   (holds) plus a few rest ledges and big crags, merged into a handful of meshes.
// ?legacy=crag restores the notch line (see crag.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * vnoise(x * f + i * 17.3, y * f - i * 9.1);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Plan-view outline of the crag boxes (north flank -> west face -> south flank), resampled every `step` metres.
function outline(points, step) {
  const out = [];
  let s = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k += 1) {
      const t = k / n;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: s + len * t });
    }
    s += len;
  }
  out.forEach((p, i) => {
    const a = out[Math.max(0, i - 1)];
    const b = out[Math.min(out.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    p.nx = -tz / l;
    p.nz = tx / l;
  });
  return out;
}

export function faceSkin({ material, roofY, deckY, zLine, lineY0, lineY1, tile = 2.42, step = 0.3 }) {
  const cols = outline([[5.1, -3.42], [3.62, -3.42], [3.5, -3.3], [3.5, 2.9], [3.62, 3.02], [5.3, 3.02]], step);
  const yBot = roofY - 0.3;
  const yTop = deckY + 1.62;
  const rows = Math.ceil((yTop - yBot) / step);
  const nc = cols.length;
  const nr = rows + 2; // + the cap row folding back into the boxes
  const pos = new Float32Array(nc * nr * 3);
  const uv = new Float32Array(nc * nr * 2);
  const col = new Float32Array(nc * nr * 3);
  const disp = new Float32Array(nc * nr);
  for (let j = 0; j < nr; j += 1) {
    const cap = j === nr - 1;
    const y = cap ? yTop + 0.02 : yBot + (j / rows) * (yTop - yBot);
    for (let i = 0; i < nc; i += 1) {
      const c = cols[i];
      const big = fbm(c.s * 0.42, y * 0.2, 3);
      const band = y * 0.58 + (vnoise(c.s * 0.3, y * 0.04) - 0.5) * 1.2;
      const f = band - Math.floor(band);
      const strata = f * f;
      const hf = fbm(c.s * 1.6 + 40, y * 1.4, 2);
      const crack = (1 - Math.abs(vnoise(c.s * 0.9 + 7, y * 0.06) * 2 - 1)) ** 6;
      let d = clamp(0.02 + 0.24 * big + 0.1 * strata * (0.5 + big) + 0.05 * hf - 0.08 * crack, 0, 0.42);
      const west = -c.nx > 0.7;
      let base = 0.04;
      if (west && y > lineY0 - 1.5 && y < deckY + 0.4) {
        const dz = Math.abs(c.z - zLine(clamp(y, lineY0, lineY1)));
        const w = smooth(0.4, 1.05, dz);
        d = d * w + (1 - w) * (0.004 + 0.012 * hf);
        base = 0.025 + 0.015 * w;
      }
      // walking height on the roof, and the shoulder / nose root up top: stay close to the boxes
      d = Math.min(d, 0.04 + Math.max(0, y - roofY - 1.9) * 0.5);
      if (c.z < 1.5) d = Math.min(d, 0.05 + Math.max(0, deckY - 0.6 - y) * 0.6);
      if (cap) d = -0.45;
      const off = base + d;
      const k = (j * nc + i) * 3;
      pos[k] = c.x + c.nx * off;
      pos[k + 1] = y;
      pos[k + 2] = c.z + c.nz * off;
      uv[(j * nc + i) * 2] = c.s / tile;
      uv[(j * nc + i) * 2 + 1] = (cap ? y + 0.47 : y) / tile;
      disp[j * nc + i] = d;
      const streak = 0.9 + 0.16 * vnoise(c.s * 2.2, y * 0.07);
      const warm = vnoise(c.s * 0.2 + 3, band * 0.9) - 0.5;
      col[k] = streak * (1 + warm * 0.12);
      col[k + 1] = streak;
      col[k + 2] = streak * (1 - warm * 0.1);
    }
  }
  // cavity AO: recessed against the neighbours -> darker, proud -> lighter
  for (let j = 0; j < nr; j += 1) {
    for (let i = 0; i < nc; i += 1) {
      let sum = 0;
      let n = 0;
      for (let dj = -2; dj <= 2; dj += 1) {
        for (let di = -2; di <= 2; di += 1) {
          const jj = j + dj;
          const ii = i + di;
          if (jj < 0 || jj >= nr - 1 || ii < 0 || ii >= nc) continue;
          sum += disp[jj * nc + ii];
          n += 1;
        }
      }
      const rel = j === nr - 1 ? 0 : disp[j * nc + i] - sum / Math.max(1, n);
      const ao = 0.8 + 0.32 * clamp(rel / 0.1, -1, 1) * 0.5 + 0.06;
      const k = (j * nc + i) * 3;
      col[k] *= ao;
      col[k + 1] *= ao;
      col[k + 2] *= ao;
    }
  }
  const index = [];
  for (let j = 0; j < nr - 1; j += 1) {
    for (let i = 0; i < nc - 1; i += 1) {
      const a = j * nc + i;
      const b = a + 1;
      const c = a + nc;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const skinMat = material.clone();
  skinMat.vertexColors = true;
  skinMat.name = 'crag_skin';
  const mesh = new THREE.Mesh(geo, skinMat);
  mesh.name = 'crag_skin';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

const HOLDS = ['hold_a', 'hold_b', 'hold_c', 'hold_d', 'hold_e', 'hold_f'];

function kitParts(kit) {
  const parts = {};
  let material = null;
  kit.scene.updateMatrixWorld(true);
  kit.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    }
    parts[o.name] = g;
    material = material || o.material;
  });
  return { parts, material };
}

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const mat4 = new THREE.Matrix4();
const one = new THREE.Vector3();
const zero = new THREE.Vector3();

// Place one kit piece: rotate/scale, then put its outermost (west) point at tipX, its top at `top` (or its base
// at `base`) and centre it on z. `backX`: stretch the piece east so it reaches at least that far (buried in the wall).
function place(src, { rot, scale, tipX, top = null, base = null, z, backX = null }) {
  const g = src.clone();
  euler.set(rot[0], rot[1], rot[2]);
  mat4.compose(zero, quat.setFromEuler(euler), one.setScalar(scale));
  g.applyMatrix4(mat4);
  g.computeBoundingBox();
  let bb = g.boundingBox;
  const depth = bb.max.x - bb.min.x;
  if (backX != null && tipX + depth < backX) {
    mat4.makeScale((backX - tipX) / depth, 1, 1);
    g.applyMatrix4(mat4);
    g.computeBoundingBox();
    bb = g.boundingBox;
  }
  const dy = top != null ? top - bb.max.y : base - bb.min.y;
  g.translate(tipX - bb.min.x, dy, z - (bb.min.z + bb.max.z) / 2);
  return g;
}

export function dressCrag({ group, kit, ladder, roofY, deckY, zLine, faceX = 3.5, chunk = 26 }) {
  const { parts, material } = kitParts(kit);
  if (!HOLDS.every((h) => parts[h]) || !material) return null;
  material.vertexColors = true;
  const meshes = [];
  const flush = (list, name) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
    list.forEach((g) => g.dispose());
    list.length = 0;
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    group.add(mesh);
    meshes.push(mesh);
  };
  // holds: one rock per grab proxy, its top edge 2.5 cm over the proxy centre, about 12 cm proud of the face
  const holds = ladder.userData.holds;
  let batch = [];
  holds.forEach(({ y, z }, i) => {
    const r = (k) => hash(i * 3.7 + k, y * 1.3) - 0.5;
    const variant = HOLDS[Math.floor(hash(i * 1.91, 4.2) * HOLDS.length) % HOLDS.length];
    batch.push(place(parts[variant], {
      rot: [r(1) * 0.7, r(2) * 0.4, r(3) * 0.25],
      scale: 1.0 + (r(4) + 0.5) * 0.3,
      tipX: faceX - 0.13 + r(5) * 0.03,
      top: y + 0.025,
      z,
      backX: faceX + 0.04,
    }));
    if (batch.length >= chunk) flush(batch, `crag_holds_${meshes.length}`);
  });
  flush(batch, `crag_holds_${meshes.length}`);
  // rest ledges beside the line and big crags off it: [piece, z (or line offset), height over the roof, scale, yaw, proud]
  const big = [];
  [7.0, 13.6, 20.2, 26.4].forEach((h, k) => {
    const y = roofY + h;
    big.push(place(parts.ledge_a, {
      rot: [0, (k % 2 ? 0.25 : -0.25), 0.05],
      scale: 0.55,
      tipX: faceX - 0.2,
      top: y,
      z: zLine(y) + (k % 2 ? 0.85 : -0.85),
      backX: faceX + 0.1,
    }));
  });
  const CRAGS = [
    ['crag_b', 0.6, 3.4, 0.7, 0.1, 0.12],
    ['crag_a', 1.8, 6.0, 1.15, 0.3, 0.34],
    ['crag_b', 0.5, 9.5, 1.0, -0.4, 0.3],
    ['crag_b', -3.25, 12.0, 0.6, 0.9, 0.22],
    ['crag_b', 2.3, 14.5, 0.9, 0.2, 0.3],
    ['crag_a', 0.9, 19.0, 1.0, -0.2, 0.32],
    ['crag_b', -0.4, 23.5, 0.8, 0.5, 0.28],
    ['crag_a', 2.0, 25.5, 1.1, 0.4, 0.3],
  ];
  CRAGS.forEach(([piece, z, h, scale, yaw, proud]) => {
    big.push(place(parts[piece], { rot: [0, yaw, 0], scale, tipX: faceX - 0.04 - proud, base: roofY + h, z, backX: faceX + 0.3 }));
  });
  flush(big, 'crag_rocks');
  let tris = 0;
  meshes.forEach((m) => { tris += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3; });
  return { meshes, tris };
}
