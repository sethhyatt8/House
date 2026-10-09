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
export const golfOld = () => params.get('golf') === 'old';
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

// Stretch a club model along its shaft: vertices below y0 move down by ext, ramping in between y0 and y1 (so the
// grip stays put, the shaft stretches, the head moves rigidly). Clones the geometry once (the template is shared).
export function makeStretch(root, y0, y1) {
  const parts = [];
  root?.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    child.geometry = child.geometry.clone();
    const pos = child.geometry.attributes.position;
    parts.push({ mesh: child, pos, base: Float32Array.from(pos.array) });
  });
  let ext = 0;
  return {
    get ext() { return ext; },
    set(next) {
      if (Math.abs(next - ext) < 1e-5 || !parts.length) { ext = next; return; }
      ext = next;
      for (const part of parts) {
        const { pos, base } = part;
        // the mesh may sit under the club with its own transform; the club models are authored at identity
        for (let i = 0; i < pos.count; i += 1) {
          const y = base[i * 3 + 1];
          const k = THREE.MathUtils.clamp((y0 - y) / (y0 - y1), 0, 1);
          pos.array[i * 3 + 1] = y - ext * k;
        }
        pos.needsUpdate = true;
        part.mesh.geometry.computeBoundingSphere();
        part.mesh.geometry.computeBoundingBox();
      }
    },
  };
}
