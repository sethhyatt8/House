// depart/arrive, a tick when passing a landing, a gate squeal, haptics, and a comfort vignette while moving.
// ?vignette=0 turns the vignette off (lift and stick locomotion), ?liftsound=0 the sounds.
import * as THREE from 'three';

const params = new URLSearchParams(location.search);

export function createLiftFeel({ lift, scene, camera, audio, pulse, controllers = [] }) {
  if (!lift?.on) return { update() {}, setComfort() {} };
  const soundOn = params.get('liftsound') !== '0';
  const vignetteOn = params.get('vignette') !== '0';

  // ---- comfort vignette: 0.29 m BackSide sphere on the camera (nests inside health.js's 0.3 m red veil) ----
  const uniforms = { uAmount: { value: 0 } };
  const veil = new THREE.Mesh(
    new THREE.SphereGeometry(0.29, 16, 12),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uAmount; varying vec3 vDir;'
        + ' void main() { float f = -normalize(vDir).z; float edge = 1.0 - smoothstep(0.55 - 0.25 * uAmount, 0.92, f);'
        + ' gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(edge * uAmount, 0.0, 0.85)); }',
      transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false,
    }),
  );
  veil.renderOrder = 998;
  veil.frustumCulled = false;
  veil.visible = false;
  veil.raycast = () => {};
  if (vignetteOn) {
    if (!camera.parent) scene.add(camera);
    camera.add(veil);
  }

  // ---- sound ----
  let hum = null;
  function ensureHum() {
    if (hum || !soundOn) return hum;
    const ctx = audio();
    const out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(out);
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 48;
    const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 96.5;
    const bg = ctx.createGain(); bg.gain.value = 0.25;
    a.connect(lp); b.connect(bg); bg.connect(lp);
    const len = ctx.sampleRate * 2; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (0.4 + 0.6 * Math.abs(Math.sin(i / 900)));
    const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = 0;
    n.connect(bp); bp.connect(ng); ng.connect(ctx.destination);
    a.start(); b.start(); n.start();
    hum = { ctx, out, a, b, ng };
    return hum;
  }
  function clunk(strength = 1, pitch = 1) {
    if (!soundOn) return;
    const ctx = audio(); const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(140 * pitch, t); o.frequency.exponentialRampToValueAtTime(45 * pitch, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32 * strength, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.32);
    const len = Math.floor(ctx.sampleRate * 0.09); const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2600 * pitch; hp.Q.value = 3;
    const sg = ctx.createGain(); sg.gain.value = 0.16 * strength;
    s.connect(hp); hp.connect(sg); sg.connect(ctx.destination); s.start(t);
  }
  function squeal(open) {
    if (!soundOn) return;
    const ctx = audio(); const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(open ? 620 : 760, t); o.frequency.linearRampToValueAtTime(open ? 760 : 560, t + 0.7);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(bp); bp.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.85);
  }

  let riding = false;
  const buzzAll = (i, ms) => controllers.forEach((c) => pulse(c, i, ms));
  lift.on('depart', () => { clunk(1, 1); if (riding) buzzAll(0.55, 70); });
  lift.on('arrive', () => { clunk(0.8, 0.85); if (riding) buzzAll(0.45, 60); });
  lift.on('pass', () => { clunk(0.25, 1.6); if (riding) buzzAll(0.15, 25); });
  lift.on('door', ({ open }) => squeal(open));

  let rumbleAt = 0;
  let comfort = 0; // rowing pass: stick locomotion / smooth turn ask for the same vignette (0..1)
  return {
    veil,
    setComfort(amount) { comfort = Math.max(0, Math.min(1, amount || 0)); },
    update(dt, isRiding, inXr) {
      riding = isRiding;
      const v = Math.abs(lift.speed || 0);
      const k = Math.min(1, v / 1.25);
      if (soundOn && (lift.moving || hum)) {
        const h = ensureHum();
        if (h) {
          const t = h.ctx.currentTime;
          h.out.gain.setTargetAtTime(lift.moving ? 0.05 + 0.1 * k : 0, t, 0.08);
          h.ng.gain.setTargetAtTime(lift.moving ? 0.03 * k : 0, t, 0.08);
          const down = (lift.speed || 0) < 0;
          h.a.frequency.setTargetAtTime((down ? 26 : 42) + (down ? 12 : 22) * k, t, 0.12);
          h.b.frequency.setTargetAtTime((down ? 52 : 84) + (down ? 24 : 45) * k, t, 0.12);
        }
      }
      if (riding && lift.moving && inXr) {
        rumbleAt -= dt;
        if (rumbleAt <= 0) { rumbleAt = 0.22; buzzAll(0.05 + 0.08 * k, 22); }
      }
      const want = vignetteOn ? Math.max(riding && lift.moving ? 0.35 + 0.45 * k : 0, inXr ? comfort : 0) : 0;
      uniforms.uAmount.value += (want - uniforms.uAmount.value) * Math.min(1, dt * 6);
      veil.visible = uniforms.uAmount.value > 0.01;
    },
  };
}
