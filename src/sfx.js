// Sample-based sound (feedback pass). Every sample is optional: play() returns false until its file is decoded (or if
// ?sfx=0), and callers keep their procedural WebAudio sound as the fallback. Files: public/audio/*.ogg (mono Vorbis,
// credits in public/audio/CREDITS.md). Ambience loops are crossfaded by zone; one-shots can be positional (HRTF).
import * as THREE from 'three';

export const SFX_FILES = [
  'amb_ocean', 'amb_night', 'amb_wind', 'amb_cave', 'amb_fire',
  'drip1', 'drip2', 'gull1', 'gull2', 'bow_release', 'bow_draw', 'arrow_whoosh',
  'splash_small1', 'splash_small2', 'splash_big', 'paddle1', 'paddle2', 'paddle3',
  'hit_wood', 'hit_wood2', 'hit_plank', 'hit_soft', 'hit_metal', 'hit_punch',
  'chop', 'latch', 'door_open', 'door_close', 'cloth', 'coins', 'creak', 'ui_click', 'ui_confirm',
];

// zone -> ambience bed levels (0..1). Unknown zones fall back to 'outdoor' above ground and 'cave' below.
const BEDS = {
  outdoor: { ocean: 0.75, night: 0.8, wind: 0.55, cave: 0 },
  sea: { ocean: 1, night: 0.55, wind: 0.45, cave: 0 },
  cave: { ocean: 0.35, night: 0, wind: 0.08, cave: 1 },
  tunnel: { ocean: 0.12, night: 0, wind: 0, cave: 0.8 },
  gallery: { ocean: 0.06, night: 0, wind: 0, cave: 0.6 },
  indoor: { ocean: 0.25, night: 0.3, wind: 0.18, cave: 0 },
};
const BED_GAIN = { ocean: 0.5, night: 0.32, wind: 0.3, cave: 0.45, fire: 0.6 };

export function createSfx(getCtx, opts = {}) {
  const params = new URLSearchParams(location.search);
  const enabled = params.get('sfx') !== '0';
  const base = opts.base || new URL('audio/', document.baseURI).href;
  const raw = new Map();      // name -> Promise<ArrayBuffer>
  const buffers = new Map();  // name -> AudioBuffer
  const decoding = new Map();
  let master = null;
  let bus = null;
  const beds = {};
  let dripWait = 3;
  let gullWait = 12;
  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();

  function fetchAll() {
    if (!enabled) return;
    for (const name of SFX_FILES) {
      if (raw.has(name)) continue;
      raw.set(name, fetch(base + name + '.ogg').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
    }
  }

  function ctxReady() {
    const ctx = getCtx();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = Number(params.get('sfxvol') ?? 1);
      master.connect(ctx.destination);
      bus = ctx.createGain();
      bus.connect(master);
    }
    return ctx;
  }

  function buffer(name) {
    if (!enabled) return null;
    const hit = buffers.get(name);
    if (hit) return hit;
    if (!decoding.has(name) && raw.has(name)) {
      const ctx = ctxReady();
      decoding.set(name, raw.get(name).then((data) => (data ? ctx.decodeAudioData(data) : null))
        .then((buf) => { if (buf) buffers.set(name, buf); return buf; })
        .catch(() => null));
    }
    return null;
  }

  function warm(names = SFX_FILES) { names.forEach((name) => buffer(name)); }

  // play('hit_wood') or play(['paddle1', 'paddle2']) (random pick). opts: gain, rate, jitter, at (Vector3), ref (m)
  function play(names, o = {}) {
    const list = Array.isArray(names) ? names : [names];
    const name = list[Math.floor(Math.random() * list.length)];
    const buf = buffer(name);
    if (!buf) { list.forEach((n) => buffer(n)); return false; }
    const ctx = ctxReady();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const jitter = o.jitter ?? 0.06;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    const gain = ctx.createGain();
    gain.gain.value = o.gain ?? 1;
    src.connect(gain);
    if (o.at) {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = o.ref ?? 1.2;
      pan.rolloffFactor = 1;
      pan.positionX.value = o.at.x; pan.positionY.value = o.at.y; pan.positionZ.value = o.at.z;
      gain.connect(pan);
      pan.connect(bus);
    } else gain.connect(bus);
    src.start();
    return true;
  }

  function bed(name) {
    if (beds[name]) return beds[name];
    const buf = buffer('amb_' + name);
    if (!buf) return null;
    const ctx = ctxReady();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    let out = gain;
    if (name === 'fire') {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.0; pan.rolloffFactor = 1.3;
      gain.connect(pan); out = pan;
      beds.firePan = pan;
    }
    out.connect(bus);
    src.start(0, Math.random() * buf.duration);
    beds[name] = { src, gain, level: 0 };
    return beds[name];
  }

  function setBed(name, level, dt) {
    if (level <= 0.001 && !beds[name]) return;
    const b = bed(name);
    if (!b) return;
    b.level += (level - b.level) * (1 - Math.exp(-dt / 0.9));
    b.gain.gain.value = b.level * BED_GAIN[name];
  }

  // Per frame: listener pose, zone beds, campfire, random drips / gulls.
  // state: { camera, zone, firePoint (Vector3|null), seaPoint (Vector3|null) }
  function update(dt, state) {
    if (!enabled || !audioStarted()) return;
    const ctx = ctxReady();
    const cam = state.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(tmp);
    fwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
    up.set(0, 1, 0).transformDirection(cam.matrixWorld);
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = tmp.x; L.positionY.value = tmp.y; L.positionZ.value = tmp.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(tmp.x, tmp.y, tmp.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    let zone = state.zone || '';
    if (zone.startsWith('lift') || zone === 'liftshaft' || zone === 'cell' || zone === 'room') zone = 'indoor';
    const levels = BEDS[zone] || (tmp.y < -3 ? BEDS.cave : BEDS.outdoor);
    for (const name of ['ocean', 'night', 'wind', 'cave']) setBed(name, levels[name], dt);
    const fire = state.firePoint;
    if (fire) {
      setBed('fire', 1, dt);
      if (beds.firePan) { beds.firePan.positionX.value = fire.x; beds.firePan.positionY.value = fire.y; beds.firePan.positionZ.value = fire.z; }
    } else setBed('fire', 0, dt);
    if (levels.cave > 0.3) {
      dripWait -= dt;
      if (dripWait <= 0) {
        dripWait = 1.5 + Math.random() * 5;
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 4;
        play(['drip1', 'drip2'], { at: { x: tmp.x + Math.cos(a) * r, y: tmp.y + 0.6 + Math.random(), z: tmp.z + Math.sin(a) * r }, gain: 0.35 + Math.random() * 0.4, jitter: 0.15 });
      }
    }
    if (levels.ocean > 0.5 && state.seaPoint) {
      gullWait -= dt;
      if (gullWait <= 0) {
        gullWait = 18 + Math.random() * 30;
        const p = state.seaPoint;
        play(['gull1', 'gull2'], { at: { x: p.x + (Math.random() - 0.5) * 30, y: p.y + 8, z: p.z + (Math.random() - 0.5) * 30 }, gain: 0.5, ref: 6, jitter: 0.1 });
      }
    }
  }

  function audioStarted() { return !!master || started; }
  let started = false;
  function start() { started = true; ctxReady(); warm(); }

  return { enabled, fetchAll, warm, play, update, start, buffers };
}
