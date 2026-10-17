// Garden pass: spawn -> yard -> down the bank path -> round the garden -> back up -> start room, with teleport off
// (?teleport=0) and no place()/teleport on the journey. Then (fresh sessions, place() allowed) the collision and
// fall checks: bed stones, pond, bank, sea edge and fence stop the stick; the walk model matches the visible ground
// all over the terrace (no fall-through); the 2.4 m bank is not a fall death but 8 m is; the garden is a checkpoint;
// stepping into the sea off the garden edge is a swim. Last, ?garden=0 has no garden.
// node scripts/ground/garden.mjs <dist> <out.json> [query] [--check]   (needs HOUSE_NODE_MODULES)
import fs from 'fs'; import { boot } from './boot.mjs';
const args = process.argv.slice(2); const check = args.includes('--check');
const [dist, out, query = 'teleport=0'] = args.filter((a) => a !== '--check');
const results = [];
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info).slice(0, 500)); };
async function session(q, fn) {
  const b = await boot(dist, q, { headH: 1.6 });
  await b.ev(fs.readFileSync(new URL('./probe.js', import.meta.url), 'utf8'));
  await b.ev(() => GT.init());
  await b.ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
  await b.ev(() => {
    // denser waypoints + re-plan (as walkall.mjs)
    T.go = async (targets, opts = {}) => {
      const results = [];
      for (const tgt of targets) {
        let r = null;
        for (let tries = 0; tries < 4; tries++) {
          const s = await T.st();
          const path = await T.x(() => T.plan([s.head[0], s.head[2]], tgt, s.offset[1]));
          if (!path) { r = { to: tgt, ok: false, why: 'no path', from: s.head.map((v) => +v.toFixed(2)) }; break; }
          const dense = []; let prev = [s.head[0], s.head[2]];
          for (const p of path) { dense.push([(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2], p); prev = p; }
          r = { to: tgt, ...(await T.walk(dense, { frames: 300 + dense.length * 30, tol: 0.12, ...opts })), tries };
          if (r.ok) break;
        }
        results.push(r);
      }
      return results;
    };
  });
  await b.ev(() => T.x(() => __house.chopDoor()));
  await b.ev(async () => { for (let i = 0; i < 400 && __house.settle?.().on; i++) await T.frames(5); });
  try { await fn(b.ev); } finally { b.logs.filter((l) => /pageerror/.test(l)).forEach((l) => ok('no page errors', false, l)); await b.close(); }
}

// ONLY=journey|checks|off runs one part
const ONLY = process.env.ONLY || '';
const want = (k) => !ONLY || ONLY === k;
// ---- 1) the journey (no place/teleport)
if (want('journey')) await session(query, async (ev) => {
  const sp = await ev(() => __house.world.garden?.spots);
  ok('garden exists', !!sp, sp);
  if (!sp) return;
  const legs = [];
  const leg = async (name, targets) => {
    await ev((t) => { T.tag = t; T.recOn = true; }, name);
    const w = await ev((tg) => T.go(tg), targets);
    await ev(() => { T.recOn = false; });
    const s = await ev(() => { const s = __house.state(); return { feet: +s.offset[1].toFixed(3), head: s.head.map((v) => +v.toFixed(2)) }; });
    const pass = w.every((l) => l?.ok);
    legs.push({ name, pass, s, w });
    ok(`walk: ${name}`, pass, { ...s, fails: w.filter((l) => !l?.ok) });
  };
  const t0 = Date.now();
  await leg('start room -> cliff room -> yard', [[3.9, 0.14], [2.2, 0.12], [0.9, 0.85], [-1.25, 0.0], [-1.25, 2.2], [0.3, 2.4], [0.35, 8.8], sp.yardEdge]);
  await leg('down the bank path to the terrace', [sp.pathTop, sp.pathTurn, sp.pathFoot]);
  const atFoot = await ev(() => __house.state().offset[1]);
  ok('reached terrace level on foot (feet ~ -2.4)', Math.abs(atFoot - -2.4) < 0.2, { feet: atFoot });
  await leg('round the garden: lantern, west strip, south view, east strip, pond, tsukubai', [sp.toro, sp.westStrip, sp.southView, sp.eastStrip, sp.pondSouth, sp.tsukubaiView]);
  await leg('back up the path to the yard', [sp.pathFoot, sp.pathTurn, sp.pathTop, sp.yardEdge]);
  await leg('yard -> cliff room -> start room', [[0.35, 8.8], [0.3, 2.4], [-0.1, -0.65], [0.9, 0.85], [2.2, 0.12], [3.9, 0.14]]);
  const rows = await ev(() => T.rows);
  const fd = await ev(() => __house.fallDeath?.() ?? null);
  const bad = rows.filter((r) => !r[8] && !r[9] && r[6] != null && Math.abs(r[4] - r[6]) > 0.05 && Math.abs(r[10]) < 0.01 && !r[11]);
  const garden = rows.filter((r) => r[3] > 10.2);
  ok('journey: no deaths', (fd?.stats?.deaths ?? 0) === 0, fd?.stats);
  const badG = bad.filter((r) => r[3] > 10.2);
  ok('journey: feet within 5 cm of the visible ground every garden frame (z > 10.2)', badG.length === 0, { frames: rows.length, gardenFrames: garden.length, offGarden: badG.length, offElsewhere: bad.length - badG.length, sample: badG.slice(0, 6), sampleElsewhere: bad.filter((r) => r[3] <= 10.2).slice(0, 3) });
  ok('journey: ends back in the start room on the floor', (() => { const s = legs[legs.length - 1].s; return Math.abs(s.feet) < 0.01 && Math.hypot(s.head[0] - 3.9, s.head[2] - 0.14) < 0.3; })(), legs[legs.length - 1].s);
  const minFeet = Math.min(...garden.map((r) => r[4]));
  ok('journey: lowest feet on the terrace (no sinking into the pond/sea)', minFeet > -2.75, { minFeet });
  results.push({ name: 'journey stats', pass: true, info: { frames: rows.length, gardenFrames: garden.length, wallSeconds: Math.round((Date.now() - t0) / 1000) } });
});

// ---- 2) collisions, ground model, falls (place() allowed)
if (want('checks')) await session(query, async (ev) => {
  // walk-into checks: aim the stick straight at a target for 6 s, see where you stop and why
  const push = async ([x, z, tx, tz]) => {
    const H = __house;
    const g = H.world.garden.groundAt(x, z);
    await T.x(() => H.place(x, g, z));
    await T.frames(40);
    let s = await T.st();
    const placed = [+s.head[0].toFixed(2), +s.head[2].toFixed(2), +s.offset[1].toFixed(2)];
    const r = await T.walk([[tx, tz]], { frames: 430, tol: 0.05 });
    s = await T.st();
    const d = s.head;
    return { ...r, placed, at: [+d[0].toFixed(2), +d[2].toFixed(2)], feet: +s.offset[1].toFixed(2) };
  };
  // yard south edge off the path: you can not walk off the yard down the bank face
  let r = await ev(async () => { const H = __house; await T.x(() => H.place(3.0, 0, 9.6)); await T.frames(30); const w = await T.walk([[3.0, 13.5]], { frames: 430, tol: 0.05 }); const s = await T.st(); return { ...w, feet: +s.offset[1].toFixed(2), at: [+s.head[0].toFixed(2), +s.head[2].toFixed(2)] }; });
  ok('yard edge off the path holds (feet stay at yard level)', !r.ok && Math.abs(r.feet) < 0.05 && r.at[1] < 11.6, r);
  r = await ev(push, [5.0, 21.2, 5.0, 23.5]);
  ok('big bed stone stops you (stand-off >= 0.45 m from its centre)', !r.ok && Math.hypot(r.at[0] - 5.0, r.at[1] - 23.5) > 0.45, r);
  r = await ev(push, [3.0, 16.9, 7.3, 16.6]);
  ok('pond: can not walk into it', !r.ok && r.at[0] < 7.3 - 1.5 && r.feet > -2.6, r);
  r = await ev(push, [6.6, 18.7, 7.3, 16.25]);
  ok('pond from the south: can not walk into it', !r.ok && r.at[1] > 17.5 && r.feet > -2.6, r);
  r = await ev(push, [0.5, 21.5, -4.0, 21.5]);
  ok('sea edge stops you', !r.ok && r.feet > -2.6 && /sea|edge|water/.test(r.why), r);
  r = await ev(push, [9.0, 24.0, 14.0, 24.0]);
  ok('fence stops you (east)', !r.ok && r.at[0] < 11.6 && /fence/.test(r.why), r);
  r = await ev(push, [-0.95, 16.2, -0.95, 12.0]);
  ok('bank off the path is a wall from below', !r.ok && r.feet < -2.2 && r.at[1] > 14.0 && /bank/.test(r.why), r);
  // ground model vs the visible ground over the walkable terrace (0.25 m grid): no fall-through, no floating
  r = await ev(() => T.x(() => {
    const H = __house; const G = H.world.garden; let n = 0; let worst = 0; const bad = []; let skipped = 0;
    for (let x = -1.0; x < 11.4; x += 0.25) {
      for (let z = 10.4; z < 31.6; z += 0.25) {
        const feet = G.groundAt(x, z);
        if (feet == null || G.blocked(x, z)) continue;
        const w = H.walker.walkable(x, z, feet);
        if (!w.ok) { skipped += 1; continue; } // colliders (stones, trees, lantern)
        if (Math.abs(G.sdBed(x, z)) < 0.01) { skipped += 1; continue; } // exactly on the kerb/gravel seam (either is right)
        const gt = GT.floor(x, z, feet + 0.6, feet - 3);
        n += 1;
        const d = gt == null ? 9 : Math.abs(gt - w.ground);
        if (d > worst) worst = d;
        if (d > 0.05) bad.push([+x.toFixed(2), +z.toFixed(2), +w.ground.toFixed(3), gt == null ? null : +gt.toFixed(3)]);
      }
    }
    return { n, skipped, worst: +worst.toFixed(3), bad: bad.length, sample: bad.slice(0, 10) };
  }));
  ok('ground model matches the visible terrace (0.25 m grid, |d| <= 5 cm)', r.n > 1500 && r.bad === 0, r);
  // falls
  const drop = async ([x, feet, z, frames = 430]) => {
    const H = __house;
    for (let i = 0; i < 300 && H.fallDeath().death; i += 1) await T.frames(5); // let any respawn finish
    const d0 = H.fallDeath().stats.deaths;
    await T.x(() => H.place(x, feet, z));
    let swum = false;
    for (let i = 0; i < frames; i += 6) { await T.frames(6); const s = await T.st(); if (s.swim?.active) swum = true; }
    const s = await T.st(); const fd = H.fallDeath();
    return { deaths: fd.stats.deaths - d0, last: fd.stats.last?.why, feet: +s.offset[1].toFixed(2), head: s.head.map((v) => +v.toFixed(2)), swum, cp: fd.cp };
  };
  r = await ev(drop, [6.0, 0.0, 22.0]);
  ok('yard height -> terrace (2.4 m) survives', r.deaths === 0 && Math.abs(r.feet - -2.4) < 0.2, r);
  // a terrace spot with 0.45 m of clear floor round it (main.js safeZone keeps checkpoints off edges)
  const spot = await ev(() => T.x(() => {
    const H = __house; const G = H.world.garden;
    for (const [x, z] of [[2.0, 17.3], [-0.2, 22.6], [4.65, 30.35], [10.0, 24.2], [1.2, 20.6], [7.6, 31.4]]) {
      const f = G.groundAt(x, z);
      if (!G.isTerrace(x, z, f)) continue;
      if ([[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]].every(([dx, dz]) => { const w = H.walker.walkable(x + dx, z + dz, f); return w.ok && Math.abs(w.ground - f) < 0.3; })) return [x, z, f];
    }
    return null;
  }));
  await ev(async (sp) => { const H = __house; await T.x(() => H.place(sp[0], sp[2], sp[1])); await T.frames(260); }, spot);
  const cp = await ev(() => __house.fallDeath().cp);
  ok('standing 2 s on the terrace sets a garden checkpoint', cp?.zone === 'garden', { cp, spot });
  r = await ev(drop, [6.0, 6.0, 25.0]);
  ok('8.4 m onto the terrace kills', r.deaths === 1 && r.last === 'fall', r);
  ok('respawn at the garden checkpoint', cp?.zone === 'garden' && Math.hypot(r.head[0] - cp.x, r.head[2] - cp.z) < 0.4 && Math.abs(r.feet - (cp.floor ?? cp.feet)) < 0.1, { r, cp });
  r = await ev(drop, [-4.5, -2.4, 22.0, 300]);
  ok('off the garden edge into the sea (5.6 m) is a swim, not a death', r.deaths === 0 && r.swum, r);
  // performance hooks
  const st = await ev(() => ({ stats: __house.world.garden.stats, loaded: __house.world.garden.loaded }));
  results.push({ name: 'garden stats', pass: true, info: st });
});

// ---- 3) ?garden=0
if (want('off')) await session(query + '&garden=0', async (ev) => {
  const r = await ev(() => ({ garden: !!__house.world.garden }));
  ok('?garden=0: no garden', !r.garden, r);
  const w = await ev(() => T.go([[3.9, 0.14], [2.2, 0.12], [0.9, 0.85], [-1.25, 0.0], [-1.25, 2.2], [0.3, 2.4], [0.35, 8.8], [1.0, 9.6]]));
  ok('?garden=0: start room -> yard still walks', w.every((l) => l?.ok), w.filter((l) => !l?.ok));
});

fs.writeFileSync(out, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(check && failed.length ? 1 : 0);
