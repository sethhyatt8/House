// Scuba kit (mask, tank, fins), for now simply sitting on the roof by the north-west corner. Squeeze a grip with your
// hand on a piece to put it on: the mask gives clear sight underwater and the mask frame, the tank gives air (and lets
// you dive deeper than a breath-hold), the fins make every stroke stronger and the glide longer. Kept through
// respawns. Model: public/models/sea/scuba_kit.glb (tank: "Scuba tank" by Steren Giannini, CC-BY 3.0; mask and fins
// modelled for House, CC0), ~1k tris, no textures, loaded on its own (not in the manifest); a procedural stand-in is
// shown if it fails. ?scuba=1 starts with the whole kit on (testing).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const SCUBA_START = params.get('scuba') === '1';
const REACH = 0.3;

const NAMES = { mask: 'dive mask', tank: 'air tank', fins: 'fins' };

export function createScuba({ scene, roof }) {
  const deck = roof?.y ?? 3.26;
  // spot: open roof between the ladder head (x 0.46, z -0.65) and the crag foot (x 3.4), clear of the puzzle (z 1.35)
  const base = new THREE.Vector3(1.25, deck, -2.35);
  const pieces = {
    tank: { id: 'tank', holder: new THREE.Group(), on: false, at: new THREE.Vector3(-0.28, 0.105, 0.05), rot: [0, 0.35, Math.PI / 2] },
    mask: { id: 'mask', holder: new THREE.Group(), on: false, at: new THREE.Vector3(0.12, 0.056, 0.22), rot: [Math.PI / 2, 0, 0.4] },
    fins: { id: 'fins', holder: new THREE.Group(), on: false, at: new THREE.Vector3(0.36, 0.008, -0.06), rot: [0, -0.5, 0] },
  };
  const root = new THREE.Group();
  root.name = 'scuba_kit';
  root.position.copy(base);
  scene.add(root);
  Object.values(pieces).forEach((p) => {
    p.holder.position.copy(p.at);
    p.holder.rotation.set(...p.rot);
    p.holder.name = `scuba_${p.id}`;
    root.add(p.holder);
  });
  // a folded towel under the mask so the kit reads as "left here on purpose"
  const towel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.018, 0.3), new THREE.MeshStandardMaterial({ color: 0x3f7f8c, roughness: 0.95 }));
  towel.position.set(0.12, 0.009, 0.2);
  towel.rotation.y = 0.3;
  towel.receiveShadow = true;
  towel.raycast = () => {};
  root.add(towel);

  const hover = new THREE.Color(0x2a6f78);
  const mats = [];
  function dress(object) {
    object.traverse((c) => {
      if (!c.isMesh) return;
      c.material = c.material.clone();
      c.castShadow = true;
      c.receiveShadow = true;
      c.raycast = () => {};
      mats.push(c.material);
    });
  }
  function standIn() {
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.4, metalness: 0.5 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.62, 16), metal);
    tank.position.y = 0.31;
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 8), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 }));
    valve.position.y = 0.66;
    const t = new THREE.Group(); t.add(tank, valve);
    const mask = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 24), new THREE.MeshStandardMaterial({ color: 0x0d3550, roughness: 0.4 }));
    mask.scale.set(1.2, 0.7, 1);
    const finMat = new THREE.MeshStandardMaterial({ color: 0xf2a00c, roughness: 0.5 });
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.62), finMat);
    const fins = new THREE.Group();
    const f2 = fin.clone(); f2.position.x = 0.26;
    fins.add(fin, f2);
    return { tank: t, mask, fins };
  }
  let loaded = false;
  function fill(models) {
    Object.entries(models).forEach(([id, obj]) => {
      const p = pieces[id];
      p.holder.clear();
      dress(obj);
      p.holder.add(obj);
    });
    loaded = true;
  }
  new GLTFLoader().loadAsync(new URL('models/sea/scuba_kit.glb', document.baseURI).href).then((gltf) => {
    const get = (name) => gltf.scene.getObjectByName(name);
    const tank = get('scuba_tank');
    const mask = get('scuba_mask');
    const fin = get('scuba_fin');
    if (!tank || !mask || !fin) throw new Error('scuba_kit.glb is missing a node');
    [tank, mask, fin].forEach((o) => { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); });
    tank.position.y = 0; // tank: base at y 0, 0.70 m tall; lying on its side via the holder
    const tankG = new THREE.Group(); tankG.add(tank); tank.position.y = -0.35; // centre the tank on its holder
    const fins = new THREE.Group();
    const finB = fin.clone();
    fin.position.set(-0.13, 0, 0); fin.rotation.y = 0.06;
    finB.position.set(0.13, 0.0, 0.05); finB.rotation.y = -0.05; finB.scale.x = -1;
    fins.add(fin, finB);
    fill({ tank: tankG, mask, fins });
  }).catch((err) => {
    console.warn('scuba kit: using stand-ins', err?.message || err);
    const s = standIn();
    fill(s);
  });

  const listeners = [];
  function equip(id, quiet = false) {
    const p = pieces[id];
    if (!p || p.on) return false;
    p.on = true;
    p.holder.visible = false;
    if (!quiet) listeners.forEach((fn) => fn(id));
    return true;
  }
  if (SCUBA_START) Object.keys(pieces).forEach((id) => equip(id, true));

  const tmp = new THREE.Vector3();
  function nearest(points) {
    let best = null;
    let bestD = REACH;
    for (const p of Object.values(pieces)) {
      if (p.on || !p.holder.visible) continue;
      p.holder.getWorldPosition(tmp);
      for (const pt of points) {
        const d = tmp.distanceTo(pt);
        if (d < bestD) { bestD = d; best = p; }
      }
    }
    return best;
  }

  let hot = null;
  return {
    root,
    pieces,
    get loaded() { return loaded; },
    has: (id) => !!pieces[id]?.on,
    all: () => Object.values(pieces).every((p) => p.on),
    names: NAMES,
    onEquip(fn) { listeners.push(fn); },
    equip,
    // squeeze with the hand on a piece: put it on. Returns the piece id or null.
    tryPickup(points) {
      const p = nearest(points);
      if (!p) return null;
      equip(p.id);
      return p.id;
    },
    // faint highlight on the piece a hand is close to
    hover(points) {
      const p = points.length ? nearest(points) : null;
      if (p === hot) return;
      if (hot) hot.holder.traverse((c) => { if (c.isMesh && c.material.emissive) c.material.emissive.setRGB(0, 0, 0); });
      hot = p;
      if (hot) hot.holder.traverse((c) => { if (c.isMesh && c.material.emissive) c.material.emissive.copy(hover); });
    },
  };
}
