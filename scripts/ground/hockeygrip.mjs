// Hockey stick grip through the real rig (IWER Quest 3, 1/72 s frames): how the stick sits in the hand, the hook at a
// natural stance (face square and upright, hook on the floor), the length fit, two hands 30 cm apart, and swept
// strikes at 10-20 m/s. node scripts/ground/hockeygrip.mjs <dist> <out.json> [query] [--check]
import fs from 'fs'; import { boot } from './boot.mjs';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CHECK = process.argv.includes('--check');
const [dist, outPath = 'hockeygrip-out.json', query = ''] = args;
// two-grip pass: the first hand picks the stick up and holds it at ITS grip (left = top grip at the end of the stick,
// right = lower grip 35 cm down). Default: the left hand first; --first=right tests the other order.
const FIRST = (process.argv.find((a) => a.startsWith('--first=')) || '--first=left').slice(8);
const SECOND = FIRST === 'left' ? 'right' : 'left';
const OLDQ = /golf=(old|legacy)/.test(query);
const H1 = OLDQ ? 'right' : FIRST; const H2 = OLDQ ? 'left' : SECOND;
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
for (const f of ['pagelib.js', 'golflib.js']) await ev(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
const out = { query, steps: {}, checks: [] };
const step = (k, v) => { out.steps[k] = v; console.log(k, JSON.stringify(v).slice(0, 700)); };
const check = (name, ok, v) => { out.checks.push({ name, ok: !!ok, v }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(v)); };
const X = (fn, a) => ev((src, a) => T.x(() => (0, eval)(src)(a)), fn.toString(), a);
const frames = (n) => ev((n) => T.frames(n), n);
await frames(20);
await X(() => G.useKit('hockey'));
const info = await X(() => { const h = __house.world.hockey; const s = h.stick.getWorldPosition(new __house.THREE.Vector3()); const b = h.ball.position; return { stick: s.toArray(), ball: b.toArray(), old: !h.stick.userData.debug }; });
step('kit', info);
const floor = await X(() => __house.groundModel.groundUnder(__house.world.hockey.ball.position.x, __house.world.hockey.ball.position.z, __house.world.hockey.ball.position.y + 0.3));
const BALL = info.ball;
// stand west of the ball (golf frame +Z -> world -X), 0.8 m away, facing +X; target = north goal (-Z)
await X((a) => __house.place(a.x, a.y, a.z), { x: BALL[0] - 0.8, y: floor, z: BALL[2] });
await frames(20);
await X((a) => T.hand(a.h, [a.p[0], a.p[1] + 0.03, a.p[2]]), { h: H1, p: info.stick }); await frames(4);
await ev((h) => { T.btn(h, 'squeeze', 1); }, H1); await frames(6); await ev((h) => { T.btn(h, 'squeeze', 0); }, H1); await frames(6);
const carried = await X(() => G.club().userData.carried);
check('stick picked up', carried, carried);
step('1_inHand', await X(() => G.inHand()));
const hasDebug = await X(() => !!G.club().userData.debug);
if (!hasDebug) {
  // 59e7c4b / ?golf=old: no debug hooks; report the in-hand frame only
  out.logs = logs; fs.writeFileSync(outPath, JSON.stringify(out, null, 1)); await close(); process.exit(0);
}
const anat = await X((h) => G.anatomy(h, 17, false), H1);
// fist where the hook's face centre sits 2 cm + r behind the ball (on the far side from the target)
const placeAt = async (q, h) => {
  const base = [BALL[0] - 0.5, floor + h, BALL[2] + 0.3];
  await X((a) => G.setGrip(a.h, new __house.THREE.Vector3(...a.base), a.q), { base, q, h: H1 }); await frames(3);
  const m = await X(() => G.measure());
  const want = [BALL[0], m.faceC[1], BALL[2] + 0.0364 + 0.02];
  const nb = [base[0] + want[0] - m.faceC[0], base[1], base[2] + want[2] - m.faceC[2]];
  await X((a) => G.setGrip(a.h, new __house.THREE.Vector3(...a.nb), a.q), { nb, q, h: H1 }); await frames(3);
  return X(() => G.measure());
};
let touch = null;
for (let h = 1.0; h >= 0.25; h -= 0.01) { const m = await placeAt(anat, h); if (m.soleAboveGround <= 0.012) { touch = { handH: +h.toFixed(2), ...m }; break; } }
step('2_anatomy_touch', touch);
const HH = H1 === 'right' && !OLDQ ? 0.55 : 0.85; // the lower hand holds the stick 30 cm lower
const at85 = await placeAt(anat, HH);
await frames(Math.round(1.3 * 72));
const fitted = await X(() => G.measure());
step('3_fit_at_0.85', { before: at85, after: fitted });
if (CHECK) {
  check('stick: face square to the target within 3 deg', Math.abs(fitted.faceYaw) < 3, fitted.faceYaw);
  check('stick: face upright (loft within 3 deg)', Math.abs(fitted.loft) < 3, fitted.loft);
  check('stick: hook on the floor after the fit', fitted.soleAboveGround > -0.002 && fitted.soleAboveGround < 0.015, fitted.soleAboveGround);
  check('stick: shaft 25-50 deg off vertical', fitted.shaftFromVertical > 25 && fitted.shaftFromVertical < 50, fitted.shaftFromVertical);
}
// two hands, 30 cm apart, both fists in the right-handed grip (back of the left hand / palm of the right to the target)
const two = await ev(async (a) => {
  const TH = __house.THREE; const g = G.ctrl(a.h1).userData.grip; g.updateWorldMatrix(true, false);
  const p = new TH.Vector3(); const q = new TH.Quaternion(); g.matrixWorld.decompose(p, q, new TH.Vector3());
  const m0 = await T.x(() => G.measure());
  const p2 = p.clone().addScaledVector(new TH.Vector3(...m0.shaftDir).applyQuaternion(G.R), a.d); // measure() is in the golf frame
  const q2 = await T.x(() => G.anatomy(a.h2, 17, false));
  await T.x(() => G.setGrip(a.h2, p2, q2)); await T.frames(3);
  T.btn(a.h2, 'squeeze', 1); await T.frames(30);
  const engaged = await T.x(() => G.club().userData.offHand === G.ctrl(a.h2));
  const m1 = await T.x(() => G.measure());
  // second hand 6 cm along world X, the way that lifts the hook (a steeper shaft would only push it into the floor clamp)
  await T.x(() => G.setGrip(a.h2, p2.clone().add(new TH.Vector3(a.d < 0 ? -0.06 : 0.06, 0, 0)), q2)); await T.frames(20);
  const m2 = await T.x(() => G.measure());
  const dbg = await T.x(() => G.club().userData.debug()); const handMode = dbg.handMode;
  T.btn(a.h2, 'squeeze', 0); await T.frames(10);
  const m3 = await T.x(() => G.measure());
  return { engaged, m1, m2, handMode, twoHand: dbg.twoHand, weight: dbg.weight, after: m3, released: !G.club().userData.offHand };
}, { h1: H1, h2: H2, d: OLDQ ? 0.3 : (H1 === 'left' ? 0.35 : -0.35) });
step('4_twohand', two);
if (CHECK) {
  check('stick two-hand engages', two.engaged && two.twoHand, { engaged: two.engaged, twoHand: two.twoHand });
  const sa = two.m1.shaftDir; const sb = two.m2.shaftDir; const steer = Math.acos(Math.min(1, sa[0] * sb[0] + sa[1] * sb[1] + sa[2] * sb[2])) * 57.2958;
  check('stick two-hand: the second hand steers the shaft (> 4 deg)', steer > 4, { steer: +steer.toFixed(1), from: two.m1.shaftFromVertical, to: two.m2.shaftFromVertical });
  if (!OLDQ) check('stick two-hand: both fists on their grips (two-grip hold)', two.handMode === 'two', two.handMode);
  check('stick two-hand: face stays square within 6 deg', Math.abs(two.m2.faceYaw) < 6, two.m2.faceYaw);
  check('stick two-hand: release falls back to one hand', two.released, two.released);
}
// swept strikes
await placeAt(anat, HH); await frames(6);
const addr = await X(() => G.measure());
const gp = await X((h) => { const g = G.ctrl(h).userData.grip; g.updateWorldMatrix(true, false); const p = new __house.THREE.Vector3(); const q = new __house.THREE.Quaternion(); g.matrixWorld.decompose(p, q, new __house.THREE.Vector3()); return { p: p.toArray(), q: { x: q.x, y: q.y, z: q.z, w: q.w } }; }, H1);
const sdW = await X((sd) => new __house.THREE.Vector3(...sd).applyQuaternion(G.R).toArray(), addr.shaftDir);
const t = [0, 0, -1];
const axis = [sdW[1] * t[2] - sdW[2] * t[1], sdW[2] * t[0] - sdW[0] * t[2], sdW[0] * t[1] - sdW[1] * t[0]];
const pivot = gp.p.map((v, i) => v - sdW[i] * (H1 === 'right' && !OLDQ ? 0.2 : 0.5));
const strikes = [];
for (const [label, omega, phase] of [['push', 4, 0.4], ['hit', 11, 0.3], ['hard', 16, 0.7], ['slap', 16, 0.15]]) {
  await X((a) => G.setGrip(a.h, new __house.THREE.Vector3(a.p[0], a.p[1] + 0.4, a.p[2]), a.q), { ...gp, h: H1 }); await frames(6);
  await X(() => { const d = G.club().userData.debug(); const b = d.ballState; b.p.x = d.spawn.x; b.p.y = d.spawn.y; b.p.z = d.spawn.z; b.v.x = b.v.y = b.v.z = 0; b.w.x = b.w.y = b.w.z = 0; b.asleep = false; });
  await frames(4);
  const rec = await ev((a) => new Promise((res) => {
    const TH = __house.THREE; const pv = new TH.Vector3(...a.pivot); const ax = new TH.Vector3(...a.axis).normalize();
    const p0 = new TH.Vector3(...a.p); const q0 = new TH.Quaternion(a.q.x, a.q.y, a.q.z, a.q.w);
    let ang = -1.2 - a.phase * a.omega / 72; const rows = []; let k = 0; let prev = null;
    const pose = (an) => { const r = new TH.Quaternion().setFromAxisAngle(ax, an); return { p: p0.clone().sub(pv).applyQuaternion(r).add(pv), q: r.multiply(q0.clone()) }; };
    const h = () => {
      const d = G.club().userData.debug(); const b = d.ballState; const f = d.face;
      const fc = new TH.Vector3(f.c.x, f.c.y, f.c.z); const hv = prev ? fc.distanceTo(prev) * 72 : 0; prev = fc;
      rows.push({ k, ang, hv, bv: Math.hypot(b.v.x, b.v.y, b.v.z), b: [b.p.x, b.p.y, b.p.z], v: [b.v.x, b.v.y, b.v.z], w: [b.w.x, b.w.y, b.w.z], s: d.lastStrike });
      k += 1;
      if (ang <= 0.9) { ang += a.omega / 72; const ps = pose(ang); G.setGrip(a.h, ps.p, ps.q); }
      if (k > 140) { T.onFrame.splice(T.onFrame.indexOf(h), 1); res(rows); }
    };
    const ps = pose(ang); G.setGrip(a.h, ps.p, ps.q); T.onFrame.push(h);
  }), { pivot, axis, p: gp.p, q: gp.q, omega, phase, h: H1 });
  const near = rec.filter((r) => Math.abs(r.ang) < omega / 72 * 1.5);
  const head = Math.max(0, ...near.map((r) => r.hv));
  const sf = rec.findIndex((r) => r.bv > 0.3);
  const r = { label, head: +head.toFixed(1), ball: sf >= 0 ? +Math.max(...rec.slice(sf, sf + 3).map((x) => x.bv)).toFixed(1) : 0, strike: rec[rec.length - 1].s };
  if (sf >= 0) { const a0 = rec[sf].b; const a1 = rec[Math.min(rec.length - 1, sf + 4)].b; r.dir = +(Math.atan2(a1[0] - a0[0], -(a1[2] - a0[2])) * 57.2958).toFixed(1); }
  if (process.env.TRACE && sf >= 0) for (const x of rec.slice(Math.max(0, sf - 2), sf + 6)) console.log('  trace', JSON.stringify({ k: x.k, ang: +x.ang.toFixed(3), hv: +x.hv.toFixed(1), bv: +x.bv.toFixed(1), b: x.b.map((v) => +v.toFixed(3)), v: x.v.map((v) => +v.toFixed(2)), w: x.w.map((v) => +v.toFixed(1)) }));
  strikes.push(r); console.log('strike', JSON.stringify(r));
}
step('5_strikes', strikes);
if (CHECK) for (const s of strikes) check(`stick ${s.label} ${s.head} m/s: ball moves (no tunnelling)`, s.ball > 0.3, s);
out.logs = logs.filter((l) => !/favicon/.test(l));
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
await close();
const bad = out.checks.filter((c) => !c.ok).length;
console.log(bad ? `${bad} failed` : 'all passed');
if (CHECK && bad) process.exit(1);
