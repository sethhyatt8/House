import * as THREE from 'three';
import { createBrick, setBrickRaycast } from './bricks.js';
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

function createPuddles(scene) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x07141a) },
        uShallow: { value: new THREE.Color(0x1a4e58) },
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(p.x * 9.0 + uTime * 1.3) * 0.012 + sin(p.y * 8.0 - uTime) * 0.008;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      varying vec2 vUv;
      void main() {
        float rim = distance(vUv, vec2(0.5));
        float alpha = smoothstep(0.5, 0.28, rim);
        vec3 color = mix(uDeep, uShallow, smoothstep(0.35, 0.05, rim));
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  [[0.45, 0.2, 0.58, 0.36], [1.55, -1.05, 0.34, 0.46], [-0.25, 1.2, 0.26, 0.2], [1.85, 0.8, 0.2, 0.15]].forEach(([x, z, rx, rz]) => {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 24), material);
    puddle.rotation.x = -Math.PI / 2;
    puddle.scale.set(rx, rz, 1);
    puddle.position.set(x, 0.018, z);
    scene.add(puddle);
  });
  return {
    update(dt) {
      material.uniforms.uTime.value += dt;
    },
  };
}

function shellGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.01);
  shape.absarc(0, 0, 0.075, 0.25, Math.PI - 0.25, false);
  shape.lineTo(0, 0.01);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.016,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.005,
    bevelSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0.012, 0);
  return geometry;
}

function starfishGeometry() {
  const shape = new THREE.Shape();
  const arms = 5;
  for (let i = 0; i < arms * 2; i += 1) {
    const radius = i % 2 === 0 ? 0.09 : 0.032;
    const angle = (i / (arms * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.016,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0.01, 0);
  return geometry;
}

function createFinds(scene, targets) {
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d756c, roughness: 1 });
  const rockDark = new THREE.MeshStandardMaterial({ color: 0x5e584f, roughness: 1 });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xf0d2c0, roughness: 0.55 });
  const shellPink = new THREE.MeshStandardMaterial({ color: 0xe7b7a8, roughness: 0.5 });
  const starMat = new THREE.MeshStandardMaterial({ color: 0xd4652e, roughness: 0.72 });
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const shellGeo = shellGeometry();
  const starGeo = starfishGeometry();
  const pieces = [
    ['rock', rockGeo, rockMat, 0.55, 0.45, 0.08, 0.4],
    ['rock', rockGeo, rockDark, -0.85, -0.25, 0.06, 1.1],
    ['rock', rockGeo, rockMat, 1.75, 0.55, 0.1, 0.3],
    ['rock', rockGeo, rockDark, 0.15, -1.25, 0.07, 2.1],
    ['rock', rockGeo, rockMat, -0.35, 0.55, 0.055, 0.8],
    ['rock', rockGeo, rockDark, 1.05, 0.95, 0.075, 1.6],
    ['shell', shellGeo, shellMat, 0.9, -0.85, 1, 0.4],
    ['shell', shellGeo, shellPink, -1.05, 0.85, 1, 1.7],
    ['shell', shellGeo, shellMat, 1.95, -0.15, 1, 2.4],
    ['shell', shellGeo, shellPink, 0.35, 1.85, 1, 0.9],
    ['starfish', starGeo, starMat, -0.55, -1.15, 1, 0.2],
    ['starfish', starGeo, starMat, 1.4, 1.35, 1, 1.1],
    ['starfish', starGeo, starMat, 0.05, -0.05, 1, 2.2],
    ['starfish', starGeo, starMat, 2.05, 1.05, 1, 0.6],
  ];
  for (const [label, geometry, material, x, z, size, spin] of pieces) {
    const mesh = new THREE.Mesh(geometry, material);
    const floorY = label === 'rock' ? size * 0.55 : 0;
    mesh.scale.setScalar(size);
    mesh.position.set(x, floorY, z);
    mesh.rotation.y = spin;
    if (label === 'rock') mesh.rotation.x = spin * 0.4;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { type: 'prop', label, role: 'loose', floorY };
    scene.add(mesh);
    targets.push(mesh);
  }
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
  return canvasTexture(8, 512, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#4f97d2');
    sky.addColorStop(0.38, '#8ec4ea');
    sky.addColorStop(0.55, '#d7e7f3');
    sky.addColorStop(0.7, '#d5decc');
    sky.addColorStop(1, '#8b9878');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
  }).texture;
}

function createCliff(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 20, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  scene.add(sky);

  const rock = new THREE.MeshStandardMaterial({ color: 0x6e675f, roughness: 1 });
  const farRock = new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 1 });

  // The house sits on this mass. Its chasm face is the floor edge, so the drop
  // beside the room is open air down to the water.
  const drop = -WATER_Y + 1.6;
  const underW = 2.2;
  const under = new THREE.Mesh(new THREE.BoxGeometry(underW, drop, 24), rock);
  under.position.set(CLIFF_X + underW / 2, -drop / 2, 0);
  under.receiveShadow = true;
  scene.add(under);

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
  const waterGeo = new THREE.PlaneGeometry(waterWidth, waterDepth, 56, 40);
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
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec2 vUv;
      varying float vWave;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 0.22 + uTime * 0.42) * 0.05
                + sin(p.z * 0.16 - uTime * 0.28) * 0.04
                + sin(p.x * 0.09 + p.z * 0.13 + uTime * 0.62) * 0.025;
        p.y += w;
        vWave = w;
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
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uGlint;
      varying vec2 vUv;
      varying float vWave;
      varying vec3 vWorldPos;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - clamp(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 3.4);
        float crest = smoothstep(-0.015, 0.055, vWave);
        vec3 color = mix(uDeep, uShallow, fresnel * 0.32 + crest * 0.22);
        float along = sin(vUv.y * 54.0 + uTime * 0.9) * 0.5 + 0.5;
        float shore = smoothstep(0.975, 0.998, vUv.x) * (0.45 + 0.55 * along);
        color = mix(color, uGlint, shore * 0.16 + fresnel * 0.05);
        gl_FragColor = vec4(color, 0.97);
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

  const ridge = new THREE.MeshStandardMaterial({ color: 0x6a645c, roughness: 1 });
  [[-24, -9, 5.2], [-36, 4, 6.4], [-18, 14, 4.2], [-44, -16, 5.6]].forEach(([x, z, height]) => {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(height * 0.42, height, 6), ridge);
    peak.position.set(x, WATER_Y + height * 0.18, z);
    scene.add(peak);
  });

  const ringGeo = new THREE.RingGeometry(0.18, 0.32, 28);
  const ripples = [];

  function splash(x, z) {
    const px = Math.min(x, waterNear - 0.4);
    const pz = THREE.MathUtils.clamp(z, -waterDepth / 2 + 1, waterDepth / 2 - 1);
    for (let i = 0; i < 2; i += 1) {
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xc5d4d2,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(px, WATER_Y + 0.06, pz);
      ring.scale.setScalar(0.3);
      scene.add(ring);
      ripples.push({ mesh: ring, age: -i * 0.14, life: 1.15 });
    }
  }

  function update(dt) {
    waterMat.uniforms.uTime.value += dt;
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const ripple = ripples[i];
      ripple.age += dt;
      const k = ripple.age / ripple.life;
      if (k < 0) continue;
      if (k >= 1) {
        ripple.mesh.material.dispose();
        scene.remove(ripple.mesh);
        ripples.splice(i, 1);
        continue;
      }
      ripple.mesh.scale.setScalar(0.35 + k * 2.8);
      ripple.mesh.material.opacity = 0.55 * (1 - k);
    }
  }

  return { update, splash };
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

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc5e0f2);
  scene.fog = new THREE.Fog(0xc5e0f2, 22, 70);

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
  addRock(roomSpan + 0.5, 1.7, 0.55, roomMidX, 0.85, roomZ + 0.16);
  addRock(0.7, 3.1, roomZ * 2 + 0.6, roomRight + 0.28, 1.55, 0);
  addRock(1.1, 1.15, 0.8, 1.15, 0.58, -2.15);
  addRock(0.7, 0.85, 1.3, 2.15, 0.42, 1.55);

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
    const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), boulderMat);
    boulder.position.set(x, radius * 0.45, z);
    boulder.rotation.set(spin, spin * 0.6, spin * 0.2);
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    scene.add(boulder);
  });
  const puddles = createPuddles(scene);
  const cliff = createCliff(scene);

  const hemi = new THREE.HemisphereLight(0xfff7ee, 0x4a453f, 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfffaf3, 1.45);
  key.position.set(1.8, 3.4, 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.4;
  key.shadow.camera.far = 8;
  key.shadow.camera.left = -2.2;
  key.shadow.camera.right = 2.2;
  key.shadow.camera.top = 2.2;
  key.shadow.camera.bottom = -2.2;
  key.shadow.bias = -0.00035;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(0, 0.6, -0.2);
  const fill = new THREE.DirectionalLight(0xd5e4f5, 0.35);
  fill.position.set(-1.5, 1.6, 1.2);
  scene.add(fill);

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
  createFinds(scene, targets);

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
      cliff.update(dt);
      puddles.update(dt);
    },
    splash: cliff.splash,
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
