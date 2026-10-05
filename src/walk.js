// Rowing pass: getting around without teleport.
// - TELEPORT: one switch for the A-button spot cycling, the spot rings and pointer-teleport. Flip TELEPORT_DEFAULT to
//   false when the game drops teleport; ?teleport=0 / ?teleport=1 override it per visit.
// - Smooth left-stick locomotion (head-relative) and right-stick snap turn (or smooth turn), with collisions:
//   you can't walk through walls, door boards, the closed lift gate or tall crate stacks, can't walk off a ledge
//   (cliff, roof edge, the yard rim, the shaft) and can't walk into deep water. Step-ups up to 0.42 m (crates, sills)
//   are fine. Room-scale walking is pushed back out of the same walls (main.js containPlayer).
// - The ground model (groundUnder / standHeight) moved here from main.js unchanged, so the game and the headless
//   reachability test use exactly the same rules.
import * as THREE from 'three';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const num = (key, fallback) => {
  const value = Number(params.get(key));
  return params.has(key) && Number.isFinite(value) ? value : fallback;
};

export const TELEPORT_DEFAULT = true;
export const TELEPORT = params.has('teleport') ? params.get('teleport') !== '0' : TELEPORT_DEFAULT;
export const MOVE = params.get('move') !== '0';
export const TURN = params.get('turn') === 'smooth' ? 'smooth' : (params.get('turn') === '0' ? 'off' : 'snap');
export const MOVE_SPEED = num('movespeed', 1.6);   // m/s at full stick
export const SNAP_DEG = num('snapdeg', 30);
export const SMOOTH_TURN_DEG = num('turnspeed', 110); // deg/s
export const RADIUS = 0.2;      // body radius for walls
export const STEP_UP = 0.42;    // highest step you walk up
export const DROP = 0.5;        // deepest step you walk down; deeper is a ledge

export function inBox(box, x, z) {
  return !!box && x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
}

export function createGround({ world, roof, startCell, cliffX, waterY }) {
  function standHeight(x, z, feetY, floor) {
    let best = floor;
    for (const crate of world.crates) {
      if (crate.userData.dead || crate.userData.role === 'held') continue;
      if (Math.abs(x - crate.position.x) > crate.userData.hx) continue;
      if (Math.abs(z - crate.position.z) > crate.userData.hz) continue;
      const top = crate.position.y + crate.userData.hy;
      if (top > feetY + 0.4) continue;
      if (top > best) best = top;
    }
    return best;
  }

  function groundUnder(x, z, feetY) {
    const green = world.golf?.green;
    if (green && feetY > 8 && x >= green.x0 && x <= green.x1 && z >= green.z0 && z <= green.z1 && feetY >= green.y - 0.9) {
      return green.y;
    }
    const crag = world.crag;
    if (crag && feetY > 8) {
      const deck = crag.deckAt(x, z);
      if (deck != null && feetY >= deck - 0.9) return deck;
    }
    const overRoof = x >= roof.x0 && x <= roof.x1 && z >= roof.z0 && z <= roof.z1;
    // the slab has thickness; standing in it or on it stays on top instead of dropping through to the floor
    if (overRoof && feetY >= roof.y - 0.9) return standHeight(x, z, feetY, roof.y);
    const cave = world.cave;
    if (cave && feetY < -1 && x >= cave.x0 && x <= cave.x1 && z >= cave.z0 && z <= cave.z1) return cave.floor;
    const pad = cave?.pad;
    if (pad && feetY < -1 && x >= pad.x0 && x <= pad.x1 && z >= pad.z0 && z <= pad.z1) return cave.floor;
    if (cave?.tunnel && feetY < -1 && x >= cave.tunnel.x0 && x <= cave.tunnel.x1 && z >= cave.tunnel.z0 && z <= cave.tunnel.z1) return cave.floor;
    // the 0.2 m seam between the cave box (x1 4.05) and the tunnel box (x0 4.25) used to read as open water
    if (cave?.tunnel && feetY < -1 && x >= cave.x1 - 0.05 && x <= cave.tunnel.x0 + 0.05 && z >= cave.tunnel.z0 && z <= cave.tunnel.z1) return cave.floor;
    if (cave?.room && feetY < -1 && x >= cave.room.x0 && x <= cave.room.x1 && z >= cave.room.z0 && z <= cave.room.z1) return cave.floor;
    const shaft = world.shaft;
    if (shaft && feetY < -0.2 && Math.abs(x - shaft.x) < 0.42 && Math.abs(z - shaft.z) < 0.5) return shaft.floor;
    // forest pass: the rock shelf at the foot of the cliff notch line (and its step into the cave mouth)
    if (feetY < -1 && (inBox(world.notches?.shelf, x, z) || inBox(world.notches?.step, x, z))) return world.notches.shelf.floor;
    const overFloor = x >= cliffX + 0.04 && x <= roof.roomX1 && z >= roof.roomZ0 && z <= roof.roomZ1;
    const cell = startCell.floor;
    const inCell = x >= cell.x0 && x <= cell.x1 && z >= cell.z0 && z <= cell.z1;
    if (inCell && feetY >= startCell.ceiling - 0.35) return startCell.ceiling;
    // rowing pass: only from above (feet > -1). The room box overhangs the cave mouth by 9 cm (x -1.74..-1.65), and
    // standing there in the cave used to read as the room floor 7.9 m up (landShift lifted you onto it).
    if ((overFloor || inCell) && feetY > -1) return standHeight(x, z, feetY, 0);
    const liftFloor = world.lift?.floorAt(x, z, feetY);
    if (liftFloor != null) return liftFloor;
    const porch = world.lift?.door?.porch;
    if (porch && x >= porch.x0 && x <= porch.x1 && z >= porch.z0 && z <= porch.z1 && feetY >= -0.4) {
      return 0;
    }
    const yard = world.yard;
    if (yard && x >= yard.x0 && x <= yard.x1 && z >= yard.z0 && z <= yard.z1 && feetY >= yard.y - 0.4) {
      return standHeight(x, z, feetY, yard.y);
    }
    const shelf = world.shallowFloor?.(x, z);
    if (shelf != null && feetY < -1) return shelf;
    return waterY;
  }

  return { groundUnder, standHeight };
}

// Walls the ground model can't see (floor continues on both sides). AABBs with a height band.
function staticColliders({ world, startCell, cliffX, roof }) {
  const list = [];
  for (const b of startCell.blocks) list.push({ ...b, y0: -0.1, y1: 3.1, why: 'cell wall' });
  // room north wall (rock, 0.7 thick)
  list.push({ x0: cliffX - 0.4, x1: roof.roomX1 + 0.65, z0: roof.roomZ0 - 0.55, z1: roof.roomZ0 - 0.0, y0: -0.1, y1: 2.7, why: 'room wall' });
  for (const post of world.hockey?.posts || []) list.push(post);
  // rock chunks standing in the room
  list.push({ x0: 0.6, x1: 1.7, z0: -2.55, z1: -1.75, y0: 0, y1: 1.16, why: 'room wall' });
  list.push({ x0: 1.8, x1: 2.5, z0: 0.9, z1: 2.2, y0: 0, y1: 0.85, why: 'room wall' });
  for (const w of world.lift?.colliders || []) list.push({ ...w, why: 'lift wall' });
  for (const block of world.crag?.colliders || []) list.push(block);
  const cave = world.cave;
  if (cave) {
    const y0 = cave.floor - 0.2;
    const y1 = -2.9;
    // rock outside the walkable cave. Kept off the west mouth and the cliff shelf.
    list.push({ x0: -1.05, x1: cave.x1 + 0.8, z0: cave.z0 - 0.55, z1: cave.z0 - 0.12, y0, y1, why: 'cave wall' });
    list.push({ x0: -1.05, x1: cave.x1 + 0.8, z0: cave.z1 + 0.35, z1: cave.z1 + 0.9, y0, y1, why: 'cave wall' });
    const tunnel = cave.tunnel;
    if (tunnel) {
      list.push({ x0: cave.x1 - 0.02, x1: cave.x1 + 0.7, z0: cave.z0, z1: tunnel.z0, y0, y1, why: 'cave wall' });
      list.push({ x0: cave.x1 - 0.02, x1: cave.x1 + 0.7, z0: tunnel.z1, z1: cave.z1, y0, y1, why: 'cave wall' });
    } else {
      list.push({ x0: cave.x1 - 0.02, x1: cave.x1 + 0.7, z0: cave.z0, z1: cave.z1, y0, y1, why: 'cave wall' });
    }
  }
  return list;
}

export function createWalker({ world, ground, startCell, cliffX, roof, waterY }) {
  const colliders = staticColliders({ world, startCell, cliffX, roof });
  const box = { x0: 0, x1: 0, z0: 0, z1: 0, y0: 0, y1: 0 };

  function hitsBox(b, x, z, feet, r) {
    if (feet + 1.7 < b.y0 || feet + 0.3 > b.y1) return false;
    return x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r;
  }

  function dynamicHit(x, z, feet, r) {
    // standing door boards
    for (const board of world.gear?.doorBoards || []) {
      if (board.userData.dead) continue;
      box.x0 = board.position.x - board.userData.hx; box.x1 = board.position.x + board.userData.hx;
      box.z0 = board.position.z - board.userData.hz; box.z1 = board.position.z + board.userData.hz;
      box.y0 = -0.1; box.y1 = 2.1;
      if (hitsBox(box, x, z, feet, r)) return 'door boards';
    }
    const lift = world.lift;
    if (lift?.door && lift.doorOpen < 0.45) {
      const d = lift.door;
      box.x0 = d.x0; box.x1 = d.x1; box.z0 = d.z0; box.z1 = d.z1; box.y0 = d.y0; box.y1 = d.y1;
      if (hitsBox(box, x, z, feet, r)) return 'lift gate';
    }
    if (lift?.shaft) {
      for (const stop of (lift.stops || []).slice(1)) {
        const atStop = !lift.moving && Math.abs(lift.floorY - stop) < 0.05;
        if (atStop) continue;
        box.x0 = lift.shaft.x1 - 0.05; box.x1 = lift.shaft.x1 + 0.12; box.z0 = lift.shaft.z0; box.z1 = lift.shaft.z1; box.y0 = stop - 0.1; box.y1 = stop + 2.0;
        if (hitsBox(box, x, z, feet, r)) return 'landing (car not here)';
      }
    }
    // crate stacks too tall to step onto
    for (const crate of world.crates || []) {
      if (crate.userData.dead || crate.userData.role === 'held') continue;
      const top = crate.position.y + crate.userData.hy;
      const bottom = crate.position.y - crate.userData.hy;
      if (top <= feet + STEP_UP || bottom > feet + 1.7) continue;
      if (Math.abs(x - crate.position.x) < crate.userData.hx + r * 0.6 && Math.abs(z - crate.position.z) < crate.userData.hz + r * 0.6) return 'crates';
    }
    return null;
  }

  // open water = groundUnder fell through to WATER_Y (lift floors at -10.8 / -14.4 are below sea level but dry)
  function isWater(g, x, z) {
    return g === waterY && world.shallowFloor?.(x, z) == null;
  }

  // Can a body standing with its feet at `feet` move its centre to (x, z)? Returns the new ground when it can.
  // opts.up / opts.down widen the step limits (stepping out of the canoe onto the shelf or into the shallows).
  function walkable(x, z, feet, opts = null) {
    const up = opts?.up ?? STEP_UP;
    const down = opts?.down ?? DROP;
    const g = ground.groundUnder(x, z, feet);
    if (isWater(g, x, z)) return { ok: false, why: 'water' };
    if (g - feet > up) return { ok: false, why: 'too high' };
    if (feet - g > down) return { ok: false, why: 'ledge' };
    for (const c of colliders) if (hitsBox(c, x, z, feet, RADIUS)) return { ok: false, why: c.why };
    const dyn = dynamicHit(x, z, feet, RADIUS);
    if (dyn) return { ok: false, why: dyn };
    // clearance: the floor has to carry on a little around you (keeps you off edges and out of tunnel walls)
    const r = RADIUS * 0.7;
    for (let i = 0; i < 4; i += 1) {
      const sx = x + (i === 0 ? r : i === 1 ? -r : 0);
      const sz = z + (i === 2 ? r : i === 3 ? -r : 0);
      const gs = ground.groundUnder(sx, sz, feet);
      if (isWater(gs, sx, sz) || feet - gs > down || gs - feet > up) return { ok: false, why: 'edge' };
    }
    return { ok: true, ground: g };
  }

  // Move (x, z) by (dx, dz) with sliding along walls. Sub-steps of 8 cm.
  function move(x, z, feet, dx, dz) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.08));
    let cx = x;
    let cz = z;
    let f = feet;
    let blocked = null;
    for (let i = 0; i < steps; i += 1) {
      const sx = dx / steps;
      const sz = dz / steps;
      const w = walkable(cx + sx, cz + sz, f);
      if (w.ok) { cx += sx; cz += sz; f = w.ground; continue; }
      blocked = w.why;
      const wx = walkable(cx + sx, cz, f);
      if (wx.ok && Math.abs(sx) > 1e-5) { cx += sx; f = wx.ground; continue; }
      const wz = walkable(cx, cz + sz, f);
      if (wz.ok && Math.abs(sz) > 1e-5) { cz += sz; f = wz.ground; continue; }
      break;
    }
    return { x: cx, z: cz, ground: f, blocked };
  }

  // Boxes room-scale walking has to be pushed out of. Same walls the stick uses.
  function solids(feet) {
    const out = [];
    for (const c of colliders) {
      if (feet + 1.7 < c.y0 || feet + 0.3 > c.y1) continue;
      out.push(c);
    }
    for (const board of world.gear?.doorBoards || []) {
      if (board.userData.dead) continue;
      out.push({
        x0: board.position.x - board.userData.hx,
        x1: board.position.x + board.userData.hx,
        z0: board.position.z - board.userData.hz,
        z1: board.position.z + board.userData.hz,
      });
    }
    for (const crate of world.crates || []) {
      if (crate.userData.dead || crate.userData.role === 'held') continue;
      const top = crate.position.y + crate.userData.hy;
      const bottom = crate.position.y - crate.userData.hy;
      if (top <= feet + STEP_UP || bottom > feet + 1.7) continue;
      out.push({
        x0: crate.position.x - crate.userData.hx,
        x1: crate.position.x + crate.userData.hx,
        z0: crate.position.z - crate.userData.hz,
        z1: crate.position.z + crate.userData.hz,
      });
    }
    return out;
  }

  return { walkable, move, colliders, solids, isWater };
}

// Head-relative stick vector -> world (dx, dz) per second.
const fwd = new THREE.Vector3();
const quat = new THREE.Quaternion();
export function stickToWorld(orientation, sx, sy, out = { x: 0, z: 0, mag: 0 }) {
  quat.set(orientation.x, orientation.y, orientation.z, orientation.w);
  fwd.set(0, 0, -1).applyQuaternion(quat);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const rx = -fwd.z;
  const rz = fwd.x;
  const mag = Math.min(1, Math.hypot(sx, sy));
  const dead = 0.15;
  const k = mag <= dead ? 0 : ((mag - dead) / (1 - dead)) ** 1.4 / Math.max(mag, 1e-6);
  out.x = (fwd.x * -sy + rx * sx) * k;
  out.z = (fwd.z * -sy + rz * sx) * k;
  out.mag = mag <= dead ? 0 : (mag - dead) / (1 - dead);
  return out;
}
