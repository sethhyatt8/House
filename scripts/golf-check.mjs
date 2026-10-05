// A lofted driver face should send a golf ball up and a long way west, then into the water.
import { createBallState, stepBall } from '../src/hockeyball.js';

const R = 0.02135;
const loft = 12 * Math.PI / 180;
const nx = -Math.cos(loft);
const ny = Math.sin(loft);
let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log(`ok  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

function golfBall(x, y, z) {
  const ball = createBallState(x, y, z);
  ball.r = R;
  ball.m = 0.04593;
  ball.faceE = 0.8;
  ball.floorE = 0.4;
  ball.floorMu = 0.5;
  ball.cd = 0.25;
  ball.magnus = 0.0032;
  return ball;
}

const gap = R + 0.001;
const face = {
  c: { x: -nx * gap, y: 11.4 - ny * gap, z: 0 },
  n: { x: nx, y: ny, z: 0 },
  toe: { x: 0, y: 0, z: 1 },
  up: { x: ny, y: -nx, z: 0 },
  halfToe: 0.046,
  halfUp: 0.022,
  v: { x: nx * 12, y: ny * 12, z: 0 },
  w: { x: 0, y: 0, z: 0 },
  sweep: 1 / 240,
  shaft: null,
};

{
  const ball = golfBall(0, 11.4, 0);
  const env = { floorAt: () => -8, waterY: -8, boxes: [], face };
  const dt = 1 / 240;
  let struck = false;
  for (let i = 0; i < 40; i += 1) {
    const ev = stepBall(ball, dt, env);
    if (ev.some((e) => e.type === 'strike')) struck = true;
    face.c.x += face.v.x * dt;
    face.c.y += face.v.y * dt;
  }
  check('driver strike climbs and goes west', struck && ball.v.x < -10 && ball.v.y > 1.5, `vx ${ball.v.x.toFixed(2)} vy ${ball.v.y.toFixed(2)} struck ${struck}`);
  env.face = null;
  let peak = ball.p.y;
  let west = ball.p.x;
  let wet = false;
  for (let t = 0; t < 4; t += 1 / 60) {
    stepBall(ball, 1 / 60, env);
    peak = Math.max(peak, ball.p.y);
    west = Math.min(west, ball.p.x);
    if (ball.p.y < -7.5) {
      wet = true;
      break;
    }
  }
  check('drive clears the point and reaches the water', west < -18 && peak > 11.8 && wet, `west ${west.toFixed(1)} peak ${peak.toFixed(2)} wet ${wet}`);
}

{
  const tee = 11.36 + 0.042;
  const ball = golfBall(-0.42, tee + R, 0.02);
  const env = {
    floorAt: (x, z, y) => (Math.hypot(x + 0.42, z - 0.02) < 0.028 && y > 11.36 && y < tee + 0.05 ? tee : -8),
    waterY: -8,
    boxes: [],
    face: null,
  };
  for (let t = 0; t < 1; t += 1 / 60) stepBall(ball, 1 / 60, env);
  check('ball stays on the tee', Math.abs(ball.p.y - (tee + R)) < 0.004 && ball.asleep, `y ${ball.p.y.toFixed(4)} asleep ${ball.asleep}`);
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
