// Golf grip pass: how a club (driver) or the hockey stick sits in the hand, the VR-golf way.
//  - One hand: the club hangs off the controller GRIP space (the fist, not the pointing ray). The grip end is in
//    the fist and the shaft runs out of the thumb side of the fist (toward the head), along the controller handle
//    tilted 30 deg toward the forearm. The face looks along the palm of the trail hand / back of the lead hand
//    (grip -X for a right-handed golfer, +X with ?golfhand=left). Held at a natural address (hands in front of the
//    belt, forearms hanging) the head sits on the ground behind the ball, face square, the driver's 58 deg lie flat.
//  - Two hands: when the other fist grabs just below, the shaft runs from the top hand through the lower one; the
//    face keeps the top hand's roll. Only the correction from the one-hand pose is smoothed (a one-euro filter:
//    ~0.13 s when the hands hold their relation, a few ms when the lower hand really moves), so a swing (both fists
//    turning together) is never lagged and tracking noise between two close fists is not amplified into the head.
//  - Length fit: hold the club still at address with the head near or in the ground for 1 s and the shaft is
//    lengthened/shortened so the head rests on the ground (any player height). ?golflen=0 turns it off,
//    ?golflen=<cm> fixes the extension.
// ?golf=old restores the 59e7c4b hold (club along the pointing ray, face = controller top) and its strike.
import * as THREE from 'three';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
// ?golf= mode. Two-grip pass: default 'twogrip'; 'old' = the 5fad730 grip hold (createHold); 'onehand' = the two-grip
// hold with the second hand ignored (one-hand / putting-style swings); 'legacy' = the 59e7c4b pointing hold.
export const golfMode = () => {
  const g = params.get('golf');
  return g === 'legacy' || g === 'old' || g === 'onehand' ? g : 'twogrip';
};
export const golfOld = () => golfMode() === 'legacy'; // the 59e7c4b hold and strike (no grip pass at all)
export const golfLefty = () => params.get('golfhand') === 'left';
export const golfLenParam = () => params.get('golflen');

const DEG = Math.PI / 180;
export const GRIP_TILT = 30 * DEG; // shaft = grip -Z (pinky -> thumb) tilted toward grip -Y (the forearm)
export const BUTT_IN_FIST = 0.01; // the fist centre sits 1 cm down the grip from the club origin
const REST = 0.01; // the fitted sole rests 1 cm over the ground, just clear of the turf clamp (8 mm)

// Club frame (both clubs): origin = grip hold point, shaft toward the head = -Y, face = +X, toe side = +Z.
// faceSign -1: right-handed golfer (face = grip -X), +1: left-handed.
export function holdQuat(faceSign, tilt = GRIP_TILT) {
  const Y = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt)); // up the shaft, toward the butt
  const X = new THREE.Vector3(faceSign, 0, 0);
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

export function holdOffset(q, butt = BUTT_IN_FIST) {
  return new THREE.Vector3(0, butt, 0).applyQuaternion(q);
}

// Meta Touch Plus ray->grip offset (the WebXR grip space relative to the target ray; IWER's Quest 3 profile).
// Used only when a frame has no grip pose (e.g. a dropped grip space): ray * GRIP_FROM_RAY ~= grip.
const RIGHT_GRIP = new THREE.Matrix4().fromArray([
  0.9925461411476135, -2.6238110351073374e-8, 0.12186934053897858, 0,
  -0.0861746147274971, 0.7071067690849304, 0.7018360495567322, 0,
  -0.08617465943098068, -0.7071067094802856, 0.701836109161377, 0,
  0.003979838453233242, -0.015857869759202003, 0.04964182525873184, 1,
]);
const LEFT_GRIP = new THREE.Matrix4().fromArray([
  0.9925461411476135, 1.0736208366779465e-8, -0.12186933308839798, 0,
  0.08617459982633591, 0.70710688829422, 0.7018360495567322, 0,
  0.08617466688156128, -0.7071067094802856, 0.7018362283706665, 0,
  -0.003979803062975407, -0.015857873484492302, 0.04964187368750572, 1,
]);

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

// World pose of the fist holding `controller` (the three.js target-ray group): the grip group when it is tracked,
// else the ray pose times the Touch Plus grip offset. Returns false when there is no controller pose at all.
export function fistPose(controller, outP, outQ) {
  if (!controller) return false;
  const grip = controller.userData?.grip;
  if (grip && grip.visible && controller.userData?.inputSource) {
    grip.updateWorldMatrix(true, false);
    grip.matrixWorld.decompose(outP, outQ, _s);
    return true;
  }
  if (!controller.userData?.inputSource) return false;
  controller.updateWorldMatrix(true, false);
  const left = controller.userData.inputSource.handedness === 'left';
  _m.multiplyMatrices(controller.matrixWorld, left ? LEFT_GRIP : RIGHT_GRIP);
  _m.decompose(outP, outQ, _s);
  return true;
}

// Per-club hand solver. opts: { faceSign, tilt, butt, twoHandMin, twoHandFull, smooth }
export function createHold(opts = {}) {
  const q = holdQuat(opts.faceSign ?? -1, opts.tilt ?? GRIP_TILT);
  const off = holdOffset(q, opts.butt ?? BUTT_IN_FIST);
  const minCut = opts.minCutoff ?? 1.2; // Hz, while the hands keep their relation
  const beta = opts.beta ?? 4; // cutoff gain per rad/s of change
  const twoMin = opts.twoHandMin ?? 0.05;
  const twoFull = opts.twoHandFull ?? 0.09;
  const fistP = new THREE.Vector3();
  const fistQ = new THREE.Quaternion();
  const offP = new THREE.Vector3();
  const offQ = new THREE.Quaternion();
  const one = new THREE.Quaternion();
  const corr = new THREE.Quaternion(); // smoothed correction, in the lead fist's frame
  const want = new THREE.Quaternion();
  const s1 = new THREE.Vector3();
  const s2 = new THREE.Vector3();
  const d = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const restLocal = new THREE.Vector3();
  const _iq = new THREE.Quaternion();
  const _id = new THREE.Quaternion();
  let restFor = null;
  let restW = 0;
  const parentInv = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const outP = new THREE.Vector3();
  const outQ = new THREE.Quaternion();
  const state = { twoHand: false, weight: 0, p: new THREE.Vector3(), q: new THREE.Quaternion() };
  let rate = 0; // filtered angular rate of the wanted correction (rad/s)
  const lastWant = new THREE.Quaternion();
  const alphaOf = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

  // Writes club.position/quaternion (local to club.parent, the target-ray group) and returns the club world pose
  // in state.p/state.q. extUp: how far the club is slid up through the fist (negative: longer reach; unused here).
  function apply(club, lead, offHand, dt) {
    if (!fistPose(lead, fistP, fistQ)) return null;
    one.copy(fistQ).multiply(q);
    let w = 0;
    if (offHand && offHand !== lead && fistPose(offHand, offP, offQ)) {
      d.copy(offP).sub(fistP);
      const len = d.length();
      if (restFor !== offHand) {
        // Grab-time relation of the two fists, kept in the lead fist's frame. Steering is relative to it: two
        // Touch controllers can't sit co-axially on a virtual grip, so the raw hand-to-hand line is never quite the
        // shaft; measured from the grab, the second hand neither pops the club nor bends it, it only steers.
        restFor = offHand;
        restLocal.copy(d).applyQuaternion(_iq.copy(fistQ).invert());
        s1.set(0, -1, 0).applyQuaternion(one);
        const ang = len > 1e-4 ? Math.acos(Math.max(-1, Math.min(1, d.dot(s1) / len))) : Math.PI;
        restW = THREE.MathUtils.smoothstep(len, twoMin, twoFull) * (1 - THREE.MathUtils.smoothstep(ang, 55 * DEG, 75 * DEG));
      }
      if (restW > 0 && len > 1e-4) {
        s2.copy(restLocal).applyQuaternion(fistQ).normalize();
        d.multiplyScalar(1 / len);
        tmpQ.setFromUnitVectors(s2, d);
        tmpQ.copy(_id.slerp(tmpQ, restW));
        _id.identity();
        want.copy(fistQ).invert().multiply(tmpQ).multiply(fistQ); // the same rotation, in the fist frame
        w = restW;
      } else want.identity();
    } else {
      want.identity();
      restFor = null;
    }
    if (dt > 0) {
      const raw = lastWant.angleTo(want) / dt;
      rate += (raw - rate) * alphaOf(1, dt);
      corr.slerp(want, alphaOf(minCut + beta * rate, dt));
    } else corr.copy(want);
    lastWant.copy(want);
    state.twoHand = w > 0.5;
    state.weight = w;
    // world pose: fist * corr * hold
    outQ.copy(fistQ).multiply(corr).multiply(q);
    outP.copy(off).applyQuaternion(fistQ.clone().multiply(corr)).add(fistP);
    state.p.copy(outP);
    state.q.copy(outQ);
    const parent = club.parent;
    parent.updateWorldMatrix(true, false);
    parentInv.copy(parent.matrixWorld).invert();
    world.compose(outP, outQ, _s.set(1, 1, 1));
    world.premultiply(parentInv);
    world.decompose(club.position, club.quaternion, club.scale);
    club.scale.set(1, 1, 1);
    return state;
  }
  function reset() {
    corr.identity();
    lastWant.identity();
    rate = 0;
    restFor = null;
    restW = 0;
    state.twoHand = false;
    state.weight = 0;
  }
  return { apply, reset, state, holdQ: q, holdP: off };
}

// Length fit. Feed it every carried frame; returns a new extension (m) when it decides to change it.
export function createFit({ min = -0.3, max = 0.2, hold = 1.0, still = 0.35, near = 0.2, deep = 0.3 } = {}) {
  let timer = 0;
  let last = null;
  const mode = golfLenParam();
  const fixed = mode != null && mode !== '' && mode !== '0' && Number.isFinite(+mode) ? THREE.MathUtils.clamp(+mode / 100, min, max) : null;
  const off = mode === '0';
  return {
    fixed,
    off: off || fixed != null,
    // gap: lowest sole point above the ground before any clamp (m); speed: head speed (m/s);
    // fromVertical: shaft angle off vertical (rad); cosDrop: vertical drop per metre of extension
    update(dt, { ext, gap, speed, fromVertical, cosDrop }) {
      if (off || fixed != null || gap == null) { timer = 0; return null; }
      const ok = speed < still && gap < near && gap > -deep && fromVertical > 12 * DEG && fromVertical < 65 * DEG && cosDrop > 0.3;
      if (!ok) { timer = 0; last = null; return null; }
      timer += dt;
      last = gap;
      if (timer < hold) return null;
      timer = 0;
      const target = THREE.MathUtils.clamp(ext + (last - REST) / cosDrop, min, max);
      if (Math.abs(target - ext) < 0.012) return null;
      return target;
    },
    reset() { timer = 0; last = null; },
  };
}

// Stretch a club along its shaft: vertices below y0 (in the ROOT's frame) move down by ext, ramping in between y0
// and y1 (the grip stays put, the shaft stretches, the head moves rigidly). Works for the GLB model and for the
// procedural parts (meshes with their own transforms under the root). Clones each geometry once (templates are
// shared). Two-grip pass: the fit used to need the GLB, so a build whose models failed to load (no Draco decoders,
// ?models=0, ?legacy=clubs) had no fit at all and the stick hook floated 11 cm over the floor.
export function makeStretch(root, y0, y1, skip = null) {
  const parts = [];
  if (!root) return { get ext() { return 0; }, set() {} };
  root.updateMatrix();
  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position || skip?.(child)) return;
    const m = new THREE.Matrix4();
    for (let o = child; o && o !== root; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
    child.geometry = child.geometry.clone();
    const pos = child.geometry.attributes.position;
    parts.push({ mesh: child, pos, base: Float32Array.from(pos.array), m, mi: m.clone().invert(), id: m.equals(new THREE.Matrix4()) });
  });
  const v = new THREE.Vector3();
  let ext = 0;
  return {
    get ext() { return ext; },
    set(next) {
      if (Math.abs(next - ext) < 1e-5 || !parts.length) { ext = next; return; }
      ext = next;
      for (const part of parts) {
        const { pos, base, m, mi, id } = part;
        for (let i = 0; i < pos.count; i += 1) {
          v.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
          if (!id) v.applyMatrix4(m);
          const k = THREE.MathUtils.clamp((y0 - v.y) / (y0 - y1), 0, 1);
          v.y -= ext * k;
          if (!id) v.applyMatrix4(mi);
          pos.array[i * 3] = v.x; pos.array[i * 3 + 1] = v.y; pos.array[i * 3 + 2] = v.z;
        }
        pos.needsUpdate = true;
        part.mesh.geometry.computeBoundingSphere();
        part.mesh.geometry.computeBoundingBox();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Two-grip pass: the club is held at two fixed grip points, the way a right-handed golfer holds it.
//  - TOP grip (club y = -butt, near the butt end): the LEFT hand (right hand with ?golfhand=left).
//  - LOWER grip, `gap` further down the shaft (0.09 m driver: hands touching; 0.35 m hockey stick): the other hand.
//  Each hand goes to its own grip whichever grabs first: one hand alone holds the club at its own grip point, at the
//  natural grip angle (holdQuat), and the empty grip shows a ghost fist.
//  - Both hands: the shaft is the line from the lower fist to the top fist (direction only, so 4-12 cm or 30-40 cm
//    between real controllers all work) and the club is anchored at the top fist. The lower fist's sideways offset
//    from the shaft when it lands (up to 5 cm; real controllers are never co-axial) is held in the club frame. The roll of the face about the shaft
//    is NOT read from either controller: a face frame is carried along with the shaft (minimal rotation per frame)
//    and only turned when BOTH hands agree that it turned (same sign; the smaller of the two), so wrist roll noise
//    on one controller cannot spin the club, while both forearms rotating together (a real face rotation) does.
//  - Smoothing: a One Euro filter on the club orientation (min cutoff 0.5 Hz at rest, + 20 Hz per rad/s: a constant ~0.45 deg lag at any swing speed), so the
//    head is still at address and lag-free at swing speed; mode changes (one <-> two hands) blend over 0.2 s.
export function createTwoGrip(opts = {}) {
  const q = holdQuat(opts.faceSign ?? -1, opts.tilt ?? GRIP_TILT);
  const butt = opts.butt ?? BUTT_IN_FIST;
  const gap = opts.gap ?? 0.09;
  const topSide = opts.topSide ?? 'left';
  const oneOnly = !!opts.onehand;
  const minCut = opts.minCutoff ?? 0.5;
  const beta = opts.beta ?? 20;
  const near = opts.twoHandMin ?? 0.02;
  const full = opts.twoHandFull ?? 0.035;
  const P1 = new THREE.Vector3(); const Q1 = new THREE.Quaternion();
  const P2 = new THREE.Vector3(); const Q2 = new THREE.Quaternion();
  const pT = new THREE.Vector3(); const qT = new THREE.Quaternion();
  const pL = new THREE.Vector3(); const qL = new THREE.Quaternion();
  const sUp = new THREE.Vector3(); const prevS = new THREE.Vector3();
  const faceRef = new THREE.Vector3(); const fT = new THREE.Vector3(); const fL = new THREE.Vector3();
  const zA = new THREE.Vector3(); const tmp = new THREE.Vector3(); const tq = new THREE.Quaternion();
  const ta = new THREE.Vector3(); const R = new THREE.Quaternion(); const basis = new THREE.Matrix4();
  const offQ = new THREE.Quaternion(); const offP = new THREE.Vector3(); const blendQ = new THREE.Quaternion();
  const dq = new THREE.Quaternion(); const wv = new THREE.Vector3(); const wRaw = new THREE.Vector3();
  const yC = new THREE.Vector3(); const sideOff = new THREE.Vector3(); const maxSide = opts.maxSide ?? 0.05;
  const ident = new THREE.Quaternion(); const hq = new THREE.Quaternion(); const prevTarget = new THREE.Quaternion(); const qf = new THREE.Quaternion();
  const outP = new THREE.Vector3(); const outQ = new THREE.Quaternion();
  const parentInv = new THREE.Matrix4(); const world = new THREE.Matrix4();
  const state = { twoHand: false, weight: 0, mode: null, missing: null, faceErr: [0, 0], p: new THREE.Vector3(), q: new THREE.Quaternion() };
  let haveFace = false; let oT = 0; let oL = 0; let lastMode = null; let blend = 1; let haveF = false;
  const alphaOf = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  const sideOf = (c) => c?.userData?.inputSource?.handedness ?? null;
  // signed angle from a to b about axis (a, b perpendicular to axis)
  const signed = (a, b, axis) => Math.atan2(tmp.crossVectors(a, b).dot(axis), a.dot(b));
  const handFace = (Q, out) => {
    out.set(1, 0, 0).applyQuaternion(hq.copy(Q).multiply(q)); // the face this hand alone would give
    out.addScaledVector(sUp, -out.dot(sUp));
    return out.lengthSq() > 1e-8 ? out.normalize() : null;
  };
  // both hands must turn the same way by about the same amount (3 deg + 25 %) or the face does not turn
  const agree = (a, b) => {
    if (a * b <= 0) return 0;
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) > 3 * DEG + 0.25 * m) return 0;
    return Math.sign(a) * Math.min(Math.abs(a), Math.abs(b));
  };

  function apply(club, lead, offHand, dt) {
    if (!fistPose(lead, P1, Q1)) return null;
    let two = !oneOnly && !!offHand && offHand !== lead && fistPose(offHand, P2, Q2);
    const ls = sideOf(lead);
    let leadTop = ls ? ls === topSide : true;
    if (two && ls === sideOf(offHand)) leadTop = true;
    let w = 0;
    if (two) {
      if (leadTop) { pT.copy(P1); qT.copy(Q1); pL.copy(P2); qL.copy(Q2); } else { pT.copy(P2); qT.copy(Q2); pL.copy(P1); qL.copy(Q1); }
      sUp.copy(pT).sub(pL);
      const len = sUp.length();
      w = THREE.MathUtils.smoothstep(len, near, full);
      if (w < 0.5 || len < 1e-4) two = false;
      else {
        // Real fists are never exactly co-axial: the lower fist's sideways offset from the shaft at the moment it
        // lands is kept in the club's own (roll-locked) frame and taken off its position, so landing the second
        // hand neither pops nor tilts the club, and wrist roll cannot swing the offset around.
        if (!haveFace && haveF) {
          yC.set(0, 1, 0).applyQuaternion(qf);
          sideOff.copy(pL).sub(pT);
          sideOff.addScaledVector(yC, -sideOff.dot(yC));
          if (sideOff.length() > maxSide) sideOff.setLength(maxSide);
          sideOff.applyQuaternion(hq.copy(qf).invert());
        } else if (!haveFace) sideOff.set(0, 0, 0);
        tmp.copy(sideOff).applyQuaternion(qf);
        sUp.copy(pT).sub(pL).add(tmp).normalize();
      }
    }
    let mode;
    if (!two) {
      tq.copy(Q1).multiply(q);
      ta.set(0, leadTop ? butt : butt + gap, 0).applyQuaternion(tq).add(P1);
      haveFace = false;
      mode = leadTop ? 'top' : 'lower';
    } else {
      mode = 'two';
      if (!haveFace) {
        // continuity: start from the face of whatever is showing now, then calibrate each hand against it
        faceRef.set(1, 0, 0).applyQuaternion(haveF ? qf : hq.copy(qT).multiply(q));
        faceRef.addScaledVector(sUp, -faceRef.dot(sUp));
        if (faceRef.lengthSq() < 1e-8) handFace(qT, faceRef); else faceRef.normalize();
        oT = handFace(qT, fT) ? signed(faceRef, fT, sUp) : 0;
        oL = handFace(qL, fL) ? signed(faceRef, fL, sUp) : 0;
        haveFace = true;
      } else {
        R.setFromUnitVectors(prevS, sUp);
        faceRef.applyQuaternion(R);
        faceRef.addScaledVector(sUp, -faceRef.dot(sUp)).normalize();
        const eT = handFace(qT, fT) ? signed(faceRef, fT, sUp) - oT : 0;
        const eL = handFace(qL, fL) ? signed(faceRef, fL, sUp) - oL : 0;
        const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
        const e = agree(wrap(eT), wrap(eL));
        state.faceErr[0] = eT; state.faceErr[1] = eL;
        if (e) faceRef.applyAxisAngle(sUp, e);
      }
      prevS.copy(sUp);
      zA.crossVectors(faceRef, sUp).normalize();
      tq.setFromRotationMatrix(basis.makeBasis(faceRef, sUp, zA));
      ta.copy(sUp).multiplyScalar(butt).add(pT);
    }
    // mode change: blend from what was showing over 0.2 s (no pop when the second hand lands or lets go)
    if (lastMode && mode !== lastMode && haveF) {
      offQ.copy(outQ).multiply(blendQ.copy(tq).invert());
      offP.copy(outP).sub(ta);
      blend = 0;
    }
    lastMode = mode;
    if (blend < 1) {
      blend = Math.min(1, blend + dt / 0.2);
      const k = 1 - THREE.MathUtils.smoothstep(blend, 0, 1);
      blendQ.slerpQuaternions(ident, offQ, k);
      tq.premultiply(blendQ);
    }
    // One Euro on the orientation. The speed term is the low-passed angular VELOCITY vector (signed), so tracking
    // noise averages out of it and only a real turn opens the filter up.
    if (!haveF || dt <= 0) { qf.copy(tq); wv.set(0, 0, 0); haveF = true; } else {
      dq.copy(prevTarget).invert().premultiply(tq); // world-frame delta
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      const sn = Math.hypot(dq.x, dq.y, dq.z);
      const ang = 2 * Math.atan2(sn, dq.w);
      if (sn > 1e-9) wRaw.set(dq.x, dq.y, dq.z).multiplyScalar(ang / sn / dt); else wRaw.set(0, 0, 0);
      wv.lerp(wRaw, alphaOf(1.2, dt));
      qf.slerp(tq, alphaOf(minCut + beta * wv.length(), dt));
    }
    prevTarget.copy(tq);
    outQ.copy(qf);
    // the holding fist stays exactly on its grip point: position from the FILTERED orientation
    if (mode === 'two') outP.set(0, butt, 0).applyQuaternion(qf).add(pT);
    else outP.set(0, leadTop ? butt : butt + gap, 0).applyQuaternion(qf).add(P1);
    if (blend < 1) outP.addScaledVector(offP, 1 - THREE.MathUtils.smoothstep(blend, 0, 1));
    state.twoHand = mode === 'two';
    state.weight = mode === 'two' ? w : 0;
    state.mode = mode;
    state.missing = oneOnly ? null : (mode === 'two' ? null : (leadTop ? 'lower' : 'top'));
    state.p.copy(outP);
    state.q.copy(outQ);
    const parent = club.parent;
    parent.updateWorldMatrix(true, false);
    parentInv.copy(parent.matrixWorld).invert();
    world.compose(outP, outQ, _s.set(1, 1, 1));
    world.premultiply(parentInv);
    world.decompose(club.position, club.quaternion, club.scale);
    club.scale.set(1, 1, 1);
    return state;
  }
  function reset() {
    haveFace = false; haveF = false; lastMode = null; blend = 1;
    state.twoHand = false; state.weight = 0; state.mode = null; state.missing = null;
  }
  return { apply, reset, state, holdQ: q, grips: [-butt, -butt - gap] };
}

// Ghost fists on the two grip points: shown on the EMPTY grip while one hand holds the club (the prompt to add the
// second hand), pulsing; hidden when both hands are on or the club is down. Top = cool blue, lower = warm amber.
export function createGhosts(club, grips) {
  const mk = (color) => {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false });
    const fist = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.085, 14, 1, true), mat);
    g.add(fist);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.003, 6, 20), mat);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.05), mat);
    knuckles.position.x = -0.035;
    g.add(knuckles);
    g.visible = false;
    g.renderOrder = 3;
    g.userData.mat = mat;
    club.add(g);
    return g;
  };
  const top = mk(0x7fc8ff); top.position.y = grips[0] - 0.035;
  const low = mk(0xffb45a); low.position.y = grips[1] - 0.035;
  let t = 0;
  return {
    top, low,
    update(dt, carried, missing) {
      t += dt;
      top.visible = !!carried && missing === 'top';
      low.visible = !!carried && missing === 'lower';
      const a = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(t * 5));
      top.userData.mat.opacity = a; low.userData.mat.opacity = a;
    },
  };
}
