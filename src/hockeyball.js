// Field-hockey ball. FIH size: 160 g, circumference 22.9 cm (radius 36.4 mm), solid sphere.
// The stick is kinematic (the arm is vastly heavier than the ball). A slow face stays with the
// ball: that is a push pass. A fast face uses restitution and leaves the ball: that is a strike.
// Tangential friction at the contact writes the spin. The same impulse resolves the floor, so
// topspin runs on and backspin checks.

export const BALL_R = 0.0364;
export const BALL_M = 0.160;
const I = 0.4 * BALL_M * BALL_R * BALL_R;
const INV_M = 1 / BALL_M;
const INV_I = 1 / I;
// Contact-point response along a tangent: Δv = J/m and Δ(ω × r) = R² J / I, and R²/I = 2.5/m.
const TANGENT_DENOM = 3.5 * INV_M;

const GRAVITY = 9.81;
const RHO = 1.225;
const CD = 0.47;
const AREA = Math.PI * BALL_R * BALL_R;
const MAGNUS = 0.00115;
const STRIKE = 3.2; // m/s of approach. Slower is a push (no extra rebound).

// Hockey numbers. A ball may carry its own r, m, faceE, floorE, cd, or magnus (the driver ball does).
const HOCKEY = {
  r: BALL_R,
  m: BALL_M,
  invM: INV_M,
  invI: INV_I,
  tangent: TANGENT_DENOM,
  faceE: 0.5,
  faceMu: 0.55,
  pushMu: 0.85,
  floorE: 0.58,
  floorMu: 0.48,
  cd: CD,
  area: AREA,
  magnus: MAGNUS,
};
let S = HOCKEY;

function useSpec(ball) {
  if (ball.r == null && ball.m == null && ball.faceE == null && ball.cd == null && ball.magnus == null) {
    S = HOCKEY;
    return;
  }
  const r = ball.r ?? BALL_R;
  const m = ball.m ?? BALL_M;
  const invM = 1 / m;
  S = {
    r,
    m,
    invM,
    invI: 1 / (0.4 * m * r * r),
    tangent: 3.5 * invM,
    faceE: ball.faceE ?? 0.5,
    faceMu: ball.faceMu ?? 0.55,
    pushMu: ball.pushMu ?? 0.85,
    floorE: ball.floorE ?? 0.58,
    floorMu: ball.floorMu ?? 0.48,
    cd: ball.cd ?? CD,
    area: Math.PI * r * r,
    magnus: ball.magnus ?? MAGNUS,
  };
}

const tmp = { x: 0, y: 0, z: 0 };

export function createBallState(x, y, z) {
  return {
    p: { x, y, z },
    v: { x: 0, y: 0, z: 0 },
    w: { x: 0, y: 0, z: 0 },
    asleep: false,
  };
}

function len(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b, out) {
  out.x = a.y * b.z - a.z * b.y;
  out.y = a.z * b.x - a.x * b.z;
  out.z = a.x * b.y - a.y * b.x;
  return out;
}

function add(a, b, out) {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

function sub(a, b, out) {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

function scale(a, s, out) {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

function clone(a) {
  return { x: a.x, y: a.y, z: a.z };
}

// Infinite-mass surface. n points from the surface toward the ball centre.
// Returns the approach speed when an impulse was applied.
function bounce(ball, n, vSurf, e, mu, pen) {
  if (pen > 0) {
    ball.p.x += n.x * pen;
    ball.p.y += n.y * pen;
    ball.p.z += n.z * pen;
  }
  const r = { x: -n.x * S.r, y: -n.y * S.r, z: -n.z * S.r };
  const spinV = cross(ball.w, r, { x: 0, y: 0, z: 0 });
  const vContact = add(ball.v, spinV, { x: 0, y: 0, z: 0 });
  const vRel = sub(vContact, vSurf, { x: 0, y: 0, z: 0 });
  const un = dot(vRel, n);
  if (un >= -0.02) return 0;
  const ee = -un < 0.4 ? 0 : e;
  const Jn = -(1 + ee) * un * S.m;
  const vt = {
    x: vRel.x - n.x * un,
    y: vRel.y - n.y * un,
    z: vRel.z - n.z * un,
  };
  let jx = -vt.x / S.tangent;
  let jy = -vt.y / S.tangent;
  let jz = -vt.z / S.tangent;
  const jtLen = Math.hypot(jx, jy, jz);
  const maxJ = mu * Jn;
  if (jtLen > maxJ && jtLen > 1e-8) {
    const s = maxJ / jtLen;
    jx *= s;
    jy *= s;
    jz *= s;
  }
  const J = { x: n.x * Jn + jx, y: n.y * Jn + jy, z: n.z * Jn + jz };
  ball.v.x += J.x * S.invM;
  ball.v.y += J.y * S.invM;
  ball.v.z += J.z * S.invM;
  const rxJ = cross(r, J, { x: 0, y: 0, z: 0 });
  ball.w.x += rxJ.x * S.invI;
  ball.w.y += rxJ.y * S.invI;
  ball.w.z += rxJ.z * S.invI;
  return -un;
}

function closestAabb(p, b) {
  return {
    x: Math.min(b.x1, Math.max(b.x0, p.x)),
    y: Math.min(b.y1, Math.max(b.y0, p.y)),
    z: Math.min(b.z1, Math.max(b.z0, p.z)),
  };
}

function hitAabb(ball, box) {
  const inside = ball.p.x > box.x0 && ball.p.x < box.x1
    && ball.p.y > box.y0 && ball.p.y < box.y1
    && ball.p.z > box.z0 && ball.p.z < box.z1;
  if (inside) {
    const faces = [
      { d: ball.p.x - box.x0, n: { x: -1, y: 0, z: 0 } },
      { d: box.x1 - ball.p.x, n: { x: 1, y: 0, z: 0 } },
      { d: ball.p.y - box.y0, n: { x: 0, y: -1, z: 0 } },
      { d: box.y1 - ball.p.y, n: { x: 0, y: 1, z: 0 } },
      { d: ball.p.z - box.z0, n: { x: 0, y: 0, z: -1 } },
      { d: box.z1 - ball.p.z, n: { x: 0, y: 0, z: 1 } },
    ];
    let best = faces[0];
    for (const face of faces) if (face.d < best.d) best = face;
    return bounce(ball, best.n, box.v || ZERO, box.e ?? 0.55, box.mu ?? 0.4, best.d + S.r);
  }
  const c = closestAabb(ball.p, box);
  const dx = ball.p.x - c.x;
  const dy = ball.p.y - c.y;
  const dz = ball.p.z - c.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= S.r || d < 1e-8) return 0;
  return bounce(ball, { x: dx / d, y: dy / d, z: dz / d }, box.v || ZERO, box.e ?? 0.55, box.mu ?? 0.4, S.r - d);
}

const ZERO = { x: 0, y: 0, z: 0 };

// Closest point on the flat face (a rectangle in the plane of n, spanned by toe and up).
function closestFace(p, face) {
  const rel = sub(p, face.c, tmp);
  const dn = dot(rel, face.n);
  let u = dot(rel, face.toe);
  let v = dot(rel, face.up);
  const eu = Math.min(face.halfToe, Math.max(-face.halfToe, u));
  const ev = Math.min(face.halfUp, Math.max(-face.halfUp, v));
  return {
    q: {
      x: face.c.x + face.toe.x * eu + face.up.x * ev,
      y: face.c.y + face.toe.y * eu + face.up.y * ev,
      z: face.c.z + face.toe.z * eu + face.up.z * ev,
    },
    dn,
    inside: u === eu && v === ev,
  };
}

function velocityAt(face, q, out) {
  const arm = sub(q, face.c, { x: 0, y: 0, z: 0 });
  const spin = cross(face.w, arm, { x: 0, y: 0, z: 0 });
  return add(face.v, spin, out);
}

function hitFace(ball, face) {
  const hit = closestFace(ball.p, face);
  // Only the playing side. The rounded back is not this face.
  if (hit.dn < -0.004) return 0;
  const delta = sub(ball.p, hit.q, { x: 0, y: 0, z: 0 });
  const dist = len(delta);
  const vq = velocityAt(face, hit.q, { x: 0, y: 0, z: 0 });
  const approach = Math.max(0, -dot(sub(ball.v, vq, { x: 0, y: 0, z: 0 }), face.n));
  const reach = S.r + approach * face.sweep;
  if (dist > reach || dist < 1e-8) return 0;
  const n = dist < S.r ? { x: delta.x / dist, y: delta.y / dist, z: delta.z / dist } : face.n;
  const pen = Math.max(0, S.r - dist);
  // A fast face rebounds. A push (e = 0) leaves the ball moving with the stick.
  const closing = -dot(sub(ball.v, vq, { x: 0, y: 0, z: 0 }), n);
  const e = closing > STRIKE ? S.faceE : 0;
  const mu = e > 0 ? S.faceMu : S.pushMu;
  const speed = bounce(ball, n, vq, e, mu, pen);
  if (!speed) return null;
  return { speed, kind: e > 0 ? 'strike' : 'push' };
}

function closestCapsule(p, a, b) {
  const ab = sub(b, a, { x: 0, y: 0, z: 0 });
  const ab2 = dot(ab, ab);
  const t = ab2 < 1e-8 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a, { x: 0, y: 0, z: 0 }), ab) / ab2));
  return {
    q: { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t },
    t,
  };
}

function hitShaft(ball, face) {
  if (!face.shaft) return 0;
  const { q } = closestCapsule(ball.p, face.shaft.a, face.shaft.b);
  const delta = sub(ball.p, q, { x: 0, y: 0, z: 0 });
  const dist = len(delta);
  const limit = S.r + face.shaft.r;
  if (dist >= limit || dist < 1e-8) return 0;
  const n = { x: delta.x / dist, y: delta.y / dist, z: delta.z / dist };
  const vq = velocityAt(face, q, { x: 0, y: 0, z: 0 });
  return bounce(ball, n, vq, 0.28, 0.4, limit - dist);
}

function floorNormal(ball, floorY) {
  const pen = floorY + S.r - ball.p.y;
  if (pen <= 0) return 0;
  return bounce(ball, { x: 0, y: 1, z: 0 }, ZERO, S.floorE, S.floorMu, pen);
}

function integrate(ball, h) {
  const v = len(ball.v);
  if (v > 0.05) {
    const drag = 0.5 * S.cd * RHO * S.area * v * v * S.invM;
    const s = drag * h / v;
    ball.v.x -= ball.v.x * s;
    ball.v.y -= ball.v.y * s;
    ball.v.z -= ball.v.z * s;
  }
  const magnus = cross(ball.w, ball.v, { x: 0, y: 0, z: 0 });
  ball.v.x += magnus.x * S.magnus * h;
  ball.v.y += magnus.y * S.magnus * h;
  ball.v.z += magnus.z * S.magnus * h;
  ball.v.y -= GRAVITY * h;
  const damp = Math.exp(-0.12 * h);
  ball.w.x *= damp;
  ball.w.y *= damp;
  ball.w.z *= damp;
  ball.p.x += ball.v.x * h;
  ball.p.y += ball.v.y * h;
  ball.p.z += ball.v.z * h;
}

function buoy(ball, waterY, h) {
  const low = waterY - S.r;
  const high = waterY + S.r;
  if (ball.p.y >= high) return;
  const submerged = ball.p.y <= low ? 1 : (high - ball.p.y) / (2 * S.r);
  const volume = (4 / 3) * Math.PI * S.r * S.r * S.r;
  const accel = (1000 * volume * GRAVITY * submerged) * S.invM;
  ball.v.y += accel * h;
  const drag = 1 - Math.exp(-3.5 * submerged * h);
  ball.v.x -= ball.v.x * drag;
  ball.v.y -= ball.v.y * drag;
  ball.v.z -= ball.v.z * drag;
  ball.w.x *= 1 - drag;
  ball.w.y *= 1 - drag;
  ball.w.z *= 1 - drag;
}

// One frame. `env.face` is the stick face in world space, or null.
// `env.floorAt(x, z, y)` is the solid surface under the ball, or null over deep water.
// `env.boxes` are static solids. Returns contact events for this frame.
export function stepBall(ball, dt, env) {
  useSpec(ball);
  const events = [];
  if (ball.asleep) {
    if (!env.face) return events;
    const hit = closestFace(ball.p, env.face);
    if (hit.dn > S.r + 0.08) return events;
    ball.asleep = false;
  }
  const h = 1 / 240;
  const steps = Math.max(1, Math.min(16, Math.round(dt / h)));
  const step = dt / steps;
  let grounded = false;
  let struck = 0;
  let pushed = 0;
  let bounced = 0;
  for (let i = 0; i < steps; i += 1) {
    integrate(ball, step);
    if (env.waterY != null) buoy(ball, env.waterY, step);
    const floorY = env.floorAt?.(ball.p.x, ball.p.z, ball.p.y);
    if (floorY != null && !(env.waterY != null && floorY <= env.waterY + 0.05 && ball.p.y < env.waterY + S.r)) {
      const speed = floorNormal(ball, floorY);
      if (speed > 0.6) bounced = Math.max(bounced, speed);
      if (ball.p.y <= floorY + S.r + 0.004) grounded = true;
    }
    if (env.boxes) {
      for (const box of env.boxes) {
        const speed = hitAabb(ball, box);
        if (speed > 0.8) bounced = Math.max(bounced, speed);
      }
    }
    if (env.face) {
      env.face.sweep = step;
      const faceHit = hitFace(ball, env.face);
      const shaftSpeed = faceHit ? 0 : hitShaft(ball, env.face);
      if (faceHit?.kind === 'strike') struck = Math.max(struck, faceHit.speed);
      else if (faceHit?.kind === 'push') pushed = Math.max(pushed, faceHit.speed);
      else if (shaftSpeed > STRIKE) struck = Math.max(struck, shaftSpeed);
      else if (shaftSpeed > 0.8) bounced = Math.max(bounced, shaftSpeed);
    }
  }
  if (grounded && len(ball.v) < 0.08 && len(ball.w) < 1.2 && pushed === 0 && struck === 0) {
    ball.v.x = ball.v.y = ball.v.z = 0;
    ball.w.x = ball.w.y = ball.w.z = 0;
    ball.asleep = true;
  }
  if (struck > 0) events.push({ type: 'strike', speed: struck });
  else if (pushed > 0) events.push({ type: 'push', speed: pushed });
  if (bounced > 1.4) events.push({ type: 'bounce', speed: bounced });
  return events;
}

export function ballSpeed(ball) {
  return len(ball.v);
}

// The sole cannot pass through the ground. This is the turf catch shared with a future club:
// the head pivots up around the hands, and a dig dumps the swing speed into the floor.
const SOLE_CLEAR = 0.008;

export function soleCatch(grip, sole, floorY, clearance = SOLE_CLEAR) {
  const dx = sole.x - grip.x;
  const dy = sole.y - grip.y;
  const dz = sole.z - grip.z;
  const pen = floorY + clearance - sole.y;
  if (pen <= 0) return { pen: 0, angle: 0, axis: null };
  const horiz = Math.hypot(dx, dz);
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.08 || horiz < 0.04) return { pen, angle: 0, axis: null };
  const current = Math.asin(Math.min(1, Math.max(-1, dy / length)));
  const target = Math.asin(Math.min(1, Math.max(-1, (floorY + clearance - grip.y) / length)));
  const angle = Math.max(0, Math.min(0.85, target - current));
  return { pen, angle, axis: { x: -dz / horiz, y: 0, z: dx / horiz } };
}

export function turfDrag(v, w, pen) {
  const into = Math.max(0, -v.y);
  const dig = Math.min(1, Math.max(0, pen) / 0.035);
  const kill = Math.min(0.94, dig * 0.72 + into / 14);
  const keep = 1 - kill;
  return {
    v: { x: v.x * keep, y: Math.max(0, v.y), z: v.z * keep },
    w: { x: (w?.x || 0) * keep, y: (w?.y || 0) * keep, z: (w?.z || 0) * keep },
    kill,
  };
}

export { clone };
