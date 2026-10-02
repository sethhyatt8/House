// src/health.js - minimal player health for the croc fight (only created when the croc exists).
import * as THREE from 'three';

export const PLAYER_MAX_HP = 100;
const INVULN = 1.2;        // s of invulnerability after a hit (grab ticks ignore it)
const REGEN_DELAY = 6;     // s without damage before regen starts
const REGEN_RATE = 8;      // hp per second
const LOW = 35;            // heartbeat + red edge below this
const DOWN_FADE = 0.8;     // s fade before onDown()

export function createPlayerHealth({ scene, camera, onDown = null, onHeartbeat = null }) {
  const uniforms = { uOpacity: { value: 0 }, uFlash: { value: 0 }, uColor: { value: new THREE.Color(0xb00010) } };
  const veil = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOpacity; uniform float uFlash; uniform vec3 uColor; varying vec3 vDir;'
        + ' void main() { float f = -normalize(vDir).z; float edge = 1.0 - smoothstep(0.45, 0.95, f);'
        + ' gl_FragColor = vec4(uColor, clamp(uOpacity * edge + uFlash * 0.45, 0.0, 1.0)); }',
      transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false,
    }),
  );
  veil.renderOrder = 999;
  veil.frustumCulled = false;
  veil.visible = false;
  veil.raycast = () => {};
  if (!camera.parent) scene.add(camera);   // camera children only render when the camera is in the scene graph
  camera.add(veil);

  let hp = PLAYER_MAX_HP;
  let clock = 0;
  let lastHurt = -99;
  let invulnUntil = -99;
  let flash = 0;
  let downT = -1;
  let beatT = 0;

  function damage(amount, { ignoreInvuln = false } = {}) {
    if (downT >= 0 || amount <= 0) return 0;
    if (!ignoreInvuln && clock < invulnUntil) return 0;
    const dealt = Math.min(hp, amount);
    hp -= dealt;
    lastHurt = clock;
    if (!ignoreInvuln) invulnUntil = clock + INVULN;
    flash = 1;
    if (hp <= 0) downT = 0;
    return dealt;
  }

  function update(dt) {
    clock += dt;
    if (downT >= 0) {
      downT += dt;
      uniforms.uOpacity.value = 1;
      uniforms.uFlash.value = Math.min(1, downT / DOWN_FADE) * 2.8;   // near-opaque red-out
      veil.visible = true;
      if (downT >= DOWN_FADE) {
        downT = -1;
        hp = PLAYER_MAX_HP;
        flash = 1;
        invulnUntil = clock + 3;
        onDown?.();
      }
      return;
    }
    if (clock - lastHurt > REGEN_DELAY && hp < PLAYER_MAX_HP) hp = Math.min(PLAYER_MAX_HP, hp + REGEN_RATE * dt);
    flash = Math.max(0, flash - dt * 1.6);
    const low = hp < LOW ? (1 - hp / LOW) : 0;
    if (low > 0) {
      beatT -= dt;
      if (beatT <= 0) { beatT = 0.55 + (hp / LOW) * 0.5; onHeartbeat?.(low); }
    } else beatT = 0;
    uniforms.uOpacity.value = Math.max(flash * 0.95, low > 0 ? (0.25 + low * 0.6) * (0.85 + 0.15 * Math.sin(clock * 7)) : 0);
    uniforms.uFlash.value = flash * 0.5;
    veil.visible = uniforms.uOpacity.value > 0.005 || uniforms.uFlash.value > 0.005;
  }

  function reset() { hp = PLAYER_MAX_HP; flash = 0; downT = -1; lastHurt = -99; invulnUntil = -99; update(0); }

  return { damage, update, reset, veil, hp: () => hp, downed: () => downT >= 0, max: PLAYER_MAX_HP };
}
