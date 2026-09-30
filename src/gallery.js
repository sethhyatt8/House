import * as THREE from 'three';

const PAINTS = ['#c4322a', '#e07a1f', '#e2c04a', '#2f8a45', '#2a5fbf', '#6a3d9a', '#1a1a1a', '#f7f4ee'];
const STORE = 'house-gallery-paint';

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function createGallery(scene, spec) {
  const floorY = spec.floorY;
  const mouthH = spec.mouthH;
  const depth = 4.48;
  const width = 5.4;
  const height = 2.85;
  const tunnelLen = 6.6;
  const roomX0 = spec.mouthX + tunnelLen;
  const roomX1 = roomX0 + depth;
  const roomZc = (spec.z0 + spec.z1) / 2;
  const roomZ0 = roomZc - width / 2;
  const roomZ1 = roomZc + width / 2;
  const ceilY = floorY + height;
  const dark = new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 });
  const walls = [];
  const buckets = [];
  let lit = false;
  let saveTimer = 0;
  const local = new THREE.Vector3();
  const firePoint = new THREE.Vector3();

  function addBox(x0, x1, y0, y1, z0, z1, material) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
      material,
    );
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  const shellY0 = floorY - 0.22;
  const shellY1 = ceilY + 0.32;
  const tunX0 = spec.mouthX - 0.05;
  const tunX1 = roomX0;
  addBox(tunX0, tunX1, shellY0, floorY, spec.z0, spec.z1, floorMat);
  addBox(tunX0, tunX1, floorY + mouthH, floorY + mouthH + 0.32, spec.z0, spec.z1, dark);
  addBox(tunX0, tunX1, shellY0, floorY + mouthH + 0.32, spec.z0 - 0.32, spec.z0, dark);
  addBox(tunX0, tunX1, shellY0, floorY + mouthH + 0.32, spec.z1, spec.z1 + 0.32, dark);

  addBox(roomX0, roomX1, shellY0, floorY, roomZ0, roomZ1, floorMat);
  addBox(roomX0 - 0.32, roomX1 + 0.32, ceilY, shellY1, roomZ0 - 0.32, roomZ1 + 0.32, dark);
  addBox(roomX0 - 0.32, roomX1 + 0.32, shellY0, shellY1, roomZ0 - 0.32, roomZ0, dark);
  addBox(roomX0 - 0.32, roomX1 + 0.32, shellY0, shellY1, roomZ1, roomZ1 + 0.32, dark);
  addBox(roomX1, roomX1 + 0.32, shellY0, shellY1, roomZ0, roomZ1, dark);
  addBox(roomX0 - 0.32, roomX0, shellY0, shellY1, roomZ0 - 0.32, spec.z0, dark);
  addBox(roomX0 - 0.32, roomX0, shellY0, shellY1, spec.z1, roomZ1 + 0.32, dark);
  addBox(roomX0 - 0.32, roomX0, floorY + mouthH, shellY1, spec.z0, spec.z1, dark);

  function paintWall(name, wallW, wallH, x, y, z, rotY) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(64, Math.round(wallW * 190));
    canvas.height = Math.max(64, Math.round(wallH * 190));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const material = new THREE.MeshBasicMaterial({ map: texture, fog: false });
    material.toneMapped = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wallW, wallH), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.visible = false;
    scene.add(mesh);
    const wall = { name, mesh, canvas, ctx, texture, width: wallW, height: wallH, last: null };
    walls.push(wall);
    return wall;
  }

  const midY = floorY + height / 2;
  const midX = (roomX0 + roomX1) / 2;
  const midZ = (roomZ0 + roomZ1) / 2;
  paintWall('south', depth, height, midX, midY, roomZ0 + 0.03, 0);
  paintWall('north', depth, height, midX, midY, roomZ1 - 0.03, Math.PI);
  paintWall('east', width, height, roomX1 - 0.03, midY, midZ, -Math.PI / 2);
  const jambH = height;
  const southJamb = spec.z0 - roomZ0;
  const northJamb = roomZ1 - spec.z1;
  paintWall('west-south', southJamb, jambH, roomX0 + 0.03, midY, (roomZ0 + spec.z0) / 2, Math.PI / 2);
  paintWall('west-north', northJamb, jambH, roomX0 + 0.03, midY, (spec.z1 + roomZ1) / 2, Math.PI / 2);
  const lintelH = height - mouthH;
  paintWall(
    'west-lintel',
    spec.z1 - spec.z0,
    lintelH,
    roomX0 + 0.03,
    floorY + mouthH + lintelH / 2,
    (spec.z0 + spec.z1) / 2,
    Math.PI / 2,
  );

  const fire = new THREE.Group();
  fire.position.set(midX, floorY, midZ);
  const logMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.92 });
  [0, 1.1, 2.2].forEach((yaw, index) => {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.62, 6), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = yaw;
    log.position.y = 0.07 + index * 0.045;
    fire.add(log);
  });
  const flames = new THREE.Group();
  flames.visible = false;
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c });
  flameMat.toneMapped = false;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 7), flameMat);
  flame.position.y = 0.34;
  flames.add(flame);
  const heart = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe1a8 }),
  );
  heart.material.toneMapped = false;
  heart.position.y = 0.24;
  flames.add(heart);
  fire.add(flames);
  const fireLight = new THREE.PointLight(0xff8a3a, 0, 6.5, 2);
  fireLight.position.y = 0.45;
  fire.add(fireLight);
  scene.add(fire);
  firePoint.set(midX, floorY + 0.34, midZ);

  const bucketMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.45, metalness: 0.55 });
  PAINTS.forEach((color, index) => {
    const bucket = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.15, 10), bucketMat);
    bucket.add(body);
    const coat = new THREE.Mesh(
      new THREE.CircleGeometry(0.07, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    coat.material.toneMapped = false;
    coat.rotation.x = -Math.PI / 2;
    coat.position.y = 0.076;
    bucket.add(coat);
    const span = PAINTS.length - 1;
    bucket.position.set(roomX0 + 0.7 + (index / span) * (depth - 1.3), floorY + 0.075, roomZ0 + 0.42);
    scene.add(bucket);
    buckets.push({
      x: bucket.position.x,
      y: floorY + 0.08,
      z: bucket.position.z,
      color,
    });
  });

  function light() {
    if (lit) return;
    lit = true;
    flames.visible = true;
    walls.forEach((wall) => {
      wall.mesh.visible = true;
    });
  }

  function nearFire(point) {
    if (!lit && point.distanceTo(firePoint) < 0.48) light();
  }

  function dip(point) {
    for (const bucket of buckets) {
      const dx = point.x - bucket.x;
      const dz = point.z - bucket.z;
      if (dx * dx + dz * dz < 0.014 && Math.abs(point.y - bucket.y) < 0.16) return bucket.color;
    }
    return null;
  }

  function stamp(wall, x, y, color) {
    const radius = Math.max(7, (0.022 / wall.width) * wall.canvas.width);
    const ink = wall.ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
    ink.addColorStop(0, rgba(color, 0.96));
    ink.addColorStop(0.72, rgba(color, 0.84));
    ink.addColorStop(1, rgba(color, 0));
    wall.ctx.fillStyle = ink;
    wall.ctx.beginPath();
    wall.ctx.arc(x, y, radius, 0, Math.PI * 2);
    wall.ctx.fill();
  }

  function paint(point, color) {
    if (!lit || !color) return;
    let marked = false;
    for (const wall of walls) {
      local.copy(point);
      wall.mesh.worldToLocal(local);
      const onFace = Math.abs(local.z) < 0.06
        && Math.abs(local.x) <= wall.width / 2
        && Math.abs(local.y) <= wall.height / 2;
      if (!onFace) {
        wall.last = null;
        continue;
      }
      const x = (local.x / wall.width + 0.5) * wall.canvas.width;
      const y = (0.5 - local.y / wall.height) * wall.canvas.height;
      const prev = wall.last;
      wall.last = { x, y };
      if (prev) {
        const span = Math.hypot(x - prev.x, y - prev.y);
        if (span < wall.canvas.width * 0.25) {
          const steps = Math.max(1, Math.ceil(span / 3));
          for (let i = 0; i <= steps; i += 1) {
            const t = i / steps;
            stamp(wall, prev.x + (x - prev.x) * t, prev.y + (y - prev.y) * t, color);
          }
        } else stamp(wall, x, y, color);
      } else stamp(wall, x, y, color);
      wall.texture.needsUpdate = true;
      marked = true;
    }
    if (marked) saveTimer = 0.8;
  }

  function save() {
    const data = {};
    walls.forEach((wall) => {
      data[wall.name] = wall.canvas.toDataURL('image/png');
    });
    try {
      localStorage.setItem(STORE, JSON.stringify(data));
    } catch {
      /* this headset may refuse a very large painting */
    }
  }

  function load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORE) || 'null');
    } catch {
      data = null;
    }
    if (!data) return;
    walls.forEach((wall) => {
      const url = data[wall.name];
      if (!url) return;
      const image = new Image();
      image.onload = () => {
        wall.ctx.clearRect(0, 0, wall.canvas.width, wall.canvas.height);
        wall.ctx.drawImage(image, 0, 0, wall.canvas.width, wall.canvas.height);
        wall.texture.needsUpdate = true;
      };
      image.src = url;
    });
  }

  load();
  window.addEventListener('pagehide', save);

  function update(dt) {
    if (!lit) return;
    const wobble = 0.84 + Math.sin(performance.now() * 0.013) * 0.1 + Math.sin(performance.now() * 0.037) * 0.06;
    fireLight.intensity = 18 * wobble;
    const flare = 0.9 + wobble * 0.15;
    flame.scale.set(flare, 0.86 + wobble * 0.2, flare);
    if (saveTimer > 0) {
      saveTimer -= dt;
      if (saveTimer <= 0) save();
    }
  }

  return {
    tunnel: { x0: spec.mouthX - 0.15, x1: roomX0 + 0.25, z0: spec.z0 + 0.08, z1: spec.z1 - 0.08 },
    room: { x0: roomX0 - 0.1, x1: roomX1 - 0.28, z0: roomZ0 + 0.28, z1: roomZ1 - 0.28 },
    brushAt: { x: roomX0 + 0.55, y: floorY + 0.02, z: roomZ0 + 0.85 },
    contains(x, z) {
      const tunnel = x >= spec.mouthX - 0.3 && x <= roomX0 + 0.4 && z >= spec.z0 - 0.2 && z <= spec.z1 + 0.2;
      const room = x >= roomX0 - 0.4 && x <= roomX1 + 0.4 && z >= roomZ0 - 0.4 && z <= roomZ1 + 0.4;
      return tunnel || room;
    },
    nearFire,
    dip,
    paint,
    update,
  };
}
