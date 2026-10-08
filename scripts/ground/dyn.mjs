// Dynamic ground checks through the real XR rig (IWER): walks, teleports, lift rides, respawn, posture.
// node dyn.mjs <dist> <out.json> [query] [headH]
import fs from 'fs'; import { boot } from './boot.mjs';
const [dist, out, query = '', headH = '1.6'] = process.argv.slice(2);
const { ev, logs, close } = await boot(dist, query, { headH: +headH });
await ev(fs.readFileSync(new URL('./probe.js', import.meta.url), 'utf8'));
await ev(() => GT.init());
await ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
const res = { query, headH: +headH, steps: [] };
const step = (name, v) => { res.steps.push({ name, ...v }); console.log(name, JSON.stringify(v).slice(0, 300)); };
const section = async (tag, fn) => {
  await ev((t) => { T.tag = t; T.recOn = true; }, tag);
  try { const v = await fn(); step(tag, v || {}); } catch (e) { step(tag, { error: String(e).slice(0, 300) }); }
  await ev(() => { T.recOn = false; });
};
const fps = await ev(async () => { const n0 = T.nFrame; await new Promise((r) => setTimeout(r, 3000)); return (T.nFrame - n0) / 3; });
step('fps', { fps });
await ev(() => T.x(() => __house.chopDoor()));
// 1) cell -> room -> cliff edge -> yard -> onto a crate and off again
await section('cell-room-yard', () => ev(async () => {
  return { legs: await T.go([[3.9, 0.14], [2.2, 0.12], [0.9, 0.85], [-1.25, 0.0], [-1.25, 2.2], [0.3, 2.4], [0.35, 8.8], [2.7, 9.2], [1.0, 9.6], [-1.2, 6.0], [3.0, 3.3]]) };
}));
// 2) every teleport spot (A cycling order and direct), the respawn
await section('teleports', () => ev(async () => {
  const outs = [];
  const spots = __house.spots();
  for (let i = 0; i < spots.length; i++) {
    await T.x(() => __house.teleportTo(i)); await T.settle(20);
    const s = await T.st();
    outs.push({ i, status: spots[i].status, feet: +s.offset[1].toFixed(3), want: spots[i].seat ? 'seat' : spots[i].floor, aboard: s.aboard, eye: +(s.head[1] - s.offset[1]).toFixed(3) });
    await T.x(() => __house.leaveCanoe());
  }
  await T.x(() => __house.playerDown()); await T.settle(20);
  const s = await T.st(); outs.push({ respawn: true, feet: +s.offset[1].toFixed(3), head: s.head.map((v) => +v.toFixed(2)) });
  return { outs };
}));
// 3) roof loop
await section('roof', () => ev(async () => {
  await T.x(() => __house.teleportTo(2)); await T.settle(10);
  const r = __house.roof;
  return { legs: await T.go([[r.x0 + 0.4, r.z0 + 0.5], [r.x1 - 0.4, r.z0 + 0.5], [r.x1 - 0.4, r.z1 - 0.5], [r.x0 + 0.4, r.z1 - 0.5], [r.x, r.z]]) };
}));
// 4) cave: down the ramp into the shallows and back, then the tunnel to the paint room
await section('cave-shallows', () => ev(async () => {
  const cave = __house.world.cave; const spots = __house.spots();
  await T.x(() => __house.teleportTo(spots.findIndex((s) => /Cave floor/.test(s.status)))); await T.settle(10);
  const z = cave.z + 1.6;
  return T.walk([[cave.x0 + 0.3, z], [-2.0, z], [-2.6, z], [-3.6, z], [-2.6, z], [-1.9, z], [cave.x0 + 0.5, z]], { frames: 2000 });
}));
await section('tunnel-paintroom', () => ev(async () => {
  const cave = __house.world.cave; const t = cave.tunnel; const r = cave.room;
  const tz = (t.z0 + t.z1) / 2;
  await T.x(() => __house.place(cave.x1 - 0.5, cave.floor, tz)); await T.settle(10);
  return { legs: await T.go([[t.x0 + 0.2, tz], [t.x1 - 0.2, tz], [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2], [r.x1 - 0.5, r.z0 + 0.5], [r.x0 + 0.5, r.z1 - 0.5]]) };
}));
// 5) lift: ride every stop and walk out into the rooms
await section('lift', () => ev(async () => {
  const L = __house.world.lift; const cb = L.carBox; const cx = (cb.x0 + cb.x1) / 2; const cz = (cb.z0 + cb.z1) / 2;
  const outs = [];
  await T.x(() => __house.place(cx, 0, cz)); await T.settle(10);
  for (let k = 1; k < L.stops.length; k++) {
    if (L.doorOpen > 0.5) { L.phase = 'idle'; }
    await T.x(() => L.go(true));
    const t0 = performance.now();
    await T.frames(3); while ((L.phase !== 'idle' || L.moving) && performance.now() - t0 < 120000) await T.frames(3);
    await T.settle(10);
    const s = await T.st();
    outs.push({ stop: L.stops[k], floorY: +L.floorY.toFixed(3), feet: +s.offset[1].toFixed(3), phase: L.phase });
    const rooms = L.floors.filter((f) => Math.abs(f.y - L.floorY) < 0.05);
    const far = rooms.sort((a, b) => b.x1 - a.x1)[0];
    if (far) {
      const w = await T.go([[(far.x0 + far.x1) / 2, (far.z0 + far.z1) / 2], [cx, cz]]);
      outs.push({ walk: w, feet: +(await T.st()).offset[1].toFixed(3) });
    }
  }
  return { outs };
}));
// 6) crag top / green / notch shelf
await section('crag-green', () => ev(async () => {
  const top = __house.world.crag?.ladder?.userData?.topSpot; const g = __house.world.golf?.green;
  await T.x(() => __house.place(top.x, top.y, top.z)); await T.settle(10);
  return { legs: await T.go([[top.x, top.z + 1.2], [g ? (g.x0 + g.x1) / 2 : top.x, g ? (g.z0 + g.z1) / 2 : top.z], [top.x - 2.5, 0]]) };
}));
await section('notch-shelf', () => ev(async () => {
  const sh = __house.world.notches.shelf; const st = __house.world.notches.step;
  await T.x(() => __house.place((sh.x0 + sh.x1) / 2, sh.floor, (sh.z0 + sh.z1) / 2)); await T.settle(10);
  const pts = [[sh.x0 + 0.2, sh.z0 + 0.2], [sh.x1 - 0.2, sh.z1 - 0.2]];
  if (st) pts.push([(st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2], [__house.world.cave.x0 + 0.6, (st.z0 + st.z1) / 2]);
  return { legs: await T.go(pts) };
}));
res.rows = await ev(() => T.rows);
res.logs = logs;
fs.writeFileSync(out, JSON.stringify(res));
await close(); process.exit(0);
