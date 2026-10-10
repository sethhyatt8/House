// Climb every climb in the game with the body-model bot: sea-wall notch line, east crag, roof ladder.
// node scripts/ground/climbs.mjs <dist> <out.json> [query] [low] [--check]   (fall pass; CLIMBS=sea,sealean,crag,roof)
// Every climb with a body-model bot (climbbot.js: hands reach feet+low .. head+0.55, pulls stop at hip height): must top
// out, land on a walkable floor with the climb released, then walk 1 m+ on the stick and snap turn.
import fs from 'fs'; import { boot } from './boot.mjs';
const CHECK = process.argv.includes('--check');
const [dist, out, query = 'teleport=0', lowArg = '0.8'] = process.argv.slice(2).filter((a) => a !== '--check');
const low = +lowArg;
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
await ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
await ev(fs.readFileSync(new URL('./climbbot.js', import.meta.url), 'utf8'));
const res = {};
for (const which of (process.env.CLIMBS || 'sea,sealean,crag,roof').split(',')) {
  res[which] = await ev(async (which, low) => {
    const H = __house; const w = H.world;
    H.chopDoor();
    await T.x(() => { __xr.position.set(0, 1.6, 0); T.hand('left', [0, 0, 0]); });
    let L; let start;
    w.scene.traverse((o) => { if (o.userData?.rungs && o.userData.path && !o.userData.crag && (which === 'sea' || which === 'sealean')) L = o; });
    if (which === 'crag') L = w.crag.ladder;
    if (which === 'roof') w.scene.traverse((o) => { if (o.userData?.rungs && !o.userData.shaft && o.userData.roofY < 4 && !L) L = o; });
    if (!L) return { error: 'no ladder' };
    if (L.userData.path) { const f = L.userData.shaft.base; start = [L.position.x - 0.42, f, L.userData.zAt(f + 1.2)]; }
    else start = [L.position.x - 0.42, 0, L.position.z];
    await T.x(() => { H.place(start[0], start[1], start[2]); T.yawTo(-Math.PI / 2); });
    await T.frames(10);
    await T.x(() => { const s = H.state(); T.hand('right', [s.head[0] + 0.3, s.offset[1] + 1.0, s.head[2] + 0.2]); T.hand('left', [s.head[0] + 0.3, s.offset[1] + 1.0, s.head[2] - 0.2]); });
    await T.frames(3);
    const r = await T.climbBot(L, { low, leanAtTop: which === 'sealean' });
    r.start = start; r.top = L.userData.shaft?.top ?? L.userData.roofY;
    return r;
  }, which, low);
  const r = res[which];
  console.log(which, JSON.stringify({ result: r.result, grabs: r.grabs, at: r.at, after: r.after, moved: r.moved, turned: r.turned, end: r.end, last: r.trace?.slice(-3) }));
}
fs.writeFileSync(out, JSON.stringify(res));
const want = { sea: 0, sealean: 0, crag: 33.42, roof: 3.26 };
let failed = 0;
for (const [k, r] of Object.entries(res)) {
  const pass = r.result === 'released' && r.after?.walk?.ok && !r.after.climb && Math.abs(r.after.feet - want[k]) < 0.02 && r.moved > 1 && Math.abs(r.turned) > 0.4;
  if (!pass) failed++;
  console.log(pass ? 'PASS' : 'FAIL', k, 'topped out, walkable, stick + snap turn');
}
await close(); process.exit(CHECK && failed ? 1 : 0);
