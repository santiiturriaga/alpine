const DATA_URL = new URL('../data/destination-relief.bin', import.meta.url);
const UNIT = 65535;
const PITCH = .56;
const SIN_PITCH = Math.sin(PITCH);
const COS_PITCH = Math.cos(PITCH);
const TAN_PITCH = Math.tan(PITCH);
const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(v, max));

const ROUTE_STYLES = [
  { color: '#dc963f', width: .0022, dash: [.008, .005] },
  { color: '#168151', width: .0021 },
  { color: '#1468b5', width: .0021 },
  { color: '#bf354b', width: .0021 },
  { color: '#2f414d', width: .0019 },
  { color: '#142537', width: .0024, dash: [.006, .0025] },
  { color: '#6f8485', width: .0016 },
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

function shadeColor(rgb, shade) {
  return 'rgb(' + rgb.map(value => Math.round(clamp(value + shade, 0, 255))).join(',') + ')';
}

function terrainColor(a, b, c, peak, variation) {
  const elevation = (a.y + b.y + c.y) / (3 * peak);
  const forest = (a.forest + b.forest + c.forest) / 3;
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uz * vy - uy * vz, ny = ux * vz - uz * vx, nz = uy * vx - ux * vy;
  const length = Math.hypot(nx, ny, nz);
  const slope = 1 - ny / length;
  const light = (-.47 * nx + .81 * ny - .34 * nz) / length;
  const rock = clamp((slope - .22) * 2.3) * (.9 - elevation * .28);
  const woodland = forest * (.85 - elevation * .4) * (1 - rock);
  const snow = [222 + 20 * elevation, 236 + 12 * elevation, 238 + 12 * elevation];
  const slate = [113, 133, 141];
  const pine = [83, 132, 117];
  const rgb = snow.map((value, i) => value * (1 - rock - woodland) + slate[i] * rock + pine[i] * woodland);
  return shadeColor(rgb, (light - .8) * 47 + variation);
}

function locator(axis) {
  // Named summits make the grid nonuniform. A lookup keeps surface queries cheap.
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

function footprint(x, z, width, depth) {
  const cornerRadius = Math.min(width, depth) * .22;
  const u = Math.max(0, Math.abs(x) - width / 2 + cornerRadius);
  const v = Math.max(0, Math.abs(z) - depth / 2 + cornerRadius);
  return u * u + v * v <= (cornerRadius + .000001) ** 2;
}

function cutFaces(boundary, points, addFace, random) {
  const rings = new Map();
  const bands = [
    [.994, .88, [107, 130, 133]],
    [.978, .55, [75, 96, 107]],
    [.943, .23, [65, 83, 94]],
    [.898, 0, [45, 65, 78]],
  ];
  function section(index) {
    if (!rings.has(index)) {
      const { x, y, z } = points[index];
      const start = points.length;
      const drift = (random() - .5) * .038;
      for (const [scale, level] of bands) {
        const height = (y + .031) * level - .031;
        const edge = scale + drift * (1 - level) * level;
        points.push({ x: x * edge, y: height + drift * level * (1 - level), z: z * edge });
      }
      rings.set(index, [index, start, start + 1, start + 2, start + 3]);
    }
    return rings.get(index);
  }
  for (const [start, end] of boundary.values()) {
    const a = section(start), b = section(end);
    const nx = points[end].z - points[start].z;
    const nz = points[start].x - points[end].x;
    const light = (-nx * .65 - nz * .4) / Math.hypot(nx, nz) * 18;
    for (let i = 0; i < bands.length; i++) {
      const variation = (random() - .5) * 12;
      addFace(a[i], b[i], b[i + 1], a[i + 1], shadeColor(bands[i][2], light + variation), nx, nz);
    }
  }
}

function decodeLandscape(view, point, width, depth, surface) {
  const routes = ROUTE_STYLES.map(() => []);
  const routeCells = new Set();
  const cellSize = .0075;
  const cellIndex = (x, z) => Math.floor((x + 1) / cellSize) + Math.floor((z + 1) / cellSize) * 300;
  let offset = point;
  for (let route = 0; route < view.getUint16(10, true); route++) {
    const style = view.getUint8(offset);
    const count = view.getUint16(offset + 1, true);
    offset += 3;
    const line = [];
    let lastX, lastZ;
    function addPoint(x, z) {
      const ground = surface(x, z);
      if (!ground) {
        if (line.at(-1)) line.push(null);
        return;
      }
      line.push({ x, y: ground.y + (style === 0 ? .0038 : .0022), z });
      routeCells.add(cellIndex(x, z));
    }
    for (let k = 0; k < count; k++, offset += 4) {
      const x = (view.getUint16(offset, true) / UNIT - .5) * width;
      const z = (view.getUint16(offset + 2, true) / UNIT - .5) * depth;
      if (k === 0) addPoint(x, z);
      else {
        const samples = Math.ceil(Math.hypot(x - lastX, z - lastZ) / .006);
        for (let i = 1; i <= samples; i++) {
          addPoint(lastX + (x - lastX) * i / samples, lastZ + (z - lastZ) * i / samples);
        }
      }
      lastX = x;
      lastZ = z;
    }
    if (line.length > 1) routes[style].push(line);
  }
  return { routes, nextToRoute: (x, z) => routeCells.has(cellIndex(x, z)) };
}

export function createDestinationRelief(view) {
  const cols = view.getUint8(0), rows = view.getUint8(1);
  const width = view.getFloat32(2, true), depth = view.getFloat32(6, true);
  const pointCount = cols * rows;
  const points = [], faces = [];
  const readAxis = (length, offset, span) => Array.from({ length }, (_, i) =>
    (view.getUint16(offset + i * 2, true) / UNIT - .5) * span);
  const xAxis = readAxis(cols, 12, width);
  const zAxis = readAxis(rows, 12 + cols * 2, depth);
  const heightOffset = 12 + (cols + rows) * 2;
  const coverOffset = heightOffset + pointCount * 2;
  const inFootprint = new Uint8Array(pointCount);
  const triangles = new Uint8Array(pointCount);
  let seed = 0x31d3a402 ^ cols ^ (rows << 8);
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  let peak = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const index = points.length;
    const x = xAxis[i], z = zAxis[j];
    const y = view.getUint16(heightOffset + index * 2, true) / UNIT;
    const forest = view.getUint8(coverOffset + index) / 255;
    points.push({ x, y, z, forest });
    if (footprint(x, z, width, depth)) {
      inFootprint[index] = 1;
      peak = Math.max(peak, y);
    }
  }

  function addFace(a, b, c, d, color, nx = 0, nz = 0) {
    const vertices = (d === null ? [a, b, c] : [a, b, c, d]).map(i => points[i]);
    faces.push({ a, b, c, d, color, nx, nz, order: 0,
      x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length,
      y: vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length,
      z: vertices.reduce((sum, point) => sum + point.z, 0) / vertices.length });
  }

  const boundary = new Map();
  function markEdge(a, b) {
    const key = Math.min(a, b) * pointCount + Math.max(a, b);
    if (!boundary.delete(key)) boundary.set(key, [a, b]);
  }
  function addTerrain(a, b, c, cell, flag) {
    if (!inFootprint[a] || !inFootprint[b] || !inFootprint[c]) return;
    triangles[cell] |= flag;
    addFace(a, b, c, null, terrainColor(points[a], points[b], points[c], peak, (random() - .5) * 7));
    markEdge(a, b);
    markEdge(b, c);
    markEdge(c, a);
  }

  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    addTerrain(a, b, c, a, 1);
    addTerrain(d, c, b, a, 2);
  }
  cutFaces(boundary, points, addFace, random);

  const locateX = locator(xAxis), locateZ = locator(zAxis);
  function interpolate(x, z, out) {
    if (Math.abs(x) > width * .5 + .0000001 || Math.abs(z) > depth * .5 + .0000001) return undefined;
    const i = locateX(x), j = locateZ(z);
    const u = clamp((x - xAxis[i]) / (xAxis[i + 1] - xAxis[i]));
    const v = clamp((z - zAxis[j]) / (zAxis[j + 1] - zAxis[j]));
    const index = j * cols + i;
    const first = u + v <= 1;
    if (!(triangles[index] & (first ? 1 : 2))) return undefined;
    const a = points[first ? index : index + cols + 1];
    const b = points[index + 1], c = points[index + cols];
    const wa = first ? 1 - u - v : u + v - 1, wb = first ? u : 1 - v, wc = 1 - wa - wb;
    const y = a.y * wa + b.y * wb + c.y * wc;
    if (out) {
      out.y = y;
      out.forest = a.forest * wa + b.forest * wb + c.forest * wc;
      out.slope = Math.max(Math.abs(b.y - a.y), Math.abs(c.y - a.y)) /
        Math.max(xAxis[i + 1] - xAxis[i], zAxis[j + 1] - zAxis[j]);
    }
    return y;
  }
  const ground = {};
  const surface = (x, z) => interpolate(x, z, ground) === undefined ? null : ground;
  const { routes, nextToRoute } = decodeLandscape(view, coverOffset + pointCount, width, depth, surface);

  const details = [];
  const spacing = .0185;
  for (let z = -depth * .49; z < depth * .49; z += spacing) {
    for (let x = -width * .49; x < width * .49; x += spacing) {
      const sx = x + (random() - .5) * spacing, sz = z + (random() - .5) * spacing;
      const sample = surface(sx, sz);
      if (!sample || nextToRoute(sx, sz)) continue;
      const { y, forest, slope } = sample;
      const tree = forest > .18 && random() < forest * .61 && slope < 1.2 && footprint(sx * 1.08, sz * 1.08, width, depth);
      const rock = !tree && random() < .012 + clamp(slope * .1, 0, .21) * (1 - forest);
      if (tree || rock) {
        const size = tree ? .014 + random() * .021 : .005 + random() * .013;
        details.push({ x: sx, y, z: sz, size, tree, tone: random(), order: 0 });
      }
    }
  }

  // Rays towards the camera stop routes and objects appearing through a ridge.
  const step = .009;
  function visible(point, s, c, lift = 0) {
    const dx = step * s, dz = step * c, dy = step * TAN_PITCH;
    let x = point.x + dx * .5, z = point.z + dz * .5, y = point.y + lift + dy * .5;
    while (y < peak && Math.abs(x) < width * .5 && Math.abs(z) < depth * .5) {
      if (interpolate(x, z) > y + .0006) return false;
      x += dx;
      z += dz;
      y += dy;
    }
    return true;
  }

  let radius = 0, top = Infinity, bottom = -Infinity;
  function frame({ x, y, z }) {
    const r = Math.hypot(x, z);
    radius = Math.max(radius, r);
    top = Math.min(top, -r * SIN_PITCH - y * COS_PITCH);
    bottom = Math.max(bottom, r * SIN_PITCH - y * COS_PITCH);
  }
  for (const { a, b, c, d } of faces) {
    frame(points[a]);
    frame(points[b]);
    frame(points[c]);
    if (d !== null) frame(points[d]);
  }
  return {
    points, faces, routes, details, visible, radius, top, bottom,
    sx: new Float32Array(points.length), sy: new Float32Array(points.length),
  };
}

export function hitDestinationRelief({ faces, sx, sy }, x, y) {
  function hitTriangle(a, b, c) {
    if (x < Math.min(sx[a], sx[b], sx[c]) || x > Math.max(sx[a], sx[b], sx[c]) ||
        y < Math.min(sy[a], sy[b], sy[c]) || y > Math.max(sy[a], sy[b], sy[c])) return false;
    const cross = (start, end) => (sx[end] - sx[start]) * (y - sy[start]) - (sy[end] - sy[start]) * (x - sx[start]);
    const ab = cross(a, b), bc = cross(b, c), ca = cross(c, a);
    return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
  }
  return faces.some(({ a, b, c, d, inView }) => inView && (hitTriangle(a, b, c) || (d !== null && hitTriangle(a, c, d))));
}

function polygon(ctx, coordinates, color) {
  ctx.beginPath();
  ctx.moveTo(coordinates[0], coordinates[1]);
  for (let i = 2; i < coordinates.length; i += 2) ctx.lineTo(coordinates[i], coordinates[i + 1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawTree(ctx, x, y, size, tone) {
  const w = size * (.29 + tone * .07);
  ctx.fillStyle = '#5e5447';
  ctx.fillRect(x - size * .035, y - size * .23, size * .07, size * .24);
  for (let i = 0; i < 3; i++) {
    const base = y - size * (.12 + .23 * i);
    const half = w * (1 - .17 * i);
    const tip = base - size * (.57 - i * .075);
    const pale = i === 2 ? '#cee2dc' : '#9dbeb4';
    polygon(ctx, [x, tip, x - half, base - size * .04, x, base + size * .02], i === 2 ? '#749f94' : '#4c8275');
    polygon(ctx, [x, tip, x + half, base - size * .045, x, base + size * .02], tone > .5 ? '#345e59' : '#315751');
    polygon(ctx, [x, tip - size * .035, x - half * .62, base - size * .18, x - half * .12, base - size * .23], pale);
  }
}

function drawRock(ctx, x, y, size, tone) {
  const h = size * (.48 + tone * .26);
  polygon(ctx, [x - size * .57, y, x - size * .37, y - h * .61, x - size * .08, y - h,
    x + size * .37, y - h * .78, x + size * .56, y - h * .1, x + size * .15, y + h * .1], '#61757d');
  polygon(ctx, [x - size * .37, y - h * .61, x - size * .08, y - h, x + size * .37, y - h * .78,
    x + size * .10, y - h * .45], tone > .58 ? '#e2eded' : '#a4b9bc');
  polygon(ctx, [x + size * .10, y - h * .45, x + size * .37, y - h * .78, x + size * .56, y - h * .1,
    x + size * .15, y + h * .1], '#445d67');
}

export function drawDestinationRelief(canvas, model, yaw, detailed = true) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const { points, faces, routes, details, visible, sx, sy, radius, top, bottom } = model;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const scale = Math.min(width * .95 / (radius * 2), height * .94 / (bottom - top + .045));
  const cx = width * .5, cy = height * .52 - (top + bottom) * .5 * scale;
  const screenX = point => cx + (point.x * c - point.z * s) * scale;
  const screenY = point => cy + ((point.x * s + point.z * c) * SIN_PITCH - point.y * COS_PITCH) * scale;
  const cameraDepth = point => (point.x * s + point.z * c) * COS_PITCH + point.y * SIN_PITCH;
  for (let i = 0; i < points.length; i++) {
    sx[i] = screenX(points[i]);
    sy[i] = screenY(points[i]);
  }
  for (const face of faces) face.order = cameraDepth(face);
  faces.sort((a, b) => a.order - b.order);

  ctx.clearRect(0, 0, width, height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = .8;
  for (const face of faces) {
    const { a, b, c: end, d, color, nx, nz } = face;
    face.inView = d === null || nx * s + nz * c > 0;
    if (!face.inView) continue;
    ctx.beginPath();
    ctx.moveTo(sx[a], sy[a]);
    ctx.lineTo(sx[b], sy[b]);
    ctx.lineTo(sx[end], sy[end]);
    if (d !== null) ctx.lineTo(sx[d], sy[d]);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.fill();
    ctx.stroke();
  }

  const drawStyle = style => {
    if (!routes[style].length) return;
    const appearance = ROUTE_STYLES[style];
    ctx.beginPath();
    for (const line of routes[style]) {
      let drawing = false;
      for (const point of line) {
        const inView = point && visible(point, s, c);
        if (inView) {
          if (drawing) ctx.lineTo(screenX(point), screenY(point));
          else ctx.moveTo(screenX(point), screenY(point));
        }
        drawing = inView;
      }
    }
    ctx.strokeStyle = appearance.color;
    ctx.lineWidth = Math.max(.56, width * appearance.width);
    ctx.setLineDash(appearance.dash?.map(length => width * length) || []);
    ctx.stroke();
  };
  // Put the amber lift dashes behind overlapping trails.
  for (const style of [0, 6, 1, 2, 3, 4, 5]) drawStyle(style);
  ctx.setLineDash([]);

  const visibleDetails = [];
  for (const detail of details) {
    if ((!detailed && detail.tone < .3) || !visible(detail, s, c, detail.size * .6)) continue;
    detail.order = cameraDepth(detail);
    visibleDetails.push(detail);
  }
  visibleDetails.sort((a, b) => a.order - b.order);
  for (const detail of visibleDetails) {
    const x = screenX(detail), y = screenY(detail), size = detail.size * scale;
    ctx.fillStyle = '#142b3542';
    ctx.beginPath();
    ctx.ellipse(x + size * .13, y + size * .01, size * .41, size * .11, 0, 0, Math.PI * 2);
    ctx.fill();
    if (detail.tree) drawTree(ctx, x, y, size, detail.tone);
    else drawRock(ctx, x, y, size, detail.tone);
  }
}
