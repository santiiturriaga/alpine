import * as THREE from 'three';
import { coniferDepthMaterial, coniferGeometry, coniferMaterial } from './conifers.js';
import { ForestCell, forestDetailTiers, makeForestCrowns, preloadForestCrowns } from './forest-lod.js';
import { pointInPolygon, runStyle, segmentDistance } from './mapped-resort-ground.js';
import { stevensTraverseTrees, STEVENS_POWERLINE } from './stevens-pass-details.js';
import { hash2, smoothstep } from './util.js';

const PATCH = 210;
const TREE_SPACING = 12;
const FOREST_TILE = 240;
const species = ['fir', 'spruce', 'hemlock'];
const detailProfiles = {
  LOW: [90, 158, 3500, .74],
  BALANCED: [127, 229, 4400, .94],
  HIGH: [165, 278, 5300, 1.11],
  MAX: [240, 375, 7200, 1.35],
};

function bindCascadeRange(material, range) {
  const original = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer);
    shader.uniforms.forestRange = range;
  };
  material.customProgramCacheKey = () => `${cacheKey}-cascade`;
  return material;
}

function exclusionMap(config) {
  const cells = new Map(), spacing = 90;
  const key = (i, j) => `${i}:${j}`;
  function add(test, minX, maxX, minZ, maxZ) {
    for (let i = Math.floor(minX / spacing); i <= Math.floor(maxX / spacing); i++) {
      for (let j = Math.floor(minZ / spacing); j <= Math.floor(maxZ / spacing); j++) {
        const id = key(i, j);
        if (!cells.has(id)) cells.set(id, []);
        cells.get(id).push(test);
      }
    }
  }
  function corridor(points, width) {
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      add((x, z) => segmentDistance(x, z, ax, az, bx, bz) < width,
        Math.min(ax, bx) - width, Math.max(ax, bx) + width,
        Math.min(az, bz) - width, Math.max(az, bz) + width);
    }
  }
  for (const run of config.runs) corridor(run.points, runStyle(run).width * .84 + 3.7);
  for (const { points, kind } of config.summerRoutes ?? []) corridor(points, kind === 'bike' ? 3 : 2);
  for (const lift of config.lifts) {
    corridor(lift.points, lift.kind === 'surface' ? 6.5 : 13);
    for (const [x, z] of [lift.points[0], lift.points.at(-1)]) {
      const r = lift.kind === 'surface' ? 10 : 22;
      add((a, b) => (x - a) ** 2 + (z - b) ** 2 < r ** 2, x - r, x + r, z - r, z + r);
    }
  }
  for (const road of config.roads ?? []) corridor(road.points, /primary|motorway|trunk/i.test(road.kind) ? 11 : 7);
  if (config.id === 'stevens-pass') corridor(STEVENS_POWERLINE, 15);
  for (const { points } of [...(config.buildings ?? []), ...(config.parking ?? []), ...(config.runAreas ?? [])]) {
    if (points.length < 3) continue;
    const x = points.map(p => p[0]), z = points.map(p => p[1]);
    add((x, z) => pointInPolygon(x, z, points), Math.min(...x), Math.max(...x), Math.min(...z), Math.max(...z));
    corridor([...points, points[0]], 4.2);
  }
  const clock = config.landmarks?.find(landmark => landmark.id === 'clock-tower');
  if (clock) {
    const [cx, cz] = clock.point;
    add((x, z) => ((x - cx) / 42) ** 2 + ((z - cz - 10) / 48) ** 2 < 1,
      cx - 42, cx + 42, cz - 38, cz + 58);
  }
  return (x, z) => cells.get(key(Math.floor(x / spacing), Math.floor(z / spacing)))?.some(fn => fn(x, z));
}

function resortForestTiles(config) {
  const active = new Set();
  function include(ax, az, bx, bz, pad) {
    const x0 = Math.floor((Math.min(ax, bx) - pad) / FOREST_TILE);
    const x1 = Math.floor((Math.max(ax, bx) + pad) / FOREST_TILE);
    const z0 = Math.floor((Math.min(az, bz) - pad) / FOREST_TILE);
    const z1 = Math.floor((Math.max(az, bz) + pad) / FOREST_TILE);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) active.add(`${x}:${z}`);
    }
  }
  for (const { points } of [...config.runs, ...config.lifts, ...(config.summerRoutes ?? [])]) {
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      include(ax, az, bx, bz, 135);
    }
  }
  if (config.startPoint) {
    const [x, z] = config.startPoint;
    include(x, z, x, z, 340);
  }
  return (x, z) => active.has(`${Math.floor(x / FOREST_TILE)}:${Math.floor(z / FOREST_TILE)}`);
}

export async function buildMappedForest(scene, ground, config, env) {
  await preloadForestCrowns();
  const group = new THREE.Group();
  group.name = 'Cascade conifers · mapped canopy and clearings';
  scene.add(group);
  const { minX, minZ, maxX, maxZ } = ground.bounds;
  // Keep the close spacing around ski terrain even on multi-valley maps.
  // Wide background stands use fewer sample points and larger draw batches.
  const footprint = (maxX - minX) * (maxZ - minZ);
  const stride = Math.max(1, Math.ceil(Math.sqrt(footprint / 100e6)));
  const fullDensity = stride > 1 ? resortForestTiles(config) : null;
  const patchSize = fullDensity ? PATCH * 2 : PATCH;
  const excluded = exclusionMap(config);
  const patches = new Map();
  const normal = new THREE.Vector3();
  let count = 0;
  function plant(tree) {
    const { x, y, z, height } = tree;
    const id = `${Math.floor(x / patchSize)}:${Math.floor(z / patchSize)}`;
    if (!patches.has(id)) patches.set(id, []);
    patches.get(id).push(tree);
    env.addCircle(x, z, .19 + height * .012, 'tree', { maxY: y + height, minY: y - .7, tree });
    count++;
  }
  if (config.id === 'stevens-pass') for (const [x, z, height] of stevensTraverseTrees()) {
    const y = ground.heightAt(x, z);
    if (!env.isOpen(x, y + .4, z, 2.6)) continue;
    plant({ x, y, z, height, kind: 2, yaw: hash2(x, z, 2131) * Math.PI * 2, spread: 1.06, tint: hash2(x, z, 311) });
  }
  function sample(ix, iz) {
    const x = (ix + .12 + .76 * hash2(ix, iz, 747)) * TREE_SPACING;
    const z = (iz + .12 + .76 * hash2(ix, iz, 519)) * TREE_SPACING;
    if (x > maxX - 2 || z > maxZ - 2) return;
    const cover = ground.forestAt(x, z);
    const patchiness = .73 + .27 * Math.sin(x * .009 - z * .014 + Math.sin(z * .035) * .9) ** 2;
    if (hash2(ix, iz, 1291) > smoothstep(.10, .84, cover) * patchiness || excluded(x, z)) return;
    if (ground.normalAt(x, z, normal).y < .56) return;
    const y = ground.heightAt(x, z);
    if (config.id === 'stevens-pass' && !env.isOpen(x, y + .4, z, 1.4)) return;
    const wind = smoothstep(1430, 1900, y);
    const age = hash2(ix, iz, 1923);
    const height = (14 + 29 * age ** .67) * (1 - .59 * wind);
    const variety = hash2(ix, iz, 2497);
    const kind = variety > .76 ? 1 : variety > .29 - wind * .14 ? 2 : 0;
    const yaw = hash2(ix, iz, 2131) * Math.PI * 2;
    const spread = .78 + .28 * hash2(ix, iz, 2789);
    const tint = hash2(ix, iz, 311);
    plant({ x, y, z, height, kind, yaw, spread, tint });
  }
  const lastX = maxX / TREE_SPACING, lastZ = maxZ / TREE_SPACING;
  const center = stride * .5;
  for (let iz = Math.ceil(minZ / TREE_SPACING); iz < lastZ; iz += stride) {
    for (let ix = Math.ceil(minX / TREE_SPACING); ix < lastX; ix += stride) {
      if (!fullDensity || fullDensity((ix + center) * TREE_SPACING, (iz + center) * TREE_SPACING)) {
        for (let z = iz; z < iz + stride; z++) {
          for (let x = ix; x < ix + stride; x++) sample(x, z);
        }
      } else {
        sample(ix + Math.floor(hash2(ix, iz, 1453) * stride), iz + Math.floor(hash2(ix, iz, 9601) * stride));
      }
    }
  }

  const range = { value: new THREE.Vector2() };
  const farRange = { value: 4400 };
  const branchRange = { value: 0 }, sprayRange = { value: 0 }, twigRange = { value: 0 };
  let quality = 1;
  function setQuality(name) {
    const [min, max, far, detail] = detailProfiles[name] ?? detailProfiles.BALANCED;
    range.value.set(min, max);
    farRange.value = far;
    quality = detail;
    branchRange.value = .67 * quality;
    sprayRange.value = .53 * quality;
    twigRange.value = .49 * quality;
  }
  setQuality('BALANCED');
  const mapped = bindCascadeRange(coniferMaterial(-1, 'mapped'), range);
  const shadowMaterial = coniferDepthMaterial();
  const silhouette = bindCascadeRange(coniferMaterial(-2, 'mapped'), range);
  let proxyMaterial = null;
  const medium = species.map(kind => coniferGeometry(kind, -1));
  const far = coniferGeometry('hemlock', -2);
  const stand = new THREE.Object3D(), color = new THREE.Color();
  function setTree(mesh, i, tree) {
    stand.position.set(tree.x, tree.y - .15, tree.z);
    stand.scale.set(tree.height * tree.spread, tree.height, tree.height * tree.spread);
    stand.rotation.set(0, tree.yaw, 0);
    stand.updateMatrix();
    mesh.setMatrixAt(i, stand.matrix);
    mesh.setColorAt(i, color.setRGB(.77 + .23 * tree.tint, .85 + .15 * tree.tint, .88 + .12 * tree.tint));
  }
  const finalize = (mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  };
  const cells = [];
  for (const trees of patches.values()) {
    const center = new THREE.Vector3();
    for (const tree of trees) {
      center.x += tree.x;
      center.y += tree.y + tree.height * .5;
      center.z += tree.z;
    }
    center.divideScalar(trees.length);
    const near = new THREE.Group();
    for (let kind = 0; kind < species.length; kind++) {
      const grove = trees.filter(tree => tree.kind === kind);
      if (!grove.length) continue;
      const mesh = new THREE.InstancedMesh(medium[kind], mapped, grove.length);
      mesh.customDepthMaterial = shadowMaterial;
      mesh.name = species[kind] + ' crowns';
      for (let i = 0; i < grove.length; i++) setTree(mesh, i, grove[i]);
      mesh.receiveShadow = true;
      near.add(finalize(mesh));
    }
    const proxy = makeForestCrowns('mapped', trees.map(tree => tree.kind));
    if (proxy) {
      if (!proxyMaterial) {
        proxyMaterial = proxy.material.clone();
        proxyMaterial.onBeforeCompile = proxy.material.onBeforeCompile;
        proxyMaterial.customProgramCacheKey = proxy.material.customProgramCacheKey;
        bindCascadeRange(proxyMaterial, range);
        const compile = proxyMaterial.onBeforeCompile;
        proxyMaterial.onBeforeCompile = (shader, renderer) => {
          compile(shader, renderer);
          shader.uniforms.cascadeDistance = farRange;
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float cascadeDistance;')
            .replace('#include <alphahash_fragment>', `#include <alphahash_fragment>
              if (smoothstep(cascadeDistance-530.,cascadeDistance,crownDistance)>forestThreshold) discard;
            `);
        };
      }
      proxy.material = proxyMaterial;
    }
    const distant = new THREE.InstancedMesh(far, silhouette, trees.length);
    for (let i = 0; i < trees.length; i++) {
      setTree(distant, i, trees[i]);
      if (proxy) setTree(proxy, i, trees[i]);
    }
    finalize(distant);
    if (proxy) finalize(proxy);
    near.position.copy(center).negate();
    distant.position.copy(near.position);
    proxy?.position.copy(near.position);
    const radius = distant.boundingSphere.radius + distant.boundingSphere.center.distanceTo(center);
    const cell = new ForestCell('mapped', center, radius, near, distant, proxy);
    cell.range = range.value;
    cells.push(cell);
    group.add(cell);
  }

  function detailMeshes(level, max, shadeDistance) {
    const material = coniferMaterial(level);
    const compile = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey();
    material.onBeforeCompile = shader => {
      compile(shader);
      shader.uniforms.forestDetail = shadeDistance;
    };
    material.customProgramCacheKey = () => `${cacheKey}-cascade`;
    return species.map(kind => {
      const mesh = new THREE.InstancedMesh(coniferGeometry(kind, level), material, max);
      mesh.name = level < 0 ? `${kind} · boughs and bark` : `${kind} · needles and snow deposits`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, color);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      return mesh;
    });
  }
  const boughs = detailMeshes(-.5, 360, branchRange);
  const sprays = detailMeshes(1, 86, sprayRange);
  const twigs = detailMeshes(2, 24, twigRange);
  const details = [...boughs, ...sprays, ...twigs];
  const last = new THREE.Vector3(Infinity, Infinity, Infinity);
  const lastFacing = new THREE.Quaternion();
  const projection = new THREE.Matrix4(), frustum = new THREE.Frustum(), crown = new THREE.Sphere();
  let oldQuality = -1;
  function update(camera) {
    const eye = camera.position;
    if (last.distanceToSquared(eye) < 18 && lastFacing.angleTo(camera.quaternion) < .08 && quality === oldQuality) return;
    last.copy(eye);
    lastFacing.copy(camera.quaternion);
    oldQuality = quality;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const cell of cells) {
      const dist = cell.position.distanceTo(eye) - cell.radius;
      cell.visible = dist < farRange.value;
      const shadows = dist < 54 * quality;
      for (const mesh of cell.near.children) mesh.castShadow = shadows;
    }
    for (const mesh of details) mesh.count = 0;
    // The shader finishes shrinking each tier before the CPU stops submitting
    // it. Leave room for the camera to move between detail queries.
    const radius = forestDetailTiers[-.5][1] * branchRange.value + 6;
    const sprayRadius = forestDetailTiers[1][1] * sprayRange.value + 6;
    const twigRadius = forestDetailTiers[2][1] * twigRange.value + 6;
    for (const { tree } of env.queryColliders(eye.x, eye.z, radius)) {
      if (!tree) continue;
      const { x, y, z, height, kind } = tree;
      const d = Math.hypot(x - eye.x, z - eye.z, Math.max(0, y - eye.y, eye.y - y - height));
      if (d > radius) continue;
      crown.center.set(x, y + height * .5, z);
      crown.radius = height * .58 + 13;
      if (d > 47 && !frustum.intersectsSphere(crown)) continue;
      if (boughs[kind].count < boughs[kind].instanceMatrix.count) setTree(boughs[kind], boughs[kind].count++, tree);
      if (d < sprayRadius && sprays[kind].count < sprays[kind].instanceMatrix.count) setTree(sprays[kind], sprays[kind].count++, tree);
      if (d < twigRadius && twigs[kind].count < twigs[kind].instanceMatrix.count) setTree(twigs[kind], twigs[kind].count++, tree);
    }
    for (const mesh of details) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
      mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    }
  }
  return { group, count, update, setQuality };
}
