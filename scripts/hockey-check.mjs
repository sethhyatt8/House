// Headless checks for the field-hockey ball: bounce height, spin on the bounce, a strike, a push.
import { BALL_R, createBallState, soleCatch, stepBall, turfDrag } from '../src/hockeyball.js';

const floor = { floorAt: () => 0, boxes: [], face: null, waterY: -8 };
let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`ok  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

function sim(ball, env, seconds) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepBall(ball, dt, env);
  return ball;
}

// Drop 1 m. First return peak should be near e² * h = 0.58² m, plus the radius.
{
  const ball = createBallState(0, 1 + BALL_R, 0);
  const dt = 1 / 240;
  let leftFloor = false;
  let peak = 0;
  for (let t = 0; t < 2; t += dt) {
    stepBall(ball, dt, floor);
    if (!leftFloor && ball.p.y > BALL_R + 0.01 && ball.v.y > 0) leftFloor = true;
    if (leftFloor && ball.v.y <= 0) {
      peak = ball.p.y;
      break;
    }
  }
  const height = peak - BALL_R;
  check('drop bounce height', height > 0.25 && height < 0.45, `got ${height.toFixed(3)} m`);
}

function bounceVx(spinZ) {
  const ball = createBallState(0, BALL_R + 0.02, 0);
  ball.v.x = 6;
  ball.v.y = -3;
  ball.w.z = spinZ;
  const dt = 1 / 240;
  for (let t = 0; t < 0.4; t += dt) {
    stepBall(ball, dt, floor);
    if (ball.p.y <= BALL_R + 0.008 && ball.v.y >= -0.05) break;
  }
  return ball.v.x;
}

{
  const none = bounceVx(0);
  const back = bounceVx(140);
  const top = bounceVx(-140);
  check('backspin checks', back < none - 0.4, `back ${back.toFixed(2)} none ${none.toFixed(2)}`);
  check('topspin runs', top > none + 0.4, `top ${top.toFixed(2)} none ${none.toFixed(2)}`);
}

function face(speed, lift = 0) {
  return {
    c: { x: -BALL_R - 0.001, y: lift, z: 0 },
    n: { x: 1, y: 0, z: 0 },
    toe: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
    halfToe: 0.105,
    halfUp: 0.027,
    v: { x: speed, y: 0, z: 0 },
    w: { x: 0, y: 0, z: 0 },
    sweep: 1 / 240,
    shaft: null,
  };
}

{
  const ball = createBallState(0, BALL_R, 0);
  const env = { ...floor, face: face(10) };
  const dt = 1 / 240;
  let struck = false;
  for (let i = 0; i < 30; i += 1) {
    const ev = stepBall(ball, dt, env);
    if (ev.some((e) => e.type === 'strike')) struck = true;
    env.face.c.x += 10 * dt;
  }
  check('strike leaves faster than the stick', struck && ball.v.x > 12 && ball.v.x < 18, `vx ${ball.v.x.toFixed(2)} struck ${struck}`);
}

{
  const ball = createBallState(0, BALL_R, 0);
  const env = { ...floor, face: face(2) };
  const dt = 1 / 240;
  let pushed = false;
  let struck = false;
  for (let i = 0; i < 80; i += 1) {
    const ev = stepBall(ball, dt, env);
    if (ev.some((e) => e.type === 'push')) pushed = true;
    if (ev.some((e) => e.type === 'strike')) struck = true;
    env.face.c.x += 2 * dt;
  }
  check('push stays with the stick', pushed && !struck && ball.v.x > 1.2 && ball.v.x < 3.2, `vx ${ball.v.x.toFixed(2)} push ${pushed} strike ${struck}`);
}

{
  const ball = createBallState(0, 0.2, 0);
  const env = { ...floor, face: face(9, 0) };
  env.face.c.x = -0.012;
  env.face.c.y = 0.2 - 0.045;
  const dt = 1 / 240;
  for (let i = 0; i < 20; i += 1) {
    stepBall(ball, dt, env);
    env.face.c.x += 9 * dt;
  }
  check('low face lofts the ball', ball.v.y > 1.2, `vy ${ball.v.y.toFixed(2)} vx ${ball.v.x.toFixed(2)}`);
}

function rodrigues(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const cx = axis.y * v.z - axis.z * v.y;
  const cy = axis.z * v.x - axis.x * v.z;
  const cz = axis.x * v.y - axis.y * v.x;
  return {
    x: v.x * c + cx * s + axis.x * d * (1 - c),
    y: v.y * c + cy * s + axis.y * d * (1 - c),
    z: v.z * c + cz * s + axis.z * d * (1 - c),
  };
}

{
  const grip = { x: 0, y: 0.9, z: 0 };
  const sole = { x: 0.55, y: -0.04, z: 0.08 };
  const hit = soleCatch(grip, sole, 0);
  const d = { x: sole.x - grip.x, y: sole.y - grip.y, z: sole.z - grip.z };
  const lifted = rodrigues(d, hit.axis, hit.angle);
  const y = grip.y + lifted.y;
  check('sole pivots up onto the floor', hit.angle > 0 && y >= 0.004, `y ${y.toFixed(3)} angle ${hit.angle.toFixed(3)}`);
}

{
  const above = soleCatch({ x: 0, y: 1, z: 0 }, { x: 0.4, y: 0.05, z: 0 }, 0);
  check('sole above the floor is free', above.angle === 0 && above.pen <= 0, `pen ${above.pen.toFixed(3)}`);
}

{
  const fat = turfDrag({ x: 12, y: -8, z: 1 }, { x: 0, y: 2, z: 0 }, 0.04);
  const brush = turfDrag({ x: 10, y: -0.3, z: 0 }, { x: 0, y: 0, z: 0 }, 0.001);
  check('a dig into the floor kills the swing', fat.kill > 0.8 && fat.v.y >= 0 && fat.v.x < 2, `kill ${fat.kill.toFixed(2)} vx ${fat.v.x.toFixed(2)}`);
  check('a brush keeps the swing', brush.kill < 0.15 && brush.v.x > 8, `kill ${brush.kill.toFixed(2)} vx ${brush.v.x.toFixed(2)}`);
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
