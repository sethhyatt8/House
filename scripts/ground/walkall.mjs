// One continuous walk-and-climb journey with teleport off (?teleport=0): every room and every transition, no
// place()/teleport after the session start. Records every frame (feet vs the visible floor), deaths, stuck legs.
// node scripts/ground/walkall.mjs <dist> <out.json> [query] [--check]   (fall pass; needs HOUSE_NODE_MODULES)
import fs from 'fs'; import { boot } from './boot.mjs';
const args = process.argv.slice(2); const check = args.includes('--check');
const [dist, out, query = 'teleport=0'] = args.filter((a) => a !== '--check');
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
await ev(fs.readFileSync(new URL('./probe.js', import.meta.url), 'utf8'));
await ev(() => GT.init());
await ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
await ev(fs.readFileSync(new URL('./climbbot.js', import.meta.url), 'utf8'));
// denser waypoints (every 0.2 m) and a re-plan from where it stopped (up to 4 tries per target)
await ev(() => {
  T.go = async (targets, opts = {}) => {
    const results = [];
    for (const tgt of targets) {
      let r = null;
      for (let tries = 0; tries < 4; tries++) {
        const s = await T.st();
        const path = await T.x(() => T.plan([s.head[0], s.head[2]], tgt, s.offset[1]));
        if (!path) { r = { to: tgt, ok: false, why: 'no path', from: s.head }; break; }
        // T.plan keeps every 4th cell; densify by halving
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
const legs = [];
const leg = async (name, fn) => {
  await ev((t) => { T.tag = t; T.recOn = true; }, name);
  let v; try { v = await ev(fn); } catch (e) { v = { error: String(e).slice(0, 300) }; }
  await ev(() => { T.recOn = false; });
  const s = await ev(() => { const s = __house.state(); return { feet: +s.offset[1].toFixed(3), head: s.head.map((x) => +x.toFixed(2)), deaths: __house.fallDeath?.()?.stats?.deaths ?? 0, cp: __house.fallDeath?.()?.cp }; });
  const okWalk = !v || v.error ? false : Array.isArray(v.legs) ? v.legs.every((l) => l.ok) : v.ok !== false;
  legs.push({ name, ok: okWalk, ...s, v });
  console.log(okWalk ? 'ok  ' : 'FAIL', name, JSON.stringify({ ...s, v }).slice(0, 400));
};
await ev(() => T.x(() => __house.chopDoor()));
await leg('start room -> cliff room -> cliff edge', async () => ({ legs: await T.go([[3.9, 0.14], [2.2, 0.12], [0.9, 0.85], [-1.25, 0.0], [-1.25, -2.2], [2.2, -2.1]]) }));
await leg('cliff room -> yard -> crates', async () => ({ legs: await T.go([[0.9, 0.85], [-1.25, 0.0], [-1.25, 2.2], [0.3, 2.4], [0.35, 8.8], [2.7, 9.2], [1.0, 9.6], [-1.2, 6.0], [3.0, 3.3]]) }));
await leg('lift: every stop and out into its rooms, back up', async () => {
  const L = __house.world.lift; const cb = L.carBox; const cx = (cb.x0 + cb.x1) / 2; const cz = (cb.z0 + cb.z1) / 2;
  const outs = [];
  if (L.openDoor) await T.x(() => L.openDoor());
  await T.frames(60);
  for (const w of await T.go([[3.0, 4.6], [3.4, 5.82], [cx, cz]])) outs.push(w);
  for (let k = 1; k <= L.stops.length; k++) {
    await T.x(() => L.go(true));
    const t0 = performance.now(); await T.frames(3);
    while ((L.phase !== 'idle' || L.moving) && performance.now() - t0 < 120000) await T.frames(3);
    await T.frames(10);
    const rooms = L.floors.filter((f) => Math.abs(f.y - L.floorY) < 0.05);
    const far = rooms.sort((a, b) => b.x1 - a.x1)[0];
    if (far) { const w = await T.go([[(far.x0 + far.x1) / 2, (far.z0 + far.z1) / 2], [cx, cz]]); outs.push({ stop: +L.floorY.toFixed(2), legs: w }); }
    if (Math.abs(L.floorY) < 0.05 && k > 1) break;
  }
  // ride back to the top if needed
  for (let n = 0; n < 6 && Math.abs(L.floorY) > 0.05; n++) { await T.x(() => L.go(true)); const t0 = performance.now(); await T.frames(3); while ((L.phase !== 'idle' || L.moving) && performance.now() - t0 < 120000) await T.frames(3); }
  await T.frames(20);
  if (L.openDoor) await T.x(() => L.openDoor()); await T.frames(60);
  const back = await T.go([[3.4, 5.82], [3.0, 4.6], [3.0, 3.3]]);
  return { legs: [...outs.flatMap((o) => o.legs || [o]), ...back], floorY: L.floorY };
});
await leg('yard -> head of the sea wall, step off the edge (notch slide to the shelf)', async () => {
  const w = await T.go([[0.35, 8.0], [-1.25, 8.5]]);
  // physically step out over the edge (head 0.7 m west) and wait for the slide
  for (let k = 1; k <= 14; k++) { await T.x(() => { const s = __house.state(); const l = T.toLocal([s.head[0] - 0.05, s.head[1], s.head[2]]); __xr.position.set(l[0], l[1], l[2]); }); await T.frames(1); }
  await T.frames(300);
  const s = await T.st();
  return { legs: w, ok: Math.abs(s.offset[1] - -7.92) < 0.05, feet: s.offset[1] };
});
await leg('shelf -> cave mouth -> cave floor -> tunnel -> paint room -> back', async () => {
  const cave = __house.world.cave; const t = cave.tunnel; const r = cave.room; const sh = __house.world.notches.shelf; const st = __house.world.notches.step;
  const tz = (t.z0 + t.z1) / 2;
  return { legs: await T.go([[(sh.x0 + sh.x1) / 2, sh.z0 + 0.3], [(st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2], [cave.x0 + 0.6, (st.z0 + st.z1) / 2], [cave.x0 + 1.0, cave.z], [t.x0 + 0.2, tz], [t.x1 - 0.2, tz], [(r.x0 + r.x1) / 2 - 0.9, (r.z0 + r.z1) / 2], [t.x0 + 0.2, tz], [cave.x0 + 0.6, cave.z + 1.6]]) };
});
await leg('cave floor -> shallows and back', async () => {
  const cave = __house.world.cave; const z = cave.z + 1.6;
  return T.walk([[cave.x0 + 0.3, z], [-2.0, z], [-2.6, z], [-2.0, z], [cave.x0 + 0.5, z]], { frames: 2000 });
});
await leg('back to the shelf, climb the sea wall, mantle onto the yard', async () => {
  const sh = __house.world.notches.shelf; const st = __house.world.notches.step; const cave = __house.world.cave;
  const w = await T.go([[cave.x0 + 0.6, (st.z0 + st.z1) / 2], [(st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2], [-1.98, 2.95]]);
  let L; __house.world.scene.traverse((o) => { if (o.userData?.rungs && o.userData.path && !o.userData.crag) L = o; });
  await T.x(() => T.yawTo(-Math.PI / 2));
  const r = await T.climbBot(L, {});
  const s = await T.st();
  return { legs: w, ok: !s.climb && Math.abs(s.offset[1]) < 0.01 && r.moved > 1 && Math.abs(r.turned) > 0.4, climb: { result: r.result, grabs: r.grabs, after: r.after, moved: r.moved, turned: r.turned } };
});
await leg('yard -> cliff room -> roof ladder -> roof', async () => {
  const w = await T.go([[0.3, 2.4], [-0.1, -0.65]]);
  let L; __house.world.scene.traverse((o) => { if (o.userData?.rungs && !o.userData.shaft && o.userData.roofY < 4 && !L) L = o; });
  await T.x(() => T.yawTo(-Math.PI / 2));
  const r = await T.climbBot(L, {});
  const s = await T.st();
  return { legs: w, ok: !s.climb && Math.abs(s.offset[1] - __house.roof.y) < 0.01 && r.moved > 1, climb: { result: r.result, grabs: r.grabs, after: r.after, moved: r.moved, turned: r.turned } };
});
await leg('roof loop -> crag foot -> climb the crag -> overlook', async () => {
  const rf = __house.roof; const L = __house.world.crag.ladder;
  const w = await T.go([[rf.x0 + 0.4, rf.z1 - 0.5], [rf.x1 - 0.4, rf.z1 - 0.5], [rf.x1 - 0.4, rf.z0 + 0.5], [L.position.x - 0.42, L.userData.zAt(rf.y + 1.2)]]);
  await T.x(() => T.yawTo(-Math.PI / 2));
  const r = await T.climbBot(L, {});
  const s = await T.st();
  return { legs: w, ok: !s.climb && s.offset[1] > 33 && r.moved > 1, climb: { result: r.result, grabs: r.grabs, after: r.after, moved: r.moved, turned: r.turned } };
});
await leg('overlook -> the green -> back', async () => {
  const g = __house.world.golf?.green; const top = __house.world.crag.ladder.userData.topSpot;
  return { legs: await T.go([[top.x, top.z + 1.2], [g ? (g.x0 + g.x1) / 2 : top.x, g ? (g.z0 + g.z1) / 2 : top.z], [top.x, top.z + 1.2]]) };
});
const rows = await ev(() => T.rows);
const fd = await ev(() => __house.fallDeath?.() ?? null);
// every frame on the ground: feet within 5 cm of the visible floor (the ground-truth ray)
const bad = rows.filter((r) => !r[8] && !r[9] && r[6] != null && Math.abs(r[4] - r[6]) > 0.05 && Math.abs(r[10]) < 0.01 && !r[11]);
const res = { query, legs, deaths: fd?.stats?.deaths ?? 0, lastDeath: fd?.stats?.last ?? null, frames: rows.length, offFloor: bad.length, offFloorByLeg: bad.reduce((a, r) => ((a[r[0]] = (a[r[0]] || 0) + 1), a), {}), sampleOff: bad.slice(0, 12), logs: logs.filter((l) => /pageerror/.test(l)) };
fs.writeFileSync(out, JSON.stringify({ ...res, rows }));
console.log(JSON.stringify({ deaths: res.deaths, lastDeath: res.lastDeath, frames: res.frames, offFloor: res.offFloor, offFloorByLeg: res.offFloorByLeg, sampleOff: res.sampleOff.slice(0, 5), pageerrors: res.logs }));
const failed = legs.filter((l) => !l.ok).length + (res.deaths ? 1 : 0) + res.logs.length;
console.log(failed ? `FAIL ${failed}` : 'ALL OK');
await close(); process.exit(check && failed ? 1 : 0);
