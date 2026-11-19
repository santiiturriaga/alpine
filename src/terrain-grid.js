import { clamp } from './math.js';

// Keep the gameplay collision grid and the drawn triangles on the same surface.
export function triangleHeight(data, n, gx, gz) {
  const ix = Math.min(n - 2, Math.floor(gx)), iz = Math.min(n - 2, Math.floor(gz));
  const tx = gx - ix, tz = gz - iz;
  const i = iz * n + ix;
  if (tx + tz <= 1) {
    return data[i] * (1 - tx - tz) + data[i + 1] * tx + data[i + n] * tz;
  }
  return data[i + n + 1] * (tx + tz - 1) + data[i + 1] * (1 - tz) + data[i + n] * (1 - tx);
}

export function worldIndex(x, z, bounds) {
  return [
    clamp((x - bounds.minX) / (bounds.maxX - bounds.minX), 0, 1) * (bounds.grid - 1),
    clamp((z - bounds.minZ) / (bounds.maxZ - bounds.minZ), 0, 1) * (bounds.grid - 1),
  ];
}

export function boxBlurGrid(src, n, radius, iterations = 2) {
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
