// Headless check for the hang glider: a slight nose-down holds a glide, a push dives, a pull climbs, a bank turns.
import * as THREE from 'three';
import { barFrame, stepGlide } from '../src/glider.js';

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`ok  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

function fly(nose, up, seconds, v0) {
  const v = { x: v0[0], y: v0[1], z: v0[2] };
  const dt = 1 / 60;
  let x = 0;
  let y = 0;
  let z = 0;
  let peak = 0;
  for (let t = 0; t < seconds; t += dt) {
    stepGlide(v, nose, up, dt);
    x += v.x * dt;
    y += v.y * dt;
    z += v.z * dt;
    if (y > peak) peak = y;
  }
  return { v, x, y, z, peak, speed: Math.hypot(v.x, v.y, v.z) };
}

const level = fly({ x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 4, [-9, 0, 0]);
check('level nose keeps flying forward', level.v.x < -4, `vx ${level.v.x.toFixed(2)}`);
check('level nose sinks', level.y < -1, `y ${level.y.toFixed(2)}`);

const dive = fly({ x: -0.98, y: -0.2, z: 0 }, { x: -0.2, y: 0.98, z: 0 }, 4, [-8, 0, 0]);
check('nose down is faster than level', dive.speed > level.speed + 0.5, `dive ${dive.speed.toFixed(2)} level ${level.speed.toFixed(2)}`);
check('nose down covers more ground', dive.x < level.x - 4, `dive x ${dive.x.toFixed(2)} level x ${level.x.toFixed(2)}`);

const climb = fly({ x: -0.97, y: 0.24, z: 0 }, { x: 0.24, y: 0.97, z: 0 }, 1.5, [-10, 0, 0]);
check('nose up climbs at first', climb.peak > 0.35, `peak ${climb.peak.toFixed(2)}`);

const bank = fly({ x: -1, y: 0, z: 0 }, { x: 0, y: 0.92, z: 0.39 }, 3, [-9, 0, 0]);
check('banked wing drifts sideways', Math.abs(bank.z) > 1.5, `z ${bank.z.toFixed(2)}`);

const stall = fly({ x: -0.95, y: 0.31, z: 0 }, { x: 0.31, y: 0.95, z: 0 }, 3, [-3, 0, 0]);
check('a slow nose-up drops', stall.y < -2, `y ${stall.y.toFixed(2)}`);

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const left = V(-0.35, 1.3, -0.28);
const right = V(-0.35, 1.3, 0.28);
const head = V(0, 1.55, 0);
const pushed = barFrame(left, right, head, V(-1, 0, 0));
check('bar across the hands points the nose out', pushed.nose.x < -0.8, `nose ${pushed.nose.x.toFixed(2)} ${pushed.nose.y.toFixed(2)}`);

const pulled = barFrame(V(-0.08, 1.35, -0.28), V(-0.08, 1.35, 0.28), head, V(-1, 0, 0));
check('pulling the bar in noses up', pulled.nose.y > pushed.nose.y + 0.15, `pulled ${pulled.nose.y.toFixed(2)} pushed ${pushed.nose.y.toFixed(2)}`);

const banked = barFrame(V(-0.35, 1.45, -0.28), V(-0.35, 1.15, 0.28), head, V(-1, 0, 0));
check('a lower right hand banks the right wing', banked.wingUp.z < -0.15 || banked.wingUp.z > 0.15, `up ${banked.wingUp.z.toFixed(2)}`);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
