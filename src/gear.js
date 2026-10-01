import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { proxyMaterial } from './assets.js';
import { legacy } from './flags.js';
import { applyWorldUv } from './uv.js';

const CHARACTERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CAPACITY = 100;

function paintTile(rank) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#2a2622';
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = '#1c2430';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '500 150px "KaiTi", "STKaiti", "SimSun", "Microsoft YaHei", serif';
  ctx.fillText(CHARACTERS[rank - 1], canvas.width / 2, 130);
  ctx.font = '500 92px "KaiTi", "STKaiti", "SimSun", "Microsoft YaHei", serif';
  ctx.fillStyle = '#1a4a78';
  ctx.fillText('萬', canvas.width / 2, 268);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function paintAxe() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a2a1c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#8a5a32';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(36, 104);
  ctx.lineTo(84, 28);
  ctx.stroke();
  ctx.fillStyle = '#c5c6c2';
  ctx.beginPath();
  ctx.moveTo(72, 14);
  ctx.lineTo(114, 34);
  ctx.lineTo(92, 58);
  ctx.lineTo(58, 36);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function carryable(object) {
  const gear = object?.userData?.gear;
  return gear === 'hatchet' || gear === 'tile' || gear === 'bow' || gear === 'torch' || gear === 'brush';
}

export function createGear(scene, camera, targets, roof, cave, gallery, assets) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6d4c32, roughness: 0.78 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb7b8b4, roughness: 0.42, metalness: 0.55 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3824, roughness: 0.86 });
  const leatherDark = new THREE.MeshStandardMaterial({ color: 0x3e2618, roughness: 0.9 });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x8d3a2a, roughness: 0.62 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x7d756c, roughness: 0.95 });
  const pocketMat = new THREE.MeshStandardMaterial({ color: 0x2c241c, roughness: 0.9, emissive: 0x120e0a, emissiveIntensity: 0.4 });
  const axeMat = new THREE.MeshStandardMaterial({ map: paintAxe(), roughness: 0.6 });
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();
  const bladePrev = new THREE.Vector3();
  const bladeNow = new THREE.Vector3();
  const hitBox = new THREE.Box3();
  const vrHands = new Map();
  const choppables = [];
  const slots = [];
  const chips = [];
  const falls = [];
  const pockets = new Array(CAPACITY).fill(null);
  const pocketMeshes = [];
  let owned = false;
  let menuOpen = false;
  let bladeReady = false;
  let bladeLogged = false;
  let onPickup = null;
  let onChop = null;
  let onLoose = null;
  let onStrike = null;
  let onDip = null;
  let onHaptic = null;
  let drawHand = null;
  let drawTickSent = false;
  let drawRumbleAt = 0;
  const deck = roof?.y ?? 0;
  const puzzleX = roof ? (roof.x0 + roof.x1) * 0.5 - 0.15 : -0.55;
  const puzzleZ = roof ? 1.35 : 2.18;
  const gearModels = assets?.feature('gear');

  function addModel(parent, id) {
    if (!gearModels) return null;
    const model = assets.instance(id);
    if (!model) return null;
    parent.add(model);
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.raycast = () => {};
    });
    return model;
  }

  function hideParts(parts) {
    for (const part of parts) {
      part.material = proxyMaterial;
      part.castShadow = false;
      part.receiveShadow = false;
    }
  }

  function enlist(object) {
    if (!targets.includes(object)) targets.push(object);
  }

  function unlist(object) {
    const index = targets.indexOf(object);
    if (index >= 0) targets.splice(index, 1);
  }

  function holdPose(item, position, rotation) {
    item.userData.holdPos = new THREE.Vector3(...position);
    item.userData.holdRot = new THREE.Euler(...rotation);
    item.userData.restRot = item.rotation.clone();
  }

  const hatchet = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.3, 6), wood);
  handle.position.y = 0.08;
  hatchet.add(handle);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.03), metal);
  head.position.set(0.015, 0.22, 0);
  hatchet.add(head);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.012), metal);
  blade.position.set(0.07, 0.25, 0);
  blade.rotation.z = -0.45;
  hatchet.add(blade);
  hatchet.position.set(1.48, 0.04, -0.42);
  hatchet.rotation.z = Math.PI / 2;
  hatchet.rotation.y = 0.4;
  hatchet.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  const grip = new THREE.Group();
  grip.position.set(0, 0.055, 0);
  grip.visible = false;
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9956b, roughness: 0.66 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.042, 0.046), skin);
  grip.add(palm);
  for (let i = 0; i < 4; i += 1) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.038, 0.016), skin);
    finger.position.set(0.012, 0.01, -0.02 + i * 0.014);
    finger.rotation.z = -1.15;
    grip.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.034, 0.016), skin);
  thumb.position.set(-0.02, 0.006, 0.02);
  thumb.rotation.z = 0.9;
  grip.add(thumb);
  hatchet.add(grip);
  const hatchetModel = assets?.enabled
    ? assets.instance('hatchet', { fit: { uniform: 1 } })
    : null;
  if (hatchetModel) {
    hatchetModel.rotation.y = Math.PI / 2;
    hatchet.add(hatchetModel);
    for (const part of [handle, head, blade]) {
      part.material = proxyMaterial;
      part.castShadow = false;
      part.receiveShadow = false;
    }
    hatchet.updateWorldMatrix(true, true);
    const bladeCenter = new THREE.Vector3();
    const sample = new THREE.Vector3();
    const samples = [];
    let minX = Infinity;
    let maxX = -Infinity;
    hatchetModel.traverse((child) => {
      const attr = child.geometry?.attributes?.position;
      if (!child.isMesh || !attr) return;
      child.updateWorldMatrix(true, false);
      for (let i = 0; i < attr.count; i += 1) {
        sample.fromBufferAttribute(attr, i);
        child.localToWorld(sample);
        hatchet.worldToLocal(sample);
        samples.push(sample.x, sample.y, sample.z);
        if (sample.x < minX) minX = sample.x;
        if (sample.x > maxX) maxX = sample.x;
      }
    });
    const cutoff = minX + (maxX - minX) * 0.65;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;
    for (let i = 0; i < samples.length; i += 3) {
      if (samples[i] < cutoff) continue;
      sx += samples[i];
      sy += samples[i + 1];
      sz += samples[i + 2];
      count += 1;
    }
    if (count) blade.position.set(sx / count, sy / count, sz / count);
    const modelBox = new THREE.Box3().setFromObject(hatchetModel);
    blade.getWorldPosition(bladeCenter);
    console.info('[hatchet] blade marker', blade.position.toArray(), 'inside model', modelBox.containsPoint(bladeCenter));
  }
  hatchet.userData = { type: 'gear', gear: 'hatchet', floorY: 0.04, blade, grip, hatchetModel };
  holdPose(hatchet, [0, -0.012, 0.06], [-Math.PI / 2, 0.08, -0.45]);
  scene.add(hatchet);
  enlist(hatchet);

  const torch = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.46, 6), wood);
  stick.position.y = 0.23;
  torch.add(stick);
  const pitch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.02, 0.1, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.9 }),
  );
  pitch.position.y = 0.4;
  torch.add(pitch);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb15a });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 6), flameMat);
  flame.position.y = 0.5;
  torch.add(flame);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xfff1c4 }),
  );
  core.position.y = 0.46;
  torch.add(core);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  halo.position.y = 0.5;
  torch.add(halo);
  const torchLight = new THREE.PointLight(0xffa24a, 8, 12, 2);
  torchLight.position.y = 0.52;
  torch.add(torchLight);
  const torchGrip = new THREE.Group();
  torchGrip.position.set(0, 0.16, 0);
  torchGrip.visible = false;
  const torchSkin = new THREE.MeshStandardMaterial({ color: 0xc9956b, roughness: 0.66 });
  const torchPalm = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.042, 0.046), torchSkin);
  torchGrip.add(torchPalm);
  for (let i = 0; i < 4; i += 1) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.038, 0.016), torchSkin);
    finger.position.set(0.012, 0.01, -0.02 + i * 0.014);
    finger.rotation.z = -1.15;
    torchGrip.add(finger);
  }
  const torchThumb = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.034, 0.016), torchSkin);
  torchThumb.position.set(-0.02, 0.006, 0.02);
  torchThumb.rotation.z = 0.9;
  torchGrip.add(torchThumb);
  torch.add(torchGrip);
  if (gearModels && assets.gltf('torch')) {
    torch.children.forEach((child) => {
      if (!child.isMesh || !child.material?.isMeshStandardMaterial) return;
      child.material = proxyMaterial;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    addModel(torch, 'torch');
  }
  torch.position.set(cave.x1 - 0.85, cave.floor, cave.z + 0.85);
  torch.rotation.y = -0.6;
  torch.rotation.z = 0.08;
  torch.userData = { type: 'gear', gear: 'torch', floorY: cave.floor, houseY: 0.02, grip: torchGrip, light: torchLight, flame, halo };
  holdPose(torch, [0.02, -0.02, -0.05], [0.5, 0, 0.18]);
  scene.add(torch);
  enlist(torch);

  const paintTip = new THREE.Vector3();
  const bristleMat = new THREE.MeshStandardMaterial({ color: 0xc2a878, roughness: 0.75 });
  const brush = new THREE.Group();
  if (gallery) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.28, 6), wood);
    handle.position.y = 0.14;
    brush.add(handle);
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.035, 6), metal);
    ferrule.position.y = 0.29;
    brush.add(ferrule);
    const bristles = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.008, 0.07, 6), bristleMat);
    bristles.position.y = 0.34;
    brush.add(bristles);
    const tip = new THREE.Object3D();
    tip.position.y = 0.385;
    brush.add(tip);
    const brushGrip = new THREE.Group();
    brushGrip.position.set(0, 0.12, 0);
    brushGrip.visible = false;
    const brushPalm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.036, 0.04), torchSkin);
    brushGrip.add(brushPalm);
    brush.add(brushGrip);
    if (gearModels && assets.gltf('brush')) {
      hideParts([handle, ferrule, bristles]);
      addModel(brush, 'brush');
    }
    brush.position.set(gallery.brushAt.x, gallery.brushAt.y, gallery.brushAt.z);
    brush.rotation.z = Math.PI / 2;
    brush.rotation.y = 0.4;
    brush.userData = {
      type: 'gear',
      gear: 'brush',
      floorY: gallery.brushAt.y,
      houseY: 0.02,
      grip: brushGrip,
      tip,
      paint: null,
    };
    holdPose(brush, [0.015, -0.02, -0.05], [Math.PI / 2, 0, 0.2]);
    scene.add(brush);
    enlist(brush);
  }

  const bowWood = wood.clone();
  bowWood.color.set(0x4a3018);
  const stringMat = new THREE.MeshStandardMaterial({ color: 0xd2c4a4, roughness: 0.55 });
  const fletchMat = new THREE.MeshStandardMaterial({ color: 0x8d2e2a, roughness: 0.7 });
  const bow = new THREE.Group();
  const riser = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.038), bowWood);
  bow.add(riser);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.11, 8), leatherDark);
  bow.add(wrap);
  const bowHasModel = !!(gearModels && assets.gltf('bow'));
  const tipHigh = new THREE.Vector3(0, 0.66, bowHasModel ? 0.304 : 0.34);
  const tipLow = new THREE.Vector3(0, -0.54, bowHasModel ? 0.304 : 0.3);
  const nockRest = new THREE.Vector3(0, 0.04, 0.28);
  const shelf = new THREE.Vector3(0, 0.04, 0.02);
  const limbs = [];
  const addLimb = (from, to) => {
    const steps = 4;
    for (let i = 0; i < steps; i += 1) {
      const a = new THREE.Vector3().lerpVectors(from, to, i / steps);
      const b = new THREE.Vector3().lerpVectors(from, to, (i + 1) / steps);
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012 - (i / steps) * 0.005, 0.014 - (i / steps) * 0.005, 1, 6),
        bowWood,
      );
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      seg.scale.y = a.distanceTo(b);
      seg.castShadow = true;
      bow.add(seg);
      limbs.push(seg);
    }
  };
  addLimb(new THREE.Vector3(0, 0.1, 0.01), tipHigh);
  addLimb(new THREE.Vector3(0, -0.1, 0.01), tipLow);
  if (bowHasModel) {
    hideParts([riser, wrap, ...limbs]);
    addModel(bow, 'bow');
  }
  const stringHigh = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 1, 5), stringMat);
  const stringLow = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 1, 5), stringMat);
  bow.add(stringHigh, stringLow);
  const upAxis = new THREE.Vector3(0, 1, 0);
  const nock = new THREE.Vector3().copy(nockRest);
  const spanTo = (mesh, a, b) => {
    tmp.copy(b).sub(a);
    const len = Math.max(0.02, tmp.length());
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(upAxis, tmp.multiplyScalar(1 / len));
    mesh.scale.set(1, len, 1);
  };
  const makeArrow = () => {
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.62, 6), wood);
    shaft.position.y = 0.31;
    arrow.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 6), metal);
    head.position.y = 0.65;
    arrow.add(head);
    const vanes = [];
    for (let i = 0; i < 3; i += 1) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.09, 0.028), fletchMat);
      vane.position.set(0, 0.06, 0);
      vane.rotation.y = i * (Math.PI * 2 / 3);
      arrow.add(vane);
      vanes.push(vane);
    }
    if (gearModels && assets.gltf('arrow')) {
      hideParts([shaft, head, ...vanes]);
      addModel(arrow, 'arrow');
    }
    arrow.userData.arrow = true;
    return arrow;
  };
  const nocked = makeArrow();
  bow.add(nocked);
  const quiver = [];
  for (let i = 0; i < 6; i += 1) {
    const arrow = makeArrow();
    arrow.visible = false;
    scene.add(arrow);
    quiver.push(arrow);
  }
  const arrowRay = new THREE.Raycaster();
  const arrowPrev = new THREE.Vector3();
  const arrowAim = new THREE.Vector3();
  bow.position.set(2.35, cave.floor + 0.56, -3.85);
  bow.rotation.y = 0.8;
  bow.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  bow.userData = { type: 'gear', gear: 'bow', floorY: cave.floor + 0.56, houseY: 0.58 };
  holdPose(bow, [0, -0.03, -0.02], [0.15, 0, 0]);
  scene.add(bow);
  enlist(bow);

  function poseArrow(arrow, from, toward) {
    arrowAim.copy(toward).sub(from);
    const len = arrowAim.length() || 1;
    arrowAim.multiplyScalar(1 / len);
    arrow.position.copy(from);
    arrow.quaternion.setFromUnitVectors(upAxis, arrowAim);
  }

  function poseString() {
    spanTo(stringHigh, tipHigh, nock);
    spanTo(stringLow, tipLow, nock);
    poseArrow(nocked, nock, shelf);
  }
  poseString();

  function handWorld(controller, target) {
    const gripPoint = controller.userData?.grip || controller;
    gripPoint.getWorldPosition(target);
    return target;
  }

  function tryDraw(controller) {
    if (!bow.userData.carried || drawHand || vrHands.get(controller) === bow || vrHands.has(controller)) return false;
    bow.updateWorldMatrix(true, true);
    const rest = tmp2.copy(nockRest);
    bow.localToWorld(rest);
    handWorld(controller, tmp);
    if (tmp.distanceTo(rest) > 0.36) return false;
    drawHand = controller;
    drawTickSent = false;
    drawRumbleAt = 0;
    return true;
  }

  function releaseDraw(controller) {
    if (drawHand !== controller) return false;
    const power = nock.z - nockRest.z;
    drawHand = null;
    if (power > 0.16) loose(power);
    else {
      nock.copy(nockRest);
      poseString();
      if (!legacy('bow')) onHaptic?.(controller, 0.22, 28);
    }
    return true;
  }

  function loose(power) {
    if (!legacy('bow')) arrowMask = null;
    let arrow = quiver.find((item) => !item.visible);
    if (!arrow) {
      arrow = makeArrow();
      scene.add(arrow);
      quiver.push(arrow);
    }
    if (arrow.parent !== scene) scene.attach(arrow);
    bow.updateWorldMatrix(true, true);
    const from = tmp.copy(nock);
    const to = tmp2.copy(shelf);
    bow.localToWorld(from);
    bow.localToWorld(to);
    arrowAim.copy(to).sub(from);
    if (arrowAim.lengthSq() < 1e-6) arrowAim.set(0, 0, -1);
    arrowAim.normalize();
    const speed = 8 + Math.min(power, 0.58) * 18;
    arrow.visible = true;
    arrow.userData.vel = arrowAim.clone().multiplyScalar(speed);
    arrow.userData.life = 4.2;
    arrow.userData.stuck = false;
    arrow.userData.stuckFish = false;
    arrow.userData.stuckBird = false;
    arrow.userData.hurt = false;
    arrow.userData.launchFrom = to.clone();
    poseArrow(arrow, from, to);
    nock.copy(nockRest);
    poseString();
    if (onLoose) onLoose();
  }

  function birdHost(object) {
    let node = object;
    while (node) {
      if (node.userData?.bird) return node;
      node = node.parent;
    }
    return null;
  }

  function fishHost(object) {
    let node = object;
    while (node) {
      if (node.userData?.fishHost) return node.userData.fishHost;
      if (node.userData?.sea) return node;
      node = node.parent;
    }
    return null;
  }

  function arrowHit(hit) {
    let node = hit.object;
    while (node) {
      if (node === bow || node.userData?.arrow) return null;
      if (node.userData?.hp != null && !node.userData.dead && node.userData.role !== 'held') return node;
      node = node.parent;
    }
    if (hit.object.userData?.type === 'ui' || hit.object.userData?.gear === 'menu') return 'skip';
    return hit;
  }

  let arrowMask = null;
  function blocksArrow(mesh) {
    let node = mesh;
    while (node) {
      if (node.userData?.noArrow || node.userData?.arrow || node.userData?.fishHost) return false;
      if (node === bow) return false;
      for (const held of vrHands.values()) {
        if (node === held) return false;
      }
      node = node.parent;
    }
    return true;
  }
  function arrowSolids() {
    if (arrowMask) return arrowMask;
    arrowMask = [];
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      let node = obj;
      let attached = false;
      while (node) {
        if (node === scene) {
          attached = true;
          break;
        }
        node = node.parent;
      }
      if (!attached) return;
      if (obj.userData?.water || obj.userData?.backdrop) return;
      if (!blocksArrow(obj)) return;
      const count = obj.geometry.attributes?.position?.count || 0;
      if (count > 2500 && !obj.userData?.fishBody) return;
      arrowMask.push(obj);
    });
    return arrowMask;
  }

  const puffs = [];
  const dustMap = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(214, 202, 184, 0.9)');
    glow.addColorStop(0.4, 'rgba(168, 154, 136, 0.4)');
    glow.addColorStop(1, 'rgba(140, 128, 112, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  })();
  const dustNormal = new THREE.Vector3();

  function puff(point, normal) {
    dustNormal.copy(normal && normal.lengthSq() > 1e-6 ? normal : tmp.set(0, 1, 0)).normalize();
    for (let i = 0; i < 7; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: dustMap,
        transparent: true,
        depthWrite: false,
        opacity: 0.75,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(point).addScaledVector(dustNormal, 0.03);
      const size = 0.05 + Math.random() * 0.09;
      sprite.scale.setScalar(size);
      scene.add(sprite);
      const spray = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      if (spray.dot(dustNormal) < 0) spray.negate();
      spray.addScaledVector(dustNormal, 0.85).normalize();
      puffs.push({
        mesh: sprite,
        v: spray.multiplyScalar(0.45 + Math.random() * 0.9),
        life: 0.32 + Math.random() * 0.22,
        age: 0,
        grow: size,
      });
    }
    if (onStrike) onStrike();
  }

  function landArrow(arrow, point, normal) {
    puff(point, normal);
    arrow.userData.vel = null;
    arrow.userData.stuck = true;
  }

  function updateArrows(dt) {
    if (drawHand && bow.userData.carried) {
      handWorld(drawHand, tmp);
      bow.worldToLocal(tmp);
      const pull = Math.min(Math.max(tmp.z - nockRest.z, 0), 0.58);
      let dx = tmp.x - nockRest.x;
      let dy = tmp.y - nockRest.y;
      const side = Math.hypot(dx, dy) || 1;
      const cap = 0.14;
      if (side > cap) {
        dx *= cap / side;
        dy *= cap / side;
      }
      nock.set(nockRest.x + dx, nockRest.y + dy, nockRest.z + pull);
      poseString();
      if (!legacy('bow')) {
        const drawn = nock.z - nockRest.z;
        if (!drawTickSent && drawn >= 0.16) {
          drawTickSent = true;
          onHaptic?.(drawHand, 0.25, 15);
        }
        if (drawn > 0.4) {
          const now = performance.now();
          if (now - drawRumbleAt >= 80) {
            drawRumbleAt = now;
            onHaptic?.(drawHand, 0.1 + 0.4 * (drawn / 0.58), 20);
          }
        }
      }
    } else if (!drawHand) {
      nock.copy(nockRest);
      poseString();
    }
    for (const arrow of quiver) {
      if (!arrow.visible || !arrow.userData.vel) continue;
      if (arrow.userData.stuckFish || arrow.userData.stuckBird) continue;
      arrow.userData.life -= dt;
      if (arrow.userData.life <= 0) {
        if (!arrow.userData.stuck) puff(arrow.position, tmp.set(0, 1, 0));
        arrow.visible = false;
        arrow.userData.vel = null;
        continue;
      }
      if (arrow.userData.stuck) continue;
      const vel = arrow.userData.vel;
      vel.y -= 9.2 * dt;
      const step = vel.length() * dt;
      if (step < 1e-5) continue;
      arrowPrev.copy(arrow.position);
      tmp.set(0, 1, 0).applyQuaternion(arrow.quaternion);
      arrowPrev.addScaledVector(tmp, 0.66);
      arrow.position.addScaledVector(vel, dt);
      if (arrow.position.y < -7.95) {
        arrow.position.y = -7.95;
        arrow.visible = false;
        landArrow(arrow, arrow.position, tmp.set(0, 1, 0));
        continue;
      }
      arrowAim.copy(vel).multiplyScalar(1 / (vel.length() || 1));
      if (arrow.userData.launchFrom) {
        const shelfPoint = arrow.userData.launchFrom;
        if (shelfPoint.dot(arrowAim) > arrowPrev.dot(arrowAim)) arrowPrev.copy(shelfPoint);
        arrow.userData.launchFrom = null;
      }
      arrow.quaternion.setFromUnitVectors(upAxis, arrowAim);
      arrowRay.set(arrowPrev, arrowAim);
      arrowRay.far = step + 0.08;
      const hits = arrowRay.intersectObjects(arrowSolids(), true);
      for (const hit of hits) {
        if (hit.distance > arrowRay.far) break;
        const found = arrowHit(hit);
        if (!found || found === 'skip') continue;
        if (found !== hit && !arrow.userData.hurt) {
          arrow.userData.hurt = true;
          hurt(found);
        }
        arrow.position.copy(hit.point).addScaledVector(arrowAim, -0.66);
        if (hit.face) dustNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        else dustNormal.set(0, 1, 0);
        puff(hit.point, dustNormal);
        const bird = birdHost(hit.object);
        if (bird) {
          if (!bird.userData.dead) {
            bird.userData.dead = true;
            bird.userData.vx = arrowAim.x * 3.2;
            bird.userData.vz = arrowAim.z * 3.2;
            bird.userData.vy = 1.1;
            bird.userData.spin = arrowAim.x > 0 ? 3.2 : -3.2;
          }
          bird.attach(arrow);
          arrow.userData.stuckBird = true;
          arrow.userData.stuck = true;
          break;
        }
        const host = fishHost(hit.object);
        if (host) {
          host.attach(arrow);
          arrow.userData.stuckFish = true;
          host.userData.arrowHits = (host.userData.arrowHits || 0) + 1;
          if (host.userData.arrowHits >= 3) host.userData.dead = true;
        } else {
          arrow.userData.life = Math.min(arrow.userData.life, 2.4);
        }
        arrow.userData.stuck = true;
        break;
      }
    }
  }

  const roughWood = gearModels ? assets.material('rough_wood') : null;
  const plankMat = roughWood ? roughWood.clone() : wood;
  if (roughWood) plankMat.color.set(0xc49a74);
  for (let i = 0; i < 5; i += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.56), plankMat);
    plank.position.set(2.28, 0.66 + i * 0.12, 0.12);
    plank.castShadow = true;
    plank.receiveShadow = true;
    plank.userData = { type: 'gear', gear: 'board', hp: 1, dead: false };
    if (roughWood) applyWorldUv(plank, 0.5);
    scene.add(plank);
    enlist(plank);
    choppables.push(plank);
  }

  const bag = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.16), leather);
  body.castShadow = true;
  bag.add(body);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.02), leatherDark);
  flap.geometry.translate(0, -0.08, 0);
  flap.position.set(0, 0.11, 0.07);
  flap.castShadow = true;
  bag.add(flap);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 14, Math.PI), leatherDark);
  strap.rotation.y = Math.PI / 2;
  strap.position.set(0, 0.12, 0);
  bag.add(strap);
  if (gearModels && assets.gltf('bag')) {
    hideParts([body, flap, strap]);
    addModel(bag, 'bag');
  }
  bag.position.set(1.85, cave.floor + 0.11, -3.7);
  bag.rotation.y = 0.5;
  bag.userData = { type: 'gear', gear: 'bag', floorY: cave.floor + 0.11, houseY: 0.12 };
  scene.add(bag);
  enlist(bag);

  const menu = new THREE.Group();
  menu.userData = { type: 'gear', gear: 'menu' };
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.012), leatherDark);
  menu.add(panel);
  const cell = 0.046;
  const origin = -cell * 4.5;
  const iconGeo = new THREE.PlaneGeometry(0.034, 0.04);
  for (let i = 0; i < CAPACITY; i += 1) {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.012), pocketMat.clone());
    const col = i % 10;
    const row = Math.floor(i / 10);
    pocket.position.set(origin + col * cell, origin + (9 - row) * cell, 0.01);
    pocket.userData = { type: 'gear', gear: 'pocket', index: i };
    const tileIcon = new THREE.Mesh(iconGeo, pocketMat);
    tileIcon.position.z = 0.01;
    tileIcon.visible = false;
    pocket.add(tileIcon);
    const axeIcon = new THREE.Mesh(iconGeo, axeMat);
    axeIcon.position.z = 0.01;
    axeIcon.visible = false;
    pocket.add(axeIcon);
    pocket.userData.tileIcon = tileIcon;
    pocket.userData.axeIcon = axeIcon;
    menu.add(pocket);
    pocketMeshes.push(pocket);
  }
  menu.visible = false;
  menu.position.set(0, -40, 0);
  scene.add(menu);

  const tileMat = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.55 });
  const roundedTiles = !!assets?.feature('props4');
  const tileBodyGeo = roundedTiles ? new RoundedBoxGeometry(0.072, 0.104, 0.016, 2, 0.004) : null;
  const tileFaceGeo = roundedTiles ? new THREE.PlaneGeometry(0.064, 0.096) : null;
  for (let rank = 1; rank <= 9; rank += 1) {
    const tile = new THREE.Group();
    const faceMat = new THREE.MeshStandardMaterial({ map: paintTile(rank), roughness: 0.5 });
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.072, 0.104, 0.016),
      roundedTiles ? proxyMaterial : [tileMat, tileMat, tileMat, tileMat, faceMat, tileMat],
    );
    if (roundedTiles) face.castShadow = false;
    tile.add(face);
    if (roundedTiles) {
      const body = new THREE.Mesh(tileBodyGeo, tileMat);
      body.raycast = () => {};
      body.castShadow = true;
      const printed = new THREE.Mesh(tileFaceGeo, faceMat);
      printed.raycast = () => {};
      printed.position.z = 0.0081;
      tile.add(body, printed);
    }
    tile.userData = {
      type: 'gear',
      gear: 'tile',
      rank,
      floorY: 0.052,
      faceMat,
      inBag: false,
      pocket: null,
      slot: null,
    };
    holdPose(tile, [0, -0.03, -0.1], [-1.05, 0, 0]);
    scene.add(tile);
    stow(tile);
  }

  const crab = new THREE.Group();
  const carapace = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), shellMat);
  carapace.scale.set(1.35, 0.5, 1.05);
  carapace.castShadow = true;
  crab.add(carapace);
  [-1, 1].forEach((side) => {
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.05), shellMat);
    claw.position.set(side * 0.12, 0.01, 0.06);
    claw.rotation.y = side * -0.5;
    crab.add(claw);
    for (let leg = 0; leg < 3; leg += 1) {
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.016), shellMat);
      limb.position.set(side * 0.12, -0.01, -0.02 - leg * 0.03);
      limb.rotation.z = side * 0.7;
      crab.add(limb);
    }
  });
  crab.position.set(1.92, 0.05, -0.55);
  crab.rotation.y = 0.8;
  if (gearModels && assets.gltf('crab')) {
    crab.traverse((child) => {
      if (!child.isMesh) return;
      child.material = proxyMaterial;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    addModel(crab, 'crab');
  }
  crab.userData = { type: 'gear', gear: 'crab', hp: 2, dead: false };
  scene.add(crab);
  enlist(crab);
  choppables.push(crab);

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.28, 0.28), stone);
  plinth.position.set(puzzleX, deck + 0.14, puzzleZ);
  const floorRock = assets?.feature('props4') ? assets.material('rock_floor') : null;
  if (floorRock) {
    plinth.material = floorRock.clone();
    applyWorldUv(plinth, 2.0);
  }
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);
  for (let i = 0; i < 9; i += 1) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.11), stone);
    slot.position.set(puzzleX - 0.42 + i * 0.105, deck + 0.29, puzzleZ);
    slot.userData = { type: 'gear', gear: 'slot', index: i, filled: 0 };
    scene.add(slot);
    enlist(slot);
    slots.push(slot);
  }

  const chest = new THREE.Group();
  chest.position.set(puzzleX + 0.84, deck, puzzleZ);
  const chestBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), wood);
  chestBody.position.y = 0.1;
  chestBody.castShadow = true;
  chest.add(chestBody);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.26), wood);
  lid.geometry.translate(0, 0.02, 0.13);
  lid.position.set(0, 0.2, -0.12);
  lid.castShadow = true;
  chest.add(lid);
  let chestLid = null;
  if (gearModels && assets.gltf('chest')) {
    hideParts([chestBody, lid]);
    const chestVis = addModel(chest, 'chest');
    chestLid = chestVis?.getObjectByName('treasure_chest_lid') || null;
  }
  chest.userData = { open: 0 };
  scene.add(chest);
  refreshPockets();

  function refreshPockets() {
    pocketMeshes.forEach((pocket, index) => {
      const item = pockets[index];
      pocket.material.color.set(item ? 0x8d7358 : 0x2c241c);
      pocket.userData.tileIcon.visible = item?.userData.gear === 'tile';
      pocket.userData.axeIcon.visible = item?.userData.gear === 'hatchet';
      if (item?.userData.gear === 'tile') pocket.userData.tileIcon.material = item.userData.faceMat;
    });
  }

  function firstEmpty() {
    return pockets.indexOf(null);
  }

  function forget(item) {
    for (const [hand, carried] of vrHands) {
      if (carried === item) vrHands.delete(hand);
    }
    if (item === bow) drawHand = null;
    item.userData.carried = false;
  }

  function clearSeat(item) {
    if (!item.userData.slot) return;
    item.userData.slot.userData.filled = 0;
    item.userData.slot = null;
    checkLock();
  }

  function releasePocket(item) {
    const index = item.userData.pocket;
    if (index == null || pockets[index] !== item) return;
    pockets[index] = null;
    item.userData.pocket = null;
    item.userData.inBag = false;
  }

  function stow(item) {
    const index = firstEmpty();
    if (index < 0 || !carryable(item)) return false;
    const fresh = !item.userData.carried && !item.userData.inBag;
    clearSeat(item);
    forget(item);
    releasePocket(item);
    item.userData.inBag = true;
    item.userData.pocket = index;
    item.userData.carried = false;
    pockets[index] = item;
    unlist(item);
    item.visible = false;
    bladeReady = false;
    scene.attach(item);
    item.position.set(0, -30, 0);
    refreshPockets();
    if (fresh && onPickup) onPickup();
    return true;
  }

  function layDown(item, point, faceYaw) {
    clearSeat(item);
    forget(item);
    releasePocket(item);
    item.visible = true;
    scene.attach(item);
    item.position.set(
      point.x + (Math.random() - 0.5) * 0.08,
      point.y > -1.5 && item.userData.houseY != null ? item.userData.houseY : (item.userData.floorY ?? 0.03),
      point.z + (Math.random() - 0.5) * 0.08,
    );
    if (item.userData.gear === 'tile' && faceYaw != null) item.rotation.set(0, faceYaw, 0);
    else item.rotation.copy(item.userData.restRot);
    item.userData.carried = false;
    if (item.userData.grip) item.userData.grip.visible = false;
    item.userData.inBag = false;
    bladeReady = false;
    enlist(item);
    refreshPockets();
  }

  function dropInFront(controller) {
    controller.getWorldPosition(tmp);
    tmp2.set(0, 0, -1).applyQuaternion(controller.quaternion);
    tmp2.y = 0;
    if (tmp2.lengthSq() < 1e-4) tmp2.set(0, 0, -1);
    tmp2.normalize();
    const yaw = Math.atan2(-tmp2.x, -tmp2.z);
    tmp.addScaledVector(tmp2, 0.35);
    return { point: tmp.clone(), yaw };
  }

  function take(who, item) {
    if (!carryable(item)) return false;
    const previous = vrHands.get(who);
    if (previous && previous !== item) {
      if (!stow(previous)) {
        const spot = dropInFront(who);
        layDown(previous, spot.point, spot.yaw);
      }
    }
    clearSeat(item);
    forget(item);
    releasePocket(item);
    who.attach(item);
    item.visible = true;
    item.position.copy(item.userData.holdPos);
    item.rotation.copy(item.userData.holdRot);
    item.userData.carried = true;
    if (item.userData.grip) item.userData.grip.visible = true;
    item.userData.inBag = false;
    unlist(item);
    vrHands.set(who, item);
    bladeReady = false;
    refreshPockets();
    return true;
  }

  function acquireBag() {
    if (owned) return false;
    owned = true;
    bag.visible = false;
    unlist(bag);
    for (const who of [...vrHands.keys()]) stow(vrHands.get(who));
    if (onPickup) onPickup();
    return true;
  }

  function pickTarget(owner, controller, points) {
    if (owner && !owner.userData.carried && !owner.userData.inBag && (owner.userData.gear === 'bag' ? !owned : carryable(owner))) {
      owner.getWorldPosition(tmp);
      controller.getWorldPosition(tmp2);
      if (tmp.distanceTo(tmp2) < 1.5) return owner;
    }
    let best = null;
    let bestDist = 0.26;
    const pool = [hatchet, bag];
    for (const item of targets) pool.push(item);
    const seen = new Set();
    for (const item of pool) {
      if (seen.has(item) || item.userData?.carried || item.userData?.inBag) continue;
      const isBag = item.userData?.gear === 'bag' && !owned;
      if (!isBag && !carryable(item)) continue;
      seen.add(item);
      item.getWorldPosition(tmp);
      for (const point of points) {
        const dist = tmp.distanceTo(point);
        if (dist < bestDist) {
          bestDist = dist;
          best = item;
        }
      }
    }
    return best;
  }

  function tryGrip(controller, points, owner) {
    const target = pickTarget(owner, controller, points);
    if (!target) return false;
    if (target.userData.gear === 'bag') return acquireBag();
    if (target.userData.gear === 'bow') return take(controller, target);
    if (owned && stow(target)) return true;
    return take(controller, target);
  }

  function stowHand(who) {
    const item = vrHands.get(who);
    if (!item) return false;
    if (owned && stow(item)) return true;
    const spot = dropInFront(who);
    layDown(item, spot.point, spot.yaw);
    return true;
  }

  function menuOwner(owner) {
    if (!menuOpen || !owner) return null;
    const gear = owner.userData?.gear;
    if (gear === 'pocket' || gear === 'menu') return owner;
    return null;
  }

  function pocketItem(owner) {
    const hit = menuOwner(owner);
    if (!hit || hit.userData.gear !== 'pocket') return null;
    return pockets[hit.userData.index] || null;
  }

  function equipPocket(owner, controller) {
    const hit = menuOwner(owner);
    if (!hit) return false;
    if (hit.userData.gear === 'pocket') {
      const item = pockets[hit.userData.index];
      if (item) take(controller, item);
    }
    return true;
  }

  function dropPocket(owner, controller) {
    const hit = menuOwner(owner);
    if (!hit || hit.userData.gear !== 'pocket') return false;
    const item = pockets[hit.userData.index];
    if (!item) return false;
    const spot = dropInFront(controller);
    layDown(item, spot.point, spot.yaw);
    return true;
  }

  function placeMenu() {
    camera.getWorldPosition(tmp);
    camera.getWorldDirection(tmp2);
    const flat = tmp2.clone();
    flat.y = 0;
    if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
    flat.normalize();
    menu.position.set(tmp.x + flat.x * 0.72, tmp.y - 0.08, tmp.z + flat.z * 0.72);
    menu.rotation.set(0, Math.atan2(-flat.x, -flat.z), 0);
  }

  function toggleMenu() {
    if (!owned) return false;
    menuOpen = !menuOpen;
    menu.visible = menuOpen;
    if (menuOpen) {
      placeMenu();
      enlist(menu);
    } else {
      unlist(menu);
      menu.position.set(0, -40, 0);
    }
    return true;
  }

  function spawnChips(object, count = 6, scale = 1) {
    object.getWorldPosition(tmp);
    for (let i = 0; i < count; i += 1) {
      const long = scale > 1 && Math.random() > 0.45;
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(0.03 * scale * (long ? 3.2 : 1), 0.012 * scale, 0.02 * scale * (long ? 1.4 : 2.2)),
        wood,
      );
      chip.position.copy(tmp);
      chip.rotation.set(Math.random() * 4, Math.random() * 4, Math.random() * 4);
      scene.add(chip);
      chips.push({
        mesh: chip,
        v: new THREE.Vector3(
          (Math.random() - 0.5) * 1.6 * scale,
          0.8 + Math.random() * scale,
          (Math.random() - 0.5) * 1.6 * scale,
        ),
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14),
        life: 0.45 + Math.random() * 0.35 * scale,
        floor: tmp.y > 2 ? deck + 0.02 : 0.02,
      });
    }
  }

  function burstCrate(object) {
    object.getWorldPosition(tmp);
    spawnChips(object, 22, 1.8);
    object.visible = false;
    scene.remove(object);
    if (!legacy('bow')) arrowMask = null;
  }

  function hurt(object) {
    if (!object || object.userData.dead || object.userData.role === 'held') return;
    object.userData.hp -= 1;
    const broken = object.userData.hp <= 0;
    if (broken && object.userData.gear === 'crate') burstCrate(object);
    else spawnChips(object, object.userData.gear === 'crate' ? 10 : 6, object.userData.gear === 'crate' ? 1.35 : 1);
    if (onChop) onChop(broken && object.userData.gear === 'crate');
    if (!broken) {
      if (object.userData.gear !== 'crate') object.rotation.z += 0.15;
      return;
    }
    object.userData.dead = true;
    unlist(object);
    const index = choppables.indexOf(object);
    if (index >= 0) choppables.splice(index, 1);
    if (object.userData.gear === 'board') {
      object.userData.falling = true;
      object.userData.vy = 0.6;
      falls.push(object);
    } else if (object.userData.gear === 'crab') {
      object.rotation.z = 1.2;
      object.position.y = 0.03;
    }
  }

  function segmentTouches(box, a, b) {
    for (let i = 0; i <= 6; i += 1) {
      tmp3.lerpVectors(a, b, i / 6);
      if (box.containsPoint(tmp3)) return true;
    }
    return false;
  }

  function swingHit(a, b) {
    const now = performance.now() / 1000;
    const list = [];
    const seen = new Set();
    for (const object of choppables) {
      if (object.userData.dead || object.userData.role === 'held') continue;
      seen.add(object);
      list.push(object);
    }
    for (const object of targets) {
      if (!object.userData?.choppable || seen.has(object) || object.userData.dead || object.userData.role === 'held') continue;
      list.push(object);
    }
    for (const object of list) {
      if (object.userData.chopAt && now - object.userData.chopAt < 0.4) continue;
      hitBox.setFromObject(object);
      hitBox.expandByScalar(object.userData.gear === 'crate' ? 0.04 : 0.06);
      if (!segmentTouches(hitBox, a, b)) continue;
      object.userData.chopAt = now;
      hurt(object);
    }
  }

  function pointedSlot(controller) {
    controller.getWorldPosition(tmp);
    tmp2.set(0, 0, -1).applyQuaternion(controller.quaternion);
    let best = null;
    let bestDist = 0.14;
    for (const slot of slots) {
      if (slot.userData.filled) continue;
      slot.getWorldPosition(tmp3);
      const along = tmp3.clone().sub(tmp).dot(tmp2);
      if (along < 0.05 || along > 1.6) continue;
      const dist = tmp.clone().addScaledVector(tmp2, along).distanceTo(tmp3);
      if (dist < bestDist) {
        bestDist = dist;
        best = slot;
      }
    }
    return best;
  }

  function seat(tile, slot) {
    forget(tile);
    releasePocket(tile);
    clearSeat(tile);
    tile.visible = true;
    scene.attach(tile);
    slot.attach(tile);
    tile.position.set(0, 0.02, 0);
    tile.rotation.set(-Math.PI / 2, 0, 0);
    tile.userData.slot = slot;
    tile.userData.carried = false;
    tile.userData.inBag = false;
    slot.userData.filled = tile.userData.rank;
    enlist(tile);
    refreshPockets();
    checkLock();
  }

  function checkLock() {
    const solved = slots.every((slot, index) => slot.userData.filled === index + 1);
    chest.userData.want = solved ? 1 : 0;
  }

  function use(controller) {
    const item = vrHands.get(controller);
    if (!item || item.userData.gear !== 'tile') return false;
    const slot = pointedSlot(controller);
    if (!slot) return false;
    seat(item, slot);
    return true;
  }

  function update(dt) {
    const carried = hatchet.userData.carried;
    if (!carried) bladeReady = false;
    else {
      hatchet.updateWorldMatrix(true, true);
      blade.getWorldPosition(bladeNow);
      if (!bladeLogged && hatchet.userData.hatchetModel) {
        bladeLogged = true;
        const modelBox = new THREE.Box3().setFromObject(hatchet.userData.hatchetModel);
        console.info('[hatchet] held blade', bladeNow.toArray(), 'model bbox', modelBox.min.toArray(), modelBox.max.toArray(), 'inside', modelBox.containsPoint(bladeNow));
      }
      if (bladeReady && dt > 0) {
        const speed = bladeNow.distanceTo(bladePrev) / dt;
        if (speed > 2.1) swingHit(bladePrev, bladeNow);
      }
      bladePrev.copy(bladeNow);
      bladeReady = true;
    }
    if (torch.visible && torch.userData.light) {
      const wobble = 0.82 + Math.sin(performance.now() * 0.017) * 0.1 + Math.sin(performance.now() * 0.043) * 0.06;
      torch.userData.light.intensity = 8 * wobble;
      const flare = 0.92 + wobble * 0.1;
      torch.userData.flame.scale.set(flare, 0.85 + wobble * 0.2, flare);
      torch.userData.halo.scale.setScalar(0.9 + wobble * 0.25);
    }
    if (gallery) {
      if (torch.visible) {
        torch.userData.flame.getWorldPosition(paintTip);
        gallery.nearFire(paintTip);
      }
      if (brush.userData.carried && brush.userData.tip) {
        brush.updateWorldMatrix(true, true);
        brush.userData.tip.getWorldPosition(paintTip);
        const dipped = gallery.dip(paintTip);
        if (dipped) {
          brush.userData.paint = dipped;
          bristleMat.color.set(dipped);
          bristleMat.emissive.set(dipped);
          bristleMat.emissiveIntensity = 0.45;
        }
        if (brush.userData.paint) gallery.paint(paintTip, brush.userData.paint);
      }
    }
    const want = chest.userData.want || 0;
    chest.userData.open = THREE.MathUtils.damp(chest.userData.open, want, 4, dt);
    lid.rotation.x = -chest.userData.open * 1.35;
    if (chestLid) chestLid.rotation.x = lid.rotation.x;
    for (const plank of falls) {
      plank.userData.vy -= 9.2 * dt;
      plank.position.y += plank.userData.vy * dt;
      plank.rotation.x += dt * 2.2;
      if (plank.position.y < 0.05) {
        plank.position.y = 0.05;
        plank.userData.vy = 0;
      }
    }
    for (let i = chips.length - 1; i >= 0; i -= 1) {
      const chip = chips[i];
      chip.life -= dt;
      chip.v.y -= 9.2 * dt;
      chip.mesh.position.addScaledVector(chip.v, dt);
      if (chip.spin) {
        chip.mesh.rotation.x += chip.spin.x * dt;
        chip.mesh.rotation.y += chip.spin.y * dt;
        chip.mesh.rotation.z += chip.spin.z * dt;
      }
      const floor = chip.floor ?? 0.02;
      if (chip.mesh.position.y < floor) {
        chip.mesh.position.y = floor;
        chip.v.y *= -0.25;
      }
      if (chip.life <= 0) {
        scene.remove(chip.mesh);
        chips.splice(i, 1);
      }
    }
    updateArrows(dt);
    for (let i = puffs.length - 1; i >= 0; i -= 1) {
      const mote = puffs[i];
      mote.age += dt;
      const k = mote.age / mote.life;
      if (k >= 1) {
        scene.remove(mote.mesh);
        mote.mesh.material.dispose();
        puffs.splice(i, 1);
        continue;
      }
      mote.v.y -= 1.4 * dt;
      mote.mesh.position.addScaledVector(mote.v, dt);
      mote.mesh.scale.setScalar(mote.grow * (1 + k * 2.4));
      mote.mesh.material.opacity = 0.72 * (1 - k);
    }
  }

  return {
    update,
    ownsBag: () => owned,
    toggleMenu,
    equipPocket,
    pocketItem,
    dropPocket,
    isHolding(who) {
      return vrHands.has(who);
    },
    tryGrip,
    tryDraw,
    releaseDraw,
    drawing: () => !!drawHand,
    stowHand,
    use,
    dropDesktop() {
      return false;
    },
    useDesktop() {
      return false;
    },
    pointer() {
      return false;
    },
    setSounds(sounds) {
      onPickup = sounds?.pickup || null;
      onChop = sounds?.chop || null;
      onLoose = sounds?.loose || null;
      onStrike = sounds?.strike || null;
      onDip = sounds?.dip || null;
    },
    setHaptics(fn) {
      onHaptic = fn || null;
    },
    hatchet,
    bag,
    crab,
  };
}
