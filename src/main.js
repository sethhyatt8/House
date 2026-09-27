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
const { scene, camera, buildRoot, gridGroup, targets, machine } = world;
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
const envScene = new THREE.Scene();
envScene.add(new THREE.HemisphereLight(0xffffff, 0xd5dee8, 1.5));
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
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 0.45;
controls.maxDistance = 3.4;
controls.update();

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
  hudEl.style.display = 'none';
  if (scalePanel) scalePanel.style.display = 'none';
  controls.enabled = false;
});
renderer.xr.addEventListener('sessionend', () => {
  hudEl.style.display = '';
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
  });
  controller.addEventListener('squeezestart', () => onXrSqueeze(controller));
  controller.addEventListener('squeezeend', () => onXrRelease(controller));
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
  setStatus(first
    ? `${chosenLabel()} is selected. Match the build behind the table. Press NEW for another.`
    : 'New build behind the table. Match the colors and the heights.');
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
  controls.enabled = true;
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
  if (watching || event.repeat) return;
  if (event.key === 'r' || event.key === 'R') rotateHeld();
  if (event.key === 'Enter') orderSelection();
  if (event.key === 'n' || event.key === 'N') startChallenge(false);
}

function onXrTrigger(controller) {
  if (watching || held) return;
  const hit = hitFromController(controller);
  if (hit?.owner?.userData.action === 'peg') {
    controller.userData.pegDrag = true;
    setPegFromHit(hit);
    return;
  }
  if (hit?.owner?.userData.type === 'ui') activateUi(hit.owner);
}

function onXrSqueeze(controller) {
  if (watching || held) return;
  const whole = triggerHeld(controller);
  const inHand = closestBrickToHand(handPoints(controller));
  if (inHand) {
    grab(inHand, controller, whole);
    return;
  }
  tmpDir.set(0, 0, -1).applyQuaternion(controller.quaternion);
  controller.getWorldPosition(handPoint);
  const hit = hitFromController(controller);
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

function pollRotate(controller) {
  const gamepad = controller.userData.inputSource?.gamepad;
  if (!gamepad || !held || heldFrom !== controller) return;
  const stick = gamepad.axes?.[2] ?? 0;
  const button = gamepad.buttons?.[5]?.pressed;
  const active = button || stick > 0.6;
  if (active && !controller.userData.rotateLatch) {
    controller.userData.rotateLatch = true;
    rotateHeld();
  } else if (!active) controller.userData.rotateLatch = false;
}

function updateHeldXr() {
  if (!held || !heldFrom) return;
  if (held.userData.type === 'prop') {
    notePropMotion();
    return;
  }
  updateSnapFromPoint(piecePoint());
}

const carryPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.05);
const propSamples = [];

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
  } else {
    scene.attach(prop);
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
      if (!overCliff && prop.position.y <= floorY && vy <= 0) {
        prop.position.y = floorY;
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

function frame() {
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
  for (const controller of controllers) updateLaser(controller);
  if (!renderer.xr.isPresenting) controls.update();
  else {
    for (const controller of controllers) {
      pollRotate(controller);
      if (controller.userData.pegDrag) {
        const hit = hitFromController(controller);
        if (hit?.owner?.userData.action === 'peg') setPegFromHit(hit);
      }
    }
    updateHeldXr();
  }
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
