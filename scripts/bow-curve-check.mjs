// node scripts/bow-curve-check.mjs
// 1) The bow curve in src/gear.js (arrowSpeed) keeps the old line 8 + power * 18 up to 60% draw and is ~+35% at full draw.
// 2) Replays gear.js updateArrows() stepping (gravity 9.2, ray from the previous tip 0.66 m ahead of the arrow origin,
//    far = step + 0.08) at full-draw speed against a 0.045 m board at 1..40 m, three pitches and five frame times.
import fs from 'node:fs';
import * as THREE from 'three';

const src = fs.readFileSync(new URL('../src/gear.js', import.meta.url), 'utf8');
const body = src.match(/export function arrowSpeed\(power\) \{([\s\S]*?)\n\}/);
if (!body) throw new Error('arrowSpeed(power) not found in src/gear.js');
const consts = ['BOW_MAX', 'BOW_KNEE', 'BOW_BOOST'].map((name) => src.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
const make = (old) => new Function('power', `const BOW_OLD = ${old};\n${consts}\n${body[1]}`);
const arrowSpeed = make(false);
const oldCurve = make(true);
const line = (p) => 8 + Math.min(p, 0.58) * 18;

let fail = 0;
const rows = [];
for (const p of [0.16, 0.2, 0.25, 0.3, 0.348, 0.4, 0.45, 0.5, 0.55, 0.58]) {
  rows.push({ draw: p, pct: Math.round((p / 0.58) * 100), old: +line(p).toFixed(2), new: +arrowSpeed(p).toFixed(2) });
  if (Math.abs(oldCurve(p) - line(p)) > 1e-9) { fail++; console.log('?bowcurve=old differs from the old line at', p); }
  if (p <= 0.348 && Math.abs(arrowSpeed(p) - line(p)) > 1e-9) { fail++; console.log('low end changed at', p); }
}
console.table(rows);
const gain = arrowSpeed(0.58) / line(0.58) - 1;
console.log(`full draw ${line(0.58).toFixed(2)} -> ${arrowSpeed(0.58).toFixed(2)} m/s (+${(gain * 100).toFixed(1)}%)`);
if (gain < 0.3 || gain > 0.4) { fail++; console.log('top-speed gain outside +30..40%'); }
for (let p = 0.16; p < 0.58; p += 0.001) if (arrowSpeed(p + 0.001) < arrowSpeed(p)) { fail++; console.log('not monotonic at', p); break; }

const up = new THREE.Vector3(0, 1, 0);
let tests = 0; let misses = 0; let maxStep = 0;
const board = new THREE.Mesh(new THREE.BoxGeometry(0.045, 60, 60));
for (const dt of [1 / 120, 1 / 90, 1 / 72, 1 / 30, 0.05]) {
  for (let d = 1.0; d < 40; d += 0.137) {
    for (const pitch of [0, 0.3, 0.7]) {
      board.position.set(d, 0, 0); board.updateMatrixWorld();
      const v = new THREE.Vector3(Math.cos(pitch), Math.sin(pitch), 0).multiplyScalar(arrowSpeed(0.58));
      const pos = new THREE.Vector3(0, 1.5, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, v.clone().normalize());
      let hit = false; tests++;
      for (let t = 0; t < 4.2 && !hit; t += dt) {
        v.y -= 9.2 * dt;
        const step = v.length() * dt; maxStep = Math.max(maxStep, step);
        const prev = pos.clone().addScaledVector(up.clone().applyQuaternion(q), 0.66);
        pos.addScaledVector(v, dt);
        const aim = v.clone().normalize(); q.setFromUnitVectors(up, aim);
        if (new THREE.Raycaster(prev, aim, 0, step + 0.08).intersectObject(board).length) hit = true;
        if (pos.x > d + 1 || pos.y < -60) break;
      }
      if (!hit) misses++;
    }
  }
}
console.log(JSON.stringify({ tests, misses, maxStepM: +maxStep.toFixed(3) }));
if (misses) fail++;
console.log(fail ? 'FAIL' : 'OK');
process.exit(fail ? 1 : 0);
