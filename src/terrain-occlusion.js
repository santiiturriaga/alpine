const clearance = .35;

function rangeMinima(values) {
  const levels = [values];
  for (let span = 1; span * 2 <= values.length; span *= 2) {
    const previous = levels.at(-1);
    levels.push(Float32Array.from(previous.subarray(0, previous.length - span),
      (value, i) => Math.min(value, previous[i + span])));
  }
  return (first, last) => {
    const level = 31 - Math.clz32(last - first + 1);
    const values = levels[level];
    return Math.min(values[first], values[last - (1 << level) + 1]);
  };
}

function slope(offset, near, far) {
  return offset / (offset < 0 ? near : far);
}

export function createTerrainOcclusion({ positions, size, tileSize }) {
  const count = (size - 1) / tileSize;
  const xs = Float32Array.from({ length: size }, (_, i) => positions[i * 3]);
  const zs = Float32Array.from({ length: size }, (_, i) => positions[i * size * 3 + 2]);
  const spacingX = (xs[size - 1] - xs[0]) / (size - 1);
  const spacingZ = (zs[size - 1] - zs[0]) / (size - 1);
  const tiles = [];
  for (let z = 0; z < count; z++) for (let x = 0; x < count; x++) {
    const x0 = x * tileSize, x1 = x0 + tileSize, z0 = z * tileSize, z1 = z0 + tileSize;
    let minY = Infinity, maxY = -Infinity;
    for (let row = z0; row <= z1; row++) for (let col = x0; col <= x1; col++) {
      const y = positions[(row * size + col) * 3 + 1];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    tiles.push({ minX: xs[x0], maxX: xs[x1], minZ: zs[z0], maxZ: zs[z1], minY, maxY });
  }
  const xEdges = [], zEdges = [];
  // Coarse, native and streamed detail meshes all meet on these surveyed
  // lines. Interior samples would not provide the same lower bound in all LODs.
  for (let i = 1; i < count; i++) {
    const edge = i * tileSize;
    xEdges.push({ at: xs[edge], minimum: rangeMinima(Float32Array.from({ length: size },
      (_, row) => positions[(row * size + edge) * 3 + 1])) });
    zEdges.push({ at: zs[edge], minimum: rangeMinima(Float32Array.from({ length: size },
      (_, col) => positions[(edge * size + col) * 3 + 1])) });
  }

  function blocked(tile, eye, openings) {
    const dx = Math.max(tile.minX - eye.x, 0, eye.x - tile.maxX);
    const dz = Math.max(tile.minZ - eye.z, 0, eye.z - tile.maxZ);
    const onX = dx >= dz;
    const along = onX ? eye.x : eye.z, across = onX ? eye.z : eye.x;
    const lo = onX ? tile.minX : tile.minZ, hi = onX ? tile.maxX : tile.maxZ;
    const direction = along < lo ? 1 : -1;
    const near = direction > 0 ? lo - along : along - hi;
    const far = direction > 0 ? hi - along : along - lo;
    if (near < (onX ? spacingX : spacingZ) * tileSize) return false;
    const left = (onX ? tile.minZ : tile.minX) - across;
    const right = (onX ? tile.maxZ : tile.maxX) - across;
    const leftSlope = slope(left, near, far), rightSlope = -slope(-right, near, far);
    const top = -slope(eye.y - tile.maxY, near, far);
    const bottom = slope(tile.minY - eye.y, near, far);
    const acrossCoordinates = onX ? zs : xs;
    const acrossSpacing = onX ? spacingZ : spacingX;
    const edges = onX ? xEdges : zEdges;
    let openingDistance = Infinity;
    // Reject barriers after any opening the ray envelope might touch. A ski
    // opening below the entire envelope cannot break its terrain occlusion.
    for (const hole of openings) {
      const min = onX ? hole.minX : hole.minZ, max = onX ? hole.maxX : hole.maxZ;
      const first = Math.max(0, direction > 0 ? min - along : along - max);
      const last = direction > 0 ? max - along : along - min;
      if (last < first || first >= near) continue;
      if (across + rightSlope * (rightSlope > 0 ? last : first) < (onX ? hole.minZ : hole.minX) ||
          across + leftSlope * (leftSlope < 0 ? last : first) > (onX ? hole.maxZ : hole.maxX)) continue;
      if (eye.y + bottom * (bottom < 0 ? last : first) > hole.maxY + clearance) continue;
      openingDistance = Math.min(openingDistance, first);
    }
    // A line of sight starting above continuous ground cannot reach the
    // target through this section of terrain if even the top of its box is
    // below the whole intervening edge.
    for (const { at, minimum } of edges) {
      const distance = direction * (at - along);
      if (distance <= clearance || distance >= near - clearance || distance >= openingDistance - clearance) continue;
      const first = across + leftSlope * distance - clearance;
      const last = across + rightSlope * distance + clearance;
      if (first < acrossCoordinates[0] || last > acrossCoordinates[size - 1]) continue;
      const firstSample = Math.floor((first - acrossCoordinates[0]) / acrossSpacing);
      const lastSample = Math.min(size - 1, Math.ceil((last - acrossCoordinates[0]) / acrossSpacing));
      if (minimum(firstSample, lastSample) > eye.y + top * distance + clearance) return true;
    }
    return false;
  }

  return { blocked, tiles };
}
