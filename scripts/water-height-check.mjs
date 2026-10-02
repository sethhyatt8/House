// node scripts/water-height-check.mjs
// Checks that water.js heightAt() (CPU) matches the vertex shader's Gerstner displacement: for grid
// points p it applies the same forward displacement the shader does (p + disp(p)), then asks heightAt()
// for the height at the displaced x/z. Uses the neutral (pre-bake) shore mask.
globalThis.location = { search: '' };
const THREE = await import('three');
const { createOcean, WAVES } = await import('../src/water.js');

const WATER_Y = -2.0;
const NEAR_X = -1.65;
const scene = new THREE.Scene();
const ocean = createOcean({ scene, waterY: WATER_Y, nearX: NEAR_X, cliffX: -1.78, assets: null, moonDir: new THREE.Vector3(-0.97, 0.24, 0.04), sky: null });

function smoothstep(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }
// Mirror of the vertex shader loop (amp from the shore texture's B channel; open sea = 1 before bake).
function forward(px, pz, eye, phases, amp) {
  const dist = Math.hypot(px - eye.x, pz - eye.z);
  let dx = 0; let dy = 0; let dz = 0;
  WAVES.forEach((w, i) => {
    const f = amp * (1 - smoothstep(0, 1, (dist - w.fadeFrom) / (w.fadeTo - w.fadeFrom)));
    const th = w.k * (w.dirX * px + w.dirZ * pz) - phases[i];
    dx += w.dirX * w.side * f * Math.cos(th);
    dz += w.dirZ * w.side * f * Math.cos(th);
    dy += w.amp * f * Math.sin(th);
  });
  return { dx, dy, dz };
}

let worst = 0; let sum = 0; let count = 0; let maxH = 0;
const eye = new THREE.Vector3(-1, WATER_Y + 1.6, 0);
ocean.setEye(eye);
for (const t of [0, 13.7, 600.25, 3600.5]) {
  ocean.update(t - ocean.time);
  const phases = ocean.uniforms.uWaveB.value.map((v) => v.y);
  for (let x = -60; x <= -2; x += 0.73) {
    for (let z = -30; z <= 30; z += 0.71) {
      const u = (x - -64) / 64; const v = (z - -32) / 64;
      const amp = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? (x < NEAR_X ? 1 : 0) : 1;
      if (amp === 0) continue;
      const d = forward(x, z, eye, phases, amp);
      const wx = x + d.dx;
      if (wx > NEAR_X) continue;
      const h = ocean.heightAt(wx, z + d.dz);
      const err = Math.abs(h - d.dy);
      worst = Math.max(worst, err); sum += err; count += 1; maxH = Math.max(maxH, Math.abs(d.dy));
    }
  }
}
console.log(`samples ${count}, max |h| ${(maxH * 100).toFixed(1)} cm, mean err ${(sum / count * 1000).toFixed(3)} mm, max err ${(worst * 1000).toFixed(3)} mm`);
if (worst > 0.002) { console.error('FAIL: heightAt() drifts from the shader displacement by more than 2 mm'); process.exit(1); }
console.log('OK');
