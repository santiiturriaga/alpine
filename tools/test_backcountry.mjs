import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { MeshBasicMaterial, Raycaster, Vector3 } from '../vendor/three.module.js';

const three = new URL('../vendor/three.module.js', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'three' ? { url: three, shortCircuit: true } : next(specifier, context);
  },
});
const { createBackcountry, createSurveyTerrain } = await import('../src/backcountry.js');
const material = new MeshBasicMaterial();
const bounds = { minX: -430, maxX: 720, minZ: -120, maxZ: 940 };
const regional = {
  bounds, cols: 24, rows: 54,
  xAt: i => bounds.minX + i * 50, zAt: i => bounds.minZ + i * 20,
  sample: (x, z) => 900 + x * .21 - z * .08,
};
const insetBounds = { minX: -240, maxX: 420, minZ: 120, maxZ: 790 };
const inset = {
  bounds: insetBounds, cols: 67, rows: 68,
  xAt: i => insetBounds.minX + i * 10, zAt: i => insetBounds.minZ + i * 10,
  sample(x, z) {
    // Native survey vertices introduce slopes that the coarse DEM cannot represent.
    const u = x / 10, t = z / 10;
    return regional.sample(x, z) + 32 + 7 * (1 - Math.abs(u / 2 - Math.round(u / 2)) * 4)
      + 5 * (1 - Math.abs(t / 2 - Math.round(t / 2)) * 4);
  },
};
const survey = createSurveyTerrain({ regional, insets: [inset], material });
const backcountry = createBackcountry({ survey, material, seed: 5419, compact: true });

function close(a, b, tolerance = .002) {
  assert.ok(Math.abs(a - b) < tolerance, `Expected ${a} near ${b} (±${tolerance})`);
}
const ray = new Raycaster(new Vector3(0, 20000, 0), new Vector3(0, -1, 0));
function triangle(group, x, z) {
  ray.ray.origin.set(x, 20000, z);
  const hit = ray.intersectObject(group, true)[0];
  assert.ok(hit, `No terrain triangle at ${x}, ${z}`);
  return hit;
}

for (const [x, z] of [[-252.4, 365.3], [423.1, 698.4], [395.4, 116.2], [201.8, 797.4]]) {
  const normal = new Vector3();
  const hit = triangle(survey.group, x, z);
  close(survey.sample(x, z, normal), hit.point.y);
  assert.ok(normal.distanceTo(hit.face.normal) < 1e-6);
}
for (const [x, z, dx, dz] of [[-240, 361.7, -1, 0], [420, 646.8, 1, 0],
  [161.3, 120, 0, -1], [205.6, 790, 0, 1], [-240, 120, -1, -1]]) {
  close(survey.sample(x + dx * .0001, z + dz * .0001), inset.sample(x, z));
}
close(survey.sample(bounds.maxX - 17, bounds.minZ + 12), regional.sample(bounds.maxX - 17, bounds.minZ + 12));

const point = { x: bounds.maxX + 8, z: 325 };
const initial = backcountry.sample(point.x, point.z);
function settle(center) {
  for (let frame = 0; frame < 120; frame++) {
    const resident = backcountry.group.children.length;
    backcountry.stream(center);
    const next = backcountry.group.children.length;
    assert.ok(next - resident <= 1);
    assert.ok(next <= 49);
  }
}
assert.equal(backcountry.group.children.length, 0);
settle(point);
for (const [x, z] of [[point.x, point.z], [bounds.maxX + 9, -4], [bounds.maxX + 3199, 55],
  [bounds.maxX + 3201, 55], [bounds.maxX + 1, bounds.minZ - 1]]) {
  const normal = new Vector3();
  const hit = triangle(backcountry.group, x, z);
  close(backcountry.sample(x, z, normal), hit.point.y);
  assert.ok(normal.distanceTo(hit.face.normal) < 1e-6);
}
close(backcountry.sample(bounds.maxX + .001, point.z), survey.sample(bounds.maxX, point.z));
assert.equal(backcountry.sample(point.x, point.z), initial);
const first = backcountry.group.children[0];
let disposed = false;
first.geometry.addEventListener('dispose', () => { disposed = true; });
settle({ x: 102000, z: -65000 });
assert.ok(disposed);
assert.ok(!backcountry.group.children.includes(first));
assert.equal(backcountry.sample(point.x, point.z), initial);
settle(point);
assert.ok(!backcountry.group.children.includes(first));
assert.equal(backcountry.sample(point.x, point.z), initial);
close(triangle(backcountry.group, point.x, point.z).point.y, initial);

const distant = createBackcountry({ survey, material, seed: 5419, compact: true, viewDistance: 6200 });
for (let frame = 0; frame < 320; frame++) distant.stream(point);
const horizonZ = point.z + 6000;
triangle(distant.horizon, point.x, horizonZ);
ray.ray.origin.set(point.x, 20000, point.z);
assert.equal(ray.intersectObject(distant.horizon, true).length, 0);
close(triangle(distant.group, point.x, point.z).point.y, initial);

// A coarse neighbor reproduces the full edge of a dense tile.
const edgeZ = bounds.maxZ + 2 * 32 * 20;
const left = triangle(distant.group, point.x, edgeZ - .001).point.y;
const right = triangle(distant.horizon, point.x, edgeZ + .001).point.y;
close(left, right);
assert.ok(distant.horizon.children.length < 80);
const originalSector = distant.horizon.children[0];
distant.stream({ x: 430000, z: 465000 });
assert.ok(!distant.horizon.children.includes(originalSector));

console.log('Survey joins, chunk seams, collision, horizon coverage, and deterministic eviction verified.');
