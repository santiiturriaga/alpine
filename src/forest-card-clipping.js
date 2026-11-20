import { crownDistanceSquared } from './forest-culling.js';

const cardWidth = .37 * 1.10;
const rootDepth = 1.55;
const tolerance = .08;
const planeCache = new WeakMap();

function frustumPlanes(view) {
  let cached = planeCache.get(view);
  if (cached?.revision === view.revision) return cached.planes;
  const planes = view.frustum.planes.map(({ normal, constant }) => ({
    x: normal.x, y: normal.y, z: normal.z, constant,
    horizontal: Math.hypot(normal.x, normal.z), vertical: Math.abs(normal.y),
  }));
  planeCache.set(view, { revision: view.revision, planes });
  return planes;
}

// An atlas card can face any direction. Its full-width horizontal circle
// bounds every orientation, including the extra width used for a distant crown.
export function makeForestCardClipper(matrices, start, total, dx = 0, dy = 0, dz = 0) {
  const trees = new Float32Array(total * 5);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let t = 0; t < total; t++) {
    const i = (start + t) * 16, j = t * 5;
    const x = trees[j] = Math.fround(matrices[i + 12] + dx);
    const y = trees[j + 1] = Math.fround(matrices[i + 13] + dy);
    const z = trees[j + 2] = Math.fround(matrices[i + 14] + dz);
    const height = trees[j + 3] = matrices[i + 5];
    const radius = trees[j + 4] = Math.sqrt(matrices[i] ** 2 + matrices[i + 2] ** 2) * cardWidth;
    minX = Math.min(minX, x - radius); maxX = Math.max(maxX, x + radius);
    minY = Math.min(minY, y - .0625 * height - rootDepth); maxY = Math.max(maxY, y + 1.0625 * height);
    minZ = Math.min(minZ, z - radius); maxZ = Math.max(maxZ, z + radius);
  }
  const x = (minX + maxX) * .5, y = (minY + maxY) * .5, z = (minZ + maxZ) * .5;
  const hx = (maxX - minX) * .5, hy = (maxY - minY) * .5, hz = (maxZ - minZ) * .5;
  const result = { count: total, indices: null, revision: 0 };
  let saved;
  function allOrNone(count) {
    if (result.count !== count || result.indices) result.revision++;
    result.count = count;
    result.indices = null;
    return result;
  }
  function select(view, near, far, translation = 0, rotation = 0) {
    const planes = frustumPlanes(view);
    const { eye } = view;
    const deltaX = Math.abs(eye.x - x), deltaY = Math.abs(eye.y - y), deltaZ = Math.abs(eye.z - z);
    const minDistanceSq = Math.max(0, deltaX - hx) ** 2 + Math.max(0, deltaY - hy) ** 2 + Math.max(0, deltaZ - hz) ** 2;
    const maxDistanceSq = (deltaX + hx) ** 2 + (deltaY + hy) ** 2 + (deltaZ + hz) ** 2;
    const motion = translation + rotation * Math.sqrt(maxDistanceSq);
    let contained = true;
    for (const plane of planes) {
      const distance = plane.x * x + plane.y * y + plane.z * z + plane.constant;
      const extent = Math.abs(plane.x) * hx + plane.vertical * hy + Math.abs(plane.z) * hz + tolerance;
      if (distance < -extent - motion) return allOrNone(0);
      if (distance + motion < extent) contained = false;
    }
    const closeSq = Math.max(0, near - tolerance - translation) ** 2, farSq = (far + tolerance + translation) ** 2;
    if (maxDistanceSq <= closeSq || minDistanceSq > farSq) return allOrNone(0);
    const testDistance = minDistanceSq <= closeSq || maxDistanceSq > farSq;
    if (contained && !testDistance) return allOrNone(total);

    saved ??= new Uint32Array(total);
    let count = 0, changed = result.indices === null;
    for (let i = 0; i < trees.length; i += 5) {
      const ox = trees[i], oy = trees[i + 1], oz = trees[i + 2], height = trees[i + 3];
      if (testDistance) {
        const distance = crownDistanceSquared(eye, ox, oy, oz, oy + height);
        if (distance <= closeSq || distance > farSq) continue;
      }
      if (!contained) {
        const halfWidth = trees[i + 4], centerY = oy + height * .5 - rootDepth * .5, halfHeight = height * .5625 + rootDepth * .5;
        let visible = true;
        for (const plane of planes) {
          if (plane.x * ox + plane.y * centerY + plane.z * oz + plane.constant <
              -(plane.horizontal * halfWidth + plane.vertical * halfHeight + tolerance + motion)) {
            visible = false;
            break;
          }
        }
        if (!visible) continue;
      }
      const index = i / 5;
      if (saved[count] !== index) changed = true;
      saved[count++] = index;
    }
    if (!count || count === total) return allOrNone(count);
    if (count !== result.count || changed) result.revision++;
    result.indices = saved;
    result.count = count;
    return result;
  }
  select.bounds = { minX, minY, minZ, maxX, maxY, maxZ };
  return select;
}

export function copyForestInstances(destination, source, stride, offset, start, { count, indices }) {
  if (!indices) {
    destination.set(source.subarray(start * stride, (start + count) * stride), offset * stride);
    return;
  }
  for (let i = 0; i < count; i++) {
    const from = (start + indices[i]) * stride, to = (offset + i) * stride;
    for (let c = 0; c < stride; c++) destination[to + c] = source[from + c];
  }
}
