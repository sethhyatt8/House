// src/croc.js - the cave crocodile (enemy). Tested headless against the real createWorld() in three r180.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { proxyMaterial } from './assets.js';
import { legacy } from './flags.js';

// Measured on models/enemies/croc.glb (metric, faces +Z, root at the belly, feet at y -0.024, snout tip z 1.092, tail tip z -2.313).
const EYES = [[0.056, 0.179, 0.789], [-0.056, 0.179, 0.789]];
const ZONES = [ // name, bone, bind-pose centre (model space), radius
  ['eye', 'head', [0, 0.205, 0.775], 0.085],
  ['skull', 'head', [0, 0.13, 0.62], 0.13],
  ['snout', 'head', [0, 0.085, 0.94], 0.11],
  ['jaw', 'jaw', [0, 0.03, 0.86], 0.09],
  ['body', 'spine1', [0, 0.16, 0.15], 0.25],
  ['body', 'spine2', [0, 0.16, -0.4], 0.24],
  ['tail', 'tail1', [0, 0.14, -0.85], 0.17],
  ['tail', 'tail2', [0, 0.12, -1.4], 0.12],
  ['tail', 'tail3', [0, 0.1, -1.9], 0.08],
];
const DAMAGE = { eye: 8, skull: 4, snout: 4, jaw: 4, body: 2, tail: 1 };
const HATCHET = 1.5;          // hatchet multiplier (rounded)
const MAX_HP = 24;
const SHOAL = legacy('canoe') ? { x0: -5.9, x1: -2.5, top: -8.16 } : { x0: -6.6, x1: -4.4, top: -8.16 };
const MOUTH = 0.95;           // mouth centre distance ahead of the root (m)
const FEET = 0.024;           // root height above the ground when standing

export function createCroc(scene, { assets, cave, waterY, targets, shallowFloor = null, zMax = null }) {
  if (!assets?.feature('croc')) return null;
  const gltf = assets.gltf('croc');
  if (!gltf) return null;
  const params = new URLSearchParams(location.search);
  const LIP = cave.x0;                    // beach edge (-1.65)
  const SAFE_X = LIP + 2.05;              // the croc's mouth never goes past this x
  const Z0 = cave.z0 + 0.4;
  const Z1 = zMax ?? (cave.z1 - 0.4);
  const PAD = cave.pad;                   // ladder landing step in the water (beach height)
  const LANE1 = PAD.z0 - 0.2;             // attack lane at the lip: Z0..LANE1 (south of the pad; the canoe sits north of it)
  const FAR = { x: legacy('canoe') ? -6.8 : -7.4, z: cave.z };

  // --- visual ------------------------------------------------------------
  const vis = skeletonClone(gltf.scene);
  vis.updateMatrixWorld(true);
  const bones = {};
  vis.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const above = new THREE.Plane(new THREE.Vector3(0, 1, 0), -waterY);
  const below = new THREE.Plane(new THREE.Vector3(0, -1, 0), waterY);
  let skin = null;
  let twin = null;
  vis.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    skin = o;
  });
  const mat = skin.material.clone();
  mat.clippingPlanes = [above];
  mat.emissive = new THREE.Color(0x000000);
  skin.material = mat;
  skin.castShadow = false;
  skin.receiveShadow = false;
  skin.raycast = () => {};
  const murk = mat.clone();
  murk.clippingPlanes = [below];
  murk.color = new THREE.Color(0xffffff).lerp(new THREE.Color(0x08343c), 0.8).multiplyScalar(0.3);
  murk.roughness = 1;
  murk.envMapIntensity = 0.25;
  murk.normalMap = null;
  twin = new THREE.SkinnedMesh(skin.geometry, murk);
  twin.bind(skin.skeleton, skin.bindMatrix);
  twin.position.copy(skin.position); twin.quaternion.copy(skin.quaternion); twin.scale.copy(skin.scale);
  twin.raycast = () => {};
  skin.parent.add(twin);
  for (const m of [skin, twin]) {
    m.computeBoundingSphere();
    m.boundingSphere.radius = 2.4;           // covers every clip, incl. the Death flip
  }

  // hit zones: invisible spheres on bones, built in the bind pose (vis at the origin)
  const zones = [];
  const tmp = new THREE.Vector3();
  for (const [name, bone, c, r] of ZONES) {
    const zone = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), proxyMaterial);
    zone.position.copy(bones[bone].worldToLocal(tmp.set(...c)));
    zone.userData.crocZone = name;
    bones[bone].add(zone);
    zones.push(zone);
  }
  if (params.get('crocdebug') === '1') {
    const wire = new THREE.MeshBasicMaterial({ color: 0xff3050, wireframe: true, depthTest: false });
    zones.forEach((z) => { const w = new THREE.Mesh(z.geometry, wire); w.raycast = () => {}; z.add(w); });
  }

  // eyeshine: two additive glints on the head bone (orange, like real croc eyeshine in torchlight)
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, 'rgba(255,236,190,1)'); r.addColorStop(0.35, 'rgba(255,150,50,0.85)'); r.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = r; g.fillRect(0, 0, 32, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const glints = EYES.map(([x, y, z]) => {
    const s = new THREE.Sprite(glowMat);
    s.position.copy(bones.head.worldToLocal(tmp.set(x * 1.15, y + 0.012, z)));
    s.scale.setScalar(0.06);
    s.raycast = () => {};
    bones.head.add(s);
    return s;
  });

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  root.add(vis);
  root.userData.croc = true;
  scene.add(root);

  // ripple rings (world.splash() clamps rings 3.2 m away from the cliff, so the croc keeps its own)
  const ringGeo = new THREE.RingGeometry(0.85, 1, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 4; i += 1) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xcfe2e6, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.raycast = () => {}; scene.add(m); rings.push({ m, age: 1, life: 1, size: 1 });
  }
  let ringAt = 0;
  function ripple(x, z, size = 1, life = 1.1) {
    const r = rings[ringAt]; ringAt = (ringAt + 1) % rings.length;
    r.m.position.set(x, waterY + 0.012, z); r.age = 0; r.life = life; r.size = size; r.m.visible = true;
  }
  // blood: 24 pooled droplets in one InstancedMesh (one draw call, only while bleeding)
  const DROPS = 24;
  const dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 5, 4), new THREE.MeshBasicMaterial({ color: 0x7a0a10 }), DROPS);
  dropMesh.count = 0; dropMesh.frustumCulled = false; dropMesh.raycast = () => {}; dropMesh.visible = false;
  scene.add(dropMesh);
  const drops = Array.from({ length: DROPS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 }));
  const dropM = new THREE.Matrix4();
  function bleed(p, n = 8) {
    let k = 0;
    for (const d of drops) {
      if (d.life > 0) continue;
      d.p.copy(p); d.v.set((Math.random() - 0.5) * 1.6, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 1.6);
      d.life = 0.5 + Math.random() * 0.3; if (++k >= n) break;
    }
  }

  // --- animation ---------------------------------------------------------
  const mixer = new THREE.AnimationMixer(vis);
  const actions = {};
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  for (const n of ['Threat', 'Attack', 'Hurt', 'Death']) {
    actions[n].setLoop(THREE.LoopOnce, 1);
    actions[n].clampWhenFinished = true;
  }
  let current = null;
  function play(name, fade = 0.2, timeScale = 1) {
    const next = actions[name];
    next.timeScale = timeScale;
    if (current === next) return next;
    next.reset().setEffectiveWeight(1).play();
    if (current) current.crossFadeTo(next, fade, false);
    current = next;
    return next;
  }

  // --- procedural motion layer (?crocmotion=new) ----------------------------
  // Additive on top of the clips, after mixer.update(): body/tail S-wave that grows with speed, the body curving into
  // turns, head aim toward the player while stalking, a slow breathing heave and the odd jaw gape at close range.
  // It never touches s.x/s.z/s.yaw, so the tracking behaviour is unchanged.
  const MOTION = params.get('crocmotion') === 'new';
  const animated = new Set();
  for (const clip of gltf.animations) for (const tr of clip.tracks) if (tr.name.endsWith('.quaternion')) animated.add(tr.name.split('.')[0]);
  const axisUp = {}; const axisSide = {};
  {
    const wq = new THREE.Quaternion();
    for (const [name, b] of Object.entries(bones)) {
      b.getWorldQuaternion(wq); wq.invert();
      axisUp[name] = new THREE.Vector3(0, 1, 0).applyQuaternion(wq).normalize();
      axisSide[name] = new THREE.Vector3(1, 0, 0).applyQuaternion(wq).normalize();
    }
  }
  const mq = new THREE.Quaternion();
  const SWAY = [['spine2', 0.35], ['tail1', 0.6], ['tail2', 0.85], ['tail3', 1.05], ['tail4', 1.25]];
  const m = { phase: 0, lastX: null, lastZ: 0, lastYaw: 0, speed: 0, turn: 0, aim: 0, gape: 0, gapeT: 3, w: 0 };
  function addRot(name, axis, angle) {
    const b = bones[name];
    if (!b || !animated.has(name) || Math.abs(angle) < 1e-5) return;
    b.quaternion.multiply(mq.setFromAxisAngle(axis[name], angle));
  }
  function motion(dt, p) {
    if (!dt) return;
    if (m.lastX === null) { m.lastX = s.x; m.lastZ = s.z; m.lastYaw = s.yaw; }
    const v = Math.hypot(s.x - m.lastX, s.z - m.lastZ) / dt;
    let dy = s.yaw - m.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.lastX = s.x; m.lastZ = s.z; m.lastYaw = s.yaw;
    m.speed = THREE.MathUtils.damp(m.speed, Math.min(v, 2.5), 4, dt);
    m.turn = THREE.MathUtils.damp(m.turn, THREE.MathUtils.clamp(dy / dt, -2.5, 2.5), 5, dt);
    const scripted = s.state === 'dead' || s.state === 'grab' || s.state === 'lunge' || s.state === 'windup' || s.state === 'ramWindup' || current === actions.Hurt;
    m.w = THREE.MathUtils.damp(m.w, scripted ? 0 : 1, 6, dt);
    if (m.w < 0.01) return;
    m.phase += dt * (1.6 + m.speed * 3.2);
    const amp = (0.05 + Math.min(m.speed, 1.6) * 0.1) * m.w;
    const bend = -m.turn * 0.12 * m.w;                       // tail trails out of the turn
    SWAY.forEach(([name, k], i) => addRot(name, axisUp, amp * k * Math.sin(m.phase - 0.8 * (i + 1)) + bend * k));
    addRot('spine1', axisUp, -amp * 0.3 * Math.sin(m.phase) - bend * 0.4);
    addRot('spine1', axisSide, 0.012 * Math.sin(s.clock * 1.3) * m.w); // breathing heave
    // head aim: yaw toward the player relative to the body, clamped, smoothed
    let aim = 0;
    if (p && (s.state === 'stalk' || s.state === 'patrol' || s.state === 'approach' || s.state === 'backoff')) {
      const want = Math.atan2(p.x - s.x, p.z - s.z);
      let d = want - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      aim = THREE.MathUtils.clamp(d, -0.55, 0.55);
    }
    m.aim = THREE.MathUtils.damp(m.aim, aim, 3, dt);
    addRot('neck', axisUp, m.aim * 0.45 * m.w - amp * 0.2 * Math.sin(m.phase + 0.6));
    addRot('head', axisUp, m.aim * 0.35 * m.w);
    // jaw: a slow gape now and then when the player is close and the croc is just watching
    const close = p && Math.hypot(p.x - s.x, p.z - s.z) < 4.5 && s.state === 'stalk';
    m.gapeT -= dt;
    if (m.gapeT <= 0) { m.gapeT = 4 + Math.random() * 5; if (close) m.gape = 1; }
    m.gape = Math.max(0, m.gape - dt * 0.6);
    const g = Math.sin(Math.PI * Math.min(1, 1 - m.gape)) * 0.16 * m.w;
    addRot('jaw', axisSide, g);
  }

  // --- state -------------------------------------------------------------
  const listeners = {};
  const emit = (type, data = {}) => (listeners[type] || []).forEach((fn) => fn({ type, croc: api, ...data }));
  const s = {
    state: 'patrol', t: 0, hp: MAX_HP, enraged: false, retreated: false,
    x: FAR.x, z: FAR.z, y: waterY - 0.75, yaw: Math.PI / 2, pitch: 0, roll: 0, speed: 0,
    target: new THREE.Vector3(), lastLunge: -99, clock: 0, engagedFor: 0, awayFor: 0, revealed: false,
    flash: 0, hurtT: 0, stun: 0, grabTick: 0, rewarded: false,
  };
  const heading = new THREE.Vector3();
  const mouth = new THREE.Vector3();
  function setState(name) { s.state = name; s.t = 0; }
  function groundAt(x, z, shoal = true) {
    if (z < cave.z0 - 0.2 || z > cave.z1 + 0.2) return null;
    if (x >= LIP - 0.05) return cave.floor;
    if (x >= PAD.x0 - 0.05 && z >= PAD.z0 - 0.05 && z <= PAD.z1 + 0.05) return cave.floor;
    const sf = shallowFloor ? shallowFloor(x, z) : null; // gameplay-fixes shallows slab/ramp, when present
    if (shoal && x >= SHOAL.x0 && x <= SHOAL.x1) return Math.max(SHOAL.top, sf ?? -Infinity);
    return sf ?? null;
  }
  function steer(tx, tz, speed, turn, dt) {
    const want = Math.atan2(tx - s.x, tz - s.z);
    let d = want - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    s.yaw += THREE.MathUtils.clamp(d, -turn * dt, turn * dt);
    const dist = Math.hypot(tx - s.x, tz - s.z);
    const v = Math.min(speed, dist / Math.max(dt, 1e-3));
    s.x += Math.sin(s.yaw) * v * dt; s.z += Math.cos(s.yaw) * v * dt;
    s.speed = v;
    return dist;
  }
  function slide(tx, tz, speed, dt) { // sculling sideways along the lip while the head tracks the player
    const dx = tx - s.x; const dz = tz - s.z; const d = Math.hypot(dx, dz);
    if (d < 1e-4) { s.speed = 0; return 0; }
    const v = Math.min(speed, d / Math.max(dt, 1e-3));
    s.x += dx / d * v * dt; s.z += dz / d * v * dt; s.speed = v;
    return d;
  }
  function face(tx, tz, turn, dt) {
    const want = Math.atan2(tx - s.x, tz - s.z);
    let d = want - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    s.yaw += THREE.MathUtils.clamp(d, -turn * dt, turn * dt);
    return Math.abs(d);
  }
  const ASHORE = new Set(['lunge', 'recover', 'backoff', 'dead', 'haul', 'windup']);
  function clampArena() {
    s.z = THREE.MathUtils.clamp(s.z, Z0, Z1);
    const maxX = ASHORE.has(s.state) ? SAFE_X - MOUTH * Math.max(0, Math.sin(s.yaw)) : LIP - 1.15;
    s.x = THREE.MathUtils.clamp(s.x, -8.5, maxX);
  }
  // where the root should sit: depth by state, but never below the ground (shoal / beach)
  function rideHeight(mode) {
    // the shoal only lifts it while it crawls across (approach / retreat); at the lip its belly sits in the sandbar
    const crossing = s.state === 'approach' || s.state === 'retreat';
    const g = groundAt(s.x + Math.sin(s.yaw) * 0.3, s.z + Math.cos(s.yaw) * 0.3, crossing);
    let y = waterY - 0.22; let pitch = -0.07;               // stalk: eyes + back scutes awash
    if (mode === 'deep') { y = waterY - 0.75; pitch = 0; }
    if (mode === 'lurk') { y = waterY - 0.30; pitch = -0.18; } // only eyes and brow above the surface
    if (mode === 'dead') { y = waterY - 0.16; pitch = 0; }
    if (g !== null && y < g + FEET) { y = g + FEET; pitch = 0; }
    return { y, pitch, ground: g };
  }

  function lunge() {
    s.lastLunge = s.clock;
    setState('lunge');
    play('Attack', 0.08, 1);
    s.lungeFrom = new THREE.Vector3(s.x, 0, s.z);
    const reach = s.enraged ? 2.4 : 2.0;
    const dx = s.target.x - (s.x + Math.sin(s.yaw) * MOUTH);
    const dz = s.target.z - (s.z + Math.cos(s.yaw) * MOUTH);
    const dist = Math.min(reach, Math.hypot(dx, dz));
    s.lungeDist = dist;
    emit('lunge', { position: root.position.clone() });
  }

  function update(dt, player) {
    s.clock += dt; s.t += dt;
    const p = player;
    s.lastPlayer = player || null;
    const engaged = !!p && s.state !== 'dead' && (p.onBeach || p.inWater || p.aboard);
    s.engagedFor = engaged ? s.engagedFor + dt : 0;
    s.awayFor = engaged ? 0 : s.awayFor + dt;
    heading.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    mouth.set(s.x, 0, s.z).addScaledVector(heading, MOUTH);
    const toPlayer = p ? Math.hypot(p.x - mouth.x, p.z - mouth.z) : Infinity;
    const lipZ = p ? THREE.MathUtils.clamp(p.z, Z0, LANE1) : LANE1;
    let mode = 'stalk';
    switch (s.state) {
      case 'patrol': { // deep, slow figure-eight beyond the shoal, immune (below the arrow floor)
        mode = 'deep';
        const a = s.clock * 0.25;
        steer(FAR.x + Math.sin(a) * 1.2, cave.z + Math.sin(a * 2) * 2.2, 0.6, 1.2, dt);
        play('Swim', 0.4, 0.7);
        if (engaged && s.engagedFor > 2.5) setState('approach');
        break;
      }
      case 'approach': { // swim to the trench at the beach edge, surfacing on the way
        mode = s.t < 1.2 ? 'deep' : 'stalk';
        const d = steer(LIP - 1.2, lipZ, s.enraged ? 1.6 : 1.1, 1.6, dt);
        play(groundAt(s.x, s.z) === SHOAL.top ? 'Walk' : 'Swim', 0.3, 1);
        if (!s.revealed && s.t > 1.2) { s.revealed = true; emit('reveal', { position: root.position.clone() }); ripple(s.x, s.z, 1.2); }
        if (d < 0.4) setState('stalk');
        if (!engaged && s.awayFor > 3) setState('patrol');
        break;
      }
      case 'stalk': { // hold at the trench, track the player along the lip, eyes on them
        mode = toPlayer > 3.5 ? 'lurk' : 'stalk';
        const tx = LIP - 1.2 + (p && p.inWater ? 0.5 : 0);
        if (Math.hypot(tx - s.x, lipZ - s.z) > 0.8) steer(tx, lipZ, s.enraged ? 1.3 : 0.8, 1.4, dt);
        else { slide(tx, lipZ, s.enraged ? 0.7 : 0.45, dt); if (p) face(p.x, p.z, 1.6, dt); }
        play(mode === 'lurk' ? 'Lurk' : 'Swim', 0.4, mode === 'lurk' ? 1 : 0.6);
        const ready = s.clock - s.lastLunge > (s.enraged ? 1.8 : 2.6) && s.engagedFor > 4;
        const reachable = p && (p.onBeach || p.inWater) && p.x <= SAFE_X + 0.3;
        if (ready && reachable && toPlayer < (s.enraged ? 2.7 : 2.3)) {
          s.target.set(p.x, 0, p.z); // locked now: stepping away during the windup dodges
          setState('windup'); play('Threat', 0.12); emit('windup', { position: root.position.clone(), target: s.target.clone() });
          ripple(mouth.x, mouth.z, 0.7, 0.8);
        } else if (p && p.aboard && s.clock - s.lastLunge > 4) {
          setState('ram');
        } else if (ready && reachable) {
          s.outOfReach = (s.outOfReach || 0) + dt;
          if (s.outOfReach > 5) { s.outOfReach = 0; setState('haul'); }
        } else s.outOfReach = 0;
        if (!engaged && s.awayFor > 3) setState('patrol');
        break;
      }
      case 'haul': { // player hangs back on the strip: crawl up the south lane, fully exposed
        mode = 'stalk';
        play('Walk', 0.3, 1);
        const tz = p ? THREE.MathUtils.clamp(p.z, Z0, LANE1) : LANE1;
        steer(SAFE_X - MOUTH, tz, 0.75, 1.2, dt);
        const reach = s.enraged ? 2.7 : 2.3;
        if (p && toPlayer < reach && p.x <= SAFE_X + 0.3) {
          s.target.set(p.x, 0, p.z); setState('windup'); play('Threat', 0.12); emit('windup', { position: root.position.clone(), target: s.target.clone() });
        } else if (!p || p.x > SAFE_X + 0.3 || s.t > 6 || !engaged) setState('backoff');
        break;
      }
      case 'windup': { // telegraph: rear, gape, hiss (0.9 s; 0.65 s enraged)
        mode = 'stalk';
        face(s.target.x, s.target.z, 3, dt);
        if (s.t >= (s.enraged ? 0.65 : 0.9)) lunge();
        break;
      }
      case 'lunge': { // 0.40 s burst onto the beach, snap at t = 0.40
        mode = 'stalk';
        const k = Math.min(1, s.t / 0.4);
        const ease = 1 - (1 - k) * (1 - k);
        const along = s.lungeDist * ease;
        s.x = s.lungeFrom.x + Math.sin(s.yaw) * along;
        s.z = s.lungeFrom.z + Math.cos(s.yaw) * along;
        if (s.t >= 0.4 && !s.snapped) {
          s.snapped = true;
          emit('snap', { position: mouth.clone() });
          if (p && toPlayer <= 0.75 && p.feetY < cave.floor + 0.6) {
            if (p.inWater) { setState('grab'); play('Grab', 0.1); emit('bite', { damage: 20, grab: true }); s.grabTick = 0; break; }
            emit('bite', { damage: 34 });
          }
        }
        if (s.t >= 0.62) { s.snapped = false; setState('recover'); play('Idle', 0.25); }
        break;
      }
      case 'recover': { // vulnerable: on the beach edge, mouth working, 1.4 s
        mode = 'stalk';
        if (s.t > 1.4) setState('backoff');
        break;
      }
      case 'backoff': { // walk backwards into the water
        mode = 'stalk';
        play('Walk', 0.25, -1);
        s.x -= Math.sin(s.yaw) * 0.9 * dt; s.z -= Math.cos(s.yaw) * 0.9 * dt;
        if (s.x < LIP - 1.2 || s.t > 2.2) { setState('stalk'); }
        break;
      }
      case 'grab': { // death roll: the croc rolls, the player's view never rotates
        mode = 'stalk';
        s.roll += dt * (Math.PI * 2) / 0.8;
        s.grabTick += dt;
        if (s.grabTick >= 0.4) { s.grabTick = 0; emit('grabTick', { damage: 12 }); ripple(s.x, s.z, 1.3, 0.7); }
        if (s.t >= 1.6 || !p?.inWater) { s.roll = 0; s.lastLunge = s.clock; emit('release'); setState('backoff'); }
        break;
      }
      case 'ram': { // canoe: circle at 3 m, windup alongside, then knock the canoe
        mode = 'stalk';
        const c = p?.canoe;
        if (!c || !p.aboard) { setState('stalk'); break; }
        const a = s.t * 0.6;
        steer(c.x + Math.cos(a) * 3, c.z + Math.sin(a) * 3, 1.4, 1.6, dt);
        play('Swim', 0.3, 1.2);
        if (s.t > 4) { s.target.set(c.x, 0, c.z); setState('ramWindup'); play('Threat', 0.12); emit('windup', { position: root.position.clone(), target: s.target.clone() }); }
        break;
      }
      case 'ramWindup': {
        mode = 'stalk';
        face(s.target.x, s.target.z, 3, dt);
        if (s.t > 0.9) { setState('ramGo'); play('Swim', 0.1, 2.2); }
        break;
      }
      case 'ramGo': {
        mode = 'stalk';
        const d = steer(s.target.x, s.target.z, 4.5, 2.5, dt);
        if (d < 1.4) { s.lastLunge = s.clock; emit('ram', { damage: 20, dir: heading.clone() }); ripple(s.x, s.z, 1.4); setState('stalk'); }
        if (s.t > 2) setState('stalk');
        break;
      }
      case 'retreat': { // hurt to half: dive and swim off beyond the shoal for 7 s
        mode = s.t > 0.6 ? 'deep' : 'stalk';
        steer(FAR.x, FAR.z, 2.0, 2.0, dt);
        play('Swim', 0.2, 1.8);
        if (s.t > 7) { s.enraged = true; s.revealed = false; setState('approach'); emit('return'); }
        break;
      }
      case 'dive': { // shot from out of reach: submerge, resurface elsewhere along the lip
        mode = 'deep';
        steer(LIP - 1.1, s.diveZ, 1.4, 2, dt);
        play('Swim', 0.2, 1.4);
        if (s.t > 3.5) { setState('stalk'); ripple(s.x, s.z, 1); }
        break;
      }
      case 'dead': {
        mode = 'dead';
        if (s.t > 1.2 && !s.rewarded) { s.rewarded = true; spawnTooth(); }
        break;
      }
      default: break;
    }
    if (s.stun > 0) s.stun -= dt;
    if (s.state !== 'lunge') clampArena();
    const ride = rideHeight(s.state === 'dead' && groundAt(s.x, s.z) === null ? 'dead' : mode);
    s.y = THREE.MathUtils.damp(s.y, ride.y, s.state === 'lunge' ? 14 : 3.2, dt);
    s.pitch = THREE.MathUtils.damp(s.pitch, ride.pitch, 3, dt);
    root.position.set(s.x, s.y, s.z);
    root.rotation.set(s.pitch, s.yaw, s.roll);
    twin.visible = s.y < waterY + 0.33;
    // eyeshine
    const lit = s.state === 'dead' ? 0 : (mode === 'deep' ? 0 : 1);
    const hot = s.state === 'windup' || s.state === 'ramWindup' ? 1.5 : 1;
    glints.forEach((g) => {
      g.getWorldPosition(tmp);
      g.visible = lit > 0 && tmp.y > waterY + 0.005;
      g.scale.setScalar(0.06 * hot * (0.9 + 0.1 * Math.sin(s.clock * 3)));
    });
    // hit flash
    if (s.flash > 0) { s.flash = Math.max(0, s.flash - dt); mat.emissive.setRGB(0.55 * s.flash / 0.15, 0.04 * s.flash / 0.15, 0.02 * s.flash / 0.15); }
    if (s.hurtT > 0) { s.hurtT -= dt; if (s.hurtT <= 0 && current === actions.Hurt && s.state !== 'dead') play(s.resume || 'Swim', 0.15); }
    mixer.update(dt);
    if (MOTION) motion(dt, p);
    for (const r of rings) {
      if (r.age >= r.life) { r.m.visible = false; continue; }
      r.age += dt; const k = r.age / r.life;
      r.m.scale.setScalar(r.size * (0.3 + k * 1.4)); r.m.material.opacity = 0.5 * (1 - k);
    }
    let live = 0;
    for (const d of drops) {
      if (d.life <= 0) continue;
      d.life -= dt; d.v.y -= 9.2 * dt; d.p.addScaledVector(d.v, dt);
      if (d.p.y < waterY + 0.02) d.life = 0;
      if (d.life > 0) dropMesh.setMatrixAt(live++, dropM.makeTranslation(d.p.x, d.p.y, d.p.z));
    }
    dropMesh.count = live; dropMesh.visible = live > 0;
    if (live) dropMesh.instanceMatrix.needsUpdate = true;
  }

  // --- damage ------------------------------------------------------------
  function hit(zone, point, source = 'arrow', player = s.lastPlayer) {
    if (s.state === 'dead' || s.state === 'patrol') return null;
    if (point && point.y < waterY - 0.05) return null;          // fully under water: arrows skim off
    const mouthOpen = s.state === 'windup' || s.state === 'recover' || s.state === 'ramWindup';
    let dmg = DAMAGE[zone] ?? 1;
    if (mouthOpen && (zone === 'snout' || zone === 'jaw')) dmg *= 2;
    if (s.state === 'grab' && zone === 'body') dmg *= 2;          // pale belly turns up during the roll
    if (source === 'hatchet') dmg = Math.round(dmg * HATCHET);
    const crit = zone === 'eye' || (mouthOpen && (zone === 'snout' || zone === 'jaw'));
    s.hp = Math.max(0, s.hp - dmg);
    s.flash = 0.15;
    bleed(point || root.position, crit ? 14 : 7);
    if (point && point.y < waterY + 0.4) ripple(point.x, point.z, 0.6, 0.6);
    if (s.hp <= 0) {
      s.roll = 0; setState('dead'); play('Death', 0.1);
      emit('hurt', { zone, damage: dmg, crit, source, hp: 0, killed: true, point: (point || root.position).clone() });
      emit('death', { position: root.position.clone() });
      return { damage: dmg, crit, killed: true };
    }
    emit('hurt', { zone, damage: dmg, crit, source, hp: s.hp, killed: false, point: (point || root.position).clone() });
    const big = dmg >= 6;
    if (s.state === 'grab') { s.roll = 0; s.lastLunge = s.clock; emit('release'); setState('backoff'); }
    else if (big && (s.state === 'windup' || s.state === 'ramWindup')) { setState('recover'); s.t = 0.6; } // staggered: windup cancelled
    if (!s.retreated && s.hp <= MAX_HP / 2) { s.retreated = true; setState('retreat'); emit('retreat'); return { damage: dmg, crit, killed: false }; }
    const outOfReach = player && player.x > SAFE_X + 0.3 && (s.state === 'stalk');
    if (outOfReach) { s.diveZ = THREE.MathUtils.clamp(s.z + (Math.random() < 0.5 ? -2.2 : 2.2), Z0, Z1); setState('dive'); }
    s.resume = s.state === 'stalk' ? 'Lurk' : (current?.getClip().name || 'Swim');
    if (s.state !== 'lunge') { play('Hurt', 0.06); s.hurtT = 0.42; }
    return { damage: dmg, crit, killed: false };
  }
  // hatchet: blade segment a->b (world) against zone spheres
  const segA = new THREE.Vector3(); const segB = new THREE.Vector3(); const seg = new THREE.Line3(); const near = new THREE.Vector3();
  let chopAt = -1;
  function chop(a, b, player = s.lastPlayer) {
    if (s.state === 'dead' || s.clock - chopAt < 0.4) return null;
    seg.set(segA.copy(a), segB.copy(b));
    let best = null; let bestD = Infinity;
    root.updateMatrixWorld(true);
    for (const z of zones) {
      z.getWorldPosition(tmp);
      seg.closestPointToPoint(tmp, true, near);
      const d = near.distanceTo(tmp) - z.geometry.parameters.radius - 0.05;
      if (d < 0 && d < bestD) { bestD = d; best = { zone: z.userData.crocZone, point: near.clone() }; }
    }
    if (!best) return null;
    chopAt = s.clock;
    return hit(best.zone, best.point, 'hatchet', player);
  }
  function spawnTooth() {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.075, 7), new THREE.MeshStandardMaterial({ color: 0xeee6d2, roughness: 0.4, emissive: 0x332a18 }));
    tooth.rotation.z = Math.PI / 2;
    const x = Math.max(LIP + 0.35, Math.min(SAFE_X - 0.3, s.x + Math.sin(s.yaw) * MOUTH));
    tooth.position.set(x, cave.floor + 0.02, THREE.MathUtils.clamp(s.z, Z0, Z1));
    tooth.userData = { type: 'prop', label: 'croc tooth', role: 'loose', floorY: 0.02 };
    tooth.castShadow = true;
    scene.add(tooth);
    targets?.push(tooth);
    emit('reward', { object: tooth });
  }
  function reset() { // player went down: break off, keep the damage
    if (s.state === 'dead') return;
    s.roll = 0; s.revealed = false; s.engagedFor = 0; setState('patrol');
  }
  const api = {
    root, zones, update, hit, chop, reset,
    on(type, fn) { (listeners[type] ||= []).push(fn); return api; },
    alive: () => s.state !== 'dead',
    state: () => s.state,
    hp: () => s.hp,
    mouth: () => mouth.clone().setY(s.y + 0.2),
    // test hook (headless harness / ?crocdebug=1): place + pose
    debugPlace(x, z, yaw, state = 'stalk') { s.x = x; s.z = z; s.yaw = yaw; setState(state); s.y = rideHeight(state === 'patrol' ? 'deep' : 'stalk').y; },
    _s: s,
  };
  play('Swim', 0);
  return api;
}
