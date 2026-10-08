// Swimming (surface + diving), breath and air, the mask HUD, underwater sound and the shark scare.
// Falling or wading into the sea no longer means the instant shark bite: you swim. ?swim=0 brings the old bite back.
// - Entering: landing in open water (the old bite trigger), walking off the shallows / the rock shelf with the stick
//   (hold toward the water), stepping out over open water, or leaning far out of the floating canoe.
// - Arm strokes: squeeze a grip (or the trigger) and pull: you glide the opposite way the hands move (pull both hands
//   back = forward along your hands, push down = up). Hands only push while they're in the water. Glide decays
//   (drag 0.9/s, fins 0.6/s), top speed 1.6 m/s (fins 2.4). ?strokegrip=0 lets open-hand strokes count too.
// - Left stick: slow swim (0.8 m/s, fins 1.2) toward where you look (level on the surface). Snap turn as on land.
// - Buoyancy: you float with your eyes just above the waves. Without the tank you can duck-dive to 2.5 m on a breath
//   (?breath= s, default 25) and you drift back up; with the tank you're near neutral below 0.6 m and can go to the
//   seabed on ?air= s of air (default 180). Out of breath/air: the view closes in, then a drowning fade and respawn.
// - Exits: swim into the shallows, the cave pad or the rock shelf and you stand up; squeeze with a hand on the floating
//   canoe's hull to climb in; grab a ladder rung / notch as on land.
// - Sharks are scenery now: no bite in the sea. Underwater, now and then a white shark glides out of the murk past you
//   and away (?sharkscare=0 off). The croc's rules in the cave pool are unchanged.
// - Sound: everything sample-based is low-passed under water (sfx.setMuffle), an underwater bed, regulator breathing
//   with the tank, bubbles (and haptics) on strokes and exhales.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { stickToWorld } from './walk.js';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const num = (key, fallback) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) && v > 0 ? v : fallback;
};
export const SWIM = params.get('swim') !== '0';
const STROKE_GRIP = params.get('strokegrip') !== '0';
const SCARE = params.get('sharkscare') !== '0';
const SCARE_SOON = params.get('sharkscare') === 'now';
const BREATH = num('breath', 25);
const AIR = num('air', 180);
const FREEDIVE = 2.5;     // m: deepest the head goes without the tank
const FLOAT = 0.1;        // eyes above the surface when floating
const K_HAND = 1.5;       // stroke gain (1/s): m/s of hand speed -> m/s^2 of push
const MAX_SPEED = 1.6;
const STICK_SPEED = 0.8;
const BOUNDS = { x0: -62, z0: -30, z1: 30 };

export function createSwim({ renderer, scene, camera, world, underwater, scuba, sfx, audio, controllers, waterY, assets, api }) {
  const vel = new THREE.Vector3();
  const head = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const fwd = new THREE.Vector3();
  const thrust = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const lastRig = new THREE.Vector3();
  const hands = new Map();
  let active = false;
  let breath = BREATH;
  let air = AIR;
  let underT = 0;
  let wasUnder = false;
  let outT = -1;          // >= 0: out of breath/air, seconds since
  let drownT = -1;        // >= 0: drowning fade running
  let lowBreath = false;
  let warned30 = false;
  let warned10 = false;
  let enterHold = 0;
  let rollHold = 0;
  let lastYaw = 0;
  let comfort = 0;
  let stats = { strokes: 0, enters: 0, exits: {}, maxDepth: 0, scares: 0 };
  let strokeCool = 0;
  let puffT = 2;
  let regT = 0;
  let regPhase = 0;
  let lastExit = '';
  const surfaceAt = (x, z) => (underwater ? underwater.surfaceAt(x, z) : waterY + (world.water?.heightAt ? world.water.heightAt(x, z) : 0));
  const floorAt = (x, z) => (underwater ? underwater.floorAt(x, z) : (world.reef?.floorY ? world.reef.floorY(x, z) : waterY - 4.6));
  const bubble = (at, n, opts) => underwater?.emitBubbles(at, n, opts);
  const cave = world.cave;
  const shelfBox = world.notches?.shelf;

  // ---------------- HUD: mask frame + breath darkening (camera child), air gauge (camera child + left wrist) ----------------
  const veilU = { uMask: { value: 0 }, uDark: { value: 0 }, uRed: { value: 0 } };
  const veil = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 16),
    new THREE.ShaderMaterial({
      uniforms: veilU,
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uMask; uniform float uDark; uniform float uRed; varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float f = -d.z;
          vec2 a = vec2(atan(d.x, max(f, 0.001)), atan(d.y, max(f, 0.001)));
          float noseCut = smoothstep(0.34, 0.0, abs(a.x)) * 0.3;
          vec2 q = vec2(a.x / 0.9, a.y / (a.y < 0.0 ? 0.6 - noseCut : 0.6));
          float r = pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25);
          if (f < 0.08) r = 2.0;
          float frame = smoothstep(0.97, 1.03, r) * uMask;
          float rim = smoothstep(0.9, 0.985, r) * (1.0 - smoothstep(0.985, 1.03, r)) * uMask;
          float glass = (1.0 - frame) * uMask * 0.05;
          float edge = 1.0 - smoothstep(0.5 - 0.35 * uDark, 0.97, f);
          float dark = clamp(edge * uDark * 1.3 + smoothstep(0.75, 1.0, uDark), 0.0, 1.0);
          float red = uRed * edge * 0.55;
          vec3 col = vec3(0.012, 0.022, 0.03) * frame + vec3(0.2, 0.32, 0.36) * rim * 0.6 + vec3(0.02, 0.07, 0.08) * glass;
          col = mix(col, vec3(0.32, 0.0, 0.02), red * (1.0 - frame));
          float alpha = max(max(frame * 0.97, rim * 0.35), max(glass, red));
          col *= 1.0 - dark;
          alpha = max(alpha, dark);
          gl_FragColor = vec4(col, alpha);
        }`,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false,
    }),
  );
  veil.renderOrder = 997;
  veil.frustumCulled = false;
  veil.visible = false;
  veil.raycast = () => {};
  if (!camera.parent) scene.add(camera);
  camera.add(veil);

  const gaugeCanvas = document.createElement('canvas');
  gaugeCanvas.width = 256; gaugeCanvas.height = 96;
  const gctx = gaugeCanvas.getContext('2d');
  const gaugeTex = new THREE.CanvasTexture(gaugeCanvas);
  gaugeTex.colorSpace = THREE.SRGBColorSpace;
  const gaugeMat = new THREE.MeshBasicMaterial({ map: gaugeTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.096, 0.036), gaugeMat);
  gauge.position.set(0.085, -0.13, -0.42);
  gauge.rotation.set(0.25, -0.18, 0);
  gauge.renderOrder = 1000;
  gauge.visible = false;
  gauge.raycast = () => {};
  camera.add(gauge);
  const wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.026), new THREE.MeshBasicMaterial({ map: gaugeTex, transparent: true, fog: false, toneMapped: false }));
  wrist.position.set(0, 0.035, 0.07);
  wrist.rotation.set(-1.1, 0, 0);
  wrist.visible = false;
  wrist.raycast = () => {};
  let wristHost = null;
  let gaugeKey = '';
  function drawGauge(label, value, max, warn) {
    const secs = Math.max(0, Math.ceil(value));
    const key = `${label}|${secs}|${warn}`;
    if (key === gaugeKey) return;
    gaugeKey = key;
    const g = gctx;
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(4,16,22,0.72)';
    g.beginPath(); g.roundRect(4, 4, 248, 88, 18); g.fill();
    const col = warn === 2 ? '#ff5a4a' : warn === 1 ? '#ffc04a' : '#7fe8e0';
    g.fillStyle = col;
    g.font = 'bold 26px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(label, 18, 30);
    const txt = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}s`;
    g.textAlign = 'right';
    g.fillText(txt, 238, 30);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(18, 56, 220, 20);
    g.fillStyle = col;
    g.fillRect(18, 56, 220 * THREE.MathUtils.clamp(value / max, 0, 1), 20);
    gaugeTex.needsUpdate = true;
  }

  // ---------------- sound ----------------
  let snd = null;
  function noiseBuffer(ctx, secs, brown = false) {
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  function sound() {
    if (snd) return snd;
    let ctx;
    try { ctx = audio(); } catch { return null; }
    if (!ctx) return null;
    const out = ctx.createGain(); out.gain.value = 0.9; out.connect(ctx.destination);
    const bedSrc = ctx.createBufferSource(); bedSrc.buffer = noiseBuffer(ctx, 4, true); bedSrc.loop = true;
    const bedLp = ctx.createBiquadFilter(); bedLp.type = 'lowpass'; bedLp.frequency.value = 340;
    const bed = ctx.createGain(); bed.gain.value = 0;
    bedSrc.connect(bedLp); bedLp.connect(bed); bed.connect(out); bedSrc.start();
    snd = { ctx, out, bed, white: noiseBuffer(ctx, 2), brown: noiseBuffer(ctx, 2, true) };
    return snd;
  }
  function burst({ buf = 'white', type = 'bandpass', freq = 1200, q = 1, gain = 0.1, attack = 0.05, hold = 0.2, release = 0.4, rate = 1 }) {
    const s = sound();
    if (!s) return;
    const t = s.ctx.currentTime;
    const src = s.ctx.createBufferSource(); src.buffer = s[buf]; src.playbackRate.value = rate;
    const f = s.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = s.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    src.connect(f); f.connect(g); g.connect(s.out);
    src.start(t, Math.random()); src.stop(t + attack + hold + release + 0.05);
  }
  function blips(n = 5, base = 500, spread = 0.5, gain = 0.05) {
    const s = sound();
    if (!s) return;
    for (let i = 0; i < n; i += 1) {
      const t = s.ctx.currentTime + Math.random() * spread;
      const o = s.ctx.createOscillator(); o.type = 'sine';
      const f0 = base * (0.6 + Math.random() * 1.2);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + 0.05);
      const g = s.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * (0.5 + Math.random()), t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g); g.connect(s.out); o.start(t); o.stop(t + 0.09);
    }
  }
  function stinger() {
    const s = sound();
    if (!s) return;
    const t = s.ctx.currentTime;
    const lp = s.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(220, t); lp.frequency.linearRampToValueAtTime(900, t + 2.2);
    const g = s.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 1.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    lp.connect(g); g.connect(s.out);
    [55, 55.6, 82.4, 110.3].forEach((f) => { const o = s.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 4.6); });
  }
  let muffle = 0;
  let bedLevel = 0;
  function updateSound(dt, under) {
    muffle += ((under ? 1 : 0) - muffle) * Math.min(1, dt / 0.3);
    sfx?.setMuffle?.(muffle);
    const want = under ? 0.22 : 0;
    if (want > 0 || bedLevel > 0.001) {
      const s = sound();
      if (s) { bedLevel += (want - bedLevel) * Math.min(1, dt / 0.3); s.bed.gain.value = bedLevel; }
    }
  }

  // ---------------- shark scare: one white shark of our own, glides past and away ----------------
  const scare = { t: -1, cool: SCARE_SOON ? 3 : 14, root: null, mixer: null, p0: new THREE.Vector3(), c: new THREE.Vector3(), p1: new THREE.Vector3(), dur: 8.5, beat: false };
  if (SCARE) {
    const src = assets?.gltf?.('shark_white');
    if (src?.scene) {
      const vis = skeletonClone(src.scene);
      vis.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.raycast = () => {}; o.castShadow = false; } });
      const root = new THREE.Group();
      root.add(vis);
      root.scale.setScalar(1.35);
      root.visible = false;
      root.name = 'scare_shark';
      scene.add(root);
      const clip = THREE.AnimationClip.findByName(src.animations, 'Swim');
      scare.root = root;
      if (clip) { scare.mixer = new THREE.AnimationMixer(vis); scare.mixer.clipAction(clip).play(); }
    }
  }
  const basis = new THREE.Matrix4();
  const bx = new THREE.Vector3(); const by = new THREE.Vector3(); const bz = new THREE.Vector3();
  function bez(out, t) {
    const u = 1 - t;
    return out.set(0, 0, 0).addScaledVector(scare.p0, u * u).addScaledVector(scare.c, 2 * u * t).addScaledVector(scare.p1, t * t);
  }
  function startScare() {
    if (!scare.root) return false;
    fwd.set(0, 0, -1).applyQuaternion(quat); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(-1, 0, 0);
    fwd.normalize();
    const side = tmp.set(-fwd.z, 0, fwd.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    const mid = new THREE.Vector3().copy(head).addScaledVector(fwd, 3.0); mid.y -= 0.5;
    scare.p0.copy(head).addScaledVector(side, 15).addScaledVector(fwd, 7); scare.p0.y -= 1.0;
    scare.p1.copy(head).addScaledVector(side, -15).addScaledVector(fwd, 8); scare.p1.y -= 1.4;
    scare.c.copy(mid).multiplyScalar(2).addScaledVector(scare.p0, -0.5).addScaledVector(scare.p1, -0.5);
    scare.t = 0;
    scare.beat = false;
    scare.root.visible = true;
    stats.scares += 1;
    stinger();
    return true;
  }
  function updateScare(dt) {
    if (scare.t < 0) {
      if (!SCARE || !scare.root || !active || !wasUnder) return;
      scare.cool -= dt;
      const depth = surfaceAt(head.x, head.z) - head.y;
      if (scare.cool <= 0 && underT > (SCARE_SOON ? 2 : 10) && depth > 0.9 && head.x < -8) {
        if (startScare()) scare.cool = 70 + Math.random() * 40;
      }
      return;
    }
    scare.t += dt;
    const k = Math.min(1, scare.t / scare.dur);
    const p = bez(new THREE.Vector3(), k);
    const ahead = bez(new THREE.Vector3(), Math.min(1, k + 0.01));
    const lo = floorAt(p.x, p.z) + 0.9;
    const hi = surfaceAt(p.x, p.z) - 0.7;
    p.y = THREE.MathUtils.clamp(p.y, lo, Math.max(lo, hi));
    bx.subVectors(ahead, bez(new THREE.Vector3(), k)).normalize();
    if (bx.lengthSq() < 1e-6) bx.set(1, 0, 0);
    by.set(0, 1, 0); bz.crossVectors(bx, by).normalize(); by.crossVectors(bz, bx).normalize();
    basis.makeBasis(bx, by, bz);
    scare.root.quaternion.setFromRotationMatrix(basis);
    scare.root.position.copy(p);
    scare.mixer?.update(dt * 1.3);
    underwater?.setThreat(p, 7);
    const d = p.distanceTo(head);
    if (!scare.beat && d < 5) {
      scare.beat = true;
      api.heartbeat?.(0.9);
      controllers.forEach((c) => api.pulse(c, 0.8, 140));
      bubble(tmp.copy(head).add(new THREE.Vector3(0, -0.12, 0)), 14, { spread: 0.08, size: 0.016 });
      api.setStatus?.('A white shark slides out of the murk, looks you over, and turns away.');
    }
    if (k >= 1 || !active) {
      scare.t = -1;
      scare.root.visible = false;
      underwater?.setThreat(null);
    }
  }

  // ---------------- state changes ----------------
  function rigNow() { return api.rig(); }
  function shift(dx, dy, dz) {
    const ok = api.shift(dx, dy, dz);
    lastRig.copy(rigNow());
    return ok;
  }
  function enter(why, v = null) {
    active = true;
    vel.set(0, 0, 0);
    if (v) vel.copy(v);
    hands.clear();
    lastRig.copy(rigNow());
    lastYaw = api.yaw();
    stats.enters += 1;
    outT = -1;
    drownT = -1;
    enterHold = 0;
    if (why !== 'quiet') {
      api.setStatus?.(scuba?.has('tank')
        ? 'In the sea. Squeeze both grips and pull back to swim. Pull down to dive.'
        : 'In the sea. Squeeze both grips and pull back to swim. Hold your breath to duck under; get the dive kit on the roof to go deep.');
    }
  }
  function exit(why) {
    if (!active) return;
    active = false;
    vel.set(0, 0, 0);
    hands.clear();
    stats.exits[why] = (stats.exits[why] || 0) + 1;
    lastExit = why;
    breath = BREATH;
    outT = -1;
    drownT = -1;
    lowBreath = false;
    if (why !== 'drown') { air = AIR; warned30 = false; warned10 = false; }
    comfort = 0;
  }
  function drown() {
    exit('drown');
    air = AIR; warned30 = false; warned10 = false;
    api.respawn?.();
    api.setStatus?.(scuba?.has('tank') ? 'Your tank ran dry. You come to on the cliff edge.' : 'You ran out of breath. You come to on the cliff edge.');
  }

  // ---------------- per-hand stroke tracking ----------------
  function handState(c) {
    let h = hands.get(c);
    if (!h) { h = { prev: new THREE.Vector3(), has: false, cool: 0, bub: 0 }; hands.set(c, h); }
    return h;
  }
  function gripPose(frame, ref, c) {
    const src = c.userData.inputSource;
    const space = src?.gripSpace || src?.targetRaySpace;
    const pose = space && frame.getPose(space, ref);
    return pose ? pose.transform.position : null;
  }
  function handPointsOf(c) {
    const p = c.userData.grip?.getWorldPosition?.(new THREE.Vector3()) ?? c.getWorldPosition(new THREE.Vector3());
    return [p];
  }

  // ---------------- dry: ways into the water ----------------
  function checkEnter(dt, frame, ref, pose) {
    if (api.climbing() || api.busy?.()) { enterHold = 0; rollHold = 0; return; }
    const rig = rigNow();
    const feet = rig.y;
    // leaning far out of the floating canoe: roll over the side
    if (api.aboard()) {
      enterHold = 0;
      const boat = world.canoe;
      if (!boat?.floating?.()) { rollHold = 0; return; }
      tmp.copy(head);
      boat.group.worldToLocal(tmp);
      const seatY = boat.seatPoint.y;
      if (Math.abs(tmp.x) > 0.85 && head.y < seatY + 0.95) {
        rollHold += dt;
        if (rollHold > 0.5) {
          rollHold = 0;
          const side = new THREE.Vector3(Math.sign(tmp.x), 0, 0).applyQuaternion(boat.group.quaternion);
          api.leaveCanoe();
          world.splash?.(head.x, head.z, true);
          enter('roll', side.multiplyScalar(0.8).setY(-1.2));
          api.setStatus?.('Over the side. Squeeze a hand on the hull to climb back in.');
        }
      } else rollHold = 0;
      return;
    }
    rollHold = 0;
    if (feet > waterY + 0.4 || feet < waterY - 1.2) { enterHold = 0; return; }
    const g = api.groundUnder(head.x, head.z, feet);
    if (api.walker.isWater(g, head.x, head.z) && feet <= waterY + 0.08) {
      enter('step');
      return;
    }
    // stick held toward open water from the shallows / the shelf: wade out
    let stickHand = null;
    for (const c of controllers) if (c.userData.inputSource?.handedness === 'left' && c.userData.inputSource.gamepad) stickHand = c;
    const pad = stickHand?.userData.inputSource.gamepad;
    if (!pad) { enterHold = 0; return; }
    const st = stickToWorld(pose.transform.orientation, pad.axes?.[2] ?? 0, pad.axes?.[3] ?? 0);
    if (st.mag < 0.6) { enterHold = 0; return; }
    const len = Math.hypot(st.x, st.z) || 1;
    const dx = st.x / len;
    const dz = st.z / len;
    const probe = api.walker.walkable(head.x + dx * 0.45, head.z + dz * 0.45, feet);
    if (probe.ok || probe.why !== 'water') { enterHold = 0; return; }
    enterHold += dt;
    if (enterHold < 0.35) return;
    shift(dx * 0.55, 0, dz * 0.55);
    head.x += dx * 0.55; head.z += dz * 0.55;
    world.splash?.(head.x, head.z, false);
    enter('wade', new THREE.Vector3(dx * 0.6, 0, dz * 0.6));
  }

  // ---------------- collisions ----------------
  function eastLimit(z) {
    if (cave && z >= cave.z0 && z <= cave.z1) return cave.x0 - 0.1; // the shallows/cave mouth: standing up happens first
    if (shelfBox && z >= shelfBox.z0 - 0.3 && z <= shelfBox.z1 + 0.3) return shelfBox.x1;
    return -2.3;
  }
  function collide(p, v) {
    // sea limits
    if (p.x < BOUNDS.x0) { p.x = BOUNDS.x0; v.x = Math.max(v.x, 0); }
    if (p.z < BOUNDS.z0) { p.z = BOUNDS.z0; v.z = Math.max(v.z, 0); }
    if (p.z > BOUNDS.z1) { p.z = BOUNDS.z1; v.z = Math.min(v.z, 0); }
    const ex = eastLimit(p.z);
    if (p.x > ex) { p.x = ex; v.x = Math.min(v.x, 0); }
    // sea rocks (cylinders round each boulder)
    for (const r of underwater?.rocks || []) {
      if (p.y > r.top + 0.25 || p.y < r.bottom - 0.3) continue;
      const dx = p.x - r.x;
      const dz = p.z - r.z;
      const d = Math.hypot(dx, dz);
      const min = r.r + 0.28;
      if (d < min && d > 1e-4) {
        p.x = r.x + (dx / d) * min;
        p.z = r.z + (dz / d) * min;
        const vn = (v.x * dx + v.z * dz) / d;
        if (vn < 0) { v.x -= (dx / d) * vn; v.z -= (dz / d) * vn; }
      }
    }
    // the wreck (its local bounding box, 0.3 m margin)
    const wb = underwater?.wreckBox;
    if (wb) {
      tmp.copy(p).applyMatrix4(wb.inv);
      const m = 0.3;
      const b = wb.box;
      if (tmp.x > b.min.x - m && tmp.x < b.max.x + m && tmp.y > b.min.y - m && tmp.y < b.max.y + m && tmp.z > b.min.z - m && tmp.z < b.max.z + m) {
        const pens = [[tmp.x - (b.min.x - m), 'x', b.min.x - m], [(b.max.x + m) - tmp.x, 'x', b.max.x + m], [tmp.y - (b.min.y - m), 'y', b.min.y - m], [(b.max.y + m) - tmp.y, 'y', b.max.y + m], [tmp.z - (b.min.z - m), 'z', b.min.z - m], [(b.max.z + m) - tmp.z, 'z', b.max.z + m]];
        pens.sort((a, c) => a[0] - c[0]);
        tmp[pens[0][1]] = pens[0][2];
        p.copy(tmp.applyMatrix4(wb.matrix));
        v.multiplyScalar(0.5);
      }
    }
    // seabed
    const fl = floorAt(p.x, p.z) + 0.35;
    if (p.y < fl) { p.y = fl; v.y = Math.max(v.y, 0); }
  }

  // ---------------- main update ----------------
  const target = new THREE.Vector3();
  const stickMove = new THREE.Vector3();
  function update(dt, frame) {
    if (!renderer.xr.isPresenting || !frame) {
      if (active) exit('session');
      veil.visible = false; gauge.visible = false; wrist.visible = false;
      return;
    }
    const ref = renderer.xr.getReferenceSpace();
    const pose = ref && frame.getViewerPose(ref);
    if (!pose) return;
    const pp = pose.transform.position;
    head.set(pp.x, pp.y, pp.z);
    const o = pose.transform.orientation;
    quat.set(o.x, o.y, o.z, o.w);
    // scuba hover highlight + wrist gauge host
    if (scuba) {
      const pts = [];
      if (Math.abs(head.y - (world.roof?.y ?? 3.26) - 1.2) < 1.6) for (const c of controllers) pts.push(...handPointsOf(c));
      scuba.hover(pts);
    }
    if (!wristHost) {
      const left = controllers.find((c) => c.userData.inputSource?.handedness === 'left');
      if (left?.userData.grip) { wristHost = left.userData.grip; wristHost.add(wrist); }
    }

    if (!active) {
      checkEnter(dt, frame, ref, pose);
      if (!active) {
        updateHud(dt, false, 0);
        updateSound(dt, false);
        updateScare(dt);
        return;
      }
    }
    // ---- exits that someone else caused ----
    if (api.aboard()) { exit('boat'); return; }
    if (api.climbing()) { exit('climb'); return; }
    const rig = rigNow();
    const yaw = api.yaw();
    const turned = Math.abs(yaw - lastYaw) > 1e-4; // snap turns pivot the rig round the head: not a teleport
    lastYaw = yaw;
    if (!turned && rig.distanceTo(lastRig) > 0.6) { exit('moved'); return; } // teleport / respawn moved the rig
    lastRig.copy(rig);

    const surf = surfaceAt(head.x, head.z);
    const depth = surf - head.y;
    const under = depth > 0.04;
    const tank = !!scuba?.has('tank');
    const fins = !!scuba?.has('fins');
    const mask = !!scuba?.has('mask');
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    // ---- strokes ----
    thrust.set(0, 0, 0);
    let pulling = 0;
    let power = 0;
    strokeCool = Math.max(0, strokeCool - dt);
    for (const c of controllers) {
      const h = handState(c);
      const p = gripPose(frame, ref, c);
      if (!p) { h.has = false; continue; }
      tmp.set(p.x - rig.x, p.y - rig.y, p.z - rig.z); // physical hand (yaw-rotated): our own glide doesn't count
      if (!h.has || turned) { h.prev.copy(tmp); h.has = true; continue; }
      const vx = (tmp.x - h.prev.x) / dt; const vy = (tmp.y - h.prev.y) / dt; const vz = (tmp.z - h.prev.z) / dt;
      h.prev.copy(tmp);
      let sp = Math.hypot(vx, vy, vz);
      if (sp > 5) continue; // tracking glitch
      const grip = c.userData.squeezeDown || c.userData.triggerDown;
      const wet = p.y < surfaceAt(p.x, p.z) + 0.12;
      if (!wet || (STROKE_GRIP ? !grip : sp < 0.6) || world.gear?.isHolding?.(c)) continue;
      thrust.x -= vx; thrust.y -= vy; thrust.z -= vz;
      pulling += 1;
      power += sp;
      if (sp > 0.7) {
        h.cool -= dt;
        if (h.cool <= 0) { h.cool = 0.09; api.pulse(c, Math.min(0.45, 0.08 + sp * 0.12), 14); }
        if (under) {
          h.bub -= dt;
          if (h.bub <= 0) { h.bub = 0.12; bubble(tmp.set(p.x, p.y, p.z), 2, { spread: 0.04, size: 0.008 }); }
        }
      }
    }
    if (pulling) {
      const gain = K_HAND * (fins ? 1.6 : 1) * (pulling === 2 ? 0.5 : 0.8); // two hands average; one hand pulls a bit less
      thrust.multiplyScalar(gain);
      vel.addScaledVector(thrust, dt);
      if (power > 2.2 && strokeCool <= 0) {
        strokeCool = 0.45;
        stats.strokes += 1;
        if (under) burst({ buf: 'brown', type: 'lowpass', freq: 500, gain: Math.min(0.14, 0.03 * power), attack: 0.08, hold: 0.1, release: 0.35 });
        else burst({ buf: 'white', type: 'bandpass', freq: 900, q: 0.7, gain: Math.min(0.08, 0.02 * power), attack: 0.03, hold: 0.05, release: 0.3 });
      }
    }

    // ---- buoyancy / gravity / drag ----
    const top = surf + FLOAT;
    const airborne = head.y > top + 0.25;
    if (airborne) vel.y -= 9.8 * dt;
    else {
      if (depth < 0.6 && !(pulling && thrust.y < 0)) vel.y += (top - head.y) * (tank ? 2.5 : 4) * dt; // float at the surface (not while pulling down: duck dive)
      else if (!tank) vel.y += 0.9 * dt; // lungs full: you drift up. With the tank you hang neutral.
      if (outT >= 0 && !tank) vel.y += 3 * dt; // blacking out: you float up
      if (!tank && depth > FREEDIVE) { vel.y = Math.max(vel.y, 0) + (depth - FREEDIVE) * 4 * dt; }
      const dragH = fins ? 0.6 : 0.9;
      const dragV = depth < 0.6 && !pulling ? 2.2 : 1.4;
      vel.x *= Math.exp(-dragH * dt);
      vel.z *= Math.exp(-dragH * dt);
      vel.y *= Math.exp(-dragV * dt);
      const max = MAX_SPEED * (fins ? 1.5 : 1);
      const sp = vel.length();
      if (sp > max) vel.multiplyScalar(max / sp);
    }

    // ---- stick swim ----
    stickMove.set(0, 0, 0);
    for (const c of controllers) {
      const src = c.userData.inputSource;
      if (src?.handedness !== 'left' || !src.gamepad) continue;
      const sx = src.gamepad.axes?.[2] ?? 0;
      const sy = src.gamepad.axes?.[3] ?? 0;
      const mag = Math.min(1, Math.hypot(sx, sy));
      if (mag < 0.15) continue;
      const k = (mag - 0.15) / 0.85;
      fwd.set(0, 0, -1).applyQuaternion(quat);
      const right = tmp.set(1, 0, 0).applyQuaternion(quat);
      const dir = new THREE.Vector3().addScaledVector(fwd, -sy).addScaledVector(right, sx);
      if (depth < 0.35 && !(tank && dir.y < -0.35)) dir.y = 0; // level on the surface (with the tank, look down to dive)
      else if (!tank && dir.y < 0) dir.y *= 0.6;
      if (dir.lengthSq() > 1e-6) dir.normalize();
      stickMove.addScaledVector(dir, STICK_SPEED * (fins ? 1.5 : 1) * k * dt);
    }

    // ---- move + collide ----
    target.copy(head).addScaledVector(vel, dt).add(stickMove);
    collide(target, vel);
    // stand up where there's footing within reach (shallows, cave pad, rock shelf)
    const g = api.groundUnder(target.x, target.z, target.y - 1.0);
    if (!api.walker.isWater(g, target.x, target.z) && g >= target.y - 1.8 && g <= target.y + 0.3) { // incl. ledges at the waterline (shelf, cave pad)
      shift(target.x - head.x, 0, target.z - head.z);
      shift(0, g - rigNow().y, 0);
      exit('shore');
      api.setStatus?.('You find your footing.');
      return;
    }
    shift(target.x - head.x, target.y - head.y, target.z - head.z);
    const dmove = Math.hypot(target.x - head.x, target.z - head.z, target.y - head.y) / Math.max(dt, 1e-3);
    comfort = THREE.MathUtils.clamp((dmove - 0.35) / 1.4, 0, 0.55);
    head.copy(target);

    // ---- crossing the surface ----
    const nowUnder = surfaceAt(head.x, head.z) - head.y > 0.04;
    if (nowUnder !== wasUnder) {
      world.splash?.(head.x, head.z, false);
      if (nowUnder) bubble(tmp.copy(head).setY(head.y - 0.1), 10, { spread: 0.1, size: 0.014 });
      else if (lowBreath) { burst({ buf: 'white', type: 'bandpass', freq: 1400, q: 0.8, gain: 0.12, attack: 0.03, hold: 0.25, release: 0.5 }); lowBreath = false; }
    }
    wasUnder = nowUnder;
    underT = nowUnder ? underT + dt : 0;

    // ---- breath / air ----
    if (nowUnder) {
      if (tank) {
        air = Math.max(0, air - dt);
        if (air <= 30 && !warned30) { warned30 = true; api.setStatus?.('30 seconds of air left. Head up.'); burst({ type: 'bandpass', freq: 2400, q: 8, gain: 0.05, attack: 0.01, hold: 0.15, release: 0.1 }); }
        if (air <= 10 && !warned10) { warned10 = true; api.setStatus?.('10 seconds of air!'); }
        if (air <= 0) outT = outT < 0 ? 0 : outT + dt;
        // regulator: inhale, then exhale with a burst of bubbles
        if (air > 0) {
          regT += dt;
          if (regPhase === 0 && regT > 0.1) { regPhase = 1; burst({ type: 'bandpass', freq: 1700, q: 1.4, gain: 0.045, attack: 0.5, hold: 0.3, release: 0.3 }); }
          if (regPhase === 1 && regT > 1.7) {
            regPhase = 2;
            burst({ buf: 'brown', type: 'lowpass', freq: 700, gain: 0.08, attack: 0.15, hold: 0.7, release: 0.5 });
            blips(9, 420, 1.1, 0.05);
            fwd.set(0, -0.35, -1).applyQuaternion(quat).normalize();
            bubble(tmp.copy(head).addScaledVector(fwd, 0.14).setY(head.y - 0.12), 18, { spread: 0.05, size: 0.013 });
          }
          if (regT > 4.6) { regT = 0; regPhase = 0; }
        }
      } else {
        breath = Math.max(0, breath - dt);
        if (breath < 6) { lowBreath = true; if (Math.floor((breath + dt) * 1.4) !== Math.floor(breath * 1.4)) api.heartbeat?.(1 - breath / 6); }
        if (breath <= 0) outT = outT < 0 ? 0 : outT + dt;
        puffT -= dt;
        if (puffT <= 0) { puffT = 3 + Math.random() * 3; bubble(tmp.copy(head).setY(head.y - 0.1), 3, { spread: 0.03, size: 0.009 }); blips(2, 600, 0.2, 0.03); }
      }
      if (outT > (tank ? 5 : 4)) { drown(); updateHud(dt, false, 0); return; }
    } else {
      breath = Math.min(BREATH, breath + dt * 6);
      if (outT >= 0) { outT = -1; api.setStatus?.('Air!'); }
      regT = 0; regPhase = 0;
    }

    updateHud(dt, true, depth, { tank, mask, nowUnder });
    updateSound(dt, nowUnder);
    updateScare(dt);
  }

  // ---------------- HUD per frame ----------------
  function updateHud(dt, swimming, depth, s = {}) {
    const ease = Math.min(1, dt * 5);
    const maskOn = swimming && s.mask && depth > -0.15;
    veilU.uMask.value += ((maskOn ? 1 : 0) - veilU.uMask.value) * ease;
    let dark = 0;
    let red = 0;
    if (swimming && s.nowUnder) {
      if (!s.tank && breath < 8) { dark = (1 - breath / 8) * 0.55; red = breath < 4 ? 0.4 + 0.3 * Math.sin(performance.now() * 0.012) : 0; }
      if (s.tank && air < 10) red = 0.35 + 0.25 * Math.sin(performance.now() * 0.01);
      if (outT >= 0) dark = Math.max(dark, 0.55 + 0.45 * Math.min(1, outT / (s.tank ? 5 : 4)));
    }
    veilU.uDark.value += (dark - veilU.uDark.value) * ease;
    veilU.uRed.value += (red - veilU.uRed.value) * ease;
    veil.visible = veilU.uMask.value > 0.01 || veilU.uDark.value > 0.01 || veilU.uRed.value > 0.01;
    underwater?.setClarity(s.mask ? 1 : 0);
    const showBreath = swimming && !s.tank && (s.nowUnder || breath < BREATH - 0.5);
    const showAir = swimming && s.tank;
    if (showAir) drawGauge('AIR', air, AIR, air < 10 ? 2 : air < 30 ? 1 : 0);
    else if (showBreath) drawGauge('BREATH', breath, BREATH, breath < 5 ? 2 : breath < 10 ? 1 : 0);
    gauge.visible = showAir || showBreath;
    wrist.visible = !!scuba?.has('tank') && (showAir || !swimming);
    if (!swimming && scuba?.has('tank')) drawGauge('AIR', air, AIR, 0);
  }

  // ---------------- hooks for main.js ----------------
  function takeFall(x, z) {
    if (!renderer.xr.isPresenting) return false;
    world.splash?.(x, z, true);
    enter('fall', new THREE.Vector3(0, -2.2, 0));
    return true;
  }
  function onSqueeze(controller) {
    if (scuba) {
      const id = scuba.tryPickup(handPointsOf(controller));
      if (id) {
        api.pulse(controller, 0.6, 50);
        sfx?.play?.('cloth', { gain: 0.6 });
        const lines = {
          mask: 'Dive mask on. You will see clearly underwater.',
          tank: 'Air tank on. You can dive deep now; watch the air gauge on your left wrist.',
          fins: 'Fins on. Every stroke carries you further.',
        };
        api.setStatus?.(`${lines[id]}${scuba.all() ? ' Kit complete: jump in.' : ''}`);
        return true;
      }
    }
    if (!active) return false;
    const boat = world.canoe;
    if (boat?.floating?.()) {
      const p = handPointsOf(controller)[0];
      tmp.copy(p);
      boat.group.worldToLocal(tmp);
      if (Math.abs(tmp.x) < 0.8 && Math.abs(tmp.z) < 2.1 && tmp.y > -0.35 && tmp.y < 0.75) {
        api.boardCanoe();
        if (api.aboard()) { exit('boat'); api.setStatus?.('You haul yourself into the canoe.'); }
        return true;
      }
    }
    return true; // while swimming a squeeze is a stroke, not a grab (rungs are still caught by the per-frame rung check)
  }

  return {
    get active() { return active; },
    get comfort() { return comfort; },
    get under() { return active && wasUnder; },
    veil,
    gauge,
    takeFall,
    onSqueeze,
    update,
    scare: () => startScare(),
    debug: () => ({
      active, under: active && wasUnder, vel: vel.toArray().map((v) => +v.toFixed(2)), breath: +breath.toFixed(1), air: +air.toFixed(1),
      out: outT, lastExit, stats: { ...stats, exits: { ...stats.exits } }, kit: scuba ? { mask: scuba.has('mask'), tank: scuba.has('tank'), fins: scuba.has('fins') } : null,
      scare: scare.t >= 0 ? +scare.t.toFixed(2) : -1, mask: +veilU.uMask.value.toFixed(2), dark: +veilU.uDark.value.toFixed(2),
    }),
  };
}
