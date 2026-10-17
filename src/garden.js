// Garden pass: a karesansui-style Japanese garden on the terrace below the yard, south of the house.
// Compass in this world (see cape.js): +x east (inland), -x west (open Pacific-style sea), -z north, +z south.
// The plateau (y 0) ends at a rocky bank just south of the crate yard; a switchback path leads 2.4 m down to the
// terrace (GARDEN_G). On it: a raked white gravel bed (rake lines and ripples round the stone groups, a shader over
// a baked field, no texture memory for the lines), dark stone groups on moss islands, a koi pond fed by a two-step
// waterfall out of the bank, a shishi-odoshi / tsukubai that tips and clacks, a stone lantern, niwaki pines, red
// maples, clipped shrubs, stepping stones, a bamboo fence on the east side and a rock cliff down to the sea round
// the whole new coast (cape.js). Everything is walkable (no teleport) and the ground model is the rendered surface.
// ?garden=0 = the old scene; ?cape=0 = straight coast; ?koi=0, ?rake=0 (plain gravel), ?gardenfx=0 (no animation).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  GARDEN, CAPE, GARDEN_G, DOMAIN, CLIFF_LINE, FOREST_XS, FOREST_ZS, COAST, onLand, coastDist, baseY, bankTop, bankFoot,
  inDomain,
} from './cape.js';
import { forestGroundY, patchForest } from './forest.js';

const params = new URLSearchParams(location.search);
const KOI = params.get('koi') !== '0';
const RAKE = params.get('rake') !== '0';
const FX = params.get('gardenfx') !== '0';
const CULL = Number(params.get('gardencull')) > 0 ? Number(params.get('gardencull')) : 48; // details off past this

const G = GARDEN_G;
const HW = 0.62; // path half width (walkable)
const FENCE_X = 11.2;
const GRAVEL_Y = G - 0.04; // 3 cm under the kerb top: below the walk check's 5 cm, still reads as a raked bed
const KERB_Y = G - 0.01;
const KERB_W = 0.16;
const WATER_Y_POND = G - 0.17;

// ---------------------------------------------------------------- maths
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function chaikin(poly, n = 3) {
  let p = poly;
  for (let k = 0; k < n; k += 1) {
    const out = [];
    for (let i = 0; i < p.length; i += 1) {
      const [ax, az] = p[i];
      const [bx, bz] = p[(i + 1) % p.length];
      out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    p = out;
  }
  return p;
}
function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// signed distance to a closed polygon: + inside
function sdPoly(poly, x, z) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ax, az] = poly[j];
    const [bx, bz] = poly[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return inPoly(poly, x, z) ? best : -best;
}
function polyBox(poly, pad = 0) {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  return { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, z0: Math.min(...zs) - pad, z1: Math.max(...zs) + pad };
}
// outward offset of a closed polygon (either winding) by d (positive = outward)
function offsetPoly(poly, d, flip = 1) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const [px, pz] = poly[(i - 1 + n) % n];
    const [cx, cz] = poly[i];
    const [nx, nz] = poly[(i + 1) % n];
    let tx = nx - px;
    let tz = nz - pz;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    out.push([cx + tz * d * flip, cz - tx * d * flip]);
  }
  // the normal side depends on the winding: if the first vertex moved inward, use the other side (once)
  if (flip === 1 && d !== 0 && inPoly(poly, out[0][0], out[0][1]) === d > 0) return offsetPoly(poly, d, -1);
  return out;
}

// ---------------------------------------------------------------- layout
// The switchback down the bank: from the yard's south edge (y 0) to the terrace. y follows arc length (about 1:3.4).
// The hairpin is a true U (radius 0.76 m > the half-width) round (4.95, 13.2).
const HAIRPIN = Array.from({ length: 9 }, (_, k) => {
  const a = -Math.PI / 2 + (Math.PI * k) / 8;
  return [4.95 + Math.cos(a) * 0.8, 13.2 + Math.sin(a) * 0.76];
});
const PATH_PTS = [[1.0, 10.0], [1.5, 11.3], [2.6, 11.9], [4.0, 12.38], ...HAIRPIN, [4.2, 14.1], [3.25, 14.6], [2.45, 15.45], [2.3, 16.45]];
// corners are filleted (radius >= the path half-width, so inside a hairpin every point has one nearest path point and
// the path height has no seam)
function fillet(pts, R) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [px, pz] = pts[i - 1];
    const [cx, cz] = pts[i];
    const [nx, nz] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cz - pz);
    const l2 = Math.hypot(nx - cx, nz - cz);
    const ax = (cx - px) / l1; const az = (cz - pz) / l1;
    const bx = (nx - cx) / l2; const bz = (nz - cz) / l2;
    const phi = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
    if (phi < 0.42) { out.push(pts[i]); continue; }
    const t = Math.min(R * Math.tan(phi / 2), 0.45 * Math.min(l1, l2));
    const r = t / Math.tan(phi / 2);
    const sx = cx - ax * t; const sz = cz - az * t;
    const side = Math.sign(ax * bz - az * bx); // +1: turning toward +z-of-x (left/right in x-z)
    const ox = sx - az * r * side; const oz = sz + ax * r * side; // arc centre
    const a0 = Math.atan2(sz - oz, sx - ox);
    const n = Math.max(2, Math.ceil(phi / 0.2));
    for (let k = 0; k <= n; k += 1) {
      const a = a0 + side * phi * (k / n);
      out.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const PATH = (() => {
  const pts = fillet(PATH_PTS, 0.95).map(([x, z]) => ({ x, z, s: 0, y: 0 }));
  for (let i = 1; i < pts.length; i += 1) pts[i].s = pts[i - 1].s + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  // the descent starts where the original second corner was (the yard's level lip ends there)
  let s0 = 0;
  let bestD = Infinity;
  for (const p of pts) { const d = Math.hypot(p.x - PATH_PTS[1][0], p.z - PATH_PTS[1][1]); if (d < bestD) { bestD = d; s0 = p.s; } }
  const s1 = pts[pts.length - 1].s - 0.55;
  const yAt = (s) => {
    const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0)));
    return G * (0.45 * t + 0.55 * t * t * (3 - 2 * t));
  };
  pts.forEach((p) => { p.y = yAt(p.s); });
  return { pts, yAt, length: pts[pts.length - 1].s, s0, s1 };
})();
function pathAt(x, z) {
  let best = { d: Infinity, s: 0, y: 0 };
  const pts = PATH.pts;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < best.d) best = { d, s: a.s + Math.sqrt(len2) * t, y: 0 };
  }
  best.y = PATH.yAt(best.s);
  return best;
}

const POND = { x: 7.3, z: 16.25, rx: 2.1, rz: 1.5 };
function pondR(theta) { return 1 + 0.12 * Math.sin(2 * theta + 0.6) + 0.07 * Math.sin(3 * theta - 1.1) + 0.2 * smooth(0.4, 1, -Math.sin(theta)); }
const POND_POLY = Array.from({ length: 48 }, (_, i) => {
  const th = (i / 48) * Math.PI * 2;
  const r = pondR(th);
  return [POND.x + Math.cos(th) * POND.rx * r, POND.z + Math.sin(th) * POND.rz * r];
});
const sdPond = (x, z) => sdPoly(POND_POLY, x, z);

const BED_RAW = [[1.4, 19.4], [5.0, 19.1], [8.6, 19.5], [9.2, 22.8], [8.8, 27.0], [6.6, 29.0], [3.6, 29.2], [1.6, 27.8], [0.8, 23.8]];
const BED = chaikin(BED_RAW, 3);
const BED_BOX = polyBox(BED, 0.3);
const sdBed = (x, z) => (x < BED_BOX.x0 - 1 || x > BED_BOX.x1 + 1 || z < BED_BOX.z0 - 1 || z > BED_BOX.z1 + 1 ? -1 : sdPoly(BED, x, z));

// karesansui stones: [type, x, z, w, h, d, yaw]; types a..d = the four Poly Haven rocks
const BED_STONES = [
  ['a', 5.0, 23.5, 1.04, 1.69, 0.81, 0.4], ['b', 4.2, 24.0, 0.81, 0.86, 0.72, 1.9], ['c', 5.8, 23.0, 1.04, 0.55, 0.78, 2.6],
  ['d', 2.6, 26.8, 0.75, 1.01, 0.72, 0.8], ['c', 3.25, 27.3, 0.94, 0.47, 0.72, -0.6],
  ['a', 7.5, 26.4, 1.37, 0.65, 0.94, 2.2], ['b', 7.1, 21.0, 0.65, 0.39, 0.59, 0.2],
];
const ISLANDS = [
  { x: 5.0, z: 23.5, rx: 1.7, rz: 1.3, h: 0.19 }, { x: 2.9, z: 27.0, rx: 1.15, rz: 0.9, h: 0.14 },
];
// moss mounds on the terrace (under trees / along the edges)
const MOUNDS = [
  { x: -0.6, z: 17.6, rx: 1.5, rz: 1.1, h: 0.34 }, { x: 10.2, z: 16.0, rx: 1.0, rz: 1.25, h: 0.3 },
  { x: 9.9, z: 31.0, rx: 1.4, rz: 1.0, h: 0.26 }, { x: 0.7, z: 14.95, rx: 1.3, rz: 0.55, h: 0.2 },
  { x: 8.3, z: 30.6, rx: 1.0, rz: 0.8, h: 0.12 },
];
function moundH(list, x, z) {
  let h = 0;
  for (const m of list) {
    const r = Math.hypot((x - m.x) / m.rx, (z - m.z) / m.rz);
    if (r < 1) h = Math.max(h, m.h * 0.5 * (1 + Math.cos(Math.PI * r)));
  }
  return h;
}

// stepping stones (tobi-ishi): [x, z, r]; tops sit 3.5 cm over the moss
const STEP_RAW = [
  [2.95, 16.6, 0.3], [3.6, 16.2, 0.37], [3.4, 17.25, 0.28], [2.95, 18.0, 0.3], [2.15, 18.45, 0.28], [1.2, 18.75, 0.3],
  [0.35, 19.45, 0.3], [-0.15, 20.45, 0.28], [-0.25, 21.55, 0.3], [-0.15, 22.65, 0.28], [-0.05, 23.75, 0.3],
  [0.1, 24.85, 0.28], [0.35, 25.95, 0.3], [0.85, 27.05, 0.29], [1.6, 28.35, 0.3], [2.5, 29.3, 0.3], [3.5, 29.95, 0.3],
  [4.65, 30.35, 0.44], [5.85, 30.5, 0.3], [6.9, 30.2, 0.28], [7.9, 29.6, 0.29], [9.0, 28.75, 0.3], [9.7, 27.6, 0.28],
  [10.0, 26.45, 0.3], [10.05, 25.3, 0.28], [10.05, 24.15, 0.3], [10.0, 23.0, 0.28], [9.95, 21.85, 0.3], [9.8, 20.7, 0.28],
  [9.4, 19.65, 0.3], [8.55, 18.75, 0.29], [7.6, 18.55, 0.3], [6.65, 18.55, 0.28], [5.7, 18.6, 0.3], [4.85, 18.45, 0.28],
];
const STONES_STEP = STEP_RAW.map(([x, z, r], i) => {
  const n = 9;
  const poly = Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + hash(i, 3) * 2;
    const rr = r * (0.82 + 0.3 * hash(i * 7 + k, 1.3)) * (k % 2 ? 1 : 0.93);
    const sx = 1 + 0.25 * (hash(i, 9) - 0.5);
    return [x + Math.cos(a) * rr * sx, z + Math.sin(a) * rr / sx];
  });
  return { x, z, r, poly: chaikin(poly, 1), top: 0 };
});

// trees
const PINES = [
  { x: -0.6, z: 17.6, h: 2.7, yaw: 1.9 }, { x: 10.2, z: 16.0, h: 2.4, yaw: -0.6 },
  { x: 0.55, z: 12.85, h: 2.5, yaw: 2.7 }, { x: 9.9, z: 31.0, h: 2.9, yaw: 0.9 },
];
const MAPLES = [{ x: 8.25, z: 30.65, h: 3.6, yaw: 0.4 }, { x: 10.25, z: 14.6, h: 3.0, yaw: 2.2 }];
const TORO = { x: 4.25, z: 17.95, h: 1.55, yaw: -0.5 };
// shishi-odoshi + tsukubai, on the pond's west rim: pivot, basin, spout
const SHISHI = { x: 4.42, z: 15.2, len: 0.78, r: 0.048, pivotY: 0.36 };
const BASIN = { x: 4.98, z: 15.22, r: 0.3, h: 0.3 };
const FALLS = { x: 7.55 };
const SHRUBS = [
  [1.3, 14.55, 0.75, 0.55], [0.1, 14.5, 0.6, 0.45], [9.4, 14.55, 0.65, 0.5], [10.6, 18.0, 0.55, 0.5], [10.65, 19.3, 0.5, 0.45],
  [8.95, 19.0, 0.4, 0.35], [1.25, 19.35, 0.42, 0.36], [0.4, 28.3, 0.55, 0.45], [9.55, 27.0, 0.4, 0.36], [10.7, 29.2, 0.6, 0.5],
  [6.2, 31.5, 0.6, 0.4], [3.1, 31.0, 0.55, 0.4], [-1.0, 19.6, 0.4, 0.35], [5.7, 17.95, 0.32, 0.3],
];

// ---------------------------------------------------------------- terrain height
function bankShape(x, z) {
  const t = smooth(bankTop(x), bankFoot(x), z);
  const face = 4 * t * (1 - t);
  return baseY(x, z) + face * ((vnoise(x * 0.9 + 4, z * 0.9) - 0.5) * 0.55 + (vnoise(x * 2.3, z * 2.3 - 7) - 0.5) * 0.18);
}
function terraceShape(x, z) {
  let y = G + (vnoise(x * 0.35 + 2, z * 0.35) - 0.5) * 0.07 + moundH(MOUNDS, x, z);
  // pond bowl, with a slight lip
  const sp = sdPond(x, z);
  if (sp > -0.6) y += 0.03 * smooth(-0.6, -0.1, sp) * (1 - smooth(-0.1, 0.05, sp));
  if (sp > -0.05) y = lerp(y, G - 0.75, smooth(-0.05, 0.9, sp));
  // gravel bed recess + islands (islands rise through the gravel)
  const sb = sdBed(x, z);
  if (sb > -0.62) {
    const recess = G - 0.11;
    // only under the kerb + gravel: the moss outside meets the kerb top (no dip for a foot to hang over)
    y = lerp(y, recess, smooth(-KERB_W - 0.04, 0.02, sb));
    if (sb > 0) y = Math.max(y, recess + moundH(ISLANDS, x, z) * 1.4);
  }
  return y;
}
// edge distance to the forest floor this terrain must meet (east edge, the north edge east of the strip)
function forestEdge(x, z) {
  let d = DOMAIN.x1 - x;
  if (x > DOMAIN.stripX) d = Math.min(d, z - DOMAIN.z0);
  else if (z < DOMAIN.z0) d = Math.min(d, DOMAIN.stripX - x);
  return d;
}
function gardenH(x, z) {
  const tFoot = smooth(bankFoot(x) - 0.4, bankFoot(x) + 0.5, z);
  let y = lerp(bankShape(x, z), terraceShape(x, z), tFoot);
  y = withChannel(x, z, y); // the waterfall's stepped channel down the bank
  const p = pathAt(x, z);
  const wp = p.d < HW + 0.95 ? 1 - smooth(HW + 0.12, HW + 0.9, p.d) : 0;
  if (wp > 0) y = lerp(y, p.y, wp);
  // meet the forest floor (exactly at the domain edge; the path keeps its own grade up to 0.5 m from it)
  const e = forestEdge(x, z);
  if (e < 1.6) y = lerp(forestGroundY(x, z), y, Math.max(smooth(0, 1.6, e), wp * smooth(0, 0.5, e)));
  return y;
}

// ---------------------------------------------------------------- terrain grid (shared by mesh + ground model)
function subdivide(lines, max) {
  const out = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const a = lines[i];
    const b = lines[i + 1];
    const m = typeof max === 'function' ? max(a, b) : max;
    const n = Math.max(1, Math.ceil((b - a) / m - 1e-6));
    for (let k = 0; k < n; k += 1) out.push(a + ((b - a) * k) / n);
  }
  out.push(lines[lines.length - 1]);
  return out;
}
function snapToCoast(x, z) {
  let best = Infinity;
  let bx = x;
  let bz = z;
  for (let k = 0; k < COAST.length - 1; k += 1) {
    const [ax, az] = COAST[k];
    const [cx, cz] = COAST[k + 1];
    if (Math.max(ax, cx) < x - 6 || Math.min(ax, cx) > x + 6 || Math.max(az, cz) < z - 6 || Math.min(az, cz) > z + 6) continue;
    const dx = cx - ax;
    const dz = cz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) { best = d; bx = ax + dx * t; bz = az + dz * t; }
  }
  return [bx, bz];
}
function buildGrid() {
  const fx = FOREST_XS.filter((x) => x > DOMAIN.x0 + 0.05 && x <= DOMAIN.x1 + 1e-6);
  const xsMajor = [DOMAIN.x0, ...fx];
  const fz = FOREST_ZS.filter((z) => z >= DOMAIN.z0 - 1e-6 && z <= DOMAIN.z1 + 1e-6);
  const zsMajor = [DOMAIN.yardZ, ...fz];
  // 20 cm cells over the bank + path (x < 6.6, z < 16.8), 30 cm elsewhere
  const xs = subdivide(xsMajor, (a) => (a < 6.6 ? 0.2 : 0.3));
  const zs = subdivide(zsMajor, (a) => (a < 16.8 ? 0.2 : 0.3));
  const nx = xs.length;
  const nz = zs.length;
  const vx = new Float32Array(nx * nz);
  const vz = new Float32Array(nx * nz);
  const vy = new Float32Array(nx * nz);
  const land = new Uint8Array(nx * nz);
  // boundary vertices on a forest grid line get the forest triangle's linear height (no cracks)
  const onForestLine = (x, z) => {
    const eps = 1e-5;
    if (Math.abs(x - DOMAIN.x1) < eps) return { along: 'z', lines: FOREST_ZS };
    if (x > DOMAIN.stripX - eps && Math.abs(z - DOMAIN.z0) < eps) return { along: 'x', lines: FOREST_XS };
    if (z < DOMAIN.z0 - eps && Math.abs(x - DOMAIN.stripX) < eps) return { along: 'z', lines: [DOMAIN.yardZ, ...FOREST_ZS.filter((v) => v >= 9)] };
    return null;
  };
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const k = i * nz + j;
      let x = xs[i];
      let z = zs[j];
      land[k] = onLand(x, z) ? 1 : 0;
      if (!land[k]) [x, z] = snapToCoast(x, z);
      vx[k] = x;
      vz[k] = z;
      const line = land[k] ? onForestLine(x, z) : null;
      if (line) {
        const v = line.along === 'z' ? z : x;
        const ls = line.lines;
        let a = 0;
        while (a < ls.length - 2 && ls[a + 1] < v - 1e-6) a += 1;
        const l0 = ls[a];
        const l1 = ls[a + 1];
        const t = (v - l0) / (l1 - l0 || 1);
        const y0 = line.along === 'z' ? forestGroundY(x, l0) : forestGroundY(l0, z);
        const y1 = line.along === 'z' ? forestGroundY(x, l1) : forestGroundY(l1, z);
        vy[k] = lerp(y0, y1, Math.min(1, Math.max(0, t)));
      } else vy[k] = gardenH(x, z);
    }
  }
  const cells = new Uint8Array((nx - 1) * (nz - 1));
  for (let i = 0; i < nx - 1; i += 1) {
    for (let j = 0; j < nz - 1; j += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (!inDomain(cx, cz)) continue;
      const k = i * nz + j;
      if (!(land[k] || land[k + nz] || land[k + nz + 1] || land[k + 1])) continue;
      cells[i * (nz - 1) + j] = 1;
    }
  }
  return { xs, zs, nx, nz, vx, vy, vz, land, cells };
}
function findIndex(list, v) {
  let lo = 0;
  let hi = list.length - 2;
  if (v < list[0] || v > list[list.length - 1]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
function triY(ax, az, ay, bx, bz, by, cx, cz, cy, x, z) {
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-9) return null;
  const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
  const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  const l3 = 1 - l1 - l2;
  if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) return null;
  return l1 * ay + l2 * by + l3 * cy;
}
// height of the rendered terrain at (x, z) (same triangles as the mesh: a-d-b, b-d-c), or null off the mesh
function gridHeight(grid, x, z) {
  const i = findIndex(grid.xs, x);
  const j = findIndex(grid.zs, z);
  if (i < 0 || j < 0) return null;
  for (const [di, dj] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const ii = i + di;
    const jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= grid.nx - 1 || jj >= grid.nz - 1) continue;
    if (!grid.cells[ii * (grid.nz - 1) + jj]) continue;
    const nz = grid.nz;
    const a = ii * nz + jj;
    const b = a + nz;
    const c = a + nz + 1;
    const d = a + 1;
    const { vx, vy, vz } = grid;
    let y = triY(vx[a], vz[a], vy[a], vx[d], vz[d], vy[d], vx[b], vz[b], vy[b], x, z);
    if (y == null) y = triY(vx[b], vz[b], vy[b], vx[d], vz[d], vy[d], vx[c], vz[c], vy[c], x, z);
    if (y != null) return y;
  }
  return null;
}

// ---------------------------------------------------------------- the waterfall channel profile (z -> y)
const CHANNEL = [[11.55, 0], [11.85, -0.1], [12.45, -0.62], [12.53, -1.3], [13.3, -1.42], [13.37, -2.5], [14.7, -2.64]];
function channelY(z) {
  if (z <= CHANNEL[0][0]) return CHANNEL[0][1];
  for (let i = 0; i < CHANNEL.length - 1; i += 1) {
    const [z0, y0] = CHANNEL[i];
    const [z1, y1] = CHANNEL[i + 1];
    if (z <= z1) return lerp(y0, y1, (z - z0) / (z1 - z0));
  }
  return CHANNEL[CHANNEL.length - 1][1];
}
function withChannel(x, z, y) {
  const fx = Math.abs(x - FALLS.x);
  if (fx > 0.75 || z < CHANNEL[0][0] || z > 14.9) return y;
  const w = (1 - smooth(0.32, 0.75, fx)) * (1 - smooth(14.5, 14.9, z));
  return lerp(y, channelY(z), w);
}

// ---------------------------------------------------------------- textures made at boot
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function streakTexture() {
  return canvasTex(128, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 260; i += 1) {
      const x = hash(i, 1) * w;
      const y = hash(i, 2) * h;
      const len = 20 + hash(i, 3) * 90;
      const a = 0.18 + hash(i, 4) * 0.5;
      const lw = 1 + hash(i, 5) * 3.5;
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = lw;
      for (const dy of [0, -h, h]) {
        ctx.beginPath();
        ctx.moveTo(x, y + dy);
        ctx.lineTo(x + (hash(i, 6) - 0.5) * 6, y + len + dy);
        ctx.stroke();
      }
    }
  });
}
function foamTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 160; i += 1) {
      const a = hash(i, 11) * Math.PI * 2;
      const r = Math.pow(hash(i, 12), 0.7) * w * 0.46;
      const x = w / 2 + Math.cos(a) * r;
      const y = h / 2 + Math.sin(a) * r;
      const s = 2 + hash(i, 13) * 7;
      const al = (0.25 + 0.5 * hash(i, 14)) * (1 - r / (w * 0.5));
      const g = ctx.createRadialGradient(x, y, 0, x, y, s);
      g.addColorStop(0, `rgba(255,255,255,${al})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
    }
  });
}
function glowTexture() {
  return canvasTex(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,214,150,0.95)');
    g.addColorStop(0.25, 'rgba(255,170,90,0.45)');
    g.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
const white = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

// ---------------------------------------------------------------- model helpers
function toFloat(g) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const size = a.itemSize;
    const arr = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i += 1) {
      arr[i * size] = a.getX(i);
      if (size > 1) arr[i * size + 1] = a.getY(i);
      if (size > 2) arr[i * size + 2] = a.getZ(i);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (g.index) out.setIndex(Array.from(g.index.array));
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  return out;
}
// Bake a glTF (or one node of it) into per-material geometries, bottom-centred (min y = 0, centre x/z = 0).
function proto(root) {
  if (!root) return null;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = toFloat(o.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!groups.has(mat)) groups.set(mat, []);
    groups.get(mat).push(g);
  });
  if (!groups.size) return null;
  const parts = [...groups].map(([material, list]) => ({ material, geometry: list.length > 1 ? mergeGeometries(list, false) : list[0] }));
  const box = new THREE.Box3();
  parts.forEach((p) => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); });
  const c = box.getCenter(new THREE.Vector3());
  parts.forEach((p) => { p.geometry.translate(-c.x, -box.min.y, -c.z); p.geometry.computeBoundingSphere(); });
  const size = box.getSize(new THREE.Vector3());
  return { parts, size, tris: parts.reduce((n, p) => n + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 0) };
}
function instanced(p, list, matrixFor, { color = null, name = 'garden', castShadow = false } = {}) {
  const meshes = [];
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const part of p.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
    list.forEach((item, i) => {
      mesh.setMatrixAt(i, matrixFor(item, m));
      if (color) mesh.setColorAt(i, color(item, c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.name = name;
    meshes.push(mesh);
  }
  return meshes;
}
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
function compose(m, x, y, z, yaw, sx, sy, sz, tilt = 0, roll = 0) {
  tmpE.set(tilt, yaw, roll, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  return m.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
}
// cylinder from a to b (open), merged into bamboo
function cane(a, b, r, color, seg = 6, capped = false) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, !capped);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return paint(g.index ? g.toNonIndexed() : g, color);
}
function paint(g, color, jitter = 0) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i += 1) {
    const k = 1 + (jitter ? (hash(i * 0.37, n) - 0.5) * jitter : 0);
    col[i * 3] = c.r * k;
    col[i * 3 + 1] = c.g * k;
    col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
function flatIndexless(g) { return g.index ? g.toNonIndexed() : g; }

// ---------------------------------------------------------------- materials
function splatMaterial() {
  const U = {
    uEarth: { value: white }, uRock: { value: white },
    uMossTint: { value: new THREE.Color(0.62, 0.86, 0.46) },
    uEarthTint: { value: new THREE.Color(0x7d8274) },
    uRockTint: { value: new THREE.Color(0x8f8a84) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: white, roughness: 1, metalness: 0, vertexColors: true });
  mat.name = 'GardenGround';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSplat;\nvarying vec3 vSplat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uEarth;\nuniform sampler2D uRock;\nuniform vec3 uMossTint;\nuniform vec3 uEarthTint;\nuniform vec3 uRockTint;\nvarying vec3 vSplat;')
      .replace('#include <map_fragment>', `
        vec3 sw = vSplat / max(vSplat.x + vSplat.y + vSplat.z, 1e-3);
        vec3 cMoss = texture2D(map, vMapUv * 1.3).rgb * uMossTint;
        vec3 cEarth = texture2D(uEarth, vMapUv).rgb * uEarthTint;
        vec3 cRock = texture2D(uRock, vMapUv * 1.32).rgb * uRockTint;
        diffuseColor.rgb *= cMoss * sw.x + cEarth * sw.y + cRock * sw.z;`);
  };
  mat.customProgramCacheKey = () => 'garden-splat';
  return { mat, U };
}

// Raked gravel: rake lines from a baked field (ring distance round the stone groups / along the bed edge), straight
// east-west lines elsewhere. Normal-only (no displacement), faded out where the lines get finer than ~2 px.
function bakeRakeField() {
  const box = BED_BOX;
  const W = 384;
  const H = Math.round(W * (box.z1 - box.z0) / (box.x1 - box.x0));
  const RING = 0.62;
  const EDGE = 0.24;
  const data = new Float32Array(W * H * 4);
  const groups = BED_STONES.map(([, x, z, w, , d]) => ({ x, z, r: 0.5 * Math.max(w, d) * 0.92 }));
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const x = box.x0 + ((i + 0.5) / W) * (box.x1 - box.x0);
      const z = box.z0 + ((j + 0.5) / H) * (box.z1 - box.z0);
      let dg = Infinity;
      let gx = 0;
      let gz = 1;
      for (const s of groups) {
        const d = Math.hypot(x - s.x, z - s.z) - s.r;
        if (d < dg) { dg = d; const l = Math.hypot(x - s.x, z - s.z) || 1; gx = (x - s.x) / l; gz = (z - s.z) / l; }
      }
      const o = (j * W + i) * 4;
      if (dg < RING) {
        data[o] = Math.max(0, dg); data[o + 1] = gx; data[o + 2] = gz; data[o + 3] = 1;
        continue;
      }
      const sb = sdPoly(BED, x, z);
      if (sb < EDGE) {
        const e = 0.01;
        const nx = sdPoly(BED, x + e, z) - sdPoly(BED, x - e, z);
        const nz = sdPoly(BED, x, z + e) - sdPoly(BED, x, z - e);
        const l = Math.hypot(nx, nz) || 1;
        data[o] = Math.max(0, sb); data[o + 1] = nx / l; data[o + 2] = nz / l; data[o + 3] = 1;
      } else {
        data[o] = RING; data[o + 1] = 0; data[o + 2] = 1; data[o + 3] = 0;
      }
    }
  }
  const half = new Uint16Array(data.length);
  for (let k = 0; k < data.length; k += 1) half[k] = THREE.DataUtils.toHalfFloat(data[k]);
  const tex = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, box, bytes: half.byteLength };
}
function gravelMaterial(field) {
  const U = {
    uRake: { value: field?.tex || white },
    uRakeBox: { value: new THREE.Vector4(field ? field.box.x0 : 0, field ? field.box.z0 : 0, field ? 1 / (field.box.x1 - field.box.x0) : 0, field ? 1 / (field.box.z1 - field.box.z0) : 0) },
    uRakeOn: { value: field ? 1 : 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.22, 1.21, 1.17), map: null, roughness: 0.96, metalness: 0 });
  mat.name = 'GardenGravel';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uRake;
uniform vec4 uRakeBox;
uniform float uRakeOn;
varying vec2 vGWorld;
float gRakeH;
vec2 gRakeSlope;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec4 f = texture2D(uRake, (vGWorld - uRakeBox.xy) * uRakeBox.zw);
  bool ring = f.a > 0.5;
  float s = ring ? f.r : vGWorld.y;
  vec2 g = ring ? normalize(f.gb + vec2(1e-4)) : vec2(0.0, 1.0);
  const float LAMBDA = 0.075;
  float ph = s / LAMBDA * 6.2831853;
  float aa = clamp(1.6 - fwidth(s / LAMBDA) * 2.2, 0.0, 1.0) * uRakeOn;
  gRakeH = cos(ph);
  float slope = -sin(ph) * 0.011 * 6.2831853 / LAMBDA * aa;
  gRakeSlope = g * slope;
  diffuseColor.rgb *= mix(1.0, 0.8 + 0.2 * (0.5 + 0.5 * gRakeH), aa);
}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
normal = normalize(normal + (viewMatrix * vec4(-gRakeSlope.x, 0.0, -gRakeSlope.y, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'garden-gravel';
  return { mat, U };
}

// low-poly rock (bank and coast boulders): displaced icosphere, flat-ish bottom
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(0.5, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 1) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const k = 1 + (vnoise(n.x * 2.2 + seed, n.z * 2.2 + n.y * 1.7 - seed) - 0.5) * 0.42 + (vnoise(n.x * 5 - seed, n.y * 5 + n.z * 3) - 0.5) * 0.12;
    v.multiplyScalar(k);
    if (v.y < -0.18) v.y = -0.18 + (v.y + 0.18) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function createGarden({ scene, assets }) {
  if (!GARDEN) return null;
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'garden';
  group.userData.zone = 'outdoor';
  const details = new THREE.Group(); // culled past CULL m (koi, falls, glow, the shishi-odoshi tube)
  details.name = 'garden_details';
  group.add(details);
  const colliders = [];
  const addCollider = (x, z, hx, hz, y0, y1, why) => colliders.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0, y1, why });
  const stats = { calls: 0, tris: 0, parts: {} };
  const count = (name, mesh) => {
    const g = mesh.geometry;
    const tris = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (mesh.isInstancedMesh ? mesh.count : 1);
    stats.calls += 1;
    stats.tris += tris;
    stats.parts[name] = (stats.parts[name] || 0) + Math.round(tris);
  };
  const add = (name, mesh, parent = group) => {
    mesh.name = `garden_${name}`;
    parent.add(mesh);
    count(name, mesh);
    return mesh;
  };

  // ---- terrain
  const grid = buildGrid();
  const hAt = (x, z) => gridHeight(grid, x, z);
  {
    const { nx, nz, vx, vy, vz } = grid;
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const col = new Float32Array(nx * nz * 3);
    const splat = new Float32Array(nx * nz * 3);
    for (let k = 0; k < nx * nz; k += 1) {
      const x = vx[k];
      const z = vz[k];
      const y = vy[k];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 3.2; uv[k * 2 + 1] = z / 3.2;
      const e = 0.2;
      const slope = Math.hypot(gardenH(x + e, z) - gardenH(x - e, z), gardenH(x, z + e) - gardenH(x, z - e)) / (2 * e);
      const p = pathAt(x, z);
      const cd = CAPE ? coastDist(x, z) : x - CLIFF_LINE;
      let rock = Math.max(smooth(0.55, 1.15, slope), 1 - smooth(0.15, 0.85, cd));
      let earth = Math.max(1 - smooth(HW - 0.08, HW + 0.3, p.d), 1 - smooth(0.1, 1.3, forestEdge(x, z)));
      if (z < bankTop(x) + 0.2) earth = Math.max(earth, 0.55);
      const sb = sdBed(x, z);
      if (sb > -0.25) earth = 1;
      const sp = sdPond(x, z);
      if (sp > -0.1) rock = Math.max(rock, 0.8);
      if (Math.abs(x - FALLS.x) < 0.7 && z > 11.6 && z < 14.8) rock = Math.max(rock, 0.85);
      earth = Math.min(earth, 1 - rock * 0.85);
      const moss = Math.max(0, 1 - rock - earth);
      splat[k * 3] = moss; splat[k * 3 + 1] = earth; splat[k * 3 + 2] = rock;
      let v = 0.86 + 0.26 * vnoise(x * 0.7 + 3, z * 0.7);
      for (const t of PINES) v *= 1 - 0.25 * (1 - smooth(0.4, 1.8, Math.hypot(x - t.x, z - t.z)));
      if (sp > 0) v *= 0.55;
      col[k * 3] = v; col[k * 3 + 1] = v; col[k * 3 + 2] = v;
    }
    const index = [];
    for (let i = 0; i < nx - 1; i += 1) {
      for (let j = 0; j < nz - 1; j += 1) {
        if (!grid.cells[i * (nz - 1) + j]) continue;
        const a = i * nz + j;
        index.push(a, a + 1, a + nz, a + nz, a + 1, a + nz + 1); // a-d-b, b-d-c (d = a + 1)
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const { mat, U } = splatMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    add('ground', mesh);
    // textures: moss (garden_moss), forest floor (forest kit, already loaded), rock (rock_cliff, deferred)
    const floor = assets?.gltf?.('forest_kit')?.scene?.getObjectByName('forest_floor');
    if (floor?.material?.map) U.uEarth.value = floor.material.map;
    const setMap = (tex, slot) => {
      if (!tex) return;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      if (slot === 'moss') { mat.map = tex; mat.needsUpdate = true; } else U[slot].value = tex;
    };
    assets?.whenReady?.('garden_moss').then(() => setMap(assets.material('garden_moss')?.map, 'moss'));
    const rockNow = assets?.material?.('rock_cliff');
    if (rockNow?.map) setMap(rockNow.map, 'uRock');
    else assets?.whenReady?.('rock_cliff').then(() => setMap(assets.material('rock_cliff')?.map, 'uRock'));
  }

  // ---- coast cliff: from the end of the old cliff (z 10.25) round the garden and the whole cape
  {
    const pts = [];
    for (let k = 0; k < COAST.length; k += 1) {
      const [x, z] = COAST[k];
      if (z < 10.25 && x <= CLIFF_LINE + 1e-6) continue;
      if (x > 150) break;
      pts.push([x, z]);
    }
    if (!pts.length || pts[0][1] > 10.25) pts.unshift([CLIFF_LINE, 10.25]);
    if (!CAPE) pts.push([CLIFF_LINE, 150]);
    // resample the straight part so the face gets columns every ~1.6 m
    const cols = [];
    for (let k = 0; k < pts.length - 1; k += 1) {
      const [ax, az] = pts[k];
      const [bx, bz] = pts[k + 1];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 1.6));
      for (let i = 0; i < n; i += 1) cols.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
    }
    cols.push(pts[pts.length - 1]);
    const topAt = (x, z) => {
      const gy = inDomain(x, z) ? (hAt(x, z) ?? gardenH(x, z)) : forestGroundY(x, z);
      return gy;
    };
    const ROWS = [0, 0.04, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
    const BOTTOM = -8.7;
    const pos = [];
    const uv = [];
    const index = [];
    let s = 0;
    const per = ROWS.length + 3; // lip, rows..., apron x2
    for (let c = 0; c < cols.length; c += 1) {
      const [x, z] = cols[c];
      const [px, pz] = cols[Math.max(0, c - 1)];
      const [qx, qz] = cols[Math.min(cols.length - 1, c + 1)];
      let dx = qx - px;
      let dz = qz - pz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const sx = -dz; // seaward normal (land is to the left of the walking direction)
      const sz = dx;
      if (c > 0) s += Math.hypot(x - cols[c - 1][0], z - cols[c - 1][1]);
      const top = topAt(x, z);
      // lip: 0.6 m inland, just under the ground there, so the rim reads as rock and hides any crack
      const ix = x - sx * 0.6;
      const iz = z - sz * 0.6;
      pos.push(ix, topAt(ix, iz) - 0.06, iz); uv.push(s / 2.42, (top + 0.6) / 2.42);
      ROWS.forEach((t, r) => {
        const y = lerp(top + 0.035, BOTTOM, t);
        const jag = r === 0 ? 0 : (vnoise(s * 0.55 + r * 3.1, y * 0.4) - 0.5) * 0.9 + Math.sin(t * Math.PI) * 0.25;
        const out = r === 0 ? 0.04 : 0.08 + jag + t * 0.7;
        pos.push(x + sx * out, y, z + sz * out);
        uv.push(s / 2.42, y / 2.42);
      });
      for (const [o, y] of [[2.2, -9.6], [5.0, -11.6]]) { pos.push(x + sx * (0.8 + o), y, z + sz * (0.8 + o)); uv.push(s / 2.42, y / 2.42 - o / 2.42); }
      if (c > 0) {
        const a0 = (c - 1) * per;
        const b0 = c * per;
        for (let r = 0; r < per - 1; r += 1) index.push(a0 + r, a0 + r + 1, b0 + r, b0 + r, a0 + r + 1, b0 + r + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const rockMat = assets?.material?.('rock_cliff') || new THREE.MeshStandardMaterial({ color: 0x5c554e, roughness: 1 });
    const mesh = new THREE.Mesh(geo, rockMat);
    mesh.userData.shore = true; // water.js shore bake: foam line and depth along the new coast
    mesh.receiveShadow = true;
    add('coast', mesh);
  }

  // ---- gravel bed + kerb + stepping stones + basin (granite)
  const field = RAKE ? bakeRakeField() : null;
  const gravel = gravelMaterial(field);
  {
    const shape = new THREE.Shape(offsetPoly(BED, 0.06).map(([x, z]) => new THREE.Vector2(x, z)));
    const geo = new THREE.ShapeGeometry(shape, 1);
    // ShapeGeometry lies in x/y: map (x, y) -> (x, GRAVEL_Y, y)
    const p = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const z = p.getY(i);
      p.setXYZ(i, x, GRAVEL_Y, z);
      uv.setXY(i, x / 0.9, z / 0.9);
    }
    geo.computeVertexNormals();
    const n = geo.attributes.normal;
    for (let i = 0; i < n.count; i += 1) n.setXYZ(i, 0, 1, 0);
    // winding: ShapeGeometry faces +z; after the swap they may face down: flip if so
    const idx = geo.index.array;
    const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
    a.fromBufferAttribute(p, idx[0]); b.fromBufferAttribute(p, idx[1]); c.fromBufferAttribute(p, idx[2]);
    if (b.sub(a).cross(c.sub(a)).y < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const mesh = new THREE.Mesh(geo, gravel.mat);
    mesh.receiveShadow = true;
    add('gravel', mesh);
    assets?.whenReady?.('garden_gravel').then(() => {
      const map = assets.material('garden_gravel')?.map;
      if (!map) return;
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
      gravel.mat.map = map;
      gravel.mat.needsUpdate = true;
    });
  }
  const granite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  granite.name = 'GardenGranite';
  const graniteParts = [];
  {
    // kerb: a ring between the bed outline and KERB_W outside it
    const inner = BED;
    const outer = offsetPoly(BED, KERB_W);
    const pos = [];
    const uv = [];
    const index = [];
    const bottom = G - 0.16;
    let s = 0;
    for (let i = 0; i <= inner.length; i += 1) {
      const k = i % inner.length;
      if (i > 0) s += Math.hypot(inner[k][0] - inner[i - 1][0], inner[k][1] - inner[i - 1][1]);
      const [ix, iz] = inner[k];
      const [ox, oz] = outer[k];
      pos.push(ix, bottom, iz, ix, KERB_Y, iz, ox, KERB_Y, oz, ox, bottom, oz);
      uv.push(s, 0, s, 0.2, s, 0.4, s, 0.6);
      if (i > 0) {
        const a = (i - 1) * 4;
        const b = i * 4;
        for (let r = 0; r < 3; r += 1) index.push(a + r, b + r, a + r + 1, a + r + 1, b + r, b + r + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    // faces must point out/up: check one top face
    const pa = ng.attributes.position;
    const tri = [6, 7, 8].map((i) => new THREE.Vector3().fromBufferAttribute(pa, i));
    const nrm = tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0]));
    if (nrm.y < 0) {
      for (let i = 0; i < pa.count; i += 3) {
        const t = [pa.getX(i + 1), pa.getY(i + 1), pa.getZ(i + 1)];
        pa.setXYZ(i + 1, pa.getX(i + 2), pa.getY(i + 2), pa.getZ(i + 2));
        pa.setXYZ(i + 2, t[0], t[1], t[2]);
        const u = ng.attributes.uv;
        const tu = [u.getX(i + 1), u.getY(i + 1)];
        u.setXY(i + 1, u.getX(i + 2), u.getY(i + 2));
        u.setXY(i + 2, tu[0], tu[1]);
      }
      ng.computeVertexNormals();
    }
    graniteParts.push(paint(ng, 0x8f8b85, 0.15));
  }
  for (const st of STONES_STEP) {
    const ground = Math.max(...st.poly.map(([x, z]) => hAt(x, z) ?? gardenH(x, z)));
    st.top = ground + 0.035; // low enough that the walker never 'hovers' > 4 cm when its body overlaps a stone edge
    const n = st.poly.length;
    const pos = [];
    const index = [];
    pos.push(st.x, st.top, st.z);
    st.poly.forEach(([x, z]) => pos.push(x, st.top, z));
    st.poly.forEach(([x, z]) => pos.push(x, st.top - 0.012, z));
    st.poly.forEach(([x, z]) => pos.push(st.x + (x - st.x) * 1.06, st.top - 0.2, st.z + (z - st.z) * 1.06));
    for (let k = 0; k < n; k += 1) {
      const a = 1 + k;
      const b = 1 + ((k + 1) % n);
      index.push(0, b, a);
      const a2 = 1 + n + k;
      const b2 = 1 + n + ((k + 1) % n);
      const a3 = 1 + 2 * n + k;
      const b3 = 1 + 2 * n + ((k + 1) % n);
      index.push(a2, b2, a3, b2, b3, a3);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g = g.toNonIndexed();
    // make the top face up
    const pa = g.attributes.position;
    const v0 = new THREE.Vector3().fromBufferAttribute(pa, 0);
    const v1 = new THREE.Vector3().fromBufferAttribute(pa, 1);
    const v2 = new THREE.Vector3().fromBufferAttribute(pa, 2);
    if (v1.sub(v0).cross(v2.sub(v0)).y < 0) {
      for (let i = 0; i < pa.count; i += 3) {
        const t = [pa.getX(i + 1), pa.getY(i + 1), pa.getZ(i + 1)];
        pa.setXYZ(i + 1, pa.getX(i + 2), pa.getY(i + 2), pa.getZ(i + 2));
        pa.setXYZ(i + 2, t[0], t[1], t[2]);
      }
    }
    g.computeVertexNormals();
    const uvs = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i += 1) { uvs[i * 2] = pa.getX(i) * 0.9; uvs[i * 2 + 1] = pa.getZ(i) * 0.9 + pa.getY(i); }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    graniteParts.push(paint(g, 0x9a958e, 0.0));
  }
  // tsukubai basin (chozubachi): a lathed stone bowl
  const basinY = (hAt(BASIN.x, BASIN.z) ?? gardenH(BASIN.x, BASIN.z)) - 0.04;
  {
    const prof = [[0.001, 0], [BASIN.r * 0.92, 0], [BASIN.r, 0.05], [BASIN.r * 1.02, BASIN.h * 0.7], [BASIN.r * 0.96, BASIN.h], [BASIN.r * 0.66, BASIN.h + 0.01], [BASIN.r * 0.62, BASIN.h - 0.05], [BASIN.r * 0.45, BASIN.h - 0.13], [0.001, BASIN.h - 0.15]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, 14);
    g.translate(BASIN.x, basinY, BASIN.z);
    graniteParts.push(paint(g.toNonIndexed(), 0x938f88, 0.12));
    addCollider(BASIN.x, BASIN.z, BASIN.r + 0.02, BASIN.r + 0.02, basinY - 0.1, basinY + BASIN.h + 0.6, 'tsukubai');
  }
  // knock stone under the tube's rear end + two stones by the basin
  const shishiY = hAt(SHISHI.x, SHISHI.z) ?? gardenH(SHISHI.x, SHISHI.z);
  {
    const k = flatIndexless(rockGeometry(4.2));
    k.scale(0.22, 0.16, 0.2);
    k.translate(SHISHI.x - SHISHI.len * 0.46, shishiY + 0.02, SHISHI.z);
    graniteParts.push(paint(k, 0x7d7a75, 0.2));
  }
  const graniteGeo = mergeGeometries(graniteParts.map((g) => {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
    return g.index ? g.toNonIndexed() : g;
  }), false);
  add('granite', new THREE.Mesh(graniteGeo, granite));

  return finishGarden({ scene, assets, group, details, colliders, addCollider, stats, add, grid, hAt, granite, gravel, field, t0 });
}

function finishGarden({ scene, assets, group, details, colliders, addCollider, stats, add, grid, hAt, granite, gravel, field, t0 }) {
  const groundY = (x, z) => hAt(x, z) ?? gardenH(x, z);
  const stoneMats = new Set();

  // ---- clipped shrubs (karikomi): displaced spheres, one merged mesh
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x3b5a2c, roughness: 0.88, metalness: 0, vertexColors: true });
  shrubMat.name = 'GardenShrub';
  {
    const parts = [];
    SHRUBS.forEach(([x, z, w, h], i) => {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      const v = new THREE.Vector3();
      for (let k = 0; k < p.count; k += 1) {
        v.fromBufferAttribute(p, k);
        const n = 1 + (vnoise(v.x * 1.7 + i, v.z * 1.7 + v.y * 1.3) - 0.5) * 0.22 + (vnoise(v.x * 6 + i * 3, v.y * 6 - v.z * 4) - 0.5) * 0.08;
        v.multiplyScalar(n);
        if (v.y < -0.35) v.y = -0.35;
        p.setXYZ(k, v.x * w, (v.y + 0.35) * h * 0.75, v.z * w * (0.85 + 0.2 * hash(i, 4)));
      }
      g.computeVertexNormals();
      g.rotateY(hash(i, 7) * 6.28);
      const y = groundY(x, z) - 0.04;
      g.translate(x, y, z);
      paint(g, new THREE.Color(0x3b5a2c).multiplyScalar(0.8 + 0.4 * hash(i, 9)), 0.22);
      parts.push(g);
      addCollider(x, z, w * 0.85, w * 0.85, y - 0.1, y + h + 0.5, 'shrub');
    });
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), shrubMat);
    add('shrubs', mesh);
    assets?.whenReady?.('garden_moss').then(() => {
      const m = assets.material('garden_moss');
      if (!m?.map) return;
      shrubMat.map = m.map;
      shrubMat.normalMap = m.normalMap || null;
      shrubMat.needsUpdate = true;
    });
  }

  // ---- low-poly boulders: the bank, the path's edges and the coast (one merged mesh, scan texture once loaded)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true });
  rockMat.name = 'GardenBoulder';
  const boulders = [];
  {
    const keep = (x, z, r) => {
      if (!inDomain(x, z) || !onLand(x, z)) return false;
      if (pathAt(x, z).d < HW + 0.22 + r) return false;
      if (Math.abs(x - FALLS.x) < 0.8 + r * 0.4 && z < 14.9) return false;
      if (x > 3.7 && x < 5.4 && z > 14.4 && z < 15.8) return false; // the shishi-odoshi
      if (Math.hypot(x - MAPLES[1].x, z - MAPLES[1].z) < 0.6 + r) return false;
      return !boulders.some((b) => Math.hypot(b.x - x, b.z - z) < (b.w + r * 2) * 0.42);
    };
    // bank
    for (let x = -1.35; x < 11.4; x += 1.05) {
      for (let z = 11.8; z < 14.5; z += 0.85) {
        const px = x + (hash(x * 3.1, z) - 0.5) * 0.8;
        const pz = z + (hash(z * 2.3, x) - 0.5) * 0.5;
        if (hash(px * 7.1, pz * 3.3) > 0.62) continue;
        const w = 0.55 + hash(px, pz * 5) * 0.95;
        if (!keep(px, pz, w / 2)) continue;
        boulders.push({ x: px, z: pz, w, h: w * (0.5 + 0.35 * hash(pz, px)), sink: 0.35, tint: 0.2 + 0.1 * hash(px * 2, pz), seed: px * 1.3 + pz });
      }
    }
    // retaining stones along both edges of the path where it crosses the bank
    for (let s = 1.6; s < PATH.length - 0.4; s += 0.55) {
      let i = 1;
      while (i < PATH.pts.length - 1 && PATH.pts[i].s < s) i += 1;
      const a = PATH.pts[i - 1];
      const b = PATH.pts[i];
      const t = (s - a.s) / (b.s - a.s);
      const x = lerp(a.x, b.x, t);
      const z = lerp(a.z, b.z, t);
      const dx = (b.x - a.x) / (b.s - a.s);
      const dz = (b.z - a.z) / (b.s - a.s);
      for (const side of [-1, 1]) {
        if (hash(s * 3.7, side) > 0.7) continue;
        const w = 0.32 + hash(s, side * 2) * 0.3;
        const off = HW + 0.12 + w / 2;
        const px = x - dz * side * off;
        const pz = z + dx * side * off;
        if (!inDomain(px, pz) || pathAt(px, pz).d < HW + 0.1 + w * 0.35) continue;
        if (boulders.some((bb) => Math.hypot(bb.x - px, bb.z - pz) < (bb.w + w) * 0.42)) continue;
        boulders.push({ x: px, z: pz, w, h: w * 0.62, sink: 0.3, tint: 0.19 + 0.08 * hash(px, pz), seed: s * 9 + side });
      }
    }
    // the coast: a rim of boulders just inside the edge
    let acc = 0;
    for (let k = 0; k < COAST.length - 1; k += 1) {
      const [ax, az] = COAST[k];
      const [bx, bz] = COAST[k + 1];
      if (bz < 10.4 && ax <= CLIFF_LINE) continue;
      if (ax > FENCE_X + 0.6) break;
      const len = Math.hypot(bx - ax, bz - az);
      const nx = (bz - az) / len; // inland
      const nz = -(bx - ax) / len;
      for (let d = 0; d < len; d += 0.35) {
        acc += 0.35;
        if (acc < 2.1) continue;
        acc = hash(ax + d, az) * 1.2;
        const x = ax + ((bx - ax) * d) / len;
        const z = az + ((bz - az) * d) / len;
        const small = z > 16.5 && z < 27.5 && x < 1;
        const w = small ? 0.38 + hash(x, z) * 0.35 : 0.4 + Math.pow(hash(x, z), 2) * 1.1;
        const px = x + nx * (0.15 + w * 0.15);
        const pz = z + nz * (0.15 + w * 0.15);
        if (!inDomain(px, pz)) continue;
        if (boulders.some((bb) => Math.hypot(bb.x - px, bb.z - pz) < (bb.w + w) * 0.4)) continue;
        boulders.push({ x: px, z: pz, w, h: w * (0.55 + 0.3 * hash(z, x)), sink: 0.3, tint: 0.17 + 0.1 * hash(x * 3, z), seed: x + z * 2.1, coast: true });
      }
    }
    // the rock in the hairpin's eye (covers the singular point where the two legs' grades meet)
    boulders.push({ x: 4.93, z: 13.2, w: 1.02, h: 0.62, sink: 0.25, tint: 0.24, seed: 41.7 });
    const parts = [];
    for (const b of boulders) {
      const g = rockGeometry(b.seed);
      const y = groundY(b.x, b.z) - b.h * b.sink;
      g.scale(b.w, b.h * 1.25, b.w * (0.75 + 0.4 * hash(b.seed, 2)));
      g.rotateY(hash(b.seed, 5) * 6.28);
      g.translate(b.x, y + b.h * 0.22, b.z);
      paint(g, new THREE.Color(b.tint, b.tint * 0.97, b.tint * 0.93), 0.1);
      parts.push(g);
      const cd = CAPE ? coastDist(b.x, b.z) : b.x - CLIFF_LINE;
      if (!b.coast || cd + b.w * 0.5 > 0.7) addCollider(b.x, b.z, b.w * 0.5, b.w * 0.5, y - 0.1, y + b.h + 0.6, 'rock');
    }
    if (parts.length) add('boulders', new THREE.Mesh(mergeGeometries(parts, false), rockMat));
  }

  // ---- bamboo: the east fence, the shishi-odoshi frame and the kakei (spout pipe); the tube itself moves
  const bambooMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true });
  bambooMat.name = 'GardenBamboo';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const shishiY = groundY(SHISHI.x, SHISHI.z);
  const pivot = V(SHISHI.x, shishiY + SHISHI.pivotY, SHISHI.z);
  const spout = V(SHISHI.x + 0.4, shishiY + 0.6, SHISHI.z);
  {
    const parts = [];
    const caneC = 0xb1aa68;
    let z0 = bankFoot(FENCE_X) + 0.05;
    let z1 = z0;
    while (z1 < 40 && (CAPE ? coastDist(FENCE_X, z1 + 0.2) > 0.45 : true) && z1 < DOMAIN.z1) z1 += 0.1;
    const span = z1 - z0;
    const posts = Math.max(2, Math.round(span / 1.8) + 1);
    for (let i = 0; i < posts; i += 1) {
      const z = z0 + (span * i) / (posts - 1);
      const y = groundY(FENCE_X, z);
      parts.push(cane(V(FENCE_X, y - 0.1, z), V(FENCE_X, y + 1.18, z), 0.045, 0x8f8650, 7, true));
    }
    for (const h of [0.32, 0.68, 1.02]) {
      for (let i = 0; i < posts - 1; i += 1) {
        const za = z0 + (span * i) / (posts - 1);
        const zb = z0 + (span * (i + 1)) / (posts - 1);
        parts.push(cane(V(FENCE_X - 0.05, groundY(FENCE_X, za) + h, za), V(FENCE_X - 0.05, groundY(FENCE_X, zb) + h, zb), 0.018, 0x9a9258));
      }
    }
    for (let z = z0 + 0.18; z < z1 - 0.1; z += 0.34) {
      const y = groundY(FENCE_X, z);
      const side = Math.round((z - z0) / 0.34) % 2 ? 0.04 : -0.1;
      parts.push(cane(V(FENCE_X + side, y - 0.05, z), V(FENCE_X + side, y + 1.08 + hash(z, 1) * 0.04, z), 0.016, new THREE.Color(caneC).multiplyScalar(0.85 + 0.3 * hash(z, 3))));
    }
    addCollider(FENCE_X, (z0 + z1) / 2, 0.12, span / 2, -3, 2, 'fence');
    // shishi-odoshi frame: two short posts with a pin through the tube's pivot
    for (const dz of [-0.075, 0.075]) parts.push(cane(V(pivot.x, shishiY - 0.05, pivot.z + dz), V(pivot.x, pivot.y + 0.06, pivot.z + dz), 0.03, 0x8a8350, 7, true));
    parts.push(cane(V(pivot.x, pivot.y, pivot.z - 0.11), V(pivot.x, pivot.y, pivot.z + 0.11), 0.008, 0x3a3428));
    // kakei: a post and a pipe out of the bank to just over the tube's mouth
    const postZ = SHISHI.z - 0.42;
    parts.push(cane(V(spout.x, groundY(spout.x, postZ) - 0.05, postZ), V(spout.x, spout.y + 0.06, postZ), 0.035, 0x8a8350, 7, true));
    parts.push(cane(V(spout.x, spout.y + 0.07, SHISHI.z - 0.85), V(spout.x, spout.y + 0.02, SHISHI.z - 0.02), 0.03, 0xa49d60, 7, true));
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), bambooMat);
    add('bamboo', mesh);
    addCollider(SHISHI.x + 0.05, SHISHI.z - 0.2, 0.5, 0.55, shishiY - 0.1, shishiY + 1.2, 'shishi-odoshi');
  }
  // the tube: pivots about z; +angle lifts the mouth (+x)
  const tube = new THREE.Group();
  tube.position.copy(pivot);
  {
    const L = SHISHI.len;
    const rear = -0.46 * L;
    const g = cane(V(rear, 0, 0), V(rear + L, 0, 0), SHISHI.r, 0xb8b06a, 8, false);
    const cap = paint(new THREE.CircleGeometry(SHISHI.r, 8).rotateY(-Math.PI / 2).translate(rear, 0, 0).toNonIndexed(), 0x8b8350);
    const node = cane(V(rear + L * 0.52, 0, 0), V(rear + L * 0.52 + 0.012, 0, 0), SHISHI.r * 1.08, 0x8b8350, 8, false);
    const mesh = new THREE.Mesh(mergeGeometries([g, cap, node], false), bambooMat);
    mesh.material = bambooMat;
    tube.add(mesh);
    tube.userData.mouth = rear + L;
    add('shishi_tube', mesh, tube);
    details.add(tube);
  }

  // ---- water: the pond surface + the basin's water, one material
  const waterNormal = assets?.texture?.('water_normal')?.clone?.() || null;
  if (waterNormal) {
    waterNormal.wrapS = THREE.RepeatWrapping;
    waterNormal.wrapT = THREE.RepeatWrapping;
    waterNormal.needsUpdate = true;
  }
  const pondMat = new THREE.MeshStandardMaterial({
    color: 0x0f2226, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.74, depthWrite: false,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.28, 0.28), envMapIntensity: 1.3,
  });
  pondMat.name = 'GardenPond';
  const basinY = groundY(BASIN.x, BASIN.z) - 0.04;
  {
    const shape = new THREE.Shape(offsetPoly(POND_POLY, 0.12).map(([x, z]) => new THREE.Vector2(x, z)));
    const geos = [new THREE.ShapeGeometry(shape, 2)];
    const disk = new THREE.CircleGeometry(BASIN.r * 0.6, 14);
    disk.translate(BASIN.x, BASIN.z, 0);
    geos.push(disk);
    const fixed = geos.map((g, gi) => {
      const p = g.attributes.position;
      const uv = g.attributes.uv;
      const y = gi === 0 ? WATER_Y_POND : basinY + BASIN.h - 0.035;
      for (let i = 0; i < p.count; i += 1) {
        const x = p.getX(i);
        const z = p.getY(i);
        p.setXYZ(i, x, y, z);
        uv.setXY(i, x / 1.1, z / 1.1);
      }
      const idx = g.index.array;
      const a = new THREE.Vector3().fromBufferAttribute(p, idx[0]);
      const b = new THREE.Vector3().fromBufferAttribute(p, idx[1]);
      const c = new THREE.Vector3().fromBufferAttribute(p, idx[2]);
      if (b.sub(a).cross(c.sub(a)).y < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      const n = g.attributes.normal;
      for (let i = 0; i < n.count; i += 1) n.setXYZ(i, 0, 1, 0);
      if (!g.attributes.tangent) g.computeTangents?.();
      return g.toNonIndexed();
    });
    for (const g of fixed) if (g.getAttribute('tangent')) g.deleteAttribute('tangent');
    const mesh = new THREE.Mesh(mergeGeometries(fixed, false), pondMat);
    mesh.userData.water = true;
    mesh.renderOrder = 2;
    add('pond', mesh);
  }

  // ---- the falls: ribbons with scrolling streaks (two drops off the bank, the stream into the pond, the kakei's
  // trickle and the basin's overflow), plus foam discs where water lands
  const streak = streakTexture();
  const fallsMat = new THREE.MeshStandardMaterial({
    color: 0xd8e4ea, map: streak, alphaMap: streak, transparent: true, depthWrite: false, roughness: 0.25, metalness: 0,
    side: THREE.DoubleSide, emissive: 0x1b2a34, emissiveIntensity: 1,
  });
  fallsMat.name = 'GardenFalls';
  const ribbon = (pts, width) => {
    const pos = [];
    const uv = [];
    const index = [];
    let s = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      if (i > 0) s += p.distanceTo(pts[i - 1]);
      const w = typeof width === 'function' ? width(i / (pts.length - 1)) : width;
      const q = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]);
      const side = new THREE.Vector3(-q.z, 0, q.x);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      side.normalize().multiplyScalar(w / 2);
      pos.push(p.x - side.x, p.y, p.z - side.z, p.x + side.x, p.y, p.z + side.z);
      uv.push(0, s * 1.4, 1, s * 1.4);
      if (i > 0) { const a = (i - 1) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return g.toNonIndexed();
  };
  {
    const fx = FALLS.x;
    const pts = [];
    const wet = 0.035;
    for (let z = 11.82; z <= 12.45; z += 0.07) pts.push(V(fx + Math.sin(z * 3) * 0.04, channelY(z) + wet, z));
    for (let u = 0.1; u <= 1.001; u += 0.1) pts.push(V(fx, -0.62 + wet - 0.72 * u * u, 12.45 + 0.17 * u));
    for (let z = 12.7; z <= 13.3; z += 0.08) pts.push(V(fx - 0.02, channelY(z) + wet, z));
    for (let u = 0.1; u <= 1.001; u += 0.1) pts.push(V(fx - 0.03, -1.42 + wet - 1.12 * u * u, 13.3 + 0.24 * u));
    for (let z = 13.62; z <= 14.62; z += 0.1) pts.push(V(fx - 0.04 - (z - 13.6) * 0.06, Math.max(WATER_Y_POND + 0.012, channelY(z) + wet), z));
    const main = ribbon(pts, (t) => 0.36 + 0.3 * smooth(0.35, 0.6, t));
    // the kakei's trickle into the tube's mouth (at rest) and the basin overflow toward the pond
    const mouthRest = V(pivot.x + Math.cos(0.49) * tube.userData.mouth, pivot.y + Math.sin(0.49) * tube.userData.mouth, pivot.z);
    const tr = [];
    for (let u = 0; u <= 1.001; u += 0.25) tr.push(V(spout.x + 0.02 * u, spout.y - 0.005 - (spout.y - mouthRest.y - 0.01) * u * u, SHISHI.z - 0.01));
    const trickle = ribbon(tr, 0.022);
    const trickle2 = ribbon(tr.map((p) => p.clone().add(V(0.0001, 0, 0.0001))), 0.022).rotateY(0);
    const over = [];
    for (let u = 0; u <= 1.001; u += 0.2) over.push(V(BASIN.x + BASIN.r * 0.95 + u * 0.18, basinY + BASIN.h - 0.02 - u * u * 0.25, BASIN.z + 0.04));
    const overflow = ribbon(over, 0.05);
    const mesh = new THREE.Mesh(mergeGeometries([main, trickle, trickle2, overflow], false), fallsMat);
    mesh.userData.water = true;
    mesh.renderOrder = 3;
    add('falls', mesh, details);
  }
  const pourMesh = (() => {
    const g = ribbon([V(0, 0, 0), V(0.03, -0.05, 0), V(0.06, -0.14, 0)], 0.035);
    const mesh = new THREE.Mesh(g, fallsMat);
    mesh.userData.water = true;
    mesh.visible = false;
    mesh.renderOrder = 3;
    details.add(mesh);
    return mesh;
  })();
  const foam = foamTexture();
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xc8d6de, map: foam, transparent: true, depthWrite: false, opacity: 0.8, fog: true });
  foamMat.name = 'GardenFoam';
  {
    const discs = [[FALLS.x, -1.4 + 0.045, 12.68, 0.34], [FALLS.x - 0.03, channelY(13.62) + 0.05, 13.62, 0.42], [FALLS.x - 0.1, WATER_Y_POND + 0.015, 14.62, 0.55], [BASIN.x + BASIN.r + 0.2, WATER_Y_POND + 0.014, BASIN.z + 0.04, 0.22]];
    const geos = discs.map(([x, y, z, r]) => {
      const g = new THREE.CircleGeometry(r, 16).rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      return g.toNonIndexed();
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), foamMat);
    mesh.userData.water = true;
    mesh.renderOrder = 4;
    add('foam', mesh, details);
  }

  // ---- lantern glow (the toro's fire box)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd4a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
  const toroY = groundY(TORO.x, TORO.z);
  glow.position.set(TORO.x, toroY + TORO.h * 0.64, TORO.z);
  glow.scale.setScalar(0.62);
  glow.userData.water = true; // ground-truth probe: not a floor
  details.add(glow);
  stats.calls += 1;

  // ---- colliders for the static props (models arrive later; their footprints are known now)
  addCollider(TORO.x, TORO.z, 0.34, 0.34, toroY - 0.1, toroY + TORO.h, 'lantern');
  for (const t of PINES) addCollider(t.x, t.z, 0.36 * t.h, 0.36 * t.h, // the scan's rock base is ~0.7 h across
     groundY(t.x, t.z) - 0.1, groundY(t.x, t.z) + t.h, 'pine');
  for (const t of MAPLES) addCollider(t.x, t.z, 0.3, 0.3, groundY(t.x, t.z) - 0.1, groundY(t.x, t.z) + t.h, 'maple');
  const bedStones = BED_STONES.map(([type, x, z, w, h, d, yaw]) => {
    const hx = Math.abs(Math.cos(yaw)) * w / 2 + Math.abs(Math.sin(yaw)) * d / 2;
    const hz = Math.abs(Math.sin(yaw)) * w / 2 + Math.abs(Math.cos(yaw)) * d / 2;
    const base = GRAVEL_Y - Math.min(0.12, h * 0.15);
    if (h > 0.2) addCollider(x, z, hx * 0.92, hz * 0.92, base - 0.1, base + h + 0.5, 'stone');
    return { type, x, z, w, h, d, yaw, base, tint: 0.22 + 0.06 * hash(x, z) };
  });
  // falls and pond-rim stones (scan rocks)
  const extraStones = [];
  const fx = FALLS.x;
  for (const [type, x, z, w, h, d, yaw, dy] of [
    ['c', fx, 12.36, 0.78, 0.28, 0.42, 0.1, -0.2], ['a', fx - 0.62, 12.5, 0.75, 0.95, 0.7, 1.2, -0.45], ['b', fx + 0.64, 12.45, 0.7, 0.85, 0.7, 2.4, -0.4],
    ['c', fx - 0.02, 13.24, 0.86, 0.3, 0.42, -0.2, -0.2], ['d', fx - 0.66, 13.3, 0.72, 1.0, 0.7, 0.5, -0.5], ['a', fx + 0.7, 13.25, 0.8, 1.05, 0.75, 2.8, -0.55],
    ['b', fx - 0.65, 14.3, 0.6, 0.45, 0.55, 0.9, -0.15], ['d', fx + 0.62, 14.25, 0.55, 0.5, 0.5, 2.0, -0.15],
  ]) extraStones.push({ type, x, z, w, h, d, yaw, base: groundY(x, z) + dy, tint: 0.3 + 0.06 * hash(x, z) });
  for (let i = 0; i < POND_POLY.length; i += 3) {
    const [x, z] = POND_POLY[i];
    if (Math.abs(x - (fx - 0.1)) < 0.75 && z < POND.z) continue;
    if (Math.hypot(x - BASIN.x, z - BASIN.z) < 0.55) continue;
    const w = 0.32 + hash(x, z) * 0.32;
    extraStones.push({ type: 'abcd'[i % 4], x, z, w, h: w * 0.55, d: w * 0.8, yaw: hash(z, x) * 6.28, base: groundY(x, z) - w * 0.2, tint: 0.36 + 0.1 * hash(x * 2, z) });
  }
  const allStones = [...bedStones, ...extraStones];

  // ---- models (arrive after boot)
  const loaded = { stones: false, bonsai: false, maple: false, toro: false, koi: false };
  const once = (id, fn) => {
    if (!assets?.whenReady) return;
    assets.whenReady(id).then((gltf) => { if (gltf) fn(gltf); });
  };
  once('garden_stones', (gltf) => {
    for (const type of ['a', 'b', 'c', 'd']) {
      const node = gltf.scene.getObjectByName(`stone_${type}`);
      const p = proto(node);
      if (!p) continue;
      const list = allStones.filter((s) => s.type === type);
      if (!list.length) continue;
      p.parts.forEach((part) => stoneMats.add(part.material));
      instanced(p, list, (s, m) => compose(m, s.x, s.base, s.z, s.yaw, s.w / p.size.x, s.h / p.size.y, s.d / p.size.z), {
        color: (s, c) => c.setRGB(s.tint, s.tint * 0.98, s.tint * 1.02),
      }).forEach((mesh) => add(`stones_${type}`, mesh));
      if (type === 'a') {
        const mat = p.parts[0].material;
        for (const target of [rockMat, granite]) {
          if (!mat.map) continue;
          target.map = mat.map;
          target.normalMap = mat.normalMap || null;
          target.needsUpdate = true;
        }
        if (mat.map) { mat.map.wrapS = THREE.RepeatWrapping; mat.map.wrapT = THREE.RepeatWrapping; mat.map.needsUpdate = true; }
        if (mat.normalMap) { mat.normalMap.wrapS = THREE.RepeatWrapping; mat.normalMap.wrapT = THREE.RepeatWrapping; mat.normalMap.needsUpdate = true; }
      }
    }
    loaded.stones = true;
  });
  once('garden_bonsai', (gltf) => {
    const p = proto(gltf.scene);
    if (!p) return;
    // the scan's trunk + rock base share one pale material: weather it to dark bark / basalt so the base reads as a
    // garden rock half sunk in the moss, not a pot
    p.parts.forEach((part) => { if (/Bonsai/.test(part.material.name)) part.material.color.setRGB(0.36, 0.33, 0.31); });
    instanced(p, PINES, (t, m) => {
      const s = t.h / p.size.y;
      return compose(m, t.x, groundY(t.x, t.z) - 0.1 * t.h, t.z, t.yaw, s, s, s);
    }, { color: (t, c) => c.setScalar(0.85 + 0.2 * hash(t.x, t.z)) }).forEach((mesh) => add('pines', mesh));
    loaded.bonsai = true;
  });
  once('garden_maple', (gltf) => {
    const p = proto(gltf.scene);
    if (!p) return;
    instanced(p, MAPLES, (t, m) => {
      const s = t.h / p.size.y;
      return compose(m, t.x, groundY(t.x, t.z) - 0.04, t.z, t.yaw, s, s, s);
    }).forEach((mesh) => add('maples', mesh));
    loaded.maple = true;
  });
  once('garden_toro', (gltf) => {
    const p = proto(gltf.scene);
    if (!p) return;
    instanced(p, [TORO], (t, m) => {
      const s = t.h / p.size.y;
      return compose(m, t.x, toroY - 0.02, t.z, t.yaw, s, s, s);
    }).forEach((mesh) => {
      // the scan is very mossy: keep a hint of the moss, mostly weathered granite grey
      const mat = mesh.material;
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
{ float l = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15)); diffuseColor.rgb = mix(vec3(l) * vec3(1.0, 0.98, 0.94), diffuseColor.rgb, 0.28) * 0.85; }`);
      };
      mat.customProgramCacheKey = () => 'garden-toro';
      mat.needsUpdate = true;
      add('toro', mesh);
    });
    loaded.toro = true;
  });
  const koi = { mesh: null, fish: [], uTime: { value: 0 } };
  if (KOI) once('garden_koi', (gltf) => {
    const p = proto(gltf.scene);
    if (!p) return;
    const part = p.parts[0];
    // body along the longer horizontal axis, 0.42 m long
    const along = p.size.x >= p.size.z ? 'x' : 'z';
    if (along === 'z') part.geometry.rotateY(Math.PI / 2);
    part.geometry.computeBoundingBox();
    const bb = part.geometry.boundingBox;
    const len = bb.max.x - bb.min.x;
    const mat = part.material.clone();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uKoiT = koi.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uKoiT;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
  float u = (transformed.x - (${bb.min.x.toFixed(4)})) / ${len.toFixed(4)}; // 0 = one end, 1 = the other
  float tail = 1.0 - u;
  float w = pow(clamp(tail, 0.0, 1.0), 1.6);
  transformed.z += sin(uKoiT * 5.5 + ph - u * 5.0) * w * ${(len * 0.1).toFixed(4)};
}`);
    };
    mat.customProgramCacheKey = () => 'garden-koi';
    const N = 5;
    const mesh = new THREE.InstancedMesh(part.geometry, mat, N);
    mesh.frustumCulled = false;
    const colors = [[1, 1, 1], [1, 0.92, 0.85], [0.95, 1, 1], [1, 0.85, 0.7], [0.9, 0.9, 0.95]];
    for (let i = 0; i < N; i += 1) {
      mesh.setColorAt(i, new THREE.Color(...colors[i]));
      koi.fish.push({ a: hash(i, 2) * 6.28, r: 0.42 + 0.3 * hash(i, 5), speed: (0.18 + 0.1 * hash(i, 8)) * (i % 2 ? 1 : -1), depth: 0.12 + 0.12 * hash(i, 9), scale: (0.36 + 0.14 * hash(i, 4)) / len, wob: hash(i, 6) * 6 });
    }
    mesh.instanceColor.needsUpdate = true;
    koi.mesh = mesh;
    koi.len = len;
    add('koi', mesh, details);
    loaded.koi = true;
  });

  // ---- the forest: no trees/cover in the garden or the sea, a few rocks along the bank further east
  patchForest({
    exclude: (x, z) => (GARDEN && inDomain(x, z)) || (CAPE && coastDist(x, z) < 1.1),
    // the cape: the stock scatter is sparse south of z 38 (band 1, 7.2 m); thicken it so the cape reads as forest from
    // the garden. Mostly 4-tri impostors (band 2); the nearest row gets band 1 (full pines inside the LOD radius).
    trees: CAPE ? (() => {
      const out = [];
      for (let x = 6; x < 58; x += 3.6) {
        for (let z = 33; z < 74; z += 3.6) {
          const px = x + (hash(x * 1.3, z) - 0.5) * 3;
          const pz = z + (hash(z * 0.7, x * 2.1) - 0.5) * 3;
          const cd = coastDist(px, pz);
          if (cd < 1.8 || inDomain(px, pz) || hash(px * 4.1, pz * 2.7) > 0.72) continue;
          const roll = hash(px * 1.7, pz * 3.3);
          const near = Math.hypot(px - 5, pz - 23) < 22;
          out.push({ x: px, z: pz, h: (near ? 6.4 : 7.6) * (0.72 + roll * 0.62) * (0.75 + 0.25 * Math.min(1, cd / 8)), r: 0.85 + roll * 0.7, trunk: 0.22 + roll * 0.16, spin: roll * 6.2, band: near ? 1 : 2 });
        }
      }
      return out;
    })() : [],
    cover: (() => {
      const out = [];
      for (let x = 13; x < 34; x += 1.4) {
        const z = lerp(bankTop(x), bankFoot(x), 0.35 + 0.4 * hash(x, 3));
        if (hash(x, 9) > 0.7) continue;
        out.push({ name: hash(x, 5) < 0.5 ? 'rock_a' : 'rock_b', x, z, seed: x * 13.1 });
      }
      return out;
    })(),
  });

  // ---- ground model (walk.js) -- the rendered surfaces: terrain triangles, gravel, kerb, stepping stones
  function groundAt(x, z) {
    if (!inDomain(x, z)) return null;
    let y = hAt(x, z);
    if (y == null) return null;
    const sb = sdBed(x, z);
    if (sb >= -KERB_W && sb <= 0.002) y = Math.max(y, KERB_Y);
    else if (sb > 0) y = Math.max(y, GRAVEL_Y);
    for (const st of STONES_STEP) {
      if (Math.abs(x - st.x) > st.r * 1.3 || Math.abs(z - st.z) > st.r * 1.3) continue;
      if (inPoly(st.poly, x, z)) y = Math.max(y, st.top);
    }
    return y;
  }
  function blocked(x, z) {
    if (!inDomain(x, z)) return null;
    const pd = pathAt(x, z).d;
    if (pd < HW - 0.25) return null;
    if (pd < HW) {
      // the path's outer band: walkable unless the shoulder there is steeper than ~42 deg
      const e = 0.12;
      const gx = (hAt(x + e, z) ?? 0) - (hAt(x - e, z) ?? 0);
      const gz = (hAt(x, z + e) ?? 0) - (hAt(x, z - e) ?? 0);
      return Math.hypot(gx, gz) / (2 * e) > 0.9 ? 'bank' : null;
    }
    if (z < bankTop(x) - 0.25) return x > CLIFF_LINE + 0.45 && x < 3.3 ? null : 'bank';
    if (z < bankFoot(x) + 0.3) return 'bank';
    const cd = CAPE ? coastDist(x, z) : x - CLIFF_LINE;
    if (cd < 0.75) return 'sea edge';
    if (x > FENCE_X - 0.3) return 'fence';
    if (sdPond(x, z) > -0.3) return 'pond';
    return null;
  }
  function isTerrace(x, z, feet) {
    if (!inDomain(x, z) || z < bankFoot(x) + 0.6 || blocked(x, z)) return false;
    const g = groundAt(x, z);
    return g != null && Math.abs(g - feet) < 0.03;
  }

  // ---- animation: shishi-odoshi cycle, koi, falls
  const REST = 0.49;
  const TIP = -0.33;
  const shishi = { phase: 'fill', t: 2 + Math.random() * 3, angle: REST, clacks: 0 };
  const FILL = 6.2;
  let onClack = null;
  const tmpM = new THREE.Matrix4();
  const center = new THREE.Vector3(5, -1.5, 22);
  const eye = new THREE.Vector3();
  let time = 0;
  let near = true;
  function update(dt, camera) {
    if (!FX) return;
    time += dt;
    if (camera) {
      camera.getWorldPosition(eye);
      near = eye.distanceTo(center) < CULL;
      details.visible = near;
    }
    if (!near) return;
    streak.offset.y -= dt * 1.7;
    foam.rotation += dt * 0.25;
    foam.center.set(0.5, 0.5);
    if (waterNormal) { waterNormal.offset.x += dt * 0.012; waterNormal.offset.y += dt * 0.008; }
    // shishi-odoshi
    shishi.t += dt;
    let pour = false;
    if (shishi.phase === 'fill') {
      shishi.angle = REST - 0.08 * (shishi.t / FILL) ** 2;
      if (shishi.t >= FILL) { shishi.phase = 'tip'; shishi.t = 0; }
    } else if (shishi.phase === 'tip') {
      const k = Math.min(1, shishi.t / 0.45);
      shishi.angle = lerp(REST - 0.08, TIP, k * k);
      pour = k > 0.6;
      if (k >= 1) { shishi.phase = 'pour'; shishi.t = 0; }
    } else if (shishi.phase === 'pour') {
      shishi.angle = TIP;
      pour = true;
      if (shishi.t >= 0.6) { shishi.phase = 'back'; shishi.t = 0; }
    } else if (shishi.phase === 'back') {
      const k = Math.min(1, shishi.t / 0.24);
      shishi.angle = lerp(TIP, REST, k * k);
      if (k >= 1) {
        shishi.phase = 'bounce'; shishi.t = 0; shishi.clacks += 1;
        onClack?.(new THREE.Vector3(pivot.x - SHISHI.len * 0.42, pivot.y - 0.2, pivot.z));
      }
    } else if (shishi.phase === 'bounce') {
      shishi.angle = REST - Math.abs(Math.sin(shishi.t * 18)) * 0.05 * Math.exp(-shishi.t * 9);
      if (shishi.t > 0.5) { shishi.phase = 'fill'; shishi.t = 0; }
    }
    tube.rotation.z = shishi.angle;
    pourMesh.visible = pour;
    if (pour) {
      const m = tube.userData.mouth;
      pourMesh.position.set(pivot.x + Math.cos(shishi.angle) * m, pivot.y + Math.sin(shishi.angle) * m, pivot.z);
    }
    // koi
    if (koi.mesh) {
      koi.uTime.value = time;
      koi.fish.forEach((f, i) => {
        f.a += (f.speed * dt) / (POND.rx * f.r);
        const r = f.r * (1 + 0.12 * Math.sin(time * 0.3 + f.wob));
        const x = POND.x + Math.cos(f.a) * POND.rx * r * 0.85;
        const z = POND.z + Math.sin(f.a) * POND.rz * r * 0.85;
        const dx = -Math.sin(f.a) * Math.sign(f.speed) * POND.rx;
        const dz = Math.cos(f.a) * Math.sign(f.speed) * POND.rz;
        const yaw = Math.atan2(-dz, dx) + KOI_YAW;
        compose(tmpM, x, WATER_Y_POND - f.depth + 0.03 * Math.sin(time * 0.7 + f.wob), z, yaw, f.scale, f.scale, f.scale);
        koi.mesh.setMatrixAt(i, tmpM);
      });
      koi.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  scene.add(group);
  const spots = {
    yardEdge: [1.0, 9.9], pathTop: [1.5, 11.2], pathTurn: [5.74, 13.2], pathFoot: [2.3, 16.45], tsukubaiView: [3.0, 16.9],
    toro: [3.0, 18.0], westStrip: [-0.2, 22.6], southView: [4.65, 30.35], eastStrip: [10.0, 24.2], pondSouth: [6.6, 18.55],
    bedEdge: [1.2, 20.6],
  };
  stats.ms = Math.round(performance.now() - t0);
  stats.rakeBytes = field?.bytes || 0;
  stats.colliders = colliders.length;
  stats.boulders = boulders.length;
  stats.stones = allStones.length;
  return {
    group, colliders, groundAt, blocked, isTerrace, update, stats, spots, loaded, shishi,
    terrainAt: hAt, gardenH, pathAt, sdBed, sdPond, coastDist, G, path: PATH, cape: CAPE,
    sound: {
      falls: new THREE.Vector3(FALLS.x, -1.3, 13.2),
      trickle: new THREE.Vector3(spout.x, spout.y, SHISHI.z),
    },
    set onClack(fn) { onClack = fn; },
  };
}
const KOI_YAW = 0;
