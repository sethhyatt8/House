import { COLORS, HEIGHTS, SHAPES } from './config.js';
import { canPlace, createGrid, layoutOf, occupy } from './grid.js';

const PLATE = 8;
const MAX_SPAN = 5;
const BOXES = SHAPES.filter((shape) => !shape.kind);

function int(random, count) {
  return Math.floor(random() * count);
}

function pickShape(random) {
  const weights = BOXES.map((shape) => shape.w * shape.d);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let i = 0; i < BOXES.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return BOXES[i];
  }
  return BOXES[BOXES.length - 1];
}

function pickHeight(random) {
  const roll = random();
  if (roll < 0.62) return HEIGHTS[0];
  if (roll < 0.86) return HEIGHTS[1];
  return HEIGHTS[2];
}

function specBrick(shape, color, height, rot) {
  return {
    userData: {
      baseW: shape.w,
      baseD: shape.d,
      kind: 'box',
      rot,
      units: height.units,
      flat: false,
      colorId: color.id,
      shapeId: shape.id,
      heightId: height.id,
    },
  };
}

function studsOf(grid) {
  const studs = [];
  for (const [key, brick] of grid) {
    if (!brick.userData.studSet?.has(key)) continue;
    const [x, z, layer] = key.split(',').map(Number);
    studs.push({ x, z, layer });
  }
  return studs;
}

function cellsOf(grid) {
  const cells = [];
  for (const [key, brick] of grid) {
    const [x, z, layer] = key.split(',').map(Number);
    cells.push({ x, z, layer, color: brick.userData.colorId, pieceId: brick.userData.pieceId });
  }
  return cells;
}

function spanOk(existing, brick, gx, gz) {
  const xs = existing.map((cell) => cell.x);
  const zs = existing.map((cell) => cell.z);
  for (const cell of layoutOf(brick)) {
    const x = gx + cell.x;
    const z = gz + cell.z;
    if (x < 0 || z < 0 || x >= PLATE || z >= PLATE) return false;
    xs.push(x);
    zs.push(z);
  }
  if (!xs.length) return false;
  return Math.max(...xs) - Math.min(...xs) <= MAX_SPAN && Math.max(...zs) - Math.min(...zs) <= MAX_SPAN;
}

function firstSpot(brick, random) {
  const cells = layoutOf(brick);
  const fw = Math.max(...cells.map((cell) => cell.x)) + 1;
  const fd = Math.max(...cells.map((cell) => cell.z)) + 1;
  return {
    gx: 1 + int(random, Math.max(1, 5 - fw)),
    gz: 1 + int(random, Math.max(1, 5 - fd)),
    layer: 0,
  };
}

function nextSpot(grid, brick, random) {
  const studs = studsOf(grid);
  const occupied = cellsOf(grid);
  const beside = !studs.length || random() < 0.42;
  if (beside) {
    const cell = occupied[int(random, occupied.length)];
    return {
      gx: cell.x + int(random, 5) - 2,
      gz: cell.z + int(random, 5) - 2,
      layer: 0,
    };
  }
  const stud = studs[int(random, studs.length)];
  const feet = layoutOf(brick).filter((cell) => cell.foot);
  const foot = feet[int(random, feet.length)];
  const jx = random() < 0.62 ? 0 : (random() < 0.5 ? -1 : 1);
  const jz = random() < 0.62 ? 0 : (random() < 0.5 ? -1 : 1);
  return {
    gx: stud.x - foot.x + jx,
    gz: stud.z - foot.z + jz,
    layer: stud.layer + 1,
  };
}

function recenter(pieces, cells) {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const minZ = Math.min(...cells.map((cell) => cell.z));
  const maxZ = Math.max(...cells.map((cell) => cell.z));
  const shiftX = Math.floor((PLATE - (maxX - minX + 1)) / 2) - minX;
  const shiftZ = Math.floor((PLATE - (maxZ - minZ + 1)) / 2) - minZ;
  for (const piece of pieces) {
    piece.gx += shiftX;
    piece.gz += shiftZ;
  }
  for (const cell of cells) {
    cell.x += shiftX;
    cell.z += shiftZ;
  }
}

function grow(random) {
  const grid = createGrid();
  const pieces = [];
  const goal = 5 + int(random, 4);
  for (let n = 0; n < goal; n += 1) {
    let placed = false;
    for (let attempt = 0; attempt < 70 && !placed; attempt += 1) {
      const shape = pickShape(random);
      const color = COLORS[int(random, COLORS.length)];
      const height = pickHeight(random);
      const rot = int(random, 4);
      const brick = specBrick(shape, color, height, rot);
      const spot = n === 0 ? firstSpot(brick, random) : nextSpot(grid, brick, random);
      if (!spanOk(cellsOf(grid), brick, spot.gx, spot.gz)) continue;
      if (!canPlace(grid, brick, spot.gx, spot.gz, spot.layer)) continue;
      brick.userData.pieceId = pieces.length;
      occupy(grid, brick, spot.gx, spot.gz, spot.layer);
      pieces.push({
        shapeId: shape.id,
        colorId: color.id,
        heightId: height.id,
        units: height.units,
        rot,
        gx: spot.gx,
        gz: spot.gz,
        layer: spot.layer,
      });
      placed = true;
    }
    if (!placed) break;
  }
  if (pieces.length < 4) return null;
  if (new Set(pieces.map((piece) => piece.colorId)).size < 2) {
    const other = COLORS.find((color) => color.id !== pieces[0].colorId);
    const last = pieces.length - 1;
    pieces[last].colorId = other.id;
    for (const brick of grid.values()) {
      if (brick.userData.pieceId === last) brick.userData.colorId = other.id;
    }
  }
  const cells = cellsOf(grid).map(({ x, z, layer, color }) => ({ x, z, layer, color }));
  recenter(pieces, cells);
  return { pieces, cells };
}

export function generateModel(random = Math.random) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const model = grow(random);
    if (model && model.cells.length >= 12) return model;
  }
  return grow(random);
}

function turnCell(x, z, rot) {
  const turn = ((rot % 4) + 4) % 4;
  if (turn === 1) return { x: -z, z: x };
  if (turn === 2) return { x: -x, z: -z };
  if (turn === 3) return { x: z, z: -x };
  return { x, z };
}

export function lookKey(cells, rot = 0) {
  const turned = cells.map((cell) => {
    const point = turnCell(cell.x, cell.z, rot);
    return { x: point.x, z: point.z, layer: cell.layer, color: cell.color };
  });
  const minX = Math.min(...turned.map((cell) => cell.x));
  const minZ = Math.min(...turned.map((cell) => cell.z));
  return turned
    .map((cell) => `${cell.x - minX},${cell.z - minZ},${cell.layer}:${cell.color}`)
    .sort()
    .join('|');
}

function mirrorCells(cells) {
  return cells.map((cell) => ({ x: -cell.x, z: cell.z, layer: cell.layer, color: cell.color }));
}

export function sameLook(built, target) {
  if (!built.length || built.length !== target.length) return false;
  const goal = lookKey(target, 0);
  const mirrored = lookKey(mirrorCells(target), 0);
  for (let rot = 0; rot < 4; rot += 1) {
    const key = lookKey(built, rot);
    if (key === goal || key === mirrored) return true;
  }
  return false;
}

export function lookVerdict(built, target) {
  if (!built.length) return 'ready';
  if (sameLook(built, target)) return 'match';
  if (built.length > target.length) return 'extra';
  if (built.length < target.length) return 'short';
  return 'different';
}

export function cellsFromGrid(grid) {
  const cells = [];
  for (const [key, brick] of grid) {
    const [x, z, layer] = key.split(',').map(Number);
    cells.push({ x, z, layer, color: brick.userData.colorId });
  }
  return cells;
}
