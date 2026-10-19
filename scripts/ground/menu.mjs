// Start menu check (menu pass): node scripts/ground/menu.mjs <dist> <out.json> [--check]   (needs HOUSE_NODE_MODULES)
// ONLY=ui|spawns|toggles|teleport|hockey|flags runs one part. Real page, IWER Quest 3; the trigger presses go through
// the menu's own laser (the right controller is aimed at the button and the trigger pulled), not a shortcut.
// 1) ui: the menu is up after entering VR (world not simulated), laser picks work, choices persist across a reload
// 2) spawns: every Test-mode spot + the Game-mode spawn: feet on the floor for 4 s (no fall), 0.45 m of floor around,
//    facing its look point, the world simulated again
// 3) toggles: attacks off = no croc bite at the waterline for 12 s, raptor gets no player, a deadly fall dies at once
//    (no cutscene); attacks on = the cutscene plays
// 4) teleport: Game-mode teleport off hides the rings and ignores A; on shows them
// 5) hockey: from the hockey spot walk to the lift with teleport off, ride it up to the surface, step out
// 6) flags: ?menu=0 boots straight into the game (no menu); ?teleport=0 wins over the menu toggle
import fs from 'fs'; import { boot } from './boot.mjs';
const CHECK = process.argv.includes('--check');
const [dist, out] = process.argv.slice(2).filter((a) => a !== '--check');
const ONLY = process.env.ONLY || '';
const results = [];
const ok = (name, pass, info = {}) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info).slice(0, 400)); };
const want = (p) => !ONLY || ONLY.split(',').includes(p);
const lib = fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8');

// in-page: aim the right controller at a menu button and pull the trigger (edge), via the menu's own raycast
const PRESS = () => {
  T.menuPress = async (id) => {
    const H = __house;
    const p = await T.x(() => H.menuPoint(id));
    if (!p) return { ok: false, why: 'no button ' + id };
    const before = H.menu().presses;
    await T.x(() => {
      const c = __xr.controllers.right;
      const st = H.state();
      const fromW = [st.head[0], st.offset[1] + 1.2, st.head[2]];
      const from = T.toLocal(fromW); const to = T.toLocal(p);
      c.position.set(from[0], from[1], from[2]);
      const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]; const L = Math.hypot(...d); d[0] /= L; d[1] /= L; d[2] /= L;
      const v = [0, 0, -1]; const cx = v[1] * d[2] - v[2] * d[1]; const cy = v[2] * d[0] - v[0] * d[2]; const cz = v[0] * d[1] - v[1] * d[0];
      const w = 1 + (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]); const n = Math.hypot(cx, cy, cz, w);
      c.quaternion.set(cx / n, cy / n, cz / n, w / n);
    });
    await T.frames(3);
    const hover = await T.x(() => H.menu().hover);
    await T.x(() => T.btn('right', 'trigger', 1));
    await T.frames(3);
    await T.x(() => T.btn('right', 'trigger', 0));
    await T.frames(2);
    const m = await T.x(() => H.menu());
    return { ok: m.presses > before && m.last === id, hover, last: m.last };
  };
};

async function session(query, fn) {
  const { pg, ev, logs, close } = await boot(dist, query, { headH: 1.6 });
  await ev(lib); await ev(PRESS);
  try { await fn({ pg, ev }); } catch (e) { ok('crash ' + query, false, { e: String(e).slice(0, 300) }); }
  if (logs.some((l) => l.startsWith('pageerror'))) ok('no page errors ' + query, false, logs.slice(0, 5));
  await close();
}

// start a chosen setup from the menu (uses the laser); returns the state after `secs` of standing still
async function startWith(ev, presses) {
  for (const id of presses) { const r = await ev((id) => T.menuPress(id), id); if (!r.ok) return { fail: id, r }; }
  return null;
}
const STAND = async (secs) => {
  const H = __house; const frames = Math.round(secs * 72);
  let minFeet = Infinity; let maxFeet = -Infinity; let n = 0; let floor0 = null;
  await T.frames(30);
  const s0 = H.state();
  floor0 = s0.offset[1];
  const h = () => { const s = H.state(); minFeet = Math.min(minFeet, s.offset[1]); maxFeet = Math.max(maxFeet, s.offset[1]); n++; };
  T.onFrame.push(h); await T.frames(frames); T.onFrame.splice(T.onFrame.indexOf(h), 1);
  const s = H.state(); const m = H.menu();
  const sp = m.applied.spawn;
  const around = [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]].map(([dx, dz]) => { const w = H.walker.walkable(s.head[0] + dx, s.head[2] + dz, s.offset[1]); return w.ok && Math.abs(w.ground - s.offset[1]) < 0.3; });
  const M = H.cameraMatrix(); const yaw = Math.atan2(M[8], M[10]); const want = Math.atan2(-(sp.look[0] - s.head[0]), -(sp.look[2] - s.head[2]));
  let dy = Math.abs(yaw - want) % (2 * Math.PI); if (dy > Math.PI) dy = 2 * Math.PI - dy;
  return { sp: [sp.x, sp.floor, sp.z], head: s.head.map((v) => +v.toFixed(2)), feet: +s.offset[1].toFixed(3), floor0: +floor0.toFixed(3), minFeet: +minFeet.toFixed(3), maxFeet: +maxFeet.toFixed(3), around, yawErrDeg: +(dy * 180 / Math.PI).toFixed(1), deaths: H.fallDeath()?.stats?.deaths ?? 0, cut: H.cutscene(), menu: m.active, dist: +Math.hypot(s.head[0] - sp.x, s.head[2] - sp.z).toFixed(2) };
};
const spawnOk = (r) => r && !r.menu && Math.abs(r.feet - r.sp[1]) < 0.05 && r.minFeet > r.sp[1] - 0.1 && r.around.every(Boolean) && r.yawErrDeg < 15 && r.deaths === 0 && !r.cut && r.dist < 0.3;

if (want('ui') && process.env.SKIP_UI !== '1') await session('menu=1', async ({ pg, ev }) => {
  const m0 = await ev(() => T.x(() => __house.menu()));
  const n0 = await ev(() => T.x(() => __house.world.cans?.debug?.()?.t ?? null));
  ok('menu is up when the headset session starts', m0?.active, m0);
  // clock frozen behind the menu: the day/night clock must not move while the menu is up
  const dn0 = await ev(() => T.x(() => __house.daynight?.hour ?? null));
  await ev(() => T.frames(144));
  const dn1 = await ev(() => T.x(() => __house.daynight?.hour ?? null));
  ok('world paused behind the menu', dn0 === dn1, { dn0, dn1, n0 });
  const r1 = await ev(() => T.menuPress('mode:test')); ok('laser + trigger picks Test mode', r1.ok, r1);
  const r2 = await ev(() => T.menuPress('spawn:garden')); ok('laser picks a spawn', r2.ok, r2);
  const r3 = await ev(() => T.menuPress('toggle:attacks')); ok('laser flips the attacks toggle', r3.ok, r3);
  const saved = await ev(() => JSON.parse(localStorage.getItem('house.menu.v1')));
  ok('choices saved to localStorage', saved?.mode === 'test' && saved.spawn === 'garden' && saved.attacks === false, saved);
  await pg.reload();
  await pg.waitForFunction(() => document.getElementById('loading')?.hidden && window.__house, { timeout: 600000, polling: 1000 });
  const after = await ev(() => __house.menu());
  ok('choices restored after a reload', after?.choice.mode === 'test' && after.choice.spawn === 'garden' && after.choice.attacks === false, after?.choice);
  // desktop mouse: click the START button centre on the 2D canvas (not presenting)
  const px = await ev(() => { const H = __house; const p = H.menuPoint('mode:game'); const cam = H.world.camera; const v = new H.THREE.Vector3(...p); cam.position.set(0, 1.6, 0.35); cam.lookAt(0, 1.3, -1.25); cam.updateMatrixWorld(); v.project(cam); const r = H.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
  await pg.mouse.click(px[0], px[1]); await new Promise((r) => setTimeout(r, 1500));
  const md = await ev(() => __house.menu());
  ok('desktop mouse click picks Game mode', md.choice.mode === 'game' && md.last === 'mode:game', { px, last: md.last, mode: md.choice.mode });
  await ev(() => localStorage.removeItem('house.menu.v1'));
});

const SPOTS = ['cliff', 'cave', 'peak', 'garden', 'hockey'];
if (want('spawns')) {
  for (const id of SPOTS) {
    await session('menu=1&teleport=0', async ({ ev }) => {
      const f = await startWith(ev, ['mode:test', `spawn:${id}`, 'start']);
      if (f) { ok(`spawn ${id}`, false, f); return; }
      const r = await ev(STAND, 4);
      ok(`spawn ${id}: on the floor 4 s, floor around, facing its view`, spawnOk(r), r);
    });
  }
  await session('menu=1', async ({ ev }) => {
    const f = await startWith(ev, ['mode:game', 'start']);
    if (f) { ok('game spawn', false, f); return; }
    const r = await ev(STAND, 4);
    ok('Game mode: designer spawn in the start room (today\'s spawn; the room is small, so no 0.45 m margin test)', spawnOk({ ...r, around: [true] }) && Math.abs(r.head[0] - 4.12) < 0.3, r);
    // back to the menu: hold left Y 1.5 s
    await ev(() => T.x(() => T.btn('left', 'y-button', 1)));
    await ev(() => T.frames(130));
    await ev(() => T.x(() => T.btn('left', 'y-button', 0)));
    const m = await ev(() => T.x(() => __house.menu()));
    ok('holding left Y 1.5 s opens the menu again', m.active, m);
    const f2 = await startWith(ev, ['mode:test', 'spawn:cave', 'start']);
    const r2 = f2 ? null : await ev(STAND, 2);
    ok('re-choosing from the menu moves you to the new spot', !f2 && spawnOk(r2) && r2.sp[1] < -5, r2 || f2);
  });
}

if (want('toggles')) {
  for (const attacks of [false, true]) {
    await session('menu=1&teleport=0', async ({ ev }) => {
      const presses = ['mode:test', 'spawn:cave'];
      const cur = await ev(() => __house.menu().choice.attacks);
      if (cur !== attacks) presses.push('toggle:attacks');
      presses.push('start');
      const f = await startWith(ev, presses); if (f) { ok('toggles start', false, f); return; }
      const opts = await ev(() => __house.menu().opts);
      ok(`attacks ${attacks ? 'on' : 'off'}: options applied`, opts.raptor === attacks && opts.croc === attacks && opts.cutscene === attacks, opts);
      // croc: stand at the waterline 14 s (pagelib stubs croc.update for other checks; restore the real one here)
      const r = await ev(async () => {
        const H = __house; const w = H.world; const cave = w.cave;
        if (!w.croc) return { noCroc: true };
        let bites = 0; w.croc.on('bite', () => { bites += 1; }); w.croc.on('grabTick', () => { bites += 1; });
        delete w.croc.update; // own property set by pagelib -> back to the module's update
        await T.frames(10);
        await T.x(() => H.place(cave.x0 + 0.3, cave.floor, cave.standZ - 0.6));
        await T.frames(72 * 14);
        return { bites, state: w.croc._s?.state, hp: null };
      });
      if (r.noCroc) ok(`attacks ${attacks ? 'on' : 'off'}: croc (not loaded in this headless page: gate covered by the options check only)`, true, r);
      else ok(`attacks ${attacks ? 'on' : 'off'}: croc ${attacks ? 'engages' : 'never engages'} at the waterline`, attacks ? r.state !== 'patrol' : (r.bites === 0 && r.state === 'patrol'), r);
      // raptor: on = it gets the player pose, off = null
      const rp = await ev(() => { const raptor = __house.world.bear; if (!raptor) return 'no raptor'; let seen = 'none'; const orig = raptor.update; raptor.update = (dt, p) => { seen = p ? 'pose' : 'null'; return orig(dt, p); }; return T.frames(5).then(() => { raptor.update = orig; return seen; }); });
      ok(`attacks ${attacks ? 'on' : 'off'}: raptor ${attacks ? 'gets' : 'never gets'} the player`, rp === (attacks ? 'pose' : 'null'), { rp });
      // deadly fall from the cliff top over the sea
      const fr = await ev(async () => {
        const H = __house; await T.x(() => H.place(-1.4, 0, 0.05));
        await T.frames(20);
        let cut = null; const deaths0 = H.fallDeath().stats.deaths;
        const h = () => { cut = cut || H.cutscene(); }; T.onFrame.push(h);
        await T.x(() => H.place(-6, 0, 0.05));
        await T.frames(72 * 4); T.onFrame.splice(T.onFrame.indexOf(h), 1);
        return { cut, deaths: H.fallDeath().stats.deaths - deaths0, last: H.fallDeath().stats.last?.why };
      });
      ok(`attacks ${attacks ? 'on' : 'off'}: deadly fall ${attacks ? 'plays the cutscene' : 'dies at once, no cutscene'}`, attacks ? !!fr.cut : (!fr.cut && fr.deaths >= 1 && fr.last === 'void'), fr);
    });
  }
}

if (want('teleport')) {
  for (const tp of [false, true]) {
    await session('menu=1', async ({ ev }) => {
      const presses = ['mode:game'];
      const cur = await ev(() => __house.menu().choice.teleport);
      if (cur !== tp) presses.push('toggle:teleport');
      presses.push('start');
      const f = await startWith(ev, presses); if (f) { ok('teleport start', false, f); return; }
      await ev(() => T.frames(40));
      const r = await ev(async () => {
        const H = __house; H.chopDoor();
        const s0 = H.state();
        await T.x(() => T.btn('right', 'a-button', 1)); await T.frames(4); await T.x(() => T.btn('right', 'a-button', 0)); await T.frames(10);
        const s1 = H.state();
        return { spots: s1.spotsVisible, moved: +Math.hypot(s1.head[0] - s0.head[0], s1.head[2] - s0.head[2]).toFixed(2), opt: H.menu().opts.teleport };
      });
      ok(`teleport ${tp ? 'on: rings shown, A moves you' : 'off: no rings, A does nothing'}`, tp ? (r.spots > 0 && r.moved > 0.5 && r.opt) : (r.spots === 0 && r.moved < 0.05 && !r.opt), r);
    });
  }
}

if (want('hockey')) await session('menu=1&teleport=0', async ({ ev }) => {
  const f = await startWith(ev, ['mode:test', 'spawn:hockey', 'start']); if (f) { ok('hockey start', false, f); return; }
  const r = await ev(async () => {
    const H = __house; const lift = H.world.lift; const log = [];
    await T.frames(60);
    const car = lift.carBox; const cx = (car.x0 + car.x1) / 2; const cz = (car.z0 + car.z1) / 2;
    log.push(['car parked at', +lift.floorY.toFixed(2), 'dir', lift.dir]);
    const w1 = [await T.walk([[5.5, 4.0], [5.5, 4.95], [5.6, 5.6], [cx, cz]], { frames: 1500 })];
    log.push(['walk in', JSON.stringify(w1)]);
    lift.go(true);
    for (let i = 0; i < 80 && (lift.moving || lift.pendingMove || Math.abs(lift.floorY) > 0.01); i++) await T.frames(36);
    for (let i = 0; i < 20 && lift.doorOpen < 0.99; i++) { lift.openDoor(); await T.frames(36); }
    const s = H.state(); log.push(['top', +lift.floorY.toFixed(2), 'feet', +s.offset[1].toFixed(2), 'door', lift.doorOpen]);
    const w2 = await T.go([[2.0, 8.4]]); // out of the car, into the yard (the crates spot itself is boxed in)
    const s2 = H.state();
    return { log, w1: w1.every((x) => x.ok), w2: w2.every((x) => x.ok), feet: +s2.offset[1].toFixed(2), head: s2.head.map((v) => +v.toFixed(2)), deaths: H.fallDeath().stats.deaths };
  });
  const out = r.head[0] < 3.4 || r.head[2] > 6.6; // clear of the shaft (x 3.55..4.95, z 5.18..6.46)
  ok('hockey room: walk to the lift, ride up, step out at the surface (teleport off)', r.w1 && out && Math.abs(r.feet) < 0.05 && r.deaths === 0, r);
});

if (want('flags')) {
  await session('', async ({ ev }) => {
    const m = await ev(() => T.x(() => ({ menu: __house.menu(), cell: __house.state().head })));
    ok('?menu=0 (harness default): no menu, straight into the start room', m.menu === null && Math.abs(m.cell[0] - 4.12) < 0.3, m);
  });
  await session('menu=1&teleport=0', async ({ ev }) => {
    await ev(() => T.menuPress('mode:game'));
    const cur = await ev(() => __house.menu().choice.teleport);
    await ev(() => T.menuPress('toggle:teleport'));
    const after = await ev(() => __house.menu().choice.teleport);
    await ev(() => T.menuPress('start')); await ev(() => T.frames(40));
    const st = await ev(() => T.x(() => ({ opts: __house.menu().opts, spots: __house.state().spotsVisible })));
    ok('?teleport=0 wins over the menu toggle', cur === after && st.opts.teleport === false && st.spots === 0, { cur, after, st });
  });
}

fs.writeFileSync(out, JSON.stringify({ results }, null, 1));
const fails = results.filter((r) => !r.pass).length;
console.log(`${results.length - fails}/${results.length} passed`);
process.exit(CHECK && fails ? 1 : 0);
