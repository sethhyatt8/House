import * as THREE from 'three';

const CHARACTERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

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

function carryable(object) {
  const gear = object?.userData?.gear;
  return gear === 'hatchet' || gear === 'bag' || gear === 'tile';
}

export function createGear(scene, camera, targets) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6d4c32, roughness: 0.78 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb7b8b4, roughness: 0.42, metalness: 0.55 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3824, roughness: 0.86 });
  const leatherDark = new THREE.MeshStandardMaterial({ color: 0x3e2618, roughness: 0.9 });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x8d3a2a, roughness: 0.62 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x7d756c, roughness: 0.95 });
  const raycaster = new THREE.Raycaster();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();
  const desktop = { item: null };
  const vrHands = new Map();
  const choppables = [];
  const slots = [];
  const chips = [];
  const falls = [];

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
  hatchet.userData = { type: 'gear', gear: 'hatchet', floorY: 0.04, blade, swing: 0, struck: false };
  holdPose(hatchet, [0.02, -0.06, -0.22], [-Math.PI / 2, 0, 0.15]);
  scene.add(hatchet);
  enlist(hatchet);

  const boards = [];
  for (let i = 0; i < 5; i += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.56), wood);
    plank.position.set(2.28, 0.66 + i * 0.12, 0.12);
    plank.castShadow = true;
    plank.receiveShadow = true;
    plank.userData = { type: 'gear', gear: 'board', hp: 1, dead: false };
    scene.add(plank);
    enlist(plank);
    choppables.push(plank);
    boards.push(plank);
  }

  const bag = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.12), leather);
  body.castShadow = true;
  bag.add(body);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.018), leatherDark);
  flap.geometry.translate(0, -0.07, 0);
  flap.position.set(0, 0.09, 0.05);
  flap.castShadow = true;
  bag.add(flap);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.011, 6, 12, Math.PI), leatherDark);
  strap.rotation.y = Math.PI / 2;
  strap.position.set(0, 0.02, 0.01);
  bag.add(strap);
  const spread = new THREE.Group();
  bag.add(spread);
  bag.position.set(2.46, 0.95, 0.12);
  bag.userData = {
    type: 'gear',
    gear: 'bag',
    floorY: 0.1,
    flap,
    spread,
    contents: [],
    open: false,
  };
  holdPose(bag, [0.16, -0.2, -0.48], [0.4, -0.5, 0.2]);
  scene.add(bag);
  enlist(bag);

  const tileMat = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.55 });
  for (let rank = 1; rank <= 9; rank += 1) {
    const tile = new THREE.Group();
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.072, 0.104, 0.016),
      [
        tileMat, tileMat, tileMat, tileMat,
        new THREE.MeshStandardMaterial({ map: paintTile(rank), roughness: 0.5 }),
        tileMat,
      ],
    );
    tile.add(face);
    tile.userData = {
      type: 'gear',
      gear: 'tile',
      rank,
      floorY: 0.02,
      inBag: true,
      bag,
      slot: null,
    };
    holdPose(tile, [0, -0.03, -0.14], [0, 0, 0]);
    spread.add(tile);
    bag.userData.contents.push(tile);
  }
  layoutBag();
  spread.visible = false;

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
  plinth.position.set(-0.55, 0.14, 2.18);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);
  for (let i = 0; i < 9; i += 1) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.11), stone);
    slot.position.set(-0.98 + i * 0.105, 0.29, 2.18);
    slot.userData = { type: 'gear', gear: 'slot', index: i, filled: 0 };
    scene.add(slot);
    enlist(slot);
    slots.push(slot);
  }

  const chest = new THREE.Group();
  chest.position.set(0.22, 0, 2.18);
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

  function layoutBag() {
    bag.userData.contents.forEach((tile, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      tile.position.set(-0.14 - row * 0.11, 0.08, (col - 1) * 0.09);
      tile.rotation.set(0.15, -Math.PI / 2, 0);
    });
  }

  function showBag(open) {
    bag.userData.open = open;
    bag.userData.spread.visible = open;
    const flapAngle = open ? -2.15 : 0;
    bag.userData.flap.rotation.x = flapAngle;
    bag.userData.contents.forEach((tile) => {
      if (open) enlist(tile);
      else unlist(tile);
    });
  }

  function holderOf(item) {
    if (desktop.item === item) return 'desktop';
    for (const [hand, carried] of vrHands) {
      if (carried === item) return hand;
    }
    return null;
  }

  function forget(item) {
    const who = holderOf(item);
    if (who === 'desktop') desktop.item = null;
    else if (who) vrHands.delete(who);
    item.userData.carried = false;
  }

  function unstow(item) {
    if (item.userData.slot) {
      item.userData.slot.userData.filled = 0;
      item.userData.slot = null;
      checkLock();
    }
    if (item.userData.inBag) {
      item.userData.inBag = false;
      const list = item.userData.bag.userData.contents;
      const index = list.indexOf(item);
      if (index >= 0) list.splice(index, 1);
      layoutBag();
    }
  }

  function take(who, item) {
    if (!carryable(item) || item.userData.dead) return false;
    const previous = who === 'desktop' ? desktop.item : vrHands.get(who);
    if (previous && previous !== item) drop(who);
    forget(item);
    unstow(item);
    const parent = who === 'desktop' ? camera : who;
    parent.attach(item);
    item.position.copy(item.userData.holdPos);
    item.rotation.copy(item.userData.holdRot);
    item.userData.carried = true;
    unlist(item);
    if (who === 'desktop') desktop.item = item;
    else vrHands.set(who, item);
    return true;
  }

  function drop(who) {
    const item = who === 'desktop' ? desktop.item : vrHands.get(who);
    if (!item) return false;
    item.getWorldPosition(tmp);
    scene.attach(item);
    const inRoom = tmp.x > -1.7 && tmp.x < 2.6 && tmp.z > -2.55 && tmp.z < 2.55 && tmp.y < 2.4;
    if (inRoom) tmp.y = item.userData.floorY ?? 0.03;
    item.position.copy(tmp);
    item.rotation.copy(item.userData.restRot);
    item.userData.carried = false;
    item.userData.swing = 0;
    enlist(item);
    if (who === 'desktop') desktop.item = null;
    else vrHands.delete(who);
    return true;
  }

  function isHolding(who) {
    return who === 'desktop' ? !!desktop.item : vrHands.has(who);
  }

  function closestCarry(points, reach) {
    let best = null;
    let bestDist = reach;
    const pool = [hatchet, bag, ...bag.userData.contents.filter((tile) => bag.userData.open), ...targets];
    const seen = new Set();
    for (const item of pool) {
      if (!carryable(item) || seen.has(item) || item.userData.carried) continue;
      if (item.userData.gear === 'tile' && item.userData.inBag && !bag.userData.open) continue;
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
    if (owner && carryable(owner) && !owner.userData.carried) {
      if (!(owner.userData.inBag && !bag.userData.open)) {
        owner.getWorldPosition(tmp);
        controller.getWorldPosition(tmp2);
        if (tmp.distanceTo(tmp2) < 1.5) return take(controller, owner);
      }
    }
    const near = closestCarry(points, 0.26);
    if (!near) return false;
    return take(controller, near);
  }

  function spawnChips(object) {
    object.getWorldPosition(tmp);
    for (let i = 0; i < 6; i += 1) {
      const chip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.02), wood);
      chip.position.copy(tmp);
      scene.add(chip);
      chips.push({
        mesh: chip,
        v: new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.8 + Math.random(), (Math.random() - 0.5) * 1.4),
        life: 0.55,
      });
    }
  }

  function hurt(object) {
    if (!object || object.userData.dead) return;
    object.userData.hp -= 1;
    spawnChips(object);
    if (object.userData.hp > 0) {
      object.rotation.z += 0.15;
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

  function asChoppable(object) {
    let current = object;
    while (current) {
      if (choppables.includes(current)) return current;
      current = current.parent;
    }
    return null;
  }

  function strike(fromCamera, controller) {
    if (fromCamera) {
      camera.getWorldPosition(tmp);
      camera.getWorldDirection(tmp2);
      let best = null;
      let bestDist = 0.24;
      for (const object of choppables) {
        object.getWorldPosition(tmp3);
        const along = tmp3.clone().sub(tmp).dot(tmp2);
        if (along < 0.25 || along > 8) continue;
        const dist = tmp.clone().addScaledVector(tmp2, along).distanceTo(tmp3);
        if (dist < bestDist) {
          bestDist = dist;
          best = object;
        }
      }
      if (best) hurt(best);
      return;
    }
    blade.getWorldPosition(tmp);
    let best = null;
    let bestDist = 0.32;
    for (const object of choppables) {
      object.getWorldPosition(tmp2);
      const dist = tmp.distanceTo(tmp2);
      if (dist < bestDist) {
        bestDist = dist;
        best = object;
      }
    }
    if (!best && controller) {
      controller.getWorldPosition(tmp);
      tmp2.set(0, 0, -1).applyQuaternion(controller.quaternion);
      raycaster.set(tmp, tmp2);
      const hits = raycaster.intersectObjects(choppables, true);
      const target = hits[0] && hits[0].distance < 0.9 ? asChoppable(hits[0].object) : null;
      if (target) best = target;
    }
    if (best) hurt(best);
  }

  function nearestSlot(item, reach) {
    item.getWorldPosition(tmp);
    let best = null;
    let bestDist = reach;
    for (const slot of slots) {
      if (slot.userData.filled) continue;
      slot.getWorldPosition(tmp2);
      const dist = tmp.distanceTo(tmp2);
      if (dist < bestDist) {
        bestDist = dist;
        best = slot;
      }
    }
    return best;
  }

  function aimedSlot() {
    camera.getWorldPosition(tmp);
    camera.getWorldDirection(tmp2);
    let best = null;
    let bestDist = 0.4;
    for (const slot of slots) {
      if (slot.userData.filled) continue;
      slot.getWorldPosition(tmp3);
      const along = tmp3.clone().sub(tmp).dot(tmp2);
      if (along < 0.15 || along > 4.5) continue;
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
    unstow(tile);
    scene.attach(tile);
    slot.attach(tile);
    tile.position.set(0, 0.02, 0);
    tile.rotation.set(-Math.PI / 2, 0, 0);
    tile.userData.slot = slot;
    tile.userData.carried = false;
    slot.userData.filled = tile.userData.rank;
    enlist(tile);
    checkLock();
  }

  function checkLock() {
    const solved = slots.every((slot, index) => slot.userData.filled === index + 1);
    chest.userData.want = solved ? 1 : 0;
  }

  function useItem(item, fromCamera, controller) {
    if (!item) return false;
    if (item.userData.gear === 'hatchet') {
      if (item.userData.swing > 0) return true;
      item.userData.swing = 1;
      item.userData.struck = false;
      item.userData.swingFromCamera = fromCamera;
      item.userData.swingController = controller || null;
      return true;
    }
    if (item.userData.gear === 'bag') {
      showBag(!bag.userData.open);
      return true;
    }
    if (item.userData.gear === 'tile') {
      const slot = fromCamera ? aimedSlot() : nearestSlot(item, 0.42);
      if (!slot) return false;
      seat(item, slot);
      return true;
    }
    return false;
  }

  function pointer(owner) {
    if (owner?.userData?.type === 'gear' && owner.userData.gear === 'slot' && desktop.item?.userData.gear === 'tile') {
      if (!owner.userData.filled) seat(desktop.item, owner);
      return true;
    }
    if (!owner || !carryable(owner) || owner.userData.carried) return false;
    if (owner.userData.inBag && !bag.userData.open) return false;
    if (desktop.item?.userData.gear === 'bag' && owner.userData.gear === 'tile' && owner.userData.inBag) {
      drop('desktop');
      take('desktop', owner);
      return true;
    }
    take('desktop', owner);
    return true;
  }

  function update(dt) {
    if (hatchet.userData.swing > 0 && hatchet.userData.carried) {
      const prev = hatchet.userData.swing;
      hatchet.userData.swing = Math.max(0, prev - dt / 0.26);
      const ang = Math.sin((1 - hatchet.userData.swing) * Math.PI) * 1.2;
      hatchet.rotation.x = hatchet.userData.holdRot.x + ang;
      if (prev > 0.42 && hatchet.userData.swing <= 0.42) {
        strike(hatchet.userData.swingFromCamera, hatchet.userData.swingController);
      }
      if (hatchet.userData.swing === 0) hatchet.rotation.copy(hatchet.userData.holdRot);
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
      if (chip.mesh.position.y < 0.02) chip.mesh.position.y = 0.02;
      if (chip.life <= 0) {
        scene.remove(chip.mesh);
        chips.splice(i, 1);
      }
    }
  }

  return {
    update,
    isHolding,
    tryGrip,
    drop,
    dropDesktop() {
      return drop('desktop');
    },
    use(controller) {
      return useItem(vrHands.get(controller), false, controller);
    },
    useDesktop() {
      return useItem(desktop.item, true, null);
    },
    pointer,
    hatchet,
    bag,
    crab,
  };
}
