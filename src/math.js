// DOM-free scalar math, seeded randomness, and noise shared with boot workers.
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
