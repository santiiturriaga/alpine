import * as THREE from 'three';

const detailIn = 490;
const detailOut = 580;
const topologyCache = new Map();

export function coarseTerrainTopology(width, height) {
  const key = `${width}:${height}`;
  if (topologyCache.has(key)) return topologyCache.get(key);
  const points = [], indices = [], vertices = new Map();
  const vertex = (x, z) => {
    const index = z * width + x;
    if (!vertices.has(index)) {
      vertices.set(index, points.length);
      points.push(index);
    }
    return vertices.get(index);
  };
  const steps = size => {
    const n = Math.ceil((size - 1) / 4);
    return Array.from({ length: n + 1 }, (_, i) => Math.round(i * (size - 1) / n));
  };
  const xs = steps(width), zs = steps(height);
  for (let j = 1; j < zs.length; j++) for (let i = 1; i < xs.length; i++) {
    const x0 = xs[i - 1], x1 = xs[i], z0 = zs[j - 1], z1 = zs[j];
    const a = vertex(x0, z0), b = vertex(x1, z0), c = vertex(x0, z1), d = vertex(x1, z1);
    const top = z0 === 0, bottom = z1 === height - 1;
    const left = x0 === 0, right = x1 === width - 1;
    if (!(top || bottom || left || right)) {
      indices.push(a, c, b, b, c, d);
      continue;
    }
    // Keep every DEM sample on the edge so adjacent tiles can use either LOD.
    const ring = [a];
    if (left) for (let z = z0 + 1; z < z1; z++) ring.push(vertex(x0, z));
    ring.push(c);
    if (bottom) for (let x = x0 + 1; x < x1; x++) ring.push(vertex(x, z1));
    ring.push(d);
    if (right) for (let z = z1 - 1; z > z0; z--) ring.push(vertex(x1, z));
    ring.push(b);
    if (top) for (let x = x1 - 1; x > x0; x--) ring.push(vertex(x, z0));
    const center = vertex(Math.floor((x0 + x1) / 2), Math.floor((z0 + z1) / 2));
    for (let k = 0; k < ring.length; k++) indices.push(center, ring[k], ring[(k + 1) % ring.length]);
  }
  const topology = { points, indices: new Uint16Array(indices) };
  topologyCache.set(key, topology);
  return topology;
}

export function createTerrainTileDetail(initialQuality) {
  const tiles = [];
  let budget = initialQuality === 'BUDGET', dirty = true;
  let lastCenters = [];
  function setQuality(name) {
    if (budget === (name === 'BUDGET')) return;
    budget = name === 'BUDGET';
    dirty = true;
  }
  function add(group, material, bounds, fullGeometry, coarseGeometry) {
    const mesh = new THREE.Mesh(budget ? coarseGeometry() : fullGeometry(), material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    tiles.push({ mesh, full: !budget, coarseGeometry, fullGeometry, bounds });
  }
  function distance({ minX, maxX, minZ, maxZ }, { x, z }) {
    return Math.hypot(Math.max(0, minX - x, x - maxX), Math.max(0, minZ - z, z - maxZ));
  }
  function update(...centers) {
    if (!dirty && (!budget || (lastCenters.length === centers.length &&
      centers.every(({ x, z }, i) => Math.hypot(lastCenters[i].x - x, lastCenters[i].z - z) < 28)))) return;
    lastCenters = centers.map(({ x, z }) => ({ x, z }));
    dirty = false;
    let remaining = 18;
    for (const tile of tiles) {
      let d = Infinity;
      for (const center of centers) d = Math.min(d, distance(tile.bounds, center));
      const full = !budget || d < (tile.full ? detailOut : detailIn);
      if (full === tile.full) continue;
      // Restore nearby gameplay tiles immediately. Spread distant changes across frames.
      if (d > detailIn && remaining-- <= 0) {
        dirty = true;
        continue;
      }
      const previous = tile.mesh.geometry;
      tile.mesh.geometry = full ? tile.fullGeometry() : tile.coarseGeometry();
      tile.full = full;
      previous.dispose();
    }
  }
  return { setQuality, update, add };
}
