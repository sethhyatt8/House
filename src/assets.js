import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export const proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });

const url = (path) => new URL(path, document.baseURI).href;

const FEATURE_FOR = {
  rock_cliff: 'rock',
  rock_floor: 'rock',
  sea_boulder: 'searocks',
  pines: 'trees',
  sky_backdrop: 'sky',
  sky_env: 'sky',
};

const BYTES_PER_PIXEL = new Map([
  [THREE.RGB_ETC2_Format, 0.5],
  [THREE.RGB_S3TC_DXT1_Format, 0.5],
  [THREE.RGBA_ETC2_EAC_Format, 1],
  [THREE.RGBA_ASTC_4x4_Format, 1],
  [THREE.RGBA_BPTC_Format, 1],
  [THREE.RGBA_S3TC_DXT5_Format, 1],
]);

function textureByteSize(texture) {
  const image = texture?.image;
  const width = image?.width || 0;
  const height = image?.height || 0;
  if (!width || !height) return 0;
  let bytesPerPixel = BYTES_PER_PIXEL.get(texture.format);
  if (bytesPerPixel == null) bytesPerPixel = texture.type === THREE.HalfFloatType ? 8 : 4;
  const mipChain = texture.mipmaps?.length > 1 || texture.generateMipmaps ? 4 / 3 : 1;
  return width * height * bytesPerPixel * mipChain;
}

function collectTextures(root, into) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) into.add(value);
      }
    }
  });
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
  const params = new URLSearchParams(location.search);
  const enabled = params.get('models') !== '0';
  const manager = new THREE.LoadingManager();
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath(url('decoders/draco/'));
  const ktx2 = new KTX2Loader(manager);
  ktx2.setTranscoderPath(url('decoders/basis/'));
  ktx2.detectSupport(renderer);
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2);
  const hdrLoader = new HDRLoader(manager).setDataType(THREE.HalfFloatType);

  const templates = new Map();
  const envTextures = new Map();
  const unavailable = new Set();
  const counted = new Set();
  let manifest = null;
  let textureBytes = 0;

  function feature(name) {
    return enabled && params.get(name) !== '0';
  }

  function shouldLoad(id) {
    if (!enabled || unavailable.has(id)) return false;
    const name = FEATURE_FOR[id];
    return !name || feature(name);
  }

  function account(texture, pmrem) {
    if (!texture || counted.has(texture.uuid)) return;
    counted.add(texture.uuid);
    textureBytes += pmrem ? 384 * 512 * 8 : textureByteSize(texture);
  }

  async function loadOne(id) {
    if (templates.has(id)) return templates.get(id);
    const spec = manifest?.models?.[id];
    if (!spec?.url) {
      console.warn(`Model "${id}" is not in the manifest.`);
      unavailable.add(id);
      return null;
    }
    try {
      const fileUrl = url(spec.url);
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const gltf = await loader.parseAsync(await response.arrayBuffer(), fileUrl);
      prepareTemplate(gltf.scene);
      const textures = new Set();
      collectTextures(gltf.scene, textures);
      for (const texture of textures) account(texture);
      templates.set(id, gltf);
      return gltf;
    } catch (error) {
      console.warn(`Model "${id}" failed to load.`, error);
      unavailable.add(id);
      return null;
    }
  }

  async function loadEnv(id) {
    if (envTextures.has(id)) return envTextures.get(id);
    const spec = manifest?.env?.[id];
    if (!spec?.url) {
      console.warn(`Env "${id}" is not in the manifest.`);
      unavailable.add(id);
      return null;
    }
    try {
      const fileUrl = url(spec.url);
      const texture = spec.url.endsWith('.hdr')
        ? await hdrLoader.loadAsync(fileUrl)
        : await ktx2.loadAsync(fileUrl);
      envTextures.set(id, texture);
      account(texture, spec.url.endsWith('.hdr'));
      return texture;
    } catch (error) {
      console.warn(`Env "${id}" failed to load.`, error);
      unavailable.add(id);
      return null;
    }
  }

  function firstMaterial(id) {
    const gltf = templates.get(id);
    if (!gltf) return null;
    let found = null;
    gltf.scene.traverse((child) => {
      if (!found && child.isMesh && child.material) found = child.material;
    });
    return Array.isArray(found) ? found[0] : found;
  }

  return {
    enabled,
    feature,
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
    async preload(ids, onProgress) {
      const queue = (enabled ? ids : []).filter((id) => shouldLoad(id));
      for (let i = 0; i < queue.length; i += 1) {
        const id = queue[i];
        if (manifest?.env?.[id]) await loadEnv(id);
        else await loadOne(id);
        onProgress?.({ loaded: i + 1, total: queue.length, id });
      }
      onProgress?.({ loaded: queue.length, total: queue.length });
    },
    gltf(id) {
      if (!shouldLoad(id)) return null;
      return templates.get(id) || null;
    },
    material(id) {
      if (!shouldLoad(id)) return null;
      return firstMaterial(id);
    },
    texture(id) {
      if (!shouldLoad(id)) return null;
      return envTextures.get(id) || null;
    },
    hdr(id) {
      return this.texture(id);
    },
    instance(modelId, opts = {}) {
      const gltf = templates.get(modelId);
      if (!shouldLoad(modelId) || !gltf) return null;
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
      return {
        textureBytes,
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
