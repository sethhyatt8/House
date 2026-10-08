# Swim / boat / reef pass: assets and sound

## Music (src/music.js)
No audio files are shipped. The ominous score (overlook woods bed, bear wake / fight swell, cave bed, heartbeat and
drum hits) is synthesised at runtime with WebAudio oscillators, filtered noise and feedback delays. It was written for
House, so there is nothing to license or credit. `?music=0` turns it off and `?musicvol=0.5` scales it.

## Sea boulder skirt (models/nature/namaqualand_boulder_04_lod.glb)
| File | Source | Author | License | Link |
|---|---|---|---|---|
| namaqualand_boulder_04_lod.glb | "Namaqualand Boulder 04" | Poly Haven | CC0 1.0 | https://polyhaven.com/a/namaqualand_boulder_04 |

Changes for House: geometry only (position, normal, uv), decimated from 2,000 to 632 triangles with three.js
SimplifyModifier, and written without textures or Draco (19 KB). world.js mirrors it into the buried skirt under each
sea boulder and draws it with the existing sea_boulder material.

## Reef kit (src/reefkit.js)
The brain, branching, table, fan, soft, barrel, tube-sponge and rubble pieces are procedural geometry written for
House, with nothing to license. The three recoloured pieces reused from models/sea/reef_corals.glb (bubble, plate,
urchin) keep their credits in CREDITS-reef.md. `?reefstyle=old` brings back the old reef.
