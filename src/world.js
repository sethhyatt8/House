import * as THREE from 'three';
import { createBrick, setBrickRaycast } from './bricks.js';
import { colorById, COLORS, GRID_X, GRID_Z, heightById, HEIGHTS, shapeById, SHAPES, STUD } from './config.js';

const TABLE_TOP = 0.76;
const WALL_Z = -2.68;
export const CLIFF_X = -1.78;

export function pedestalSlot(index) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: 0.76 + col * 0.3,
    z: 0.42 - row * 0.32,
  };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, ctx, texture };
}

function plankTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8d6a45';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#9a754c' : '#7d5d3b';
      ctx.fillRect(0, i * 64, w, 62);
      ctx.strokeStyle = 'rgba(60, 36, 18, 0.35)';
      ctx.strokeRect(0.5, i * 64 + 0.5, w - 1, 61);
    }
  }).texture;
}

function skyTexture() {
  return canvasTexture(8, 512, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#4f97d2');
    sky.addColorStop(0.38, '#8ec4ea');
    sky.addColorStop(0.55, '#d7e7f3');
    sky.addColorStop(0.7, '#d5decc');
    sky.addColorStop(1, '#8b9878');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
  }).texture;
}

function createCliff(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 20, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  scene.add(sky);

  const rock = new THREE.MeshStandardMaterial({ color: 0x6e675f, roughness: 1 });
  const rockDark = new THREE.MeshStandardMaterial({ color: 0x5c564f, roughness: 1 });
  const scrub = new THREE.MeshStandardMaterial({ color: 0x7d8a62, roughness: 1 });
  const farRock = new THREE.MeshStandardMaterial({ color: 0x8d877e, roughness: 1 });

  const face = new THREE.Mesh(new THREE.BoxGeometry(2.4, 28, 14), rock);
  face.position.set(CLIFF_X - 1.2, -14, 0);
  scene.add(face);
  const buttressA = new THREE.Mesh(new THREE.BoxGeometry(3.2, 20, 2.4), rockDark);
  buttressA.position.set(CLIFF_X - 2.4, -10, -1.6);
  scene.add(buttressA);
  const buttressB = new THREE.Mesh(new THREE.BoxGeometry(2.6, 16, 1.8), rockDark);
  buttressB.position.set(CLIFF_X - 2.8, -8, 2.1);
  scene.add(buttressB);

  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.08, 5.6),
    new THREE.MeshStandardMaterial({ color: 0x9a9186, roughness: 0.92 }),
  );
  lip.position.set(CLIFF_X - 0.04, 0.04, 0);
  lip.castShadow = true;
  lip.receiveShadow = true;
  scene.add(lip);

  const valley = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 80),
    scrub,
  );
  valley.rotation.x = -Math.PI / 2;
  valley.position.set(-24, -22, 0);
  scene.add(valley);

  const farWall = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 90), farRock);
  farWall.position.set(-78, -15, 0);
  scene.add(farWall);

  const ridge = new THREE.MeshStandardMaterial({ color: 0x7a736b, roughness: 1 });
  [[-38, -12, 6], [-55, 2, 8], [-34, 20, 5], [-62, -22, 7]].forEach(([x, z, height]) => {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(height * 0.42, height, 5), ridge);
    peak.position.set(x, -22 + height / 2, z);
    scene.add(peak);
  });
}

function plateTexture() {
  const px = 32;
  return canvasTexture(GRID_X * px, GRID_Z * px, (ctx, w, h) => {
    ctx.fillStyle = '#d5dbe3';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b7c0cb';
    ctx.lineWidth = 2;
    for (let i = 0; i <= GRID_X; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * px, 0);
      ctx.lineTo(i * px, h);
      ctx.stroke();
    }
    for (let j = 0; j <= GRID_Z; j += 1) {
      ctx.beginPath();
      ctx.moveTo(0, j * px);
      ctx.lineTo(w, j * px);
      ctx.stroke();
    }
  }).texture;
}

function buttonTexture(label, fill, textColor) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = textColor;
    ctx.font = `700 ${label.length > 4 ? 46 : 64}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2 + 2);
  }).texture;
}

function addBox(parent, size, position, material, targets) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  if (targets) targets.push(mesh);
  return mesh;
}

function createRoomCard(scene) {
  const screen = canvasTexture(512, 256, () => {});
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.25),
    new THREE.MeshBasicMaterial({ map: screen.texture }),
  );
  mesh.position.set(-0.82, 1.18, 0.18);
  scene.add(mesh);

  function setRoomCode(code, caption) {
    const { ctx, texture, canvas } = screen;
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9eb0be';
    ctx.font = '600 44px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption || 'ROOM', canvas.width / 2, 74);
    ctx.fillStyle = '#f7f4ee';
    ctx.font = '700 128px Segoe UI, sans-serif';
    ctx.fillText(code || '----', canvas.width / 2, 168);
    texture.needsUpdate = true;
  }

  setRoomCode('----', 'ROOM');
  return { mesh, setRoomCode };
}

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc5e0f2);
  scene.fog = new THREE.Fog(0xc5e0f2, 22, 70);

  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 160);
  camera.position.set(-0.05, 1.58, 1.22);

  const targets = [];

  const roomRight = 2.7;
  const roomZ = 2.7;
  const roomSpan = roomRight - CLIFF_X;
  const roomMidX = (roomRight + CLIFF_X) / 2;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe4ddd2, roughness: 1 });
  const addWall = (w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  addWall(roomSpan, 4.4, 0.12, roomMidX, 2.2, -roomZ - 0.06);
  addWall(roomSpan, 4.4, 0.12, roomMidX, 2.2, roomZ + 0.06);
  addWall(0.12, 4.4, roomZ * 2, roomRight + 0.06, 2.2, 0);
  addWall(roomSpan, 0.1, roomZ * 2, roomMidX, 4.45, 0);

  const floorMap = plankTexture();
  floorMap.wrapS = THREE.RepeatWrapping;
  floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.repeat.set(3.2, 4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(roomSpan, roomZ * 2),
    new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(roomMidX, 0.001, 0);
  floor.receiveShadow = true;
  scene.add(floor);
  createCliff(scene);

  const hemi = new THREE.HemisphereLight(0xfff7ee, 0x6d5c4c, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfffaf3, 1.45);
  key.position.set(1.8, 3.4, 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.4;
  key.shadow.camera.far = 8;
  key.shadow.camera.left = -2.2;
  key.shadow.camera.right = 2.2;
  key.shadow.camera.top = 2.2;
  key.shadow.camera.bottom = -2.2;
  key.shadow.bias = -0.00035;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(0, 0.6, -0.2);
  const fill = new THREE.DirectionalLight(0xd5e4f5, 0.35);
  fill.position.set(-1.5, 1.6, 1.2);
  scene.add(fill);

  const plateW = GRID_X * STUD;
  const plateD = GRID_Z * STUD;
  const buildRoot = new THREE.Group();
  buildRoot.position.set(0, TABLE_TOP, -0.55);
  scene.add(buildRoot);
  const gridGroup = new THREE.Group();
  gridGroup.position.set(-plateW / 2, 0, -plateD / 2);
  buildRoot.add(gridGroup);

  const plateMap = plateTexture();
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(plateW, 0.02, plateD),
    new THREE.MeshStandardMaterial({ map: plateMap, color: 0xffffff, roughness: 0.86 }),
  );
  plate.position.set(plateW / 2, -0.01, plateD / 2);
  plate.receiveShadow = true;
  plate.userData = { type: 'plate' };
  gridGroup.add(plate);
  targets.push(plate);

  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.78 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x5c3b22, roughness: 0.8 });
  const table = new THREE.Group();
  scene.add(table);
  const topW = plateW + 0.16;
  const topD = plateD + 0.16;
  const top = new THREE.Mesh(new THREE.BoxGeometry(topW, 0.045, topD), wood);
  top.position.set(0, TABLE_TOP - 0.034, -0.55);
  top.castShadow = true;
  top.receiveShadow = true;
  table.add(top);
  const legGeo = new THREE.BoxGeometry(0.06, 0.7, 0.06);
  const legs = [];
  for (let i = 0; i < 4; i += 1) {
    const leg = new THREE.Mesh(legGeo, woodDark);
    leg.castShadow = true;
    table.add(leg);
    legs.push(leg);
  }
  function layoutTable(scale) {
    const w = plateW * scale + 0.16;
    const d = plateD * scale + 0.16;
    top.scale.set(w / topW, 1, d / topD);
    const offsets = [
      [-(plateW * scale + 0.08) / 2, -(plateD * scale + 0.08) / 2],
      [(plateW * scale + 0.08) / 2, -(plateD * scale + 0.08) / 2],
      [-(plateW * scale + 0.08) / 2, (plateD * scale + 0.08) / 2],
      [(plateW * scale + 0.08) / 2, (plateD * scale + 0.08) / 2],
    ];
    legs.forEach((leg, index) => {
      leg.position.set(offsets[index][0], 0.35, -0.55 + offsets[index][1]);
    });
  }
  layoutTable(1);

  const machine = createMachine(targets);
  scene.add(machine.group);
  const challenge = createChallengeStand(targets);
  scene.add(challenge.group);
  scene.add(challenge.sign);
  scene.add(challenge.newButton);
  challenge.sign.position.set(-0.34, 0.9, WALL_Z + 0.01);
  challenge.sign.rotation.set(0, 0, 0);
  challenge.sign.scale.setScalar(1.22);
  challenge.newButton.position.set(0.22, 0.9, WALL_Z + 0.03);
  challenge.newButton.rotation.set(0, 0, 0);
  challenge.newButton.userData.restZ = WALL_Z + 0.03;
  challenge.newButton.userData.baseScale = 1.22;
  challenge.newButton.scale.setScalar(1.22);
  machine.pressables.push(challenge.newButton);
  const bin = createBin();
  scene.add(bin);
  const roomCard = createRoomCard(scene);

  return {
    scene,
    camera,
    buildRoot,
    gridGroup,
    plate,
    targets,
    machine,
    challenge,
    bin,
    tableTop: TABLE_TOP,
    layoutTable,
    setRoomCode: roomCard.setRoomCode,
  };
}

function createMachine(targets) {
  const mount = new THREE.Group();

  const openPose = { x: 0, y: 1.92, z: WALL_Z, tilt: 0, yaw: 0 };
  const closedPose = { x: 0, y: 3.5, z: WALL_Z, tilt: 0, yaw: 0 };
  const group = new THREE.Group();
  group.position.set(openPose.x, openPose.y, openPose.z);
  group.rotation.x = openPose.tilt;
  group.scale.set(1.22, 1.22, 1);
  mount.add(group);
  const pressables = [];
  function trackPress(mesh, restZ = 0.078) {
    mesh.position.z = restZ;
    mesh.userData.restZ = restZ;
    mesh.userData.press = 0;
    pressables.push(mesh);
    return mesh;
  }

  const sheen = canvasTexture(128, 256, (ctx, w, h) => {
    const fade = ctx.createLinearGradient(0, 0, w * 0.35, h);
    fade.addColorStop(0, '#f7fbff');
    fade.addColorStop(0.28, '#d5dee8');
    fade.addColorStop(0.46, '#f3f7fb');
    fade.addColorStop(0.7, '#c3ced8');
    fade.addColorStop(1, '#e6edf3');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
  }).texture;
  const caseMat = new THREE.MeshPhysicalMaterial({
    map: sheen,
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.82,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.15,
  });
  const trimMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7fafc,
    roughness: 0.1,
    metalness: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.2,
  });
  const panelW = 2.08;
  const panelH = 2.2;
  const panelBottom = -0.72;
  const panelMidY = panelBottom + panelH / 2;
  addBox(group, [panelW, panelH, 0.022], [0, panelMidY, 0], caseMat);
  addBox(group, [panelW + 0.04, 0.022, 0.03], [0, panelBottom + panelH - 0.02, 0], trimMat);

  const orderButton = new THREE.Mesh(
    new THREE.BoxGeometry(1.86, 0.52, 0.11),
    new THREE.MeshStandardMaterial({
      color: 0x1f7a45,
      roughness: 0.42,
      emissive: 0x1f7a45,
      emissiveIntensity: 0.2,
    }),
  );
  orderButton.position.set(0, 0.86, 0.02);
  orderButton.userData = { type: 'ui', action: 'order' };
  orderButton.castShadow = true;
  trackPress(orderButton, 0.095);
  group.add(orderButton);
  targets.push(orderButton);

  const screen = canvasTexture(768, 320, () => {});
  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.46),
    new THREE.MeshBasicMaterial({ map: screen.texture }),
  );
  screenMesh.position.set(0, 0, 0.057);
  orderButton.add(screenMesh);
  const previewRoot = new THREE.Group();
  orderButton.add(previewRoot);

  const colorButtons = COLORS.map((color, index) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.1),
      new THREE.MeshStandardMaterial({
        color: color.hex,
        roughness: 0.42,
        emissive: 0x111111,
        emissiveIntensity: 0.18,
      }),
    );
    const col = index % 6;
    const row = Math.floor(index / 6);
    const rowCount = row === 0 ? Math.min(6, COLORS.length) : COLORS.length - 6;
    const step = 0.31;
    const origin = -((rowCount - 1) * step) / 2;
    mesh.position.set(origin + col * step, row === 0 ? 0.4 : 0.16, 0.02);
    mesh.userData = { type: 'ui', action: 'color', value: color.id };
    mesh.castShadow = true;
    trackPress(mesh);
    group.add(mesh);
    targets.push(mesh);
    return mesh;
  });

  const shapeButtons = SHAPES.map((shape, index) => {
    const col = index % 5;
    const row = Math.floor(index / 5);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.09, 0.09),
      new THREE.MeshStandardMaterial({
        map: buttonTexture(shape.button || shape.name, '#243038', '#f4f7f8'),
        roughness: 0.5,
        emissive: 0x8fd0ff,
        emissiveIntensity: 0,
      }),
    );
    mesh.position.set(-0.6 + col * 0.3, -0.06 - row * 0.14, 0.016);
    mesh.userData = { type: 'ui', action: 'shape', value: shape.id };
    mesh.castShadow = true;
    trackPress(mesh);
    group.add(mesh);
    targets.push(mesh);
    return mesh;
  });

  const heightButtons = HEIGHTS.map((height, index) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.08, 0.09),
      new THREE.MeshStandardMaterial({
        map: buttonTexture(height.label, '#243038', '#f4f7f8'),
        roughness: 0.5,
        emissive: 0x8fd0ff,
        emissiveIntensity: 0,
      }),
    );
    mesh.position.set(-0.55 + index * 0.28, -0.38, 0.02);
    mesh.userData = { type: 'ui', action: 'height', value: height.id };
    mesh.castShadow = true;
    trackPress(mesh);
    group.add(mesh);
    targets.push(mesh);
    return mesh;
  });

  const flatButton = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.08, 0.09),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('FLAT', '#243038', '#f4f7f8'),
      roughness: 0.5,
      emissive: 0xf1c40f,
      emissiveIntensity: 0,
    }),
  );
  flatButton.position.set(0.42, -0.38, 0.02);
  flatButton.userData = { type: 'ui', action: 'top' };
  flatButton.castShadow = true;
  trackPress(flatButton);
  group.add(flatButton);
  targets.push(flatButton);

  const pegTrack = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.09, 0.016),
    new THREE.MeshStandardMaterial({ color: 0x1c242c, roughness: 0.55 }),
  );
  pegTrack.position.set(0, -0.56, 0.014);
  pegTrack.userData = { type: 'ui', action: 'peg' };
  group.add(pegTrack);
  targets.push(pegTrack);
  const pegKnob = new THREE.Mesh(
    new THREE.BoxGeometry(0.046, 0.055, 0.028),
    new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.35 }),
  );
  pegKnob.position.set(0, 0, 0.012);
  pegTrack.add(pegKnob);
  const pegLabel = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f4f7f8';
    ctx.font = '600 36px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PEG SIZE', w / 2, h / 2);
  }).texture;
  const pegTag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.04),
    new THREE.MeshBasicMaterial({ map: pegLabel, transparent: true }),
  );
  pegTag.position.set(0, 0, 0.02);
  pegTrack.add(pegTag);

  function setPegKnob(scale, min, max) {
    const t = Math.min(1, Math.max(0, (scale - min) / (max - min)));
    pegKnob.position.x = -0.42 + t * 0.84;
  }

  function paintScreen(label) {
    const { ctx, texture, canvas } = screen;
    ctx.fillStyle = '#1f7a45';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d7ecdf';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = label.length > 18 ? '600 30px Segoe UI, sans-serif' : '600 36px Segoe UI, sans-serif';
    ctx.fillText(label, canvas.width * 0.4, canvas.height * 0.36);
    ctx.fillStyle = '#f7fff8';
    ctx.font = '700 64px Segoe UI, sans-serif';
    ctx.fillText('Press to order', canvas.width * 0.4, canvas.height * 0.68);
    texture.needsUpdate = true;
  }

  function showPreview(selection) {
    while (previewRoot.children.length) previewRoot.remove(previewRoot.children[0]);
    const shape = shapeById(selection.shapeId);
    const color = colorById(selection.colorId);
    const height = heightById(selection.heightId);
    const brick = createBrick(shape, color, {
      units: height.units,
      flat: selection.flat,
      heightId: selection.heightId,
    });
    setBrickRaycast(brick, false);
    brick.userData.type = 'preview';
    brick.traverse((child) => {
      if (child.isMesh) child.castShadow = false;
    });
    const span = Math.max(shape.w, shape.d) * STUD;
    const fit = Math.min(2.2, 0.32 / span);
    brick.scale.set(fit, fit * 0.22, fit);
    brick.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
    ));
    brick.position.set(-0.55, 0, 0.058);
    previewRoot.add(brick);
  }

  const hideButton = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.09, 0.09),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('HIDE', '#3a4652', '#f4f7f8'),
      roughness: 0.5,
    }),
  );
  hideButton.position.set(0.84, 1.28, 0.02);
  hideButton.userData = { type: 'ui', action: 'screen' };
  trackPress(hideButton);
  group.add(hideButton);
  targets.push(hideButton);

  const tab = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.1, 0.05),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('PARTS', '#1f7a45', '#f4fff7'),
      roughness: 0.45,
      emissive: 0x1f7a45,
      emissiveIntensity: 0.2,
    }),
  );
  tab.position.set(0.58, 0.9, WALL_Z + 0.03);
  tab.userData = { type: 'ui', action: 'screen', restZ: WALL_Z + 0.03, press: 0, baseScale: 1.22 };
  tab.scale.setScalar(1.22);
  tab.visible = false;
  mount.add(tab);
  targets.push(tab);
  pressables.push(tab);

  let openAmount = 1;
  let openTarget = 1;

  function applyScreenPose() {
    group.position.set(
      closedPose.x + (openPose.x - closedPose.x) * openAmount,
      closedPose.y + (openPose.y - closedPose.y) * openAmount,
      closedPose.z + (openPose.z - closedPose.z) * openAmount,
    );
    group.rotation.x = closedPose.tilt + (openPose.tilt - closedPose.tilt) * openAmount;
    group.rotation.y = closedPose.yaw + (openPose.yaw - closedPose.yaw) * openAmount;
    group.visible = openAmount > 0.08;
    tab.visible = openAmount < 0.92;
  }

  function placeScreen() {
    openPose.x = 0;
    openPose.z = WALL_Z;
    openPose.tilt = 0;
    closedPose.x = 0;
    closedPose.z = WALL_Z;
    closedPose.tilt = 0;
    tab.position.set(0.58, 0.9, tab.userData.restZ);
    tab.rotation.set(0, 0, 0);
    applyScreenPose();
  }

  function toggleScreen() {
    openTarget = openTarget > 0.5 ? 0 : 1;
    return openTarget > 0.5;
  }

  function update(dt) {
    const step = Math.min(1, dt * 4);
    openAmount += (openTarget - openAmount) * step;
    if (Math.abs(openTarget - openAmount) < 0.001) openAmount = openTarget;
    applyScreenPose();
    for (const mesh of pressables) {
      let press = mesh.userData.press || 0;
      if (press > 0) mesh.userData.press = Math.max(0, press - dt * 3.4);
      mesh.position.z = mesh.userData.restZ - (mesh.userData.press || 0) * 0.046;
    }
  }

  applyScreenPose();

  function refreshSelection(selection) {
    for (const button of colorButtons) {
      const selected = button.userData.value === selection.colorId;
      button.material.emissive.copy(button.material.color);
      button.material.emissiveIntensity = selected ? 0.42 : 0.06;
      button.scale.setScalar(selected ? 1.1 : 1);
    }
    for (const button of shapeButtons) {
      button.material.emissiveIntensity = button.userData.value === selection.shapeId ? 0.22 : 0;
    }
    for (const button of heightButtons) {
      button.material.emissiveIntensity = button.userData.value === selection.heightId ? 0.28 : 0;
    }
    flatButton.material.emissiveIntensity = selection.flat ? 0.35 : 0;
  }

  placeScreen(1);

  return { group: mount, orderButton, pegTrack, colorButtons, shapeButtons, paintScreen, showPreview, refreshSelection, setPegKnob, toggleScreen, update, placeScreen, pressables };
}

export function createChallengeStand(targets) {
  const group = new THREE.Group();
  group.position.set(0, 0, -1.45);

  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.78 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x5c3b22, roughness: 0.8 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 0.78, 18), woodDark);
  post.position.y = 0.39;
  post.castShadow = true;
  group.add(post);

  const plateSize = 8 * STUD;
  const model = new THREE.Group();
  model.position.y = 0.82;
  group.add(model);

  const topMat = new THREE.MeshStandardMaterial({ color: 0xc5ced8, roughness: 0.82, emissive: 0x000000, emissiveIntensity: 0 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(plateSize, 0.02, plateSize), topMat);
  plate.position.y = -0.01;
  plate.receiveShadow = true;
  model.add(plate);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(plateSize + 0.08, 0.04, plateSize + 0.08), wood);
  deck.position.y = -0.04;
  deck.castShadow = true;
  deck.receiveShadow = true;
  model.add(deck);

  const bricks = new THREE.Group();
  bricks.position.set(-plateSize / 2, 0, -plateSize / 2);
  model.add(bricks);

  const newButton = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.1, 0.05),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('NEW', '#1f7a45', '#f4fff7'),
      roughness: 0.45,
      emissive: 0x1f7a45,
      emissiveIntensity: 0.15,
    }),
  );
  newButton.position.set(0.22, 0.9, 0);
  newButton.rotation.set(0, 0, 0);
  newButton.userData = { type: 'ui', action: 'challenge', restZ: 0, press: 0, baseScale: 1.22 };
  newButton.scale.setScalar(1.22);
  newButton.castShadow = true;
  group.add(newButton);
  targets.push(newButton);

  const sign = canvasTexture(512, 160, () => {});
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.14),
    new THREE.MeshBasicMaterial({ map: sign.texture }),
  );
  signMesh.position.set(-0.34, 0.9, 0);
  signMesh.rotation.set(0, 0, 0);
  signMesh.scale.setScalar(1.22);
  group.add(signMesh);

  const glow = new THREE.PointLight(0xd6ffe6, 0, 2.4);
  glow.position.set(0, 1.0, 0);
  group.add(glow);
  const sparkGeo = new THREE.SphereGeometry(0.014, 6, 6);
  const sparks = [];
  let glowTime = 0;

  let matched = false;
  let shown = 'ready';

  function paint(headline, detail) {
    const { ctx, texture, canvas } = sign;
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = matched ? '#8ee0ad' : '#8fd0ff';
    ctx.font = '700 58px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(headline, canvas.width / 2, 58);
    ctx.fillStyle = '#d5dde4';
    ctx.font = '500 32px Segoe UI, sans-serif';
    ctx.fillText(detail, canvas.width / 2, 112);
    texture.needsUpdate = true;
  }

  const verdictCopy = {
    ready: ['Match this', 'Any turn is fine'],
    match: ['You got it', 'Press NEW'],
    extra: ['Match this', 'Toss the extra bricks'],
    short: ['Match this', 'Still missing some'],
    different: ['Match this', 'Check colors and heights'],
  };

  function setVerdict(verdict) {
    if (verdict === shown) return;
    shown = verdict;
    matched = verdict === 'match';
    const [headline, detail] = verdictCopy[verdict] || verdictCopy.ready;
    topMat.emissive.setHex(matched ? 0x1f7a45 : 0x000000);
    topMat.emissiveIntensity = matched ? 0.45 : 0;
    paint(headline, detail);
  }

  function celebrate() {
    glowTime = 1.6;
    for (let i = 0; i < 22; i += 1) {
      const spark = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xffe08a : 0x8dffc0,
          transparent: true,
          opacity: 1,
        }),
      );
      spark.position.set((Math.random() - 0.5) * 0.28, 0.9 + Math.random() * 0.08, (Math.random() - 0.5) * 0.28);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.25 + Math.random() * 0.45;
      group.add(spark);
      sparks.push({
        mesh: spark,
        vx: Math.cos(angle) * speed,
        vy: 0.35 + Math.random() * 0.55,
        vz: Math.sin(angle) * speed,
        life: 0.9 + Math.random() * 0.4,
        age: 0,
      });
    }
  }

  function update(dt) {
    model.rotation.y += dt * 0.22;
    if (glowTime > 0) {
      glowTime = Math.max(0, glowTime - dt);
      glow.intensity = glowTime * 3.2;
    }
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.age += dt;
      spark.vy -= dt * 0.8;
      spark.mesh.position.x += spark.vx * dt;
      spark.mesh.position.y += spark.vy * dt;
      spark.mesh.position.z += spark.vz * dt;
      spark.mesh.material.opacity = Math.max(0, 1 - spark.age / spark.life);
      if (spark.age >= spark.life) {
        spark.mesh.material.dispose();
        group.remove(spark.mesh);
        sparks.splice(i, 1);
      }
    }
  }

  paint('Match this', 'Any turn is fine');

  return { group, model, bricks, newButton, sign: signMesh, setVerdict, celebrate, update };
}

function createBin() {
  const group = new THREE.Group();
  group.position.set(-0.92, 0, -0.42);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c333a, roughness: 0.72, metalness: 0.08 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.76, 16), mat);
  post.position.y = 0.38;
  post.castShadow = true;
  group.add(post);
  const wall = (w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const span = 0.34;
  const lip = 0.74;
  wall(span, 0.018, span, 0, lip, 0);
  wall(0.018, 0.16, span, -span / 2, lip + 0.08, 0);
  wall(0.018, 0.16, span, span / 2, lip + 0.08, 0);
  wall(span, 0.16, 0.018, 0, lip + 0.08, -span / 2);
  wall(span + 0.018, 0.16, 0.018, 0, lip + 0.08, span / 2);
  const label = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4f7f8';
    ctx.font = '700 72px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TOSS', w / 2, h / 2);
  }).texture;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09),
    new THREE.MeshBasicMaterial({ map: label }),
  );
  sign.position.set(0, lip + 0.2, span / 2 + 0.012);
  group.add(sign);
  const sideSign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09),
    new THREE.MeshBasicMaterial({ map: label }),
  );
  sideSign.position.set(span / 2 + 0.012, lip + 0.2, 0);
  sideSign.rotation.y = Math.PI / 2;
  group.add(sideSign);
  return group;
}

export function createPedestal(index, label) {
  const group = new THREE.Group();
  const slot = pedestalSlot(index);
  group.position.set(slot.x, 0, slot.z);

  const metal = new THREE.MeshStandardMaterial({ color: 0x8d959c, roughness: 0.35, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.3 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0xd7dde3, roughness: 0.4, metalness: 0.25, emissive: 0xfff4d2, emissiveIntensity: 0 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 24), dark);
  base.position.y = 0.03;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.62, 20), metal);
  column.position.y = 0.37;
  column.castShadow = true;
  group.add(column);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.028, 28), topMat);
  top.position.y = 0.694;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const labelTex = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4f7f8';
    ctx.font = label.length > 16 ? '600 20px Segoe UI, sans-serif' : '600 32px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2);
  }).texture;
  const tag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.04),
    new THREE.MeshBasicMaterial({ map: labelTex }),
  );
  tag.position.set(0, 0.52, 0.058);
  group.add(tag);

  const dismiss = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.08, 0.045),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('X', '#b4332c', '#fff6f4'),
      color: 0xffffff,
      roughness: 0.42,
      emissive: 0xffb0a8,
      emissiveIntensity: 0.2,
    }),
  );
  dismiss.position.set(0, 0.42, 0.1);
  dismiss.castShadow = true;
  dismiss.userData = { type: 'ui', action: 'dismiss', restZ: 0.1, press: 0 };
  group.add(dismiss);

  return { group, top, dismiss };
}
