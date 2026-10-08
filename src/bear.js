// src/bear.js - the overlook brown bear: a cliff-top fight that starts when you top out of the east crag climb.
// Model: 0 A.D. brown bear (Wildfire Games, CC-BY-SA 3.0), models/enemies/bear.glb (edited: scaled to 2.25 m, 8 clips,
// static channels stripped). The GLB stays CC-BY-SA; this code doesn't. Tested headless against createWorld() in r180.
//
// sleep -> wake (growl, stand, rear-up roar) -> stalk <-> swipe | lunge | charge (miss = stunned) | rear (roar, chest
// exposed, slam) -> dead (saved; back asleep after RESPAWN_H hours). Leaving the overlook (glider, climbing down, going
// down) breaks the fight off: it walks back to its den and lies down, keeping its wounds for this session.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { proxyMaterial } from './assets.js';
import { DEN as WOODS_DEN } from './overlookshape.js';

const SAVE_KEY = 'house.bear.v1';
export const RESPAWN_H = 24;              // a killed bear stays gone for a day of real time, then it's back asleep
const BEAR_HP = 120;
// damage to the player (x ?beardmg=)
const HURT = { swipe: 20, lunge: 25, charge: 30, slam: 15 };
const SHOVE = { swipe: 0.45, lunge: 0.6, charge: 0.8, slam: 0.4 };
// damage to the bear
const ARROW = { head: 22, neck: 14, chest: 12, body: 10, rump: 8, paw: 4 };
const ZONE_MULT = { head: 1.5, neck: 1.2, chest: 1, body: 1, rump: 0.8, paw: 0.5 }; // hatchet / club
// hit zones: name, bone, model-space centre in the bind pose (bear faces +Z, feet at y 0, root between the legs), radius
const ZONES = [
  ['head', 'Ursidae_Head', [0, 0.93, 1.05], 0.2],
  ['neck', 'Ursidae_Neck', [0, 0.95, 0.7], 0.23],
  ['chest', 'Ursidae_Spine_3', [0, 0.72, 0.42], 0.33],
  ['body', 'Ursidae_Spine_2', [0, 0.78, 0.0], 0.36],
  ['body', 'Ursidae_Spine_1', [0, 0.78, -0.4], 0.36],
  ['rump', 'Ursidae_Pelvis', [0, 0.72, -0.72], 0.3],
  ['paw', 'Ursidae_Paw_L', [0.25, 0.1, 0.68], 0.13],
  ['paw', 'Ursidae_Paw_R', [-0.25, 0.1, 0.68], 0.13],
];
const MOUTH = 1.15;                       // mouth distance ahead of the root
const NOSE_DEN = { x: -1.85, z: 0, yaw: Math.PI / 2 };  // nose tip, facing east along the crown (?legacy=overlook)
const GLIDER = { x: -1.35, r: 1.7 };      // no rearing up under the parked glider's wing

export function createBear(scene, { assets, crag, golf = null, gear = null, targets = null }) {
  if (!assets?.feature('bear') || !crag?.deckAt) return null;   // ?bear=0 (or ?models=0)
  // overlook pass: the den is a clearing in the summit woods; the bear walks out of the trees when it wakes
  const woods = !!crag.summit;
  const DEN = woods ? WOODS_DEN : NOSE_DEN;
  const deckAt = crag.bearDeckAt || crag.deckAt;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('beardebug') === '1';
  const rawDmg = params.get('beardmg');
  const DMG = rawDmg == null || rawDmg === '' || !Number.isFinite(Number(rawDmg)) ? 1 : Math.max(0, Number(rawDmg));
  const MAX_HP = Math.max(1, Number(params.get('bearhp')) || BEAR_HP);
  const deckY = crag.deckY;
  const ladder = crag.ladder?.userData || {};
  const climbBaseY = ladder.shaft?.base ?? deckY - 25;
  if (params.get('bear') === 'reset') save(null);

  const root = new THREE.Group();
  root.name = 'bear';
  root.position.set(DEN.x, deckY, DEN.z);
  root.rotation.y = DEN.yaw;
  scene.add(root);

  const listeners = {};
  const emit = (type, data = {}) => (listeners[type] || []).forEach((fn) => fn({ type, bear: api, ...data }));
  const s = {
    state: 'off', t: 0, clock: 0, hp: MAX_HP, x: DEN.x, z: DEN.z, yaw: DEN.yaw,
    engaged: 0, lastAttack: -99, cool: 1.5, struck: false, attack: null, lockX: 0, lockZ: 0, travel: 0,
    rears: 0, rearQueued: false, arrived: false, lastClimb: -99, away: 0, flinch: 0, kills: 0,
    pivot: 0, hitAt: -99, ballAt: -99, clubAt: -99, chopAt: -99, rewarded: false, ready: false, wakeT: 0,
  };
  const saved = load();
  s.kills = saved?.kills ?? 0;
  const gone = saved?.killedAt && Date.now() - saved.killedAt < RESPAWN_H * 3600e3;
  let model = null;
  let claw = null;
  if (gone) {
    s.state = 'gone';
    claw = spawnClaw(DEN.x + Math.sin(DEN.yaw) * 0.6, DEN.z + 0.15);
  }

  // --- model (lazy: prefetched during the climb) -----------------------------
  let skin = null; let mixer = null; const actions = {}; let current = null;
  const bones = {}; const zones = []; const rest = new Map(); const animated = new Set();
  const axisSide = {}; const axisUp = {};
  function build(gltf) {
    if (model || !gltf) return;
    const vis = skeletonClone(gltf.scene);
    vis.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (o.isSkinnedMesh) skin = o;
    });
    if (!skin) return;
    skin.material = skin.material.clone();
    skin.material.vertexColors = false;
    skin.castShadow = false;
    skin.receiveShadow = true;
    skin.raycast = () => {};
    skin.frustumCulled = true;
    root.add(vis);
    root.updateMatrixWorld(true);
    skin.computeBoundingSphere();
    skin.boundingSphere.radius = 2.6;     // covers every clip incl. the rear-up (2.4 m tall)
    // bind-pose axes for the procedural layer (root yaw is applied, so undo it)
    const wq = new THREE.Quaternion(); const rootInv = root.quaternion.clone().invert();
    for (const [name, b] of Object.entries(bones)) {
      rest.set(b, b.quaternion.clone());
      b.getWorldQuaternion(wq); wq.premultiply(rootInv).invert();
      axisUp[name] = new THREE.Vector3(0, 1, 0).applyQuaternion(wq).normalize();
      axisSide[name] = new THREE.Vector3(1, 0, 0).applyQuaternion(wq).normalize();
    }
    for (const clip of gltf.animations) for (const tr of clip.tracks) if (tr.name.endsWith('.quaternion')) animated.add(tr.name.split('.')[0]);
    // hit zones on bones (model-space centres -> bone space)
    const tmp = new THREE.Vector3();
    for (const [name, bone, c, r] of ZONES) {
      const b = bones[bone];
      if (!b) continue;
      const zone = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), proxyMaterial);
      zone.position.copy(b.worldToLocal(root.localToWorld(tmp.set(...c))));
      zone.userData.foeZone = name;
      zone.userData.foe = api;
      zone.userData.noTarget = true;
      b.add(zone);
      zones.push(zone);
    }
    if (DEBUG) {
      const wire = new THREE.MeshBasicMaterial({ color: 0xff3050, wireframe: true, depthTest: false });
      zones.forEach((z) => { const w = new THREE.Mesh(z.geometry, wire); w.raycast = () => {}; z.add(w); });
    }
    mixer = new THREE.AnimationMixer(vis);
    for (const clip of gltf.animations) {
      const a = mixer.clipAction(clip);
      if (['Swipe', 'Lunge', 'Rear', 'Death'].includes(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions[clip.name] = a;
    }
    model = vis;
    s.ready = true;
    if (s.state === 'off') { setState('sleep'); lieDown(0); }
    mixer.update(0);
    emit('ready');
  }
  function prefetch() {
    if (model || s.state === 'gone' || s.loading) return;
    s.loading = true;
    assets.whenReady('bear').then((gltf) => build(gltf));
  }

  function play(name, fade = 0.25, timeScale = 1, from = null) {
    const next = actions[name];
    if (!next) return null;
    next.setEffectiveTimeScale(timeScale);
    if (current === next && from == null) return next;
    next.reset();
    if (from != null) next.time = from * next.getClip().duration;
    next.setEffectiveWeight(1).play();
    if (current && current !== next) current.crossFadeTo(next, fade, false);
    current = next;
    return next;
  }
  function norm(a = current) { return a ? Math.min(1, a.time / a.getClip().duration) : 0; }
  function lieDown(fade) {   // sleep pose = end of the Death clip (lying, head on the paws); breathing is procedural
    play('Death', fade, fade ? 0.55 : 1, fade ? 0.45 : 0.999);
  }

  // --- arena -----------------------------------------------------------------
  const fwd = new THREE.Vector3();
  function onDeck(x, z, m) {
    if (deckAt(x, z) == null) return false;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      if (deckAt(x + Math.cos(a) * m, z + Math.sin(a) * m) == null) return false;
    }
    return true;
  }
  function bearFits(x, z, yaw) {   // chest, root and rump stay 0.28 m in from every edge
    const fx = Math.sin(yaw); const fz = Math.cos(yaw);
    return onDeck(x, z, 0.28) && onDeck(x + fx * 0.75, z + fz * 0.75, 0.22) && onDeck(x - fx * 0.6, z - fz * 0.6, 0.22);
  }
  function moveTo(nx, nz) {
    if (bearFits(nx, nz, s.yaw)) { s.x = nx; s.z = nz; return true; }
    // turned into a pose that doesn't fit (chest over the inside corner where the shoulder meets the crown): let it
    // walk out as long as the root stays well on the rock
    if (!bearFits(s.x, s.z, s.yaw) && onDeck(nx, nz, 0.3) && onDeck(nx + Math.sin(s.yaw) * 0.75, nz + Math.cos(s.yaw) * 0.75, 0.05)) { s.x = nx; s.z = nz; return true; }
    if (bearFits(nx, s.z, s.yaw)) { s.x = nx; return 'slide'; }
    if (bearFits(s.x, nz, s.yaw)) { s.z = nz; return 'slide'; }
    return false;
  }
  // Walk toward (tx, tz) around the edges: try headings fanned out from the direct one, take the first whose next
  // 0.45 m still fits on the rock, turn toward it and walk along the current heading.
  function steer(tx, tz, speed, dt, rate = 2.4) {
    const want = Math.atan2(tx - s.x, tz - s.z);
    let pick = null;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.9, -1.9]) {
      const yaw = want + off;
      if (bearFits(s.x + Math.sin(yaw) * 0.2, s.z + Math.cos(yaw) * 0.2, yaw) && bearFits(s.x + Math.sin(yaw) * 0.45, s.z + Math.cos(yaw) * 0.45, yaw)) { pick = yaw; break; }
    }
    if (pick == null) {   // hugging an edge with no clean heading: back toward the middle of the rock on root clearance only
      const cx = s.z < -0.95 && s.x > 1.5 ? 2.25 : s.x + 0.3 * Math.sign(tx - s.x);
      const cz = s.z < -0.95 && s.x > 1.5 ? -1.85 : 0;
      const yaw = Math.atan2(cx - s.x, cz - s.z);
      let dd = yaw - s.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      s.yaw += THREE.MathUtils.clamp(dd, -rate * dt, rate * dt);
      const nx = s.x + Math.sin(s.yaw) * speed * 0.6 * dt; const nz = s.z + Math.cos(s.yaw) * speed * 0.6 * dt;
      if (Math.abs(dd) < 0.6 && onDeck(nx, nz, 0.2)) { s.x = nx; s.z = nz; return true; }
      return false;
    }
    let d = pick - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    s.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
    if (Math.abs(d) > 1.2) return false;   // mostly turning on the spot
    return moveTo(s.x + Math.sin(s.yaw) * speed * dt, s.z + Math.cos(s.yaw) * speed * dt);
  }
  function turnTo(tx, tz, rate, dt) {
    const want = Math.atan2(tx - s.x, tz - s.z);
    let d = want - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
    const yaw = s.yaw + step;
    const fx = Math.sin(yaw); const fz = Math.cos(yaw);
    // don't swing the head out over the drop, unless it has been stuck facing the wrong way for a second (on the
    // narrow tip a 2.25 m bear can only turn round with its head over the edge; its feet stay on the rock)
    if (onDeck(s.x + fx * 0.75, s.z + fz * 0.75, 0.2) || s.pivot > 1) { s.yaw = yaw; if (step) s.pivot = Math.max(0, s.pivot - dt * 0.5); }
    else s.pivot += dt;
    return Math.abs(d);
  }
  function mouth(out = new THREE.Vector3(), ahead = MOUTH) {
    return out.set(s.x + Math.sin(s.yaw) * ahead, deckY + 0.75, s.z + Math.cos(s.yaw) * ahead);
  }
  // Shove that can never put the player off the rock: the whole path and the end point keep 0.5 m from every edge;
  // otherwise it shrinks (60%, 30%) or is dropped.
  function safeShove(px, pz, dx, dz, dist) {
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    if (!onDeck(px, pz, 0.15)) return { x: 0, z: 0 };
    for (const k of [1, 0.6, 0.3]) {
      const d = dist * k;
      let ok = true;
      for (let i = 1; i <= 5 && ok; i += 1) ok = onDeck(px + dx * d * (i / 5), pz + dz * d * (i / 5), 0.5);
      if (ok) return { x: dx * d, z: dz * d };
    }
    return { x: 0, z: 0 };
  }

  // --- player tracking --------------------------------------------------------
  const P = { x: 0, z: 0, headY: 0, feetY: -99, onDeck: false, inZone: false };
  function readPlayer(p) {
    if (!p) return false;
    P.x = p.x; P.z = p.z; P.headY = p.headY ?? p.feetY + 1.6; P.feetY = p.feetY ?? P.headY - 1.6;
    P.onDeck = Math.abs(P.feetY - deckY) < 0.35 && crag.deckAt(P.x, P.z) != null;
    P.inZone = P.feetY > deckY - 2.5 && P.x > -4.5 && P.x < (woods ? 21.5 : 5) && P.z > (woods ? -9.5 : -4.5) && P.z < (woods ? 9 : 3.5);
    const climbing = P.x > 2.75 && P.z > -3.1 && P.z < -1.3 && P.feetY < deckY - 0.2 && P.feetY > climbBaseY - 0.5;
    if (climbing) s.lastClimb = s.clock;
    if ((climbing && P.feetY > deckY - 15) || P.inZone) prefetch();
    if (P.onDeck && !s.arrived && (s.clock - s.lastClimb < 4 || DEBUG)) s.arrived = true;   // topped out of the climb
    return true;
  }
  function playerDist() { const m = mouth(tmpM); return Math.hypot(P.x - m.x, P.z - m.z); }
  const tmpM = new THREE.Vector3();

  // --- state machine ----------------------------------------------------------
  function setState(name) { s.state = name; s.t = 0; s.struck = false; }
  function startAttack(kind) {
    s.attack = kind;
    setState(kind);
    s.lockX = P.x; s.lockZ = P.z; s.travel = 0;
    emit('telegraph', { kind, position: root.position.clone() });
  }
  function endAttack(next = 'stalk') {
    s.lastAttack = s.clock;
    s.cool = 1.2 + Math.random() * 0.8;
    s.attack = null;
    setState(next);
  }
  // Hit test: the player's head (x,z) against a capsule from just behind the mouth to the strike point `at`
  // (so standing inside the reach, or in its face, doesn't dodge it), radius per move.
  const REACH = { swipe: 0.55, lunge: 0.55, charge: 0.5, slam: 1.5 };
  function strike(kind, at) {
    if (s.struck || !P.onDeck) return;
    const mx = s.x + Math.sin(s.yaw) * 0.3; const mz = s.z + Math.cos(s.yaw) * 0.3;   // from the chest out
    const ax = at.x - mx; const az = at.z - mz; const len2 = ax * ax + az * az || 1;
    const k = kind === 'slam' ? 1 : THREE.MathUtils.clamp(((P.x - mx) * ax + (P.z - mz) * az) / len2, 0, 1);
    const d = Math.hypot(P.x - (mx + ax * k), P.z - (mz + az * k));
    if (d > REACH[kind]) return;
    s.struck = true;
    let damage = HURT[kind] * DMG;
    let blocked = false;
    if (kind === 'swipe' && gear?.hatchet?.userData?.carried) {
      gear.hatchet.getWorldPosition(tmpH);
      if (tmpH.distanceTo(at.setY(P.headY - 0.35)) < 0.6) { blocked = true; damage *= 0.5; }
    }
    const shove = safeShove(P.x, P.z, P.x - s.x, P.z - s.z, SHOVE[kind]);
    emit('strike', { kind, damage: Math.round(damage), shove, blocked, position: root.position.clone() });
    if (blocked) emit('block');
  }
  const tmpH = new THREE.Vector3();
  const tmpA = new THREE.Vector3();

  function update(dt, p) {
    s.clock += dt;
    if (s.state === 'gone') { readPlayer(p); return; }
    const have = readPlayer(p);
    if (!model) return;
    // out of zone: freeze (no mixer, no AI) unless it's walking home / dying
    const busy = s.state === 'return' || s.state === 'settle' || (s.state === 'dead' && s.t < 4) || s.state === 'wake' || s.engaged;
    if (!have || (!P.inZone && !busy)) { if (!P.inZone) s.arrived = false; return; }
    s.t += dt;
    s.flinch = Math.max(0, s.flinch - dt);
    const d = playerDist();
    const fighting = !['sleep', 'dead', 'return', 'settle'].includes(s.state);
    if (fighting) {
      s.engaged += dt;
      s.away = P.inZone && P.feetY > deckY - 0.6 ? 0 : s.away + dt;
      if (s.away > 1.5) { emit('leave'); s.attack = null; setState('return'); s.engaged = 0; s.arrived = false; }
    }
    switch (s.state) {
      case 'sleep': {
        if (s.arrived && P.onDeck) { setState('wake'); s.engaged = 0.001; emit('wake', { position: root.position.clone() }); play('Idle', 1.4, 0.8); }
        break;
      }
      case 'wake': {           // ~3.4 s: stands up (1.4 s blend), rears and roars, drops to all fours
        turnTo(P.x, P.z, 0.9, dt);
        if (s.t > 1.4 && current !== actions.Rear) { play('Rear', 0.35, 0.8, 0); s.roared = false; }
        if (current === actions.Rear) {
          if (!s.roared && norm() > 0.28) { s.roared = true; emit('roar', { position: mouth(new THREE.Vector3()), intro: true }); }
          if (norm() >= 1) { play('Idle', 0.3); setState('stalk'); s.lastAttack = s.clock; s.cool = 1.5; }
        }
        break;
      }
      case 'stalk': {
        const limp = s.hp < MAX_HP * 0.4 ? 0.8 : 1;
        const close = d <= 0.8;
        let turn = Math.atan2(P.x - s.x, P.z - s.z) - s.yaw;
        turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
        if (close) turn = turnTo(P.x, P.z, 2.4, dt);   // in reach: square up; otherwise steer() does the turning
        if (s.rearQueued && s.clock - s.lastAttack > 0.8 && s.clock - (s.lastRear ?? -99) > 6 && Math.abs(s.x - GLIDER.x) > GLIDER.r) { s.rearQueued = false; s.lastRear = s.clock; startAttack('rear'); play('Rear', 0.3, 0.75, 0); break; }
        const ready = s.clock - s.lastAttack > s.cool && turn < 0.5;
        const early = s.engaged < 20;
        if (ready && d <= 1.05) { startAttack('swipe'); play('Swipe', 0.2, 0.55, 0); break; }
        if (ready && !early && d > 1.3 && d <= 2.6 && Math.random() < dt * 1.5) { startAttack('lunge'); play('Lunge', 0.25, 0.4, 0); break; }
        if (ready && !early && d > 3 && d < 5.5 && laneClear()) { startAttack('charge'); play('Paw', 0.25, 1.4, 0); break; }
        if (d < 0.45) {        // you walked into it (or it crowded you): it shuffles back rather than standing in you
          play('Walk', 0.3, -0.6);
          moveTo(s.x - Math.sin(s.yaw) * 0.6 * dt, s.z - Math.cos(s.yaw) * 0.6 * dt);
          break;
        }
        if (close) { play('Idle', 0.3); break; }
        const run = d > 3.4;
        const speed = (run ? 2.4 : 1.05) * limp;
        // woods den: from the summit, the shoulder (west of the climb slot) is reached over the crown, not across the slot
        const viaCrown = woods && s.x > 3.0 && P.x < 3.0 && P.z < -0.9 && s.z < -0.4;
        const moved = viaCrown ? steer(2.6, -0.15, speed, dt) : steer(P.x, P.z, speed, dt);
        play(moved ? (run ? 'Run' : 'Walk') : 'Walk', 0.3, moved ? (run ? 0.65 : 0.95 * limp) : 0.5);
        s.growlT = (s.growlT ?? 3) - dt;
        if (s.growlT <= 0) { s.growlT = 4 + Math.random() * 4; emit('growl', { position: mouth(new THREE.Vector3()) }); }
        break;
      }
      case 'swipe': {          // telegraph 0.75 s (paw up, huff), strike 0.42..0.62 of the clip
        const n = norm();
        if (n < 0.4) { turnTo(P.x, P.z, 1.2, dt); current.setEffectiveTimeScale(0.55); }
        else {
          current.setEffectiveTimeScale(1);
          if (n < 0.62 && d > 0.6) moveTo(s.x + Math.sin(s.yaw) * 0.6 * dt, s.z + Math.cos(s.yaw) * 0.6 * dt);
          if (n > 0.42 && n < 0.62) strike('swipe', mouth(tmpA, MOUTH + 0.4));
        }
        if (n >= 1) { if (!s.struck) emit('miss', { kind: 'swipe' }); play('Idle', 0.25); endAttack(); }
        break;
      }
      case 'lunge': {          // telegraph ~0.8 s (head down, two snorts), then a 0.9 m leap
        const n = norm();
        if (n < 0.32) { turnTo(P.x, P.z, 1.0, dt); current.setEffectiveTimeScale(0.4); }
        else {
          current.setEffectiveTimeScale(1.05);
          if (n < 0.68) {
            const v = 0.9 / (0.36 * current.getClip().duration / 1.05);
            if (d > 0.5) moveTo(s.x + Math.sin(s.yaw) * v * dt, s.z + Math.cos(s.yaw) * v * dt);
            strike('lunge', mouth(tmpA, MOUTH + 0.15));
          }
        }
        if (n >= 1) {
          if (!s.struck) { emit('miss', { kind: 'lunge' }); play('Idle', 0.2, 0.6); setState('open'); }
          else { play('Idle', 0.25); endAttack(); }
        }
        break;
      }
      case 'charge': {         // telegraph 0.9 s pawing the ground, then 5.5 m/s straight at where you stood
        if (s.t < 0.9) {
          turnTo(P.x, P.z, 1.6, dt);
          s.lockX = P.x; s.lockZ = P.z;
          if (s.t > 0.3 && !s.paw1) { s.paw1 = true; emit('paw', { position: root.position.clone() }); }
          if (s.t > 0.65 && !s.paw2) { s.paw2 = true; emit('paw', { position: root.position.clone() }); }
          break;
        }
        if (current !== actions.Run) { play('Run', 0.15, 1.35); emit('charge', { position: root.position.clone() }); s.paw1 = s.paw2 = false; s.stepT = 0; }
        const v = Math.min(5.5, 2 + (s.t - 0.9) * 12);   // pushes off over ~0.3 s: the moment to sidestep
        const ok = moveTo(s.x + Math.sin(s.yaw) * v * dt, s.z + Math.cos(s.yaw) * v * dt);
        s.travel += v * dt;
        s.stepT -= dt;
        if (s.stepT <= 0) { s.stepT = 0.22; emit('step', { position: root.position.clone() }); }
        strike('charge', mouth(tmpA, MOUTH));
        if (s.struck) { play('Idle', 0.3); endAttack(); break; }
        const past = Math.hypot(s.lockX - s.x, s.lockZ - s.z) < 0.4 || s.travel > 6;
        if (ok !== true || past) {   // skid into the wall / edge / past you: stunned
          emit('miss', { kind: 'charge' });
          emit('stun', { position: mouth(new THREE.Vector3()) });
          play('Paw', 0.15, 0.35, 0.3);
          setState('stunned');
        }
        break;
      }
      case 'stunned': if (s.t > 1.6) { play('Idle', 0.4); endAttack(); } break;
      case 'open': if (s.t > 1.0) endAttack(); break;
      case 'stagger': if (s.t > (s.staggerFor ?? 0.6)) { play('Idle', 0.3); endAttack(); } break;
      case 'rear': {           // rises 0..0.35, roar at 0.3, chest exposed 0.25..0.62, slam at ~0.74
        const n = norm();
        if (n < 0.3) turnTo(P.x, P.z, 0.8, dt);
        if (!s.roared && n > 0.3) { s.roared = true; emit('roar', { position: mouth(new THREE.Vector3()) }); }
        if (!s.slammed && n > 0.74) {
          s.slammed = true;
          emit('slam', { position: mouth(new THREE.Vector3(), 0.95) });
          strike('slam', mouth(tmpA, 0.95));
        }
        if (n >= 1) { s.roared = false; s.slammed = false; play('Idle', 0.3); endAttack(); }
        break;
      }
      case 'return': {
        let home = Math.hypot(DEN.x - s.x, DEN.z - s.z);
        if (s.t > 25) { s.x = DEN.x; s.z = DEN.z; home = 0; }   // wedged somewhere while nobody watched: snap home
        if (home < 0.15) {
          if (turnTo(DEN.x + Math.sin(DEN.yaw), DEN.z + Math.cos(DEN.yaw), 1.6, dt) < 0.08) { setState('settle'); lieDown(0.8); }
          else play('Idle', 0.3);
          break;
        }
        // head for the crown line first, then along it (the shoulder joins the nose at x > 1.6); woods den: off the
        // crown onto the summit at x 5, then up the path into the trees
        let tx = s.z < -0.9 && s.x < 3.2 ? Math.min(s.x, 2.2) : DEN.x;
        let tz = s.z < -0.9 && s.x < 3.2 ? -0.3 : DEN.z;
        if (woods && !(s.z < -0.9 && s.x < 3.2) && s.x < 4.6) { tx = 5.2; tz = 0.1; }
        play('Walk', 0.4, 0.9);
        steer(tx, tz, Math.min(home / dt, 1.0), dt, 2.2);
        break;
      }
      case 'settle': if (s.t > 2.2) { setState('sleep'); } break;
      case 'dead': {
        if (!s.rewarded && s.t > 2.2) {
          s.rewarded = true;
          const fx = Math.sin(s.yaw); const fz = Math.cos(s.yaw);
          let cx = s.x + fx * 1.4; let cz = s.z + fz * 1.4;
          if (!onDeck(cx, cz, 0.2)) { cx = s.x + Math.cos(s.yaw) * 0.7; cz = s.z - Math.sin(s.yaw) * 0.7; }
          if (!onDeck(cx, cz, 0.2)) { cx = s.x; cz = s.z; }
          claw = spawnClaw(cx, cz);
          emit('reward', { object: claw });
        }
        break;
      }
      default: break;
    }
    if (s.state === 'stalk' || s.state === 'swipe' || s.state === 'lunge' || s.state === 'charge' || s.state === 'rear' || s.state === 'wake') checkWeapons(dt);
    else if (s.state === 'stunned' || s.state === 'open' || s.state === 'stagger') checkWeapons(dt);
    root.position.set(s.x, deckY, s.z);
    root.rotation.y = s.yaw;
    skin.castShadow = s.state !== 'sleep' && s.state !== 'settle';
    mixer.update(dt);
    procedural(dt);
  }

  function laneClear() {
    const fx = P.x - s.x; const fz = P.z - s.z; const len = Math.hypot(fx, fz);
    const yaw = Math.atan2(fx, fz);
    for (let k = 0.4; k < len - 0.8; k += 0.4) if (!bearFits(s.x + (fx / len) * k, s.z + (fz / len) * k, yaw)) return false;
    return true;
  }

  // --- procedural layer: breathing, head aim, roar jaw, flinch -----------------
  const mq = new THREE.Quaternion();
  const touched = new Set();
  function addRot(name, axis, angle) {
    const b = bones[name];
    if (!b || Math.abs(angle) < 1e-5) return;
    if (!animated.has(name) && !touched.has(b)) b.quaternion.copy(rest.get(b));
    touched.add(b);
    b.quaternion.multiply(mq.setFromAxisAngle(axis[name], angle));
  }
  const pm = { aim: 0, gape: 0, breath: 0 };
  function procedural(dt) {
    touched.clear();
    const sleeping = s.state === 'sleep' || s.state === 'settle';
    pm.breath += dt * (sleeping ? 1.6 : 2.6);
    addRot('Ursidae_Spine_2', axisSide, Math.sin(pm.breath) * (sleeping ? 0.03 : 0.015));
    // head aim at the player while stalking / telegraphing
    let aim = 0;
    if (['stalk', 'swipe', 'lunge', 'wake', 'stunned', 'open'].includes(s.state) || (s.state === 'charge' && s.t < 0.9)) {
      let a = Math.atan2(P.x - s.x, P.z - s.z) - s.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
      aim = THREE.MathUtils.clamp(a, -0.6, 0.6);
    }
    pm.aim = THREE.MathUtils.damp(pm.aim, aim, 4, dt);
    addRot('Ursidae_Neck', axisUp, pm.aim * 0.5);
    addRot('Ursidae_Head', axisUp, pm.aim * 0.4);
    // jaw: wide open for the roars, a little during telegraphs; head lifts with the roar
    const roaring = (s.state === 'rear' || s.state === 'wake') && current === actions.Rear && norm() > 0.22 && norm() < 0.62;
    const want = roaring ? 1 : (s.state === 'swipe' || s.state === 'lunge' || s.state === 'charge') ? 0.35 : s.state === 'dead' ? 0.2 : 0;
    pm.gape = THREE.MathUtils.damp(pm.gape, want, roaring ? 9 : 5, dt);
    addRot('Ursidae_Jaw_01', axisSide, JAW_SIGN * 0.5 * pm.gape);
    addRot('Ursidae_Head', axisSide, -JAW_SIGN * 0.22 * (roaring ? pm.gape : 0));
    if (s.flinch > 0) addRot('Ursidae_Head', axisUp, Math.sin(s.flinch * 40) * 0.12 * s.flinch / 0.3);
  }
  const JAW_SIGN = Number(params.get('bearjaw')) || 1;

  // --- damage in --------------------------------------------------------------
  function hit(zone, point, source = 'arrow', o = {}) {
    if (!model || s.state === 'off' || s.state === 'gone') return null;
    if (s.state === 'dead') return source === 'arrow' ? { damage: 0, killed: false } : null;   // arrows stick in the carcass
    let dmg;
    if (source === 'arrow') dmg = ARROW[zone] ?? 10;
    else if (source === 'hatchet') dmg = THREE.MathUtils.clamp(10 + ((o.speed ?? 3) - 3) * 2.4, 10, 22) * (ZONE_MULT[zone] ?? 1);
    else if (source === 'club') dmg = Math.min(25, (8 + 0.6 * (o.speed ?? 0)) * (zone === 'head' ? 1.2 : ZONE_MULT[zone] ?? 1));
    else if (source === 'ball') dmg = 6;
    else dmg = 5;
    if (s.state === 'rear' && zone === 'chest' && norm() > 0.25 && norm() < 0.62) dmg *= 2;
    if (s.state === 'stunned' || s.state === 'open') dmg *= 1.5;
    if (s.state === 'wake') dmg *= 0.5;
    dmg = Math.max(1, Math.round(dmg));
    const crit = zone === 'head' || (s.state === 'rear' && zone === 'chest');
    const before = s.hp;
    s.hp = Math.max(0, s.hp - dmg);
    s.flinch = 0.3;
    if (s.state === 'sleep' || s.state === 'settle' || s.state === 'return') {   // shot in its sleep: wakes up angry
      s.arrived = true;
      if (s.hp > 0) { setState('wake'); s.engaged = 0.001; emit('wake', { position: root.position.clone(), ambush: true }); play('Idle', 0.8, 1); }
    }
    if (s.hp <= 0) {
      s.attack = null;
      setState('dead');
      s.engaged = 0;
      play('Death', 0.15, 0.8, 0);
      skin.castShadow = true;
      emit('hurt', { zone, damage: dmg, crit, source, hp: 0, killed: true, point: (point || root.position).clone() });
      emit('death', { position: root.position.clone() });
      s.kills += 1;
      save({ killedAt: Date.now(), kills: s.kills });
      return { damage: dmg, crit, killed: true };
    }
    emit('hurt', { zone, damage: dmg, crit, source, hp: s.hp, killed: false, point: (point || root.position).clone() });
    for (const f of [2 / 3, 1 / 3]) if (before > MAX_HP * f && s.hp <= MAX_HP * f) s.rearQueued = true;
    // staggers: a hard club hit to the head, or a big hit during a telegraph, cancels the attack
    const tele = (s.state === 'swipe' && norm() < 0.4) || (s.state === 'lunge' && norm() < 0.32) || (s.state === 'charge' && s.t < 0.9);
    if ((source === 'club' && (o.speed ?? 0) >= 25 && zone === 'head') || (tele && dmg >= 20)) {
      s.attack = null; setState('stagger'); s.staggerFor = 0.7; play('Paw', 0.12, 0.6, 0.2); emit('stagger');
    } else if (source === 'ball' && tele) {
      s.attack = null; setState('stagger'); s.staggerFor = 0.5; play('Idle', 0.15); emit('stagger');
    }
    return { damage: dmg, crit, killed: false };
  }
  const seg = new THREE.Line3(); const near = new THREE.Vector3(); const zp = new THREE.Vector3();
  function sweep(a, b, pad) {
    seg.set(a, b);
    let best = null; let bestD = Infinity;
    for (const z of zones) {
      z.getWorldPosition(zp);
      seg.closestPointToPoint(zp, true, near);
      const dd = near.distanceTo(zp) - z.geometry.parameters.radius - pad;
      if (dd < 0 && dd < bestD) { bestD = dd; best = { zone: z.userData.foeZone, point: near.clone() }; }
    }
    return best;
  }
  function chop(a, b, speed = 3) {   // hatchet blade segment (gear.js), one hit per swing
    if (!model || s.state === 'dead' || s.state === 'gone' || speed < 2.5 || s.clock - s.chopAt < 0.4) return null;
    root.updateMatrixWorld(true);
    const best = sweep(a, b, 0.05);
    if (!best) return null;
    s.chopAt = s.clock;
    return hit(best.zone, best.point, 'hatchet', { speed });
  }
  // golf club face and driven balls (golf.js face + ball state)
  const clubPrev = new THREE.Vector3(); const clubNow = new THREE.Vector3(); let clubSeen = false;
  const ballPrev = new THREE.Vector3(); const ballNow = new THREE.Vector3(); let ballSeen = false;
  function checkWeapons() {
    if (!golf?.face || !zones.length) return;
    root.updateMatrixWorld(true);
    const f = golf.face;
    if (golf.club.userData.carried) {
      clubNow.set(f.c.x, f.c.y, f.c.z);
      const speed = Math.hypot(f.v.x, f.v.y, f.v.z);
      if (clubSeen && speed > 4 && s.clock - s.clubAt > 0.35) {
        const best = sweep(clubPrev, clubNow, 0.06);
        if (best) { s.clubAt = s.clock; hit(best.zone, best.point, 'club', { speed }); }
      }
      clubPrev.copy(clubNow); clubSeen = true;
    } else clubSeen = false;
    const ball = golf.ballState;
    if (ball) {
      ballNow.set(ball.p.x, ball.p.y, ball.p.z);
      const v = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
      if (ballSeen && v > 6 && s.clock - s.ballAt > 0.4) {
        const best = sweep(ballPrev, ballNow, 0.025);
        if (best) {
          s.ballAt = s.clock;
          hit(best.zone, best.point, 'ball', { speed: v });
          ball.v.x *= -0.25; ball.v.z *= -0.25; ball.v.y = Math.abs(ball.v.y) * 0.3;   // thuds off the fur
        }
      }
      ballPrev.copy(ballNow); ballSeen = true;
    }
  }

  // --- reward + save ----------------------------------------------------------
  function spawnClaw(x, z) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.45, metalness: 0.05 });
    const pad = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), pad);
    base.scale.set(1.4, 0.6, 1);
    g.add(base);
    for (let i = 0; i < 4; i += 1) {   // four curved claws on a bit of paw
      const geo = new THREE.ConeGeometry(0.008, 0.075, 6, 4);
      geo.translate(0, 0.0375, 0);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k += 1) { const y = pos.getY(k); pos.setZ(k, pos.getZ(k) + y * y * 4); }
      geo.computeVertexNormals();
      const c = new THREE.Mesh(geo, mat);
      c.position.set(-0.03 + i * 0.02, 0.01, 0.02);
      c.rotation.x = Math.PI / 2 - 0.3;
      g.add(c);
    }
    g.position.set(x, deckY + 0.02, z);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.userData = { type: 'prop', label: 'bear claw', role: 'loose', floorY: 0.02 };
    scene.add(g);
    targets?.push(g);
    return g;
  }
  function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; } }
  function save(v) { try { if (v) localStorage.setItem(SAVE_KEY, JSON.stringify(v)); else localStorage.removeItem(SAVE_KEY); } catch { /* private mode */ } }

  const api = {
    root, zones, update, hit, chop, safeShove, onDeck, prefetch,
    on(type, fn) { (listeners[type] ||= []).push(fn); return api; },
    state: () => s.state,
    den: () => DEN,
    hp: () => s.hp,
    maxHp: MAX_HP,
    alive: () => s.state !== 'dead' && s.state !== 'gone',
    engaged: () => s.engaged > 0 && !['sleep', 'dead', 'gone', 'return', 'settle'].includes(s.state),
    ready: () => !!model,
    claw: () => claw,
    mouth: () => mouth(new THREE.Vector3()),
    clip: () => (current ? `${current.getClip().name}@${norm().toFixed(2)}` : null),
    // test hooks (headless harness / ?beardebug=1)
    debugPlace(x, z, yaw, state = 'stalk') { s.x = x; s.z = z; s.yaw = yaw; setState(state); if (state !== 'sleep') s.engaged = Math.max(s.engaged, 0.001); root.position.set(x, deckY, z); root.rotation.y = yaw; },
    debugPose(name, n, extra = {}) { mixer.stopAllAction(); current = null; play(name, 0, 1, n); mixer.update(0); Object.assign(pm, extra); procedural(0); },
    debugBuild: build,
    _fits: (x, z, yaw) => bearFits(x, z, yaw),
    _s: s,
  };
  return api;
}
