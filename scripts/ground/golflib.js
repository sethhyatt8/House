// In-page helpers for the golf grip checks (needs boot.mjs T.* and pagelib.js). Golf frame used throughout:
// target = -X (shots go west), the right-handed golfer faces -Z and stands south of the ball; up = +Y.
// Poses are given for the controller GRIP space (the fist), converted to the IWER ray pose through the
// device's own grip offset (measured from the live rig, so it is whatever IWER's Quest 3 profile says).
(() => {
  const H = __house; const TH = H.THREE; const xr = H.renderer.xr; const G = (window.G = {});
  const V = (a) => new TH.Vector3(a[0], a[1], a[2]);
  const arr = (v, d = 4) => [+v.x.toFixed(d), +v.y.toFixed(d), +v.z.toFixed(d)];
  G.ctrl = (side) => { for (let i = 0; i < 2; i += 1) { const c = xr.getController(i); if (c.userData.inputSource?.handedness === side) return c; } return null; };
  G.relCache = {};
  // ray -> grip transform of the emulated Touch Plus controller (constant per hand)
  G.rel = (side) => {
    const c = G.ctrl(side); const g = c.userData.grip;
    c.updateWorldMatrix(true, false); g.updateWorldMatrix(true, false);
    const m = c.matrixWorld.clone().invert().multiply(g.matrixWorld);
    G.relCache[side] = m; return m;
  };
  G.W = () => new TH.Matrix4().fromArray(T.W().toFloat32Array());
  // put the controller GRIP at world pose (pos, quat); takes effect on the next XR frame
  G.setGrip = (side, pos, quat) => {
    const rel = G.relCache[side] || G.rel(side);
    const qq = quat.isQuaternion ? quat : new TH.Quaternion(quat._x ?? quat.x, quat._y ?? quat.y, quat._z ?? quat.z, quat._w ?? quat.w);
    const pp = pos.isVector3 ? pos : new TH.Vector3(pos.x ?? pos[0], pos.y ?? pos[1], pos.z ?? pos[2]);
    const gw = new TH.Matrix4().compose(pp, qq, new TH.Vector3(1, 1, 1));
    const rayW = gw.multiply(rel.clone().invert());
    const local = G.W().invert().multiply(rayW);
    const p = new TH.Vector3(); const q = new TH.Quaternion(); const s = new TH.Vector3();
    local.decompose(p, q, s);
    __xr.controllers[side].position.set(p.x, p.y, p.z);
    __xr.controllers[side].quaternion.set(q.x, q.y, q.z, q.w);
  };
  // kit: 'golf' (driver, target -X) or 'hockey' (stick, target -Z: the north goal). G.R maps the golf frame
  // (target -X, right-handed golfer on +Z) into the kit's world frame.
  G.kitName = 'golf';
  G.R = new TH.Quaternion();
  G.useKit = (name) => {
    G.kitName = name;
    G.R = name === 'hockey' ? new TH.Quaternion().setFromAxisAngle(new TH.Vector3(0, 1, 0), -Math.PI / 2) : new TH.Quaternion();
  };
  G.golf = () => {
    if (G.kitName === 'golf') return H.world.golf;
    const h = H.world.hockey; const d = h.stick.userData.debug?.();
    return { face: d ? d.face : null, club: h.stick, green: { y: d ? d.floorY : 0 }, debug: () => h.stick.userData.debug?.(), ballState: null, hockey: h };
  };
  G.club = () => (G.kitName === 'golf' ? H.world.golf.club : H.world.hockey.stick);
  // contact constants of the 59e7c4b model driver (used when the build has no golf.debug())
  const MODEL_SOLE = [[-0.012, -1.0768, -0.0075], [-0.035, -1.099, 0.0243], [-0.019, -1.1188, 0.0617]];
  G.soles = () => {
    const g = G.golf(); const d = g.debug?.();
    if (d?.sole) return d.sole.map(V);
    const club = G.club(); club.updateWorldMatrix(true, false);
    return MODEL_SOLE.map((p) => V(p).applyMatrix4(club.matrixWorld));
  };
  G.ground = () => G.golf().green.y;
  // address measures from the live face frame
  G.measure = () => {
    const g = G.golf(); const f = g.face; const club = G.club();
    club.updateWorldMatrix(true, false);
    const a = V([f.shaft.a.x, f.shaft.a.y, f.shaft.a.z]); const b = V([f.shaft.b.x, f.shaft.b.y, f.shaft.b.z]);
    const Ri = G.R.clone().invert();
    const sd = b.clone().sub(a).normalize().applyQuaternion(Ri);
    const n = V([f.n.x, f.n.y, f.n.z]).applyQuaternion(Ri); const toe = V([f.toe.x, f.toe.y, f.toe.z]).applyQuaternion(Ri);
    const soles = G.soles(); const low = Math.min(...soles.map((p) => p.y));
    const nh = Math.hypot(n.x, n.z);
    const sh = Math.hypot(sd.x, sd.z);
    const d = g.debug?.() || {};
    return {
      lie: +(Math.asin(Math.min(1, -sd.y)) * 180 / Math.PI).toFixed(2), // shaft angle above the ground
      shaftFromVertical: +(Math.acos(Math.min(1, -sd.y)) * 180 / Math.PI).toFixed(2),
      shaftYaw: sh > 1e-3 ? +(Math.atan2(sd.x, -sd.z) * 180 / Math.PI).toFixed(1) : null, // 0 = shaft runs toward -Z (away from a RH golfer)
      faceYaw: +(Math.atan2(n.z, -n.x) * 180 / Math.PI).toFixed(2), // 0 = square to target (-X); + = face points toward +Z
      faceToTarget: +(Math.acos(Math.max(-1, Math.min(1, -n.x / (nh || 1)))) * 180 / Math.PI).toFixed(2),
      loft: +(Math.atan2(n.y, nh) * 180 / Math.PI).toFixed(2),
      toeTilt: +(Math.asin(Math.max(-1, Math.min(1, toe.y))) * 180 / Math.PI).toFixed(2), // 0 = sole flat along the toe
      soleAboveGround: +(low - G.ground()).toFixed(4),
      faceC: arr(f.c), n: arr(n, 3), shaftDir: arr(sd, 3), grip: arr(a),
      ext: d.ext ?? null, twoHand: d.twoHand ?? null, mode: d.mode ?? 'old',
    };
  };
  // the club relative to the grip space and to the ray space of the hand holding it
  G.inHand = () => {
    const club = G.club(); const hand = club.parent; if (!hand?.userData?.grip) return null;
    hand.updateWorldMatrix(true, false); hand.userData.grip.updateWorldMatrix(true, false); club.updateWorldMatrix(true, false);
    const out = {};
    for (const [k, frame] of [['grip', hand.userData.grip], ['ray', hand]]) {
      const m = frame.matrixWorld.clone().invert().multiply(club.matrixWorld);
      const p = new TH.Vector3(); const q = new TH.Quaternion(); const s = new TH.Vector3(); m.decompose(p, q, s);
      const shaft = new TH.Vector3(0, -1, 0).applyQuaternion(q); const faceN = new TH.Vector3(1, 0, 0).applyQuaternion(q);
      out[k] = { holdPoint: arr(p), shaft: arr(shaft, 3), faceN: arr(faceN, 3) };
    }
    return out;
  };
  // anatomical address pose of a fist (see golfgrip.mjs): back of the right hand away from the target, forearm
  // hanging `hang` degrees off vertical toward the ball; the ray (pointing) direction stands in for the forearm.
  // anatomical address pose of a fist (see golfgrip.mjs): for a right-handed golfer the back of the right hand and
  // the palm of the left face away from the target (grip +X = +X world for both), forearm hanging `hang` degrees off
  // vertical toward the ball; the ray (pointing) direction stands in for the forearm. A left-handed golfer is the
  // mirror image through the target line (z -> -z) of the right-handed golfer's other hand.
  G.anatomy = (side, hang = 17, lefty = false) => {
    const solveSide = lefty ? (side === 'left' ? 'right' : 'left') : side;
    const rel = G.relCache[solveSide] || G.rel(solveSide);
    const relQ = new TH.Quaternion(); rel.decompose(new TH.Vector3(), relQ, new TH.Vector3());
    const rf = new TH.Vector3(0, 0, -1).applyQuaternion(relQ.clone().invert()); // ray forward in grip coords
    const want = new TH.Vector3(0, -Math.cos(hang * Math.PI / 180), -Math.sin(hang * Math.PI / 180));
    let best = null;
    for (let i = 0; i < 3600; i += 1) {
      const phi = (i / 3600) * Math.PI * 2;
      const X = new TH.Vector3(1, 0, 0); const Y = new TH.Vector3(0, Math.cos(phi), Math.sin(phi)); const Z = new TH.Vector3().crossVectors(X, Y);
      const q = new TH.Quaternion().setFromRotationMatrix(new TH.Matrix4().makeBasis(X, Y, Z));
      const w = rf.clone().applyQuaternion(q); w.x = 0; w.normalize();
      const err = w.angleTo(want);
      if (!best || err < best.err) best = { err, q };
    }
    let q = best.q;
    if (lefty) {
      const m = new TH.Matrix4().makeRotationFromQuaternion(q);
      const r = new TH.Matrix4().makeScale(1, 1, -1).multiply(m).multiply(new TH.Matrix4().makeScale(-1, 1, 1));
      q = new TH.Quaternion().setFromRotationMatrix(r);
    }
    return G.R.clone().multiply(q);
  };
  G.resetBall = () => {
    const g = G.golf();
    if (g.resetBall) { g.resetBall(); return; }
    const b = g.ballState; const y = g.green.y + 0.042 + 0.02135;
    b.p.x = -0.42; b.p.y = y; b.p.z = 0.02; b.v.x = b.v.y = b.v.z = 0; b.w.x = b.w.y = b.w.z = 0; b.asleep = false;
  };
  G.ball = () => { const b = G.golf().ballState; return { p: arr(b.p), v: arr(b.v, 3), w: arr(b.w, 2) }; };
  // A rigid swing: the address grip pose rotated about `axis` through `pivot` by angle(t). The club comes through the
  // address pose at t = tHit. Records face/ball per frame. Returns a promise of the record.
  G.swing = ({ side, pos, quat, pivot, axis, omega, from, to, phase = 0, frames = 400, follow = 150, extra = null }) => new Promise((res) => {
    const rec = { frames: [], strikeFrame: null }; let k = 0; const pv = V(pivot); const ax = V(axis).normalize();
    const p0 = V(pos); const q0 = new TH.Quaternion(quat.x, quat.y, quat.z, quat.w);
    const dt = 1 / 72; let ang = from - phase * omega * dt;
    const g = G.golf(); let after = 0; let prevFace = null;
    const pose = (a) => {
      const r = new TH.Quaternion().setFromAxisAngle(ax, a);
      return { p: p0.clone().sub(pv).applyQuaternion(r).add(pv), q: r.multiply(q0.clone()) };
    };
    const h = () => {
      const f = g.face; const b = g.ballState;
      const fc = V([f.c.x, f.c.y, f.c.z]);
      const hv = prevFace ? fc.clone().sub(prevFace).multiplyScalar(72).length() : 0; prevFace = fc;
      const bs = Math.hypot(b.v.x, b.v.y, b.v.z);
      rec.frames.push({ k, ang: +ang.toFixed(4), face: arr(fc), hv: +hv.toFixed(2), ball: arr(b.p), bv: +bs.toFixed(2), ...(extra ? extra() : {}) });
      if (rec.strikeFrame == null && bs > 1.5) rec.strikeFrame = k;
      k += 1;
      if (rec.strikeFrame != null || ang > to) after += 1;
      if (ang <= to) { ang += omega * dt; const ps = pose(ang); G.setGrip(side, ps.p, ps.q); }
      if (k >= frames || after > follow) { T.onFrame.splice(T.onFrame.indexOf(h), 1); res(rec); }
    };
    const ps = pose(ang); G.setGrip(side, ps.p, ps.q);
    T.onFrame.push(h);
  });
})();
