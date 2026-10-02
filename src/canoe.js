import * as THREE from 'three';
import { proxyMaterial } from './assets.js';
import { legacy } from './flags.js';

// Bow is local -Z, starboard is local +X. The rower faces the stern (local +Z), so their
// left hand works the starboard oar. A starboard-only power stroke yaws the bow to port:
// positive yaw, counter-clockwise from above. From the seat, the stern swings to the left.
const BLADE = 78;
const OARLOCK = { x: 0.5, y: 0.34, z: 0.02 };
// Hand paddles (feedback pass, default): one short paddle per hand, thrust from the blade's velocity through the water.
// ?rowing=old (or ?legacy=row) goes back to the oarlock oars. ?paddlegain=<n> scales the thrust (default 1).
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const PADDLE_MODE = params.get('rowing') !== 'old' && !legacy('row');
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
  const long = dragAccel(localZ);
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
  sim.yawRate += (torque / sim.inertia - 1.8 * sim.yawRate) * dt;
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
    ? ((PADDLE_MODE && assets.instance('canoe_cedar')) || assets.instance('canoe'))
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
    oarGrips[pd.name] = null;
    pd.hand = null;
    pd.mesh.parent?.remove(pd.mesh);
    group.add(pd.mesh);
    pd.mesh.matrix.copy(pd.rest);
    pd.userData.gripZone?.material.emissive?.setHex(0x000000);
  }

  function nearOar(points, reach = 0.26) {
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
    group.rotation.z = 0.02 * Math.sin(1.1 * clock);

    const poseX = group.position.x;
    const poseZ = group.position.z;
    const poseYaw = sim.yaw;

    if (PADDLE_MODE && !aboard) paddles.forEach((pd) => { if (pd.hand) dropPaddle(pd); });
    const strokes = PADDLE_MODE ? { push: paddleForces(dt) } : (poseOars(dt, aboard), bladeStrokes(dt));
    driftHome(dt, aboard);
    stepBoat(sim, dt, strokes);
    group.position.x += sim.vx * dt;
    group.position.z += sim.vz * dt;
    if (drag) steerHeld(poseX, poseZ, poseYaw, dt);
    group.rotation.y = sim.yaw;
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
    if (!floating()) { out.x *= 0.15; out.z *= 0.15; out.torque *= 0.15; } // blade on sand barely moves a grounded hull
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
    paddles,
    paddleMode: PADDLE_MODE,
    debug: () => ({ sim: { ...sim }, push: lastPush, paddles: paddles.map((pd) => ({ name: pd.name, held: !!pd.hand, wet: +pd.wet.toFixed(2), force: +pd.force.toFixed(1) })), floating: floating() }),
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
