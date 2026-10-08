# Underwater pass (src/underwater.js, src/swim.js, src/scuba.js, models/sea/scuba_kit.glb)

| Mesh | Source model | Author | License | Link |
|---|---|---|---|---|
| scuba_tank | "Scuba tank" | Steren Giannini | CC-BY 3.0 | https://poly.pizza/m/4GhtCNARi8c |
| scuba_mask | original (built in Blender for House) | — | CC0 1.0 | — |
| scuba_fin | original (built in Blender for House) | — | CC0 1.0 | — |

Changes for House: the tank was re-centred base-at-origin and rescaled to 0.70 m, untextured flat colours,
292 triangles. Mask (442 tris) and fin (296 tris) are procedural Blender builds (no textures). All three are in one
47 KB GLB.

Everything else in the underwater pass is generated at runtime with no assets: the caustic texture (baked tiling
Worley noise), seabed ripples, kelp/seagrass ribbons, the fish school mesh, marine snow, light shafts, bubbles,
the Snell's-window surface, the mask HUD and all underwater sounds (filtered noise via Web Audio).
