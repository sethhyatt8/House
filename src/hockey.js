// Eloise's room: the main hall. A field-hockey stick, an FIH ball, and two goals.
// The ball solver lives in hockeyball.js (spin, bounce, strike, push pass).
import * as THREE from 'three';
import { BALL_R, createBallState, soleCatch, stepBall, turfDrag } from './hockeyball.js';

const CX = -0.8;
const HALF_W = 0.62;
const GOAL_H = 2.02;
const POST = 0.05;
const NORTH_Z = -1.9;
const SOUTH_Z = 1.35;
const FACE_LOCAL = new THREE.Vector3(0.016, -0.8, 0.02);
const FACE_N = new THREE.Vector3(1, 0, 0);
const FACE_TOE = new THREE.Vector3(0, 0, 1);
const FACE_UP = new THREE.Vector3(0, 1, 0);
const SHAFT_A = new THREE.Vector3(0, -0.02, 0);
const SHAFT_B = new THREE.Vector3(0, -0.76, 0);
// Bottom edge of the head: heel, middle, toe. The toe is what digs in on an undercut.
const SOLE = [
  new THREE.Vector3(0.016, -0.827, -0.085),
  new THREE.Vector3(0.016, -0.827, 0.02),
  new THREE.Vector3(0.016, -0.827, 0.125),
];

function woodSign(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#6a4a30';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#3a2818';
  ctx.lineWidth = 16;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  ctx.fillStyle = '#f3ead8';
  ctx.font = '600 86px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.72 });
}

function addPost(posts, x, z) {
  posts.push({
    x0: x - POST / 2,
    x1: x + POST / 2,
    z0: z - POST / 2,
    z1: z + POST / 2,
    y0: 0,
    y1: GOAL_H,
    why: 'goal',
  });
}

export function createHockey(scene, targets) {
  const posts = [];
  const northZ0 = NORTH_Z - 0.34;
  const southZ1 = SOUTH_Z + 0.34;
  addPost(posts, CX - HALF_W, (NORTH_Z + northZ0) / 2);
  addPost(posts, CX + HALF_W, (NORTH_Z + northZ0) / 2);
  addPost(posts, CX - HALF_W, (SOUTH_Z + southZ1) / 2);
  addPost(posts, CX + HALF_W, (SOUTH_Z + southZ1) / 2);

  const solids = [];
  const addBox = (x0, x1, y0, y1, z0, z1, e = 0.52, mu = 0.4) => {
    solids.push({ x0, x1, y0, y1, z0, z1, e, mu });
  };
  addBox(CX - HALF_W, CX + HALF_W, GOAL_H - 0.04, GOAL_H + 0.02, northZ0, NORTH_Z, 0.46, 0.35);
  addBox(CX - HALF_W, CX + HALF_W, GOAL_H - 0.04, GOAL_H + 0.02, SOUTH_Z, southZ1, 0.46, 0.35);
  addBox(CX - HALF_W, CX + HALF_W, 0, GOAL_H, northZ0 - 0.04, northZ0, 0.2, 0.5);
  addBox(CX - HALF_W, CX + HALF_W, 0, GOAL_H, southZ1, southZ1 + 0.04, 0.2, 0.5);
  // the hall ceiling and the start-room ceiling, so a high ball comes back down
  addBox(0.46, 3.25, 2.64, 3.26, -3.28, 3.28, 0.4, 0.35);
  addBox(3.33, 4.88, 2.26, 2.42, -0.9, 1.14, 0.35, 0.4);

  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.55 });
  const tape = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.84 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1a, roughness: 0.45 });
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xe7e2d6, roughness: 0.38 });
  const pipe = new THREE.MeshStandardMaterial({ color: 0xd7d8d4, roughness: 0.35, metalness: 0.7 });
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xd9d3c4,
    roughness: 0.9,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });

  function goal(zLine, depthSign) {
    const group = new THREE.Group();
    const depth = 0.34;
    const zBack = zLine + depthSign * depth;
    const postH = GOAL_H;
    [-HALF_W, HALF_W].forEach((x) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(POST / 2, POST / 2, postH, 8), pipe);
      mesh.position.set(CX + x, postH / 2, (zLine + zBack) / 2);
      mesh.castShadow = true;
      group.add(mesh);
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + POST, 0.045, POST), pipe);
    bar.position.set(CX, GOAL_H, (zLine + zBack) / 2);
    bar.castShadow = true;
    group.add(bar);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, GOAL_H), netMat);
    net.position.set(CX, GOAL_H / 2, zBack);
    group.add(net);
    scene.add(group);
  }
  goal(NORTH_Z, -1);
  goal(SOUTH_Z, 1);

  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.03), woodSign('ELOISE'));
  sign.position.set(CX, 1.35, NORTH_Z - 0.2);
  sign.castShadow = true;
  scene.add(sign);

  const stick = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.74, 8), white);
  shaft.position.y = -0.39;
  stick.add(shaft);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 8), tape);
  wrap.position.y = -0.16;
  stick.add(wrap);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.058, 0.22), headMat);
  back.position.set(-0.004, -0.8, 0.02);
  stick.add(back);
  const playing = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.054, 0.21), faceMat);
  playing.position.copy(FACE_LOCAL);
  stick.add(playing);
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.04, 0.05), headMat);
  toe.position.set(0.002, -0.78, 0.145);
  toe.rotation.x = -0.5;
  stick.add(toe);
  const grip = new THREE.Group();
  grip.position.set(0, -0.02, 0);
  grip.visible = false;
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9956b, roughness: 0.66 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.04), skin);
  grip.add(palm);
  stick.add(grip);
  stick.position.set(1.55, 0.02, 0.2);
  stick.rotation.z = Math.PI / 2;
  stick.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  stick.userData = {
    type: 'gear',
    gear: 'stick',
    floorY: 0.02,
    grip,
    holdPos: new THREE.Vector3(0, -0.02, -0.03),
    holdRot: new THREE.Euler(0.87, 0, 0),
    restRot: stick.rotation.clone(),
    carried: false,
  };
  scene.add(stick);
  targets.push(stick);

  const ballMat = new THREE.MeshStandardMaterial({ color: 0xffe14a, roughness: 0.42 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), ballMat);
  ballMesh.castShadow = true;
  const seam = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 0.98, 0.0016, 6, 28), seamMat);
  ballMesh.add(seam);
  const seam2 = seam.clone();
  seam2.rotation.y = Math.PI / 2;
  ballMesh.add(seam2);
  scene.add(ballMesh);

  const spawn = { x: CX, y: BALL_R, z: -0.15 };
  const ball = createBallState(spawn.x, spawn.y, spawn.z);
  const face = {
    c: { x: 0, y: 0, z: 0 },
    n: { x: 1, y: 0, z: 0 },
    toe: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
    halfToe: 0.105,
    halfUp: 0.027,
    v: { x: 0, y: 0, z: 0 },
    w: { x: 0, y: 0, z: 0 },
    sweep: 0,
    shaft: {
      a: { x: 0, y: 0, z: 0 },
      b: { x: 0, y: 0, z: 0 },
      r: 0.015,
    },
  };
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
  const holdQuat = new THREE.Quaternion().setFromEuler(stick.userData.holdRot);
  let havePrev = false;
  let pushArmed = true;
  let turfArmed = true;
  let turf = null;
  let northSide = false;
  let southSide = false;
  let goals = 0;

  function worldDir(local, target) {
    return target.copy(local).transformDirection(stick.matrixWorld);
  }

  function readFace() {
    stick.updateWorldMatrix(true, false);
    worldA.copy(FACE_LOCAL).applyMatrix4(stick.matrixWorld);
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
    worldA.copy(SHAFT_A).applyMatrix4(stick.matrixWorld);
    worldB.copy(SHAFT_B).applyMatrix4(stick.matrixWorld);
    face.shaft.a.x = worldA.x;
    face.shaft.a.y = worldA.y;
    face.shaft.a.z = worldA.z;
    face.shaft.b.x = worldB.x;
    face.shaft.b.y = worldB.y;
    face.shaft.b.z = worldB.z;
  }

  // Pivot the head up around the hands until every sole point is on the floor.
  function catchFloor(floorAt, waterY) {
    if (!stick.userData.carried || !stick.parent) return 0;
    let worst = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      stick.updateWorldMatrix(true, false);
      stick.getWorldPosition(gripV);
      let dug = null;
      for (const local of SOLE) {
        soleW.copy(local).applyMatrix4(stick.matrixWorld);
        const floorY = floorAt(soleW.x, soleW.z, soleW.y);
        if (floorY == null || floorY <= waterY + 0.05) continue;
        const hit = soleCatch(gripV, soleW, floorY);
        if (hit.pen > (dug?.pen ?? 0)) dug = hit;
      }
      if (!dug || dug.pen <= 0.001 || !dug.axis || dug.angle <= 1e-4) break;
      worst = Math.max(worst, dug.pen);
      axis.set(dug.axis.x, dug.axis.y, dug.axis.z);
      catchQ.setFromAxisAngle(axis, dug.angle);
      stick.getWorldQuaternion(worldQ).premultiply(catchQ);
      stick.parent.getWorldQuaternion(parentQ).invert();
      stick.quaternion.copy(parentQ).multiply(worldQ);
    }
    return worst;
  }

  function syncPose(dt, motion, floorAt, waterY) {
    if (stick.userData.carried) {
      stick.quaternion.copy(holdQuat);
      stick.position.copy(stick.userData.holdPos);
    }
    readFace();
    if (motion?.held && motion.v) {
      stick.getWorldPosition(gripV);
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
      turf = dragged.kill > 0.18 ? { kill: dragged.kill, at: { x: face.c.x, y: face.c.y, z: face.c.z } } : null;
    } else turf = null;
  }

  function inMouth(x, y) {
    return x > CX - HALF_W + POST && x < CX + HALF_W - POST && y > BALL_R && y < GOAL_H - 0.05;
  }

  function update(dt, { colliders = [], groundUnder = null, waterY = -8, motion = null } = {}) {
    const floorAt = (x, z, y) => {
      if (!groundUnder) return y > -0.5 ? 0 : null;
      if (y >= 3.05 || y < -0.8) return groundUnder(x, z, y);
      return groundUnder(x, z, 0.2);
    };
    if (!stick.visible || stick.position.y < -5) havePrev = false;
    else syncPose(dt, motion, floorAt, waterY);
    const useFace = stick.visible && stick.position.y > -5;
    const boxes = colliders.length ? solids.concat(colliders) : solids;
    const events = stepBall(ball, dt, {
      face: useFace ? face : null,
      boxes,
      waterY,
      floorAt,
    });
    if (!Number.isFinite(ball.p.y) || ball.p.y < -30 || ball.p.y > 40) {
      ball.p.x = spawn.x;
      ball.p.y = spawn.y;
      ball.p.z = spawn.z;
      ball.v.x = ball.v.y = ball.v.z = 0;
      ball.w.x = ball.w.y = ball.w.z = 0;
      ball.asleep = false;
    }
    ballMesh.position.set(ball.p.x, ball.p.y, ball.p.z);
    const spin = Math.hypot(ball.w.x, ball.w.y, ball.w.z);
    if (spin > 0.2) {
      axis.set(ball.w.x, ball.w.y, ball.w.z).multiplyScalar(1 / spin);
      ballMesh.rotateOnWorldAxis(axis, spin * dt);
    }
    const scored = [];
    const inN = ball.p.z < NORTH_Z && inMouth(ball.p.x, ball.p.y);
    const inS = ball.p.z > SOUTH_Z && inMouth(ball.p.x, ball.p.y);
    if (inN && !northSide && ball.v.z < 0) scored.push('north');
    if (inS && !southSide && ball.v.z > 0) scored.push('south');
    northSide = inN;
    southSide = inS;
    const out = [];
    let pushed = false;
    for (const event of events) {
      if (event.type === 'push') pushed = true;
      else out.push({ ...event, at: { x: ball.p.x, y: ball.p.y, z: ball.p.z } });
    }
    if (pushed && pushArmed) out.push({ type: 'push', speed: 1, at: { x: ball.p.x, y: ball.p.y, z: ball.p.z } });
    pushArmed = !pushed;
    if (turf && turfArmed) out.push({ type: 'turf', kill: turf.kill, at: turf.at });
    turfArmed = !turf;
    for (const which of scored) {
      goals += 1;
      out.push({ type: 'goal', which, goals, at: { x: ball.p.x, y: ball.p.y, z: ball.p.z } });
    }
    return out;
  }

  return { update, stick, posts, ball: ballMesh };
}
