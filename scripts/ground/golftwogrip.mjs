// Two-grip pass: both hands on the driver through the real rig (IWER Quest 3, 1/72 s frames).
// node scripts/ground/golftwogrip.mjs <dist> <out.json> [query] [--check] [--quick]
//  1. both grip orders: the first hand alone sits at ITS grip (left = top, right = 9 cm lower; mirrored with
//     ?golfhand=left), the empty grip shows its ghost, the second hand lands on the other grip
//  2. address with both hands: face square, lie, sole on the ground after the length fit
//  3. +-20 deg random wrist roll on either controller (plus 0.2 mm position noise): face moves < 1 deg, head < 2 mm
//  4. hands 4 / 8 / 12 cm apart: still two-handed, face square, shaft along the hands
//  5. two-handed swings at 20 / 35 / 50 m/s (two phases each): every one connects, smash ~1.4, start line < 1 deg
// With ?golf=onehand only step 1 runs and the second hand must be ignored.
import fs from 'fs'; import { boot } from './boot.mjs';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CHECK = process.argv.includes('--check');
const QUICK = process.argv.includes('--quick');
const [dist, outPath = 'golftwogrip-out.json', query = ''] = args;
const LEFT = /golfhand=left/.test(query);
const ONEHAND = /golf=onehand/.test(query);
// which hand grabs first: --first=top | --first=lower (default lower: the right hand of a right-handed golfer)
const FIRSTROLE = (process.argv.find((a) => a.startsWith('--first=')) || '--first=lower').slice(8);
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
for (const f of ['pagelib.js', 'golflib.js']) await ev(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
const out = { query, steps: {}, checks: [] };
const step = (k, v) => { out.steps[k] = v; console.log(k, JSON.stringify(v).slice(0, 500)); };
const check = (name, ok, v) => { out.checks.push({ name, ok: !!ok, v }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(v)); };
const X = (fn, a) => ev((src, a) => T.x(() => (0, eval)(src)(a)), fn.toString(), a);
const frames = (n) => ev((n) => T.frames(n), n);
const R = 0.02135;
const TOP = LEFT ? 'right' : 'left'; const LOW = LEFT ? 'left' : 'right';
const zs = LEFT ? -1 : 1;
await frames(20);
const deck = await X(() => __house.world.golf.green.y);
const tee = await X(() => __house.world.golf.debug().tee);
const standZ = Math.max(-0.58, Math.min(0.58, tee.z + zs * 0.92));
await X((a) => __house.place(a.x, a.y, a.z), { x: tee.x + 0.05, y: deck, z: standZ });
await frames(20);

// in-page helpers: grip poses for both hands at address (top fist at P, lower fist `gap` down the hold's shaft line)
await X(() => {
  const TH = __house.THREE;
  G.fist = (side) => { const g = G.ctrl(side).userData.grip; g.updateWorldMatrix(true, false); const p = new TH.Vector3(); const q = new TH.Quaternion(); g.matrixWorld.decompose(p, q, new TH.Vector3()); return { p, q }; };
  // the one-hand hold's shaft direction (toward the head) for a fist orientation: grip (0,-sin30,-cos30)
  G.shaftOf = (q) => new TH.Vector3(0, -0.5, -Math.sqrt(3) / 2).applyQuaternion(q).normalize();
  G.gripW = (i) => { const d = G.golf().debug(); const c = G.club(); c.updateWorldMatrix(true, false); return new TH.Vector3(0, d.grips[i], 0).applyMatrix4(c.matrixWorld); };
  G.pair = (P, qT, qL, gap, top, low) => { G.setGrip(top, P, qT); G.setGrip(low, P.clone().addScaledVector(G.shaftOf(qT), gap), qL); };
  return true;
});
const qTop = await X((a) => G.anatomy(a.s, 17, a.l), { s: TOP, l: LEFT });
const qLow = await X((a) => G.anatomy(a.s, 17, a.l), { s: LOW, l: LEFT });

// --- 1. grip orders --------------------------------------------------------------------------------------------
// address spot for the top fist: put the face behind the ball (iterate on the top fist position)
const P0 = [tee.x + 0.3, deck + 0.86, tee.z + zs * 0.62];
const orders = [];
{
  const first = FIRSTROLE === 'top' ? TOP : LOW;
  const second = first === TOP ? LOW : TOP;
  const clubAt = await X(() => G.club().getWorldPosition(new __house.THREE.Vector3()).toArray());
  await X((a) => T.hand(a.s, [a.p[0], a.p[1] + 0.03, a.p[2]]), { s: first, p: clubAt }); await frames(4);
  await ev((s) => T.btn(s, 'squeeze', 1), first); await frames(6);
  // the first hand alone, in its address pose: it must sit on its own grip point
  const oneR = await X((a) => {
    const TH = __house.THREE; const P = new TH.Vector3(...a.P0);
    const q = a.first === a.TOP ? a.qTop : a.qLow; const qq = new TH.Quaternion(q._x, q._y, q._z, q._w);
    const pos = a.first === a.TOP ? P : P.clone().addScaledVector(G.shaftOf(new TH.Quaternion(a.qTop._x, a.qTop._y, a.qTop._z, a.qTop._w)), 0.09);
    G.setGrip(a.first, pos, qq);
    // the other hand far away
    G.setGrip(a.second, P.clone().add(new TH.Vector3(0, -0.3, a.zs * 0.4)), qq);
    return true;
  }, { P0, first, second, TOP, qTop, qLow, zs });
  await frames(100); // teleported pose: let the at-rest filter settle
  const one = await X((a) => { const d = G.golf().debug(); const f = G.fist(a.first).p; const i = a.first === a.TOP ? 0 : 1; return { carried: G.club().userData.carried, parent: G.club().parent === G.ctrl(a.first), handMode: d.handMode, missing: d.missing, fistToOwnGripMm: +(1000 * f.distanceTo(G.gripW(i))).toFixed(1), ghostTop: G.club().children.some((c) => c.visible && c.userData.mat && c.position.y > -0.1), ghostLow: G.club().children.some((c) => c.visible && c.userData.mat && c.position.y < -0.1) }; }, { first, TOP });
  // second hand onto its grip (exact 9 cm along the shaft) and squeeze
  await X((a) => { const TH = __house.THREE; const Q = (q) => new TH.Quaternion(q._x, q._y, q._z, q._w); G.pair(new TH.Vector3(...a.P0), Q(a.qTop), Q(a.qLow), 0.09, a.TOP, a.LOW); return true; }, { P0, qTop, qLow, TOP, LOW });
  await frames(3);
  await ev((s) => T.btn(s, 'squeeze', 1), second); await frames(100);
  const both = await X((a) => { const d = G.golf().debug(); return { off: G.club().userData.offHand === G.ctrl(a.second), handMode: d.handMode, missing: d.missing, topMm: +(1000 * G.fist(a.TOP).p.distanceTo(G.gripW(0))).toFixed(1), lowMm: +(1000 * G.fist(a.LOW).p.distanceTo(G.gripW(1))).toFixed(1), m: G.measure() }; }, { second, TOP, LOW });
  const r = { first, one, both };
  orders.push(r); step(`1_order_${first}_first`, r);
  if (CHECK) {
    check(`${first} first: carried by the first hand`, one.carried && one.parent, one);
    check(`${first} first: one hand sits on its own grip (<5 mm)`, one.fistToOwnGripMm < 5, one.fistToOwnGripMm);
    check(`${first} first: ghost on the empty grip`, ONEHAND ? (!one.ghostTop && !one.ghostLow) : (first === TOP ? one.missing === 'lower' && one.ghostLow && !one.ghostTop : one.missing === 'top' && one.ghostTop && !one.ghostLow), one);
    if (ONEHAND) check(`${first} first: ?golf=onehand ignores the second hand`, both.handMode !== 'two', both.handMode);
    else {
      check(`${first} first: both hands -> two-hand hold`, both.off && both.handMode === 'two' && both.missing == null, both);
      check(`${first} first: top fist on the top grip, lower fist on the lower grip (<5 mm)`, both.topMm < 5 && both.lowMm < 5, [both.topMm, both.lowMm]);
    }
  }
}
if (ONEHAND || QUICK) await finish();

// --- 2. address with both hands ---------------------------------------------------------------------------------
const place2 = async (P, gap = 0.09) => {
  await X((a) => { const TH = __house.THREE; const Q = (q) => new TH.Quaternion(q._x, q._y, q._z, q._w); G.pair(new TH.Vector3(...a.P), Q(a.qTop), Q(a.qLow), a.gap, a.TOP, a.LOW); return true; }, { P, qTop, qLow, TOP, LOW, gap });
  await frames(3);
};
await place2(P0); await frames(30);
// slide the hands so the face sits r + 4 mm behind the ball
let P = P0.slice();
for (let i = 0; i < 2; i += 1) {
  const m = await X(() => G.measure());
  P = [P[0] + (tee.x + R + 0.004 - m.faceC[0]), P[1], P[2] + (tee.z - m.faceC[2])];
  await place2(P); await frames(20);
}
await frames(Math.round(1.4 * 72)); // length fit
const addr = await X(() => G.measure());
step('2_address_two_hands', addr);
if (CHECK) {
  check('two-hand address: two-handed', addr.twoHand, addr.twoHand);
  check('two-hand address: face square within 2 deg', Math.abs(addr.faceYaw) < 2, addr.faceYaw);
  check('two-hand address: lie 58 +-3 deg', Math.abs(addr.lie - 58) < 3, addr.lie);
  check('two-hand address: sole on the ground after the fit (0..1.5 cm)', addr.soleAboveGround > -0.002 && addr.soleAboveGround < 0.015, addr.soleAboveGround);
}
// re-centre on the ball after the fit
{ const m = await X(() => G.measure()); P = [P[0] + (tee.x + R + 0.004 - m.faceC[0]), P[1], P[2] + (tee.z - m.faceC[2])]; await place2(P); await frames(30); }

// --- 3. wrist roll noise ----------------------------------------------------------------------------------------
const noise = async (who, rollDeg, posMm, n = 150) => X((a) => new Promise((res) => {
  const TH = __house.THREE; const Q = (q) => new TH.Quaternion(q._x, q._y, q._z, q._w);
  const P = new TH.Vector3(...a.P); const qT = Q(a.qTop); const qL = Q(a.qLow);
  const pL = P.clone().addScaledVector(G.shaftOf(qT), 0.09);
  let seed = a.seed; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const rows = []; let k = 0;
  const h = () => {
    const m = G.measure(); rows.push({ yaw: m.faceYaw, c: m.faceC });
    k += 1;
    const roll = (q) => { const ax = G.shaftOf(q); return new TH.Quaternion().setFromAxisAngle(ax, rnd() * 2 * a.roll * Math.PI / 180).multiply(q); };
    const pn = () => new TH.Vector3(rnd(), rnd(), rnd()).multiplyScalar(2 * a.pos / 1000);
    G.setGrip(a.TOP, P.clone().add(pn()), a.who === 'top' || a.who === 'both' ? roll(qT) : qT);
    G.setGrip(a.LOW, pL.clone().add(pn()), a.who === 'low' || a.who === 'both' ? roll(qL) : qL);
    if (k > a.n) { T.onFrame.splice(T.onFrame.indexOf(h), 1); res(rows); }
  };
  T.onFrame.push(h);
}), { P, qTop, qLow, TOP, LOW, who, roll: rollDeg, pos: posMm, n, seed: 11 });
const stats = (rows) => {
  const use = rows.slice(5); const y0 = use[0].yaw;
  const mean = [0, 1, 2].map((i) => use.reduce((s, r) => s + r.c[i], 0) / use.length);
  let dev = 0; let st = 0; let yaw = 0;
  for (let i = 0; i < use.length; i += 1) {
    dev = Math.max(dev, Math.hypot(...use[i].c.map((v, j) => v - mean[j])));
    if (i) st = Math.max(st, Math.hypot(...use[i].c.map((v, j) => v - use[i - 1].c[j])));
    yaw = Math.max(yaw, Math.abs(use[i].yaw - addr0.faceYaw));
  }
  return { faceDevDeg: +yaw.toFixed(2), headDevMm: +(dev * 1000).toFixed(2), headMaxStepMm: +(st * 1000).toFixed(2) };
};
await frames(20);
const addr0 = await X(() => G.measure());
const rest = stats(await noise('none', 0, 0.2, 100));
const rollTop = stats(await noise('top', 20, 0.2));
const rollLow = stats(await noise('low', 20, 0.2));
const rollBoth = stats(await noise('both', 5, 0.2)); // independent +-5 deg on both (reported)
step('3_noise', { rest, rollTop, rollLow, rollBoth });
if (CHECK) {
  check('rest (0.2 mm tracking noise): head jitter < 2 mm', rest.headDevMm < 2, rest);
  check('+-20 deg roll noise on the TOP controller: face < 1 deg', rollTop.faceDevDeg < 1, rollTop);
  check('+-20 deg roll noise on the LOWER controller: face < 1 deg', rollLow.faceDevDeg < 1, rollLow);
  check('roll noise on either controller: head < 2 mm', rollTop.headDevMm < 2 && rollLow.headDevMm < 2, [rollTop.headDevMm, rollLow.headDevMm]);
}
// --- 4. hands 4..12 cm apart --------------------------------------------------------------------------------------
const gaps = [];
for (const g of [0.04, 0.06, 0.08, 0.1, 0.12]) {
  await place2(P, g); await frames(30);
  const m = await X(() => G.measure());
  gaps.push({ gap: g, twoHand: m.twoHand, faceYaw: m.faceYaw, lie: m.lie, sole: m.soleAboveGround });
}
step('4_gaps', gaps);
if (CHECK) for (const g of gaps) check(`hands ${g.gap * 100} cm apart: two-handed, face square < 2 deg, lie within 1 deg of 9 cm`, g.twoHand && Math.abs(g.faceYaw) < 2 && Math.abs(g.lie - gaps[2].lie) < 1, g);
await place2(P); await frames(30);

// --- 5. two-handed swings ---------------------------------------------------------------------------------------
const swingRun = (a) => X((a) => new Promise((res) => {
  const TH = __house.THREE; const Q = (q) => new TH.Quaternion(q._x, q._y, q._z, q._w);
  const P = new TH.Vector3(...a.P); const qT = Q(a.qTop); const qL = Q(a.qLow);
  const sd = G.shaftOf(qT); const pL = P.clone().addScaledVector(sd, 0.09);
  // swing plane: contains the shaft and the target line (-X); hub 0.45 m up the shaft from the top fist
  const ax = new TH.Vector3().crossVectors(sd, new TH.Vector3(-1, 0, 0)).normalize();
  const pv = P.clone().addScaledVector(sd, -0.45);
  const f0 = G.measure().faceC; const rad = new TH.Vector3(...f0).distanceTo(pv);
  const omega = a.v / rad; const dt = 1 / 72;
  const pose = (ang, p, q) => { const r = new TH.Quaternion().setFromAxisAngle(ax, ang); return { p: p.clone().sub(pv).applyQuaternion(r).add(pv), q: r.multiply(q.clone()) }; };
  // backswing: a smooth 0.8 s take-away to the top (-1.9 rad), then the downswing at constant omega through impact
  const top = -1.9; let k = 0; let ang = 0; let phase = 'back'; const rows = []; let prev = null; let after = 0; let hit = null;
  const set = () => { const t = pose(ang, P, qT); const l = pose(ang, pL, qL); G.setGrip(a.TOP, t.p, t.q); G.setGrip(a.LOW, l.p, l.q); };
  const h = () => {
    const g = G.golf(); const f = g.face; const b = g.ballState; const d = g.debug();
    const fc = new TH.Vector3(f.c.x, f.c.y, f.c.z); const hv = prev ? fc.distanceTo(prev) / dt : 0; prev = fc;
    rows.push({ k, ang, hv, bv: Math.hypot(b.v.x, b.v.y, b.v.z) });
    if (!hit && d.lastStrike && Math.hypot(b.v.x, b.v.y, b.v.z) > 3) hit = { ...d.lastStrike, k, twoHand: d.twoHand };
    k += 1;
    if (phase === 'back') { const s = Math.min(1, k / 58); ang = top * (0.5 - 0.5 * Math.cos(Math.PI * s)); if (s >= 1) { phase = 'pause'; } }
    else if (phase === 'pause') { if (k > 58 + 10) { phase = 'down'; ang = top - a.phase * omega * dt; } }
    else if (ang < 1.2) ang += omega * dt; else after += 1;
    set();
    if (after > 30 || k > 600) { T.onFrame.splice(T.onFrame.indexOf(h), 1); res({ hit, omega, rad, head: Math.max(...rows.filter((r) => Math.abs(r.ang) < omega * dt * 1.5).map((r) => r.hv)) }); }
  };
  T.onFrame.push(h);
}), a);
const swings = [];
for (const [v, phase] of [[20, 0.2], [20, 0.7], [35, 0.35], [35, 0.85], [50, 0.1], [50, 0.55]]) {
  await X(() => { G.resetBall(); G.golf().debug().lastStrike; return true; });
  await X(() => { const g = __house.world.golf; g.resetBall(); return true; });
  await frames(4);
  const before = await X(() => JSON.stringify(G.golf().debug().lastStrike));
  const r = await swingRun({ P, qTop, qLow, TOP, LOW, v, phase });
  const s = r.hit && JSON.stringify(r.hit) !== before ? r.hit : null;
  const row = { target: v, head: +r.head.toFixed(1), connected: !!s, smash: s?.smash, ball: s?.ball, launch: s?.launch, spinRpm: s?.spinRpm, dir: s?.dir, twoHand: s?.twoHand };
  swings.push(row); console.log('swing', JSON.stringify(row));
  await place2(P); await frames(30);
}
step('5_swings', swings);
if (CHECK) for (const s of swings) {
  check(`swing ${s.target} m/s: connects`, s.connected, s);
  if (s.connected) {
    check(`swing ${s.target} m/s: smash 1.35-1.45`, s.smash > 1.35 && s.smash < 1.45, s.smash);
    check(`swing ${s.target} m/s: start line within 1 deg (square face, straight path)`, Math.abs(s.dir) < 1, s.dir);
  }
}
await finish();
async function finish() {
  out.logs = logs.filter((l) => !/favicon/.test(l));
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  await close();
  const bad = out.checks.filter((c) => !c.ok).length;
  console.log(bad ? `${bad} failed` : 'all passed');
  process.exit(CHECK && bad ? 1 : 0);
}
