import * as THREE from 'three';

export function p4Node(assets, id, name) {
  const gltf = assets?.gltf(id);
  return gltf ? gltf.scene.getObjectByName(name) : null;
}

const noRay = (object) => {
  object.raycast = () => {};
  return object;
};

function shown(object) {
  for (let node = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (!node.parent && !node.isScene) return false;
  }
  return true;
}

export function createFollower(scene, src, proxies, local = new THREE.Matrix4(), colors = null) {
  const mesh = noRay(new THREE.InstancedMesh(src.geometry, src.material, proxies.length));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  if (colors) proxies.forEach((_, index) => mesh.setColorAt(index, new THREE.Color(colors[index])));
  scene.add(mesh);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const matrix = new THREE.Matrix4();
  function update() {
    proxies.forEach((proxy, index) => {
      if (!shown(proxy)) {
        mesh.setMatrixAt(index, zero);
        return;
      }
      proxy.updateWorldMatrix(true, false);
      mesh.setMatrixAt(index, matrix.multiplyMatrices(proxy.matrixWorld, local));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  update();
  return { mesh, update };
}

export function addLadderVisuals(group, assets, railSpecs, rungSpecs) {
  const rail = p4Node(assets, 'ladder_kit', 'ladder_rail');
  const rung = p4Node(assets, 'ladder_kit', 'ladder_rung');
  if (!rail || !rung) return false;
  const segment = 0.96;
  const rotation = new THREE.Quaternion();
  const mats = [];
  for (const { x, y0, y1, z, w, d } of railSpecs) {
    const count = Math.max(1, Math.ceil((y1 - y0) / segment));
    const length = (y1 - y0) / count;
    for (let i = 0; i < count; i += 1) {
      mats.push(new THREE.Matrix4().compose(
        new THREE.Vector3(x, y0 + i * length, z),
        rotation,
        new THREE.Vector3(w, length, d),
      ));
    }
  }
  const rails = noRay(new THREE.InstancedMesh(rail.geometry, rail.material, mats.length));
  mats.forEach((item, index) => rails.setMatrixAt(index, item));
  const rungs = noRay(new THREE.InstancedMesh(rung.geometry, rung.material, rungSpecs.length));
  rungSpecs.forEach(({ x, y, sx, sy, sz }, index) => rungs.setMatrixAt(
    index,
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, 0),
      rotation,
      new THREE.Vector3(sx / 0.09, sy / 0.02, sz / 0.44),
    ),
  ));
  for (const mesh of [rails, rungs]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return true;
}
