// Golf grip pass, pure maths (node): the grip-space hold at a natural address, the swept face contact (no tunnelling at
// 65 m/s), the driver impact (smash, launch, spin), the flight staying inside the world, the two-hand filter and the
// left-handed mirror. The full-rig versions are scripts/ground/golfgrip.mjs and hockeygrip.mjs.
import * as THREE from 'three';
import { createFit, createHold, holdQuat } from '../src/golfgrip.js';
import { DRIVER, impact, sweepFace, golfAero } from '../src/golfball.js';
import { createBallState, stepBall } from '../src/hockeyball.js';

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`ok  ${name}`);
  else { failed += 1; console.log(`FAIL ${name} ${detail}`); }
}
const DEG = Math.PI / 180;
// Touch Plus right grip offset (ray -> grip), as in IWER's Quest 3 profile
const RIGHT = new THREE.Matrix4().fromArray([0.9925461411476135, -2.6238110351073374e-8, 0.12186934053897858, 0, -0.0861746147274971, 0.7071067690849304, 0.7018360495567322, 0, -0.08617465943098068, -0.7071067094802856, 0.701836109161377, 0, 0.003979838453233242, -0.015857869759202003, 0.04964182525873184, 1]);
const relQ = new THREE.Quaternion(); RIGHT.decompose(new THREE.Vector3(), relQ, new THREE.Vector3());
const rayFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(relQ.clone().invert());

// 1) natural address: back of the right hand away from the target (-X), forearm (ray) 17 deg off vertical toward the ball
function anatomy(hang) {
  const want = new THREE.Vector3(0, -Math.cos(hang * DEG), -Math.sin(hang * DEG));
  let best = null;
  for (let i = 0; i < 7200; i += 1) {
    const phi = (i / 7200) * Math.PI * 2;
    const X = new THREE.Vector3(1, 0, 0); const Y = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y)));
    const w = rayFwd.clone().applyQuaternion(q); w.x = 0; w.normalize();
    const err = w.angleTo(want);
    if (!best || err < best.err) best = { err, q };
  }
  return best.q;
}
const MODEL = { n: new THREE.Vector3(0.9781, 0.1763, 0.1102).normalize(), toe: new THREE.Vector3(0, -0.5299, 0.848).normalize() };
{
  const fist = anatomy(17);
  const club = fist.clone().multiply(holdQuat(-1));
  const shaft = new THREE.Vector3(0, -1, 0).applyQuaternion(club);
  const n = MODEL.n.clone().applyQuaternion(club); const toe = MODEL.toe.clone().applyQuaternion(club);
  const lie = Math.asin(-shaft.y) / DEG;
  const faceYaw = Math.atan2(n.z, -n.x) / DEG;
  const loft = Math.atan2(n.y, Math.hypot(n.x, n.z)) / DEG;
  const toeTilt = Math.asin(toe.y) / DEG;
  check('natural address: lie 58 +-1', Math.abs(lie - 58) < 1, lie.toFixed(2));
  check('natural address: face square within 1 deg', Math.abs(faceYaw) < 1, faceYaw.toFixed(2));
  check('natural address: loft 12 +-1', Math.abs(loft - 12) < 1, loft.toFixed(2));
  check('natural address: toe flat within 1 deg', Math.abs(toeTilt) < 1, toeTilt.toFixed(2));
  // the 59e7c4b hold (shaft = ray -Z, face = ray +Y) in the same fist
  const ray = fist.clone().multiply(relQ.clone().invert());
  const oldN = new THREE.Vector3(0, 1, 0).applyQuaternion(ray);
  const oldYaw = Math.acos(Math.max(-1, Math.min(1, -oldN.x / Math.hypot(oldN.x, oldN.z)))) / DEG;
  check('the old hold is far off in a golf grip (documents the bug)', oldYaw > 45, oldYaw.toFixed(1));
  // left-handed: mirror of the right-handed fist through the target line, face +X of the grip
  const m = new THREE.Matrix4().makeScale(1, 1, -1).multiply(new THREE.Matrix4().makeRotationFromQuaternion(fist)).multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  const lfist = new THREE.Quaternion().setFromRotationMatrix(m);
  const lclub = lfist.clone().multiply(holdQuat(1));
  const lshaft = new THREE.Vector3(0, -1, 0).applyQuaternion(lclub);
  const lmirror = (v) => new THREE.Vector3(v.x, v.y, -v.z);
  const ln = lmirror(MODEL.n).applyQuaternion(lclub); const ltoe = lmirror(MODEL.toe).applyQuaternion(lclub);
  check('left-handed mirrors: shaft', lshaft.distanceTo(new THREE.Vector3(shaft.x, shaft.y, -shaft.z)) < 1e-3, lshaft.toArray());
  check('left-handed mirrors: face and toe', ln.distanceTo(new THREE.Vector3(n.x, n.y, -n.z)) < 1e-3 && ltoe.distanceTo(new THREE.Vector3(toe.x, toe.y, -toe.z)) < 1e-3, ln.toArray());
}

// 2) swept contact: a 65 m/s face that jumps 0.9 m in one 72 Hz frame still meets the ball
const local = { face: new THREE.Vector3(0, 0, 0), n: new THREE.Vector3(1, 0, 0), toe: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), halfToe: 0.056, halfUp: 0.029 };
const R = 0.02135;
for (const v of [10, 40, 65]) {
  const dt = 1 / 72;
  const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // face +X -> -X (toward the target)
  const p0 = { p: new THREE.Vector3(R + v * dt * 0.4, 0, 0), q: qa };
  const p1 = { p: new THREE.Vector3(R + v * dt * 0.4 - v * dt, 0, 0), q: qa };
  const hit = sweepFace(p0, p1, dt, local, new THREE.Vector3(0, 0, 0), new THREE.Vector3(), R);
  const tWant = (p0.p.x - R) / (v * dt);
  check(`sweep ${v} m/s: contact found at the right time`, hit && Math.abs(hit.t - tWant) < 0.01, hit ? hit.t.toFixed(3) + ' vs ' + tWant.toFixed(3) : 'none');
}

// 3) impact: centred driver strikes (12 deg loft, square, level path)
const loft = 12 * DEG;
const shots = {};
for (const V of [30, 40, 50]) {
  const ball = createBallState(0, 0, 0);
  const n = new THREE.Vector3(-Math.cos(loft), Math.sin(loft), 0);
  const hit = { vHead: new THREE.Vector3(-V, 0, 0), n, toe: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(Math.sin(loft), Math.cos(loft), 0), u: 0, v: 0, ball: new THREE.Vector3() };
  shots[V] = impact(ball, hit, DRIVER, R, 0.04593);
  shots[V].state = ball;
}
check('driver smash 1.38-1.46 at 40 m/s', shots[40].smash > 1.38 && shots[40].smash < 1.46, shots[40].smash.toFixed(3));
check('driver launch 9-11 deg', shots[40].launch > 9 && shots[40].launch < 11, shots[40].launch.toFixed(2));
check('driver backspin 1800-2600 rpm at 40 m/s', shots[40].spinRpm > 1800 && shots[40].spinRpm < 2600, shots[40].spinRpm.toFixed(0));
{
  const ball = createBallState(0, 0, 0);
  const n = new THREE.Vector3(-Math.cos(loft), Math.sin(loft), 0);
  const res = impact(ball, { vHead: new THREE.Vector3(-40, 0, 0), n, toe: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(Math.sin(loft), Math.cos(loft), 0), u: 0.035, v: 0, ball: new THREE.Vector3() }, DRIVER, R, 0.04593);
  check('toe strike loses speed and adds draw spin (+y)', res.smash < shots[40].smash - 0.08 && ball.w.y > 20, `${res.smash.toFixed(3)} wy ${ball.w.y.toFixed(1)}`);
}

// 4) flight: off the 33 m point into the sea, inside the 148 m world even at 65 m/s head speed
function fly(V) {
  const ball = createBallState(0, 33.48, 0); ball.r = R; ball.m = 0.04593; ball.floorE = 0.4; ball.floorMu = 0.5;
  ball.aero = (b, h) => golfAero(b, h, R, 0.04593);
  const n = new THREE.Vector3(-Math.cos(loft), Math.sin(loft), 0);
  impact(ball, { vHead: new THREE.Vector3(-V, 0, 0), n, toe: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(Math.sin(loft), Math.cos(loft), 0), u: 0, v: 0, ball: new THREE.Vector3(0, 33.48, 0) }, DRIVER, R, 0.04593);
  let apex = 0;
  for (let t = 0; t < 20; t += 1 / 72) {
    stepBall(ball, 1 / 72, { floorAt: (x) => (x > -1.5 ? 33.42 : -100), waterY: -8, boxes: [] });
    apex = Math.max(apex, ball.p.y - 33.42);
    if (ball.p.y < -7.9) break;
  }
  return { dist: -ball.p.x, apex };
}
const f25 = fly(25); const f40 = fly(40); const f65 = fly(65);
console.log('flight (m to the sea):', { 25: +f25.dist.toFixed(1), 40: +f40.dist.toFixed(1), 65: +f65.dist.toFixed(1) }, 'apex', { 40: +f40.apex.toFixed(1), 65: +f65.apex.toFixed(1) });
check('a 25 m/s swing reaches the sea (> 60 m)', f25.dist > 60, f25.dist.toFixed(1));
check('a 40 m/s swing goes 100-140 m', f40.dist > 100 && f40.dist < 140, f40.dist.toFixed(1));
check('a 65 m/s swing stays inside the world (< 148 m)', f65.dist < 148, f65.dist.toFixed(1));

// 5) two hands: 1 mm noise on two fists 11 cm apart is not amplified past 1.6x the one-hand head jitter
{
  const mk = (hand) => {
    const grip = new THREE.Object3D(); grip.visible = true;
    const c = new THREE.Object3D(); c.userData = { grip, inputSource: { handedness: hand } };
    const scene = new THREE.Object3D(); scene.add(c); scene.add(grip);
    return c;
  };
  const lead = mk('right'); const off = mk('left');
  const club = new THREE.Object3D(); lead.add(club);
  const fist = anatomy(17);
  const base = new THREE.Vector3(0, 0.92, 0.3);
  const shaft = new THREE.Vector3(0, -1, 0).applyQuaternion(fist.clone().multiply(holdQuat(-1)));
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const run = (two) => {
    const hold = createHold({ faceSign: -1 });
    let prev = null; let sum = 0; let n = 0;
    for (let i = 0; i < 400; i += 1) {
      lead.userData.grip.position.copy(base).add(new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(0.002));
      lead.userData.grip.quaternion.copy(fist).premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 0.006, rnd() * 0.006, rnd() * 0.006)));
      off.userData.grip.position.copy(base).addScaledVector(shaft, 0.11).add(new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(0.002));
      off.userData.grip.quaternion.copy(fist);
      lead.userData.grip.updateMatrixWorld(); off.userData.grip.updateMatrixWorld();
      hold.apply(club, lead, two ? off : null, 1 / 72);
      const head = new THREE.Vector3(0, -1.1, 0).applyQuaternion(hold.state.q).add(hold.state.p);
      if (prev && i > 40) { sum += head.distanceToSquared(prev); n += 1; }
      prev = head;
    }
    return { rms: Math.sqrt(sum / n) * 1000, two: hold.state.twoHand };
  };
  const one = run(false); seed = 3; const two = run(true);
  check('two-hand engaged', two.two, two.two);
  check('two-hand head jitter <= 1.6x one-hand', two.rms <= 1.6 * one.rms, `${two.rms.toFixed(2)} mm vs ${one.rms.toFixed(2)} mm`);
  // a second fist 2 cm off the virtual shaft (two controllers can't sit co-axially): engaging must not move the
  // club; moving it 4 cm across afterwards steers the shaft by about atan(4/11)
  {
    const hold = createHold({ faceSign: -1 });
    const side = new THREE.Vector3(1, 0, 0);
    const pose = (offShift) => {
      lead.userData.grip.position.copy(base); lead.userData.grip.quaternion.copy(fist);
      off.userData.grip.position.copy(base).addScaledVector(shaft, 0.11).addScaledVector(side, 0.02 + offShift);
      lead.userData.grip.updateMatrixWorld(); off.userData.grip.updateMatrixWorld();
    };
    pose(0); for (let i = 0; i < 30; i += 1) hold.apply(club, lead, null, 1 / 72);
    const q1 = hold.state.q.clone();
    for (let i = 0; i < 30; i += 1) hold.apply(club, lead, off, 1 / 72);
    const pop = q1.angleTo(hold.state.q) * 57.2958;
    pose(0.04); for (let i = 0; i < 60; i += 1) hold.apply(club, lead, off, 1 / 72);
    const steer = q1.angleTo(hold.state.q) * 57.2958;
    check('two-hand: engaging 2 cm off the shaft does not move the club (< 0.5 deg)', pop < 0.5, +pop.toFixed(2));
    check('two-hand: moving the second fist 4 cm steers the shaft 15-25 deg', steer > 15 && steer < 25, +steer.toFixed(1));
  }
}

// 6) length fit: 1 s still with the head 8 cm in the ground shortens the shaft by 8 cm / cos(32 deg) less the 1 cm rest
{
  const fit = createFit();
  let ext = 0; let got = null;
  for (let i = 0; i < 80 && got == null; i += 1) got = fit.update(1 / 72, { ext, gap: -0.08, speed: 0.05, fromVertical: 32 * DEG, cosDrop: Math.cos(32 * DEG) });
  check('fit fires after 1 s still', got != null, got);
  check('fit length', got != null && Math.abs(got - (-0.09 / Math.cos(32 * DEG))) < 0.003, got);
  const fit2 = createFit(); got = null;
  for (let i = 0; i < 80 && got == null; i += 1) got = fit2.update(1 / 72, { ext, gap: -0.08, speed: 0.9, fromVertical: 32 * DEG, cosDrop: Math.cos(32 * DEG) });
  check('no fit while the head is moving', got == null, got);
}

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
