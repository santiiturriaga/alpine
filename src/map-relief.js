const PAPER = '#e9efee';
const GENERATED = '#7b75a144';
const TILE_PIXELS = 192;
const TILE_STEPS = 24;
const TILE_LIMIT = 84;
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

function createReliefTile({ x, z, span }, heightAt) {
  const step = span / TILE_STEPS;
  const nodes = Array.from({ length: TILE_STEPS + 1 }, (_, col) =>
    Array.from({ length: TILE_STEPS + 1 }, (_, row) => {
      const dx = col * step, dz = row * step;
      return { x: dx, z: dz, y: heightAt(x + dx, z + dz) };
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
  for (let col = 0; col < TILE_STEPS; col++) for (let row = 0; row < TILE_STEPS; row++) {
    const a = nodes[col][row], b = nodes[col + 1][row], c = nodes[col][row + 1], d = nodes[col + 1][row + 1];
    triangle(a, b, c, (b.y - a.y) / step, (c.y - a.y) / step);
    triangle(d, c, b, (d.y - c.y) / step, (d.y - b.y) / step);
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_PIXELS;
  const ctx = canvas.getContext('2d');
  const scale = TILE_PIXELS / span;
  ctx.scale(scale, scale);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, span, span);
  ctx.lineWidth = .82 / scale;
  for (const [color, path] of fills) {
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.fill(path);
    ctx.stroke(path);
  }
  ctx.strokeStyle = '#335a622b';
  ctx.lineWidth = .55 / scale;
  if (scale >= .09) ctx.stroke(contours.minor);
  ctx.lineWidth = .82 / scale;
  ctx.stroke(contours.major);
  return canvas;
}

function visibleTiles(span, { minX, minZ, maxX, maxZ }) {
  const tiles = [];
  for (let col = Math.floor(minX / span); col < Math.ceil(maxX / span); col++) {
    for (let row = Math.floor(minZ / span); row < Math.ceil(maxZ / span); row++) {
      tiles.push({ key: `${span}/${col}/${row}`, x: col * span, z: row * span, span });
    }
  }
  return tiles;
}

export function createMapRelief({ regionalBounds, heightAt, lakes = [] }) {
  const water = lakes.map(({ ring, holes }) => {
    const path = new Path2D();
    for (const [first, ...coast] of [ring, ...holes]) {
      path.moveTo(...first);
      for (const point of coast) path.lineTo(...point);
      path.closePath();
    }
    return path;
  });
  return { regionalBounds, heightAt, water, tiles: new Map() };
}

export function drawMapRelief(ctx, relief, transform, dpr) {
  const { width, height, scale, x, z, visible } = transform;
  const { regionalBounds, water, tiles } = relief;
  const span = 2 ** Math.round(Math.log2(TILE_PIXELS / scale));
  const current = visibleTiles(span, visible);
  const missing = current.filter(tile => !tiles.has(tile.key));
  if (span !== relief.span) {
    relief.fallbackSpan = relief.span;
    relief.span = span;
  }
  if (missing.length) {
    const centerX = (visible.minX + visible.maxX) / 2, centerZ = (visible.minZ + visible.maxZ) / 2;
    const distance = tile => Math.hypot(tile.x + span / 2 - centerX, tile.z + span / 2 - centerZ);
    missing.sort((a, b) => distance(a) - distance(b));
    const deadline = performance.now() + 3;
    do {
      const tile = missing.shift();
      tiles.set(tile.key, { ...tile, canvas: createReliefTile(tile, relief.heightAt) });
    } while (missing.length && performance.now() < deadline);
  }
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  const pixel = value => Math.round(value * dpr) / dpr;
  function drawTile(tile) {
    const { key, canvas, x: tileX, z: tileZ, span } = tile;
    tiles.delete(key);
    tiles.set(key, tile);
    const left = x + tileX * scale, top = z + tileZ * scale;
    const dx = pixel(left), dz = pixel(top), size = span * scale;
    ctx.drawImage(canvas, dx, dz, pixel(left + size) - dx, pixel(top + size) - dz);
  }
  if (missing.length && relief.fallbackSpan) {
    for (const tile of [...tiles.values()]) {
      if (tile.span === relief.fallbackSpan && tile.x < visible.maxX && tile.x + tile.span > visible.minX &&
        tile.z < visible.maxZ && tile.z + tile.span > visible.minZ) drawTile(tile);
    }
  }
  for (const { key } of current) if (tiles.has(key)) drawTile(tiles.get(key));
  while (tiles.size > TILE_LIMIT) tiles.delete(tiles.keys().next().value);

  ctx.save();
  ctx.translate(x, z);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#9fcad5';
  ctx.strokeStyle = '#85b5c1';
  ctx.lineWidth = .8 / scale;
  for (const lake of water) {
    ctx.fill(lake, 'evenodd');
    ctx.stroke(lake);
  }
  ctx.restore();

  if (regionalBounds) {
    const left = x + regionalBounds.minX * scale, top = z + regionalBounds.minZ * scale;
    const right = x + regionalBounds.maxX * scale, bottom = z + regionalBounds.maxZ * scale;
    const minX = Math.max(0, left), minZ = Math.max(0, top);
    const maxX = Math.min(width, right), maxZ = Math.min(height, bottom);
    ctx.fillStyle = GENERATED;
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    if (maxX > minX && maxZ > minZ) ctx.rect(minX, minZ, maxX - minX, maxZ - minZ);
    ctx.fill('evenodd');
    ctx.save();
    ctx.strokeStyle = '#685d7b';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.restore();
  }
  return missing.length > 0;
}
