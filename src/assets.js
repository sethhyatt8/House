import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export const proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });

const url = (path) => new URL(path, document.baseURI).href;

function estimateKtx2Bytes(buffer, start) {
  const view = new DataView(buffer, start);
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const scheme = view.getUint32(44, true);
  const bytesPerPixel = scheme === 1 ? 0.5 : 1;
  return width * height * bytesPerPixel * (4 / 3);
}

function estimateGlbTextureBytes(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) return 0;
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binStart = 20 + jsonLength + 8;
  let total = 0;
  for (const image of json.images || []) {
    if (image.bufferView == null) continue;
    const viewDef = json.bufferViews[image.bufferView];
    const start = binStart + (viewDef.byteOffset || 0);
    const magic = new Uint8Array(buffer, start, 12);
    const ktx2 = magic[0] === 0xab && magic[1] === 0x4b && magic[2] === 0x54 && magic[3] === 0x58;
    if (ktx2) total += estimateKtx2Bytes(buffer, start);
  }
  return total;
}

function prepareTemplate(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.userData.visualOnly = true;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      material.envMap = null;
    }
  });
}

function fitInstance(root, opts) {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const fit = opts.fit || {};
  let scale = 1;
  if (typeof fit.uniform === 'number') scale = fit.uniform;
  else if (fit.height != null) scale = fit.height / (size.y || 1);
  else if (fit.maxExtent != null) scale = fit.maxExtent / (Math.max(size.x, size.y, size.z) || 1);
  root.scale.setScalar(scale);
  if (opts.anchor !== 'center' && opts.anchor !== 'base') return;
  root.updateWorldMatrix(true, true);
  const fitted = new THREE.Box3().setFromObject(root);
  const center = fitted.getCenter(new THREE.Vector3());
  if (opts.anchor === 'base') {
    root.position.set(-center.x, -fitted.min.y, -center.z);
  } else {
    root.position.sub(center);
  }
}

export function createAssetManager(renderer) {
  const enabled = new URLSearchParams(location.search).get('models') !== '0';
  const manager = new THREE.LoadingManager();
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath(url('decoders/draco/'));
  const ktx2 = new KTX2Loader(manager);
  ktx2.setTranscoderPath(url('decoders/basis/'));
  ktx2.detectSupport(renderer);
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2);

  const templates = new Map();
  const unavailable = new Set();
  const textureBytes = new Map();
  let manifest = null;

  async function loadOne(id) {
    if (!enabled || unavailable.has(id) || templates.has(id)) return templates.get(id) || null;
    const spec = manifest?.models?.[id];
    if (!spec?.url) {
      console.warn(`Model "${id}" is not in the manifest.`);
      unavailable.add(id);
      return null;
    }
    try {
      const fileUrl = url(spec.url);
      const buffer = await fetch(fileUrl).then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.arrayBuffer();
      });
      textureBytes.set(id, estimateGlbTextureBytes(buffer.slice(0)));
      const gltf = await loader.parseAsync(buffer, fileUrl);
      prepareTemplate(gltf.scene);
      templates.set(id, gltf);
      return gltf;
    } catch (error) {
      console.warn(`Model "${id}" failed to load.`, error);
      unavailable.add(id);
      return null;
    }
  }

  return {
    enabled,
    get manifest() {
      return manifest;
    },
    async loadManifest(path) {
      if (!enabled) return null;
      try {
        const response = await fetch(url(path));
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        manifest = await response.json();
        return manifest;
      } catch (error) {
        console.warn('Scene manifest failed to load.', error);
        manifest = null;
        return null;
      }
    },
    async preload(modelIds, onProgress) {
      const ids = enabled ? modelIds : [];
      for (let i = 0; i < ids.length; i += 1) {
        await loadOne(ids[i]);
        onProgress?.({ loaded: i + 1, total: ids.length, id: ids[i] });
      }
      onProgress?.({ loaded: ids.length, total: ids.length });
    },
    instance(modelId, opts = {}) {
      const gltf = templates.get(modelId);
      if (!enabled || !gltf || unavailable.has(modelId)) return null;
      const root = gltf.scene.clone(true);
      fitInstance(root, opts);
      root.traverse((child) => {
        if (!child.isMesh) return;
        child.raycast = () => {};
        child.castShadow = opts.castShadow !== false;
        child.receiveShadow = opts.receiveShadow !== false;
      });
      return root;
    },
    stats() {
      let bytes = 0;
      for (const value of textureBytes.values()) bytes += value;
      return {
        textureBytes: bytes,
        models: templates.size,
        unavailable: [...unavailable],
      };
    },
  };
}

export function applyPlacements(scene, assets, manifest, { targets } = {}) {
  if (!assets?.enabled || !manifest?.placements) return;
  const proxies = [];
  const seen = new Set();
  const consider = (object) => {
    if (!object || seen.has(object) || !object.userData?.placeId) return;
    seen.add(object);
    proxies.push(object);
  };
  for (const target of targets || []) consider(target);
  scene.traverse(consider);
  manifest.placements.forEach((placement, index) => {
    const proxy = proxies.find((object) => object.userData.placeId === placement.id);
    if (!proxy) {
      console.warn(`No scene object for placement ${placement.id}.`);
      return;
    }
    const model = assets.instance(placement.model, {
      fit: placement.fit,
      anchor: 'center',
    });
    if (!model) return;
    model.rotation.y = index * 0.87 + 0.35;
    proxy.add(model);
    if (proxy.isMesh) {
      proxy.material = proxyMaterial;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
    }
  });
}
