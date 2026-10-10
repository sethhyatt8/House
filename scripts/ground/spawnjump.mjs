// node scripts/ground/spawnjump.mjs <dist> <out.json> [query] [--check]   (fall pass)
// Head jumps (tracking hitch / pose gap while the player moves) inside the start room: does the rig leave the cell?
// 005ff00: a 1.0 m jump north/south or 1.2 m east lands you on the cave / tunnel floor 7.9 m below.
import fs from 'fs'; import { boot } from './boot.mjs';
const CHECK = process.argv.includes('--check');
const [dist, out, query = ''] = process.argv.slice(2).filter((a) => a !== '--check');
const { pg, ev, logs, close } = await boot(dist, query, { headH: 1.6 });
await ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
const res = [];
const cases = [];
for (const [dx, dz] of [[0.5, 0], [0.8, 0], [1.2, 0], [0, 0.7], [0, 1.0], [0, -0.7], [0, -1.0], [-0.9, 0], [-1.6, 0]]) cases.push({ dx, dz });
for (const c of cases) {
  const r = await ev(async (c) => {
    const H = __house;
    await T.x(() => { __xr.position.set(0, 1.6, 0); });
    await T.frames(3);
    await T.x(() => H.place(4.12, 0, 0.14));
    await T.frames(10);
    const s0 = await T.st();
    // jump the tracked head by (dx, dz) in WORLD space in one frame (e.g. a 0.5-1 s pose gap while you step)
    await T.x(() => { const l = T.toLocal([s0.head[0] + c.dx, s0.head[1], s0.head[2] + c.dz]); __xr.position.set(l[0], l[1], l[2]); });
    let minFeet = 99; let worst = null;
    for (let i = 0; i < 150; i++) { await T.frames(1); const s = await T.st(); if (s.offset[1] < minFeet) { minFeet = s.offset[1]; worst = s; } }
    const s1 = await T.st();
    return { c, from: s0.head.map((v) => +v.toFixed(2)), to: s1.head.map((v) => +v.toFixed(2)), feet: +s1.offset[1].toFixed(2), minFeet: +minFeet.toFixed(2), status: s1.status, swim: s1.swim?.active };
  }, c);
  console.log(JSON.stringify(r)); res.push(r);
}
fs.writeFileSync(out, JSON.stringify(res));
const bad = res.filter((r) => r.minFeet < -0.3 || Math.abs(r.feet) > 0.01);
console.log(bad.length ? `FAIL ${bad.length}/${res.length} left the floor` : `all ${res.length} stayed on the start-room floor`);
await close(); process.exit(CHECK && bad.length ? 1 : 0);
