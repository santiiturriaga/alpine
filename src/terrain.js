import * as THREE from 'three';
import {
  WORLD, RUNS, KICKERS, CLIFFS, initWorldData, runPointAt, MOUNTAIN,
} from './worlddata.js';
import {
  clamp, lerp, smoothstep, noise, noise2, gaussian, makeCanvas, canvasTexture,
  mulberry32,
} from './util.js';

/* ═══════════════════════════════════════════════════════════════
   TERRAIN
   A hand-shaped height field: two resort massifs, a deep valley,
   groomed run corridors, wind lips, booters, and cliff bands.
   ═══════════════════════════════════════════════════════════════ */

export const terrain = {
  mesh: null,
  heights: null,
  n: 0,
  cell: 0,
  mask: null,
  maskN: 0,
  snowMap: null,
  snowNormal: null,
  get minX() { return WORLD.minX; },
  get maxX() { return WORLD.maxX; },
  get minZ() { return WORLD.minZ; },
  get maxZ() { return WORLD.maxZ; },
};

let heights, n, cell, mask, maskN, maskCell;

function baseHeight(x, z) {
  // Valley floor, rising gently toward the peaks.
  let h = 618 + 132 * smoothstep(0, 1, (2020 - z) / 4100);
  h += 34 * noise.fbm(x * 0.0013 + 12.3, z * 0.0013 - 4.1, 3);

  // ── Whistler massif ───────────────────────────────────────────
  const wx = 1380 + 0.052 * (-z - 400);
  const whZ = z > -900
    ? 1515 * Math.exp(-Math.pow((z + 900) / 1760, 2))
    : 1515 * Math.exp(-Math.pow((z + 900) / 840, 2));
  const whWidth = x < wx ? 980 : 680;
  const wd = (x - wx) / whWidth;
  h += whZ * Math.exp(-wd * wd);

  // ── Blackcomb massif ──────────────────────────────────────────
  const bx = -1418 + 0.058 * (-z - 420);
  const bhZ = z > -860
    ? 1665 * Math.exp(-Math.pow((z + 860) / 1690, 2))
    : 1665 * Math.exp(-Math.pow((z + 860) / 830, 2));
  const bhWidth = x > bx ? 1010 : 690;
  const bd = (x - bx) / bhWidth;
  h += bhZ * Math.exp(-bd * bd);

  // ── Little ridges & shoulders ─────────────────────────────────
  // 7th Heaven shoulder on Blackcomb
  const d7 = Math.pow((x + 505) / 470, 2) + Math.pow((z + 680) / 420, 2);
  h += 300 * Math.exp(-d7) * (1 - smoothstep(300, 900, z));
  // Flute / Symphony ridge west of Whistler Peak
  const df = Math.pow((x - 690) / 330, 2) + Math.pow((z + 1190) / 350, 2);
  h += 265 * Math.exp(-df);
  // Small mid-valley shoulder that separates the lower runs
  const dm = Math.pow((x - 10) / 520, 2) + Math.pow((z - 650) / 650, 2);
  h += 55 * Math.exp(-dm);

  // ── Benches, bowls and wind-scoured pockets ───────────────────
  const bowl = (cx, cz, rx, rz, depth) =>
    depth * Math.exp(-(Math.pow((x - cx) / rx, 2) + Math.pow((z - cz) / rz, 2)));
  h -= bowl(1010, -360, 330, 520, 85);     // Whistler Bowl apron
  h -= bowl(430, 220, 420, 560, 60);       // Harmony Bowl
  h -= bowl(-1050, -360, 430, 580, 95);    // Blackcomb chutes
  h -= bowl(-450, 420, 330, 420, 40);      // lower glade pocket

  // ── Big organic ridges & gullies ──────────────────────────────
  const alpine = smoothstep(950, 1950, h);
  h += noise.ridged(x * 0.00172 + 3.7, z * 0.00172 - 8.2, 3) * 58 * alpine;
  h += noise2.fbm(x * 0.0036 - 5.1, z * 0.0036 + 1.8, 4) * (7 + 18 * alpine);
  h += noise.fbm(x * 0.012 + 2.0, z * 0.012 - 3.0, 3) * 3.4;

  // Sastrugi / wind texture on the high alpine
  h += noise.ridged(x * 0.021, z * 0.021, 2) * 2.2 * alpine;

  // ── Base area terraces ────────────────────────────────────────
  const dv = Math.sqrt(Math.pow((x - 250) / 620, 2) + Math.pow((z - 1980) / 540, 2));
  const wv = 1 - smoothstep(0.67, 1.06, dv);
  if (wv > 0) h = lerp(h, 660 + (z - 1980) * 0.012 + 2.5 * noise.fbm(x * 0.01, z * 0.01, 2), wv * 0.94);

  const dc = Math.sqrt(Math.pow((x - 790) / 350, 2) + Math.pow((z - 2050) / 300, 2));
  const wc = 1 - smoothstep(0.6, 1.04, dc);
  if (wc > 0) h = lerp(h, 700 + (z - 2050) * 0.014, wc * 0.92);

  return h;
}

function buildMask(res = 1024) {
  const { canvas, ctx } = makeCanvas(res, res);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, res, res);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sx = res / WORLD.sizeX;
  const sz = res / WORLD.sizeZ;
  for (const run of RUNS) {
    ctx.beginPath();
    const pts = run.samples;
    ctx.lineWidth = Math.max(2.1, run.width * ((sx + sz) * 0.5) * (run.hidden ? 0.98 : 1.12));
    for (let i = 0; i < pts.length; i++) {
      const px = (pts[i].x - WORLD.minX) * sx;
      const py = (pts[i].z - WORLD.minZ) * sz;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  const img = ctx.getImageData(0, 0, res, res).data;
  const m = new Float32Array(res * res);
  for (let i = 0; i < m.length; i++) m[i] = img[i * 4] / 255;

  // separable box blur, twice, for soft groomed shoulders
  let a = m, b = new Float32Array(m.length);
  for (let pass = 0; pass < 2; pass++) {
    const r = pass === 0 ? 2 : 3;
    // horizontal
    for (let y = 0; y < res; y++) {
      let sum = 0;
      const row = y * res;
      for (let x = -r; x <= r; x++) sum += a[row + clamp(x, 0, res - 1)];
      for (let x = 0; x < res; x++) {
        b[row + x] = sum / (r * 2 + 1);
        sum += a[row + Math.min(res - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    // vertical
    for (let x = 0; x < res; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[clamp(y, 0, res - 1) * res + x];
      for (let y = 0; y < res; y++) {
        a[y * res + x] = sum / (r * 2 + 1);
        sum += b[Math.min(res - 1, y + r + 1) * res + x] - b[Math.max(0, y - r) * res + x];
      }
    }
  }
  return { mask: a, res };
}

function sampleMask(x, z) {
  const res = maskN;
  const fx = clamp((x - WORLD.minX) / WORLD.sizeX * (res - 1), 0, res - 1.001);
  const fz = clamp((z - WORLD.minZ) / WORLD.sizeZ * (res - 1), 0, res - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const i0 = iz * res + ix;
  const a = mask[i0], b = mask[i0 + 1], c = mask[i0 + res], d = mask[i0 + res + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function boxBlurHeights(src, radius, iterations = 2) {
  const N = n;
  let a = src, b = new Float32Array(src.length);
  const w = radius * 2 + 1;
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < N; y++) {
      let sum = 0;
      const row = y * N;
      for (let x = -radius; x <= radius; x++) sum += a[row + clamp(x, 0, N - 1)];
      for (let x = 0; x < N; x++) {
        b[row + x] = sum / w;
        sum += a[row + Math.min(N - 1, x + radius + 1)] - a[row + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < N; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += b[clamp(y, 0, N - 1) * N + x];
      for (let y = 0; y < N; y++) {
        a[y * N + x] = sum / w;
        sum += b[Math.min(N - 1, y + radius + 1) * N + x] - b[Math.max(0, y - radius) * N + x];
      }
    }
  }
  return a;
}

function applyFeatures() {
  const res = n;
  const sx = WORLD.sizeX / (res - 1);
  const sz = WORLD.sizeZ / (res - 1);

  // snow cat / booter features
  for (const k of KICKERS) {
    const p = runPointAt(k.run, k.t);
    if (!p) continue;
    const fx = p.tx, fz = p.tz;
    const rx = -fz, rz = fx;
    const halfL = k.length * 0.5;
    const reach = halfL + 16;
    const halfW = k.width * 0.62;
    const cx = p.x, cz = p.z;
    const i0 = clamp(Math.floor((cx - reach - WORLD.minX) / sx), 1, res - 2);
    const i1 = clamp(Math.ceil((cx + reach - WORLD.minX) / sx), 1, res - 2);
    const j0 = clamp(Math.floor((cz - reach - WORLD.minZ) / sz), 1, res - 2);
    const j1 = clamp(Math.ceil((cz + reach - WORLD.minZ) / sz), 1, res - 2);
    for (let j = j0; j <= j1; j++) {
      const z = WORLD.minZ + j * sz;
      for (let i = i0; i <= i1; i++) {
        const x = WORLD.minX + i * sx;
        const dx = x - cx, dz = z - cz;
        const s = dx * fx + dz * fz;
        const lat = dx * rx + dz * rz;
        if (Math.abs(lat) > halfW) continue;
        let lift = 0;
        const u = (s + halfL) / k.length;
        if (u > 0 && u <= 1) {
          lift = Math.pow(smoothstep(0, 1, u), 0.9) * k.height;
        } else if (s > halfL && s < halfL + 3.2) {
          lift = k.height * (1 - smoothstep(0, 3.2, s - halfL));
        }
        if (lift <= 0) continue;
        const latQ = 1 - smoothstep(0.62, 1.0, Math.abs(lat) / halfW);
        heights[j * res + i] += lift * latQ;
      }
    }
  }

  // cliff shelves
  for (const c of CLIFFS) {
    const p = runPointAt(c.run, c.t);
    if (!p) continue;
    const fx = p.tx, fz = p.tz;
    const rx = -fz, rz = fx;
    const halfW = c.width * 0.62;
    const reach = 75;
    const cx = p.x, cz = p.z;
    const i0 = clamp(Math.floor((cx - reach - WORLD.minX) / sx), 1, res - 2);
    const i1 = clamp(Math.ceil((cx + reach - WORLD.minX) / sx), 1, res - 2);
    const j0 = clamp(Math.floor((cz - reach - WORLD.minZ) / sz), 1, res - 2);
    const j1 = clamp(Math.ceil((cz + reach - WORLD.minZ) / sz), 1, res - 2);
    for (let j = j0; j <= j1; j++) {
      const z = WORLD.minZ + j * sz;
      for (let i = i0; i <= i1; i++) {
        const x = WORLD.minX + i * sx;
        const dx = x - cx, dz = z - cz;
        const s = dx * fx + dz * fz;
        const lat = dx * rx + dz * rz;
        if (Math.abs(s) > reach || Math.abs(lat) > halfW) continue;
        let shelf = 1 - smoothstep(0, c.length, s + 1.6);
        shelf *= smoothstep(-70, -14, s); // taper the upstream shelf into the hill
        if (shelf <= 0) continue;
        const latQ = 1 - smoothstep(0.58, 1.0, Math.abs(lat) / halfW);
        heights[j * res + i] += c.drop * shelf * latQ;
      }
    }
  }

  // Soft edge berms keep players inside the mapped area without fences everywhere.
  for (let j = 0; j < res; j++) {
    const z = WORLD.minZ + j * sz;
    for (let i = 0; i < res; i++) {
      const x = WORLD.minX + i * sx;
      const edge = Math.min(x - WORLD.minX, WORLD.maxX - x, z - WORLD.minZ, WORLD.maxZ - z);
      if (edge < 190) {
        const t = 1 - smoothstep(0, 190, edge);
        heights[j * res + i] += t * t * 160;
      }
    }
  }
}

function makeSnowTexture() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const rand = mulberry32(881122);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const n1 = noise2.fbm(x * 0.035, y * 0.035, 3);
      const n2 = noise2.fbm(x * 0.19, y * 0.19, 2);
      const v = 244 + n1 * 14 + n2 * 8 + (rand() - 0.5) * 3.4;
      img.data[i] = clamp(v - 2, 0, 255);
      img.data[i + 1] = clamp(v, 0, 255);
      img.data[i + 2] = clamp(v + 2, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = canvasTexture(canvas, { repeat: [1, 1] });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makeSnowNormal() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const bump = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      bump[y * S + x] = noise2.fbm(x * 0.055, y * 0.055, 3) * 0.75 + noise2.fbm(x * 0.22, y * 0.22, 2) * 0.25;
    }
  }
  const img = ctx.createImageData(S, S);
  const strength = 1.55;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = bump[y * S + ((x - 1 + S) % S)];
      const r = bump[y * S + ((x + 1 + S) % S)];
      const d = bump[((y - 1 + S) % S) * S + x];
      const u = bump[((y + 1 + S) % S) * S + x];
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      img.data[i] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = canvasTexture(canvas, { repeat: [1, 1], srgb: false });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export async function buildTerrain(onProgress = () => {}, yieldFrame = () => Promise.resolve()) {
  initWorldData();
  onProgress(0.08, 'Sounding the snowpack…');
  await yieldFrame();

  const N = WORLD.grid;
  n = N; heights = new Float32Array(N * N);
  cell = WORLD.sizeX / (N - 1);
  const dz = WORLD.sizeZ / (N - 1);
  for (let j = 0; j < N; j++) {
    const z = WORLD.minZ + j * dz;
    for (let i = 0; i < N; i++) {
      const x = WORLD.minX + i * cell;
      heights[j * N + i] = baseHeight(x, z);
    }
  }
  onProgress(0.2, 'Laying out the runs…');
  await yieldFrame();

  const m = buildMask(1024);
  mask = m.mask; maskN = m.res; maskCell = WORLD.sizeX / (maskN - 1);

  // Smooth the groomed corridors into long, flowing surfaces.
  const smoothH = boxBlurHeights(heights.slice(), 5, 3);
  for (let j = 0; j < N; j++) {
    const z = WORLD.minZ + j * dz;
    for (let i = 0; i < N; i++) {
      const x = WORLD.minX + i * cell;
      const p = sampleMask(x, z);
      const blend = Math.min(1, p * 1.38) * 0.8;
      heights[j * N + i] = lerp(heights[j * N + i], smoothH[j * N + i], blend);
    }
  }

  onProgress(0.34, 'Building booters & cliff drops…');
  await yieldFrame();
  applyFeatures();

  // The village is a flat, walkable terrace.
  for (let j = 0; j < N; j++) {
    const z = WORLD.minZ + j * dz;
    for (let i = 0; i < N; i++) {
      const x = WORLD.minX + i * cell;
      const dv = Math.sqrt(Math.pow((x - 250) / 600, 2) + Math.pow((z - 1990) / 520, 2));
      const wv = 1 - smoothstep(0.7, 1.02, dv);
      if (wv > 0) heights[j * N + i] = lerp(heights[j * N + i], 662 + (z - 1990) * 0.01, wv * 0.88);
      const dc = Math.sqrt(Math.pow((x - 790) / 340, 2) + Math.pow((z - 2060) / 290, 2));
      const wc = 1 - smoothstep(0.64, 1.0, dc);
      if (wc > 0) heights[j * N + i] = lerp(heights[j * N + i], 698 + (z - 2060) * 0.012, wc * 0.84);
    }
  }

  // Build mesh.
  const vcount = N * N;
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const uvs = new Float32Array(vcount * 2);
  const colors = new Float32Array(vcount * 3);
  const dx = cell;

  const snow = new THREE.Color().setRGB(0.955, 0.972, 0.995, THREE.SRGBColorSpace);
  const snowPiste = new THREE.Color().setRGB(0.995, 0.998, 1.0, THREE.SRGBColorSpace);
  const snowShade = new THREE.Color().setRGB(0.84, 0.895, 0.95, THREE.SRGBColorSpace);
  const snowWind = new THREE.Color().setRGB(0.83, 0.895, 0.945, THREE.SRGBColorSpace);
  const rock = new THREE.Color().setRGB(0.30, 0.29, 0.285, THREE.SRGBColorSpace);
  const rockLight = new THREE.Color().setRGB(0.42, 0.405, 0.39, THREE.SRGBColorSpace);
  const col = new THREE.Color();
  const blurred = boxBlurHeights(heights.slice(), 9, 1);

  onProgress(0.5, 'Shading the alpine…');
  await yieldFrame();

  for (let j = 0; j < N; j++) {
    const z = WORLD.minZ + j * dz;
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = WORLD.minX + i * cell;
      const h = heights[k];
      const hL = heights[j * N + Math.max(0, i - 1)];
      const hR = heights[j * N + Math.min(N - 1, i + 1)];
      const hD = heights[Math.max(0, j - 1) * N + i];
      const hU = heights[Math.min(N - 1, j + 1) * N + i];
      let nx = (hL - hR) / (2 * dx);
      let nz = (hD - hU) / (2 * dz);
      const nl = Math.hypot(nx, 1, nz);
      nx /= nl; nz /= nl;
      const ny = 1 / nl;
      positions[k * 3] = x;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = z;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;
      uvs[k * 2] = x / 14.0;
      uvs[k * 2 + 1] = z / 14.0;

      const slope = 1 - ny;
      const p = sampleMask(x, z);
      const nBig = noise2.fbm(x * 0.0042 + 2.1, z * 0.0042 - 1.4, 3);
      const nMid = noise.fbm(x * 0.017, z * 0.017, 2);
      const nFine = noise2.fbm(x * 0.06, z * 0.06, 2);

      col.copy(snow);
      // groomed corridor
      col.lerp(snowPiste, clamp(p * 1.45, 0, 1) * 0.9);
      // off-piste blue shadow / age
      col.lerp(snowShade, (1 - p) * (0.28 + 0.2 * nBig) * 0.5);
      // wind-scoured grey-blue alpine
      const wind = smoothstep(1770, 2200, h) * smoothstep(0.15, 0.7, nBig) * 0.4;
      col.lerp(snowWind, wind);
      // faint forest dapple
      const treePossible = smoothstep(700, 1000, h) * (1 - smoothstep(1680, 1880, h)) * (1 - smoothstep(0.38, 0.62, slope));
      const forest = treePossible * smoothstep(0.0, 0.5, nBig + nMid * 0.4) * (1 - p);
      col.lerp(snowShade, forest * 0.18);
      // rock bands and cliff faces
      const rocky = smoothstep(0.30, 0.54, slope) * smoothstep(0.2, 0.72, nBig + nFine * 0.25 + (h > 1700 ? 0.2 : -0.1));
      if (rocky > 0.01) {
        col.copy(col).lerp(nFine > 0 ? rockLight : rock, clamp(rocky * 1.4, 0, 0.94));
      }
      // concave shading / ambient depth
      const conc = clamp((blurred[k] - h) * 0.009, -0.05, 0.12);
      col.multiplyScalar(1 - conc * 0.85);
      // very subtle large-scale tonal drift
      col.offsetHSL(0, 0, nFine * 0.014);

      colors[k * 3] = col.r;
      colors[k * 3 + 1] = col.g;
      colors[k * 3 + 2] = col.b;
    }
  }

  onProgress(0.66, 'Grooming corduroy…');
  await yieldFrame();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const indices = new Uint32Array((N - 1) * (N - 1) * 6);
  let o = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      indices[o++] = a; indices[o++] = c; indices[o++] = b;
      indices[o++] = b; indices[o++] = c; indices[o++] = d;
    }
  }
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  const snowMap = makeSnowTexture();
  const snowNormal = makeSnowNormal();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: snowMap,
    normalMap: snowNormal,
    normalScale: new THREE.Vector2(0.62, 0.62),
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.6,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';

  terrain.mesh = mesh;
  terrain.heights = heights;
  terrain.n = N;
  terrain.cell = cell;
  terrain.mask = mask;
  terrain.maskN = maskN;
  terrain.snowMap = snowMap;
  terrain.snowNormal = snowNormal;

  onProgress(0.78, 'Snow is falling…');
  await yieldFrame();
  return terrain;
}

/* ── sampling API ─────────────────────────────────────────────── */

export function heightAt(x, z) {
  if (!heights) return 0;
  const N = n;
  const gx = clamp((x - WORLD.minX) / WORLD.sizeX * (N - 1), 0, N - 1.001);
  const gz = clamp((z - WORLD.minZ) / WORLD.sizeZ * (N - 1), 0, N - 1.001);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const tx = gx - ix, tz = gz - iz;
  const i0 = iz * N + ix;
  const h00 = heights[i0], h10 = heights[i0 + 1], h01 = heights[i0 + N], h11 = heights[i0 + N + 1];
  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 1.8;
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  out.set(hL - hR, 2 * e, hD - hU).normalize();
  return out;
}

export function slopeAt(x, z) {
  const nrm = normalAt(x, z, _tmpN);
  return 1 - nrm.y;
}

const _tmpN = new THREE.Vector3();

export function pisteAt(x, z) {
  if (!mask) return 0;
  return sampleMask(x, z);
}

export function isGroomed(x, z) {
  return pisteAt(x, z) > 0.34;
}

export function treeExclusion(x, z) {
  const p = pisteAt(x, z);
  return p;
}
