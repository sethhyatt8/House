import * as THREE from 'three';

// Quest-friendly fire: one Mesh (one draw call) per fire. Flame tongues, a soft glow, rising embers and an
// optional smoke wisp are instances of a single quad, animated entirely in the shaders (no per-frame CPU work
// besides a few uniforms). Premultiplied blending lets additive light (alpha 0) and alpha smoke share the call.

const KIND = { flame: 0, glow: 1, ember: 2, smoke: 3, coals: 4 };
let noiseTexture = null;

// Tileable 128x128 value-noise texture, built once at startup (64 KB + mips, no download).
// R = 4-octave fbm, G = coarse, B = medium, A = fine.
function getNoiseTexture() {
  if (noiseTexture) return noiseTexture;
  const N = 128;
  let s = 1234567;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const layer = (period) => {
    const grid = Array.from({ length: period * period }, rand);
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        const fx = (x / N) * period;
        const fy = (y / N) * period;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const g = (i, j) => grid[((j % period) * period) + (i % period)];
        const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
        const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
        out[y * N + x] = a + (b - a) * sy;
      }
    }
    return out;
  };
  const l4 = layer(4);
  const l8 = layer(8);
  const l16 = layer(16);
  const l32 = layer(32);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i += 1) {
    const fbm = (l4[i] * 0.5 + l8[i] * 0.25 + l16[i] * 0.15 + l32[i] * 0.1);
    data[i * 4] = Math.round(fbm * 255);
    data[i * 4 + 1] = Math.round(l8[i] * 255);
    data[i * 4 + 2] = Math.round(l16[i] * 255);
    data[i * 4 + 3] = Math.round(l32[i] * 255);
  }
  noiseTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.magFilter = THREE.LinearFilter;
  noiseTexture.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTexture.generateMipmaps = true;
  noiseTexture.colorSpace = THREE.NoColorSpace;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}

const vertexShader = /* glsl */ `
attribute vec4 aOffSeed;   // xyz: base position in the fire's local space, w: seed 0..1
attribute vec4 aSizeKind;  // x: width, y: height (ember: rise), z: kind, w: ember rate (1/s)
uniform float uTime;
uniform float uFade;
uniform float uFlick;
uniform vec3 uLean;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vLife;

void main() {
  vec3 base = (modelMatrix * vec4(aOffSeed.xyz, 1.0)).xyz;
  float kind = aSizeKind.z;
  float seed = aOffSeed.w;
  vec2 size = aSizeKind.xy;
  vUv = uv;
  vKind = kind;
  vSeed = seed;
  vLife = 0.0;
  vec4 mv;
  if (kind > 3.5) {
    // Coal bed: flat disc on the fire's floor, under the logs.
    mv = viewMatrix * vec4(base + vec3(position.x, 0.0, 0.5 - position.y) * size.x, 1.0);
  } else if (kind < 0.5 || kind > 2.5) {
    // Flame tongue / smoke: axial billboard around world up, tilted 60% toward the eye so it still reads from above.
    float h = size.y;
    if (kind < 0.5) h *= mix(0.3, 1.0, uFade) * (0.92 + 0.1 * uFlick);
    else h *= uFade;
    vec3 toCam = cameraPosition - base;
    vec3 flatDir = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
    vec3 right = vec3(flatDir.z, 0.0, -flatDir.x);
    vec3 view = normalize(toCam);
    vec3 up = normalize(vec3(0.0, 1.0, 0.0) - view * view.y * 0.6);
    float y = position.y;
    vec3 p = base + right * (position.x * size.x) + up * (y * h) + uLean * (y * y * h);
    mv = viewMatrix * vec4(p, 1.0);
  } else if (kind < 1.5) {
    // Glow: camera-facing disc.
    mv = viewMatrix * vec4(base, 1.0);
    mv.xy += vec2(position.x, position.y - 0.5) * size.x;
  } else {
    // Ember: rises, spirals and fades, then respawns. Position is a pure function of time and seed.
    float life = fract(uTime * aSizeKind.w + seed * 7.13);
    float ang = seed * 37.0 + uTime * (1.3 + seed * 1.7);
    vec3 p = base;
    p.xz += vec2(sin(ang), cos(ang * 0.8)) * (0.015 + 0.06 * life) * size.x * 40.0;
    p.y += life * size.y;
    p += uLean * life * size.y;
    vLife = life;
    mv = viewMatrix * vec4(p, 1.0);
    mv.xy += vec2(position.x, position.y - 0.5) * size.x * (1.0 - 0.6 * life) * uFade;
  }
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uFade;
uniform float uFlick;
uniform float uBright;
uniform float uSmoke;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vLife;

vec3 ramp(float i) {
  vec3 c = mix(vec3(0.45, 0.03, 0.0), vec3(1.0, 0.25, 0.02), smoothstep(0.0, 0.35, i));
  c = mix(c, vec3(1.0, 0.58, 0.14), smoothstep(0.3, 0.68, i));
  return mix(c, vec3(1.0, 0.84, 0.52), smoothstep(0.75, 1.0, i));
}

void main() {
  vec4 outColor = vec4(0.0);
  float t = uTime;
  if (vKind < 0.5) {
    vec2 uv = vUv;
    float y = uv.y;
    vec4 n1 = texture2D(uNoise, vec2(uv.x * 0.45 + vSeed, y * 0.5 - t * 0.55));
    float x = (uv.x - 0.5 + (n1.g - 0.5) * 0.55 * y) * 2.0;
    float hw = pow(max(1.0 - y, 0.0), 0.8) * smoothstep(-0.05, 0.22, y);
    float body = 1.0 - abs(x) / max(hw, 1e-3);
    vec4 n2 = texture2D(uNoise, vec2(uv.x * 0.9 - vSeed * 3.0, y * 0.75 - t * 1.25));
    float turb = n2.b * 0.65 + n2.a * 0.35;
    float f = body - turb * (0.2 + 0.95 * y) + 0.2 * (1.0 - y);
    float i = clamp(f * 1.5, 0.0, 1.0);
    float b = i * uBright * (0.85 + 0.2 * uFlick) * smoothstep(0.0, 0.16, y);
    // Mostly additive, with a little coverage so the flame still reads against the white gallery walls.
    outColor = vec4(ramp(i) * b, smoothstep(0.1, 0.75, i) * 0.85 * uFade);
  } else if (vKind < 1.5) {
    float r = length(vUv - 0.5) * 2.0;
    float g = max(1.0 - r, 0.0);
    g *= g * g;
    outColor = vec4(vec3(1.0, 0.36, 0.08) * g * 0.2 * uBright * (0.8 + 0.3 * uFlick) * uFade, 0.0);
  } else if (vKind < 2.5) {
    float r = length(vUv - 0.5) * 2.0;
    float d = max(1.0 - r, 0.0);
    d *= d;
    float tw = 0.6 + 0.4 * sin(t * 23.0 + vSeed * 61.0);
    float fade = (1.0 - vLife) * smoothstep(0.0, 0.08, vLife);
    float e = d * fade * tw * uFade;
    outColor = vec4(mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.3, 0.05), vLife) * e * 2.2, e * 0.5);
  } else if (vKind > 3.5) {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    vec4 n = texture2D(uNoise, vUv * 1.3 + vec2(vSeed, t * 0.03));
    vec4 m = texture2D(uNoise, vUv * 2.1 - vec2(t * 0.05, vSeed));
    float heat = smoothstep(1.0, 0.2, r) * (n.r * 0.7 + m.a * 0.6) * (0.8 + 0.25 * uFlick);
    float c = smoothstep(0.35, 0.95, heat);
    outColor = vec4(mix(vec3(0.35, 0.03, 0.0), vec3(1.0, 0.42, 0.06), c) * c * 1.6 * uFade, 0.0);
  } else {
    vec2 uv = vUv;
    float y = uv.y;
    vec4 n = texture2D(uNoise, vec2(uv.x * 0.4 + vSeed, y * 0.35 - t * 0.18));
    float x = (uv.x - 0.5 + (n.g - 0.5) * 0.7 * y) * 2.0;
    float hw = 0.25 + 0.75 * y;
    float body = 1.0 - abs(x) / hw;
    float m = smoothstep(0.0, 0.7, body - n.b * 0.55) * smoothstep(0.0, 0.3, y) * (1.0 - y);
    float a = m * uSmoke * uFade;
    vec3 c = mix(vec3(0.22, 0.14, 0.09), vec3(0.09, 0.085, 0.08), y);
    outColor = vec4(c * a, a);
  }
  gl_FragColor = outColor;
  #include <colorspace_fragment>
}
`;

// Small deterministic RNG so every fire looks the same on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * createFire(spec) → { mesh, update(dt), ignite(), setLean(vec3), get flicker(), get fade() }
 * spec: { tongues: [{ x, y, z, w, h }], glow: { y, size }, embers: { count, y, spread, rise, size, rate },
 *         smoke: { count, y, w, h, alpha }, bright, bounds: { y, r }, lit, seed }
 */
export function createFire(spec) {
  const rand = rng(spec.seed ?? 7);
  const off = [];
  const sk = [];
  const push = (x, y, z, seed, w, h, kind, rate = 0) => {
    off.push(x, y, z, seed);
    sk.push(w, h, kind, rate);
  };
  if (spec.coals) push(0, spec.coals.y, 0, rand(), spec.coals.size, 0, KIND.coals);
  if (spec.glow) push(0, spec.glow.y, 0, 0, spec.glow.size, 0, KIND.glow);
  for (const t of spec.tongues) push(t.x, t.y, t.z, rand(), t.w, t.h, KIND.flame);
  const e = spec.embers;
  for (let i = 0; e && i < e.count; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * e.spread;
    push(Math.cos(a) * r, e.y, Math.sin(a) * r, rand(), e.size * (0.6 + rand() * 0.8), e.rise * (0.6 + rand() * 0.6), KIND.ember, e.rate * (0.7 + rand() * 0.6));
  }
  const sm = spec.smoke;
  for (let i = 0; sm && i < sm.count; i += 1) push((rand() - 0.5) * 0.06, sm.y, (rand() - 0.5) * 0.06, rand(), sm.w, sm.h, KIND.smoke);

  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  geometry.setAttribute('aOffSeed', new THREE.InstancedBufferAttribute(new Float32Array(off), 4));
  geometry.setAttribute('aSizeKind', new THREE.InstancedBufferAttribute(new Float32Array(sk), 4));
  geometry.instanceCount = off.length / 4;
  const bounds = spec.bounds ?? { y: 0.4, r: 1 };
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, bounds.y, 0), bounds.r);
  geometry.boundingBox = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, bounds.y, 0), new THREE.Vector3(2, 2, 2).multiplyScalar(bounds.r));

  const uniforms = {
    uNoise: { value: getNoiseTexture() },
    uTime: { value: (spec.seed ?? 7) * 3.1 },
    uFade: { value: spec.lit === false ? 0 : 1 },
    uFlick: { value: 0 },
    uBright: { value: spec.bright ?? 1 },
    uSmoke: { value: sm?.alpha ?? 0 },
    uLean: { value: new THREE.Vector3() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = spec.name ?? 'fire';
  mesh.raycast = () => {};
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;

  let time = uniforms.uTime.value;
  let wander = 0;
  let wanderTarget = 0;
  let wanderClock = 0;
  let fading = uniforms.uFade.value >= 1 ? 0 : -1;
  let flicker = 1;
  const seedPhase = (spec.seed ?? 7) * 1.7;

  return {
    mesh,
    uniforms,
    ignite() {
      if (fading === -1) fading = 1;
    },
    setLean(v) {
      uniforms.uLean.value.copy(v);
    },
    // flicker ≈ 0.6..1.15, use it to drive the PointLight intensity.
    get flicker() {
      return flicker * uniforms.uFade.value;
    },
    get fade() {
      return uniforms.uFade.value;
    },
    update(dt) {
      const step = Math.min(dt, 0.1);
      time += step;
      uniforms.uTime.value = time;
      if (fading === 1) {
        uniforms.uFade.value = Math.min(1, uniforms.uFade.value + step / 1.4);
        if (uniforms.uFade.value >= 1) fading = 0;
      }
      wanderClock -= step;
      if (wanderClock <= 0) {
        wanderClock = 0.06 + Math.random() * 0.14;
        wanderTarget = Math.random() * 2 - 1;
      }
      wander += (wanderTarget - wander) * Math.min(1, step * 14);
      const wave = Math.sin(time * 7.3 + seedPhase) * 0.5 + Math.sin(time * 12.9 + seedPhase * 2.3) * 0.3 + Math.sin(time * 2.1) * 0.2;
      const flick = THREE.MathUtils.clamp(wave * 0.55 + wander * 0.45, -1, 1);
      uniforms.uFlick.value = flick;
      flicker = 0.88 + flick * 0.2;
    },
  };
}

// Presets, sizes in metres. The gallery fire sits on its logs inside the phase 4 pit (ring height 0.214).
export function campfire(opts = {}) {
  return createFire({
    name: 'gallery-fire',
    seed: 11,
    lit: opts.lit,
    bright: 0.75,
    tongues: [
      { x: 0, y: 0.07, z: 0, w: 0.36, h: 0.78 },
      { x: 0.08, y: 0.07, z: 0.06, w: 0.24, h: 0.5 },
      { x: -0.09, y: 0.07, z: 0.03, w: 0.22, h: 0.46 },
      { x: 0.02, y: 0.07, z: -0.09, w: 0.24, h: 0.52 },
      { x: -0.04, y: 0.07, z: -0.04, w: 0.16, h: 0.62 },
    ],
    coals: { y: 0.03, size: 0.46 },
    glow: { y: 0.3, size: 0.8 },
    embers: { count: 22, y: 0.18, spread: 0.12, rise: 1.0, size: 0.014, rate: 0.55 },
    smoke: { count: 2, y: 0.45, w: 0.3, h: 1.05, alpha: 0.18 },
    bounds: { y: 0.6, r: 1.0 },
  });
}

export function torchFlame() {
  return createFire({
    name: 'torch-fire',
    seed: 3,
    bright: 1.2,
    tongues: [
      { x: 0, y: 0.43, z: 0, w: 0.095, h: 0.19 },
      { x: 0.012, y: 0.43, z: 0.008, w: 0.065, h: 0.13 },
      { x: -0.012, y: 0.43, z: -0.006, w: 0.06, h: 0.15 },
    ],
    glow: { y: 0.5, size: 0.26 },
    embers: { count: 6, y: 0.47, spread: 0.015, rise: 0.32, size: 0.007, rate: 0.9 },
    bounds: { y: 0.52, r: 0.35 },
  });
}

export function fireEnabled(assets) {
  if (assets?.feature) return assets.feature('fire');
  return new URLSearchParams(location.search).get('fire') !== '0';
}
