// Notch climbing (forest pass): the big stone ladder from the room corner down into the sea cave is replaced by small
// carved hand notches, and a second, hidden-ish line of worn notches goes down the cliff face from the yard edge to a
// rock shelf by the cave mouth. Same grab / hand-over-hand logic as the ladder (main.js treats both as `shaft`
// ladders). ?ladders=old (or ?legacy=ladders) keeps the old ladder and no cliff route.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { legacy } from './flags.js';
import { proxyMaterial } from './assets.js';

export const NOTCHES = new URLSearchParams(location.search).get('ladders') !== 'old' && !legacy('ladders');

// Recessed holds on the cave's east wall, under the start cell and clear of the tunnel (z 1.23+).
// The face is faceX. This does not open the cell floor.
export const SHAFT_SLOT = {
  x0: 3.7,
  faceX: 4.4,
  x1: 5.1,
  z0: 0.48,
  z1: 0.9,
};

const cutMat = new THREE.MeshStandardMaterial({ color: 0x26221d, roughness: 1 });
const wornMat = new THREE.MeshStandardMaterial({ color: 0x766e64, roughness: 0.95 });
cutMat.name = 'notch_cut';
wornMat.name = 'notch_worn';

// One hold: a dark recess flush with the wall (only its front face shows, 4 mm proud) plus a thin worn lip on top.
function holdParts(cuts, lips, surfaceX, y, z, w = 0.12) {
  const cut = new THREE.BoxGeometry(0.034, 0.056, w);
  cut.translate(surfaceX + 0.013, y, z);
  cuts.push(cut);
  const lip = new THREE.BoxGeometry(0.03, 0.011, w * 1.08);
  lip.translate(surfaceX + 0.004, y + 0.033, z);
  lips.push(lip);
}

function mergedMesh(list, material, name) {
  if (!list.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
  list.forEach((g) => g.dispose());
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.raycast = () => {};
  return mesh;
}

// invisible grab proxy for one hold (what main.js's closestRungToHand / pointer grab look for)
function proxy(ladder, x, y, z, rungs) {
  const rung = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.34), proxyMaterial);
  rung.position.set(x, y, z);
  rung.userData = { type: 'rung', ladder, index: rungs.length };
  ladder.add(rung);
  rungs.push(y);
  return rung;
}

// The old ladder group is emptied and reused as the east-wall climb. Call before the rock material swap.
// No rib and no cleft back-plate: the cave-mouth slot stays a hidden void, and the holds are pockets in the east wall.
export function notchShaft({ scene, rock, ladder, shaftVoid, beachTop, WATER_Y, caveTop }) {
  ladder.children.slice().forEach((child) => ladder.remove(child));
  if (shaftVoid) shaftVoid.visible = false;
  const { x0, faceX, x1, z0, z1 } = SHAFT_SLOT;
  const zc = (z0 + z1) / 2;
  ladder.position.set(faceX, 0, zc);
  const yBot = WATER_Y - 0.35;
  // Stop at the cave ceiling. The start-room floor stays solid; this is not a shaft up into the cell.
  const yTop = caveTop;
  const skin = 0.08;
  const addRock = (xa, xb, ya, yb, za, zb) => {
    if (xb - xa < 0.012 || yb - ya < 0.012 || zb - za < 0.012) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, yb - ya, zb - za), rock);
    mesh.position.set((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  // rock behind the pockets, so each cut has a back wall
  addRock(faceX + skin, x1, yBot, yTop, z0, z1);

  const cuts = [];
  const lips = [];
  const rungs = [];
  const holds = [];
  let side = 0;
  for (let y = caveTop - 0.28; y >= WATER_Y + 0.95; y -= 0.23) {
    holds.push({ y, z: zc + (side % 2 ? 0.11 : -0.11) });
    side += 1;
  }
  const pocketH = 0.07;
  const pocketW = 0.13;
  let yCursor = yTop;
  holds.forEach((hold) => {
    const top = hold.y + pocketH / 2;
    const bot = hold.y - pocketH / 2;
    addRock(faceX, faceX + skin, top, yCursor, z0, z1);
    const pz0 = hold.z - pocketW / 2;
    const pz1 = hold.z + pocketW / 2;
    addRock(faceX, faceX + skin, bot, top, z0, pz0);
    addRock(faceX, faceX + skin, bot, top, pz1, z1);
    // dark pocket, entirely inside the wall (nothing proud of faceX)
    const cut = new THREE.BoxGeometry(skin - 0.016, pocketH - 0.01, pocketW - 0.016);
    cut.translate(0.008 + (skin - 0.016) / 2, hold.y, hold.z - zc);
    cuts.push(cut);
    const lip = new THREE.BoxGeometry(0.026, 0.011, pocketW);
    lip.translate(0.013, top - 0.004, hold.z - zc);
    lips.push(lip);
    proxy(ladder, -0.07, hold.y, hold.z - zc, rungs);
    yCursor = bot;
  });
  addRock(faceX, faceX + skin, yBot, yCursor, z0, z1);
  [mergedMesh(cuts, cutMat, 'notches_cut'), mergedMesh(lips, wornMat, 'notches_worn')].forEach((m) => m && ladder.add(m));
  ladder.userData = {
    rungs,
    roofY: 0.4,
    notches: true,
    shaft: { top: caveTop, base: beachTop },
    topSpot: { x: x0 - 0.35, y: beachTop, z: zc },
    baseSpot: { x: x0 - 0.35, y: beachTop, z: zc },
    topStatus: 'In the cave, at the notches in the east wall.',
    baseStatus: 'In the cave, at the notches in the east wall.',
  };
}

// Route 2: hidden notch line down the cliff face from the yard edge (z 10.05: the yard's far corner, behind the rim boulder and past the last crate pile) to a shelf at the
// foot of the cliff by the cave mouth. The line drifts 3.4 m sideways on the way down (main.js follows userData.path).
export function cliffRoute({ scene, targets, rock, faceX, beachTop, WATER_Y, zTop = 10.05, zBase = 2.95 }) {
  const ladder = new THREE.Group();
  const rx = faceX + 0.22;
  ladder.position.set(rx, 0, zBase);
  const top = 0;
  const base = beachTop;
  const knee = base + 1.6; // vertical for the last 1.6 m so the bottom holds line up over the shelf
  const zAt = (y) => zBase + Math.min(1, Math.max(0, y - knee) / (top - knee)) * (zTop - zBase);
  // main.js keeps the body under the hands: z follows zAt(feet + CHEST)
  const cuts = [];
  const lips = [];
  const rungs = [];
  let side = 0;
  for (let y = -0.16; y >= base + 0.95; y -= 0.23) {
    const z = zAt(y) + (side % 2 ? 0.13 : -0.13) - zBase;
    holdParts(cuts, lips, faceX - rx, y, z, 0.11);
    proxy(ladder, faceX - rx - 0.07, y, zAt(y) - zBase, rungs);
    side += 1;
  }
  // the access point: a small worn cleft in the yard edge and two scuffed holds just under it
  const cleft = new THREE.BoxGeometry(0.12, 0.16, 0.24);
  cleft.translate(faceX + 0.05 - rx, -0.075, zTop - zBase);
  cuts.push(cleft);
  [-0.09, 0.09].forEach((dz) => {
    const scuff = new THREE.BoxGeometry(0.11, 0.008, 0.07);
    scuff.translate(faceX + 0.07 - rx, 0.004, zTop - zBase + dz);
    lips.push(scuff);
  });
  [mergedMesh(cuts, cutMat, 'cliffnotches_cut'), mergedMesh(lips, wornMat, 'cliffnotches_worn')].forEach((m) => m && ladder.add(m));
  ladder.userData = {
    rungs,
    roofY: 0.4,
    notches: true,
    shaft: { top, base },
    path: { zTop, zBase },
    zAt,
    topSpot: { x: faceX + 0.6, y: 0, z: zTop + 0.05 }, // clear of the rim boulder (-1.19, 9.5, r 0.48)
    baseSpot: { x: faceX - 0.3, y: beachTop, z: zBase - 0.2 },
    topStatus: 'At the top of the cliff, behind the boulder in the corner of the yard.',
    baseStatus: 'On the rocks at the foot of the cliff. The cave mouth is just around the corner.',
  };
  scene.add(ladder);
  targets.push(ladder);
  // shelf at the foot of the face (catches falls) plus a step into the cave mouth
  const shelfTop = beachTop;
  const shelf = { x0: faceX - 0.6, x1: faceX, z0: zBase - 0.5, z1: zTop + 0.45, floor: shelfTop };
  const step = { x0: faceX, x1: faceX + 0.24, z0: zBase - 0.75, z1: zBase - 0.3, floor: shelfTop };
  const slabs = [
    [shelf.x0, shelf.x1, shelf.z0, shelf.z0 + 1.6, 0],
    [shelf.x0 + 0.08, shelf.x1, shelf.z0 + 1.55, shelf.z0 + 3.0, 0.03],
    [shelf.x0 + 0.02, shelf.x1, shelf.z0 + 2.95, shelf.z1, -0.02],
    [step.x0 - 0.05, step.x1, step.z0, step.z1, 0],
  ];
  const meshes = slabs.map(([x0, x1, z0, z1, tilt]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.34, z1 - z0), rock);
    m.position.set((x0 + x1) / 2, shelfTop - 0.17, (z0 + z1) / 2);
    m.rotation.x = tilt;
    m.receiveShadow = true;
    m.userData.shore = true;
    scene.add(m);
    return m;
  });
  return { ladder, shelf, step, meshes };
}

// main.js: is the player on (or falling along) a notch line? Falls there are a controlled slide.
export function nearNotches(routes, x, z) {
  for (const r of routes) {
    const p = r.ladder.position;
    const zz = r.ladder.userData.path ? null : p.z;
    if (Math.abs(x - (p.x - 0.42)) > 0.55) continue;
    if (zz != null ? Math.abs(z - zz) < 0.6 : (z > r.ladder.userData.path.zBase - 0.6 && z < r.ladder.userData.path.zTop + 0.6)) return true;
  }
  return false;
}
