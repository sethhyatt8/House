// In-page ground truth: a downward raycast against the VISIBLE static geometry (instance-level raycast overrides
// that visual GLB clones carry are bypassed; invisible proxies, water, sky/backdrop, the canoe, props, bricks,
// ladders, hands and controllers are skipped). Bucketed by 1 m XZ cells so a ray only tests nearby meshes.
(() => {
  const H = window.__house; const THREE = H.THREE; const world = H.world; const scene = world.scene;
  const SKIP_TYPES = new Set(['teleport', 'brick', 'prop', 'oar', 'rung', 'boatEnd', 'boatHull', 'boatSeat', 'ui', 'plate', 'pedestal', 'lift']);
  const label = (o) => { const parts = []; for (let a = o; a && a !== scene; a = a.parent) { const n = a.name || a.userData?.type || a.userData?.label || ''; if (n) parts.push(n); if (parts.length > 3) break; } return parts.join('<') || o.geometry?.type || 'mesh'; };
  function skip(o) {
    if (!o.isMesh || o.isSkinnedMesh) return 'kind';
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every((m) => !m || m.visible === false)) return 'proxy';
    if (mats.every((m) => m.transparent && (m.opacity < 0.6 || m.depthWrite === false))) return 'transparent';
    for (let a = o; a && a !== scene; a = a.parent) {
      const u = a.userData || {};
      if (u.water || u.backdrop) return 'water/backdrop';
      if (a === world.canoe.group) return 'canoe';
      if (u.rungs || u.ladder) return 'ladder';
      if (u.inputSource || u.noArrow) return 'controller';
      if (world.crates?.includes(a)) return null; // crates are floor (walk.js standHeight)
      if (SKIP_TYPES.has(u.type)) return 'type:' + u.type;
      if (u.carried || u.heldBy) return 'held';
      if (a.visible === false && !(u.zoneRoot || u.zone)) return 'hidden';
    }
    return null;
  }
  const B = 1; const buckets = new Map(); const metas = [];
  const key = (i, k) => i * 100003 + k;
  function init() {
    buckets.clear(); metas.length = 0;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    scene.traverse((o) => {
      if (skip(o)) return;
      box.setFromObject(o);
      if (box.isEmpty()) return;
      const m = { o, min: box.min.clone(), max: box.max.clone(), label: label(o), cast: Object.getPrototypeOf(o).raycast };
      metas.push(m);
      for (let i = Math.floor(m.min.x / B); i <= Math.floor(m.max.x / B); i++) {
        for (let k = Math.floor(m.min.z / B); k <= Math.floor(m.max.z / B); k++) {
          const kk = key(i, k); if (!buckets.has(kk)) buckets.set(kk, []); buckets.get(kk).push(m);
        }
      }
    });
    return metas.length;
  }
  const rc = new THREE.Raycaster(); rc.layers.enableAll();
  const origin = new THREE.Vector3(); const down = new THREE.Vector3(0, -1, 0); const n = new THREE.Vector3(); const nm = new THREE.Matrix3();
  const hits = [];
  // highest upward-facing surface between yTop and yBot under (x, z)
  function floor(x, z, yTop, yBot, wantLabel = false) {
    const list = buckets.get(key(Math.floor(x / B), Math.floor(z / B)));
    if (!list) return null;
    origin.set(x, yTop, z); rc.set(origin, down); rc.near = 0; rc.far = yTop - yBot;
    let best = null; let bestM = null;
    for (const m of list) {
      if (x < m.min.x || x > m.max.x || z < m.min.z || z > m.max.z || m.max.y < yBot || m.min.y > yTop) continue;
      hits.length = 0;
      m.cast.call(m.o, rc, hits);
      for (const h of hits) {
        if (best != null && h.point.y <= best) continue;
        if (h.face) {
          nm.getNormalMatrix(m.o.matrixWorld); n.copy(h.face.normal).applyMatrix3(nm).normalize();
          const ds = (Array.isArray(m.o.material) ? m.o.material[0] : m.o.material)?.side === THREE.DoubleSide;
          if (n.y < 0.45 && !(ds && n.y < -0.45)) continue;
        }
        best = h.point.y; bestM = m;
      }
    }
    if (best == null) return null;
    return wantLabel ? { y: best, label: bestM.label } : best;
  }
  window.GT = { init, floor, metas, skip, label };
})();
