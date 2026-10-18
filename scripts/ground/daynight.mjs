// Day/night pass, in the real page (IWER Quest 3, headless): steps the clock through the day and checks the live
// scene against src/daynight.js: key light direction (sun / old moon direction), colour and intensity, hemisphere,
// fog near/far/colour, the far-plane drop at the fog peak, the blended env probe, the texel-snapped shadow box,
// clock speed (?daylen/?timescale), indoor rooms/caves back on the old night rig, underwater owning the fog, the sea
// cutscene, and draw calls against ?daynight=0. Then ?daynight=0 must be the old fixed lighting exactly, and
// ?fog=0 / ?daylen are honoured.
// node scripts/ground/daynight.mjs <dist> <out.json> [--check]   (needs HOUSE_NODE_MODULES)   ONLY=main|rooms|off|flags
import fs from 'fs'; import { boot } from './boot.mjs';
globalThis.location = { search: '' };
const THREE = await import('three');
const dn = await import('../../src/daynight.js');
const args = process.argv.slice(2); const check = args.includes('--check');
const [dist, out] = args.filter((a) => a !== '--check');
const ONLY = process.env.ONLY || '';
const results = [];
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info ?? '').slice(0, 400)); };
async function session(q, fn) {
  const b = await boot(dist, q, { headH: 1.6, freezeClock: true });
  await b.ev(() => {
    const H = __house; window.T = window.T || {};
    // physics/logic only between measurements: the main scene isn't drawn (swiftshader is ~4 fps), probe passes are
    const r = H.renderer; const realRender = r.render.bind(r);
    T.draw = false;
    r.render = (scn, cam) => { if (scn !== H.world.scene || T.draw) return realRender(scn, cam); r.xr.updateCamera(cam); };
    T.outdoor = () => new Promise((res) => { const t0 = Date.now(); const h = () => (H.daynight.state.indoor === 0 || Date.now() - t0 > 20000 ? res() : setTimeout(h, 50)); h(); });
    T.q = []; T.n = 0;
    window.__vt = performance.now(); // virtual clock: every XR frame is exactly 1/72 s (boot.mjs routes performance.now here)
    H.setFrameHook(() => { T.n += 1; window.__vt += 1000 / 72; for (const task of T.q.splice(0)) { try { task.resolve(task.fn()); } catch (e) { task.reject(e); } } });
    T.x = (fn) => new Promise((resolve, reject) => T.q.push({ fn, resolve, reject }));
    T.wait = (n) => new Promise((res) => { const end = T.n + n; const h = () => (T.n >= end ? res() : setTimeout(h, 20)); h(); });
    T.light = () => {
      const w = H.world; const k = w.keyLight; const d = k.position.clone().sub(k.target.position).normalize();
      return { dir: d.toArray(), I: k.intensity, col: k.color.getHexString(), hemiI: w.hemiLight.intensity, hemiCol: w.hemiLight.color.getHexString(),
        fog: [w.scene.fog.near, w.scene.fog.far, w.scene.fog.color.getHexString()], far: w.camera.far, xrFar: H.renderer.xr.getCamera().far,
        env: w.scene.environment?.name || '', envI: w.scene.environmentIntensity, target: k.target.position.toArray(), pos: k.position.toArray(),
        shadowFar: k.shadow.camera.far, shadowBox: k.shadow.camera.right, map: k.shadow.mapSize.x };
    };
  });
  await b.ev(() => T.x(() => __house.chopDoor()));
  await b.ev(async () => { for (let i = 0; i < 400 && __house.settle?.().on; i++) await T.wait(5); });
  try { await fn(b.ev); } finally { b.logs.filter((l) => /pageerror/.test(l)).forEach((l) => ok('no page errors', false, l)); await b.close(); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const vdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

if (!ONLY || ONLY === 'main') await session('', async (ev) => {
  ok('daynight on by default, starts at 10:00', await ev(() => T.x(() => !!__house.daynight && __house.daynight.hour > 9.99 && __house.daynight.hour < 10.2)));
  // ---- the day in 1 h steps (+ the fog hours), from the yard
  await ev(() => T.x(() => __house.place(3.0, 0, 9.6)));
  await ev(() => T.wait(30));
  await ev(() => T.outdoor());
  const hours = [0, 3, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10, 11, 12.5, 14, 16, 18, 18.6, 19, 19.25, 19.5, 20, 21, 23];
  const steps = [];
  for (const h of hours) steps.push({ h, ...(await ev((hh) => T.x(() => { __house.daynight.setHour(hh, __house.world.camera.position); return { ...T.light(), st: { ...__house.daynight.state }, look: __house.daynight.look(), snap: { ...__house.daynight.snap }, eye: __house.world.camera.position.toArray() }; }), h)) });
  let dirErr = 0; let iErr = 0; let fogErr = 0;
  for (const s of steps) {
    const hq = Math.round(s.h / 0.00375) * 0.00375; const sun = dn.sunDir(hq);
    const useSun = sun.y > -0.05; const exp = useSun ? sun : dn.MOON_DIR;
    dirErr = Math.max(dirErr, vdist(s.dir, exp.toArray()));
    const L = dn.lookAt(s.h); const w = useSun ? dn.sunWeight(hq) : dn.moonWeight(s.h); // the code weights the sun by its 0.05-deg-stepped position
    iErr = Math.max(iErr, Math.abs(s.I - L.keyI * w));
    const f = dn.fogAmount(s.h);
    fogErr = Math.max(fogErr, Math.abs(s.fog[0] - (L.fogNear + (dn.FOG_PEAK.near - L.fogNear) * f)), Math.abs(s.fog[1] - (L.fogFar + (dn.FOG_PEAK.far - L.fogFar) * f)));
  }
  ok('key light direction = sun (east->west) by day, old moon direction by night', dirErr < 1e-4, { worst: dirErr });
  ok('key light intensity follows the look x elevation weight', iErr < 1e-4, { worst: iErr });
  ok('fog near/far follow the look + morning fog curve', fogErr < 1e-4, { worst: fogErr });
  const by = Object.fromEntries(steps.map((s) => [s.h, s]));
  ok('night (00:00, 03:00, 23:00) = old lighting: key d5e2ff 1.15 from (-7,9,2), hemi .26, fog 18/210 #10182c', [0, 3, 23].every((h) => {
    const s = by[h]; return s.col === 'd5e2ff' && near(s.I, 1.15, 1e-6) && near(s.hemiI, 0.26, 1e-6) && s.fog[0] === 18 && s.fog[1] === 210 && s.fog[2] === '10182c' && vdist(s.dir, dn.MOON_DIR.toArray()) < 1e-6;
  }), by[0]);
  ok('sun rises east, south at noon, sets west', by[6].dir[0] > 0.99 && by[12.5].dir[2] > 0.4 && by[12.5].dir[1] > 0.85 && by[19].dir[0] < -0.99, [by[6].dir, by[12.5].dir, by[19].dir].map((d) => d.map((v) => +v.toFixed(2))));
  ok('noon brightest; dusk warm; moon blue', by[12.5].I > by[9].I && by[9].I > by[18.6].I && by[18.6].col.slice(0, 2) === 'ff' && parseInt(by[18.6].col.slice(4), 16) < 0x80, steps.map((s) => `${s.h}:${s.I.toFixed(2)}#${s.col}`).join(' '));
  ok('light is 0 at the sun/moon swap (19:25)', by[19.25].I < 1e-3 && by[19.5].I < 0.05, [by[19.25].I, by[19.5].I]);
  ok('morning fog: thick at 07:00-08:00 (far <= 40 m), clear by 10:00 (>= 200 m)', by[7.5].fog[1] <= 26.01 && by[8].fog[1] < 40 && by[10].fog[1] >= 200 && by[6].fog[1] < by[5].fog[1], steps.filter((s) => s.h >= 5 && s.h <= 10).map((s) => `${s.h}:${s.fog[1].toFixed(0)}`).join(' '));
  ok('fog peak drops the camera far plane to 48 m (XR camera too), restored after', by[7.5].far === 48 && by[7.5].xrFar === 48 && by[10].far === 160 && by[12.5].far === 160, { f75: by[7.5].far, xr: by[7.5].xrFar, f10: by[10].far });
  ok('scene.environment is the blended probe', steps.every((s) => s.env === 'daynight_env'));
  ok('lantern/fireflies/night sound: on at night, off by day', by[0].st.glow === 1 && by[12.5].st.glow === 0 && by[0].st.nightSound === 1 && by[12.5].st.nightSound === 0 && by[19.5].st.glow > 0 && by[19.5].st.glow < 1, steps.map((s) => `${s.h}:${s.st.glow.toFixed(2)}`).join(' '));
  // ---- shadows: one map, texel-snapped box round the player
  const sh = by[12.5];
  ok('one shadow map, box follows the player (centre within one texel of the eye column)', sh.map === 256 && sh.shadowBox === 4.5 && Math.hypot(sh.target[0] - sh.eye[0], sh.target[2] - sh.eye[2]) < 1.5, { target: sh.target, eye: sh.eye, map: sh.map });
  ok('shadow centre on whole texels in light space', steps.every((s) => near(s.snap.cx / s.snap.texel, Math.round(s.snap.cx / s.snap.texel), 1e-6) && near(s.snap.cy / s.snap.texel, Math.round(s.snap.cy / s.snap.texel), 1e-6)), { texel: sh.snap.texel });
  const stab = await ev(() => T.x(() => {
    const dnn = __house.daynight; const k = __house.world.keyLight; const E = __house.THREE.Vector3; const e0 = new E(2.6, 1.6, 7.5);
    const res = []; dnn.setHour(12.5, e0); const t0 = k.target.position.clone(); let moved = 0; let maxJump = 0;
    for (let i = 1; i <= 40; i++) { const e = e0.clone().add(new E(i * 0.0007, 0, i * 0.0005)); const before = k.target.position.clone(); dnn.setHour(12.5, e); const j = k.target.position.distanceTo(before); if (j > 1e-9) moved += 1; maxJump = Math.max(maxJump, j); }
    dnn.setHour(12.5, e0); res.push(k.target.position.distanceTo(t0));
    return { moved, maxJump, back: res[0], texel: dnn.snap.texel };
  }));
  ok('stable: 40 sub-texel head steps (2.8 cm) move the shadow box only in whole-texel jumps, and back exactly', stab.back < 1e-9 && stab.maxJump <= stab.texel * 1.75 + 1e-6 && stab.moved <= 4, stab);
  const sweep = await ev(() => T.x(() => { const dnn = __house.daynight; const k = __house.world.keyLight; const out = []; let changes = 0; let prev = null; for (let i = 0; i <= 200; i++) { dnn.setHour(12 + i * 0.0005, __house.world.camera.position); const d = k.position.clone().sub(k.target.position).normalize(); if (prev && d.distanceTo(prev) > 1e-9) changes += 1; prev = d; } return { changes }; }));
  ok('light direction moves in 0.05 deg steps (27 steps over 6 game minutes)', sweep.changes >= 20 && sweep.changes <= 30, sweep);
  // ---- clock speed (virtual 1/72 s frames are not guaranteed here: measure against performance.now)
  const clock = await ev(async () => { const d = __house.daynight; const h0 = await T.x(() => [d.hour, performance.now()]); await T.wait(144); const h1 = await T.x(() => [d.hour, performance.now()]); return { dh: h1[0] - h0[0], ms: h1[1] - h0[1] }; });
  const rate = clock.dh / (clock.ms / 1000); // game hours per (virtual) second
  ok('24-minute day: 1 game hour per real minute', clock.dh > 0 && near(rate * 60, 1, 0.05), { perMin: +(rate * 60).toFixed(3), ...clock });
});

if (!ONLY || ONLY === 'rooms') await session('', async (ev) => {
  // ---- indoor rooms / caves keep the old night rig
  const indoor = await ev(async () => {
    const H = __house; const out = {};
    await T.x(() => { H.daynight.setHour(12.5, H.world.camera.position); H.teleportTo?.({ x: 4.12, z: 0.14, floor: 0 }); H.place(4.12, 0, 0.14); });
    await T.wait(420);
    out.cell = await T.x(() => ({ zone: H.world.zones?.current, st: { ...H.daynight.state }, ...T.light(), blend: H.daynight.lastBlend() }));
    const c = H.world.cave;
    await T.x(() => H.place((c.x0 + c.x1) / 2, c.floor, (c.z0 + c.z1) / 2));
    await T.wait(420);
    out.cave = await T.x(() => ({ zone: H.world.zones?.current, st: { ...H.daynight.state }, ...T.light(), blend: H.daynight.lastBlend() }));
    await T.x(() => H.place(3.0, 0, 9.6));
    await T.wait(420);
    out.yard = await T.x(() => ({ zone: H.world.zones?.current, st: { ...H.daynight.state }, ...T.light() }));
    return out;
  });
  const rig = (s) => s.st.indoor === 1 && s.st.rig === 'old' && vdist(s.pos, [-7, 9, 2]) < 1e-9 && s.shadowFar === 8 && near(s.I, 1.15, 0.02) && near(s.hemiI, 0.26, 0.01) && s.col === 'd5e2ff' && vdist(s.dir, dn.MOON_DIR.toArray()) < 0.01 && s.blend?.indoor === 1;
  ok('start cell at noon: old night rig (key 1.15 at (-7,9,2), old shadow frustum, hemi .26, night env)', rig(indoor.cell), { zone: indoor.cell.zone, I: indoor.cell.I, hemi: indoor.cell.hemiI, blend: indoor.cell.blend });
  ok('cave at noon: stays dark (old night rig)', rig(indoor.cave), { zone: indoor.cave.zone, I: indoor.cave.I, hemi: indoor.cave.hemiI, blend: indoor.cave.blend });
  ok('back outside: daylight again', indoor.yard.st.indoor === 0 && indoor.yard.I > 2.5, { zone: indoor.yard.zone, I: indoor.yard.I });
  // ---- underwater owns the fog while you're under
  const uw = await ev(async () => {
    const H = __house; const u = H.world.underwater; if (!u) return null;
    await T.x(() => { H.daynight.setHour(12.5, H.world.camera.position); u.force(true); });
    await T.wait(20);
    const under = await T.x(() => T.light());
    await T.x(() => u.force(null)); await T.wait(20);
    const after = await T.x(() => T.light());
    return { under: under.fog, after: after.fog, far: after.far };
  });
  ok('underwater: water fog kept (near < 1), daylight fog back after', !uw || (uw.under[0] < 1 && uw.after[0] >= 18 && uw.far === 160), uw);
  // ---- sea cutscene at sunset
  const cut = await ev(async () => {
    const H = __house; await T.x(() => { H.place(3.0, 0, 9.6); H.daynight.setHour(19, H.world.camera.position); H.playCutscene('sea'); });
    const seen = []; for (let i = 0; i < 30; i++) { await T.wait(10); const c = await T.x(() => H.cutscene()); if (c) seen.push(c.phase); else break; }
    return { seen: [...new Set(seen)], light: await T.x(() => T.light()) };
  });
  ok('sea cutscene plays at sunset with the day/night light running', cut.seen.length > 0 && Number.isFinite(cut.light.I), cut.seen);
  // ---- probes + draw calls
  const probes = await ev(() => T.x(() => ({ ...__house.daynight.probes, cached: __house.daynight.cachedProbes(), casters: { ...__house.daynight.casters } })));
  ok('env probes: one per key look, small, blended', probes.cached.length >= 4 && probes.probes <= 4 && probes.size[0] === 384 && probes.blends > 0, probes);
  const calls = await ev(async () => { const H = __house; const out = {}; for (const [name, x, f, z, h] of [['yard_noon', 3.0, 0, 9.6, 12.5], ['yard_night', 3.0, 0, 9.6, 0], ['yard_fog', 3.0, 0, 9.6, 7.5]]) { await T.x(() => { H.place(x, f, z); H.daynight.setHour(h, H.world.camera.position); }); T.draw = true; await T.wait(8); out[name] = await T.x(() => H.renderer.info.render.calls); T.draw = false; } return out; });
  results.push({ name: 'calls', pass: true, info: calls }); console.log('calls', JSON.stringify(calls));
});

if (!ONLY || ONLY === 'off') await session('daynight=0', async (ev) => {
  const s = await ev(() => T.x(() => ({ dn: __house.daynight, ...T.light(), sky: (() => { let m = null; __house.world.scene.traverse((o) => { if (o.userData?.backdrop && o.geometry?.parameters?.radius === 120) m = o.material; }); return m ? m.customProgramCacheKey() : 'missing'; })() })));
  ok('?daynight=0: no day/night system', s.dn == null);
  ok('?daynight=0: old key light exactly ((-7,9,2) -> (0,0.6,-0.2), d5e2ff 1.15, shadow far 8, box 2.2)', vdist(s.pos, [-7, 9, 2]) < 1e-9 && vdist(s.target, [0, 0.6, -0.2]) < 1e-9 && s.col === 'd5e2ff' && s.I === 1.15 && s.shadowFar === 8 && s.shadowBox === 2.2, s);
  ok('?daynight=0: old fog/hemi/env (18/210 #10182c, hemi .26, original probe)', s.fog[0] === 18 && s.fog[1] === 210 && s.fog[2] === '10182c' && s.hemiI === 0.26 && s.env !== 'daynight_env' && s.far === 160, s);
  ok('?daynight=0: sky material unpatched', s.sky !== 'missing' && s.sky !== 'dn-sky', s.sky);
  const calls = await ev(async () => { const H = __house; const out = {}; for (const [name, x, f, z] of [['yard', 3.0, 0, 9.6]]) { await T.x(() => H.place(x, f, z)); T.draw = true; await T.wait(8); out[name] = await T.x(() => H.renderer.info.render.calls); T.draw = false; } return out; });
  results.push({ name: 'calls_off', pass: true, info: calls }); console.log('calls off', JSON.stringify(calls));
});

if (!ONLY || ONLY === 'flags') await session('time=7.5&fog=0&daylen=2', async (ev) => {
  const s = await ev(async () => { await T.wait(10); return T.x(() => ({ h: __house.daynight.hour, st: { ...__house.daynight.state }, ...T.light() })); });
  ok('?time=7.5&fog=0: starts at 07:30 with no fog (far >= 150, camera far 160)', near(s.h, 7.5, 0.2) && s.st.fog === 0 && s.fog[1] >= 150 && s.far === 160, { h: s.h, fog: s.fog, far: s.far });
  const clock = await ev(async () => { const d = __house.daynight; const h0 = await T.x(() => [d.hour, performance.now()]); await T.wait(144); const h1 = await T.x(() => [d.hour, performance.now()]); return { dh: h1[0] - h0[0], ms: h1[1] - h0[1] }; });
  const rate = clock.dh / (clock.ms / 1000);
  ok('?daylen=2: 12 game hours per real minute', near(rate * 60, 12, 0.6), { perMin: +(rate * 60).toFixed(2) });
});

if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `${failed.length} FAILED` : `ALL PASS (${results.length})`);
if (check && failed.length) process.exit(1);
