// A hang glider parked on the pride rock. Both hands on the bar and it flies.
// The step is plain numbers so a headless check can fly it without a scene.
import * as THREE from 'three';

const nose = new THREE.Vector3();
const wingUp = new THREE.Vector3();
const bar = new THREE.Vector3();
const fwd = new THREE.Vector3();
const mid = new THREE.Vector3();
const toBar = new THREE.Vector3();

// Nose down spends height for speed. Nose up spends speed to climb. A bank turns.
// Below flying speed the wing stops carrying you.
export function stepGlide(v, noseIn, upIn, dt) {
  const flat = Math.hypot(noseIn.x, noseIn.z) || 1;
  const nx = noseIn.x / flat;
  const nz = noseIn.z / flat;
  let hx = v.x;
  let hz = v.z;
  const mag = Math.hypot(hx, hz);
  if (mag < 0.3) {
    hx = nx;
    hz = nz;
  } else {
    hx /= mag;
    hz /= mag;
  }
  const bank = upIn.z * nx - upIn.x * nz;
  const ang = bank * 1.4 * dt;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  let tx = hx * cs - hz * sn;
  let tz = hx * sn + hz * cs;
  const vane = Math.min(1, dt * 0.8);
  tx += (nx - tx) * vane;
  tz += (nz - tz) * vane;
  const dl = Math.hypot(tx, tz) || 1;
  tx /= dl;
  tz /= dl;

  let speed = mag < 0.3 ? 4.5 : mag;
  const pitch = noseIn.y;
  const target = THREE.MathUtils.clamp(8.6 - pitch * 16, 2.2, 13.5);
  speed += (target - speed) * Math.min(1, dt * 1.1);
  const baseline = -0.65 - (speed - 9) * (speed - 9) * 0.07;
  const climb = baseline + pitch * speed * 0.75;
  v.x = tx * speed;
  v.z = tz * speed;
  v.y += (climb - v.y) * Math.min(1, dt * 3);
}

// Hands set the bar. Pushing it out from the head noses down; pulling it in noses up.
// One hand lower banks that wing. prevNose keeps the nose from flipping when the bar is level.
export function barFrame(left, right, head, prevNose) {
  mid.copy(left).add(right).multiplyScalar(0.5);
  bar.copy(right).sub(left);
  if (bar.lengthSq() < 1e-6) bar.set(0, 0, 1);
  bar.normalize();
  fwd.crossVectors(_up, bar);
  if (fwd.lengthSq() < 1e-6) fwd.set(-1, 0, 0);
  fwd.normalize();
  if (prevNose && fwd.dot(prevNose) < 0) fwd.negate();
  toBar.copy(mid).sub(head);
  const ahead = toBar.dot(fwd);
  const pitch = THREE.MathUtils.clamp((0.32 - ahead) * 1.35, -0.55, 0.42);
  nose.copy(fwd).applyAxisAngle(bar, -pitch);
  wingUp.crossVectors(bar, nose);
  if (wingUp.y < 0) wingUp.negate();
  wingUp.normalize();
  return { mid: mid.clone(), bar: bar.clone(), nose: nose.clone(), wingUp: wingUp.clone(), pitch };
}

const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _basis = new THREE.Matrix4();

export function createGlider(scene, deckY = 11.5) {
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xd7d0c2, roughness: 0.92, side: THREE.DoubleSide });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x8c3b34, roughness: 0.8 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.42, metalness: 0.55 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.85 });

  const group = new THREE.Group();
  group.name = 'glider';

  function tube(ax, ay, az, bx, by, bz, radius, material) {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 7), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Local +X is the nose. Parked facing west (rotation.y = PI) that points out over the water.
  const noseP = [1.62, 1.14, 0];
  const leftTip = [0.12, 0.9, -1.78];
  const rightTip = [0.12, 0.9, 1.78];
  const tail = [-0.48, 0.84, 0];
  const hang = [0.2, 1.02, 0];
  tube(...noseP, ...tail, 0.018, frameMat);
  tube(...noseP, ...leftTip, 0.016, frameMat);
  tube(...noseP, ...rightTip, 0.016, frameMat);
  tube(...leftTip, ...rightTip, 0.012, frameMat);
  tube(0, 0, -0.3, ...hang, 0.016, frameMat);
  tube(0, 0, 0.3, ...hang, 0.016, frameMat);
  tube(0, 0, -0.3, 0, 0, 0.3, 0.02, frameMat);
  tube(0, 0, -0.34, 0, 0, -0.2, 0.026, gripMat);
  tube(0, 0, 0.2, 0, 0, 0.34, 0.026, gripMat);

  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([
    ...noseP, ...leftTip, ...tail,
    ...noseP, ...tail, ...rightTip,
  ], 3));
  sail.computeVertexNormals();
  const cloth = new THREE.Mesh(sail, sailMat);
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  group.add(cloth);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), noseMat);
  cap.position.set(noseP[0] + 0.06, noseP[1], noseP[2]);
  cap.rotation.z = -Math.PI / 2;
  cap.castShadow = true;
  group.add(cap);

  const grips = [-1, 1].map((side) => {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.16), new THREE.MeshBasicMaterial({ visible: false }));
    grip.position.set(0, 0, side * 0.3);
    grip.userData = { type: 'glider', side, heldBy: null };
    group.add(grip);
    return grip;
  });

  // On the walkable crown of the point, bar about chest height, nose toward the sea.
  group.position.set(-1.35, deckY + 1.12, 0);
  group.rotation.y = Math.PI;
  scene.add(group);

  function aim(quaternion, noseDir, upDir) {
    _x.copy(noseDir);
    _y.copy(upDir);
    _z.crossVectors(_x, _y).normalize();
    _y.crossVectors(_z, _x).normalize();
    quaternion.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z));
  }

  return { group, grips, aim };
}
