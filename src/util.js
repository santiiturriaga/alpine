import * as THREE from 'three';
import { compactDevice } from './device-budget.js';
import { mulberry32 } from './math.js';
export {
  PI2, clamp, lerp, invLerp, smoothstep, smootherstep, damp, wrapAngle,
  shortestAngle, mix, mulberry32, hash2, makeNoise, noise, noise2, gaussian,
} from './math.js';

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
  if (compactDevice && canvas.width * canvas.height > 260000) {
    const scale = Math.min(.75, 1024 / Math.max(canvas.width, canvas.height));
    const small = makeCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
    small.ctx.drawImage(canvas, 0, 0, small.canvas.width, small.canvas.height);
    canvas = small.canvas;
  }
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
    sub = '', accent = '#ffc75b', border = 'rgba(255,255,255,.18)', centered = false,
  } = opts;
  const scale = compactDevice ? .7 : 1;
  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);
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
  ctx.textAlign = centered ? 'center' : 'left';
  const textX = centered ? width / 2 : 32;
  if (sub) {
    ctx.fillStyle = accent;
    ctx.font = '600 26px "Barlow", "Segoe UI", sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText(sub.toUpperCase(), centered ? textX : 34, 57);
  }
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, textX, sub ? height - 44 : height * 0.64);
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
