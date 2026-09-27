import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HEIGHT, STUD, STUD_H } from './config.js';

const GAP = 0.0016;
const STUD_RISE = STUD_H * 0.9;
const HOLE_R = STUD * 0.34;
const studGeometry = new THREE.CylinderGeometry(STUD * 0.29, STUD * 0.29, STUD_RISE, 16);
const materials = new Map();
let nextWatchId = 1;

function materialFor(hex) {
  let material = materials.get(hex);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.38,
      metalness: 0.02,
    });
    materials.set(hex, material);
  }
  return material;
}

const bodyGeometry = new Map();

function roundedRect(shape, x, y, w, h, r) {
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + w, y + h - r);
  shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + h);
  shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
}

function extrudeUp(shape, height) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function socketDepth(bodyH) {
  return Math.min(STUD_H, Math.max(0.004, bodyH - 0.005));
}

function geometryFor(w, d, bodyH) {
  const key = `box${w}x${d}x${bodyH}`;
  let geometry = bodyGeometry.get(key);
  if (geometry) return geometry;

  const width = w * STUD - GAP;
  const depth = d * STUD - GAP;
  const socket = socketDepth(bodyH);
  const outline = new THREE.Shape();
  roundedRect(outline, -width / 2, -depth / 2, width, depth, 0.003);
  for (let x = 0; x < w; x += 1) {
    for (let z = 0; z < d; z += 1) {
      const hole = new THREE.Path();
      hole.absarc(
        (x - (w - 1) / 2) * STUD,
        -((z - (d - 1) / 2) * STUD),
        HOLE_R,
        0,
        Math.PI * 2,
        true,
      );
      outline.holes.push(hole);
    }
  }

  const capOutline = new THREE.Shape();
  roundedRect(capOutline, -width / 2, -depth / 2, width, depth, 0.003);
  const plate = extrudeUp(outline, socket);
  const cap = extrudeUp(capOutline, bodyH - socket + 0.0004);
  cap.translate(0, socket - 0.0004, 0);
  geometry = mergeGeometries([plate, cap]);
  geometry.computeVertexNormals();
  bodyGeometry.set(key, geometry);
  return geometry;
}

function profileGeometry(width, build) {
  const shape = new THREE.Shape();
  build(shape);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

function cellCenter(ix, iz, w, d) {
  return {
    x: (ix - (w - 1) / 2) * STUD,
    z: (iz - (d - 1) / 2) * STUD,
  };
}

function rectPlate(x0, z0, x1, z1, holes, height = STUD_H) {
  const shape = new THREE.Shape();
  shape.moveTo(x0, -z1);
  shape.lineTo(x1, -z1);
  shape.lineTo(x1, -z0);
  shape.lineTo(x0, -z0);
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    path.absarc(hole.x, -hole.z, hole.r, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  return extrudeUp(shape, height);
}

function holeRadius(cz, zLimit) {
  const room = cz - zLimit - 0.001;
  if (room < STUD * 0.3) return 0;
  return Math.min(HOLE_R, room);
}

function slopeGeometry(w, d, bodyH) {
  const key = `slope${w}x${d}x${bodyH}`;
  let geometry = bodyGeometry.get(key);
  if (geometry) return geometry;
  const width = w * STUD - GAP;
  const depth = d * STUD - GAP;
  const socket = socketDepth(bodyH);
  const z0 = -depth / 2;
  const z1 = depth / 2;
  const knee = cellCenter(0, d - 1, w, d).z - STUD / 2;
  const zA = z0 + (knee - z0) * (socket / bodyH);
  const holes = [];
  for (let x = 0; x < w; x += 1) {
    for (let z = 0; z < d; z += 1) {
      const center = cellCenter(x, z, w, d);
      const radius = holeRadius(center.z, zA);
      if (radius > 0) holes.push({ ...center, r: radius });
    }
  }
  const parts = [
    profileGeometry(width, (shape) => {
      shape.moveTo(z0, 0);
      shape.lineTo(zA, 0);
      shape.lineTo(zA, socket);
      shape.lineTo(z0, 0);
    }),
    rectPlate(-width / 2, zA, width / 2, z1, holes, socket),
    profileGeometry(width, (shape) => {
      shape.moveTo(zA, socket);
      shape.lineTo(z1, socket);
      shape.lineTo(z1, bodyH);
      shape.lineTo(knee, bodyH);
      shape.lineTo(zA, socket);
    }),
  ];
  geometry = mergeGeometries(parts);
  geometry.computeVertexNormals();
  bodyGeometry.set(key, geometry);
  return geometry;
}

function wallGeometry(w, d, bodyH) {
  const key = `wall${w}x${d}x${bodyH}`;
  let geometry = bodyGeometry.get(key);
  if (geometry) return geometry;
  const width = w * STUD - GAP;
  const depth = d * STUD - GAP;
  const socket = socketDepth(bodyH);
  const z0 = -depth / 2;
  const z1 = depth / 2;
  const knee = cellCenter(0, 0, w, d).z + STUD / 2;
  const holes = [];
  for (let x = 0; x < w; x += 1) {
    const center = cellCenter(x, 0, w, d);
    const radius = holeRadius(knee - 0.001, center.z);
    if (radius > 0) holes.push({ ...center, r: radius });
  }
  const parts = [
    rectPlate(-width / 2, z0, width / 2, knee, holes, socket),
    profileGeometry(width, (shape) => {
      shape.moveTo(z0, socket);
      shape.lineTo(knee, socket);
      shape.lineTo(knee, bodyH);
      shape.lineTo(z0, bodyH);
      shape.closePath();
    }),
    profileGeometry(width, (shape) => {
      shape.moveTo(knee, 0);
      shape.lineTo(z1, bodyH);
      shape.lineTo(knee, bodyH);
      shape.closePath();
    }),
  ];
  geometry = mergeGeometries(parts);
  geometry.computeVertexNormals();
  bodyGeometry.set(key, geometry);
  return geometry;
}

export function createBrick(shape, color, options = {}) {
  const group = new THREE.Group();
  const material = materialFor(color.hex);
  const kind = shape.kind || 'box';
  const units = options.units || 4;
  const bodyH = HEIGHT * units / 4;
  const flat = !!options.flat;
  const bodyGeo = kind === 'slope' ? slopeGeometry(shape.w, shape.d, bodyH) : kind === 'wall' ? wallGeometry(shape.w, shape.d, bodyH) : geometryFor(shape.w, shape.d, bodyH);
  const body = new THREE.Mesh(bodyGeo, material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  if (!flat) {
    for (let x = 0; x < shape.w; x += 1) {
      for (let z = 0; z < shape.d; z += 1) {
        if (kind === 'slope' && z !== shape.d - 1) continue;
        const stud = new THREE.Mesh(studGeometry, material);
        stud.position.set(
          (x - (shape.w - 1) / 2) * STUD,
          bodyH + STUD_RISE / 2,
          (z - (shape.d - 1) / 2) * STUD,
        );
        stud.castShadow = true;
        group.add(stud);
      }
    }
  }

  group.userData = {
    type: 'brick',
    role: 'supply',
    shapeId: shape.id,
    colorId: color.id,
    heightId: options.heightId || '1',
    units,
    flat,
    baseW: shape.w,
    baseD: shape.d,
    kind,
    rot: 0,
    watchId: nextWatchId++,
    pedestalId: null,
    cells: null,
    anchor: null,
    snap: null,
  };
  return group;
}

export function setBrickRaycast(brick, enabled) {
  const raycast = enabled ? THREE.Mesh.prototype.raycast : () => {};
  brick.traverse((child) => {
    if (child.isMesh) child.raycast = raycast;
  });
}

export function makeGhost(source) {
  const ghost = source.clone(true);
  ghost.traverse((child) => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 0.38;
      child.material.depthWrite = false;
      child.castShadow = false;
      child.raycast = () => {};
    }
  });
  ghost.visible = false;
  ghost.userData.type = 'ghost';
  return ghost;
}
