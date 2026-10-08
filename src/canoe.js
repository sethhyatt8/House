import * as THREE from 'three';
import { proxyMaterial } from './assets.js';
import { legacy } from './flags.js';

// Bow is local -Z, starboard is local +X. The rower faces the stern (local +Z), so their
// left hand works the starboard oar. A starboard-only power stroke yaws the bow to port:
// positive yaw, counter-clockwise from above. From the seat, the stern swings to the left.
const BLADE = 78;
const OARLOCK = { x: 0.5, y: 0.34, z: 0.02 };
// Rowing modes (rowing pass):
//   default 'oars'    two long oars pivoting in oarlock rings on the gunwales. Grab each oar at the very end of the
//                     handle; the oar turns about its ring as the hand moves. You sit facing the bow: push the handles
//                     forward with the blades in the water (they sweep back) = forward; press the handles down (blade
//                     lifts out) or roll the wrist (blade feathers flat) for the recovery = no thrust; one oar = turn.
//                     Thrust comes from each blade's velocity through the water. ?oargain=<n> scales it.
//   ?rowing=paddle    the feedback-pass hand paddles. ?paddlegain=<n> scales their thrust.
//   ?rowing=old       (or ?legacy=row) the original oarlock oars with the stroke-burst rowing.
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const ROW_MODE = (params.get('rowing') === 'old' || legacy('row')) ? 'old' : (params.get('rowing') === 'paddle' ? 'paddle' : 'oars');
export const PADDLE_MODE = ROW_MODE === 'paddle';
export const OAR_MODE = ROW_MODE === 'oars';
const OARS_OLD_EARLY = params.get('oars') === 'old';
// swim/boat/reef pass: rowing feel. ?rowgain= scales oar thrust (alias of ?oargain=), ?rowdrag= scales the hull's
// forward drag (1 = a stroke coasts ~10 s). ?row=old = the ground-pass blade depth / force curve / drag.
const ROW_OLD = OARS_OLD_EARLY || params.get('row') === 'old' || params.get('rowing') === 'old' || legacy('row');
const pnum = (key) => { const v = Number(params.get(key)); return params.has(key) && Number.isFinite(v) && v > 0 ? v : null; };
const ROW_GAIN = pnum('rowgain') ?? pnum('oargain') ?? 1;
const ROW_DRAG = pnum('rowdrag') ?? 1;
const OARS = {
  len: 2.1,                 // handle end to blade tip (the paddle.glb model stretched to oar length)
  // ground/boat pass: rings on short brackets 10 cm outside the gunwale and a 0.5 m inboard, so the two handle ends
  // stay >= 10 cm apart across the whole sweep (they used to cross the centreline and pass through each other)
  inboard: OARS_OLD_EARLY ? 0.55 : 0.5,  // handle end to the ring
  pivot: { x: OARS_OLD_EARLY ? 0.45 : 0.55, y: 0.34, z: -0.35 },  // ring centre, boat frame (a little ahead of the seat: the hands sweep around it)
  bladeLen: 0.7,
  samples: [0.12, 0.33, 0.54], // blade sample points, metres in from the tip
  // swim/boat/reef pass: the blade sat 8 cm deep at the grab height and was fully out 13 cm higher, i.e. the hands
  // only had to settle ~5 cm below where they took hold for the blade to leave the water (on the headset: "barely
  // moves"). Now it sits 18 cm deep and stays (partly) in until the hands drop ~10 cm: a deliberate recovery.
  neutralDepth: ROW_OLD ? 0.08 : 0.18, // where the blade centre sits when you take hold (handle height is calibrated on grab)
  wetBand: ROW_OLD ? [0.1, 0.5] : [0.12, 0.6], // wet = clamp(depth / a + b): old -5..+5 cm, new -7..+5 cm
  gain: ROW_GAIN,
  // force per blade sample = wet x (k |v| + lin) x v. Old: mostly quadratic (a small, slow Quest stroke gave ~1/4 of a
  // brisk emulator stroke). New: mostly linear in blade speed (area x speed), a little quadratic so hard > soft.
  k: ROW_OLD ? 38 : 9.5,    // N per (m/s)^2 per sample
  lin: ROW_OLD ? 10 : 32,   // N per m/s per sample (tuned with the ~10 s glide: a headset-size stroke = ~3 m)
  maxForce: OARS_OLD_EARLY ? 380 : (ROW_OLD ? 600 : 1000), // ground/boat pass: 380 clipped a brisk stroke, so hard and soft felt the same
  maxTorque: 300,
  feather: params.get('feather') !== '0', // ?oars=old only: wrist roll about the shaft feathers the blade (25 deg dead zone)
};
// Ground/boat pass oar feel (default; ?oars=old restores the previous pose + feathering + blade-point torque):
// - the oar turns only about its ring: bearing and pitch come from where the hand is relative to the ring (a lever),
//   never from controller roll, so it cannot spin in the hand; the blade face stays square to the stroke.
// - sweep / pitch are clamped so the handle never goes into the rower, under the hull floor or through the other oar
//   (when the two handles overlap the starboard one rides over the port one, as in real sculling).
// - thrust per blade sample = wet (submerged area) fraction x blade speed through the water (k|v|+lin) x coefficient,
//   applied at the oarlock: hands push FORWARD with the blades in = boat FORWARD, pull BACK = boat BACKWARD,
//   blades out = nothing, one oar = the bow turns away from that side.
// - ?feather=1 adds a deliberate feather: twist the wrist past 55 deg about the shaft and the blade lies flat
//   (no bite), back under 35 deg and it squares up again. Off by default.
export const OARS_OLD = OARS_OLD_EARLY;
const OAR_FEEL = {
  aft: 0.45,      // bearing limit toward the rower (rad): handle end stays ~12 cm ahead of the seat
  fore: -1.15,    // bearing limit toward the bow
  dyMin: -0.24,   // handle end at least ~10 cm above the hull floor
  dyMax: 0.3,     // blade no deeper than ~0.5 m
  rate: 9,        // rad/s: a one-frame tracking jump can't flip the oar
  near: 0.1,      // hand closer than this (horizontally) to the ring: keep the last bearing
  gap: 0.05,      // handle-to-handle clearance (shaft radii + margin)
  featherOn: 0.96, featherOff: 0.61,
  feather: params.get('feather') === '1',
};
const PADDLE = {
  gain: Number(params.get('paddlegain')) || 1,
  k: 57,             // N per (m/s)^2 per blade sample: 0.5 * rho 1000 * Cd ~1.2 * (blade 0.26 x 0.3 m / 3 samples) * game gain ~3.6
  lin: 10,           // N per m/s per sample: keeps slow, careful strokes from feeling dead
  samples: [-0.5, -0.6, -0.7],  // blade sample points along the shaft (local -Y from the hand), tip at -0.73
  maxForce: 420,
  maxTorque: 220,
};

export function createBoatSim(aboard = true) {
  return {
    vx: 0,
    vz: 0,
    yaw: Math.PI / 2,
    yawRate: 0,
    mass: aboard ? 120 : 45,
    inertia: aboard ? 90 : 30,
    draft: aboard ? 0.16 : 0.12,
    groundedFrac: 0,
  };
}

function dragAccel(speed) {
  return 0.35 * speed + 0.3 * speed * Math.abs(speed);
}
// swim/boat/reef pass: forward glide drag, mostly quadratic with a small linear term (the old 0.35 v + 0.3 v^2 lost
// most of the speed within ~2 s). From 0.8 m/s a hull now coasts ~10 s (to < 0.1 m/s) and ~3 m. Sideways stays at the
// old x10 (keel: it tracks straight), yaw damping 1.8 -> 1.5/s.
function glideDrag(speed) {
  return ROW_DRAG * (0.13 * speed + 0.22 * speed * Math.abs(speed));
}

export function stepBoat(sim, dt, input = {}) {
  const cos = Math.cos(sim.yaw);
  const sin = Math.sin(sim.yaw);
  const localX = sim.vx * cos - sim.vz * sin;
  const localZ = sim.vx * sin + sim.vz * cos;
  let forceX = 0;
  let forceZ = 0;
  let torque = 0;
  const push = (side, stroke) => {
    if (!stroke || stroke.k <= 0 || !stroke.along) return;
    const mag = BLADE * stroke.k * stroke.along * Math.abs(stroke.along);
    const force = -mag;
    forceZ += force;
    torque += -(side * OARLOCK.x) * force;
  };
  push(1, input.starboard);
  push(-1, input.port);
  if (input.push) {
    forceX += input.push.x;
    forceZ += input.push.z;
    torque += input.push.torque || 0;
  }
  const long = ROW_OLD ? dragAccel(localZ) : glideDrag(localZ);
  const lat = dragAccel(localX) * 10;
  let ax = forceX / sim.mass - lat;
  let az = forceZ / sim.mass - long;
  if (sim.groundedFrac > 0) {
    const speed = Math.hypot(localX, localZ);
    const stick = 0.45 * 9.8 * sim.groundedFrac;
    const pushForce = Math.hypot(forceX, forceZ);
    if (speed < 0.05 && pushForce < stick * sim.mass) {
      ax = 0;
      az = 0;
      sim.vx = 0;
      sim.vz = 0;
    } else if (speed > 1e-4) {
      ax -= (stick * localX) / speed;
      az -= (stick * localZ) / speed;
    }
  }
  sim.vx += (ax * cos + az * sin) * dt;
  sim.vz += (ax * -sin + az * cos) * dt;
  sim.yawRate += (torque / sim.inertia - (ROW_OLD ? 1.8 : 1.5) * sim.yawRate) * dt;
  sim.yawRate = THREE.MathUtils.clamp(sim.yawRate, -1.2, 1.2);
  sim.yaw += sim.yawRate * dt;
}

export function createCanoe(scene, targets, cave, assets, water) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.74, side: THREE.DoubleSide });
  const trim = new THREE.MeshStandardMaterial({ color: 0x4e3422, roughness: 0.82, emissive: 0x000000 });
  const oarMat = new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.68 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.7 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xc2b39a, roughness: 0.8, emissive: 0x000000 });
  const group = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 3.4), wood);
  hull.position.y = 0.08;
  hull.userData = { type: 'boatHull' };
  group.add(hull);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.035, 0.16), trim);
  seat.position.set(0, 0.22, 0.02);
  seat.userData = { type: 'boatSeat' };
  group.add(seat);
  const ends = [];
  const loops = [];
  [-1, 1].forEach((dir) => {
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.16), trim);
    stem.position.set(0, 0.28, dir * 1.7);
    stem.userData = { type: 'boatEnd', end: dir === -1 ? 'bow' : 'stern' };
    group.add(stem);
    ends.push(stem);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16), ropeMat.clone());
    loop.position.set(0, 0.34, dir * 1.82);
    loop.rotation.y = Math.PI / 2;
    loop.userData = { type: 'boatEnd', end: stem.userData.end, loop: true };
    group.add(loop);
    loops.push(loop);
  });
  const oars = [];
  const restDir = new THREE.Vector3(0.62, -0.05, -0.78).normalize();
  [-1, 1].forEach((side) => {
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), trim);
    fork.position.set(side * OARLOCK.x, OARLOCK.y, OARLOCK.z);
    group.add(fork);
    const oar = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 2.1, 6), oarMat);
    shaft.rotation.z = Math.PI / 2;
    oar.add(shaft);
    const gripZone = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6), leather.clone());
    gripZone.rotation.z = Math.PI / 2;
    gripZone.position.x = -side * 0.3;
    oar.add(gripZone);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.45), oarMat);
    blade.position.set(side * 1.48, 0, 0);
    oar.add(blade);
    const dir = restDir.clone();
    dir.x *= side;
    oar.position.copy(new THREE.Vector3(side * OARLOCK.x, OARLOCK.y, OARLOCK.z));
    oar.quaternion.setFromUnitVectors(new THREE.Vector3(side > 0 ? 1 : -1, 0, 0), dir);
    oar.userData = {
      type: 'oar',
      side,
      name: side > 0 ? 'starboard' : 'port',
      blade,
      gripZone,
      prevBlade: new THREE.Vector3(),
      immersed: 0,
    };
    group.add(oar);
    oars.push(oar);
  });
  const canoeModel = assets?.feature('boats')
    ? (((PADDLE_MODE || OAR_MODE) && assets.instance('canoe_cedar')) || assets.instance('canoe'))
    : null;
  const modelMats = [];
  if (canoeModel) {
    hull.material = proxyMaterial;
    hull.castShadow = false;
    ends.forEach((stem) => {
      stem.material = proxyMaterial;
      stem.castShadow = false;
    });
    canoeModel.traverse((child) => {
      if (!child.isMesh) return;
      child.material = child.material.clone();
      child.material.side = THREE.DoubleSide;
      child.castShadow = true;
      child.receiveShadow = true;
      child.raycast = () => {};
      modelMats.push(child.material);
    });
    group.add(canoeModel);
  }
  // --- hand paddles ---
  const paddles = [];
  const HOLD = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // paddle -Y (blade) -> grip +Z (below the fist), face -> grip Y
  if (PADDLE_MODE) {
    oars.forEach((oar) => { oar.visible = false; });
    group.children.forEach((child) => { if (child.geometry?.type === 'BoxGeometry' && child.position.y === OARLOCK.y) child.visible = false; });
    [-1, 1].forEach((side) => {
      let mesh = assets?.feature('boats') ? assets.instance('paddle') : null;
      if (!mesh) {
        mesh = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.62, 8), oarMat);
        shaft.position.y = -0.19;
        const knob = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), oarMat);
        knob.position.y = 0.11;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.014), oarMat);
        blade.position.y = -0.58;
        mesh.add(shaft, knob, blade);
      }
      let grip = null;
      mesh.traverse((child) => {
        if (!child.isMesh) return;
        child.material = child.material.clone();
        if (!child.material.emissive) child.material.emissive = new THREE.Color(0x000000);
        child.raycast = () => {};
        child.castShadow = true;
        grip ||= child;
      });
      const rest = new THREE.Matrix4().compose(
        new THREE.Vector3(side * 0.24, 0.06, side * 0.35),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, side * 0.08)),
        new THREE.Vector3(1, 1, 1),
      );
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(rest);
      group.add(mesh);
      paddles.push({
        mesh, rest, side, name: side > 0 ? 'starboard' : 'port', hand: null, prev: [null, null, null],
        wet: 0, wasWet: false, force: 0, userData: { gripZone: grip },
      });
    });
  }

  // --- oarlock oars (rowing pass, default) ---
  const longOars = [];
  if (OAR_MODE) {
    oars.forEach((oar) => { oar.visible = false; });
    group.children.forEach((child) => { if (child.geometry?.type === 'BoxGeometry' && child.position.y === OARLOCK.y) child.visible = false; });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x5a4a32, metalness: 0.75, roughness: 0.42 });
    // Hole faces outboard so the shaft stays captive in a fixed ring, the way a rowboat oarlock works.
    const ringGeo = new THREE.TorusGeometry(0.055, 0.012, 8, 22);
    const hornGeo = new THREE.CylinderGeometry(0.013, 0.016, 0.12, 8);
    [-1, 1].forEach((side) => {
      const P = new THREE.Vector3(side * OARS.pivot.x, OARS.pivot.y, OARS.pivot.z);
      const ring = new THREE.Mesh(ringGeo, bronze);
      ring.rotation.y = Math.PI / 2;
      ring.position.copy(P);
      ring.castShadow = true;
      ring.raycast = () => {};
      const hornA = new THREE.Mesh(hornGeo, bronze);
      const hornB = new THREE.Mesh(hornGeo, bronze);
      hornA.position.set(P.x, P.y - 0.02, P.z - 0.07);
      hornB.position.set(P.x, P.y - 0.02, P.z + 0.07);
      hornA.raycast = () => {};
      hornB.raycast = () => {};
      group.add(ring, hornA, hornB);
      if (!OARS_OLD_EARLY) { // outrigger bracket from the gunwale out to the ring
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.05), bronze);
        bracket.position.set(side * (P.x - 0.08), P.y - 0.07, P.z);
        bracket.castShadow = true;
        bracket.raycast = () => {};
        group.add(bracket);
      }
      let model = assets?.feature('boats') ? assets.instance('paddle') : null;
      if (!model) {
        model = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.62, 8), oarMat);
        shaft.position.y = -0.19;
        const knob = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), oarMat);
        knob.position.y = 0.11;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.014), oarMat);
        blade.position.y = -0.58;
        model.add(shaft, knob, blade);
      }
      model.traverse((child) => {
        if (!child.isMesh) return;
        child.material = child.material.clone();
        child.raycast = () => {};
        child.castShadow = true;
      });
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const srcLen = Math.max(0.2, box.max.y - box.min.y);
      const holder = new THREE.Group();
      holder.add(model);
      holder.scale.set(1.25, OARS.len / srcLen, 1.25);
      holder.position.y = -box.max.y * (OARS.len / srcLen); // handle end at the root origin, blade down -Y
      const root = new THREE.Group();
      root.matrixAutoUpdate = false;
      root.add(holder);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.13, 8), leather.clone());
      grip.material.emissive = new THREE.Color(0x000000);
      grip.position.y = -0.075;
      grip.raycast = () => {};
      // leather collar where the shaft crosses the stationary ring (model -Y runs handle -> blade)
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 14), leather.clone());
      collar.rotation.x = Math.PI / 2;
      collar.position.y = -OARS.inboard;
      collar.raycast = () => {};
      root.add(grip, collar);
      group.add(root);
      longOars.push({
        root, side, P, name: side > 0 ? 'starboard' : 'port', hand: null, dy0: 0, roll0: 0, feather: 0,
        prev: [null, null, null], wet: 0, wasWet: false, force: 0, userData: { gripZone: grip },
        end: new THREE.Vector3(), axis: new THREE.Vector3(), normal: new THREE.Vector3(), basis: new THREE.Matrix4(),
      });
    });
  }

  group.rotation.y = Math.PI / 2;
  const oldSpot = legacy('canoehome');
  const shelf = cave.shallows;
  const REST = oldSpot || !shelf
    ? { x: cave.boatX + 0.7, z: cave.z + 2.45 }
    : { x: cave.x0 - 1.45, z: cave.z + 2.45 };
  const HOME = { x: REST.x - 0.5, z: REST.z };
  group.position.set(REST.x, cave.floor + 0.12, REST.z);
  scene.add(group);
  targets.push(group);

  const sim = createBoatSim(false);
  sim.yaw = Math.PI / 2;
  const seatPoint = new THREE.Vector3();
  const center = new THREE.Vector3();
  let onHaptic = null;
  let draft = 0.12;
  let surf = 0;
  let swellPitch = 0;
  let groundedFrac = 0;
  let hovered = null;
  const anchor = new THREE.Vector3();
  let drag = null;
  const oarGrips = { starboard: null, port: null };
  let hoveredOar = null;
  let idleTime = 0;
  let homing = false;
  const segA = new THREE.Vector3();
  const segB = new THREE.Vector3();
  const segP = new THREE.Vector3();
  const segLine = new THREE.Line3();
  const gripHands = { starboard: makeGripHand(), port: makeGripHand() };
  Object.values(gripHands).forEach((hand) => {
    hand.visible = false;
    scene.add(hand);
  });
  const local = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  let clock = 0;
  let wasImmersed = { starboard: false, port: false };

  let rider = false;
  function setAboard(value) {
    rider = !!value;
    if (drag) drag.aboard = rider;
  }

  function floating() {
    return groundedFrac === 0 && group.position.x < cave.x0;
  }
  // ground/boat pass: oars only lose their bite when the whole hull is on the sand (or inside the cave). The boat's
  // own rest spot has the stern on the shelf (groundedFrac 1/3), and with the old rule (any keel point aground ->
  // oar force x0.15, against the grounded hull's static friction) you could sit there rowing forever without moving.
  function beached() {
    return OARS_OLD ? !floating() : (groundedFrac > 0.99 || group.position.x >= cave.x0);
  }

  function massNow() {
    sim.mass = floating() && drag?.aboard ? 120 : (drag?.aboard ? 120 : 45);
    sim.inertia = sim.mass > 80 ? 90 : 30;
  }

  function shove() {
    const aheadX = -Math.sin(sim.yaw);
    const aheadZ = -Math.cos(sim.yaw);
    const step = 0.9;
    if (drag) {
      drag.nudgeX += aheadX * step;
      drag.nudgeZ += aheadZ * step;
    }
    group.position.x += aheadX * step;
    group.position.z += aheadZ * step;
    sim.vx = aheadX * 0.35;
    sim.vz = aheadZ * 0.35;
    sim.yawRate = 0;
    group.updateMatrixWorld(true);
    groundedNow();
    onHaptic?.(drag?.controller, 0.5, 45);
    return floating() ? 'water' : 'again';
  }

  function stroke(which = 'both') {
    if (!floating()) return false;
    const burst = { k: 0.85, along: 1.35 };
    if (which === 'both' || which === 'starboard') stepBoat(sim, 0.16, { starboard: burst });
    if (which === 'both' || which === 'port') stepBoat(sim, 0.16, { port: burst });
    return true;
  }

  function nearest(points, objects, reach) {
    let best = null;
    let bestDist = reach;
    for (const object of objects) {
      object.getWorldPosition(worldPoint);
      for (const point of points) {
        const dist = worldPoint.distanceTo(point);
        if (dist < bestDist) {
          bestDist = dist;
          best = object;
        }
      }
    }
    return best;
  }

  function grab(controller, points) {
    const loop = nearest(points, loops, 0.35);
    const stem = loop || nearest(points, ends, 0.35);
    if (!stem) return false;
    if (drag?.controller && drag.controller !== controller) restoreHand(drag.controller);
    anchor.copy(stem.position);
    const hand = new THREE.Vector3();
    controller.getWorldPosition(hand);
    const framed = boatFrame(hand.x - group.position.x, hand.z - group.position.z, sim.yaw);
    const ring = ringXZ(anchor, sim.yaw, group.position);
    const sep = boatFrame(hand.x - ring.x, hand.z - ring.z, sim.yaw);
    drag = {
      controller,
      anchor: anchor.clone(),
      yaw0: sim.yaw,
      pos0: group.position.clone(),
      lat0: framed.lat,
      along0: framed.along,
      sepLat0: sep.lat,
      sepAlong0: sep.along,
      nudgeX: 0,
      nudgeZ: 0,
    };
    onHaptic?.(controller, 0.8, 60);
    snapHand(controller, stem);
    return true;
  }

  function nearPaddle(points, reach = 0.3) {
    let best = null;
    let bestDist = reach;
    for (const pd of paddles) {
      if (pd.hand) continue;
      pd.mesh.updateMatrixWorld(true);
      segA.set(0, 0.12, 0).applyMatrix4(pd.mesh.matrixWorld);
      segB.set(0, -0.7, 0).applyMatrix4(pd.mesh.matrixWorld);
      const seg = segLine.set(segA, segB);
      for (const point of points) {
        seg.closestPointToPoint(point, true, segP);
        const dist = segP.distanceTo(point);
        if (dist < bestDist) { bestDist = dist; best = pd; }
      }
    }
    return best;
  }

  function takePaddle(controller, points) {
    if (paddles.some((pd) => pd.hand === controller)) return false;
    let pd = nearPaddle(points, 0.35);
    if (!pd && rider) pd = paddles.find((item) => !item.hand) || null;
    if (!pd) return false;
    pd.hand = controller;
    pd.prev = [null, null, null];
    pd.wet = 0;
    pd.wasWet = false;
    oarGrips[pd.name] = controller;
    group.remove(pd.mesh);
    group.parent?.add(pd.mesh);
    onHaptic?.(controller, 0.7, 50);
    snapHand(controller, pd.mesh);
    return true;
  }

  function dropPaddle(pd) {
    if (pd.hand) restoreHand(pd.hand);
    gripHands[pd.name].visible = false; // rowing pass: the shown grip hand used to stay floating where you let go
    oarGrips[pd.name] = null;
    pd.hand = null;
    pd.mesh.parent?.remove(pd.mesh);
    group.add(pd.mesh);
    pd.mesh.matrix.copy(pd.rest);
    pd.userData.gripZone?.material.emissive?.setHex(0x000000);
  }

  // --- oarlock oars ---
  const oarTmp = new THREE.Vector3();
  const oarUp = new THREE.Vector3(0, 1, 0);
  const oarQ = new THREE.Quaternion();
  const oarQ2 = new THREE.Quaternion();
  const oarX = new THREE.Vector3();
  const oarN0 = new THREE.Vector3();
  const oarB0 = new THREE.Vector3();
  const handLocalV = new THREE.Vector3();
  function handLocal(controller, out) {
    controller.getWorldPosition(out);
    return group.worldToLocal(out);
  }
  // twist of the controller about the oar shaft (boat frame), for feathering
  function wristRollOld(controller, axis) {
    controller.getWorldQuaternion(oarQ);
    group.getWorldQuaternion(oarQ2);
    oarQ.premultiply(oarQ2.invert());
    oarX.set(0, 1, 0).applyQuaternion(oarQ);
    if (Math.abs(oarX.dot(axis)) > 0.9) oarX.set(0, 0, -1).applyQuaternion(oarQ);
    oarN0.crossVectors(oarUp, axis).normalize();
    oarB0.crossVectors(axis, oarN0);
    return Math.atan2(oarX.dot(oarB0), oarX.dot(oarN0));
  }
  // Pose one oar in the boat frame from the hand (or the rest pose). The handle end follows the hand's height
  // (minus the grab calibration) and its bearing around the ring; the oar always passes through the ring, so the
  // blade moves the other way, Lout/Lin = 2.8x as far.
  function poseLongOarOld(o) {
    const { P, side } = o;
    const Lin = OARS.inboard;
    let dy;
    let ux;
    let uz;
    let feather;
    if (o.hand) {
      const h = handLocal(o.hand, handLocalV);
      dy = THREE.MathUtils.clamp(h.y - o.dy0 - P.y, -0.8 * Lin, 0.8 * Lin);
      const hx = h.x - P.x;
      const hz = h.z - P.z;
      let ang = Math.atan2(hz, Math.max(0.02, -side * hx)); // 0 = straight inboard, + = toward the stern
      ang = THREE.MathUtils.clamp(ang, -1.25, 1.25);
      ux = -side * Math.cos(ang);
      uz = Math.sin(ang);
      feather = o.feather;
    } else {
      dy = 0.05;
      const ang = 0.12; // square in the lock, shaft through the ring, blade just out over the side
      ux = -side * Math.cos(ang);
      uz = Math.sin(ang);
      feather = 0.35;
    }
    const horiz = Math.sqrt(Math.max(0, Lin * Lin - dy * dy));
    // inboard unit direction (ring -> handle end)
    oarTmp.set(ux * horiz, dy, uz * horiz).divideScalar(Lin);
    o.end.copy(P).addScaledVector(oarTmp, Lin);
    o.axis.copy(oarTmp).negate(); // handle -> blade
    oarN0.crossVectors(oarUp, o.axis).normalize();
    oarB0.crossVectors(o.axis, oarN0);
    o.normal.copy(oarN0).multiplyScalar(Math.cos(feather)).addScaledVector(oarB0, Math.sin(feather));
    const yAxis = oarTmp; // model +Y points from the blade back to the handle
    oarX.crossVectors(yAxis, o.normal).normalize();
    o.basis.makeBasis(oarX, yAxis, o.normal).setPosition(o.end);
    o.root.matrix.copy(o.basis);
    o.root.matrixWorldNeedsUpdate = true;
  }
  // twist of the controller about the oar shaft (boat frame): the controller's X axis projected on the plane
  // across the shaft. No axis switching (the old version swapped axes near 0.9 and jumped); null when undefined.
  function wristRoll(controller, axis) {
    if (OARS_OLD) return wristRollOld(controller, axis);
    controller.getWorldQuaternion(oarQ);
    group.getWorldQuaternion(oarQ2);
    oarQ.premultiply(oarQ2.invert());
    oarX.set(1, 0, 0).applyQuaternion(oarQ);
    oarX.addScaledVector(axis, -oarX.dot(axis));
    if (oarX.lengthSq() < 0.09) return null;
    oarN0.crossVectors(oarUp, axis).normalize();
    oarB0.crossVectors(axis, oarN0);
    return Math.atan2(oarX.dot(oarB0), oarX.dot(oarN0));
  }
  // Pose one oar in the boat frame. The ring is fixed; the handle end sits on a sphere of radius `inboard` around it,
  // aimed at the hand (bearing from the hand's XZ offset, pitch from its height minus the grab calibration). Clamped
  // and rate-limited; the blade face is square to the sweep unless a deliberate feather is on.
  function poseLongOar(o, dt = 0, lift = 0, keep = false) {
    if (OARS_OLD) return poseLongOarOld(o);
    const { P, side } = o;
    const Lin = OARS.inboard;
    let dy;
    let ang;
    let feather = 0;
    if (o.hand) {
      const h = handLocal(o.hand, handLocalV);
      dy = h.y - o.dy0 - P.y;
      const hx = h.x - P.x;
      const hz = h.z - P.z;
      const inb = -side * hx;
      ang = o.ang ?? 0.1;
      if (!keep && Math.hypot(hx, hz) > OAR_FEEL.near) ang = Math.atan2(hz, Math.max(0.05, inb)); // 0 = straight inboard, + = toward the stern
      ang = THREE.MathUtils.clamp(ang, OAR_FEEL.fore, OAR_FEEL.aft);
      if (!keep && dt > 0 && o.ang != null) ang = o.ang + THREE.MathUtils.clamp(ang - o.ang, -OAR_FEEL.rate * dt, OAR_FEEL.rate * dt);
      feather = o.feather;
    } else {
      dy = 0.05;
      ang = 0.12; // square in the lock, shaft through the ring, blade just out over the side
      feather = 0.35;
    }
    o.ang = o.hand ? ang : null;
    dy = THREE.MathUtils.clamp(dy + lift, OAR_FEEL.dyMin, OAR_FEEL.dyMax + lift);
    const horiz = Math.sqrt(Math.max(0, Lin * Lin - dy * dy));
    oarTmp.set(-side * Math.cos(ang) * horiz, dy, Math.sin(ang) * horiz).divideScalar(Lin); // ring -> handle end
    o.end.copy(P).addScaledVector(oarTmp, Lin);
    o.axis.copy(oarTmp).negate(); // handle -> blade
    oarN0.crossVectors(oarUp, o.axis).normalize();
    oarB0.crossVectors(o.axis, oarN0);
    o.normal.copy(oarN0).multiplyScalar(Math.cos(feather)).addScaledVector(oarB0, Math.sin(feather));
    const yAxis = oarTmp; // model +Y points from the blade back to the handle
    oarX.crossVectors(yAxis, o.normal).normalize();
    o.basis.makeBasis(oarX, yAxis, o.normal).setPosition(o.end);
    o.root.matrix.copy(o.basis);
    o.root.matrixWorldNeedsUpdate = true;
  }
  // closest distance between the two inboard shafts (ring -> handle end), boat frame
  const segQ = new THREE.Line3();
  const segC1 = new THREE.Vector3();
  const segC2 = new THREE.Vector3();
  function handleGap(a, b) {
    segLine.set(a.P, a.end);
    segQ.set(b.P, b.end);
    let best = Infinity;
    for (let i = 0; i <= 8; i += 1) {
      segLine.at(i / 8, segC1);
      segQ.closestPointToPoint(segC1, true, segC2);
      best = Math.min(best, segC1.distanceTo(segC2));
    }
    return best;
  }
  // both oars: pose, then keep the handles apart (starboard over port)
  function poseOarPair(dt) {
    longOars.forEach((o) => poseLongOar(o, dt));
    if (OARS_OLD || longOars.length < 2) return;
    const star = longOars.find((o) => o.side > 0);
    const port = longOars.find((o) => o.side < 0);
    let lift = 0;
    while (handleGap(star, port) < OAR_FEEL.gap && lift < 0.12) {
      lift += 0.015;
      poseLongOar(star, 0, lift, true);
    }
  }
  function nearLongOar(points, reach = 0.24) {
    let best = null;
    let bestDist = reach;
    for (const o of longOars) {
      if (o.hand) continue;
      segA.copy(o.end);
      group.localToWorld(segA);
      segB.copy(o.end).addScaledVector(o.axis, 0.3);
      group.localToWorld(segB);
      const seg = segLine.set(segA, segB);
      for (const point of points) {
        seg.closestPointToPoint(point, true, segP);
        const dist = segP.distanceTo(point);
        if (dist < bestDist) { bestDist = dist; best = o; }
      }
    }
    return best;
  }
  function takeLongOar(controller, points) {
    if (longOars.some((o) => o.hand === controller)) return false;
    const o = nearLongOar(points, 0.26);
    if (!o) return false;
    // calibrate: wherever you take hold, the blade starts just under the surface (catch-ready)
    const pivotW = oarTmp.copy(o.P);
    group.localToWorld(pivotW);
    // ground/boat pass: calibrate against the level boat (the 1-2 deg bob roll used to give the two oars different
    // neutral depths, so equal strokes pulled to one side)
    const above = (OARS_OLD ? pivotW.y : group.position.y + o.P.y) - surfaceAt(pivotW.x, pivotW.z);
    const outCentre = OARS.len - OARS.inboard - OARS.bladeLen / 2;
    const dyNeutral = (above + OARS.neutralDepth) * OARS.inboard / outCentre;
    const h = handLocal(controller, handLocalV);
    o.dy0 = THREE.MathUtils.clamp(h.y - o.P.y - dyNeutral, -0.7, 0.7);
    o.hand = controller;
    o.prev = [null, null, null];
    o.wet = 0;
    o.wasWet = false;
    o.feather = 0;
    o.ang = null;
    poseLongOar(o);
    o.roll0 = wristRoll(controller, o.axis) ?? 0;
    o.feathered = false;
    oarGrips[o.name] = controller;
    onHaptic?.(controller, 0.8, 60);
    snapHand(controller, o.root);
    return true;
  }
  function dropLongOar(o) {
    if (o.hand) restoreHand(o.hand);
    gripHands[o.name].visible = false;
    oarGrips[o.name] = null;
    o.hand = null;
    o.prev = [null, null, null];
    o.userData.gripZone.material.emissive.setHex(0x000000);
    poseLongOar(o);
  }
  const oaPoint = new THREE.Vector3();
  const oaVel = new THREE.Vector3();
  const oaNormal = new THREE.Vector3();
  const oaQuat = new THREE.Quaternion();
  const oarLock = new THREE.Vector3();
  function oarForces(dt) {
    const out = { x: 0, z: 0, torque: 0 };
    group.updateMatrixWorld(true);
    group.getWorldQuaternion(oaQuat);
    for (const o of longOars) {
      if (o.hand && OARS_OLD && OARS.feather) {
        const roll = wristRoll(o.hand, o.axis) - o.roll0;
        const r = Math.atan2(Math.sin(roll), Math.cos(roll));
        const dead = 0.44;
        o.feather = Math.abs(r) <= dead ? 0 : THREE.MathUtils.clamp((r - Math.sign(r) * dead) * 1.6, -Math.PI / 2, Math.PI / 2);
      } else if (o.hand && !OARS_OLD) {
        // square blade unless ?feather=1 and a deliberate twist (hysteresis, binary: square or flat)
        const roll = OAR_FEEL.feather ? wristRoll(o.hand, o.axis) : null;
        if (roll != null) {
          const r = Math.abs(Math.atan2(Math.sin(roll - o.roll0), Math.cos(roll - o.roll0)));
          if (!o.feathered && r > OAR_FEEL.featherOn) o.feathered = true;
          else if (o.feathered && r < OAR_FEEL.featherOff) o.feathered = false;
        }
        if (!OAR_FEEL.feather) o.feathered = false;
        o.feather = o.feathered ? Math.PI / 2 : 0;
      }
    }
    if (OARS_OLD) longOars.forEach((o) => poseLongOar(o));
    else poseOarPair(dt);
    for (const o of longOars) {
      const shown = gripHands[o.name];
      if (!o.hand) { shown.visible = false; continue; }
      o.root.updateMatrixWorld(true);
      shown.visible = true;
      o.root.getWorldPosition(shown.position);
      o.root.getWorldQuaternion(shown.quaternion);
      if (!dt) continue;
      oaNormal.copy(o.normal).applyQuaternion(oaQuat);
      let wetSum = 0;
      let force = 0;
      const yaw = sim.yaw;
      OARS.samples.forEach((fromTip, i) => {
        oaPoint.copy(o.end).addScaledVector(o.axis, OARS.len - fromTip);
        group.localToWorld(oaPoint);
        const prev = o.prev[i];
        const depth = surfaceAt(oaPoint.x, oaPoint.z) - oaPoint.y;
        const wet = THREE.MathUtils.clamp(depth / OARS.wetBand[0] + OARS.wetBand[1], 0, 1);
        wetSum += wet;
        if (prev && wet > 0) {
          oaVel.subVectors(oaPoint, prev).multiplyScalar(1 / dt);
          if (oaVel.lengthSq() < 144) {            // > 12 m/s at the blade = tracking glitch: ignore
            const vn = oaVel.dot(oaNormal);
            const mag = -OARS.gain * wet * (OARS.k * Math.abs(vn) + OARS.lin) * vn;
            const fx = oaNormal.x * mag;
            const fz = oaNormal.z * mag;
            const f = boatFrame(fx, fz, yaw);
            if (!OARS_OLD) { oarLock.copy(o.P); group.localToWorld(oarLock); } // force goes into the boat at the ring
            const at = OARS_OLD ? oaPoint : oarLock;
            const r = boatFrame(at.x - group.position.x, at.z - group.position.z, yaw);
            out.x += f.lat;
            out.z += f.along;
            out.torque += r.along * f.lat - r.lat * f.along;
            force += Math.hypot(fx, fz);
          }
        }
        if (prev) prev.copy(oaPoint); else o.prev[i] = oaPoint.clone();
      });
      o.wet = wetSum / OARS.samples.length;
      o.force = force;
      const tip = oaPoint.copy(o.end).addScaledVector(o.axis, OARS.len - 0.35);
      group.localToWorld(tip);
      if (o.wet > 0.25 && !o.wasWet) {
        onHaptic?.(o.hand, ROW_OLD ? 0.45 : 0.75, ROW_OLD ? 30 : 50); // the catch
        water.ripple?.(tip.x, tip.z, 0.6);
        onSplash?.('catch', tip, Math.min(1, 0.3 + force / 180));
      } else if (o.wet < 0.08 && o.wasWet) {
        onHaptic?.(o.hand, 0.12, 12);
        onSplash?.('exit', tip, 0.3);
      } else if (o.wet > 0.25 && force > 5) {
        onHaptic?.(o.hand, ROW_OLD ? 0.05 + 0.35 * Math.min(1, force / 180) : 0.12 + 0.5 * Math.min(1, force / 220), 25); // load through the drive
      }
      if (o.wet > 0.25 !== o.wasWet) o.wasWet = o.wet > 0.25;
    }
    const fl = Math.hypot(out.x, out.z);
    if (fl > OARS.maxForce) { out.x *= OARS.maxForce / fl; out.z *= OARS.maxForce / fl; }
    out.torque = THREE.MathUtils.clamp(out.torque, -OARS.maxTorque, OARS.maxTorque);
    if (beached()) { out.x *= 0.15; out.z *= 0.15; out.torque *= 0.15; }
    lastPush = out;
    return out;
  }
  longOars.forEach((o) => poseLongOar(o));

  function nearOar(points, reach = 0.26) {
    if (OAR_MODE) return nearLongOar(points, Math.max(reach, 0.24));
    if (PADDLE_MODE) return nearPaddle(points, Math.max(reach, 0.3));
    let best = null;
    let bestDist = reach;
    for (const oar of oars) {
      oar.updateWorldMatrix(true, false);
      segA.set(-oar.userData.side * 0.38, 0, 0);
      oar.localToWorld(segA);
      segB.set(oar.userData.side * 0.05, 0, 0);
      oar.localToWorld(segB);
      const seg = segLine.set(segA, segB);
      for (const point of points) {
        seg.closestPointToPoint(point, true, segP);
        const dist = segP.distanceTo(point);
        if (dist < bestDist) {
          bestDist = dist;
          best = oar;
        }
      }
    }
    return best;
  }

  function tryOar(controller, points) {
    if (OAR_MODE) return takeLongOar(controller, points);
    if (PADDLE_MODE) return takePaddle(controller, points);
    const oar = legacy('oarreach')
      ? nearest(points, oars.map((item) => item.userData.gripZone), 0.42)?.parent
      : nearOar(points);
    if (!oar) return false;
    const name = oar.userData.name;
    if (oarGrips[name]) return false;
    oarGrips[name] = controller;
    oar.userData.prevBlade.set(0, 0, 0);
    onHaptic?.(controller, 0.8, 60);
    snapHand(controller, oar.userData.gripZone);
    gripHands[name].visible = true;
    return true;
  }

  function release(controller) {
    for (const pd of paddles) if (pd.hand === controller) dropPaddle(pd);
    for (const o of longOars) if (o.hand === controller) dropLongOar(o);
    if (drag?.controller === controller) {
      drag = null;
      onHaptic?.(controller, 0.2, 20);
    }
    for (const name of Object.keys(oarGrips)) {
      if (oarGrips[name] === controller) {
        oarGrips[name] = null;
        gripHands[name].visible = false;
      }
    }
    restoreHand(controller);
  }

  function anyOar() {
    return !!(oarGrips.starboard || oarGrips.port);
  }

  // Let go of everything the boat holds (oars, paddles, the bow/stern rope) and give the hands back. Called whenever
  // you leave the canoe, however you leave it (rowing pass: leaving used to keep oars, rope and hidden hands attached).
  function releaseAll() {
    const hands = new Set();
    paddles.forEach((pd) => { if (pd.hand) hands.add(pd.hand); });
    longOars.forEach((o) => { if (o.hand) hands.add(o.hand); });
    Object.values(oarGrips).forEach((c) => { if (c) hands.add(c); });
    if (drag?.controller) hands.add(drag.controller);
    hands.forEach((c) => release(c));
    paddles.forEach((pd) => { if (pd.hand) dropPaddle(pd); });
    longOars.forEach((o) => { if (o.hand) dropLongOar(o); });
    oarGrips.starboard = null;
    oarGrips.port = null;
    drag = null;
    Object.values(gripHands).forEach((hand) => { hand.visible = false; });
  }

  function setSplash(fn) {
    onSplash = fn || null;
  }

  function hover(points) {
    const oar = nearOar(points || []);
    if (oar !== hoveredOar) {
      if (hoveredOar) hoveredOar.userData.gripZone.material.emissive.setHex(0x000000);
      hoveredOar = oar;
      if (oar) {
        oar.userData.gripZone.material.emissive.setHex(0xffd27a);
        oar.userData.gripZone.material.emissiveIntensity = 0.7;
        if (points.controller) onHaptic?.(points.controller, 0.15, 15);
      }
    }
    const loop = nearest(points || [], loops, 0.35);
    if (loop === hovered) return;
    if (hovered) hovered.material.emissive.setHex(0x000000);
    hovered = loop;
    if (!loop) {
      modelMats.forEach((material) => material.emissive?.setHex(0x000000));
      return;
    }
    loop.material.emissive.setHex(0xffd27a);
    loop.material.emissiveIntensity = 0.6;
    modelMats.forEach((material) => {
      material.emissive?.setHex(0x332211);
      material.emissiveIntensity = 0.35;
    });
    const hand = points.controller;
    if (hand) onHaptic?.(hand, 0.15, 15);
  }

  function update(dt, aboard = rider) {
    clock += dt;
    if (drag) drag.aboard = aboard;
    sim.mass = aboard ? 120 : 45;
    sim.inertia = aboard ? 90 : 30;
    const targetDraft = aboard ? 0.16 : 0.12;
    draft += (targetDraft - draft) * (1 - Math.exp(-dt / 0.4));
    let bob = 0.012 * Math.sin(1.6 * clock) + 0.006 * Math.sin(2.7 * clock + 1);
    let floatY = water.level + 0.09 - draft + bob;
    if (water.ocean?.heightAt) {
      const target = water.ocean.heightAt(group.position.x, group.position.z);
      surf += (target - surf) * (1 - Math.exp(-dt / 0.35));
      bob *= 0.5;
      floatY = water.level + 0.09 - draft + surf + bob;
    }
    const samples = [-1.6, 0, 1.6].map((z) => {
      local.set(0, 0, z);
      group.localToWorld(local);
      const ground = water.ground?.(local.x, local.z);
      const height = Math.max(floatY, Number.isFinite(ground) ? ground + 0.09 : -Infinity);
      return { z, x: local.x, wz: local.z, height, grounded: Number.isFinite(ground) && ground + 0.09 >= floatY };
    });
    groundedFrac = samples.filter((sample) => sample.grounded).length / samples.length;
    sim.groundedFrac = groundedFrac;
    const bowY = samples[0].height;
    const sternY = samples[2].height;
    group.position.y = (bowY + sternY) / 2;
    group.rotation.x = Math.atan2(bowY - sternY, 3.2);
    if (water.ocean?.heightAt) {
      const bowH = water.ocean.heightAt(samples[0].x, samples[0].wz);
      const sternH = water.ocean.heightAt(samples[2].x, samples[2].wz);
      const targetPitch = Math.atan2(bowH - sternH, 3.2);
      swellPitch += (targetPitch - swellPitch) * (1 - Math.exp(-dt / 0.35));
      group.rotation.x += swellPitch;
    }
    const bobRoll = 0.02 * Math.sin(1.1 * clock);
    // ground/boat pass: the roll bob is cosmetic. It used to be on while the blades were sampled, so one blade sat
    // ~3 cm deeper than the other and equal strokes curved; now the forces see a level hull and the bob goes on after.
    group.rotation.z = OARS_OLD ? bobRoll : 0;

    const poseX = group.position.x;
    const poseZ = group.position.z;
    const poseYaw = sim.yaw;

    if (PADDLE_MODE && !aboard) paddles.forEach((pd) => { if (pd.hand) dropPaddle(pd); });
    if (OAR_MODE && !aboard) longOars.forEach((o) => { if (o.hand) dropLongOar(o); });
    const strokes = OAR_MODE ? { push: oarForces(dt) }
      : PADDLE_MODE ? { push: paddleForces(dt) } : (poseOars(dt, aboard), bladeStrokes(dt));
    driftHome(dt, aboard);
    stepBoat(sim, dt, strokes);
    group.position.x += sim.vx * dt;
    group.position.z += sim.vz * dt;
    if (drag) steerHeld(poseX, poseZ, poseYaw, dt);
    group.rotation.y = sim.yaw;
    group.rotation.z = bobRoll;
    const softX = -16;
    if (group.position.x < softX) sim.vx += (-16.4 - group.position.x) * dt;
    const zLimit = 7;
    const zOff = group.position.z - cave.z;
    if (Math.abs(zOff) > zLimit) sim.vz -= Math.sign(zOff) * (Math.abs(zOff) - zLimit) * dt;
    water.setBoat?.(group.position.x, group.position.z, group.rotation.y, floating(), surf);
    center.copy(group.position);
    seat.getWorldPosition(seatPoint);
    massNow();
  }

  function poseOars(dt, aboard) {
    oars.forEach((oar) => {
      const name = oar.userData.name;
      const hand = oarGrips[name];
      const pin = new THREE.Vector3(Math.sign(oar.userData.side) * OARLOCK.x, OARLOCK.y, OARLOCK.z);
      if (!hand) {
        const dir = restDir.clone();
        dir.x *= oar.userData.side;
        oar.position.copy(pin);
        oar.quaternion.setFromUnitVectors(new THREE.Vector3(oar.userData.side > 0 ? 1 : -1, 0, 0), dir);
        return;
      }
      const gripPoint = new THREE.Vector3();
      hand.getWorldPosition(gripPoint);
      group.worldToLocal(gripPoint);
      const toward = pin.clone().sub(gripPoint);
      if (toward.lengthSq() < 1e-6) toward.set(0, 0, 1);
      toward.normalize();
      oar.position.copy(pin);
      oar.quaternion.setFromUnitVectors(new THREE.Vector3(oar.userData.side > 0 ? 1 : -1, 0, 0), toward.clone().multiplyScalar(oar.userData.side));
      oar.userData.hand = gripPoint;
      const shown = gripHands[name];
      oar.updateWorldMatrix(true, false);
      oar.userData.gripZone.getWorldPosition(shown.position);
      oar.getWorldQuaternion(shown.quaternion);
    });
  }

  function groundedNow() {
    const floatY = water.level + 0.09 - draft;
    let grounded = 0;
    for (const z of [-1.6, 0, 1.6]) {
      local.set(0, 0, z);
      group.localToWorld(local);
      const ground = water.ground?.(local.x, local.z);
      if (Number.isFinite(ground) && ground + 0.09 >= floatY) grounded += 1;
    }
    groundedFrac = grounded / 3;
    sim.groundedFrac = groundedFrac;
  }

  function driftHome(dt, aboard) {
    const idle = !aboard && !drag && !anyOar();
    idleTime = idle ? idleTime + dt : 0;
    if (oldSpot || !shelf || idleTime < 6 || !floating()) {
      homing = false;
      return;
    }
    const dx = HOME.x - group.position.x;
    const dz = HOME.z - group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.5) homing = true;
    if (dist < 0.4) homing = false;
    if (!homing) return;
    const speed = Math.min(0.45, 0.06 + dist * 0.08);
    const k = 1 - Math.exp(-dt / 1.5);
    sim.vx += ((dx / dist) * speed - sim.vx) * k;
    sim.vz += ((dz / dist) * speed - sim.vz) * k;
    let dyaw = Math.PI / 2 - sim.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    sim.yawRate += (dyaw * 0.25 - sim.yawRate) * k;
  }

  const pdPoint = new THREE.Vector3();
  const pdVel = new THREE.Vector3();
  const pdNormal = new THREE.Vector3();
  const pdMat = new THREE.Matrix4();
  const pdQuat = new THREE.Quaternion();
  function surfaceAt(x, z) {
    return water.level + (water.ocean?.heightAt ? water.ocean.heightAt(x, z) : 0);
  }
  // Each held paddle: sample 3 points on the blade; a submerged sample moving through the water with velocity v pushes
  // back with F = -(k |vn| + lin) vn n (n = blade face normal, vn = v.n), so the boat gets the reaction. A blade that is
  // out of the water (wrist tipped up / lifted for the recovery) gives nothing; a feathered (edge-on) blade gives little.
  // Forces are summed in the boat frame with torque about the hull centre: both paddles pulled back = forward,
  // one paddle = the boat turns away from that side; holding a blade still in the water while moving = brake.
  function paddleForces(dt) {
    const out = { x: 0, z: 0, torque: 0 };
    if (!dt) return out;
    const yaw = sim.yaw;
    for (const pd of paddles) {
      const hand = pd.hand;
      if (!hand) continue;
      const ref = hand.userData?.grip || hand;
      ref.updateMatrixWorld(true);
      pdMat.multiplyMatrices(ref.matrixWorld, HOLD);
      pd.mesh.matrix.copy(pdMat);
      pd.mesh.matrixWorldNeedsUpdate = true;
      pd.mesh.updateMatrixWorld(true);
      pdQuat.setFromRotationMatrix(pdMat);
      pdNormal.set(0, 0, 1).applyQuaternion(pdQuat);
      const shown = gripHands[pd.name];
      shown.visible = true;
      shown.position.setFromMatrixPosition(pdMat);
      shown.quaternion.copy(pdQuat);
      let wetSum = 0;
      let force = 0;
      PADDLE.samples.forEach((y, i) => {
        pdPoint.set(0, y, 0).applyMatrix4(pdMat);
        const prev = pd.prev[i];
        const depth = surfaceAt(pdPoint.x, pdPoint.z) - pdPoint.y;
        const wet = THREE.MathUtils.clamp(depth / 0.06 + 0.5, 0, 1);
        wetSum += wet;
        if (prev && wet > 0) {
          pdVel.subVectors(pdPoint, prev).multiplyScalar(1 / dt);
          if (pdVel.lengthSq() < 64) {            // > 8 m/s = tracking glitch / teleport: ignore
            const vn = pdVel.dot(pdNormal);
            const mag = -PADDLE.gain * wet * (PADDLE.k * Math.abs(vn) + PADDLE.lin) * vn;
            const fx = pdNormal.x * mag;
            const fz = pdNormal.z * mag;
            const f = boatFrame(fx, fz, yaw);
            const r = boatFrame(pdPoint.x - group.position.x, pdPoint.z - group.position.z, yaw);
            out.x += f.lat;
            out.z += f.along;
            out.torque += r.along * f.lat - r.lat * f.along;
            force += Math.hypot(fx, fz);
          }
        }
        if (prev) prev.copy(pdPoint); else pd.prev[i] = pdPoint.clone();
      });
      pd.wet = wetSum / PADDLE.samples.length;
      pd.force = force;
      const tip = pdPoint.set(0, -0.6, 0).applyMatrix4(pdMat);
      if (pd.wet > 0.25 && !pd.wasWet) {
        onHaptic?.(hand, 0.45, 30);
        water.ripple?.(tip.x, tip.z, 0.5);
        onSplash?.('catch', tip, Math.min(1, 0.3 + force / 150));
      } else if (pd.wet < 0.08 && pd.wasWet) {
        onHaptic?.(hand, 0.12, 12);
        onSplash?.('exit', tip, 0.3);
      } else if (pd.wet > 0.25 && force > 4) {
        onHaptic?.(hand, 0.05 + 0.35 * Math.min(1, force / 140), 25);
      }
      if (pd.wet > 0.25 !== pd.wasWet) pd.wasWet = pd.wet > 0.25;
    }
    const fl = Math.hypot(out.x, out.z);
    if (fl > PADDLE.maxForce) { out.x *= PADDLE.maxForce / fl; out.z *= PADDLE.maxForce / fl; }
    out.torque = THREE.MathUtils.clamp(out.torque, -PADDLE.maxTorque, PADDLE.maxTorque);
    if (beached()) { out.x *= 0.15; out.z *= 0.15; out.torque *= 0.15; } // blade on sand barely moves a grounded hull
    lastPush = out;
    return out;
  }
  let lastPush = { x: 0, z: 0, torque: 0 };
  let onSplash = null;

  function bladeStrokes(dt) {
    const result = {};
    oars.forEach((oar) => {
      const name = oar.userData.name;
      const blade = new THREE.Vector3(oar.userData.side * 1.48, 0, 0);
      oar.localToWorld(blade);
      const prev = oar.userData.prevBlade;
      const waterY = water.level - 0.09 + draft;
      const k = THREE.MathUtils.clamp((waterY - blade.y) / 0.12, 0, 1);
      let along = 0;
      if (prev.lengthSq() > 0 && dt > 0) {
        const vel = blade.clone().sub(prev).multiplyScalar(1 / dt);
        group.worldToLocal(vel.add(group.position));
        along = THREE.MathUtils.clamp(vel.z, -2.2, 2.2);
      }
      prev.copy(blade);
      const caught = k > 0.3 && along > 0.2;
      if (caught && !wasImmersed[name]) {
        onHaptic?.(oarGrips[name], 0.45, 35);
        water.ripple?.(blade.x, blade.z, 0.6);
      } else if (k <= 0 && wasImmersed[name]) onHaptic?.(oarGrips[name], 0.12, 12);
      else if (k > 0.3 && oarGrips[name]) {
        const force = BLADE * k * Math.abs(along);
        onHaptic?.(oarGrips[name], 0.08 + 0.3 * Math.min(1, force / 90), 25);
      }
      wasImmersed[name] = k > 0.3;
      if (oarGrips[name]) result[name] = { k, along };
    });
    return result;
  }

  function steerHeld(prevX, prevZ, prevYaw, dt) {
    const held = drag;
    if (!held) return;
    const hand = new THREE.Vector3();
    held.controller.getWorldPosition(hand);
    const framed = boatFrame(hand.x - held.pos0.x, hand.z - held.pos0.z, held.yaw0);
    const lever = Math.max(0.9, Math.abs(held.anchor.z));
    const yaw = held.yaw0 + soften(framed.lat - held.lat0, 0.02) / lever;
    const slide = soften(framed.along - held.along0, 0.03);
    const sin0 = Math.sin(held.yaw0);
    const cos0 = Math.cos(held.yaw0);
    let x = held.pos0.x + sin0 * slide + held.nudgeX;
    let z = held.pos0.z + cos0 * slide + held.nudgeZ;
    if (x < -16) {
      held.pos0.x += -16 - x;
      x = -16;
    }
    const zOff = z - cave.z;
    if (Math.abs(zOff) > 7) {
      const clamped = cave.z + Math.sign(zOff) * 7;
      held.pos0.z += clamped - z;
      z = clamped;
    }
    const ring = ringXZ(held.anchor, yaw, { x, z });
    const sep = boatFrame(hand.x - ring.x, hand.z - ring.z, yaw);
    const slipLat = sep.lat - held.sepLat0;
    const slipAlong = sep.along - held.sepAlong0;
    if (Math.abs(slipLat) > 0.75 || Math.hypot(slipLat, slipAlong) > 2.6) {
      release(held.controller);
      return;
    }
    group.position.x = x;
    group.position.z = z;
    sim.yaw = yaw;
    const safeDt = Math.max(dt, 1 / 120);
    const vx = (x - prevX) / safeDt;
    const vz = (z - prevZ) / safeDt;
    const speed = Math.hypot(vx, vz);
    const scale = speed > 2 ? 2 / speed : 1;
    sim.vx = vx * scale;
    sim.vz = vz * scale;
    sim.yawRate = THREE.MathUtils.clamp((yaw - prevYaw) / safeDt, -1.4, 1.4);
    if (groundedFrac > 0 && speed > 0.12) {
      onHaptic?.(held.controller, 0.12 + 0.28 * Math.min(1, speed / 1.2), 30);
    }
  }

  function holding(controller) {
    return !!drag && (!controller || drag.controller === controller);
  }

  function setHaptics(fn) {
    onHaptic = fn || null;
  }

  function knock(dir, strength = 1) {
    if (!dir) return;
    const len = Math.hypot(dir.x, dir.z) || 1;
    sim.vx += (dir.x / len) * 0.8 * strength;
    sim.vz += (dir.z / len) * 0.8 * strength;
    sim.yawRate += (Math.random() - 0.5) * 0.6 * strength;
  }

  return {
    group,
    ends,
    oars,
    loops,
    seat,
    hull,
    update,
    shove,
    stroke,
    floating,
    seatPoint,
    center,
    setHaptics,
    knock,
    grab,
    tryOar,
    release,
    holding,
    hover,
    nearOar,
    anyOar,
    oarGrips,
    setAboard,
    setSplash,
    releaseAll,
    paddles,
    longOars,
    paddleMode: PADDLE_MODE,
    oarMode: OAR_MODE,
    rowMode: ROW_MODE,
    rider: () => rider,
    debug: () => ({
      sim: { ...sim },
      push: lastPush,
      paddles: paddles.map((pd) => ({ name: pd.name, held: !!pd.hand, wet: +pd.wet.toFixed(2), force: +pd.force.toFixed(1) })),
      oars: longOars.map((o) => ({ name: o.name, held: !!o.hand, wet: +o.wet.toFixed(2), force: +o.force.toFixed(1), feather: +o.feather.toFixed(2) })),
      gripHandsVisible: Object.values(gripHands).filter((h) => h.visible).length,
      drag: !!drag,
      floating: floating(),
    }),
  };
}

function boatFrame(dx, dz, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    lat: dx * cos - dz * sin,
    along: dx * sin + dz * cos,
  };
}

function ringXZ(anchor, yaw, pos) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: pos.x + anchor.x * cos + anchor.z * sin,
    z: pos.z - anchor.x * sin + anchor.z * cos,
  };
}

function soften(value, dead) {
  if (Math.abs(value) <= dead) return 0;
  return value - Math.sign(value) * dead;
}

function makeGripHand() {
  const hand = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9956b, roughness: 0.66 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.036, 0.04), skin);
  hand.add(palm);
  for (let i = 0; i < 4; i += 1) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.032, 0.014), skin);
    finger.position.set(0.01, 0.01, -0.018 + i * 0.012);
    finger.rotation.z = -1.1;
    hand.add(finger);
  }
  return hand;
}

function snapHand(controller, target) {
  const grip = controller.userData?.grip;
  if (grip?.children?.[0]) grip.children[0].visible = false;
  controller.userData.hiddenGrip = grip?.children?.[0] || null;
}

function restoreHand(controller) {
  if (controller.userData?.hiddenGrip) controller.userData.hiddenGrip.visible = true;
}
