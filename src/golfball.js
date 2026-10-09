// Golf grip pass: club-on-ball impact and ball flight for the driver (and the hockey stick's swept contact).
// Pure functions (three.js maths only) so scripts/golf-grip-check.mjs can run them in node.
//  - sweepFace(): continuous collision of the face plate against the ball over one frame. The club pose is
//    interpolated between last frame and this frame (hands lerp, rotation slerp), so a 50 m/s head that moves
//    70 cm per 72 Hz frame still meets a 4.3 cm ball. Returns the first contact (time, point, normal, head velocity).
//  - impact(): a two-body head/ball collision along the face normal (COR + head mass => smash factor about 1.42 for
//    a centred driver), friction up the face (the ball leaves rolling: launch a little under the loft, backspin from
//    the loft), off-centre loss and a toe/heel gear effect.
//  - golfAero(): drag + lift from the spin (C_D, C_L from the spin ratio), in "world air" thick enough that the
//    longest drives land in the sea inside the 150 m world.
import * as THREE from 'three';

export const DRIVER = { M: 0.2, e: 0.79, mu: 0.4, gear: 80, sweetHalf: 0.032, pushBelow: 1.2 };
export const STICK = { M: 50, e: 0.5, mu: 0.05, gear: 0, sweetHalf: 0.05, pushBelow: 3.2 };  // M: near-rigid stick in a planted grip (same 1.5x ratio as hockeyball.js); mu low: a ball pinned on turf takes little face spin (more backspin than its speed makes it roll backwards)

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();

// pose = { p: Vector3 (club origin, world), q: Quaternion (club rotation, world) }; local = club-frame contact frame
// { face, n, toe, up, halfToe, halfUp }. Fills out {c, n, toe, up} at time t (0..1) between pose0 and pose1.
export function faceAt(pose0, pose1, t, local, out) {
  _p.lerpVectors(pose0.p, pose1.p, t);
  _q.slerpQuaternions(pose0.q, pose1.q, t);
  out.c.copy(local.face).applyQuaternion(_q).add(_p);
  out.n.copy(local.n).applyQuaternion(_q);
  out.toe.copy(local.toe).applyQuaternion(_q);
  out.up.copy(local.up).applyQuaternion(_q);
  out.p.copy(_p);
  out.q.copy(_q);
  return out;
}

function frame() {
  return { c: new THREE.Vector3(), n: new THREE.Vector3(), toe: new THREE.Vector3(), up: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Quaternion() };
}
const F0 = frame();
const F1 = frame();

// Signed gap from the ball surface to the face plane (positive = in front of the face), and whether the ball centre
// projects onto the plate (with a little rim allowance so an edge hit still counts).
function gapAt(f, ball, r, local, rim) {
  _a.copy(ball).sub(f.c);
  const d = _a.dot(f.n) - r;
  const u = _a.dot(f.toe);
  const v = _a.dot(f.up);
  const on = Math.abs(u) <= local.halfToe + rim && Math.abs(v) <= local.halfUp + rim;
  return { d, u, v, on };
}

// Continuous collision over one frame. ballP/ballV are the ball at frame start (it moves on a line meanwhile).
// Returns null or { t, c, n, toe, up, u, v, vHead, pose } at first contact.
export function sweepFace(pose0, pose1, dt, local, ballP, ballV, r) {
  faceAt(pose0, pose1, 0, local, F0);
  faceAt(pose0, pose1, 1, local, F1);
  const travel = F0.c.distanceTo(F1.c) + 2 * local.halfToe * F0.q.angleTo(F1.q);
  // cheap reject: ball far from both ends and from the segment between them
  _b.copy(ballP).addScaledVector(ballV, dt * 0.5);
  const reach = travel + local.halfToe + local.halfUp + r + 0.1;
  if (_b.distanceTo(F0.c) > reach && _b.distanceTo(F1.c) > reach) return null;
  const n = Math.max(1, Math.min(160, Math.ceil(travel / 0.004)));
  const rim = r * 0.45;
  const ball = new THREE.Vector3();
  const f = frame();
  ball.copy(ballP);
  let prev = gapAt(faceAt(pose0, pose1, 0, local, f), ball, r, local, rim);
  // already touching at frame start (resting against the face): contact at t = 0 if the head closes on it
  if (prev.d <= 0 && prev.d > -r && prev.on) return contact(pose0, pose1, dt, local, ballP, ballV, r, 0, f);
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    ball.copy(ballP).addScaledVector(ballV, t * dt);
    faceAt(pose0, pose1, t, local, f);
    const g = gapAt(f, ball, r, local, rim);
    if (prev.d > 0 && g.d <= 0 && g.d > -2 * r - travel / n) {
      // refine the crossing time
      let lo = (i - 1) / n;
      let hi = t;
      for (let k = 0; k < 8; k += 1) {
        const mid = (lo + hi) / 2;
        ball.copy(ballP).addScaledVector(ballV, mid * dt);
        const gm = gapAt(faceAt(pose0, pose1, mid, local, f), ball, r, local, rim);
        if (gm.d > 0) lo = mid; else hi = mid;
      }
      ball.copy(ballP).addScaledVector(ballV, hi * dt);
      const gh = gapAt(faceAt(pose0, pose1, hi, local, f), ball, r, local, rim);
      if (gh.on) return contact(pose0, pose1, dt, local, ballP, ballV, r, hi, f);
    }
    prev = g;
  }
  return null;
}

function contact(pose0, pose1, dt, local, ballP, ballV, r, t, f) {
  faceAt(pose0, pose1, t, local, f);
  // head velocity at the contact point: hand translation + rotation over the frame (an arc, not the chord)
  _q.copy(pose1.q).multiply(pose0.q.clone().invert());
  let angle = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
  const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
  const axis = s > 1e-6 ? new THREE.Vector3(_q.x / s, _q.y / s, _q.z / s) : new THREE.Vector3(0, 1, 0);
  if (_q.w < 0) angle = -angle;
  const w = axis.multiplyScalar(angle / dt);
  const ball = new THREE.Vector3().copy(ballP).addScaledVector(ballV, t * dt);
  const point = ball.clone().addScaledVector(f.n, -r); // contact point on the face
  const vHead = new THREE.Vector3().subVectors(pose1.p, pose0.p).multiplyScalar(1 / dt)
    .add(new THREE.Vector3().crossVectors(w, point.clone().sub(f.p)));
  _a.copy(ball).sub(f.c);
  return {
    t,
    ball,
    point,
    c: f.c.clone(),
    n: f.n.clone(),
    toe: f.toe.clone(),
    up: f.up.clone(),
    u: _a.dot(f.toe),
    v: _a.dot(f.up),
    vHead,
    w,
  };
}

// Head-on-ball collision. Mutates ball {p, v, w} ({x,y,z} objects) and returns a summary.
export function impact(ball, hit, spec, r, m) {
  const vb = _a.set(ball.v.x, ball.v.y, ball.v.z);
  const rel = _b.copy(hit.vHead).sub(vb);
  const n = _n.copy(hit.n);
  const vn = rel.dot(n);
  if (vn <= 0.02) return null;
  const massK = spec.M / (spec.M + m);
  const push = vn < spec.pushBelow;
  const off = Math.hypot(hit.u, hit.v) / spec.sweetHalf;
  const offLoss = Math.max(0.55, 1 - 0.1 * off * off);
  const e = push ? 0 : spec.e;
  const dn = (1 + e) * massK * vn * offLoss;
  const vt = _t.copy(rel).addScaledVector(n, -vn);
  // friction: the ball ends up rolling on the face (2/7 of the sliding speed for a solid sphere), capped by mu
  let dtv = vt.clone().multiplyScalar((2 / 7) * massK);
  const cap = spec.mu * dn;
  if (dtv.length() > cap) dtv.setLength(cap);
  if (push) dtv.multiplyScalar(0.3);
  ball.v.x += n.x * dn + dtv.x;
  ball.v.y += n.y * dn + dtv.y;
  ball.v.z += n.z * dn + dtv.z;
  // spin from the face friction: contact point is -n r from the centre; dw = (r_c x J) / I
  const spin = _c.crossVectors(n, dtv).multiplyScalar(-2.5 / r);
  // gear effect: a toe hit adds draw spin about (toe x n), a heel hit fade
  if (spec.gear && !push) spin.addScaledVector(_u.crossVectors(hit.toe, n).normalize(), spec.gear * hit.u * vn);
  ball.w.x += spin.x;
  ball.w.y += spin.y;
  ball.w.z += spin.z;
  ball.asleep = false;
  // out of the face
  ball.p.x = hit.ball.x + n.x * 0.0015;
  ball.p.y = hit.ball.y + n.y * 0.0015;
  ball.p.z = hit.ball.z + n.z * 0.0015;
  const speed = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
  const hz = Math.hypot(ball.v.x, ball.v.z);
  return {
    push,
    head: hit.vHead.length(),
    vn,
    ball: speed,
    smash: speed / Math.max(1e-3, hit.vHead.length()),
    launch: Math.atan2(ball.v.y, hz) * 180 / Math.PI,
    spinRpm: Math.hypot(ball.w.x, ball.w.y, ball.w.z) * 60 / (2 * Math.PI),
    off: Math.hypot(hit.u, hit.v),
  };
}

// Ball flight: drag and spin lift (Smits & Smith style fits), in thickened "world air" (AIR x sea-level density)
// so a drive stays inside the 150 m world. Replaces hockeyball's constant cd/magnus for the golf ball.
export const AIR = 3.2;
export const LIFT = 0.45;
export function golfAero(ball, h, r = 0.02135, m = 0.04593, air = AIR, lift = LIFT) {
  const v = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
  if (v < 0.05) return;
  const w = Math.hypot(ball.w.x, ball.w.y, ball.w.z);
  const S = (r * w) / v;
  const cd = 0.24 + 0.18 * Math.min(S, 0.4);
  const cl = S > 1e-4 ? lift * Math.min(0.32, 0.54 * Math.pow(S, 0.4)) : 0;
  const k = (0.5 * 1.225 * air * Math.PI * r * r * v * v) / m;
  const drag = (k * cd * h) / v;
  let lx = ball.w.y * ball.v.z - ball.w.z * ball.v.y;
  let ly = ball.w.z * ball.v.x - ball.w.x * ball.v.z;
  let lz = ball.w.x * ball.v.y - ball.w.y * ball.v.x;
  const ll = Math.hypot(lx, ly, lz);
  if (ll > 1e-6) {
    const s = (k * cl * h) / ll;
    lx *= s; ly *= s; lz *= s;
  } else lx = ly = lz = 0;
  ball.v.x += -ball.v.x * drag + lx;
  ball.v.y += -ball.v.y * drag + ly;
  ball.v.z += -ball.v.z * drag + lz;
}
