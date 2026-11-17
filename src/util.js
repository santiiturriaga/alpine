import * as THREE from 'three';

export const PI2 = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => {
  a = (a + Math.PI) % PI2;
  if (a < 0) a += PI2;
  return a - Math.PI;
};
export const shortestAngle = (from, to) => wrapAngle(to - from);
export const mix = (a, b, t) => a + (b - a) * t;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, seed = 1337) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695040888963407 % 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

export function makeNoise(seed = 7) {
  const rand = mulberry32(seed);
  const table = new Float32Array(512);
  for (let i = 0; i < 512; i++) table[i] = rand() * 2 - 1;

  function at(ix, iy) {
    const x = ((ix % 256) + 256) % 256;
    const y = ((iy % 256) + 256) % 256;
    return table[(x + y * 251) & 511];
  }

  function noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = fade(x - ix), fy = fade(y - iy);
    const a = at(ix, iy), b = at(ix + 1, iy);
    const c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  function fbm(x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise2(x * freq + i * 17.17, y * freq - i * 9.13) * amp;
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  function ridged(x, y, octaves = 4, lacunarity = 2.07, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise2(x * freq + i * 7.31, y * freq + i * 3.77));
      sum += n * n * amp;
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  return { noise2, fbm, ridged };
}

export const noise = makeNoise(20251122);
export const noise2 = makeNoise(99117);

export function gaussian(x, center, width) {
  const d = (x - center) / width;
  return Math.exp(-d * d);
}

export function catmullSample2D(points, samplesPerSegment = 20) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false, 'centripetal', 0.5
  );
  const len = curve.getLength();
  const count = Math.max(8, Math.ceil(len / 12));
  const pts = curve.getSpacedPoints(count);
  return { curve, points: pts.map(p => ({ x: p.x, z: p.z })), length: len };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { canvas: c, ctx: c.getContext('2d') };
}

export function canvasTexture(canvas, { repeat = null, flipY = true, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = 4;
  tex.flipY = flipY;
  tex.needsUpdate = true;
  return tex;
}

export function makeRadialTexture(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]) {
  const { canvas, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, c] of stops) g.addColorStop(t, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeTextTexture(text, opts = {}) {
  const {
    width = 640, height = 220, bg = '#3a2b1d', fg = '#f6efdf',
    font = '700 92px "Barlow Condensed", "Arial Narrow", sans-serif',
    sub = '', accent = '#ffc75b', border = 'rgba(255,255,255,.18)',
  } = opts;
  const { canvas, ctx } = makeCanvas(width, height);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  // grain on the board
  const rand = mulberry32(4242);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.035})`;
    ctx.fillRect(rand() * width, rand() * height, rand() * 80 + 10, 1);
  }
  ctx.strokeStyle = border;
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, width - 20, height - 20);
  if (sub) {
    ctx.fillStyle = accent;
    ctx.font = '600 26px "Barlow", "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '4px';
    ctx.fillText(sub.toUpperCase(), 34, 57);
  }
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 32, sub ? height - 44 : height * 0.64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildRibbonGeometry(pts, width, yOffset = 0) {
  // pts: [{x,y,z}] centerline. Generates a flat-ish triangle strip.
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const nx = -dz, nz = dx;
    positions.push(p.x + nx * width / 2, p.y + yOffset, p.z + nz * width / 2);
    positions.push(p.x - nx * width / 2, p.y + yOffset, p.z - nz * width / 2);
    uvs.push(0, i * 0.12, 1, i * 0.12);
    if (i < pts.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
