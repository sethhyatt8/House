import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { createBrick, makeGhost, setBrickRaycast } from './bricks.js';
import { cellsFromGrid, generateModel, lookVerdict, sameLook } from './challenge.js';
import { colorById, GRID_X, GRID_Z, HEIGHT, heightById, LAYER, MAX_PEDESTALS, partLabel, PEG_MAX, PEG_MIN, shapeById, STUD, STUD_H } from './config.js';
import { brickLocalPosition, canPlaceAssembly, columnTop, connectedBricks, createGrid, findAssemblySnap, findSnap, footprintOf, occupy, release, rotatePieceRecords } from './grid.js';
import { hostRoomCode, openRoom, watchCodeFromUrl } from './watch.js';
import { createAssetManager } from './assets.js';
import { legacy } from './flags.js';
import { GROUND_OLD, followGround } from './walk.js'; // ground/boat pass
import { START_CELL } from './cell.js';
import { CLIFF_X, WATER_Y, createPedestal, createWorld, pedestalSlot } from './world.js';
import { createLiftFeel } from './liftfeel.js';
import { createPlayerHealth } from './health.js';
import { wireBear } from './bearfight.js';
import { wireRaptor } from './raptorfight.js';
import { createMusic } from './music.js';
import { createTopout } from './topout.js';
import { createSfx } from './sfx.js';
import { nearNotches } from './notches.js';
import { barFrame, stepGlide } from './glider.js';
import { FOREST_LEGACY } from './forest.js';
import { MOVE, MOVE_SPEED, SMOOTH_TURN_DEG, SNAP_DEG, TELEPORT, TURN, createGround, createWalker, stickToWorld } from './walk.js';
import { UNDERWATER, createUnderwater } from './underwater.js';
import { SWIM, createSwim } from './swim.js';
import { createScuba } from './scuba.js';

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
const pageParams = new URLSearchParams(location.search);
const watchParam = pageParams.get('watch');
const watching = watchParam != null;
const roomCode = watching ? watchCodeFromUrl() : hostRoomCode();

watchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = watchInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
  if (code.length < 4) {
    watchNote.textContent = 'Room codes are 4 letters.';
    return;
  }
  const next = new URL(location.href);
  next.searchParams.set('watch', code);
  location.href = next.toString();
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = pageParams.get('tone') === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
const xrScale = Number(pageParams.get('xrscale'));
renderer.xr.setFramebufferScaleFactor(Number.isFinite(xrScale) && xrScale > 0 ? xrScale : 1.3);
const fovParam = pageParams.get('fov');
renderer.xr.setFoveation(fovParam == null || fovParam === '' ? 1 : Number(fovParam));
renderer.xr.setReferenceSpaceType('local-floor');
renderer.localClippingEnabled = true;

const loadingEl = document.getElementById('loading');
const loadingBar = document.getElementById('loading-bar');
const assets = createAssetManager(renderer);
await assets.loadManifest('models/scene-manifest.json');
const DEFERRED = ['rock_cliff', 'rock_floor', 'boulder', 'lift_kit', 'chest', 'fire_pit', 'paint_can', 'crag_kit'];
const lazyBoot = pageParams.get('zones') !== '0';
if (lazyBoot) assets.deferMaterials(['rock_cliff', 'rock_floor']);
await assets.preload([
  'crate', 'boulder', 'hatchet', 'rock_cliff', 'rock_floor', 'sea_boulder', 'sea_boulder_lod', 'pines', 'sky_backdrop', 'sky_env', 'water_normal',
  'shark_white', 'swordfish', 'angelfish', 'gull_fly', 'gull_perch', 'shipwreck', 'canoe', 'canoe_cedar', 'paddle',
  'chest', 'torch', 'brush', 'bow', 'arrow', 'bag', 'crab', 'rough_wood',
  'finds', 'ladder_kit', 'table', 'fire_pit', 'paint_can', 'croc', 'reef_corals', 'club_driver', 'hockey_stick', 'crag_kit',
  ...(FOREST_LEGACY ? [] : ['forest_kit']),
].filter((id) => !lazyBoot || !DEFERRED.includes(id)), ({ loaded, total }) => {
  if (loadingBar && total > 0) loadingBar.style.width = `${Math.round((loaded / total) * 100)}%`;
});
if (loadingEl) loadingEl.hidden = true;

const world = createWorld({ assets, renderer });
assets.prefetch(DEFERRED);
const envHdr = assets.feature('sky') ? assets.hdr('sky_env') : null;
if (envHdr) {
  envHdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  world.scene.environment = pmrem.fromEquirectangular(envHdr).texture;
  envHdr.dispose();
  pmrem.dispose();
} else {
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
}
world.scene.environmentIntensity = +(pageParams.get('envi') ?? 1);
world.bakeWater(renderer);
world.gear.bakeIcons?.(renderer);
// Sound pass: samples first (public/audio, see sfx.js), the procedural sounds stay as the fallback / ?sfx=0.
const sfx = createSfx(() => audio());
const SEA_POINT = new THREE.Vector3(-30, WATER_Y, 0);
sfx.fetchAll();
const rawSplash = world.splash;
world.splash = (x, z, burst) => {
  rawSplash(x, z, burst);
  sfx.play(burst ? 'splash_big' : ['splash_small1', 'splash_small2'], { at: { x, y: WATER_Y, z }, gain: burst ? 0.9 : 0.55, ref: 2 });
};
world.canoe.setSplash?.((kind, p, strength) => {
  if (kind === 'catch') sfx.play(['paddle1', 'paddle2', 'paddle3'], { at: p, gain: 0.35 + 0.55 * strength, ref: 1.5 }) || playPaddleSynth(strength);
  else sfx.play(['drip1', 'drip2'], { at: p, gain: 0.3, jitter: 0.2 });
});
world.gear.setSounds({
  pickup: () => sfx.play('cloth', { gain: 0.55 }) || playPickup(),
  chop: (broken) => (broken ? sfx.play('hit_plank', { gain: 0.9 }) && sfx.play('chop', { gain: 0.7 }) : sfx.play('chop', { gain: 0.8 })) || playChop(broken),
  loose: () => (sfx.play('bow_release', { gain: 0.8 }) ? (sfx.play('arrow_whoosh', { gain: 0.25 }), true) : playLoose()),
  strike: () => sfx.play(['hit_wood', 'hit_wood2'], { gain: 0.75 }) || playStrike(),
  dip: playDip,
  sprayStart: playSprayStart,
  sprayLevel: setSprayLevel,
  sprayStop: playSprayStop,
  rattle: playRattle,
});
world.gear.setHaptics(pulseController);
world.gear.setGround((x, z) => world.shallowFloor?.(x, z) ?? null);
world.canoe.setHaptics(pulseController);
const grid = createGrid();
const { scene, camera, buildRoot, gridGroup, targets, machine, roof } = world;
document.body.appendChild(renderer.domElement);
document.body.appendChild(XRButton.createButton(renderer, {
  optionalFeatures: ['local-floor', 'bounded-floor'],
}));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(START_CELL.door.x, 0.72, (START_CELL.door.z0 + START_CELL.door.z1) / 2);
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
  if (spec.parent) {
    spec.parent.add(group);
    group.position.set(spec.x, spec.y ?? 0, spec.z);
    if (spec.scale) group.scale.setScalar(spec.scale);
  } else {
    group.position.set(spec.x, spec.floor ?? 0, spec.z);
    scene.add(group);
  }
  group.userData = { type: 'teleport', spot: teleportSpots.length };
  targets.push(group);
  teleportSpots.push({ ...spec, ringMat, group });
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
addTeleportSpot({
  x: 0.35,
  z: 8.85,
  eye: new THREE.Vector3(0.35, 1.7, 8.45),
  look: new THREE.Vector3(0.4, 0.4, 4.2),
  status: 'Out among the crates.',
});
addTeleportSpot({
  x: 0,
  y: 0.18,
  z: 0.02,
  parent: world.canoe.group,
  scale: 0.62,
  seat: true,
  status: 'In the canoe.',
});

// Underground spots (feedback pass): there is no stick locomotion, and the paint tunnel is 7 m long, so the cave,
// the tunnel and the paint room get their own spots. A (teleportNext) cycles the spots of the level you're on.
const caveSpots = [];
if (world.cave?.tunnel && world.cave?.room) {
  const cave = world.cave;
  const tz = (cave.tunnel.z0 + cave.tunnel.z1) / 2;
  const roomX = (cave.room.x0 + cave.room.x1) / 2;
  const roomZ = (cave.room.z0 + cave.room.z1) / 2;
  [
    { x: cave.standX + 0.5, z: cave.standZ, look: new THREE.Vector3(cave.standX - 3, cave.floor + 1.0, cave.standZ), status: 'Cave floor, by the water.' },
    { x: cave.tunnel.x0 - 0.45, z: tz, look: new THREE.Vector3(cave.tunnel.x1, cave.floor + 1.2, tz), status: 'Mouth of the tunnel.' },
    // ground/boat pass: the spot was the room centre = the middle of the fire pit (now solid); stand 0.9 m west of it
    { x: roomX - (GROUND_OLD ? 0 : 0.9), z: roomZ, look: new THREE.Vector3(cave.room.x1, cave.floor + 1.1, roomZ), status: 'In the paint room.' },
  ].forEach((spot) => {
    caveSpots.push(teleportSpots.length);
    addTeleportSpot({ ...spot, floor: cave.floor, underground: true, eye: new THREE.Vector3(spot.x, cave.floor + 1.55, spot.z) });
  });
}

// Rowing pass: with teleport off (?teleport=0, or TELEPORT_DEFAULT in walk.js) the spots stay as respawn points
// (teleportTo(1) after the water bite / going down) but the rings, the A button and pointer-teleport go away.
if (!TELEPORT) {
  teleportSpots.forEach((spot) => {
    spot.group.visible = false;
    const at = targets.indexOf(spot.group);
    if (at >= 0) targets.splice(at, 1);
  });
}
const nextSpotHint = TELEPORT ? ' Press A for the next spot.' : '';

function doorStanding() {
  return world.gear.doorBoards?.some((board) => !board.userData.dead);
}

function teleportTo(index) {
  if (biteHold) return;
  if (renderer.xr.isPresenting && doorStanding()) return;
  const spot = teleportSpots[index];
  if (!spot) return;
  leaveClimb();
  teleportIndex = index;
  fallVy = 0;
  if (spot.seat) {
    boardCanoe();
    return;
  }
  leaveCanoe();
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
  setStatus(`${spot.status}${nextSpotHint}`);
}

function teleportNext() {
  const feet = renderer.xr.isPresenting ? xrOffset.y : camera.position.y - 1.55;
  const order = feet < -1 && caveSpots.length ? caveSpots : [1, 3, 0, 2, 4];
  const at = order.indexOf(teleportIndex);
  teleportTo(order[(at + 1) % order.length]);
}

let climb = null;
let mantle = null; // overlook pass: the scripted haul over the crag lip (src/topout.js)
let boatGrip = null;
let oarGrip = null;
let aboard = false;
let exitCooldown = 0; // rowing pass: no auto-boarding for a second after you get out
let stickExit = 0;
let fallVy = 0;
const glide = {
  flying: false,
  loose: false,
  airborne: false,
  v: new THREE.Vector3(),
  nose: new THREE.Vector3(-1, 0, 0),
  up: new THREE.Vector3(0, 1, 0),
};
let biteHold = false;
let xrBaseSpace = null;
let xrYaw = 0;
let cellPhase = 0;
let gazeLock = null;
const xrOffset = new THREE.Vector3();
const spaceQuat = new THREE.Quaternion();
const spaceEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const spaceUp = new THREE.Vector3(0, 1, 0);
const spacePivot = new THREE.Vector3();
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

function applyXrSpace() {
  if (!xrBaseSpace) xrBaseSpace = renderer.xr.getReferenceSpace();
  if (!xrBaseSpace) return false;
  spaceQuat.setFromAxisAngle(spaceUp, -xrYaw);
  spacePivot.set(-xrOffset.x, -xrOffset.y, -xrOffset.z).applyQuaternion(spaceQuat);
  try {
    renderer.xr.setReferenceSpace(xrBaseSpace.getOffsetReferenceSpace(new XRRigidTransform(
      { x: spacePivot.x, y: spacePivot.y, z: spacePivot.z },
      { x: spaceQuat.x, y: spaceQuat.y, z: spaceQuat.z, w: spaceQuat.w },
    )));
  } catch {
    return false;
  }
  return true;
}

function shiftPlayer(dx, dy, dz) {
  if (!renderer.xr.isPresenting || !xrFrame) return false;
  const prevX = xrOffset.x;
  const prevY = xrOffset.y;
  const prevZ = xrOffset.z;
  xrOffset.x += dx;
  xrOffset.y += dy;
  xrOffset.z += dz;
  if (!applyXrSpace()) {
    xrOffset.set(prevX, prevY, prevZ);
    return false;
  }
  return true;
}

function enableCellView() {
  camera.layers.enable(1);
  const xrCamera = renderer.xr.getCamera?.();
  if (!xrCamera) return;
  xrCamera.layers.enable(1);
  xrCamera.cameras?.forEach((eye) => eye.layers.enable(1));
}

function placeInCell() {
  if (cellPhase > 1 || watching || !renderer.xr.isPresenting || !xrFrame) return;
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return;
  const head = pose.transform.position;
  if (cellPhase === 0) {
    if (shiftPlayer(START_CELL.spawnX - head.x, 0, START_CELL.spawnZ - head.z)) cellPhase = 1;
    return;
  }
  const orient = pose.transform.orientation;
  spaceQuat.set(orient.x, orient.y, orient.z, orient.w);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(spaceQuat);
  forward.y = 0;
  if (forward.lengthSq() > 1e-6) {
    forward.normalize();
    const delta = Math.atan2(-forward.z, -forward.x);
    if (Math.abs(delta) > 0.03) yawAround(delta, head.x, head.z);
  }
  cellPhase = 2;
}

function pushOutOf(x, z, box, radius) {
  const x0 = box.x0 - radius;
  const x1 = box.x1 + radius;
  const z0 = box.z0 - radius;
  const z1 = box.z1 + radius;
  if (x <= x0 || x >= x1 || z <= z0 || z >= z1) return null;
  const left = x - x0;
  const right = x1 - x;
  const near = z - z0;
  const far = z1 - z;
  const min = Math.min(left, right, near, far);
  if (min === left) return { dx: -left, dz: 0 };
  if (min === right) return { dx: right, dz: 0 };
  if (min === near) return { dx: 0, dz: -near };
  return { dx: 0, dz: far };
}

function containPlayer() {
  if (cellPhase < 2 || watching || aboard || biteHold || mantle || !renderer.xr.isPresenting || !xrFrame) return;
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return;
  let x = pose.transform.position.x;
  let z = pose.transform.position.z;
  const boxes = walker.solids(xrOffset.y);
  for (let pass = 0; pass < 6; pass += 1) {
    let hit = false;
    for (const box of boxes) {
      if (climb && box.climbThrough) continue; // overlook pass: the slot edge doesn't shove you while you hang in it
      const push = pushOutOf(x, z, box, 0.2);
      if (!push) continue;
      if (!shiftPlayer(push.dx, 0, push.dz)) return;
      x += push.dx;
      z += push.dz;
      hit = true;
    }
    if (!hit) break;
  }
}

function yawAround(delta, pivotX, pivotZ) {
  const prevYaw = xrYaw;
  const prevX = xrOffset.x;
  const prevZ = xrOffset.z;
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const dx = pivotX - xrOffset.x;
  const dz = pivotZ - xrOffset.z;
  xrOffset.x = pivotX - (cos * dx + sin * dz);
  xrOffset.z = pivotZ - (-sin * dx + cos * dz);
  xrYaw += delta;
  if (!applyXrSpace()) {
    xrYaw = prevYaw;
    xrOffset.x = prevX;
    xrOffset.z = prevZ;
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
  const head = headSample(); // overlook pass: also called from squeeze/select events (stale XRFrame)
  const dx = (ladder.position.x - 0.42) - head.x;
  const dz = (ladder.userData.zAt ? ladder.userData.zAt(xrOffset.y + 1.2) : ladder.position.z) - head.z;
  if (Math.hypot(dx, dz) > 0.55) shiftPlayer(dx, 0, dz);
}

function pulseController(controller, intensity = 0.7, ms = 50) {
  const pad = controller?.userData?.inputSource?.gamepad;
  const haptic = pad?.hapticActuators?.[0] || pad?.vibrationActuator;
  if (haptic?.pulse) haptic.pulse(intensity, ms);
}

function pulseBoth(intensity, ms) {
  for (const c of controllers) pulseController(c, intensity, ms);
}

function attachClimb(controller, hit) {
  const ladder = hit.owner.userData.ladder;
  if (!ladder || aboard || mantle) return;
  const same = climb && climb.ladder === ladder;
  const lifted = same ? climb.lifted : 0;
  const feet = same && climb.feet != null ? climb.feet : xrOffset.y;
  const low = same && climb.lowest != null ? climb.lowest : feet;
  const high = same && climb.highest != null ? climb.highest : feet;
  const index = hit.owner.userData.type === 'rung' ? hit.owner.userData.index : nearestRung(ladder, hit.point.y);
  beginClimb(ladder, hit.point.y, index);
  climb.hand = controller;
  climb.lifted = lifted;
  climb.onLip = !!hit.owner.userData.lip;
  if (ladder.userData.shaft) {
    climb.feet = feet;
    climb.lowest = Math.min(low, feet);
    climb.highest = Math.max(high, feet);
  }
  standAtLadder(ladder);
  controller.getWorldPosition(handPoint);
  climb.handY = handPoint.y;
  pulseController(controller, climb.onLip ? 0.9 : 0.7, climb.onLip ? 70 : 50);
  setStatus(climb.onLip
    ? 'Holding the lip. Pull down hard to haul yourself over the top.'
    : ladder.userData.crag
    ? 'Holding a rock edge. Pull down to climb, push up to go down. Swap hands as you go.'
    : ladder.userData.notches
    ? 'Holding a notch. Pull down to climb, push up to go down. Swap hands as you go.'
    : ladder.userData.shaft
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
    // ground/boat pass: rig y = the roof (the headset supplies the eye height). It used to place the HEAD at
    // max(1.4, eye): crouched or seated players arrived floating and dropped.
    const eye = Math.max(1.4, head.y - climb.lifted);
    shiftPlayer(
      ladder.position.x + 0.85 - head.x,
      GROUND_OLD ? roof + eye - head.y : roof - xrOffset.y,
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
    const zAt = climb.ladder.userData.zAt; // the cliff notch line drifts sideways
    if (lift > 0.004 && shiftPlayer(0, lift, zAt ? zAt(climb.feet + lift + 1.2) - zAt(climb.feet + 1.2) : 0)) {
      climb.handY = handPoint.y + lift;
      climb.feet += lift;
      climb.highest = Math.max(climb.highest, climb.feet);
    }
    if (climb.feet >= shaft.top - 0.25 && climb.lowest < shaft.top - 0.8) {
      snapShaft(climb.ladder.userData.topSpot, climb.ladder.userData.topStatus || 'On the cliff.');
    }
    return;
  }
  if (dy > 0.12) {
    const drop = Math.min(0.35, dy, Math.max(0, climb.feet - shaft.base));
    const zAt = climb.ladder.userData.zAt;
    if (drop > 0.004 && shiftPlayer(0, -drop, zAt ? zAt(climb.feet - drop + 1.2) - zAt(climb.feet + 1.2) : 0)) {
      climb.handY = handPoint.y - drop;
      climb.feet -= drop;
      climb.lowest = Math.min(climb.lowest, climb.feet);
    }
    if (climb.feet <= shaft.base + 0.45 && climb.highest > shaft.base + 1.2) {
      snapShaft(climb.ladder.userData.baseSpot, climb.ladder.userData.baseStatus || 'In the cave. Grab either end of the canoe.');
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
      // ground/boat pass: rig y = the spot's floor (was head-based with a 1.25 m minimum: crouching at the top-out
      // put you up to 25 cm above the ledge)
      // (the east crag top-out keeps its own placement: another pass owns it)
      const headBased = GROUND_OLD || climb?.ladder?.userData?.crag;
      shiftPlayer(spot.x - head.x, headBased ? spot.y + eye - head.y : spot.y - xrOffset.y, spot.z - head.z);
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
      placeAtSpot(spot, climb.ladder.userData.path ? new THREE.Vector3(spot.x + 2, spot.y + 1, spot.z - 3) : world.canoe.center,
        climb.ladder.userData.baseStatus || 'In the cave. Grab either end of the canoe, then press F.');
      return;
    }
    if (next >= rungs.length) {
      const spot = climb.ladder.userData.topSpot;
      placeAtSpot(spot, new THREE.Vector3(spot.x - 3, 0.7, spot.z), climb.ladder.userData.topStatus || 'On the cliff.');
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
    setStatus(TELEPORT ? 'Middle of the room. Press A for the other spot.' : 'Middle of the room.');
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
      setStatus(TELEPORT ? 'Middle of the room. Press A for the other spot.' : 'Middle of the room.');
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
  const bz = climb.ladder.userData.zAt ? climb.ladder.userData.zAt(y) : base.z;
  camera.position.set(base.x - 0.34, y + 0.18, bz + 0.48);
  camera.lookAt(base.x + 0.02, y, bz);
  gripHand.position.set(base.x + 0.02, y, bz);
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

// Overlook pass: the top-out. Holding the lip and pulling your head over it, any hold with your head 20 cm over it,
// or leaning over the top while still on the line hauls you onto the summit: a short eased lift (up, then
// forward), haptics, and the climb is fully released so the stick and snap turn work straight away.
const topout = createTopout({
  getClimb: () => climb,
  head: headSample,
  feet: () => xrOffset.y,
  shiftPlayer,
  leaveClimb() { leaveClimb(); fallVy = 0; },
  pulse: pulseBoth,
  setStatus,
  controllers: () => controllers,
  setActive(v) { mantle = v; },
});
function updateTopout(dt) { topout.update(dt); releaseStandingClimb(); }
// Standing on a floor with no hand on a hold ends the climb. It used to stay set (only a fall in updatePlayerFall
// cleared it) and pollMove needs !climb for the stick: walking over the top and letting go left you stuck.
// Kept out of updatePlayerFall on purpose (the ground/boat pass rewrites that function).
function releaseStandingClimb() {
  if (!climb || climb.hand || topout.active?.()) return;
  const head = headSample();
  const feetY = xrOffset.y;
  if (feetY - groundUnder(head.x, head.z, feetY) <= 0.12) leaveClimb();
}

// rowing pass: the ground model lives in walk.js (same rules), shared with stick locomotion and the reachability test
const groundModel = createGround({ world, roof, startCell: START_CELL, cliffX: CLIFF_X, waterY: WATER_Y });
const walker = createWalker({ world, ground: groundModel, startCell: START_CELL, cliffX: CLIFF_X, roof, waterY: WATER_Y });

function standHeight(x, z, feetY, floor) {
  return groundModel.standHeight(x, z, feetY, floor);
}

function groundUnder(x, z, feetY) {
  return groundModel.groundUnder(x, z, feetY);
}

function startWaterBite(x, z) {
  if (biteHold || world.biteActive()) return;
  if (swim?.takeFall(x, z)) { fallVy = 0; return; } // underwater pass: the sea is for swimming now (?swim=0: old bite)
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

function inBox(box, x, z) {
  return !!box && x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
}

function landShift(ground, feetY, head) {
  const cave = world.cave;
  const onShelf = inBox(world.notches?.shelf, head.x, head.z) || inBox(world.notches?.step, head.x, head.z);
  // rowing pass: shaft.floor equals the cave floor, so this used to fire on ANY step up onto the cave floor west of
  // x -1.5 (e.g. wading up out of the shallows toward the torch) and yank you back to the stand spot. Only from the shaft.
  const shaft = world.shaft;
  const inShaft = shaft && Math.abs(head.x - shaft.x) < 0.42 && Math.abs(head.z - shaft.z) < 0.5 && feetY > shaft.floor + 0.6;
  const fromShaft = !onShelf && inShaft && ground === shaft.floor && head.x < cave.x0 + 0.15;
  shiftPlayer(fromShaft ? cave.standX - head.x : 0, ground - feetY, fromShaft ? cave.standZ - head.z : 0);
}

let ridingLift = false;

function headSample() {
  if (renderer.xr.isPresenting && xrFrame) {
    // overlook pass: input events (squeeze/select) fire between frames, when the stored XRFrame is no longer active and
    // getViewerPose throws; fall back to the last head pose three copied into the camera
    try {
      const ref = renderer.xr.getReferenceSpace();
      const pose = ref && xrFrame.getViewerPose(ref);
      if (pose) return pose.transform.position;
    } catch { /* stale frame */ }
  }
  return camera.position;
}

function inLiftCar(head) {
  const lift = world.lift;
  const box = lift?.carBox;
  if (!box || !head) return false;
  const y = lift.floorY;
  return head.x > box.x0 - 0.08 && head.x < box.x1 + 0.08
    && head.z > box.z0 - 0.08 && head.z < box.z1 + 0.08
    && head.y > y + 0.25 && head.y < y + 2.15;
}

function updateLift(dt) {
  const lift = world.lift;
  if (!lift) return;
  const inside = renderer.xr.isPresenting && inLiftCar(headSample());
  const dy = lift.update(dt);
  if (inside && dy) {
    shiftPlayer(0, dy, 0);
    fallVy = 0;
  }
  ridingLift = inside && lift.moving;
  liftFeel.update(dt, ridingLift, renderer.xr.isPresenting);
}

function updatePlayerFall(dt) {
  if (watching || biteHold || aboard || swim?.active || !renderer.xr.isPresenting || !xrFrame) return;
  if (climb?.hand || boatGrip || glide.flying || mantle) {
    fallVy = 0;
    return;
  }
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return;
  const head = pose.transform.position;
  const feetY = xrOffset.y;
  const ground = groundUnder(head.x, head.z, feetY);
  // ground/boat pass: one rule (walk.js followGround): snap up, snap down within SNAP_DOWN (the old 12 cm band was
  // never closed, so you hovered after every small step down and all the way down ramps), else fall and land.
  // forest pass: letting go on a notch line is a controlled slide down the rock, not a free fall
  const sliding = world.notches && nearNotches(world.notches.routes, head.x, head.z);
  const step = followGround(feetY, ground, fallVy, dt, { slide: sliding ? -4.5 : null });
  if (step.feet !== ground && !step.rest) { // in the air
    if (climb) leaveClimb();
    fallVy = step.vy;
    shiftPlayer(0, step.moved, 0);
    return;
  }
  if (Math.abs(step.feet - feetY) > 1e-4) landShift(step.feet, feetY, head);
  fallVy = 0;
  if (sliding && step.landed > 2.5 && ground !== WATER_Y) {
    pulseBoth(0.6, 90);
    setStatus('You slide down the rock and land on your feet.');
  }
  const wading = world.shallowFloor?.(head.x, head.z) != null;
  // rowing pass: === WATER_Y only (the dry lift floors at -10.8 / -14.4 are below sea level)
  if (!wading && ground === WATER_Y && (step.landed > (GROUND_OLD ? 1.2 : 0) || feetY - ground > 0.01)) startWaterBite(head.x, head.z);
}

const raycaster = new THREE.Raycaster();
raycaster.layers.enable(1);
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
function applyShadowSize() {
  const light = world.keyLight;
  if (!light) return;
  const param = pageParams.get('shadow');
  const forced = param != null && param !== '' ? Number(param) : 0;
  const size = Number.isFinite(forced) && forced > 0 ? forced : (renderer.xr.isPresenting ? 1024 : 2048);
  if (light.shadow.mapSize.x === size) return;
  light.shadow.mapSize.set(size, size);
  if (light.shadow.map) {
    light.shadow.map.dispose();
    light.shadow.map = null;
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  xrBaseSpace = renderer.xr.getReferenceSpace();
  xrOffset.set(0, 0, 0);
  xrYaw = 0;
  cellPhase = 0;
  enableCellView();
  try { audio(); } catch { /* the roar starts once the headset session is running */ }
  sfx.start();
  gazeLock = null;
  hudEl.style.display = 'none';
  if (scalePanel) scalePanel.style.display = 'none';
  controls.enabled = false;
  applyShadowSize();
});
renderer.xr.addEventListener('sessionend', () => {
  xrBaseSpace = null;
  xrOffset.set(0, 0, 0);
  xrYaw = 0;
  gazeLock = null;
  leaveClimb();
  hudEl.style.display = watching ? '' : 'none';
  if (!watching && scalePanel) scalePanel.style.display = '';
  controls.enabled = true;
  applyShadowSize();
});

const controllerFactory = new XRControllerModelFactory();
const controllers = [0, 1].map((index) => setupController(index));
const liftFeel = createLiftFeel({ lift: world.lift, scene, camera, audio, pulse: pulseController, controllers });
world.lift?.on('depart', ({ from, to }) => {
  const down = world.lift.stops[to] < world.lift.stops[from];
  sfx.play(down ? 'creak' : 'latch', { gain: down ? 0.55 : 0.32, rate: down ? 0.55 : 1.1 });
});
world.lift?.on('arrive', () => sfx.play('hit_metal', { gain: 0.34, rate: 0.72 }));
world.lift?.on('door', ({ open }) => sfx.play(open ? 'door_open' : 'door_close', { gain: 0.5 }));

const croc = world.croc ?? null;
const crocDebug = pageParams.get('crocdebug') === '1';
const health = (croc || world.bear) && !watching ? createPlayerHealth({
  scene: world.scene,
  camera,
  onDown: playerDown,
  onHeartbeat: (low) => { playHeartbeat(low); pulseBoth(0.15, 40); },
}) : null;
const crocPlayerState = { x: 0, z: 0, feetY: 0, onBeach: false, inWater: false, aboard: false, canoe: null };
const crocHead = new THREE.Vector3();

function crocPlayer() {
  const p = crocPlayerState;
  const cave = world.cave;
  if (renderer.xr.isPresenting) {
    const ref = xrFrame && renderer.xr.getReferenceSpace();
    const pose = ref && xrFrame.getViewerPose(ref);
    if (!pose) return null;
    crocHead.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
    p.feetY = xrOffset.y;
  } else {
    crocHead.copy(camera.position);
    p.feetY = crocHead.y - 1.6;
  }
  p.x = crocHead.x;
  p.z = crocHead.z;
  const low = p.feetY < cave.floor + 0.6;
  const inZ = p.z >= cave.z0 && p.z <= cave.z1;
  const pad = cave.pad;
  const onPad = !!pad && p.x >= pad.x0 && p.x <= pad.x1 && p.z >= pad.z0 && p.z <= pad.z1;
  p.aboard = aboard && world.canoe.floating();
  p.canoe = p.aboard ? world.canoe.center : null;
  p.onBeach = !p.aboard && low && ((inZ && p.x >= cave.x0 - 0.05 && p.x <= cave.x1) || onPad);
  p.inWater = !p.aboard && !p.onBeach && low && inZ && p.x < cave.x0 && p.feetY > WATER_Y - 1.2;
  // a swimmer's feet hang deeper than a wader's: same croc rules near the shallows
  if (swim?.active && !p.aboard && inZ && p.x < cave.x0 && p.x > (cave.shallows?.x0 ?? -4.4) - 3) p.inWater = true;
  return p;
}

function hurtPlayer(amount, opts) {
  if (!health || (!renderer.xr.isPresenting && !crocDebug)) return 0;
  return health.damage(amount, opts);
}

function playerDown() {
  if (biteHold) return;
  teleportTo(1);
  croc?.reset();
}

if (croc) {
  croc.on('reveal', (e) => playCrocGrowl(e.position, 0.55));
  croc.on('return', () => playCrocGrowl(croc.root.position, 1));
  croc.on('windup', (e) => { playCrocHiss(e.position, croc._s.enraged ? 0.65 : 0.9); pulseBoth(0.25, 60); });
  croc.on('snap', (e) => playCrocSnap(e.position));
  croc.on('bite', (e) => { if (hurtPlayer(e.damage) > 0) { playBite(); pulseBoth(1, 200); } });
  croc.on('grabTick', (e) => { hurtPlayer(e.damage, { ignoreInvuln: true }); pulseBoth(0.8, 120); });
  croc.on('release', () => pulseBoth(0.3, 60));
  croc.on('ram', (e) => { hurtPlayer(e.damage); playCrocSnap(croc.root.position); pulseBoth(0.9, 160); world.canoe.knock?.(e.dir, 1); });
  croc.on('hurt', (e) => {
    playCrocHit(e.point, e.crit);
    const hand = world.gear.handHolding(e.source === 'hatchet' ? 'hatchet' : 'bow');
    if (e.source === 'hatchet') pulseController(hand, e.crit ? 1 : 0.8, e.crit ? 110 : 70);
    else pulseController(hand, e.crit ? 0.8 : 0.45, e.crit ? 80 : 45);
  });
  croc.on('retreat', () => playCrocGrowl(croc.root.position, 0.8, 0.8));
  croc.on('death', (e) => { playCrocDeath(e.position); pulseBoth(0.6, 300); });
  croc.on('reward', () => playClear());
}

// overlook boss: the raptor (src/raptor.js + src/raptorfight.js; calls from the woods when you top out of the east crag
// climb, then comes out) or, with ?legacy=bear, the bear (src/bear.js + src/bearfight.js)
const bossArgs = { health, sfx, audio, renderer, shiftPlayer, pulseBoth, pulseController, gear: world.gear, golf: world.golf, player: crocPlayer, head: crocHead, debug: crocDebug, tickHealth: !croc };
const bearFight = !world.bear || watching ? null
  : world.bear.kind === 'raptor' ? wireRaptor({ raptor: world.bear, hockey: world.hockey, ...bossArgs })
    : wireBear({ bear: world.bear, ...bossArgs });
// swim/boat/reef pass: ominous procedural score near the overlook woods / the bear fight, quiet bed in the cave (?music=0)
const music = !watching ? createMusic({ audio, renderer, camera, bear: world.bear, cave: world.cave }) : null;

// Underwater pass: visuals (src/underwater.js), swimming + breath/air + shark scare (src/swim.js), the scuba kit on
// the roof (src/scuba.js). ?underwater=0 removes all of it; ?swim=0 keeps the visuals and brings back the water bite.
const underwater = UNDERWATER ? createUnderwater(scene, { waterY: WATER_Y, reef: world.reef, water: world.water }) : null;
const scuba = UNDERWATER && SWIM && !watching ? createScuba({ scene, roof }) : null;
const swim = UNDERWATER && SWIM && !watching ? createSwim({
  renderer, scene, camera, world, underwater, scuba, sfx, audio, controllers, waterY: WATER_Y, assets,
  api: {
    shift: shiftPlayer,
    rig: () => xrOffset,
    yaw: () => xrYaw,
    aboard: () => aboard,
    climbing: () => !!climb,
    busy: () => biteHold || glide.flying,
    boardCanoe,
    leaveCanoe,
    respawn: () => teleportTo(1),
    pulse: pulseController,
    setStatus,
    heartbeat: (low) => { playHeartbeat(low); pulseBoth(0.15, 40); },
    groundUnder,
    walker,
  },
}) : null;
world.underwater = underwater;
world.swim = swim;
world.scuba = scuba;

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

// ?testhooks=1: the headless checks run right after each frame, still inside the XR callback (live XRFrame)
renderer.setAnimationLoop(pageParams.get('testhooks') === '1' ? (time, xr) => { frame(time, xr); testFrameHook?.(); } : frame);

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
    if (!controller.userData.squeezeDown) controller.userData.noRegrab = false;
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
    if (!controller.userData.triggerDown) controller.userData.noRegrab = false;
    onXrRelease(controller);
  });
  scene.add(controller);
  controller.userData.noArrow = true;

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.0014, 1, 8),
    new THREE.MeshBasicMaterial({ color: 0x3ef0c4 }),
  );
  beam.geometry.translate(0, 0.5, 0);
  beam.rotation.x = -Math.PI / 2;
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
  grip.userData.noArrow = true;
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
  if (!audioCtx) {
    audioCtx = new AudioContext();
    queueMicrotask(() => sfx.start());
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

let roar = null;

function ensureRoar() {
  if (roar) return roar;
  const ctx = audio();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const seconds = 3;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  let carry = 0;
  for (let i = 0; i < data.length; i += 1) {
    carry = carry * 0.97 + (Math.random() * 2 - 1) * 0.03;
    data[i] = Math.max(-1, Math.min(1, carry * 7));
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const growl = ctx.createBiquadFilter();
  growl.type = 'bandpass';
  growl.frequency.value = 180;
  growl.Q.value = 5;
  const growlGain = ctx.createGain();
  growlGain.gain.value = 0;
  noise.connect(growl);
  growl.connect(growlGain);
  growlGain.connect(master);
  const rasp = ctx.createBiquadFilter();
  rasp.type = 'bandpass';
  rasp.frequency.value = 480;
  rasp.Q.value = 1.6;
  const raspGain = ctx.createGain();
  raspGain.gain.value = 0;
  noise.connect(rasp);
  rasp.connect(raspGain);
  raspGain.connect(master);
  const chest = ctx.createOscillator();
  chest.type = 'sine';
  chest.frequency.value = 70;
  const chestGain = ctx.createGain();
  chestGain.gain.value = 0;
  chest.connect(chestGain);
  chestGain.connect(master);
  chest.start();
  noise.start();
  roar = { ctx, master, growl, rasp, growlGain, raspGain, chest, chestGain, snarl: 0, wait: 1.6, dur: 2.2 };
  return roar;
}

function listenerXZ() {
  if (renderer.xr.isPresenting && xrFrame) {
    const ref = renderer.xr.getReferenceSpace();
    const pose = ref && xrFrame.getViewerPose(ref);
    if (pose) return { x: pose.transform.position.x, z: pose.transform.position.z };
  }
  return { x: camera.position.x, z: camera.position.z };
}

function updateRoar(dt) {
  const ear = listenerXZ();
  const room = START_CELL.floor;
  const inside = ear.x >= room.x0 && ear.x <= room.x1 && ear.z >= room.z0 && ear.z <= room.z1;
  if (!inside && !roar) return;
  const voice = ensureRoar();
  if (voice.ctx.state === 'suspended') voice.ctx.resume();
  const blend = 1 - Math.exp(-dt / 0.35);
  voice.master.gain.value += ((inside ? 1 : 0) - voice.master.gain.value) * blend;
  if (!inside) {
    voice.snarl = 0;
    voice.wait = Math.max(voice.wait, 1.4);
  } else if (voice.snarl <= 0) {
    voice.wait -= dt;
    if (voice.wait <= 0) {
      voice.snarl = 0.001;
      voice.dur = 1.7 + Math.random() * 1.3;
      voice.wait = 4 + Math.random() * 5;
    }
  }
  let env = 0;
  if (voice.snarl > 0) {
    voice.snarl += dt;
    const u = Math.min(1, voice.snarl / voice.dur);
    const rise = 0.42;
    env = u < rise ? u / rise : Math.max(0, 1 - (u - rise) / (1 - rise));
    env *= env;
    const rattle = 0.55 + 0.45 * Math.sin(voice.snarl * 120);
    env *= 0.72 + 0.28 * rattle;
    voice.growl.frequency.value = 240 - u * 130;
    voice.rasp.frequency.value = 620 - u * 260;
    voice.chest.frequency.value = 92 - u * 40;
    if (u >= 1) voice.snarl = 0;
  }
  const glide = 1 - Math.exp(-dt / 0.06);
  voice.growlGain.gain.value += (env * 0.32 - voice.growlGain.gain.value) * glide;
  voice.raspGain.gain.value += (env * 0.1 - voice.raspGain.gain.value) * glide;
  voice.chestGain.gain.value += (env * 0.08 - voice.chestGain.gain.value) * glide;
}

function envGain(ctx, start, peak, attack, release) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
  gain.connect(ctx.destination);
  return gain;
}

function playPaddleSynth(strength = 0.6) { // fallback paddle catch: short low-passed noise 'glug'
  const ctx = audio();
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.22);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400, t);
  lp.frequency.exponentialRampToValueAtTime(380, t + 0.2);
  src.connect(lp);
  lp.connect(envGain(ctx, t, 0.08 + 0.18 * strength, 0.01, 0.2));
  src.start(t);
  return true;
}

function playChop(broken) {
  const ctx = audio();
  const t = ctx.currentTime;
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * (broken ? 0.34 : 0.12)), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    const fade = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * fade * fade;
  }
  const burst = ctx.createBufferSource();
  burst.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(broken ? 1800 : 2400, t);
  filter.frequency.exponentialRampToValueAtTime(broken ? 280 : 700, t + (broken ? 0.22 : 0.08));
  filter.Q.value = 0.7;
  const noiseGain = envGain(ctx, t, broken ? 0.28 : 0.12, 0.004, broken ? 0.32 : 0.1);
  burst.connect(filter);
  filter.connect(noiseGain);
  burst.start(t);
  burst.stop(t + (broken ? 0.34 : 0.12));
  if (!broken) return;
  const crack = ctx.createOscillator();
  crack.type = 'triangle';
  crack.frequency.setValueAtTime(520, t);
  crack.frequency.exponentialRampToValueAtTime(90, t + 0.16);
  crack.connect(envGain(ctx, t, 0.08, 0.005, 0.16));
  crack.start(t);
  crack.stop(t + 0.18);
}

function playLoose() {
  const ctx = audio();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(620, t);
  osc.frequency.exponentialRampToValueAtTime(140, t + 0.09);
  osc.connect(envGain(ctx, t, 0.09, 0.003, 0.1));
  osc.start(t);
  osc.stop(t + 0.11);
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const whisk = ctx.createBufferSource();
  whisk.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 900;
  const whiskGain = envGain(ctx, t, 0.08, 0.002, 0.05);
  whisk.connect(filter);
  filter.connect(whiskGain);
  whisk.start(t);
  whisk.stop(t + 0.06);
}

function playDip(color, same) {
  const ctx = audio();
  const t = ctx.currentTime;
  const vol = same ? 0.45 : 1;
  const blob = ctx.createOscillator();
  blob.type = 'sine';
  blob.frequency.setValueAtTime(380, t);
  blob.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  blob.connect(envGain(ctx, t, 0.09 * vol, 0.004, 0.09));
  blob.start(t);
  blob.stop(t + 0.12);
  const bub = ctx.createOscillator();
  bub.type = 'sine';
  bub.frequency.setValueAtTime(720, t + 0.06);
  bub.frequency.exponentialRampToValueAtTime(330, t + 0.11);
  bub.connect(envGain(ctx, t + 0.06, 0.05 * vol, 0.003, 0.06));
  bub.start(t + 0.06);
  bub.stop(t + 0.14);
  const len = Math.floor(ctx.sampleRate * 0.16);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const samples = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    const fade = 1 - i / len;
    samples[i] = (Math.random() * 2 - 1) * fade * fade;
  }
  const slosh = ctx.createBufferSource();
  slosh.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(1300, t);
  bp.frequency.exponentialRampToValueAtTime(320, t + 0.14);
  slosh.connect(bp);
  bp.connect(envGain(ctx, t, 0.07 * vol, 0.006, 0.14));
  slosh.start(t);
  slosh.stop(t + 0.16);
}

const sprayVoices = new Map();
let sprayNoise = null;

function sprayNoiseBuffer(ctx) {
  if (sprayNoise) return sprayNoise;
  const len = Math.floor(ctx.sampleRate * 2);
  sprayNoise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = sprayNoise.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  return sprayNoise;
}

function playSprayStart(key, flow) {
  playSprayStop(key);
  const ctx = audio();
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = sprayNoiseBuffer(ctx);
  source.loop = true;
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 3200;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 6500;
  band.Q.value = 0.7;
  const gain = ctx.createGain();
  const level = 0.05 + 0.05 * flow;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(level * 1.6, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), t + 0.04);
  source.connect(highpass);
  highpass.connect(band);
  band.connect(gain);
  gain.connect(ctx.destination);
  source.start(t);
  sprayVoices.set(key, { source, gain, band });
}

function setSprayLevel(key, flow, cone) {
  const voice = sprayVoices.get(key);
  if (!voice) return;
  const ctx = audio();
  const t = ctx.currentTime;
  const level = Math.max(0.0001, 0.05 + 0.05 * flow);
  voice.gain.gain.setTargetAtTime(level, t, 0.02);
  const span = (cone - 0.035) / (0.35 - 0.035);
  voice.band.frequency.setTargetAtTime(8000 + (4500 - 8000) * THREE.MathUtils.clamp(span, 0, 1), t, 0.04);
}

function playSprayStop(key) {
  const voice = sprayVoices.get(key);
  if (!voice) return;
  const ctx = audio();
  const t = ctx.currentTime;
  const current = Math.max(0.0001, voice.gain.gain.value || 0.0001);
  voice.gain.gain.cancelScheduledValues(t);
  voice.gain.gain.setValueAtTime(current, t);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  voice.source.stop(t + 0.08);
  sprayVoices.delete(key);
}

function playRattle() {
  const ctx = audio();
  const t = ctx.currentTime;
  for (let i = 0; i < 3; i += 1) {
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let s = 0; s < len; s += 1) data[s] = (Math.random() * 2 - 1) * (1 - s / len);
    const source = ctx.createBufferSource();
    source.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2500;
    band.Q.value = 2;
    source.connect(band);
    band.connect(envGain(ctx, t + i * 0.06, 0.12, 0.002, 0.04));
    source.start(t + i * 0.06);
    source.stop(t + i * 0.06 + 0.04);
  }
}

function playStrike() {
  const ctx = audio();
  const t = ctx.currentTime;
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.09), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    const fade = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * fade * fade;
  }
  const burst = ctx.createBufferSource();
  burst.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1600, t);
  filter.frequency.exponentialRampToValueAtTime(240, t + 0.07);
  const noiseGain = envGain(ctx, t, 0.2, 0.002, 0.08);
  burst.connect(filter);
  filter.connect(noiseGain);
  burst.start(t);
  burst.stop(t + 0.09);
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(160, t);
  thump.frequency.exponentialRampToValueAtTime(55, t + 0.06);
  thump.connect(envGain(ctx, t, 0.14, 0.002, 0.07));
  thump.start(t);
  thump.stop(t + 0.08);
}

function playPickup() {
  const ctx = audio();
  const t = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
    const osc = ctx.createOscillator();
    osc.type = index === 3 ? 'triangle' : 'sine';
    osc.frequency.value = freq;
    const start = t + index * 0.05;
    osc.connect(envGain(ctx, start, 0.055, 0.012, 0.28));
    osc.start(start);
    osc.stop(start + 0.32);
  });
}

const crocTmp = new THREE.Vector3();
function crocOut(ctx, position) {
  const out = ctx.createGain();
  const pan = ctx.createStereoPanner();
  let p = 0;
  let g = 1;
  if (position) {
    crocTmp.copy(position).applyMatrix4(camera.matrixWorldInverse);
    const d = crocTmp.length();
    p = THREE.MathUtils.clamp(crocTmp.x / Math.max(0.5, d), -1, 1);
    g = 1 / (1 + Math.max(0, d - 1) * 0.35);
  }
  pan.pan.value = p;
  out.gain.value = g;
  out.connect(pan);
  pan.connect(ctx.destination);
  return out;
}
function crocEnv(ctx, out, start, peak, attack, release) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
  gain.connect(out);
  return gain;
}
function crocNoise(ctx, secs) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}
function playCrocGrowl(position, level = 1, secs = 1.1) {
  const ctx = audio(); const t = ctx.currentTime; const out = crocOut(ctx, position);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
  const env = crocEnv(ctx, out, t, 0.32 * level, 0.12, secs);
  const trem = ctx.createGain(); trem.gain.value = 0.6;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const depth = ctx.createGain(); depth.gain.value = 0.4;
  lfo.connect(depth); depth.connect(trem.gain);
  [48, 51.5].forEach((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.85, t + secs); o.connect(lp); o.start(t); o.stop(t + secs + 0.15); });
  lp.connect(trem); trem.connect(env); lfo.start(t); lfo.stop(t + secs + 0.15);
}
function playCrocHiss(position, secs = 0.9) {
  const ctx = audio(); const t = ctx.currentTime; const out = crocOut(ctx, position);
  const src = crocNoise(ctx, secs + 0.1);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4500; bp.Q.value = 0.8;
  src.connect(hp); hp.connect(bp); bp.connect(crocEnv(ctx, out, t, 0.22, secs * 0.85, 0.12));
  src.start(t); src.stop(t + secs + 0.1);
  playCrocGrowl(position, 0.6, secs);
}
function playCrocSnap(position) {
  const ctx = audio(); const t = ctx.currentTime; const out = crocOut(ctx, position);
  const click = crocNoise(ctx, 0.05); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 1.2;
  click.connect(bp); bp.connect(crocEnv(ctx, out, t, 0.5, 0.002, 0.05)); click.start(t); click.stop(t + 0.05);
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
  o.connect(crocEnv(ctx, out, t, 0.18, 0.004, 0.08)); o.start(t); o.stop(t + 0.1);
  const slosh = crocNoise(ctx, 0.4); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
  slosh.connect(lp); lp.connect(crocEnv(ctx, out, t + 0.02, 0.25, 0.03, 0.33)); slosh.start(t + 0.02); slosh.stop(t + 0.42);
}
function playCrocHit(position, crit) {
  const ctx = audio(); const t = ctx.currentTime; const out = crocOut(ctx, position);
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
  o.connect(crocEnv(ctx, out, t, 0.35, 0.004, 0.15)); o.start(t); o.stop(t + 0.18);
  const n = crocNoise(ctx, 0.12); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
  n.connect(lp); lp.connect(crocEnv(ctx, out, t, 0.2, 0.003, 0.1)); n.start(t); n.stop(t + 0.12);
  if (crit) { const c = ctx.createOscillator(); c.type = 'triangle'; c.frequency.setValueAtTime(900, t); c.frequency.exponentialRampToValueAtTime(400, t + 0.06); c.connect(crocEnv(ctx, out, t, 0.16, 0.002, 0.06)); c.start(t); c.stop(t + 0.08); }
}
function playCrocDeath(position) {
  playCrocGrowl(position, 1.1, 1.6);
  const ctx = audio(); const t = ctx.currentTime; const out = crocOut(ctx, position);
  const n = crocNoise(ctx, 0.9); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.8);
  n.connect(lp); lp.connect(crocEnv(ctx, out, t + 0.25, 0.3, 0.05, 0.8)); n.start(t + 0.25); n.stop(t + 1.15);
}
function playHeartbeat(level = 1) {
  const ctx = audio(); const t = ctx.currentTime;
  [0, 0.16].forEach((dt, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(62, t + dt); o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.09);
    o.connect(envGain(ctx, t + dt, (i ? 0.16 : 0.22) * (0.6 + 0.4 * level), 0.006, 0.09)); o.start(t + dt); o.stop(t + dt + 0.12); });
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

const boatLocal = new THREE.Vector3();

function handNearBoat(points) {
  const boat = world.canoe.group;
  for (const point of points) {
    boatLocal.copy(point);
    boat.worldToLocal(boatLocal);
    const dx = Math.max(Math.abs(boatLocal.x) - 0.58, 0);
    const dy = Math.max(-0.02 - boatLocal.y, boatLocal.y - 0.5, 0);
    const dz = Math.max(Math.abs(boatLocal.z) - 1.92, 0);
    if (Math.hypot(dx, dy, dz) < 0.18) return true;
  }
  return false;
}

function gripBoatEnd(controller) {
  if (!legacy('canoe') && world.canoe.grab) {
    const heldRing = world.canoe.grab(controller, handPoints(controller));
    if (heldRing) boatGrip = { controller };
    return heldRing;
  }
  const points = handPoints(controller);
  const near = closestBoat(world.canoe.ends, points, 0.42);
  if (!near && !handNearBoat(points)) return false;
  boatGrip = { controller };
  oarGrip = null;
  pulseController(controller);
  setStatus('Holding the canoe. Press the trigger to shove it.');
  return true;
}

function gripOar(controller) {
  if (!legacy('row') && world.canoe.tryOar) return world.canoe.tryOar(controller, handPoints(controller));
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
  if (aboard) return;
  world.canoe.releaseAll?.(); // drop the bow/stern rope and anything left over from last time
  const seat = world.canoe.seatPoint;
  if (renderer.xr.isPresenting && xrFrame) {
    const ref = renderer.xr.getReferenceSpace();
    const pose = ref && xrFrame.getViewerPose(ref);
    if (pose) {
      const head = pose.transform.position;
      seatEyeShift(head.y - xrOffset.y);
      shiftPlayer(seat.x - head.x, seat.y + SEAT_EYE - head.y, seat.z - head.z);
      // rowing pass: sit facing the bow (oars and paddles), so pushing the handles forward reads as forward
      if (world.canoe.oarMode || world.canoe.paddleMode) {
        const o = pose.transform.orientation;
        spaceQuat.set(o.x, o.y, o.z, o.w);
        const look = new THREE.Vector3(0, 0, -1).applyQuaternion(spaceQuat);
        if (look.x * look.x + look.z * look.z > 1e-6) {
          let delta = world.canoe.group.rotation.y - Math.atan2(-look.x, -look.z);
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          if (Math.abs(delta) > 0.02) yawAround(delta, seat.x, seat.z);
        }
      }
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
  lastBoatYaw = world.canoe.group.rotation.y; // was stale: the first synced frame yawed you by the boat's turn since last time
  aboard = true;
  boatGrip = null;
  fallVy = 0;
  stickExit = 0;
  if (climb) leaveClimb();
  const out = MOVE ? ' Push the left stick to step out.' : ' Stand up and step over the side to get out.';
  setStatus(world.canoe.paddleMode
    ? `In the canoe. Squeeze a grip to take a paddle in each hand. Dip the blade and pull back to paddle.${out}`
    : world.canoe.oarMode
      ? `In the canoe. Squeeze at the end of each oar handle. Push the handles forward to row; press them down to lift the blades back.${out}`
      : 'In the canoe. Grip an oar and pull back to row.');
}

// Rowing pass: one way out of the canoe, whatever the reason (teleport, respawn, stepping out, stick exit).
// Leaving used to keep `aboard` set (rig still dragged by the boat, no falling, every squeeze took a paddle, so the
// torch could not be picked up), and kept the oars, the rope and the hidden controller models attached.
function leaveCanoe() {
  world.canoe.releaseAll?.();
  const was = aboard;
  aboard = false;
  boatGrip = null;
  oarGrip = null;
  fallVy = 0;
  stickExit = 0;
  if (was) exitCooldown = 1;
}

function nearSeat() {
  const head = headSample();
  const seat = world.canoe.seatPoint;
  return Math.hypot(head.x - seat.x, head.z - seat.z) < 1.1 && Math.abs(head.y - seat.y) < 1.8;
}

const hullLocal = new THREE.Vector3();
function inHull(x, y, z, halfX, halfZ) {
  hullLocal.set(x, y, z);
  world.canoe.group.worldToLocal(hullLocal);
  return Math.abs(hullLocal.x) < halfX && Math.abs(hullLocal.z) < halfZ;
}

// Stepping out: land on the shelf, the cave pad or the shallows (up 0.8 m, down 1.2 m from the seat).
const EXIT_STEP = { up: 0.8, down: 1.2 };
function stepOutTo(x, z) {
  const seat = world.canoe.seatPoint;
  const spot = walker.walkable(x, z, seat.y, EXIT_STEP);
  if (!spot.ok) return false;
  const head = headSample();
  leaveCanoe();
  if (renderer.xr.isPresenting) shiftPlayer(x - head.x, spot.ground - xrOffset.y, z - head.z);
  setStatus('Out of the canoe.');
  return true;
}

function checkStepOut() {
  if (!aboard || !renderer.xr.isPresenting || !xrFrame) return;
  const head = headSample();
  if (inHull(head.x, head.y, head.z, 0.62, 1.85)) return;
  const seat = world.canoe.seatPoint;
  const spot = walker.walkable(head.x, head.z, seat.y, EXIT_STEP);
  if (!spot.ok) return; // leaning out over open water: you stay in the boat
  leaveCanoe();
  shiftPlayer(0, spot.ground - xrOffset.y, 0);
  setStatus('Out of the canoe.');
}

// Held stick (> 0.7 for 0.35 s): look for dry footing 0.7..2.4 m away in that direction (+-60 degrees).
function tryStickExit(dirX, dirZ) {
  const seat = world.canoe.seatPoint;
  const base = Math.atan2(dirX, dirZ);
  for (const dist of [0.7, 0.95, 1.2, 1.5, 1.9, 2.4]) {
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
      const a = base + off;
      if (stepOutTo(seat.x + Math.sin(a) * dist, seat.z + Math.cos(a) * dist)) return true;
    }
  }
  return false;
}

// Ground/boat pass: seated eye height in the canoe follows your real posture. Boarding puts the eyes SEAT_EYE above
// the seat for whatever height you board at; sitting down (or standing up) for real afterwards used to move the eyes
// 0.4-0.5 m (into the gunwale). Now a sustained real-height change (> 0.3 m for 1.5 s, no oar in hand, so a stroke's
// lean never moves the hands) re-seats you smoothly. ?ground=old turns it off.
const SEAT_EYE = 0.72;
const seatPosture = { anchor: 0, slow: 0, held: 0, pending: 0 };
function seatEyeShift(realH) { // realH: headset height above your real floor (local-floor) when you sat down
  seatPosture.anchor = realH;
  seatPosture.slow = realH;
  seatPosture.held = 0;
  seatPosture.pending = 0;
}
function updateSeatPosture(dt) {
  if (GROUND_OLD || !aboard || !renderer.xr.isPresenting || !xrFrame) return;
  const head = headSample();
  const realH = head.y - xrOffset.y;
  seatPosture.slow += (realH - seatPosture.slow) * (1 - Math.exp(-dt / 0.6));
  const oarInHand = world.canoe.anyOar?.() || world.canoe.longOars?.some((o) => o.hand) || world.canoe.paddles?.some((pd) => pd.hand);
  if (!seatPosture.pending && !oarInHand && Math.abs(seatPosture.slow - seatPosture.anchor) > 0.3) {
    seatPosture.held += dt;
    if (seatPosture.held > 1.5) {
      seatPosture.pending = seatPosture.anchor - seatPosture.slow; // rig moves by this so the eyes return to the seat height
      seatPosture.anchor = seatPosture.slow;
      seatPosture.held = 0;
    }
  } else if (!seatPosture.pending) seatPosture.held = 0;
  if (seatPosture.pending) {
    const step = Math.sign(seatPosture.pending) * Math.min(Math.abs(seatPosture.pending), 0.9 * dt);
    if (shiftPlayer(0, step, 0)) seatPosture.pending -= step;
    if (Math.abs(seatPosture.pending) < 1e-3) seatPosture.pending = 0;
  }
}

const lastSeat = new THREE.Vector3();
let lastBoatYaw = 0;

function syncAboard() {
  if (!aboard) return;
  const seat = world.canoe.seatPoint;
  const dx = seat.x - lastSeat.x;
  const dy = seat.y - lastSeat.y;
  const dz = seat.z - lastSeat.z;
  const yaw = world.canoe.group.rotation.y;
  const deltaYaw = yaw - lastBoatYaw;
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.0001) {
    if (renderer.xr.isPresenting) shiftPlayer(dx, dy, dz);
    else {
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
      controls.target.x += dx;
      controls.target.y += dy;
      controls.target.z += dz;
    }
  }
  if (!legacy('row') && Math.abs(deltaYaw) > 0.0001) {
    if (renderer.xr.isPresenting) yawAround(deltaYaw, seat.x, seat.z);
    else {
      spinAbout(camera.position, seat, deltaYaw);
      spinAbout(controls.target, seat, deltaYaw);
    }
  }
  lastSeat.copy(seat);
  lastBoatYaw = yaw;
}

function spinAbout(point, pivot, delta) {
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const dx = point.x - pivot.x;
  const dz = point.z - pivot.z;
  point.x = pivot.x + cos * dx - sin * dz;
  point.z = pivot.z + sin * dx + cos * dz;
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
const canoeHoverPoints = [];

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
  if (!legacy('row') && aboard && (event.key === 'z' || event.key === 'Z') && world.canoe.stroke?.('port')) return;
  if (!legacy('row') && aboard && (event.key === 'c' || event.key === 'C') && world.canoe.stroke?.('starboard')) return;
  if (event.key === 'f' || event.key === 'F') {
    if (world.gear.useDesktop()) return;
    if (aboard) {
      if (!world.canoe.floating()) {
        const result = world.canoe.shove();
        if (result) {
          setStatus(result === 'water'
            ? 'The canoe is floating into the shallows.'
            : 'Shoved. Press F again.');
        }
        return;
      }
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
  const aimed = hitFromController(controller);
  if (world.gear.pocketItem(aimed?.owner) && held && heldFrom === controller && held.userData.type === 'prop') {
    dropProp();
  }
  if (held && heldFrom === controller) return;
  if (world.gear.equipPocket(aimed?.owner, controller)) return;
  if (world.gear.use(controller)) return;
  if (boatGrip) {
    shoveBoat();
    return;
  }
  if (aboard) {
    if (!world.canoe.floating()) {
      shoveBoat();
      return;
    }
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
  if (hit?.owner?.userData.type === 'lift') {
    if (hit.owner.userData.role === 'open') world.lift.openDoor();
    else world.lift.go(inLiftCar(headSample()));
    return;
  }
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

function gliderHand(controller) {
  return world.glider.grips.some((grip) => grip.userData.heldBy === controller);
}

function gripGlider(controller) {
  if (aboard || climb?.hand || biteHold || glide.flying) return false;
  if (gliderHand(controller)) return true;
  const points = handPoints(controller);
  let best = null;
  let bestDist = 0.2;
  for (const grip of world.glider.grips) {
    if (grip.userData.heldBy) continue;
    grip.getWorldPosition(worldPoint);
    for (const point of points) {
      const dist = worldPoint.distanceTo(point);
      if (dist < bestDist) {
        bestDist = dist;
        best = grip;
      }
    }
  }
  if (!best) return false;
  best.userData.heldBy = controller;
  pulseController(controller, 0.45, 28);
  const both = world.glider.grips.every((grip) => grip.userData.heldBy);
  if (both) launchGlider();
  else setStatus('Both hands on the bar.');
  return true;
}

function gliderFrame() {
  let left = null;
  let right = null;
  for (const grip of world.glider.grips) {
    if (grip.userData.side < 0) left = grip.userData.heldBy;
    else right = grip.userData.heldBy;
  }
  if (!left || !right || !renderer.xr.isPresenting || !xrFrame) return null;
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return null;
  left.getWorldPosition(handPoint);
  const leftAt = handPoint.clone();
  right.getWorldPosition(worldPoint);
  return barFrame(leftAt, worldPoint, pose.transform.position, glide.nose);
}

function launchGlider() {
  const frame = gliderFrame();
  glide.flying = true;
  glide.loose = false;
  glide.airborne = false;
  if (frame) glide.nose.copy(frame.nose);
  const flat = Math.hypot(glide.nose.x, glide.nose.z) || 1;
  glide.v.set((glide.nose.x / flat) * 4.5, 0, (glide.nose.z / flat) * 4.5);
  setStatus('In the air.');
  pulseBoth(0.55, 45);
}

function settleGlider(x, ground, z) {
  const wing = world.glider.group;
  wing.position.set(x, ground + 1.12, z);
  wing.rotation.set(0, Math.atan2(-glide.nose.z, glide.nose.x), 0);
}

function releaseGlider(controller) {
  if (!gliderHand(controller)) return false;
  const wasFlying = glide.flying;
  for (const grip of world.glider.grips) grip.userData.heldBy = null;
  glide.flying = false;
  if (wasFlying && glide.airborne) {
    glide.loose = true;
    fallVy = Math.min(glide.v.y, -0.5);
    setStatus('You let go.');
  } else {
    glide.v.set(0, 0, 0);
    if (!wasFlying) setStatus('');
  }
  return true;
}

function updateGlider(dt) {
  const wing = world.glider;
  if (glide.flying) {
    const frame = gliderFrame();
    if (!frame) return;
    glide.nose.copy(frame.nose);
    glide.up.copy(frame.wingUp);
    stepGlide(glide.v, glide.nose, glide.up, dt);
    const ref = renderer.xr.getReferenceSpace();
    const pose = ref && xrFrame.getViewerPose(ref);
    const head = pose?.transform.position;
    if (!head) return;
    const feet = xrOffset.y;
    const ground = groundUnder(head.x, head.z, feet);
    if (feet - ground > 1) glide.airborne = true;
    const nextFeet = feet + glide.v.y * dt;
    if (!glide.airborne && glide.v.y < 0 && nextFeet < ground + 0.04) {
      glide.v.y = 0;
      shiftPlayer(glide.v.x * dt, Math.max(0, ground + 0.02 - feet), glide.v.z * dt);
      const placed = gliderFrame();
      if (placed) {
        wing.group.position.copy(placed.mid);
        wing.aim(wing.group.quaternion, placed.nose, placed.wingUp);
      }
      return;
    }
    if (glide.airborne && glide.v.y < 0 && nextFeet <= ground + 0.08) {
      for (const grip of wing.grips) grip.userData.heldBy = null;
      glide.flying = false;
      if (ground === WATER_Y) {
        glide.loose = true;
        startWaterBite(head.x, head.z);
        return;
      }
      shiftPlayer(glide.v.x * dt, ground - feet, glide.v.z * dt);
      glide.v.set(0, 0, 0);
      settleGlider(head.x, ground, head.z);
      setStatus('Down.');
      return;
    }
    shiftPlayer(glide.v.x * dt, glide.v.y * dt, glide.v.z * dt);
    const placed = gliderFrame();
    if (placed) {
      wing.group.position.copy(placed.mid);
      wing.aim(wing.group.quaternion, placed.nose, placed.wingUp);
      glide.nose.copy(placed.nose);
    }
    return;
  }
  if (!glide.loose) return;
  glide.v.y = Math.max(-8, glide.v.y - 6 * dt);
  glide.v.x *= Math.max(0, 1 - dt * 0.35);
  glide.v.z *= Math.max(0, 1 - dt * 0.35);
  wing.group.position.addScaledVector(glide.v, dt);
  const ground = groundUnder(wing.group.position.x, wing.group.position.z, wing.group.position.y);
  if (wing.group.position.y <= ground + 1.12) {
    settleGlider(wing.group.position.x, ground, wing.group.position.z);
    glide.v.set(0, 0, 0);
    glide.loose = false;
  }
}

function onXrSqueeze(controller) {
  if (watching) return;
  if (swim?.onSqueeze(controller)) return; // scuba kit pickup, canoe hull from the water, strokes
  if (held && heldFrom === controller) return;
  if (world.gear.tryDraw(controller)) return;
  const aimed = hitFromController(controller);
  if (world.gear.dropPocket(aimed?.owner, controller)) return;
  if (world.gear.isHolding(controller)) {
    world.gear.stowHand(controller);
    return;
  }
  if (!legacy('row') && !legacy('oarreach') && (aboard || nearSeat()) && world.canoe.nearOar?.(handPoints(controller))) {
    if (!aboard) boardCanoe();
    if (gripOar(controller)) return;
  }
  if (gripClub(controller)) return;
  if (world.gear.tryGrip(controller, handPoints(controller), aimed?.owner)) return;
  if (held) return;
  if (aboard) {
    gripOar(controller);
    return;
  }
  if (gripBoatEnd(controller)) return;
  if (gripGlider(controller)) return;
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

// Second hand on a carried club or hockey stick (golf grip pass: the stick takes a second hand too, in its own
// zone further down the shaft; an item without `offHand` in its userData has no two-hand hold).
function gripClub(controller) {
  for (const club of [world.golf?.club, world.hockey?.stick]) {
    if (!club?.userData.carried || club.parent === controller || club.userData.offHand === undefined) continue;
    if (club.userData.offHand === controller) return true;
    if (club.userData.offHand) continue;
    club.updateWorldMatrix(true, true);
    const [top, bottom] = club.userData.twoHandZone || [0.01, -0.3];
    const butt = new THREE.Vector3(0, top, 0);
    const low = new THREE.Vector3(0, bottom, 0);
    club.localToWorld(butt);
    club.localToWorld(low);
    const span = low.clone().sub(butt);
    const spanLen = span.lengthSq() || 1;
    let near = false;
    for (const point of handPoints(controller)) {
      const t = THREE.MathUtils.clamp(point.clone().sub(butt).dot(span) / spanLen, 0, 1);
      if (butt.clone().addScaledVector(span, t).distanceTo(point) < 0.2) near = true;
    }
    if (!near) continue;
    club.userData.offHand = controller;
    pulseController(controller, 0.4, 24);
    return true;
  }
  return false;
}

function onXrRelease(controller) {
  for (const club of [world.golf?.club, world.hockey?.stick]) {
    if (club?.userData.offHand === controller) {
      club.userData.offHand = null;
      return;
    }
  }
  if (releaseGlider(controller)) return;
  if (world.gear.releaseDraw(controller)) return;
  world.canoe.release?.(controller);
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

// Rowing pass: smooth left-stick locomotion (head-relative) and right-stick snap/smooth turn.
// A hand holding a spray can (stick = cone/reach) or a brick (stick = rotate) is skipped, and so is a hand on an oar.
let snapLatch = false;
function canoeHolds(controller) {
  const c = world.canoe;
  return !!(c.longOars?.some((o) => o.hand === controller) || c.paddles?.some((pd) => pd.hand === controller)
    || c.oarGrips?.starboard === controller || c.oarGrips?.port === controller);
}

function pollMove(dt) {
  exitCooldown = Math.max(0, exitCooldown - dt);
  if (!renderer.xr.isPresenting || !xrFrame || watching || biteHold || mantle) {
    liftFeel.setComfort?.(0);
    return;
  }
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return;
  const head = pose.transform.position;
  let comfort = 0;
  let moveHand = null;
  let turnHand = null;
  const sprayHand = world.gear.handHolding?.('spray');
  for (const controller of controllers) {
    const source = controller.userData.inputSource;
    if (!source?.gamepad || controller === sprayHand || heldFrom === controller || canoeHolds(controller)) continue;
    if (source.handedness === 'left') moveHand = controller;
    else if (source.handedness === 'right') turnHand = controller;
  }
  // turn
  if (TURN !== 'off' && turnHand && !climb?.hand) {
    const x = turnHand.userData.inputSource.gamepad.axes?.[2] ?? 0;
    if (TURN === 'snap') {
      if (Math.abs(x) > 0.7 && !snapLatch) {
        snapLatch = true;
        yawAround(-Math.sign(x) * THREE.MathUtils.degToRad(SNAP_DEG), head.x, head.z);
      } else if (Math.abs(x) < 0.3) snapLatch = false;
    } else if (Math.abs(x) > 0.2) {
      const k = (Math.abs(x) - 0.2) / 0.8;
      yawAround(-Math.sign(x) * k * THREE.MathUtils.degToRad(SMOOTH_TURN_DEG) * dt, head.x, head.z);
      comfort = Math.max(comfort, 0.3 * k);
    }
  }
  if (swim?.active) { liftFeel.setComfort?.(Math.max(comfort, swim.comfort)); return; } // swim.js owns the left stick in the sea
  // move
  if (MOVE && moveHand) {
    const pad = moveHand.userData.inputSource.gamepad;
    const stick = stickToWorld(pose.transform.orientation, pad.axes?.[2] ?? 0, pad.axes?.[3] ?? 0);
    if (aboard) {
      if (stick.mag > 0.7) {
        stickExit += dt;
        if (stickExit >= 0.35) {
          stickExit = -1; // one try per push
          if (!tryStickExit(stick.x, stick.z)) setStatus('No footing that way. Row closer to the shelf or the shallows.');
        }
      } else if (stick.mag < 0.3) stickExit = 0;
    } else if (stick.mag > 0 && !climb && !glide.flying && !(ridingLift && world.lift?.moving)) {
      const feet = xrOffset.y;
      const dx = stick.x * MOVE_SPEED * dt;
      const dz = stick.z * MOVE_SPEED * dt;
      const res = walker.move(head.x, head.z, feet, dx, dz);
      if (res.x !== head.x || res.z !== head.z) shiftPlayer(res.x - head.x, 0, res.z - head.z);
      // walking into the floating canoe gets you in
      const seat = world.canoe.seatPoint;
      if (exitCooldown <= 0 && Math.abs(feet - seat.y) < 1.2 && inHull(head.x + dx * 6, seat.y, head.z + dz * 6, 0.5, 1.5)) boardCanoe();
      comfort = Math.max(comfort, 0.25 + 0.35 * stick.mag);
    }
  }
  // stepping physically into the hull also boards
  if (!aboard && exitCooldown <= 0 && !climb && Math.abs(xrOffset.y - world.canoe.seatPoint.y) < 1.2 && inHull(head.x, head.y, head.z, 0.36, 1.3)) boardCanoe();
  liftFeel.setComfort?.(comfort);
}

function pollGazeLock() {
  if (!renderer.xr.isPresenting || !xrFrame || biteHold || climb || aboard || boatGrip || oarGrip || glide.flying || world.canoe.anyOar?.() || world.gear.drawing()) {
    gazeLock = null;
    return;
  }
  let turning = false;
  for (const controller of controllers) {
    if (controller.userData.inputSource?.gamepad?.buttons?.[3]?.pressed) turning = true;
  }
  if (!turning) {
    gazeLock = null;
    return;
  }
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return;
  const orient = pose.transform.orientation;
  spaceQuat.set(orient.x, orient.y, orient.z, orient.w);
  spaceEuler.setFromQuaternion(spaceQuat, 'YXZ');
  const yaw = spaceEuler.y;
  if (!gazeLock) {
    gazeLock = { yaw };
    return;
  }
  let delta = gazeLock.yaw - yaw;
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) < 0.001) return;
  const head = pose.transform.position;
  yawAround(delta, head.x, head.z);
}

function pollTeleport(controller) {
  if (!TELEPORT || glide.flying) return;
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

function overCave(x, z) {
  const cave = world.cave;
  if (!cave) return false;
  if (x >= cave.x0 && x <= cave.x1 && z >= cave.z0 && z <= cave.z1) return true;
  const pad = cave.pad;
  if (pad && x >= pad.x0 && x <= pad.x1 && z >= pad.z0 && z <= pad.z1) return true;
  const tunnel = cave.tunnel;
  if (tunnel && x >= tunnel.x0 && x <= tunnel.x1 && z >= tunnel.z0 && z <= tunnel.z1) return true;
  const room = cave.room;
  return !!(room && x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1);
}

function supportY(prop) {
  const cave = world.cave;
  const inCave = prop.position.y < -1 && overCave(prop.position.x, prop.position.z);
  let best = inCave && cave ? cave.floor + (prop.userData.floorY ?? 0) : (prop.userData.floorY ?? 0.03);
  const overRoof = prop.position.x >= roof.x0 && prop.position.x <= roof.x1
    && prop.position.z >= roof.z0 && prop.position.z <= roof.z1
    && prop.position.y > roof.y - 0.2;
  if (overRoof) best = Math.max(best, roof.y + (prop.userData.floorY ?? 0));
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
  if (!prop || prop.userData.hold === 'grip') return;
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
    if (prop.userData.hold === 'grip') {
      prop.position.set(0, -0.16, -0.34);
      prop.rotation.set(-0.2, 0.4, 0);
    } else {
      prop.position.set(0, -0.05, -0.24);
      presentHeld(prop);
    }
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

function propRestY(prop) {
  const lift = prop.userData.floorY ?? 0.03;
  const { x, y, z } = prop.position;
  if (y < -1 && overCave(x, z)) return (world.cave?.floor ?? 0) + lift;
  if (x >= roof.x0 && x <= roof.x1 && z >= roof.z0 && z <= roof.z1 && y > roof.y - 0.25) {
    return standHeight(x, z, y, roof.y) + lift;
  }
  const yard = world.yard;
  if (yard && x >= yard.x0 && x <= yard.x1 && z >= yard.z0 && z <= yard.z1 && y >= yard.y - 0.4) {
    return standHeight(x, z, y, yard.y) + lift;
  }
  const shelf = world.shallowFloor?.(x, z);
  if (shelf != null && y < -1) return shelf + lift;
  return standHeight(x, z, y, 0) + lift;
}

function dropProp() {
  const prop = held;
  if (!prop || prop.userData.type !== 'prop') return;
  held = null;
  heldFrom = null;
  heldHome = null;
  assembly = null;
  propSamples.length = 0;
  scene.attach(prop);
  let vy = 0;
  const job = {
    t: 0,
    d: 4,
    last: 0,
    update() {
      const dt = Math.min(0.05, Math.max(0, job.t - job.last));
      job.last = job.t;
      if (dt === 0) return;
      vy -= 9.2 * dt;
      prop.position.y += vy * dt;
      const yard = world.yard;
      const onYard = yard
        && prop.position.x >= yard.x0 && prop.position.x <= yard.x1
        && prop.position.z >= yard.z0 && prop.position.z <= yard.z1;
      const inCave = prop.position.y < -1 && overCave(prop.position.x, prop.position.z);
      const onShallow = world.shallowFloor?.(prop.position.x, prop.position.z) != null && prop.position.y < -1;
      const inHouse = !inCave && prop.position.y > -1 && prop.position.x >= CLIFF_X;
      if (!inHouse && !onYard && !inCave && !onShallow && prop.position.y <= WATER_Y) {
        world.splash(prop.position.x, prop.position.z);
        prop.parent?.remove(prop);
        job.t = job.d;
        return;
      }
      const rest = propRestY(prop);
      if ((inHouse || onYard || inCave || onShallow) && prop.position.y <= rest) {
        prop.position.y = rest;
        prop.userData.role = 'loose';
        setBrickRaycast(prop, true);
        if (!targets.includes(prop)) targets.push(prop);
        job.t = job.d;
      }
    },
  };
  jobs.push(job);
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
    if (prop.userData.hold === 'grip') prop.rotation.y = 0;
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
      const yard = world.yard;
      const onYard = yard
        && prop.position.x >= yard.x0 && prop.position.x <= yard.x1
        && prop.position.z >= yard.z0 && prop.position.z <= yard.z1;
      const inCave = prop.position.y < -1 && overCave(prop.position.x, prop.position.z);
      const onShallow = world.shallowFloor?.(prop.position.x, prop.position.z) != null && prop.position.y < -1;
      const inHouse = !inCave && prop.position.y > -1 && prop.position.x >= CLIFF_X;
      if (inHouse) {
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
      if (!inHouse && !onYard && !inCave && !onShallow && prop.position.y <= WATER_Y) {
        world.splash(prop.position.x, prop.position.z);
        prop.parent?.remove(prop);
        job.t = job.d;
        return;
      }
      const rest = prop.userData.stackH != null ? supportY(prop) : floorY;
      if ((inHouse || onYard || inCave || onShallow) && prop.position.y <= rest && vy <= 0) {
        prop.position.y = rest;
        if (vy < -1.3) {
          vy = -vy * 0.32;
          vx *= 0.55;
          vz *= 0.55;
          return;
        }
        if (prop.userData.hold === 'grip') prop.rotation.set(0, 0, 0);
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

const perfEl = document.getElementById('perf');
const showPerf = pageParams.get('stats') === '1';
if (showPerf && perfEl) perfEl.hidden = false;
let perfStamp = 0;
let perfWarned = 0;

function notePerf(time) {
  if (!showPerf || !perfEl) return;
  if (time - perfStamp < 500) return;
  perfStamp = time;
  const renderInfo = renderer.info.render;
  const memory = renderer.info.memory;
  const vram = assets.stats().textureBytes;
  const over = renderInfo.calls > 150 || renderInfo.triangles > 500000 || vram > 150 * 1024 * 1024;
  perfEl.style.color = over ? '#ffb4a8' : '#f7f2ea';
  perfEl.textContent = [
    `calls ${renderInfo.calls}`,
    `tris ${renderInfo.triangles}`,
    `geometries ${memory.geometries}`,
    `textures ${memory.textures}`,
    `vram ${(vram / (1024 * 1024)).toFixed(1)} MB`,
  ].join('\n');
  if (renderer.xr.isPresenting && over && time - perfWarned > 5000) {
    perfWarned = time;
    console.warn('XR frame is over the phase 1 budget.', {
      calls: renderInfo.calls,
      triangles: renderInfo.triangles,
      textureBytes: vram,
    });
  }
}

function sampleGripMotion(item) {
  if (!item?.userData.carried || !renderer.xr.isPresenting || !xrFrame) return { held: false };
  const source = item.parent?.userData?.inputSource;
  const ref = renderer.xr.getReferenceSpace();
  const pose = source?.gripSpace && ref ? xrFrame.getPose(source.gripSpace, ref) : null;
  const lv = pose?.linearVelocity;
  const av = pose?.angularVelocity;
  if (!lv) return { held: true };
  return {
    held: true,
    v: { x: lv.x, y: lv.y, z: lv.z },
    w: av ? { x: av.x, y: av.y, z: av.z } : { x: 0, y: 0, z: 0 },
  };
}

function sampleStickMotion() {
  return sampleGripMotion(world.hockey?.stick);
}

// Ground/boat pass: squeeze/select handlers run between animation frames, when the XRFrame we kept is no longer
// active and getViewerPose()/getPose() throw InvalidStateError ("XRFrame access outside the callback..."). Off the boat,
// every squeeze asks nearSeat() -> headSample() first, so the throw aborted the whole grab: no torch, rung or item
// pickup after leaving the canoe. The wrapper answers outside the frame with the last pose this frame produced
// (null if none), so callers fall back the way they already do when a pose is missing.
const framePoses = new WeakMap();
function liveFrame(raw) {
  if (!raw) return null;
  return {
    raw,
    session: raw.session,
    getViewerPose(ref) {
      try {
        const pose = raw.getViewerPose(ref);
        if (ref) framePoses.set(ref, pose);
        return pose;
      } catch (err) {
        return (ref && framePoses.get(ref)) || null;
      }
    },
    getPose(space, ref) {
      try { return raw.getPose(space, ref); } catch (err) { return null; }
    },
  };
}

function frame(time, frame) {
  xrFrame = liveFrame(frame);
  placeInCell();
  containPlayer();
  const dt = Math.min(clock.getDelta(), 0.05);
  updateRoar(dt);
  for (let i = jobs.length - 1; i >= 0; i -= 1) {
    jobs[i].t += dt;
    const k = Math.min(1, jobs[i].t / jobs[i].d);
    jobs[i].update(k);
    if (k >= 1) jobs.splice(i, 1);
  }
  machine.update(dt);
  world.challenge.update(dt);
  world.canoe.setAboard?.(aboard);
  world.update(dt);
  if (world.hockey) {
    const events = world.hockey.update(dt, {
      colliders: walker.colliders,
      groundUnder,
      waterY: WATER_Y,
      motion: sampleStickMotion(),
    });
    const hand = world.hockey.stick.userData.carried ? world.hockey.stick.parent : null;
    for (const event of events) {
      if (event.type === 'strike') {
        sfx.play(['hit_wood', 'hit_wood2'], { at: event.at, gain: Math.min(1, 0.35 + event.speed / 22), rate: 1.2 });
        pulseController(hand, Math.min(1, 0.4 + event.speed / 24), 30);
        if (hand) pulseController(world.hockey.stick.userData.offHand, Math.min(1, 0.4 + event.speed / 24), 30);
      } else if (event.type === 'fit') {
        pulseController(hand, 0.25, 18);
      } else if (event.type === 'turf') {
        sfx.play(event.kill > 0.55 ? 'hit_plank' : 'hit_soft', { at: event.at, gain: Math.min(0.85, 0.3 + event.kill), rate: 0.72 });
        pulseController(hand, Math.min(1, 0.35 + event.kill), 45);
      } else if (event.type === 'push') {
        sfx.play('hit_soft', { at: event.at, gain: 0.2, rate: 1.45 });
      } else if (event.type === 'bounce') {
        sfx.play('hit_soft', { at: event.at, gain: Math.min(0.4, event.speed / 20) });
      } else if (event.type === 'goal') {
        sfx.play('hit_plank', { at: event.at, gain: 0.65 });
        setStatus('Goal.');
      }
    }
  }
  if (world.golf) {
    const events = world.golf.update(dt, {
      colliders: walker.colliders,
      groundUnder,
      waterY: WATER_Y,
      motion: sampleGripMotion(world.golf.club),
    });
    const hand = world.golf.club.userData.carried ? world.golf.club.parent : null;
    for (const event of events) {
      if (event.type === 'strike') {
        sfx.play('hit_wood', { at: event.at, gain: Math.min(0.85, 0.28 + event.speed / 30), rate: 1.7 });
        sfx.play('hit_metal', { at: event.at, gain: Math.min(0.45, 0.12 + event.speed / 50), rate: 1.85 });
        pulseController(hand, Math.min(1, 0.45 + event.speed / 30), 22);
        if (hand) pulseController(world.golf.club.userData.offHand, Math.min(1, 0.45 + event.speed / 30), 22); // both fists feel it
      } else if (event.type === 'fit') {
        pulseController(hand, 0.25, 18); // shaft length fitted to the ground
      } else if (event.type === 'turf') {
        sfx.play('hit_soft', { at: event.at, gain: Math.min(0.7, 0.25 + event.kill), rate: 0.9 });
        pulseController(hand, Math.min(1, 0.3 + event.kill), 36);
      } else if (event.type === 'push') {
        sfx.play('hit_soft', { at: event.at, gain: 0.16, rate: 1.6 });
      } else if (event.type === 'bounce') {
        sfx.play('hit_soft', { at: event.at, gain: Math.min(0.32, event.speed / 26), rate: 1.4 });
      } else if (event.type === 'splash') {
        sfx.play(event.speed > 8 ? 'splash_big' : 'splash_small1', { at: event.at, gain: 0.75 });
      }
    }
  }
  sfx.update(dt, {
    camera: renderer.xr.isPresenting ? renderer.xr.getCamera() : camera,
    zone: world.zones?.current ?? null,
    firePoint: world.gallery?.firePoint?.() ?? null,
    seaPoint: SEA_POINT,
  });
  if (croc) {
    if (watching) croc.root.visible = false;
    else if (!biteHold && (!world.zones?.enabled || world.zones.isAwake('cave') || world.zones.isAwake('sea'))) croc.update(dt, crocPlayer());
    health?.update(dt);
  }
  bearFight?.update(dt);
  music?.update(dt);
  if (boatGrip && world.canoe.holding && !world.canoe.holding(boatGrip.controller)) boatGrip = null;
  syncAboard();
  checkStepOut();
  updateSeatPosture(dt); // ground/boat pass: the canoe seat follows your real posture
  pullOar();
  for (const controller of controllers) updateLaser(controller);
  if (renderer.xr.isPresenting && !legacy('canoe') && world.canoe.hover) {
    canoeHoverPoints.length = 0;
    for (const controller of controllers) canoeHoverPoints.push(...handPoints(controller));
    world.canoe.hover(canoeHoverPoints);
  }
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
  if (renderer.xr.isPresenting) updateTopout(dt);
  updateLift(dt);
  updateGlider(dt);
  pollMove(dt);
  updatePlayerFall(dt);
  swim?.update(dt, xrFrame);
  if (renderer.xr.isPresenting || !(climb && !climb.onRoof)) {
    pollGazeLock();
    for (const controller of controllers) {
      pollTeleport(controller);
      pollRotate(controller);
      pollBag(controller);
      if (renderer.xr.isPresenting && controller.userData.squeezeDown && heldFrom !== controller && !oarGrip && aboard && !world.gear.isHolding(controller)
        && (world.canoe.paddleMode || world.canoe.nearOar?.(handPoints(controller)))) {
        gripOar(controller);
      }
      if (renderer.xr.isPresenting && controller.userData.squeezeDown && heldFrom !== controller && !climb?.hand && !boatGrip && !aboard && !gliderHand(controller) && !world.gear.isHolding(controller) && !controller.userData.noRegrab && !mantle) {
        const grabbedBoat = legacy('canoe') && gripBoatEnd(controller);
        if (!grabbedBoat) {
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
  if (world.zones?.enabled) {
    const eye = headSample();
    world.zones.update(eye, dt, renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
  }
  underwater?.update(dt, headSample());
  renderer.render(scene, camera);
  notePerf(time);
}

startRelay();

let testFrameHook = null;
// Test hooks for the headless WebXR checks (?testhooks=1 only; nothing is exposed otherwise).
if (pageParams.get('testhooks') === '1') {
  // XRFrame poses are only valid inside the frame callback; in XR three copies the last head pose into `camera`
  const hookHead = () => camera.position;
  window.__house = {
    world,
    state: () => ({
      aboard,
      climb: !!climb,
      offset: xrOffset.toArray(),
      yaw: xrYaw,
      head: hookHead().toArray(),
      torch: !!world.gear.handHolding?.('torch'),
      canoe: world.canoe.debug?.(),
      seat: world.canoe.seatPoint.toArray(),
      boatYaw: world.canoe.group.rotation.y,
      spotsVisible: teleportSpots.filter((spot) => spot.group.visible).length,
      teleportIndex,
      status: statusEl?.textContent || '',
      swim: swim?.debug?.() ?? null,
      music: music?.state?.() ?? null,
      scuba: scuba ? { loaded: scuba.loaded, mask: scuba.has('mask'), tank: scuba.has('tank'), fins: scuba.has('fins') } : null,
    }),
    place(x, feet, z) { // move the player's feet to (x, feet, z) keeping the head offset (test setup only)
      leaveCanoe();
      const head = hookHead();
      shiftPlayer(x - head.x, feet - xrOffset.y, z - head.z);
    },
    cameraMatrix: () => renderer.xr.getCamera().matrixWorld.toArray(),
    chopDoor() { (world.gear.doorBoards || []).forEach((b) => { b.userData.dead = true; b.visible = false; }); },
    forceMusic(phase) { music?.force?.(phase); },
    bossSounds: () => bearFight?.sounds?.() ?? [], // raptor pass: last raptor sounds (name, time, position)
    // ground pass: what the headless ground-truth survey (ground/harness) needs
    THREE,
    renderer,
    groundModel,
    walker,
    waterY: WATER_Y,
    roof,
    spots: () => teleportSpots.map((spot) => ({ x: spot.x, z: spot.z, floor: spot.floor ?? 0, seat: !!spot.seat, status: spot.status })),
    teleportTo,
    boardCanoe,
    leaveCanoe,
    tryStickExit,
    playerDown,
    fall: () => fallVy,
    setFrameHook(fn) { testFrameHook = fn; }, // runs after every frame, inside the XR callback
  };
}
