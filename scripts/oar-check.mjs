// node scripts/oar-check.mjs   (ground/boat pass; add ?-style flags as argv, e.g. `node scripts/oar-check.mjs oars=old`)
// Drives the real canoe.js long oars with scripted hands (no browser): the oar turns only about its ring, the blade
// bites by submerged area x speed, and the boat goes the way the hands push.
//   push       both hands push forward with blades in, lift-and-return out of the water -> boat moves FORWARD (bow)
//   pull       both hands pull back with blades in, recover out of the water             -> boat moves BACKWARD
//   recovery   hands sweep forward and back with the blades held out of the water        -> no thrust
//   starboard  starboard oar alone pushing forward                                        -> bow turns to port (away)
//   port       port oar alone                                                              -> bow turns to starboard
//   hard/soft  same stroke at 1.0x and 0.5x hand speed                                    -> speed roughly 2:1
//   twist      the controller rolls 360 deg about the shaft mid-stroke                    -> blade face unchanged
//   clip       sweep every hand position on a grid: handle never under the hull floor, into the rower, or through
//              the other oar; blade samples never inside the hull
const ctx2d = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? () => {} : undefined) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.location = { search: '?' + process.argv.slice(2).join('&') };
globalThis.window = { innerWidth: 800, innerHeight: 600, addEventListener() {} };
const THREE = await import('three');
const { createCanoe } = await import('../src/canoe.js');

const LEVEL = -8;
function makeBoat() {
  const scene = new THREE.Scene();
  const cave = { x0: 10, x1: 12, z0: -3, z1: 3, z: 0, floor: -7.92, boatX: 0, shallows: null };
  const canoe = createCanoe(scene, [], cave, null, { level: LEVEL, ground: () => -Infinity, ocean: null });
  canoe.group.position.set(0, LEVEL, 0);
  canoe.setAboard(true);
  for (let i = 0; i < 30; i += 1) canoe.update(1 / 60, true);
  const hands = { starboard: new THREE.Object3D(), port: new THREE.Object3D() };
  Object.values(hands).forEach((h) => { h.userData = {}; scene.add(h); });
  return { scene, canoe, hands };
}
const v = new THREE.Vector3();
// put a hand at a boat-frame point
function handAt(b, side, x, y, z) { v.set(x, y, z); b.canoe.group.localToWorld(v); b.hands[side].position.copy(v); b.hands[side].updateMatrixWorld(true); }
function grab(b, side) {
  const o = b.canoe.longOars.find((oar) => oar.name === side);
  handAt(b, side, o.end.x, o.end.y, o.end.z);
  const p = new THREE.Vector3(); b.hands[side].getWorldPosition(p);
  return b.canoe.tryOar(b.hands[side], [p]);
}
// stroke: handle end moves in the boat frame from zA to zB (z: - = toward the bow) at height dIn (blades in) and
// comes back at height dOut (blades out). speed = metres per second of the hand.
function row(b, sides, { strokes = 8, zA = -0.15, zB = -0.75, speed = 0.9, dIn = 0.0, dOut = -0.2, reverse = false, outBoth = false, twist = 0 }) {
  const dt = 1 / 60;
  const yaw0 = b.canoe.group.rotation.y; const p0 = b.canoe.group.position.clone();
  const x = { starboard: 0.12, port: -0.12 };
  const base = {}; sides.forEach((s) => { base[s] = b.canoe.longOars.find((o) => o.name === s).P.y; });
  const legs = reverse ? [[zB, zA, dIn], [zA, zB, dOut]] : [[zA, zB, dIn], [zB, zA, dOut]];
  let t = 0; let maxForce = 0;
  for (let k = 0; k < strokes; k += 1) {
    for (const [from, to, d0] of legs) {
      const d = outBoth ? dOut : d0;
      const n = Math.max(2, Math.round(Math.abs(to - from) / speed / dt));
      const lastD = legs[(legs.findIndex((l) => l[0] === from) + 1) % 2][2];
      const prevD = outBoth ? dOut : lastD;
      for (let i = 0; i <= n; i += 1) {
        const z = from + (to - from) * (i / n);
        const ease = Math.min(1, i / 8); // hands drop in / lift out over ~0.13 s
        const dd = prevD + (d - prevD) * ease;
        sides.forEach((s) => {
          handAt(b, s, x[s], base[s] + dd, z);
          if (twist) { b.hands[s].quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), twist * t); b.hands[s].updateMatrixWorld(true); }
        });
        b.canoe.update(dt, true); t += dt;
        b.canoe.longOars.forEach((o) => { maxForce = Math.max(maxForce, o.force); });
      }
    }
  }
  for (let i = 0; i < 30; i += 1) b.canoe.update(dt, true);
  const yaw = b.canoe.group.rotation.y;
  const fwd = new THREE.Vector3(-Math.sin(yaw0), 0, -Math.cos(yaw0)); // bow direction at the start
  const d = b.canoe.group.position.clone().sub(p0);
  return { forward: +d.dot(fwd).toFixed(3), side: +(d.x * fwd.z - d.z * fwd.x).toFixed(3), turnDeg: +((yaw - yaw0) * 180 / Math.PI).toFixed(1), maxForce: +maxForce.toFixed(0) };
}
function fresh(sides) { const b = makeBoat(); sides.forEach((s) => { if (!grab(b, s)) throw new Error('could not take ' + s); }); return b; }
const res = {};
res.push = row(fresh(['starboard', 'port']), ['starboard', 'port'], {});
res.pull = row(fresh(['starboard', 'port']), ['starboard', 'port'], { reverse: true });
res.recovery = row(fresh(['starboard', 'port']), ['starboard', 'port'], { outBoth: true });
res.starboard = row(fresh(['starboard']), ['starboard'], {});
res.port = row(fresh(['port']), ['port'], {});
res.hard = row(fresh(['starboard', 'port']), ['starboard', 'port'], { speed: 1.0, strokes: 10 });
res.soft = row(fresh(['starboard', 'port']), ['starboard', 'port'], { speed: 0.5, strokes: 5 });
// face stays square while the wrist rolls (only the hand position drives the oar)
{
  const b = fresh(['starboard', 'port']); const normals = [];
  const o = b.canoe.longOars.find((oar) => oar.name === 'starboard');
  for (let i = 0; i < 120; i += 1) {
    handAt(b, 'starboard', 0.12, o.P.y, -0.4); b.hands.starboard.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), i * 0.11); b.hands.starboard.updateMatrixWorld(true);
    handAt(b, 'port', -0.12, o.P.y, -0.4);
    b.canoe.update(1 / 60, true); if (i >= 20) normals.push(o.normal.clone());
  }
  const dev = Math.max(...normals.map((n) => n.angleTo(normals[0])));
  res.twist = { maxFaceChangeDeg: +(dev * 180 / Math.PI).toFixed(2) };
}
// clip sweep: every hand position on a grid (boat frame), both oars held
{
  const b = fresh(['starboard', 'port']); const bad = []; let n = 0;
  const [st, pt] = ['starboard', 'port'].map((s) => b.canoe.longOars.find((o) => o.name === s));
  const seat = { y: 0.24, z: 0.02 };
  const seg = (o, u) => o.end.clone().addScaledVector(o.axis, u);
  for (let hx = -0.5; hx <= 0.5001; hx += 0.1) for (let hy = -0.2; hy <= 0.9; hy += 0.1) for (let hz = -1.2; hz <= 0.5; hz += 0.1) {
    handAt(b, 'starboard', hx, hy, hz); handAt(b, 'port', -hx, hy, hz + 0.05);
    for (let i = 0; i < 3; i += 1) b.canoe.update(1 / 60, true);
    n += 1;
    for (const o of [st, pt]) {
      if (o.end.y < 0.08) bad.push({ why: 'handle under the hull floor', o: o.name, h: [hx, hy, hz], y: +o.end.y.toFixed(2) });
      if (o.end.z > seat.z - 0.1 && o.end.y < 1.3) bad.push({ why: 'handle in the rower', o: o.name, h: [hx, hy, hz], z: +o.end.z.toFixed(2) });
      for (let u = 0.6; u <= 2.1; u += 0.1) { // outboard of the ring: never inside the hull box (|x| < 0.45, y < 0.22)
        const p = seg(o, u); if (Math.abs(p.x) < 0.44 && p.y < 0.22 && Math.abs(p.z) < 1.7) { bad.push({ why: 'shaft through the hull', o: o.name, h: [hx, hy, hz], u }); break; }
      }
    }
    // inboard shafts: closest distance
    let gap = Infinity;
    for (let a = 0; a <= 1.0001; a += 0.1) { const pa = seg(st, a * 0.55); for (let c = 0; c <= 1.0001; c += 0.1) gap = Math.min(gap, pa.distanceTo(seg(pt, c * 0.55))); }
    if (gap < 0.035) bad.push({ why: 'oar through oar', h: [hx, hy, hz], gap: +gap.toFixed(3) });
  }
  res.clip = { poses: n, problems: bad.length, first: bad.slice(0, 5) };
}
const ratio = res.soft.forward !== 0 ? res.hard.forward / res.soft.forward : 0;
const checks = {
  pushForward: res.push.forward > 1.0,
  pullBackward: res.pull.forward < -1.0,
  recoveryNone: Math.abs(res.recovery.forward) < 0.05 && Math.abs(res.recovery.turnDeg) < 1,
  pushStraight: Math.abs(res.push.turnDeg) < 3,
  starboardTurnsToPort: res.starboard.turnDeg > 10,
  portTurnsToStarboard: res.port.turnDeg < -10,
  hardVsSoft: ratio > 1.4 && ratio < 3.2,
  faceHeld: res.twist.maxFaceChangeDeg < 0.5,
  noClip: res.clip.problems === 0,
};
console.log(JSON.stringify({ ...res, hardSoftRatio: +ratio.toFixed(2), checks }, null, 1));
if (Object.values(checks).some((ok) => !ok)) process.exit(1);
