// A driver, a small green, and one ball on the pride rock. Shots go west, out over the water.
// The ball uses the hockey solver with golf size, loft, and a ribbon so the flight stays visible.
import * as THREE from 'three';
import { createBallState, soleCatch, stepBall, turfDrag } from './hockeyball.js';

const BALL_R = 0.02135;
const LOFT = 12 * Math.PI / 180;
const COS = Math.cos(LOFT);
const SIN = Math.sin(LOFT);
const HEAD_Y = -1.02;
// The face plate, in the head's own space, before the loft tilt. Wide and flat, on the front of the head.
const PLATE_AT = new THREE.Vector3(0.062, -0.012, 0.02);
const PLATE_W = 0.108;
const PLATE_H = 0.058;

export const GREEN = { x0: -0.62, x1: 0.72, z0: -0.42, z1: 0.42, y: 11.36 };
const TEE = { x: -0.42, z: 0.02 };
const TEE_H = 0.042;

const zAxis = new THREE.Vector3(0, 0, 1);
const FACE_LOCAL = PLATE_AT.clone().applyAxisAngle(zAxis, LOFT).add(new THREE.Vector3(0, HEAD_Y, 0));
const FACE_N = new THREE.Vector3(COS, SIN, 0);
const FACE_TOE = new THREE.Vector3(0, 0, 1);
const FACE_UP = new THREE.Vector3(-SIN, COS, 0);
const SHAFT_A = new THREE.Vector3(0, -0.04, 0);
const SHAFT_B = new THREE.Vector3(0, HEAD_Y + 0.02, 0);
const SOLE = [-0.03, 0.02, 0.07].map((z) => {
  const p = new THREE.Vector3(0.02, -0.032, z).applyAxisAngle(zAxis, LOFT);
  p.y += HEAD_Y;
  return p;
});

// One hand: point the controller and the shaft follows. The top of that controller is the face.
const HOLD_QUAT = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
  ),
);

const TRAIL_N = 48;

function faceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e4dfd2';
  ctx.fillRect(0, 0, 64, 32);
  ctx.strokeStyle = '#b9b3a4';
  ctx.lineWidth = 1;
  for (let y = 5; y < 30; y += 4) {
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(60, y);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function turfTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3d7a3c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#468a44';
  for (let i = 0; i < 8; i += 1) ctx.fillRect(0, i * 16, 128, 7);
  ctx.fillStyle = '#2f6234';
  ctx.fillRect(0, 0, 128, 6);
  ctx.fillRect(0, 122, 128, 6);
  ctx.fillRect(0, 0, 6, 128);
  ctx.fillRect(122, 0, 6, 128);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  return map;
}

function makeTrail() {
  const pos = new Float32Array(TRAIL_N * 2 * 3);
  const alpha = new Float32Array(TRAIL_N * 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const index = [];
  for (let i = 0; i < TRAIL_N - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(index);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(1.0, 0.97, 0.86, vAlpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, pos, alpha, geo };
}

export function createGolf(scene, targets, deckY = GREEN.y) {
  const green = { ...GREEN, y: deckY };
  const turf = new THREE.Mesh(
    new THREE.BoxGeometry(green.x1 - green.x0, 0.05, green.z1 - green.z0),
    new THREE.MeshStandardMaterial({ map: turfTexture(), color: 0xffffff, roughness: 0.96 }),
  );
  turf.position.set((green.x0 + green.x1) / 2, green.y - 0.025, (green.z0 + green.z1) / 2);
  turf.receiveShadow = true;
  scene.add(turf);
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(green.x1 - green.x0 + 0.16, 0.03, green.z1 - green.z0 + 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2c5a30, roughness: 0.98 }),
  );
  apron.position.set(turf.position.x, green.y - 0.055, turf.position.z);
  apron.receiveShadow = true;
  scene.add(apron);

  const teeTop = green.y + TEE_H;
  const peg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.006, TEE_H, 6),
    new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.55 }),
  );
  peg.position.set(TEE.x, green.y + TEE_H / 2, TEE.z);
  peg.castShadow = true;
  scene.add(peg);

  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.42, metalness: 0.4 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.82 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.32, metalness: 0.62 });
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(), color: 0xffffff, roughness: 0.42, metalness: 0.12 });

  const club = new THREE.Group();
  const shaftLen = -HEAD_Y - 0.24;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.0045, shaftLen, 10), shaftMat);
  shaft.position.y = -0.26 - shaftLen / 2;
  club.add(shaft);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.0145, 0.3, 12), gripMat);
  wrap.position.y = -0.15;
  club.add(wrap);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), gripMat);
  cap.position.y = 0.012;
  club.add(cap);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.7 });
  [-0.06, -0.22].forEach((y) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0025, 6, 14), ringMat);
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    club.add(ring);
  });
  const head = new THREE.Group();
  head.position.set(0, HEAD_Y, 0);
  head.rotation.z = LOFT;
  const hosel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.08, 8), shaftMat);
  hosel.position.set(0.01, 0.01, -0.02);
  hosel.rotation.z = 0.4;
  hosel.rotation.x = 0.5;
  head.add(hosel);
  const crown = new THREE.Shape();
  crown.moveTo(0.07, -0.04);
  crown.lineTo(0.07, 0.07);
  crown.quadraticCurveTo(0.055, 0.1, 0.01, 0.09);
  crown.quadraticCurveTo(-0.035, 0.05, -0.02, 0.0);
  crown.quadraticCurveTo(-0.03, -0.045, 0.015, -0.05);
  crown.quadraticCurveTo(0.05, -0.05, 0.07, -0.04);
  const crownGeo = new THREE.ExtrudeGeometry(crown, {
    depth: 0.048,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.007,
    bevelSegments: 2,
    curveSegments: 10,
  });
  crownGeo.translate(0, 0, -0.024);
  crownGeo.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(crownGeo, headMat);
  head.add(body);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.012, PLATE_H, PLATE_W), faceMat);
  plate.position.copy(PLATE_AT);
  head.add(plate);
  club.add(head);
  club.position.set(-0.38, green.y + 0.08, 0.24);
  club.rotation.z = Math.PI / 2;
  club.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  club.userData = {
    type: 'gear',
    gear: 'driver',
    floorY: green.y + 0.08,
    holdPos: new THREE.Vector3(0, -0.02, -0.03),
    holdRot: new THREE.Euler().setFromQuaternion(HOLD_QUAT),
    restRot: club.rotation.clone(),
    carried: false,
    offHand: null,
  };
  scene.add(club);
  targets.push(club);

  const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xf7f7f4, roughness: 0.28, metalness: 0.04 }),
  );
  ballMesh.castShadow = true;
  scene.add(ballMesh);

  const spawn = { x: TEE.x, y: teeTop + BALL_R, z: TEE.z };
  const ball = createBallState(spawn.x, spawn.y, spawn.z);
  ball.r = BALL_R;
  ball.m = 0.04593;
  ball.faceE = 0.8;
  ball.floorE = 0.4;
  ball.floorMu = 0.5;
  ball.cd = 0.25;
  ball.magnus = 0.0032;

  const face = {
    c: { x: 0, y: 0, z: 0 },
    n: { x: 1, y: 0, z: 0 },
    toe: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
    halfToe: PLATE_W / 2 + 0.006,
    halfUp: PLATE_H / 2 + 0.004,
    v: { x: 0, y: 0, z: 0 },
    w: { x: 0, y: 0, z: 0 },
    sweep: 0,
    shaft: { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, r: 0.01 },
  };

  const trail = makeTrail();
  scene.add(trail.mesh);
  const samples = [];
  let fade = 0;
  let wait = 0;
  let wet = false;

  const prevRaw = new THREE.Vector3();
  const gripV = new THREE.Vector3();
  const soleW = new THREE.Vector3();
  const arm = new THREE.Vector3();
  const worldA = new THREE.Vector3();
  const worldB = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const catchQ = new THREE.Quaternion();
  const worldQ = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  const holdQuat = HOLD_QUAT.clone();
  const leadPos = new THREE.Vector3();
  const offPos = new THREE.Vector3();
  const leadQ = new THREE.Quaternion();
  const shaftDir = new THREE.Vector3();
  const faceDir = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const toeAxis = new THREE.Vector3();
  const aimBasis = new THREE.Matrix4();
  const aimWorld = new THREE.Quaternion();
  let twoHand = false;
  const side = new THREE.Vector3();
  let havePrev = false;
  let pushArmed = true;
  let turfArmed = true;
  let dug = null;

  function worldDir(local, target) {
    return target.copy(local).transformDirection(club.matrixWorld);
  }

  function readFace() {
    club.updateWorldMatrix(true, false);
    worldA.copy(FACE_LOCAL).applyMatrix4(club.matrixWorld);
    face.c.x = worldA.x;
    face.c.y = worldA.y;
    face.c.z = worldA.z;
    worldDir(FACE_N, worldA);
    face.n.x = worldA.x;
    face.n.y = worldA.y;
    face.n.z = worldA.z;
    worldDir(FACE_TOE, worldA);
    face.toe.x = worldA.x;
    face.toe.y = worldA.y;
    face.toe.z = worldA.z;
    worldDir(FACE_UP, worldA);
    face.up.x = worldA.x;
    face.up.y = worldA.y;
    face.up.z = worldA.z;
    worldA.copy(SHAFT_A).applyMatrix4(club.matrixWorld);
    worldB.copy(SHAFT_B).applyMatrix4(club.matrixWorld);
    face.shaft.a.x = worldA.x;
    face.shaft.a.y = worldA.y;
    face.shaft.a.z = worldA.z;
    face.shaft.b.x = worldB.x;
    face.shaft.b.y = worldB.y;
    face.shaft.b.z = worldB.z;
  }

  function catchFloor(floorAt, waterY) {
    if (!club.userData.carried || !club.parent) return 0;
    let worst = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      club.updateWorldMatrix(true, false);
      club.getWorldPosition(gripV);
      let hit = null;
      for (const local of SOLE) {
        soleW.copy(local).applyMatrix4(club.matrixWorld);
        const floorY = floorAt(soleW.x, soleW.z, soleW.y);
        if (floorY == null || floorY <= waterY + 0.05) continue;
        const caught = soleCatch(gripV, soleW, floorY);
        if (caught.pen > (hit?.pen ?? 0)) hit = caught;
      }
      if (!hit || hit.pen <= 0.001 || !hit.axis || hit.angle <= 1e-4) break;
      worst = Math.max(worst, hit.pen);
      axis.set(hit.axis.x, hit.axis.y, hit.axis.z);
      catchQ.setFromAxisAngle(axis, hit.angle);
      club.getWorldQuaternion(worldQ).premultiply(catchQ);
      club.parent.getWorldQuaternion(parentQ).invert();
      club.quaternion.copy(parentQ).multiply(worldQ);
    }
    return worst;
  }

  // Both fists on the grip: the shaft runs from the top hand through the lower hand.
  // The tops of the two controllers roll the face.
  function aimHands() {
    const lead = club.parent;
    const off = club.userData.offHand;
    if (!club.userData.carried || !lead || !off || off === lead) return false;
    lead.getWorldPosition(leadPos);
    off.getWorldPosition(offPos);
    shaftDir.copy(offPos).sub(leadPos);
    if (shaftDir.lengthSq() < 0.0036) return false;
    shaftDir.normalize();
    lead.getWorldQuaternion(leadQ);
    faceDir.set(0, 1, 0).applyQuaternion(leadQ);
    off.getWorldQuaternion(leadQ);
    worldA.set(0, 1, 0).applyQuaternion(leadQ);
    faceDir.add(worldA);
    faceDir.addScaledVector(shaftDir, -faceDir.dot(shaftDir));
    if (faceDir.lengthSq() < 1e-6) return false;
    faceDir.normalize();
    yAxis.copy(shaftDir).negate();
    toeAxis.crossVectors(faceDir, yAxis);
    if (toeAxis.lengthSq() < 1e-8) return false;
    toeAxis.normalize();
    yAxis.crossVectors(toeAxis, faceDir).normalize();
    aimWorld.setFromRotationMatrix(aimBasis.makeBasis(faceDir, yAxis, toeAxis));
    lead.getWorldQuaternion(parentQ).invert();
    club.quaternion.copy(parentQ).multiply(aimWorld);
    club.position.copy(club.userData.holdPos);
    return true;
  }

  function syncPose(dt, motion, floorAt, waterY) {
    if (!club.userData.carried || club.userData.offHand === club.parent) club.userData.offHand = null;
    const aimed = aimHands();
    if (aimed !== twoHand) havePrev = false;
    twoHand = aimed;
    if (club.userData.carried && !aimed) {
      club.quaternion.copy(holdQuat);
      club.position.copy(club.userData.holdPos);
    }
    readFace();
    if (!aimed && motion?.held && motion.v) {
      club.getWorldPosition(gripV);
      arm.set(face.c.x - gripV.x, face.c.y - gripV.y, face.c.z - gripV.z);
      const w = motion.w || { x: 0, y: 0, z: 0 };
      face.v.x = motion.v.x + (w.y * arm.z - w.z * arm.y);
      face.v.y = motion.v.y + (w.z * arm.x - w.x * arm.z);
      face.v.z = motion.v.z + (w.x * arm.y - w.y * arm.x);
      face.w.x = w.x;
      face.w.y = w.y;
      face.w.z = w.z;
    } else if (havePrev && dt > 1e-4) {
      face.v.x = (face.c.x - prevRaw.x) / dt;
      face.v.y = (face.c.y - prevRaw.y) / dt;
      face.v.z = (face.c.z - prevRaw.z) / dt;
      face.w.x = face.w.y = face.w.z = 0;
    } else {
      face.v.x = face.v.y = face.v.z = 0;
      face.w.x = face.w.y = face.w.z = 0;
    }
    prevRaw.set(face.c.x, face.c.y, face.c.z);
    havePrev = true;
    const pen = catchFloor(floorAt, waterY);
    readFace();
    if (pen > 0) {
      const dragged = turfDrag(face.v, face.w, pen);
      face.v.x = dragged.v.x;
      face.v.y = dragged.v.y;
      face.v.z = dragged.v.z;
      face.w.x = dragged.w.x;
      face.w.y = dragged.w.y;
      face.w.z = dragged.w.z;
      dug = dragged.kill > 0.18 ? { kill: dragged.kill, at: { x: face.c.x, y: face.c.y, z: face.c.z } } : null;
    } else dug = null;
  }

  function resetBall() {
    ball.p.x = spawn.x;
    ball.p.y = spawn.y;
    ball.p.z = spawn.z;
    ball.v.x = ball.v.y = ball.v.z = 0;
    ball.w.x = ball.w.y = ball.w.z = 0;
    ball.asleep = false;
    samples.length = 0;
    fade = 0;
    wait = 0;
    wet = false;
    trail.geo.setDrawRange(0, 0);
  }

  function writeTrail() {
    const n = samples.length;
    const attr = trail.geo.getAttribute('position');
    const alphas = trail.geo.getAttribute('aAlpha');
    if (n < 2) {
      trail.geo.setDrawRange(0, 0);
      return;
    }
    const draw = Math.min(n, TRAIL_N);
    const start = n - draw;
    for (let i = 0; i < draw; i += 1) {
      const a = samples[start + Math.max(0, i - 1)];
      const b = samples[start + Math.min(draw - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const hl = Math.hypot(dx, dz) || 1;
      side.set((dz / hl) * 0.35, 0.94, (-dx / hl) * 0.35).normalize();
      const w = 0.01 + 0.03 * (i / (draw - 1));
      const p = samples[start + i];
      const o = i * 2;
      attr.setXYZ(o, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      attr.setXYZ(o + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      const along = i / (draw - 1);
      const aFade = along * along * Math.max(0, 1 - fade);
      alphas.setX(o, aFade);
      alphas.setX(o + 1, aFade * 0.35);
    }
    attr.needsUpdate = true;
    alphas.needsUpdate = true;
    trail.geo.setDrawRange(0, (draw - 1) * 6);
  }

  function update(dt, { colliders = [], groundUnder = null, waterY = -8, motion = null } = {}) {
    const floorAt = (x, z, y) => (groundUnder ? groundUnder(x, z, y) : null);
    const ballFloor = (x, z, y) => {
      if (Math.hypot(x - TEE.x, z - TEE.z) < 0.028 && y > green.y && y < teeTop + 0.05) return teeTop;
      return floorAt(x, z, y);
    };
    if (!club.visible || club.position.y < -5) havePrev = false;
    else syncPose(dt, motion, floorAt, waterY);
    const useFace = club.visible && club.position.y > -5;
    const events = stepBall(ball, dt, {
      face: useFace ? face : null,
      boxes: colliders,
      waterY,
      floorAt: ballFloor,
    });
    if (!Number.isFinite(ball.p.y) || ball.p.y < -30 || ball.p.y > 80) resetBall();
    const speed = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
    const last = samples[samples.length - 1];
    const moved = !last || Math.hypot(ball.p.x - last.x, ball.p.y - last.y, ball.p.z - last.z) > 0.18;
    if (speed > 2.2 && moved) {
      samples.push({ x: ball.p.x, y: ball.p.y, z: ball.p.z });
      if (samples.length > 96) samples.shift();
      fade = 0;
    } else if (samples.length && speed < 1.4) fade += dt * 0.45;
    writeTrail();

    const inWater = ball.p.y < waterY + 0.2;
    if (inWater && !wet) {
      wet = true;
      events.push({ type: 'splash', at: { x: ball.p.x, y: waterY, z: ball.p.z }, speed });
    }
    if (!inWater) wet = false;
    const far = Math.hypot(ball.p.x - spawn.x, ball.p.z - spawn.z) > 1.2;
    if ((inWater && speed < 0.7) || (ball.asleep && far)) wait += dt;
    else wait = 0;
    if (wait > (inWater ? 2.4 : 3.2)) resetBall();

    ballMesh.position.set(ball.p.x, ball.p.y, ball.p.z);
    const spin = Math.hypot(ball.w.x, ball.w.y, ball.w.z);
    if (spin > 0.2) {
      axis.set(ball.w.x, ball.w.y, ball.w.z).multiplyScalar(1 / spin);
      ballMesh.rotateOnWorldAxis(axis, spin * dt);
    }
    const out = [];
    let pushed = false;
    for (const event of events) {
      if (event.type === 'push') pushed = true;
      else out.push({ ...event, at: { x: ball.p.x, y: ball.p.y, z: ball.p.z } });
    }
    if (pushed && pushArmed) out.push({ type: 'push', speed: 1, at: { x: ball.p.x, y: ball.p.y, z: ball.p.z } });
    pushArmed = !pushed;
    if (dug && turfArmed) out.push({ type: 'turf', kill: dug.kill, at: dug.at });
    turfArmed = !dug;
    return out;
  }

  return { update, club, green, ball: ballMesh };
}
