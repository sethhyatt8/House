// Two-grip pass unit check (node, no browser): createTwoGrip with fake controllers.
// grip snap for both grab orders, wrist-roll noise rejection, rest jitter, hands 4-12 cm apart, swing lag.
import * as THREE from 'three';
import { createTwoGrip, holdQuat } from '../src/golfgrip.js';
let fails = 0;
const ok = (name, cond, v) => { console.log(cond ? 'PASS' : 'FAIL', name, JSON.stringify(v)); if (!cond) fails += 1; };
const ctrl = (side) => { const c = new THREE.Object3D(); const g = new THREE.Object3D(); c.userData = { inputSource: { handedness: side }, grip: g }; return c; };
const L = ctrl('left'); const Rr = ctrl('right');
const setFist = (c, p, q) => { c.userData.grip.position.copy(p); c.userData.grip.quaternion.copy(q); c.userData.grip.updateMatrixWorld(true); c.position.copy(p); c.quaternion.copy(q); c.updateMatrixWorld(true); };
const club = new THREE.Object3D();
// a fist orientation whose hold puts the shaft 32 deg off vertical, face toward -X
const hq = holdQuat(-1);
const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, Math.cos(32 * Math.PI / 180), Math.sin(32 * Math.PI / 180)), new THREE.Vector3().crossVectors(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, Math.cos(32 * Math.PI / 180), Math.sin(32 * Math.PI / 180)))));
const fq = want.clone().multiply(hq.clone().invert());
const down = new THREE.Vector3(0, -1, 0).applyQuaternion(want);
const P = new THREE.Vector3(0, 0.9, 0.6);
const world = (y) => { club.updateMatrixWorld(true); return new THREE.Vector3(0, y, 0).applyMatrix4(club.matrixWorld); };
const head = () => world(-1.1);
const faceN = () => { club.updateMatrixWorld(true); return new THREE.Vector3(1, 0, 0).transformDirection(club.matrixWorld); };
const yaw = () => { const n = faceN(); return Math.atan2(n.z, -n.x) * 57.2958; };
const dt = 1 / 72;
for (const order of ['left', 'right']) {
  const hold = createTwoGrip({ faceSign: -1, gap: 0.09, topSide: 'left' });
  const first = order === 'left' ? L : Rr; const second = first === L ? Rr : L;
  first.add(club);
  setFist(L, P, fq); setFist(Rr, P.clone().addScaledVector(down, 0.09), fq);
  for (let i = 0; i < 60; i += 1) hold.apply(club, first, null, dt);
  const own = first === L ? hold.grips[0] : hold.grips[1];
  ok(`${order} first: one hand on its own grip`, world(own).distanceTo(first.userData.grip.position) < 1e-3 && hold.state.missing === (first === L ? 'lower' : 'top'), { mm: +(world(own).distanceTo(first.userData.grip.position) * 1000).toFixed(2), missing: hold.state.missing });
  for (let i = 0; i < 60; i += 1) hold.apply(club, first, second, dt);
  ok(`${order} first: both fists on their grips`, hold.state.mode === 'two' && world(hold.grips[0]).distanceTo(L.userData.grip.position) < 1e-3 && world(hold.grips[1]).distanceTo(Rr.userData.grip.position) < 1e-3, hold.state.mode);
  // roll noise on either hand
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (const who of [L, Rr]) {
    hold.apply(club, first, second, dt); const y0 = yaw(); let worst = 0;
    for (let i = 0; i < 300; i += 1) {
      const axis = new THREE.Vector3(0, -0.5, -Math.sqrt(3) / 2).applyQuaternion(fq);
      setFist(who, who.userData.grip.position, new THREE.Quaternion().setFromAxisAngle(axis, rnd() * 40 * Math.PI / 180).multiply(fq));
      hold.apply(club, first, second, dt); worst = Math.max(worst, Math.abs(yaw() - y0));
    }
    setFist(who, who.userData.grip.position, fq);
    ok(`${order} first: +-20 deg roll noise on the ${who === L ? 'top' : 'lower'} hand moves the face < 1 deg`, worst < 1, +worst.toFixed(3));
  }
  // both forearms turn 10 deg together: the face follows
  { const axis = new THREE.Vector3(0, -0.5, -Math.sqrt(3) / 2).applyQuaternion(fq); const y0 = yaw(); const q2 = new THREE.Quaternion().setFromAxisAngle(axis, 10 * Math.PI / 180).multiply(fq); hold.apply(club, first, second, dt); const y1 = yaw();
    setFist(L, L.userData.grip.position, q2); setFist(Rr, Rr.userData.grip.position, q2); for (let i = 0; i < 120; i += 1) hold.apply(club, first, second, dt);
    ok(`${order} first: both hands turning 10 deg turn the face`, Math.abs(Math.abs(yaw() - y1) - 8.5) < 1, +(yaw() - y1).toFixed(2)); // 10 deg about a shaft 32 deg off vertical = 8.5 deg of yaw
    setFist(L, L.userData.grip.position, fq); setFist(Rr, Rr.userData.grip.position, fq); for (let i = 0; i < 200; i += 1) hold.apply(club, first, second, dt); }
  // rest jitter 0.2 mm
  { const hs = []; for (let i = 0; i < 200; i += 1) { const n = () => new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(0.0004); setFist(L, P.clone().add(n()), fq); setFist(Rr, P.clone().addScaledVector(down, 0.09).add(n()), fq); hold.apply(club, first, second, dt); hs.push(head()); }
    const m = hs.slice(20).reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / 180); const dev = Math.max(...hs.slice(20).map((h) => h.distanceTo(m)));
    ok(`${order} first: head jitter at rest < 2 mm`, dev < 0.002, +(dev * 1000).toFixed(2)); }
  // 4..12 cm apart
  for (const g of [0.04, 0.12]) { setFist(L, P, fq); setFist(Rr, P.clone().addScaledVector(down, g), fq); for (let i = 0; i < 200; i += 1) hold.apply(club, first, second, dt); const sd = world(-1).sub(world(0)).normalize(); ok(`${order} first: hands ${g * 100} cm apart`, hold.state.mode === 'two' && sd.angleTo(down) < 0.01 && Math.abs(yaw()) < 1, { deg: +(sd.angleTo(down) * 57.3).toFixed(2), yaw: +yaw().toFixed(2) }); }
  // swing lag: both fists rotate rigidly at 30 rad/s about an axis through a hub; club lag < 1 deg
  { const ax = new THREE.Vector3().crossVectors(down, new THREE.Vector3(-1, 0, 0)).normalize(); const hub = P.clone().addScaledVector(down, -0.45); const pL = P.clone().addScaledVector(down, 0.09); let lag = 0;
    for (let i = 0; i < 40; i += 1) { const r = new THREE.Quaternion().setFromAxisAngle(ax, -1.5 + i * 30 * dt); setFist(L, P.clone().sub(hub).applyQuaternion(r).add(hub), r.clone().multiply(fq)); setFist(Rr, pL.clone().sub(hub).applyQuaternion(r).add(hub), r.clone().multiply(fq)); hold.apply(club, first, second, dt);
      if (i > 25) { const sd = world(-1).sub(world(0)).normalize(); lag = Math.max(lag, sd.angleTo(down.clone().applyQuaternion(r)) * 57.3); } }
    ok(`${order} first: 30 rad/s swing lag < 1 deg`, lag < 1, +lag.toFixed(3)); }
  first.remove(club);
}
// the lower fist lands 2.5 cm off the shaft line (real controllers are never co-axial): no pop, no tilt
{
  const hold = createTwoGrip({ faceSign: -1, gap: 0.09, topSide: 'left' }); L.add(club);
  setFist(L, P, fq); for (let i = 0; i < 60; i += 1) hold.apply(club, L, null, dt);
  const sd0 = world(-1).sub(world(0)).normalize(); const y0 = yaw();
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(want).multiplyScalar(0.025);
  setFist(Rr, P.clone().addScaledVector(down, 0.09).add(side), fq);
  let worst = 0; for (let i = 0; i < 120; i += 1) { hold.apply(club, L, Rr, dt); worst = Math.max(worst, world(-1).sub(world(0)).normalize().angleTo(sd0) * 57.3, Math.abs(yaw() - y0)); }
  ok('lower fist lands 2.5 cm off the line: club moves < 0.5 deg', hold.state.mode === 'two' && worst < 0.5, +worst.toFixed(3));
  setFist(Rr, P.clone().addScaledVector(down, 0.09).add(side).add(new THREE.Vector3(0, 0, 0.03)), fq); for (let i = 0; i < 120; i += 1) hold.apply(club, L, Rr, dt);
  ok('  ... and the lower hand still steers (3 cm -> > 10 deg)', world(-1).sub(world(0)).normalize().angleTo(sd0) * 57.3 > 10, +(world(-1).sub(world(0)).normalize().angleTo(sd0) * 57.3).toFixed(1));
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
