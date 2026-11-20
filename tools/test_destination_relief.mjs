import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const three = new URL('../vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'three' ? { url: three, shortCircuit: true } : next(specifier, context);
} });
const { createDestinationRelief, loadDestinationReliefs } = await import('../src/destination-relief.js');

test('each mountain retains the surveyed rectangle and four vertical cut faces', async t => {
  const data = await readFile(new URL('../data/destination-relief.bin', import.meta.url));
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(data)));
  const records = await loadDestinationReliefs();
  assert.ok(records.has('whistler-blackcomb'));
  for (const [name, record] of records) {
    const { terrain, routes, details } = createDestinationRelief(record);
    const halfX = record.getFloat32(2, true) / 2;
    const halfZ = record.getFloat32(6, true) / 2;
    for (const mesh of [terrain, routes, details]) {
      if (!mesh.attributes.position.count) continue;
      mesh.computeBoundingBox();
      const { min, max } = mesh.boundingBox;
      assert.ok(min.x >= -halfX - 1e-6 && max.x <= halfX + 1e-6 &&
        min.z >= -halfZ - 1e-6 && max.z <= halfZ + 1e-6, name + ' exceeds its survey boundary');
    }
    const faces = new Set();
    const points = terrain.attributes.position;
    for (let i = 0; i < points.count; i += 3) {
      const y = [points.getY(i), points.getY(i + 1), points.getY(i + 2)];
      if (Math.min(...y) !== 0 || Math.max(...y) <= 0) continue;
      const x = points.getX(i), z = points.getZ(i);
      if (x === points.getX(i + 1) && x === points.getX(i + 2) && Math.abs(x) === halfX) faces.add(x > 0 ? 'east' : 'west');
      if (z === points.getZ(i + 1) && z === points.getZ(i + 2) && Math.abs(z) === halfZ) faces.add(z > 0 ? 'south' : 'north');
    }
    assert.equal(faces.size, 4, name + ' is missing a cut face');
  }
});
