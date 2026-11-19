import * as THREE from 'three';
import { coarseTerrainTopology, createTerrainTileDetail } from './terrain-tile-detail.js';

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

export function createMappedTerrainDetail(grid, initialQuality) {
  const detail = createTerrainTileDetail(initialQuality);
  return {
    setQuality: detail.setQuality,
    update(camera) { detail.update(camera.position); },
    add(i, j, width, height, fullGeometry, material, group) {
      detail.add(group, material, {
        minX: grid.xAt(i), maxX: grid.xAt(i + width - 1),
        minZ: grid.zAt(j), maxZ: grid.zAt(j + height - 1),
      }, fullGeometry, () => coarseGeometry(grid, i, j, width, height));
    },
  };
}
