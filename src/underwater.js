// Underwater pass: everything you see with your head under the sea. Built once at boot, drawn only while the eye is
// below the surface (the group is hidden and the shared-material hooks are gated by a uniform), so on land it costs
// nothing but a few skipped branches. ?underwater=0 removes the whole underwater experience (this file, swim.js, the
// scuba kit) and the sea goes back to exactly what it was. Quest budget while under: +10 draw calls, ~25k tris.
//   - water fog + absorption: the scene's linear fog is retuned while the eye is under (teal, near 0.4 m, far 9..22 m
//     depending on depth and the mask), and the shared fog chunk eats red > green > blue with distance (only while
//     fog.near < 1, i.e. only under the sea; no extra uniforms, no recompiles)
//   - caustics: one baked, tiling 256^2 Worley texture sampled twice (scrolling, min-blended) on the seabed, the reef
//     shelf and corals, the sea rocks and the wreck
//   - surface from below: Snell's window (48.6 deg cone shows the rippled moonlit sky), total internal reflection
//     outside it, bright rim at the window edge; follows the wave height over the eye
//   - light shafts (14 additive slanted quads), marine snow (1600 points wrapping round the eye)
//   - seabed: one sand sheet with ripples, rubble and caustics, meeting the reef shelf and burying the rock bases
//   - kelp (instanced crossed ribbons with a blade texture, sway), seagrass (instanced crossed cards, sway)
//   - fish schools: 3 schools in ONE instanced mesh (instance colours), boids-lite at 20 Hz, flee the diver and sharks
//   - bubbles: one 256-point pool (regulator exhale, strokes, splashes), rise with wobble, pop at the surface
//   - reef up close: the reef's distance fade is lifted while you're under (true colours near, fog does the rest);
//     the dark "seen from above" twins of the sharks and the dim wreck get their real colours back
// Flags: ?underwater=0 (all off), ?caustics=0, ?uwlife=0 (no kelp/seagrass/schools).
import * as THREE from 'three';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const UNDERWATER = params.get('underwater') !== '0';
const CAUSTICS = params.get('caustics') !== '0';
const LIFE = params.get('uwlife') !== '0';

// Distance absorption in the shared fog chunk. Gated on fog.near < 1: the above-water fog starts at 18 m, the
// underwater fog at 0.4 m, so land materials skip it. Patched at import time, before anything compiles.
if (UNDERWATER && !THREE.ShaderChunk.fog_fragment.includes('uw-absorb')) {
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
    'float fogFactor = smoothstep( fogNear, fogFar, fogDepth );',
    `float fogFactor = smoothstep( fogNear, fogFar, fogDepth );
		if ( fogNear < 1.0 ) gl_FragColor.rgb *= exp( - fogDepth * vec3( 0.15, 0.045, 0.03 ) ); // uw-absorb`,
  );
}

const CAUSTIC_GLSL = /* glsl */`
uniform sampler2D uUwCaus;
float uwCaustic(vec2 xz, float t) {
  vec2 uv = xz * 0.21;
  float a = texture2D(uUwCaus, uv + vec2(t * 0.019, t * 0.011)).r;
  float b = texture2D(uUwCaus, uv * 1.37 + vec2(0.37 - t * 0.015, 0.11 + t * 0.022)).r;
  return min(a, b);
}`;

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Tiling caustic network: periodic Worley F2-F1 on an 8x8 cell grid, thin bright lines.
function bakeCaustics(size = 256, cells = 8) {
  const pts = [];
  for (let j = 0; j < cells; j += 1) for (let i = 0; i < cells; i += 1) pts.push([(i + 0.15 + hash(i, j) * 0.7) / cells, (j + 0.15 + hash(j + 7, i + 3) * 0.7) / cells]);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const ci = Math.floor(u * cells);
      const cj = Math.floor(v * cells);
      let f1 = 9;
      let f2 = 9;
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          const ii = (ci + di + cells) % cells;
          const jj = (cj + dj + cells) % cells;
          const p = pts[jj * cells + ii];
          const dx = p[0] + ((ci + di) - ii) / cells - u; // neighbour cell unwrapped next to (u, v)
          const dy = p[1] + ((cj + dj) - jj) / cells - v;
          const d = Math.sqrt(dx * dx + dy * dy) * cells;
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
      }
      const edge = f2 - f1;
      const c = Math.pow(Math.max(0, 1 - edge * 2.2), 3.2);
      const k = (y * size + x) * 4;
      const val = Math.round(Math.min(1, c) * 255);
      data[k] = val; data[k + 1] = val; data[k + 2] = val; data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

function mergeSimple(parts) {
  const pos = []; const uv = []; const nor = []; const col = []; const idx = []; let off = 0;
  const hasUv = parts.every((g) => g.attributes.uv);
  const hasCol = parts.every((g) => g.attributes.color);
  parts.forEach((g) => {
    pos.push(...g.attributes.position.array);
    if (hasUv) uv.push(...g.attributes.uv.array);
    if (g.attributes.normal) nor.push(...g.attributes.normal.array);
    if (hasCol) col.push(...g.attributes.color.array);
    const n = g.attributes.position.count;
    if (g.index) idx.push(...Array.from(g.index.array, (v) => v + off));
    else for (let i = 0; i < n; i += 1) idx.push(i + off);
    off += n;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (hasUv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (nor.length === pos.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (hasCol) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  if (nor.length !== pos.length) geo.computeVertexNormals();
  return geo;
}

export function createUnderwater(scene, { waterY, reef = null, water = null, moonDir = new THREE.Vector3(-0.9701, 0.2385, 0.0441) } = {}) {
  const group = new THREE.Group();
  group.name = 'underwater';
  group.visible = false;
  scene.add(group);
  const time = { value: 0 };
  const under = { value: 0 }; // 0 above, 1 below: gates the caustics on shared materials
  const causTex = { value: CAUSTICS ? bakeCaustics() : null };
  const sinA = Math.sqrt(1 - moonDir.y * moonDir.y) / 1.333;
  const horiz = new THREE.Vector2(-moonDir.x, -moonDir.z).normalize();
  const lightDir = new THREE.Vector3(horiz.x * sinA, -Math.sqrt(1 - sinA * sinA), horiz.y * sinA); // direction light travels
  const shallow = new THREE.Color(0x0d4352);
  const deep = new THREE.Color(0x05202b);
  const stats = { drawCalls: 0, tris: 0 };
  const count = (mesh, tris) => { stats.drawCalls += 1; stats.tris += tris; };
  const surfaceAt = (x, z) => waterY + (water?.heightAt ? water.heightAt(x, z) : 0);

  // ---- seabed height (shared with swim.js collisions) ----
  const floorAt = (x, z) => {
    const r = reef?.floorY ? reef.floorY(x, z) : waterY - 4.6;
    const dune = Math.sin(x * 0.21 + z * 0.13) * 0.18 + Math.sin(x * 0.07 - z * 0.19) * 0.3;
    const shore = THREE.MathUtils.smoothstep(x, -12, -4.6); // rises toward the cave shallows
    const y = r + dune * (1 - shore) - 0.05;
    return THREE.MathUtils.lerp(y, waterY - 0.7, shore);
  };

  // ---- seabed sheet ----
  {
    const size = 120;
    const seg = 72;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const cx = -34;
    // contact shading round each sea outcrop (x, z, radius, strength): the sand goes dark and silty at the rock foot
    const rockAO = Array.from({ length: 6 }, (_, i) => {
      const r = reef?.rocks?.[i];
      return r && new URLSearchParams(location.search).get('rockbase') !== 'old' ? new THREE.Vector4(r[0], r[1], r[2], 1) : new THREE.Vector4(0, 0, 1, 0);
    });
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i);
      pos.setXYZ(i, x, floorAt(Math.min(x, -4.6), z), z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uLight: { value: lightDir }, uWaterY: { value: waterY }, uUwCaus: { value: null }, uRockAO: { value: rockAO } }]),
      fog: true,
      defines: { UW_CAUSTICS: CAUSTICS ? 1 : 0 },
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vW; varying vec3 vN;
        void main() { vW = position; vN = normal; vec4 mvPosition = viewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <fog_pars_fragment>
        uniform float uT; uniform vec3 uLight; uniform float uWaterY; uniform vec4 uRockAO[6];
        varying vec3 vW; varying vec3 vN;
        ${CAUSTIC_GLSL}
        float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main() {
          // sand ripples: warped crests across the swell, faded out where they would alias
          vec2 p = vW.xz;
          float fw = length(fwidth(p));
          float detail = 1.0 - smoothstep(0.08, 0.3, fw);
          float warp = sin(p.x * 0.37 + sin(p.y * 0.23) * 2.0) * 1.4 + n2(p * 0.6) * 1.5;
          float ph = p.y * 5.2 + p.x * 1.6 + warp;
          float rip = sin(ph);
          float crest = pow(0.5 + 0.5 * rip, 3.0);
          float rub = smoothstep(0.55, 0.95, n2(p * 0.9) * 0.45 + n2(p * 0.17) * 0.65);
          float speck = (h2(floor(p * 40.0)) - 0.5) * 0.12 * detail;
          vec3 sand = mix(vec3(0.46, 0.43, 0.35), vec3(0.2, 0.19, 0.16), rub);
          sand *= 0.86 + (0.1 * rip + 0.1 * crest) * detail + speck;
          // ripple slope shading: the face toward the light is brighter
          vec2 slope = vec2(1.6, 5.2) * cos(ph) * 0.06 * detail * (1.0 - rub);
          vec3 n = normalize(vN + vec3(slope.x, 0.0, slope.y));
          float depth = max(uWaterY - vW.y, 0.0);
          float lit = max(dot(n, -uLight), 0.0);
          vec3 col = sand * (vec3(0.07, 0.13, 0.15) + vec3(0.34, 0.46, 0.48) * lit * exp(-depth * 0.2));
          float ao = 0.0;
          for (int i = 0; i < 6; i++) {
            float d = length(p - uRockAO[i].xy) / uRockAO[i].z;
            ao = max(ao, uRockAO[i].w * (1.0 - smoothstep(0.75, 1.75, d + (n2(p * 1.7) - 0.5) * 0.25)));
          }
          col *= 1.0 - 0.55 * ao;
          lit *= 1.0 - 0.6 * ao;
          #if UW_CAUSTICS
            float c = uwCaustic(p, uT) * exp(-depth * 0.16) * (0.6 + 0.4 * lit);
            col += vec3(0.42, 0.66, 0.68) * c * 1.35 * sand;
          #endif
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.uT = time;
    mat.uniforms.uUwCaus = causTex;
    const bed = new THREE.Mesh(geo, mat);
    bed.name = 'underwater_seabed';
    bed.raycast = () => {};
    bed.frustumCulled = false;
    group.add(bed);
    count(bed, seg * seg * 2);
  }

  // ---- caustics on shared sea materials (reef shelf + corals, sea rocks, wreck) ----
  const patched = new Set();
  const patchCaustics = (material) => {
    if (!CAUSTICS || !material || patched.has(material) || material.userData.uwCaustics) return;
    material.userData.uwCaustics = true;
    patched.add(material);
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      prev?.call(material, shader, r);
      shader.uniforms.uUwT = time;
      shader.uniforms.uUwUnder = under;
      shader.uniforms.uUwCaus = causTex;
      shader.uniforms.uUwWaterY = { value: waterY };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vUwW;')
        .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 uwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            uwp = instanceMatrix * uwp;
          #endif
          vUwW = (modelMatrix * uwp).xyz;
        }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vUwW;\nuniform float uUwT;\nuniform float uUwUnder;\nuniform float uUwWaterY;\n${CAUSTIC_GLSL}`)
        .replace('#include <fog_fragment>', `if (uUwUnder > 0.5 && vUwW.y < uUwWaterY) {
          float uwd = uUwWaterY - vUwW.y;
          vec3 uwn = normalize(cross(dFdx(vUwW), dFdy(vUwW))); // facet normal: no smeared stripes on walls
          float uwUp = smoothstep(0.3, 0.85, abs(uwn.y));
          gl_FragColor.rgb += gl_FragColor.rgb * vec3(0.55, 0.95, 1.0) * uwCaustic(vUwW.xz, uUwT) * 1.6 * uwUp * exp(-uwd * 0.14);
        }
        #include <fog_fragment>`);
    };
    const key = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => `${key ? key() : ''}-uw`;
    material.needsUpdate = true;
  };
  reef?.group?.traverse((o) => { if (o.isMesh) patchCaustics(o.material); });
  if (reef?.shelf?.material) patchCaustics(reef.shelf.material);

  // the sea rocks (InstancedMesh tagged for the shore bake) and the wreck (found by its spot in the sea)
  const rockColliders = [];
  let wreck = null;
  scene.traverse((o) => {
    if (o.isInstancedMesh && o.userData.shore && o !== reef?.shelf && o.count >= 6) {
      patchCaustics(o.material);
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const m = new THREE.Matrix4(); const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3();
      for (let i = 0; i < o.count; i += 1) {
        o.getMatrixAt(i, m);
        m.decompose(p, q, s);
        const r = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 * s.x * 0.82;
        const baseBottom = o.userData.baseBottom?.[i]; // world.js createSeaRockBases(): the skirt reaches the bed
        rockColliders.push({ x: p.x, z: p.z, r, top: p.y + bb.max.y * s.y, bottom: Math.min(p.y + bb.min.y * s.y, baseBottom ?? Infinity) });
      }
    }
    if (!wreck && o.isGroup && Math.abs(o.position.x + 45.5) < 0.01 && Math.abs(o.position.z - 12.5) < 0.01) wreck = o;
  });
  const wreckColours = [];
  let wreckBox = null;
  if (wreck) {
    wreck.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(wreck.matrixWorld).invert();
    const box = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    wreck.traverse((c) => {
      if (!c.isMesh || !c.material || c.material.visible === false) return;
      patchCaustics(c.material);
      if (c.material.color && !wreckColours.some((w) => w.m === c.material)) wreckColours.push({ m: c.material, above: c.material.color.clone() });
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      tmpBox.copy(c.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
      box.union(tmpBox);
    });
    if (!box.isEmpty()) wreckBox = { inv, box, matrix: wreck.matrixWorld.clone() };
  }
  const wreckUnder = new THREE.Color(0x4a6058); // weathered grey-green (the above-water tint is a dark teal)

  // dark "seen through the surface" twins of the sharks/swordfish: real colours while you're under
  const twins = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.material?.clippingPlanes?.length) return;
    const plane = o.material.clippingPlanes[0];
    if (plane.normal.y > -0.5) return; // keep only the below-water twins
    const sib = o.parent?.children.find((c) => c !== o && c.isMesh && c.geometry === o.geometry && c.material?.clippingPlanes?.[0]?.normal.y > 0.5);
    if (o.material.color) twins.push({ m: o.material, dark: o.material.color.clone(), lit: sib?.material?.color?.clone() ?? o.material.color.clone().multiplyScalar(2.2), rough: o.material.roughness, litRough: sib?.material?.roughness ?? o.material.roughness });
  });
  stats.twins = twins.length;
  stats.causticMaterials = patched.size;

  // ---- surface from below: Snell's window ----
  const surf = (() => {
    const geo = new THREE.PlaneGeometry(400, 400, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uDeep: { value: shallow.clone() }, uMoon: { value: moonDir.clone() } }]),
      fog: true,
      side: THREE.BackSide,
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <fog_pars_fragment>
        uniform float uT; uniform vec3 uDeep; uniform vec3 uMoon;
        varying vec3 vW;
        void main() {
          vec3 ray = normalize(vW - cameraPosition);
          vec2 p = vW.xz;
          vec2 g = vec2(cos(p.x * 1.7 + uT * 1.3) + cos((p.x + p.y) * 2.3 - uT * 1.7) * 0.6, cos(p.y * 1.9 - uT * 1.1) + cos((p.x - p.y) * 2.9 + uT * 1.5) * 0.6);
          vec2 h = vec2(cos(p.x * 4.1 + uT * 2.3) + cos((p.x + p.y) * 5.7 - uT * 2.9) * 0.5, cos(p.y * 4.6 - uT * 2.0) + cos((p.x - p.y) * 6.3 + uT * 2.6) * 0.5);
          vec3 n = normalize(vec3(g.x * 0.004 + h.x * 0.011, -1.0, g.y * 0.004 + h.y * 0.011)); // short chop: the window edge shimmers, it doesn't blob
          float c = dot(ray, -n);
          float window = smoothstep(0.63, 0.69, c); // Snell's window: cos(48.6 deg) = 0.661
          float ripple = 0.85 + 0.15 * cos(p.x * 5.3 + uT * 2.1) * cos(p.y * 4.7 - uT * 1.9);
          vec3 sky = mix(vec3(0.015, 0.04, 0.06), vec3(0.06, 0.12, 0.15), pow(c, 4.0)) * ripple;
          vec3 rr = refract(ray, n, 1.333);
          float moon = pow(max(dot(normalize(rr), normalize(uMoon)), 0.0), 260.0) * 1.4;
          vec3 tir = uDeep * (0.7 + 0.22 * g.x * 0.5);
          float rim = smoothstep(0.61, 0.66, c) * (1.0 - smoothstep(0.66, 0.71, c));
          vec3 col = mix(tir, sky + moon, window) + vec3(0.05, 0.10, 0.12) * rim;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.uT = time;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = waterY - 0.02;
    mesh.name = 'underwater_surface';
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    group.add(mesh);
    count(mesh, 2);
    return mesh;
  })();

  // ---- light shafts ----
  const SHAFTS = 14;
  const shafts = [];
  {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 6);
    geo.translate(0, -0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uAmount: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: /* glsl */`
        attribute float aSeed;
        varying vec2 vUv; varying float vSeed; varying float vFade;
        void main() { vUv = uv; vSeed = aSeed;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          float d = length(w.xyz - cameraPosition);
          vFade = smoothstep(0.0, 3.0, d) * (1.0 - smoothstep(10.0, 16.0, d));
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform float uT; uniform float uAmount;
        varying vec2 vUv; varying float vSeed; varying float vFade;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float a = pow(across, 1.6) * pow(vUv.y, 1.3) * (0.55 + 0.45 * sin(uT * (0.6 + vSeed) + vSeed * 20.0));
          gl_FragColor = vec4(vec3(0.45, 0.70, 0.75) * a * 0.09 * uAmount * vFade, 1.0);
        }`,
    });
    mat.uniforms.uT = time;
    const mesh = new THREE.InstancedMesh(geo, mat, SHAFTS);
    const seeds = new Float32Array(SHAFTS);
    for (let i = 0; i < SHAFTS; i += 1) {
      seeds[i] = hash(i, 3);
      shafts.push({ x: 0, z: 0, w: 0.4 + hash(i, 7) * 1.1, len: 7 + hash(i, 9) * 5, placed: false });
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.frustumCulled = false;
    mesh.name = 'underwater_shafts';
    mesh.raycast = () => {};
    mesh.renderOrder = 5;
    group.add(mesh);
    shafts.mesh = mesh;
    shafts.mat = mat;
    count(mesh, SHAFTS * 12);
  }
  const shaftQ = new THREE.Quaternion();
  const shaftM = new THREE.Matrix4();
  const shaftS = new THREE.Vector3();
  const shaftP = new THREE.Vector3();
  const upY = new THREE.Vector3(0, 1, 0);
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), lightDir);
  let shaftSeed = 1;
  function updateShafts(eye) {
    shafts.forEach((s, i) => {
      const dx = s.x - eye.x;
      const dz = s.z - eye.z;
      if (!s.placed || Math.hypot(dx, dz) > 10) {
        shaftSeed += 1;
        const a = hash(i, shaftSeed * 0.37) * Math.PI * 2;
        const r = 2 + hash(i + 5, shaftSeed * 0.53) * 7;
        s.x = eye.x + Math.cos(a) * r - lightDir.x * 4;
        s.z = eye.z + Math.sin(a) * r - lightDir.z * 4;
        s.placed = true;
      }
      const toEye = Math.atan2(eye.x - s.x, eye.z - s.z);
      shaftQ.setFromAxisAngle(upY, toEye).premultiply(tilt);
      shaftP.set(s.x, waterY - 0.05, s.z);
      shaftS.set(s.w, s.len, 1);
      shaftM.compose(shaftP, shaftQ, shaftS);
      shafts.mesh.setMatrixAt(i, shaftM);
    });
    shafts.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- marine snow ----
  {
    const N = 1600;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i += 1) {
      pos.set([hash(i, 1) * 12, hash(i, 2) * 12, hash(i, 3) * 12], i * 3);
      seed[i] = hash(i, 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uWaterY: { value: waterY } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        uniform float uT; uniform float uWaterY; attribute float aSeed; varying float vA;
        void main() {
          vec3 drift = vec3(sin(uT * 0.2 + aSeed * 30.0) * 0.3 + uT * 0.04, -uT * 0.025 * (0.5 + aSeed), cos(uT * 0.17 + aSeed * 20.0) * 0.3);
          vec3 p = mod(position + drift - cameraPosition + 6.0, 12.0) - 6.0 + cameraPosition;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = (1.0 - smoothstep(3.0, 6.0, d)) * step(p.y, uWaterY - 0.1) * (0.4 + 0.6 * aSeed);
          gl_PointSize = clamp((1.2 + aSeed * 2.4) * 60.0 / max(d, 0.2), 1.0, 6.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)) * vA; gl_FragColor = vec4(vec3(0.55, 0.65, 0.62) * a * 0.5, 1.0); }`,
    });
    mat.uniforms.uT = time;
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.name = 'underwater_snow';
    pts.raycast = () => {};
    group.add(pts);
    count(pts, 0);
    stats.snow = N;
  }

  // ---- bubbles: one pool of 256 points ----
  const bubbles = (() => {
    const N = 256;
    const pos = new Float32Array(N * 3).fill(-9999);
    const size = new Float32Array(N);
    const life = [];
    for (let i = 0; i < N; i += 1) life.push({ on: false, x: 0, y: 0, z: 0, vy: 0, ph: 0, s: 0, age: 0 });
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    const sizeAttr = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('aSize', sizeAttr);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 900 } },
      vertexShader: /* glsl */`
        attribute float aSize; uniform float uScale; varying float vA;
        void main() { vec4 mv = viewMatrix * vec4(position, 1.0); float d = max(-mv.z, 0.05);
          vA = aSize > 0.0 ? 1.0 - smoothstep(4.0, 9.0, d) : 0.0;
          gl_PointSize = clamp(aSize * uScale / d, 0.0, 64.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
          float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
          float hi = smoothstep(0.35, 0.0, length(c - vec2(-0.16, -0.16)));
          gl_FragColor = vec4(vec3(0.62, 0.85, 0.9) * (rim * 0.8 + hi * 0.9 + 0.06) * vA, 1.0); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.name = 'underwater_bubbles';
    pts.raycast = () => {};
    pts.renderOrder = 6;
    group.add(pts);
    count(pts, 0);
    let next = 0;
    let alive = 0;
    function emit(at, n = 6, { spread = 0.05, size: sz = 0.012, up = 0.5 } = {}) {
      for (let k = 0; k < n; k += 1) {
        const b = life[next];
        next = (next + 1) % N;
        if (!b.on) alive += 1;
        b.on = true;
        b.x = at.x + (Math.random() - 0.5) * spread * 2;
        b.y = at.y + (Math.random() - 0.5) * spread;
        b.z = at.z + (Math.random() - 0.5) * spread * 2;
        b.s = sz * (0.4 + Math.random() * 1.2);
        b.vy = up * (0.6 + b.s / sz * 0.5);
        b.ph = Math.random() * 6.28;
        b.age = 0;
      }
    }
    function update(dt) {
      if (!alive) return;
      for (let i = 0; i < N; i += 1) {
        const b = life[i];
        if (!b.on) continue;
        b.age += dt;
        b.vy = Math.min(b.vy + dt * 0.6, 0.9);
        b.y += b.vy * dt;
        b.x += Math.sin(b.age * 9 + b.ph) * 0.12 * dt;
        b.z += Math.cos(b.age * 7 + b.ph) * 0.12 * dt;
        const top = surfaceAt(b.x, b.z);
        if (b.y > top - 0.02 || b.age > 14) {
          b.on = false; alive -= 1;
          pos[i * 3 + 1] = -9999; size[i] = 0;
          continue;
        }
        pos[i * 3] = b.x; pos[i * 3 + 1] = b.y; pos[i * 3 + 2] = b.z;
        size[i] = b.s;
      }
      posAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    }
    return { emit, update, get alive() { return alive; } };
  })();

  // ---- kelp, seagrass ----
  const swayMat = (opts, sway = 0.18) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide, ...opts });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uUwT = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uUwT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float hs = length(instanceMatrix[1].xyz);
          float h = max(position.y, 0.0) * hs;
          float ph = ip.x * 0.7 + ip.z * 0.9;
          float s = sin(uUwT * 0.8 + ph - h * 0.9) * 0.6 + sin(uUwT * 1.5 + ph * 1.3 - h * 1.7) * 0.25;
          float bend = ${sway.toFixed(3)} * h * h / max(hs, 0.001);
          transformed.x += s * bend;
          transformed.z += cos(uUwT * 0.6 + ph - h * 0.7) * bend * 0.55;
        }`);
    };
    m.customProgramCacheKey = () => `uw-sway-${sway}-${opts.alphaTest ? 'a' : 'o'}`;
    return m;
  };
  const patches = [{ x: -23.6, z: -6.8, r: 5.6 }, { x: -29.2, z: 2.2, r: 3.6 }, { x: -36.2, z: 4.2, r: 5.0 }, { x: -19.5, z: 12.5, r: 3.2 }, { x: -42.5, z: 9.5, r: 3.6 }];
  const inRock = (x, z, pad = 0.2) => rockColliders.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + pad && r.bottom < floorAt(x, z) + 1);
  if (LIFE) {
    // kelp: two crossed twisted ribbons with a blade texture (alpha cut-out), 1 m unit tall, 12 segments
    const bladeTex = canvasTexture(64, 512, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const grd = ctx.createLinearGradient(0, h, 0, 0);
      grd.addColorStop(0, '#2e2a12'); grd.addColorStop(0.35, '#5a5a1c'); grd.addColorStop(1, '#7c7a2a');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(w * 0.42, h);
      for (let y = h; y >= 0; y -= 8) {
        const t = 1 - y / h;
        const half = (0.1 + 0.36 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.85)) * w * (0.92 + 0.08 * Math.sin(y * 0.21));
        ctx.lineTo(w / 2 + half, y);
      }
      for (let y = 0; y <= h; y += 8) {
        const t = 1 - y / h;
        const half = (0.1 + 0.36 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.85)) * w * (0.92 + 0.08 * Math.cos(y * 0.19));
        ctx.lineTo(w / 2 - half, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,26,8,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.lineTo(w / 2, 0); ctx.stroke();
      for (let i = 0; i < 40; i += 1) { ctx.fillStyle = `rgba(20,18,6,${0.15 + Math.random() * 0.2})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 6 + Math.random() * 10); }
    });
    const seg = 12;
    const ribbon = (rot) => {
      const pos = []; const uv = []; const idx = [];
      for (let i = 0; i <= seg; i += 1) {
        const y = i / seg;
        const tw = y * 2.6 + rot;
        const w = 0.13;
        pos.push(Math.cos(tw) * -w, y, Math.sin(tw) * -w, Math.cos(tw) * w, y, Math.sin(tw) * w);
        uv.push(0, y, 1, y);
        if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const geo = mergeSimple([ribbon(0), ribbon(Math.PI / 2)]);
    const list = [];
    patches.forEach((p, pi) => {
      const n = Math.round(p.r * 7);
      for (let k = 0; k < n; k += 1) {
        const a = hash(pi * 31 + k, 1) * Math.PI * 2;
        const r = p.r * (0.8 + hash(k, pi + 2) * 0.7);
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (inRock(x, z)) continue;
        const y = floorAt(x, z);
        const h = Math.min((waterY - y) * (0.55 + hash(k, pi) * 0.38), 4.6);
        if (h < 0.8) continue;
        list.push([x, y, z, h, a]);
      }
    });
    const mat = swayMat({ map: bladeTex, alphaTest: 0.45, color: 0xb8c49a, emissive: 0x0a0e06 }, 0.11);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tint = new THREE.Color();
    list.forEach(([x, y, z, h, a], i) => {
      q.setFromAxisAngle(upY, a * 3);
      const wscale = 0.85 + hash(i, 4) * 0.5;
      m.compose(new THREE.Vector3(x, y - 0.05, z), q, new THREE.Vector3(wscale, h, wscale));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tint.setHSL(0.15 + hash(i, 8) * 0.07, 0.45, 0.42 + hash(i, 9) * 0.22));
    });
    mesh.name = 'underwater_kelp';
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    group.add(mesh);
    count(mesh, list.length * seg * 4);
    stats.kelp = list.length;
  }
  if (LIFE) {
    const tex = canvasTexture(128, 128, (ctx) => {
      for (let i = 0; i < 30; i += 1) {
        const x = 6 + Math.random() * 116;
        const lean = (Math.random() - 0.5) * 34;
        const h = 56 + Math.random() * 70;
        ctx.strokeStyle = `rgb(${86 + Math.random() * 40}, ${118 + Math.random() * 50}, ${48 + Math.random() * 22})`;
        ctx.lineWidth = 2 + Math.random() * 2.5;
        ctx.beginPath(); ctx.moveTo(x, 128); ctx.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.5, x + lean, 128 - h); ctx.stroke();
      }
    });
    const a = new THREE.PlaneGeometry(0.6, 0.45); a.translate(0, 0.225, 0);
    const b = a.clone(); b.rotateY(Math.PI / 2);
    const geo = mergeSimple([a, b]);
    const mat = swayMat({ map: tex, alphaTest: 0.4, color: 0x8a9a80, emissive: 0x050a06 }, 0.3);
    const list = [];
    patches.forEach((p, pi) => {
      for (let k = 0; k < 130; k += 1) {
        const ang = hash(pi * 17 + k, 5) * Math.PI * 2;
        const r = p.r * (0.55 + hash(k, pi + 9) * 1.6);
        const x = p.x + Math.cos(ang) * r;
        const z = p.z + Math.sin(ang) * r;
        if (inRock(x, z, 0)) continue;
        list.push([x, floorAt(x, z), z, 0.7 + hash(k, pi) * 0.9, ang]);
      }
    });
    // a few meadows on the open sand between the reef and the wreck
    for (let k = 0; k < 160; k += 1) {
      const x = -48 + hash(k, 31) * 36;
      const z = -14 + hash(k, 37) * 30;
      if (inRock(x, z, 0)) continue;
      const cxz = Math.sin(x * 0.3) * Math.cos(z * 0.27);
      if (cxz < 0.2) continue;
      list.push([x, floorAt(x, z), z, 0.6 + hash(k, 41) * 0.8, hash(k, 43) * 6.28]);
    }
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    list.forEach(([x, y, z, s, ang], i) => {
      q.setFromAxisAngle(upY, ang);
      m.compose(new THREE.Vector3(x, y - 0.03, z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    });
    mesh.name = 'underwater_seagrass';
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    group.add(mesh);
    count(mesh, list.length * 4);
    stats.seagrass = list.length;
  }

  // ---- fish schools: one InstancedMesh for all, boids-lite ----
  const SCHOOLS = [
    { n: 64, x: -23.6, z: -6.8, r: 3.4, y: waterY - 1.5, size: 0.75, color: 0xc7d6de, speed: [0.35, 1.3] },
    { n: 40, x: -36.2, z: 4.2, r: 2.8, y: waterY - 2.0, size: 0.95, color: 0xf2c94a, speed: [0.3, 1.1] },
    { n: 36, x: -44.0, z: 11.0, r: 3.2, y: waterY - 2.4, size: 0.85, color: 0x6f9fd0, speed: [0.3, 1.2] },
  ];
  const fish = { mesh: null, list: [], schools: [], total: 0, tick: 0 };
  if (LIFE) {
    // body: elliptical cross-section along -Z (nose) .. +Z (tail), 8 around x 7 rings, plus a tail fork and a dorsal fin
    const R = 8;
    const rings = [[-0.21, 0.0, 0.0], [-0.17, 0.035, 0.05], [-0.09, 0.05, 0.085], [0.0, 0.048, 0.09], [0.08, 0.036, 0.07], [0.15, 0.02, 0.04], [0.19, 0.008, 0.016]];
    const pos = []; const col = []; const idx = [];
    const back = new THREE.Color(0x26323a); const belly = new THREE.Color(0xf4f7f6); const c = new THREE.Color();
    rings.forEach(([z, w, h]) => {
      for (let i = 0; i < R; i += 1) {
        const a = (i / R) * Math.PI * 2;
        const y = Math.cos(a) * h;
        pos.push(Math.sin(a) * w, y, z);
        c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(y / Math.max(h, 1e-3), -0.1, 0.7));
        col.push(c.r, c.g, c.b);
      }
    });
    for (let r = 0; r < rings.length - 1; r += 1) {
      for (let i = 0; i < R; i += 1) {
        const a = r * R + i; const b2 = r * R + ((i + 1) % R); const cc = (r + 1) * R + i; const d = (r + 1) * R + ((i + 1) % R);
        idx.push(a, cc, b2, b2, cc, d);
      }
    }
    const tip = pos.length / 3; pos.push(0, 0, -0.225); col.push(0.5, 0.55, 0.55);
    for (let i = 0; i < R; i += 1) idx.push(tip, i, (i + 1) % R);
    const t0 = pos.length / 3;
    pos.push(0, 0, 0.17, 0, 0.085, 0.29, 0, 0.0, 0.25, 0, -0.085, 0.29); // tail fork
    for (let k = 0; k < 4; k += 1) col.push(0.32, 0.38, 0.42);
    idx.push(t0, t0 + 1, t0 + 2, t0, t0 + 2, t0 + 3);
    const d0 = pos.length / 3;
    pos.push(0, 0.085, -0.05, 0, 0.13, 0.02, 0, 0.07, 0.07); // dorsal
    for (let k = 0; k < 3; k += 1) col.push(0.25, 0.3, 0.34);
    idx.push(d0, d0 + 1, d0 + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tris = idx.length / 3;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.38, emissive: 0x0b1a20, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uUwT = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uUwT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 2.3;
        transformed.x += sin(uUwT * 12.0 + ph - position.z * 10.0) * 0.07 * smoothstep(-0.08, 0.3, position.z);`);
    };
    mat.customProgramCacheKey = () => 'uw-fish';
    let total = 0;
    SCHOOLS.forEach((s) => { total += s.n; });
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.frustumCulled = false;
    mesh.name = 'underwater_fish';
    mesh.raycast = () => {};
    group.add(mesh);
    fish.mesh = mesh;
    fish.total = total;
    let k = 0;
    const tint = new THREE.Color();
    SCHOOLS.forEach((s, si) => {
      const school = { ...s, first: k, angle: si * 2.1, target: new THREE.Vector3(s.x, s.y, s.z) };
      fish.schools.push(school);
      for (let i = 0; i < s.n; i += 1) {
        fish.list.push({
          s: school,
          p: new THREE.Vector3(s.x + (hash(i, si + 1) - 0.5) * 2, s.y + (hash(i, si + 2) - 0.5) * 0.8, s.z + (hash(i, si + 3) - 0.5) * 2),
          v: new THREE.Vector3(0.3, 0, 0.1),
          a: new THREE.Vector3(),
          scale: s.size * (0.8 + hash(i, si + 4) * 0.4),
        });
        mesh.setColorAt(k, tint.set(s.color).offsetHSL((hash(i, 9) - 0.5) * 0.03, 0, (hash(i, 11) - 0.5) * 0.1));
        k += 1;
      }
    });
    count(mesh, tris * total);
    stats.fish = total;
  }
  const fm = new THREE.Matrix4();
  const fq = new THREE.Quaternion();
  const fz = new THREE.Vector3(0, 0, -1);
  const fdir = new THREE.Vector3();
  const fscale = new THREE.Vector3();
  const threat = { on: false, p: new THREE.Vector3(), r: 6 };
  function steerFish(eye) {
    // accelerations at 20 Hz: cohesion to a wandering target, separation, alignment, flee the diver and a shark
    for (const s of fish.schools) {
      s.angle += 0.05 * 0.12 * (s.n > 50 ? 1 : 1.3);
      s.target.set(s.x + Math.cos(s.angle) * s.r, s.y + Math.sin(s.angle * 1.7) * 0.35, s.z + Math.sin(s.angle) * s.r);
    }
    const L = fish.list;
    for (let i = 0; i < L.length; i += 1) {
      const f = L[i];
      const s = f.s;
      const acc = f.a.set(0, 0, 0);
      acc.x += (s.target.x - f.p.x) * 0.5; acc.y += (s.target.y - f.p.y) * 0.5; acc.z += (s.target.z - f.p.z) * 0.5;
      const end = s.first + s.n;
      for (let j = s.first; j < end; j += 1) {
        if (j === i) continue;
        const g = L[j];
        const dx = f.p.x - g.p.x; const dy = f.p.y - g.p.y; const dz = f.p.z - g.p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.1 && d2 > 1e-6) { const k = (0.1 - d2) * 24; acc.x += dx * k; acc.y += dy * k; acc.z += dz * k; }
        else if (d2 < 1.0) { acc.x += g.v.x * 0.025; acc.y += g.v.y * 0.025; acc.z += g.v.z * 0.025; }
      }
      const ex = f.p.x - eye.x; const ey = f.p.y - eye.y; const ez = f.p.z - eye.z;
      const ed2 = ex * ex + ey * ey + ez * ez;
      if (ed2 < 3.2) { const k = (3.2 - ed2) * 2.6; acc.x += ex * k; acc.y += ey * k * 0.5; acc.z += ez * k; }
      if (threat.on) {
        const tx = f.p.x - threat.p.x; const ty = f.p.y - threat.p.y; const tz = f.p.z - threat.p.z;
        const td2 = tx * tx + ty * ty + tz * tz;
        const r2 = threat.r * threat.r;
        if (td2 < r2) { const k = (r2 - td2) / r2 * 6 / Math.sqrt(td2 + 0.01); acc.x += tx * k; acc.y += ty * k * 0.4; acc.z += tz * k; }
      }
      const floor = floorAt(f.p.x, f.p.z) + 0.5;
      if (f.p.y < floor) acc.y += (floor - f.p.y) * 4;
    }
  }
  function moveFish(dt) {
    const L = fish.list;
    for (let i = 0; i < L.length; i += 1) {
      const f = L[i];
      const s = f.s;
      f.v.addScaledVector(f.a, dt);
      const sp = f.v.length();
      const max = threat.on ? s.speed[1] * 1.9 : s.speed[1];
      if (sp > max) f.v.multiplyScalar(max / sp);
      else if (sp < s.speed[0]) f.v.multiplyScalar(s.speed[0] / Math.max(sp, 1e-4));
      f.p.addScaledVector(f.v, dt);
      f.p.y = Math.min(f.p.y, waterY - 0.35);
      fdir.copy(f.v).normalize();
      fdir.y *= 0.6;
      fq.setFromUnitVectors(fz, fdir.normalize());
      fscale.setScalar(f.scale);
      fm.compose(f.p, fq, fscale);
      fish.mesh.setMatrixAt(i, fm);
    }
    fish.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- state swap (fog, background, reef look, twins, wreck) ----
  const fog = scene.fog;
  const fogAbove = fog ? { near: fog.near, far: fog.far, color: fog.color.clone() } : null;
  const bgAbove = scene.background?.isColor ? scene.background.clone() : null;
  const reefAbove = reef?.look ? { on: reef.look.uReefOn.value, glow: reef.look.uReefGlow.value } : null;
  let wasUnder = false;
  let clarity = 0; // 0 bare eyes, 1 mask (set by swim.js)
  const eye = new THREE.Vector3();
  const fogCol = new THREE.Color();
  const backdrops = [];
  scene.traverse((o) => { if (o.isMesh && o.material && o.material.fog === false && (o.userData.backdrop || o.geometry?.boundingSphere?.radius > 40 || (o.geometry && !o.geometry.boundingSphere && (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere.radius > 40)))) backdrops.push(o); });
  stats.backdrops = backdrops.length;
  const backdropVis = new Map();
  function enter() {
    group.visible = true;
    backdrops.forEach((o) => { backdropVis.set(o, o.visible); o.visible = false; });
    under.value = 1;
    if (reef?.look) { reef.look.uReefOn.value = 0; reef.look.uReefGlow.value = 0.07; }
    twins.forEach((t) => { t.m.color.copy(t.lit).multiplyScalar(0.9); t.m.roughness = t.litRough; });
    wreckColours.forEach((w) => w.m.color.copy(wreckUnder));
  }
  function leave() {
    group.visible = false;
    backdrops.forEach((o) => { if (backdropVis.has(o)) o.visible = backdropVis.get(o); });
    under.value = 0;
    if (fog && fogAbove) { fog.near = fogAbove.near; fog.far = fogAbove.far; fog.color.copy(fogAbove.color); }
    if (bgAbove && scene.background?.isColor) scene.background.copy(bgAbove);
    if (reef?.look && reefAbove) { reef.look.uReefOn.value = reefAbove.on; reef.look.uReefGlow.value = reefAbove.glow; }
    twins.forEach((t) => { t.m.color.copy(t.dark); t.m.roughness = t.rough; });
    wreckColours.forEach((w) => w.m.color.copy(w.above));
  }
  function tuneFog(depth) {
    if (!fog) return;
    const k = THREE.MathUtils.clamp(depth / 6, 0, 1);
    fogCol.copy(shallow).lerp(deep, k);
    fog.color.copy(fogCol);
    fog.near = 0.4;
    const far = THREE.MathUtils.lerp(22, 15, k);
    fog.far = THREE.MathUtils.lerp(far * 0.5, far, clarity);
    if (scene.background?.isColor) scene.background.copy(fogCol);
    surf.material.uniforms.uDeep.value.copy(fogCol).multiplyScalar(1.15);
  }

  let fishAcc = 0;
  let forced = null;
  return {
    group,
    stats,
    floorAt,
    surfaceAt,
    rocks: rockColliders,
    wreckBox,
    bubbles,
    emitBubbles: bubbles.emit,
    get under() { return wasUnder; },
    setClarity(k) { clarity = THREE.MathUtils.clamp(k, 0, 1); },
    setThreat(p, r = 6) { if (p) { threat.on = true; threat.p.copy(p); threat.r = r; } else threat.on = false; },
    force(on) { forced = on; }, // test hook: null = follow the eye
    update(dt, eyePos) {
      time.value = (time.value + dt) % 1000;
      if (!eyePos) return;
      eye.set(eyePos.x, eyePos.y, eyePos.z);
      const top = surfaceAt(eye.x, eye.z);
      const depth = top - eye.y;
      const on = forced ?? (depth > 0.03 && eye.x < -1.6);
      if (on && !wasUnder) enter();
      else if (!on && wasUnder) leave();
      wasUnder = on;
      bubbles.update(dt);
      if (!on) return;
      tuneFog(Math.max(depth, 0));
      surf.position.set(eye.x, Math.min(top, eye.y + 4) - 0.02, eye.z);
      surf.updateMatrixWorld();
      shafts.mat.uniforms.uAmount.value = THREE.MathUtils.clamp(1.3 - depth * 0.15, 0.3, 1.3);
      updateShafts(eye);
      if (fish.mesh) {
        fishAcc += dt;
        if (fishAcc >= 0.05) { fishAcc = 0; steerFish(eye); }
        moveFish(dt);
      }
    },
  };
}
