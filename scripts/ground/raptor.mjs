// Raptor boss through the real rig (IWER Quest 3 emulation, virtual clock 1/72 s per frame).
// Usage: node scripts/ground/raptor.mjs dist out.json   (needs HOUSE_NODE_MODULES, see boot.mjs)
// Checks: the ~15 s hidden intro (never fully seen, calls from 3+ places), the emergence, a leap you dodge (misses,
// knocks it down) and one you don't (hits), a tackle at the cliff edge (shove stops 0.5 m short, eased), a chase into
// the woods (body/tail never inside a trunk, feet never off the ground), the fight to the death and the claw, and
// that ?legacy=bear still boots the old bear.
import fs from 'fs'; import { boot } from './boot.mjs';
const [dist, outPath = 'raptor-out.json'] = process.argv.slice(2);
const out = { checks: {}, notes: {} };
const ok = (k, v, note) => { out.checks[k] = !!v; if (note !== undefined) out.notes[k] = note; console.log(`${v ? 'PASS' : 'FAIL'} ${k}${note !== undefined ? ' ' + JSON.stringify(note) : ''}`); };

// ---------------------------------------------------------------- main run
{
  const { ev, logs, close } = await boot(dist, 'raptordebug=1&raptordmg=0.25');
  await ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
  const secs = (s) => ev((n) => T.frames(n), Math.round(s * 72));
  await ev(() => T.x(() => __house.chopDoor()));
  ok('isRaptor', await ev(() => T.x(() => __house.world.bear?.kind === 'raptor' && !!__house.world.raptor)));
  // recorder: events, per-frame state, clearance, steps
  await ev(() => T.x(() => {
    const H = __house; const R = H.world.bear; const crag = H.world.crag;
    const rec = (window.RR = { ev: [], frames: 0, hiddenFrames: 0, drawnHidden: 0, seenHidden: 0, maxExpDrawn: 0, minTrunk: 99, minTail: 99, offGround: 0, maxStep: 0, stepAt: null,
      states: {}, music: [], player: [], skipStep: 0, eyesMax: 0, clearBad: [] });
    for (const t of ['wake', 'hidden', 'call', 'rustle', 'growl', 'emerge', 'roar', 'telegraph', 'leap', 'land', 'strike', 'miss', 'knocked', 'hurt', 'stagger', 'death', 'reward', 'charge', 'leave'])
      R.on(t, (e) => rec.ev.push({ t, f: T.nFrame, st: R.state(), p: e?.position ? [+e.position.x.toFixed(2), +e.position.y.toFixed(2), +e.position.z.toFixed(2)] : null,
        ...(e && { kind: e.kind, damage: e.damage, shove: e.shove ? [+e.shove.x.toFixed(3), +e.shove.z.toFixed(3)] : undefined, reason: e.reason, at: e.at, why: e.why, zone: e.zone, killed: e.killed, intro: e.intro }) }));
    let last = null;
    T.onFrame.push(() => {
      if (!R.ready()) return;
      const d = R.debug(); rec.frames += 1; rec.states[d.state] = (rec.states[d.state] || 0) + 1;
      if (d.state === 'hidden') {
        rec.hiddenFrames += 1;
        if (d.drawn) { rec.drawnHidden += 1; rec.maxExpDrawn = Math.max(rec.maxExpDrawn, d.exposure); if (d.exposure > 0.5 || d.veil < 0.6) rec.seenHidden += 1; }
        rec.eyesMax = Math.max(rec.eyesMax, d.eyes);
      }
      if (!['den', 'gone'].includes(d.state)) {
        const c = R.clearance();
        if (d.state !== 'dead') {
          rec.minTrunk = Math.min(rec.minTrunk, c.trunk); rec.minTail = Math.min(rec.minTail, c.tail);
          if (!c.ground) rec.offGround += 1;
          if ((c.trunk < 0 || c.tail < 0.05 || !c.ground) && rec.clearBad.length < 12) rec.clearBad.push({ f: T.nFrame, st: d.state, x: d.x, z: d.z, yaw: d.yaw, ...c });
        }
      }
      if (last && rec.skipStep <= 0) { const st = Math.hypot(d.x - last.x, d.z - last.z); if (st > rec.maxStep) { rec.maxStep = st; rec.stepAt = { f: T.nFrame, st: d.state, clip: d.clip }; } }
      rec.skipStep -= 1; last = d;
      if (T.nFrame % 36 === 0) { const m = H.state().music; rec.music.push([T.nFrame, d.state, m?.mode, +(m?.fight ?? 0).toFixed(2), +(m?.woods ?? 0).toFixed(2)]); }
      const s = H.state(); rec.player.push([T.nFrame, +s.head[0].toFixed(3), +s.head[2].toFixed(3), +s.offset[1].toFixed(3)]); if (rec.player.length > 400) rec.player.shift();
    });
    // CPU cost of the raptor's update (wall clock, this machine): mean / worst
    const up = R.update; rec.cpu = { n: 0, sum: 0, max: 0 };
    R.update = (...a) => { const t = Date.now(); const r = up(...a); const ms = Date.now() - t; rec.cpu.n += 1; rec.cpu.sum += ms; rec.cpu.max = Math.max(rec.cpu.max, ms); return r; };
    // the tests teleport the raptor; don't count those frames as steps
    const dp = R.debugPlace; R.debugPlace = (...a) => { rec.skipStep = 2; return dp(...a); };
  }));
  // top out on the west lip of the summit, facing east into the woods
  const lip = await ev(() => T.x(() => { const c = __house.world.crag; const x = 4.0; const z = -0.4; const y = c.deckAt(x, z); __house.place(x, y, z); T.yawTo(-Math.PI / 2); return [x, y, z]; }));
  out.notes.lip = lip;
  let ready = false;
  for (let i = 0; i < 240 && !ready; i += 1) { await secs(1); ready = await ev(() => T.x(() => __house.world.bear.ready())); }
  ok('modelLoads', ready);
  const t0 = await ev(() => T.nFrame);
  // --- hidden intro: stand still at the lip until it comes out (or 25 s)
  for (let i = 0; i < 50; i += 1) { await secs(0.5); const st = await ev(() => T.x(() => __house.world.bear.state())); if (st === 'stalk') break; }
  let R = await ev(() => RR);
  const em = R.ev.find((e) => e.t === 'emerge'); const hid = R.ev.find((e) => e.t === 'hidden');
  const calls = R.ev.filter((e) => e.t === 'call' && e.f < (em?.f ?? 1e9));
  const distinct = []; for (const c of calls) if (!distinct.some((d) => Math.hypot(d[0] - c.p[0], d[2] - c.p[2]) < 2.5)) distinct.push(c.p);
  const hideSecs = em && hid ? (em.f - hid.f) / 72 : null;
  out.notes.hidden = { hideSecs, emergeAt: em?.at, reason: em?.reason, calls: calls.map((c) => c.p), rustles: R.ev.filter((e) => e.t === 'rustle' && e.f < (em?.f ?? 1e9)).length,
    hiddenFrames: R.hiddenFrames, drawnHidden: R.drawnHidden, seenHidden: R.seenHidden, maxExposureWhileDrawn: R.maxExpDrawn, eyesMax: R.eyesMax };
  ok('hiddenAbout15s', hideSecs != null && hideSecs > 13 && hideSecs < 19 && em.reason === 'time', { hideSecs, reason: em?.reason });
  ok('neverFullySeenWhileHidden', R.seenHidden === 0 && R.hiddenFrames > 72 * 12, { hiddenFrames: R.hiddenFrames, drawn: R.drawnHidden, seen: R.seenHidden, maxExp: R.maxExpDrawn });
  ok('callsFrom3Places', distinct.length >= 3, { calls: calls.length, distinct: distinct.length });
  ok('rustles', out.notes.hidden.rustles >= 3, out.notes.hidden.rustles);
  const roar = R.ev.find((e) => e.t === 'roar' && e.intro);
  ok('emergesWithRoar', !!em && !!roar && roar.f >= em.f, { emergeAt: em?.p, roarF: roar?.f });
  const mus = R.music.filter((m) => m[1] === 'hidden');
  const musEnd = mus[mus.length - 1];
  const fightMus = R.music.filter((m) => m[1] === 'stalk');
  ok('musicTension', mus.length > 5 && mus.every((m) => m[2] === 'hidden' || m[2] === 'wake') && musEnd[3] > 0.25 && mus[1][3] < musEnd[3], { first: mus[1], last: musEnd });
  out.notes.callSamples = (await ev(() => T.x(() => __house.bossSounds()))).filter((s) => /raptor_call|raptor_roar|raptor_growl/.test(s.name ?? s[0] ?? '')).length;

  // --- free fight 24 s: you walk to the middle of the arena; it should circle and attack on its own
  await ev(() => T.x(() => { RR.fightF = T.nFrame; }));
  await ev(() => T.go([[5.6, 0.2]]));
  await secs(24);
  R = await ev(() => RR);
  const fightEv = R.ev.filter((e) => e.f >= R.fightF);
  out.notes.freeFight = { strikes: fightEv.filter((e) => e.t === 'strike').map((e) => e.kind), telegraphs: fightEv.filter((e) => e.t === 'telegraph').map((e) => e.kind), misses: fightEv.filter((e) => e.t === 'miss').map((e) => e.kind), states: R.states };
  const mus2 = R.music.filter((m) => m[0] >= R.fightF + 72 * 4);
  ok('musicFight', mus2.length && mus2.every((m) => m[2] === 'fight') && mus2[mus2.length - 1][3] > 0.55, mus2[mus2.length - 1]);
  const kinds = new Set(fightEv.filter((e) => e.t === 'telegraph').map((e) => e.kind));
  ok('attacksOnItsOwn', fightEv.filter((e) => e.t === 'strike' || e.t === 'miss').length >= 3 && kinds.size >= 2, out.notes.freeFight);

  // --- leap you dodge: it crouches 5.5 m east of you, you step 1.4 m sideways during the crouch
  const leap = async (dodge) => {
    const r = await ev(async (dodge) => {
      const H = __house; const B = H.world.bear; const c = H.world.crag;
      await T.x(() => { const px = 5.0; const pz = 0.2; H.place(px, c.deckAt(px, pz), pz); B._s.hp = Math.max(B._s.hp, 60); B.debugPlace(px + 5.5, pz, -Math.PI / 2, 'stalk'); });
      await T.frames(10);
      const f0 = T.nFrame;
      await T.x(() => B.debugAttack('leap'));
      await T.frames(43);   // 0.6 s into the 0.8 s crouch: it has stopped aiming (hiss + crouch were the telegraph)
      if (dodge) { for (let i = 0; i < 36; i += 1) { await T.x(() => { const s = H.state(); H.place(s.offset[0], c.deckAt(s.offset[0], s.offset[2] + 0.04), s.offset[2] + 0.04); }); } }   // 1.44 m sideways in 0.5 s
      await T.frames(72 * 2.4);
      const evs = RR.ev.filter((e) => e.f >= f0);
      return { evs: evs.map((e) => `${e.t}:${e.kind ?? e.why ?? ''}`), state: B.state(), struck: evs.some((e) => e.t === 'strike' && e.kind === 'leap'), knocked: evs.some((e) => e.t === 'knocked'), landed: evs.some((e) => e.t === 'land'), raptor: [B.debug().x, B.debug().z] };
    }, dodge);
    return r;
  };
  const ld = await leap(true);
  ok('leapDodged', !ld.struck && ld.knocked && ld.landed, ld);
  await secs(3);
  const lh = await leap(false);
  ok('leapHitsIfYouStand', lh.struck, lh);
  await secs(3);

  // --- tackle at the cliff edge: you stand 0.8 m from the west lip, it charges from the east
  const tk = await ev(async () => {
    const H = __house; const B = H.world.bear; const c = H.world.crag;
    const px = 6.0; let ez = 0; while (ez > -12 && B.onDeck(px, ez, 0)) ez -= 0.02;   // the summit's south edge below the arena
    const pz = ez + 1.3;   // 1.3 m from the drop: a full 1.1 m shove would leave 0.2 m
    await T.x(() => { H.place(px, c.deckAt(px, pz), pz); B._s.hp = Math.max(B._s.hp, 60); B.debugPlace(px, pz + 4.2, Math.PI, 'stalk'); });
    await T.frames(10);
    const f0 = T.nFrame;
    await T.x(() => B.debugAttack('tackle'));
    await T.frames(72 * 2.5);
    const evs = RR.ev.filter((e) => e.f >= f0); const st = evs.find((e) => e.t === 'strike');
    const tr = RR.player.filter((p) => p[0] >= (st?.f ?? 1e9) - 2);
    let maxStep = 0; for (let i = 1; i < tr.length; i += 1) maxStep = Math.max(maxStep, Math.hypot(tr[i][1] - tr[i - 1][1], tr[i][2] - tr[i - 1][2]));
    const end = tr[tr.length - 1] ?? RR.player[RR.player.length - 1];
    let edgeGap = 0; while (edgeGap < 3 && B.onDeck(end[1], end[2], edgeGap + 0.02)) edgeGap += 0.02;
    return { edgeZ: +ez.toFixed(2), startZ: +pz.toFixed(2), strike: st && { kind: st.kind, shove: st.shove }, end: end && [end[1], end[2]], edgeGap: +edgeGap.toFixed(2), onDeck05: !!end && B.onDeck(end[1], end[2], 0.45), maxStep: +maxStep.toFixed(3), evs: evs.map((e) => e.t) };
  });
  ok('tackleEdgeSafe', tk.strike?.kind === 'tackle' && tk.onDeck05 && tk.edgeGap >= 0.48 && tk.maxStep < 0.12, tk);
  // and the same tackle in the open shoves you properly (so the edge case is really clamped, not just weak)
  const to = await ev(async () => {
    const H = __house; const B = H.world.bear; const c = H.world.crag; const px = 5.0; const pz = -0.2;
    await T.x(() => { H.place(px, c.deckAt(px, pz), pz); B.debugPlace(px + 4.2, pz, -Math.PI / 2, 'stalk'); });
    await T.frames(10); const f0 = T.nFrame; await T.x(() => B.debugAttack('tackle')); await T.frames(72 * 2.5);
    const st = RR.ev.find((e) => e.f >= f0 && e.t === 'strike'); return { strike: st && { kind: st.kind, shove: st.shove } };
  });
  const sl = (s) => (s ? Math.hypot(s[0], s[1]) : 0);
  ok('tackleShovesInOpen', to.strike?.kind === 'tackle' && sl(to.strike.shove) > sl(tk.strike?.shove) + 0.2, { open: to.strike?.shove, edge: tk.strike?.shove });
  await secs(2);

  // --- chase into the woods (north-east), 14 s of it following you between the trunks
  const chase = await ev(async () => {
    const H = __house; const B = H.world.bear; const c = H.world.crag;
    await T.x(() => { B._s.hp = Math.max(B._s.hp, 60); });
    const route = [[9.2, 3.6], [10.6, 5.2], [12.4, 4.4], [12.0, 2.2], [9.6, 2.6]];
    const res = [];
    for (const p of route) { res.push(await T.go([p], { speed: 0.9 })); }
    await T.frames(72 * 4);
    return { res: res.map((r) => r[0].ok), raptor: [B.debug().x, B.debug().z, B.state()] };
  });
  out.notes.chase = chase;
  // --- finish it: club to the head (knock-down), then arrows until it dies
  const kill = await ev(async () => {
    const H = __house; const B = H.world.bear; const c = H.world.crag;
    await T.x(() => { const px = 5.4; const pz = 0; H.place(px, c.deckAt(px, pz), pz); B.debugPlace(px + 2.6, pz, -Math.PI / 2, 'stalk'); B._s.lastAttack = B._s.clock; B._s.cool = 3; });
    await T.frames(20);
    const f0 = T.nFrame;
    const head = await T.x(() => B.zones.find((z) => z.userData.foeZone === 'head') ?? B.zones[0]);
    await T.x(() => B.hit('head', head.getWorldPosition(new head.position.constructor()), 'club', { speed: 24 }));
    await T.frames(12);
    const knocked = B.state();
    let n = 0;
    while (B.state() !== 'dead' && n < 40) { await T.x(() => B.hit(['chest', 'neck', 'body', 'head'][n % 4], null, 'arrow')); n += 1; await T.frames(36); }
    await T.frames(72 * 4);
    const claw = B.claw();
    return { knocked, arrows: n, state: B.state(), hp: B.hp(), claw: !!claw && claw.userData?.label, evs: RR.ev.filter((e) => e.f >= f0 && ['knocked', 'death', 'reward'].includes(e.t)).map((e) => e.t) };
  });
  ok('clubKnocksDown', kill.knocked === 'knocked', kill);
  ok('fightToDeath', kill.state === 'dead' && kill.evs.includes('death'), kill);
  ok('clawTrophy', kill.claw === 'raptor claw' && kill.evs.includes('reward'), kill.claw);
  R = await ev(() => RR);
  ok('neverInATrunk', R.minTrunk >= 0 && R.minTail >= 0.05, { minTrunk: R.minTrunk, minTail: R.minTail, bad: R.clearBad });
  ok('neverOffTheCliff', R.offGround === 0, { offGround: R.offGround });
  ok('noTeleportSteps', R.maxStep < 0.3, { maxStep: +R.maxStep.toFixed(3), at: R.stepAt });
  out.notes.states = R.states; out.notes.events = R.ev.length;
  out.notes.cpu = { meanMs: +(R.cpu.sum / Math.max(1, R.cpu.n)).toFixed(3), maxMs: R.cpu.max, ...(await ev(() => T.x(() => { const d = __house.world.bear.debug(); return { navBuildMs: d.navMs, gridBuildMs: d.gridMs, navDone: d.navDone }; }))) };
  console.log('cpu', JSON.stringify(out.notes.cpu));
  ok('noPageErrors', !logs.some((l) => l.startsWith('pageerror')), logs.slice(0, 8));
  out.logs = logs.slice(0, 30);
  out.sounds = await ev(() => T.x(() => __house.bossSounds().slice(-60)));
  await close();
}
// ---------------------------------------------------------------- ?legacy=bear
{
  const { ev, logs, close } = await boot(dist, 'legacy=bear');
  await ev(fs.readFileSync(new URL('./pagelib.js', import.meta.url), 'utf8'));
  const b = await ev(() => T.x(() => { const B = __house.world.bear; return { kind: B?.kind ?? 'bear', state: B?.state?.(), raptor: !!__house.world.raptor, den: B?.den?.() }; }));
  await ev(() => T.x(() => { const B = __house.world.bear; const d = B.den(); __house.place(d.x - 3, B.root.position.y, d.z); }));
  await ev(() => T.frames(72 * 6));
  const st = await ev(() => T.x(() => __house.world.bear.state()));
  ok('legacyBearBoots', b.kind === 'bear' && !b.raptor && !logs.some((l) => l.startsWith('pageerror')), { ...b, after: st, logs: logs.slice(0, 4) });
  await close();
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
const bad = Object.entries(out.checks).filter(([, v]) => !v).map(([k]) => k);
console.log(bad.length ? `FAILED: ${bad.join(', ')}` : `ALL ${Object.keys(out.checks).length} PASS`);
process.exit(bad.length ? 1 : 0);
