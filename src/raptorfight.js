// src/raptorfight.js - glue between the overlook raptor (src/raptor.js) and the player: health, sound, haptics, safe
// shove. Like bearfight.js it stays out of main.js (main only creates it and calls update). Samples:
// public/audio/raptor_*.ogg (CC0, see public/audio/CREDITS.md); rustles, scrapes and thumps are WebAudio. Calls from
// the woods are muffled (low-pass) while it hides. ?sfx=0 and ?sfxvol= are honoured.

const SAMPLES = ['raptor_call', 'raptor_roar', 'raptor_hiss', 'raptor_snort', 'raptor_growl', 'raptor_yelp', 'raptor_death'];

export function wireRaptor({ raptor, health, sfx, audio, renderer, shiftPlayer, pulseBoth, pulseController, gear, golf, hockey = null, player, head, debug = false, tickHealth = false }) {
  const params = new URLSearchParams(location.search);
  const live = () => renderer.xr.isPresenting || debug || (params.get('raptordebug') ?? params.get('beardebug')) === '1';
  const sfxOn = params.get('sfx') !== '0';
  const vol = Number(params.get('sfxvol') ?? 1);
  const log = [];   // last sounds (headless checks)

  // --- audio -------------------------------------------------------------------
  const raw = {}; const bufs = {}; const decoding = {};
  let master = null;
  function fetchAll() {
    if (!sfxOn || raw.raptor_call) return;
    const base = new URL('audio/', document.baseURI).href;
    for (const n of SAMPLES) raw[n] = fetch(base + n + '.ogg').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    for (const n of SAMPLES) buffer(n);
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
  function out(c, at, gain, { ref = 2, muffle = 0 } = {}) {
    const g = c.createGain(); g.gain.value = gain;
    let tail = g;
    if (muffle > 0) {   // through the trees: lose the top end
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200 - 3600 * muffle; lp.Q.value = 0.5;
      g.connect(lp); tail = lp;
    }
    if (!at) { tail.connect(master); return g; }
    const pan = c.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = ref; pan.rolloffFactor = 1;
    pan.positionX.value = at.x; pan.positionY.value = at.y; pan.positionZ.value = at.z;
    tail.connect(pan); pan.connect(master);
    return g;
  }
  function sample(n, at, gain = 1, rate = 1, o = {}) {
    log.push({ n, t: +performance.now().toFixed(0), at: at ? [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)] : null });
    if (log.length > 60) log.shift();
    if (!sfxOn) return;
    const b = buffer(n);
    if (!b) return;
    const c = ctx();
    const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 0.06);
    src.connect(out(c, at, gain, o)); src.start();
  }
  let noiseBuf = null;
  function burst(at, { freq = 500, q = 1.2, gain = 0.4, attack = 0.02, len = 0.25, delay = 0, low = false } = {}) {
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
  function rustleSound(at, k = 1) {   // twigs and fronds: a few short, bright crackles
    log.push({ n: 'rustle', t: +performance.now().toFixed(0), at: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)] });
    for (let i = 0; i < 3; i += 1) burst(at, { freq: 2200 + Math.random() * 2400, q: 0.8, gain: 0.18 * k, attack: 0.01, len: 0.07 + Math.random() * 0.12, delay: i * (0.06 + Math.random() * 0.12) });
    burst(at, { freq: 700, q: 0.6, gain: 0.12 * k, attack: 0.04, len: 0.35 });
  }
  const play = (name, o) => sfx?.play?.(name, o);

  // --- events ------------------------------------------------------------------
  const shove = { x: 0, z: 0, left: 0 };
  raptor.on('ready', () => fetchAll());
  raptor.on('wake', () => { fetchAll(); pulseBoth(0.12, 40); });
  raptor.on('call', (e) => { sample('raptor_call', e.position, 1, 0.94 + Math.random() * 0.1, { ref: 3, muffle: 0.55 }); });
  raptor.on('rustle', (e) => rustleSound(e.position, e.strength));
  raptor.on('growl', (e) => sample('raptor_growl', e.position, e.hidden ? 0.5 : 0.45, 0.95 + Math.random() * 0.1, { muffle: e.hidden ? 0.5 : 0 }));
  raptor.on('roar', (e) => { sample('raptor_roar', e.position, e.intro ? 1 : 0.85, e.intro ? 0.95 : 1.06); pulseBoth(e.intro ? 0.6 : 0.4, e.intro ? 450 : 250); });
  raptor.on('telegraph', (e) => {
    const at = raptor.mouth();
    if (e.kind === 'leap') sample('raptor_hiss', at, 1, 1);
    else if (e.kind === 'tackle') { sample('raptor_snort', at, 0.8, 0.9); sample('raptor_growl', at, 0.5, 1.15); }
    else sample('raptor_snort', at, 0.55, 1.15);
    pulseBoth(0.2, 50);
  });
  raptor.on('snap', (e) => play('hit_wood2', { at: e.position, gain: 0.35, rate: 1.9 }));   // teeth clack
  raptor.on('scrape', (e) => { burst(e.position, { freq: 900, q: 0.7, gain: 0.35, attack: 0.01, len: 0.22 }); pulseBoth(0.15, 30); });
  raptor.on('leap', (e) => { play('arrow_whoosh', { at: e.position, gain: 0.7, rate: 0.45 }); });
  raptor.on('land', (e) => { burst(e.position, { low: true, gain: 0.8, attack: 0.004, len: 0.25 }); pulseBoth(0.35, 70); });
  raptor.on('charge', (e) => sample('raptor_growl', e.position, 0.6, 1.2));
  raptor.on('step', (e) => { burst(e.position, { low: true, gain: 0.35, attack: 0.004, len: 0.1 }); pulseBoth(0.12, 20); });
  raptor.on('miss', () => play('arrow_whoosh', { at: raptor.mouth(), gain: 0.45, rate: 0.6 }));
  raptor.on('knocked', (e) => { play('hit_soft', { at: e.position, gain: 0.9, rate: 0.5 }); sample('raptor_yelp', raptor.mouth(), 0.9, 0.85); burst(e.position, { low: true, gain: 0.9, attack: 0.004, len: 0.35, delay: 0.35 }); });
  raptor.on('stagger', () => sample('raptor_yelp', raptor.mouth(), 0.7, 1.05));
  raptor.on('strike', (e) => {
    if (!health || !live()) return;
    const dealt = health.damage(e.damage);
    if (dealt <= 0) return;
    play('hit_punch', { gain: 0.95, rate: 0.8 });
    burst(null, { low: true, gain: 0.6, attack: 0.004, len: 0.2 });
    pulseBoth(1, e.kind === 'leap' || e.kind === 'tackle' ? 280 : 180);
    if (e.shove.x || e.shove.z) { shove.x = e.shove.x; shove.z = e.shove.z; shove.left = 1; }   // raptor.js already proved it safe
  });
  raptor.on('hurt', (e) => {
    play(e.crit ? 'hit_punch' : 'hit_soft', { at: e.point, gain: e.crit ? 0.8 : 0.6, rate: e.crit ? 0.9 : 0.8 });
    const hand = e.source === 'hatchet' ? gear?.handHolding?.('hatchet') : e.source === 'club' ? golf?.club?.parent : e.source === 'stick' ? hockey?.stick?.parent : e.source === 'arrow' ? gear?.handHolding?.('bow') : null;
    if (hand) pulseController(hand, e.source === 'arrow' ? 0.4 : 0.9, e.source === 'arrow' ? 40 : 90);
  });
  raptor.on('death', (e) => { sample('raptor_death', e.position, 0.95, 1); pulseBoth(0.5, 300); });
  raptor.on('reward', () => play('ui_confirm', { gain: 0.6 }));

  // --- per frame -----------------------------------------------------------------
  const pose = { x: 0, z: 0, headY: 0, feetY: 0 };
  const SHOVE_T = 0.15;
  function update(dt) {
    const p = player();
    if (p) { pose.x = p.x; pose.z = p.z; pose.feetY = p.feetY; pose.headY = head.y; }
    raptor.update(dt, p ? pose : null);
    if (shove.left > 0) {   // ease the shove in over 0.15 s (comfort); every point on the path was checked by raptor.js
      const k = Math.min(shove.left, dt / SHOVE_T);
      shiftPlayer(shove.x * k, 0, shove.z * k);
      shove.left -= k;
    }
    if (tickHealth) health?.update(dt);
  }
  return { update, raptor, bear: raptor, sounds: () => log.slice() };
}
