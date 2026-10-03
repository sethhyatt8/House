# Model credits / licenses

All three phase-1 models are from Poly Haven and are licensed **CC0** (https://polyhaven.com/license). Attribution isn't required but is appreciated.

| File | Source | Authors (per Poly Haven API) | Processing |
|---|---|---|---|
| props/wooden_crate_02.glb | https://polyhaven.com/a/wooden_crate_02 | James Ray Cock, Jurita Burger | 2k glTF → flatten+join → weld+simplify (ratio 0.5, err 0.002) → textures resized to 1024 → KTX2 (ETC1S baseColor, UASTC+RDO normal/ARM) → Draco |
| props/boulder_01.glb | https://polyhaven.com/a/boulder_01 | Rico Cilliers | 2k glTF → flatten+join → normal-averaged weld + meshopt simplify to 3,000 tris → 1024 textures → KTX2 → Draco |
| props/hatchet.glb | https://polyhaven.com/a/hatchet | James Ray Cock, Ulan Cabanilla | 2k glTF → flatten+join → no simplify → 1024 textures → KTX2 → Draco |

## Crocodile enemy

| File | Asset | Author | License | Source |
|---|---|---|---|---|
| models/enemies/croc.glb | "Crocodile" (low-poly rigged crocodile, Blender 2.79 .blend) | br-n518 | CC0 1.0 (public domain dedication) | https://opengameart.org/content/crocodile-0 |

CC0 does not require attribution; it is credited anyway.

Changes made for House (Blender 4.2.3 + gltf-transform + KTX-Software 4.4.2, scripted in scripts/build-croc.sh / croc/build_croc.py, outside this repo):
- Applied the mirror modifier (918 triangles), metric scale (3.4 m long), faces +Z.
- Baked the author's IK animations (idle-loop, walk-loop, attack, death) to FK as Idle, Walk, Attack, Death. Removed the IK helper bones (27 joints remain).
- Added new FK clips: Swim, Lurk, Threat, Hurt, Grab.
- Recoloured the diffuse to a dark olive with mottling, a duller belly and yellow eyes. Turned the specular map into a roughness map (ORM green channel).
- Textures resized to 1024 and compressed to KTX2 (ETC1S colour/ORM, UASTC normal). Mesh compressed with Draco.

## Water

## water_001_normal_512.ktx2
- Source: "Water 001" by Katsukagi, 3D Textures — https://3dtextures.me/2017/12/28/water-001/
- License: CC0 (public domain), per https://3dtextures.me/about/
- Original: Water_001_NORM.jpg (1024x1024, OpenGL-style tangent-space normal map)
- Processing: downscaled to 512x512, encoded with KTX-Software 4.4.2:
  `ktx create --format R8G8B8_UNORM --assign-tf linear --encode uastc --uastc-quality 2 --uastc-rdo --uastc-rdo-l 0.5 --zstd 18 --generate-mipmap --normalize`
- Linear (non-colour) data, 10 mip levels. Used by src/water.js as two scrolling detail-normal layers.

## Feedback pass (canoe, paddles, HD croc)

| File | Asset | Author | License | Source |
|---|---|---|---|---|
| models/props/canoe_cedar.glb | "Canoe and paddles" (canoe mesh) | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/7lcrTaY7sE_ |
| models/props/paddle.glb | "Canoe and paddles" (paddle mesh) | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/7lcrTaY7sE_ |
| models/enemies/croc_hd.glb | "Crocodile" (same source as croc.glb) | br-n518 | CC0 1.0 | https://opengameart.org/content/crocodile-0 |

- canoe_cedar: Blender 4.2, transforms applied, scaled to 0.86 x 0.459 x 3.7 m (same frame as canoe.glb), texture 512 KTX2 (ETC1S), quantized.
- paddle: PCA-aligned so the shaft is -Y from the grip point (origin), 0.85 m long, blade widened x1.25, texture 256 KTX2, quantized.
- croc_hd: croc.glb's rig and clips unchanged; Catmull-Clark subdivision level 1 applied (918 -> 3,940 tris, lip and teeth edges creased), new baked 1024 textures (procedural scutes/osteoderms, countershading, crevice AO, original teeth/mouth/eyes kept), KTX2 + Draco. Only loads with `?crocmodel=hd`.

## Forest pass (shark, forest kit)

| File | Asset | Author | License | Source |
|---|---|---|---|---|
| models/sea/shark_real.glb | "shark.glb" | Babylon.js | CC-BY 4.0 | https://github.com/BabylonJS/Assets/blob/master/meshes/shark.glb |
| models/nature/forest_kit.glb (ground cover) | "Stylized Nature MegaKit" (ferns, plants, grass, bushes, rocks, mushrooms) | Quaternius | CC0 1.0 | https://quaternius.com/packs/stylizednaturemegakit.html |
| models/nature/forest_kit.glb (floor texture) | "Forest Leaves 04" | Rob Tuytel (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/forest_leaves_04 |

- shark_real: mesh, skin (31 joints) and Swim animation kept. Wrapped in a root node so it uses the makeWhite() unit frame (faces +X, nose x 1.06, tail x -1.56, fin tip y 0.591). Textures resized to 512 and compressed to KTX2 (ETC1S colour, UASTC normal); mesh quantized. 5,999 tris. Loads by default; `?shark=old` uses shark_white.glb.
- forest_kit: chosen MegaKit pieces packed into one 1024 alpha-tested atlas, plus the Forest Leaves 04 diffuse resized to 1024 (tiling floor). Both are ETC1S KTX2; meshes are Draco. Built with Blender 4.2.3 + gltf-transform (forest/build_atlas.py, build_kit.py, outside this repo).
