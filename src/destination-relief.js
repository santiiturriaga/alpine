const DATA_URL = new URL('../data/destination-relief.bin', import.meta.url);
const UNIT = 65535;

export async function loadDestinationReliefs() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`Destination relief returned HTTP ${response.status}`);
  const view = new DataView(await response.arrayBuffer());
  if (view.getUint32(0) !== 0x41445231) throw new Error('Invalid destination relief format');

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

const MIX = [
  [0, [63, 96, 106]], [0.25, [102, 132, 141]],
  [0.47, [157, 181, 190]], [0.72, [209, 224, 231]], [1, [241, 246, 248]],
];
const PITCH = .48;
const SIN_PITCH = Math.sin(PITCH);
const COS_PITCH = Math.cos(PITCH);
const TAN_PITCH = Math.tan(PITCH);

function faceColor(a, b, c, peak) {
  const h = (a.y + b.y + c.y) / (3 * peak);
  let i = 1;
  while (i < MIX.length - 1 && h > MIX[i][0]) i++;
  const [lo, low] = MIX[i - 1], [hi, high] = MIX[i];
  const t = Math.max(0, Math.min(1, (h - lo) / (hi - lo)));
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uz * vy - uy * vz, ny = ux * vz - uz * vx, nz = uy * vx - ux * vy;
  const light = (-.42 * nx + .84 * ny - .34 * nz) / Math.hypot(nx, ny, nz);
  const shade = (light - .72) * 66;
  return '#' + low.map((value, k) => {
    const c = Math.max(0, Math.min(255, Math.round(value + (high[k] - value) * t + shade)));
    return c.toString(16).padStart(2, '0');
  }).join('');
}

export function createDestinationRelief(view) {
  const cols = view.getUint8(0), rows = view.getUint8(1);
  const width = view.getFloat32(2, true), depth = view.getFloat32(6, true);
  const points = [], faces = [], routes = [];
  const n = cols * rows;
  const xAt = i => (i / (cols - 1) - .5) * width;
  const zAt = j => (j / (rows - 1) - .5) * depth;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const y = view.getUint16(12 + (j * cols + i) * 2, true) / UNIT;
    points.push({ x: xAt(i), y, z: zAt(j) });
  }
  const peak = points.reduce((maximum, point) => Math.max(maximum, point.y), 0);

  function face(a, b, c, d, color, nx = 0, nz = 0) {
    const vertices = (d === null ? [a, b, c] : [a, b, c, d]).map(i => points[i]);
    faces.push({ a, b, c, d, color, nx, nz, order: 0,
      x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length,
      z: vertices.reduce((sum, point) => sum + point.z, 0) / vertices.length });
  }

  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    face(a, b, c, null, faceColor(points[a], points[b], points[c], peak));
    face(d, c, b, null, faceColor(points[d], points[c], points[b], peak));
  }

  function addSide(indices, color, nx, nz) {
    const bottom = points.length;
    for (const index of indices) points.push({ ...points[index], y: 0 });
    for (let i = 1; i < indices.length; i++) {
      face(indices[i - 1], indices[i], bottom + i, bottom + i - 1, color, nx, nz);
    }
  }
  addSide(Array.from({ length: cols }, (_, i) => i), '#253c49', 0, -1);
  addSide(Array.from({ length: cols }, (_, i) => (rows - 1) * cols + i), '#233943', 0, 1);
  addSide(Array.from({ length: rows }, (_, i) => i * cols), '#36505b', -1, 0);
  addSide(Array.from({ length: rows }, (_, i) => i * cols + cols - 1), '#304b59', 1, 0);

  function heightAt(x, z) {
    const i = Math.min(cols - 2, Math.floor(x)), j = Math.min(rows - 2, Math.floor(z));
    const u = x - i, v = z - j, index = j * cols + i;
    return u + v <= 1 ? points[index].y * (1 - u - v) + points[index + 1].y * u + points[index + cols].y * v
      : points[index + cols + 1].y * (u + v - 1) + points[index + 1].y * (1 - v) + points[index + cols].y * (1 - u);
  }
  const cablePoint = (x, z) => ({ x: xAt(x), y: heightAt(x, z) + .002, z: zAt(z) });

  let offset = 12 + n * 2;
  for (let l = 0; l < view.getUint16(10, true); l++) {
    const count = view.getUint16(offset, true);
    offset += 2;
    const start = points.length;
    let lastX, lastZ;
    for (let k = 0; k < count; k++, offset += 4) {
      const x = view.getUint16(offset, true) / UNIT * (cols - 1);
      const z = view.getUint16(offset + 2, true) / UNIT * (rows - 1);
      if (k === 0) points.push(cablePoint(x, z));
      else {
        const count = Math.max(1, Math.ceil(Math.hypot(x - lastX, z - lastZ) * 2.5));
        const dx = (x - lastX) / count, dz = (z - lastZ) / count;
        for (let i = 1; i <= count; i++) {
          points.push(cablePoint(lastX + dx * i, lastZ + dz * i));
        }
      }
      lastX = x;
      lastZ = z;
    }
    routes.push([start, points.length]);
  }

  // A ray towards the observer tests whether a foreground ridge hides a cable point.
  // Coordinates for the intersection stay in the same triangle grid used for the model.
  const step = Math.min(width / (cols - 1), depth / (rows - 1)) * .4;
  const toGridX = (cols - 1) / width, toGridZ = (rows - 1) / depth;
  function cableVisible(point, s, c) {
    const dy = step * TAN_PITCH, dx = step * s * toGridX, dz = step * c * toGridZ;
    let y = point.y + dy;
    let x = (point.x + width * .5) * toGridX + dx;
    let z = (point.z + depth * .5) * toGridZ + dz;
    while (y < peak && x > 0 && x < cols - 1 && z > 0 && z < rows - 1) {
      if (heightAt(x, z) > y + .001) return false;
      x += dx;
      z += dz;
      y += dy;
    }
    return true;
  }

  return { points, order: faces, routes, cableVisible, sx: new Float32Array(points.length), sy: new Float32Array(points.length) };
}

export function drawDestinationRelief(canvas, model, yaw) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const { points, order, routes, cableVisible, sx, sy } = model;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const scale = width * .68;
  const cx = width * .5, cy = height * .69;
  for (let i = 0; i < points.length; i++) {
    const { x, y, z } = points[i];
    sx[i] = cx + (x * c - z * s) * scale;
    sy[i] = cy + ((x * s + z * c) * SIN_PITCH - y * COS_PITCH) * scale;
  }
  for (const face of order) face.order = face.x * s + face.z * c;
  order.sort((a, b) => a.order - b.order);

  ctx.clearRect(0, 0, width, height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const { a, b, c: end, d, color, nx, nz } of order) {
    if (d !== null && nx * s + nz * c <= 0) continue;
    ctx.beginPath();
    ctx.moveTo(sx[a], sy[a]);
    ctx.lineTo(sx[b], sy[b]);
    ctx.lineTo(sx[end], sy[end]);
    if (d !== null) ctx.lineTo(sx[d], sy[d]);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.fill();
    ctx.lineWidth = .8;
    ctx.stroke();

  }
  if (!routes.length) return;
  ctx.beginPath();
  for (const [start, end] of routes) {
    let drawing = false;
    for (let i = start; i < end; i++) {
      const visible = cableVisible(points[i], s, c);
      if (visible) {
        if (drawing) ctx.lineTo(sx[i], sy[i]);
        else ctx.moveTo(sx[i], sy[i]);
      }
      drawing = visible;
    }
  }
  ctx.strokeStyle = '#6f4b32';
  ctx.lineWidth = width * .005;
  ctx.stroke();
  ctx.strokeStyle = '#ffbf7b';
  ctx.lineWidth = width * .0029;
  ctx.stroke();
}
