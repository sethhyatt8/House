// ?cans=old: the original 1d63970 can pyramid, kept verbatim (capsule bodies, 364 cans, hit_metal sound).
// Empty-can pyramid for the side room one floor under the range (lift stop y = -7.2, zone lift:2).
// Twelve layers of 6-inch cans in a triangular stack: 1 on top, then 3, 6, 10, ... 78 on the floor
// (364 cans). They sleep until a body runs into them, then topple as light hollow cans.
//
// Stand-in geometry until a tin-can model is available. Drop the mesh in as models/props/tin_can.glb,
// register it as id "tin_can", and swap the geometries from buildGeos() for instances of that model.
// Keep it upright on local +Y and scale it to CAN_H; the physics body stays this capsule.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CAN_H = 6 * 0.0254; // 0.1524 m
export const CAN_D = 2.6 * 0.0254; // a normal can diameter, so the cone stays narrow and tall
export const CAN_LAYERS = 12;

const R = CAN_D * 0.5;
const HALF = (CAN_H - CAN_D) * 0.5; // capsule inner segment, so the rounded ends land on CAN_H
const GRAV = 9.4;
const SLOP = 0.0016;
const REST = 0.32;
const STEP = 1 / 90;

function triIndex(edge, row, col) {
  return row * edge - (row * (row - 1)) / 2 + col;
}

function buildSpots(room) {
  const rowStep = CAN_D * Math.sqrt(3) / 2;
  const edge0 = CAN_LAYERS;
  const bottom = [];
  for (let row = 0; row < edge0; row += 1) {
    for (let col = 0; col < edge0 - row; col += 1) {
      bottom.push({ x: (col + row * 0.5) * CAN_D, z: row * rowStep });
    }
  }
  const levels = [bottom];
  for (let level = 1; level < CAN_LAYERS; level += 1) {
    const below = levels[level - 1];
    const edge = CAN_LAYERS - level + 1;
    const above = [];
    for (let row = 0; row < edge - 1; row += 1) {
      for (let col = 0; col < edge - 1 - row; col += 1) {
        const a = below[triIndex(edge, row, col)];
        const b = below[triIndex(edge, row, col + 1)];
        const c = below[triIndex(edge, row + 1, col)];
        above.push({ x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3 });
      }
    }
    levels.push(above);
  }
  let sx = 0;
  let sz = 0;
  for (const p of bottom) { sx += p.x; sz += p.z; }
  sx /= bottom.length;
  sz /= bottom.length;
  // In front of the vestibule door (the opening is the west part of the near wall), a step back
  // from that wall so there is a run-up.
  const ox = room.x0 + 0.6;
  const oz = (room.z0 + room.z1) / 2 + 0.12;
  const spots = [];
  for (let level = 0; level < levels.length; level += 1) {
    const y = room.y + CAN_H * (level + 0.5);
    for (const p of levels[level]) spots.push({ x: ox + (p.x - sx), y, z: oz + (p.z - sz) });
  }
  return spots;
}

function labelTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const wash = g.createLinearGradient(0, 0, 128, 0);
  wash.addColorStop(0, '#8e979e');
  wash.addColorStop(0.28, '#f2f5f6');
  wash.addColorStop(0.62, '#c5ced3');
  wash.addColorStop(1, '#7f888f');
  g.fillStyle = wash;
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#b4332e';
  g.fillRect(0, 24, 128, 14);
  g.fillStyle = '#d7dfe3';
  g.fillRect(0, 22, 128, 2);
  g.fillRect(0, 38, 128, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildGeos() {
  const body = new THREE.CylinderGeometry(R * 0.985, R * 0.985, CAN_H - 0.008, 12, 1);
  const top = new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.007, 12);
  top.translate(0, CAN_H / 2 - 0.004, 0);
  const bot = new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.007, 12);
  bot.translate(0, -CAN_H / 2 + 0.004, 0);
  const rim = mergeGeometries([top, bot], false);
  const cap = new THREE.CircleGeometry(R * 0.9, 10);
  cap.rotateX(-Math.PI / 2);
  cap.translate(0, CAN_H / 2 - 0.0035, 0);
  const inner = new THREE.CylinderGeometry(R * 0.84, R * 0.84, CAN_H * 0.7, 10, 1, true);
  inner.translate(0, CAN_H * 0.06, 0);
  const mouth = mergeGeometries([cap, inner], false);
  return { body, rim, mouth };
}

function makeMesh(geo, mat, count, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

export function createCans(scene, { room, vestibule = null } = {}) {
  const spots = buildSpots(room);
  const n = spots.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  const qx = new Float64Array(n);
  const qy = new Float64Array(n);
  const qz = new Float64Array(n);
  const qw = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const vz = new Float64Array(n);
  const wx = new Float64Array(n);
  const wy = new Float64Array(n);
  const wz = new Float64Array(n);
  const awake = new Uint8Array(n);
  const held = new Uint8Array(n);
  const dirty = new Uint8Array(n);
  const restT = new Float32Array(n);
  const sndAt = new Float32Array(n);
  const homeX = new Float64Array(n);
  const homeY = new Float64Array(n);
  const homeZ = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    px[i] = homeX[i] = spots[i].x;
    py[i] = homeY[i] = spots[i].y;
    pz[i] = homeZ[i] = spots[i].z;
    const yaw = ((i * 47) % 360) * Math.PI / 180;
    qy[i] = Math.sin(yaw / 2);
    qw[i] = Math.cos(yaw / 2);
  }

  const map = labelTexture();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    metalness: 0.48,
    roughness: 0.38,
    emissive: 0x2c3136,
    emissiveIntensity: 0.32,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd5dbe0,
    metalness: 0.62,
    roughness: 0.3,
    emissive: 0x3a4148,
    emissiveIntensity: 0.28,
  });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.92, metalness: 0.04 });
  const geos = buildGeos();
  const body = makeMesh(geos.body, bodyMat, n, 'canBody');
  const rim = makeMesh(geos.rim, rimMat, n, 'canRim');
  const mouth = makeMesh(geos.mouth, mouthMat, n, 'canMouth');
  const tint = new THREE.Color();
  for (let i = 0; i < n; i += 1) {
    const t = 0.9 + ((i * 13) % 10) / 100;
    tint.setRGB(t, t, t * 0.98);
    body.setColorAt(i, tint);
    rim.setColorAt(i, tint);
  }
  const group = new THREE.Group();
  group.name = 'canPyramid';
  group.userData.zone = 'lift:2';
  group.add(body, rim, mouth);
  scene.add(group);

  const floorY = room.y;
  const ceilY = room.y + 2.02;
  const doorX0 = room.x0 + 0.2;
  const doorX1 = room.x0 + 1.0;
  const posts = [];
  for (let x = room.x0 + 0.45; x < room.x1 - 0.2; x += 0.8) {
    posts.push({ x, z: room.z0 + 0.07, r: 0.07 });
    posts.push({ x, z: room.z1 - 0.07, r: 0.07 });
  }
  const anchorX = px[n - 1];
  const anchorZ = pz[n - 1];

  const CELL = CAN_D * 1.35;
  const GW = 48;
  const GD = 48;
  const ORIGIN_X = room.x0 - 0.8;
  const ORIGIN_Z = (vestibule?.z0 ?? room.z0) - 0.6;
  const gridHead = new Int32Array(GW * GD);
  const gridNext = new Int32Array(n);
  const ea = new Float64Array(9);
  const eb = new Float64Array(9);
  const scratch = { dist: 0, nx: 0, ny: 0, nz: 0, pax: 0, pay: 0, paz: 0, pbx: 0, pby: 0, pbz: 0 };
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _one = new THREE.Vector3(1, 1, 1);
  const pool = Array.from({ length: 5 }, () => ({ x: 0, y: 0, z: 0, speed: 0 }));
  const impacts = [];
  let bodyRef = null;
  let anyAwake = false;
  let acc = 0;
  let time = 0;
  let dirtyAll = true;
  const Iinv = 1 / (R * R * 0.5 + (CAN_H * CAN_H) / 12);

  function wake(i, hard) {
    if (!awake[i]) {
      awake[i] = 1;
      anyAwake = true;
      restT[i] = 0;
      if (!hard) held[i] = 1;
    }
    if (hard) held[i] = 0;
    dirty[i] = 1;
  }

  function note(i, speed) {
    if (speed < 0.7 || time - sndAt[i] < 0.08) return;
    sndAt[i] = time;
    let slot = impacts.length;
    if (slot >= pool.length) {
      slot = 0;
      for (let k = 1; k < impacts.length; k += 1) if (impacts[k].speed < impacts[slot].speed) slot = k;
      if (speed <= impacts[slot].speed) return;
    } else impacts.push(pool[slot]);
    const hit = impacts[slot];
    hit.x = px[i];
    hit.y = py[i];
    hit.z = pz[i];
    hit.speed = speed;
  }

  function ends(i, out) {
    const x = qx[i];
    const y = qy[i];
    const z = qz[i];
    const w = qw[i];
    const ax = 2 * (x * y - w * z);
    const ay = 1 - 2 * (x * x + z * z);
    const az = 2 * (y * z + w * x);
    out[6] = ax;
    out[7] = ay;
    out[8] = az;
    out[0] = px[i] - ax * HALF;
    out[1] = py[i] - ay * HALF;
    out[2] = pz[i] - az * HALF;
    out[3] = px[i] + ax * HALF;
    out[4] = py[i] + ay * HALF;
    out[5] = pz[i] + az * HALF;
  }

  function spinQuat(i, dt) {
    const x = qx[i];
    const y = qy[i];
    const z = qz[i];
    const w = qw[i];
    const hx = wx[i] * dt * 0.5;
    const hy = wy[i] * dt * 0.5;
    const hz = wz[i] * dt * 0.5;
    const nx = hx * w + hy * z - hz * y;
    const ny = -hx * z + hy * w + hz * x;
    const nz = hx * y - hy * x + hz * w;
    const nw = -hx * x - hy * y - hz * z;
    let X = x + nx;
    let Y = y + ny;
    let Z = z + nz;
    let W = w + nw;
    const inv = 1 / (Math.hypot(X, Y, Z, W) || 1);
    qx[i] = X * inv;
    qy[i] = Y * inv;
    qz[i] = Z * inv;
    qw[i] = W * inv;
  }

  // Closest points on segments AB and CD. Normal points from the second segment toward the first.
  function segSeg(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const cdx = dx - cx;
    const cdy = dy - cy;
    const cdz = dz - cz;
    const rx = ax - cx;
    const ry = ay - cy;
    const rz = az - cz;
    const A = abx * abx + aby * aby + abz * abz;
    const E = cdx * cdx + cdy * cdy + cdz * cdz;
    const F = cdx * rx + cdy * ry + cdz * rz;
    const C = abx * rx + aby * ry + abz * rz;
    const B = abx * cdx + aby * cdy + abz * cdz;
    const denom = A * E - B * B;
    let s = denom > 1e-8 ? Math.min(1, Math.max(0, (B * F - C * E) / denom)) : 0;
    let t = E > 1e-8 ? (B * s + F) / E : 0;
    if (t < 0) {
      t = 0;
      s = A > 1e-8 ? Math.min(1, Math.max(0, -C / A)) : 0;
    } else if (t > 1) {
      t = 1;
      s = A > 1e-8 ? Math.min(1, Math.max(0, (B - C) / A)) : 0;
    }
    const pax = ax + abx * s;
    const pay = ay + aby * s;
    const paz = az + abz * s;
    const pbx = cx + cdx * t;
    const pby = cy + cdy * t;
    const pbz = cz + cdz * t;
    const nx = pax - pbx;
    const ny = pay - pby;
    const nz = paz - pbz;
    scratch.pax = pax;
    scratch.pay = pay;
    scratch.paz = paz;
    scratch.pbx = pbx;
    scratch.pby = pby;
    scratch.pbz = pbz;
    scratch.nx = nx;
    scratch.ny = ny;
    scratch.nz = nz;
    scratch.dist = Math.hypot(nx, ny, nz);
  }

  function cellOf(x, z) {
    const ix = ((x - ORIGIN_X) / CELL) | 0;
    const iz = ((z - ORIGIN_Z) / CELL) | 0;
    if (ix < 0 || iz < 0 || ix >= GW || iz >= GD) return -1;
    return ix + iz * GW;
  }

  function rebuildGrid() {
    gridHead.fill(-1);
    for (let i = 0; i < n; i += 1) {
      const c = cellOf(px[i], pz[i]);
      if (c < 0) { gridNext[i] = -1; continue; }
      gridNext[i] = gridHead[c];
      gridHead[c] = i;
    }
  }

  function forNear(i, radCells, fn) {
    const c = cellOf(px[i], pz[i]);
    if (c < 0) return;
    const ix = c % GW;
    const iz = (c / GW) | 0;
    for (let dz = -radCells; dz <= radCells; dz += 1) {
      for (let dx = -radCells; dx <= radCells; dx += 1) {
        const x = ix + dx;
        const z = iz + dz;
        if (x < 0 || z < 0 || x >= GW || z >= GD) continue;
        let j = gridHead[x + z * GW];
        while (j >= 0) {
          if (j !== i) fn(j);
          j = gridNext[j];
        }
      }
    }
  }

  function supported(i) {
    ends(i, ea);
    const low = Math.min(ea[1], ea[4]) - R;
    if (low <= floorY + 0.016) return true;
    let yes = false;
    forNear(i, 1, (j) => {
      if (yes) return;
      ends(j, eb);
      const top = Math.max(eb[1], eb[4]) + R;
      if (top < low - 0.02 || top > low + 0.014) return;
      const dx = px[i] - px[j];
      const dz = pz[i] - pz[j];
      if (dx * dx + dz * dz < (CAN_D * 0.8) * (CAN_D * 0.8)) yes = true;
    });
    return yes;
  }

  function wakeNear(i, rad) {
    const rad2 = rad * rad;
    forNear(i, 2, (j) => {
      const dx = px[i] - px[j];
      const dy = py[i] - py[j];
      const dz = pz[i] - pz[j];
      if (dx * dx + dy * dy + dz * dz < rad2) wake(j, false);
    });
  }

  function playerHit(b) {
    const y0 = Math.min(b.y0, b.y1);
    const y1 = Math.max(b.y0, b.y1);
    const pr = b.r;
    const reach = pr + CAN_H;
    for (let i = 0; i < n; i += 1) {
      const dx = px[i] - b.x;
      const dz = pz[i] - b.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (py[i] + CAN_H * 0.5 < y0 || py[i] - CAN_H * 0.5 > y1) continue;
      ends(i, ea);
      segSeg(b.x, y0, b.z, b.x, y1, b.z, ea[0], ea[1], ea[2], ea[3], ea[4], ea[5]);
      const overlap = pr + R - scratch.dist;
      if (overlap <= 0) continue;
      let hx;
      let hz;
      if (scratch.dist > 1e-5) {
        hx = -scratch.nx;
        hz = -scratch.nz;
      } else {
        hx = dx;
        hz = dz;
      }
      const hlen = Math.hypot(hx, hz);
      if (hlen < 1e-5) { hx = 1; hz = 0; } else { hx /= hlen; hz /= hlen; }
      const away = vx[i] * hx + vz[i] * hz;
      if (away > 1.4 && overlap < 0.02) continue;
      wake(i, true);
      px[i] += hx * overlap;
      pz[i] += hz * overlap;
      const approach = Math.max(0, (b.vx - vx[i]) * hx + (b.vz - vz[i]) * hz);
      const kick = approach < 0.18 ? 0.5 : Math.min(2.6, approach * 1.2);
      const tip = approach < 0.18 ? 2.4 : Math.min(8, 2.6 + approach * 2.2);
      vx[i] += hx * kick;
      vz[i] += hz * kick;
      vy[i] += approach < 0.18 ? 0.15 : Math.min(0.85, approach * 0.22);
      wx[i] += -hz * tip;
      wz[i] += hx * tip;
      note(i, Math.max(approach, 0.9));
      wakeNear(i, 0.22);
    }
  }

  function integrate(i, dt) {
    const sp2 = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
    if (held[i] && sp2 < 0.008 && supported(i)) return;
    held[i] = 0;
    vy[i] -= GRAV * dt;
    const ld = Math.exp(-1.6 * dt);
    const ad = Math.exp(-3.4 * dt);
    vx[i] *= ld;
    vy[i] *= ld;
    vz[i] *= ld;
    wx[i] *= ad;
    wy[i] *= ad;
    wz[i] *= ad;
    const sp = Math.hypot(vx[i], vy[i], vz[i]);
    if (sp > 7) {
      const k = 7 / sp;
      vx[i] *= k;
      vy[i] *= k;
      vz[i] *= k;
    }
    const as = Math.hypot(wx[i], wy[i], wz[i]);
    if (as > 14) {
      const k = 14 / as;
      wx[i] *= k;
      wy[i] *= k;
      wz[i] *= k;
    }
    px[i] += vx[i] * dt;
    py[i] += vy[i] * dt;
    pz[i] += vz[i] * dt;
    spinQuat(i, dt);
    dirty[i] = 1;
  }

  function bounds(i) {
    ends(i, ea);
    const low = Math.min(ea[1], ea[4]) - R;
    if (low < floorY) {
      py[i] += floorY - low;
      if (vy[i] < 0) {
        const impact = -vy[i];
        vy[i] = impact < 0.45 ? 0 : impact * 0.14;
        const slide = vx[i] * vx[i] + vz[i] * vz[i];
        vx[i] *= slide < 0.06 ? 0.55 : 0.82;
        vz[i] *= slide < 0.06 ? 0.55 : 0.82;
        const spin = slide < 0.06 ? 0.45 : 0.78;
        wx[i] *= spin;
        wy[i] *= spin;
        wz[i] *= spin;
        if (impact > 0.55) note(i, impact);
      }
    }
    const high = Math.max(ea[1], ea[4]) + R;
    if (high > ceilY) {
      py[i] -= high - ceilY;
      if (vy[i] > 0) vy[i] *= -0.08;
    }
    const minX = Math.min(ea[0], ea[3]) - R;
    const maxX = Math.max(ea[0], ea[3]) + R;
    if (minX < room.x0) {
      px[i] += room.x0 - minX;
      if (vx[i] < 0) { note(i, -vx[i]); vx[i] *= -0.22; }
    }
    if (maxX > room.x1) {
      px[i] -= maxX - room.x1;
      if (vx[i] > 0) { note(i, vx[i]); vx[i] *= -0.22; }
    }
    const maxZ = Math.max(ea[2], ea[5]) + R;
    const minZ = Math.min(ea[2], ea[5]) - R;
    if (maxZ > room.z1) {
      pz[i] -= maxZ - room.z1;
      if (vz[i] > 0) { note(i, vz[i]); vz[i] *= -0.22; }
    }
    const inDoor = px[i] > doorX0 + R && px[i] < doorX1 - R;
    if (!inDoor && minZ < room.z0) {
      pz[i] += room.z0 - minZ;
      if (vz[i] < 0) { note(i, -vz[i]); vz[i] *= -0.22; }
    } else if (inDoor && minZ < room.z0) {
      const stopZ = (vestibule?.z0 ?? room.z0 - 0.8) + 0.28;
      if (px[i] < doorX0 + R) { px[i] = doorX0 + R; vx[i] = Math.max(0, vx[i]); }
      if (px[i] > doorX1 - R) { px[i] = doorX1 - R; vx[i] = Math.min(0, vx[i]); }
      if (minZ < stopZ) {
        pz[i] += stopZ - minZ;
        if (vz[i] < 0) { note(i, -vz[i]); vz[i] *= -0.2; }
      }
    }
    for (let p = 0; p < posts.length; p += 1) {
      const post = posts[p];
      const dx = px[i] - post.x;
      const dz = pz[i] - post.z;
      const rr = post.r + R;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) / d;
      px[i] += dx * push;
      pz[i] += dz * push;
      const vn = vx[i] * dx + vz[i] * dz;
      if (vn < 0) {
        vx[i] -= (dx / d) * (vn / d) * 1.15;
        vz[i] -= (dz / d) * (vn / d) * 1.15;
      }
    }
    dirty[i] = 1;
  }

  function collideOne(i, j) {
    const dx = px[j] - px[i];
    const dy = py[j] - py[i];
    const dz = pz[j] - pz[i];
    const reach2 = (CAN_H + 0.03) * (CAN_H + 0.03);
    if (dx * dx + dy * dy + dz * dz > reach2) return;
    ends(i, ea);
    ends(j, eb);
    segSeg(ea[0], ea[1], ea[2], ea[3], ea[4], ea[5], eb[0], eb[1], eb[2], eb[3], eb[4], eb[5]);
    const overlap = CAN_D - scratch.dist;
    if (overlap <= SLOP) return;
    let nx;
    let ny;
    let nz;
    if (scratch.dist > 1e-5) {
      const inv = 1 / scratch.dist;
      nx = -scratch.nx * inv;
      ny = -scratch.ny * inv;
      nz = -scratch.nz * inv;
    } else {
      const inv = 1 / (Math.hypot(dx, dy, dz) || 1);
      nx = (dx || 0) * inv;
      ny = (dy || 1) * inv;
      nz = (dz || 0) * inv;
    }
    const hard = overlap > 0.008 || Math.hypot(vx[i] - vx[j], vy[i] - vy[j], vz[i] - vz[j]) > 0.35;
    if (!awake[j]) wake(j, hard);
    if (hard) { held[i] = 0; held[j] = 0; }
    const push = overlap - SLOP;
    px[i] -= nx * push * 0.5;
    py[i] -= ny * push * 0.5;
    pz[i] -= nz * push * 0.5;
    px[j] += nx * push * 0.5;
    py[j] += ny * push * 0.5;
    pz[j] += nz * push * 0.5;
    const rvx = vx[j] - vx[i];
    const rvy = vy[j] - vy[i];
    const rvz = vz[j] - vz[i];
    const rel = rvx * nx + rvy * ny + rvz * nz;
    if (rel < -0.22) {
      const dv = -(1 + REST) * rel * 0.5;
      vx[i] -= nx * dv;
      vy[i] -= ny * dv;
      vz[i] -= nz * dv;
      vx[j] += nx * dv;
      vy[j] += ny * dv;
      vz[j] += nz * dv;
      note(i, -rel);
      note(j, -rel);
      const rix = scratch.pax - px[i];
      const riy = scratch.pay - py[i];
      const riz = scratch.paz - pz[i];
      const rjx = scratch.pbx - px[j];
      const rjy = scratch.pby - py[j];
      const rjz = scratch.pbz - pz[j];
      const jx = nx * dv;
      const jy = ny * dv;
      const jz = nz * dv;
      wx[i] += (riy * -jz - riz * -jy) * Iinv;
      wy[i] += (riz * -jx - rix * -jz) * Iinv;
      wz[i] += (rix * -jy - riy * -jx) * Iinv;
      wx[j] += (rjy * jz - rjz * jy) * Iinv;
      wy[j] += (rjz * jx - rjx * jz) * Iinv;
      wz[j] += (rjx * jy - rjy * jx) * Iinv;
    }
    dirty[i] = 1;
    dirty[j] = 1;
  }

  function collideAwake() {
    for (let i = 0; i < n; i += 1) {
      if (!awake[i]) continue;
      forNear(i, 1, (j) => {
        if (awake[j] && j < i) return;
        collideOne(i, j);
      });
    }
  }

  function spread() {
    if (!anyAwake) return;
    for (let i = 0; i < n; i += 1) {
      if (awake[i]) continue;
      let close = false;
      forNear(i, 2, (j) => {
        if (close || !awake[j]) return;
        const dx = px[i] - px[j];
        const dy = py[i] - py[j];
        const dz = pz[i] - pz[j];
        if (dx * dx + dy * dy + dz * dz < 0.42 * 0.42) close = true;
      });
      if (close && !supported(i)) wake(i, true);
    }
  }

  function trySleep(i, dt) {
    const sp = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
    const an = wx[i] * wx[i] + wy[i] * wy[i] + wz[i] * wz[i];
    const resting = supported(i);
    if (sp < 0.06 && an < 4 && vy[i] > -0.4 && resting) {
      restT[i] += dt;
      if (restT[i] > 0.16 || (sp < 0.004 && an < 0.4)) {
        awake[i] = 0;
        held[i] = 0;
        vx[i] = vy[i] = vz[i] = wx[i] = wy[i] = wz[i] = 0;
      }
    } else restT[i] = 0;
  }

  function refreshAwake() {
    anyAwake = false;
    for (let i = 0; i < n; i += 1) if (awake[i]) { anyAwake = true; return; }
  }

  function unclipFloor() {
    for (let i = 0; i < n; i += 1) {
      if (!awake[i] && !dirty[i]) continue;
      ends(i, ea);
      const low = Math.min(ea[1], ea[4]) - R;
      if (low < floorY) {
        py[i] += floorY - low;
        if (vy[i] < 0) vy[i] = 0;
        dirty[i] = 1;
      }
    }
  }

  function substep(dt, b) {
    rebuildGrid();
    if (b) playerHit(b);
    for (let i = 0; i < n; i += 1) if (awake[i]) integrate(i, dt);
    rebuildGrid();
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < n; i += 1) if (awake[i]) bounds(i);
      collideAwake();
    }
    rebuildGrid();
    spread();
    for (let i = 0; i < n; i += 1) if (awake[i]) trySleep(i, dt);
    unclipFloor();
    refreshAwake();
  }

  function writeMatrices() {
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      if (!dirtyAll && !dirty[i]) continue;
      _q.set(qx[i], qy[i], qz[i], qw[i]);
      _p.set(px[i], py[i], pz[i]);
      _m.compose(_p, _q, _one);
      body.setMatrixAt(i, _m);
      rim.setMatrixAt(i, _m);
      mouth.setMatrixAt(i, _m);
      dirty[i] = 0;
      changed = true;
    }
    dirtyAll = false;
    if (!changed) return;
    body.instanceMatrix.needsUpdate = true;
    rim.instanceMatrix.needsUpdate = true;
    mouth.instanceMatrix.needsUpdate = true;
  }

  writeMatrices();

  function update(dt) {
    impacts.length = 0;
    const b = bodyRef;
    const near = !!(b && Math.abs(b.x - anchorX) < 4.5 && Math.abs(b.z - anchorZ) < 4.5 && b.y1 > floorY - 0.3 && b.y0 < floorY + 2.6);
    if (!anyAwake && !near) return impacts;
    acc += Math.min(Math.max(dt, 0), 0.05);
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      acc -= STEP;
      substep(STEP, near ? b : null);
      steps += 1;
    }
    if (steps === 4) acc = 0;
    writeMatrices();
    time += dt;
    return impacts;
  }

  function debug() {
    let awakeN = 0;
    let moved = 0;
    let nan = 0;
    let minY = Infinity;
    let maxDisp = 0;
    let fast = 0;
    let air = 0;
    let speedSum = 0;
    for (let i = 0; i < n; i += 1) {
      if (awake[i]) awakeN += 1;
      if (!Number.isFinite(px[i] + py[i] + pz[i] + qx[i] + qw[i])) nan += 1;
      const d = Math.hypot(px[i] - homeX[i], py[i] - homeY[i], pz[i] - homeZ[i]);
      if (d > maxDisp) maxDisp = d;
      if (d > 0.02) moved += 1;
      if (py[i] < minY) minY = py[i];
      const sp = Math.hypot(vx[i], vy[i], vz[i]);
      speedSum += sp;
      if (sp > 0.25) fast += 1;
      if (py[i] > floorY + CAN_H) air += 1;
    }
    return {
      count: n,
      awake: awakeN,
      moved,
      maxDisp,
      minY,
      nan,
      fast,
      air,
      meanSpeed: speedSum / n,
      topY: py[n - 1],
      topHome: homeY[n - 1],
      floorY,
    };
  }

  return {
    group,
    count: n,
    impacts,
    update,
    debug,
    setBody(b) { bodyRef = b; },
  };
}
