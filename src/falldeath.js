// Fall pass: big falls kill and reset (Seth: "if you fall, you should die and reset").
// - Lethal = landing after a free fall of more than LETHAL m (?falllethal=, default 6). The real drops: start-room /
//   cliff-room / yard floor (y 0) to the sea (-8) = 8 m and to the cliff shelf / cave floor (-7.92) = 7.9 m; roof
//   (3.26) to the floor = 3.3 m (safe); a lift-shaft stop is 3.6 m (safe), two stops 7.2 m (lethal); the crag summit /
//   overlook (33.42) to the roof = 30 m. Height = highest feet since you left the floor minus where you land.
// - Water landings from that height kill too, unless you wear the scuba tank (?fallscuba=any: any kit piece,
//   ?fallscuba=0: the kit never saves you). Small drops into the sea stay a swim.
// - A notch-line slide (letting go on the cliff notches or the crag face: a controlled slide, max 4.5 m/s) only kills
//   over SLIDE_LETHAL m (?slidelethal=, default 10): the 7.9 m sea-wall line stays a slide, a crag slide from high up
//   does not.
// - Safety net: feet below the lowest floor in the game (-20), off the map (|x|,|z| > 400), NaN, falling for more
//   than 6 s, or stuck inside a wall for more than 2 s -> the same death.
// - Death: a quick fade to black with a thud (or a big splash), 0.7 s of black, respawn at the last checkpoint (the
//   last spot you stood still-ish for 2 s on a safe floor: the start room, the cliff room, the yard, the roof, the
//   overlook), then fade back in. Inventory, the scuba kit and everything you carry stay with you.
// - Climbing, the canoe, swimming, the glider, lifts, mantles and teleports never count as falling: main.js resets
//   the tracker in all of those states, so only the free fall after you let go counts.
// ?falldeath=0 turns the whole thing off.
import * as THREE from 'three';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const num = (key, fallback) => {
  const value = Number(params.get(key));
  return params.has(key) && Number.isFinite(value) ? value : fallback;
};

export const FALLDEATH = params.get('falldeath') !== '0';
export const LETHAL = num('falllethal', 6);
export const SLIDE_LETHAL = num('slidelethal', 10);
export const SCUBA_RULE = params.get('fallscuba') || 'tank'; // 'tank' | 'any' | '0'
const VOID_Y = -20;
const MAP = 400;
const AIR_MAX = 6;
const STUCK_MAX = 2;
const CHECKPOINT_T = 2;
const FADE_OUT = 0.25;
const HOLD = 0.7;
const FADE_IN = 0.9;

export function createFallDeath({ camera, scene, sfx = null, pulse = null, setStatus = null, respawn, scubaSafe = () => false, home }) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false });
  const veil = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 10), mat);
  veil.renderOrder = 1000;
  veil.frustumCulled = false;
  veil.visible = false;
  veil.raycast = () => {};
  if (!camera.parent) scene.add(camera);
  camera.add(veil);

  const air = { on: false, top: 0, t: 0, slid: false };
  const cp = { ...home, zone: 'start' };
  const cand = { x: 0, z: 0, floor: 0, zone: null, t: 0 };
  let stuckT = 0;
  let death = null; // { t, why, height, water, respawned }
  const stats = { deaths: 0, last: null, checkpoints: 0 };

  function reset(feet = null) {
    air.on = false;
    air.t = 0;
    air.slid = false;
    air.top = feet != null ? feet : -Infinity;
  }

  function die(why, extra = {}) {
    if (!FALLDEATH || death) return false;
    death = { t: 0, why, respawned: false, ...extra };
    stats.deaths += 1;
    stats.last = { why, ...extra, at: { ...cp } };
    reset();
    stuckT = 0;
    veil.visible = true;
    if (extra.water) sfx?.play?.('splash_big', { gain: 0.9, rate: 0.8 });
    else {
      sfx?.play?.('hit_punch', { gain: 1, rate: 0.5 });
      sfx?.play?.('hit_soft', { gain: 0.9, rate: 0.55 });
    }
    pulse?.(1, 260);
    return true;
  }

  return {
    // the rig stands on a floor this frame
    ground(feet) {
      reset(feet);
    },
    // the rig is in the air this frame (feet = where it is now)
    air(feet, dt, sliding = false) {
      // the fall starts where the feet last stood; if the rig was moved since (a teleport that didn't reset), from here
      if (!air.on) { air.on = true; air.t = 0; air.top = Math.abs(air.top - feet) < 0.5 ? Math.max(air.top, feet) : feet; }
      air.top = Math.max(air.top, feet);
      air.t += dt;
      if (sliding) air.slid = true;
      if (air.t > AIR_MAX) die('falling', { height: +(air.top - feet).toFixed(2) });
    },
    // landed on `floor` (water: the open sea). Returns true when the landing kills (the caller skips swimming).
    land(floor, { water = false } = {}) {
      if (!air.on) { reset(floor); return false; }
      const height = air.top - floor;
      const limit = air.slid ? SLIDE_LETHAL : LETHAL;
      const saved = water && scubaSafe();
      reset(floor);
      if (!FALLDEATH || height <= limit) return false;
      if (saved) {
        setStatus?.('A long way down, but the dive kit takes the hit.');
        return false;
      }
      return die(water ? 'fall-water' : 'fall', { height: +height.toFixed(2), water });
    },
    reset,
    die,
    // every frame: safety net + the fade. head: world head position, feet: rig y. inside: head is inside a wall.
    update(dt, { head, feet, inside = false, active = true }) {
      if (death) {
        death.t += dt;
        const t = death.t;
        if (t < FADE_OUT) mat.opacity = t / FADE_OUT;
        else if (t < FADE_OUT + HOLD) {
          mat.opacity = 1;
          if (!death.respawned) {
            death.respawned = true;
            respawn({ ...cp }, death);
            setStatus?.(death.water ? 'You hit the water too hard. You come to where you last stood safe.'
              : death.why === 'fall' ? 'You fell too far. You come to where you last stood safe.'
                : 'You come to where you last stood safe.');
          }
        } else if (t < FADE_OUT + HOLD + FADE_IN) mat.opacity = 1 - (t - FADE_OUT - HOLD) / FADE_IN;
        else { mat.opacity = 0; veil.visible = false; death = null; }
        return;
      }
      if (!FALLDEATH || !active || !head) { stuckT = 0; return; }
      if (!Number.isFinite(feet) || !Number.isFinite(head.x) || !Number.isFinite(head.z)) { die('void'); return; }
      if (feet < VOID_Y || Math.abs(head.x) > MAP || Math.abs(head.z) > MAP) { die('void'); return; }
      stuckT = inside ? stuckT + dt : 0;
      if (stuckT > STUCK_MAX) die('stuck');
    },
    // a safe floor under you this frame (zone name) or null; a spot counts after CHECKPOINT_T s within 0.6 m
    stand(x, z, floor, zone, dt) {
      if (!zone || death) { cand.t = 0; cand.zone = null; return; }
      if (cand.zone !== zone || Math.abs(cand.floor - floor) > 0.05 || Math.hypot(x - cand.x, z - cand.z) > 0.6) {
        cand.x = x; cand.z = z; cand.floor = floor; cand.zone = zone; cand.t = 0;
        return;
      }
      cand.t += dt;
      if (cand.t >= CHECKPOINT_T) {
        if (cp.zone !== zone || Math.hypot(cp.x - cand.x, cp.z - cand.z) > 0.3 || cp.floor !== cand.floor) stats.checkpoints += 1;
        cp.x = cand.x; cp.z = cand.z; cp.floor = cand.floor; cp.zone = zone;
      }
    },
    dying: () => !!death,
    // in a free fall of more than `m` metres so far (main.js: falling past the canoe doesn't board it)
    falling: (feet, m = 1.2) => air.on && air.top - feet > m,
    checkpoint: () => ({ ...cp }),
    setCheckpoint(p) { Object.assign(cp, p); },
    debug: () => ({ air: { ...air }, death: death ? { ...death } : null, cp: { ...cp }, cand: { ...cand }, stuckT, stats: { ...stats }, opacity: mat.opacity, lethal: LETHAL, slideLethal: SLIDE_LETHAL, on: FALLDEATH }),
  };
}
