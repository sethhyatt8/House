// In-page climber (needs boot.mjs T.* + pagelib.js T.x/T.frames). Body model: a hand can reach a hold between
// feet + LOW and head + REACH, and a pull moves the hand down (in the headset's local space, i.e. relative to the
// feet) 4 cm per frame until it is LOW above the feet. Then the other hand grabs the highest hold in reach.
(() => {
  const H = __house; const V = H.THREE.Vector3;
  const holdsOf = (L) => L.children.filter((c) => c.userData.type === 'rung').map((c) => c.getWorldPosition(new V()));
  T.climbBot = async (L, { low = 0.8, reach = 0.55, maxGrabs = 140, eye = 1.6, leanAtTop = false } = {}) => {
    const out = { grabs: 0, trace: [], result: null };
    let hand = 'right'; let holding = null; let lastFeet = -999; let still = 0;
    for (let i = 0; i < maxGrabs; i++) {
      const s = await T.st();
      if (!s.climb && i > 0) { out.result = 'released'; break; }
      const feet = s.offset[1]; const head = s.head;
      const hs = holdsOf(L).filter((p) => p.y > feet + low + 0.05 && p.y < head[1] + reach && Math.abs(p.z - head[2]) < 0.75).sort((a, b) => b.y - a.y);
      const h = hs[0];
      if (!h) { out.result = 'no hold in reach'; out.at = { feet, head }; break; }
      await T.x(() => T.hand(hand, [h.x, h.y, h.z]));
      await T.frames(1);
      await T.x(() => T.btn(hand, 'squeeze', 1));
      await T.frames(2);
      if (holding) { await T.x(() => { T.btn(holding, 'squeeze', 0); const c = __xr.controllers[holding].position; c.set(c.x, 1.0, c.z); }); }
      await T.frames(1);
      out.grabs++;
      holding = hand;
      // pull down
      for (let k = 0; k < 60; k++) {
        const done = await T.x(() => { const c = __xr.controllers[hand].position; if (c.y <= low) return true; c.set(c.x, Math.max(low, c.y - 0.04), c.z); return false; });
        await T.frames(1);
        const s2 = await T.st();
        if (!s2.climb || done) break;
      }
      const s3 = await T.st();
      out.trace.push([i, +s3.offset[1].toFixed(2), +s3.head[0].toFixed(2), +s3.head[2].toFixed(2), s3.climb ? 1 : 0, s3.status.slice(0, 48)]);
      if (!s3.climb) { out.result = 'released'; break; }
      if (Math.abs(s3.offset[1] - lastFeet) < 0.01) { if (++still >= 3) { out.result = 'stuck'; out.at = { feet: s3.offset[1], head: s3.head }; break; } } else still = 0;
      lastFeet = s3.offset[1];
      hand = hand === 'right' ? 'left' : 'right';
    }
    if (leanAtTop && (await T.st()).climb) {
      // lean the head 0.35 m toward the wall (+X) while still holding
      for (let k = 0; k < 10; k++) { await T.x(() => { const p = __xr.position; const s = H.state(); const l = T.toLocal([s.head[0] + 0.035, s.head[1], s.head[2]]); p.set(l[0], l[1], l[2]); }); await T.frames(1); }
      out.leaned = true;
    }
    await T.frames(60); // let a mantle finish
    await T.x(() => { T.btn('left', 'squeeze', 0); T.btn('right', 'squeeze', 0); });
    await T.frames(20);
    const a = await T.st();
    out.after = { feet: +a.offset[1].toFixed(3), head: a.head.map((v) => +v.toFixed(2)), climb: a.climb, status: a.status, ground: +H.groundModel.groundUnder(a.head[0], a.head[2], a.offset[1]).toFixed(3), walk: H.walker.walkable(a.head[0], a.head[2], a.offset[1]) };
    // stick forward 1.2 s (toward +X, the way the wall faced), then snap turn
    await T.x(() => T.yawTo(-Math.PI / 2));
    const b0 = await T.st();
    await T.x(() => T.stick('left', 0, -1)); await T.frames(86); await T.x(() => T.stick('left', 0, 0)); await T.frames(3);
    const b1 = await T.st();
    await T.x(() => T.stick('right', 1, 0)); await T.frames(5); await T.x(() => T.stick('right', 0, 0)); await T.frames(5);
    const b2 = await T.st();
    out.moved = +Math.hypot(b1.head[0] - b0.head[0], b1.head[2] - b0.head[2]).toFixed(2);
    out.turned = +(b2.yaw - b1.yaw).toFixed(3);
    out.end = { feet: +b2.offset[1].toFixed(3), head: b2.head.map((v) => +v.toFixed(2)), climb: b2.climb };
    return out;
  };
})();
