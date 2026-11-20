import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { getNeedleAtlas } from './conifers.js';
import { forestView } from './forest-culling.js';
import { hash2, mulberry32 } from './util.js';

const tau = Math.PI * 2;
const profiles = {
  BUDGET: [54, 31, .68], LOW: [68, 42, .80], BALANCED: [86, 55, .9], HIGH: [110, 69, 1], MAX: [136, 87, 1],
};
const movementAllowance = 4;
const turnAllowance = .075;
const speedAllowance = .10;
const detailFadeEnd = 2;
const coverStart = .68, coverEnd = .95;
const canopyCell = 13;

function makePlants(kind) {
  const rand = mulberry32(9481 + kind.length * 1733);
  const needled = kind === 'sapling';
  const solid = [.971, .004];
  const parts = Array.from({ length: 2 }, () => ({ positions: [], colors: [], snowWeights: [], uv: [] }));
  const wood = new THREE.Color(kind === 'brush' ? 0x6c5140 : 0x524135);
  const leaf = new THREE.Color(kind === 'sasa' ? 0x667650 : kind === 'sapling' ? 0x354e43 : 0x435a38);
  const deadLeaf = new THREE.Color(0x8c7958);
  function triangle(a, b, c, color, snow, detail = false, u = solid, v = solid, w = solid) {
    const { positions, colors, snowWeights, uv } = parts[Number(detail)];
    positions.push(...a, ...b, ...c);
    if (needled) uv.push(...u, ...v, ...w);
    for (let j = 0; j < 3; j++) {
      colors.push(color.r, color.g, color.b);
      snowWeights.push(snow);
    }
  }
  function stem(a, b, radius, tip, color = wood, detail = false, sides = 4) {
    const axis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const across = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < .95
      ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const around = new THREE.Vector3().crossVectors(axis, across);
    const rings = [a, b].map((p, ring) => Array.from({ length: sides }, (_, i) => {
      const angle = i * tau / sides, size = ring ? tip : radius;
      return p.map((v, j) => v + (across.getComponent(j) * Math.cos(angle) + around.getComponent(j) * Math.sin(angle)) * size);
    }));
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      triangle(rings[0][i], rings[0][j], rings[1][i], color, .04, detail);
      triangle(rings[1][i], rings[0][j], rings[1][j], color, .04, detail);
    }
  }
  function spray(attach, angle, length, width, droop, tone, coat, detail = false) {
    const x = Math.sin(angle), z = Math.cos(angle);
    const crest = [attach[0] + x * length * .55, attach[1] + width * .7, attach[2] + z * length * .55];
    const a = [crest[0] + z * width, crest[1] - width * .68, crest[2] - x * width];
    const b = [crest[0] - z * width, crest[1] - width * .61, crest[2] + x * width];
    const end = [attach[0] + x * length, attach[1] - droop, attach[2] + z * length];
    triangle(attach, crest, a, tone, coat * .76, detail);
    triangle(a, crest, end, tone, coat, detail);
    triangle(attach, b, crest, tone, coat * .87, detail);
    triangle(b, end, crest, tone, coat, detail);
    return end;
  }
  function needleFan(a, b, width, roll, detail = false) {
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    const rightX = dz / length, rightZ = -dx / length;
    const tile = Math.floor(rand() * 4);
    const tone = new THREE.Color(0xc6d1be).multiplyScalar(.80 + rand() * .35);
    const coat = rand() < .38 ? .54 + rand() * .29 : .08 + rand() * .29;
    const point = (t, side) => {
      const reach = width * side * (1.02 - .42 * t);
      return [a[0] + dx * t + reach * rightX, a[1] + (b[1] - a[1]) * t + reach * roll
        + length * .09 * Math.sin(t * Math.PI), a[2] + dz * t + reach * rightZ];
    };
    const uv = (t, side) => [(tile % 2 + .5 + .43 * side) * .5, (Math.floor(tile / 2) + .94 - .87 * t) * .5];
    const corners = [[0, -1], [1, -1], [1, 1], [0, 1]];
    const center = point(.53, 0);
    for (let i = 0; i < corners.length; i++) {
      const from = corners[i], to = corners[(i + 1) % corners.length];
      triangle(center, point(...from), point(...to), tone, coat, detail, uv(.53, 0), uv(...from), uv(...to));
    }
  }

  if (kind === 'stump') {
    const bark = new THREE.Color(0x564133), heart = new THREE.Color(0xb58b58);
    const twist = rand() * tau, cuts = Array.from({ length: 12 }, () => rand());
    const rings = Array.from({ length: 6 }, (_, ring) => cuts.map((cut, i) => {
      const angle = i / cuts.length * tau;
      const root = .28 + .094 * Math.cos(angle * 5 + twist);
      const bole = .23 + .023 * Math.sin(angle * 7 + twist);
      const brokenTop = .56 + .16 * cut ** 2.7 + .1 * Math.sin(angle + twist);
      const radii = [root * 1.35, root, bole, bole * .92, bole * .63, .001];
      const heights = [-.22, .12, brokenTop, brokenTop - .048, .54 + .15 * cut ** 3, .587];
      return [Math.cos(angle) * radii[ring], heights[ring], Math.sin(angle) * radii[ring]];
    }));
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const upper = ring >= 3;
      for (let i = 0; i < cuts.length; i++) {
        const j = (i + 1) % cuts.length;
        const color = (upper ? heart : bark).clone().multiplyScalar(.66 + cuts[i] * .35 + (ring % 2) * .10);
        const coat = upper ? .58 + cuts[i] * .41 : .023;
        const a = rings[ring][i], b = rings[ring][j], c = rings[ring+1][i], d = rings[ring+1][j];
        triangle(a, c, b, color, coat);
        triangle(b, c, d, color, coat);
      }
    }
    stem([.02, .18, -.18], [.16, .27, -.37], .057, .026);
  } else if (kind === 'sapling') {
    const leader = [[0, -.28, 0], [.009, .71, -.055], [.075, 1.43, -.065], [.041, 2.17, .038]];
    const barkWidth = [.042, .027, .014, .002];
    const mix = (a, b, t) => a.map((value, i) => THREE.MathUtils.lerp(value, b[i], t));
    for (let i = 1; i < leader.length; i++) stem(leader[i-1], leader[i], barkWidth[i-1], barkWidth[i], wood, false, 5);
    for (let tier = 0; tier < 6; tier++) {
      const lift = .38 + tier * .27;
      const reach = .83 - tier * .118;
      const arms = tier > 2 ? 3 : 4;
      for (let arm = 0; arm < arms; arm++) {
        const bearing = arm * tau / arms + tier * 1.29 + rand() * .74;
        const length = reach * (.60 + rand() * .56);
        const y = lift + (rand() - .4) * .14;
        const segment = y < .71 ? 0 : y < 1.43 ? 1 : 2;
        const base = mix(leader[segment], leader[segment+1], (y - leader[segment][1]) / (leader[segment+1][1] - leader[segment][1]));
        const end = [base[0] + Math.sin(bearing) * length, y + (.12 + rand() * .23 - .38) * length,
          base[2] + Math.cos(bearing) * length];
        stem(base, end, reach * .017, .0016, wood, false, 3);
        needleFan(mix(base, end, .21 + rand() * .14), end, length * (.16 + rand() * .055), rand() * .86 - .43);
        for (let twig = 0; twig < 3; twig++) {
          const attach = mix(base, end, .28 + twig * .19 + rand() * .11);
          const side = (arm + twig) % 2 ? 1 : -1;
          const angle = bearing + side * (.57 + rand() * .50);
          const span = length * (.57 - twig * .077) * (.69 + rand() * .53);
          const tip = [attach[0] + Math.sin(angle) * span, attach[1] + span * (.07 + rand() * .26), attach[2] + Math.cos(angle) * span];
          const detail = twig > 0;
          stem(attach, tip, span * .021, .0012, wood, detail, 3);
          needleFan(attach, tip, span * (.16 + rand() * .065), side * (.13 + rand() * .34), detail);
        }
      }
    }
    needleFan(mix(leader[2], leader[3], .51), [leader[3][0] + .027, leader[3][1] + .026, leader[3][2] + .017], .06, .82);
  } else if (kind === 'brush') {
    for (let branch = 0; branch < 5; branch++) {
      const angle = branch * 2.39996, x = Math.sin(angle), z = Math.cos(angle);
      const h = .52 + rand() * .64, wide = .25 + rand() * .33;
      const knee = [x * wide * .46, h * .57, z * wide * .43];
      const end = [x * wide, h, z * wide];
      stem([0, -.26, 0], knee, .020 + rand() * .008, .011);
      stem(knee, end, .011, .002, wood, false, 3);
      for (let twig = 0; twig < 4; twig++) {
        const t = .19 + twig * .18, side = twig % 2 ? 1 : -1;
        const start = knee.map((value, i) => THREE.MathUtils.lerp(value, end[i], t));
        const tip = [start[0] + x * .08 + z * side * .14, start[1] + .14 + rand() * .14, start[2] + z * .08 - x * side * .14];
        stem(start, tip, .005, .001, wood, true, 3);
      }
    }
  } else {
    const bamboo = kind === 'sasa';
    for (let branch = 0; branch < (bamboo ? 9 : 8); branch++) {
      const angle = branch * 2.39996 + rand() * .85, dx = Math.sin(angle), dz = Math.cos(angle);
      const length = .35 + rand() * (bamboo ? .55 : .67);
      const elbow = [dx * length * .48, .37 + .32 * rand(), dz * length * .48];
      const tip = [dx * length, elbow[1] * (.68 + rand() * .33), dz * length];
      stem([0, -.24, 0], elbow, .014, .007, wood, false, 3);
      stem(elbow, tip, .007, .0018, wood, false, 3);
      for (let n = 0; n < 5; n++) {
        const t = .12 + .16 * n, side = n % 2 ? 1 : -1;
        const point = elbow.map((v, i) => THREE.MathUtils.lerp(v, tip[i], t));
        const blade = (bamboo ? .25 : .18) + rand() * .16;
        const tone = leaf.clone().lerp(deadLeaf, rand() ** 5 * .80).multiplyScalar(.78 + rand() * .42);
        spray(point, angle + side * (.54 + rand() * .75), blade, blade * (bamboo ? .15 : .26),
          blade * .24, tone, .33 + .66 * rand(), n > 1);
      }
    }
  }
  return parts.map(({ positions, colors, snowWeights, uv }) => {
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('snowWeight', new THREE.Float32BufferAttribute(snowWeights, 1));
    if (needled) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  });
}

function plantMaterial(range, detailRange, motion, detail, needled) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93, side: THREE.DoubleSide });
  if (needled) {
    material.map = getNeedleAtlas();
    material.alphaTest = .12;
    material.alphaToCoverage = true;
  }
  material.forceSinglePass = true;
  material.customProgramCacheKey = () => `understory-${detail ? 'tips' : 'form'}-${needled ? 'needled' : 'solid'}`;
  material.onBeforeCompile = shader => {
    shader.uniforms.lowPlantsSnow = climateUniforms.snowpack;
    shader.uniforms.lowPlantsLine = climateUniforms.snowline;
    shader.uniforms.lowPlantsRange = range;
    shader.uniforms.detailRange = detailRange;
    shader.uniforms.motion = motion;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float snowWeight;
      uniform float lowPlantsSnow;
      uniform float lowPlantsLine;
      varying float plantCoat;
      varying vec3 plantPoint;
      varying float trimFade;
      ${detail ? 'attribute vec3 shelter; uniform float detailRange; uniform float motion;' : ''}
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      plantPoint = (modelMatrix * instanceMatrix * vec4(position,1.)).xyz;
      float snowSeason = lowPlantsSnow * smoothstep(lowPlantsLine-260.,lowPlantsLine+230.,plantPoint.y);
      plantCoat = snowSeason * snowWeight;
      trimFade = 0.;
      ${detail ? `
        vec2 root = (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xz;
        vec2 eyeOffset = cameraPosition.xz - root;
        float cover = shelter.z * smoothstep(${coverStart}, ${coverEnd}, dot(shelter.xy, normalize(eyeOffset + vec2(.00001, 0.))));
        float reach = detailRange * (1. - .58 * cover * motion);
        trimFade = smoothstep(reach - 8., reach + ${detailFadeEnd}., length(eyeOffset));
      ` : ''}
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float lowPlantsRange;
      varying float plantCoat;
      varying vec3 plantPoint;
      varying float trimFade;
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float drift = .64 + .36 * sin(plantPoint.x*10. + cos(plantPoint.z*12.))*sin(plantPoint.y*9.-plantPoint.z*7.);
      float snow = smoothstep(.18,.72,plantCoat*drift);
      ${needled ? 'snow *= (gl_FrontFacing ? .88 : .16) * smoothstep(.48,.85,drift);' : ''}
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.59,.70,.77), snow);
      float transition = smoothstep(lowPlantsRange-12., lowPlantsRange+1., length(cameraPosition.xz-plantPoint.xz));
      float noise = fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
      if (max(transition, trimFade) > noise) discard;
    `);
  };
  return material;
}

export function makeForestUndergrowth(group, { region, heightAt, treesAt, permits, forestFloor = permits }) {
  const range = { value: 0 }, detailRange = { value: 0 }, motion = { value: 0 };
  const kinds = [region === 'niseko-united' ? 'sasa' : 'shrub', 'stump', 'sapling', 'brush'];
  const labels = ['leafy shrubs', 'fractured stumps', 'evergreen seedlings', 'woody brush'];
  const materials = [false, true].map(needled =>
    [false, true].map(detail => plantMaterial(range, detailRange, motion, detail, needled)));
  const batches = kinds.map((kind, family) => makePlants(kind).map((template, detail) => template && ({
    name: `Forest understory · ${kind === 'sasa' ? 'sasa bamboo' : labels[family]} · ${detail ? 'twigs' : 'form'}`,
    template, detail, material: materials[Number(kind === 'sapling')][detail], mesh: null, previous: [], layout: [],
  })));
  const sitesByTree = new WeakMap();
  const pose = new THREE.Object3D(), sphere = new THREE.Sphere();
  const last = new THREE.Vector3(Infinity, Infinity, Infinity);
  const facing = new THREE.Quaternion(), projection = new THREE.Matrix4();
  let currentQuality, lastMotion = -Infinity;

  function plantSites(tree, lookup) {
    if (sitesByTree.has(tree)) return sitesByTree.get(tree);
    const sites = [];
    sitesByTree.set(tree, sites);
    const height = tree.apex ?? tree.height ?? 0;
    const choice = hash2(tree.x, tree.z, 12337);
    if (height < 8 || choice > .79) return sites;
    const bearing = hash2(tree.x, tree.z, 7223) * tau;
    for (let i = 0; i < (choice < .46 ? 3 : 2); i++) {
      const offset = (i === 0 ? 2.3 : 3.6) + 5.2 * hash2(tree.x, tree.z, 721 + i * 193);
      const angle = bearing + i * 2.39996;
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const x = tree.x + dx * offset, z = tree.z + dz * offset;
      if (!permits(x, z)) continue;
      const y = heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const nearby = lookup(x, z);
      if (nearby < 0) continue;
      const edge = !forestFloor(x + 6, z) || !forestFloor(x - 6, z)
        || !forestFloor(x, z + 6) || !forestFloor(x, z - 6);
      const interior = edge ? 0 : .45 + .55 * THREE.MathUtils.smoothstep(nearby, 1, 4);
      const roll = hash2(x, z, 3149);
      const family = i === 0 && choice < .08 ? 1 : i === 0 ? 0 : roll < .51 ? 2 : roll < .80 ? 3 : 0;
      const scale = (family === 2 ? .68 : .58) + hash2(x, z, 6211) * .75;
      const vertical = scale * (.79 + hash2(x, z, 311) * .56);
      pose.position.set(x, y - .075, z);
      pose.rotation.y = angle + hash2(x, z, 91) * tau;
      pose.scale.set(scale, vertical, scale);
      pose.updateMatrix();
      const [form, trim] = batches[family];
      const size = form.template.boundingSphere;
      const trimSize = trim?.template.boundingSphere;
      const extra = trimSize ? size.center.distanceTo(trimSize.center) + trimSize.radius : 0;
      const bound = Math.max(size.radius, extra) * Math.max(scale, vertical)
        + Math.hypot(size.center.x, size.center.z) * scale + .12;
      sites.push({ x, y, z, family, interior, shelterX: -dx, shelterZ: -dz, bound,
        height: size.center.y * vertical, keep: edge || i === 0 ? 0 : hash2(x, z, 853), matrix: pose.matrix.clone() });
    }
    return sites;
  }

  function submit(batch) {
    const { layout, previous, detail } = batch;
    if (!layout.length) {
      if (batch.mesh) batch.mesh.visible = false;
      return;
    }
    if (!batch.mesh || layout.length > batch.mesh.instanceMatrix.count) {
      if (batch.mesh) {
        group.remove(batch.mesh);
        batch.mesh.geometry.dispose();
        batch.mesh.dispose();
      }
      const capacity = 2 ** Math.ceil(Math.log2(Math.max(16, layout.length)));
      const geometry = batch.template.clone();
      if (detail) geometry.setAttribute('shelter', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
        .setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.InstancedMesh(geometry, batch.material, capacity);
      mesh.name = batch.name;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      batch.mesh = mesh;
      previous.length = 0;
    }
    const mesh = batch.mesh;
    mesh.visible = true;
    mesh.count = layout.length;
    let start = Infinity, end = -1;
    const shelter = mesh.geometry.attributes.shelter;
    for (let i = 0; i < layout.length; i++) {
      const site = layout[i];
      if (previous[i] === site) continue;
      previous[i] = site;
      start = Math.min(start, i);
      end = i;
      mesh.setMatrixAt(i, site.matrix);
      shelter?.setXYZ(i, site.shelterX, site.shelterZ, site.interior);
    }
    if (end < start) return;
    for (const attribute of [mesh.instanceMatrix, shelter].filter(Boolean)) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(start * attribute.itemSize, (end - start + 1) * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  return (camera, quality, speed = 0, dt = 0) => {
    const target = THREE.MathUtils.smoothstep(Math.abs(speed), 8, 23);
    motion.value = THREE.MathUtils.damp(motion.value, target, 4.8, Math.max(0, Math.min(.12, dt)));
    if (Math.abs(motion.value - target) < .004) motion.value = target;
    camera.updateWorldMatrix(true, false);
    const view = forestView(camera), eye = view.eye;
    if (currentQuality === quality && last.distanceToSquared(eye) < movementAllowance ** 2
      && facing.angleTo(camera.quaternion) < turnAllowance && projection.equals(camera.projectionMatrix)
      && Math.abs(lastMotion - motion.value) < speedAllowance) return;
    currentQuality = quality;
    last.copy(eye);
    facing.copy(camera.quaternion);
    projection.copy(camera.projectionMatrix);
    lastMotion = motion.value;
    const [radius, detail, density] = profiles[quality] ?? profiles.HIGH;
    range.value = radius;
    detailRange.value = detail;
    for (const family of batches) for (const batch of family) if (batch) batch.layout.length = 0;
    // Read the existing spatial index once. Only revisit terrain and build
    // the small canopy grid when the view reaches genuinely new sites.
    const parents = treesAt(eye.x, eye.z, radius + 43);
    let canopy;
    function nearbyCanopy(x, z) {
      if (!canopy) {
        canopy = new Map();
        for (const { tree } of parents) {
          if (!tree) continue;
          const key = Math.floor(tree.x / canopyCell) + ':' + Math.floor(tree.z / canopyCell);
          if (!canopy.has(key)) canopy.set(key, []);
          canopy.get(key).push(tree);
        }
      }
      const ix = Math.floor(x / canopyCell), iz = Math.floor(z / canopyCell);
      let count = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const neighbors = canopy.get((ix + dx) + ':' + (iz + dz));
        if (!neighbors) continue;
        for (const tree of neighbors) {
          const d = (tree.x - x) ** 2 + (tree.z - z) ** 2;
          if (d < 1.21) return -1;
          if (d < canopyCell ** 2 && (tree.apex ?? tree.height ?? 0) >= 9) count++;
        }
      }
      return count;
    }
    for (const { tree } of parents) {
      if (!tree || (eye.x - tree.x) ** 2 + (eye.z - tree.z) ** 2 > (radius + 22) ** 2) continue;
      for (const site of plantSites(tree, nearbyCanopy)) {
        if (site.keep > density) continue;
        const dx = eye.x - site.x, dz = eye.z - site.z;
        const distance = Math.hypot(dx, dz);
        if (distance > radius + movementAllowance + site.bound + 1) continue;
        sphere.center.set(site.x, site.y + site.height, site.z);
        const distance3D = sphere.center.distanceTo(eye);
        // Keep a buffer for view lag and tree motion so the visible edges do
        // not lose coverage when the cached query moves or turns.
        sphere.radius = site.bound + movementAllowance + turnAllowance * (distance3D + site.bound);
        if (!view.frustum.intersectsSphere(sphere)) continue;
        const [form, trim] = batches[site.family];
        form.layout.push(site);
        if (!trim) continue;
        // The base foliage remains. Only thin twig detail behind interior
        // cover can fade earlier at speed. Bound the fade conservatively
        // across the full cache interval, including a reversal in speed.
        const alignment = (site.shelterX * dx + site.shelterZ * dz) / Math.max(.001, distance);
        const sin = Math.min(1, movementAllowance / Math.max(.001, distance));
        const cos = Math.sqrt(1 - sin * sin);
        const leastAligned = sin === 1 || alignment <= -cos ? -1 :
          alignment * cos - Math.sqrt(Math.max(0, 1 - alignment * alignment)) * sin;
        const cover = site.interior * THREE.MathUtils.smoothstep(leastAligned, coverStart, coverEnd);
        const minimumMotion = Math.max(0, motion.value - speedAllowance);
        const fullFade = detail * (1 - .58 * cover * minimumMotion) + detailFadeEnd;
        if (distance <= fullFade + movementAllowance) trim.layout.push(site);
      }
    }
    for (const family of batches) for (const batch of family) if (batch) submit(batch);
  };
}
