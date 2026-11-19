import assert from 'node:assert/strict';
import { createTerrainOcclusion } from '../src/terrain-occlusion.js';

function ridge({ onX = true, gap = false, peak = false } = {}) {
  const size = 9, tileSize = 2;
  const positions = new Float32Array(size * size * 3);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const k = 3 * (z * size + x), along = onX ? x : z, across = onX ? z : x;
    const y = peak && along === 7 ? 46 : along === 4 && (!gap || across !== 1) ? 6 : 0;
    positions.set([x * 20, y, z * 20], k);
  }
  const { tiles, blocked } = createTerrainOcclusion({ positions, size, tileSize });
  return { blocked: (index, eye, openings) => blocked(tiles[index], eye, openings), blockedBounds: blocked };
}

const eye = { x: 10, y: 2, z: 20 }, target = 3;
assert.ok(ridge().blocked(target, eye, []));
assert.ok(ridge({ onX: false }).blocked(12, { x: eye.z, y: eye.y, z: eye.x }, []));
assert.ok(ridge().blocked(0, { x: 150, y: 2, z: 20 }, []));
assert.equal(ridge({ gap: true }).blocked(target, eye, []), false);
assert.equal(ridge({ peak: true }).blocked(target, eye, []), false);
assert.equal(ridge().blocked(target, { ...eye, y: 80 }, []), false);
assert.equal(ridge().blocked(target, { ...eye, x: 105 }, []), false);

const opening = { minX: 38, maxX: 44, minZ: 17, maxZ: 23, maxY: Infinity };
assert.equal(ridge().blocked(target, eye, [opening]), false);
assert.ok(ridge().blocked(target, eye, [{ ...opening, minZ: 100, maxZ: 105 }]));
assert.ok(ridge().blocked(target, eye, [{ ...opening, maxY: -2 }]));
assert.ok(ridge().blocked(target, eye, [{ ...opening, minX: 100, maxX: 108 }]));
const regional = { minX: 170, maxX: 210, minY: -5, maxY: 2, minZ: 0, maxZ: 50 };
assert.ok(ridge().blockedBounds(regional, eye, []));
assert.equal(ridge().blockedBounds({ ...regional, maxY: 30 }, eye, []), false);
assert.equal(ridge().blockedBounds({ ...regional, minZ: -200, maxZ: 300 }, eye, []), false);
assert.equal(ridge().blockedBounds(regional, eye, [opening]), false);
console.log('Terrain barriers preserve ridge gaps, tall target peaks, displaced cameras and surface openings.');
