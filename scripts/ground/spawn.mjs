// Start-room spawn under realistic Quest boot conditions, many seeds in one page (session ended and re-entered).
// node scripts/ground/spawn.mjs <dist> <out.json> [query] [trials] [--check]   (fall pass; needs HOUSE_NODE_MODULES, see boot.mjs)
// Per trial: eye height 1.2-1.85 m, headset 0-15 cm off the spawn, random yaw, a zero or late floor height for the
// first frames, a 0-8 s frame hitch at session start, physical wander, stick walking, grip squeezes, and on odd trials a
// 0.4-1.8 m head jump during the hitch (you kept walking while the game stalled / tracking jumped). Fails if the feet
// ever go below -0.3.
import fs from 'fs'; import { boot } from './boot.mjs';
const CHECK = process.argv.includes('--check');
const [dist, out, query = '', trialsArg = '24'] = process.argv.slice(2).filter((a) => a !== '--check');
const TRIALS = +trialsArg;
// install the recorder before the FIRST session so trial 0 sees the real first frames
const before = () => {
  window.__vt = performance.now();
  window.__S = { rows: [], plan: null, n: 0 };
  const H = __house;
  { const r = H.renderer; const cam = H.world.camera; if (H.world.croc) H.world.croc.update = () => {}; r.render = () => { r.xr.updateCamera(cam); }; }
  H.setFrameHook(() => {
    const S = __S; S.n++;
    window.__vt += 1000 / 72;
    const p = S.plan; if (!p) return;
    p.f++;
    const f = p.f;
    // tracking: zero/late floor height, then real height; physical wander in the cell
    let y = p.h;
    if (f < p.zeroFrames) y = 0;
    else if (f < p.lateFrames) y = p.h - p.lateDrop;
    const wx = p.wander * Math.sin(f / 37 + p.ph) ; const wz = p.wander * Math.sin(f / 53 + p.ph * 2);
    __xr.position.set(p.dx + wx, y, p.dz + wz);
    if (f === p.hitchAt) window.__vt += p.hitchMs;
    // the player kept moving through the hitch / tracking jumped: the head lands jx, jz away (world-ish, local axes)
    if (f >= p.hitchAt + 1) { p.dx0 = p.dx0 ?? p.dx; p.dx = p.dx0 + p.jx; p.dz = (p.dz0 = p.dz0 ?? p.dz) + p.jz; }
    // left stick walk bursts, grip squeezes
    const L = __xr.controllers.left; const R = __xr.controllers.right;
    if (p.stick && f > 90) { const a = f / 90 + p.ph; L.updateAxes('thumbstick', Math.sin(a) * 0.8, Math.cos(a) * 0.8); }
    if (p.squeeze && f % 47 === 0) R.updateButtonValue('squeeze', 1);
    if (p.squeeze && f % 47 === 5) R.updateButtonValue('squeeze', 0);
    const s = H.state();
    const feet = s.offset[1];
    p.minFeet = Math.min(p.minFeet, feet); p.maxFeet = Math.max(p.maxFeet, feet);
    if (f % 30 === 0 || feet < -0.3) p.trace.length < 80 && p.trace.push([f, s.head.map((v) => +v.toFixed(2)), +feet.toFixed(3), s.climb, s.status.slice(0, 50)]);
    if (f >= p.frames) { L.updateAxes('thumbstick', 0, 0); p.done = true; S.rows.push(p); S.plan = null; }
  });
};
const { pg, ev, logs, close } = await boot(dist, query, { headH: null, before, wait: 0 });
const rnd = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
const results = [];
for (let t = 0; t < TRIALS; t++) {
  const plan = {
    t, f: 0, frames: 72 * 6,
    h: 1.2 + rnd() * 0.65, dx: (rnd() - 0.5) * 0.3, dz: (rnd() - 0.5) * 0.3, yaw: rnd() * Math.PI * 2,
    zeroFrames: t % 3 === 0 ? Math.floor(rnd() * 40) : 0, lateFrames: t % 4 === 1 ? 60 + Math.floor(rnd() * 60) : 0, lateDrop: 0.3 + rnd() * 0.5,
    hitchAt: 1 + Math.floor(rnd() * 20), hitchMs: [0, 120, 600, 2500, 8000][t % 5], jx: 0, jz: 0,
    wander: t % 2 ? 0.45 : 0.1, ph: rnd() * 6, stick: t % 3 !== 2, squeeze: t % 2 === 0,
    minFeet: 99, maxFeet: -99, trace: [],
  };
  if (process.env.JUMPS !== '0' && t % 2 === 1) { const a = rnd() * Math.PI * 2; const m = 0.4 + rnd() * 1.4; plan.jx = Math.cos(a) * m; plan.jz = Math.sin(a) * m; plan.hitchAt = 20 + Math.floor(rnd() * 60); }
  if (t > 0) {
    // new session: end, then re-enter with this plan live from the first frame
    await ev(() => __xr.activeSession?.end());
    await pg.waitForFunction(() => !__xr.activeSession, { timeout: 30000 });
  }
  await ev((plan) => {
    const q = __xr.quaternion; const h = plan.yaw / 2; q.set(0, Math.sin(h), 0, Math.cos(h));
    __xr.position.set(plan.dx, plan.zeroFrames ? 0 : plan.h, plan.dz);
    __S.plan = plan;
  }, plan);
  if (t > 0) await ev(() => document.getElementById('XRButton').click());
  await pg.waitForFunction(() => __S.rows.length > 0 && __S.rows[__S.rows.length - 1].t === __S.lastT + 1 || (__S.plan == null && __S.rows.length), { timeout: 600000, polling: 500 }).catch(() => {});
  await pg.waitForFunction((t) => __S.rows.some((r) => r.t === t), { timeout: 900000, polling: 500 }, t);
  const r = await ev((t) => __S.rows.find((x) => x.t === t), t);
  const st = await ev(() => __house.state());
  r.end = { head: st.head.map((v) => +v.toFixed(2)), feet: +st.offset[1].toFixed(3), status: st.status };
  r.fell = r.minFeet < -0.3;
  results.push(r);
  console.log(t, 'h', r.h.toFixed(2), 'jump', Math.hypot(r.jx, r.jz).toFixed(2), 'zero', r.zeroFrames, 'late', r.lateFrames, 'hitch', r.hitchMs, 'min', r.minFeet.toFixed(3), 'max', r.maxFeet.toFixed(3), 'end', JSON.stringify(r.end.head), r.end.feet, r.fell ? 'FELL' : 'ok');
}
fs.writeFileSync(out, JSON.stringify({ query, results, logs: logs.slice(0, 20) }));
console.log('fell', results.filter((r) => r.fell).length, '/', results.length);
await close(); process.exit(CHECK && results.some((r) => r.fell) ? 1 : 0);
