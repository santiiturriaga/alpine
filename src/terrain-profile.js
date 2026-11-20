import { clamp, smoothstep } from './math.js';

function limitedTangent(left, right) {
  return left * right <= 0 ? 0 : 2 * left * right / (left + right);
}

// Monotone cubic interpolation keeps surveyed crests and hollows at their
// measured heights and avoids inventing humps between the survey points.
export function surveyCurve(a, b, c, d, t) {
  const grade = c - b;
  const left = limitedTangent(b - a, grade), right = limitedTangent(grade, d - c);
  return b + t * (left + t * (3 * grade - 2 * left - right + t * (left + right - 2 * grade)));
}

export function snowProfile(grid, i, j, width, height) {
  const { values, cols, rows, xAt, zAt } = grid;
  const maxX = width * 2 - 2, maxZ = height * 2 - 2;
  const dx = xAt(1) - xAt(0), dz = zAt(1) - zAt(0);
  const limit = Math.min(.76, .055 * Math.min(dx, dz));
  const at = (x, z) => values[clamp(z, 0, rows - 1) * cols + clamp(x, 0, cols - 1)];

  function vertex(u, v) {
    const x = i + (u >> 1), z = j + (v >> 1);
    const halfX = u & 1, halfZ = v & 1;
    const a = at(x, z);
    if (!halfX && !halfZ) return a;
    const b = at(x + 1, z), c = at(x, z + 1);
    const base = halfX ? (a + b) / 2 : (a + c) / 2;
    const linear = halfX && halfZ ? (b + c) / 2 : base;
    const edge = Math.min(u, v, maxX - u, maxZ - v);
    if (!edge) return Math.fround(linear);
    const d = at(x + 1, z + 1);
    const grade = Math.hypot(Math.max(Math.abs(b - a), Math.abs(d - c)) / dx,
      Math.max(Math.abs(c - a), Math.abs(d - b)) / dz);
    const weight = smoothstep(0, 4, edge) * (1 - smoothstep(.46, .94, grade));
    if (!weight) return Math.fround(linear);
    let curved;
    if (halfX && halfZ) {
      const alongX = row => surveyCurve(at(x - 1, row), at(x, row), at(x + 1, row), at(x + 2, row), .5);
      const alongZ = col => surveyCurve(at(col, z - 1), at(col, z), at(col, z + 1), at(col, z + 2), .5);
      curved = (surveyCurve(alongX(z - 1), alongX(z), alongX(z + 1), alongX(z + 2), .5) +
        surveyCurve(alongZ(x - 1), alongZ(x), alongZ(x + 1), alongZ(x + 2), .5)) / 2;
    } else if (halfX) curved = surveyCurve(at(x - 1, z), a, b, at(x + 2, z), .5);
    else curved = surveyCurve(at(x, z - 1), a, c, at(x, z + 2), .5);
    return Math.fround(linear + weight * clamp(curved - linear, -limit, limit));
  }

  const minX = xAt(i), minZ = zAt(j);
  function sample(x, z, normal, exact, cached) {
    const u = clamp((x - minX) * 2 / dx, 0, maxX);
    const v = clamp((z - minZ) * 2 / dz, 0, maxZ);
    const col = Math.min(maxX - 1, Math.floor(u)), row = Math.min(maxZ - 1, Math.floor(v));
    const tx = u - col, tz = v - row, first = tx + tz <= 1;
    const offset = first ? 0 : 1;
    const k = row * (maxX + 1) + col;
    const a = cached ? cached[k + offset * (maxX + 2)] : vertex(col + offset, row + offset);
    const b = cached ? cached[k + 1] : vertex(col + 1, row);
    const c = cached ? cached[k + maxX + 1] : vertex(col, row + 1);
    if (normal) {
      if (exact) normal.set((first ? a - b : c - a) * 2 / dx, 1, (first ? a - c : b - a) * 2 / dz).normalize();
      else grid.sample(x, z, normal);
    }
    return first ? a * (1 - tx - tz) + b * tx + c * tz : a * (tx + tz - 1) + b * (1 - tz) + c * (1 - tx);
  }

  return { vertex, sample, cols: maxX + 1, rows: maxZ + 1 };
}
