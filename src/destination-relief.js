import { BufferAttribute, BufferGeometry, Color } from 'three';

const DATA_URL = new URL('../data/destination-relief.bin', import.meta.url);
const UNIT = 65535;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;

const ROUTE_STYLES = [
  { color: '#dc963f', width: .0045, dash: [.013, .007], lift: .0031 },
  { color: '#168151', width: .0041, lift: .0038 },
  { color: '#1468b5', width: .0041, lift: .0039 },
  { color: '#bf354b', width: .0041, lift: .004 },
  { color: '#2f414d', width: .0039, lift: .0041 },
  { color: '#142537', width: .0045, dash: [.009, .0038], lift: .0042 },
  { color: '#6f8485', width: .0032, lift: .0036 },
];

export async function loadDestinationReliefs() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error('Could not load mountain reliefs (HTTP ' + response.status + ')');
  const view = new DataView(await response.arrayBuffer());
  if (view.getUint32(0) !== 0x41445232) throw new Error('Invalid destination relief format');

  const entries = new Map();
  const decoder = new TextDecoder();
  let offset = 5;
  for (let i = 0; i < view.getUint8(4); i++) {
    const nameLength = view.getUint8(offset++);
    const name = decoder.decode(new Uint8Array(view.buffer, offset, nameLength));
    offset += nameLength;
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > view.byteLength) throw new Error('Incomplete destination relief');
    entries.set(name, new DataView(view.buffer, offset, length));
    offset += length;
  }
  return entries;
}

function vertexBatch() {
  const positions = [], colors = [];
  return {
    vertex({ x, y, z }, { r, g, b }) {
      positions.push(x, y, z);
      colors.push(r, g, b);
      return positions.length / 3 - 1;
    },
    geometry(indices) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
      if (indices) geometry.setIndex(indices);
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

function terrainFace(batch, a, b, c, peak, variation, color) {
  const elevation = (a.y + b.y + c.y) / (3 * peak);
  const forest = (a.forest + b.forest + c.forest) / 3;
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  const faceSlope = 1 - ny / length;
  const faceLight = (-.46 * nx + .81 * ny + .35 * nz) / length;
  for (const point of [a, b, c]) {
    const terrainMix = .72;
    const height = mix(elevation, point.y / peak, terrainMix);
    const slope = mix(faceSlope, point.slope, terrainMix);
    const light = mix(faceLight, point.light, terrainMix);
    const rock = clamp((slope - .22) * 2.3) * (.9 - height * .28);
    const woodland = mix(forest, point.forest, terrainMix) * (.84 - height * .39) * (1 - rock);
    const snow = 1 - rock - woodland;
    const shade = (light - .8) * 48 + variation * (1 - terrainMix) + point.grain * 10;
    const r = (222 + 20 * height) * snow + 113 * rock + 83 * woodland + shade;
    const g = (236 + 12 * height) * snow + 133 * rock + 132 * woodland + shade;
    const blue = (238 + 12 * height) * snow + 141 * rock + 117 * woodland + shade;
    color.setRGB(clamp(r / 255), clamp(g / 255), clamp(blue / 255), 'srgb');
    batch.vertex(point, color);
  }
}

function locator(axis) {
  // Summit samples are inserted at their exact coordinates, producing a nonuniform grid.
  const max = axis.length - 1;
  const first = axis[0], span = axis[max] - first;
  const bins = new Uint8Array(1024);
  for (let bucket = 0, i = 0; bucket < bins.length; bucket++) {
    const position = first + span * bucket / bins.length;
    while (i < max - 1 && axis[i + 1] <= position) i++;
    bins[bucket] = i;
  }
  return position => {
    let i = bins[clamp(Math.floor((position - first) / span * bins.length), 0, bins.length - 1)];
    while (i < max - 1 && axis[i + 1] <= position) i++;
    return i;
  };
}

function terrainGrain(x, z) {
  return .50 * Math.sin(x * 33 + z * 21) * Math.cos(z * 27 - x * 9) +
    .34 * Math.sin(z * 44 - x * 19) * Math.cos(x * 37 + z * 13) +
    .16 * Math.cos(x * 63 - z * 71);
}

function appendWalls(batch, perimeter) {
  const top = new Color(), bottom = new Color();
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length];
    const wallA = { x: a.x, y: 0, z: a.z };
    const wallB = { x: b.x, y: 0, z: b.z };
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const shade = (.46 * dz + .35 * dx) / length * 21;
    top.setRGB((70 + shade) / 255, (88 + shade) / 255, (96 + shade) / 255, 'srgb');
    bottom.setRGB((39 + shade) / 255, (56 + shade) / 255, (64 + shade) / 255, 'srgb');
    batch.vertex(a, top);
    batch.vertex(wallA, bottom);
    batch.vertex(b, top);
    batch.vertex(b, top);
    batch.vertex(wallA, bottom);
    batch.vertex(wallB, bottom);
  }
}

function routeGeometry(view, start, sample, width, depth, routeCells) {
  const batch = vertexBatch();
  const triangles = [];
  let offset = start;
  for (let route = 0; route < view.getUint16(10, true); route++) {
    const style = ROUTE_STYLES[view.getUint8(offset)];
    const count = view.getUint16(offset + 1, true);
    offset += 3;
    const color = new Color(style.color);
    let lastX, lastZ, lastEdge, length = 0;
    const edge = (x, z, dx, dz) => {
      const leftX = clamp(x - dz, -width / 2, width / 2), leftZ = clamp(z + dx, -depth / 2, depth / 2);
      const rightX = clamp(x + dz, -width / 2, width / 2), rightZ = clamp(z - dx, -depth / 2, depth / 2);
      routeCells.add(routeCell(x, z));
      return [
        batch.vertex({ x: leftX, y: sample(leftX, leftZ).y + style.lift, z: leftZ }, color),
        batch.vertex({ x: rightX, y: sample(rightX, rightZ).y + style.lift, z: rightZ }, color),
      ];
    };
    for (let k = 0; k < count; k++, offset += 4) {
      const x = (view.getUint16(offset, true) / UNIT - .5) * width;
      const z = (view.getUint16(offset + 2, true) / UNIT - .5) * depth;
      const segmentX = x - lastX, segmentZ = z - lastZ;
      const segment = Math.hypot(segmentX, segmentZ);
      if (segment > 0) {
        const radius = style.width * .5;
        const dx = segmentX * radius / segment, dz = segmentZ * radius / segment;
        const steps = Math.ceil(segment / .0045);
        const stride = segment / steps;
        let previous = lastEdge ?? edge(lastX, lastZ, dx, dz);
        for (let i = 1; i <= steps; i++) {
          const current = edge(mix(lastX, x, i / steps), mix(lastZ, z, i / steps), dx, dz);
          const dash = style.dash;
          if (!dash || (length + stride * .5) % (dash[0] + dash[1]) < dash[0]) {
            triangles.push(previous[0], current[0], previous[1], current[0], current[1], previous[1]);
          }
          length += stride;
          previous = current;
        }
        lastEdge = previous;
      }
      lastX = x;
      lastZ = z;
    }
  }
  return batch.geometry(triangles);
}

const routeCell = (x, z) => Math.floor((x + 1) / .01) + Math.floor((z + 1) / .01) * 250;
const TREE_SHADES = ['#6f9b8f', '#587f71', '#375b54', '#41695f'].map(color => new Color(color));
const ROCK_SHADES = ['#798a8d', '#526a70', '#3e575e', '#657b7e'].map(color => new Color(color));

function landscapeGeometry(sample, routeCells, width, depth, random) {
  const batch = vertexBatch();
  function cap(x, y, z, size, base, apex, radius, sides, turn, shades) {
    const tip = { x: x + size * .055, y: y + size * apex, z };
    const ring = [];
    for (let side = 0; side < sides; side++) {
      const angle = side * Math.PI * 2 / sides + turn;
      ring.push({ x: x + Math.cos(angle) * size * radius, y: y + size * base, z: z + Math.sin(angle) * size * radius });
    }
    for (let side = 0; side < sides; side++) {
      const color = shades[side];
      batch.vertex(ring[side], color);
      batch.vertex(tip, color);
      batch.vertex(ring[(side + 1) % sides], color);
    }
  }

  function conifer(x, y, z, size) {
    cap(x, y, z, size, -.08, .59, .29, 4, .7, TREE_SHADES);
    cap(x, y, z, size, .27, .88, .23, 4, .75, TREE_SHADES);
    cap(x, y, z, size, .52, 1.15, .165, 4, .81, TREE_SHADES);
  }

  const spacing = .023;
  for (let z = -depth / 2 + spacing / 2; z < depth / 2 - spacing / 2; z += spacing) {
    for (let x = -width / 2 + spacing / 2; x < width / 2 - spacing / 2; x += spacing) {
      const sx = x + (random() - .5) * spacing, sz = z + (random() - .5) * spacing;
      if (Math.abs(sx) > width / 2 - .011 || Math.abs(sz) > depth / 2 - .011) continue;
      if (routeCells.has(routeCell(sx, sz))) continue;
      const { y, forest, slope } = sample(sx, sz);
      const tree = forest > .18 && random() < forest * .63 && slope < 1.1;
      const rock = !tree && random() < .009 + clamp(slope * .073, 0, .15) * (1 - forest);
      if (tree) {
        conifer(sx, y, sz, .014 + random() * .021);
      } else if (rock) {
        cap(sx, y, sz, .006 + random() * .013, -.16, .36, .55, 4, .51, ROCK_SHADES);
      }
    }
  }
  return batch.geometry();
}

export function createDestinationRelief(view) {
  const cols = view.getUint8(0), rows = view.getUint8(1);
  const width = view.getFloat32(2, true), depth = view.getFloat32(6, true);
  const pointCount = cols * rows;
  const readAxis = (length, offset, span) => Array.from({ length }, (_, i) =>
    (view.getUint16(offset + i * 2, true) / UNIT - .5) * span);
  const xAxis = readAxis(cols, 12, width);
  const zAxis = readAxis(rows, 12 + cols * 2, depth);
  const heightOffset = 12 + (cols + rows) * 2;
  const coverOffset = heightOffset + pointCount * 2;
  const points = [];
  let peak = 0;
  let seed = 0x31d3a402 ^ cols ^ (rows << 8);
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  for (const z of zAxis) for (const x of xAxis) {
    const index = points.length;
    const y = view.getUint16(heightOffset + index * 2, true) / UNIT;
    const forest = view.getUint8(coverOffset + index) / 255;
    points.push({ x, y, z, forest });
    peak = Math.max(peak, y);
  }

  // Sample the grade across neighbouring DEM posts so snow and rock shading
  // follow the ridges instead of exposing the diagonal of every triangle.
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const point = points[j * cols + i];
    const left = points[j * cols + Math.max(0, i - 1)];
    const right = points[j * cols + Math.min(cols - 1, i + 1)];
    const north = points[Math.max(0, j - 1) * cols + i];
    const south = points[Math.min(rows - 1, j + 1) * cols + i];
    const nx = (left.y - right.y) / (right.x - left.x);
    const nz = (north.y - south.y) / (south.z - north.z);
    const length = Math.hypot(nx, 1, nz);
    point.slope = 1 - 1 / length;
    point.light = (-.46 * nx + .81 + .35 * nz) / length;
    point.grain = terrainGrain(point.x, point.z) * .27;
  }

  const locateX = locator(xAxis), locateZ = locator(zAxis);
  const ground = {};
  function sample(x, z) {
    const i = locateX(x), j = locateZ(z);
    const dx = xAxis[i + 1] - xAxis[i], dz = zAxis[j + 1] - zAxis[j];
    const u = clamp((x - xAxis[i]) / dx), v = clamp((z - zAxis[j]) / dz);
    const index = j * cols + i;
    const first = u + v <= 1;
    const a = points[first ? index : index + cols + 1];
    const b = points[index + 1], c = points[index + cols];
    const wa = first ? 1 - u - v : u + v - 1, wb = first ? u : 1 - v, wc = 1 - wa - wb;
    ground.y = a.y * wa + b.y * wb + c.y * wc;
    ground.forest = a.forest * wa + b.forest * wb + c.forest * wc;
    ground.slope = Math.max(Math.abs(b.y - a.y) / (first ? dx : dz), Math.abs(c.y - a.y) / (first ? dz : dx));
    return ground;
  }

  const terrain = vertexBatch(), color = new Color();
  const addFace = (a, b, c) => terrainFace(terrain, a, b, c, peak, (random() - .5) * 5, color);
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    addFace(points[a], points[c], points[b]);
    addFace(points[d], points[b], points[c]);
  }

  const perimeter = [];
  for (let j = 0; j < rows - 1; j++) perimeter.push(points[j * cols]);
  for (let i = 0; i < cols - 1; i++) perimeter.push(points[(rows - 1) * cols + i]);
  for (let j = rows - 1; j > 0; j--) perimeter.push(points[j * cols + cols - 1]);
  for (let i = cols - 1; i > 0; i--) perimeter.push(points[i]);
  appendWalls(terrain, perimeter);

  const routeCells = new Set();
  const routes = routeGeometry(view, coverOffset + pointCount, sample, width, depth, routeCells);
  return { terrain: terrain.geometry(), routes, details: landscapeGeometry(sample, routeCells, width, depth, random), width, depth, peak };
}
