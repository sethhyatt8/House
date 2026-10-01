import * as THREE from 'three';

export function applyWorldUv(mesh, tile) {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const m = mesh.matrixWorld;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    if (ax >= ay && ax >= az) uv.setXY(i, (n.x > 0 ? -p.z : p.z) / tile, p.y / tile);
    else if (ay >= az) uv.setXY(i, p.x / tile, (n.y > 0 ? -p.z : p.z) / tile);
    else uv.setXY(i, (n.z > 0 ? p.x : -p.x) / tile, p.y / tile);
  }
  uv.needsUpdate = true;
}
