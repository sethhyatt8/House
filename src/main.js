import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { createBrick, makeGhost, setBrickRaycast } from './bricks.js';
import { cellsFromGrid, generateModel, lookVerdict, sameLook } from './challenge.js';
import { colorById, GRID_X, GRID_Z, HEIGHT, heightById, LAYER, MAX_PEDESTALS, partLabel, PEG_MAX, PEG_MIN, shapeById, STUD, STUD_H } from './config.js';
import { brickLocalPosition, canPlaceAssembly, columnTop, connectedBricks, createGrid, findAssemblySnap, findSnap, footprintOf, occupy, release, rotatePieceRecords } from './grid.js';
import { hostRoomCode, openRoom, watchCodeFromUrl } from './watch.js';
import { CLIFF_X, WATER_Y, createPedestal, createWorld, pedestalSlot } from './world.js';

const statusEl = document.getElementById('status');
const hudEl = document.getElementById('hud');
const scalePanel = document.getElementById('scale-panel');
const pegInput = document.getElementById('peg-size');
const pegReadout = document.getElementById('peg-readout');
const roomCodeEl = document.getElementById('room-code');
const roomLabelEl = document.getElementById('room-label');
const watchForm = document.getElementById('watch-form');
const watchInput = document.getElementById('watch-code');
const watchNote = document.getElementById('watch-note');
const watchParam = new URLSearchParams(location.search).get('watch');
const watching = watchParam != null;
const roomCode = watching ? watchCodeFromUrl() : hostRoomCode();

const world = createWorld();
const { scene, camera, buildRoot, gridGroup, targets, machine, roof } = world;
const grid = createGrid();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.localClippingEnabled = true;
const envScene = new THREE.Scene();
envScene.add(new THREE.HemisphereLight(0x9aafd4, 0x2a3038, 0.85));
envScene.add(new THREE.Mesh(
  new THREE.SphereGeometry(8, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xb7c4d0, side: THREE.BackSide }),
));
const envGlow = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
envGlow.position.set(1.2, 3.4, 1.6);
envScene.add(envGlow);
const pmrem = new THREE.PMREMGenerator(renderer);
world.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
pmrem.dispose();
document.body.appendChild(renderer.domElement);
document.body.appendChild(XRButton.createButton(renderer, {
  optionalFeatures: ['local-floor', 'bounded-floor'],
}));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.12, 1.02, -0.42);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.62;
controls.minDistance = 0.45;
controls.maxDistance = 4.2;
controls.update();

const teleportSpots = [];
let teleportIndex = -1;
const spotRingGeo = new THREE.RingGeometry(0.18, 0.3, 40);
const spotDiscGeo = new THREE.CircleGeometry(0.16, 28);

function addTeleportSpot(spec) {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xb8ffe8,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(spotRingGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  const disc = new THREE.Mesh(
    spotDiscGeo,
    new THREE.MeshBasicMaterial({
      color: 0xf4fffb,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  group.add(ring, disc);
  group.position.set(spec.x, spec.floor ?? 0, spec.z);
  group.userData = { type: 'teleport', spot: teleportSpots.length };
  scene.add(group);
  targets.push(group);
  teleportSpots.push({ ...spec, ringMat });
}

addTeleportSpot({
  x: 0.9,
  z: 0.85,
  eye: new THREE.Vector3(0.9, 1.55, 0.85),
  look: new THREE.Vector3(0.15, 1.15, -0.45),
  status: 'Middle of the room.',
});
addTeleportSpot({
  x: -1.4,
  z: 0.05,
  eye: new THREE.Vector3(-1.34, 1.55, 0.62),
  look: new THREE.Vector3(-5.2, 0.85, 0.15),
  status: 'Cliff edge.',
});
addTeleportSpot({
  x: roof.x,
  z: roof.z,
  floor: roof.y,
  eye: new THREE.Vector3(roof.x, roof.y + 1.55, roof.z),
  look: new THREE.Vector3(roof.x - 4.2, roof.y + 0.7, roof.z + 0.2),
  status: 'On the roof.',
});

function teleportTo(index) {
  if (biteHold) return;
  const spot = teleportSpots[index];
  if (!spot) return;
  leaveClimb();
  teleportIndex = index;
  fallVy = 0;
  if (renderer.xr.isPresenting && xrFrame) {
    const ref = renderer.xr.getReferenceSpace();
    const pose = ref && xrFrame.getViewerPose(ref);
    if (pose) {
      const head = pose.transform.position;
      const floor = spot.floor ?? 0;
      shiftPlayer(spot.x - head.x, floor - xrOffset.y, spot.z - head.z);
    }
  } else {
    const onRoof = (spot.floor ?? 0) > 1;
    controls.maxPolarAngle = onRoof ? Math.PI * 0.92 : roomPolar;
    controls.minPolarAngle = onRoof ? 0.15 : 0;
    controls.maxDistance = onRoof ? 8 : 4.2;
    camera.position.copy(spot.eye);
    controls.target.copy(spot.look);
    controls.update();
  }
  setStatus(`${spot.status} Press A for the next spot.`);
}

function teleportNext() {
  const order = [1, 0, 2];
  const at = order.indexOf(teleportIndex);
  teleportTo(order[(at + 1) % order.length]);
}

let climb = null;
let boatGrip = null;
let oarGrip = null;
let aboard = false;
let fallVy = 0;
let biteHold = false;
let xrBaseSpace = null;
const xrOffset = new THREE.Vector3();
const roomPolar = Math.PI * 0.62;
const pullPixels = 78;
const rungAxis = new THREE.Vector3();
const rungClosest = new THREE.Vector3();
const handDelta = new THREE.Vector3();
const raySample = new THREE.Vector3();

function nearestRung(ladder, hitY) {
  const rungs = ladder.userData.rungs;
  let rung = 0;
  let best = Infinity;
  rungs.forEach((y, index) => {
    const dist = Math.abs(y - hitY);
    if (dist < best) {
      best = dist;
      rung = index;
    }
  });
  return rung;
}

function createGripHand() {
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9956b, roughness: 0.62 });
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.055, 0.09), skin);
  palm.position.set(-0.055, -0.02, 0);
  hand.add(palm);
  for (let i = 0; i < 4; i += 1) {
    const root = new THREE.Group();
    root.position.set(-0.042, -0.008, -0.033 + i * 0.022);
    root.rotation.z = 0.95;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.012, 0.014), skin);
    seg.position.x = 0.023;
    root.add(seg);
    const mid = new THREE.Group();
    mid.position.x = 0.046;
    mid.rotation.z = -1.25;
    const bend = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.011, 0.013), skin);
    bend.position.x = 0.02;
    mid.add(bend);
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.011, 0.012), skin);
    end.position.set(0.034, -0.008, 0);
    end.rotation.z = -1.05;
    mid.add(end);
    root.add(mid);
    hand.add(root);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.014), skin);
  thumb.position.set(-0.03, -0.03, 0.048);
  thumb.rotation.z = 1.1;
  hand.add(thumb);
  hand.visible = false;
  scene.add(hand);
  return hand;
}

const gripHand = createGripHand();

function beginClimb(ladder, hitY, rungIndex) {
  const rung = rungIndex ?? nearestRung(ladder, hitY);
  climb = {
    ladder,
    rung,
    onRoof: false,
    pulling: false,
    pull: 0,
    pointerY: null,
    hand: null,
    handY: 0,
    raised: 0,
    lifted: 0,
  };
  if (!renderer.xr.isPresenting) applyClimbView();
  setStatus(renderer.xr.isPresenting
    ? 'Holding a rung. Pull your hand down to climb.'
    : 'Holding a rung. Drag up to pull yourself up.');
}

function shiftPlayer(dx, dy, dz) {
  if (!renderer.xr.isPresenting || !xrFrame) return false;
  if (!xrBaseSpace) xrBaseSpace = renderer.xr.getReferenceSpace();
  if (!xrBaseSpace) return false;
  xrOffset.x += dx;
  xrOffset.y += dy;
  xrOffset.z += dz;
  try {
    renderer.xr.setReferenceSpace(xrBaseSpace.getOffsetReferenceSpace(new XRRigidTransform({
      x: -xrOffset.x,
      y: -xrOffset.y,
      z: -xrOffset.z,
    })));
  } catch {
    xrOffset.x -= dx;
    xrOffset.y -= dy;
    xrOffset.z -= dz;
    return false;
  }
  return true;
}

function closestRungToHand(points, reach = 0.2) {
  let best = null;
  let bestDist = reach;
  for (const item of targets) {
    if (!item.userData?.rungs) continue;
    for (const child of item.children) {
      if (child.userData?.type !== 'rung') continue;
      child.getWorldPosition(worldPoint);
      child.getWorldQuaternion(yawQuat);
      rungAxis.set(0, 0, 1).applyQuaternion(yawQuat);
      for (const point of points) {
        handDelta.copy(point).sub(worldPoint);
        const along = THREE.MathUtils.clamp(handDelta.dot(rungAxis), -0.22, 0.22);
        rungClosest.copy(worldPoint).addScaledVector(rungAxis, along);
        const dist = rungClosest.distanceTo(point);
        if (dist < bestDist) {
          bestDist = dist;
          best = child;
        }
      }
    }
  }
  if (!best) return null;
  return { owner: best, point: best.getWorldPosition(rungClosest) };
}

function rungFromController(controller) {
  const byHand = closestRungToHand(handPoints(controller), 0.2);
  if (byHand) return byHand;
  const aimed = hitFromController(controller);
  if (aimed?.owner?.userData.type === 'rung') return aimed;
  controller.getWorldPosition(handPoint);
  tmpDir.set(0, 0, -1).applyQuaternion(controller.quaternion);
  const stop = aimed ? Math.min(2.6, handPoint.distanceTo(aimed.point)) : 2.6;
  for (let distance = 0.06; distance < stop; distance += 0.08) {
    raySample.copy(handPoint).addScaledVector(tmpDir, distance);
    const hit = closestRungToHand([raySample], 0.14);
    if (hit) return hit;
  }
  return null;
}

function standAtLadder(ladder) {
  if (!renderer.xr.isPresenting || !xrFrame || !ladder) return;
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return;
  const head = pose.transform.position;
  const dx = (ladder.position.x - 0.42) - head.x;
  const dz = ladder.position.z - head.z;
  if (Math.hypot(dx, dz) > 0.55) shiftPlayer(dx, 0, dz);
}

function pulseController(controller) {
  const pad = controller?.userData?.inputSource?.gamepad;
  const haptic = pad?.hapticActuators?.[0] || pad?.vibrationActuator;
  if (haptic?.pulse) haptic.pulse(0.7, 50);
}

function attachClimb(controller, hit) {
  const ladder = hit.owner.userData.ladder;
  if (!ladder || aboard) return;
  const same = climb && climb.ladder === ladder;
  const lifted = same ? climb.lifted : 0;
  const feet = same && climb.feet != null ? climb.feet : xrOffset.y;
  const low = same && climb.lowest != null ? climb.lowest : feet;
  const high = same && climb.highest != null ? climb.highest : feet;
  const index = hit.owner.userData.type === 'rung' ? hit.owner.userData.index : nearestRung(ladder, hit.point.y);
  beginClimb(ladder, hit.point.y, index);
  climb.hand = controller;
  climb.lifted = lifted;
  if (ladder.userData.shaft) {
    climb.feet = feet;
    climb.lowest = Math.min(low, feet);
    climb.highest = Math.max(high, feet);
  }
  standAtLadder(ladder);
  controller.getWorldPosition(handPoint);
  climb.handY = handPoint.y;
  pulseController(controller);
  setStatus(ladder.userData.shaft
    ? 'Holding a rung. Pull down to climb, push up to go down.'
    : 'Holding a rung. Pull your hand down to climb.');
}

function arriveOnRoof() {
  const ladder = climb?.ladder;
  if (!ladder) return;
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame && xrFrame.getViewerPose(ref);
  if (pose) {
    const head = pose.transform.position;
    const roof = ladder.userData.roofY;
    const eye = Math.max(1.4, head.y - climb.lifted);
    shiftPlayer(
      ladder.position.x + 0.85 - head.x,
      roof + eye - head.y,
      ladder.position.z - head.z,
    );
  }
  climb.onRoof = true;
  climb.hand = null;
  setStatus('On the roof.');
}

function pullXrClimb() {
  if (!climb?.hand) return;
  climb.hand.getWorldPosition(handPoint);
  const dy = handPoint.y - climb.handY;
  if (climb.ladder.userData.shaft) {
    pullShaft(dy);
    return;
  }
  if (dy < -0.004) {
    const lift = Math.min(0.35, -dy);
    if (!shiftPlayer(0, lift, 0)) return;
    climb.handY = handPoint.y + lift;
    climb.lifted += lift;
    if (climb.lifted >= climb.ladder.userData.roofY - 0.45) arriveOnRoof();
    return;
  }
  if (dy > 0.12) {
    let drop = Math.min(0.35, dy);
    if (climb.lifted - drop < 0) drop = climb.lifted;
    if (drop > 0.004 && shiftPlayer(0, -drop, 0)) {
      climb.handY = handPoint.y - drop;
      climb.lifted -= drop;
    }
    return;
  }
  if (dy > 0.004) climb.handY = handPoint.y;
}

function pullShaft(dy) {
  const shaft = climb.ladder.userData.shaft;
  if (dy < -0.004) {
    const lift = Math.min(0.35, -dy, Math.max(0, shaft.top - climb.feet));
    if (lift > 0.004 && shiftPlayer(0, lift, 0)) {
      climb.handY = handPoint.y + lift;
      climb.feet += lift;
      climb.highest = Math.max(climb.highest, climb.feet);
    }
    if (climb.feet >= shaft.top - 0.25 && climb.lowest < shaft.top - 0.8) {
      snapShaft(climb.ladder.userData.topSpot, 'On the cliff.');
    }
    return;
  }
  if (dy > 0.12) {
    const drop = Math.min(0.35, dy, Math.max(0, climb.feet - shaft.base));
    if (drop > 0.004 && shiftPlayer(0, -drop, 0)) {
      climb.handY = handPoint.y - drop;
      climb.feet -= drop;
      climb.lowest = Math.min(climb.lowest, climb.feet);
    }
    if (climb.feet <= shaft.base + 0.45 && climb.highest > shaft.base + 1.2) {
      snapShaft(climb.ladder.userData.baseSpot, 'In the cave. Grab either end of the canoe.');
    }
    return;
  }
  if (dy > 0.004) climb.handY = handPoint.y;
}

function snapShaft(spot, status) {
  if (renderer.xr.isPresenting && xrFrame) {
    const ref = renderer.xr.getReferenceSpace();
    const pose = ref && xrFrame.getViewerPose(ref);
    if (pose) {
      const head = pose.transform.position;
      const eye = Math.max(1.25, head.y - xrOffset.y);
      shiftPlayer(spot.x - head.x, spot.y + eye - head.y, spot.z - head.z);
    }
  }
  leaveClimb();
  setStatus(status);
}

function placeAtSpot(spot, look, status) {
  leaveClimb();
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.minPolarAngle = 0.12;
  controls.maxDistance = 7;
  controls.enabled = true;
  controls.target.copy(look);
  camera.position.set(spot.x, spot.y + 1.42, spot.z);
  controls.update();
  setStatus(status);
}

function moveClimb(dir) {
  if (!climb) return;
  climb.pull = 0;
  climb.pulling = false;
  const rungs = climb.ladder.userData.rungs;
  if (climb.ladder.userData.shaft) {
    const next = climb.rung + dir;
    if (next < 0) {
      const spot = climb.ladder.userData.baseSpot;
      placeAtSpot(spot, world.canoe.center, 'In the cave. Grab either end of the canoe, then press F.');
      return;
    }
    if (next >= rungs.length) {
      const spot = climb.ladder.userData.topSpot;
      placeAtSpot(spot, new THREE.Vector3(spot.x - 3, 0.7, spot.z), 'On the cliff.');
      return;
    }
    climb.rung = next;
    applyClimbView();
    return;
  }
  if (climb.onRoof) {
    if (dir > 0) return;
    climb.onRoof = false;
    climb.rung = rungs.length - 1;
    applyClimbView();
    setStatus('Hold a rung and drag up to pull yourself up.');
    return;
  }
  const next = climb.rung + dir;
  if (next < 0) {
    leaveClimb();
    setStatus('Middle of the room. Press A for the other spot.');
    return;
  }
  if (next >= rungs.length) {
    climb.onRoof = true;
    applyClimbView();
    return;
  }
  climb.rung = next;
  applyClimbView();
}

function grabRung(pointerY) {
  if (!climb || climb.onRoof) return;
  climb.pulling = true;
  climb.pointerY = pointerY;
  climb.pull = 0;
  controls.enabled = false;
  gripHand.visible = true;
  renderer.domElement.style.cursor = 'grabbing';
}

function pullClimb(pointerY) {
  if (!climb?.pulling || climb.pointerY == null) return;
  const rungs = climb.ladder.userData.rungs;
  climb.pull = (climb.pointerY - pointerY) / pullPixels;
  if (climb.pull >= 1) {
    climb.pointerY = pointerY;
    climb.pull = 0;
    if (climb.rung >= rungs.length - 1) {
      climb.onRoof = true;
      climb.pulling = false;
      applyClimbView();
      return;
    }
    climb.rung += 1;
  } else if (climb.pull <= -1) {
    climb.pointerY = pointerY;
    climb.pull = 0;
    if (climb.rung <= 0) {
      leaveClimb();
      setStatus('Middle of the room. Press A for the other spot.');
      return;
    }
    climb.rung -= 1;
  }
  applyClimbView();
}

function releasePull() {
  if (!climb?.pulling) return;
  climb.pulling = false;
  climb.pull = 0;
  climb.pointerY = null;
  gripHand.visible = false;
  renderer.domElement.style.cursor = 'grab';
  applyClimbView();
  setStatus('Grab the next rung and drag up.');
}

function applyClimbView() {
  if (!climb) return;
  const base = climb.ladder.position;
  const roof = climb.ladder.userData.roofY;
  if (climb.onRoof) {
    gripHand.visible = false;
    controls.maxPolarAngle = Math.PI * 0.92;
    controls.minPolarAngle = 0.2;
    controls.maxDistance = 5.5;
    controls.enabled = true;
    camera.position.set(base.x + 1.05, roof + 1.5, base.z + 0.2);
    controls.target.set(base.x + 2.6, roof + 1.05, base.z - 0.45);
    controls.update();
    setStatus('On the roof. Press S to climb down.');
    return;
  }
  controls.enabled = false;
  const rungs = climb.ladder.userData.rungs;
  const span = rungs.length > 1 ? rungs[1] - rungs[0] : 0.32;
  const y = rungs[climb.rung] + (climb.pull || 0) * span;
  camera.position.set(base.x - 0.34, y + 0.18, base.z + 0.48);
  camera.lookAt(base.x + 0.02, y, base.z);
  gripHand.position.set(base.x + 0.02, y, base.z);
  gripHand.rotation.set(0, 0, 0);
}

function leaveClimb() {
  if (!climb) return;
  climb = null;
  gripHand.visible = false;
  controls.maxPolarAngle = roomPolar;
  controls.minPolarAngle = 0;
  controls.maxDistance = 4.2;
  controls.enabled = !renderer.xr.isPresenting;
}

function groundUnder(x, z, feetY) {
  const overRoof = x >= roof.x0 && x <= roof.x1 && z >= roof.z0 && z <= roof.z1;
  if (overRoof && feetY >= roof.y - 0.25) return roof.y;
  const cave = world.cave;
  if (cave && feetY < -1 && x >= cave.x0 && x <= cave.x1 && z >= cave.z0 && z <= cave.z1) return cave.floor;
  const shaft = world.shaft;
  if (shaft && feetY < -0.2 && Math.abs(x - shaft.x) < 0.85 && Math.abs(z - shaft.z) < 0.7) return shaft.floor;
  const overFloor = x >= CLIFF_X + 0.04 && x <= roof.roomX1 && z >= roof.roomZ0 && z <= roof.roomZ1;
  if (overFloor) return 0;
  return WATER_Y;
}

function startWaterBite(x, z) {
  if (biteHold || world.biteActive()) return;
  biteHold = true;
  fallVy = 0;
  if (climb) leaveClimb();
  world.splash(x, z, true);
  if (renderer.xr.isPresenting && xrFrame) {
    const ref = renderer.xr.getReferenceSpace();
    const pose = ref && xrFrame.getViewerPose(ref);
    if (pose) {
      const head = pose.transform.position;
      shiftPlayer(x - head.x, (WATER_Y + 0.48) - head.y, z - head.z);
    }
  }
  world.startBite(x, z);
  setStatus('Something in the water.');
}

function finishWaterBite() {
  if (!world.biteDone()) {
    if (world.takeStrike()) {
      playBite();
      world.splash(camera.position.x, camera.position.z, true);
      if (renderer.xr.isPresenting) shiftPlayer(0.16, -0.1, 0);
    }
    return;
  }
  world.clearBite();
  biteHold = false;
  teleportTo(1);
}

function landShift(ground, feetY, head) {
  const cave = world.cave;
  const fromShaft = ground === world.shaft?.floor && head.x < cave.x0 + 0.15;
  shiftPlayer(fromShaft ? cave.standX - head.x : 0, ground - feetY, fromShaft ? cave.standZ - head.z : 0);
}

function updatePlayerFall(dt) {
  if (watching || biteHold || aboard || !renderer.xr.isPresenting || !xrFrame) return;
  if (climb?.hand || boatGrip) {
    fallVy = 0;
    return;
  }
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return;
  const head = pose.transform.position;
  const feetY = xrOffset.y;
  const ground = groundUnder(head.x, head.z, feetY);
  const gap = feetY - ground;
  if (gap <= 0.12) {
    if (gap < -0.01) landShift(ground, feetY, head);
    if (fallVy < -1.2 && ground <= WATER_Y + 0.05) {
      fallVy = 0;
      startWaterBite(head.x, head.z);
      return;
    }
    fallVy = 0;
    return;
  }
  if (climb) leaveClimb();
  fallVy = Math.max(-16, fallVy - 9.2 * dt);
  const next = feetY + fallVy * dt;
  if (next <= ground) {
    landShift(ground, feetY, head);
    if (ground <= WATER_Y + 0.05) {
      fallVy = 0;
      startWaterBite(head.x, head.z);
      return;
    }
    fallVy = 0;
    return;
  }
  shiftPlayer(0, fallVy * dt, 0);
}

const raycaster = new THREE.Raycaster();
const buildPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -world.tableTop);
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const jobs = [];
const pedestals = [];
const localPoint = new THREE.Vector3();
const worldPoint = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

const selection = { colorId: 'red', shapeId: '2x4', heightId: '1', flat: false };
let held = null;
let heldFrom = null;
let heldHome = null;
let assembly = null;
let ghost = null;
let hovered = null;
let press = null;
let pegScale = 1;
let pegDrag = false;
let nextPedestalId = 1;
let hasAim = false;
const yawQuat = new THREE.Quaternion();
const yawEuler = new THREE.Euler();
const lastAim = new THREE.Vector3();
let aimLayer = null;
let challenge = null;
let challengeMatched = false;
let shownVerdict = 'ready';
let relay = null;
let watcherCount = 0;
let watchSendTimer = 0;
let seenWatch = false;
let challengeKey = '';
const remoteBricks = new Map();
const remotePedestals = new Map();
const posePos = new THREE.Vector3();
const poseQuat = new THREE.Quaternion();
let watchHands = [];

world.setRoomCode(roomCode || '----', watching ? 'WATCH' : 'ROOM');
roomCodeEl.textContent = roomCode || '----';
if (watching) {
  roomLabelEl.textContent = 'Watching';
  if (scalePanel) scalePanel.style.display = 'none';
  watchNote.textContent = roomCode.length === 4 ? 'Connecting...' : 'Enter the 4-letter room code.';
  setStatus(roomCode.length === 4 ? `Waiting for headset room ${roomCode}...` : 'Enter the 4-letter room code.');
} else {
  hudEl.style.display = 'none';
  machine.refreshSelection(selection);
  paintSelection();
  startChallenge(true);
}
watchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = watchInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
  if (code.length < 4) {
    watchNote.textContent = 'Room codes are 4 letters.';
    return;
  }
  const url = new URL(location.href);
  url.searchParams.set('watch', code);
  location.href = url.toString();
});

renderer.xr.addEventListener('sessionstart', () => {
  xrBaseSpace = renderer.xr.getReferenceSpace();
  xrOffset.set(0, 0, 0);
  hudEl.style.display = 'none';
  if (scalePanel) scalePanel.style.display = 'none';
  controls.enabled = false;
});
renderer.xr.addEventListener('sessionend', () => {
  xrBaseSpace = null;
  xrOffset.set(0, 0, 0);
  leaveClimb();
  hudEl.style.display = watching ? '' : 'none';
  if (!watching && scalePanel) scalePanel.style.display = '';
  controls.enabled = true;
});

const controllerFactory = new XRControllerModelFactory();
const controllers = [0, 1].map((index) => setupController(index));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('keydown', onKeyDown);
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

renderer.setAnimationLoop(frame);

function setupController(index) {
  const controller = renderer.xr.getController(index);
  controller.addEventListener('connected', (event) => {
    controller.userData.inputSource = event.data;
    controller.userData.rotateLatch = false;
  });
  controller.addEventListener('selectstart', () => {
    controller.userData.triggerDown = true;
    onXrTrigger(controller);
  });
  controller.addEventListener('selectend', () => {
    controller.userData.triggerDown = false;
    if (controller.userData.pegDrag) controller.userData.pegDrag = false;
    if (climb?.hand === controller && !controller.userData.squeezeDown) {
      climb.hand = null;
      climb.pull = 0;
    }
  });
  controller.addEventListener('squeezestart', () => {
    controller.userData.squeezeDown = true;
    onXrSqueeze(controller);
  });
  controller.addEventListener('squeezeend', () => {
    controller.userData.squeezeDown = false;
    onXrRelease(controller);
  });
  scene.add(controller);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.0014, 1, 8),
    new THREE.MeshBasicMaterial({ color: 0x3ef0c4 }),
  );
  beam.geometry.translate(0, 0.5, 0);
  beam.rotation.x = Math.PI / 2;
  beam.visible = false;
  controller.add(beam);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xeffff8 }),
  );
  dot.visible = false;
  controller.add(dot);
  controller.userData.laser = { beam, dot };

  const grip = renderer.xr.getControllerGrip(index);
  controller.userData.grip = grip;
  grip.add(controllerFactory.createControllerModel(grip));
  scene.add(grip);
  return controller;
}

function setStatus(text) {
  if (!watching) return;
  statusEl.textContent = text;
}

let audioCtx = null;

function audio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function envGain(ctx, start, peak, attack, release) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
  gain.connect(ctx.destination);
  return gain;
}

function playBite() {
  const ctx = audio();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(36, t + 0.22);
  const tone = envGain(ctx, t, 0.32, 0.008, 0.26);
  osc.connect(tone);
  osc.start(t);
  osc.stop(t + 0.28);
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const burst = ctx.createBufferSource();
  burst.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, t);
  const noiseGain = envGain(ctx, t, 0.4, 0.005, 0.18);
  burst.connect(filter);
  filter.connect(noiseGain);
  burst.start(t);
  burst.stop(t + 0.2);
}

function playDispense() {
  const ctx = audio();
  const t = ctx.currentTime;
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.09), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const burst = ctx.createBufferSource();
  burst.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(420, t);
  filter.frequency.exponentialRampToValueAtTime(1400, t + 0.08);
  const noiseGain = envGain(ctx, t, 0.16, 0.01, 0.08);
  burst.connect(filter);
  filter.connect(noiseGain);
  burst.start(t);
  burst.stop(t + 0.09);

  const whir = ctx.createOscillator();
  whir.type = 'triangle';
  whir.frequency.setValueAtTime(180, t);
  whir.frequency.exponentialRampToValueAtTime(720, t + 0.22);
  whir.connect(envGain(ctx, t, 0.07, 0.03, 0.24));
  whir.start(t);
  whir.stop(t + 0.28);

  const chime = ctx.createOscillator();
  chime.type = 'sine';
  chime.frequency.value = 988;
  chime.connect(envGain(ctx, t + 0.16, 0.09, 0.02, 0.34));
  chime.start(t + 0.16);
  chime.stop(t + 0.54);
}

function playSnap() {
  const ctx = audio();
  const t = ctx.currentTime;
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const burst = ctx.createBufferSource();
  burst.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 900;
  const noiseGain = envGain(ctx, t, 0.42, 0.001, 0.028);
  burst.connect(filter);
  filter.connect(noiseGain);
  burst.start(t);
  burst.stop(t + 0.035);

  const click = ctx.createOscillator();
  click.type = 'triangle';
  click.frequency.setValueAtTime(2200, t);
  click.frequency.exponentialRampToValueAtTime(420, t + 0.04);
  click.connect(envGain(ctx, t, 0.28, 0.001, 0.05));
  click.start(t);
  click.stop(t + 0.06);
}

function chosenLabel() {
  return partLabel(selection.colorId, selection.shapeId, selection.heightId, selection.flat);
}

function brickLabel(brick) {
  return partLabel(brick.userData.colorId, brick.userData.shapeId, brick.userData.heightId, brick.userData.flat);
}

function paintSelection() {
  machine.paintScreen(chosenLabel());
  machine.showPreview(selection);
}

function playClear() {
  const ctx = audio();
  const t = ctx.currentTime;
  [523, 659, 784, 1047].forEach((freq, index) => {
    const tone = ctx.createOscillator();
    tone.type = index === 3 ? 'triangle' : 'sine';
    tone.frequency.value = freq;
    tone.connect(envGain(ctx, t + index * 0.11, index === 3 ? 0.14 : 0.1, 0.02, 0.38));
    tone.start(t + index * 0.11);
    tone.stop(t + index * 0.11 + 0.46);
  });
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.35), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const burst = ctx.createBufferSource();
  burst.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1400, t);
  filter.frequency.exponentialRampToValueAtTime(4200, t + 0.3);
  burst.connect(filter);
  filter.connect(envGain(ctx, t + 0.08, 0.12, 0.02, 0.32));
  burst.start(t + 0.08);
  burst.stop(t + 0.42);
}

function celebrateSolve() {
  playClear();
  world.challenge.celebrate();
}

function clearExample() {
  const { bricks } = world.challenge;
  for (const child of [...bricks.children]) bricks.remove(child);
}

function showExample(model) {
  clearExample();
  for (const piece of model.pieces) {
    const brick = createBrick(shapeById(piece.shapeId), colorById(piece.colorId), {
      units: piece.units,
      heightId: piece.heightId,
      flat: false,
    });
    brick.userData.rot = piece.rot;
    brick.userData.role = 'example';
    const { w, d } = footprintOf(brick);
    brick.position.set((piece.gx + w / 2) * STUD, piece.layer * LAYER, (piece.gz + d / 2) * STUD);
    brick.rotation.y = piece.rot * Math.PI / 2;
    brick.scale.setScalar(1);
    setBrickRaycast(brick, false);
    world.challenge.bricks.add(brick);
  }
}

const verdictStatus = {
  ready: 'Match the build behind the table. Any turn is fine, and a mirror counts.',
  match: 'You got it. Press NEW for another.',
  extra: 'Extra bricks are still on the table. Drop them in the TOSS bin on your left.',
  short: 'Still missing some. Any turn is fine, and a mirror counts.',
  different: 'Colors or heights still differ. Any turn is fine, and a mirror counts.',
};

function reviewBuild(speak) {
  if (!challenge) return false;
  const verdict = lookVerdict(cellsFromGrid(grid), challenge.cells);
  shownVerdict = verdict;
  world.challenge.setVerdict(verdict);
  if (verdict === 'match') {
    if (!challengeMatched) {
      challengeMatched = true;
      celebrateSolve();
      setStatus(verdictStatus.match);
    }
    return true;
  }
  challengeMatched = false;
  if (speak && verdict !== 'ready') setStatus(verdictStatus[verdict]);
  return false;
}

function startChallenge(first) {
  const model = generateModel();
  if (!model) {
    setStatus('Could not make a build. Press NEW to try again.');
    return;
  }
  challenge = model;
  challengeMatched = false;
  shownVerdict = 'ready';
  world.challenge.setVerdict('ready');
  showExample(model);
  if (sameLook(cellsFromGrid(grid), model.cells)) {
    challengeMatched = true;
    shownVerdict = 'match';
    world.challenge.setVerdict('match');
    celebrateSolve();
    setStatus('You got it. Press NEW for another.');
    return;
  }
}

function ownerOf(object) {
  let current = object;
  while (current) {
    if (current.userData?.type) return current;
    current = current.parent;
  }
  return null;
}

function hitTest(origin, direction) {
  raycaster.set(origin, direction);
  const hits = raycaster.intersectObjects(targets, true);
  for (const hit of hits) {
    const owner = ownerOf(hit.object);
    if (!owner || owner === held || owner.userData.type === 'ghost') continue;
    return { owner, point: hit.point };
  }
  return null;
}

function hitFromCamera() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(targets, true);
  for (const hit of hits) {
    const owner = ownerOf(hit.object);
    if (!owner || owner === held || owner.userData.type === 'ghost') continue;
    return { owner, point: hit.point };
  }
  return null;
}

function hitFromController(controller) {
  controller.getWorldPosition(worldPoint);
  tmpDir.set(0, 0, -1).applyQuaternion(controller.quaternion);
  return hitTest(worldPoint, tmpDir);
}

function updateLaser(controller) {
  const laser = controller.userData.laser;
  if (!laser) return;
  if (!renderer.xr.isPresenting) {
    laser.beam.visible = false;
    laser.dot.visible = false;
    return;
  }
  const hit = hitFromController(controller);
  controller.getWorldPosition(worldPoint);
  const distance = hit ? Math.max(0.08, worldPoint.distanceTo(hit.point)) : 2.8;
  laser.beam.visible = true;
  laser.beam.scale.y = distance;
  laser.dot.visible = true;
  laser.dot.position.set(0, 0, -distance);
}

function raiseOnto(point, brick, layer) {
  const base = new THREE.Vector3();
  const scale = new THREE.Vector3();
  brick.getWorldPosition(base);
  brick.getWorldScale(scale);
  point.y = base.y + ((brick.userData.units || 4) / 4) * HEIGHT * scale.y;
  aimLayer = layer + 1;
  return point;
}

function stackAt(point) {
  localPoint.copy(point);
  gridGroup.worldToLocal(localPoint);
  const top = columnTop(grid, Math.floor(localPoint.x / STUD), Math.floor(localPoint.z / STUD));
  if (!top) {
    aimLayer = 0;
    return point;
  }
  return raiseOnto(point, top.brick, top.layer);
}

function placementPoint() {
  aimLayer = null;
  const hits = raycaster.intersectObjects(targets, true);
  for (const hit of hits) {
    const owner = ownerOf(hit.object);
    if (!owner || owner === held || owner.userData.type === 'ghost') continue;
    if (owner.userData.type === 'ui') continue;
    if (owner.userData.type === 'brick' && owner.userData.role === 'placed' && owner.userData.anchor) {
      return raiseOnto(hit.point.clone(), owner, owner.userData.anchor.layer);
    }
    if (owner.userData.type === 'plate') return stackAt(hit.point.clone());
  }
  const point = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(buildPlane, point)) return null;
  return stackAt(point);
}

function showSelection() {
  machine.refreshSelection(selection);
  paintSelection();
  setStatus(`${chosenLabel()} is selected. Press to order.`);
}

function selectColor(colorId) {
  selection.colorId = colorId;
  showSelection();
}

function selectShape(shapeId) {
  selection.shapeId = shapeId;
  showSelection();
}

function selectHeight(heightId) {
  selection.heightId = heightId;
  showSelection();
}

function toggleFlat() {
  selection.flat = !selection.flat;
  showSelection();
}

function activateUi(owner) {
  if (watching) return;
  if (owner.userData.restZ != null) owner.userData.press = 1;
  if (owner.userData.action === 'color') selectColor(owner.userData.value);
  else if (owner.userData.action === 'shape') selectShape(owner.userData.value);
  else if (owner.userData.action === 'height') selectHeight(owner.userData.value);
  else if (owner.userData.action === 'top') toggleFlat();
  else if (owner.userData.action === 'order') orderSelection();
  else if (owner.userData.action === 'challenge') startChallenge(false);
  else if (owner.userData.action === 'screen') {
    const open = machine.toggleScreen();
    setStatus(open ? 'Order screen is down.' : 'Order screen is tucked away. Press PARTS to bring it back.');
  }
  else if (owner.userData.action === 'dismiss') removePedestal(owner.userData.pedestalId);
}

function orderSelection() {
  const existing = pedestals.find((pedestal) => (
    pedestal.colorId === selection.colorId
    && pedestal.shapeId === selection.shapeId
    && pedestal.heightId === selection.heightId
    && pedestal.flat === selection.flat
  ));
  if (existing) {
    flash(existing.top);
    const label = chosenLabel();
    paintSelection();
    setStatus(`${label} is already out.`);
    return existing;
  }
  if (pedestals.length >= MAX_PEDESTALS) {
    setStatus(`The room already has ${MAX_PEDESTALS} pedestals. Press the red X on one to clear it.`);
    return null;
  }
  const pedestal = spawnPedestal(selection);
  const label = chosenLabel();
  playDispense();
  paintSelection();
  setStatus(`${label} is on a pedestal.`);
  return pedestal;
}

function spawnPedestal(choice) {
  const index = pedestals.length;
  const label = partLabel(choice.colorId, choice.shapeId, choice.heightId, choice.flat);
  const visual = createPedestal(index, label);
  scene.add(visual.group);
  const pedestal = {
    id: nextPedestalId,
    colorId: choice.colorId,
    shapeId: choice.shapeId,
    heightId: choice.heightId,
    flat: choice.flat,
    group: visual.group,
    top: visual.top,
    supply: null,
    dismiss: visual.dismiss,
    index,
  };
  nextPedestalId += 1;
  visual.dismiss.userData.pedestalId = pedestal.id;
  targets.push(visual.dismiss);
  machine.pressables.push(visual.dismiss);
  pedestals.push(pedestal);
  refill(pedestal, true);
  return pedestal;
}

function detachSupplyHome(home, id) {
  if (home?.role === 'supply' && home.pedestalId === id) {
    home.role = 'loose';
    home.pedestalId = null;
  }
}

function disposePedestalGroup(group) {
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });
}

function removePedestal(id) {
  const index = pedestals.findIndex((item) => item.id === id);
  if (index < 0) return;
  const pedestal = pedestals[index];
  if (pedestal.supply) {
    const brick = pedestal.supply;
    pedestal.supply = null;
    flingBrick(brick);
  }
  detachSupplyHome(heldHome, id);
  if (assembly) {
    for (const piece of assembly.pieces) detachSupplyHome(piece.home, id);
  }
  const buttonIndex = targets.indexOf(pedestal.dismiss);
  if (buttonIndex >= 0) targets.splice(buttonIndex, 1);
  const pressIndex = machine.pressables.indexOf(pedestal.dismiss);
  if (pressIndex >= 0) machine.pressables.splice(pressIndex, 1);
  pedestals.splice(index, 1);
  const group = pedestal.group;
  const dropFrom = group.position.y;
  jobs.push({
    t: 0,
    d: 0.32,
    update(k) {
      group.position.y = dropFrom - k * k * 1.15;
      if (k < 1) return;
      group.parent?.remove(group);
      disposePedestalGroup(group);
    },
  });
  pedestals.forEach((item, slot) => {
    item.index = slot;
    const next = pedestalSlot(slot);
    item.group.position.x = next.x;
    item.group.position.z = next.z;
  });
  setStatus('Pedestal cleared.');
}

function refill(pedestal, animateIn) {
  const height = heightById(pedestal.heightId);
  const brick = createBrick(shapeById(pedestal.shapeId), colorById(pedestal.colorId), {
    units: height.units,
    heightId: height.id,
    flat: pedestal.flat,
  });
  brick.userData.role = 'supply';
  brick.userData.pedestalId = pedestal.id;
  brick.position.set(0, 0.712, 0);
  pedestal.group.add(brick);
  pedestal.supply = brick;
  targets.push(brick);
  if (animateIn) {
    brick.scale.setScalar(0.2);
    jobs.push({
      t: 0,
      d: 0.22,
      update(k) {
        if (brick.userData.role !== 'supply') return;
        const s = 0.2 + 0.8 * (k * k * (3 - 2 * k));
        brick.scale.setScalar(pegScale * s);
      },
    });
  }
}

function flash(mesh) {
  mesh.material.emissiveIntensity = 0.7;
  jobs.push({
    t: 0,
    d: 0.45,
    update(k) {
      mesh.material.emissiveIntensity = 0.7 * (1 - k);
    },
  });
}

function quarterTurns(object) {
  object.updateWorldMatrix(true, false);
  object.getWorldQuaternion(yawQuat);
  yawEuler.setFromQuaternion(yawQuat, 'YXZ');
  return ((Math.round(yawEuler.y / (Math.PI / 2)) % 4) + 4) % 4;
}

function triggerHeld(controller) {
  return Boolean(controller?.userData.triggerDown);
}

const handPoint = new THREE.Vector3();
const scalePoint = new THREE.Vector3();
const localGrab = new THREE.Vector3();

function eachLooseBrick(visit) {
  for (const item of targets) {
    if (item.userData?.type !== 'brick' || item.userData.role === 'held') continue;
    visit(item);
  }
}

function surfaceGap(brick, world) {
  brick.updateWorldMatrix(true, false);
  localGrab.copy(world);
  brick.worldToLocal(localGrab);
  const hx = brick.userData.baseW * STUD * 0.5;
  const hz = brick.userData.baseD * STUD * 0.5;
  const dx = localGrab.x - THREE.MathUtils.clamp(localGrab.x, -hx, hx);
  const top = ((brick.userData.units || 4) / 4) * HEIGHT + (brick.userData.flat ? 0 : STUD_H);
  const dy = localGrab.y - THREE.MathUtils.clamp(localGrab.y, 0, top);
  const dz = localGrab.z - THREE.MathUtils.clamp(localGrab.z, -hz, hz);
  brick.getWorldScale(scalePoint);
  return Math.hypot(dx, dy, dz) * scalePoint.x;
}

function handPoints(controller) {
  const points = [];
  controller.getWorldPosition(handPoint);
  controller.getWorldQuaternion(yawQuat);
  points.push(handPoint.clone());
  const grip = controller.userData.grip;
  if (grip) points.push(grip.getWorldPosition(new THREE.Vector3()));
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQuat);
  const down = new THREE.Vector3(0, -1, 0).applyQuaternion(yawQuat);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat);
  points.push(handPoint.clone().addScaledVector(side, 0.08));
  points.push(handPoint.clone().addScaledVector(side, -0.08));
  points.push(handPoint.clone().addScaledVector(down, 0.06));
  points.push(handPoint.clone().addScaledVector(forward, 0.1));
  return points;
}

function closestBrickToHand(points) {
  let best = null;
  let bestDist = 0.22;
  eachLooseBrick((item) => {
    let dist = Infinity;
    for (const point of points) dist = Math.min(dist, surfaceGap(item, point));
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  });
  return best;
}

function closestBrickToRay(origin, forward) {
  let best = null;
  let bestDist = 0.12;
  const sample = new THREE.Vector3();
  for (let distance = 0.04; distance <= 0.9; distance += 0.06) {
    sample.copy(origin).addScaledVector(forward, distance);
    eachLooseBrick((item) => {
      const gap = surfaceGap(item, sample);
      if (gap < bestDist) {
        bestDist = gap;
        best = item;
      }
    });
  }
  return best;
}

function captureHome(brick) {
  return {
    role: brick.userData.role,
    pedestalId: brick.userData.pedestalId,
    anchor: brick.userData.anchor ? { ...brick.userData.anchor } : null,
    rot: brick.userData.rot,
  };
}

function grab(brick, holder, whole) {
  if (watching) return;
  const group = whole && brick.userData.role === 'placed' ? connectedBricks(grid, brick) : [brick];
  if (group.length > 1) grabAssembly(group, brick, holder);
  else grabOne(brick, holder);
}

function grabOne(brick, holder) {
  const home = captureHome(brick);
  if (brick.userData.role === 'placed') release(grid, brick);
  const fromSupply = home.role === 'supply';
  const pedestal = pedestals.find((item) => item.id === brick.userData.pedestalId);
  held = brick;
  heldFrom = holder;
  heldHome = home;
  assembly = null;
  brick.userData.role = 'held';
  brick.userData.snap = null;
  brick.scale.setScalar(1);
  const index = targets.indexOf(brick);
  if (index >= 0) targets.splice(index, 1);
  setBrickRaycast(brick, false);

  if (holder) {
    holder.attach(brick);
    brick.position.set(0, -0.02, -0.14);
  } else {
    scene.attach(brick);
    brick.rotation.set(0, brick.userData.rot * Math.PI / 2, 0);
  }
  syncBrickScale(brick);

  discardGhost();
  ghost = makeGhost(brick);
  ghost.visible = false;
  syncBrickScale(ghost);
  scene.add(ghost);

  if (fromSupply && pedestal) pedestal.supply = null;
  setStatus(`Holding ${brickLabel(brick)}. Let go to drop it.`);
  reviewBuild(false);
}

function grabAssembly(bricks, primary, holder) {
  const origin = primary.userData.anchor;
  const pieces = bricks.map((item) => ({
    brick: item,
    home: captureHome(item),
    dgx: item.userData.anchor.gx - origin.gx,
    dgz: item.userData.anchor.gz - origin.gz,
    dlayer: item.userData.anchor.layer - origin.layer,
  }));
  const carry = new THREE.Group();
  gridGroup.add(carry);
  carry.position.set(origin.gx * STUD, origin.layer * LAYER, origin.gz * STUD);
  for (const piece of pieces) {
    release(grid, piece.brick);
    const index = targets.indexOf(piece.brick);
    if (index >= 0) targets.splice(index, 1);
    setBrickRaycast(piece.brick, false);
    piece.brick.userData.role = 'held';
    piece.brick.userData.snap = null;
    const { w, d } = footprintOf(piece.brick);
    carry.attach(piece.brick);
    piece.brick.position.set((piece.dgx + w / 2) * STUD, piece.dlayer * LAYER, (piece.dgz + d / 2) * STUD);
    piece.brick.rotation.set(0, piece.brick.userData.rot * Math.PI / 2, 0);
    piece.brick.scale.setScalar(1);
  }
  if (holder) {
    holder.attach(carry);
    carry.position.set(0, -0.04, -0.28);
  }
  held = primary;
  heldFrom = holder;
  heldHome = null;
  assembly = { pieces, carry };
  if (ghost) ghost.visible = false;
  setStatus(`Holding ${pieces.length} connected bricks. Let go to drop them.`);
  reviewBuild(false);
}

function pieceRecords() {
  return assembly.pieces.map((piece) => ({
    brick: piece.brick,
    home: piece.home,
    dgx: piece.dgx,
    dgz: piece.dgz,
    dlayer: piece.dlayer,
    rot: piece.brick.userData.rot,
  }));
}

function placementPieces() {
  let records = pieceRecords();
  const turns = heldFrom ? quarterTurns(assembly.carry) : 0;
  for (let i = 0; i < turns; i += 1) records = rotatePieceRecords(records, held);
  return records;
}

function rotateAssembly() {
  const turned = rotatePieceRecords(pieceRecords(), held);
  for (const item of turned) {
    const piece = assembly.pieces.find((entry) => entry.brick === item.brick);
    piece.dgx = item.dgx;
    piece.dgz = item.dgz;
    piece.brick.userData.rot = item.rot;
    const { w, d } = footprintOf(piece.brick);
    piece.brick.position.set((piece.dgx + w / 2) * STUD, piece.dlayer * LAYER, (piece.dgz + d / 2) * STUD);
    piece.brick.rotation.set(0, piece.brick.userData.rot * Math.PI / 2, 0);
  }
}

function rotateHeld() {
  if (!held) return;
  if (held.userData.type === 'prop') {
    held.rotation.y += Math.PI / 2;
    return;
  }
  if (assembly) rotateAssembly();
  else if (heldFrom) {
    held.rotation.y += Math.PI / 2;
  } else {
    held.userData.rot = (held.userData.rot + 1) % 4;
    held.rotation.set(0, held.userData.rot * Math.PI / 2, 0);
  }
  if (hasAim) updateSnapFromPoint(lastAim);
}

function placeAssembly() {
  const snap = held.userData.snap;
  const pieces = placementPieces();
  if (!snap || !canPlaceAssembly(grid, pieces, snap)) return false;
  const { carry } = assembly;
  const count = pieces.length;
  assembly = null;
  held = null;
  heldFrom = null;
  heldHome = null;
  for (const piece of pieces) {
    const gx = snap.gx + piece.dgx;
    const gz = snap.gz + piece.dgz;
    const layer = snap.layer + piece.dlayer;
    piece.brick.userData.rot = piece.rot;
    const { w, d } = footprintOf(piece.brick);
    gridGroup.attach(piece.brick);
    piece.brick.position.set((gx + w / 2) * STUD, layer * LAYER, (gz + d / 2) * STUD);
    piece.brick.rotation.set(0, piece.rot * Math.PI / 2, 0);
    piece.brick.scale.setScalar(1);
    piece.brick.userData.role = 'placed';
    piece.brick.userData.snap = null;
    occupy(grid, piece.brick, gx, gz, layer);
    setBrickRaycast(piece.brick, true);
    targets.push(piece.brick);
  }
  carry.parent?.remove(carry);
  playSnap();
  setStatus(`Placed ${count} bricks.`);
  reviewBuild(true);
  return true;
}

function placeSingle() {
  const snap = held.userData.snap;
  if (!snap) return false;
  const brick = held;
  const home = heldHome;
  held = null;
  heldFrom = null;
  heldHome = null;
  if (ghost) ghost.visible = false;
  gridGroup.attach(brick);
  const pos = brickLocalPosition(brick, snap);
  brick.position.set(pos.x, pos.y, pos.z);
  brick.rotation.set(0, brick.userData.rot * Math.PI / 2, 0);
  brick.scale.setScalar(1);
  brick.userData.role = 'placed';
  brick.userData.snap = null;
  syncBrickScale(brick);
  occupy(grid, brick, snap.gx, snap.gz, snap.layer);
  setBrickRaycast(brick, true);
  targets.push(brick);
  if (home?.role === 'supply') {
    const pedestal = pedestals.find((item) => item.id === home.pedestalId);
    if (pedestal && !pedestal.supply) refill(pedestal, true);
  }
  playSnap();
  setStatus(`Placed ${brickLabel(brick)}.`);
  reviewBuild(true);
  return true;
}

function restoreBrick(brick, home) {
  brick.userData.rot = home.rot;
  brick.userData.snap = null;
  if (home.role === 'loose') {
    flingBrick(brick);
    return;
  }
  if (home.role === 'supply') {
    const pedestal = pedestals.find((item) => item.id === home.pedestalId);
    if (pedestal) {
      pedestal.group.attach(brick);
      brick.position.set(0, 0.712, 0);
      brick.rotation.set(0, 0, 0);
      brick.userData.role = 'supply';
      brick.userData.pedestalId = home.pedestalId;
      pedestal.supply = brick;
      syncBrickScale(brick);
    } else {
      flingBrick(brick);
      return;
    }
  } else if (home.role === 'placed' && home.anchor) {
    brick.userData.rot = home.rot;
    gridGroup.attach(brick);
    const pos = brickLocalPosition(brick, { ...home.anchor, dist: 0 });
    brick.position.set(pos.x, pos.y, pos.z);
    brick.rotation.set(0, home.rot * Math.PI / 2, 0);
    brick.scale.setScalar(1);
    brick.userData.role = 'placed';
    occupy(grid, brick, home.anchor.gx, home.anchor.gz, home.anchor.layer);
  }
  setBrickRaycast(brick, true);
  if (!targets.includes(brick)) targets.push(brick);
}

function restoreHeld() {
  if (assembly) {
    const { pieces, carry } = assembly;
    assembly = null;
    held = null;
    heldFrom = null;
    heldHome = null;
    for (const piece of pieces) restoreBrick(piece.brick, piece.home);
    carry.parent?.remove(carry);
    setStatus('Dropped it back where it was.');
    reviewBuild(true);
    return;
  }
  if (held && heldHome) {
    const brick = held;
    const home = heldHome;
    held = null;
    heldFrom = null;
    heldHome = null;
    restoreBrick(brick, home);
    setStatus('Dropped it back where it was.');
    reviewBuild(true);
  }
  held = null;
  heldFrom = null;
  heldHome = null;
}

function pieceWorld() {
  const point = new THREE.Vector3();
  (assembly ? assembly.carry : held).getWorldPosition(point);
  return point;
}

function shouldToss(point) {
  const bin = new THREE.Vector3();
  world.bin.getWorldPosition(bin);
  const overBin = point.x - bin.x;
  const overBinZ = point.z - bin.z;
  if (overBin * overBin + overBinZ * overBinZ < 0.22 * 0.22 && point.y < bin.y + 1.1) return true;
  localPoint.copy(point);
  gridGroup.worldToLocal(localPoint);
  const margin = STUD * 6;
  const outside = localPoint.x < -margin || localPoint.z < -margin
    || localPoint.x > GRID_X * STUD + margin
    || localPoint.z > GRID_Z * STUD + margin;
  return outside && !held.userData.snap;
}

function playToss() {
  const ctx = audio();
  const t = ctx.currentTime;
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.16), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const burst = ctx.createBufferSource();
  burst.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(900, t);
  filter.frequency.exponentialRampToValueAtTime(220, t + 0.16);
  burst.connect(filter);
  filter.connect(envGain(ctx, t, 0.2, 0.01, 0.16));
  burst.start(t);
  burst.stop(t + 0.16);
}

function flingBrick(brick) {
  scene.attach(brick);
  brick.userData.role = 'tossed';
  brick.userData.snap = null;
  setBrickRaycast(brick, false);
  const index = targets.indexOf(brick);
  if (index >= 0) targets.splice(index, 1);
  const start = brick.position.clone();
  const vx = (Math.random() - 0.5) * 0.35;
  const vz = 0.15 + Math.random() * 0.25;
  jobs.push({
    t: 0,
    d: 0.62,
    update(k) {
      brick.position.set(start.x + vx * k, start.y + 0.28 * k - k * k * 1.5, start.z + vz * k);
      brick.rotation.x += 0.12;
      brick.rotation.z += 0.08;
      if (k >= 1) brick.parent?.remove(brick);
    },
  });
}

function fallBrick(brick) {
  scene.attach(brick);
  brick.userData.role = 'tossed';
  brick.userData.snap = null;
  setBrickRaycast(brick, false);
  const index = targets.indexOf(brick);
  if (index >= 0) targets.splice(index, 1);
  const start = brick.position.clone();
  const vx = -0.7 - Math.random() * 0.45;
  const vz = (Math.random() - 0.5) * 0.35;
  const job = {
    t: 0,
    d: 3.4,
    hit: false,
    update(k) {
      if (job.hit) return;
      const time = k * job.d;
      const x = start.x + vx * time;
      const y = start.y - time * time * 3.1;
      const z = start.z + vz * time;
      brick.position.set(x, y, z);
      brick.rotation.x += 0.09;
      brick.rotation.z += 0.06;
      if (y <= WATER_Y) {
        job.hit = true;
        job.t = job.d;
        world.splash(x, z);
        brick.parent?.remove(brick);
        return;
      }
      if (k >= 1) brick.parent?.remove(brick);
    },
  };
  jobs.push(job);
}

function tossHeld(fling = flingBrick) {
  const pieces = assembly
    ? assembly.pieces.map((piece) => ({ brick: piece.brick, home: piece.home }))
    : [{ brick: held, home: heldHome }];
  const carry = assembly?.carry || null;
  const count = pieces.length;
  const offEdge = fling === fallBrick;
  assembly = null;
  held = null;
  heldFrom = null;
  heldHome = null;
  for (const piece of pieces) {
    fling(piece.brick);
    if (piece.home?.role !== 'supply') continue;
    const pedestal = pedestals.find((item) => item.id === piece.home.pedestalId);
    if (pedestal && !pedestal.supply) refill(pedestal, true);
  }
  carry?.parent?.remove(carry);
  playToss();
  if (offEdge) setStatus(count > 1 ? `Dropped ${count} bricks off the edge.` : 'Off the edge.');
  else setStatus(count > 1 ? `Tossed ${count} bricks.` : 'Tossed it away.');
  reviewBuild(true);
}

function releaseHeld() {
  if (!held) return;
  const droppedAt = pieceWorld();
  if (droppedAt.x < CLIFF_X) {
    tossHeld(fallBrick);
    discardGhost();
    return;
  }
  if (shouldToss(droppedAt)) {
    tossHeld();
    discardGhost();
    return;
  }
  const placed = assembly ? placeAssembly() : placeSingle();
  if (!placed) restoreHeld();
  discardGhost();
}

function discardGhost() {
  if (!ghost) return;
  ghost.parent?.remove(ghost);
  ghost = null;
}

function followAim(point) {
  const target = assembly ? assembly.carry : held;
  scene.attach(target);
  target.position.copy(point);
  target.position.y += 0.04;
  if (assembly) {
    target.rotation.set(0, 0, 0);
    target.scale.setScalar(pegScale);
    return;
  }
  target.rotation.set(0, held.userData.rot * Math.PI / 2, 0);
  syncBrickScale(held);
}

function showGhost(snap) {
  if (!ghost || assembly) return;
  if (!snap) {
    ghost.visible = false;
    return;
  }
  const pos = brickLocalPosition(held, snap);
  gridGroup.attach(ghost);
  ghost.position.set(pos.x, pos.y, pos.z);
  ghost.rotation.set(0, held.userData.rot * Math.PI / 2, 0);
  syncBrickScale(ghost);
  ghost.visible = true;
}

function updateSnapFromPoint(point) {
  if (!held) return;
  lastAim.copy(point);
  hasAim = true;
  if (!heldFrom) followAim(point);
  localPoint.copy(point);
  gridGroup.worldToLocal(localPoint);
  const margin = STUD * 3;
  const nearBuild = localPoint.x > -margin && localPoint.z > -margin
    && localPoint.x < GRID_X * STUD + margin && localPoint.z < GRID_Z * STUD + margin;
  if (assembly) {
    held.userData.snap = nearBuild
      ? findAssemblySnap(grid, placementPieces(), held, localPoint.x, localPoint.y, localPoint.z)
      : null;
    return;
  }
  if (heldFrom) held.userData.rot = quarterTurns(held);
  const snap = nearBuild ? findSnap(grid, held, localPoint.x, localPoint.y, localPoint.z) : null;
  held.userData.snap = snap;
  showGhost(snap);
}

function inBuild(object) {
  let current = object;
  while (current) {
    if (current === buildRoot) return true;
    current = current.parent;
  }
  return false;
}

function syncBrickScale(brick) {
  if (!brick) return;
  if (assembly?.pieces.some((piece) => piece.brick === brick)) {
    brick.scale.setScalar(1);
    return;
  }
  brick.scale.setScalar(inBuild(brick) ? 1 : pegScale);
}

function setPegScale(next) {
  pegScale = THREE.MathUtils.clamp(next, PEG_MIN, PEG_MAX);
  buildRoot.scale.setScalar(pegScale);
  world.layoutTable(pegScale);
  machine.setPegKnob(pegScale, PEG_MIN, PEG_MAX);
  machine.placeScreen(pegScale);
  for (const item of targets) {
    if (item.userData?.type === 'brick') syncBrickScale(item);
  }
  syncBrickScale(held);
  syncBrickScale(ghost);
  world.challenge.model.scale.setScalar(pegScale);
  const far = -0.55 - (GRID_Z * STUD * pegScale + 0.16) / 2;
  world.challenge.group.position.set(0, 0, far - 0.4);
  world.challenge.sign.position.set(-0.34, 0.9, -2.67);
  world.challenge.sign.rotation.set(0, 0, 0);
  world.challenge.sign.scale.setScalar(1.22);
  world.challenge.newButton.position.set(0.22, 0.9, -2.65);
  world.challenge.newButton.rotation.set(0, 0, 0);
  world.challenge.newButton.userData.restZ = -2.65;
  world.challenge.newButton.scale.setScalar(world.challenge.newButton.userData.baseScale || 1.22);
  const side = (GRID_X * STUD * pegScale + 0.16) / 2;
  world.bin.position.set(-(side + 0.34), 0, -0.42);
  if (assembly) assembly.carry.scale.setScalar(inBuild(assembly.carry) ? 1 : pegScale);
  if (pegReadout) pegReadout.textContent = `${(STUD * pegScale * 100).toFixed(1)} cm`;
  if (pegInput && document.activeElement !== pegInput) pegInput.value = String(pegScale);
}

function setPegFromHit(hit) {
  const local = hit.owner.worldToLocal(hit.point.clone());
  const t = THREE.MathUtils.clamp((local.x + 0.42) / 0.84, 0, 1);
  const next = PEG_MIN + t * (PEG_MAX - PEG_MIN);
  if (pegInput) pegInput.value = String(next);
  setPegScale(next);
}

pegInput?.addEventListener('input', () => {
  setPegScale(Number(pegInput.value));
});
setPegScale(1);

function uiRest(owner) {
  return owner.userData.baseScale ?? 1;
}

function hover(owner) {
  if (hovered === owner) return;
  if (hovered?.userData.type === 'ui' && hovered.userData.action !== 'peg') {
    const selectedColor = hovered.userData.action === 'color' && hovered.userData.value === selection.colorId;
    hovered.scale.setScalar(uiRest(hovered) * (selectedColor ? 1.08 : 1));
  }
  hovered = owner;
  if (owner?.userData.type === 'ui' && owner.userData.action !== 'peg') owner.scale.setScalar(uiRest(owner) * 1.1);
  renderer.domElement.style.cursor = owner ? 'pointer' : (held ? 'grabbing' : 'default');
}

function onPointerMove(event) {
  if (watching) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  if (climb?.pulling) pullClimb(event.clientY);
  if (renderer.xr.isPresenting) return;
  if (pegDrag) {
    const pegHit = hitFromCamera();
    if (pegHit?.owner?.userData.action === 'peg') setPegFromHit(pegHit);
    return;
  }
  const hit = hitFromCamera();
  hover(hit?.owner ?? null);
  if (held?.userData.type === 'prop' && !heldFrom) {
    raycaster.setFromCamera(pointer, camera);
    const aim = propCarryPoint();
    if (aim) {
      scene.attach(held);
      held.position.copy(aim);
      presentHeld(held);
      notePropMotion();
    }
    return;
  }
  if (held && !heldFrom) {
    raycaster.setFromCamera(pointer, camera);
    const aim = placementPoint();
    if (aim) updateSnapFromPoint(aim);
  }
}

function closestBoat(list, points, reach) {
  let best = null;
  let bestDist = reach;
  for (const mesh of list) {
    mesh.getWorldPosition(worldPoint);
    for (const point of points) {
      const dist = worldPoint.distanceTo(point);
      if (dist < bestDist) {
        bestDist = dist;
        best = mesh;
      }
    }
  }
  if (!best) return null;
  return { owner: best, point: best.getWorldPosition(rungClosest) };
}

function gripBoatEnd(controller) {
  const near = closestBoat(world.canoe.ends, handPoints(controller), 0.36);
  if (!near) return false;
  boatGrip = { controller };
  oarGrip = null;
  pulseController(controller);
  setStatus('Holding the canoe. Press the trigger to shove it.');
  return true;
}

function gripOar(controller) {
  if (!aboard) return false;
  const near = closestBoat(world.canoe.oars, handPoints(controller), 0.42);
  if (!near) return false;
  controller.getWorldPosition(handPoint);
  oarGrip = { controller, x: handPoint.x, z: handPoint.z, stroked: false };
  pulseController(controller);
  setStatus('Pull the oar back to row.');
  return true;
}

function shoveBoat() {
  const result = world.canoe.shove();
  if (!result) return;
  pulseController(boatGrip?.controller);
  setStatus(result === 'water'
    ? 'The canoe is floating into the shallows. Grab the seat to get in.'
    : 'Shoved. Press the trigger again.');
}

function boardCanoe() {
  if (!world.canoe.floating() || aboard) return;
  const seat = world.canoe.seatPoint;
  if (renderer.xr.isPresenting && xrFrame) {
    const ref = renderer.xr.getReferenceSpace();
    const pose = ref && xrFrame.getViewerPose(ref);
    if (pose) {
      const head = pose.transform.position;
      shiftPlayer(seat.x - head.x, seat.y + 0.72 - head.y, seat.z - head.z);
    }
  } else {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(world.canoe.group.quaternion);
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.minPolarAngle = 0.12;
    controls.maxDistance = 5;
    controls.enabled = true;
    controls.target.set(seat.x + fwd.x * 2.2, seat.y + 0.35, seat.z + fwd.z * 2.2);
    camera.position.set(seat.x, seat.y + 0.78, seat.z);
    controls.update();
  }
  lastSeat.copy(seat);
  aboard = true;
  boatGrip = null;
  if (climb) leaveClimb();
  setStatus('In the canoe. Grip an oar and pull back to row.');
}

const lastSeat = new THREE.Vector3();

function syncAboard() {
  if (!aboard) return;
  const seat = world.canoe.seatPoint;
  const dx = seat.x - lastSeat.x;
  const dy = seat.y - lastSeat.y;
  const dz = seat.z - lastSeat.z;
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.0001) return;
  if (renderer.xr.isPresenting) shiftPlayer(dx, dy, dz);
  else {
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
    controls.target.x += dx;
    controls.target.y += dy;
    controls.target.z += dz;
  }
  lastSeat.copy(seat);
}

function pullOar() {
  if (!oarGrip) return;
  oarGrip.controller.getWorldPosition(handPoint);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(world.canoe.group.quaternion);
  const along = (oarGrip.x - handPoint.x) * fwd.x + (oarGrip.z - handPoint.z) * fwd.z;
  if (along > 0.1 && !oarGrip.stroked) {
    if (world.canoe.stroke()) pulseController(oarGrip.controller);
    oarGrip.stroked = true;
    oarGrip.x = handPoint.x;
    oarGrip.z = handPoint.z;
  } else if (along < 0.03) {
    oarGrip.stroked = false;
    oarGrip.x = handPoint.x;
    oarGrip.z = handPoint.z;
  }
}

let boatHeld = false;

function onPointerDown(event) {
  if (watching) return;
  if (event.button !== 0 || renderer.xr.isPresenting) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  const hit = hitFromCamera();
  if (hit?.owner?.userData.action === 'peg') {
    pegDrag = true;
    controls.enabled = false;
    setPegFromHit(hit);
  }
  const owner = hit?.owner ?? null;
  if (owner?.userData.type === 'teleport') {
    teleportTo(owner.userData.spot);
    return;
  }
  if (owner?.userData.type === 'boatEnd') {
    boatHeld = true;
    setStatus('Holding the canoe. Press F to shove it.');
    return;
  }
  if (owner?.userData.type === 'boatSeat' || owner?.userData.type === 'boatHull') {
    if (world.canoe.floating()) boardCanoe();
    else setStatus('Grip an end and press F to shove the canoe into the water.');
    return;
  }
  if (owner?.userData.type === 'oar' && aboard) {
    world.canoe.stroke();
    setStatus('Rowing.');
    return;
  }
  if (world.gear.pointer(owner)) return;
  if (!held && owner?.userData.type === 'rung') {
    beginClimb(owner.userData.ladder, hit.point.y, owner.userData.index);
    grabRung(event.clientY);
    try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* already grabbing */ }
    return;
  }
  press = {
    x: event.clientX,
    y: event.clientY,
    owner,
    grabbedNow: false,
  };
  if (!held && owner?.userData.type === 'prop') {
    grabProp(owner, null);
    press.grabbedNow = true;
    raycaster.setFromCamera(pointer, camera);
    const aim = propCarryPoint();
    if (aim && held) {
      held.position.copy(aim);
      presentHeld(held);
      notePropMotion();
    }
  } else if (!held && owner?.userData.type === 'brick') {
    grab(owner, null, event.shiftKey);
    press.grabbedNow = true;
    raycaster.setFromCamera(pointer, camera);
    const aim = placementPoint();
    if (aim) updateSnapFromPoint(aim);
  }
  const interactive = owner && (owner.userData.type === 'ui' || owner.userData.type === 'brick' || owner.userData.type === 'prop' || held);
  if (interactive || held) controls.enabled = false;
}

function onPointerUp(event) {
  if (watching) return;
  if (climb?.pulling) releasePull();
  if (pegDrag) {
    pegDrag = false;
    controls.enabled = true;
    press = null;
    return;
  }
  if (!press || renderer.xr.isPresenting) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  const clicked = moved < 8;
  const { owner } = press;
  press = null;
  controls.enabled = !(climb && !climb.onRoof);
  if (owner?.userData.type === 'ui' && clicked && !held) {
    activateUi(owner);
    return;
  }
  if (!held || heldFrom) {
    if (owner?.userData.type === 'ui' && clicked) activateUi(owner);
    return;
  }
  if (held.userData.type === 'prop') {
    releaseProp();
    return;
  }
  raycaster.setFromCamera(pointer, camera);
  const aim = placementPoint();
  if (aim) updateSnapFromPoint(aim);
  releaseHeld();
}

function onKeyDown(event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (watching) return;
  if (climb && (event.key === 'w' || event.key === 'W' || event.key === 'ArrowUp')) {
    moveClimb(1);
    return;
  }
  if (climb && (event.key === 's' || event.key === 'S' || event.key === 'ArrowDown')) {
    moveClimb(-1);
    return;
  }
  if (event.repeat) return;
  if ((event.key === 'q' || event.key === 'Q') && world.gear.dropDesktop()) return;
  if (event.key === 'f' || event.key === 'F') {
    if (world.gear.useDesktop()) return;
    if (aboard) {
      if (world.canoe.stroke()) setStatus('Rowing.');
      return;
    }
    if (boatHeld) {
      const result = world.canoe.shove();
      if (result) {
        setStatus(result === 'water'
          ? 'The canoe is floating into the shallows. Click it to get in.'
          : 'Shoved. Press F again.');
      }
    }
    return;
  }
  if (event.key === 'a' || event.key === 'A') teleportNext();
  if (event.key === 'r' || event.key === 'R') rotateHeld();
  if (event.key === 'Enter') orderSelection();
  if (event.key === 'n' || event.key === 'N') startChallenge(false);
}

function onXrTrigger(controller) {
  if (watching) return;
  if (held && heldFrom === controller) return;
  const aimed = hitFromController(controller);
  if (world.gear.equipPocket(aimed?.owner, controller)) return;
  if (world.gear.use(controller)) return;
  if (boatGrip) {
    shoveBoat();
    return;
  }
  if (aboard) {
    if (world.canoe.stroke()) {
      pulseController(controller);
      setStatus('Rowing.');
    }
    return;
  }
  const near = rungFromController(controller);
  if (near) {
    attachClimb(controller, near);
    return;
  }
  const hit = hitFromController(controller);
  if (hit?.owner?.userData.action === 'peg') {
    controller.userData.pegDrag = true;
    setPegFromHit(hit);
    return;
  }
  if (hit?.owner?.userData.type === 'teleport') {
    teleportTo(hit.owner.userData.spot);
    return;
  }
  if (hit?.owner?.userData.type === 'rung') {
    attachClimb(controller, hit);
    return;
  }
  if (hit?.owner?.userData.type === 'boatSeat' || hit?.owner?.userData.type === 'boatHull') {
    if (world.canoe.floating()) boardCanoe();
    else setStatus('Shove the canoe into the water, then get in.');
    return;
  }
  if (hit?.owner?.userData.type === 'ui') activateUi(hit.owner);
}

function onXrSqueeze(controller) {
  if (watching) return;
  if (held && heldFrom === controller) return;
  const aimed = hitFromController(controller);
  if (world.gear.dropPocket(aimed?.owner, controller)) return;
  if (world.gear.isHolding(controller)) {
    world.gear.stowHand(controller);
    return;
  }
  if (world.gear.tryGrip(controller, handPoints(controller), aimed?.owner)) return;
  if (held) return;
  if (aboard) {
    gripOar(controller);
    return;
  }
  if (gripBoatEnd(controller)) return;
  const near = rungFromController(controller);
  if (near) {
    attachClimb(controller, near);
    return;
  }
  const hit = hitFromController(controller);
  if (hit?.owner?.userData.type === 'rung') {
    attachClimb(controller, hit);
    return;
  }
  const whole = triggerHeld(controller);
  const inHand = closestBrickToHand(handPoints(controller));
  if (inHand) {
    grab(inHand, controller, whole);
    return;
  }
  tmpDir.set(0, 0, -1).applyQuaternion(controller.quaternion);
  controller.getWorldPosition(handPoint);
  if (hit?.owner?.userData.type === 'prop') {
    grabProp(hit.owner, controller);
    return;
  }
  const target = (hit?.owner?.userData.type === 'brick' ? hit.owner : null) || closestBrickToRay(handPoint, tmpDir);
  if (target) grab(target, controller, whole);
}

function piecePoint() {
  held.getWorldPosition(worldPoint);
  return worldPoint;
}

function onXrRelease(controller) {
  if (boatGrip?.controller === controller) boatGrip = null;
  if (oarGrip?.controller === controller) oarGrip = null;
  if (climb?.hand === controller && !controller.userData.triggerDown) {
    climb.hand = null;
    climb.pull = 0;
  }
  if (controller.userData.pegDrag) {
    controller.userData.pegDrag = false;
    return;
  }
  if (!held || heldFrom !== controller) return;
  if (held.userData.type === 'prop') {
    releaseProp();
    return;
  }
  updateSnapFromPoint(piecePoint());
  releaseHeld();
}

function pollTeleport(controller) {
  const pressed = !!controller.userData.inputSource?.gamepad?.buttons?.[4]?.pressed;
  if (pressed && !controller.userData.teleportLatch) {
    controller.userData.teleportLatch = true;
    teleportNext();
  } else if (!pressed) controller.userData.teleportLatch = false;
}

function pollBag(controller) {
  if (controller.userData.inputSource?.handedness !== 'right') return;
  const pressed = !!controller.userData.inputSource?.gamepad?.buttons?.[5]?.pressed;
  if (pressed && !controller.userData.bagLatch) {
    controller.userData.bagLatch = true;
    world.gear.toggleMenu();
  } else if (!pressed) controller.userData.bagLatch = false;
}

function pollRotate(controller) {
  const gamepad = controller.userData.inputSource?.gamepad;
  if (!gamepad || !held || heldFrom !== controller) return;
  const stick = gamepad.axes?.[2] ?? 0;
  const bagButton = world.gear.ownsBag() && controller.userData.inputSource?.handedness === 'right';
  const button = !bagButton && gamepad.buttons?.[5]?.pressed;
  const active = button || stick > 0.6;
  if (active && !controller.userData.rotateLatch) {
    controller.userData.rotateLatch = true;
    rotateHeld();
  } else if (!active) controller.userData.rotateLatch = false;
}

function updateHeldXr() {
  if (!held || !heldFrom) return;
  if (held.userData.type === 'prop') {
    presentHeld(held);
    notePropMotion();
    return;
  }
  updateSnapFromPoint(piecePoint());
}

const carryPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.05);
const propSamples = [];
const faceUp = new THREE.Vector3(0, 1, 0);
const towardEye = new THREE.Vector3();
const presentQuat = new THREE.Quaternion();

function supportY(prop) {
  let best = prop.userData.floorY ?? 0.03;
  const span = prop.userData.stackSpan ?? 0.35;
  for (const other of targets) {
    if (other === prop || other.userData.role === 'held') continue;
    if (other.userData.type === 'shelf') {
      const dx = Math.abs(prop.position.x - other.position.x);
      const dz = Math.abs(prop.position.z - other.position.z);
      if (dx < other.userData.hx && dz < other.userData.hz) {
        const top = other.userData.top + (prop.userData.floorY ?? 0);
        if (top > best) best = top;
      }
      continue;
    }
    if (other.userData.type !== 'prop' || other.userData.stackH == null) continue;
    const dx = other.position.x - prop.position.x;
    const dz = other.position.z - prop.position.z;
    if (dx * dx + dz * dz > span * span) continue;
    const floor = other.userData.floorY ?? 0;
    const top = other.position.y - floor + other.userData.stackH + (prop.userData.floorY ?? 0);
    if (top > best) best = top;
  }
  return best;
}

function presentHeld(prop) {
  if (!prop) return;
  if (prop.userData.hold === 'level') {
    towardEye.subVectors(camera.position, prop.position);
    if (towardEye.lengthSq() < 1e-6) return;
    prop.rotation.set(0, Math.atan2(-towardEye.z, towardEye.x), 0);
    return;
  }
  if (heldFrom) {
    presentQuat.setFromUnitVectors(faceUp, towardEye.set(0, 0.35, 1).normalize());
  } else {
    towardEye.subVectors(camera.position, prop.position);
    if (towardEye.lengthSq() < 1e-6) return;
    towardEye.normalize();
    presentQuat.setFromUnitVectors(faceUp, towardEye);
  }
  prop.quaternion.copy(presentQuat);
}

function propCarryPoint() {
  const point = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(carryPlane, point)) return null;
  return point;
}

function grabProp(prop, holder) {
  if (watching) return;
  held = prop;
  heldFrom = holder;
  heldHome = null;
  assembly = null;
  prop.userData.role = 'held';
  const index = targets.indexOf(prop);
  if (index >= 0) targets.splice(index, 1);
  setBrickRaycast(prop, false);
  propSamples.length = 0;
  if (holder) {
    holder.attach(prop);
    prop.position.set(0, -0.05, -0.24);
    presentHeld(prop);
  } else {
    scene.attach(prop);
    presentHeld(prop);
  }
  setStatus(`Holding a ${prop.userData.label}. Let go to throw it.`);
}

function notePropMotion() {
  if (!held || held.userData.type !== 'prop') return;
  const point = new THREE.Vector3();
  held.getWorldPosition(point);
  propSamples.push({ t: performance.now() / 1000, p: point.clone() });
  const cutoff = propSamples[propSamples.length - 1].t - 0.18;
  while (propSamples.length > 1 && propSamples[0].t < cutoff) propSamples.shift();
}

function releaseProp() {
  const prop = held;
  const holder = heldFrom;
  held = null;
  heldFrom = null;
  heldHome = null;
  assembly = null;
  scene.attach(prop);
  let velocity = new THREE.Vector3();
  if (propSamples.length >= 2) {
    const first = propSamples[0];
    const last = propSamples[propSamples.length - 1];
    const span = Math.max(0.016, last.t - first.t);
    velocity.subVectors(last.p, first.p).divideScalar(span);
  }
  propSamples.length = 0;
  if (holder) velocity.y = Math.max(velocity.y, 0.8);
  const speed = velocity.length();
  if (speed > 7) velocity.multiplyScalar(7 / speed);
  if (speed < 1.6 && prop.userData.stackH != null) {
    prop.position.y = supportY(prop);
    prop.rotation.x = 0;
    prop.rotation.z = 0;
    prop.userData.role = 'loose';
    setBrickRaycast(prop, true);
    if (!targets.includes(prop)) targets.push(prop);
    setStatus(`Set the ${prop.userData.label} down.`);
    return;
  }
  throwProp(prop, velocity);
  setStatus(`Threw the ${prop.userData.label}.`);
}

function throwProp(prop, velocity) {
  let vx = velocity.x;
  let vy = velocity.y;
  let vz = velocity.z;
  const floorY = prop.userData.floorY ?? 0.03;
  const job = {
    t: 0,
    d: 6,
    last: 0,
    update() {
      const dt = Math.min(0.05, Math.max(0, job.t - job.last));
      job.last = job.t;
      if (dt === 0) return;
      vy -= 9.2 * dt;
      prop.position.x += vx * dt;
      prop.position.y += vy * dt;
      prop.position.z += vz * dt;
      prop.rotation.x += dt * 2.4;
      prop.rotation.z += dt * 1.7;
      const overCliff = prop.position.x < CLIFF_X;
      if (!overCliff) {
        if (prop.position.x > 2.35) {
          prop.position.x = 2.35;
          vx = -Math.abs(vx) * 0.45;
        }
        if (prop.position.z < -2.25) {
          prop.position.z = -2.25;
          vz = Math.abs(vz) * 0.45;
        }
        if (prop.position.z > 2.25) {
          prop.position.z = 2.25;
          vz = -Math.abs(vz) * 0.45;
        }
      }
      if (overCliff && prop.position.y <= WATER_Y) {
        world.splash(prop.position.x, prop.position.z);
        prop.parent?.remove(prop);
        job.t = job.d;
        return;
      }
      const rest = prop.userData.stackH != null ? supportY(prop) : floorY;
      if (!overCliff && prop.position.y <= rest && vy <= 0) {
        prop.position.y = rest;
        if (vy < -1.3) {
          vy = -vy * 0.32;
          vx *= 0.55;
          vz *= 0.55;
          return;
        }
        prop.userData.role = 'loose';
        setBrickRaycast(prop, true);
        if (!targets.includes(prop)) targets.push(prop);
        job.t = job.d;
      }
    },
  };
  jobs.push(job);
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function poseOf(object) {
  object.updateWorldMatrix(true, false);
  object.getWorldPosition(posePos);
  object.getWorldQuaternion(poseQuat);
  return [
    round3(posePos.x), round3(posePos.y), round3(posePos.z),
    round3(poseQuat.x), round3(poseQuat.y), round3(poseQuat.z), round3(poseQuat.w),
  ];
}

function packBrick(brick, role) {
  const data = {
    id: brick.userData.watchId,
    role,
    shapeId: brick.userData.shapeId,
    colorId: brick.userData.colorId,
    heightId: brick.userData.heightId,
    units: brick.userData.units,
    flat: brick.userData.flat ? 1 : 0,
    rot: brick.userData.rot || 0,
  };
  if (role === 'placed' && brick.userData.anchor) {
    data.gx = brick.userData.anchor.gx;
    data.gz = brick.userData.anchor.gz;
    data.layer = brick.userData.anchor.layer;
  } else if (role === 'supply') {
    data.pedestalId = brick.userData.pedestalId;
  } else {
    data.pose = poseOf(brick);
  }
  return data;
}

function captureSnapshot() {
  const bricks = [];
  for (const item of targets) {
    if (item.userData?.type !== 'brick') continue;
    if (item.userData.role === 'placed' || item.userData.role === 'supply') bricks.push(packBrick(item, item.userData.role));
  }
  if (assembly) {
    for (const piece of assembly.pieces) bricks.push(packBrick(piece.brick, 'held'));
  } else if (held) bricks.push(packBrick(held, 'held'));
  return {
    peg: round3(pegScale),
    verdict: shownVerdict,
    challenge: challenge ? challenge.pieces : [],
    pedestals: pedestals.map((item) => ({
      id: item.id,
      colorId: item.colorId,
      shapeId: item.shapeId,
      heightId: item.heightId,
      flat: item.flat ? 1 : 0,
      index: item.index,
    })),
    bricks,
    hands: renderer.xr.isPresenting ? controllers.map((controller) => poseOf(controller)) : [],
  };
}

function remoteBrickKey(data) {
  return `${data.shapeId}|${data.colorId}|${data.heightId}|${data.units}|${data.flat}`;
}

function makeRemoteBrick(data) {
  const brick = createBrick(shapeById(data.shapeId), colorById(data.colorId), {
    units: data.units,
    heightId: data.heightId,
    flat: !!data.flat,
  });
  brick.userData.watchId = data.id;
  brick.userData.remoteKey = remoteBrickKey(data);
  setBrickRaycast(brick, false);
  return brick;
}

function placeRemoteBrick(brick, data) {
  brick.userData.rot = data.rot || 0;
  if (data.role === 'placed') {
    gridGroup.attach(brick);
    const pos = brickLocalPosition(brick, { gx: data.gx, gz: data.gz, layer: data.layer, dist: 0 });
    brick.position.set(pos.x, pos.y, pos.z);
    brick.rotation.set(0, brick.userData.rot * Math.PI / 2, 0);
    brick.scale.setScalar(1);
    return;
  }
  if (data.role === 'supply') {
    const pedestal = remotePedestals.get(data.pedestalId);
    if (!pedestal) return;
    pedestal.group.attach(brick);
    brick.position.set(0, 0.712, 0);
    brick.rotation.set(0, 0, 0);
    brick.scale.setScalar(pegScale);
    return;
  }
  if (!data.pose) return;
  scene.attach(brick);
  const [x, y, z, qx, qy, qz, qw] = data.pose;
  brick.position.set(x, y, z);
  brick.quaternion.set(qx, qy, qz, qw);
  brick.scale.setScalar(pegScale);
}

function syncRemotePedestals(list) {
  for (const data of list) {
    let pedestal = remotePedestals.get(data.id);
    if (!pedestal) {
      const visual = createPedestal(data.index, partLabel(data.colorId, data.shapeId, data.heightId, !!data.flat));
      scene.add(visual.group);
      pedestal = { id: data.id, group: visual.group, index: data.index };
      remotePedestals.set(data.id, pedestal);
    }
    if (pedestal.index !== data.index) {
      pedestal.index = data.index;
      const slot = pedestalSlot(data.index);
      pedestal.group.position.set(slot.x, 0, slot.z);
    }
  }
}

function dropMissingPedestals(list) {
  const seen = new Set(list.map((item) => item.id));
  for (const [id, pedestal] of remotePedestals) {
    if (seen.has(id)) continue;
    const leftovers = [];
    pedestal.group.traverse((child) => {
      if (child.userData?.type === 'brick') leftovers.push(child);
    });
    for (const brick of leftovers) brick.parent?.remove(brick);
    pedestal.group.parent?.remove(pedestal.group);
    disposePedestalGroup(pedestal.group);
    remotePedestals.delete(id);
  }
}

function syncRemoteBricks(list) {
  const seen = new Set();
  for (const data of list) {
    if (data.role === 'supply' && !remotePedestals.has(data.pedestalId)) continue;
    seen.add(data.id);
    let brick = remoteBricks.get(data.id);
    if (!brick || brick.userData.remoteKey !== remoteBrickKey(data)) {
      brick?.parent?.remove(brick);
      brick = makeRemoteBrick(data);
      remoteBricks.set(data.id, brick);
    }
    placeRemoteBrick(brick, data);
  }
  for (const [id, brick] of remoteBricks) {
    if (seen.has(id)) continue;
    brick.parent?.remove(brick);
    remoteBricks.delete(id);
  }
}

function makeWatchHand() {
  const group = new THREE.Group();
  const palm = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.04, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.55 }),
  );
  palm.position.set(0, 0, -0.04);
  group.add(palm);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.0012, 0.8, 6),
    new THREE.MeshBasicMaterial({ color: 0x3ef0c4, transparent: true, opacity: 0.75 }),
  );
  beam.geometry.translate(0, 0.4, 0);
  beam.rotation.x = Math.PI / 2;
  group.add(beam);
  group.visible = false;
  scene.add(group);
  return group;
}

function syncRemoteHands(hands) {
  for (let index = 0; index < watchHands.length; index += 1) {
    const pose = hands[index];
    const hand = watchHands[index];
    if (!pose) {
      hand.visible = false;
      continue;
    }
    hand.visible = true;
    const [x, y, z, qx, qy, qz, qw] = pose;
    hand.position.set(x, y, z);
    hand.quaternion.set(qx, qy, qz, qw);
  }
}

function applySnapshot(snap) {
  if (!seenWatch) {
    seenWatch = true;
    watchNote.textContent = 'Live';
    setStatus('Watching the room. Drag to look around.');
  }
  if (typeof snap.peg === 'number' && Math.abs(snap.peg - pegScale) > 0.001) setPegScale(snap.peg);
  const pedestalList = snap.pedestals || [];
  syncRemotePedestals(pedestalList);
  syncRemoteBricks(snap.bricks || []);
  dropMissingPedestals(pedestalList);
  const pieces = snap.challenge || [];
  const key = JSON.stringify(pieces);
  if (key !== challengeKey) {
    challengeKey = key;
    showExample({ pieces });
  }
  if (snap.verdict) world.challenge.setVerdict(snap.verdict);
  syncRemoteHands(snap.hands || []);
}

function startRelay() {
  if (watching && roomCode.length !== 4) return;
  if (watching) watchHands = [makeWatchHand(), makeWatchHand()];
  try {
    relay = openRoom(roomCode, {
      role: watching ? 'watch' : 'host',
      onSnapshot(data) {
        if (watching) applySnapshot(data);
      },
      onStatus(status) {
        if (seenWatch) return;
        if (status === 'offline') {
          watchNote.textContent = 'Could not reach the watch connection.';
          if (watching) setStatus(`Still waiting for headset room ${roomCode}.`);
        } else if (watching) {
          watchNote.textContent = 'Connected. Waiting for the headset to send the room.';
        }
      },
      onWatchers(count) {
        watcherCount = count;
        if (watching) return;
        watchNote.textContent = count > 0
          ? `${count === 1 ? '1 person is' : `${count} people are`} watching.`
          : '';
        if (count > 0) relay?.send(captureSnapshot());
      },
    });
  } catch {
    watchNote.textContent = 'Could not open the room.';
  }
}

let xrFrame = null;

function frame(time, frame) {
  xrFrame = frame ?? null;
  const dt = Math.min(clock.getDelta(), 0.05);
  for (let i = jobs.length - 1; i >= 0; i -= 1) {
    jobs[i].t += dt;
    const k = Math.min(1, jobs[i].t / jobs[i].d);
    jobs[i].update(k);
    if (k >= 1) jobs.splice(i, 1);
  }
  machine.update(dt);
  world.challenge.update(dt);
  world.update(dt);
  syncAboard();
  pullOar();
  for (const controller of controllers) updateLaser(controller);
  if (!renderer.xr.isPresenting) controls.update();
  if (biteHold) {
    finishWaterBite();
    if (biteHold && !renderer.xr.isPresenting) {
      const focus = world.biteFocus();
      if (focus) {
        camera.position.copy(focus.eye);
        camera.lookAt(focus.look);
      }
    }
  }
  if (climb && !climb.onRoof) {
    if (renderer.xr.isPresenting && climb.hand) pullXrClimb();
    if (!renderer.xr.isPresenting) applyClimbView();
  }
  updatePlayerFall(dt);
  if (renderer.xr.isPresenting || !(climb && !climb.onRoof)) {
    for (const controller of controllers) {
      pollTeleport(controller);
      pollRotate(controller);
      pollBag(controller);
      if (renderer.xr.isPresenting && controller.userData.squeezeDown && heldFrom !== controller && !oarGrip && aboard) {
        gripOar(controller);
      }
      if (renderer.xr.isPresenting && controller.userData.squeezeDown && heldFrom !== controller && !climb?.hand && !boatGrip && !aboard && !world.gear.isHolding(controller)) {
        if (!gripBoatEnd(controller)) {
          const near = rungFromController(controller);
          if (near) attachClimb(controller, near);
        }
      }
      if (controller.userData.pegDrag) {
        const hit = hitFromController(controller);
        if (hit?.owner?.userData.action === 'peg') setPegFromHit(hit);
      }
    }
    updateHeldXr();
  }
  const spotGlow = 0.62 + Math.sin(performance.now() * 0.004) * 0.22;
  teleportSpots.forEach((spot, index) => {
    spot.ringMat.opacity = index === teleportIndex ? 1 : spotGlow;
  });
  const pulse = 0.12 + Math.sin(performance.now() * 0.004) * 0.08;
  if (!held) machine.orderButton.material.emissiveIntensity = pulse;
  world.challenge.newButton.material.emissiveIntensity = challengeMatched ? 0.55 : pulse;
  if (relay) {
    watchSendTimer += dt;
    if (watching && watchSendTimer >= 2) {
      watchSendTimer = 0;
      relay.ping();
    } else if (!watching && watcherCount > 0 && watchSendTimer >= 0.2) {
      watchSendTimer = 0;
      watcherCount = relay.watcherCount();
      relay.send(captureSnapshot());
    }
  }
  renderer.render(scene, camera);
}

startRelay();
