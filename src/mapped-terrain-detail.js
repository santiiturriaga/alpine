import * as THREE from 'three';
import { coarseTerrainTopology, createTerrainTileDetail } from './terrain-tile-detail.js';
import { snowProfile } from './terrain-profile.js';
import { clamp, lerp, smoothstep } from './math.js';

const refinedIndices = new Map();

function coarseGeometry(grid, i, j, width, height) {
  const { points, indices } = coarseTerrainTopology(width, height);
  const positions = new Float32Array(points.length * 3);
  const normals = new Float32Array(positions.length);
  for (let n = 0; n < points.length; n++) {
    const u = i + points[n] % width, v = j + Math.floor(points[n] / width);
    const src = (v * grid.cols + u) * 3, dst = n * 3;
    positions[dst] = grid.xAt(u);
    positions[dst + 1] = grid.values[src / 3];
    positions[dst + 2] = grid.zAt(v);
    normals[dst] = grid.normals[src];
    normals[dst + 1] = grid.normals[src + 1];
    normals[dst + 2] = grid.normals[src + 2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function refinedGeometry(grid, profile, i, j) {
  const { rows, cols } = profile;
  const count = rows * cols;
  const values = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(positions.length);
  const dx = grid.xAt(1) - grid.xAt(0), dz = grid.zAt(1) - grid.zAt(0);
  const lastX = cols - 1, lastZ = rows - 1;
  for (let v = 0; v < rows; v++) for (let u = 0; u < cols; u++) {
    const k = v * cols + u;
    values[k] = profile.vertex(u, v);
    positions[3 * k] = grid.xAt(i + u * .5);
    positions[3 * k + 1] = values[k];
    positions[3 * k + 2] = grid.zAt(j + v * .5);
  }
  for (let v = 0; v < rows; v++) for (let u = 0; u < cols; u++) {
    const k = v * cols + u;
    const x = i + (u >> 1), z = j + (v >> 1);
    const halfX = u & 1, halfZ = v & 1;
    const source = (z * grid.cols + x) * 3;
    const normalA = source + (halfX && halfZ ? 3 : 0);
    const normalB = source + (halfZ ? grid.cols * 3 : halfX * 3);
    const edge = Math.min(u, v, lastX - u, lastZ - v);
    const up = (grid.normals[normalA + 1] + grid.normals[normalB + 1]) * .5;
    const blend = .63 * smoothstep(0, 4, edge) * smoothstep(.70, .91, up);
    const nx = blend ? (values[k - 1] - values[k + 1]) / dx : 0;
    const nz = blend ? (values[k - cols] - values[k + cols]) / dz : 0;
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    normals[k * 3] = lerp((grid.normals[normalA] + grid.normals[normalB]) * .5, nx * inv, blend);
    normals[k * 3 + 1] = lerp(up, inv, blend);
    normals[k * 3 + 2] = lerp((grid.normals[normalA + 2] + grid.normals[normalB + 2]) * .5, nz * inv, blend);
  }
  const key = rows * 128 + cols;
  let indices = refinedIndices.get(key);
  if (!indices) {
    indices = new Uint16Array(lastX * lastZ * 6);
    let offset = 0;
    for (let v = 0; v < lastZ; v++) for (let u = 0; u < lastX; u++) {
      const a = v * cols + u, b = a + 1, c = a + cols;
      indices.set([a, c, b, b, c, c + 1], offset);
      offset += 6;
    }
    refinedIndices.set(key, indices);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.userData.snowProfile = values;
  return geometry;
}

export function createMappedTerrainDetail(grid, initialQuality, tileSize) {
  const detail = createTerrainTileDetail(initialQuality);
  const tileCols = Math.ceil((grid.cols - 1) / tileSize);
  const tileRows = Math.ceil((grid.rows - 1) / tileSize);
  const dx = grid.xAt(tileSize) - grid.xAt(0), dz = grid.zAt(tileSize) - grid.zAt(0);
  const tiles = new Array(tileCols * tileRows);
  const index = (x, z) => z * tileCols + x;
  return {
    setQuality: detail.setQuality,
    update(camera, rider) {
      if (rider) detail.update(camera.position, rider);
      else detail.update(camera.position);
    },
    add(i, j, width, height, fullGeometry, material, group) {
      const profile = snowProfile(grid, i, j, width, height);
      const mesh = detail.add(group, material, {
        minX: grid.xAt(i), maxX: grid.xAt(i + width - 1),
        minZ: grid.zAt(j), maxZ: grid.zAt(j + height - 1),
      }, fullGeometry, () => coarseGeometry(grid, i, j, width, height),
      () => refinedGeometry(grid, profile, i, j));
      tiles[index(i / tileSize, j / tileSize)] = { profile, mesh };
    },
    sample(x, z, normal, exact) {
      const col = clamp(Math.floor((x - grid.bounds.minX) / dx), 0, tileCols - 1);
      const row = clamp(Math.floor((z - grid.bounds.minZ) / dz), 0, tileRows - 1);
      const tile = tiles[index(col, row)];
      // Use the same profile before and after streaming, including for asset
      // anchors sampled long before the rider gets near the tile.
      return tile ? tile.profile.sample(x, z, normal, exact, tile.mesh.geometry.userData.snowProfile)
        : grid.sample(x, z, normal, exact);
    },
  };
}
