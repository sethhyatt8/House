// In-page swim helpers (needs boot.mjs T.* and pagelib.js). Hands are placed in the BODY frame: head position +
// head yaw (x right, y up, z back), so the body gliding forward doesn't move the hands relative to the body.
(() => {
  const H = __house; const TH = H.THREE;
  T.headPose = () => { const m = new TH.Matrix4().fromArray(H.cameraMatrix()); const p = new TH.Vector3().setFromMatrixPosition(m); const f = new TH.Vector3(0, 0, -1).transformDirection(m); return { p, yaw: Math.atan2(-f.x, -f.z), pitch: Math.asin(Math.max(-1, Math.min(1, f.y))) }; };
  T.bodyToWorld = (l, pose = T.headPose()) => { const c = Math.cos(pose.yaw); const s = Math.sin(pose.yaw); const x = l[0] * c + l[2] * s; const z = -l[0] * s + l[2] * c; return [pose.p.x + x, pose.p.y + l[1], pose.p.z + z]; };
  T.setHands = (lr, ll) => { const pose = T.headPose(); T.hand('right', T.bodyToWorld(lr, pose)); T.hand('left', T.bodyToWorld(ll, pose)); };
  const lerp = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
  const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
  // one breaststroke: drive from `from` to `to` (right hand; left mirrored in x) over `secs`, optional grip, then a
  // streamlined recovery (hands in to the chest, then forward) over `rec` seconds with the grips released.
  T.stroke = async ({ from = [0.25, -0.35, -0.5], to = [0.35, -0.4, 0.1], secs = 0.55, grip = false, rec = 0.9, mid = [0.08, -0.2, -0.12], hands = 'both' } = {}) => {
    const m = (p) => [-p[0], p[1], p[2]];
    const put = (p) => { const rest = [0.2, -0.45, -0.25]; T.setHands(hands === 'left' ? rest : p, hands === 'right' ? m(rest) : m(p)); };
    put(from); await T.frames(3);
    if (grip) { T.btn('left', 'squeeze', 1); T.btn('right', 'squeeze', 1); }
    const n = Math.max(2, Math.round(secs * 72));
    for (let i = 1; i <= n; i++) { put(lerp(from, to, ease(i / n))); await T.frames(1); }
    if (grip) { T.btn('left', 'squeeze', 0); T.btn('right', 'squeeze', 0); }
    const r = Math.max(2, Math.round(rec * 72)); const h = Math.round(r * 0.45);
    for (let i = 1; i <= h; i++) { put(lerp(to, mid, ease(i / h))); await T.frames(1); }
    for (let i = 1; i <= r - h; i++) { put(lerp(mid, from, ease(i / (r - h)))); await T.frames(1); }
  };
  T.idleHands = () => T.setHands([0.2, -0.45, -0.25], [-0.2, -0.45, -0.25]);
  T.sw = () => { const s = H.state(); return { head: s.head.map((v) => +v.toFixed(3)), feet: +s.offset[1].toFixed(3), swim: s.swim, aboard: s.aboard, status: s.status.slice(0, 90) }; };
  T.waitFor = (fn, maxFrames) => new Promise((res) => { let k = 0; const h = () => { k++; let ok = false; try { ok = fn(); } catch { /**/ } if (ok || k >= maxFrames) { T.onFrame.splice(T.onFrame.indexOf(h), 1); res({ ok, frames: k, s: +(k / 72).toFixed(2) }); } }; T.onFrame.push(h); });
  T.surf = (x, z) => (H.world.underwater ? H.world.underwater.surfaceAt(x, z) : H.waterY);
  T.floor = (x, z) => (H.world.underwater ? H.world.underwater.floorAt(x, z) : null);
})();
