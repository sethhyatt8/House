// src/daynight.js - day/night cycle with morning sea fog. ?daynight=0 leaves the old fixed night lighting exactly
// (nothing here is created and no shader is patched).
//
// - Clock: hour 0..24, default 24 real minutes per day (?daylen=<min>), start ?time=<hour> (default 10),
//   ?timescale=<x> (0 freezes the clock). +x east (woods), -x west (sea), -z north, +z south.
// - Sun: one DirectionalLight (the old key light) rises in the east at 05:45, peaks 62 deg up in the south at 12:30 and
//   sets in the west at 19:15. Its intensity follows the elevation, so at the horizon it is 0. After sunset the same
//   light fades back in as the moon, from the old fixed night direction (where the baked moon/glint already are), with
//   the old night colour and intensity. The direction swap happens while the light is at 0.
// - Shadows: still ONE shadow map. The shadow box (+-?shadowbox m, default 7) follows the player, its centre snapped
//   to whole shadow texels in light space, and the light direction moves in 0.05 deg steps, so shadows swing and
//   lengthen without shimmering.
// - Looks: a 6-key gradient (night, dawn, morning, noon, dusk, night) drives light colour/intensity, hemisphere,
//   fill/rim, sky (night texture <-> analytic day sky with a sun disc), fog, ocean colours, forest haze, the garden
//   lantern, fireflies and the night ambience bed.
// - Env/reflections: one PMREM probe per key (the night one is the original HDR probe), rendered lazily (one per
//   frame, never two in a frame), and blended into a single CubeUV target with one full-screen pass at most every
//   few frames. Inside caves/tunnel/gallery/lift/cell the lights and env go back to the old night rig.
// - Morning fog (?fog=0 off): rolls in from 05:24 to 07:12, holds to 07:48, burns off by 10:00. Thicker linear fog
//   (far 26 m at peak), a low fog bank over the sea in the sky/sea horizon, and the camera far plane drops to the fog
//   distance at the peak (fewer draw calls; ?fogcull=0 keeps it).
import * as THREE from 'three';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const num = (k, d) => { const v = params.get(k); const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : d; };
export const DAYNIGHT = params.get('daynight') !== '0';
export const DAY_MINUTES = Math.max(0.05, num('daylen', 24));
export const START_HOUR = ((num('time', 10) % 24) + 24) % 24;
export const TIMESCALE = Math.max(0, num('timescale', 1));
export const MORNING_FOG = params.get('fog') !== '0';
const FOG_CULL = params.get('fogcull') !== '0';
const SHADOW_BOX = Math.max(1, num('shadowbox', 4.5));
const SHADOW_REACH = Math.max(4, num('shadowreach', 16)); // how far up-sun a caster may be (m)
const CASTER_R = Math.max(0, num('shadowr', 4)); // small casters only cast within this distance of the head (m)
const CASTER_N = Math.max(0, num('shadown', 6)); // ...and only the nearest N of them
const BIG = 1.5; // bounding radius (m) from which a caster is "big" and always casts (house, crag, instanced sets)

export const SUNRISE = 5.75;
export const SUNSET = 19.25;
export const NOON = (SUNRISE + SUNSET) / 2;
const SUN_PEAK = THREE.MathUtils.degToRad(62);
// the old key light: position (-7, 9, 2) toward target (0, 0.6, -0.2)
export const MOON_DIR = new THREE.Vector3(-7, 8.4, 2.2).normalize();
// the baked moon of the night backdrop (water.js glint direction)
export const BAKED_MOON = new THREE.Vector3(-0.9701, 0.2385, 0.0441).normalize();

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export const wrap24 = (h) => ((h % 24) + 24) % 24;

// Sun direction (unit, toward the sun) for an hour; below the horizon outside SUNRISE..SUNSET.
export function sunDir(h, out = new THREE.Vector3()) {
  let t = (wrap24(h) - SUNRISE) / (SUNSET - SUNRISE); // 0 sunrise, 1 sunset; night hours run on past 1 / before 0
  if (t < -0.5 * (24 - (SUNSET - SUNRISE)) / (SUNSET - SUNRISE)) t += 24 / (SUNSET - SUNRISE);
  const th = t * Math.PI;
  return out.set(Math.cos(th), Math.sin(th) * Math.sin(SUN_PEAK), Math.sin(th) * Math.cos(SUN_PEAK)).normalize();
}
// Light weights: sun 0 at/below the horizon, full from ~7 deg up; the moon only once the sun is well down.
export function sunWeight(h) { return smooth(0.0, 0.12, sunDir(h, _v).y); }
export function moonWeight(h) {
  const hh = wrap24(h);
  const afterSet = smooth(SUNSET + 0.25, SUNSET + 1.25, hh);
  const beforeRise = 1 - smooth(SUNRISE - 1.0, SUNRISE - 0.15, hh);
  return hh >= 12 ? afterSet : beforeRise;
}
const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();

// Morning sea fog amount 0..1 (and a slightly longer-lived low bank over the sea).
export const FOG_TIMES = { in0: 5.4, in1: 7.2, out0: 7.8, out1: 10.0 };
export function fogAmount(h) {
  if (!MORNING_FOG) return 0;
  const hh = wrap24(h);
  return smooth(FOG_TIMES.in0, FOG_TIMES.in1, hh) * (1 - smooth(FOG_TIMES.out0, FOG_TIMES.out1, hh));
}
export function bankAmount(h) {
  if (!MORNING_FOG) return 0;
  const hh = wrap24(h);
  return smooth(FOG_TIMES.in0 - 0.3, FOG_TIMES.in1 - 0.6, hh) * (1 - smooth(FOG_TIMES.out0 + 0.4, FOG_TIMES.out1 + 0.6, hh));
}
export const FOG_PEAK = { near: 2.5, far: 26, cullFar: 34 };

// ---- the 6 looks ----
const C = (hex) => new THREE.Color(hex);
const LOOKS = {
  night: { // = the old fixed lighting (world.js / water.js / forest.js values)
    keyCol: C(0xd5e2ff), keyI: 1.15, hemiSky: C(0x8ea4cc), hemiGround: C(0x2a2622), hemiI: 0.26, fillI: 0.34, rimI: 0.4,
    fog: C(0x10182c), fogNear: 18, fogFar: 210, zenith: C(0x05070f), horizon: C(0x1a2742), sunCol: C(0xd5e2ff), day: 0,
    envI: 1, haze: C(0x1b2738), deep: C(0x02080c), shallow: C(0x0e3a40), scatter: C(0x0a3a3c), foam: C(0xa7b3bb),
    refl: C(0x1c2636), glint: 1.6, night: 1,
  },
  dawn: {
    keyCol: C(0xffb27c), keyI: 1.7, hemiSky: C(0x9aa2c8), hemiGround: C(0x3a302c), hemiI: 0.55, fillI: 0.3, rimI: 0.25,
    fog: C(0xa49eb0), fogNear: 14, fogFar: 170, zenith: C(0x3a5288), horizon: C(0xf2b890), sunCol: C(0xffb070), day: 1,
    envI: 0.9, haze: C(0x9a96ac), deep: C(0x0a1a26), shallow: C(0x22525a), scatter: C(0x1a4a50), foam: C(0xc4c4cc),
    refl: C(0x6a7088), glint: 2.2, night: 0.12,
  },
  morning: {
    keyCol: C(0xffeacc), keyI: 2.5, hemiSky: C(0xb0cdf2), hemiGround: C(0x4e4436), hemiI: 0.8, fillI: 0.32, rimI: 0.28,
    fog: C(0xadc3da), fogNear: 24, fogFar: 240, zenith: C(0x3d70c2), horizon: C(0xc0d6ec), sunCol: C(0xfff0d6), day: 1,
    envI: 0.85, haze: C(0xa2b6ce), deep: C(0x0b2a3c), shallow: C(0x2a7078), scatter: C(0x1d5f66), foam: C(0xe2e8ec),
    refl: C(0x8aa4c4), glint: 3.0, night: 0,
  },
  noon: {
    keyCol: C(0xfff6e8), keyI: 2.9, hemiSky: C(0xb8d4ff), hemiGround: C(0x54493a), hemiI: 0.85, fillI: 0.3, rimI: 0.25,
    fog: C(0xb8cee4), fogNear: 30, fogFar: 260, zenith: C(0x3064c0), horizon: C(0xc6dcf2), sunCol: C(0xfff8ec), day: 1,
    envI: 0.85, haze: C(0xacc2da), deep: C(0x0a3048), shallow: C(0x2a8088), scatter: C(0x1f6a72), foam: C(0xeef2f4),
    refl: C(0x9ab6d6), glint: 3.2, night: 0,
  },
  dusk: {
    keyCol: C(0xff9c5a), keyI: 1.8, hemiSky: C(0x8e80aa), hemiGround: C(0x34282a), hemiI: 0.45, fillI: 0.3, rimI: 0.3,
    fog: C(0x7e687c), fogNear: 20, fogFar: 220, zenith: C(0x2a3864), horizon: C(0xee9866), sunCol: C(0xff8444), day: 1,
    envI: 0.9, haze: C(0x6e5e78), deep: C(0x081622), shallow: C(0x1c4048), scatter: C(0x18383e), foam: C(0xb4aab0),
    refl: C(0x5c5470), glint: 2.4, night: 0.3,
  },
};
export const KEY_NAMES = ['night', 'dawn', 'morning', 'noon', 'dusk', 'night'];
// [hour, look, ease]: ease > 1 holds the start look longer (the afternoon stays noon-like). Night holds 20:24 .. 04:36; six keys in order, the night key repeated across midnight.
export const KEYS = [[0, 'night'], [4.6, 'night'], [6.0, 'dawn'], [9.0, 'morning'], [12.5, 'noon', 2.4], [18.6, 'dusk'], [20.4, 'night'], [24, 'night']];
const SCALARS = ['keyI', 'hemiI', 'fillI', 'rimI', 'fogNear', 'fogFar', 'day', 'envI', 'glint', 'night'];
const COLORS = ['keyCol', 'hemiSky', 'hemiGround', 'fog', 'zenith', 'horizon', 'sunCol', 'haze', 'deep', 'shallow', 'scatter', 'foam', 'refl'];
export function makeLook() { const o = {}; for (const k of SCALARS) o[k] = 0; for (const k of COLORS) o[k] = new THREE.Color(); return o; }
export function segmentAt(h) {
  const hh = wrap24(h);
  for (let i = 0; i < KEYS.length - 1; i += 1) {
    if (hh >= KEYS[i][0] && hh < KEYS[i + 1][0]) return { a: KEYS[i][1], b: KEYS[i + 1][1], t: smooth(0, 1, ((hh - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0])) ** (KEYS[i][2] || 1)), i };
  }
  return { a: 'night', b: 'night', t: 0, i: 0 };
}
export function lookAt(h, out = makeLook()) {
  const { a, b, t } = segmentAt(h);
  const A = LOOKS[a]; const B = LOOKS[b];
  for (const k of SCALARS) out[k] = A[k] + (B[k] - A[k]) * t;
  for (const k of COLORS) out[k].copy(A[k]).lerp(B[k], t);
  return out;
}
export function lookOf(name) { return LOOKS[name]; }

// ---- sky (shared by the sky dome and the ocean's far-sea mirror) ----
export const SKY_UNIFORMS = {
  uDnDay: { value: 0 }, uDnZenith: { value: new THREE.Color() }, uDnHorizon: { value: new THREE.Color() },
  uDnSunCol: { value: new THREE.Color() }, uDnSunDir: { value: new THREE.Vector3(0, -1, 0) },
  uDnFogCol: { value: new THREE.Color() }, uDnFog: { value: 0 }, uDnBank: { value: 0 },
};
export const SKY_GLSL = /* glsl */`
uniform float uDnDay; uniform vec3 uDnZenith; uniform vec3 uDnHorizon; uniform vec3 uDnSunCol; uniform vec3 uDnSunDir;
uniform vec3 uDnFogCol; uniform float uDnFog; uniform float uDnBank;
vec3 dnDaySky(vec3 d, float disc) {
  float h = 1.0 - clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uDnZenith, uDnHorizon, h * h * h);
  col = mix(col, uDnHorizon * 0.5, clamp(-d.y * 6.0, 0.0, 1.0));
  float mu = max(dot(d, uDnSunDir), 0.0);
  float up = smoothstep(-0.14, 0.03, uDnSunDir.y);
  col += uDnSunCol * (pow(mu, 5.0) * 0.22 * h * h + pow(mu, 60.0) * 0.5) * up;
  float sd = length(d - uDnSunDir);
  col += uDnSunCol * (1.0 - smoothstep(0.017, 0.022, sd)) * 14.0 * disc * smoothstep(-0.03, 0.01, uDnSunDir.y);
  return col;
}
vec3 dnSky(vec3 night, vec3 d, float disc) {
  vec3 col = uDnDay > 0.0 ? mix(night, dnDaySky(d, disc), uDnDay) : night;
  float west = clamp(0.35 - d.x * 0.65, 0.0, 1.0);
  float bank = uDnBank * (1.0 - smoothstep(-0.01, 0.035 + 0.11 * west, d.y)) * (0.55 + 0.45 * west);
  float veil = uDnFog * (1.0 - 0.3 * smoothstep(0.1, 0.9, d.y));
  return mix(col, uDnFogCol, clamp(max(veil, bank), 0.0, 1.0));
}`;

// Sky dome material (world.js): MeshBasicMaterial with the night backdrop map; the day sky is mixed in after the map.
export function patchSkyMaterial(material) {
  if (!DAYNIGHT) return material;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SKY_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDnDir;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDnDir = (modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDnDir;\n${SKY_GLSL}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = dnSky(diffuseColor.rgb, normalize(vDnDir), 1.0);');
  };
  material.customProgramCacheKey = () => 'dn-sky';
  return material;
}

// ---- env probes ----
const PROBE_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
function createProbes(renderer, envNight, nightMap) {
  const cubeSize = Math.max(16, Math.round((envNight?.image?.height || 512) / 4));
  const eqW = cubeSize * 4;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const quadScene = new THREE.Scene();
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const probeU = {
    ...SKY_UNIFORMS,
    uDnDay: { value: 0 }, uDnZenith: { value: new THREE.Color() }, uDnHorizon: { value: new THREE.Color() },
    uDnSunCol: { value: new THREE.Color() }, uDnSunDir: { value: new THREE.Vector3() }, uDnFogCol: { value: new THREE.Color() },
    uDnFog: { value: 0 }, uDnBank: { value: 0 }, uNight: { value: nightMap || null }, uHasNight: { value: nightMap ? 1 : 0 },
    uGround: { value: new THREE.Color() }, uNightGain: { value: 1 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: probeU,
    vertexShader: PROBE_VS,
    fragmentShader: `${SKY_GLSL}
uniform sampler2D uNight; uniform float uHasNight; uniform vec3 uGround; uniform float uNightGain; varying vec2 vUv;
void main() {
  float phi = (vUv.x - 0.5) * 6.28318530718; float th = (vUv.y - 0.5) * 3.14159265359;
  vec3 d = vec3(cos(th) * cos(phi), sin(th), cos(th) * sin(phi));
  vec3 night = uHasNight > 0.5
    ? texture2D(uNight, vec2(fract(atan(-d.z, -d.x) * 0.15915494), 1.0 - acos(clamp(d.y, -1.0, 1.0)) * 0.31830989)).rgb * uNightGain
    : mix(uDnHorizon, uDnZenith, clamp(d.y, 0.0, 1.0));
  vec3 col = dnSky(night, d, 0.0);
  col = mix(col, uGround, smoothstep(0.0, -0.08, d.y));
  gl_FragColor = vec4(col, 1.0);
}`,
    depthTest: false, depthWrite: false,
  });
  const blendMat = new THREE.ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, tN: { value: null }, uT: { value: 0 }, uIn: { value: 0 }, uSize: { value: new THREE.Vector2() } },
    vertexShader: PROBE_VS,
    fragmentShader: `uniform sampler2D tA; uniform sampler2D tB; uniform sampler2D tN; uniform float uT; uniform float uIn; uniform vec2 uSize;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = mix(texture2D(tA, uv).rgb, texture2D(tB, uv).rgb, uT);
  gl_FragColor = vec4(mix(c, texture2D(tN, uv).rgb, uIn), 1.0);
}`,
    depthTest: false, depthWrite: false,
  });
  const eqRT = new THREE.WebGLRenderTarget(eqW, eqW / 2, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  eqRT.texture.mapping = THREE.EquirectangularReflectionMapping;
  const W = envNight?.image?.width || 3 * Math.max(cubeSize, 112); const H = envNight?.image?.height || 4 * cubeSize;
  const out = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
  out.texture.mapping = THREE.CubeUVReflectionMapping;
  out.texture.name = 'daynight_env';
  blendMat.uniforms.uSize.value.set(W, H);
  const cache = new Map(); // look name -> texture
  if (envNight) cache.set('night', envNight);
  const stats = { probes: 0, blends: 0, probeMs: [], blendMs: 0, cubeSize, size: [W, H] };

  function withRenderer(fn) {
    const xr = renderer.xr.enabled; const target = renderer.getRenderTarget(); const auto = renderer.autoClear;
    renderer.xr.enabled = false; renderer.autoClear = true;
    try { fn(); } finally { renderer.setRenderTarget(target); renderer.xr.enabled = xr; renderer.autoClear = auto; }
  }
  // stage 1 (one frame): the key's sky into the equirect target; stage 2 (a later frame): PMREM of it.
  let pending = null;
  function renderSky(name) {
    const L = LOOKS[name];
    probeU.uDnDay.value = L.day; probeU.uDnZenith.value.copy(L.zenith); probeU.uDnHorizon.value.copy(L.horizon);
    probeU.uDnSunCol.value.copy(L.sunCol); sunDir(name === 'dawn' ? 6.6 : name === 'morning' ? 9 : name === 'noon' ? NOON : name === 'dusk' ? 18.6 : 0, probeU.uDnSunDir.value);
    probeU.uGround.value.copy(L.hemiGround).lerp(L.deep, 0.5).multiplyScalar(0.6 + L.hemiI);
    quad.material = skyMat;
    withRenderer(() => { renderer.setRenderTarget(eqRT); renderer.render(quadScene, ortho); });
    pending = name;
  }
  function filter() {
    const t0 = performance.now();
    let rt = null;
    withRenderer(() => { rt = pmrem.fromEquirectangular(eqRT.texture); });
    cache.set(pending, rt.texture);
    stats.probes += 1; stats.probeMs.push(+(performance.now() - t0).toFixed(2));
    pending = null;
  }
  // Advance lazily: at most one probe stage per call. Returns true when work was done this frame.
  function step(wanted) {
    if (pending) { filter(); return true; }
    const name = wanted.find((n) => !cache.has(n));
    if (!name) return false;
    renderSky(name);
    return true;
  }
  function ensure(names) { for (const n of names) if (!cache.has(n)) { renderSky(n); filter(); } }
  function blend(a, b, t, indoor) {
    const A = cache.get(a); const B = cache.get(b) || A; const N = cache.get('night') || A;
    if (!A) return false;
    const t0 = performance.now();
    blendMat.uniforms.tA.value = A; blendMat.uniforms.tB.value = B; blendMat.uniforms.tN.value = N;
    blendMat.uniforms.uT.value = t; blendMat.uniforms.uIn.value = indoor;
    quad.material = blendMat;
    withRenderer(() => { renderer.setRenderTarget(out); renderer.render(quadScene, ortho); });
    stats.blends += 1; stats.blendMs = +(performance.now() - t0).toFixed(3);
    return true;
  }
  return { texture: out.texture, step, ensure, blend, has: (n) => cache.has(n), stats, cached: () => [...cache.keys()] };
}

// ---- the system ----
const INDOOR = (zone) => !!zone && (zone === 'cave' || zone === 'tunnel' || zone === 'gallery' || zone === 'cell' || zone === 'liftshaft' || zone.startsWith('lift'));

export function createDayNight({ renderer, scene, camera, world }) {
  const key = world.keyLight; const hemi = world.hemiLight; const fill = world.fillLight; const rim = world.rimLight;
  const ocean = world.water?.uniforms || null;
  const haze = world.forest?.haze || null;
  const fireflies = world.forest?.fireflies || null;
  const fireflyBase = fireflies ? fireflies.material.uniforms.uColor.value.clone() : null;
  const lantern = world.garden?.lantern || null;
  const lanternOpacity = lantern ? lantern.material.opacity : 1;
  const NIGHT = LOOKS.night;
  const look = makeLook(); const lit = makeLook();
  let hour = START_HOUR;
  const hoursPerSecond = 24 / (DAY_MINUTES * 60);
  const baseFar = camera.far;
  let culled = false;
  let indoor = 0;
  const state = { hour, fog: 0, bank: 0, glow: 0, nightSound: 1, sunW: 0, moonW: 0, keyI: 0, indoor: 0, far: baseFar, seg: null };

  // shadows: one map, a box that follows the player, texel-snapped
  const S = SHADOW_BOX; const D = SHADOW_REACH;
  const oldRig = { pos: key.position.clone(), target: key.target.position.clone(), cam: { left: key.shadow.camera.left, right: key.shadow.camera.right, top: key.shadow.camera.top, bottom: key.shadow.camera.bottom, near: key.shadow.camera.near, far: key.shadow.camera.far }, bias: key.shadow.bias };
  const sunRig = { left: -S, right: S, top: S, bottom: -S, near: 0.5, far: D + S + 2 };
  let rig = 'sun';
  function setRig(name) {
    if (rig === name) return;
    rig = name;
    Object.assign(key.shadow.camera, name === 'old' ? oldRig.cam : sunRig);
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = name === 'old' ? oldRig.bias : -0.0003;
    if (name === 'old') {
      key.position.copy(oldRig.pos); key.target.position.copy(oldRig.target);
      key.target.updateMatrixWorld(); key.updateMatrixWorld();
      for (const [o, r] of casters) if (r >= 0) o.castShadow = true; // the old frustum, the old casters
    } else lodWait = 0;
  }
  Object.assign(key.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 0.5, far: D + S + 2 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0003;
  const sun = new THREE.Vector3(); const dirQ = new THREE.Vector3(); const dir = new THREE.Vector3();
  const bx = new THREE.Vector3(); const by = new THREE.Vector3(); const centre = new THREE.Vector3(); const UP = new THREE.Vector3(0, 1, 0);
  const snap = { texel: 0, cx: 0, cy: 0 };
  function placeShadow(eye) {
    const texel = (2 * S) / key.shadow.mapSize.x;
    bx.crossVectors(UP, dirQ).normalize(); by.crossVectors(dirQ, bx);
    centre.set(eye.x, eye.y - 1.2, eye.z);
    const cx = Math.round(centre.dot(bx) / texel) * texel; const cy = Math.round(centre.dot(by) / texel) * texel; const cz = Math.round(centre.dot(dirQ) / texel) * texel;
    centre.copy(bx).multiplyScalar(cx).addScaledVector(by, cy).addScaledVector(dirQ, cz);
    key.target.position.copy(centre);
    key.position.copy(centre).addScaledVector(dirQ, D);
    key.target.updateMatrixWorld(); key.updateMatrixWorld();
    snap.texel = texel; snap.cx = cx; snap.cy = cy;
  }

  // Shadow caster LOD: the sun's box covers far more small props than the old fixed light did (the crate yard alone
  // has ~50 crate meshes), so small casters (bounding radius < 1.5 m) only cast within CASTER_R of the head, nearest
  // CASTER_N first. Big casters and anything that never cast are untouched. castShadow changes no shader program.
  const casters = new Map(); // mesh -> radius
  let scanWait = 0; let lodWait = 0;
  const sph = new THREE.Sphere(); const cand = [];
  const casterStats = { small: 0, big: 0, on: 0 };
  function scan() {
    scene.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || casters.has(o) || !o.castShadow || o.isInstancedMesh) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.updateWorldMatrix(true, false);
      const r = o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
      if (r >= BIG) { casterStats.big += 1; casters.set(o, -1); return; }
      casters.set(o, r); casterStats.small += 1;
    });
  }
  function casterLod(eye) {
    if (--scanWait <= 0) { scan(); scanWait = 240; }
    if (--lodWait > 0) return;
    lodWait = 6;
    cand.length = 0;
    for (const [o, r] of casters) {
      if (r < 0) continue;
      if (!o.parent) { casters.delete(o); continue; }
      sph.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      const d = sph.center.distanceTo(eye) - sph.radius;
      o.castShadow = false;
      if (d < CASTER_R) cand.push([d, o]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const n = Math.min(cand.length, CASTER_N);
    for (let i = 0; i < n; i += 1) cand[i][1].castShadow = true;
    casterStats.on = n;
  }

  // env probes
  const envNight = scene.environment || null;
  const probes = createProbes(renderer, envNight, world.skyTexture || null);
  let lastBlend = { a: '', b: '', t: -1, indoor: -1 };
  let blendWait = 0;
  {
    const seg = segmentAt(hour);
    probes.ensure([seg.a, seg.b]);
    probes.blend(seg.a, seg.b, seg.t, 0);
    lastBlend = { a: seg.a, b: seg.b, t: seg.t, indoor: 0 };
    scene.environment = probes.texture;
  }
  const mist = new THREE.Color(); const MIST = new THREE.Color(0xd2d8de);
  const tmpC = new THREE.Color();

  function apply(dt, eye) {
    lookAt(hour, look);
    // light direction: the sun by day, the old fixed moon direction by night (swapped while the light is at 0)
    const hq = Math.round(hour / 0.00375) * 0.00375; // 0.05 deg of sun arc per step (shadow stability)
    sunDir(hq, sun);
    const sunW = smooth(0.0, 0.12, sun.y); const moonW = moonWeight(hour);
    const useSun = sun.y > -0.05;
    dirQ.copy(useSun ? sun : MOON_DIR);
    // indoor (caves, tunnel, gallery, lift, cell): back to the old night rig
    const zone = world.zones?.enabled ? world.zones.current : (eye.y < -2.6 ? 'cave' : null);
    const target = INDOOR(zone) ? 1 : 0;
    indoor += (target - indoor) * (1 - Math.exp(-dt / 0.6));
    if (Math.abs(target - indoor) < 0.002) indoor = target;
    const lightW = useSun ? sunW : moonW;
    for (const k of SCALARS) lit[k] = look[k] + (NIGHT[k] - look[k]) * indoor;
    for (const k of COLORS) lit[k].copy(look[k]).lerp(NIGHT[k], indoor);
    const keyI = lit.keyI * (lightW + (1 - lightW) * indoor);
    key.color.copy(lit.keyCol); key.intensity = keyI;
    hemi.color.copy(lit.hemiSky); hemi.groundColor.copy(lit.hemiGround); hemi.intensity = lit.hemiI;
    if (fill) fill.intensity = lit.fillI;
    if (rim) rim.intensity = lit.rimI;
    scene.environmentIntensity = lit.envI * (+(params.get('envi') ?? 1));
    // indoors the old rig is exact, shadow frustum included (same shadow casters as before); outdoors the sun's box
    setRig(indoor >= 0.5 ? 'old' : 'sun');
    if (rig === 'sun') {
      placeShadow(eye);
      casterLod(_eye.set(eye.x, eye.y, eye.z));
    }

    // fog + sky
    const f = fogAmount(hour); const bank = bankAmount(hour);
    mist.copy(look.fog).lerp(MIST, 0.4 * look.day).multiplyScalar(0.55 + 0.45 * look.day);
    const fogCol = tmpC.copy(look.fog).lerp(mist, f);
    const under = !!world.underwater?.under;
    if (scene.fog && !under) {
      scene.fog.color.copy(fogCol);
      scene.fog.near = look.fogNear + (FOG_PEAK.near - look.fogNear) * f;
      scene.fog.far = look.fogFar + (FOG_PEAK.far - look.fogFar) * f;
      if (scene.background?.isColor) scene.background.copy(fogCol);
    }
    const veil = smooth(0, 0.85, f);
    SKY_UNIFORMS.uDnDay.value = Math.max(look.day, smooth(-0.1, 0.02, sun.y)); // no baked moon/stars while the sun is up
    SKY_UNIFORMS.uDnZenith.value.copy(look.zenith); SKY_UNIFORMS.uDnHorizon.value.copy(look.horizon);
    SKY_UNIFORMS.uDnSunCol.value.copy(look.sunCol); SKY_UNIFORMS.uDnSunDir.value.copy(sun);
    SKY_UNIFORMS.uDnFogCol.value.copy(fogCol); SKY_UNIFORMS.uDnFog.value = veil; SKY_UNIFORMS.uDnBank.value = bank;
    // far plane: drop to the fog wall only when the fog hides everything past it (hysteresis, two states)
    const wantCull = FOG_CULL && !under && (culled ? f > 0.9 : f > 0.95);
    if (wantCull !== culled) {
      culled = wantCull;
      camera.far = culled ? FOG_PEAK.cullFar + 14 : baseFar;
      camera.updateProjectionMatrix();
    }

    // ocean, forest haze, lantern, fireflies
    if (ocean) {
      ocean.uDeep.value.copy(look.deep); ocean.uShallow.value.copy(look.shallow); ocean.uScatter.value.copy(look.scatter);
      ocean.uFoam.value.copy(look.foam); ocean.uReflFallback.value.copy(look.refl);
      ocean.uMoonDir.value.copy(useSun ? sun : BAKED_MOON);
      ocean.uMoonColor.value.copy(look.keyCol).multiplyScalar(look.glint * lightW * (1 - 0.85 * f));
    }
    if (haze) haze.copy(look.haze).lerp(fogCol, f * 0.8);
    const glow = smooth(0.25, 0.85, look.night);
    if (lantern) { lantern.material.opacity = lanternOpacity * glow; lantern.visible = glow > 0.01; }
    if (fireflies) { fireflies.material.uniforms.uColor.value.copy(fireflyBase).multiplyScalar(glow); fireflies.visible = glow > 0.01; }

    // env: blend the two key probes of this segment (+ the night probe indoors); prefetch the next key
    const seg = segmentAt(hour);
    const next = KEYS[Math.min(seg.i + 2, KEYS.length - 1)][1];
    blendWait -= 1;
    if (!probes.step([seg.a, seg.b, next]) && blendWait <= 0) {
      const changed = seg.a !== lastBlend.a || seg.b !== lastBlend.b || Math.abs(seg.t - lastBlend.t) > 1 / 64 || Math.abs(indoor - lastBlend.indoor) > 0.02 || (indoor !== lastBlend.indoor && (indoor === 0 || indoor === 1));
      if (changed && probes.has(seg.a) && probes.has(seg.b) && probes.blend(seg.a, seg.b, seg.t, indoor)) {
        lastBlend = { a: seg.a, b: seg.b, t: seg.t, indoor };
        blendWait = 3;
      }
    }
    Object.assign(state, { rig, hour, fog: f, bank, glow, nightSound: smooth(0.2, 0.8, look.night), sunW, moonW, keyI, indoor, far: camera.far, seg: `${seg.a}>${seg.b}@${seg.t.toFixed(2)}`, useSun, zone });
  }

  return {
    update(dt, eye) {
      hour = wrap24(hour + Math.min(dt, 0.25) * hoursPerSecond * TIMESCALE);
      apply(Math.min(dt, 0.25), eye);
    },
    setHour(h, eye = camera.position) { hour = wrap24(h); blendWait = 0; apply(0.016, eye); },
    get hour() { return hour; },
    state,
    snap,
    casters: casterStats,
    probes: probes.stats,
    cachedProbes: probes.cached,
    lastBlend: () => ({ ...lastBlend }),
    look: () => ({ ...Object.fromEntries(SCALARS.map((k) => [k, +look[k].toFixed(4)])), ...Object.fromEntries(COLORS.map((k) => [k, look[k].getHexString()])) }),
    finishProbes() { for (let i = 0; i < 12 && probes.step(KEY_NAMES); i += 1); },
  };
}
