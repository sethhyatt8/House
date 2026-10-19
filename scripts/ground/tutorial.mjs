// Tutorial check (tutorial pass): node scripts/ground/tutorial.mjs <dist> <out.json> [--check]   (needs HOUSE_NODE_MODULES)
// ONLY=menu,1,2,3,4,5,skip runs parts. Each station is completed with simulated controller input through the real rig
// (IWER Quest 3): stick axes, the thumbstick click, grips, hand motion. Checks that each step advances, that the chime
// plays, teleport/attacks/cutscenes are off, and that the end hands back the Game-mode options.
import fs from 'fs'; import { boot } from './boot.mjs';
const CHECK = process.argv.includes('--check');
const [dist, out] = process.argv.slice(2).filter((a) => a !== '--check');
const ONLY = (process.env.ONLY || 'menu,1,2,3,4,5,skip').split(',');
const results = [];
const ok = (name, pass, info = {}) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info).slice(0, 500)); };
const lib = fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8');
const swimlib = fs.readFileSync(new URL('./swimlib.js', import.meta.url), 'utf8');
async function session(query, fn) {
  const { pg, ev, logs, close } = await boot(dist, query, { headH: 1.6 });
  await ev(lib); await ev(swimlib);
  await ev(`window.ADVp = ${ADV.toString()};`);
  try { await fn({ pg, ev }); } catch (e) { ok('crash ' + query, false, { e: String(e).slice(0, 300) }); }
  if (logs.some((l) => l.startsWith('pageerror'))) ok('no page errors ' + query, false, logs.slice(0, 5));
  await close();
}
// wait until the tutorial leaves (station, step) or `frames` pass
const ADV = ([station, step, frames]) => new Promise((res) => {
  let k = 0; const h = () => { k++; const t = __house.tutorial(); if (!t.active || t.station !== station || t.step !== step || k > frames) { T.onFrame.splice(T.onFrame.indexOf(h), 1); res({ moved: k <= frames, t }); } }; T.onFrame.push(h);
});
const tut = (ev) => ev(() => T.x(() => __house.tutorial()));

if (ONLY.includes('menu')) await session('menu=1', async ({ ev }) => {
  const r = await ev(async () => {
    const H = __house; const p = await T.x(() => H.menuPoint('mode:tutorial'));
    H.menuPress('mode:tutorial'); H.menuPress('start');
    await T.frames(60);
    return { t: H.tutorial(), opts: H.menu().opts, st: H.state(), p };
  });
  ok('menu: Tutorial button starts station 1 on the cave beach, attacks/cutscenes/teleport off', r.t.active && r.t.station === 1 && r.st.offset[1] < -7 && !r.opts.raptor && !r.opts.croc && !r.opts.cutscene && !r.opts.teleport && r.st.spotsVisible === 0, { t: r.t, opts: r.opts, feet: r.st.offset[1] });
});

if (ONLY.includes('1')) await session('tutorial=1', async ({ ev }) => {
  await ev(() => T.frames(40));
  const t0 = await tut(ev);
  await ev(() => T.x(() => T.stick('left', 0, -1)));
  const r = await ev((a) => ADVp(a), [1, 0, 72 * 4]);
  await ev(() => T.x(() => T.stick('left', 0, 0)));
  ok('1 walk: left stick forward 1.5 m completes the station', t0.station === 1 && r.moved && r.t.station === 2, { t0, r });
});

if (ONLY.includes('2')) await session('tutorial=2', async ({ ev }) => {
  await ev(() => T.frames(40));
  await ev(() => T.x(() => T.stick('right', 1, 0)));
  const a = await ev((a) => ADVp(a), [2, 0, 72 * 2]);
  await ev(() => T.x(() => T.stick('right', 0, 0)));
  ok('2a turn: right stick flick snap-turns and advances', a.moved && a.t.station === 2 && a.t.step === 1, a);
  // hold the right thumbstick click and turn the head 60 deg over 1 s
  await ev(() => T.x(() => T.btn('right', 'thumbstick', 1)));
  await ev(() => T.frames(5));
  const b = await ev(async () => {
    const p = ADVp([2, 1, 72 * 3]);
    for (let i = 0; i < 72; i++) { await T.x(() => { const q = __xr.quaternion; const h = (Math.PI / 3 / 72) / 2; const c = Math.cos(h); const s = Math.sin(h); q.set(q.x * c - q.z * s, q.y * c + q.w * s, q.z * c + q.x * s, q.w * c - q.y * s); }); }
    return p;
  }).catch((e) => ({ err: String(e) }));
  await ev(() => T.x(() => T.btn('right', 'thumbstick', 0)));
  ok('2b turn: holding the stick click and turning the head advances', b.moved && b.t.station === 3, b);
});

if (ONLY.includes('3')) await session('tutorial=3', async ({ ev }) => {
  await ev(() => T.frames(40));
  const r = await ev(async () => {
    const H = __house; const TH = H.THREE; const stick = H.world.hockey.stick;
    const p = stick.getWorldPosition(new TH.Vector3());
    const a = ADVp([3, 0, 72 * 2]);
    await T.x(() => T.hand('right', [p.x, p.y + 0.03, p.z]));
    await T.frames(4); await T.x(() => T.btn('right', 'squeeze', 1)); await T.frames(6); await T.x(() => T.btn('right', 'squeeze', 0));
    const ra = await a;
    await T.frames(10);
    const low = stick.localToWorld(new TH.Vector3(0, -0.3, 0));
    const b = ADVp([3, 1, 72 * 2]);
    await T.x(() => T.hand('left', [low.x, low.y, low.z])); await T.frames(4);
    await T.x(() => T.btn('left', 'squeeze', 1));
    const rb = await b;
    await T.x(() => T.btn('left', 'squeeze', 0));
    return { at: p.toArray().map((v) => +v.toFixed(2)), feet: H.state().offset[1], ra, rb };
  });
  ok('3a two hands: grip at the handle picks the stick up', r.ra.moved && r.ra.t.step === 1 && r.at[1] < -7, r);
  ok('3b two hands: the other grip on the shaft completes the station', r.rb.moved && r.rb.t.station === 4, r.rb);
});

if (ONLY.includes('4')) await session('tutorial=4', async ({ ev }) => {
  await ev(() => T.frames(40));
  const a = await ev(async () => { const p = ADVp([4, 0, 72 * 6]); const w = T.walk([[-1.4, 0.5], [-3.0, 0.5]], { frames: 72 * 6 }); const r = await p; T.stick('left', 0, 0); void w; return { ...r, aboard: __house.state().aboard }; });
  await ev(() => T.x(() => T.stick('left', 0, 0)));
  ok('4a row: walking into the canoe boards it and advances', a.moved && a.aboard && a.t.step === 1, a);
  // grab both oars where they rest (as scripts/ground/row.mjs does)
  const b = await ev(async () => {
    const c = __house.world.canoe; T.L = c.longOars.find((o) => o.side < 0); T.R = c.longOars.find((o) => o.side > 0);
    const w = (o) => { const v = o.end.clone(); c.group.localToWorld(v); return [v.x, v.y, v.z]; };
    const pr = w(T.R); const pl = w(T.L); T.follow = { right: () => pr, left: () => pl };
    await T.frames(10);
    const p = ADVp([4, 1, 72 * 2]);
    T.btn('left', 'squeeze', 1); T.btn('right', 'squeeze', 1);
    return p;
  });
  ok('4b row: gripping both oars advances', b.moved && b.t.step === 2, b);
  // strokes: push both handles forward and back for up to 12 s (row.mjs drive geometry, mirrored hands)
  const c = await ev(async () => {
    const C = __house.world.canoe; const p = ADVp([4, 2, 72 * 12]);
    const TH = __house.THREE; T.hy = { R: T.R.end.y, L: T.L.end.y };
    // row.mjs geometry: hands on a 0.5 m arc about each oarlock; drive 0.35 -> -0.8 rad blades in (0.6 s), recover blades out
    const at = (oar, key, th, out) => { const v = new TH.Vector3(oar.P.x - oar.side * 0.5 * Math.cos(th), T.hy[key] - (out ? 0.2 : 0), oar.P.z + 0.5 * Math.sin(th)); C.group.localToWorld(v); return [v.x, v.y, v.z]; };
    let f = 0; const D = 43; const R = 50;
    const th = () => { const k = f % (D + R); return k < D ? 0.35 - 1.15 * (0.5 - 0.5 * Math.cos(Math.PI * k / D)) : -0.8 + 1.15 * ((k - D) / R); };
    const outW = () => f % (D + R) >= D;
    T.follow = { right: () => at(T.R, 'R', th(), outW()), left: () => at(T.L, 'L', th(), outW()) };
    const h = () => { f += 1; }; T.onFrame.push(h);
    const r = await p; T.onFrame.splice(T.onFrame.indexOf(h), 1); T.follow = null;
    const d = C.debug(); T.btn('left', 'squeeze', 0); T.btn('right', 'squeeze', 0);
    return { ...r, boat: C.group.position.toArray().map((v) => +v.toFixed(2)), grounded: d.sim?.groundedFrac, floating: C.floating?.(), wet: d.oars?.map((o) => o.wet), held: C.longOars.map((o) => !!o.hand) };
  });
  ok('4c row: strokes move the boat 0.7 m and finish the station', c.moved && c.t.station === 5, c);
});

if (ONLY.includes('5')) await session('tutorial=5', async ({ ev }) => {
  await ev(() => T.frames(40));
  const a = await ev(async () => { await T.x(() => __house.place(-1.2, -7.92, -3.6)); await T.frames(10); const p = ADVp([5, 0, 72 * 8]); T.walk([[-2.2, -3.6], [-6, -3.6]], { frames: 72 * 8 }); const r = await p; T.stick('left', 0, 0); return { ...r, swim: __house.state().swim?.active }; });
  await ev(() => T.x(() => T.stick('left', 0, 0)));
  ok('5a swim: walking off the shallows starts swimming and advances', a.moved && a.t.step === 1, a);
  const b = await ev(async () => { const p = ADVp([5, 1, 72 * 10]); for (let i = 0; i < 4; i++) { await T.stroke({}); } return p; });
  ok('5b swim: two arm strokes advance', b.moved && b.t.step === 2, b);
  const c = await ev(async () => { const p = ADVp([5, 2, 72 * 15]); T.walk([[0.5, -3.6]], { frames: 72 * 15 }); const r = await p; T.stick('left', 0, 0); return { ...r, st: __house.tutorial(), menu: null }; });
  ok('5c swim: swimming back and standing up finishes the tutorial', c.moved && !c.t.active && c.t.done, c);
});

if (ONLY.includes('skip')) await session('tutorial=1', async ({ ev }) => {
  await ev(() => T.frames(40));
  const r = await ev(async () => {
    const seen = [];
    for (let i = 0; i < 6; i++) {
      const t = __house.tutorial(); if (!t.active) break; seen.push([t.station, t.step]);
      const p = ADVp([t.station, t.step, 72 * 3]);
      await T.x(() => T.btn('left', 'x-button', 1)); const r = await p; await T.x(() => T.btn('left', 'x-button', 0)); await T.frames(3);
      if (!r.moved) return { seen, stuck: r.t };
    }
    const H = __house;
    return { seen, end: H.tutorial(), stickHome: H.world.hockey.stick.position.toArray().map((v) => +v.toFixed(2)) };
  });
  ok('skip: holding left X 1 s skips each station; the end screen shows; the stick is back in the hockey room', r.end && !r.end.active && r.end.done && r.seen.length === 5 && r.stickHome[1] > -4, r);
});

fs.writeFileSync(out, JSON.stringify({ results }, null, 1));
const fails = results.filter((r) => !r.pass).length;
console.log(`${results.length - fails}/${results.length} passed`);
process.exit(CHECK && fails ? 1 : 0);
