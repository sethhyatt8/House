// Golf grip + strike through the real rig (IWER Quest 3 emulation, virtual clock 1/72 s per frame).
// node scripts/ground/golfgrip.mjs <dist> <out.json> [query]     (needs HOUSE_NODE_MODULES, see boot.mjs)
// Measures how the driver sits in the hand (grip-space offset, shaft and face directions), what an anatomical
// address pose does with it (lie, face angle, head height), the swing physics (launch speed/angle/spin, carry,
// tunnelling at high head speed), two-hand mode jitter and the left-handed mirror. With --check it also enforces
// the acceptance numbers of the golf grip pass and exits 1 on a failure.
import fs from 'fs'; import { boot } from './boot.mjs';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CHECK = process.argv.includes('--check');
const REQUIRED = process.argv.includes('--required'); // address with the pose the build's hold needs (for the old hold)
const [dist, outPath = 'golfgrip-out.json', query = ''] = args;
const LEFT = /golfhand=left/.test(query);
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
for (const f of ['pagelib.js', 'golflib.js']) await ev(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
const out = { query, steps: {}, checks: [] };
const step = (k, v) => { out.steps[k] = v; console.log(k, JSON.stringify(v).slice(0, 600)); };
const check = (name, ok, v) => { out.checks.push({ name, ok: !!ok, v }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(v)); };
const X = (fn, a) => ev((src, a) => T.x(() => (0, eval)(src)(a)), fn.toString(), a);
const frames = (n) => ev((n) => T.frames(n), n);

const R = 0.02135;
const hand = LEFT ? 'left' : 'right'; const other = LEFT ? 'right' : 'left';
const zs = LEFT ? -1 : 1; // the golfer stands on +Z (right-handed) or -Z (left-handed) of the target line
await frames(20);
const deck = await X(() => __house.world.golf.green.y);
const teeInfo = await X(() => __house.world.golf.debug?.()?.tee ?? null);
const TEE = teeInfo ? [teeInfo.x, teeInfo.z] : [-0.42, 0.02];
// stand ~0.92 m from the ball line, but never past the walkable edge of the rock (|z| 0.6)
const standZ = Math.max(-0.58, Math.min(0.58, TEE[1] + zs * 0.92));
step('stand', { tee: TEE, standZ, ballToHead: +Math.abs(standZ - TEE[1]).toFixed(2) });
await X((a) => __house.place(a.x, a.y, a.z), { x: TEE[0] + 0.05, y: deck, z: standZ });
await frames(20);
step('rig', await X(() => {
  const TH = __house.THREE; const o = {};
  for (const s of ['left', 'right']) {
    const m = G.rel(s); const p = new TH.Vector3(); const q = new TH.Quaternion(); m.decompose(p, q, new TH.Vector3());
    const z = new TH.Vector3(0, 0, -1).applyQuaternion(q); const rf = new TH.Vector3(0, 0, -1).applyQuaternion(q.clone().invert());
    o[s] = { gripOrigin: p.toArray().map((v) => +v.toFixed(4)), gripMinusZinRay: z.toArray().map((v) => +v.toFixed(3)), rayFwdInGrip: rf.toArray().map((v) => +v.toFixed(3)), angleRayToGripZ: +(z.angleTo(new TH.Vector3(0, 0, -1)) * 57.2958).toFixed(1) };
  }
  return o;
}));

// 1) pick the driver up with one hand
const clubAt = await X(() => { const p = G.club().getWorldPosition(new __house.THREE.Vector3()); return p.toArray(); });
await X((a) => T.hand(a.side, a.p), { side: hand, p: [clubAt[0], clubAt[1] + 0.03, clubAt[2]] });
await frames(4);
await ev((s) => { T.btn(s, 'squeeze', 1); }, hand); await frames(6); await ev((s) => { T.btn(s, 'squeeze', 0); }, hand); await frames(6);
const carried = await X(() => G.club().userData.carried);
check('driver picked up', carried, carried);
step('1_inHand', await X(() => G.inHand()));

// 2) anatomical address pose: hands in front of the belt, forearm hanging 17 deg toward the ball, back of the
//    right hand (palm of the left) away from the target. Position the fist so the face sits just behind the ball.
const placeAt = async (q, handH) => {
  // put the grip at a reference spot, then translate so the face centre is r + 4 mm behind the ball (target side
  // opposite) and the hands are handH above the deck
  await X((a) => G.setGrip(a.side, new __house.THREE.Vector3(a.TEE[0] + 0.3, a.deck + a.h, a.TEE[1] + a.zs * 0.7), a.q), { side: hand, deck, h: handH, zs, q, TEE });
  await frames(3);
  const m = await X(() => G.measure());
  const gripNow = m.grip; const fc = m.faceC;
  const want = [TEE[0] + (R + 0.004), fc[1], TEE[1]];
  const d = [want[0] - fc[0], 0, want[2] - fc[2]];
  await X((a) => G.setGrip(a.side, new __house.THREE.Vector3(a.TEE[0] + 0.3 + a.d[0], a.deck + a.h, a.TEE[1] + a.zs * 0.7 + a.d[2]), a.q), { side: hand, deck, h: handH, zs, q, TEE, d });
  await frames(3);
  return X(() => G.measure());
};
const anat = await X((a) => G.anatomy(a.s, 17, a.l), { s: hand, l: LEFT });
// hand height at which the sole just touches: sweep
let touch = null;
for (let h = 1.05; h >= 0.6; h -= 0.01) {
  const m = await placeAt(anat, h);
  if (m.soleAboveGround <= 0.012) { touch = { handH: +h.toFixed(2), ...m }; break; }
}
step('2_anatomy_touch', touch);
const at90 = await placeAt(anat, 0.9);
step('2_anatomy_at_0.90', at90);

// 3) what controller pose the CURRENT hold needs for a textbook address (shaft 58 deg, face square, toe flat)
step('3_required_pose', await X((a) => {
  const TH = __house.THREE; const club = G.club(); const g = club.parent.userData.grip;
  g.updateWorldMatrix(true, false); club.updateWorldMatrix(true, false);
  const cg = new TH.Quaternion(); g.matrixWorld.clone().invert().multiply(club.matrixWorld).decompose(new TH.Vector3(), cg, new TH.Vector3());
  const lie = 58 * Math.PI / 180;
  const Xa = new TH.Vector3(-1, 0, 0); const Ya = new TH.Vector3(0, Math.sin(lie), a.zs * Math.cos(lie)); const Za = new TH.Vector3().crossVectors(Xa, Ya);
  const ideal = new TH.Quaternion().setFromRotationMatrix(new TH.Matrix4().makeBasis(Xa, Ya, Za));
  const need = ideal.clone().multiply(cg.clone().invert());
  const anat = new TH.Quaternion(a.anat._x ?? a.anat.x, a.anat._y ?? a.anat.y, a.anat._z ?? a.anat.z, a.anat._w ?? a.anat.w);
  const rel = G.relCache[a.side]; const rq = new TH.Quaternion(); rel.decompose(new TH.Vector3(), rq, new TH.Vector3());
  const rayQ = need.clone().multiply(rq.clone().invert());
  const rayFwd = new TH.Vector3(0, 0, -1).applyQuaternion(rayQ); const top = new TH.Vector3(0, 1, 0).applyQuaternion(rayQ);
  const palm = new TH.Vector3(a.side === 'right' ? -1 : 1, 0, 0).applyQuaternion(need);
  return {
    degFromAnatomy: +(2 * Math.acos(Math.min(1, Math.abs(need.dot(anat)))) * 57.2958).toFixed(1),
    rayForward: rayFwd.toArray().map((v) => +v.toFixed(3)), rayFromVertical: +(Math.acos(-rayFwd.y) * 57.2958).toFixed(1),
    controllerTop: top.toArray().map((v) => +v.toFixed(3)), palmFaces: palm.toArray().map((v) => +v.toFixed(3)),
    need: { x: need.x, y: need.y, z: need.z, w: need.w },
  };
}, { anat, side: hand, zs }));
const addrQ = REQUIRED ? out.steps['3_required_pose'].need : anat;
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));

// 4) swings from the address pose: rigid rotation about a hub 0.55 m up the shaft line, in the shaft/target plane
let reqTouch = null;
if (REQUIRED) for (let h = 1.1; h >= 0.6; h -= 0.01) { const m = await placeAt(addrQ, h); if (m.soleAboveGround <= 0.012) { reqTouch = +h.toFixed(2); break; } }
const addr = await placeAt(addrQ, REQUIRED ? (reqTouch ?? 0.9) : (touch ? touch.handH : 0.9));
await frames(80); // calibration window (new build) / settle
const addrAfter = await X(() => G.measure());
step('4_address', addrAfter);
if (CHECK) {
  check('address: sole on the ground (0..1.5 cm)', addrAfter.soleAboveGround > -0.002 && addrAfter.soleAboveGround < 0.015, addrAfter.soleAboveGround);
  check('address: face square within 3 deg', Math.abs(addrAfter.faceYaw) < 3, addrAfter.faceYaw);
  check('address: lie 58 +-2 deg', Math.abs(addrAfter.lie - 58) < 2, addrAfter.lie);
  check('address: toe flat within 3 deg', Math.abs(addrAfter.toeTilt) < 3, addrAfter.toeTilt);
  check('address: loft 12 +-2 deg', Math.abs(addrAfter.loft - 12) < 2, addrAfter.loft);
}
// 4b) length fit (new hold only): a shorter player (hands 8 cm lower) and a taller one (6 cm higher) hold still
//     at address for 1.3 s; the shaft is refitted so the sole rests on the ground and the lie returns to 58 deg
if (!REQUIRED && addrAfter.mode !== 'old') {
  const fitRun = async (dh) => {
    const before = await placeAt(anat, (touch ? touch.handH : 0.9) + dh);
    await frames(Math.round(1.3 * 72));
    const after = await X(() => G.measure());
    return { dh, before: { lie: before.lie, sole: before.soleAboveGround, ext: before.ext }, after: { lie: after.lie, sole: after.soleAboveGround, ext: after.ext, faceYaw: after.faceYaw } };
  };
  const short = await fitRun(-0.08);
  const tall = await fitRun(+0.06);
  const back = await fitRun(0);
  step('4b_fit', { short, tall, back });
  // the fitted length moved the head: address again before the swings
  await placeAt(anat, touch ? touch.handH : 0.9); await frames(6);
  if (CHECK) {
    for (const [k, r] of Object.entries({ short, tall, back })) {
      check(`fit ${k}: sole on the ground after 1.3 s still`, r.after.sole > -0.002 && r.after.sole < 0.015, r.after);
      check(`fit ${k}: lie 58 +-2 after the fit`, Math.abs(r.after.lie - 58) < 2, r.after.lie);
    }
  }
}
const gripPose = await X((s) => { const g = G.ctrl(s).userData.grip; g.updateWorldMatrix(true, false); const p = new __house.THREE.Vector3(); const q = new __house.THREE.Quaternion(); g.matrixWorld.decompose(p, q, new __house.THREE.Vector3()); return { p: p.toArray(), q: { x: q.x, y: q.y, z: q.z, w: q.w } }; }, hand);
const sd = addrAfter.shaftDir; const t = [-1, 0, 0];
const axis = [sd[1] * t[2] - sd[2] * t[1], sd[2] * t[0] - sd[0] * t[2], sd[0] * t[1] - sd[1] * t[0]];
const pivot = [gripPose.p[0] - sd[0] * 0.55, gripPose.p[1] - sd[1] * 0.55, gripPose.p[2] - sd[2] * 0.55];
const swings = [];
for (const [label, omega, phase] of [['slow', 9, 0.3], ['medium', 18, 0.5], ['solid', 25, 0.15], ['fast', 31, 0.7], ['fast2', 31, 0.2], ['veryfast', 36, 0.45]]) {
  await X((a) => G.setGrip(a.side, new __house.THREE.Vector3(a.p[0], a.p[1] + 0.5, a.p[2]), a.q), { side: hand, ...gripPose });
  await frames(6);
  await X(() => G.resetBall()); await frames(4);
  const rec = await ev((a) => G.swing({ side: a.side, pos: a.pos, quat: a.quat, pivot: a.pivot, axis: a.axis, omega: a.omega, from: -1.7, to: 1.3, phase: a.phase, follow: 420, frames: 900,
    extra: () => ({ m: G.golf().debug?.()?.lastStrike ?? null }) }), { side: hand, pos: gripPose.p, quat: gripPose.q, pivot, axis, omega, phase });
  const fr = rec.frames;
  const sf = rec.strikeFrame;
  const r = { label, omega };
  // head speed at the bottom of the arc (frame-to-frame face speed around ang 0)
  const near0 = fr.filter((f) => Math.abs(f.ang) < omega / 72 * 1.5 && f.hv > 0);
  r.headSpeed = near0.length ? +Math.max(...near0.map((f) => f.hv)).toFixed(1) : null;
  if (sf != null) {
    const f0 = fr[sf]; const f1 = fr[Math.min(fr.length - 1, sf + 1)];
    const v = [(f1.ball[0] - f0.ball[0]) * 72, (f1.ball[1] - f0.ball[1]) * 72, (f1.ball[2] - f0.ball[2]) * 72];
    const sp = Math.hypot(...v); const hz = Math.hypot(v[0], v[2]);
    r.ballSpeed = +sp.toFixed(1); r.launch = +(Math.atan2(v[1], hz) * 57.2958).toFixed(1); r.dir = +(Math.atan2(v[2], -v[0]) * 57.2958).toFixed(1);
    r.smash = r.headSpeed ? +(sp / r.headSpeed).toFixed(2) : null;
    r.strike = f1.m || f0.m || null;
    // carry: horizontal distance from the tee when the ball comes back down through tee height; total at rest/water
    let carry = null; let maxH = 0; let last = fr[fr.length - 1];
    for (let i = sf + 1; i < fr.length; i += 1) {
      const b = fr[i].ball; maxH = Math.max(maxH, b[1] - deck);
      if (carry == null && b[1] < deck + 0.07 && i > sf + 3) carry = +Math.hypot(b[0] - TEE[0], b[2] - TEE[1]).toFixed(1);
    }
    r.apexAboveTee = +maxH.toFixed(1); r.carryAtTeeHeight = carry; r.lastBall = last.ball; r.offline = +(last.ball[2] - TEE[1]).toFixed(1);
  } else r.ballSpeed = 0;
  r.tunnel = sf == null && r.headSpeed > 5;
  swings.push(r); console.log('swing', JSON.stringify(r));
}
step('5_swings', swings);
if (CHECK) {
  for (const s of swings) {
    check(`swing ${s.label}: ball struck (no tunnelling)`, s.ballSpeed > 1, { head: s.headSpeed, ball: s.ballSpeed });
    if (s.headSpeed > 25) {
      check(`swing ${s.label}: smash 1.3-1.5`, s.smash > 1.3 && s.smash < 1.5, s.smash);
      check(`swing ${s.label}: launch 6-18 deg`, s.launch > 6 && s.launch < 18, s.launch);
      check(`swing ${s.label}: start line within 6 deg`, Math.abs(s.dir) < 6, s.dir);
    }
  }
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));

// 5) two hands: the other fist 11 cm down the shaft from the first, squeeze held; 1 mm tracking noise
await X(() => G.resetBall());
await placeAt(addrQ, REQUIRED ? (reqTouch ?? 0.9) : (touch ? touch.handH : 0.9));
await frames(10);
const two = await ev(async (a) => {
  const TH = __house.THREE; const g = G.ctrl(a.side).userData.grip; g.updateWorldMatrix(true, false);
  const p = new TH.Vector3(); const q = new TH.Quaternion(); g.matrixWorld.decompose(p, q, new TH.Vector3());
  const m0 = await T.x(() => G.measure());
  const sd = new TH.Vector3(...m0.shaftDir);
  const p2 = p.clone().addScaledVector(sd, 0.11);
  // the second fist: same anatomy (mirrored hand), its palm facing the other way
  const q2 = a.req ? q.clone() : await T.x(() => G.anatomy(a.other, 17, a.left));
  await T.x(() => G.setGrip(a.other, p2, q2)); await T.frames(3);
  T.btn(a.other, 'squeeze', 1); await T.frames(6);
  const engaged = await T.x(() => G.club().userData.offHand === G.ctrl(a.other));
  // the same noise sequence (1 mm position, 0.17 deg rotation per axis on each fist) with and without the second hand
  const run = async (twoHands) => {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) - 0.5; };
    if (!twoHands) { T.btn(a.other, 'squeeze', 0); await T.frames(8); } else { T.btn(a.other, 'squeeze', 1); await T.frames(30); }
    const rows = [];
    for (let i = 0; i < 100; i += 1) {
      const n1 = new TH.Vector3(rnd(), rnd(), rnd()).multiplyScalar(0.002); const n2 = new TH.Vector3(rnd(), rnd(), rnd()).multiplyScalar(0.002);
      const r1 = new TH.Quaternion().setFromEuler(new TH.Euler(rnd() * 0.006, rnd() * 0.006, rnd() * 0.006));
      const r2 = new TH.Quaternion().setFromEuler(new TH.Euler(rnd() * 0.006, rnd() * 0.006, rnd() * 0.006));
      await T.x(() => { G.setGrip(a.side, p.clone().add(n1), r1.clone().multiply(q)); G.setGrip(a.other, p2.clone().add(n2), r2.clone().multiply(q2)); });
      await T.frames(1);
      rows.push(await T.x(() => G.measure()));
    }
    const use = rows.slice(10);
    const st = (k) => { const v = use.map((r) => r[k]); const mean = v.reduce((s, x) => s + x, 0) / v.length; const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length); let jump = 0; for (let i = 1; i < v.length; i += 1) jump = Math.max(jump, Math.abs(v[i] - v[i - 1])); return { mean: +mean.toFixed(2), sd: +sd.toFixed(3), maxStep: +jump.toFixed(3) }; };
    const head = use.map((r) => r.faceC); const steps = [];
    for (let i = 1; i < head.length; i += 1) steps.push(1000 * Math.hypot(head[i][0] - head[i - 1][0], head[i][1] - head[i - 1][1], head[i][2] - head[i - 1][2]));
    const rms = Math.sqrt(steps.reduce((s, x) => s + x * x, 0) / steps.length);
    return { faceYaw: st('faceYaw'), lie: st('lie'), headRmsStepMm: +rms.toFixed(2), headMaxStepMm: +Math.max(...steps).toFixed(1), twoHand: use[use.length - 1].twoHand };
  };
  const oneJ = await run(false);
  const twoJ = await run(true);
  // the lower hand moves 4 cm toward the target: shaft should follow (two-hand) and the face should not flip
  await T.x(() => G.setGrip(a.other, p2.clone().add(new TH.Vector3(-0.04, 0, 0)), q2)); await T.frames(12);
  const moved = await T.x(() => G.measure());
  T.btn(a.other, 'squeeze', 0); await T.frames(8);
  const released = await T.x(() => ({ off: !!G.club().userData.offHand, carried: G.club().userData.carried, m: G.measure() }));
  return { engaged, single: m0, one: oneJ, two: twoJ, moved, released };
}, { side: hand, other, left: LEFT, req: REQUIRED });
step('6_twohand', two);
if (CHECK) {
  check('two-hand: second hand engages', two.engaged, two.engaged);
  check('two-hand: engaged during the noise run', two.two.twoHand, two.two.twoHand);
  check('two-hand: face yaw jitter sd < 0.5 deg', two.two.faceYaw.sd < 0.5, two.two.faceYaw);
  check('two-hand: head jitter no worse than 1.5x one hand (+1 mm)', two.two.headRmsStepMm <= 1.5 * two.one.headRmsStepMm + 1, { one: two.one.headRmsStepMm, two: two.two.headRmsStepMm });
  check('two-hand: releasing falls back to one hand', !two.released.off && two.released.carried, two.released.off);
}
out.logs = logs.filter((l) => !/favicon/.test(l));
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
await close();
const bad = out.checks.filter((c) => !c.ok).length;
console.log(bad ? `${bad} failed` : 'all passed');
if (CHECK && bad) process.exit(1);
