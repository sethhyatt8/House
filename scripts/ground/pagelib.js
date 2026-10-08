// In-page helpers for the dynamic ground/boat checks (needs boot.mjs T.* and probe.js GT.*).
// Everything that touches the game runs inside the XR frame callback (IWER enforces XRFrame lifetimes):
// T.x(fn) queues fn for the next XR frame (runs right after the game frame), T.onFrame hooks run every XR frame.
(() => {
  const H = __house;
  if (H.world.croc) H.world.croc.update = () => {}; // keep the croc out of the measurements
  const r = H.renderer; const cam = H.world.camera;
  if (!window.__RENDER) r.render = () => { r.xr.updateCamera(cam); }; // physics only: skip drawing (swiftshader is ~1 fps)
  window.__vt = performance.now();
  T.q = []; T.onFrame = []; T.nFrame = 0;
  H.setFrameHook(() => {
    T.nFrame += 1;
    if (window.__vt != null) window.__vt += 1000 / 72; // virtual clock: every XR frame is exactly 1/72 s of game time
    for (const h of T.onFrame.slice()) { try { h(); } catch (e) { T.err = String(e); } }
    for (const task of T.q.splice(0)) { try { task.resolve(task.fn()); } catch (e) { task.reject(e); } }
  });
  T.x = (fn) => new Promise((resolve, reject) => T.q.push({ fn, resolve, reject }));
  T.frames = (n) => new Promise((res) => { const end = T.nFrame + n; const h = () => { if (T.nFrame >= end) { T.onFrame.splice(T.onFrame.indexOf(h), 1); res(); } }; T.onFrame.push(h); });
  T.settle = (n = 12) => T.frames(n);
  T.rows = []; T.recOn = false; T.tag = '';
  T.onFrame.push(() => {
    if (!T.recOn) return;
    const s = H.state(); const feet = s.offset[1]; const [hx, hy, hz] = s.head;
    const gt = GT.floor(hx, hz, feet + 0.6, feet - 3);
    const model = H.groundModel.groundUnder(hx, hz, feet);
    T.rows.push([T.tag, T.nFrame, +hx.toFixed(3), +hz.toFixed(3), +feet.toFixed(3), +(hy - feet).toFixed(3), gt == null ? null : +gt.toFixed(3), +model.toFixed(3), s.aboard ? 1 : 0, s.climb ? 1 : 0, +H.fall().toFixed(2), H.world.lift?.moving ? 1 : 0]);
  });
  T.st = () => T.x(() => H.state());
  // stick autopilot through waypoints [x, z]; resolves {ok} or {ok:false, stuckAt}
  T.walk = (pts, { frames = 900, tol = 0.14, speed = 1 } = {}) => new Promise((res) => {
    let i = 0; const f0 = T.nFrame; let lastProg = f0; let best = Infinity;
    const h = () => {
      const done = (v) => { T.stick('left', 0, 0); T.onFrame.splice(T.onFrame.indexOf(h), 1); res(v); };
      const s = H.state(); const [hx, , hz] = s.head; const p = pts[i]; const dx = p[0] - hx; const dz = p[1] - hz; const d = Math.hypot(dx, dz);
      if (d < tol) {
        i += 1; best = Infinity; lastProg = T.nFrame;
        if (i >= pts.length) { done({ ok: true, at: [+hx.toFixed(2), +hz.toFixed(2)] }); return; }
        return;
      }
      if (d < best - 0.02) { best = d; lastProg = T.nFrame; }
      if (T.nFrame - lastProg > 60) { done({ ok: false, stuckAt: [+hx.toFixed(2), +hz.toFixed(2)], feet: +s.offset[1].toFixed(2), target: p, leg: i, why: H.walker.walkable(hx + dx / d * 0.08, hz + dz / d * 0.08, s.offset[1]).why }); return; }
      if (T.nFrame - f0 > frames) { done({ ok: false, timeout: true, at: [hx, hz], leg: i }); return; }
      T.yawTo(Math.atan2(-dx, -dz)); T.stick('left', 0, -Math.min(1, speed * (0.35 + d)));
    };
    T.onFrame.push(h);
  });
})();
// Path planning over the walker's own reachability (10 cm grid, built lazily around a level): T.go([[x,z],...]) walks
// to each target along a BFS path through cells the walker accepts, so routes don't depend on hand-picked waypoints.
(() => {
  const H = __house; const S = 0.1;
  T.plan = (from, to, feet) => {
    const k = (i, j) => `${i},${j}`;
    const si = Math.round(from[0] / S); const sj = Math.round(from[1] / S);
    const ti = Math.round(to[0] / S); const tj = Math.round(to[1] / S);
    const prev = new Map(); const g = new Map(); const q = [[si, sj]]; prev.set(k(si, sj), null); g.set(k(si, sj), feet);
    let found = null; let n = 0;
    while (q.length && n < 60000) {
      const [i, j] = q.shift(); n++;
      if (Math.abs(i - ti) <= 1 && Math.abs(j - tj) <= 1) { found = [i, j]; break; }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const kk = k(i + di, j + dj); if (prev.has(kk)) continue;
        const w = H.walker.walkable((i + di) * S, (j + dj) * S, g.get(k(i, j)));
        if (!w.ok) continue;
        // keep a body width off walls: all 4 neighbours of the next cell must be walkable too
        prev.set(kk, k(i, j)); g.set(kk, w.ground); q.push([i + di, j + dj]);
      }
    }
    if (!found) return null;
    const path = []; let c = k(found[0], found[1]);
    while (c != null) { const [i, j] = c.split(',').map(Number); path.push([i * S, j * S]); c = prev.get(c); }
    path.reverse();
    const out = []; for (let p = 4; p < path.length; p += 4) out.push(path[p]); out.push(to);
    return out;
  };
  T.go = async (targets, opts = {}) => {
    const results = [];
    for (const tgt of targets) {
      const s = await T.st();
      const path = await T.x(() => T.plan([s.head[0], s.head[2]], tgt, s.offset[1]));
      if (!path) { results.push({ to: tgt, ok: false, why: 'no path' }); continue; }
      const r = await T.walk(path, { frames: 200 + path.length * 40, ...opts });
      results.push({ to: tgt, ...r });
    }
    return results;
  };
})();
(() => { T.onFrame.push(() => { if (T.follow) for (const [side, fn] of Object.entries(T.follow)) T.hand(side, fn()); }); })();
