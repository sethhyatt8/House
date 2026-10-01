# Phase 2 asset credits / licenses

Everything here is **CC0** (public domain). Attribution isn't required but is appreciated.

| File | Source | Authors (per Poly Haven API / pack licence) | Processing |
|---|---|---|---|
| models/materials/dark_rock.glb | https://polyhaven.com/a/dark_rock | Amal Kumar | 2k glTF texture set → material on a 1×1 m quad (preview mesh dropped), ARM also used as occlusion, single-sided → baseColor 2048 ETC1S, normal 2048 UASTC+RDO, ARM 1024 UASTC+RDO |
| models/materials/seaside_rock.glb | https://polyhaven.com/a/seaside_rock | Dimitrios Savva | same as dark_rock |
| models/nature/namaqualand_boulder_04.glb | https://polyhaven.com/a/namaqualand_boulder_04 | Jenelle van Heerden | 2k glTF (59,066 tris) → flatten+join → normal-averaged weld + meshoptimizer simplify to 2,000 tris → ARM as occlusion → 1024 textures → KTX2 → Draco |
| models/nature/pines.glb (pine_a, pine_b, pine_far) | Quaternius Stylized Nature MegaKit (Standard, free): https://quaternius.com/packs/stylizednaturemegakit.html, download https://quaternius.itch.io/stylized-nature-megakit | Quaternius (pack License_Standard.txt: CC0 1.0) | Pine_5 → pine_a, Pine_2 → pine_b: kept only the trunk component of the bark (dropped the hidden dead branches), bark set OPAQUE single-sided, meshoptimizer simplify (Permissive) to 459 / 358 tris, dropped all-white leaf vertex colours. pine_far = 2 crossed quads with an albedo atlas baked from pine_b. Shared materials; bark 512, leaves 1024, impostor 512×512; KTX2; Draco |
| env/qwantani_moonrise_backdrop_2k.ktx2 | https://polyhaven.com/a/qwantani_moonrise_puresky | Greg Zaal (photography), Jarod Guest (processing) | 2k HDR → rotated so the moon matches the old moon azimuth → exposure-matched to the old canvas sky → sRGB 2048×1024 → KTX2 UASTC+zstd, no mips, stored bottom-up |
| env/qwantani_moonrise_env_512.hdr | same as above | same | 2k HDR → same rotation → moon clamped (luminance ≤ 10) → 4×4 box downsample to 512×256 → normalised to mean radiance 0.541 → RGBE |

Poly Haven licence: https://polyhaven.com/license
