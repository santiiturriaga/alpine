import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { compactCrownBatch, forestView } from './forest-culling.js';
import { bindTreeSnow } from './tree-snow.js';

const profiles = {
  BUDGET: { mapped: [90, 205], regional: [145, 320], detail: .46 },
  MAX: { mapped: [740, 980], regional: [1040, 1380], detail: 1.18 },
  HIGH: { mapped: [315, 535], regional: [405, 635], detail: 1 },
  BALANCED: { mapped: [250, 445], regional: [335, 540], detail: .83 },
  LOW: { mapped: [175, 355], regional: [260, 465], detail: .67 },
};

const transitions = {
  mapped: { value: new THREE.Vector2() },
  regional: { value: new THREE.Vector2() },
};
let budget = false, maxCrowns = false;
export const forestQuality = { detail: { value: 1 }, name: 'HIGH' };
export const forestDetailTiers = {
  '-0.5': [105, 165],
  1: [44, 79],
  2: [15, 35],
};

export function setForestQuality(name) {
  const profile = profiles[name] || profiles.HIGH;
  budget = name === 'BUDGET';
  maxCrowns = name === 'MAX';
  forestQuality.name = name;
  forestQuality.detail.value = profile.detail;
  transitions.mapped.value.fromArray(profile.mapped);
  transitions.regional.value.fromArray(profile.regional);
}
setForestQuality('HIGH');

const declarations = `
  varying float forestFade;
  uniform vec2 forestRange;
  float crownFade(float distanceFromEye, vec2 root) {
    // Each tree changes tiers over part of the total band. The threshold
    // varies with its fixed root and is shared by both representations.
    float stagger = fract(sin(dot(root, vec2(.1271, .2293))) * 3375.73);
    float band = forestRange.y - forestRange.x;
    float start = mix(forestRange.x, forestRange.y, .86 * stagger);
    return smoothstep(start, start + .14 * band, distanceFromEye);
  }
`;
const coverage = `
  // Complementary coverage keeps the same tree rooted through the transition.
  float forestThreshold = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy),
    vec2(.06711056, .00583715))));
`;

export function attachForestFade(shader, region, near) {
  shader.uniforms.forestRange = transitions[region];
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>${declarations}`)
    .replace('#include <project_vertex>', `
      forestFade = crownFade(crownDistance, forestOrigin.xz);
      if (${near ? 'forestFade >= 1.0' : 'forestFade <= 0.0'}) transformed = vec3(0.);
      #include <project_vertex>
    `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float forestFade;')
    .replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      ${coverage}
      if (${near ? 'forestFade > 0.0 && forestFade > forestThreshold' : 'forestFade < 1.0 && forestFade <= forestThreshold'}) discard;
    `);
}

let atlasPromise, atlas, winterAtlas, proxyMaterials = new Map();

export function preloadForestCrowns() {
  const load = name => new THREE.TextureLoader().loadAsync(new URL(`../assets/forest/${name}?v=3`, import.meta.url).href)
    .then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return texture;
    });
  atlasPromise ||= Promise.all([load('crowns.png'), load('crowns-snow.png').catch(() => null)])
    .then(([dry, snow]) => { atlas = dry; winterAtlas = snow ?? dry; }).catch(() => undefined);
  return atlasPromise;
}

function crownMaterial(region, cascade) {
  const profile = cascade ? `${region}-cascades` : region;
  if (proxyMaterials.has(profile)) return proxyMaterials.get(profile);
  const material = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: .09, alphaToCoverage: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.forestRange = transitions[region];
    shader.uniforms.snowline = climateUniforms.snowline;
    shader.uniforms.snowpack = climateUniforms.snowpack;
    shader.uniforms.night = climateUniforms.night;
    shader.uniforms.winterCrownAtlas = { value: winterAtlas };
    bindTreeSnow(shader);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float crownSpecies;
      uniform float snowline;
      uniform float snowpack;
      varying float crownDirection;
      varying float crownRow;
      varying float crownSnow;
      varying float crownDistance;
      ${declarations}
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 origin = (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xyz;
      float height = length(instanceMatrix[1].xyz);
      vec2 horizontal = cameraPosition.xz - origin.xz;
      vec2 eyeDirection = normalize(horizontal + vec2(.00001, 0.));
      vec3 right = vec3(eyeDirection.y, 0., -eyeDirection.x);
      crownDirection = floor(fract(origin.x*.037 + origin.z*.021)*4.);
      crownRow = crownSpecies;
      float rise = max(0., max(origin.y-cameraPosition.y, cameraPosition.y-origin.y-height));
      crownDistance = length(vec3(horizontal,rise));
      forestFade = crownFade(crownDistance, origin.xz);
      float distantCrown = smoothstep(700.,2450.,crownDistance);
      float snow = smoothstep(snowline-180.,snowline+410.,origin.y) * snowpack;
      crownSnow = snow * attachedTreeSnow(origin.xz)
        * mix(.68,1.,${region === 'regional' ? 'smoothstep(1110.,1580.,origin.y)' : 'smoothstep(1370.,1820.,origin.y)'});
      float rootedY = position.y * height - (1. - smoothstep(-.063,.014,position.y)) * 1.55;
      vec3 world = origin + right * position.x * length(instanceMatrix[0].xyz) * (1. + .10*distantCrown)
        + vec3(0.,rootedY,0.);
      if (forestFade <= 0.) world = origin;
    `).replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(world,1.); gl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(world,1.);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float night;
      uniform sampler2D winterCrownAtlas;
      varying float crownDirection;
      varying float crownRow;
      varying float crownSnow;
      varying float crownDistance;
      varying float forestFade;
    `).replace('#include <map_fragment>', `
      // The baked frames leave sixteen transparent pixels around each crown.
      // Preserve the old placement while keeping mips away from adjacent roots.
      vec2 frameUV = (vMapUv * vec2(192.,256.) + vec2(16.)) / vec2(224.,288.);
      frameUV = (frameUV + vec2(crownDirection,5.0-crownRow)) * vec2(.25,1./6.);
      float bias = ${cascade ? 'mix(-.28,.56,smoothstep(1050.,3700.,crownDistance))' : '-.28'};
      vec4 dryCrown = texture2D(map,frameUV,bias);
      vec4 snowCrown = texture2D(winterCrownAtlas,frameUV,bias);
      float alpha = mix(dryCrown.a,snowCrown.a,crownSnow);
      vec3 crown = mix(dryCrown.rgb*dryCrown.a,snowCrown.rgb*snowCrown.a,crownSnow) / max(alpha,.001);
      crown *= mix(vec3(.78,.85,.92),vec3(.90,.95,1.0),smoothstep(700.,2450.,crownDistance));
      float opacity = smoothstep(.038, .49, alpha);
      diffuseColor *= vec4(crown * mix(vec3(1.),vec3(.18,.25,.36),night),opacity);
    `).replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      ${coverage}
      if (forestFade < 1.0 && forestFade <= forestThreshold) discard;
    `).replace('#include <opaque_fragment>', '#undef OPAQUE\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => `forest-crown-atlas-${profile}-v5`;
  proxyMaterials.set(profile,material);
  return material;
}

const card = new THREE.BufferGeometry();
// Trim the empty space between the crown and the atlas edges; on a dense
// skyline several hundred cards may overlap behind the same pixels.
const outline = [[0,.13],[.10,.37],[.25,.32],[.49,.26],[.70,.18],[.87,.105],[1,.055]];
const positions = [], uv = [], indices = [];
for (const [v,halfWidth] of outline) for (const side of [-1,1]) {
  const x = halfWidth*side;
  positions.push(x,v*1.125-.0625,0);
  uv.push(x/.84375+.5,v);
}
for (let i=0;i<outline.length-1;i++) {
  const a=i*2,b=a+1,c=a+2,d=a+3;
  indices.push(a,b,c,b,d,c);
}
card.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
card.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
card.setIndex(indices);

export function makeForestCrowns(region, species, cascade = false) {
  if (!atlas) return null;
  const geometry = card.clone();
  geometry.setAttribute('crownSpecies',new THREE.InstancedBufferAttribute(Float32Array.from(species),1));
  const mesh = new THREE.InstancedMesh(geometry,crownMaterial(region,cascade),species.length);
  mesh.name = 'Baked conifer crowns';
  return mesh;
}

export function batchMaxForestCrowns(group, entries, enabled = () => maxCrowns) {
  if (!entries.length) return;
  const phase = new THREE.LOD();
  phase.name = 'Visible far conifer crowns';
  group.add(phase);
  const capacity = entries.reduce((sum, { mesh }) => sum + mesh.count, 0);
  const candidates = [], center = new THREE.Vector3();
  let batch, previousView, revision, layout = 0;

  function resize(count) {
    if (batch) {
      phase.remove(batch);
      batch.dispose();
      batch.geometry.dispose();
    }
    const limit = Math.min(capacity, Math.ceil(count / 4096) * 4096);
    const geometry = card.clone();
    geometry.setAttribute('crownSpecies', new THREE.InstancedBufferAttribute(new Float32Array(limit), 1)
      .setUsage(THREE.DynamicDrawUsage));
    batch = new THREE.InstancedMesh(geometry, entries[0].mesh.material, limit);
    batch.name = entries[0].mesh.name;
    batch.matrixAutoUpdate = batch.matrixWorldAutoUpdate = false;
    batch.frustumCulled = false;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (entries[0].mesh.instanceColor) {
      batch.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(limit * 3), 3)
        .setUsage(THREE.DynamicDrawUsage);
    }
    layout++;
    phase.add(batch);
  }

  phase.update = camera => {
    if (!enabled()) {
      if (batch) batch.visible = false;
      previousView = undefined;
      return;
    }
    const view = forestView(camera);
    if (batch) batch.visible = batch.count > 0;
    if (previousView === view && revision === view.revision) return;
    previousView = view;
    revision = view.revision;
    candidates.length = 0;
    let count = 0;
    for (const item of entries) {
      const { inRange, mesh } = item;
      if (!inRange || !mesh.layers.test(camera.layers) || !view.frustum.intersectsObject(mesh)) continue;
      item.depth = center.copy(mesh.boundingSphere.center).applyMatrix4(mesh.matrixWorld).applyMatrix4(view.clip).z;
      candidates.push(item);
      count += mesh.count;
    }
    if (!count) {
      if (batch) { batch.visible = false; batch.count = 0; }
      return;
    }
    // Opaque depth ties keep the same cell and instance order as separate draws.
    candidates.sort((a, b) => a.depth - b.depth || a.mesh.id - b.mesh.id);
    if (!batch || count > batch.instanceMatrix.count) resize(count);
    const matrices = batch.instanceMatrix.array;
    const tints = batch.instanceColor?.array;
    const species = batch.geometry.attributes.crownSpecies;
    let first = count, last = 0, offset = 0;
    for (const item of candidates) {
      const { mesh } = item;
      // Another cell may have overwritten this slot while this one was hidden.
      if (item.batchLayout !== layout || item.batchOffset !== offset) {
        item.batchOffset = offset;
        const transform = mesh.matrixWorld.elements;
        const dx = Math.fround(transform[12]), dy = Math.fround(transform[13]), dz = Math.fround(transform[14]);
        const start = offset * 16, end = start + mesh.count * 16;
        matrices.set(mesh.instanceMatrix.array, start);
        // The source models only translate. Preserve the shader's Float32 sum
        // of its cell translation and the per-instance root.
        if (dx || dy || dz) for (let i = start + 12; i < end; i += 16) {
          matrices[i] += dx;
          matrices[i + 1] += dy;
          matrices[i + 2] += dz;
        }
        if (tints) tints.set(mesh.instanceColor.array, offset * 3);
        species.array.set(mesh.geometry.attributes.crownSpecies.array, offset);
        first = Math.min(first, offset);
        last = offset + mesh.count;
      }
      item.batchLayout = layout + 1;
      offset += mesh.count;
    }
    layout++;
    batch.count = count;
    batch.visible = true;
    if (last <= first) return;
    for (const attribute of [batch.instanceMatrix, batch.instanceColor, species]) {
      if (!attribute) continue;
      attribute.addUpdateRange(first * attribute.itemSize, (last - first) * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  };
}

const budgetCard = new THREE.BufferGeometry()
  .setAttribute('position', new THREE.Float32BufferAttribute([
    -.37,-.0625,0, .37,-.0625,0, -.37,1.0625,0, .37,1.0625,0,
  ], 3))
  .setAttribute('uv', new THREE.Float32BufferAttribute([
    .5-.37/.84375,0, .5+.37/.84375,0, .5-.37/.84375,1, .5+.37/.84375,1,
  ], 2))
  .setIndex([0,1,2,1,3,2]);

// The cards already fade per trunk in the material. Combine them into
// larger batches on the low-cost profile and keep every surveyed placement.
export function batchBudgetForestCrowns(group, region, patchSize) {
  const patches = new Map();
  for (const cell of group.children) {
    if (!(cell instanceof ForestCell) || !cell.proxy) continue;
    const { x, z } = cell.position;
    const key = `${Math.floor(x / patchSize)},${Math.floor(z / patchSize)}`;
    if (!patches.has(key)) patches.set(key, { cells: [], count: 0 });
    const patch = patches.get(key);
    patch.cells.push(cell);
    patch.count += cell.proxy.count;
    cell.combinedCrowns = true;
  }
  if (!patches.size) return;
  batchMaxForestCrowns(group, [...patches.values()].flatMap(patch => patch.cells.map(cell => cell.proxyEntry)));
  const batches = new THREE.LOD();
  batches.name = 'Distant conifer crowns';
  group.add(batches);
  const matrix = new THREE.Matrix4(), transform = new THREE.Matrix4(), tint = new THREE.Color();
  batches.update = () => {
    if (budget && !batches.children.length) {
      for (const { cells, count } of patches.values()) {
        const geometry = budgetCard.clone();
        const kinds = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
        geometry.setAttribute('crownSpecies', kinds);
        const mesh = new THREE.InstancedMesh(geometry, crownMaterial(region), count);
        let index = 0;
        for (const { proxy, position } of cells) {
          transform.makeTranslation(position.x + proxy.position.x, position.y + proxy.position.y,
            position.z + proxy.position.z);
          const species = proxy.geometry.getAttribute('crownSpecies');
          for (let i = 0; i < proxy.count; i++, index++) {
            proxy.getMatrixAt(i, matrix);
            mesh.setMatrixAt(index, matrix.premultiply(transform));
            kinds.setX(index, species.getX(i));
            if (proxy.instanceColor) {
              proxy.getColorAt(i, tint);
              mesh.setColorAt(index, tint);
            }
          }
        }
        mesh.computeBoundingSphere();
        mesh.matrixAutoUpdate = false;
        batches.add(mesh);
        mesh.updateMatrixWorld(true);
      }
    }
    for (const mesh of batches.children) mesh.visible = budget;
  };
  batches.update();
}

// The atlas cards and silhouette use the same fixed tree placements and tint.
export function shareForestInstances(source, geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, 0);
  mesh.count = source.count;
  mesh.instanceMatrix = source.instanceMatrix;
  mesh.instanceColor = source.instanceColor;
  return mesh;
}

export class ForestCell extends THREE.LOD {
  constructor(region, center, radius, near, far, proxy) {
    super();
    this.name = region === 'regional' ? 'Coast Mountains forest cell' : 'Mapped mature forest cell';
    this.position.copy(center);
    this.radius = radius;
    this.range = transitions[region].value;
    this.near = near;
    this.far = far;
    this.proxy = proxy;
    this.proxyEntry = proxy && { mesh: proxy, inRange: false };
    this.crowns = (near.isGroup ? near.children : [near]).map(mesh => ({ mesh, select: compactCrownBatch(mesh) }));
    this.add(near,far);
    if (proxy) this.add(proxy);
    this.traverse(object => {
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    });
  }

  update(camera) {
    const distanceSq = this.position.distanceToSquared(camera.position);
    const useProxy = !!this.proxy;
    const near = distanceSq <= (this.range.y + this.radius)**2;
    if (this.near.isGroup) this.near.visible = near;
    if (near || !this.near.isGroup) {
      const view = near && forestView(camera);
      for (const { mesh, select } of this.crowns) {
        const bounds = mesh.boundingSphere;
        const visible = near && (!budget || !this.near.isGroup ||
          bounds.center.distanceToSquared(camera.position) <= (this.range.y + bounds.radius + 5)**2);
        select(view, this.range.y, visible);
      }
    }
    const distant = distanceSq >= Math.max(0,this.range.x - this.radius)**2;
    this.far.visible = distant && !useProxy;
    if (this.proxy) {
      this.proxyEntry.inRange = distant;
      this.proxy.visible = distant && (!(budget || maxCrowns) || !this.combinedCrowns);
    }
  }
}
