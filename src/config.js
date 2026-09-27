export const STUD = 0.06;
export const HEIGHT = 0.072;
export const LAYER = HEIGHT / 4;
export const STUD_H = 0.012;
export const PEG_MIN = 0.3;
export const PEG_MAX = 2;
export const GRID_X = 16;
export const GRID_Z = 12;
export const MAX_LAYER = 80;
export const MAX_PEDESTALS = 8;

export const COLORS = [
  { id: 'red', name: 'Red', hex: 0xd12c2c },
  { id: 'blue', name: 'Blue', hex: 0x2b6cb0 },
  { id: 'yellow', name: 'Yellow', hex: 0xf1c40f },
  { id: 'green', name: 'Green', hex: 0x239b56 },
  { id: 'white', name: 'White', hex: 0xd2c6b4 },
  { id: 'black', name: 'Black', hex: 0x222326 },
  { id: 'orange', name: 'Orange', hex: 0xe67e22 },
  { id: 'tan', name: 'Tan', hex: 0xd4a574 },
  { id: 'pink', name: 'Pink', hex: 0xf07aaa },
  { id: 'purple', name: 'Purple', hex: 0x7b4eab },
  { id: 'lime', name: 'Lime', hex: 0x8fbf3a },
];

export const SHAPES = [
  { id: '1x1', name: '1×1', w: 1, d: 1 },
  { id: '1x2', name: '1×2', w: 1, d: 2 },
  { id: '1x3', name: '1×3', w: 1, d: 3 },
  { id: '1x4', name: '1×4', w: 1, d: 4 },
  { id: '2x2', name: '2×2', w: 2, d: 2 },
  { id: '2x3', name: '2×3', w: 2, d: 3 },
  { id: '2x4', name: '2×4', w: 2, d: 4 },
  { id: 'slope12', name: 'Slope 1×2', button: 'S 1×2', w: 1, d: 2, kind: 'slope' },
  { id: 'slope22', name: 'Slope 2×2', button: 'S 2×2', w: 2, d: 2, kind: 'slope' },
  { id: 'wall22', name: '45° Wall', button: '45°', w: 2, d: 2, kind: 'wall' },
];

export function colorById(id) {
  return COLORS.find((color) => color.id === id);
}

export function shapeById(id) {
  return SHAPES.find((shape) => shape.id === id);
}

export const HEIGHTS = [
  { id: '1', label: '1', units: 4 },
  { id: 'half', label: '1/2', units: 2 },
  { id: 'quarter', label: '1/4', units: 1 },
];

export function heightById(id) {
  return HEIGHTS.find((height) => height.id === id) || HEIGHTS[0];
}

export function partLabel(colorId, shapeId, heightId = '1', flat = false) {
  const height = heightById(heightId);
  const size = height.id === '1' ? '' : ` ${height.label}`;
  const top = flat ? ' flat' : '';
  return `${colorById(colorId).name} ${shapeById(shapeId).name}${size}${top}`;
}
