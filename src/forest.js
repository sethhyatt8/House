// Forest pass: wind-swayed, tinted pines on an undulating forest floor, merged ground cover, distance LOD and fireflies.
// ?forest=legacy brings back the old flat forest (world.js createForest). Everything here is static except two uniforms.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { legacy } from './flags.js';

const params = new URLSearchParams(location.search);
export const FOREST_LEGACY = ['legacy', 'old'].includes(params.get('forest')) || legacy('forest');
const num = (key, fallback) => (Number(params.get(key)) >= 0 && params.get(key) !== null && params.get(key) !== '' ? Number(params.get(key)) : fallback);
const WIND = num('wind', 1); // sway multiplier, 0 = still
const FULL_R = num('forestlod', 34); // band-0/1 pines farther than this from the clearing use the pine_far impostor
const COVER = params.get('cover') !== '0';
const FIREFLIES = params.get('fireflies') !== '0';
const HAZE = params.get('haze') !== '0';

// Overlook pass: other modules created before the forest (crag.js: the wooded summit) can hand it extra trees and
// cover at their own heights, plus an area to keep clear of ground trees (the summit's massif). Same instanced meshes
// and merged cover, so no extra draw calls.
const patches = [];
export function patchForest(patch) { patches.push(patch); }

const CENTER = { x: 2.5, z: 4 }; // middle of the clearing (yard + cell); every view of the forest is from around here
const clock = { value: 0 };
const hazeColor = { value: new THREE.Color(0x1b2738) };

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// distance from the clearing (x < 6.4, -5 < z < 12.6); 0 inside it
function clearingGap(x, z) {
  const dx = Math.max(0, x - 6.4);
  const dz = Math.max(0, -5 - z, z - 12.6);
  return x < 6.4 && z > -5 && z < 12.6 ? 0 : Math.hypot(dx, dz);
}
// Ground height: flat (-0.04, as before) in the clearing, at the cliff edge and past 55 m; up to about +-0.6 m of soft
// rolling ground in between.
export function forestGroundY(x, z) {
  const amp = smooth(1.5, 10, clearingGap(x, z)) * smooth(-1.4, 3, x) * (1 - smooth(45, 58, Math.max(x, Math.abs(z))));
  if (amp <= 0) return -0.04;
  const h = (vnoise(x * 0.06 + 3.1, z * 0.06 - 1.7) - 0.5) * 1.0 + (vnoise(x * 0.17 - 8, z * 0.17 + 2) - 0.5) * 0.35;
  return -0.04 + amp * h;
}

// Shader patch shared by every forest material: wind sway (instanced trees use the instance matrix, merged cover uses
// a per-vertex aSway weight) and a night-blue distance haze that sits under the scene's linear fog.
export function patchMaterial(material, { kind, sway = 0, flutter = 0, height = 8 }) {
  if (material.userData.forestPatched) return material;
  material.userData.forestPatched = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uForestT = clock;
    shader.uniforms.uForestHaze = hazeColor;
    const amp = (sway * WIND).toFixed(4);
    const flut = (flutter * WIND).toFixed(4);
    if (sway > 0 || flutter > 0) shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uForestT;
${kind === 'cover' ? 'attribute float aSway;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec2 windDir = vec2(0.8, 0.6);
#if defined(USE_INSTANCING)
  vec3 iPos = instanceMatrix[3].xyz;
  float iScale = length(instanceMatrix[0].xyz);
  float hN = clamp(transformed.y / ${height.toFixed(2)}, 0.0, 1.2);
  float ph = dot(iPos.xz, vec2(0.21, 0.13));
  float gust = 0.65 + 0.35 * sin(uForestT * 0.31 + iPos.x * 0.045 + iPos.z * 0.03);
  float s = (sin(uForestT * 1.05 + ph) * 0.7 + sin(uForestT * 2.2 + ph * 1.7) * 0.3) * gust;
  vec2 offW = windDir * s * ${amp} * hN * hN;
  offW += vec2(sin(uForestT * 5.7 + position.x * 2.3 + ph), cos(uForestT * 4.9 + position.z * 2.1 + ph)) * ${flut} * hN;
  transformed += transpose(mat3(instanceMatrix)) * vec3(offW.x, 0.0, offW.y) / (iScale * iScale);
#else
  ${kind === 'cover' ? `float ph = dot(position.xz, vec2(0.37, 0.29));
  float s = sin(uForestT * 1.4 + ph) * 0.7 + sin(uForestT * 3.1 + ph * 1.9) * 0.3;
  transformed.xz += windDir * s * ${amp} * aSway;` : ''}
#endif
}`);
    if (HAZE) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uForestHaze;`)
        .replace('#include <fog_fragment>', `{
  float hz = 1.0 - exp(-max(length(vViewPosition) - 9.0, 0.0) * 0.03);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uForestHaze, hz * 0.6);
}
#include <fog_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `forest-${kind}-${sway}-${flutter}-${HAZE ? 1 : 0}`;
  return material;
}

const quadrantOf = (x, z) => Math.floor(((Math.atan2(z, x - 3) + Math.PI * 2.25) % (Math.PI * 2)) / (Math.PI / 2)) % 4;

function tag(mesh) {
  mesh.userData.backdrop = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

function nearestIndex(spots) {
  const cell = 4;
  const grid = new Map();
  spots.forEach((s) => {
    const k = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  });
  return (x, z, radius, fn) => {
    const r = Math.ceil(radius / cell);
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -r; i <= r; i += 1) {
      for (let j = -r; j <= r; j += 1) {
        const list = grid.get(`${cx + i},${cz + j}`);
        if (list) for (const s of list) fn(s, Math.hypot(s.x - x, s.z - z));
      }
    }
  };
}

function buildGround(group, kit, near) {
  const floor = kit?.getObjectByName('forest_floor');
  const map = floor?.material?.map || null;
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 4;
    map.needsUpdate = true;
  }
  const material = patchMaterial(new THREE.MeshStandardMaterial({
    color: map ? 0x7d8274 : 0x1a261e, map, roughness: 1, metalness: 0, vertexColors: true,
  }), { kind: 'ground' });
  material.name = 'ForestFloor';
  const span = (a, b, step) => {
    const n = Math.max(1, Math.round((b - a) / step));
    return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / n);
  };
  const xs = [...span(-1.55, 3.7, 1.3), ...span(3.7, 60, 1.5), 60];
  const zs = [...span(-60, -4.1, 1.5), ...span(-4.1, 11.3, 1.4), ...span(11.3, 60, 1.5), 60];
  const pos = [];
  const uv = [];
  const col = [];
  const index = [];
  const TILE = 3.2;
  const shade = (x, z) => {
    let dark = 0;
    near(x, z, 4.5, (s, d) => { dark += Math.exp(-((d / (s.r * 1.5)) ** 2)) * (s.band === 0 ? 1 : 0.6); });
    const macro = 0.78 + 0.32 * vnoise(x * 0.11 + 7, z * 0.11 - 3);
    const k = macro * (1 - Math.min(0.5, dark * 0.3));
    // under the canopy: darker and a touch redder (dead needles); in the open: a touch greener
    const warm = Math.min(1, dark * 0.5);
    return [k * (0.92 + 0.12 * warm), k * (0.98 - 0.06 * warm), k * (0.9 - 0.12 * warm)];
  };
  const vert = (x, z) => {
    pos.push(x, forestGroundY(x, z), z);
    uv.push(x / TILE, z / TILE);
    col.push(...shade(x, z));
    return pos.length / 3 - 1;
  };
  const ids = xs.map((x) => zs.map((z) => vert(x, z)));
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < zs.length - 1; j += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (cx < 3.7 && cz > -4.1 && cz < 11.3) continue; // the yard and cell have their own ground
      const a = ids[i][j];
      const b = ids[i + 1][j];
      const c = ids[i + 1][j + 1];
      const d = ids[i][j + 1];
      index.push(a, d, b, b, d, c);
    }
  }
  // far ring at y -0.04 out to 150 m, same material (UVs in world metres so the tiling continues)
  const quad = (x0, x1, z0, z1) => {
    const base = pos.length / 3;
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      pos.push(x, -0.04, z);
      uv.push(x / TILE, z / TILE);
      col.push(0.62, 0.64, 0.6);
    }
    index.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
  };
  quad(60, 150, -150, 150);
  quad(-1.55, 60, 60, 150);
  quad(-1.55, 60, -150, -60);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = tag(new THREE.Mesh(geometry, material));
  mesh.name = 'forest_ground';
  group.add(mesh);
  return { tris: index.length / 3 };
}

function buildTrees(group, pines, spots) {
  const variants = {};
  pines.scene.updateWorldMatrix(true, true);
  for (const node of pines.scene.children) {
    variants[node.name] = { node, h: new THREE.Box3().setFromObject(node).max.y, list: [] };
  }
  for (const spot of spots) {
    const d = Math.hypot(spot.x - CENTER.x, spot.z - CENTER.z);
    let name = 'pine_far';
    if (spot.band === 0 && d < FULL_R) name = hash(spot.x * 5.3, spot.z * 2.9) < 0.5 ? 'pine_a' : 'pine_b';
    else if (spot.band === 1 && d < FULL_R) name = 'pine_b';
    variants[name].list.push(spot);
  }
  const counts = { pine_a: variants.pine_a.list.length, pine_b: variants.pine_b.list.length, pine_far: variants.pine_far.list.length };
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let tris = 0;
  for (const variant of Object.values(variants)) {
    if (!variant.list.length) continue;
    // full pines are split into 4 frustum-culled quadrants; the 4-tri impostors are one mesh (culling them saves nothing)
    const far = variant.node.name === 'pine_far';
    const groups = far ? [variant.list] : [[], [], [], []];
    if (!far) variant.list.forEach((spot) => groups[quadrantOf(spot.x, spot.z)].push(spot));
    variant.node.traverse((part) => {
      if (!part.isMesh) return;
      const mat = part.material;
      const leaves = /Leaves|Impostor/.test(mat.name);
      if (leaves) mat.color.set(/Impostor/.test(mat.name) ? 0x667f6c : 0x6f8f78);
      if (/Bark/.test(mat.name)) mat.color.set(0x726b66);
      patchMaterial(mat, /Impostor/.test(mat.name)
        ? { kind: 'impostor', sway: 0.14, height: 7.2 }
        : leaves ? { kind: 'leaves', sway: 0.22, flutter: 0.04, height: 8 } : { kind: 'bark', sway: 0.22, height: 8 });
      const partTris = (part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count) / 3;
      for (const list of groups) {
        if (!list.length) continue;
        const mesh = new THREE.InstancedMesh(part.geometry, mat, list.length);
        list.forEach((spot, index) => {
          const lean = 0.05;
          dummy.position.set(spot.x, (spot.y ?? forestGroundY(spot.x, spot.z)) - 0.06, spot.z);
          dummy.rotation.set((hash(spot.x, spot.z + 9) - 0.5) * 2 * lean, spot.spin, (hash(spot.z, spot.x - 4) - 0.5) * 2 * lean, 'YXZ');
          dummy.scale.setScalar((spot.h / variant.h) * (0.92 + 0.16 * hash(spot.z * 3.1, spot.x)));
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
          // +-8% value, slight warm/cool shift; bark varies less
          const v = 0.88 + 0.24 * hash(spot.x * 1.9, spot.z * 0.7);
          const w = (hash(spot.z * 2.3, spot.x * 1.1) - 0.5) * (leaves ? 0.1 : 0.05);
          color.setRGB(v * (1 + w), v, v * (1 - w * 1.4));
          mesh.setColorAt(index, color);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.frustumCulled = !far;
        mesh.name = `forest_${variant.node.name}_${mat.name}`;
        group.add(tag(mesh));
        tris += partTris * list.length;
      }
    });
  }
  return { counts, tris };
}

// Ground cover: MegaKit ferns, plants, bushes, grass, rocks and mushrooms (one atlas, one material) merged into one
// static mesh per quadrant, fallen logs included (bark cell of the atlas). Only within ~22 m of the clearing.
function buildCover(group, kit, spots, near, drop = () => false, extra = []) {
  const protos = {};
  for (const name of ['fern', 'plant', 'groundleaf', 'bush', 'grass', 'rock_a', 'rock_b', 'mushroom']) {
    const node = kit.getObjectByName(name);
    let mesh = null;
    node?.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
    if (!mesh) continue;
    const g = mesh.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
    g.computeBoundingBox();
    protos[name] = { geometry: g, h: g.boundingBox.max.y, material: mesh.material };
  }
  const anyProto = Object.values(protos)[0];
  if (!anyProto) return { tris: 0, count: 0 };
  // one material for all cover: alpha-tested (never blended), double-sided cards, swayed by aSway
  const material = anyProto.material.clone();
  material.transparent = false;
  material.alphaTest = 0.5;
  material.depthWrite = true;
  material.side = THREE.DoubleSide;
  material.roughness = 0.95;
  material.metalness = 0;
  material.color.set(0x8a9484);
  material.vertexColors = true;
  material.name = 'ForestCover';
  patchMaterial(material, { kind: 'cover', sway: 0.08 });
  const SWAY = { fern: 0.8, plant: 1, groundleaf: 0.3, bush: 0.45, grass: 1, rock_a: 0, rock_b: 0, mushroom: 0 };
  const TINT = { fern: 0.95, plant: 0.85, groundleaf: 0.9, bush: 1.8, grass: 0.9, rock_a: 0.5, rock_b: 0.55, mushroom: 0.9 };
  const SIZE = { fern: [0.42, 0.7], plant: [0.55, 0.95], groundleaf: [0.7, 1.2], bush: [0.75, 1.15], grass: [0.6, 1], rock_a: [0.45, 1.1], rock_b: [0.4, 1], mushroom: [0.7, 1.3] };
  const buckets = [[], [], [], []];
  const counts = {};
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const place = (name, x, z, seed, y = null) => {
    const proto = protos[name];
    if (!proto) return;
    const [s0, s1] = SIZE[name];
    const s = s0 + (s1 - s0) * hash(seed, x);
    const tilt = name.startsWith('rock') ? 0.25 : 0.08;
    euler.set((hash(x, seed) - 0.5) * tilt, hash(z, seed) * Math.PI * 2, (hash(seed, z) - 0.5) * tilt);
    quat.setFromEuler(euler);
    const sink = name.startsWith('rock') ? 0.18 * s : 0.03;
    m.compose(new THREE.Vector3(x, (y ?? forestGroundY(x, z)) - sink, z), quat, new THREE.Vector3(s, s * (0.85 + 0.3 * hash(x + 1, z)), s));
    const g = proto.geometry.clone().applyMatrix4(m);
    const local = proto.geometry.attributes.position;
    const sway = new Float32Array(local.count);
    for (let i = 0; i < local.count; i += 1) sway[i] = SWAY[name] * Math.max(0, local.getY(i) / proto.h) ** 1.5 * s;
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    // per-type and per-instance tint (rocks darker, bushes lifted, +-10% value)
    const v = TINT[name] * (0.9 + 0.2 * hash(x * 2.7, z * 3.9));
    const colors = new Float32Array(local.count * 3);
    for (let i = 0; i < local.count; i += 1) { colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v * (name.startsWith('rock') ? 0.92 : 1); }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    buckets[quadrantOf(x, z)].push(g);
    counts[name] = (counts[name] || 0) + 1;
  };
  const step = 1.15;
  for (let x = -1.1; x <= 32; x += step) {
    for (let z = -32; z <= 42; z += step) {
      const px = x + (hash(x * 3.3, z * 1.7) - 0.5) * step * 0.9;
      const pz = z + (hash(z * 2.9, x * 4.1) - 0.5) * step * 0.9;
      if (px < -1.05) continue;
      const gap = clearingGap(px, pz);
      if (gap < 0.25 || gap > 24) continue;
      if (px < 6.9 && pz > -0.8 && pz < 1.1) continue; // the path out of the gate
      if (drop(px, pz)) continue;
      let trunk = 99;
      near(px, pz, 2, (s, d) => { trunk = Math.min(trunk, d - s.trunk * 0.6); });
      const r = hash(px * 7.7, pz * 5.1);
      const keep = 0.62 * Math.exp(-gap / 10) + 0.08;
      if (hash(pz * 1.3, px * 9.2) > keep) continue;
      let name;
      if (trunk < 0.4) {
        if (trunk > 0.22 && r < 0.35) name = 'mushroom';
        else continue;
      } else if (gap < 2.6) {
        name = r < 0.3 ? 'bush' : r < 0.55 ? 'fern' : r < 0.75 ? 'grass' : r < 0.9 ? 'groundleaf' : r < 0.96 ? 'plant' : 'rock_b';
      } else if (trunk < 1.4) {
        name = r < 0.45 ? 'fern' : r < 0.75 ? 'groundleaf' : r < 0.83 ? 'mushroom' : r < 0.92 ? 'plant' : 'rock_a';
      } else {
        name = r < 0.3 ? 'fern' : r < 0.6 ? 'groundleaf' : r < 0.72 ? 'grass' : r < 0.82 ? 'plant' : r < 0.9 ? 'bush' : r < 0.95 ? 'rock_a' : 'rock_b';
      }
      place(name, px, pz, r * 97.3);
    }
  }
  for (const c of extra) place(c.name, c.x, c.z, c.seed, c.y);
  // fallen logs: 9-sided cylinders textured from the bark cell of the same atlas, merged with the cover (no extra call)
  const BARK = { x: 784 / 1024, y: 640 / 1024, w: 240 / 1024, h: 384 / 1024 };
  const logGeo = new THREE.CylinderGeometry(1, 1, 1, 9, 1, false);
  logGeo.rotateZ(Math.PI / 2);
  logGeo.deleteAttribute('normal');
  logGeo.computeVertexNormals();
  {
    const uvs = logGeo.attributes.uv;
    for (let i = 0; i < uvs.count; i += 1) uvs.setXY(i, BARK.x + uvs.getX(i) * BARK.w * 0.98, BARK.y + uvs.getY(i) * BARK.h * 0.98);
  }
  let tries = 0;
  counts.log = 0;
  while (counts.log < 9 && tries < 400) {
    tries += 1;
    const x = 7 + hash(tries, 3.1) * 20;
    const z = -26 + hash(4.7, tries) * 62;
    const gap = clearingGap(x, z);
    if (gap < 2.5 || gap > 18 || drop(x, z)) continue;
    let clear = true;
    near(x, z, 2.6, (sp, d) => { if (d < 1.9) clear = false; });
    if (!clear) continue;
    const len = 2.2 + hash(tries, 8) * 2;
    const rad = 0.12 + hash(9, tries) * 0.09;
    const yaw = hash(tries, tries * 0.3) * Math.PI;
    const y = Math.min(forestGroundY(x - Math.cos(yaw) * len / 2, z + Math.sin(yaw) * len / 2), forestGroundY(x + Math.cos(yaw) * len / 2, z - Math.sin(yaw) * len / 2));
    const g = logGeo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y + rad * 0.75, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, (hash(tries, 2) - 0.5) * 0.08)), new THREE.Vector3(len, rad, rad)));
    const n = g.attributes.position.count;
    g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.62), 3));
    buckets[quadrantOf(x, z)].push(g);
    counts.log += 1;
  }
  let tris = 0;
  let calls = 0;
  buckets.forEach((list, q) => {
    if (!list.length) return;
    const geometry = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    geometry.computeBoundingSphere();
    tris += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    const mesh = tag(new THREE.Mesh(geometry, material));
    mesh.name = `forest_cover_${q}`;
    group.add(mesh);
    calls += 1;
  });
  return { tris, counts, calls };
}

function buildFireflies(group, drop = () => false) {
  const N = 150;
  const pos = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  let n = 0;
  for (let i = 0; n < N && i < 5000; i += 1) {
    const x = -1 + hash(i, 1.3) * 30;
    const z = -28 + hash(2.1, i) * 66;
    const gap = clearingGap(x, z);
    if (gap < 0.8 || gap > 16 || drop(x, z)) continue;
    pos[n * 3] = x;
    pos[n * 3 + 1] = forestGroundY(x, z) + 0.35 + hash(i, 7) * 1.8;
    pos[n * 3 + 2] = z;
    phase[n] = hash(i, 11) * 100;
    n += 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setDrawRange(0, n);
  const material = new THREE.ShaderMaterial({
    uniforms: { uT: clock, uColor: { value: new THREE.Color(0xd8ff7a) }, uScale: { value: 1 } },
    vertexShader: `
uniform float uT; uniform float uScale; attribute float aPhase; varying float vGlow;
void main() {
  vec3 p = position + vec3(sin(uT * 0.31 + aPhase) * 0.7, sin(uT * 0.53 + aPhase * 2.0) * 0.3, cos(uT * 0.27 + aPhase * 1.3) * 0.7);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float blink = pow(max(0.0, sin(uT * 0.8 + aPhase * 6.2831)), 5.0);
  vGlow = blink * smoothstep(26.0, 6.0, -mv.z);
  gl_PointSize = clamp(uScale * 0.09 * projectionMatrix[1][1] * 360.0 / -mv.z, 1.0, 24.0) * (0.35 + 0.65 * blink);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform vec3 uColor; varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * vGlow;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'forest_fireflies';
  points.frustumCulled = false;
  points.renderOrder = 2;
  group.add(tag(points));
  return { count: n };
}

export function createForestNext(scene, assets, { pines, spots: allSpots }) {
  const group = new THREE.Group();
  group.name = 'forest';
  group.userData.backdrop = true;
  const kit = assets?.gltf?.('forest_kit')?.scene || null;
  const extra = patches.splice(0);
  const drop = (x, z) => extra.some((p) => p.exclude?.(x, z));
  const spots = extra.length ? allSpots.filter((sp) => !drop(sp.x, sp.z)) : allSpots;
  const near = nearestIndex(spots);
  const stats = {};
  stats.ground = buildGround(group, kit, near);
  stats.trees = buildTrees(group, pines, [...spots, ...extra.flatMap((p) => p.trees || [])]);
  if (COVER && kit) stats.cover = buildCover(group, kit, spots, near, drop, extra.flatMap((p) => p.cover || []));
  if (FIREFLIES) stats.fireflies = buildFireflies(group, drop);
  stats.dropped = allSpots.length - spots.length;
  scene.add(group);
  if (import.meta.env?.DEV) console.info('forest', stats);
  return {
    group,
    stats,
    update(dt) {
      clock.value = (clock.value + dt) % 3600;
    },
  };
}
