import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Coral reef on the seabed under and around the big sea rocks in the middle of the shark/swordfish water.
// Quest budget: one draw call for the seabed shelf + one InstancedMesh per coral variant (9), no textures
// (the corals carry baked vertex colours, so they cost 0 bytes of texture memory), Draco geometry, no
// shadows, no raycasts, no per-frame work. ?reef=0 (or ?models=0) leaves the sea exactly as before.

// Patches around SEA_OUTCROPS in world.js: the (-24, -9) + (-22.5, -4.2) pair, (-29, 2.4) and (-36, 4).
const PATCHES = [
  { x: -23.6, z: -6.8, r: 5.6, seed: 11 },
  { x: -29.2, z: 2.2, r: 3.6, seed: 23 },
  { x: -36.2, z: 4.2, r: 5.0, seed: 37 },
];
const VARIANTS = [ // [mesh name in reef_corals.glb, weight, base scale]
  ['coral_branch', 1.4, 1.0],
  ['coral_staghorn', 1.2, 1.1],
  ['coral_tube', 1.0, 0.9],
  ['coral_bubble', 1.1, 1.0],
  ['coral_plate', 1.2, 1.15],
  ['coral_anemone', 0.6, 0.6],
  ['coral_fan', 1.0, 1.0],
  ['coral_redbranch', 1.0, 0.9],
  ['urchin', 0.5, 1.3],
];
const CENTRE_DEPTH = 2.0; // metres below WATER_Y in the middle of a patch
const RIM_DEPTH = 3.4; // at the patch edge, where it fades into the dark open-sea floor
const MIN_TIP_DEPTH = 0.6; // coral tips stay at least this far under the surface (waves, shark bellies)

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

export function createReef(scene, { assets, waterY, rocks = [] } = {}) {
  const gltf = assets?.feature('reef') ? assets.gltf('reef_corals') : null;
  if (!gltf) return null;
  const params = new URLSearchParams(location.search);
  const glow = Number(params.get('reefglow') ?? 0.14);
  const density = THREE.MathUtils.clamp(Number(params.get('reefdensity') ?? 1) || 1, 0.1, 2); // ?reefdensity=0.5 halves the corals

  // Seabed height: patch bowls plus a mound under each rock that buries the rock's base (the boulder
  // instances in createSeaRocks() reach about 0.55 * scale below the water).
  function depthAt(x, z) {
    let best = Infinity;
    for (const p of PATCHES) {
      const t = Math.hypot(x - p.x, z - p.z) / p.r;
      if (t > 1.2) continue;
      const wob = (Math.sin(x * 1.7 + p.seed) * Math.cos(z * 1.3 - p.seed) + Math.sin((x + z) * 3.1)) * 0.08;
      best = Math.min(best, CENTRE_DEPTH + (RIM_DEPTH - CENTRE_DEPTH) * smooth(0.45, 1.0, t) + (t > 1 ? (t - 1) * 8 : 0) + wob);
    }
    if (!Number.isFinite(best)) best = RIM_DEPTH + 1.2; // outside every patch
    for (const [rx, rz, scale] of rocks) {
      const d = Math.hypot(x - rx, z - rz) / (scale * 1.25);
      if (d < 1) best = Math.min(best, 0.5 * scale + (best - 0.5 * scale) * smooth(0.35, 1.0, d));
    }
    return best;
  }
  const floorY = (x, z) => waterY - depthAt(x, z);

  // Shelf: one merged, vertex-coloured mesh (sand with darker rubble).
  const sand = new THREE.Color(0x6a604c);
  const rubble = new THREE.Color(0x2f2b25);
  const abyss = new THREE.Color(0x0b1114);
  const tint = new THREE.Color();
  const discs = PATCHES.map((p) => {
    // Polar grid (rings x segments) so the bowl and the rock mounds have vertices to bend.
    const rings = 14;
    const segs = 48;
    const pos = [];
    const col = [];
    const idx = [];
    for (let i = 0; i <= rings; i += 1) {
      const rr = (i / rings) * p.r * 1.15;
      for (let j = 0; j < segs; j += 1) {
        const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
        const x = p.x + Math.cos(a) * rr;
        const z = p.z + Math.sin(a) * rr;
        pos.push(x, floorY(x, z), z);
        const n = 0.5 + 0.5 * Math.sin(x * 2.3 + z * 1.1 + p.seed) * Math.cos(z * 2.9 - x * 0.7);
        tint.copy(sand).lerp(rubble, smooth(0.35, 0.8, n) * 0.8);
        // Darker with depth and toward the rim, so the patch edge melts into the unlit open-sea floor.
        tint.lerp(abyss, Math.max(smooth(0.6, 1.15, i / rings * 1.15), smooth(2.2, 3.6, depthAt(x, z)) * 0.8));
        col.push(tint.r, tint.g, tint.b);
      }
    }
    for (let i = 0; i < rings; i += 1) {
      for (let j = 0; j < segs; j += 1) {
        const a = i * segs + j;
        const b = i * segs + ((j + 1) % segs);
        const c = (i + 1) * segs + j;
        const d = (i + 1) * segs + ((j + 1) % segs);
        if (i > 0) idx.push(a, b, c); // counter-clockwise seen from above: normals up (the water bake treats back faces as land)
        idx.push(b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  });
  const shelf = new THREE.Mesh(
    mergeGeometries(discs),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  );
  discs.forEach((geo) => geo.dispose());
  shelf.name = 'reefShelf';
  shelf.userData.shore = true; // seen by the water shore bake (src/water.js): lighter, clearer water over the reef
  shelf.raycast = () => {};
  scene.add(shelf);

  // Corals: one InstancedMesh per variant, sharing one vertex-colour material with a faint glow.
  const coralMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  coralMat.onBeforeCompile = (shader) => {
    shader.uniforms.uReefGlow = { value: glow };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReefGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance += vColor.rgb * uReefGlow;\n#endif');
  };
  const meshes = new Map();
  gltf.scene.traverse((o) => {
    if (o.isMesh) meshes.set(o.name, o.geometry);
  });
  const total = VARIANTS.reduce((s, v) => s + v[1], 0);
  const picks = VARIANTS.map(() => []);
  const dummy = new THREE.Object3D();
  let serial = 0;
  for (const p of PATCHES) {
    const count = Math.round(p.r * p.r * 1.6 * density);
    for (let k = 0; k < count; k += 1) {
      serial += 1;
      const h1 = hash(p.seed * 101 + k * 7.13);
      const h2 = hash(p.seed * 53 + k * 3.71);
      const t = 0.12 + 0.8 * Math.sqrt(h1);
      const a = h2 * Math.PI * 2;
      const x = p.x + Math.cos(a) * t * p.r;
      const z = p.z + Math.sin(a) * t * p.r;
      if (rocks.some(([rx, rz, scale]) => Math.hypot(x - rx, z - rz) < scale * 0.55)) continue;
      let w = hash(serial * 9.7) * total;
      let v = 0;
      while (w > VARIANTS[v][1] && v < VARIANTS.length - 1) {
        w -= VARIANTS[v][1];
        v += 1;
      }
      const geo = meshes.get(VARIANTS[v][0]);
      if (!geo) continue;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const y = floorY(x, z) - 0.04;
      let s = VARIANTS[v][2] * (0.95 + hash(serial * 4.1) * 0.75) * (1.2 - 0.35 * t);
      const room = waterY - MIN_TIP_DEPTH - y;
      if (geo.boundingBox.max.y * s > room) s = room / geo.boundingBox.max.y;
      if (s < 0.25) continue;
      picks[v].push({ x, y, z, s, yaw: hash(serial * 2.3) * Math.PI * 2, tx: (hash(serial * 5.9) - 0.5) * 0.25, tz: (hash(serial * 6.7) - 0.5) * 0.25 });
    }
  }
  const group = new THREE.Group();
  group.name = 'reef';
  let instances = 0;
  let tris = 0;
  VARIANTS.forEach(([name], v) => {
    const list = picks[v];
    const geo = meshes.get(name);
    if (!geo || !list.length) return;
    const mesh = new THREE.InstancedMesh(geo, coralMat, list.length);
    list.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(it.tx, it.yaw, it.tz);
      dummy.scale.setScalar(it.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.raycast = () => {};
    mesh.name = `reef_${name}`;
    group.add(mesh);
    instances += list.length;
    tris += list.length * (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3);
  });
  scene.add(group);

  return {
    group,
    shelf,
    floorY,
    stats: { instances, tris, drawCalls: group.children.length + 1, shelfTris: shelf.geometry.index.count / 3 },
  };
}
