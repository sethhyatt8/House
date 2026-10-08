// Rowing feel through the real XR rig (IWER): one stroke from rest in open water -> distance during the drive, peak
// speed, coast time (until < 0.10 and < 0.05 m/s) and total glide; a strong full-arc stroke, a small "real Quest"
// stroke (shorter, slower arc, hands settled 4 cm below where you took hold, +-2 cm wobble), pull-back, one oar,
// blades out. Prints PASS/FAIL, exits 1 on failure.   node scripts/ground/row.mjs <dist> <out.json> [query]
import fs from 'fs'; import { boot } from './boot.mjs';
const [dist, out, query = ''] = process.argv.slice(2);
const { ev, logs, close } = await boot(dist, query, { headH: 1.15 });
for (const f of ['probe.js', 'pagelib.js']) await ev(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
const res = { query, steps: [], checks: [] };
const step = (name, v) => { res.steps.push({ name, ...v }); console.log(name, JSON.stringify(v)); };
const check = (name, ok, v) => { res.checks.push({ name, ok: !!ok, v }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(v)); };
// board, tow the boat out to open water (bow west), take both oars where they rest
await ev(() => T.x(() => { __house.chopDoor(); __house.boardCanoe(); }));
await ev(() => T.settle(30));
await ev(() => T.x(() => { const c = __house.world.canoe; c.group.position.x = -7.5; c.group.position.z = 3.5; c.group.rotation.y = Math.PI / 2; }));
await ev(() => T.settle(60));
await ev(() => {
  const c = __house.world.canoe; T.L = c.longOars.find((o) => o.side < 0); T.R = c.longOars.find((o) => o.side > 0);
  const w = (o) => { const v = o.end.clone(); c.group.localToWorld(v); return [v.x, v.y, v.z]; };
  const pr = w(T.R); const pl = w(T.L); T.hy = { R: T.R.end.y, L: T.L.end.y };
  T.follow = { right: () => pr, left: () => pl };
});
await ev(() => T.settle(10));
await ev(() => { T.btn('left', 'squeeze', 1); T.btn('right', 'squeeze', 1); }); await ev(() => T.settle(20));
const held = await ev(() => __house.world.canoe.longOars.map((o) => !!o.hand));
check('took both oars', held.every(Boolean), held);
// one stroke from rest. arc: [start, end] bearing (rad, + = toward the rower); secs: drive time; drop: hands this far
// below the grab height during the drive; wobble: +- hand height noise; side: both | R | L | none
const one = (o) => ev(async ({ arc = [0.35, -0.8], secs = 0.6, drop = 0, wobble = 0, side = 'both', dir = 1 }) => {
  const c = __house.world.canoe; const TH = __house.THREE;
  const at = (oar, key, th, outOfWater, dy) => { const v = new TH.Vector3(oar.P.x - oar.side * 0.5 * Math.cos(th), T.hy[key] - (outOfWater ? 0.2 : 0) + dy, oar.P.z + 0.5 * Math.sin(th)); c.group.localToWorld(v); return [v.x, v.y, v.z]; };
  const set = (th, inR, inL, dy = 0) => { const pr = at(T.R, 'R', th, !inR, dy); const pl = at(T.L, 'L', th, !inL, dy); T.follow = { right: () => pr, left: () => pl }; };
  const a0 = dir > 0 ? arc[0] : arc[1]; const a1 = dir > 0 ? arc[1] : arc[0];
  // settle: wait for the boat to stop (blades out, hands at the catch)
  for (let i = 0; i < 72 * 40; i++) { set(a0, false, false); await T.frames(1); const sm = c.debug().sim; if (Math.hypot(sm.vx, sm.vz) < 0.01 && Math.abs(sm.yawRate) < 0.01 && i > 30) break; }
  await T.x(() => { c.group.position.x = -7.5; c.group.position.z = 3.5; });
  for (let i = 0; i < 20; i++) { set(a0, false, false); await T.frames(1); }
  const p0 = c.group.position.clone(); const yaw0 = c.group.rotation.y; const fx = -Math.sin(yaw0); const fz = -Math.cos(yaw0);
  const inR = side === 'both' || side === 'R'; const inL = side === 'both' || side === 'L';
  for (let i = 0; i < 8; i++) { set(a0, inR, inL, -drop); await T.frames(1); }
  const N = Math.round(secs * 72); let peak = 0; let wetMin = 1; let wetSum = 0; let forceMax = 0; const sp = () => { const sm = c.debug().sim; return -Math.sin(yaw0) * sm.vx - Math.cos(yaw0) * sm.vz; };
  for (let i = 0; i <= N; i++) { const u = 0.5 - 0.5 * Math.cos(Math.PI * i / N); set(a0 + (a1 - a0) * u, inR, inL, -drop + wobble * Math.sin(i * 0.9)); await T.frames(1); const d = c.debug(); const w = d.oars.filter((o, k) => (o.name.includes('star') || o.name.includes('R') ? inR : inL)); wetSum += d.oars.reduce((a, o) => a + o.wet, 0) / 2; wetMin = Math.min(wetMin, ...d.oars.map((o) => o.wet)); forceMax = Math.max(forceMax, d.oars.reduce((a, o) => a + o.force, 0)); const v = sp(); if (Math.abs(v) > Math.abs(peak)) peak = v; }
  const pd = c.group.position.clone().sub(p0); const driveDist = pd.x * fx + pd.z * fz;
  // lift out and hold still: coast
  for (let i = 0; i < 6; i++) { set(a1, false, false); await T.frames(1); }
  let t10 = null; let t05 = null; let t = 0; const v0 = sp(); const trace = [];
  for (let i = 0; i < 72 * 40; i++) { await T.frames(1); t += 1 / 72; const v = Math.abs(sp()); if (i % 36 === 0) { const d = c.debug(); trace.push([+v.toFixed(2), +c.group.position.x.toFixed(2), +c.group.position.z.toFixed(2), +d.sim.groundedFrac.toFixed(2), d.oars.map((o) => o.wet).join('/')]); } if (Math.abs(v) > Math.abs(peak)) peak = sp(); if (t10 == null && v < 0.1) t10 = +t.toFixed(1); if (t05 == null && v < 0.05) { t05 = +t.toFixed(1); break; } }
  const d = c.group.position.clone().sub(p0);
  return { total: +(d.x * fx + d.z * fz).toFixed(2), drive: +driveDist.toFixed(2), peak: +peak.toFixed(2), vAtRelease: +v0.toFixed(2), coastTo010: t10, coastTo005: t05, turnDeg: +((c.group.rotation.y - yaw0) * 180 / Math.PI).toFixed(1), meanWet: +(wetSum / (N + 1)).toFixed(2), wetMin: +wetMin.toFixed(2), peakForceN: +forceMax.toFixed(0), ...(window.__TRACE ? { trace } : {}) };
}, o);
if (process.env.TRACE) await ev(() => { window.__TRACE = 1; });
if (process.env.ONLY) { for (const k of process.env.ONLY.split(',')) step(k, await one(JSON.parse(k))); await close(); process.exit(0); }
if (process.env.TRACE) await ev(() => { window.__TRACE = 1; });
const strong = await one({}); step('R1_strong_full_stroke', strong);
const quest = await one({ arc: [0.2, -0.5], secs: 0.85, drop: 0.04, wobble: 0.02 }); step('R2_small_quest_stroke', quest);
const soft = await one({ arc: [0.35, -0.8], secs: 1.1 }); step('R3_soft_full_stroke', soft);
const pull = await one({ dir: -1 }); step('R4_pull_back', pull);
const star = await one({ side: 'R' }); step('R5_starboard_only', star);
const port = await one({ side: 'L' }); step('R6_port_only', port);
const none = await one({ side: 'none' }); step('R7_blades_out', none);
check('good headset-size stroke (0.35 m hands, 0.85 s, hands settled 4 cm low): 2.5-3.5 m of glide', quest.total >= 2.5 && quest.total <= 3.5 && quest.meanWet > 0.6, { total: quest.total, meanWet: quest.meanWet });
check('it coasts 7.5-12.5 s (to < 0.10 m/s)', quest.coastTo010 >= 7.5 && quest.coastTo010 <= 12.5, quest.coastTo010);
check('full-range hard stroke goes further (and coasts 8-13 s), peak <= 2.5 m/s', strong.total > quest.total && strong.coastTo010 >= 8 && strong.coastTo010 <= 13 && strong.peak <= 2.5, { total: strong.total, coast: strong.coastTo010, peak: strong.peak });
check('hard > soft', strong.total > soft.total * 1.1, { strong: strong.total, soft: soft.total });
check('pull back = backward', pull.total < -1.5, pull.total);
check('starboard only turns to port (+yaw), port only to starboard', star.turnDeg > 5 && port.turnDeg < -5, { star: star.turnDeg, port: port.turnDeg });
check('blades out = no thrust', Math.abs(none.total) < 0.05, none.total);
check('tracks straight (both oars: |turn| < 3 deg)', Math.abs(strong.turnDeg) < 3, strong.turnDeg);
res.logs = logs;
fs.writeFileSync(out, JSON.stringify(res, null, 1));
const bad = res.checks.filter((c) => !c.ok).length;
console.log(bad ? `${bad} FAILED` : 'ALL PASS');
await close(); process.exit(bad ? 1 : 0);
