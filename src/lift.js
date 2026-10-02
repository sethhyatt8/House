// src/lift.js - mine-lift elevator (replaces the box-and-point-light lift from 2bf34b0).
// Same public API as the old addLift() return value (floorY, doorOpen, phase, dir, target, pendingMove, moving,
// shaft, carBox, floors, openDoor(), go(inside), arm(), update(dt) -> dy, floorAt()), plus:
//   speed (m/s, signed), stops, stopIndex(), floorGroups[], shaftGroup, car, lampWorld (Vector3, car lamp),
//   on(type, fn) events: 'depart' | 'arrive' | 'pass' | 'door', setStopVisible(index, bool).
// Lighting: NO PointLights. Lift materials get "material-local lamps": up to 5 warm lamps evaluated only in the lift's
// own shaders (4 landing lamps + the car lamp), and the scene's moonlight/env is faded out underground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LIFT_STOPS = [0, -3.6, -7.2, -10.8, -14.4];
const VMAX = 1.25;    // m/s cruise (old lift: constant 1.05)
const ACCEL = 0.7;    // m/s^2 start
const DECEL = 0.6;    // m/s^2 braking
const CREEP = 0.05;   // m/s minimum so the car always lands
const JERK = 2.2;     // m/s^3, softens the start of acceleration
// The paint-gallery tunnel (world.js createCliff -> gallery.tunnel, x 4.25..11.25, z 1.23..2.42, floor y -7.92).
// The old lift put a room of the -7.2 floor right across it. Rooms that touch this box are skipped.
const AVOID = [{ x0: 4.1, x1: 11.4, y0: -8.3, y1: -4.6, z0: 1.05, z1: 2.6 }];
const LAMP_COUNT = 5;

const lampUniforms = {
  uLampPos: { value: Array.from({ length: LAMP_COUNT }, () => new THREE.Vector3(0, -999, 0)) },
  uLampColor: { value: Array.from({ length: LAMP_COUNT }, () => new THREE.Color(0, 0, 0)) },
  uLampRange: { value: new Array(LAMP_COUNT).fill(5) },
  uLiftAbove: { value: 0.45 },   // scene light kept above ground (y > 0)
  uLiftBelow: { value: 0.0 },    // scene direct light kept underground
  uLiftAmbBelow: { value: 0.1 }, // env/hemi kept underground
};

// Clone a MeshStandardMaterial and give it the lift lamps. Textures are shared with the source (no extra VRAM).
export function liftLit(source, { tint = null, name = null } = {}) {
  const mat = source.clone();
  if (tint != null) mat.color.set(tint);
  if (name) mat.name = name;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lampUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLiftW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vec4 liftW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  liftW = instanceMatrix * liftW;
  #endif
  vLiftW = (modelMatrix * liftW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLiftW;
uniform vec3 uLampPos[${LAMP_COUNT}];
uniform vec3 uLampColor[${LAMP_COUNT}];
uniform float uLampRange[${LAMP_COUNT}];
uniform float uLiftAbove;
uniform float uLiftBelow;
uniform float uLiftAmbBelow;`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
  float liftSky = smoothstep(-1.4, 0.1, vLiftW.y);
  reflectedLight.directDiffuse *= mix(uLiftBelow, uLiftAbove, liftSky);
  reflectedLight.directSpecular *= mix(uLiftBelow, uLiftAbove, liftSky);
  for (int li = 0; li < ${LAMP_COUNT}; li++) {
    vec3 toLamp = uLampPos[li] - vLiftW;
    float dl = length(toLamp);
    if (dl < uLampRange[li]) {
      IncidentLight lamp;
      lamp.direction = normalize((viewMatrix * vec4(toLamp, 0.0)).xyz);
      lamp.color = uLampColor[li] * getDistanceAttenuation(dl, uLampRange[li], 2.0);
      lamp.visible = true;
      RE_Direct(lamp, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    }
  }`)
      .replace('#include <lights_fragment_end>', `  float liftAmb = mix(uLiftAmbBelow, 1.0, smoothstep(-1.4, 0.1, vLiftW.y));
  irradiance *= liftAmb;
  #if defined( RE_IndirectSpecular )
  radiance *= liftAmb;
  iblIrradiance *= liftAmb;
  #endif
#include <lights_fragment_end>`);
  };
  mat.customProgramCacheKey = () => 'liftLit';
  return mat;
}

// Planar world-space UVs per face (same convention as uv.js applyWorldUv), on already-placed geometry.
function worldUv(geo, tile) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)); const ay = Math.abs(nor.getY(i)); const az = Math.abs(nor.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, (nor.getX(i) > 0 ? -z : z) / tile, y / tile);
    else if (ay >= az) uv.setXY(i, x / tile, (nor.getY(i) > 0 ? -z : z) / tile);
    else uv.setXY(i, (nor.getZ(i) > 0 ? x : -x) / tile, y / tile);
  }
  return geo;
}

export function createLift(scene, back, targets, { assets = null, addGate, rockWall = null, rockFloor = null, timber = null } = {}) {
  const stops = LIFT_STOPS;
  const shaft = { x0: 5.18, x1: 6.58, z0: -0.52, z1: 0.76 };
  const carBox = { x0: 5.2, x1: 6.4, z0: -0.4, z1: 0.64 };
  const mid = (a, b) => (a + b) / 2;
  const t = 0.1;
  const crown = 2.35;
  const pit = stops[stops.length - 1] - 0.2;
  const roomH = 2.2;
  const floors = [];

  // ---- materials (procedural stand-ins until lift_kit.glb / rock / timber are ready) ----
  const std = (color, rough, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const M = {
    rock: liftLit(rockWall || std(0x3a332b, 1), { tint: rockWall ? 0x8c8278 : null, name: 'lift_rock' }),
    floor: liftLit(rockFloor || std(0x2f2a24, 1), { tint: rockFloor ? 0x7a7068 : null, name: 'lift_floor' }),
    timber: liftLit(timber || std(0x6e5340, 0.86), { tint: timber ? 0xb08a68 : null, name: 'lift_timber' }),
    tread: liftLit(std(0x55585c, 0.5, 0.85), { name: 'lift_tread' }),
    paint: liftLit(std(0x3d5a3c, 0.55, 0.4), { name: 'lift_paint' }),
    steel: liftLit(std(0x2a2b2d, 0.42, 1), { name: 'lift_steel' }),
  };
  // Upgrade a stand-in to the kit's textured material in place (same object, so meshes keep it).
  const fill = (dst, src) => {
    if (!src) return;
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) dst[key] = src[key] || null;
    dst.color.copy(src.color); dst.roughness = src.roughness; dst.metalness = src.metalness;
    if (src.normalScale) dst.normalScale.copy(src.normalScale);
    dst.needsUpdate = true;
  };

  // ---- static geometry, merged per (group, material) ----
  const buckets = new Map(); // key -> { group, mat, geos[] }
  const shaftGroup = new THREE.Group(); shaftGroup.name = 'lift_shaft';
  scene.add(shaftGroup);
  const floorGroups = stops.map((y, index) => {
    const g = new THREE.Group(); g.name = `lift_floor_${index}`; g.userData.liftStop = index;
    scene.add(g);
    return g;
  });
  const put = (group, matKey, geo, tile) => {
    const key = `${group.uuid}|${matKey}`;
    if (!buckets.has(key)) buckets.set(key, { group, mat: M[matKey], geos: [] });
    buckets.get(key).geos.push(tile ? worldUv(geo, tile) : geo);
  };
  const box = (group, matKey, w, h, d, x, y, z, tile = 2.42) => {
    if (w <= 0.02 || h <= 0.02 || d <= 0.02) return;
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    put(group, matKey, geo, tile);
  };
  const wallZ = (g, m, z, x0, x1, y0, y1) => box(g, m, x1 - x0, y1 - y0, t, mid(x0, x1), mid(y0, y1), z);
  const wallX = (g, m, x, z0, z1, y0, y1) => box(g, m, t, y1 - y0, z1 - z0, x, mid(y0, y1), mid(z0, z1));
  const S = shaftGroup;
  // shaft walls (same openings as the old lift: the cell gate on the west at the top, the landings on the east)
  wallX(S, 'rock', shaft.x0 - t / 2, shaft.z0, back.z0, 0, crown);
  wallX(S, 'rock', shaft.x0 - t / 2, back.z1, shaft.z1, 0, crown);
  wallX(S, 'rock', shaft.x0 - t / 2, back.z0, back.z1, 2.02, crown);
  wallX(S, 'rock', shaft.x0 - t / 2, shaft.z0, shaft.z1, pit, 0);
  const levels = stops.slice(1).sort((a, b) => a - b);
  const east = shaft.x1 + t / 2;
  wallX(S, 'rock', east, shaft.z0, shaft.z1, pit, levels[0]);
  levels.forEach((y, index) => {
    const above = index === levels.length - 1 ? crown : levels[index + 1];
    wallX(S, 'rock', east, shaft.z0, shaft.z1, y + 2.08, above);
  });
  wallZ(S, 'rock', shaft.z0 - t / 2, shaft.x0, shaft.x1, pit, crown);
  wallZ(S, 'rock', shaft.z1 + t / 2, shaft.x0, shaft.x1, pit, crown);
  box(S, 'rock', shaft.x1 - shaft.x0, t, shaft.z1 - shaft.z0, mid(shaft.x0, shaft.x1), crown - t / 2, mid(shaft.z0, shaft.z1));
  box(S, 'floor', shaft.x1 - shaft.x0, 0.16, shaft.z1 - shaft.z0, mid(shaft.x0, shaft.x1), pit - 0.08, mid(shaft.z0, shaft.z1), 2.0);
  // timber cribbing rings every 1.8 m down the shaft (mine look; 4 thin beams per ring, flush with the walls)
  for (let y = crown - 0.3; y > pit + 0.2; y -= 1.8) {
    if (stops.some((s) => y > s - 0.15 && y < s + 2.2)) continue; // keep landings clear
    box(S, 'timber', shaft.x1 - shaft.x0, 0.14, 0.08, mid(shaft.x0, shaft.x1), y, shaft.z0 + 0.04, 0.6);
    box(S, 'timber', shaft.x1 - shaft.x0, 0.14, 0.08, mid(shaft.x0, shaft.x1), y, shaft.z1 - 0.04, 0.6);
    box(S, 'timber', 0.08, 0.14, shaft.z1 - shaft.z0 - 0.16, shaft.x0 + 0.04, y, mid(shaft.z0, shaft.z1), 0.6);
  }
  // guide rails: two steel T-rails on the north/south walls, full height
  [shaft.z0 + 0.05, shaft.z1 - 0.05].forEach((z) => {
    box(S, 'steel', 0.07, crown - pit, 0.012, mid(carBox.x0, carBox.x1), mid(pit, crown), z, 0);
    box(S, 'steel', 0.012, crown - pit, 0.05, mid(carBox.x0, carBox.x1), mid(pit, crown), z + (z < 0.1 ? 0.03 : -0.03), 0);
  });

  // ---- floor rooms (old layout; rooms that would cut the gallery tunnel are skipped) ----
  const vestibule = { x0: shaft.x1, x1: 7.9, z0: shaft.z0, z1: shaft.z1 };
  const doorX0 = 6.95;
  const doorX1 = 7.75;
  const clashes = (r, y) => AVOID.some((a) => r.x0 < a.x1 && r.x1 > a.x0 && r.z0 < a.z1 && r.z1 > a.z0 && y < a.y1 && y + roomH > a.y0);
  const lampSpots = [];
  stops.slice(1).forEach((y, i) => {
    const G = floorGroups[i + 1];
    const shells = [
      vestibule,
      { x0: 6.75, x1: 9.2, z0: vestibule.z1, z1: vestibule.z1 + 2.35 },
      { x0: 6.75, x1: 9.2, z0: vestibule.z0 - 2.35, z1: vestibule.z0 },
    ];
    const keep = shells.map((room) => !clashes(room, y));
    shells.forEach((room, index) => {
      if (!keep[index]) return;
      floors.push({ x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y });
      box(G, 'floor', room.x1 - room.x0, 0.08, room.z1 - room.z0, mid(room.x0, room.x1), y - 0.04, mid(room.z0, room.z1), 2.0);
      box(G, 'rock', room.x1 - room.x0, 0.08, room.z1 - room.z0, mid(room.x0, room.x1), y + roomH - 0.04, mid(room.z0, room.z1));
      wallX(G, 'rock', room.x1 + t / 2, room.z0, room.z1, y, y + roomH);
      if (index === 0) wallX(G, 'rock', room.x0 - t / 2, room.z0, room.z1, y + 2.08, y + roomH);
      else wallX(G, 'rock', room.x0 - t / 2, room.z0, room.z1, y, y + roomH);
      if (index === 0) {
        const doorWall = (z, open) => {
          if (open) {
            wallZ(G, 'rock', z, room.x0, doorX0, y, y + roomH);
            wallZ(G, 'rock', z, doorX1, room.x1, y, y + roomH);
            wallZ(G, 'rock', z, doorX0, doorX1, y + 2.02, y + roomH);
            // timber door set: two posts and a cap
            box(G, 'timber', 0.12, 2.02, 0.16, doorX0 + 0.06, y + 1.01, z, 0.6);
            box(G, 'timber', 0.12, 2.02, 0.16, doorX1 - 0.06, y + 1.01, z, 0.6);
            box(G, 'timber', doorX1 - doorX0 + 0.12, 0.14, 0.18, mid(doorX0, doorX1), y + 2.02 + 0.07, z, 0.6);
          } else {
            wallZ(G, 'rock', z, room.x0, room.x1, y, y + roomH);
          }
        };
        doorWall(room.z0 - t / 2, keep[2]);
        doorWall(room.z1 + t / 2, keep[1]);
      } else if (index === 1) {
        wallZ(G, 'rock', room.z1 + t / 2, room.x0, room.x1, y, y + roomH);
      } else {
        wallZ(G, 'rock', room.z0 - t / 2, room.x0, room.x1, y, y + roomH);
      }
      // mine sets along the side rooms: post-cap-post every 0.8 m
      if (index > 0) {
        for (let x = room.x0 + 0.45; x < room.x1 - 0.2; x += 0.8) {
          const zi = room.z0 + 0.07; const zo = room.z1 - 0.07;
          box(G, 'timber', 0.12, roomH - 0.1, 0.12, x, y + (roomH - 0.1) / 2, zi, 0.6);
          box(G, 'timber', 0.12, roomH - 0.1, 0.12, x, y + (roomH - 0.1) / 2, zo, 0.6);
          box(G, 'timber', 0.14, 0.14, room.z1 - room.z0, x, y + roomH - 0.17, mid(room.z0, room.z1), 0.6);
        }
      }
      box(G, 'timber', 0.05, 0.16, Math.min(1.15, (room.z1 - room.z0) * 0.55), room.x1 - 0.12, y + 1.15, mid(room.z0, room.z1), 0.6);
    });
    // landing: steel tread sill, painted landing frame around the shaft opening
    box(G, 'tread', 0.36, 0.03, shaft.z1 - shaft.z0 - 0.04, shaft.x1 + 0.18, y + 0.012, mid(shaft.z0, shaft.z1), 0.6);
    box(G, 'paint', 0.08, 2.08, 0.1, shaft.x1 + 0.06, y + 1.04, shaft.z0 + 0.05, 0.5);
    box(G, 'paint', 0.08, 2.08, 0.1, shaft.x1 + 0.06, y + 1.04, shaft.z1 - 0.05, 0.5);
    box(G, 'paint', 0.08, 0.12, shaft.z1 - shaft.z0, shaft.x1 + 0.06, y + 2.08 + 0.06, mid(shaft.z0, shaft.z1), 0.5);
    lampSpots.push({ stop: i + 1, pos: new THREE.Vector3(7.25, y + 1.78, vestibule.z1 - 0.02), yaw: Math.PI, light: new THREE.Vector3(7.25, y + 1.72, vestibule.z1 - 0.25) });
  });
  for (const { group, mat, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.raycast = () => {};
    mesh.userData.zoneStatic = true;
    group.add(mesh);
  }

  // ---- car ----
  const car = new THREE.Group(); car.name = 'lift_car';
  scene.add(car);
  const carMid = new THREE.Vector3(mid(carBox.x0, carBox.x1), 0, mid(carBox.z0, carBox.z1));
  const carVis = new THREE.Group(); carVis.position.copy(carMid); car.add(carVis);
  // stand-in car (shown until lift_kit.glb arrives, and under ?models=0)
  const standIn = new THREE.Group(); carVis.add(standIn);
  const sb = (m, w, h, d, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.raycast = () => {}; standIn.add(o); };
  sb(M.tread, 1.2, 0.06, 1.04, 0, 0.03, 0);
  [[-0.6, -0.52], [-0.6, 0.52], [0.6, -0.52], [0.6, 0.52]].forEach(([x, z]) => sb(M.paint, 0.05, 2.08, 0.05, x, 1.04, z));
  sb(M.paint, 1.2, 0.06, 1.04, 0, 2.08, 0);
  // hoist cable from the crosshead to the shaft head
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0), M.steel);
  cable.position.set(carMid.x, 2.4, carMid.z); cable.raycast = () => {};
  scene.add(cable); // world-space, rescaled every move
  const hinge = new THREE.Group();
  hinge.position.set(back.gateX, 0, back.z0);
  car.add(hinge);
  addGate?.(hinge, back);
  hinge.traverse((o) => { if (o.isMesh) { o.layers.set(0); o.material = M.paint; } });
  // lever (role 'go'): invisible proxy keeps the old pick box; a visual lever rotates when pulled
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.06), new THREE.MeshBasicMaterial({ visible: false }));
  lever.position.set(carBox.x0 + 0.14, 1.1, carBox.z1 - 0.1);
  lever.userData.type = 'lift';
  lever.userData.role = 'go';
  car.add(lever);
  targets.push(lever);
  const leverPivot = new THREE.Group();
  leverPivot.position.set(carBox.x0 + 0.14, 1.04, carBox.z1 - 0.06);
  car.add(leverPivot);
  const leverStand = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.26, 0.022).translate(0, 0.13, 0), M.paint);
  leverStand.raycast = () => {};
  leverPivot.add(leverStand);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06), M.paint);
  handle.position.set(4.58, 1.12, -0.55);
  handle.userData.type = 'lift';
  handle.userData.role = 'open';
  scene.add(handle);
  targets.push(handle);

  // ---- lamps (emissive fixtures + material-local light) ----
  const lampFixtures = [];
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.5, metalness: 0.6, emissive: 0xffd2a0, emissiveIntensity: 0 });
  const bulbStandIn = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a8 }));
  bulbStandIn.material.toneMapped = false;
  function placeFixture(parent, pos, yaw, stop) {
    const holder = new THREE.Group(); holder.position.copy(pos); holder.rotation.y = yaw; parent.add(holder);
    const bulb = bulbStandIn.clone(); bulb.position.set(0, 0, 0.12); bulb.raycast = () => {}; holder.add(bulb);
    lampFixtures.push({ holder, bulb, stop });
  }
  lampSpots.forEach((spot) => placeFixture(floorGroups[spot.stop], spot.pos, spot.yaw, spot.stop));
  const carLampLocal = new THREE.Vector3(0, 1.93, 0.5);
  placeFixture(carVis, carLampLocal, Math.PI, -1);
  const lampWorld = new THREE.Vector3();
  const lampOffset = new THREE.Vector3(0, -0.1, -0.2);
  const warm = new THREE.Color(0xffc9a0);
  lampSpots.forEach((spot, i) => {
    lampUniforms.uLampPos.value[i].copy(spot.light);
    lampUniforms.uLampColor.value[i].copy(warm).multiplyScalar(11);
    lampUniforms.uLampRange.value[i] = 4.8;
  });
  lampUniforms.uLampColor.value[4].copy(warm).multiplyScalar(5);
  lampUniforms.uLampRange.value[4] = 3.2;

  // ---- lift_kit.glb (lazy: never blocks boot) ----
  let leverVis = null;
  const kitReady = assets?.whenReady ? assets.whenReady('lift_kit') : Promise.resolve(null);
  kitReady.then((gltf) => {
    if (!gltf) return;
    const node = (name) => gltf.scene.getObjectByName(name);
    const deck = node('lift_car_deck'); const frame = node('lift_car_frame');
    if (!deck || !frame) return;
    fill(M.tread, deck.material); fill(M.paint, frame.material); fill(M.steel, node('lift_cable')?.material);
    standIn.visible = false;
    for (const n of [deck, frame]) { const c = n.clone(); c.material = n === deck ? M.tread : M.paint; c.raycast = () => {}; carVis.add(c); }
    const lv = node('lift_lever');
    if (lv) {
      leverStand.visible = false;
      leverVis = lv.clone(); leverVis.material = M.paint; leverVis.raycast = () => {};
      leverPivot.add(leverVis);
    }
    const lamp = node('lift_lamp');
    if (lamp) {
      const lm = liftLit(lamp.material, { name: 'lift_lamp' });
      lm.emissiveIntensity = 3.2;
      for (const f of lampFixtures) {
        const c = lamp.clone(); c.material = lm; c.raycast = () => {};
        f.holder.add(c); f.bulb.visible = false;
      }
    }
    // re-skin the handle by the gate with the kit lever
    if (lv) { handle.material = new THREE.MeshBasicMaterial({ visible: false }); const hv = lv.clone(); hv.material = M.paint; hv.position.set(0, -0.14, 0); hv.raycast = () => {}; handle.add(hv); }
  });

  const listeners = {};
  const emit = (type, data = {}) => (listeners[type] || []).forEach((fn) => fn({ type, ...data }));
  let leverKick = 0;
  let lastStop = 0;

  const lift = {
    floorY: 0,
    doorOpen: 0,
    phase: 'idle',
    dir: 1,
    target: 0,
    pendingMove: false,
    moving: false,
    speed: 0,
    accel: 0,
    shaft,
    carBox,
    floors,
    stops,
    car,
    shaftGroup,
    floorGroups,
    lampWorld,
    lampUniforms,
    on(type, fn) { (listeners[type] ||= []).push(fn); return lift; },
    stopIndex(y = this.floorY) {
      let index = 0; let best = Infinity;
      stops.forEach((stop, i) => { const d = Math.abs(stop - y); if (d < best) { best = d; index = i; } });
      return index;
    },
    setStopVisible(index, on) { if (floorGroups[index]) floorGroups[index].visible = on; },
    openDoor() {
      if (this.phase !== 'idle' || Math.abs(this.floorY) > 0.08 || this.doorOpen > 0.5) return;
      this.phase = 'opening';
      emit('door', { open: true });
    },
    go(inside) {
      if (this.phase !== 'idle' || !inside) return;
      leverKick = 1;
      if (this.doorOpen > 0.5) {
        this.pendingMove = true;
        this.phase = 'closing';
        emit('door', { open: false });
        return;
      }
      this.arm();
    },
    arm() {
      const index = this.stopIndex();
      let next = index + this.dir;
      if (next < 0 || next >= stops.length) {
        this.dir *= -1;
        next = index + this.dir;
      }
      this.target = stops[next];
      this.phase = 'moving';
      this.moving = true;
      this.speed = 0;
      this.accel = 0;
      lastStop = index;
      emit('depart', { from: index, to: next });
    },
    update(dt) {
      const dy = this.step(dt);
      this.sync();
      return dy;
    },
    step(dt) {
      if (leverKick > 0) {
        leverKick = Math.max(0, leverKick - dt / 0.45);
        leverPivot.rotation.z = -0.9 * Math.sin(Math.PI * (1 - leverKick));
      }
      if (this.phase === 'opening' || this.phase === 'closing') {
        const step = dt / 0.85;
        this.doorOpen = this.phase === 'opening'
          ? Math.min(1, this.doorOpen + step)
          : Math.max(0, this.doorOpen - step);
        const k = this.doorOpen;
        hinge.rotation.y = 1.5 * (k * k * (3 - 2 * k)); // eased swing
        if (this.phase === 'opening' && this.doorOpen >= 1) this.phase = 'idle';
        if (this.phase === 'closing' && this.doorOpen <= 0) {
          this.phase = 'idle';
          if (this.pendingMove) {
            this.pendingMove = false;
            this.arm();
          }
        }
        return 0;
      }
      if (this.phase !== 'moving') return 0;
      const remaining = Math.abs(this.target - this.floorY);
      const sign = Math.sign(this.target - this.floorY);
      const brake = Math.sqrt(2 * DECEL * Math.max(0, remaining - 0.004));
      const want = Math.max(CREEP, Math.min(VMAX, brake));
      const speed = Math.abs(this.speed);
      // jerk-limited acceleration toward the wanted speed; braking follows the v = sqrt(2ad) curve directly
      if (want > speed) this.accel = Math.min(ACCEL, this.accel + JERK * dt);
      else this.accel = 0;
      const next = want > speed ? Math.min(want, speed + this.accel * dt) : want;
      const step = sign * Math.min(next * dt, remaining);
      this.floorY += step;
      this.speed = sign * next;
      car.position.y = this.floorY;
      const passing = this.stopIndex();
      if (passing !== lastStop && Math.abs(stops[passing] - this.floorY) < 0.05 && Math.abs(this.target - this.floorY) > 0.05) {
        lastStop = passing; emit('pass', { stop: passing });
      }
      if (Math.abs(this.floorY - this.target) <= 0.001) {
        this.floorY = this.target;
        car.position.y = this.floorY;
        this.moving = false;
        this.speed = 0;
        this.phase = Math.abs(this.floorY) < 0.05 ? 'opening' : 'idle';
        emit('arrive', { stop: this.stopIndex() });
        if (this.phase === 'opening') emit('door', { open: true });
      }
      return step;
    },
    // keeps the cable, car lamp and lamp uniform in step with the car; call once per frame after update()
    sync() {
      const top = crown - 0.02;
      const from = this.floorY + 2.4;
      cable.position.y = from;
      cable.scale.y = Math.max(0.01, top - from);
      cable.visible = top - from > 0.05;
      carVis.updateWorldMatrix(true, false);
      lampWorld.copy(carLampLocal).add(lampOffset).applyMatrix4(carVis.matrixWorld);
      lampUniforms.uLampPos.value[4].copy(lampWorld);
    },
    floorAt(x, z, feetY) {
      if (x >= shaft.x0 && x <= shaft.x1 && z >= shaft.z0 && z <= shaft.z1) {
        if (Math.abs(feetY - this.floorY) < 1.4) return this.floorY;
      }
      let best = null;
      for (const room of floors) {
        if (x < room.x0 || x > room.x1 || z < room.z0 || z > room.z1) continue;
        if (feetY < room.y - 0.45 || feetY > room.y + 2.3) continue;
        if (best == null || room.y > best) best = room.y;
      }
      return best;
    },
  };
  lift.sync();
  return lift;
}
