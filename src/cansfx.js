// Can sounds (cans pass): real recorded aluminium/tin can samples (public/audio/can_*.ogg, CC0, see CREDITS.md)
// played as positional WebAudio voices. Per impact: a random variant of the right set (can-on-can clank, floor
// bounce, wall knock), pitch and gain from impact speed, a cascade clatter layer when many cans hit in one frame,
// up to 3 positional rolling loops following the fastest rolling cans (gain/rate by roll speed), a 12-voice cap
// (quietest voice is stolen) and the physics' 70 ms per-can cooldown. ?cansfx=0 mutes, ?canvol= scales.
import * as THREE from 'three';

export const CAN_SFX = [
  'can_clank_0', 'can_clank_1', 'can_clank_2', 'can_clank_3', 'can_clank_4', 'can_clank_5', 'can_clank_6',
  'can_floor_0', 'can_floor_1', 'can_floor_2', 'can_floor_3', 'can_floor_4', 'can_floor_5',
  'can_clatter_0', 'can_clatter_1', 'can_clatter_2', 'can_clatter_3', 'can_roll_loop',
];
const SETS = {
  can: ['can_clank_0', 'can_clank_1', 'can_clank_2', 'can_clank_3', 'can_clank_4', 'can_clank_5', 'can_clank_6'],
  floor: ['can_floor_0', 'can_floor_1', 'can_floor_2', 'can_floor_3', 'can_floor_4', 'can_floor_5'],
  wall: ['can_floor_1', 'can_floor_2', 'can_floor_3', 'can_clank_2'],
  hit: ['can_clank_0', 'can_clank_3', 'can_clank_5', 'can_floor_0'],
  clatter: ['can_clatter_0', 'can_clatter_1', 'can_clatter_2', 'can_clatter_3'],
};
export const MAX_VOICES = 12;

export function createCanSfx(sfx, getCtx, { mass = 0.015 } = {}) {
  const params = new URLSearchParams(location.search);
  const on = params.get('cansfx') !== '0' && sfx?.enabled !== false;
  const vol = Number(params.get('canvol') ?? 1);
  const heavy = mass > 0.1; // full cans: duller, lower
  const voices = []; // {src, gain, level, end}
  const rolls = [];
  let clatterAt = -1;
  const stats = { played: 0, dropped: 0, stolen: 0, peak: 0, clatter: 0, rolling: 0, rollPeak: 0, byType: { can: 0, floor: 0, wall: 0, hit: 0, clatter: 0 } };
  const log = [];
  let out = null;

  function ctxOut() {
    const ctx = getCtx();
    if (!out) {
      out = ctx.createGain();
      out.gain.value = vol;
      const dest = sfx?.output?.() || ctx.destination;
      out.connect(dest);
    }
    return ctx;
  }
  function prune(now) { for (let k = voices.length - 1; k >= 0; k -= 1) if (voices[k].end <= now) voices.splice(k, 1); }

  function voice(name, at, level, rate, ref = 1.1) {
    if (!on) return false;
    const buf = sfx.buffer?.(name);
    if (!buf) return false;
    const ctx = ctxOut();
    const now = ctx.currentTime;
    prune(now);
    if (voices.length >= MAX_VOICES) {
      let q = 0; for (let k = 1; k < voices.length; k += 1) if (voices[k].level < voices[q].level) q = k;
      if (voices[q].level >= level) { stats.dropped += 1; return false; }
      const v = voices[q];
      try { v.gain.gain.setTargetAtTime(0, now, 0.01); v.src.stop(now + 0.05); } catch { /* already stopped */ }
      voices.splice(q, 1); stats.stolen += 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = level;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = ref; pan.rolloffFactor = 1;
    pan.positionX.value = at.x; pan.positionY.value = at.y; pan.positionZ.value = at.z;
    src.connect(gain); gain.connect(pan); pan.connect(out);
    src.start();
    const v = { src, gain, level, end: now + buf.duration / rate };
    src.onended = () => { const k = voices.indexOf(v); if (k >= 0) voices.splice(k, 1); };
    voices.push(v);
    stats.peak = Math.max(stats.peak, voices.length);
    stats.played += 1;
    return true;
  }

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  // one physics impact: { type: 'can'|'floor'|'wall'|'hit', x, y, z, speed }
  function impact(e) {
    const s = Math.min(1, Math.max(0, (e.speed - 0.3) / 3.2));
    const level = (0.18 + 1.25 * Math.pow(s, 0.7)) * (heavy ? 1.15 : 1);
    const rate = (heavy ? 0.72 : 1) * (0.88 + 0.28 * s) * (1 + (Math.random() * 2 - 1) * 0.09);
    const ok = voice(pick(SETS[e.type] || SETS.can), e, level, rate);
    if (ok) stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
    log.push({ type: e.type, speed: +e.speed.toFixed(2), level: +level.toFixed(2), rate: +rate.toFixed(2), ok });
    if (log.length > 400) log.shift();
    return ok;
  }

  function ensureRolls() {
    if (rolls.length || !on) return rolls.length > 0;
    const buf = sfx.buffer?.('can_roll_loop');
    if (!buf) return false;
    const ctx = ctxOut();
    for (let k = 0; k < 3; k += 1) {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 0.9; pan.rolloffFactor = 1;
      src.connect(gain); gain.connect(pan); pan.connect(out);
      src.start(0, Math.random() * buf.duration);
      rolls.push({ src, gain, pan, level: 0 });
    }
    return true;
  }

  // per frame: impacts from cans.update(), rollers from cans.rollers()
  function update(dt, events, rollers) {
    if (!on) return;
    const ctx = getCtx();
    const now = ctx.currentTime;
    // big cascades: many impacts this frame -> one clatter layer at their centroid (250 ms apart)
    if (events.length >= 5 && now - clatterAt > 0.25) {
      let x = 0; let y = 0; let z = 0; let sp = 0;
      for (const e of events) { x += e.x; y += e.y; z += e.z; sp = Math.max(sp, e.speed); }
      const k = 1 / events.length;
      if (voice(pick(SETS.clatter), { x: x * k, y: y * k, z: z * k }, Math.min(1.5, 0.5 + events.length * 0.07) * (heavy ? 1.1 : 1), (heavy ? 0.8 : 1) * (0.92 + Math.random() * 0.16), 1.6)) { clatterAt = now; stats.clatter += 1; stats.byType.clatter += 1; }
    }
    // loudest impacts first so the voice cap keeps the big ones
    const sorted = events.length > 1 ? events.slice().sort((a, b) => b.speed - a.speed) : events;
    for (const e of sorted) impact(e);
    if (!ensureRolls()) return;
    let active = 0;
    for (let k = 0; k < rolls.length; k += 1) {
      const r = rolls[k]; const c = rollers[k];
      const target = c ? Math.min(0.9, Math.max(0, (c.speed - 0.04) * 1.1)) * (heavy ? 1.2 : 1) : 0;
      r.level += (target - r.level) * (1 - Math.exp(-dt / 0.06));
      r.gain.gain.value = r.level;
      if (c) {
        r.pan.positionX.value = c.x; r.pan.positionY.value = c.y; r.pan.positionZ.value = c.z;
        r.src.playbackRate.value = (heavy ? 0.75 : 1) * Math.min(1.6, 0.7 + c.speed * 0.55);
      }
      if (r.level > 0.02) active += 1;
    }
    stats.rolling = active;
    stats.rollPeak = Math.max(stats.rollPeak, active);
  }

  return { update, impact, stats, log, voices: () => { if (out) prune(getCtx().currentTime); return voices.length; }, enabled: on };
}
