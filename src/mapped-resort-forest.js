import * as THREE from 'three';
import { coniferDepthMaterial, coniferGeometry, coniferMaterial } from './conifers.js';
import { batchMaxForestCrowns, forestDetailTiers, makeForestCrowns, preloadForestCrowns } from './forest-lod.js';
import { coniferInView, crownDistanceSquared, forestView, setConiferBounds } from './forest-culling.js';
import { makeForestUndergrowth } from './forest-undergrowth.js';
import { pointInPolygon, runStyle, segmentDistance } from './mapped-resort-ground.js';
import { stevensTraverseTrees, STEVENS_POWERLINE } from './stevens-pass-details.js';
import { hash2, smoothstep } from './util.js';
import { cacheStaticTransforms } from './scenery.js';

const PATCH = 210;
const TREE_SPACING = 12;
const FOREST_TILE = 240;
const species = ['fir', 'spruce', 'hemlock'];
const detailProfiles = {
  BUDGET: [67, 118, 3500, .64],
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
  for (const { points } of [...(config.buildings ?? []), ...(config.parking ?? []), ...(config.runAreas ?? []), ...(config.landmarkClearings ?? [])]) {
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

export async function buildMappedForest(scene, ground, config, env, initialQuality = 'BALANCED') {
  const group = new THREE.Group();
  group.name = 'Mapped woodland and ski clearings';
  scene.add(group);
  const { minX, minZ, maxX, maxZ } = ground.bounds;
  const cascadeHorizon = config.id === 'snoqualmie' && !!config.forest.survey;
  const beyond = cascadeHorizon ? 1800 : 0;
  // Keep the close spacing around ski terrain even on multi-valley maps.
  // Wide background stands use fewer sample points and larger draw batches.
  const footprint = (maxX - minX) * (maxZ - minZ);
  const stride = Math.max(1, Math.ceil(Math.sqrt(footprint / 100e6)));
  const fullDensity = stride > 1 ? resortForestTiles(config) : null;
  const patchSize = fullDensity ? PATCH * 2 : PATCH;
  const excluded = exclusionMap(config);
  const patches = new Map(), deciduousPatches = new Map();
  const standSample = [0, 0];
  const normal = new THREE.Vector3();
  const coniferCounts = [0, 0, 0];
  let count = 0;
  function plant(tree) {
    const { x, y, z, height } = tree;
    const id = `${Math.floor(x / patchSize)}:${Math.floor(z / patchSize)}`;
    const stands = tree.kind === 'deciduous' ? deciduousPatches : patches;
    if (tree.kind !== 'deciduous') coniferCounts[tree.kind]++;
    if (!stands.has(id)) stands.set(id, []);
    stands.get(id).push(tree);
    env.addCircle(x, z, .19 + height * .012, 'tree', { maxY: y + height, minY: y - .7, tree });
    count++;
  }
  if (config.id === 'stevens-pass') for (const [x, z, height] of stevensTraverseTrees()) {
    const y = ground.heightAt(x, z);
    if (!env.isOpen(x, y + .4, z, 2.6)) continue;
    plant({ x, y, z, height, kind: 2, yaw: hash2(x, z, 2131) * Math.PI * 2, spread: 1.06, tint: hash2(x, z, 311) });
  }
  function sample(ix, iz, regional = false) {
    const x = (ix + .12 + .76 * hash2(ix, iz, 747)) * TREE_SPACING;
    const z = (iz + .12 + .76 * hash2(ix, iz, 519)) * TREE_SPACING;
    if (regional ? x >= minX && x < maxX && z >= minZ && z < maxZ : x > maxX - 2 || z > maxZ - 2) return;
    const cover = ground.forestAt(x, z);
    const patchiness = .73 + .27 * Math.sin(x * .009 - z * .014 + Math.sin(z * .035) * .9) ** 2;
    const edge = Math.max(minX-x, x-maxX, minZ-z, z-maxZ);
    const fringe = regional ? 1 - smoothstep(beyond*.29, beyond, edge) : 1;
    if (hash2(ix, iz, 1291) > smoothstep(.10, .84, cover) * patchiness * fringe || excluded(x, z)) return;
    const y = ground.heightAt(x, z, normal, true);
    if (normal.y < .56) return;
    if (config.id === 'stevens-pass' && !env.isOpen(x, y + .4, z, 1.4)) return;
    if (regional) standSample[0] = standSample[1] = 0;
    else ground.sampleStand?.(x, z, standSample);
    const observed = standSample[0];
    const wind = observed >= 1 ? 1 - smoothstep(5, 19, observed) : smoothstep(1430, 1900, y);
    const age = hash2(ix, iz, 1923);
    const height = observed >= 1 ? Math.max(3, observed) * (.72 + .45 * age ** .68)
      : (14 + 29 * age ** .67) * (1 - .59 * wind);
    const variety = hash2(ix, iz, 2497);
    const kind = variety > .76 ? 1 : variety > .29 - wind * .14 ? 2 : 0;
    const yaw = hash2(ix, iz, 2131) * Math.PI * 2;
    const spread = .78 + .28 * hash2(ix, iz, 2789);
    const tint = hash2(ix, iz, 311);
    if (hash2(ix, iz, 7331) * 100 < standSample[1]) {
      plant({ x, y, z, height, kind: 'deciduous', rotation: yaw, width: spread });
    } else {
      plant({ x, y, z, height, kind, yaw, spread, tint });
    }
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

  if (cascadeHorizon) {
    const spacing = 3;
    for (let iz = Math.ceil((minZ-beyond)/TREE_SPACING); iz < (maxZ+beyond)/TREE_SPACING; iz += spacing) {
      for (let ix = Math.ceil((minX-beyond)/TREE_SPACING); ix < (maxX+beyond)/TREE_SPACING; ix += spacing) {
        if (ix >= minX/TREE_SPACING && ix+spacing < lastX && iz >= minZ/TREE_SPACING && iz+spacing < lastZ) continue;
        sample(ix + Math.floor(hash2(ix,iz,103)*spacing), iz + Math.floor(hash2(ix,iz,541)*spacing), true);
      }
    }
  }
  const range = { value: new THREE.Vector2() };
  const farRange = { value: 4400 };
  const branchRange = { value: 0 }, sprayRange = { value: 0 }, twigRange = { value: 0 };
  const crownAtlas = patches.size ? preloadForestCrowns() : null;
  const updateUndergrowth = count ? makeForestUndergrowth(group, {
    region: config.id,
    heightAt: ground.heightAt,
    treesAt: env.queryColliders,
    permits: (x, z) => x > minX + 1 && z > minZ + 1 && x < maxX - 1 && z < maxZ - 1
      && ground.forestAt(x, z) > .24 && !excluded(x, z),
  }) : null;
  let hardwoods = null;
  if (deciduousPatches.size) {
    const forest = await import('./deciduous-forest.js');
    await forest.preloadDeciduousCrowns();
    hardwoods = forest.buildDeciduousForest(group, deciduousPatches, config.id);
  }
  let quality = 1, qualityName;
  function setQuality(name) {
    qualityName = name;
    const [min, max, far, detail] = detailProfiles[name] ?? detailProfiles.BALANCED;
    range.value.set(min, max);
    farRange.value = cascadeHorizon ? Math.max(4750,far) : far;
    quality = detail;
    branchRange.value = .67 * quality;
    sprayRange.value = .53 * quality;
    twigRange.value = .49 * quality;
  }
  setQuality(initialQuality);
  if (!patches.size) {
    cacheStaticTransforms(group);
    return { group, count, setQuality, update(camera) {
      hardwoods?.update(camera, qualityName);
      updateUndergrowth?.(camera, qualityName);
    } };
  }
  await crownAtlas;
  const mapped = bindCascadeRange(coniferMaterial(-1, 'mapped'), range);
  const shadowMaterial = coniferDepthMaterial();
  let proxyMaterial = null;
  let silhouette = null, far = null;
  const stand = new THREE.Object3D(), color = new THREE.Color();
  function prepareTree(tree) {
    stand.position.set(tree.x, tree.y, tree.z);
    stand.scale.set(tree.height * tree.spread, tree.height, tree.height * tree.spread);
    stand.rotation.set(0, tree.yaw, 0);
    stand.updateMatrix();
    color.setRGB(.77 + .23 * tree.tint, .85 + .15 * tree.tint, .88 + .12 * tree.tint);
  }
  function setTree(mesh, i) {
    mesh.setMatrixAt(i, stand.matrix);
    mesh.setColorAt(i, color);
  }
  const finalize = (mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  };
  const farBatches = [];
  for (const trees of patches.values()) {
    const proxy = makeForestCrowns('mapped', trees.map(tree => tree.kind), cascadeHorizon);
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
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float cascadeDistance;')
            .replace('if (forestFade <= 0.) world = origin;', `
              float horizon = cascadeDistance - ${cascadeHorizon ? '1270.' : '490.'} * fract(sin(dot(origin.xz, vec2(.243,.671))) * 1927.2);
              if (forestFade <= 0. || crownDistance > horizon) world = origin;
            `);
        };
      }
      proxy.material = proxyMaterial;
    }
    if (!proxy && !far) {
      far = coniferGeometry('hemlock', -2);
      silhouette = bindCascadeRange(coniferMaterial(-2, 'mapped'), range);
    }
    const instances = proxy ?? new THREE.InstancedMesh(far, silhouette, trees.length);
    for (let i = 0; i < trees.length; i++) {
      prepareTree(trees[i]);
      setTree(instances, i);
    }
    finalize(instances);
    // Crown cards rotate toward the viewer, so leave room beyond their baked plane.
    instances.boundingSphere.radius += 16;
    farBatches.push({ mesh: instances, proxy: !!proxy, inRange: false });
    group.add(instances);
  }
  batchMaxForestCrowns(group, farBatches.filter(batch => batch.proxy), () => qualityName === 'MAX');

  function dynamicMesh(geometry, material, capacity) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, color);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    return mesh;
  }

  const maxRadius = detailProfiles.MAX[1] + 8;
  const latticeCapacity = (Math.ceil(maxRadius * 2 / TREE_SPACING) + 2) ** 2;
  const traverseTreeCount = config.id === 'stevens-pass' ? stevensTraverseTrees().length : 0;
  const crowns = species.map((kind, i) => {
    const capacity = Math.min(coniferCounts[i], latticeCapacity + traverseTreeCount);
    if (!capacity) return null;
    const mesh = dynamicMesh(coniferGeometry(kind, -1), mapped, capacity);
    mesh.name = kind + ' crowns';
    mesh.customDepthMaterial = shadowMaterial;
    mesh.castShadow = true;
    return mesh;
  });

  function detailMeshes(level, max, shadeDistance) {
    const material = coniferMaterial(level);
    const compile = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey();
    material.onBeforeCompile = shader => {
      compile(shader);
      shader.uniforms.forestDetail = shadeDistance;
    };
    material.customProgramCacheKey = () => `${cacheKey}-cascade`;
    return species.map((kind, i) => {
      if (!coniferCounts[i]) return null;
      const mesh = dynamicMesh(coniferGeometry(kind, level), material, Math.min(coniferCounts[i], max));
      mesh.name = level < 0 ? `${kind} · boughs and bark` : `${kind} · needles and snow deposits`;
      return mesh;
    });
  }
  const boughs = detailMeshes(-.5, 360, branchRange);
  const sprays = detailMeshes(1, 86, sprayRange);
  const twigs = detailMeshes(2, 24, twigRange);
  const details = [...crowns, ...boughs, ...sprays, ...twigs].filter(Boolean);
  const last = new THREE.Vector3(Infinity, Infinity, Infinity);
  const lastFacing = new THREE.Quaternion();
  const lastProjection = new THREE.Matrix4();
  const crown = new THREE.Sphere(), treeFootprint = new Float64Array(6);
  const boughSlots = new Uint16Array(3), spraySlots = new Uint16Array(3), twigSlots = new Uint16Array(3);
  let oldQuality = -1;
  function addDetail(mesh, slots, kind, maxDistance, view, distanceSquared) {
    if (slots[kind] >= mesh.instanceMatrix.count) return;
    slots[kind]++;
    if (distanceSquared > (maxDistance + 4.33) ** 2) return;
    setConiferBounds(treeFootprint, 0, mesh.geometry, stand.matrix.elements);
    const { eye } = view;
    const reach = Math.hypot(treeFootprint[0] - eye.x, treeFootprint[1] - eye.y, treeFootprint[2] - eye.z)
      + treeFootprint[3] + treeFootprint[4] + treeFootprint[5];
    // The cache also covers a 4.24 m move and a .08 radian view rotation.
    if (coniferInView(view, treeFootprint, 0, 4.33 + .081 * reach)) setTree(mesh, mesh.count++);
  }
  function update(camera) {
    hardwoods?.update(camera, qualityName);
    updateUndergrowth?.(camera, qualityName);
    const eye = camera.position;
    if (last.distanceToSquared(eye) < 18 && lastFacing.angleTo(camera.quaternion) < .08
      && quality === oldQuality && lastProjection.equals(camera.projectionMatrix)) return;
    lastProjection.copy(camera.projectionMatrix);
    last.copy(eye);
    lastFacing.copy(camera.quaternion);
    oldQuality = quality;
    camera.updateMatrixWorld();
    const view = forestView(camera);
    for (const batch of farBatches) {
      const { mesh } = batch;
      const { center, radius } = mesh.boundingSphere;
      const distance = center.distanceTo(eye);
      batch.inRange = distance - radius < farRange.value && distance + radius > range.value.x;
      mesh.visible = batch.inRange && (qualityName !== 'MAX' || !batch.proxy);
    }
    for (const mesh of details) mesh.count = 0;
    boughSlots.fill(0);
    spraySlots.fill(0);
    twigSlots.fill(0);
    // The shader finishes shrinking each tier before the CPU stops submitting
    // it. Leave room for the camera to move between detail queries.
    const radius = forestDetailTiers[-.5][1] * branchRange.value + 6;
    const sprayRadius = forestDetailTiers[1][1] * sprayRange.value + 6;
    const twigRadius = forestDetailTiers[2][1] * twigRange.value + 6;
    const crownRadius = range.value.y + 8;
    for (const { tree } of env.queryColliders(eye.x, eye.z, crownRadius)) {
      if (!tree || tree.kind === 'deciduous') continue;
      const { x, y, z, height, kind } = tree;
      const d = Math.hypot(x - eye.x, z - eye.z, Math.max(0, y - eye.y, eye.y - y - height));
      if (d > crownRadius) continue;
      crown.center.set(x, y + height * .5, z);
      crown.radius = height * .58 + 13 + d * .088;
      const inView = d < 47 || view.frustum.intersectsSphere(crown);
      // Off-camera crowns close to the skier still contribute to the sun shadow.
      if (inView || d < 112) {
        prepareTree(tree);
        setTree(crowns[kind], crowns[kind].count++);
      }
      if (!inView || d > radius) continue;
      const heightFromRoot = stand.position.y;
      const distanceSquared = crownDistanceSquared(eye, x, heightFromRoot, z, heightFromRoot + height);
      addDetail(boughs[kind], boughSlots, kind, radius - 6, view, distanceSquared);
      if (d < sprayRadius) addDetail(sprays[kind], spraySlots, kind, sprayRadius - 6, view, distanceSquared);
      if (d < twigRadius) addDetail(twigs[kind], twigSlots, kind, twigRadius - 6, view, distanceSquared);
    }
    for (const mesh of details) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
      mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    }
  }
  cacheStaticTransforms(group);
  return { group, count, update, setQuality };
}
