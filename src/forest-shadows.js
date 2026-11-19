import * as THREE from 'three';

// Retain simple casters at their planted positions. The light's own frustum
// selects tiles, independently of the view, color LOD, and lift clearance.
export function forestShadowTiles(group) {
  const size = 96, tiles = new Map(), batches = new Map();
  const surface = new THREE.MeshBasicMaterial();
  const bounds = new THREE.Box3();
  function allocate(batch, count) {
    const { geometry, mesh } = batch;
    if (mesh) {
      group.remove(mesh);
      mesh.dispose();
    }
    const capacity = 2 ** Math.ceil(Math.log2(Math.max(16, count)));
    batch.mesh = new THREE.InstancedMesh(geometry, surface, capacity);
    batch.mesh.name = 'Fixed woodland shadow casters';
    batch.mesh.frustumCulled = false;
    batch.mesh.castShadow = true;
    batch.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The light pass is the only consumer of these instances.
    batch.mesh.count = 0;
    batch.mesh.onBeforeShadow = () => { batch.mesh.count = batch.count; };
    batch.mesh.onAfterShadow = () => { batch.mesh.count = 0; };
    batch.mesh.matrixAutoUpdate = false;
    group.add(batch.mesh);
    batch.mesh.updateWorldMatrix(false, false);
  }
  return {
    add(x, z, geometry, matrix) {
      const key = `${Math.floor(x / size)}:${Math.floor(z / size)}:${geometry.id}`;
      if (!tiles.has(key)) tiles.set(key, { geometry, matrices: [], bounds: new THREE.Box3() });
      const tile = tiles.get(key);
      tile.matrices.push(...matrix.elements);
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      tile.bounds.union(bounds.copy(geometry.boundingBox).applyMatrix4(matrix));
    },
    finish() {
      for (const tile of tiles.values()) {
        const { geometry } = tile;
        if (!batches.has(geometry)) batches.set(geometry, { geometry, tiles: [], selected: [], previous: [] });
        tile.matrices = Float32Array.from(tile.matrices);
        batches.get(geometry).tiles.push(tile);
      }
      tiles.clear();
    },
    update(renderer, sun) {
      const shadowMap = renderer.shadowMap;
      if (!sun?.castShadow || !shadowMap.enabled || (!shadowMap.needsUpdate && !shadowMap.autoUpdate)) return;
      sun.updateMatrixWorld();
      sun.shadow.updateMatrices(sun);
      const frustum = sun.shadow.getFrustum();
      for (const batch of batches.values()) {
        const { selected, previous } = batch;
        selected.length = 0;
        let count = 0;
        for (const tile of batch.tiles) {
          if (!frustum.intersectsBox(tile.bounds)) continue;
          selected.push(tile);
          count += tile.matrices.length / 16;
        }
        if (batch.mesh) batch.mesh.visible = count > 0;
        if (selected.length === previous.length && selected.every((tile, i) => tile === previous[i])) continue;
        batch.count = count;
        if (count) {
          if (!batch.mesh || count > batch.mesh.instanceMatrix.count) allocate(batch, count);
          const matrices = batch.mesh.instanceMatrix;
          let offset = 0;
          for (const tile of selected) {
            matrices.array.set(tile.matrices, offset);
            offset += tile.matrices.length;
          }
          matrices.clearUpdateRanges();
          matrices.addUpdateRange(0, offset);
          matrices.needsUpdate = true;
        }
        batch.previous = selected;
        batch.selected = previous;
      }
    },
  };
}

export function softenShadowBoundary(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',
    THREE.ShaderChunk.shadowmap_pars_fragment.replace('return shadow;', `
      float inset = min(min(shadowCoord.x, 1.0-shadowCoord.x), min(shadowCoord.y, 1.0-shadowCoord.y));
      return mix(1.0,shadow,smoothstep(.002,.205,inset));`));
}
