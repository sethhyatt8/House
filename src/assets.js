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
  water_normal: 'water',
  finds: 'finds',
  ladder_kit: 'props4',
  table: 'props4',
  fire_pit: 'props4',
  paint_can: 'props4',
  lift_kit: 'liftkit',
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
  const inflight = new Map();
  const queue = [];
  const deferredMaterials = new Set();
  const placeholders = new Map();
  let pumping = 0;
  let manifest = null;
  let textureBytes = 0;

  function feature(name) {
    return enabled && params.get(name) !== '0';
  }

  function featureOf(id) {
    if (FEATURE_FOR[id]) return FEATURE_FOR[id];
    const features = manifest?.features;
    if (!features) return null;
    for (const [name, ids] of Object.entries(features)) {
      if (ids.includes(id)) return name;
    }
    return null;
  }

  function shouldLoad(id) {
    if (!enabled || unavailable.has(id)) return false;
    const name = featureOf(id);
    return !name || feature(name);
  }

  function account(texture, pmrem) {
    if (!texture || counted.has(texture.uuid)) return;
    counted.add(texture.uuid);
    textureBytes += pmrem ? 384 * 512 * 8 : textureByteSize(texture);
  }

  function loadOne(id) {
    if (templates.has(id)) return Promise.resolve(templates.get(id));
    if (!inflight.has(id)) inflight.set(id, fetchOne(id).finally(() => inflight.delete(id)));
    return inflight.get(id);
  }

  async function fetchOne(id) {
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
      fillPlaceholder(id);
      return gltf;
    } catch (error) {
      console.warn(`Model "${id}" failed to load.`, error);
      unavailable.add(id);
      return null;
    }
  }

  function loadEnv(id) {
    if (envTextures.has(id)) return Promise.resolve(envTextures.get(id));
    if (!inflight.has(id)) inflight.set(id, fetchEnv(id).finally(() => inflight.delete(id)));
    return inflight.get(id);
  }

  async function fetchEnv(id) {
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

  function loadAny(id) {
    return manifest?.env?.[id] ? loadEnv(id) : loadOne(id);
  }

  function pump() {
    while (pumping < 2 && queue.length) {
      const id = queue.shift();
      if (templates.has(id) || envTextures.has(id) || unavailable.has(id)) continue;
      pumping += 1;
      loadAny(id).finally(() => {
        pumping -= 1;
        pump();
      });
    }
  }

  function prefetch(ids, { urgent = false } = {}) {
    if (!enabled) return;
    for (const id of ids) {
      if (!shouldLoad(id) || templates.has(id) || envTextures.has(id)) continue;
      const at = queue.indexOf(id);
      if (at >= 0) {
        if (!urgent) continue;
        queue.splice(at, 1);
      }
      if (urgent) queue.unshift(id);
      else queue.push(id);
    }
    pump();
  }

  function whenReady(id) {
    if (!shouldLoad(id)) return Promise.resolve(null);
    if (templates.has(id)) return Promise.resolve(templates.get(id));
    if (envTextures.has(id)) return Promise.resolve(envTextures.get(id));
    if (!inflight.has(id)) prefetch([id], { urgent: true });
    return (inflight.get(id) || loadAny(id)).then((value) => value || null, () => null);
  }

  const LAZY_GREY = 0x777069;
  function placeholder(id) {
    if (placeholders.has(id)) return placeholders.get(id).base;
    const base = new THREE.MeshStandardMaterial({ color: LAZY_GREY, roughness: 1, metalness: 0 });
    base.name = `${id} (loading)`;
    const family = [];
    const track = (material) => {
      family.push(material);
      material.clone = function cloneTracked() {
        return track(THREE.MeshStandardMaterial.prototype.clone.call(this));
      };
      return material;
    };
    track(base);
    placeholders.set(id, { base, family });
    whenReady(id);
    return base;
  }

  function fillPlaceholder(id) {
    const entry = placeholders.get(id);
    const src = firstMaterial(id);
    if (!entry || !src) return;
    for (const material of entry.family) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) material[key] = src[key] || null;
      if (material.color.getHex() === LAZY_GREY) material.color.copy(src.color);
      material.roughness = src.roughness;
      material.metalness = src.metalness;
      material.aoMapIntensity = src.aoMapIntensity;
      if (src.normalScale) material.normalScale.copy(src.normalScale);
      material.name = material.name.replace(' (loading)', '');
      material.needsUpdate = true;
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
      const list = (enabled ? ids : []).filter((id) => shouldLoad(id));
      for (let i = 0; i < list.length; i += 1) {
        const id = list[i];
        await loadAny(id);
        onProgress?.({ loaded: i + 1, total: list.length, id });
      }
      onProgress?.({ loaded: list.length, total: list.length });
    },
    prefetch,
    whenReady,
    isReady(id) {
      return templates.has(id) || envTextures.has(id);
    },
    deferMaterials(ids) {
      ids.forEach((id) => deferredMaterials.add(id));
    },
    pending() {
      return queue.length + inflight.size;
    },
    gltf(id) {
      if (!shouldLoad(id)) return null;
      return templates.get(id) || null;
    },
    material(id) {
      if (!shouldLoad(id)) return null;
      if (placeholders.has(id)) return placeholders.get(id).base;
      if (!templates.has(id) && deferredMaterials.has(id)) return placeholder(id);
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
    const attach = () => {
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
    };
    if (assets.isReady?.(placement.model) === false && assets.whenReady) assets.whenReady(placement.model).then(attach);
    else attach();
  });
}
