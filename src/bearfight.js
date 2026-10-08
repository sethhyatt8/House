// src/bearfight.js - glue between the overlook bear (src/bear.js) and the player: health, sound, haptics, safe shove.
// Kept out of main.js on purpose (main only creates it and calls update). Samples: public/audio/bear_*.ogg (CC0, U.S.
// Fish & Wildlife Service recordings via OpenGameArt), loaded here so src/sfx.js stays untouched; huffs, snorts and
// thumps are WebAudio. ?sfx=0 and ?sfxvol= are honoured.
import * as THREE from 'three';

const SAMPLES = ['bear_roar', 'bear_growl', 'bear_death'];

export function wireBear({ bear, health, sfx, audio, renderer, shiftPlayer, pulseBoth, pulseController, gear, golf, player, head, debug = false, tickHealth = false }) {
  const params = new URLSearchParams(location.search);
  const live = () => renderer.xr.isPresenting || debug || params.get('beardebug') === '1';
  const sfxOn = params.get('sfx') !== '0';
  const vol = Number(params.get('sfxvol') ?? 1);

  // --- audio -------------------------------------------------------------------
  const raw = {}; const bufs = {}; const decoding = {};
  let master = null;
  function fetchAll() {
    if (!sfxOn || raw.bear_roar) return;
    const base = new URL('audio/', document.baseURI).href;
    for (const n of SAMPLES) raw[n] = fetch(base + n + '.ogg').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  }
  function ctx() {
    const c = audio();
    if (!master) { master = c.createGain(); master.gain.value = vol; master.connect(c.destination); }
    return c;
  }
  function buffer(n) {
    if (bufs[n] || !raw[n]) return bufs[n] || null;
    if (!decoding[n]) decoding[n] = raw[n].then((d) => (d ? ctx().decodeAudioData(d) : null)).then((b) => { if (b) bufs[n] = b; }).catch(() => {});
    return null;
  }
  function out(c, at, gain, ref = 2) {
    const g = c.createGain(); g.gain.value = gain;
    if (!at) { g.connect(master); return g; }
    const pan = c.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = ref; pan.rolloffFactor = 1;
    pan.positionX.value = at.x; pan.positionY.value = at.y; pan.positionZ.value = at.z;
    g.connect(pan); pan.connect(master);
    return g;
  }
  function sample(n, at, gain = 1, rate = 1) {
    if (!sfxOn) return;
    const b = buffer(n);
    if (!b) return;
    const c = ctx();
    const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 0.06);
    src.connect(out(c, at, gain)); src.start();
  }
  let noiseBuf = null;
  function burst(at, { freq = 500, q = 1.2, gain = 0.4, attack = 0.02, len = 0.25, delay = 0, low = false } = {}) {   // huff / snort / thump
    if (!sfxOn) return;
    const c = ctx(); const t = c.currentTime + delay;
    if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1; }
    const env = c.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(gain, t + attack); env.gain.exponentialRampToValueAtTime(0.0001, t + attack + len);
    env.connect(out(c, at, 1));
    if (low) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + len);
      o.connect(env); o.start(t); o.stop(t + attack + len + 0.05);
    } else {
      const src = c.createBufferSource(); src.buffer = noiseBuf;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      src.connect(bp); bp.connect(env); src.start(t, Math.random() * 0.5); src.stop(t + attack + len + 0.05);
    }
  }
  const play = (name, o) => sfx?.play?.(name, o);

  // --- events ------------------------------------------------------------------
  const shove = { x: 0, z: 0, left: 0 };
  bear.on('ready', () => fetchAll());
  bear.on('wake', (e) => { fetchAll(); sample('bear_growl', e.position.clone().setY(e.position.y + 0.6), 0.8, 0.85); pulseBoth(0.2, 80); });
  bear.on('roar', (e) => { sample('bear_roar', e.position, e.intro ? 1 : 0.9, e.intro ? 0.92 : 1); pulseBoth(0.55, 420); });
  bear.on('growl', (e) => sample('bear_growl', e.position, 0.45, 0.95 + Math.random() * 0.1));
  bear.on('telegraph', (e) => {
    const at = bear.mouth();
    if (e.kind === 'swipe') burst(at, { freq: 420, gain: 0.5, attack: 0.03, len: 0.32 });                 // huff
    else if (e.kind === 'lunge') { burst(at, { freq: 1100, q: 2, gain: 0.35, len: 0.12 }); burst(at, { freq: 1000, q: 2, gain: 0.4, len: 0.14, delay: 0.32 }); } // two snorts
    else if (e.kind === 'charge') sample('bear_growl', at, 0.7, 1.15);
    pulseBoth(0.2, 50);
  });
  bear.on('paw', (e) => { burst(e.position, { low: true, gain: 0.7, attack: 0.005, len: 0.18 }); play('hit_soft', { at: e.position, gain: 0.5, rate: 0.5 }); pulseBoth(0.25, 40); });
  bear.on('charge', (e) => sample('bear_roar', e.position, 0.55, 1.2));
  bear.on('step', (e) => { burst(e.position, { low: true, gain: 0.45, attack: 0.004, len: 0.12 }); pulseBoth(0.18, 25); });
  bear.on('slam', (e) => { burst(e.position, { low: true, gain: 1, attack: 0.004, len: 0.35 }); play('hit_wood', { at: e.position, gain: 0.8, rate: 0.45 }); pulseBoth(0.8, 160); });
  bear.on('miss', (e) => { if (e.kind !== 'charge') play('arrow_whoosh', { at: bear.mouth(), gain: 0.45, rate: 0.55 }); });
  bear.on('stun', (e) => { play('hit_soft', { at: e.position, gain: 0.9, rate: 0.55 }); sample('bear_growl', e.position, 0.4, 0.7); });
  bear.on('block', () => { play('hit_wood', { gain: 0.8, rate: 0.8 }); pulseController(gear?.handHolding?.('hatchet'), 1, 120); });
  bear.on('strike', (e) => {
    if (!health || !live()) return;
    const dealt = health.damage(e.damage);
    if (dealt <= 0) return;
    play('hit_punch', { gain: 0.95, rate: 0.8 });
    burst(null, { low: true, gain: 0.6, attack: 0.004, len: 0.2 });
    pulseBoth(1, 220);
    if (e.shove.x || e.shove.z) { shove.x = e.shove.x; shove.z = e.shove.z; shove.left = 1; }   // bear.js already proved it safe
  });
  bear.on('hurt', (e) => {
    play(e.crit ? 'hit_punch' : 'hit_soft', { at: e.point, gain: e.crit ? 0.8 : 0.6, rate: e.crit ? 0.9 : 0.8 });
    if (e.crit && !e.killed) burst(e.point, { freq: 700, q: 1.5, gain: 0.35, len: 0.2 });
    const hand = e.source === 'hatchet' ? gear?.handHolding?.('hatchet') : e.source === 'club' ? golf?.club?.parent : e.source === 'arrow' ? gear?.handHolding?.('bow') : null;
    if (hand) pulseController(hand, e.source === 'arrow' ? 0.4 : 0.9, e.source === 'arrow' ? 40 : 90);
  });
  bear.on('death', (e) => { sample('bear_death', e.position, 0.9, 1); pulseBoth(0.5, 300); });
  bear.on('reward', () => play('ui_confirm', { gain: 0.6 }));

  // --- per frame -----------------------------------------------------------------
  const pose = { x: 0, z: 0, headY: 0, feetY: 0 };
  const SHOVE_T = 0.15;
  function update(dt) {
    const p = player();
    if (p) { pose.x = p.x; pose.z = p.z; pose.feetY = p.feetY; pose.headY = head.y; }
    bear.update(dt, p ? pose : null);
    if (shove.left > 0) {   // ease the shove in over 0.15 s (comfort); every point on the path was checked by bear.js
      const k = Math.min(shove.left, dt / SHOVE_T);
      shiftPlayer(shove.x * k, 0, shove.z * k);
      shove.left -= k;
    }
    if (tickHealth) health?.update(dt);
  }
  return { update, bear };
}
