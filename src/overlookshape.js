// Overlook pass: plan-view shape of the wooded summit behind the east crag overlook (no three.js, so forest.js,
// crag.js, overlookwoods.js and bear.js can all import it). The old crag was a 2 m slab whose last 1.6 m stood up as a
// bare wall behind the overlook with nothing past it; the summit replaces that wall with a block of forest.
//
// Heights are relative to the crag deck (deckY). The bear's ground (arena, path, den clearing) is flat at deckY; the
// woods rise behind the den so the view east ends in trees and ground, not sky.

// summit outline, counter-clockwise from the south end of the climb lip (x 3.42 is the top of the climb face)
export const SUMMIT = [
  [3.42, -3.3], [4.7, -3.6], [6.4, -4.7], [8.4, -6.6], [10.9, -8.0], [14.4, -8.9], [18.2, -8.6], [20.5, -6.6],
  [21.0, -2.0], [20.8, 3.6], [19.4, 7.2], [15.6, 8.5], [11.6, 8.0], [8.9, 6.3], [6.5, 4.2], [4.6, 3.25], [3.42, 2.95],
];
// the massif under it reaches the ground only east of x 13 (west of that the summit overhangs on the crag pillar), so
// the cell's back gate and the clearing keep their trees
export const FOOT_X = 13;
export const DEN = { x: 11.7, z: 1.0, yaw: -Math.PI / 2 };   // bear den: a clearing inside the woods, facing west
export const LIP = { x: 3.5, z0: -2.85, z1: -1.2 };           // climb lip (the top edge of the face) on the summit

export function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// distance to the outline (positive inside); skipLip leaves out the climb lip edge (x 3.42)
export function edgeDist(poly, x, z, skipLip = false) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ax, az] = poly[j];
    const [bx, bz] = poly[i];
    if (skipLip && ax < 3.5 && bx < 3.5) continue;
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return inPoly(poly, x, z) ? best : -best;
}

// nearest point on the outline
export function clampToPoly(poly, x, z) {
  if (inPoly(poly, x, z)) return [x, z];
  let best = Infinity;
  let out = [x, z];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ax, az] = poly[j];
    const [bx, bz] = poly[i];
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const px = ax + vx * t;
    const pz = az + vz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; out = [px, pz]; }
  }
  return out;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
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

// ground height over deckY before the bear's flat is cut in: a gentle rise behind the den plus soft lumps
function baseRise(x, z) {
  return 3.4 * smooth(12.6, 19.5, x) + (vnoise(x * 0.35 + 4.1, z * 0.35 - 2.3) - 0.5) * 0.5 * smooth(8.5, 12, x);
}

// The open part the bear always has: the rock behind the lip, a path into the trees and the den clearing.
export function bearOpen(x, z) {
  if (x < 3.42) return false;
  if (x < 8.3 && z > -3.2 && z < 3.0) return true;   // arena
  if (x >= 8.3 && x < DEN.x && Math.abs(z - (0.2 + (x - 8.3) * 0.24)) < 1.35) return true;   // path
  return Math.hypot(x - DEN.x, z - DEN.z) < 2.3;   // den clearing
}

// The bear's ground on the summit: everything level enough (it also walks the woods, between the trunks; crag.js
// cuts those out), 0.45 m in from the edge.
export function bearGround(x, z) {
  if (x < 3.42 || !inPoly(SUMMIT, Math.max(x, 3.43), z)) return false;
  // where the nose crown joins (|z| < 1) the lip edge isn't an edge: the bear walks on and off the crown there
  if (edgeDist(SUMMIT, x, z, Math.abs(z) < 1.0) < 0.45) return false;
  return bearOpen(x, z) || baseRise(x, z) <= 0.25;
}

// summit ground height over deckY: flat (0) wherever the bear walks, rising behind the den
export function summitRise(x, z) {
  if (bearOpen(x, z)) return 0;
  return Math.max(0, baseRise(x, z) - 0.25);
}

// trees stay off the open ground (arena, path, den), the top-out and the first 0.7 m of the edge
export function treeOk(x, z) {
  if (!inPoly(SUMMIT, x, z) || edgeDist(SUMMIT, x, z) < 0.7) return false;
  if (x < 6.6) return false;
  if (x < 9.0 && z > -3.6 && z < 3.4) return false;
  if (x >= 8.3 && x < DEN.x + 0.5 && Math.abs(z - (0.2 + (x - 8.3) * 0.24)) < 1.9) return false;
  return Math.hypot(x - DEN.x, z - DEN.z) > 2.8;
}

// inside the massif footprint at ground level (forest.js drops ground trees and cover there)
export function inMassif(x, z, margin = 0) {
  if (x < FOOT_X - margin) return false;
  return edgeDist(SUMMIT, Math.max(x, FOOT_X), z) > -margin;
}
