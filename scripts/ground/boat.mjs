// Boat checks through the real XR rig (IWER): board from the cave floor / the shallows / the seat spot, posture
// (sit down for real after boarding), take both oars, push-row, exit on each side, re-board, pick the torch up after.
// node boat.mjs <dist> <out.json> [query]
import fs from 'fs'; import { boot } from './boot.mjs';
const [dist, out, query = ''] = process.argv.slice(2);
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
for (const f of ['probe.js', 'pagelib.js']) await ev(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
await ev(() => GT.init());
const res = { query, steps: [] };
const step = (name, v) => { res.steps.push({ name, ...v }); console.log(name, JSON.stringify(v).slice(0, 400)); };
const S = () => ev(async () => {
  const s = await T.st(); const c = __house.world.canoe; const yaw = c.group.rotation.y;
  return { aboard: s.aboard, feet: +s.offset[1].toFixed(3), head: s.head.map((v) => +v.toFixed(3)), seat: s.seat.map((v) => +v.toFixed(3)), eyeOverSeat: +(s.head[1] - s.seat[1]).toFixed(3), realH: +(s.head[1] - s.offset[1]).toFixed(3), boatYawDeg: +(yaw * 180 / Math.PI).toFixed(1), bow: [-Math.sin(yaw), -Math.cos(yaw)].map((v) => +v.toFixed(2)), torch: s.torch, oars: __house.world.canoe.longOars?.map((o) => !!o.hand), status: s.status.slice(0, 80) };
});
const floorCheck = () => ev(async () => { const s = await T.st(); const gt = GT.floor(s.head[0], s.head[2], s.offset[1] + 0.6, s.offset[1] - 3); return { feet: +s.offset[1].toFixed(3), visible: gt == null ? null : +gt.toFixed(3), off: gt == null ? null : +(s.offset[1] - gt).toFixed(3), model: +__house.groundModel.groundUnder(s.head[0], s.head[2], s.offset[1]).toFixed(3) }; });
await ev(() => { T.tag = 'boat'; T.recOn = true; });
const cave = await ev(() => { const c = __house.world.cave; return { x0: c.x0, x1: c.x1, z: c.z, floor: c.floor, z0: c.z0, z1: c.z1 }; });
const REST = await ev(() => { const c = __house.world.canoe; return [c.group.position.x, c.group.position.z, c.group.rotation.y]; });
// A) walk from the cave floor into the canoe
let s = await S();
await ev((c) => T.x(() => __house.place(c.x0 + 0.6, c.floor, __house.world.canoe.seatPoint.z)), cave); await ev(() => T.settle(10));
const walkIn = await ev(() => T.walk([[__house.world.canoe.seatPoint.x, __house.world.canoe.seatPoint.z]], { frames: 600 }));
await ev(() => T.settle(30));
step('A_walk_in', { walkIn, ...(await S()) });
// B) posture: sit down for real (headset 1.6 -> 1.15), wait, then stand up again
await ev(() => { __xr.position.y = 1.15; }); await ev(() => T.settle(240));
step('B_sit_down_irl', await S());
await ev(() => { __xr.position.y = 1.6; }); await ev(() => T.settle(240));
step('B_stand_up_irl', await S());
await ev(() => { __xr.position.y = 1.15; }); await ev(() => T.settle(240));
// C) take both oars at the handle ends (hand targets frozen at the grab point, not chasing the oar)
await ev(() => {
  const c = __house.world.canoe; T.L = c.longOars.find((o) => o.side < 0); T.R = c.longOars.find((o) => o.side > 0);
  const w = (o) => { const v = o.end.clone(); c.group.localToWorld(v); return [v.x, v.y, v.z]; };
  const pr = w(T.R); const pl = w(T.L); T.hy = { R: T.R.end.y, L: T.L.end.y };
  T.follow = { right: () => pr, left: () => pl };
});
await ev(() => T.settle(10));
await ev(() => { T.btn('left', 'squeeze', 1); T.btn('right', 'squeeze', 1); }); await ev(() => T.settle(20));
step('C_take_oars', await S());
// D) strokes: hands on the arc the handle can reach (ring + inboard at bearing th; th + = hands toward the stern).
// push: blades in while the hands go forward (aft -> fore), out on the way back; pull: the reverse.
// side: 'both' | 'R' | 'L' | 'none' (recovery-only: blades out both ways)
const stroke = (dir, n, side = 'both', secs = 0.7) => ev(async ({ dir, n, side, secs }) => {
  const c = __house.world.canoe; const TH = __house.THREE;
  const at = (o, key, th, out) => { const v = new TH.Vector3(o.P.x - o.side * 0.5 * Math.cos(th), T.hy[key] - (out ? 0.2 : 0), o.P.z + 0.5 * Math.sin(th)); c.group.localToWorld(v); return [v.x, v.y, v.z]; };
  const AFT = 0.35; const FORE = -0.8; const N = Math.round(secs * 60);
  const set = (th, inR, inL) => { T.follow = { right: ((p) => () => p)(at(T.R, 'R', th, !inR)), left: ((p) => () => p)(at(T.L, 'L', th, !inL)) }; };
  for (let i = 0; i < 600; i++) { const sm = c.debug().sim; if (Math.hypot(sm.vx, sm.vz) < 0.03 && Math.abs(sm.yawRate) < 0.02) break; await T.frames(1); } // glide out the last test
  const p0 = c.group.position.clone(); const yaw0 = c.group.rotation.y; let wetMax = 0; let forceSum = 0; let peak = 0;
  const spd = () => { const sm = c.debug().sim; const v = -Math.sin(yaw0) * sm.vx - Math.cos(yaw0) * sm.vz; if (Math.abs(v) > Math.abs(peak)) peak = v; };
  const drive = dir > 0 ? [AFT, FORE] : [FORE, AFT];
  const inR = side === 'both' || side === 'R'; const inL = side === 'both' || side === 'L';
  // get to the start of the drive with the blades out
  for (let i = 0; i <= 20; i++) { set(drive[0], false, false); await T.frames(1); }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i <= 6; i++) { set(drive[0], inR, inL); await T.frames(1); }
    for (let i = 0; i <= N; i++) { const u = i / N; set(drive[0] + (drive[1] - drive[0]) * u, inR, inL); await T.frames(1); spd(); const d = c.debug(); forceSum += d.oars.reduce((a, o) => a + o.force, 0); }
    for (let i = 0; i <= 6; i++) { set(drive[1], false, false); await T.frames(1); }
    for (let i = 0; i <= N; i++) { const u = i / N; set(drive[1] + (drive[0] - drive[1]) * u, false, false); await T.frames(1); spd(); const d = c.debug(); wetMax = Math.max(wetMax, ...d.oars.map((o) => o.wet)); }
  }
  await T.frames(30);
  const d = c.group.position.clone().sub(p0); const fx = -Math.sin(yaw0); const fz = -Math.cos(yaw0);
  const dbg = c.debug();
  return { alongBow: +(d.x * fx + d.z * fz).toFixed(2), peakSpeed: +peak.toFixed(2), turnDeg: +((c.group.rotation.y - yaw0) * 180 / Math.PI).toFixed(1), meanDriveForceN: +(forceSum / (n * (N + 1))).toFixed(1), recoveryWetMax: +wetMax.toFixed(2), grounded: +dbg.sim.groundedFrac.toFixed(2), floating: dbg.floating };
}, { dir, n, side, secs });
step('D0_push_from_rest_spot', await stroke(1, 3));
// get out to open water for the clean stroke tests (tow the boat 2 m off the shelf, as if shoved off)
await ev(() => T.x(() => { const c = __house.world.canoe; const dx = -Math.sin(c.group.rotation.y) * 2.2; const dz = -Math.cos(c.group.rotation.y) * 2.2; c.group.position.x += dx; c.group.position.z += dz; }));
await ev(() => T.settle(30));
const st0 = await S();
step('D1_push_row', { ...(await stroke(1, 3)), eyeOverSeat: (await S()).eyeOverSeat, before: st0.eyeOverSeat });
step('D2_pull_row', await stroke(-1, 3));
step('D3_recovery_only', await stroke(1, 3, 'none'));
step('D4_starboard_only_push', await stroke(1, 3, 'R'));
step('D5_port_only_push', await stroke(1, 3, 'L'));
step('D6_hard_push', await stroke(1, 2, 'both', 0.5));
step('D7_soft_push', await stroke(1, 2, 'both', 1.0));
// E) let go; exits: try every side with the stick (starboard, port, bow, stern relative to the boat)
await ev(() => { T.btn('left', 'squeeze', 0); T.btn('right', 'squeeze', 0); T.follow = null; }); await ev(() => T.settle(20));
step('E_released', await S());
const exitTo = async (name, ang) => { // ang: 0 = bow, PI/2 = port (left of a bow-facing rower), -PI/2 = starboard, PI = stern
  const r = await ev(async (ang) => {
    const c = __house.world.canoe; const yaw = c.group.rotation.y + ang; T.yawTo(yaw); await T.frames(3);
    T.stick('left', 0, -1); await T.frames(40); T.stick('left', 0, 0); await T.frames(20);
    return null;
  }, ang);
  const st = await S(); const fc = await floorCheck();
  step('E_exit_' + name, { exited: !st.aboard, ...fc, status: st.status, realH: st.realH });
  return !st.aboard;
};
const reboard = async (label) => {
  await ev(() => T.settle(80)); // exit cooldown (1 s)
  const w = await ev(() => T.walk([[__house.world.canoe.seatPoint.x, __house.world.canoe.seatPoint.z]], { frames: 500 }));
  await ev(() => T.settle(30));
  const st = await S(); step('F_reboard_' + label, { walk: w, aboard: st.aboard, eyeOverSeat: st.eyeOverSeat });
  return st.aboard;
};
await exitTo('open_water_port', Math.PI / 2);
{ const st = await S(); if (!st.aboard) { step('E_open_water_exit_left_boat', {}); await ev(() => T.x(() => __house.boardCanoe())); } }
// back to the shelf (where it rests) for the side exits
await ev((R) => T.x(() => { const c = __house.world.canoe; const sim = c.debug().sim; c.group.position.x = R[0]; c.group.position.z = R[1]; }), REST);
await ev(() => T.settle(60));
step('E_back_at_rest', await S());
for (const [name, ang] of [['starboard', -Math.PI / 2], ['port', Math.PI / 2], ['stern', Math.PI], ['bow', 0]]) {
  const ok = await exitTo(name, ang);
  if (ok) await reboard(name); else step('E_exit_' + name + '_blocked', {});
}
// G) physically step over the side (headset moves 0.9 m sideways)
{
  const st = await S();
  if (st.aboard) {
    await ev(() => { __xr.position.x += 0.9; }); await ev(() => T.settle(30));
    step('G_step_over_side', { ...(await S()), ...(await floorCheck()) });
    await ev(() => { __xr.position.x -= 0.9; }); await ev(() => T.settle(10));
  }
}
// H) items after leaving: walk to the torch and pick it up
{
  if ((await S()).aboard) await exitTo('stern_for_torch', Math.PI);
  await ev(() => T.settle(90));
  const torch = await ev(() => { let t = null; __house.world.scene.traverse((o) => { if (o.userData?.gear === 'torch') t = o; }); if (!t) return null; const v = (t.userData.grip || t).getWorldPosition(new __house.THREE.Vector3()); return [v.x, v.y, v.z]; });
  if (torch) {
    const w = await ev((t) => T.go([[t[0] - 0.45, t[2]]]), torch);
    await ev((t) => { T.follow = { right: () => [t[0], t[1], t[2]] }; }, torch); await ev(() => T.settle(10));
    await ev(() => T.btn('right', 'squeeze', 1)); await ev(() => T.settle(10)); await ev(() => T.btn('right', 'squeeze', 0)); await ev(() => T.settle(10));
    await ev(() => { T.follow = null; });
    const st = await S(); step('H_torch', { walk: w, torch: st.torch, aboard: st.aboard, ...(await floorCheck()) });
  } else step('H_torch', { error: 'no torch target' });
}
// I) seat teleport spot, respawn from the boat
{
  await ev(() => T.x(() => __house.chopDoor())); // teleports are off while the cell door stands
  const idx = await ev(() => __house.spots().findIndex((s) => s.seat));
  await ev((i) => T.x(() => __house.teleportTo(i)), idx); await ev(() => T.settle(30));
  step('I_seat_spot', await S());
  await ev(() => T.x(() => __house.playerDown())); await ev(() => T.settle(30));
  step('I_respawn_from_boat', { ...(await S()), ...(await floorCheck()) });
}
await ev(() => { T.recOn = false; });
res.rows = await ev(() => T.rows);
res.logs = logs;
fs.writeFileSync(out, JSON.stringify(res));
await close(); process.exit(0);
