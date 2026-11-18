const PAPER = '#e9efee';
const RAMP = [
  [635, [176, 207, 190]], [1150, [203, 222, 211]], [1550, [222, 233, 230]],
  [2050, [239, 243, 242]], [2650, [250, 250, 247]],
];

function terrainColor(height, dx, dz) {
  let i = 1;
  while (i < RAMP.length - 1 && height > RAMP[i][0]) i++;
  const [lo, a] = RAMP[i - 1], [hi, b] = RAMP[i];
  const t = Math.max(0, Math.min(1, (height - lo) / (hi - lo)));
  const shade = (1 + .47 * dx + .62 * dz) / Math.hypot(dx, dz, 1);
  return 'rgb(' + a.map((c, k) => Math.round((c + (b[k] - c) * t + (shade - 1) * 51) / 3) * 3).join(',') + ')';
}

function outline(contours, a, b, c) {
  const vertices = [a, b, c, a];
  const minimum = Math.min(a.y, b.y, c.y), maximum = Math.max(a.y, b.y, c.y);
  for (let level = Math.ceil(minimum / 50) * 50; level < maximum; level += 50) {
    const points = [];
    for (let i = 0; i < 3; i++) {
      const p = vertices[i], q = vertices[i + 1];
      if ((p.y > level) === (q.y > level)) continue;
      const fraction = (level - p.y) / (q.y - p.y);
      points.push([p.x + (q.x - p.x) * fraction, p.z + (q.z - p.z) * fraction]);
    }
    if (points.length === 2) {
      const path = level % 250 ? contours.minor : contours.major;
      path.moveTo(...points[0]);
      path.lineTo(...points[1]);
    }
  }
}

export function createMapRelief({ bounds, heightAt, lakes = [] }) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const stride = Math.max(24, Math.max(maxX - minX, maxZ - minZ) / 205);
  const cols = Math.ceil((maxX - minX) / stride), rows = Math.ceil((maxZ - minZ) / stride);
  const width = (maxX - minX) / cols, depth = (maxZ - minZ) / rows;
  const nodes = Array.from({ length: cols + 1 }, (_, col) =>
    Array.from({ length: rows + 1 }, (_, row) => {
      const x = minX + col * width, z = minZ + row * depth;
      return { x, z, y: heightAt(x, z) };
    }));
  const fills = new Map();
  const contours = { minor: new Path2D(), major: new Path2D() };
  function triangle(a, b, c, dx, dz) {
    const color = terrainColor((a.y + b.y + c.y) / 3, dx, dz);
    if (!fills.has(color)) fills.set(color, new Path2D());
    const path = fills.get(color);
    path.moveTo(a.x, a.z);
    path.lineTo(b.x, b.z);
    path.lineTo(c.x, c.z);
    path.closePath();
    outline(contours, a, b, c);
  }
  for (let col = 0; col < cols; col++) for (let row = 0; row < rows; row++) {
    const a = nodes[col][row], b = nodes[col + 1][row], c = nodes[col][row + 1], d = nodes[col + 1][row + 1];
    triangle(a, b, c, (b.y - a.y) / width, (c.y - a.y) / depth);
    triangle(d, c, b, (d.y - c.y) / width, (d.y - b.y) / depth);
  }
  const water = lakes.map(({ ring, holes }) => {
    const path = new Path2D();
    for (const [first, ...coast] of [ring, ...holes]) {
      path.moveTo(...first);
      for (const point of coast) path.lineTo(...point);
      path.closePath();
    }
    return path;
  });
  return { bounds, fills, contours, water };
}

export function drawMapRelief(ctx, relief, transform) {
  const { width, height, scale, x, z } = transform;
  const { bounds, fills, contours, water } = relief;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(x, z);
  ctx.scale(scale, scale);
  ctx.lineWidth = .65 / scale;
  for (const [color, path] of fills) {
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.fill(path);
    ctx.stroke(path);
  }
  ctx.strokeStyle = '#335a622b';
  ctx.lineWidth = .55 / scale;
  if (scale >= .09) ctx.stroke(contours.minor);
  ctx.lineWidth = .8 / scale;
  ctx.stroke(contours.major);
  ctx.fillStyle = '#9fcad5';
  ctx.strokeStyle = '#85b5c1';
  for (const lake of water) {
    ctx.fill(lake, 'evenodd');
    ctx.stroke(lake);
  }
  ctx.strokeStyle = '#a5bec2';
  ctx.lineWidth = 1 / scale;
  ctx.strokeRect(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  ctx.restore();
}
