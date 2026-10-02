import * as THREE from 'three';

// Inventory icons: each carryable item is rendered once at startup with an offscreen orthographic
// camera into one shared atlas (unlit MeshBasicMaterial on the pocket, so it reads in the dark cave).
// Silhouettes get a pale 2 px outline so dark wood (the bow) still reads on the dark pocket.
// Cost: one render + one readPixels per item at load (~1-3 ms each on desktop), one 512x512 texture.

const CELL = 128;
const COLS = 4;
const TMP_BOX = new THREE.Box3();
const TMP_V = new THREE.Vector3();

function srgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function shownMeshes(root) {
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    let a = o;
    while (a && a !== root.parent) {
      if (!a.visible) return;
      a = a.parent;
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every((m) => !m || m.visible === false)) return;
    list.push(o);
  });
  return list;
}

export function createIconBaker(renderer, { env = null, cols = COLS, rows = 4 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * cols;
  canvas.height = CELL * rows;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x30343c, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-1, 2, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd4ff, 1.4);
  rim.position.set(2, 1, -2);
  scene.add(rim);
  const holder = new THREE.Group();
  scene.add(holder);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const rt = new THREE.WebGLRenderTarget(CELL, CELL, { samples: 4 });
  const pixels = new Uint8Array(CELL * CELL * 4);
  const image = ctx.createImageData(CELL, CELL);
  const materials = new Map();
  let next = 0;

  // entry: { key, object, label?, axis?: 'x'|'y'|'z'|'-x'..., roll?: radians, tint?: css colour for the label }
  function bake(entry) {
    const { object } = entry;
    if (!object || next >= cols * rows) return null;
    const saved = {
      parent: object.parent, pos: object.position.clone(), quat: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible,
    };
    const lights = [];
    // lights and anything tagged userData.noIcon (e.g. shader flames) stay out of the icon
    object.traverse((o) => { if ((o.isLight || o.userData?.noIcon) && o.visible) { lights.push(o); o.visible = false; } });
    const grip = object.userData?.grip;
    const gripWas = grip?.visible;
    if (grip) grip.visible = false;
    holder.add(object);
    object.position.set(0, 0, 0);
    object.quaternion.identity();
    object.scale.set(1, 1, 1);
    object.visible = true;
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3();
    shownMeshes(object).forEach((m) => {
      m.geometry.computeBoundingBox();
      TMP_BOX.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
      box.union(TMP_BOX);
    });
    let cell = null;
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // Look along the thinnest axis so the silhouette shows the most area; roll long items onto the diagonal.
      const dims = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1]);
      const axisName = (entry.axis || dims[0][0]).replace('-', '');
      const sign = (entry.axis || '').startsWith('-') ? -1 : 1;
      const dir = new THREE.Vector3(axisName === 'x' ? sign : 0, axisName === 'y' ? sign : 0, axisName === 'z' ? sign : 0);
      const longest = dims[2][0] === axisName ? dims[1][0] : dims[2][0];
      const up = new THREE.Vector3(longest === 'x' ? 1 : 0, longest === 'y' ? 1 : 0, longest === 'z' ? 1 : 0);
      const radius = size.length() * 0.5 + 0.01;
      cam.position.copy(center).addScaledVector(dir, radius * 4);
      cam.up.copy(up);
      cam.lookAt(center);
      const roll = entry.roll ?? (dims[2][1] > dims[1][1] * 1.6 ? -Math.PI / 4 : 0);
      cam.rotateZ(roll);
      cam.updateMatrixWorld();
      // Fit: project the box corners into camera space.
      let half = 0;
      const inv = cam.matrixWorldInverse;
      for (let i = 0; i < 8; i += 1) {
        TMP_V.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
        half = Math.max(half, Math.abs(TMP_V.x), Math.abs(TMP_V.y));
      }
      half *= entry.label ? 1.22 : 1.1;
      const lift = entry.label ? half * 0.12 : 0;
      cam.left = -half; cam.right = half; cam.top = half - lift; cam.bottom = -half - lift;
      cam.near = 0.01; cam.far = radius * 8;
      cam.updateProjectionMatrix();
      const prev = {
        target: renderer.getRenderTarget(), xr: renderer.xr.enabled, auto: renderer.shadowMap.autoUpdate,
        clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
      };
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, CELL, CELL, pixels);
      renderer.setRenderTarget(prev.target);
      renderer.setClearColor(prev.clear, prev.alpha);
      renderer.xr.enabled = prev.xr;
      renderer.shadowMap.autoUpdate = prev.auto;
      // Linear premultiplied -> sRGB straight alpha, flip Y, then a 2 px pale outline from the alpha mask.
      const d = image.data;
      const alphaAt = (x, y) => (x < 0 || y < 0 || x >= CELL || y >= CELL ? 0 : pixels[((CELL - 1 - y) * CELL + x) * 4 + 3]);
      for (let y = 0; y < CELL; y += 1) {
        for (let x = 0; x < CELL; x += 1) {
          const s = ((CELL - 1 - y) * CELL + x) * 4;
          const o = (y * CELL + x) * 4;
          const a = pixels[s + 3] / 255;
          if (a > 0.02) {
            for (let c = 0; c < 3; c += 1) d[o + c] = Math.round(srgb(Math.min(1, (pixels[s + c] / 255) / a * 1.15)) * 255);
            d[o + 3] = Math.round(a * 255);
          } else {
            let near = 0;
            for (let dy = -2; dy <= 2 && !near; dy += 1) for (let dx = -2; dx <= 2; dx += 1) if (alphaAt(x + dx, y + dy) > 128) { near = 1; break; }
            d[o] = 242; d[o + 1] = 228; d[o + 2] = 196; d[o + 3] = near ? 220 : 0;
          }
        }
      }
      const cx = (next % cols) * CELL;
      const cy = Math.floor(next / cols) * CELL;
      ctx.putImageData(image, cx, cy);
      if (entry.label) {
        ctx.font = 'bold 19px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,16,12,0.9)';
        ctx.strokeText(entry.label, cx + CELL / 2, cy + CELL - 6);
        ctx.fillStyle = entry.tint || '#f4ead2';
        ctx.fillText(entry.label, cx + CELL / 2, cy + CELL - 6);
      }
      cell = next;
      next += 1;
    }
    // restore
    if (saved.parent) saved.parent.add(object); else holder.remove(object);
    object.position.copy(saved.pos);
    object.quaternion.copy(saved.quat);
    object.scale.copy(saved.scale);
    object.visible = saved.visible;
    lights.forEach((l) => { l.visible = true; });
    if (grip) grip.visible = gripWas;
    if (cell == null) return null;
    const map = texture.clone();
    map.repeat.set(1 / cols, 1 / rows);
    map.offset.set((cell % cols) / cols, 1 - (Math.floor(cell / cols) + 1) / rows);
    map.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.04, depthWrite: false, toneMapped: false });
    materials.set(entry.key, material);
    return material;
  }

  function finish() {
    texture.needsUpdate = true;
    rt.dispose();
    return { canvas, texture, materials };
  }

  return { bake, finish, materials, canvas };
}
