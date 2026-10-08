// Overlook pass: topping out of a climb that has a lip (crag.js ladder.userData.lip). The old crag snapped you onto
// the deck only when your feet reached deck - 0.45 m, which the holds could never get you to; you ended up hanging with
// your head just over the edge, and walking over the top left the climb state set (no stick, no snap turn).
//
// Haul over when, still on the line:
//   - you hold the lip and pull until your head is over it, or
//   - your head is 20 cm over the lip on any hold (eyes over the edge: you can't hang any higher), or
//   - you lean (or walk) your head out over the top.
// Then: a 0.6 s eased lift (up first, then forward onto the summit), a strong pulse on both hands at the start and a
// softer one on landing. The climb is released before the lift; the grip that was holding can't re-grab a hold until
// you let go of it.
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createTopout({ getClimb, head, feet, shiftPlayer, leaveClimb, pulse, setStatus, controllers, setActive }) {
  let m = null;
  let hinted = false;

  function check() {
    const climb = getClimb();
    const lip = climb?.ladder?.userData?.lip;
    if (!lip) { hinted = false; return; }
    const h = head();
    if (h.z < lip.z0 - 0.6 || h.z > lip.z1 + 0.6 || h.x < lip.x - 1.1) return;
    const over = h.y - lip.y;
    const leaning = h.x > lip.x - 0.1 && over > -0.05;
    if ((climb.hand && climb.onLip && over >= 0.05) || over >= 0.2 || leaning) {
      start(h, lip, climb.onLip ? 'lip' : leaning ? 'lean' : 'reach');
      return;
    }
    if (!hinted && climb.hand && !climb.onLip && over > -1.0) {
      hinted = true;
      setStatus('The lip is just above you. Grab the top edge and pull down to haul yourself over.');
    }
  }

  function start(h, lip, how) {
    const toZ = clamp(h.z, lip.z0 + 0.25, lip.z1 - 0.25);
    m = {
      t: 0,
      dur: 0.6,
      how,
      fromX: h.x,
      fromZ: h.z,
      fromY: feet(),
      toX: Math.max(h.x, lip.spot.x),
      toZ,
      toY: lip.spot.y,
      x: h.x,
      z: h.z,
      landed: false,
    };
    hinted = false;
    leaveClimb();
    for (const c of controllers()) c.userData.noRegrab = true;
    pulse(0.9, 90);
    setStatus('You haul yourself over the lip.');
    setActive(m);
  }

  function step(dt) {
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    const up = ease(k / 0.6);
    const fwd = ease((k - 0.35) / 0.65);
    const x = m.fromX + (m.toX - m.fromX) * fwd;
    const z = m.fromZ + (m.toZ - m.fromZ) * fwd;
    const y = m.fromY + (m.toY - m.fromY) * up;
    // only the scripted path moves you; your own head motion during the lift is kept
    shiftPlayer(x - m.x, y - feet(), z - m.z);
    m.x = x;
    m.z = z;
    if (!m.landed && k > 0.62) { m.landed = true; pulse(0.35, 30); }
    if (k >= 1) {
      pulse(0.55, 45);
      setStatus('On top of the crag. The woods start behind you.');
      m = null;
      setActive(null);
    }
  }

  return {
    update(dt) {
      if (m) step(Math.min(dt, 0.05));
      else check();
    },
    active: () => !!m,
    state: () => m,
  };
}
