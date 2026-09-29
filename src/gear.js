import * as THREE from 'three';

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
  return gear === 'hatchet' || gear === 'tile';
}

export function createGear(scene, camera, targets, roof) {
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
  let onPickup = null;
  let onChop = null;
  const deck = roof?.y ?? 0;
  const puzzleX = roof ? (roof.x0 + roof.x1) * 0.5 - 0.15 : -0.55;
  const puzzleZ = roof ? 1.35 : 2.18;

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
  hatchet.userData = { type: 'gear', gear: 'hatchet', floorY: 0.04, blade };
  holdPose(hatchet, [0.02, -0.06, -0.22], [-Math.PI / 2, 0, 0.15]);
  scene.add(hatchet);
  enlist(hatchet);

  for (let i = 0; i < 5; i += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.56), wood);
    plank.position.set(2.28, 0.66 + i * 0.12, 0.12);
    plank.castShadow = true;
    plank.receiveShadow = true;
    plank.userData = { type: 'gear', gear: 'board', hp: 1, dead: false };
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
  bag.position.set(0.42, 0.11, 1.22);
  bag.rotation.y = 0.5;
  bag.userData = { type: 'gear', gear: 'bag', floorY: 0.11 };
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
  for (let rank = 1; rank <= 9; rank += 1) {
    const tile = new THREE.Group();
    const faceMat = new THREE.MeshStandardMaterial({ map: paintTile(rank), roughness: 0.5 });
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.072, 0.104, 0.016),
      [tileMat, tileMat, tileMat, tileMat, faceMat, tileMat],
    );
    tile.add(face);
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
  crab.userData = { type: 'gear', gear: 'crab', hp: 2, dead: false };
  scene.add(crab);
  enlist(crab);
  choppables.push(crab);

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.28, 0.28), stone);
  plinth.position.set(puzzleX, deck + 0.14, puzzleZ);
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
      item.userData.floorY ?? 0.03,
      point.z + (Math.random() - 0.5) * 0.08,
    );
    if (item.userData.gear === 'tile' && faceYaw != null) item.rotation.set(0, faceYaw, 0);
    else item.rotation.copy(item.userData.restRot);
    item.userData.carried = false;
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
      if (bladeReady && dt > 0) {
        const speed = bladeNow.distanceTo(bladePrev) / dt;
        if (speed > 2.1) swingHit(bladePrev, bladeNow);
      }
      bladePrev.copy(bladeNow);
      bladeReady = true;
    }
    const want = chest.userData.want || 0;
    chest.userData.open = THREE.MathUtils.damp(chest.userData.open, want, 4, dt);
    lid.rotation.x = -chest.userData.open * 1.35;
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
  }

  return {
    update,
    ownsBag: () => owned,
    toggleMenu,
    equipPocket,
    dropPocket,
    isHolding(who) {
      return vrHands.has(who);
    },
    tryGrip,
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
    },
    hatchet,
    bag,
    crab,
  };
}
