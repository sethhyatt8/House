// Fall death: lethal falls (ground and water), scuba water landing, small drops, notch slides, void, checkpoints.
// node scripts/ground/fall.mjs <dist> <out.json> [query] [--check]   (fall pass; needs HOUSE_NODE_MODULES)
import fs from 'fs'; import { boot } from './boot.mjs';
const args = process.argv.slice(2); const check = args.includes('--check');
const [dist, out, query = 'teleport=0'] = args.filter((a) => a !== '--check');
const results = [];
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
async function run(q, fn) {
  const b = await boot(dist, q, { headH: 1.6 });
  await b.ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
  await b.ev(() => { __house.chopDoor(); });
  await b.ev(async () => { for (let i = 0; i < 400 && __house.settle().on; i++) await T.frames(5); }); // session-start gravity hold done
  try { await fn(b.ev); } finally { b.logs.filter((l) => /pageerror/.test(l)).forEach((l) => ok('no page errors', false, l)); await b.close(); }
}
// drop from (x, feet, z) and watch for 6 s: deaths, where you end up, swim state
const dropScript = async ([x, feet, z, frames = 430]) => {
  const H = __house;
  const d0 = H.fallDeath().stats.deaths;
  await T.x(() => H.place(x, feet, z));
  let minFeet = 99; let maxOpacity = 0; let swum = false;
  for (let i = 0; i < frames; i += 6) { await T.frames(6); const s = await T.st(); minFeet = Math.min(minFeet, s.offset[1]); const fd = H.fallDeath(); maxOpacity = Math.max(maxOpacity, fd.opacity); if (s.swim?.active) swum = true; }
  const s = await T.st(); const fd = H.fallDeath();
  return { deaths: fd.stats.deaths - d0, last: fd.stats.last, minFeet: +minFeet.toFixed(2), feet: +s.offset[1].toFixed(2), head: s.head.map((v) => +v.toFixed(2)), swimming: !!s.swim?.active, swum, maxOpacity: +maxOpacity.toFixed(2), cp: fd.cp, status: s.status };
};
await run(query, async (ev) => {
  // 1) step off the cliff-room edge (8.6 m onto the cave shallows, past the moored canoe): dies, respawns in the start room
  let r = await ev(dropScript, [-2.3, 0, 0.05]);
  ok('cliff room edge -> shallows past the canoe (8.6 m) kills', r.deaths === 1 && r.last?.why === 'fall' && r.maxOpacity > 0.95, r);
  ok('respawned on the start-room floor, not swimming', Math.abs(r.feet) < 0.01 && Math.abs(r.head[0] - 4.12) < 0.3 && Math.abs(r.head[2] - 0.14) < 0.3 && !r.swimming, r);
  // 1b) out over the open sea from start-floor height (8 m water landing)
  r = await ev(dropScript, [-6, 0, 0]);
  ok('start-floor height -> open sea (8 m water landing) kills', r.deaths === 1 && r.last?.why === 'fall-water' && r.maxOpacity > 0.95, r);
  ok('respawned on the start-room floor, not swimming', Math.abs(r.feet) < 0.01 && Math.abs(r.head[0] - 4.12) < 0.3 && Math.abs(r.head[2] - 0.14) < 0.3 && !r.swimming, r);
  // 2) small drop: off the roof onto the cliff-room floor (3.26 m) is fine
  r = await ev(dropScript, [0.3, 3.26, 1.6, 200]);
  ok('roof -> floor (3.3 m) survives', r.deaths === 0 && Math.abs(r.feet) < 0.01, r);
  // 3) checkpoint: stand in the yard 2.5 s, then fall 7.5 m onto the cliff-room floor: respawn in the yard.
  // (0.9, 6.2) is on the model-crate row down the middle of the yard, so the feet sit on a crate and it is not the floor.
  await ev(async () => { await T.x(() => __house.place(0.36, 0, 7.98)); await T.frames(200); });
  const cp = await ev(() => __house.fallDeath().cp);
  ok('standing 2 s in the yard sets a checkpoint', cp.zone === 'yard', cp);
  r = await ev(dropScript, [-1.0, 7.5, 0.85]);
  ok('7.5 m onto rock kills', r.deaths === 1 && r.last?.why === 'fall', r);
  ok('respawn at the yard checkpoint', r.cp.zone === 'yard' && Math.hypot(r.head[0] - cp.x, r.head[2] - cp.z) < 0.3 && Math.abs(r.feet) < 0.01, r);
  // 4) the summit to the roof (30 m)
  r = await ev(dropScript, [1.8, 33.42 + 1.0, 2.2]);
  ok('a fall from overlook height onto the roof kills', r.deaths === 1, r);
  // 5) letting go high on the sea-wall notches is a slide (7.9 m max): survives on the shelf
  r = await ev(dropScript, [-1.98, -0.4, 8.2]);
  ok('notch-line slide to the shelf survives', r.deaths === 0 && Math.abs(r.feet - -7.92) < 0.05, r);
  // 6) off the map (x 500): void -> respawn
  r = await ev(dropScript, [500, 0, 0, 160]);
  ok('below the world -> respawn', r.deaths === 1 && r.last?.why === 'void' && r.feet > -1, r);
  // 7) a short drop into the sea (1.2 m over the water) is a swim
  r = await ev(dropScript, [-6, -6.8, 0, 160]);
  ok('1.2 m into the sea: swim, no death', r.deaths === 0 && r.swum, r);
  // 8) teleports never count: roof -> cave floor spot (11 m lower)
  r = await ev(async () => { const H = __house; const d0 = H.fallDeath().stats.deaths; await T.x(() => H.place(1.8, 3.26, 0)); await T.frames(20); await T.x(() => H.teleportTo(5)); await T.frames(150); const s = await T.st(); return { deaths: H.fallDeath().stats.deaths - d0, feet: +s.offset[1].toFixed(2) }; });
  ok('teleport roof -> cave floor: no death', r.deaths === 0 && Math.abs(r.feet - -7.92) < 0.05, r);
});
// 9) wearing the scuba kit: the 8 m water landing is a swim
await run(query + '&scuba=1', async (ev) => {
  const r = await ev(dropScript, [-6, 0, 0, 200]);
  ok('scuba kit on: start-floor height -> open sea survives and swims', r.deaths === 0 && r.swum, r);
  const r2 = await ev(dropScript, [-1.0, 7.5, 0.85, 200]);
  ok('scuba kit on: 7.5 m onto rock still kills', r2.deaths === 1, r2);
});
// 10) ?falldeath=0: no deaths
await run(query + '&falldeath=0', async (ev) => {
  const r = await ev(dropScript, [-6, 0, 0, 200]);
  ok('?falldeath=0: the 8 m water landing is a swim', r.deaths === 0 && r.swum, r);
});
fs.writeFileSync(out, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(check && failed.length ? 1 : 0);
