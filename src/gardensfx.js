// Garden pass: the garden's sounds (public/audio/garden_*.ogg, CC0, see CREDITS.md): the shishi-odoshi's clack
// (positional one-shot each time the tube knocks the stone), and two positional loops, the waterfall and the
// kakei's trickle, that only run while you are within ~42 m of the garden. ?gardensfx=0 mutes them.
import { GARDEN } from './cape.js';

export const GARDEN_SFX = GARDEN ? ['garden_clack_0', 'garden_clack_1', 'garden_falls', 'garden_trickle'] : [];

export function createGardenSfx(sfx, getCtx, garden) {
  const params = new URLSearchParams(location.search);
  const on = !!garden && params.get('gardensfx') !== '0' && sfx?.enabled !== false;
  const stats = { clacks: 0, loops: 0 };
  const loops = {};
  const SPEC = { falls: { gain: 0.85, ref: 2.4, roll: 1.1 }, trickle: { gain: 0.3, ref: 0.7, roll: 1.3 } };
  if (on) {
    garden.onClack = (at) => {
      if (sfx.play(['garden_clack_0', 'garden_clack_1'], { at, gain: 0.95, ref: 2.0, jitter: 0.05 })) stats.clacks += 1;
    };
  }
  function start(name) {
    const buf = sfx.buffer?.(`garden_${name}`);
    if (!buf) return null;
    const ctx = getCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = SPEC[name].ref;
    pan.rolloffFactor = SPEC[name].roll;
    const p = garden.sound[name];
    pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z;
    src.connect(gain);
    gain.connect(pan);
    pan.connect(sfx.output());
    src.start(0, Math.random() * buf.duration);
    stats.loops += 1;
    return { src, gain, level: 0 };
  }
  function update(dt, camera) {
    if (!on || !camera) return;
    const e = camera.matrixWorld.elements;
    const dx = e[12] - 5;
    const dz = e[14] - 22;
    const near = Math.hypot(dx, dz) < 42;
    for (const name of Object.keys(SPEC)) {
      let l = loops[name];
      if (!l && near) l = loops[name] = start(name);
      if (!l) continue;
      const target = near ? SPEC[name].gain : 0;
      l.level += (target - l.level) * (1 - Math.exp(-dt / 0.8));
      l.gain.gain.value = l.level;
      if (!near && l.level < 0.002) {
        try { l.src.stop(); } catch { /* already stopped */ }
        loops[name] = null;
      }
    }
  }
  return { update, stats, get on() { return on; } };
}
