import * as THREE from 'three';
import { createBrick, setBrickRaycast } from './bricks.js';
import { createGear } from './gear.js';
import { colorById, COLORS, GRID_X, GRID_Z, heightById, HEIGHTS, shapeById, SHAPES, STUD } from './config.js';

const TABLE_TOP = 0.76;
const WALL_Z = -2.68;
export const CLIFF_X = -1.78;
export const WATER_Y = -8;

export function pedestalSlot(index) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: 0.76 + col * 0.3,
    z: 0.42 - row * 0.32,
  };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, ctx, texture };
}

function rockTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6a635c';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i += 1) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const span = 3 + Math.random() * 22;
      const shade = 62 + Math.random() * 58;
      ctx.fillStyle = `rgba(${shade}, ${shade - 8}, ${shade - 16}, 0.42)`;
      ctx.beginPath();
      ctx.ellipse(x, y, span, span * (0.35 + Math.random() * 0.7), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(36, 32, 28, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i += 1) {
      ctx.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      ctx.moveTo(x, y);
      for (let step = 0; step < 7; step += 1) {
        x += (Math.random() - 0.5) * 48;
        y += (Math.random() - 0.5) * 48;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }).texture;
}

function basinGeometry(seed) {
  const rings = 12;
  const segs = 36;
  const positions = [];
  const colors = [];
  const indices = [];
  const wobble = (ring, seg) => {
    const edge = ring / rings;
    const n = Math.sin(seg * 0.85 + seed * 2.3) + 0.35 * Math.sin(seg * 1.9 + seed);
    return 1 + n * 0.035 * (1 - edge);
  };
  const push = (x, y, z, wet) => {
    positions.push(x, y, z);
    const damp = 1 - wet * 0.55;
    colors.push(damp, damp, damp * 0.98);
  };
  push(0, -0.22, 0, 1);
  for (let i = 1; i <= rings; i += 1) {
    const t = i / rings;
    const y = -0.22 * (1 - t) ** 1.05;
    for (let j = 0; j < segs; j += 1) {
      const a = (j / segs) * Math.PI * 2;
      const radius = t * wobble(i, j);
      push(Math.cos(a) * radius, y, Math.sin(a) * radius, 1 - t);
    }
  }
  for (let j = 0; j < segs; j += 1) {
    indices.push(0, 1 + ((j + 1) % segs), 1 + j);
  }
  for (let i = 0; i < rings - 1; i += 1) {
    for (let j = 0; j < segs; j += 1) {
      const a = 1 + i * segs + j;
      const b = 1 + i * segs + ((j + 1) % segs);
      const c = 1 + (i + 1) * segs + j;
      const d = 1 + (i + 1) * segs + ((j + 1) % segs);
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function stampFloorUv(geometry, x, z, rx, rz) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const roomRight = 2.7;
  const roomZ = 2.7;
  const roomMidX = (roomRight + CLIFF_X) / 2;
  const spanX = roomRight - CLIFF_X;
  const spanZ = roomZ * 2;
  for (let i = 0; i < pos.count; i += 1) {
    const wx = x + pos.getX(i) * rx;
    const wz = z + pos.getZ(i) * rz;
    uv.setXY(i, (wx - roomMidX) / spanX + 0.5, -wz / spanZ + 0.5);
  }
  uv.needsUpdate = true;
}

const PUDDLES = [[1.15, 0.12, 0.4, 0.3, 1.2], [1.7, -1.15, 0.36, 0.42, 2.4], [0.05, -1.35, 0.3, 0.36, 3.1], [-0.9, 0.85, 0.24, 0.18, 4.2]];

function punchFloor(floor) {
  const roomRight = 2.7;
  const roomZ = 2.7;
  const roomMidX = (roomRight + CLIFF_X) / 2;
  const spanX = roomRight - CLIFF_X;
  const spanZ = roomZ * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-spanX / 2, -spanZ / 2);
  shape.lineTo(spanX / 2, -spanZ / 2);
  shape.lineTo(spanX / 2, spanZ / 2);
  shape.lineTo(-spanX / 2, spanZ / 2);
  PUDDLES.forEach(([x, z, rx, rz]) => {
    const hole = new THREE.Path();
    const cx = x - roomMidX;
    const cy = -z;
    const steps = 24;
    for (let i = 0; i <= steps; i += 1) {
      const a = -(i / steps) * Math.PI * 2;
      const px = cx + Math.cos(a) * rx * 0.86;
      const py = cy + Math.sin(a) * rz * 0.86;
      if (i === 0) hole.moveTo(px, py);
      else hole.lineTo(px, py);
    }
    shape.holes.push(hole);
  });
  const geometry = new THREE.ShapeGeometry(shape);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, pos.getX(i) / spanX + 0.5, pos.getY(i) / spanZ + 0.5);
  }
  floor.geometry.dispose();
  floor.geometry = geometry;
}

function createPuddles(scene, floor, floorMap) {
  const rock = new THREE.MeshStandardMaterial({
    map: floorMap,
    color: 0xc8bfb4,
    roughness: 0.94,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 } },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vec2 p = (vUv - vec2(0.5)) * 2.0;
        float rim = length(p);
        float edge = smoothstep(1.0, 0.55, rim);
        float depth = smoothstep(1.0, 0.0, rim);
        float seed = fract(sin(dot(floor(vWorld.xz), vec2(19.1, 73.7))) * 241.5);
        float sweep = fract(uTime * 0.05 + seed);
        float band = smoothstep(0.07, 0.0, abs(p.y - mix(-0.45, 0.45, sweep)));
        float rare = step(0.78, fract(seed * 17.0 + floor(uTime * 0.12)));
        float shimmer = band * rare * smoothstep(0.35, 0.9, sin(uTime * 0.9 + seed * 6.2) * 0.5 + 0.5);
        vec3 color = mix(vec3(0.04, 0.2, 0.24), vec3(0.14, 0.4, 0.42), depth);
        color += vec3(0.8, 0.9, 0.88) * shimmer;
        float alpha = edge * mix(0.5, 0.82, depth) + shimmer * 0.22;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  punchFloor(floor);
  const waterGeo = new THREE.CircleGeometry(0.72, 28);
  PUDDLES.forEach(([x, z, rx, rz, seed]) => {
    const geometry = basinGeometry(seed);
    stampFloorUv(geometry, x, z, rx, rz);
    const bowl = new THREE.Mesh(geometry, rock);
    bowl.scale.set(rx, 1, rz);
    bowl.position.set(x, -0.01, z);
    bowl.receiveShadow = true;
    scene.add(bowl);
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.scale.set(rx, rz, 1);
    water.position.set(x, -0.06, z);
    water.renderOrder = 2;
    scene.add(water);
  });
  return {
    update(dt) {
      waterMat.uniforms.uTime.value += dt;
    },
  };
}

function shellTexture(hinge, mid, lip, rib) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const wash = ctx.createLinearGradient(0, 0, w, 0);
    wash.addColorStop(0, hinge);
    wash.addColorStop(0.42, mid);
    wash.addColorStop(1, lip);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 24; i += 1) {
      const y = ((i + 0.5) / 24) * h;
      ctx.strokeStyle = rib;
      ctx.lineWidth = i % 2 === 0 ? 7 : 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.35, y - 10, w * 0.7, y + 12, w, y - 4);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(92, 58, 36, 0.28)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 16; i += 1) {
      const x = Math.pow(i / 16, 1.15) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 6, h);
      ctx.stroke();
    }
    for (let i = 0; i < 140; i += 1) {
      const shade = 90 + Math.random() * 80;
      ctx.fillStyle = `rgba(${shade}, ${shade * 0.62}, ${shade * 0.4}, 0.35)`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.4, 0.6 + Math.random(), Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = lip;
    ctx.fillRect(w - 24, 0, 24, 28);
  }).texture;
}

function shellGeometry() {
  const ribs = 18;
  const segments = 36;
  const rings = 18;
  const fan = 2.15;
  const positions = [];
  const uvs = [];
  const pushRing = (lift, cupScale) => {
    for (let i = 0; i <= rings; i += 1) {
      const u = i / rings;
      for (let j = 0; j <= segments; j += 1) {
        const v = j / segments;
        const ang = (v - 0.5) * fan;
        const radius = 0.018 + u * 0.108;
        const rib = Math.cos((v * ribs) * Math.PI * 2) * 0.0042 * Math.pow(u, 0.85);
        const cup = Math.sin(u * Math.PI) * 0.011 * cupScale;
        const ear = Math.pow(Math.sin(v * Math.PI), 0.35);
        positions.push(
          Math.sin(ang) * radius * ear,
          lift + cup + (cupScale > 0.5 ? rib : rib * 0.25),
          -Math.cos(ang) * radius * 0.92 + 0.03,
        );
        uvs.push(cupScale > 0.5 ? u : 0.985, cupScale > 0.5 ? v : 0.02);
      }
    }
  };
  pushRing(0.014, 1);
  const topCount = positions.length / 3;
  for (let i = 0; i < topCount; i += 1) {
    positions.push(positions[i * 3], positions[i * 3 + 1] - 0.006, positions[i * 3 + 2]);
    uvs.push(0.985, 0.02);
  }
  const row = segments + 1;
  const indices = [];
  const stitch = (base, flip) => {
    for (let i = 0; i < rings; i += 1) {
      for (let j = 0; j < segments; j += 1) {
        const a = base + i * row + j;
        if (flip) indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
        else indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
  };
  stitch(0, false);
  stitch((rings + 1) * row, true);
  const lip = (rings + 1) * row;
  const seal = (t0, t1, outward) => {
    const b0 = lip + t0;
    const b1 = lip + t1;
    if (outward) indices.push(t0, t1, b0, t1, b1, b0);
    else indices.push(t0, b0, t1, t1, b0, b1);
  };
  for (let j = 0; j < segments; j += 1) {
    seal(j, j + 1, false);
    seal(rings * row + j, rings * row + j + 1, true);
  }
  for (let i = 0; i < rings; i += 1) {
    seal(i * row, (i + 1) * row, false);
    seal(i * row + segments, (i + 1) * row + segments, true);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function starfishGeometry(warmth) {
  const arms = 5;
  const steps = 72;
  const rings = 10;
  const positions = [];
  const colors = [];
  const radiusAt = (theta) => {
    const lobe = 0.5 + 0.5 * Math.cos(arms * theta);
    return 0.038 + 0.1 * Math.pow(lobe, 2.6);
  };
  const bodyC = new THREE.Color(warmth > 0.6 ? '#d15a22' : '#b84a18');
  const centerC = new THREE.Color('#6a2a10');
  const tipC = new THREE.Color('#e8b07a');
  const spotC = new THREE.Color('#7c3412');
  const underC = new THREE.Color('#f3d7c0');
  const paint = (theta, u, top) => {
    const tip = Math.pow(0.5 + 0.5 * Math.cos(arms * theta), 3.2);
    const spot = Math.sin(theta * 11.0 + u * 19.0) * Math.sin(theta * 7.0 - u * 5.0);
    const color = new THREE.Color();
    if (!top) {
      color.copy(underC);
      if (spot > 0.35) color.lerp(spotC, 0.35);
      return [color.r, color.g, color.b];
    }
    color.copy(bodyC);
    if (u < 0.34) color.lerp(centerC, 1 - u / 0.34);
    else color.lerp(tipC, (u - 0.34) * tip);
    if (spot > 0.45) color.lerp(spotC, 0.55);
    return [color.r, color.g, color.b];
  };
  const addSide = (top) => {
    for (let i = 0; i <= steps; i += 1) {
      const theta = (i / steps) * Math.PI * 2;
      const reach = radiusAt(theta);
      for (let k = 0; k <= rings; k += 1) {
        const u = k / rings;
        const rr = reach * u;
        const x = Math.cos(theta) * rr;
        const z = Math.sin(theta) * rr;
        const dome = top ? 0.014 * Math.cos(u * Math.PI * 0.5) * (0.65 + (1 - u) * 0.7) : 0;
        const tuber = top ? Math.max(0, Math.sin(theta * 14) * Math.sin(u * 10)) * 0.007 : 0;
        positions.push(x, (top ? 0.012 : 0.001) + dome + tuber, z);
        colors.push(...paint(theta, u, top));
      }
    }
  };
  addSide(true);
  addSide(false);
  const row = rings + 1;
  const indices = [];
  const stitch = (base, flip) => {
    for (let i = 0; i < steps; i += 1) {
      for (let k = 0; k < rings; k += 1) {
        const a = base + i * row + k;
        if (flip) indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
        else indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
  };
  stitch(0, false);
  stitch((steps + 1) * row, true);
  const starLip = (steps + 1) * row;
  for (let i = 0; i < steps; i += 1) {
    const t0 = i * row + rings;
    const t1 = (i + 1) * row + rings;
    const b0 = starLip + t0;
    const b1 = starLip + t1;
    indices.push(t0, t1, b0, t1, b1, b0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function pebbleGeometry(seed) {
  const geometry = new THREE.SphereGeometry(1, 18, 14);
  const pos = geometry.attributes.position;
  let state = seed;
  const rand = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const lumps = [];
  for (let i = 0; i < 4; i += 1) {
    lumps.push({
      x: rand() * 2 - 1,
      y: rand() * 2 - 1,
      z: rand() * 2 - 1,
      amp: 0.06 + rand() * 0.12,
    });
  }
  const stretchX = 0.82 + rand() * 0.36;
  const squashY = 0.52 + rand() * 0.16;
  const stretchZ = 0.78 + rand() * 0.38;
  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (dir.lengthSq() < 1e-8) continue;
    dir.normalize();
    let radius = 1;
    for (const lump of lumps) {
      const dot = dir.x * lump.x + dir.y * lump.y + dir.z * lump.z;
      radius += lump.amp * Math.pow(Math.max(0, dot), 2);
    }
    pos.setXYZ(i, dir.x * radius * stretchX, dir.y * radius * squashY, dir.z * radius * stretchZ);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createFinds(scene, targets, rockMap) {
  const pebbleMap = rockMap.clone();
  pebbleMap.repeat.set(1, 1);
  pebbleMap.offset.set(0.15, 0.2);
  pebbleMap.needsUpdate = true;
  const pebbleMat = new THREE.MeshStandardMaterial({ map: pebbleMap, color: 0xc4bbb2, roughness: 0.94 });
  const pebbleDarkMap = pebbleMap.clone();
  pebbleDarkMap.offset.set(0.62, 0.48);
  pebbleDarkMap.needsUpdate = true;
  const pebbleDark = new THREE.MeshStandardMaterial({ map: pebbleDarkMap, color: 0x8d847a, roughness: 1 });
  const cream = shellTexture('#f4e2cf', '#e7c3a2', '#f7efe4', 'rgba(176, 122, 78, 0.55)');
  const rose = shellTexture('#f0d0c4', '#e29a86', '#f6e4da', 'rgba(150, 78, 62, 0.5)');
  const shellMat = new THREE.MeshStandardMaterial({ map: cream, roughness: 0.42, metalness: 0.06, side: THREE.DoubleSide });
  const shellPink = new THREE.MeshStandardMaterial({ map: rose, roughness: 0.38, metalness: 0.08, side: THREE.DoubleSide });
  const starMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  const starRed = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const shellGeo = shellGeometry();
  const starGeo = starfishGeometry(0.35);
  const starWarm = starfishGeometry(0.85);
  const pebbles = [pebbleGeometry(3), pebbleGeometry(11), pebbleGeometry(19), pebbleGeometry(29)];
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const stones = [
    [0.55, 0.45, 0.09, 0.4],
    [-0.85, -0.25, 0.055, 1.1],
    [1.75, 0.55, 0.11, 0.3],
    [0.15, -1.25, 0.07, 2.1],
    [-0.35, 0.55, 0.048, 0.8],
    [1.05, 0.95, 0.08, 1.6],
    [-1.15, -0.85, 0.06, 0.2],
    [0.72, -0.15, 0.045, 1.4],
    [1.45, 1.15, 0.05, 2.4],
    [-0.15, -0.55, 0.04, 0.6],
    [2.15, 0.25, 0.065, 1.8],
    [0.95, 1.65, 0.042, 0.9],
    [-0.55, 1.35, 0.05, 2.6],
    [1.2, -1.55, 0.058, 0.15],
    [0.28, 0.85, 0.038, 1.2],
    [-1.25, 0.35, 0.07, 2.0],
  ];
  stones.forEach(([x, z, size, spin], index) => {
    const stone = new THREE.Group();
    const body = new THREE.Mesh(pebbles[index % pebbles.length], index % 2 === 0 ? pebbleMat : pebbleDark);
    body.scale.set(size, size * 0.72, size * 0.9);
    body.castShadow = true;
    body.receiveShadow = true;
    stone.add(body);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(Math.max(size * 1.15, 0.055), 8, 6), hitMat);
    stone.add(hit);
    const floorY = size * 0.34;
    stone.position.set(x, floorY, z);
    stone.rotation.set(spin * 0.35, spin, spin * 0.2);
    stone.userData = { type: 'prop', label: 'stone', role: 'loose', floorY };
    scene.add(stone);
    targets.push(stone);
  });
  const pieces = [
    ['shell', shellGeo, shellMat, 0.9, -0.85, 1, 0.4],
    ['shell', shellGeo, shellPink, -1.05, 0.85, 1, 1.7],
    ['shell', shellGeo, shellMat, 1.95, -0.15, 1, 2.4],
    ['shell', shellGeo, shellPink, 0.35, 1.85, 1, 0.9],
    ['starfish', starGeo, starMat, -0.55, -1.15, 1, 0.2],
    ['starfish', starWarm, starRed, 1.4, 1.35, 1, 1.1],
    ['starfish', starGeo, starMat, 0.05, -0.05, 1, 2.2],
    ['starfish', starWarm, starRed, 2.05, 1.05, 1, 0.6],
  ];
  for (const [label, geometry, material, x, z, size, spin] of pieces) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(size);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = spin;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { type: 'prop', label, role: 'loose', floorY: 0 };
    scene.add(mesh);
    targets.push(mesh);
  }
}

function tubeGeometry(profile, power, rings = 28, segs = 20) {
  const exp = 2 / power;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= rings; i += 1) {
    const p = profile(i / rings);
    for (let j = 0; j <= segs; j += 1) {
      const a = (j / segs) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const oy = p.oy || 0;
      positions.push(
        p.x,
        oy + Math.sign(c) * Math.pow(Math.abs(c), exp) * p.y,
        Math.sign(s) * Math.pow(Math.abs(s), exp) * p.z,
      );
      uvs.push(i / rings, j / segs);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segs; j += 1) {
      const a = i * row + j;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const nose = profile(1);
  const tail = profile(0);
  const noseCenter = positions.length / 3;
  positions.push(nose.x, nose.oy || 0, 0);
  uvs.push(1, 0.5);
  const tailCenter = positions.length / 3;
  positions.push(tail.x, tail.oy || 0, 0);
  uvs.push(0, 0.5);
  for (let j = 0; j < segs; j += 1) {
    indices.push(noseCenter, rings * row + j, rings * row + j + 1);
    indices.push(tailCenter, j + 1, j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function swordfishProfile(u) {
  const body = Math.exp(-((u - 0.34) ** 2) / 0.055);
  const head = Math.exp(-((u - 0.7) ** 2) / 0.014);
  let y = 0.02 + 0.19 * body + 0.05 * head;
  let z = 0.016 + 0.14 * body + 0.042 * head;
  if (u > 0.78) {
    const point = Math.pow(1 - (u - 0.78) / 0.22, 1.05);
    y *= point;
    z *= point;
  }
  return { x: -1.08 + u * 2.72, y: Math.max(y, 0.002), z: Math.max(z, 0.0016) };
}

function greatWhiteProfile(u) {
  let radius;
  let oy = 0;
  if (u < 0.14) {
    radius = 0.046 + 0.048 * Math.pow(u / 0.14, 0.8);
  } else if (u < 0.58) {
    const k = (u - 0.14) / 0.44;
    radius = 0.094 + 0.16 * Math.sin(k * Math.PI * 0.5);
  } else if (u < 0.8) {
    const k = (u - 0.58) / 0.22;
    radius = 0.254 - 0.03 * k;
  } else {
    const k = (u - 0.8) / 0.2;
    radius = Math.max(0.224 * Math.pow(Math.max(1 - k, 0), 0.75), 0.014);
    oy = 0.03 * k;
  }
  return {
    x: -1.12 + u * 2.18,
    y: radius * 0.96,
    z: radius * 0.92,
    oy,
  };
}

function sharkSlice(u) {
  const p = greatWhiteProfile(u);
  const oy = p.oy || 0;
  return { x: p.x, mid: oy, top: oy + p.y, belly: oy - p.y, half: p.z };
}

function sharkSkinTexture(base = '#3c5566', grey = false) {
  const size = grey ? 1024 : 256;
  const { texture } = canvasTexture(size, size, (ctx, w, h) => {
    if (grey) {
      const image = ctx.createImageData(w, h);
      const data = image.data;
      for (let y = 0; y < h; y += 1) {
        const v = y / h;
        for (let x = 0; x < w; x += 1) {
          const u = x / w;
          const wave = Math.sin(u * Math.PI * 14) * 0.012 + Math.sin(u * Math.PI * 40) * 0.005;
          const dist = Math.abs(v - 0.5);
          const blend = THREE.MathUtils.smoothstep(dist, 0.15 + wave, 0.23 + wave);
          const ridge = THREE.MathUtils.smoothstep(dist, 0.3, 0.5);
          const grain = Math.sin(x * 0.37 + y * 1.7) * Math.sin(x * 1.9 - y * 0.8);
          let r = 214 + (62 - 214) * blend - ridge * 22 + grain * 5;
          let g = 210 + (68 - 210) * blend - ridge * 20 + grain * 5;
          let b = 198 + (74 - 198) * blend - ridge * 16 + grain * 4;
          const i = (y * w + x) * 4;
          data[i] = Math.max(0, Math.min(255, r));
          data[i + 1] = Math.max(0, Math.min(255, g));
          data[i + 2] = Math.max(0, Math.min(255, b));
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    } else {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
    }
    const specks = grey ? 2400 : 900;
    for (let i = 0; i < specks; i += 1) {
      const shade = 36 + Math.random() * 48;
      const y = Math.random() * h;
      const onBelly = grey && y > h * 0.34 && y < h * 0.66;
      ctx.fillStyle = onBelly
        ? `rgba(${180 + shade * 0.3}, ${176 + shade * 0.25}, ${168 + shade * 0.2}, 0.35)`
        : `rgba(${shade * 0.7}, ${shade * 0.74}, ${shade * 0.78}, 0.55)`;
      ctx.fillRect(Math.random() * w, y, grey ? 2 : 2, grey ? 4 : 3);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, grey ? 1 : 1.4);
  texture.anisotropy = 8;
  return texture;
}

function silverScaleTexture() {
  const { texture } = canvasTexture(1024, 1024, (ctx, w, h) => {
    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, '#1a56b0');
    wash.addColorStop(0.08, '#1e62c0');
    wash.addColorStop(0.16, '#2f74b8');
    wash.addColorStop(0.26, '#8eacbf');
    wash.addColorStop(0.34, '#e4eaee');
    wash.addColorStop(0.5, '#f7f9fa');
    wash.addColorStop(0.66, '#e4eaee');
    wash.addColorStop(0.74, '#8eacbf');
    wash.addColorStop(0.84, '#2f74b8');
    wash.addColorStop(0.92, '#1e62c0');
    wash.addColorStop(1, '#1a56b0');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    const cols = 78;
    const rows = 40;
    const rw = w / cols;
    const rh = h / rows;
    const bands = [];
    for (let row = 0; row < rows; row += 1) {
      const fromBack = Math.min((row + 0.5) / rows, 1 - (row + 0.5) / rows);
      if (fromBack < 0.2) bands.push({ row, strength: 1 - fromBack / 0.2 });
    }
    bands.sort((a, b) => a.strength - b.strength);
    bands.forEach(({ row, strength }) => {
      const shift = row % 2 ? rw * 0.5 : 0;
      const red = Math.round(22 + (1 - strength) * 36);
      const green = Math.round(78 + (1 - strength) * 48);
      const blue = Math.round(176 + (1 - strength) * 24);
      for (let col = -1; col <= cols; col += 1) {
        const x = col * rw + shift;
        const y = row * rh + rh * 0.5;
        ctx.globalAlpha = 0.55 + strength * 0.4;
        ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
        ctx.beginPath();
        ctx.ellipse(x + rw * 0.15, y, rw * 0.78, rh * 0.95, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.7 + strength * 0.3;
        ctx.strokeStyle = '#07111c';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x + rw * 0.28, y, Math.min(rw, rh) * 0.72, Math.PI * 0.55, Math.PI * 1.45);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  return texture;
}

function finGeometry(points, depth = 0.02) {
  const shape = new THREE.Shape();
  const curve = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const spaced = curve.getPoints(40);
  shape.moveTo(spaced[0].x, spaced[0].y);
  spaced.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

const SEA_ROCKS = [
  { x: -24, z: -9, r: 4.2 },
  { x: -36, z: 4, r: 4.8 },
  { x: -18, z: 14, r: 3.4 },
  { x: -44, z: -16, r: 4.4 },
  { x: -22.5, z: -4.2, r: 2.4 },
  { x: -29, z: 2.4, r: 2.2 },
  { x: -45.5, z: 12.5, r: 8.5 },
];

function clearOfRocks(x, z, reach) {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 3; pass += 1) {
    for (const rock of SEA_ROCKS) {
      const dx = px - rock.x;
      const dz = pz - rock.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const limit = rock.r + reach;
      if (dist < limit) {
        px = rock.x + (dx / dist) * limit;
        pz = rock.z + (dz / dist) * limit;
      }
    }
  }
  return [THREE.MathUtils.clamp(px, -50, -9), THREE.MathUtils.clamp(pz, -22, 18)];
}

function createSharks(scene, splash) {
  const aboveWater = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
  const belowWater = new THREE.Plane(new THREE.Vector3(0, -1, 0), WATER_Y);
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1a1e22,
    roughness: 0.35,
    clippingPlanes: [aboveWater],
  });
  const scaleSkin = silverScaleTexture();
  const scaleBump = scaleSkin.clone();
  scaleBump.colorSpace = THREE.LinearSRGBColorSpace;
  const swordBodyMat = new THREE.MeshStandardMaterial({
    map: scaleSkin,
    bumpMap: scaleBump,
    bumpScale: 0.05,
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.12,
    clippingPlanes: [aboveWater],
  });
  const swordFinMat = new THREE.MeshStandardMaterial({
    color: 0x24303a,
    roughness: 0.48,
    metalness: 0.22,
    side: THREE.DoubleSide,
    clippingPlanes: [aboveWater],
  });
  const swordDorsalMat = swordFinMat.clone();
  swordDorsalMat.color.set(0x1a62c8);
  const mouthMat = new THREE.MeshStandardMaterial({
    color: 0x2a1618,
    roughness: 0.86,
    side: THREE.DoubleSide,
    clippingPlanes: [aboveWater],
  });
  const whiteSkin = sharkSkinTexture('#7c7f83', true);
  const whiteBump = whiteSkin.clone();
  whiteBump.colorSpace = THREE.LinearSRGBColorSpace;
  const whiteMat = new THREE.MeshStandardMaterial({
    map: whiteSkin,
    bumpMap: whiteBump,
    bumpScale: 0.04,
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.02,
    clippingPlanes: [aboveWater],
  });
  const whiteFin = whiteMat.clone();
  whiteFin.side = THREE.DoubleSide;
  const swordBody = tubeGeometry(swordfishProfile, 2);
  const whiteBody = tubeGeometry(greatWhiteProfile, 2, 64, 48);
  const swordAnal = finGeometry([
    [0.04, -0.12],
    [-0.1, -0.24],
    [-0.26, -0.32],
    [-0.44, -0.2],
    [-0.32, -0.1],
    [-0.12, -0.08],
  ], 0.01);
  const swordMouth = finGeometry([
    [0.84, -0.05],
    [0.96, -0.09],
    [1.12, -0.07],
    [1.1, -0.038],
    [0.94, -0.032],
    [0.84, -0.04],
  ], 0.016);
  const swordPelvic = finGeometry([
    [0.04, -0.01],
    [-0.02, -0.08],
    [-0.1, -0.13],
    [-0.14, -0.05],
    [-0.04, 0.0],
  ], 0.007);
  const swordDorsal = finGeometry([
    [0.08, 0.17],
    [0.0, 0.26],
    [-0.08, 0.36],
    [-0.22, 0.26],
    [-0.36, 0.18],
    [-0.48, 0.15],
  ]);
  const swordTail = finGeometry([
    [0.06, 0.02],
    [-0.1, 0.12],
    [-0.28, 0.2],
    [-0.42, 0.16],
    [-0.22, 0.04],
    [-0.12, 0.0],
    [-0.3, -0.1],
    [-0.4, -0.18],
    [-0.16, -0.05],
    [0.02, -0.01],
  ], 0.012);
  const whiteDorsal = finGeometry([
    [0.18, 0.24],
    [0.08, 0.36],
    [-0.02, 0.46],
    [-0.14, 0.32],
    [-0.24, 0.22],
  ], 0.022);
  const whiteDorsal2 = finGeometry([
    [-0.62, 0.1],
    [-0.7, 0.16],
    [-0.78, 0.2],
    [-0.88, 0.13],
    [-0.96, 0.07],
  ], 0.01);
  const whiteTail = finGeometry([
    [0.18, 0.045],
    [-0.16, 0.2],
    [-0.46, 0.4],
    [-0.24, 0.1],
    [-0.08, 0.02],
    [-0.26, -0.12],
    [-0.16, -0.2],
    [0.16, -0.025],
  ], 0.02);
  const pecGeo = finGeometry([
    [0.02, 0.04],
    [0.18, 0.06],
    [0.4, 0.0],
    [0.56, -0.08],
    [0.34, -0.14],
    [0.1, -0.05],
  ], 0.012);
  const addPair = (build) => {
    const fish = build();
    const shadow = fish.clone(true);
    shadow.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      const material = child.material.clone();
      material.clippingPlanes = [belowWater];
      child.material = material;
    });
    fish.userData.tail = fish.getObjectByName('tail');
    shadow.userData.tail = shadow.getObjectByName('tail');
    fish.rotation.order = 'YXZ';
    shadow.rotation.order = 'YXZ';
    return { shark: fish, shadow };
  };
  const makeSwordfish = () => {
    const fish = new THREE.Group();
    const body = new THREE.Mesh(swordBody, swordBodyMat);
    body.castShadow = true;
    fish.add(body);
    const dorsal = new THREE.Mesh(swordDorsal, swordDorsalMat);
    dorsal.name = 'dorsal';
    dorsal.castShadow = true;
    fish.add(dorsal);
    const anal = new THREE.Mesh(swordAnal, swordFinMat);
    anal.castShadow = true;
    fish.add(anal);
    const pelvic = new THREE.Mesh(swordPelvic, swordFinMat);
    pelvic.position.set(0.5, -0.12, 0.03);
    pelvic.rotation.order = 'YXZ';
    pelvic.rotation.y = -0.4;
    pelvic.scale.set(1.35, 1.35, 1.35);
    pelvic.castShadow = true;
    fish.add(pelvic);
    const pelvicL = pelvic.clone();
    pelvicL.position.z = -0.045;
    pelvicL.rotation.y = 0.4;
    fish.add(pelvicL);
    const tail = new THREE.Group();
    tail.name = 'tail';
    tail.position.set(-1.05, 0, 0);
    tail.add(new THREE.Mesh(swordTail, swordFinMat));
    fish.add(tail);
    const head = swordfishProfile(0.73);
    const eyeY = head.y * 0.18;
    const eyeZ = head.z * Math.sqrt(Math.max(0.15, 1 - (eyeY / head.y) ** 2));
    const eyeGeo = new THREE.SphereGeometry(0.034, 16, 12);
    const glintGeo = new THREE.SphereGeometry(0.009, 8, 6);
    const glintMat = darkMat.clone();
    glintMat.color.set(0xf2f5f7);
    const eye = new THREE.Mesh(eyeGeo, darkMat);
    eye.position.set(head.x, eyeY, eyeZ);
    fish.add(eye);
    const glint = new THREE.Mesh(glintGeo, glintMat);
    glint.position.set(head.x + 0.012, eyeY + 0.012, eyeZ + 0.02);
    fish.add(glint);
    const eyeL = new THREE.Mesh(eyeGeo, darkMat);
    eyeL.position.set(head.x, eyeY, -eyeZ);
    fish.add(eyeL);
    const glintL = new THREE.Mesh(glintGeo, glintMat);
    glintL.position.set(head.x + 0.012, eyeY + 0.012, -eyeZ - 0.02);
    fish.add(glintL);
    const mouth = new THREE.Mesh(swordMouth, mouthMat);
    fish.add(mouth);
    return fish;
  };
  const toothShape = new THREE.Shape();
  toothShape.moveTo(-0.0065, 0);
  toothShape.lineTo(0.0065, 0);
  toothShape.lineTo(0, 0.02);
  const toothGeo = new THREE.ExtrudeGeometry(toothShape, {
    depth: 0.0032,
    bevelEnabled: false,
  });
  toothGeo.translate(0, 0, -0.0016);
  const addSharkMouth = (fish) => {
    const gumMat = new THREE.MeshStandardMaterial({
      color: 0xc43238,
      emissive: 0x6e1418,
      emissiveIntensity: 0.7,
      roughness: 0.58,
      side: THREE.DoubleSide,
      clippingPlanes: [aboveWater],
    });
    const cavityMat = new THREE.MeshStandardMaterial({
      color: 0x5c1016,
      emissive: 0x3a080c,
      emissiveIntensity: 0.45,
      roughness: 0.86,
      side: THREE.DoubleSide,
      clippingPlanes: [aboveWater],
    });
    const toothMat = new THREE.MeshStandardMaterial({
      color: 0xe6e1d6,
      emissive: 0x4a4740,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.05,
      clippingPlanes: [aboveWater],
    });
    const toothGrey = toothMat.clone();
    toothGrey.color.set(0xb7b2a8);
    toothGrey.emissive.set(0x3a3834);
    const jawAt = (t) => {
      const ang = t * Math.PI;
      const front = Math.sin(ang);
      const gape = front ** 0.85;
      const across = Math.cos(ang);
      const u = 0.83 + gape * 0.07;
      const slice = sharkSlice(u);
      const ry = (slice.top - slice.belly) / 2;
      const a = Math.PI - across * 0.58;
      const ny = Math.cos(a);
      const nz = Math.sin(a);
      const x = slice.x;
      const surfY = slice.mid + ny * ry;
      const surfZ = nz * slice.half;
      const out = (dist) => [x - dist * 0.15, surfY + ny * dist, surfZ + nz * dist * 0.35];
      return {
        seam: out(0.003),
        upper: out(0.011 + gape * 0.004),
        lower: out(0.013 + gape * 0.026),
        chin: out(0.02 + gape * 0.034),
        pit: out(0.008 + gape * 0.014),
        front: gape,
        across,
      };
    };
    const ribbon = (keyA, keyB, name, material) => {
      const steps = 28;
      const positions = [];
      const indices = [];
      for (let i = 0; i <= steps; i += 1) {
        const spot = jawAt(i / steps);
        positions.push(...spot[keyA], ...spot[keyB]);
      }
      for (let i = 0; i < steps; i += 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      mesh.geometry.setIndex(indices);
      mesh.geometry.computeVertexNormals();
      mesh.name = name;
      fish.add(mesh);
    };
    ribbon('seam', 'upper', 'gum', gumMat);
    ribbon('chin', 'lower', 'gum', gumMat);
    ribbon('upper', 'pit', 'mouth', cavityMat);
    ribbon('pit', 'lower', 'cavity', cavityMat);
    const plant = (upper, back, count, material) => {
      for (let i = 0; i < count; i += 1) {
        const spot = jawAt((i + 0.5) / count);
        if (spot.front < 0.42) continue;
        const tooth = new THREE.Mesh(toothGeo, material);
        tooth.name = 'tooth';
        const edge = upper ? spot.upper : spot.lower;
        tooth.position.set(
          edge[0] - (back ? 0.01 : 0),
          edge[1] + (upper ? (back ? 0.003 : 0) : (back ? 0.002 : 0.008)),
          edge[2] * (back ? 0.72 : 0.98),
        );
        tooth.rotation.y = spot.across * 0.25;
        tooth.rotation.z = upper ? Math.PI : 0;
        const size = (0.62 + spot.front * 0.38) * (back ? 0.66 : 1);
        tooth.scale.set(size * (upper ? 1.35 : 0.8), size * 0.7, size);
        fish.add(tooth);
      }
    };
    plant(true, false, 12, toothMat);
    plant(true, true, 10, toothGrey);
    plant(false, false, 11, toothMat);
    plant(false, true, 9, toothGrey);
    const slit = new THREE.BoxGeometry(0.005, 0.048, 0.003);
    for (let i = 0; i < 5; i += 1) {
      const slice = sharkSlice(0.7 - i * 0.018);
      const gill = new THREE.Mesh(slit, darkMat);
      gill.position.set(slice.x, slice.mid - 0.012, slice.half * 0.9);
      gill.rotation.z = -0.35;
      fish.add(gill);
      const gillL = gill.clone();
      gillL.position.z = -slice.half * 0.9;
      fish.add(gillL);
    }
  };
  const makeWhite = () => {
    const fish = new THREE.Group();
    const body = new THREE.Mesh(whiteBody, whiteMat);
    body.castShadow = true;
    fish.add(body);
    const dorsal = new THREE.Mesh(whiteDorsal, whiteFin);
    dorsal.castShadow = true;
    fish.add(dorsal);
    const dorsal2 = new THREE.Mesh(whiteDorsal2, whiteFin);
    dorsal2.castShadow = true;
    fish.add(dorsal2);
    addSharkMouth(fish);
    const tail = new THREE.Group();
    tail.name = 'tail';
    tail.position.set(-1.02, 0.01, 0);
    tail.add(new THREE.Mesh(whiteTail, whiteFin));
    fish.add(tail);
    const pecSlice = sharkSlice(0.56);
    const pecY = pecSlice.mid - (pecSlice.mid - pecSlice.belly) * 0.28;
    const pecDrop = 24 * Math.PI / 180;
    const pec = new THREE.Mesh(pecGeo, whiteFin);
    pec.rotation.order = 'YXZ';
    pec.rotation.set(Math.PI / 2, -2.55, 0);
    pec.scale.set(1.15, 1.65, 1.15);
    const pecHinge = new THREE.Group();
    pecHinge.position.set(pecSlice.x, pecY, pecSlice.half * 0.7);
    pecHinge.rotation.x = pecDrop;
    pecHinge.add(pec);
    fish.add(pecHinge);
    const pecL = pec.clone();
    pecL.rotation.set(-Math.PI / 2, 2.55, 0);
    const pecHingeL = new THREE.Group();
    pecHingeL.position.set(pecSlice.x, pecY, -pecSlice.half * 0.7);
    pecHingeL.rotation.x = -pecDrop;
    pecHingeL.add(pecL);
    fish.add(pecHingeL);
    const eyeSlice = sharkSlice(0.82);
    const eyeRise = (eyeSlice.top - eyeSlice.mid) * 0.22;
    const eyeY = eyeSlice.mid + eyeRise;
    const eyeNz = Math.sqrt(Math.max(0.2, 1 - (eyeRise / (eyeSlice.top - eyeSlice.mid)) ** 2));
    const eyeGeo = new THREE.SphereGeometry(0.034, 12, 10);
    const rimGeo = new THREE.SphereGeometry(0.05, 10, 8);
    const rimMat = darkMat.clone();
    rimMat.color.set(0xe6e2db);
    const eyeZ = eyeSlice.half * eyeNz;
    const eye = new THREE.Mesh(eyeGeo, darkMat);
    eye.position.set(eyeSlice.x, eyeY, eyeZ);
    fish.add(eye);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(eyeSlice.x, eyeY, eyeZ * 0.9);
    fish.add(rim);
    const eyeL = new THREE.Mesh(eyeGeo, darkMat);
    eyeL.position.set(eyeSlice.x, eyeY, -eyeZ);
    fish.add(eyeL);
    const rimL = new THREE.Mesh(rimGeo, rimMat);
    rimL.position.set(eyeSlice.x, eyeY, -eyeZ * 0.9);
    fish.add(rimL);
    return fish;
  };
  const waterline = { sword: 0.16, white: 0.2 };
  const routes = [
    { kind: 'sword', cx: -16, cz: 2.4, rx: 4.2, rz: 5.2, speed: 0.42, phase: 0.3, scale: 2.15, dive: 0.7 },
    { kind: 'sword', cx: -32, cz: -2.2, rx: 4.4, rz: 4.6, speed: -0.52, phase: 1.6, scale: 1.7, dive: 0.55 },
    { kind: 'sword', cx: -22, cz: 6.5, rx: 3.2, rz: 3.6, speed: 0.64, phase: 2.4, scale: 1.45, dive: 0.8 },
    { kind: 'white', cx: -41, cz: 5.5, rx: 5.2, rz: 4.2, speed: 0.24, phase: 0.9, scale: 2.65, dive: 0 },
    { kind: 'white', cx: -28, cz: -7.5, rx: 5.6, rz: 3.4, speed: -0.2, phase: 2.2, scale: 3.05, dive: 0 },
  ];
  const sharks = routes.map((route) => {
    const pair = addPair(route.kind === 'white' ? makeWhite : makeSwordfish);
    pair.shark.scale.setScalar(route.scale);
    pair.shadow.scale.setScalar(route.scale);
    scene.add(pair.shark);
    scene.add(pair.shadow);
    route.reach = route.scale * (route.kind === 'white' ? 1.25 : 1.05);
    route.finTip = route.kind === 'white' ? 0.46 : 0.36;
    route.wasAbove = true;
    route.wake = 0;
    return pair;
  });
  const places = routes.map(() => ({ x: 0, z: 0 }));
  let time = 0;
  const update = (dt) => {
      time += dt;
      sharks.forEach((pair, index) => {
        const route = routes[index];
        const angle = time * route.speed + route.phase;
        const rawX = route.cx + Math.cos(angle) * route.rx;
        const rawZ = route.cz + Math.sin(angle) * route.rz;
        const [x, z] = clearOfRocks(rawX, rawZ, route.reach);
        places[index].x = x;
        places[index].z = z;
        places[index].angle = angle;
      });
      for (let pass = 0; pass < 3; pass += 1) {
        for (let i = 0; i < places.length; i += 1) {
          for (let j = i + 1; j < places.length; j += 1) {
            const dx = places[i].x - places[j].x;
            const dz = places[i].z - places[j].z;
            const dist = Math.hypot(dx, dz) || 0.001;
            const limit = (routes[i].reach + routes[j].reach) * 0.72;
            if (dist >= limit) continue;
            const push = Math.min((limit - dist) / 2, 2.2 * dt);
            const nx = dx / dist;
            const nz = dz / dist;
            places[i].x += nx * push;
            places[i].z += nz * push;
            places[j].x -= nx * push;
            places[j].z -= nz * push;
          }
        }
        places.forEach((place, index) => {
          const [x, z] = clearOfRocks(place.x, place.z, routes[index].reach * 0.45);
          const dx = x - place.x;
          const dz = z - place.z;
          const dist = Math.hypot(dx, dz);
          const maxNudge = 2.4 * dt;
          if (dist > maxNudge) {
            place.x += (dx / dist) * maxNudge;
            place.z += (dz / dist) * maxNudge;
          } else {
            place.x = x;
            place.z = z;
          }
        });
      }
      sharks.forEach((pair, index) => {
        const route = routes[index];
        const place = places[index];
        const maxStep = 4.2 * dt;
        if (route.px != null) {
          const dx = place.x - route.px;
          const dz = place.z - route.pz;
          const dist = Math.hypot(dx, dz);
          if (dist > maxStep) {
            place.x = route.px + (dx / dist) * maxStep;
            place.z = route.pz + (dz / dist) * maxStep;
          }
        }
        route.px = place.x;
        route.pz = place.z;
        const wave = Math.sin(time * 0.62 + route.phase);
        const bob = route.dive ? wave * route.dive - route.dive * 0.35 : Math.sin(time * 1.1 + route.phase) * 0.012;
        const y = WATER_Y - route.scale * waterline[route.kind] + bob;
        pair.shark.position.set(place.x, y, place.z);
        const angle = place.angle;
        const vx = -Math.sin(angle) * route.rx * Math.sign(route.speed);
        const vz = Math.cos(angle) * route.rz * Math.sign(route.speed);
        const yaw = Math.atan2(-vz, vx);
        const roll = Math.sin(time * 0.8 + route.phase) * 0.04;
        const pitch = route.dive ? -Math.cos(time * 0.62 + route.phase) * 0.28 : 0;
        pair.shark.rotation.set(pitch, yaw, roll);
        const wag = route.kind === 'sword' ? 5.4 : 4.2;
        pair.shark.userData.tail.rotation.y = Math.sin(time * wag + route.phase) * 0.38;
        pair.shadow.position.copy(pair.shark.position);
        pair.shadow.rotation.copy(pair.shark.rotation);
        pair.shadow.userData.tail.rotation.y = pair.shark.userData.tail.rotation.y;
        const tipY = y + Math.cos(pitch) * route.scale * route.finTip;
        const above = tipY - WATER_Y;
        if (route.seen && (above > 0) !== (route.wasAbove > 0)) splash(place.x, place.z, true);
        route.seen = true;
        route.wasAbove = above;
        if (above > 0 && above < route.scale * 0.45) {
          route.wake += dt;
          if (route.wake > 0.42) {
            route.wake = 0;
            splash(place.x - Math.cos(yaw) * route.reach * 0.35, place.z + Math.sin(yaw) * route.reach * 0.35, false);
          }
        }
      });
  };
  function stillAnimal(kind) {
    const fish = kind === 'white' ? makeWhite() : makeSwordfish();
    fish.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const material = child.material.clone();
      material.clippingPlanes = [];
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.side = THREE.DoubleSide;
      child.material = material;
      child.castShadow = true;
    });
    return fish;
  }
  return { update, sword: stillAnimal('sword'), white: stillAnimal('white') };
}

function createBite(scene, source) {
  const shark = source.clone(true);
  shark.visible = false;
  shark.scale.setScalar(2.6);
  scene.add(shark);
  const snoutBox = new THREE.Box3().setFromObject(shark.getObjectByName('mouth') || shark);
  const snout = snoutBox.max.x - shark.position.x;
  const dropGeo = new THREE.SphereGeometry(0.05, 6, 5);
  const chunkGeo = new THREE.SphereGeometry(0.14, 7, 6);
  const bright = new THREE.MeshBasicMaterial({ color: 0xc41622 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x6a0c12 });
  const drops = [];
  let bite = null;

  function addDrop(mesh, velocity, life) {
    scene.add(mesh);
    drops.push({
      mesh,
      life,
      age: 0,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
    });
  }

  function spray(x, y, z) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 22),
      new THREE.MeshBasicMaterial({
        color: 0x9a1218,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, WATER_Y + 0.05, z);
    scene.add(disc);
    drops.push({ mesh: disc, life: 2.2, age: 0, disc: true, vx: 0, vy: 0, vz: 0 });
    for (let i = 0; i < 36; i += 1) {
      const mesh = new THREE.Mesh(chunkGeo, i % 2 === 0 ? bright : dark);
      mesh.scale.setScalar(3.2 + Math.random() * 4.8);
      mesh.position.set(x, y, z);
      const dir = new THREE.Vector3(0.45 + Math.random() * 0.7, (Math.random() - 0.35) * 0.7, (Math.random() - 0.5) * 1.1);
      dir.normalize();
      addDrop(mesh, dir.multiplyScalar(1.4 + Math.random() * 3.2), 1.6);
    }
    for (let i = 0; i < 160; i += 1) {
      const mesh = new THREE.Mesh(i % 6 === 0 ? chunkGeo : dropGeo, i % 3 === 0 ? dark : bright);
      const scale = i % 6 === 0 ? 1.1 + Math.random() * 2.2 : 0.45 + Math.random() * 1.5;
      mesh.scale.setScalar(scale);
      mesh.position.set(x, y, z);
      const dir = new THREE.Vector3(Math.random() - 0.2, 0.2 + Math.random() * 0.85, Math.random() - 0.5);
      if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
      dir.normalize();
      addDrop(mesh, dir.multiplyScalar(2.4 + Math.random() * 8), 1.2 + Math.random() * 0.6);
    }
  }

  function clear() {
    bite = null;
    shark.visible = false;
    for (const drop of drops) {
      scene.remove(drop.mesh);
      if (drop.disc) {
        drop.mesh.geometry.dispose();
        drop.mesh.material.dispose();
      }
    }
    drops.length = 0;
  }

  function start(x, z) {
    if (bite && !bite.done) return;
    clear();
    bite = { t: 0, x, z, sprayed: false, struck: false, done: false };
    shark.visible = true;
    shark.position.set(x - 7.2, WATER_Y - 0.7, z);
    shark.rotation.set(0.2, 0, 0.18);
  }

  function update(dt) {
    if (!bite || bite.done) return;
    bite.t += dt;
    const strike = Math.min(1, bite.t / 0.34);
    const eased = strike * strike;
    const from = bite.x - 7.2;
    const to = bite.x - snout - 0.72;
    shark.position.x = from + (to - from) * eased;
    shark.position.y = WATER_Y - 0.55 + eased * 0.72;
    shark.position.z = bite.z + Math.sin(bite.t * 9) * 0.08;
    shark.rotation.z = 0.2 * (1 - eased);
    const tail = shark.getObjectByName('tail');
    if (tail) tail.rotation.y = Math.sin(bite.t * 16) * 0.5;
    if (strike >= 1) {
      const shake = Math.sin(bite.t * 34) * 0.12 * Math.max(0, 1 - (bite.t - 0.34) / 0.55);
      shark.rotation.y = shake;
      shark.position.x = to + Math.sin(bite.t * 26) * 0.05;
      if (!bite.sprayed) {
        bite.sprayed = true;
        bite.struck = true;
        spray(bite.x - 0.35, WATER_Y + 0.42, bite.z);
      }
    }
    for (let i = drops.length - 1; i >= 0; i -= 1) {
      const drop = drops[i];
      drop.age += dt;
      if (drop.disc) {
        const spread = 1 + drop.age * 3.4;
        drop.mesh.scale.setScalar(spread);
        drop.mesh.material.opacity = Math.max(0.15, 0.9 - drop.age * 0.28);
        continue;
      }
      drop.vy -= 9.2 * dt;
      drop.mesh.position.x += drop.vx * dt;
      drop.mesh.position.y += drop.vy * dt;
      drop.mesh.position.z += drop.vz * dt;
      if (drop.mesh.position.y < WATER_Y + 0.04) {
        drop.mesh.position.y = WATER_Y + 0.04;
        drop.vy *= -0.18;
        drop.vx *= 0.7;
        drop.vz *= 0.7;
      }
    }
    if (bite.t > 1.9) bite.done = true;
  }

  return {
    start,
    clear,
    update,
    active: () => !!(bite && !bite.done),
    done: () => !!(bite && bite.done),
    takeStrike() {
      if (!bite?.struck) return false;
      bite.struck = false;
      return true;
    },
    focus() {
      if (!bite) return null;
      const mouth = shark.position.clone();
      mouth.x += snout * 0.92;
      mouth.y += 0.2;
      return {
        eye: new THREE.Vector3(bite.x + 0.05, WATER_Y + 0.5, bite.z),
        look: mouth,
      };
    },
  };
}

function createAnimalCase(scene, targets, sword, white) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x5c4638, roughness: 0.86 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xe7eef0,
    roughness: 0.06,
    metalness: 0.04,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shelfTop = 0.08;

  function addCase(model, label, scale) {
    model.scale.setScalar(scale);
    model.rotation.y = 0.35;
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const length = bounds.max.x - bounds.min.x;
    const width = bounds.max.z - bounds.min.z;
    const height = bounds.max.y - bounds.min.y;
    const floorY = -bounds.min.y;
    const halfL = length / 2 + 0.1;
    const halfW = Math.max(width / 2 + 0.1, 0.18);
    const wallH = height + 0.12;
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(halfL * 2 + 0.08, shelfTop, halfW * 2 + 0.08), wood);
    base.position.set(0, shelfTop / 2, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    const pane = (w, h, d, px, py, pz) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
      mesh.position.set(px, py, pz);
      group.add(mesh);
    };
    const glassY = shelfTop + wallH / 2;
    const thick = 0.012;
    pane(thick, wallH, halfW * 2, -halfL, glassY, 0);
    pane(thick, wallH, halfW * 2, halfL, glassY, 0);
    pane(halfL * 2, wallH, thick, 0, glassY, -halfW);
    pane(halfL * 2, wallH, thick, 0, glassY, halfW);
    pane(halfL * 2, thick, halfW * 2, 0, shelfTop + wallH, 0);
    model.position.set(0, shelfTop + floorY, 0);
    group.add(model);
    group.userData = {
      type: 'prop',
      label: `${label} case`,
      role: 'loose',
      floorY: 0,
      stackH: shelfTop + wallH + thick,
      stackSpan: Math.max(halfL, halfW) * 1.2,
      hold: 'level',
    };
    scene.add(group);
    targets.push(group);
    return group;
  }

  const swordCase = addCase(sword, 'swordfish', 0.4);
  const whiteCase = addCase(white, 'great white', 0.34);
  swordCase.position.set(-0.55, 0, 0.2);
  whiteCase.position.set(-0.55, swordCase.userData.stackH, 0.2);
}

function plankTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8d6a45';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#9a754c' : '#7d5d3b';
      ctx.fillRect(0, i * 64, w, 62);
      ctx.strokeStyle = 'rgba(60, 36, 18, 0.35)';
      ctx.strokeRect(0.5, i * 64 + 0.5, w - 1, 61);
    }
  }).texture;
}

function skyTexture() {
  const { texture } = canvasTexture(2048, 1024, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#05070f');
    sky.addColorStop(0.42, '#10182c');
    sky.addColorStop(0.72, '#1a2742');
    sky.addColorStop(1, '#24344e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i += 1) {
      const bright = Math.random();
      const x = 1 + Math.floor(Math.random() * (w - 3));
      const y = 1 + Math.floor(Math.random() * h * 0.84);
      ctx.fillStyle = `rgba(246, 249, 255, ${bright > 0.92 ? 1 : 0.72 + bright * 0.28})`;
      ctx.fillRect(x, y, 1, 1);
      if (bright > 0.94) {
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x + 1, y, 1, 1);
        ctx.fillRect(x, y - 1, 1, 1);
        ctx.fillRect(x, y + 1, 1, 1);
      }
    }
  });
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function moonTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const glow = ctx.createRadialGradient(w * 0.42, h * 0.4, 8, w * 0.5, h * 0.5, w * 0.52);
    glow.addColorStop(0, '#fffaf0');
    glow.addColorStop(0.55, '#efe6d4');
    glow.addColorStop(1, '#d5cbb8');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i += 1) {
      const radius = 4 + Math.random() * 16;
      ctx.fillStyle = `rgba(86, 82, 74, ${0.12 + Math.random() * 0.22})`;
      ctx.beginPath();
      ctx.arc(28 + Math.random() * (w - 56), 28 + Math.random() * (h - 56), radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }).texture;
}

const waterWaveGlsl = `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float ringWave(vec4 s, vec2 xz) {
    float age = s.z;
    float amp = s.w;
    float live = step(0.02, amp) * step(age, 1.5);
    vec2 wind = normalize(vec2(-0.22, 0.98));
    vec2 center = s.xy + wind * age * 1.15;
    float dist = length(xz - center);
    float front = age * 1.7;
    float band = exp(-abs(dist - front) * 3.6);
    return sin(dist * 8.0 - age * 13.0) * band * amp * exp(-age * 1.35) * live;
  }
  float heightAt(vec2 xz) {
    vec2 wind = normalize(vec2(-0.22, 0.98));
    vec2 flow = xz - wind * uTime * 0.62;
    float region = noise(flow * 0.05);
    float gust = noise(flow * 0.1 + vec2(2.4, 6.1));
    float turn = (gust - 0.5) * 0.3;
    float cs = cos(turn);
    float sn = sin(turn);
    vec2 dir = normalize(vec2(wind.x * cs - wind.y * sn, wind.x * sn + wind.y * cs));
    float along = dot(xz, dir);
    float crossw = dot(xz, vec2(-dir.y, dir.x));
    float amp = mix(0.4, 1.1, smoothstep(0.15, 0.85, region));
    float freq = mix(1.35, 2.3, gust);
    float phase = region * 5.0;
    float primary = sin(along * freq - uTime * 1.75 + phase);
    float ripple = sin(along * freq * 1.7 + crossw * 0.2 - uTime * 2.2 + phase);
    float sea = (primary * 0.7 + ripple * 0.4) * amp;
    float wake = ringWave(uRings[0], xz) + ringWave(uRings[1], xz) + ringWave(uRings[2], xz) + ringWave(uRings[3], xz);
    return sea * 0.11 + wake * 0.045;
  }
`;

function hash01(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function seaRockTexture() {
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6d6458';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i += 1) {
      const y = hash01(i * 3.1) * h;
      const shade = 78 + hash01(i * 1.7) * 50;
      ctx.fillStyle = `rgba(${shade}, ${shade - 6}, ${shade - 14}, 0.28)`;
      ctx.fillRect(0, y, w, 6 + hash01(i * 2.2) * 18);
    }
    for (let i = 0; i < 2200; i += 1) {
      const x = hash01(i * 1.3) * w;
      const y = hash01(i * 2.7) * h;
      const span = 2 + hash01(i * 4.1) * 16;
      const shade = 48 + hash01(i * 5.9) * 80;
      ctx.fillStyle = `rgba(${shade}, ${shade - 10}, ${shade - 18}, 0.38)`;
      ctx.beginPath();
      ctx.ellipse(x, y, span, span * (0.28 + hash01(i) * 0.7), hash01(i * 8) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(28, 24, 20, 0.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i += 1) {
      ctx.beginPath();
      let x = hash01(i * 2.2) * w;
      let y = hash01(i * 4.4) * h;
      ctx.moveTo(x, y);
      for (let step = 0; step < 6; step += 1) {
        x += (hash01(i * 9 + step) - 0.5) * 70;
        y += (hash01(i * 3 + step * 5) - 0.5) * 36;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }).texture;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.4, 1.2);
  return texture;
}

function seaBoulderGeometry(radius, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position;
  const color = new Float32Array(pos.count * 3);
  const stretch = 0.78 + hash01(seed) * 0.36;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const lump = Math.sin(nx * 3.1 + seed * 1.7) * Math.cos(nz * 2.5 + seed) * 0.14
      + Math.sin(nx * 6.2 + ny * 4.8 + seed * 2.4) * 0.06;
    const facet = 0.9 + Math.abs(Math.sin(nx * 2.1 + seed) * Math.cos(nz * 1.7 + ny + seed)) * 0.18;
    let sy = ny;
    if (sy < -0.06) sy = -0.06 + (sy + 0.06) * 0.4;
    sy *= 0.7;
    const px = nx * stretch * facet * (1 + lump) * radius;
    const py = sy * facet * (1 + lump) * radius;
    const pz = nz * (1.08 - stretch * 0.15) * facet * (1 + lump) * radius;
    pos.setXYZ(i, px, py, pz);
    const wet = 1 - THREE.MathUtils.smoothstep(py, -radius * 0.22, radius * 0.18);
    const crown = THREE.MathUtils.smoothstep(py, radius * 0.2, radius * 0.5);
    color[i * 3] = 1 - wet * 0.48 + crown * 0.06;
    color[i * 3 + 1] = 1 - wet * 0.34 + crown * 0.08;
    color[i * 3 + 2] = 1 - wet * 0.28;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.computeVertexNormals();
  return geo;
}

function addSeaOutcrop(scene, material, x, z, scale, seed) {
  const group = new THREE.Group();
  group.position.set(x, WATER_Y, z);
  const stones = [
    [1, 0.22, 0, 0, 0.4],
    [0.58, -0.02, 0.78, 0.22, 1.6],
    [0.46, -0.16, -0.62, -0.36, 2.8],
    [0.32, -0.2, 0.18, -0.82, 4.1],
    [0.26, 0.08, -0.28, 0.55, 5.5],
  ];
  stones.forEach(([k, yk, dx, dz, salt]) => {
    const radius = scale * k;
    const mesh = new THREE.Mesh(seaBoulderGeometry(radius, seed + salt), material);
    mesh.position.set(dx * scale, yk * scale, dz * scale);
    mesh.rotation.set(
      hash01(seed + salt) * 2.4,
      hash01(seed + salt + 3) * 6.2,
      hash01(seed + salt + 8) * 1.2,
    );
    group.add(mesh);
  });
  scene.add(group);
}

function hullSection(u) {
  const waist = Math.sin(u * Math.PI);
  const sternCastle = Math.exp(-((u - 0.07) ** 2) / 0.011);
  const foreCastle = Math.exp(-((u - 0.86) ** 2) / 0.007);
  const bowTaper = u > 0.94 ? (1 - u) / 0.06 : 1;
  const beam = (1.05 + waist * 0.85) * bowTaper * (u < 0.03 ? 0.98 : 1);
  return {
    x: (u - 0.46) * 14.6,
    beam: Math.max(0.45, beam),
    depth: (0.85 + waist * 0.45) * (0.72 + bowTaper * 0.28),
    sheer: 0.22 + waist * 0.06 + sternCastle * 2.25 + foreCastle * 0.95,
  };
}

function wreckHullGeometry() {
  const stations = 18;
  const around = 10;
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  for (let i = 0; i < stations; i += 1) {
    const u = i / (stations - 1);
    const section = hullSection(u);
    for (let j = 0; j <= around; j += 1) {
      const v = j / around;
      const ang = v * Math.PI;
      const y = section.sheer * (1 - Math.sin(ang)) - Math.sin(ang) * section.depth;
      positions.push(section.x, y, Math.cos(ang) * section.beam);
      uvs.push(u, v);
      const algae = Math.sin(ang);
      colors.push(0.35 - algae * 0.12, 0.38 - algae * 0.08, 0.36 - algae * 0.06);
    }
  }
  const row = around + 1;
  for (let i = 0; i < stations - 1; i += 1) {
    const u = i / (stations - 1);
    for (let j = 0; j < around; j += 1) {
      const v = j / around;
      if (u > 0.36 && u < 0.55 && v < 0.32) continue;
      const a = i * row + j;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createWreck(scene) {
  const wreck = new THREE.Group();
  const shadow = new THREE.MeshBasicMaterial({ color: 0x07141c, side: THREE.DoubleSide });
  const ribMat = new THREE.MeshBasicMaterial({ color: 0x0c1a22 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e5844, roughness: 0.96 });

  const hull = new THREE.Mesh(wreckHullGeometry(), shadow);
  wreck.add(hull);

  [0.34, 0.46, 0.56].forEach((u, index) => {
    const section = hullSection(u);
    const reach = section.depth * 0.9;
    [-1, 1].forEach((side) => {
      if (index === 1 && side > 0) return;
      const piece = new THREE.Mesh(new THREE.BoxGeometry(0.08, reach, 0.05), ribMat);
      piece.position.set(section.x, section.sheer - reach * 0.55, side * section.beam * 0.7);
      piece.rotation.x = side * 0.4;
      wreck.add(piece);
    });
  });

  const stern = hullSection(0.05);
  const transom = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.45, stern.beam * 1.9), shadow);
  transom.position.set(stern.x - 0.2, 0.95, 0);
  wreck.add(transom);
  [0.55, 1.2, 1.85].forEach((y) => {
    const gallery = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.07, stern.beam * 1.72), shadow);
    gallery.position.set(stern.x + 0.15, y, 0);
    wreck.add(gallery);
  });
  const quarter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.15, stern.beam * 1.55), shadow);
  quarter.position.set(stern.x + 0.7, 1.55, 0);
  wreck.add(quarter);

  const bow = hullSection(0.88);
  const forecastle = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.85, bow.beam * 1.15), shadow);
  forecastle.position.set(bow.x, 0.7, 0);
  wreck.add(forecastle);
  const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 2.6, 5), shadow);
  sprit.position.set(bow.x + 1.7, 0.35, 0);
  sprit.rotation.z = -0.55;
  wreck.add(sprit);

  const keel = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.16, 0.2), shadow);
  keel.position.set(0.1, -1.05, 0);
  wreck.add(keel);

  const waist = hullSection(0.48);
  const nestY = 3.72;
  const mastLen = 4.6;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, mastLen, 6), wood);
  mast.position.set(waist.x, nestY - mastLen / 2, 0);
  wreck.add(mast);
  const mizzen = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.1, 6), shadow);
  mizzen.position.set(stern.x + 0.85, 2.15, 0);
  mizzen.rotation.z = 0.18;
  wreck.add(mizzen);

  const nest = new THREE.Group();
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.78, 0.07, 8), wood);
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.035, 5, 12), wood);
  hoop.rotation.x = Math.PI / 2;
  hoop.position.y = 0.34;
  nest.add(platform, hoop);
  for (let i = 0; i < 6; i += 1) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.38, 4), wood);
    const a = (i / 6) * Math.PI * 2;
    post.position.set(Math.cos(a) * 0.7, 0.16, Math.sin(a) * 0.7);
    nest.add(post);
  }
  nest.position.set(waist.x, nestY, 0);
  wreck.add(nest);

  wreck.position.set(-45.5, WATER_Y - 3.55, 12.5);
  wreck.rotation.y = 1.15;
  wreck.rotation.z = 0.05;
  scene.add(wreck);

  const sand = new THREE.Mesh(
    sandPatch(14),
    new THREE.MeshBasicMaterial({ color: 0x061018 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-44.6, WATER_Y - 0.28, 12);
  scene.add(sand);
}

function sandPatch(radius) {
  const geo = new THREE.CircleGeometry(radius, 28);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const dist = Math.hypot(x, y);
    if (dist < radius * 0.2) continue;
    const n = 1 + Math.sin(x * 0.55 + y * 0.4) * 0.14 + Math.sin(x * 1.3 - y * 0.8) * 0.06;
    pos.setXY(i, x * n, y * n);
  }
  geo.computeVertexNormals();
  return geo;
}

function createSeaRocks(scene) {
  const map = seaRockTexture();
  const material = new THREE.MeshStandardMaterial({
    map,
    color: 0xc4b8a8,
    roughness: 0.96,
    flatShading: true,
    vertexColors: true,
  });
  [
    [-24, -9, 2.8, 1.2],
    [-36, 4, 3.15, 2.5],
    [-18, 14, 2.25, 3.4],
    [-44, -16, 2.85, 4.7],
    [-22.5, -4.2, 1.45, 6.1],
    [-29, 2.4, 1.25, 7.3],
  ].forEach(([x, z, scale, seed]) => addSeaOutcrop(scene, material, x, z, scale, seed));
}

function createCanoe(scene, targets, cave) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.74, side: THREE.DoubleSide });
  const trim = new THREE.MeshStandardMaterial({ color: 0x4e3422, roughness: 0.82 });
  const oarMat = new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.68 });
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.22, 0.16);
  shape.bezierCurveTo(-0.2, 0.02, -0.08, -0.01, 0, -0.015);
  shape.bezierCurveTo(0.08, -0.01, 0.2, 0.02, 0.22, 0.16);
  const hole = new THREE.Path();
  hole.moveTo(-0.16, 0.145);
  hole.bezierCurveTo(-0.14, 0.05, -0.05, 0.03, 0, 0.028);
  hole.bezierCurveTo(0.05, 0.03, 0.14, 0.05, 0.16, 0.145);
  shape.holes.push(hole);
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.78, bevelEnabled: false, curveSegments: 8 }),
    wood,
  );
  hull.geometry.translate(0, 0, -0.39);
  hull.userData = { type: 'boatHull' };
  group.add(hull);
  [-0.2, 0.2].forEach((side) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 0.72), trim);
    rail.position.set(side, 0.155, 0);
    group.add(rail);
  });
  const ends = [];
  [-1, 1].forEach((dir) => {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.28, 10), wood);
    cap.rotation.x = dir === -1 ? Math.PI / 2 : -Math.PI / 2;
    cap.scale.set(1.05, 1, 0.55);
    cap.position.set(0, 0.07, dir * 0.5);
    cap.userData = { type: 'boatEnd', end: dir === -1 ? 'bow' : 'stern' };
    group.add(cap);
    ends.push(cap);
  });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.14), trim);
  seat.position.set(0, 0.09, 0.02);
  seat.userData = { type: 'boatSeat' };
  group.add(seat);
  const oars = [];
  [-1, 1].forEach((side) => {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.045, 6), trim);
    pin.position.set(side * 0.2, 0.17, 0);
    group.add(pin);
    const oar = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.72, 6), oarMat);
    shaft.rotation.z = Math.PI / 2;
    oar.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.2), oarMat);
    blade.position.set(side * 0.4, 0, 0);
    oar.add(blade);
    oar.position.set(side * 0.2, 0.2, 0);
    oar.rotation.y = side * 0.65;
    oar.rotation.z = side * -0.18;
    oar.userData = { type: 'oar', side, restY: side * 0.65, restZ: side * -0.18 };
    group.add(oar);
    oars.push(oar);
  });
  group.position.set(cave.boatX, cave.floor + 0.02, cave.z);
  scene.add(group);
  targets.push(group);

  const state = { vx: 0, vz: 0, mode: 'beach', yaw: 0, stroke: 0 };
  const center = new THREE.Vector3();
  const seatPoint = new THREE.Vector3();
  const forward = new THREE.Vector3();

  function floating() {
    return state.mode === 'float';
  }

  function shove() {
    if (state.vx < -0.45) return null;
    const reaches = group.position.x - 1.05 < cave.wetX || state.mode === 'float';
    state.vx = -1.9;
    if (state.mode !== 'float') state.mode = 'glide';
    return reaches ? 'water' : 'again';
  }

  function stroke() {
    if (!floating()) return false;
    forward.set(0, 0, -1).applyQuaternion(group.quaternion);
    state.vx += forward.x * 1.3;
    state.vz += forward.z * 1.3;
    const speed = Math.hypot(state.vx, state.vz);
    if (speed > 1.7) {
      state.vx *= 1.7 / speed;
      state.vz *= 1.7 / speed;
    }
    state.stroke = 1;
    return true;
  }

  function update(dt) {
    group.position.x += state.vx * dt;
    group.position.z += state.vz * dt;
    state.vx *= Math.exp(-1.65 * dt);
    state.vz *= Math.exp(-1.65 * dt);
    group.position.x = THREE.MathUtils.clamp(group.position.x, -8, cave.boatX);
    group.position.z = THREE.MathUtils.clamp(group.position.z, cave.z - 1.4, cave.z + 1.4);
    if (group.position.x < cave.wetX) {
      state.mode = 'float';
      const bob = Math.sin(performance.now() * 0.0016) * 0.012;
      group.position.y = THREE.MathUtils.damp(group.position.y, WATER_Y - 0.01 + bob, 3.2, dt);
      group.rotation.y = THREE.MathUtils.damp(group.rotation.y, Math.PI / 2, 2.2, dt);
    }
    state.stroke = Math.max(0, state.stroke - dt * 1.5);
    const swing = Math.sin(state.stroke * Math.PI) * 0.45;
    oars.forEach((oar) => {
      oar.rotation.y = oar.userData.restY;
      oar.rotation.z = oar.userData.restZ;
      oar.rotation.x = swing;
    });
    center.copy(group.position);
    seat.getWorldPosition(seatPoint);
  }

  return { group, ends, oars, seat, hull, update, shove, stroke, floating, seatPoint, center };
}

function createCliff(scene, targets) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 20, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  scene.add(sky);
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 28, 20),
    new THREE.MeshBasicMaterial({ map: moonTexture(), fog: false }),
  );
  moon.position.set(-22, 9, 1);
  scene.add(moon);

  const stoneMap = rockTexture();
  stoneMap.wrapS = THREE.RepeatWrapping;
  stoneMap.wrapT = THREE.RepeatWrapping;
  stoneMap.repeat.set(1.6, 2.4);
  const rock = new THREE.MeshStandardMaterial({ map: stoneMap, color: 0xc4b8aa, roughness: 1 });
  const farRock = new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 1 });

  // The house sits on this mass. Its chasm face is the floor edge, so the drop
  // beside the room is open air down to the water.
  const drop = -WATER_Y + 1.6;
  const underW = 2.2;
  const faceX = CLIFF_X;
  const skin = 0.78;
  const innerX = faceX + skin;
  const yTop = 0;
  const yBot = -drop;
  const shaftZ0 = -2.45;
  const shaftZ1 = -1.4;
  const shaftTop = -0.42;
  const shaftBot = -5.9;
  const caveZ0 = -3.15;
  const caveZ1 = -0.7;
  const caveTop = -5.9;
  const caveBot = WATER_Y - 0.2;
  const caveDark = new THREE.MeshBasicMaterial({ color: 0x101418 });
  const slab = (z0, z1, y0, y1, mat = rock) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(skin, y1 - y0, z1 - z0), mat);
    mesh.position.set(faceX + skin / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const backW = underW - skin;
  const back = new THREE.Mesh(new THREE.BoxGeometry(backW, drop, 24), rock);
  back.position.set(innerX + backW / 2, -drop / 2, 0);
  back.receiveShadow = true;
  scene.add(back);
  slab(-12, caveZ0, yBot, yTop);
  slab(caveZ1, 12, yBot, yTop);
  slab(caveZ0, caveZ1, yBot, caveBot);
  slab(caveZ0, shaftZ0, caveTop, yTop);
  slab(shaftZ1, caveZ1, caveTop, yTop);
  slab(shaftZ0, shaftZ1, shaftTop, yTop);

  const shaftVoid = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, shaftTop - shaftBot, shaftZ1 - shaftZ0 - 0.08),
    caveDark,
  );
  shaftVoid.position.set(faceX + 0.52, (shaftTop + shaftBot) / 2, (shaftZ0 + shaftZ1) / 2);
  scene.add(shaftVoid);
  const caveVoid = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, caveTop - caveBot - 0.05, caveZ1 - caveZ0 - 0.2),
    caveDark,
  );
  caveVoid.position.set(-0.78, (caveTop + caveBot) / 2, (caveZ0 + caveZ1) / 2);
  scene.add(caveVoid);

  const caveMid = (caveZ0 + caveZ1) / 2;
  const beachTop = WATER_Y + 0.08;
  const beach = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.24, caveZ1 - caveZ0 - 0.28),
    rock,
  );
  beach.position.set(-1.4, beachTop - 0.12, caveMid);
  beach.receiveShadow = true;
  scene.add(beach);
  const shoal = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.16, 2.5),
    new THREE.MeshStandardMaterial({ color: 0x8a8176, roughness: 1 }),
  );
  shoal.position.set(-2.7, WATER_Y - 0.24, caveMid);
  scene.add(shoal);

  const rungW = shaftZ1 - shaftZ0 - 0.22;
  const rungX = faceX + 0.22;
  const ladder = new THREE.Group();
  ladder.position.set(rungX, 0, caveMid);
  const cutMat = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 1 });
  const pierTop = shaftTop - 0.08;
  const pierBot = WATER_Y + 0.9;
  const recess = new THREE.Mesh(new THREE.BoxGeometry(0.12, pierTop - pierBot, rungW * 0.72), cutMat);
  recess.position.set(0.05, (pierTop + pierBot) / 2, 0);
  ladder.add(recess);
  const rungs = [];
  const rungYs = [];
  for (let y = shaftTop - 0.42; y >= WATER_Y + 1.05; y -= 0.46) rungYs.push(y);
  rungYs.forEach((y) => {
    const course = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.24, rungW + 0.14), rock);
    course.position.set(-0.04, y + 0.3, 0);
    course.castShadow = true;
    course.receiveShadow = true;
    ladder.add(course);
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, rungW * 0.78), rock);
    rung.position.set(-0.2, y, 0);
    rung.castShadow = true;
    rung.receiveShadow = true;
    rung.userData = { type: 'rung', ladder, index: rungs.length };
    ladder.add(rung);
    rungs.push(y);
  });
  ladder.userData = {
    rungs,
    roofY: 0.4,
    shaft: { top: 0, base: beachTop },
    topSpot: { x: -1.42, y: 0, z: caveMid },
    baseSpot: { x: -1.38, y: beachTop, z: -1.05 },
  };
  scene.add(ladder);
  targets.push(ladder);
  const cave = {
    floor: beachTop,
    x0: -1.85,
    x1: -0.95,
    z0: caveZ0 + 0.12,
    z1: caveZ1 - 0.08,
    z: caveMid,
    standX: -1.38,
    standZ: -1.05,
    boatX: -1.46,
    wetX: -2.2,
  };
  const shaft = { x: rungX - 0.42, z: caveMid, floor: beachTop };
  const jamb = (z) => {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.1, shaftTop - shaftBot, 0.08), rock);
    edge.position.set(faceX + 0.05, (shaftTop + shaftBot) / 2, z);
    scene.add(edge);
  };
  jamb(shaftZ0);
  jamb(shaftZ1);
  const caveHalf = (caveZ1 - caveZ0) / 2;
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, caveZ1 - caveZ0 + 0.35), rock);
  brow.position.set(faceX + 0.06, caveTop + 0.1, caveMid);
  scene.add(brow);
  [-1, 1].forEach((side) => {
    const haunch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.22), rock);
    haunch.position.set(faceX + 0.05, caveTop - 0.22, caveMid + side * (caveHalf - 0.02));
    haunch.rotation.x = side * -0.55;
    scene.add(haunch);
  });

  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.08, 5.6),
    new THREE.MeshStandardMaterial({ color: 0x9a9186, roughness: 0.92 }),
  );
  lip.position.set(CLIFF_X - 0.04, 0.04, 0);
  lip.castShadow = true;
  lip.receiveShadow = true;
  scene.add(lip);

  const waterNear = CLIFF_X + 0.05;
  const waterFar = -56;
  const waterWidth = waterNear - waterFar;
  const waterDepth = 64;
  const waterGeo = new THREE.PlaneGeometry(waterWidth, waterDepth, 200, 148);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x07141a) },
        uShallow: { value: new THREE.Color(0x1c5966) },
        uGlint: { value: new THREE.Color(0xd7e6ea) },
        uRings: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform vec4 uRings[4];
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vHeight;
      ${waterWaveGlsl}
      void main() {
        vUv = uv;
        vec3 p = position;
        vec2 xz = (modelMatrix * vec4(p, 1.0)).xz;
        float h = heightAt(xz);
        vHeight = h;
        p.y += h;
        vec4 worldPos = modelMatrix * vec4(p, 1.0);
        vWorldPos = worldPos.xyz;
        vec4 mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec4 uRings[4];
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uGlint;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vHeight;
      ${waterWaveGlsl}
      void main() {
        vec2 xz = vWorldPos.xz;
        float e = 0.2;
        float h = heightAt(xz);
        float hx = heightAt(xz + vec2(e, 0.0));
        float hz = heightAt(xz + vec2(0.0, e));
        vec3 slope = vec3((h - hx) * 2.6, e, (h - hz) * 2.6);
        vec3 normal = normalize(slope);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 moon = normalize(vec3(-0.45, 0.72, 0.12));
        vec3 halfVec = normalize(moon + viewDir);
        float lit = clamp(dot(normal, moon) * 0.5 + 0.5, 0.0, 1.0);
        float spec = pow(clamp(dot(normal, halfVec), 0.0, 1.0), 70.0);
        float into = pow(clamp(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 0.55);
        float fresnel = pow(1.0 - clamp(dot(viewDir, normal), 0.0, 1.0), 3.0);
        float crest = smoothstep(-0.02, 0.08, vHeight);
        float far = smoothstep(0.92, 0.08, vUv.x);
        vec3 depthCol = mix(uShallow, uDeep, far * 0.82 + 0.12);
        vec3 surface = mix(uDeep, uShallow, 0.3 + crest * 0.12);
        surface *= mix(0.62, 1.18, lit);
        surface += uGlint * spec * (0.28 + crest * 0.35);
        surface = mix(surface, uGlint, fresnel * 0.1);
        vec3 color = mix(surface, depthCol, into);
        float shore = smoothstep(0.9, 0.995, vUv.x) * (0.35 + noise(xz * 0.8 + uTime * 0.4) * 0.65);
        color = mix(color, uGlint, shore * 0.08);
        float alpha = mix(0.9, 0.36, into);
        alpha = mix(alpha, alpha * 0.72, smoothstep(0.8, 0.99, vUv.x));
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.set((waterNear + waterFar) / 2, WATER_Y, 0);
  scene.add(water);

  const farWall = new THREE.Mesh(new THREE.BoxGeometry(7, 13, 72), farRock);
  farWall.position.set(waterFar - 3.5, WATER_Y + 2.4, 0);
  scene.add(farWall);

  createSeaRocks(scene);
  createWreck(scene);

  const mistMap = canvasTexture(128, 128, (ctx, w, h) => {
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    glow.addColorStop(0, 'rgba(232, 240, 242, 0.75)');
    glow.addColorStop(0.28, 'rgba(206, 220, 224, 0.28)');
    glow.addColorStop(0.62, 'rgba(186, 204, 208, 0.06)');
    glow.addColorStop(1, 'rgba(186, 204, 208, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }).texture;
  const ripples = [];

  function spray(px, pz, rise, spread, size, life) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mistMap,
      transparent: true,
      depthWrite: false,
      opacity: 0.22 + Math.random() * 0.15,
    }));
    const ang = Math.random() * Math.PI * 2;
    const speed = spread * Math.random();
    puff.position.set(px, WATER_Y + 0.05, pz);
    puff.scale.setScalar(size);
    scene.add(puff);
    ripples.push({
      mesh: puff,
      age: 0,
      life,
      x: px,
      y: WATER_Y + 0.04,
      z: pz,
      vx: Math.cos(ang) * speed,
      vz: Math.sin(ang) * speed,
      vy: rise * (0.45 + Math.random()),
      grow: size,
    });
  }

  const ringSlots = waterMat.uniforms.uRings.value;
  let ringCursor = 0;

  function splash(x, z, burst = true) {
    const px = THREE.MathUtils.clamp(x, waterFar + 3.2, waterNear - 3.2);
    const pz = THREE.MathUtils.clamp(z, -waterDepth / 2 + 3.2, waterDepth / 2 - 3.2);
    ringSlots[ringCursor].set(px, pz, 0, burst ? 1 : 0.55);
    ringCursor = (ringCursor + 1) % ringSlots.length;
    const count = burst ? 12 : 4;
    for (let i = 0; i < count; i += 1) {
      spray(
        px + (Math.random() - 0.5) * 0.4,
        pz + (Math.random() - 0.5) * 0.4,
        burst ? 1.8 : 0.4,
        burst ? 1.1 : 0.4,
        0.22 + Math.random() * (burst ? 0.4 : 0.18),
        0.55 + Math.random() * 0.45,
      );
    }
  }

  function update(dt) {
    waterMat.uniforms.uTime.value += dt;
    ringSlots.forEach((slot) => {
      if (slot.w > 0) slot.z += dt;
    });
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const ripple = ripples[i];
      ripple.age += dt;
      const k = ripple.age / ripple.life;
      if (k >= 1) {
        ripple.mesh.material.dispose();
        scene.remove(ripple.mesh);
        ripples.splice(i, 1);
        continue;
      }
      ripple.vy -= 4.2 * dt;
      ripple.x += ripple.vx * dt;
      ripple.y += ripple.vy * dt;
      ripple.z += ripple.vz * dt;
      if (ripple.y < WATER_Y + 0.03) ripple.y = WATER_Y + 0.03;
      ripple.mesh.position.set(ripple.x, ripple.y, ripple.z);
      ripple.mesh.scale.setScalar(ripple.grow * (1 + k * 1.8));
      ripple.mesh.material.opacity = 0.55 * (1.0 - k) * (1.0 - k);
    }
  }

  return { update, splash, cave, shaft };
}

function plateTexture() {
  const px = 32;
  return canvasTexture(GRID_X * px, GRID_Z * px, (ctx, w, h) => {
    ctx.fillStyle = '#d5dbe3';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b7c0cb';
    ctx.lineWidth = 2;
    for (let i = 0; i <= GRID_X; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * px, 0);
      ctx.lineTo(i * px, h);
      ctx.stroke();
    }
    for (let j = 0; j <= GRID_Z; j += 1) {
      ctx.beginPath();
      ctx.moveTo(0, j * px);
      ctx.lineTo(w, j * px);
      ctx.stroke();
    }
  }).texture;
}

function buttonTexture(label, fill, textColor) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = textColor;
    ctx.font = `700 ${label.length > 4 ? 46 : 64}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2 + 2);
  }).texture;
}

function addBox(parent, size, position, material, targets) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  if (targets) targets.push(mesh);
  return mesh;
}

function createRoomCard(scene) {
  const screen = canvasTexture(512, 256, () => {});
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.25),
    new THREE.MeshBasicMaterial({ map: screen.texture }),
  );
  mesh.position.set(-0.82, 1.18, 0.18);

  function setRoomCode(code, caption) {
    const { ctx, texture, canvas } = screen;
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9eb0be';
    ctx.font = '600 44px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption || 'ROOM', canvas.width / 2, 74);
    ctx.fillStyle = '#f7f4ee';
    ctx.font = '700 128px Segoe UI, sans-serif';
    ctx.fillText(code || '----', canvas.width / 2, 168);
    texture.needsUpdate = true;
  }

  setRoomCode('----', 'ROOM');
  return { mesh, setRoomCode };
}

function createLadder(scene, targets, x, z, roofY) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6d5342, roughness: 0.88 });
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const top = roofY + 0.28;
  const railH = top - 0.08;
  const railGeo = new THREE.BoxGeometry(0.05, railH, 0.045);
  [-0.18, 0.18].forEach((side) => {
    const rail = new THREE.Mesh(railGeo, wood);
    rail.position.set(0.04, 0.08 + railH / 2, side);
    rail.castShadow = true;
    group.add(rail);
  });
  const rungs = [];
  const rungGeo = new THREE.BoxGeometry(0.06, 0.035, 0.4);
  const padGeo = new THREE.BoxGeometry(0.08, 0.05, 0.42);
  const padMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  for (let y = 0.42; y <= top - 0.05; y += 0.32) {
    const rung = new THREE.Mesh(rungGeo, wood);
    rung.position.set(0.02, y, 0);
    rung.castShadow = true;
    rung.userData = { type: 'rung', ladder: group, index: rungs.length };
    group.add(rung);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(0, 0, 0);
    pad.userData = rung.userData;
    rung.add(pad);
    rungs.push(y);
  }
  group.userData = { rungs, roofY };
  scene.add(group);
  targets.push(group);
}

function createCrateYard(scene, targets, rockMap) {
  const map = rockMap.clone();
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2.8, 2.2);
  const rock = new THREE.MeshStandardMaterial({ map, color: 0xa09890, roughness: 1 });
  const yard = { y: 0, x0: CLIFF_X + 0.04, x1: 3.35, z0: 2.58, z1: 10.2 };
  const span = yard.x1 - yard.x0;
  const depth = yard.z1 - 2.72;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(span, 1.4, depth),
    rock,
  );
  slab.position.set(yard.x0 + span / 2, -0.7, 2.72 + depth / 2);
  slab.receiveShadow = true;
  scene.add(slab);
  const rim = new THREE.MeshStandardMaterial({ color: 0x7c756c, roughness: 1 });
  [[yard.x0 + 0.55, yard.z1 - 0.7, 0.48], [yard.x1 - 0.6, yard.z1 - 0.85, 0.4], [yard.x1 - 0.5, 3.35, 0.32]].forEach(([x, z, radius]) => {
    const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), rim);
    boulder.position.set(x, radius * 0.42, z);
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    scene.add(boulder);
  });

  const crateTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#6a4630';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7c5840';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(10, 16 + i * 58, w - 20, 36);
    ctx.strokeStyle = '#3a2618';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#4e3422';
    ctx.fillRect(w * 0.46, 0, 16, h);
  }).texture;
  const woods = [0x8a6244, 0x6e4c32, 0x7a5838].map((color) => new THREE.MeshStandardMaterial({
    map: crateTex,
    color,
    roughness: 0.84,
  }));
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x3e2918, roughness: 0.9 });
  const crates = [];

  function addCrate(x, z, w, h, d, layer) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), woods[crates.length % woods.length]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.1, h * 1.02, d * 1.02), bandMat);
    band.position.x = w * 0.18;
    mesh.add(band);
    const band2 = band.clone();
    band2.position.x = -w * 0.22;
    mesh.add(band2);
    mesh.position.set(x, h / 2 + layer * h, z);
    mesh.userData = {
      type: 'prop',
      label: 'crate',
      role: 'loose',
      hold: 'grip',
      floorY: h / 2,
      stackH: h,
      stackSpan: Math.min(w, d) * 0.78,
      hx: w / 2,
      hz: d / 2,
      hy: h / 2,
      choppable: true,
      gear: 'crate',
      hp: 2,
      dead: false,
    };
    scene.add(mesh);
    targets.push(mesh);
    crates.push(mesh);
  }

  function pile(x, z, cols, rows, layers, w, h, d) {
    for (let layer = 0; layer < layers; layer += 1) {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          if (layer > 0 && (col + row + layer) % 4 === 0) continue;
          addCrate(x + col * (w + 0.04), z + row * (d + 0.04), w, h, d, layer);
        }
      }
    }
  }

  pile(-0.85, 3.55, 3, 2, 2, 0.52, 0.46, 0.48);
  pile(1.35, 4.7, 3, 2, 2, 0.48, 0.42, 0.46);
  pile(-0.7, 6.15, 2, 3, 2, 0.5, 0.44, 0.46);
  pile(1.15, 7.55, 3, 2, 2, 0.46, 0.42, 0.5);
  pile(-0.4, 8.85, 2, 2, 1, 0.55, 0.4, 0.48);
  [[0.55, 3.15, 0.5, 0.42, 0.48], [1.85, 3.4, 0.62, 0.4, 0.46], [-1.15, 4.85, 0.44, 0.5, 0.44], [2.35, 6.4, 0.5, 0.38, 0.52]].forEach(([x, z, w, h, d]) => {
    addCrate(x, z, w, h, d, 0);
  });
  return { yard, crates };
}

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10182c);
  scene.fog = new THREE.Fog(0x10182c, 18, 62);

  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 160);
  camera.position.set(-0.05, 1.58, 1.22);

  const targets = [];

  const roomRight = 2.7;
  const roomZ = 2.7;
  const roomSpan = roomRight - CLIFF_X;
  const roomMidX = (roomRight + CLIFF_X) / 2;
  const rockMap = rockTexture();
  rockMap.wrapS = THREE.RepeatWrapping;
  rockMap.wrapT = THREE.RepeatWrapping;
  rockMap.repeat.set(2.4, 2.2);
  const wallMat = new THREE.MeshStandardMaterial({ map: rockMap, roughness: 1 });
  const floorMap = rockMap.clone();
  floorMap.repeat.set(3.1, 2.6);
  const addRock = (w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  addRock(roomSpan + 0.8, 2.7, 0.7, roomMidX, 1.35, -roomZ - 0.2);
  addRock(0.7, 3.1, roomZ * 2 + 0.6, roomRight + 0.28, 1.55, 0);
  addRock(1.1, 1.15, 0.8, 1.15, 0.58, -2.15);
  addRock(0.7, 0.85, 1.3, 2.15, 0.42, 1.55);
  const coverFrom = roomMidX;
  const coverTo = roomRight + 0.55;
  const ceilW = coverTo - coverFrom;
  const ceilX = (coverFrom + coverTo) / 2;
  addRock(ceilW, 0.62, roomZ * 2 + 1.15, ceilX, 2.95, 0);
  [[-1.4, 0.55, 0.85], [0.2, 0.7, 1.05], [1.7, 0.42, 0.75]].forEach(([z, hang, depth]) => {
    addRock(0.85, 0.38, depth, coverFrom + 0.15, 2.55 - hang * 0.15, z);
  });
  const roofTop = 2.95 + 0.31;
  const roofDepth = roomZ * 2 + 1.15;
  const roof = {
    y: roofTop,
    x: ceilX,
    z: 0,
    x0: coverFrom,
    x1: coverTo,
    z0: -roofDepth / 2,
    z1: roofDepth / 2,
    roomX1: roomRight,
    roomZ0: -roomZ,
    roomZ1: roomZ,
  };
  createLadder(scene, targets, coverFrom - 0.14, -0.65, roofTop);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(roomSpan, roomZ * 2),
    new THREE.MeshStandardMaterial({ map: floorMap, color: 0xc8bfb4, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(roomMidX, 0.001, 0);
  floor.receiveShadow = true;
  scene.add(floor);
  const boulderMat = new THREE.MeshStandardMaterial({ map: rockMap, color: 0x9a9186, roughness: 1 });
  [[1.35, -0.35, 0.34, 0.7], [0.15, 1.55, 0.22, 1.4], [2.05, -1.7, 0.28, 0.4]].forEach(([x, z, radius, spin]) => {
    const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), boulderMat);
    const floorY = radius * 0.42;
    boulder.position.set(x, floorY, z);
    boulder.rotation.set(spin, spin * 0.6, spin * 0.2);
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    boulder.userData = { type: 'prop', label: 'stone', role: 'loose', floorY };
    scene.add(boulder);
    targets.push(boulder);
  });
  const puddles = createPuddles(scene, floor, floorMap);
  const cliff = createCliff(scene, targets);
  const canoe = createCanoe(scene, targets, cliff.cave);

  const hemi = new THREE.HemisphereLight(0x8ea4cc, 0x2a2622, 0.26);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xd5e2ff, 1.15);
  key.position.set(-7, 9, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 2;
  key.shadow.camera.near = 0.4;
  key.shadow.camera.far = 8;
  key.shadow.camera.left = -2.2;
  key.shadow.camera.right = 2.2;
  key.shadow.camera.top = 2.2;
  key.shadow.camera.bottom = -2.2;
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.012;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(0, 0.6, -0.2);
  const fill = new THREE.DirectionalLight(0x8aa4c8, 0.34);
  fill.position.set(4.6, 2.4, 1.8);
  scene.add(fill);
  scene.add(fill.target);
  fill.target.position.set(0, 0.8, -0.2);
  const rim = new THREE.DirectionalLight(0xe4eef8, 0.4);
  rim.position.set(0.6, 4.2, -6.4);
  scene.add(rim);
  scene.add(rim.target);
  rim.target.position.set(0, 1.05, -0.2);

  const plateW = GRID_X * STUD;
  const plateD = GRID_Z * STUD;
  const buildRoot = new THREE.Group();
  buildRoot.position.set(0, TABLE_TOP, -0.55);
  const gridGroup = new THREE.Group();
  gridGroup.position.set(-plateW / 2, 0, -plateD / 2);
  buildRoot.add(gridGroup);

  const plateMap = plateTexture();
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(plateW, 0.02, plateD),
    new THREE.MeshStandardMaterial({ map: plateMap, color: 0xffffff, roughness: 0.86 }),
  );
  plate.position.set(plateW / 2, -0.01, plateD / 2);
  plate.receiveShadow = true;
  plate.userData = { type: 'plate' };
  gridGroup.add(plate);
  targets.push(plate);

  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.78 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x5c3b22, roughness: 0.8 });
  const table = new THREE.Group();
  const topW = plateW + 0.16;
  const topD = plateD + 0.16;
  const top = new THREE.Mesh(new THREE.BoxGeometry(topW, 0.045, topD), wood);
  top.position.set(0, TABLE_TOP - 0.034, -0.55);
  top.castShadow = true;
  top.receiveShadow = true;
  table.add(top);
  const legGeo = new THREE.BoxGeometry(0.06, 0.7, 0.06);
  const legs = [];
  for (let i = 0; i < 4; i += 1) {
    const leg = new THREE.Mesh(legGeo, woodDark);
    leg.castShadow = true;
    table.add(leg);
    legs.push(leg);
  }
  function layoutTable(scale) {
    const w = plateW * scale + 0.16;
    const d = plateD * scale + 0.16;
    top.scale.set(w / topW, 1, d / topD);
    const offsets = [
      [-(plateW * scale + 0.08) / 2, -(plateD * scale + 0.08) / 2],
      [(plateW * scale + 0.08) / 2, -(plateD * scale + 0.08) / 2],
      [-(plateW * scale + 0.08) / 2, (plateD * scale + 0.08) / 2],
      [(plateW * scale + 0.08) / 2, (plateD * scale + 0.08) / 2],
    ];
    legs.forEach((leg, index) => {
      leg.position.set(offsets[index][0], 0.35, -0.55 + offsets[index][1]);
    });
  }
  layoutTable(1);

  const machine = createMachine(targets);
  const challenge = createChallengeStand(targets);
  challenge.sign.position.set(-0.34, 0.9, WALL_Z + 0.01);
  challenge.sign.rotation.set(0, 0, 0);
  challenge.sign.scale.setScalar(1.22);
  challenge.newButton.position.set(0.22, 0.9, WALL_Z + 0.03);
  challenge.newButton.rotation.set(0, 0, 0);
  challenge.newButton.userData.restZ = WALL_Z + 0.03;
  challenge.newButton.userData.baseScale = 1.22;
  challenge.newButton.scale.setScalar(1.22);
  machine.pressables.push(challenge.newButton);
  const bin = createBin();
  const roomCard = createRoomCard(scene);
  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const kind = targets[i].userData?.type;
    if (kind === 'ui' || kind === 'plate') targets.splice(i, 1);
  }
  createFinds(scene, targets, rockMap);
  const sharks = createSharks(scene, cliff.splash);
  const bite = createBite(scene, sharks.white);
  createAnimalCase(scene, targets, sharks.sword, sharks.white);
  const gear = createGear(scene, camera, targets, roof);
  const { yard, crates } = createCrateYard(scene, targets, rockMap);

  return {
    scene,
    camera,
    buildRoot,
    gridGroup,
    plate,
    targets,
    machine,
    challenge,
    bin,
    tableTop: TABLE_TOP,
    layoutTable,
    setRoomCode: roomCard.setRoomCode,
    update(dt) {
      sharks.update(dt);
      bite.update(dt);
      cliff.update(dt);
      puddles.update(dt);
      canoe.update(dt);
      gear.update(dt);
    },
    gear,
    yard,
    crates,
    canoe,
    cave: cliff.cave,
    shaft: cliff.shaft,
    splash: cliff.splash,
    startBite: bite.start,
    clearBite: bite.clear,
    biteActive: bite.active,
    biteDone: bite.done,
    takeStrike: bite.takeStrike,
    biteFocus: bite.focus,
    roof,
  };
}

function createMachine(targets) {
  const mount = new THREE.Group();

  const openPose = { x: 0, y: 1.92, z: WALL_Z, tilt: 0, yaw: 0 };
  const closedPose = { x: 0, y: 3.5, z: WALL_Z, tilt: 0, yaw: 0 };
  const group = new THREE.Group();
  group.position.set(openPose.x, openPose.y, openPose.z);
  group.rotation.x = openPose.tilt;
  group.scale.set(1.22, 1.22, 1);
  mount.add(group);
  const pressables = [];
  function trackPress(mesh, restZ = 0.078) {
    mesh.position.z = restZ;
    mesh.userData.restZ = restZ;
    mesh.userData.press = 0;
    pressables.push(mesh);
    return mesh;
  }

  const sheen = canvasTexture(128, 256, (ctx, w, h) => {
    const fade = ctx.createLinearGradient(0, 0, w * 0.35, h);
    fade.addColorStop(0, '#f7fbff');
    fade.addColorStop(0.28, '#d5dee8');
    fade.addColorStop(0.46, '#f3f7fb');
    fade.addColorStop(0.7, '#c3ced8');
    fade.addColorStop(1, '#e6edf3');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
  }).texture;
  const caseMat = new THREE.MeshPhysicalMaterial({
    map: sheen,
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.82,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.15,
  });
  const trimMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7fafc,
    roughness: 0.1,
    metalness: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.2,
  });
  const panelW = 2.08;
  const panelH = 2.2;
  const panelBottom = -0.72;
  const panelMidY = panelBottom + panelH / 2;
  addBox(group, [panelW, panelH, 0.022], [0, panelMidY, 0], caseMat);
  addBox(group, [panelW + 0.04, 0.022, 0.03], [0, panelBottom + panelH - 0.02, 0], trimMat);

  const orderButton = new THREE.Mesh(
    new THREE.BoxGeometry(1.86, 0.52, 0.11),
    new THREE.MeshStandardMaterial({
      color: 0x1f7a45,
      roughness: 0.42,
      emissive: 0x1f7a45,
      emissiveIntensity: 0.2,
    }),
  );
  orderButton.position.set(0, 0.86, 0.02);
  orderButton.userData = { type: 'ui', action: 'order' };
  orderButton.castShadow = true;
  trackPress(orderButton, 0.095);
  group.add(orderButton);
  targets.push(orderButton);

  const screen = canvasTexture(768, 320, () => {});
  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.46),
    new THREE.MeshBasicMaterial({ map: screen.texture }),
  );
  screenMesh.position.set(0, 0, 0.057);
  orderButton.add(screenMesh);
  const previewRoot = new THREE.Group();
  orderButton.add(previewRoot);

  const colorButtons = COLORS.map((color, index) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.1),
      new THREE.MeshStandardMaterial({
        color: color.hex,
        roughness: 0.42,
        emissive: 0x111111,
        emissiveIntensity: 0.18,
      }),
    );
    const col = index % 6;
    const row = Math.floor(index / 6);
    const rowCount = row === 0 ? Math.min(6, COLORS.length) : COLORS.length - 6;
    const step = 0.31;
    const origin = -((rowCount - 1) * step) / 2;
    mesh.position.set(origin + col * step, row === 0 ? 0.4 : 0.16, 0.02);
    mesh.userData = { type: 'ui', action: 'color', value: color.id };
    mesh.castShadow = true;
    trackPress(mesh);
    group.add(mesh);
    targets.push(mesh);
    return mesh;
  });

  const shapeButtons = SHAPES.map((shape, index) => {
    const col = index % 5;
    const row = Math.floor(index / 5);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.09, 0.09),
      new THREE.MeshStandardMaterial({
        map: buttonTexture(shape.button || shape.name, '#243038', '#f4f7f8'),
        roughness: 0.5,
        emissive: 0x8fd0ff,
        emissiveIntensity: 0,
      }),
    );
    mesh.position.set(-0.6 + col * 0.3, -0.06 - row * 0.14, 0.016);
    mesh.userData = { type: 'ui', action: 'shape', value: shape.id };
    mesh.castShadow = true;
    trackPress(mesh);
    group.add(mesh);
    targets.push(mesh);
    return mesh;
  });

  const heightButtons = HEIGHTS.map((height, index) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.08, 0.09),
      new THREE.MeshStandardMaterial({
        map: buttonTexture(height.label, '#243038', '#f4f7f8'),
        roughness: 0.5,
        emissive: 0x8fd0ff,
        emissiveIntensity: 0,
      }),
    );
    mesh.position.set(-0.55 + index * 0.28, -0.38, 0.02);
    mesh.userData = { type: 'ui', action: 'height', value: height.id };
    mesh.castShadow = true;
    trackPress(mesh);
    group.add(mesh);
    targets.push(mesh);
    return mesh;
  });

  const flatButton = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.08, 0.09),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('FLAT', '#243038', '#f4f7f8'),
      roughness: 0.5,
      emissive: 0xf1c40f,
      emissiveIntensity: 0,
    }),
  );
  flatButton.position.set(0.42, -0.38, 0.02);
  flatButton.userData = { type: 'ui', action: 'top' };
  flatButton.castShadow = true;
  trackPress(flatButton);
  group.add(flatButton);
  targets.push(flatButton);

  const pegTrack = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.09, 0.016),
    new THREE.MeshStandardMaterial({ color: 0x1c242c, roughness: 0.55 }),
  );
  pegTrack.position.set(0, -0.56, 0.014);
  pegTrack.userData = { type: 'ui', action: 'peg' };
  group.add(pegTrack);
  targets.push(pegTrack);
  const pegKnob = new THREE.Mesh(
    new THREE.BoxGeometry(0.046, 0.055, 0.028),
    new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.35 }),
  );
  pegKnob.position.set(0, 0, 0.012);
  pegTrack.add(pegKnob);
  const pegLabel = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f4f7f8';
    ctx.font = '600 36px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PEG SIZE', w / 2, h / 2);
  }).texture;
  const pegTag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.04),
    new THREE.MeshBasicMaterial({ map: pegLabel, transparent: true }),
  );
  pegTag.position.set(0, 0, 0.02);
  pegTrack.add(pegTag);

  function setPegKnob(scale, min, max) {
    const t = Math.min(1, Math.max(0, (scale - min) / (max - min)));
    pegKnob.position.x = -0.42 + t * 0.84;
  }

  function paintScreen(label) {
    const { ctx, texture, canvas } = screen;
    ctx.fillStyle = '#1f7a45';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d7ecdf';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = label.length > 18 ? '600 30px Segoe UI, sans-serif' : '600 36px Segoe UI, sans-serif';
    ctx.fillText(label, canvas.width * 0.4, canvas.height * 0.36);
    ctx.fillStyle = '#f7fff8';
    ctx.font = '700 64px Segoe UI, sans-serif';
    ctx.fillText('Press to order', canvas.width * 0.4, canvas.height * 0.68);
    texture.needsUpdate = true;
  }

  function showPreview(selection) {
    while (previewRoot.children.length) previewRoot.remove(previewRoot.children[0]);
    const shape = shapeById(selection.shapeId);
    const color = colorById(selection.colorId);
    const height = heightById(selection.heightId);
    const brick = createBrick(shape, color, {
      units: height.units,
      flat: selection.flat,
      heightId: selection.heightId,
    });
    setBrickRaycast(brick, false);
    brick.userData.type = 'preview';
    brick.traverse((child) => {
      if (child.isMesh) child.castShadow = false;
    });
    const span = Math.max(shape.w, shape.d) * STUD;
    const fit = Math.min(2.2, 0.32 / span);
    brick.scale.set(fit, fit * 0.22, fit);
    brick.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
    ));
    brick.position.set(-0.55, 0, 0.058);
    previewRoot.add(brick);
  }

  const hideButton = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.09, 0.09),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('HIDE', '#3a4652', '#f4f7f8'),
      roughness: 0.5,
    }),
  );
  hideButton.position.set(0.84, 1.28, 0.02);
  hideButton.userData = { type: 'ui', action: 'screen' };
  trackPress(hideButton);
  group.add(hideButton);
  targets.push(hideButton);

  const tab = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.1, 0.05),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('PARTS', '#1f7a45', '#f4fff7'),
      roughness: 0.45,
      emissive: 0x1f7a45,
      emissiveIntensity: 0.2,
    }),
  );
  tab.position.set(0.58, 0.9, WALL_Z + 0.03);
  tab.userData = { type: 'ui', action: 'screen', restZ: WALL_Z + 0.03, press: 0, baseScale: 1.22 };
  tab.scale.setScalar(1.22);
  tab.visible = false;
  mount.add(tab);
  targets.push(tab);
  pressables.push(tab);

  let openAmount = 1;
  let openTarget = 1;

  function applyScreenPose() {
    group.position.set(
      closedPose.x + (openPose.x - closedPose.x) * openAmount,
      closedPose.y + (openPose.y - closedPose.y) * openAmount,
      closedPose.z + (openPose.z - closedPose.z) * openAmount,
    );
    group.rotation.x = closedPose.tilt + (openPose.tilt - closedPose.tilt) * openAmount;
    group.rotation.y = closedPose.yaw + (openPose.yaw - closedPose.yaw) * openAmount;
    group.visible = openAmount > 0.08;
    tab.visible = openAmount < 0.92;
  }

  function placeScreen() {
    openPose.x = 0;
    openPose.z = WALL_Z;
    openPose.tilt = 0;
    closedPose.x = 0;
    closedPose.z = WALL_Z;
    closedPose.tilt = 0;
    tab.position.set(0.58, 0.9, tab.userData.restZ);
    tab.rotation.set(0, 0, 0);
    applyScreenPose();
  }

  function toggleScreen() {
    openTarget = openTarget > 0.5 ? 0 : 1;
    return openTarget > 0.5;
  }

  function update(dt) {
    const step = Math.min(1, dt * 4);
    openAmount += (openTarget - openAmount) * step;
    if (Math.abs(openTarget - openAmount) < 0.001) openAmount = openTarget;
    applyScreenPose();
    for (const mesh of pressables) {
      let press = mesh.userData.press || 0;
      if (press > 0) mesh.userData.press = Math.max(0, press - dt * 3.4);
      mesh.position.z = mesh.userData.restZ - (mesh.userData.press || 0) * 0.046;
    }
  }

  applyScreenPose();

  function refreshSelection(selection) {
    for (const button of colorButtons) {
      const selected = button.userData.value === selection.colorId;
      button.material.emissive.copy(button.material.color);
      button.material.emissiveIntensity = selected ? 0.42 : 0.06;
      button.scale.setScalar(selected ? 1.1 : 1);
    }
    for (const button of shapeButtons) {
      button.material.emissiveIntensity = button.userData.value === selection.shapeId ? 0.22 : 0;
    }
    for (const button of heightButtons) {
      button.material.emissiveIntensity = button.userData.value === selection.heightId ? 0.28 : 0;
    }
    flatButton.material.emissiveIntensity = selection.flat ? 0.35 : 0;
  }

  placeScreen(1);

  return { group: mount, orderButton, pegTrack, colorButtons, shapeButtons, paintScreen, showPreview, refreshSelection, setPegKnob, toggleScreen, update, placeScreen, pressables };
}

export function createChallengeStand(targets) {
  const group = new THREE.Group();
  group.position.set(0, 0, -1.45);

  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.78 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x5c3b22, roughness: 0.8 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 0.78, 18), woodDark);
  post.position.y = 0.39;
  post.castShadow = true;
  group.add(post);

  const plateSize = 8 * STUD;
  const model = new THREE.Group();
  model.position.y = 0.82;
  group.add(model);

  const topMat = new THREE.MeshStandardMaterial({ color: 0xc5ced8, roughness: 0.82, emissive: 0x000000, emissiveIntensity: 0 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(plateSize, 0.02, plateSize), topMat);
  plate.position.y = -0.01;
  plate.receiveShadow = true;
  model.add(plate);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(plateSize + 0.08, 0.04, plateSize + 0.08), wood);
  deck.position.y = -0.04;
  deck.castShadow = true;
  deck.receiveShadow = true;
  model.add(deck);

  const bricks = new THREE.Group();
  bricks.position.set(-plateSize / 2, 0, -plateSize / 2);
  model.add(bricks);

  const newButton = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.1, 0.05),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('NEW', '#1f7a45', '#f4fff7'),
      roughness: 0.45,
      emissive: 0x1f7a45,
      emissiveIntensity: 0.15,
    }),
  );
  newButton.position.set(0.22, 0.9, 0);
  newButton.rotation.set(0, 0, 0);
  newButton.userData = { type: 'ui', action: 'challenge', restZ: 0, press: 0, baseScale: 1.22 };
  newButton.scale.setScalar(1.22);
  newButton.castShadow = true;
  group.add(newButton);
  targets.push(newButton);

  const sign = canvasTexture(512, 160, () => {});
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.14),
    new THREE.MeshBasicMaterial({ map: sign.texture }),
  );
  signMesh.position.set(-0.34, 0.9, 0);
  signMesh.rotation.set(0, 0, 0);
  signMesh.scale.setScalar(1.22);
  group.add(signMesh);

  const glow = new THREE.PointLight(0xd6ffe6, 0, 2.4);
  glow.position.set(0, 1.0, 0);
  group.add(glow);
  const sparkGeo = new THREE.SphereGeometry(0.014, 6, 6);
  const sparks = [];
  let glowTime = 0;

  let matched = false;
  let shown = 'ready';

  function paint(headline, detail) {
    const { ctx, texture, canvas } = sign;
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = matched ? '#8ee0ad' : '#8fd0ff';
    ctx.font = '700 58px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(headline, canvas.width / 2, 58);
    ctx.fillStyle = '#d5dde4';
    ctx.font = '500 32px Segoe UI, sans-serif';
    ctx.fillText(detail, canvas.width / 2, 112);
    texture.needsUpdate = true;
  }

  const verdictCopy = {
    ready: ['Match this', 'Any turn is fine'],
    match: ['You got it', 'Press NEW'],
    extra: ['Match this', 'Toss the extra bricks'],
    short: ['Match this', 'Still missing some'],
    different: ['Match this', 'Check colors and heights'],
  };

  function setVerdict(verdict) {
    if (verdict === shown) return;
    shown = verdict;
    matched = verdict === 'match';
    const [headline, detail] = verdictCopy[verdict] || verdictCopy.ready;
    topMat.emissive.setHex(matched ? 0x1f7a45 : 0x000000);
    topMat.emissiveIntensity = matched ? 0.45 : 0;
    paint(headline, detail);
  }

  function celebrate() {
    glowTime = 1.6;
    for (let i = 0; i < 22; i += 1) {
      const spark = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xffe08a : 0x8dffc0,
          transparent: true,
          opacity: 1,
        }),
      );
      spark.position.set((Math.random() - 0.5) * 0.28, 0.9 + Math.random() * 0.08, (Math.random() - 0.5) * 0.28);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.25 + Math.random() * 0.45;
      group.add(spark);
      sparks.push({
        mesh: spark,
        vx: Math.cos(angle) * speed,
        vy: 0.35 + Math.random() * 0.55,
        vz: Math.sin(angle) * speed,
        life: 0.9 + Math.random() * 0.4,
        age: 0,
      });
    }
  }

  function update(dt) {
    model.rotation.y += dt * 0.22;
    if (glowTime > 0) {
      glowTime = Math.max(0, glowTime - dt);
      glow.intensity = glowTime * 3.2;
    }
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.age += dt;
      spark.vy -= dt * 0.8;
      spark.mesh.position.x += spark.vx * dt;
      spark.mesh.position.y += spark.vy * dt;
      spark.mesh.position.z += spark.vz * dt;
      spark.mesh.material.opacity = Math.max(0, 1 - spark.age / spark.life);
      if (spark.age >= spark.life) {
        spark.mesh.material.dispose();
        group.remove(spark.mesh);
        sparks.splice(i, 1);
      }
    }
  }

  paint('Match this', 'Any turn is fine');

  return { group, model, bricks, newButton, sign: signMesh, setVerdict, celebrate, update };
}

function createBin() {
  const group = new THREE.Group();
  group.position.set(-0.92, 0, -0.42);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c333a, roughness: 0.72, metalness: 0.08 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.76, 16), mat);
  post.position.y = 0.38;
  post.castShadow = true;
  group.add(post);
  const wall = (w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const span = 0.34;
  const lip = 0.74;
  wall(span, 0.018, span, 0, lip, 0);
  wall(0.018, 0.16, span, -span / 2, lip + 0.08, 0);
  wall(0.018, 0.16, span, span / 2, lip + 0.08, 0);
  wall(span, 0.16, 0.018, 0, lip + 0.08, -span / 2);
  wall(span + 0.018, 0.16, 0.018, 0, lip + 0.08, span / 2);
  const label = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4f7f8';
    ctx.font = '700 72px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TOSS', w / 2, h / 2);
  }).texture;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09),
    new THREE.MeshBasicMaterial({ map: label }),
  );
  sign.position.set(0, lip + 0.2, span / 2 + 0.012);
  group.add(sign);
  const sideSign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09),
    new THREE.MeshBasicMaterial({ map: label }),
  );
  sideSign.position.set(span / 2 + 0.012, lip + 0.2, 0);
  sideSign.rotation.y = Math.PI / 2;
  group.add(sideSign);
  return group;
}

export function createPedestal(index, label) {
  const group = new THREE.Group();
  const slot = pedestalSlot(index);
  group.position.set(slot.x, 0, slot.z);

  const metal = new THREE.MeshStandardMaterial({ color: 0x8d959c, roughness: 0.35, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.3 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0xd7dde3, roughness: 0.4, metalness: 0.25, emissive: 0xfff4d2, emissiveIntensity: 0 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 24), dark);
  base.position.y = 0.03;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.62, 20), metal);
  column.position.y = 0.37;
  column.castShadow = true;
  group.add(column);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.028, 28), topMat);
  top.position.y = 0.694;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const labelTex = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4f7f8';
    ctx.font = label.length > 16 ? '600 20px Segoe UI, sans-serif' : '600 32px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2);
  }).texture;
  const tag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.04),
    new THREE.MeshBasicMaterial({ map: labelTex }),
  );
  tag.position.set(0, 0.52, 0.058);
  group.add(tag);

  const dismiss = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.08, 0.045),
    new THREE.MeshStandardMaterial({
      map: buttonTexture('X', '#b4332c', '#fff6f4'),
      color: 0xffffff,
      roughness: 0.42,
      emissive: 0xffb0a8,
      emissiveIntensity: 0.2,
    }),
  );
  dismiss.position.set(0, 0.42, 0.1);
  dismiss.castShadow = true;
  dismiss.userData = { type: 'ui', action: 'dismiss', restZ: 0.1, press: 0 };
  group.add(dismiss);

  return { group, top, dismiss };
}
