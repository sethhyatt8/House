// src/music.js - ominous ambient score, fully procedural WebAudio (no audio files, nothing to license).
// - Woods bed: near the overlook woods (within ~26 m of the bear's den, up on the summit) a low detuned drone fades in.
// - Bear: on wake the bed rises; while engaged (fighting) a dissonant cluster swells, a slow heartbeat and the odd deep
//   drum hit join; on death / leave the score fades out (~10 s to near silence) and does not return once it is dead.
// - Cave: a quieter tense bed (filtered air + a thin glassy tone) inside the cave tunnel / room.
// ?music=0 turns it off; ?musicvol=0.5 scales it (default 1). Exposes .state() for the headless check.
import * as THREE from 'three';

const LEVEL = { woods: 0.32, wake: 0.62, fight: 1, cave: 0.22 };

export function createMusic({ audio, renderer, camera, bear = null, cave = null }) {
  const params = new URLSearchParams(location.search);
  if (params.get('music') === '0') return null;
  const vol = THREE.MathUtils.clamp(Number(params.get('musicvol') ?? 1) || 0, 0, 2);
  const head = new THREE.Vector3();
  let nodes = null;
  // Phase is driven by bear events (wake / death / leave) rather than polling state names: the AI can bounce through
  // stalk / open / swipe / return within a single frame and a poll-based score would flicker off.
  const st = {
    woods: 0, fight: 0, cave: 0,
    target: { woods: 0, fight: 0, cave: 0 },
    mode: 'off', phase: 'idle', // idle | woods | wake | fight | after
    drumT: 3, beatT: 0, after: 0, wakeAge: 0,
  };

  if (bear) {
    bear.on('wake', () => { st.phase = 'wake'; st.forced = false; st.wakeAge = 0; st.after = 0; });
    bear.on('death', () => { st.phase = 'after'; st.after = 8; });
    bear.on('leave', () => { if (st.phase !== 'after') { st.phase = 'after'; st.after = 6; } });
    bear.on('reward', () => { st.phase = 'after'; st.after = 8; });
  }

  function build() {
    const ctx = audio();
    const out = ctx.createGain();
    out.gain.value = 0.55 * vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 4;
    out.connect(comp); comp.connect(ctx.destination);
    const verbIn = ctx.createGain(); verbIn.gain.value = 0.35;
    [0.37, 0.53].forEach((t, i) => {
      const d = ctx.createDelay(1); d.delayTime.value = t;
      const fb = ctx.createGain(); fb.gain.value = 0.42;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400 - i * 300;
      verbIn.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(out);
    });
    const bus = (g = 0) => { const n = ctx.createGain(); n.gain.value = g; n.connect(out); n.connect(verbIn); return n; };
    const osc = (type, f, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.start(); return o; };
    const lfo = (rate, depth, param) => { const o = osc('sine', rate); const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(param); return o; };

    const woods = bus();
    const wLp = ctx.createBiquadFilter(); wLp.type = 'lowpass'; wLp.frequency.value = 260; wLp.Q.value = 2.5;
    lfo(0.05, 120, wLp.frequency);
    [[36.71, -7], [36.71, 8], [73.42, 3], [77.78, -4]].forEach(([f, dt], i) => {
      const o = osc(i < 2 ? 'sawtooth' : 'triangle', f, dt);
      const g = ctx.createGain(); g.gain.value = i < 2 ? 0.22 : 0.09;
      lfo(0.07 + i * 0.023, 0.05, g.gain);
      o.connect(g); g.connect(wLp);
    });
    wLp.connect(woods);

    const fight = bus();
    const fLp = ctx.createBiquadFilter(); fLp.type = 'lowpass'; fLp.frequency.value = 700; fLp.Q.value = 1.2;
    lfo(0.11, 260, fLp.frequency);
    [[73.42, 0], [103.83, -6], [110, 5], [146.83, 9]].forEach(([f, dt], i) => {
      const o = osc('sawtooth', f, dt);
      const g = ctx.createGain(); g.gain.value = 0.1 - i * 0.015;
      lfo(0.17 + i * 0.05, 0.04, g.gain);
      o.connect(g); g.connect(fLp);
    });
    fLp.connect(fight);
    const hits = bus(1);

    const caveBus = bus();
    const len = ctx.sampleRate * 4;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    let c = 0;
    for (let i = 0; i < len; i += 1) { c = c * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = c * 6; }
    const air = ctx.createBufferSource(); air.buffer = nb; air.loop = true; air.start();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 340; bp.Q.value = 0.9;
    lfo(0.04, 120, bp.frequency);
    const airG = ctx.createGain(); airG.gain.value = 0.5;
    air.connect(bp); bp.connect(airG); airG.connect(caveBus);
    const glass = osc('sine', 1174.7, 0); lfo(0.3, 6, glass.frequency);
    const glassG = ctx.createGain(); glassG.gain.value = 0.025; lfo(0.09, 0.02, glassG.gain);
    glass.connect(glassG); glassG.connect(caveBus);
    const caveLow = osc('triangle', 55, -5); const clG = ctx.createGain(); clG.gain.value = 0.12; caveLow.connect(clG); clG.connect(caveBus);

    nodes = { ctx, out, woods, fight, hits, caveBus };
  }

  function drum(gain, f0 = 70, len = 0.9) {
    const { ctx, hits } = nodes;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(hits); o.start(t); o.stop(t + len + 0.05);
  }

  function zone(dt) {
    (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(head);
    const t = { woods: 0, fight: 0, cave: 0 };
    let mode = 'off';
    if (bear) {
      const den = bear.den();
      const deckY = bear.root.position.y;
      const near = Math.hypot(head.x - den.x, head.z - den.z) < 26 && head.y > deckY - 6;
      // Phase machine: wake for ~2.5 s, then fight while the bear stays engaged; proximity alone drives the woods bed.
      if (st.phase === 'wake') {
        st.wakeAge += dt;
        // force() holds the phase; only the real wake event (wakeAge still advancing from the listener) promotes to fight
        if (st.forced) { /* held */ }
        else if (st.wakeAge > 2.5 && bear.engaged()) st.phase = 'fight';
        else if (st.wakeAge > 2.5 && !bear.engaged()) st.phase = near ? 'woods' : 'idle';
      } else if (st.phase === 'fight') {
        if (!st.forced && !bear.engaged()) { st.phase = 'after'; st.after = 6; }
      } else if (st.phase === 'after' && st.after <= 0) {
        st.phase = near && bear.alive() ? 'woods' : 'idle';
      } else if (st.phase === 'idle' && near && bear.alive()) {
        st.phase = 'woods';
      } else if (st.phase === 'woods' && !near) {
        st.phase = 'idle';
      }
      if (st.phase === 'woods') { t.woods = LEVEL.woods; mode = 'woods'; }
      else if (st.phase === 'wake') { t.woods = LEVEL.wake; mode = 'wake'; }
      else if (st.phase === 'fight') { t.woods = LEVEL.wake; t.fight = LEVEL.fight; mode = 'fight'; }
      else if (st.phase === 'after') { mode = 'after'; }
    }
    if (cave?.room || cave?.tunnel) {
      const fy = cave.floor ?? -Infinity;
      const inBox = (b) => b && head.x >= b.x0 && head.x <= b.x1 && head.z >= b.z0 && head.z <= b.z1 && head.y > fy - 0.5 && head.y < fy + 3;
      if (inBox(cave.room) || inBox(cave.tunnel)) { t.cave = LEVEL.cave; if (mode === 'off' || mode === 'after') mode = 'cave'; }
    }
    st.target = t; st.mode = mode;
  }

  function update(dt) {
    st.after = Math.max(0, st.after - dt);
    zone(dt);
    const any = st.target.woods + st.target.fight + st.target.cave + st.woods + st.fight + st.cave > 0.002;
    if (!any) return;
    if (!nodes) build();
    if (nodes.ctx.state === 'suspended') nodes.ctx.resume();
    const ease = (cur, to, up, down) => cur + (to - cur) * (1 - Math.exp(-dt / (to > cur ? up : down)));
    st.woods = ease(st.woods, st.target.woods, 4, 5);
    st.fight = ease(st.fight, st.target.fight, 2.5, 4);
    st.cave = ease(st.cave, st.target.cave, 3, 4);
    const now = nodes.ctx.currentTime;
    nodes.woods.gain.setTargetAtTime(st.woods, now, 0.05);
    nodes.fight.gain.setTargetAtTime(st.fight * 0.9, now, 0.05);
    nodes.caveBus.gain.setTargetAtTime(st.cave, now, 0.05);
    if (st.fight > 0.25) {
      st.beatT -= dt;
      if (st.beatT <= 0) {
        st.beatT = 1.15;
        drum(0.22 * st.fight, 52, 0.35);
        // schedule the second heartbeat beat with AudioContext time (virtual clock safe: AudioClock still advances)
        const t = nodes.ctx.currentTime + 0.26;
        const o = nodes.ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(50, t); o.frequency.exponentialRampToValueAtTime(22, t + 0.3);
        const g = nodes.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15 * st.fight, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g); g.connect(nodes.hits); o.start(t); o.stop(t + 0.35);
      }
      st.drumT -= dt;
      if (st.drumT <= 0) { st.drumT = 5 + Math.random() * 6; drum(0.5 * st.fight, 78, 1.6); }
    }
  }

  return {
    update,
    // headless / ?musicdebug: force a phase without needing the bear AI to cooperate
    force(phase) { st.phase = phase; st.forced = phase === 'wake' || phase === 'fight'; st.wakeAge = 0; st.after = phase === 'after' ? 8 : 0; },
    state: () => ({ mode: st.mode, phase: st.phase, woods: +st.woods.toFixed(3), fight: +st.fight.toFixed(3), cave: +st.cave.toFixed(3), built: !!nodes }),
  };
}
