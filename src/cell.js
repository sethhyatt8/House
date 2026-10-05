// The choppable boards on the east wall become the door of this room.
// The player starts inside and has to fell the door to leave.
export const START_CELL = {
  spawnX: 4.12,
  spawnZ: 0.14,
  hatchet: { x: 3.48, y: 0.07, z: 0.12 },
  door: {
    x: 2.6,
    z0: -0.36,
    z1: 0.6,
    h: 2.02,
    thick: 0.07,
    rows: 8,
  },
  back: { z0: -0.3, z1: 0.54, h: 2.02, gateX: 5.08 },
  floor: { x0: 2.55, x1: 5.18, z0: -0.72, z1: 0.96 },
  ceiling: 2.42,
  blocks: [
    { x0: 2.5, x1: 3.33, z0: -3.05, z1: -0.36 },
    { x0: 2.5, x1: 3.33, z0: 0.6, z1: 3.05 },
    { x0: 3.28, x1: 4.92, z0: -0.98, z1: -0.72 },
    { x0: 3.28, x1: 4.92, z0: 0.96, z1: 1.22 },
    { x0: 4.7, x1: 4.96, z0: -0.98, z1: -0.3 },
    { x0: 4.7, x1: 4.96, z0: 0.54, z1: 1.22 },
  ],
};
