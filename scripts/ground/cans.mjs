// Cans pass: the can pyramid end to end through the real XR rig (IWER, emulated Quest 3).
// 1) the stack stands untouched for 10 s with you next to it, 2) running into it topples it (cascade),
// 3) the cans come to rest (asleep, on the floor, inside the room, no NaN), 4) can sounds fire (floor + can-on-can,
// clatter layer) and the 12-voice cap holds, 5) physics frame budget (node-side benchmark of src/cans.js, the
// in-page clock is virtual). Prints PASS/FAIL, exits 1 on failure.
// node scripts/ground/cans.mjs <dist> <out.json> [query]   (needs HOUSE_NODE_MODULES, see boot.mjs)
import fs from 'fs'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'url'; import { boot } from './boot.mjs';
const [dist, out, query = 'teleport=0'] = process.argv.slice(2);
const res = { query, checks: [], steps: [] };
const check = (name, ok, v) => { res.checks.push({ name, ok: !!ok, v }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(v)); };
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
await ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
await ev(async () => { for (let i = 0; i < 400 && __house.settle().on; i++) await T.frames(5); });
const st = () => ev(() => T.x(() => { const c = __house.cans(); return { ...c, log: undefined }; }));
let c = await st();
check('cans exist (new engine unless ?cans=old)', c.phys && (c.legacy || c.phys.count >= 30), { count: c.phys?.count, legacy: c.legacy });
if (c.legacy) { // ?cans=old: smoke only
  await ev(() => T.settle(60));
  c = await st();
  check('?cans=old loads the original pyramid', c.phys.count === 364 && c.phys.nan === 0, { count: c.phys.count });
} else {
  const { room, anchor, floorY } = c.phys;
  // stand 0.9 m from the stack (inside the room, on the +z side) and wait 10 s
  const standZ = Math.min(room.z1 - 0.35, anchor.z + 0.9);
  await ev((a) => T.x(() => __house.place(a.x, a.y, a.z)), { x: anchor.x, y: floorY, z: standZ });
  await ev(() => T.x(() => { __house.audioKick?.(); }));
  await ev(() => T.frames(720));
  c = await st();
  res.steps.push({ idle: c.phys });
  check('1 stack stands still for 10 s next to you', c.phys.moved === 0 && c.phys.awake === 0 && Math.abs(c.phys.topY - c.phys.topHome) < 0.003, { moved: c.phys.moved, awake: c.phys.awake, top: +(c.phys.topY - c.phys.topHome).toFixed(4) });
  // 2) run through it: 3 m/s toward -z, straight through the anchor
  const startZ = anchor.z + 0.75; const endZ = anchor.z - 0.5;
  for (let f = 0, z = startZ; z > endZ; f++, z -= 3 / 72) await ev((a) => T.x(() => __house.place(a.x, a.y, a.z)), { x: anchor.x, y: floorY, z });
  await ev(() => T.frames(36));
  c = await st();
  res.steps.push({ hit: c.phys });
  check('2 running into it topples the pyramid (cascade)', c.phys.moved >= c.phys.count * 0.6 && c.phys.topY < c.phys.topHome - 0.3, { moved: c.phys.moved, of: c.phys.count, topDrop: +(c.phys.topHome - c.phys.topY).toFixed(2), awake: c.phys.awake });
  // step back out of the pile and let it settle
  await ev((a) => T.x(() => __house.place(a.x + 0.9, a.y, a.z)), { x: anchor.x, y: floorY, z: room.z1 - 0.3 });
  let rest = null;
  for (let k = 0; k < 20; k++) { await ev(() => T.frames(72)); c = await st(); if (c.phys.awake === 0) { rest = k + 1; break; } }
  res.steps.push({ rest: c.phys, seconds: rest });
  check('3 cans come to rest within 20 s', c.phys.awake <= 1, { awake: c.phys.awake, seconds: rest });
  check('3 no can lost (NaN / under the floor / out of the room)', c.phys.nan === 0 && c.phys.below === 0 && c.phys.outside === 0, { nan: c.phys.nan, below: c.phys.below, outside: c.phys.outside, onFloor: c.phys.onFloor });
  const s = c.sfx;
  res.sfx = s;
  check('4 can sounds fire (floor bounces and can-on-can clanks)', s.played >= 15 && s.byType.floor > 0 && s.byType.can > 0, { played: s.played, byType: s.byType });
  check('4 a cascade clatter layer played', s.clatter >= 1, { clatter: s.clatter });
  check('4 rolling loop follows rolling cans', s.rollPeak >= 1, { rollPeak: s.rollPeak });
  check('4 voice cap holds (<= 12 at once)', s.peak <= 12 && s.peak >= 4, { peak: s.peak, dropped: s.dropped, stolen: s.stolen });
  // 6) a hand swipe (controller grip probe) through the top of a fresh stack knocks cans off
  await ev(() => T.x(() => __house.world.cans.reset()));
  await ev((a) => T.x(() => __house.place(a.x, a.y, a.z)), { x: anchor.x, y: floorY, z: anchor.z + 0.55 });
  await ev(() => T.frames(10));
  const topY = c.phys.topHome;
  for (let k = 0; k <= 24; k++) {
    const x = anchor.x - 0.45 + k * (0.9 / 24);
    await ev((p) => T.x(() => T.hand('right', p)), [x, topY - 0.12, anchor.z + 0.02]);
    await ev(() => T.frames(1));
  }
  await ev(() => T.frames(144));
  c = await st();
  check('6 a hand swipe through the top layers knocks cans down', c.phys.moved >= 6, { moved: c.phys.moved, awake: c.phys.awake });
  res.sfxLog = (await ev(() => T.x(() => __house.cans().log))).slice(-10);
}
check('no page errors', !logs.some((l) => /pageerror/.test(l)), logs.filter((l) => /pageerror/.test(l)).slice(0, 3));
await close();
// 5) physics budget, node side (the page runs on a virtual clock): the same module, a hard hit, 6 s at 72 Hz.
// A fresh process: the puppeteer heap left in this one makes GC spikes fail a budget the module itself meets.
if (!/cans=old/.test(query)) {
  const src = fileURLToPath(new URL('../../src/cans.js', import.meta.url));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    const src = process.env.CANS_SRC;
    globalThis.location = { search: '?' + (process.env.CANS_QUERY || '') };
    const THREE = await import(pathToFileURL(path.resolve(path.dirname(src), '../node_modules/three/build/three.module.js')).href);
    const { createCans } = await import(pathToFileURL(src).href);
    const cans = createCans(new THREE.Scene(), { room: { x0: 0, x1: 4, z0: 0, z1: 3.2, y: -7.2 }, vestibule: { z0: -0.8 } });
    const bench = () => {
      cans.reset();
      const a = cans.debug().anchor; let z = a.z + 0.8; const ts = [];
      for (let t = 0; t < 72 * 6; t++) {
        if (z > a.z - 0.5) { z -= 3 / 72; cans.setBody({ x: a.x, z, y0: -7.16, y1: -5.6, r: 0.26, vx: 0, vz: -3 }); } else cans.setBody(null);
        const t0 = performance.now(); cans.update(1 / 72); ts.push(performance.now() - t0);
      }
      ts.sort((p, q) => p - q);
      return { p50: +ts[ts.length >> 1].toFixed(3), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(3), max: +ts.at(-1).toFixed(3) };
    };
    for (let i = 0; i < 3; i++) bench();
    const runs = [bench(), bench(), bench()].sort((p, q) => p.p95 - q.p95);
    console.log(JSON.stringify(runs[1]));
  `], { encoding: 'utf8', env: { ...process.env, CANS_SRC: src, CANS_QUERY: query } });
  let b = null;
  try { b = JSON.parse((child.stdout || '').trim().split('\n').at(-1)); } catch { /* reported below */ }
  res.bench = b || { error: (child.stderr || '').slice(0, 400), status: child.status };
  // Quest 3 runs this kind of JS ~3-4x slower than a desktop core: keep p95 under 1 ms here (~4 ms on the headset)
  check('5 physics budget: p95 < 1 ms/frame desktop (~4 ms Quest), max < 5 ms (one wake-up frame)', !!b && b.p95 < 1 && b.max < 5, res.bench);
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
const bad = res.checks.filter((x) => !x.ok).length;
console.log(bad ? `${bad} FAILED` : 'ALL PASS');
process.exit(bad ? 1 : 0);
