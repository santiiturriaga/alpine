import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Raycaster, Vector3 }
  from '../vendor/three.module.js';

const three = new URL('../vendor/three.module.js', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'three' ? { url: three, shortCircuit: true } : next(specifier, context);
  },
});
const { rasterGrid } = await import('../src/mapped-resort-ground.js');
const { createMappedTerrainDetail } = await import('../src/mapped-terrain-detail.js');
const { snowProfile, surveyCurve } = await import('../src/terrain-profile.js');

const tileSize = 48;
const size = tileSize * 2 + 1;
const bounds = { minX: -50, maxX: 910, minZ: -20, maxZ: 940 };
const values = new Float32Array(size * size);
for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
  values[j * size + i] = 1500 + 11 * Math.cos(i * .39) + 7 * Math.sin(j * .26);
}
const grid = rasterGrid(values, { cols: size, rows: size }, bounds);
const detail = createMappedTerrainDetail(grid, 'BUDGET', tileSize);
const group = new Group(), material = new MeshBasicMaterial();

function fullGeometry(i, j) {
  const geometry = new BufferGeometry(), points = [], indices = [];
  for (let z = 0; z <= tileSize; z++) for (let x = 0; x <= tileSize; x++) {
    points.push(grid.xAt(i + x), values[(j + z) * size + i + x], grid.zAt(j + z));
    if (z === tileSize || x === tileSize) continue;
    const a = z * (tileSize + 1) + x, b = a + 1, c = a + tileSize + 1;
    indices.push(a, c, b, b, c, c + 1);
  }
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
for (let j = 0; j < size - 1; j += tileSize) for (let i = 0; i < size - 1; i += tileSize) {
  detail.add(i, j, tileSize + 1, tileSize + 1, () => fullGeometry(i, j), material, group);
}
const ray = new Raycaster(new Vector3(0, 6000, 0), new Vector3(0, -1, 0));
const normal = new Vector3(), oldLeft = new Vector3(), oldRight = new Vector3();
const newLeft = new Vector3(), newRight = new Vector3();
function compareSurface(mesh, x, z, exact) {
  ray.ray.origin.set(x, 6000, z);
  const hit = ray.intersectObject(mesh, false)[0];
  assert.ok(hit, `No surface at ${x}, ${z}`);
  const h = exact ? detail.sample(x, z, normal, true) : grid.sample(x, z);
  assert.ok(Math.abs(hit.point.y - h) < .0002);
  if (exact) assert.ok(normal.distanceTo(hit.face.normal) < 1e-6);
}

const corner = { x: grid.xAt(tileSize), z: grid.zAt(tileSize) };
const checkpoints = [[-3.23, -2.21], [5.41, -3.51], [-1.29, 8.05], [17.23, 22.18]]
  .map(([x, z]) => [corner.x + x, corner.z + z]);
const before = checkpoints.map(([x, z]) => detail.sample(x, z));
const camera = { position: { x: 240, z: 255 } };
detail.update(camera);
assert.ok(group.children[0].geometry.userData.snowProfile);
assert.ok(!group.children[1].geometry.userData.snowProfile);
for (const offset of [3.25, 25.5, 45.7, 90.1, 184.2, 312.3, 479.9]) {
  compareSurface(group.children[0], corner.x - .0001, bounds.minZ + offset, true);
  compareSurface(group.children[1], corner.x + .0001, bounds.minZ + offset, false);
}

const preparedMs = [];
const approach = { position: { x: corner.x - 95, z: corner.z - 95 } };
for (let frame = 0; frame < 3; frame++) {
  const started = performance.now();
  detail.update(approach);
  preparedMs.push(performance.now() - started);
}
assert.equal(group.children.filter(mesh => mesh.geometry.userData.snowProfile).length, 1);
const started = performance.now();
detail.update({ position: corner });
const streamedMs = performance.now() - started;
assert.equal(group.children.filter(mesh => mesh.geometry.userData.snowProfile).length, 4);
assert.ok(group.children.every(mesh => mesh.geometry.index.count / 3 === tileSize * tileSize * 8));
const cornerGeometry = group.children[3].geometry;
detail.update({ position: { x: corner.x - 113, z: corner.z - 113 } });
assert.ok(!group.children[3].geometry.userData.snowProfile);
detail.update({ position: corner });
assert.equal(group.children[3].geometry, cornerGeometry);
for (const [index, [x, z]] of checkpoints.entries()) {
  assert.equal(detail.sample(x, z), before[index]);
  compareSurface(group.children[index], x, z, true);
}
for (const distance of [-20.3, -5.3, -.01, .01, 5.3, 20.3]) {
  const x = corner.x + distance, z = corner.z + distance * .71;
  compareSurface(group.children[distance < 0 ? 0 : 3], x, z, true);
}
for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
  assert.equal(detail.sample(grid.xAt(i), grid.zAt(j)), values[j * size + i]);
}
detail.update({ position: { x: -700, z: -700 } });
assert.equal(group.children.filter(mesh => mesh.geometry.userData.snowProfile).length, 0);
assert.deepEqual(checkpoints.map(([x, z]) => detail.sample(x, z)), before);
assert.ok(group.children[0].geometry.index.count / 3 < tileSize * tileSize * 2);
assert.equal(surveyCurve(0, 4, 5, 5, 0), 4);
assert.equal(surveyCurve(0, 4, 5, 5, 1), 5);
for (let i = 0; i <= 25; i++) {
  const y = surveyCurve(-25, 4, 5, 75, i / 25);
  assert.ok(y >= 4 && y <= 5);
}

const steep = new Float32Array(size * size);
for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
  steep[j * size + i] = 2200 + i * 15 + 2 * Math.cos(i + j * .43);
}
const rock = rasterGrid(steep, { cols: size, rows: size }, bounds);
const cliff = snowProfile(rock, 0, 0, tileSize + 1, tileSize + 1);
for (let v = 0; v < cliff.rows; v++) for (let u = 0; u < cliff.cols; u++) {
  assert.ok(Math.abs(cliff.vertex(u, v) - rock.sample(rock.xAt(u * .5), rock.zAt(v * .5))) < .00015);
}

for (const resort of ['vail', 'les-3-vallees', 'stevens-pass']) {
  const folder = new URL(`../data/mountains/${resort}/`, import.meta.url);
  const config = JSON.parse(await readFile(new URL('resort.json', folder), 'utf8'));
  const raster = config.terrain;
  const source = await readFile(new URL(raster.file, folder));
  const data = new Float32Array(raster.cols * raster.rows);
  for (let i = 0; i < data.length; i++) data[i] = raster.offset + raster.scale * source.readUInt16LE(i * 2);
  const DEM = rasterGrid(data, raster, config.bounds);
  const dx = DEM.xAt(1) - DEM.xAt(0), dz = DEM.zAt(1) - DEM.zAt(0);
  const line = config.runs.find(run => run.id === config.startRun);
  const oldAngles = [], newAngles = [], oldDiagonals = [], newDiagonals = [];
  for (const [x, z] of line.points) {
    const gx = Math.round((x - config.bounds.minX) / dx);
    const gz = Math.round((z - config.bounds.minZ) / dz);
    const i = Math.floor(gx / tileSize) * tileSize, j = Math.floor(gz / tileSize) * tileSize;
    const tile = snowProfile(DEM, i, j, Math.min(tileSize + 1, raster.cols - i), Math.min(tileSize + 1, raster.rows - j));
    for (let v = gz - 4; v <= gz + 4; v++) for (let u = gx - 4; u <= gx + 4; u++) {
      if (u < i + 2 || v < j + 2 || (u - i) * 2 > tile.cols - 5 || (v - j) * 2 > tile.rows - 5) continue;
      const mid = DEM.zAt(v + .23), left = DEM.xAt(u) - .02, right = DEM.xAt(u) + .02;
      DEM.sample(left, mid, oldLeft, true); DEM.sample(right, mid, oldRight, true);
      if (Math.min(oldLeft.y, oldRight.y) < .884) continue;
      tile.sample(left, mid, newLeft, true); tile.sample(right, mid, newRight, true);
      oldAngles.push(oldLeft.angleTo(oldRight) * 180 / Math.PI);
      newAngles.push(newLeft.angleTo(newRight) * 180 / Math.PI);
      const diagX = DEM.xAt(u + .38), diagZ = DEM.zAt(v + .62);
      DEM.sample(diagX - .02, diagZ, oldLeft, true); DEM.sample(diagX + .02, diagZ, oldRight, true);
      if (Math.min(oldLeft.y, oldRight.y) < .884) continue;
      tile.sample(diagX - .02, diagZ, newLeft, true); tile.sample(diagX + .02, diagZ, newRight, true);
      oldDiagonals.push(oldLeft.angleTo(oldRight) * 180 / Math.PI);
      newDiagonals.push(newLeft.angleTo(newRight) * 180 / Math.PI);
    }
  }
  const percentile = angles => angles.sort((a, b) => a - b)[Math.floor(angles.length * .95)];
  const old95 = percentile(oldAngles), new95 = percentile(newAngles);
  assert.ok(oldAngles.length > 800);
  assert.ok(new95 < old95 * .90, `${resort}: ${new95}° refined vs. ${old95}° native`);
  const oldDiag95 = percentile(oldDiagonals), newDiag95 = percentile(newDiagonals);
  assert.ok(newDiag95 < oldDiag95, `${resort}: diagonal ${newDiag95}° refined vs. ${oldDiag95}° native`);
  console.log(`${line.name} (${resort}), ${oldAngles.length} snow-slope joins: p95 ${old95.toFixed(2)}° → ${new95.toFixed(2)}°. ` +
    `Across ${oldDiagonals.length} diagonals, p95 ${oldDiag95.toFixed(2)}° → ${newDiag95.toFixed(2)}°.`);
}
console.log(`Survey points, steep faces, corner stitching, active render/collision and level changes verified. ` +
  `Three geometry preparations took ${preparedMs.map(ms => ms.toFixed(1)).join(', ')} ms in separate updates. ` +
  `Promoting the prepared geometry took ${streamedMs.toFixed(2)} ms.`);
