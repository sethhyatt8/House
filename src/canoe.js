import * as THREE from 'three';
import { proxyMaterial } from './assets.js';

// Bow is local -Z, starboard is local +X. The rower faces the stern (local +Z), so their
// left hand works the starboard oar. A starboard-only power stroke yaws the bow to port:
// positive yaw, counter-clockwise from above. From the seat, the stern swings to the left.
const BLADE = 78;
const OARLOCK = { x: 0.5, y: 0.33, z: 0.32 };

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
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16), ropeMat);
    loop.position.set(0, 0.34, dir * 1.82);
    loop.rotation.y = Math.PI / 2;
    loop.userData = { type: 'boatEnd', end: stem.userData.end, loop: true };
    group.add(loop);
    loops.push(loop);
  });
  const oars = [];
  const restDir = new THREE.Vector3(0.25, -0.05, -0.97).normalize();
  [-1, 1].forEach((side) => {
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), trim);
    fork.position.set(side * OARLOCK.x, OARLOCK.y, OARLOCK.z);
    group.add(fork);
    const oar = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 2.1, 6), oarMat);
    shaft.rotation.z = Math.PI / 2;
    oar.add(shaft);
    const gripZone = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6), leather);
    gripZone.rotation.z = Math.PI / 2;
    gripZone.position.x = -side * 0.56;
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
  const canoeModel = assets?.feature('boats') ? assets.instance('canoe') : null;
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
  group.rotation.y = Math.PI / 2;
  group.position.set(cave.boatX + 0.7, cave.floor + 0.12, cave.z + 2.45);
  scene.add(group);
  targets.push(group);

  const sim = createBoatSim(false);
  sim.yaw = Math.PI / 2;
  const seatPoint = new THREE.Vector3();
  const center = new THREE.Vector3();
  let onHaptic = null;
  let draft = 0.12;
  let groundedFrac = 0;
  let hovered = null;
  const anchor = new THREE.Vector3();
  let drag = null;
  const oarGrips = { starboard: null, port: null };
  const gripHand = makeGripHand();
  gripHand.visible = false;
  scene.add(gripHand);
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

  function tryOar(controller, points) {
    const handle = nearest(points, oars.map((oar) => oar.userData.gripZone), 0.3);
    if (!handle) return false;
    const oar = handle.parent;
    const name = oar.userData.name;
    if (oarGrips[name]) return false;
    oarGrips[name] = controller;
    onHaptic?.(controller, 0.8, 60);
    snapHand(controller, handle);
    return true;
  }

  function release(controller) {
    if (drag?.controller === controller) {
      drag = null;
      onHaptic?.(controller, 0.2, 20);
    }
    for (const name of Object.keys(oarGrips)) {
      if (oarGrips[name] === controller) oarGrips[name] = null;
    }
    restoreHand(controller);
  }

  function anyOar() {
    return !!(oarGrips.starboard || oarGrips.port);
  }

  function hover(points) {
    const loop = nearest(points, loops, 0.35);
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
    const bob = 0.012 * Math.sin(1.6 * clock) + 0.006 * Math.sin(2.7 * clock + 1);
    const floatY = water.level + 0.09 - draft + bob;
    const samples = [-1.6, 0, 1.6].map((z) => {
      local.set(0, 0, z);
      group.localToWorld(local);
      const ground = water.ground?.(local.x, local.z);
      const height = Math.max(floatY, Number.isFinite(ground) ? ground + 0.09 : -Infinity);
      return { z, height, grounded: Number.isFinite(ground) && ground + 0.09 >= floatY };
    });
    groundedFrac = samples.filter((sample) => sample.grounded).length / samples.length;
    sim.groundedFrac = groundedFrac;
    const bowY = samples[0].height;
    const sternY = samples[2].height;
    group.position.y = (bowY + sternY) / 2;
    group.rotation.x = Math.atan2(bowY - sternY, 3.2);
    group.rotation.z = 0.02 * Math.sin(1.1 * clock);

    const poseX = group.position.x;
    const poseZ = group.position.z;
    const poseYaw = sim.yaw;

    poseOars(dt, aboard);
    const strokes = bladeStrokes(dt);
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
    if (water.uniform) {
      water.uniform.value.set(group.position.x, group.position.z, group.rotation.y, floating() ? 1 : 0);
    }
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
    });
  }

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
        along = vel.z;
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
    grab,
    tryOar,
    release,
    holding,
    hover,
    anyOar,
    oarGrips,
    setAboard,
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
