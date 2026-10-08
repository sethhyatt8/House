import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Swim/boat/reef pass: procedural reef kit. Every piece is built once at boot from a few primitives (no downloads,
// no textures), base at the origin, +Y up, roughly 1 m across/tall, with GREY vertex colours that only carry shading
// (grooves, darker bases, paler tips). The hue comes from the instance colour, picked from a muted natural palette.
// Triangle counts are kept low (36-170) so ~1,500 instances stay inside the Quest budget with distance culling.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function shade(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const raw = fn(v, i);
    const g = Number.isFinite(raw) ? THREE.MathUtils.clamp(raw, 0, 1.2) : 0.6;
    col[i * 3] = g; col[i * 3 + 1] = g; col[i * 3 + 2] = g;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function clean(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}

// brain coral: low dome with meandering grooves (shading + a little relief)
function brain(seed) {
  const r = rng(seed);
  const geo = new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const ph = r() * 6;
  const groove = (x, z, y) => Math.sin(x * 19 + Math.sin(z * 13 + ph) * 2.2) * Math.cos(z * 17 + Math.sin(x * 11 - ph) * 2.0 + y * 6);
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const g = groove(v.x, v.z, v.y);
    const k = 1 + 0.035 * g + (r() - 0.5) * 0.03;
    v.multiplyScalar(k);
    v.y = (v.y - 0.06) * 0.72;
    pos.setXYZ(i, v.x * (1 + 0.12 * Math.sin(ph + v.z * 3)), Math.max(v.y, -0.02), v.z);
  }
  geo.computeVertexNormals();
  const out = clean(geo);
  out.computeVertexNormals();
  return shade(out, (p) => 0.62 + 0.28 * Math.max(0, groove(p.x, p.z, p.y)) + p.y * 0.5);
}

// branching (staghorn / acropora): a few levels of tapered pentagonal branches, pale tips
function branching(seed, { spread = 0.75, levels = 2 } = {}) {
  const r = rng(seed);
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  function limb(from, dir, len, rad, lvl) {
    const geo = new THREE.CylinderGeometry(rad * 0.62, rad, len, 4, 1, true);
    geo.translate(0, len / 2, 0);
    q.setFromUnitVectors(up, dir);
    geo.applyQuaternion(q);
    geo.translate(from.x, from.y, from.z);
    parts.push(clean(geo));
    if (lvl >= levels) return;
    const tip = from.clone().addScaledVector(dir, len);
    const n = lvl === 0 ? 4 : 2;
    for (let i = 0; i < n; i += 1) {
      const a = r() * Math.PI * 2;
      const d = dir.clone().add(new THREE.Vector3(Math.cos(a) * spread, 0.25 + r() * 0.3, Math.sin(a) * spread)).normalize();
      limb(tip, d, len * (0.62 + r() * 0.2), rad * 0.66, lvl + 1);
    }
  }
  limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2).normalize(), 0.36, 0.055, 0);
  const geo = mergeGeometries(parts);
  geo.computeBoundingBox();
  const top = geo.boundingBox.max.y;
  return shade(geo, (p) => 0.5 + 0.6 * Math.max(0, p.y / top) ** 1.5);
}

// table coral: an irregular flat plate on a short stalk
function table(seed) {
  const r = rng(seed);
  const plate = new THREE.CylinderGeometry(0.5, 0.42, 0.05, 11, 1);
  const pos = plate.attributes.position;
  const v = new THREE.Vector3();
  const ph = r() * 6;
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const rr = 1 + 0.12 * Math.sin(a * 3 + ph) + 0.06 * Math.sin(a * 7 - ph);
    pos.setXYZ(i, v.x * rr, v.y + 0.03 * Math.sin(a * 2 + ph) + Math.hypot(v.x, v.z) * 0.12, v.z * rr);
  }
  plate.translate(0, 0.3, 0);
  const stalk = new THREE.CylinderGeometry(0.05, 0.09, 0.3, 6, 1, true);
  stalk.translate(0, 0.15, 0);
  const geo = mergeGeometries([clean(plate), clean(stalk)]);
  geo.computeVertexNormals();
  return shade(geo, (p) => (p.y > 0.31 ? 0.78 : p.y > 0.28 ? 0.5 : 0.45 + p.y));
}

// sea fan (gorgonian): a lobed flat fan, both faces, on a short stem; vein shading
function fan(seed) {
  const r = rng(seed);
  const shape = new THREE.Shape();
  const n = 9;
  shape.moveTo(-0.03, 0);
  for (let i = 0; i <= n; i += 1) {
    const a = Math.PI * (0.12 + 0.76 * (i / n));
    const rad = 0.5 * (0.82 + 0.25 * r());
    shape.lineTo(-Math.cos(a) * rad * 0.9, 0.08 + Math.sin(a) * rad);
  }
  shape.lineTo(0.03, 0);
  const front = new THREE.ShapeGeometry(shape, 2);
  const back = front.clone();
  const idx = back.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  back.translate(0, 0, -0.004);
  const geo = mergeGeometries([clean(front), clean(back)]);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) pos.setZ(i, pos.getZ(i) + 0.06 * Math.sin(pos.getX(i) * 5) * pos.getY(i));
  geo.computeVertexNormals();
  return shade(geo, (p) => 0.6 + 0.35 * Math.abs(Math.sin(Math.atan2(p.y, p.x) * 11)) * Math.min(1, p.y * 3));
}

// soft coral (finger / leather): a cluster of leaning tapered fingers
function soft(seed) {
  const r = rng(seed);
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const n = 5 + Math.floor(r() * 2);
  for (let i = 0; i < n; i += 1) {
    const h = 0.32 + r() * 0.35;
    const geo = new THREE.CylinderGeometry(0.018, 0.055, h, 4, 2, true);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k += 1) { const y = pos.getY(k) + h / 2; pos.setX(k, pos.getX(k) + 0.06 * Math.sin(y * 7 + i)); }
    geo.translate(0, h / 2, 0);
    const a = (i / n) * Math.PI * 2 + r();
    q.setFromUnitVectors(up, new THREE.Vector3(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45).normalize());
    geo.applyQuaternion(q);
    geo.translate(Math.cos(a) * 0.06, -0.02, Math.sin(a) * 0.06);
    parts.push(clean(geo));
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return shade(geo, (p) => 0.55 + 0.7 * p.y);
}

// barrel sponge: a thick-walled open vase (lathe out and back in), dark inside
function barrel(seed) {
  const r = rng(seed);
  const w = 0.04;
  const prof = [[0.2, 0], [0.26, 0.12], [0.3, 0.3], [0.33, 0.5], [0.33 - w, 0.52], [0.3 - w, 0.33], [0.24 - w, 0.15], [0.1, 0.06]];
  const pts = prof.map(([x, y]) => new THREE.Vector2(x * (0.9 + r() * 0.2), y));
  const geo = clean(new THREE.LatheGeometry(pts, 7));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); const k = 1 + 0.07 * Math.sin(a * 5 + pos.getY(i) * 9); pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
  geo.computeVertexNormals();
  return shade(geo, (p) => { const rad = Math.hypot(p.x, p.z); return p.y > 0.49 ? 0.75 : (rad < 0.27 && p.y > 0.1 ? 0.28 : 0.6 + p.y * 0.5); });
}

// tube sponges: 3-4 upright tubes, dark mouths
function tubes(seed) {
  const r = rng(seed);
  const parts = [];
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i += 1) {
    const h = 0.25 + r() * 0.35;
    const rad = 0.045 + r() * 0.03;
    const outer = new THREE.CylinderGeometry(rad, rad * 0.85, h, 7, 1, true);
    outer.translate(0, h / 2, 0);
    const mouth = new THREE.CircleGeometry(rad * 0.98, 7);
    mouth.rotateX(-Math.PI / 2);
    mouth.translate(0, h - 0.025, 0);
    const a = (i / n) * Math.PI * 2 + r();
    const off = new THREE.Vector3(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
    for (const g of [outer, mouth]) { g.rotateZ(Math.cos(a) * 0.12); g.rotateX(Math.sin(a) * 0.12); g.translate(off.x, -0.02, off.z); parts.push(clean(g)); }
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return shade(geo, (p, i) => 0.55 + p.y * 0.8);
}

// rubble: dead coral chunks / stones
function rubble(seed) {
  const r = rng(seed);
  const geo = clean(new THREE.DodecahedronGeometry(0.5, 0));
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i += 1) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, 0.75 + r() * 0.45);
    const k = map.get(key);
    pos.setXYZ(i, pos.getX(i) * k * 1.3, Math.max(-0.05, pos.getY(i) * k * 0.55), pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return shade(geo, (p) => 0.5 + p.y * 0.7);
}

// palette (sRGB): ochres, dusty pinks, olive, brown, pale purple, bleached white accents
export const PALETTE = {
  ochre: 0xa07c42, tan: 0xa49170, sand: 0xae9f80, bleach: 0xcdc6b4, bone: 0xbab09a,
  pink: 0xb48782, rose: 0x9e6f6c, mauve: 0x8f7a8e, lilac: 0x878296, olive: 0x7b7c4c,
  sage: 0x879177, brown: 0x765843, rust: 0x93603f, maroon: 0x6b4446, slate: 0x7a8288,
};
const pal = (...names) => names.map((n) => new THREE.Color(PALETTE[n]));

// kit: name -> { geo, colors, size: [min, max] scale, w: weight, cull: base cull distance (m) }
export function buildReefKit() {
  const kit = [
    { name: 'brain', geos: [brain(3)], colors: pal('ochre', 'tan', 'olive', 'brown', 'sand', 'rust', 'ochre', 'olive'), size: [0.32, 0.8], w: 2.2, cull: 15 },
    { name: 'staghorn', geos: [branching(11)], colors: pal('tan', 'ochre', 'pink', 'lilac', 'pink', 'ochre', 'bleach'), size: [0.45, 1.05], w: 2.2, cull: 14 },
    { name: 'table', geos: [table(5)], colors: pal('olive', 'brown', 'tan', 'sage', 'ochre'), size: [0.5, 1.15], w: 1.2, cull: 16 },
    { name: 'fan', geos: [fan(13)], colors: pal('maroon', 'pink', 'mauve', 'ochre', 'rose', 'lilac'), size: [0.45, 1.0], w: 1.3, cull: 13 },
    { name: 'soft', geos: [soft(17)], colors: pal('olive', 'sage', 'tan', 'pink', 'lilac', 'olive'), size: [0.45, 0.95], w: 1.6, cull: 11 },
    { name: 'barrel', geos: [barrel(23)], colors: pal('rust', 'brown', 'ochre', 'mauve'), size: [0.55, 1.25], w: 0.7, cull: 14 },
    { name: 'tubes', geos: [tubes(31)], colors: pal('mauve', 'lilac', 'ochre', 'rose', 'slate'), size: [0.6, 1.2], w: 0.8, cull: 11 },
    { name: 'rubble', geos: [rubble(41)], colors: pal('slate', 'brown', 'tan', 'slate', 'maroon'), size: [0.1, 0.32], w: 3.0, cull: 8, rubble: true },
  ];
  for (const k of kit) {
    k.geo = k.geos[0];
    k.geo.computeBoundingBox();
    k.geo.computeBoundingSphere();
    k.tris = k.geo.attributes.position.count / 3;
  }
  return kit;
}
