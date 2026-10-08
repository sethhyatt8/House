// Swim checks through the real XR rig (IWER, emulated Quest 3): fall in, open-hand breaststrokes, gaze dive with the
// tank, neutral drift, push-down rise, right-stick rise, surface, swim to the shallows and stand, board the canoe
// from the water. Prints PASS/FAIL per check, exits 1 on any failure.
// node scripts/ground/swim.mjs <dist> <out.json> [query]    (dev-only deps: see boot.mjs)
import fs from 'fs'; import { boot } from './boot.mjs';
const [dist, out, query = ''] = process.argv.slice(2);
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
for (const f of ['probe.js', 'pagelib.js', 'swimlib.js']) await ev(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
const res = { query, steps: [], checks: [] };
const step = (name, v) => { res.steps.push({ name, ...v }); console.log(name, JSON.stringify(v).slice(0, 500)); };
const check = (name, ok, v) => { res.checks.push({ name, ok: !!ok, v }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(v)); };
const sw = () => ev(() => T.x(() => { const s = T.sw(); const h = s.head; return { head: h, feet: s.feet, depth: +(T.surf(h[0], h[2]) - h[1]).toFixed(2), aboveFloor: +(h[1] - T.floor(h[0], h[2])).toFixed(2), active: !!s.swim?.active, lastExit: s.swim?.lastExit, aboard: s.aboard, vel: s.swim?.vel }; }));
const look = (yaw, pitch = 0) => ev((a) => T.x(() => { T.yawTo(a.yaw); const q = __xr.quaternion; const n = Math.hypot(q.y, q.w); q.set(0, q.y / n, 0, q.w / n); if (a.pitch) { const c = Math.cos(a.pitch / 2), s = Math.sin(a.pitch / 2); q.set(q.w * s, q.y * c, -q.y * s, q.w * c); } }), { yaw, pitch });
const strokes = (opts, n = 1, glide = 3) => ev(async ({ opts, n, glide }) => {
  const p0 = T.headPose(); const fx = -Math.sin(p0.yaw); const fz = -Math.cos(p0.yaw);
  for (let k = 0; k < n; k++) await T.stroke(opts);
  T.idleHands(); await T.frames(Math.round(glide * 72));
  const d = T.headPose().p.sub(p0.p);
  return { fwd: +(d.x * fx + d.z * fz).toFixed(2), dy: +d.y.toFixed(2), active: !!__house.state().swim?.active };
}, { opts, n, glide });
await ev(() => T.x(() => { __house.chopDoor(); T.idleHands(); }));
await ev(() => T.settle(20));
// frame-to-frame watchdog: while swimming the rig must never snap (ground-follow fighting swim.js)
await ev(() => { T.jumps = 0; T.lastF = null; T.onFrame.push(() => { const s = __house.state(); const f = s.offset[1]; if (s.swim?.active && T.lastF != null && Math.abs(f - T.lastF) > 0.12) T.jumps++; T.lastF = s.swim?.active ? f : null; }); });

// A) fall into open water
await ev(() => T.x(() => __house.place(-14, -6.4, 8)));
const fell = await ev(() => T.waitFor(() => __house.state().swim?.active, 400));
await ev(() => T.settle(216));
let s = await sw(); step('A_fall_in', { fell, ...s });
check('A swim starts when you fall in', fell.ok && s.active, fell);
check('A floating at the surface (not on the seabed, no ground snap)', Math.abs(s.depth) < 0.35 && s.feet < -9, { depth: s.depth, feet: s.feet });
// B) open-hand breaststrokes (no buttons)
await look(Math.PI / 2);
let r = await strokes({ grip: false }, 1); step('B_one_open_hand_stroke', r);
check('B one good stroke moves you 0.8-1.2 m forward', r.fwd >= 0.8 && r.fwd <= 1.2, r);
r = await strokes({ grip: false }, 3); step('B_three_strokes', r);
check('B three strokes 2.4-3.6 m', r.fwd >= 2.4 && r.fwd <= 3.6, r);
r = await strokes({ grip: false, from: [0.22, -0.35, -0.4], to: [0.28, -0.38, -0.05], secs: 0.7 }, 1); step('B_small_slow_stroke', r);
check('B a small slow stroke still moves you (0.15-0.7 m)', r.fwd > 0.15 && r.fwd < 0.7, r);
r = await strokes({ grip: false, from: [0.25, -0.35, -0.5], to: [0.25, -0.35, -0.5], secs: 0.2, rec: 0.2 }, 1, 1); step('B_no_stroke', r);
// C) the dive kit: look 40 deg down and breaststroke -> you go down along your gaze
await ev(() => T.x(() => { const sc = __house.world.scuba; for (const id of ['mask', 'tank', 'fins']) { const e = sc.pieces[id].holder.matrixWorld.elements; sc.tryPickup([new __house.THREE.Vector3(e[12], e[13], e[14])]); } }));
await look(Math.PI / 2, -0.8);
const d0 = (await sw()).depth;
r = await strokes({ grip: false }, 5, 0.5); s = await sw(); step('C_gaze_dive', { ...r, ...s });
check('C look down + strokes dives (> 1.5 m deeper)', s.depth - d0 > 1.5, { d0, depth: s.depth });
// D) neutral drift, then push-down strokes rise
await look(Math.PI / 2);
let a = await sw(); await ev(() => T.settle(216)); let b = await sw();
const drift = +(b.head[1] - a.head[1]).toFixed(2); step('D_drift_3s', { drift, depth: b.depth, aboveFloor: b.aboveFloor });
check('D with the tank you hang near-neutral (drift up 0..0.5 m in 3 s), never parked on the sand', drift >= 0 && drift < 0.5 && b.aboveFloor > 0.6, { drift, aboveFloor: b.aboveFloor });
a = await sw();
r = await strokes({ grip: false, from: [0.3, -0.05, -0.3], to: [0.3, -0.75, -0.25], secs: 0.45, mid: [0.15, -0.5, -0.2], rec: 0.8 }, 2, 0.4); b = await sw();
const rise = +(b.head[1] - a.head[1]).toFixed(2); step('D_push_down_x2', { ...r, rise, depth: b.depth });
check('D pushing down raises you (> drift + 0.3 m)', rise > Math.max(0, drift) * (2.4 / 3) + 0.3 || b.depth < 0.15, { rise, depth: b.depth });
// E) right stick up rises; surface
await ev(() => T.stick('right', 0, -1)); const surf = await ev(() => T.waitFor(() => { const h = __house.state().head; return T.surf(h[0], h[2]) - h[1] < 0.05; }, 72 * 12)); await ev(() => T.stick('right', 0, 0)); await ev(() => T.settle(72));
s = await sw(); step('E_right_stick_surface', { surf, ...s });
check('E right stick up brings you to the surface', surf.ok && s.depth < 0.3 && s.active, { surf, depth: s.depth });
// F) stick-swim to the shallows (+X) and stand up there
await look(-Math.PI / 2);
await ev(() => T.x(() => { const c = __house.world.cave; T.shoreZ = c.z; }));
await ev(() => T.x(() => { const h = __house.state().head; __house.world.swim; }));
await ev(() => T.stick('left', 0, -1));
r = await ev(() => T.waitFor(() => { const h = __house.state().head; T.yawTo(Math.atan2(-(-3.2 - h[0]), -(T.shoreZ - h[2]))); return !__house.state().swim?.active; }, 72 * 40));
await ev(() => T.stick('left', 0, 0)); await ev(() => T.settle(40));
s = await sw(); step('F_swim_to_shallows', { r, ...s });
check('F swim to the shallows and stand up', r.ok && s.lastExit === 'shore' && Math.abs(s.feet - (-8.6)) < 0.05, { lastExit: s.lastExit, feet: s.feet });
// G) back out (walk off the shallows edge), then climb into the canoe from the water
await look(Math.PI / 2); await ev(() => T.stick('left', 0, -1));
r = await ev(() => T.waitFor(() => __house.state().swim?.active, 72 * 15)); await ev(() => T.settle(60)); await ev(() => T.stick('left', 0, 0)); await ev(() => T.settle(60));
check('G walking off the shallows edge starts swimming', r.ok, r);
await ev(() => T.x(() => { const c = __house.world.canoe; const h = __house.state().head; c.group.position.x = h[0] - 1.1; c.group.position.z = h[2]; c.group.rotation.y = 0; c.group.updateMatrixWorld(true); }));
await ev(() => T.settle(30));
await ev(() => T.x(() => { const c = __house.world.canoe; const e = c.group.matrixWorld.elements; T.hand('right', [e[12] + 0.35, e[13] + 0.25, e[14]]); }));
await ev(() => T.settle(5)); await ev(() => T.btn('right', 'squeeze', 1)); await ev(() => T.settle(20)); await ev(() => T.btn('right', 'squeeze', 0)); await ev(() => T.settle(40));
s = await sw(); step('G_board_canoe_from_water', s);
check('G squeeze a hand on the floating hull climbs you in', s.aboard && !s.active, { aboard: s.aboard, lastExit: s.lastExit });
const jumps = await ev(() => T.jumps);
check('no ground snaps while swimming', jumps === 0, { jumps });
res.logs = logs;
fs.writeFileSync(out, JSON.stringify(res, null, 1));
const bad = res.checks.filter((c) => !c.ok).length;
console.log(bad ? `${bad} FAILED` : 'ALL PASS');
await close(); process.exit(bad ? 1 : 0);
