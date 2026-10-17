// Garden pass: the land south of the house. With the garden on (default; ?garden=0 = the old scene) the plateau ends
// in a rocky bank at z ~11.6..14.2 and the land below sits 2.4 m lower (GARDEN_G). With the cape on (default;
// ?cape=0 keeps the old straight west coast) the coast bends east south of the garden and runs out to a forested
// tip at about (30, 68), so looking south from the garden it is mostly open sea with the cape on the left.
// Pure maths, no three.js: forest.js, garden.js, water.js and the tests all share it.
// Compass (see the notes in garden.js): +x east (inland), -x west (the sea), -z north, +z south.
const params = typeof location === 'undefined' ? new URLSearchParams('') : new URLSearchParams(location.search);
const legacyForest = ['legacy', 'old'].includes(params.get('forest'));
export const GARDEN = params.get('garden') !== '0';
export const CAPE = GARDEN && params.get('cape') !== '0' && !legacyForest;
export const CLIFF_LINE = -1.78;
export const GARDEN_G = -2.4; // garden terrace level (the sea is at -8: a 5.6 m drop is still a swim, not a fall death)
export const CAPE_Z = 15.5; // south of this the sea may run east of the old cliff line (water.js clamp)

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise1(t) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, 7.3) * (1 - u) + hash(i + 1, 7.3) * u;
}

// Coast, north to south down the west side, round the tip, then east. Land is to the left walking along it
// (north/east of the line). The garden stretch (z < 36, x < 15) is kept smooth; the cape gets a noisy shoreline.
const KEY = [
  [CLIFF_LINE, -400], [CLIFF_LINE, 15], [CLIFF_LINE, 19.5], [-1.6, 23], [-0.9, 26.2], [0.6, 29.0], [2.8, 31.2],
  [5.6, 32.9], [8.6, 34.0], [11.6, 35.0], [14.6, 36.6], [17.4, 39.6], [19.8, 43.8], [21.8, 48.8], [23.4, 54.2],
  [24.6, 59.4], [25.8, 63.6], [27.6, 66.6], [30.0, 67.9], [32.1, 66.5], [33.7, 62.6], [35.6, 57.4], [38.4, 51.6],
  [42.4, 45.8], [47.6, 40.6], [54.0, 36.4], [62.0, 33.0], [72.0, 30.4], [85.0, 28.4], [100, 27.0], [120, 26.0],
  [160, 25.6], [400, 25.6],
];
function buildCoast() {
  if (!CAPE) return [[CLIFF_LINE, -400], [CLIFF_LINE, 400]];
  const out = [];
  let s = 0;
  for (let k = 0; k < KEY.length - 1; k += 1) {
    const [ax, az] = KEY[k];
    const [bx, bz] = KEY[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = len > 100 ? 1 : Math.max(1, Math.ceil(len / 1.6));
    for (let i = 0; i < n; i += 1) {
      const t = i / n;
      let x = ax + (bx - ax) * t;
      let z = az + (bz - az) * t;
      const garden = x < 15 && z < 36.4;
      const amp = len > 100 || z < 19.6 ? 0 : (garden ? 0.22 : 1.1) * smooth(19.6, 22, z);
      if (amp > 0) {
        const off = (vnoise1((s + len * t) / 3.1) - 0.5) * 2 * amp + (vnoise1((s + len * t) / 1.1 + 40) - 0.5) * amp * 0.5;
        // left normal of (dx, dz) is (dz, -dx) / len: positive = inland
        x += ((bz - az) / len) * off;
        z += (-(bx - ax) / len) * off;
      }
      out.push([x, z]);
    }
    s += len;
  }
  out.push(KEY[KEY.length - 1]);
  return out;
}
export const COAST = buildCoast();

// segment grid for quick distance queries
const CELL = 6;
const grid = new Map();
for (let k = 0; k < COAST.length - 1; k += 1) {
  const [ax, az] = COAST[k];
  const [bx, bz] = COAST[k + 1];
  if (Math.hypot(bx - ax, bz - az) > 60) continue; // the two long ends are handled analytically
  const i0 = Math.floor((Math.min(ax, bx) - 8) / CELL);
  const i1 = Math.floor((Math.max(ax, bx) + 8) / CELL);
  const j0 = Math.floor((Math.min(az, bz) - 8) / CELL);
  const j1 = Math.floor((Math.max(az, bz) + 8) / CELL);
  for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) {
    const key = i * 4096 + j;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(k);
  }
}
function segDist(px, pz, k) {
  const [ax, az] = COAST[k];
  const [bx, bz] = COAST[k + 1];
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
// is (x, z) on the land side of the coast? (ray cast to -x: the coast is a single polyline from z=-400 to x=+400)
export function onLand(x, z) {
  if (!CAPE) return x >= CLIFF_LINE;
  if (z < 15) return x >= CLIFF_LINE;
  if (z > 70) return false;
  let inside = false;
  // closed polygon: coast + far corners (400,-400) back to the start
  const n = COAST.length;
  for (let k = 0; k < n; k += 1) {
    const [ax, az] = COAST[k];
    const [bx, bz] = k + 1 < n ? COAST[k + 1] : [400, -400];
    if ((az > z) !== (bz > z)) {
      const xc = ax + ((z - az) / (bz - az)) * (bx - ax);
      if (xc > x) inside = !inside;
    }
  }
  // (400,-400) -> (CLIFF_LINE,-400) closes along z=-400, never crossed for z > -400
  return inside;
}
// signed distance to the coast: + on land, - at sea (exact within ~8 m of the coast, clamped to 8 beyond)
export function coastDist(x, z) {
  if (!CAPE) return x - CLIFF_LINE;
  let best = 8;
  if (z < 13) best = Math.min(best, Math.abs(x - CLIFF_LINE));
  else {
    const list = grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
    if (list) for (const k of list) best = Math.min(best, segDist(x, z, k));
    if (x > 150) best = Math.min(best, Math.abs(z - 25.6));
  }
  return onLand(x, z) ? best : -best;
}

// the bank: plateau (y 0) north of bankTop, GARDEN_G south of bankFoot
export function bankTop(x) {
  return x < 13 ? 11.6 : 11.6 + smooth(13, 20, x) * (1.4 * Math.sin(x * 0.09 - 1.2) + 0.8 * Math.sin(x * 0.23 + 1) + 0.6);
}
export function bankFoot(x) { return bankTop(x) + (x < 13 ? 2.6 : 2.6 + smooth(13, 20, x) * 0.8); }

// Base height of the land (before the forest's soft undulation): 0 = the old plateau (-0.04 for forest ground).
export function baseY(x, z) {
  if (!GARDEN) return 0;
  const t = smooth(bankTop(x), bankFoot(x), z);
  if (t <= 0) return 0;
  let y = GARDEN_G * t;
  if (CAPE) y -= 1.7 * smooth(40, 66, z) * t; // the land falls away toward the tip
  return y;
}
// coastal roll-off for the forest floor: the last few metres before the edge round down
export function rollOff(x, z) {
  if (!CAPE || z < 15) return 0;
  const d = coastDist(x, z);
  return -0.7 * (1 - smooth(0, 5, d));
}

// Forest floor grid lines (shared with forest.js so the garden terrain meets the forest ground vertex for vertex).
export function span(a, b, step) {
  const n = Math.max(1, Math.round((b - a) / step));
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / n);
}
export const FOREST_XS = [...span(-1.55, 3.7, 1.3), ...span(3.7, 60, 1.5), 60];
export const FOREST_ZS = CAPE
  ? [...span(-60, -4.1, 1.5), ...span(-4.1, 11.3, 1.4), ...span(11.3, 60, 1.5), ...span(60, 72, 2), 72]
  : [...span(-60, -4.1, 1.5), ...span(-4.1, 11.3, 1.4), ...span(11.3, 60, 1.5), 60];
// The garden's own terrain replaces the forest floor in this rectangle (plus the strip between the yard and z 11.3,
// x < 3.7, which the forest never covered). Edges are forest grid lines.
const pick = (list, v) => list.reduce((best, a) => (Math.abs(a - v) < Math.abs(best - v) ? a : best), list[0]);
export const DOMAIN = { x0: CLIFF_LINE, x1: pick(FOREST_XS, 12.6), z0: 11.3, z1: pick(FOREST_ZS, 37.2), yardZ: 10.2, stripX: 3.7 };
export function inDomain(x, z) {
  if (!GARDEN) return false;
  if (x < DOMAIN.x0 - 0.01 || x > DOMAIN.x1) return false;
  if (z >= DOMAIN.z0) return z <= DOMAIN.z1;
  return z >= DOMAIN.yardZ && x <= DOMAIN.stripX;
}
