import * as THREE from 'three';
import { legacy } from './flags.js';

// One continuous ocean surface: a radial grid that follows the viewer, a Gerstner wave sum in the
// vertex shader, two scrolling detail normal maps, Fresnel reflection of scene.environment (the
// phase-2 PMREM), a moon glitter path, depth/shore colour and foam from a one-off top-down bake,
// and a horizon fade into the sky backdrop. heightAt() is the CPU twin of the vertex shader.

const GRAVITY = 9.81;
const DEG = Math.PI / 180;
const WIND = new THREE.Vector2(-0.22, 0.98).normalize(); // same wind as the legacy sea

// [angle from the wind (deg), wavelength (m), amplitude (m), steepness share, phase seed]
// Sum of amplitudes 0.17 m, RMS 0.050 m: the same envelope as the legacy heightAt() near the cliff.
export const WAVES = [
  [8, 22.0, 0.035, 0.6, 0.3],
  [0, 9.0, 0.042, 0.7, 1.9],
  [23, 6.4, 0.032, 0.7, 4.1],
  [-31, 4.6, 0.024, 0.7, 2.6],
  [47, 3.3, 0.017, 0.65, 5.3],
  [-58, 2.4, 0.012, 0.6, 0.9],
  [12, 1.7, 0.008, 0.5, 3.7],
].map(([angle, length, amp, steep, seed]) => {
  const a = Math.atan2(WIND.y, WIND.x) + angle * DEG;
  const k = (2 * Math.PI) / length;
  const q = Math.min(steep / (k * amp * 7), 3); // Gerstner Q, capped so crests pinch but never loop
  return {
    dirX: Math.cos(a), dirZ: Math.sin(a), k, amp, side: q * amp,
    omega: Math.sqrt(GRAVITY * k), seed, fadeFrom: 2.5 * length, fadeTo: 6 * length,
  };
});
const NW = WAVES.length;

// Shore bake window: covers the cliff, cave mouth, shallows, sea rocks and shark routes.
export const SHORE_RECT = { x0: -64, z0: -32, x1: 0, z1: 32, size: 256 };
const DEPTH_MAX = 8;
const DIST_MAX = 16;
const BAKE_LAYER = 5;

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function radialGrid(radius, segments) {
  const radii = [0];
  let r = 0;
  while (r < radius) {
    r += Math.max(0.12, r * ((2 * Math.PI) / segments));
    radii.push(Math.min(r, radius));
  }
  const positions = [0, 0, 0];
  for (let i = 1; i < radii.length; i += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    }
  }
  // Horizon skirt: a copy of the outer ring that the vertex shader lifts to just under eye level, so
  // the sea reaches the horizon instead of stopping 3-4 degrees below it at the far plane.
  for (let s = 0; s < segments; s += 1) {
    const a = (s / segments) * Math.PI * 2;
    positions.push(Math.cos(a) * radius, 1, Math.sin(a) * radius);
  }
  radii.push(radius);
  const index = [];
  for (let s = 0; s < segments; s += 1) index.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let i = 1; i < radii.length - 1; i += 1) {
    const a0 = 1 + (i - 1) * segments;
    const b0 = 1 + i * segments;
    for (let s = 0; s < segments; s += 1) {
      const s1 = (s + 1) % segments;
      index.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
  return { geo, rings: radii.length };
}

const ringGlsl = `
  // Value and analytic gradient of ringWave(); skipped per ring by a uniform test, so idle rings cost nothing.
  vec3 ringWaveG(vec4 s, vec2 xz) {
    if (s.w < 0.02 || s.z > 1.5) return vec3(0.0);
    float age = s.z;
    vec2 wind = normalize(vec2(-0.22, 0.98));
    vec2 d = xz - (s.xy + wind * age * 1.15);
    float dist = max(length(d), 1e-4);
    float off = dist - age * 1.7;
    float band = exp(-abs(off) * 3.6);
    float k = s.w * exp(-age * 1.35);
    float a = dist * 8.0 - age * 13.0;
    float sa = sin(a);
    float dv = k * band * (8.0 * cos(a) - 3.6 * sign(off) * sa);
    return vec3(sa * band * k, d * (dv / dist));
  }
  // Canoe hull: oriented ellipse, 0.85 m across x 2.2 m along the canoe's local Z (gameplay fixes, section 4b).
  float boatMask(vec2 xz, vec2 axes, float soft) {
    if (uBoat.w < 0.5) return 0.0;
    vec2 d = xz - uBoat.xy;
    float c = cos(uBoat.z);
    float s = sin(uBoat.z);
    vec2 l = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
    float e = length(l / axes);
    return 1.0 - smoothstep(1.0, 1.0 + soft / axes.x, e);
  }
`;

const vertexShader = `
  #include <common>
  #include <fog_pars_vertex>
  #define NW ${NW}
  uniform vec4 uWaveA[NW];   // dir.x, dir.z, k, amplitude
  uniform vec4 uWaveB[NW];   // horizontal amplitude, phase, fade start, 1 / fade length
  uniform vec3 uEye;
  uniform vec4 uShoreRect;   // x0, z0, 1/width, 1/depth
  uniform sampler2D uShore;
  uniform float uNearX;
  uniform vec4 uRings[4];
  uniform vec4 uBoat;
  uniform float uBoatH;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrest;
  varying float vSkirt;
  ${ringGlsl}
  void main() {
    float skirt = position.y;
    vec4 base = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
    vec2 p = vec2(min(base.x, uNearX), base.z);
    vec2 suv = (p - uShoreRect.xy) * uShoreRect.zw;
    float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
    float amp = mix(1.0, texture2D(uShore, suv).b, inside);
    float dist = length(p - uEye.xz);
    vec3 disp = vec3(0.0);
    vec3 slope = vec3(0.0);
    for (int i = 0; i < NW; i++) {
      vec4 a = uWaveA[i];
      vec4 b = uWaveB[i];
      float f = amp * (1.0 - smoothstep(0.0, 1.0, (dist - b.z) * b.w));
      float th = a.z * dot(a.xy, p) - b.y;
      float s = sin(th);
      float c = cos(th);
      disp.xz += a.xy * (b.x * f * c);
      disp.y += a.w * f * s;
      slope.xz += a.xy * (a.z * a.w * f * c);
      slope.y += a.z * b.x * f * s;
    }
    float bm = boatMask(p, vec2(0.85, 2.2), 0.3);
    disp.y = mix(disp.y, uBoatH, bm);
    disp.xz *= 1.0 - bm;
    slope *= 1.0 - bm;
    vec3 rw = (ringWaveG(uRings[0], p) + ringWaveG(uRings[1], p) + ringWaveG(uRings[2], p) + ringWaveG(uRings[3], p)) * 0.045;
    float r0 = rw.x / 0.045;
    vec2 rg = rw.yz;
    vec3 world = vec3(min(p.x + disp.x, uNearX), base.y + disp.y + r0 * 0.045, p.y + disp.z);
    // Skirt: lift to 0.3 deg under the eye, except toward the land side of the cliff line.
    float lift = skirt * smoothstep(uNearX - 1.0, uNearX - 7.0, base.x);
    world.y = mix(world.y, uEye.y - length(base.xz - uEye.xz) * 0.005, lift);
    vSkirt = lift;
    vNormal = vec3(-slope.x - rg.x, 1.0 - slope.y, -slope.z - rg.y);
    vCrest = disp.y;
    vWorldPos = world;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = `
  #include <common>
  #include <fog_pars_fragment>
  #include <cube_uv_reflection_fragment>
  #ifdef ENVMAP_TYPE_CUBE_UV
    uniform sampler2D envMap;
  #endif
  uniform sampler2D uNormalMap;
  uniform sampler2D uShore;
  uniform sampler2D uSky;
  uniform vec4 uShoreRect;
  uniform vec4 uBoat;
  uniform vec4 uRings[4];
  uniform vec3 uEye;
  uniform float uTime;
  uniform float uDetail;
  uniform float uEnvGain;
  uniform float uReflGain;
  uniform float uEyeH;
  uniform float uHorizonGain;
  uniform float uSkyGain;
  uniform float uHasSky;
  uniform float uRadius;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uScatter;
  uniform vec3 uFoam;
  uniform vec3 uReflFallback;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrest;
  varying float vSkirt;
  ${ringGlsl}
  vec3 skyBehind(vec3 d) {
    float u = atan(-d.z, -d.x) * (0.5 / PI);
    float v = 1.0 - acos(clamp(d.y, -1.0, 1.0)) / PI;
    return texture2D(uSky, vec2(fract(u), v)).rgb * uSkyGain;
  }
  void main() {
    vec3 toEye = cameraPosition - vWorldPos;
    float dist = length(toEye);
    vec3 v = toEye / dist;
    vec3 wpos = vWorldPos;
    if (vSkirt > 0.0) {
      // Shade the skirt as the sea plane it stands in for: intersect the view ray with y = water level.
      float below = max(cameraPosition.y - (uEye.y - uEyeH), 0.01);
      float t = below / max(v.y, below / 3000.0);
      wpos = cameraPosition - v * t;
      dist = t;
    }
    vec2 xz = wpos.xz;
    // Inside the hull: fully transparent instead of discard, which would cost early depth rejection on Quest.
    float hull = step(0.5, boatMask(xz, vec2(0.5, 1.82), 0.0001));
    vec2 suv = (xz - uShoreRect.xy) * uShoreRect.zw;
    float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
    vec4 shore = texture2D(uShore, suv);
    float depth = mix(${DEPTH_MAX.toFixed(1)}, shore.r * ${DEPTH_MAX.toFixed(1)}, inside);
    float sdist = mix(${DIST_MAX.toFixed(1)}, shore.g * ${DIST_MAX.toFixed(1)}, inside);

    vec2 uv1 = xz * 0.27 + vec2(0.021, 0.034) * uTime;
    vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * xz * 0.0885 + vec2(-0.013, 0.019) * uTime;
    vec3 d1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
    vec3 d2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;
    float ds = uDetail * mix(1.0, 0.3, smoothstep(6.0, 70.0, dist));
    vec3 n = normalize(vNormal);
    n = normalize(vec3(n.x + (d1.x * 0.55 + d2.x * 0.45) * ds, n.y, n.z - (d1.y * 0.55 + d2.y * 0.45) * ds));

    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 r = reflect(-v, n);
    r = normalize(vec3(r.x, max(r.y, 0.015), r.z));
    #ifdef ENVMAP_TYPE_CUBE_UV
      float rough = mix(0.05, 0.2, smoothstep(10.0, 120.0, dist));
      vec3 refl = textureCubeUV(envMap, r, rough).rgb * uEnvGain * uReflGain;
    #else
      vec3 refl = uReflFallback;
    #endif

    vec3 h = normalize(uMoonDir + v);
    float ndh = max(dot(n, h), 0.0);
    float glint = (pow(ndh, 1100.0) * 16.0 + pow(ndh, 120.0) * 0.32) * smoothstep(0.0, 0.06, uMoonDir.y);

    float shallowK = exp(-depth * 0.9);
    vec3 body = mix(uDeep, uShallow, shallowK);
    float crest = clamp(vCrest / 0.12, 0.0, 1.0);
    vec2 moonFlat = normalize(uMoonDir.xz);
    float back = pow(max(dot(-v.xz, moonFlat), 0.0), 3.0);
    body += uScatter * crest * (0.3 + back);
    vec3 color = mix(body, refl, fres) + uMoonColor * glint * (0.25 + fres);

    // Shore foam: a thin wet collar plus intermittent lapping lines moving in toward land, broken up
    // by the detail normals so it never forms a clean ring.
    float pattern = smoothstep(0.35, 0.75, 0.5 + (d1.x + d2.y) * 0.9 + (vCrest * 2.5));
    float edge = (1.0 - smoothstep(0.0, 0.45, sdist)) * (0.45 + 0.55 * pattern);
    float lap = pow(max(sin(sdist * 4.0 + uTime * 1.9 + d2.x * 2.0), 0.0), 8.0) * (1.0 - smoothstep(0.15, 1.6, sdist)) * pattern;
    float foam = clamp(edge * 0.75 + lap * 0.55, 0.0, 1.0) * inside;
    float foamLit = 0.45 + 0.55 * max(dot(n, uMoonDir), 0.0);
    color = mix(color, uFoam * foamLit, foam * 0.7);

    float into = pow(clamp(v.y, 0.0, 1.0), 0.55);
    float alpha = mix(mix(0.8, 0.4, into), mix(0.86, 0.55, into), 1.0 - shallowK);
    alpha = max(max(alpha, fres), foam) * (1.0 - hull);
    gl_FragColor = vec4(color, alpha);
    #ifdef WATER_DEBUG_REFL
      gl_FragColor = vec4(refl, 1.0);
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    float horizon = smoothstep(uRadius * 0.4, uRadius * 6.0, dist);
    if (uHasSky > 0.5 && horizon > 0.0) {
      // Far sea = mirror of the visible backdrop just above the horizon, so the two meet without a line.
      vec4 sky = vec4(skyBehind(vec3(-v.x, max(v.y, 0.004), -v.z)) * mix(uHorizonGain, 1.0, smoothstep(uRadius * 3.0, uRadius * 12.0, dist)), 1.0);
      #if defined( TONE_MAPPING )
        sky.rgb = toneMapping(sky.rgb);
      #endif
      sky = linearToOutputTexel(sky);
      gl_FragColor = mix(gl_FragColor, vec4(sky.rgb, 1.0 - hull), horizon);
    }
    #ifdef WATER_DEBUG_HEIGHT
      float hq = clamp(vWorldPos.y - (uEye.y - uEyeH) + 0.5, 0.0, 1.0) * 255.0;
      gl_FragColor = vec4(floor(hq) / 255.0, fract(hq), 0.0, 1.0);
    #endif
  }
`;

function flatNormalTexture() {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
}

function neutralShore(size, nearX) {
  // Before bake(): open water everywhere except the analytic cliff line (x >= nearX is land).
  const data = new Uint8Array(size * size * 4);
  const { x0, x1 } = SHORE_RECT;
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const x = x0 + ((i + 0.5) / size) * (x1 - x0);
      const d = Math.max(0, nearX - x);
      const o = (j * size + i) * 4;
      data[o] = d > 0 ? 255 : 0;
      data[o + 1] = Math.round(Math.min(d / DIST_MAX, 1) * 255);
      data[o + 2] = d > 0 ? 255 : 0;
      data[o + 3] = 255;
    }
  }
  return data;
}

export function createOcean({ scene, waterY, nearX, cliffX, assets, moonDir, sky, radius = 150, segments = 96 }) {
  const size = SHORE_RECT.size;
  const shoreData = neutralShore(size, nearX);
  const shoreTex = new THREE.DataTexture(shoreData, size, size);
  shoreTex.magFilter = THREE.LinearFilter;
  shoreTex.minFilter = THREE.LinearFilter;
  shoreTex.needsUpdate = true;
  const normalMap = assets?.texture?.('water_normal') || null;
  if (normalMap) {
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = 4;
    normalMap.needsUpdate = true;
  }
  const params = new URLSearchParams(location.search);
  const waveA = WAVES.map((w) => new THREE.Vector4(w.dirX, w.dirZ, w.k, w.amp));
  const waveB = WAVES.map((w) => new THREE.Vector4(w.side, w.seed, w.fadeFrom, 1 / (w.fadeTo - w.fadeFrom)));
  const rect = SHORE_RECT;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uEye: { value: new THREE.Vector3() },
    uShoreRect: { value: new THREE.Vector4(rect.x0, rect.z0, 1 / (rect.x1 - rect.x0), 1 / (rect.z1 - rect.z0)) },
    uNearX: { value: nearX },
    uRings: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uBoat: { value: new THREE.Vector4() },
    uBoatH: { value: 0 },
    uDetail: { value: normalMap ? +(params.get('wdetail') ?? 0.32) : 0 },
    uEnvGain: { value: 1 },
    uReflGain: { value: +(params.get('wrefl') ?? 0.3) },
    uEyeH: { value: 9.6 },
    uHorizonGain: { value: +(params.get('whgain') ?? 0.85) },
    uSkyGain: { value: +(params.get('skygain') ?? 1) },
    uHasSky: { value: sky ? 1 : 0 },
    uRadius: { value: radius },
    uMoonDir: { value: moonDir.clone().normalize() },
    uMoonColor: { value: new THREE.Color(0xd5e2ff).multiplyScalar(1.6) },
    uDeep: { value: new THREE.Color(0x02080c) },
    uShallow: { value: new THREE.Color(0x0e3a40) },
    uScatter: { value: new THREE.Color(0x0a3a3c) },
    uFoam: { value: new THREE.Color(0xa7b3bb) },
    uReflFallback: { value: new THREE.Color(0x1c2636) },
  }]);
  // Arrays and textures must not be cloned by merge (shared with the CPU side).
  uniforms.uWaveA = { value: waveA };
  uniforms.uWaveB = { value: waveB };
  uniforms.uShore = { value: shoreTex };
  uniforms.uNormalMap = { value: normalMap || flatNormalTexture() };
  uniforms.uSky = { value: sky || flatNormalTexture() };
  uniforms.envMap = { value: null };
  const material = new THREE.ShaderMaterial({
    defines: params.get('wdebug') === 'refl' ? { WATER_DEBUG_REFL: 1 } : params.get('wdebug') === 'height' ? { WATER_DEBUG_HEIGHT: 1 } : {},
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
    fog: true,
  });
  const { geo, rings } = radialGrid(radius, segments);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(0, waterY, 0);
  mesh.frustumCulled = false;
  mesh.userData.water = true;
  mesh.raycast = () => {};
  scene.add(mesh);

  const eye = new THREE.Vector3(-1, waterY + 9.6, 0);
  const eyeTmp = new THREE.Vector3();
  let time = 0;
  const phases = new Float64Array(NW);
  const setPhases = () => {
    WAVES.forEach((w, i) => {
      phases[i] = (w.omega * time + w.seed) % (Math.PI * 2);
      waveB[i].y = phases[i];
    });
  };
  setPhases();

  function setEye(position) {
    eye.copy(position);
    uniforms.uEye.value.copy(eye);
    uniforms.uEyeH.value = Math.max(eye.y - waterY, 0.05);
    mesh.position.x = eye.x;
    mesh.position.z = eye.z;
    mesh.updateMatrixWorld();
  }

  mesh.onBeforeRender = (renderer, renderScene, camera) => {
    const viewer = renderer.xr?.isPresenting ? renderer.xr.getCamera() : camera;
    setEye(eyeTmp.setFromMatrixPosition(viewer.matrixWorld));
    const env = renderScene.environment || null;
    if (env !== material.envMap) {
      material.envMap = env;
      uniforms.envMap.value = env;
      material.needsUpdate = true;
    }
    uniforms.uEnvGain.value = renderScene.environmentIntensity ?? 1;
  };

  function sampleShore(x, z, channel) {
    const u = (x - rect.x0) / (rect.x1 - rect.x0);
    const v = (z - rect.z0) / (rect.z1 - rect.z0);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const fx = Math.min(Math.max(u * size - 0.5, 0), size - 1);
    const fz = Math.min(Math.max(v * size - 0.5, 0), size - 1);
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const i1 = Math.min(i0 + 1, size - 1);
    const j1 = Math.min(j0 + 1, size - 1);
    const tx = fx - i0;
    const tz = fz - j0;
    const at = (i, j) => shoreData[(j * size + i) * 4 + channel] / 255;
    return (at(i0, j0) * (1 - tx) + at(i1, j0) * tx) * (1 - tz) + (at(i0, j1) * (1 - tx) + at(i1, j1) * tx) * tz;
  }

  const disp = { x: 0, y: 0, z: 0 };
  function displace(px, pz) {
    const ampShore = sampleShore(px, pz, 2);
    const amp = ampShore == null ? 1 : ampShore;
    const dist = Math.hypot(px - eye.x, pz - eye.z);
    disp.x = 0; disp.y = 0; disp.z = 0;
    for (let i = 0; i < NW; i += 1) {
      const w = WAVES[i];
      const f = amp * (1 - smoothstep(0, 1, (dist - w.fadeFrom) / (w.fadeTo - w.fadeFrom)));
      const th = w.k * (w.dirX * px + w.dirZ * pz) - phases[i];
      const c = Math.cos(th);
      disp.x += w.dirX * w.side * f * c;
      disp.z += w.dirZ * w.side * f * c;
      disp.y += w.amp * f * Math.sin(th);
    }
    return disp;
  }

  // CPU twin of the vertex shader: surface height above waterY at world (x, z), excluding the
  // short-lived splash rings and the canoe's flattened patch. Inverts the Gerstner sideways shift.
  function heightAt(x, z) {
    const px0 = Math.min(x, nearX);
    let px = px0;
    let pz = z;
    for (let k = 0; k < 4; k += 1) {
      const d = displace(px, pz);
      px = px0 - d.x;
      pz = z - d.z;
    }
    return displace(px, pz).y;
  }

  function update(dt) {
    time += dt;
    uniforms.uTime.value = time % 1000;
    setPhases();
  }

  function setBoat(x, z, yaw, active, height = 0) {
    uniforms.uBoat.value.set(x, z, yaw, active ? 1 : 0);
    uniforms.uBoatH.value = height;
  }

  // One-off top-down bake of everything tagged userData.shore: floor depth (R), distance to land (G)
  // and the wave-amplitude mask (B). Same bytes feed the shader and heightAt().
  function bake(renderer) {
    const t0 = performance.now();
    const roots = [];
    scene.traverse((o) => { if (o.userData.shore) roots.push(o); });
    const tagged = [];
    roots.forEach((root) => root.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && !o.isSkinnedMesh) { o.layers.enable(BAKE_LAYER); tagged.push(o); }
    }));
    const span = 9;
    const top = waterY + 0.35;
    const cam = new THREE.OrthographicCamera(rect.x0, rect.x1, -rect.z0, -rect.z1, 0, span);
    cam.position.set(0, top, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, top - 1, 0);
    cam.updateMatrixWorld();
    cam.layers.set(BAKE_LAYER);
    const bakeMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: { uBase: { value: top - span }, uRange: { value: span } },
      vertexShader: `
        varying float vY;
        void main() {
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          vec4 w = modelMatrix * p;
          vY = w.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uBase;
        uniform float uRange;
        varying float vY;
        void main() {
          float h = clamp((vY - uBase) / uRange, 0.0, 1.0) * 255.0;
          gl_FragColor = vec4(floor(h) / 255.0, fract(h), gl_FrontFacing ? 0.0 : 1.0, 1.0);
        }`,
    });
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
    const saved = {
      target: renderer.getRenderTarget(), override: scene.overrideMaterial, background: scene.background,
      autoUpdate: renderer.shadowMap.autoUpdate, needsUpdate: renderer.shadowMap.needsUpdate,
      clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), xr: renderer.xr.enabled,
    };
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    scene.overrideMaterial = bakeMat;
    scene.background = null;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    renderer.setRenderTarget(saved.target);
    renderer.setClearColor(saved.clear, saved.alpha);
    renderer.xr.enabled = saved.xr;
    renderer.shadowMap.autoUpdate = saved.autoUpdate;
    renderer.shadowMap.needsUpdate = saved.needsUpdate;
    scene.overrideMaterial = saved.override;
    scene.background = saved.background;
    tagged.forEach((o) => o.layers.disable(BAKE_LAYER));
    rt.dispose();
    bakeMat.dispose();

    const n = size * size;
    const depth = new Float32Array(n);
    const land = new Uint8Array(n);
    const texel = (rect.x1 - rect.x0) / size;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const o = ((size - 1 - j) * size + i) * 4; // read-back row 0 is z1 (screen bottom = +z)
        const k = j * size + i;
        const x = rect.x0 + (i + 0.5) * texel;
        const hit = pixels[o + 3] > 0;
        const back = pixels[o + 2] > 127;
        const y = top - span + ((pixels[o] + pixels[o + 1] / 255) / 255) * span;
        const isLand = x >= cliffX || (hit && (back || y >= waterY - 0.02));
        land[k] = isLand ? 1 : 0;
        depth[k] = isLand ? 0 : hit ? Math.min(waterY - y, DEPTH_MAX) : DEPTH_MAX;
      }
    }
    // Chamfer distance to land (metres).
    const far = 1e6;
    const dist = new Float32Array(n);
    for (let k = 0; k < n; k += 1) dist[k] = land[k] ? 0 : far;
    const d1 = texel;
    const d2 = texel * Math.SQRT2;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const k = j * size + i;
        let d = dist[k];
        if (i > 0) d = Math.min(d, dist[k - 1] + d1);
        if (j > 0) {
          d = Math.min(d, dist[k - size] + d1);
          if (i > 0) d = Math.min(d, dist[k - size - 1] + d2);
          if (i < size - 1) d = Math.min(d, dist[k - size + 1] + d2);
        }
        dist[k] = d;
      }
    }
    for (let j = size - 1; j >= 0; j -= 1) {
      for (let i = size - 1; i >= 0; i -= 1) {
        const k = j * size + i;
        let d = dist[k];
        if (i < size - 1) d = Math.min(d, dist[k + 1] + d1);
        if (j < size - 1) {
          d = Math.min(d, dist[k + size] + d1);
          if (i < size - 1) d = Math.min(d, dist[k + size + 1] + d2);
          if (i > 0) d = Math.min(d, dist[k + size - 1] + d2);
        }
        dist[k] = d;
      }
    }
    // Soften the depth edges (box shoal / slab outlines) with a 5x5 blur, then pack.
    const blur = (src) => {
      const out = new Float32Array(n);
      for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
          let sum = 0;
          let cnt = 0;
          for (let dj = -2; dj <= 2; dj += 1) {
            const jj = j + dj;
            if (jj < 0 || jj >= size) continue;
            for (let di = -2; di <= 2; di += 1) {
              const ii = i + di;
              if (ii < 0 || ii >= size) continue;
              sum += src[jj * size + ii];
              cnt += 1;
            }
          }
          out[j * size + i] = sum / cnt;
        }
      }
      return out;
    };
    const soft = blur(depth);
    for (let k = 0; k < n; k += 1) {
      const o = k * 4;
      const ampK = land[k] ? 0 : 0.35 + 0.65 * smoothstep(0.1, 1.2, depth[k]);
      shoreData[o] = Math.round((land[k] ? 0 : soft[k] / DEPTH_MAX) * 255);
      shoreData[o + 1] = Math.round(Math.min(dist[k] / DIST_MAX, 1) * 255);
      shoreData[o + 2] = Math.round(ampK * 255);
      shoreData[o + 3] = 255;
    }
    shoreTex.needsUpdate = true;
    return { ms: Math.round(performance.now() - t0), tagged: tagged.length, landTexels: land.reduce((a, b) => a + b, 0) };
  }

  return { mesh, material, uniforms, update, heightAt, setBoat, setEye, bake, rings, shoreData, get time() { return time; } };
}

// ?water=legacy (or ?water=0) restores today's two sheets, sand patch and shader; so does ?legacy / ?legacy=water.
export function legacyWater() {
  const mode = new URLSearchParams(location.search).get('water');
  return mode === 'legacy' || mode === '0' || legacy('water');
}
