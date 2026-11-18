import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';

const profiles = {
  MAX: { mapped: [740, 980], regional: [1040, 1380], detail: 1.18 },
  HIGH: { mapped: [315, 535], regional: [405, 635], detail: 1 },
  BALANCED: { mapped: [250, 445], regional: [335, 540], detail: .83 },
  LOW: { mapped: [175, 355], regional: [260, 465], detail: .67 },
};

const transitions = {
  mapped: { value: new THREE.Vector2() },
  regional: { value: new THREE.Vector2() },
};
export const forestQuality = { max: false, detail: { value: 1 } };

export function setForestQuality(name) {
  const profile = profiles[name] || profiles.HIGH;
  forestQuality.max = profile === profiles.MAX;
  forestQuality.detail.value = profile.detail;
  transitions.mapped.value.fromArray(profile.mapped);
  transitions.regional.value.fromArray(profile.regional);
}
setForestQuality('HIGH');

const fade = `smoothstep(forestRange.x, forestRange.y, crownDistance)`;
const declarations = `
  varying float forestFade;
  uniform vec2 forestRange;
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
      forestFade = ${fade};
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

let atlasPromise, atlas, proxyMaterials = new Map();

export function preloadForestCrowns() {
  atlasPromise ||= new THREE.TextureLoader().loadAsync(new URL('../assets/forest/crowns.png', import.meta.url).href)
    .then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      atlas = texture;
    })
    .catch(() => undefined);
  return atlasPromise;
}

function crownMaterial(region) {
  if (proxyMaterials.has(region)) return proxyMaterials.get(region);
  const material = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: .12, alphaToCoverage: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.forestRange = transitions[region];
    shader.uniforms.snowline = climateUniforms.snowline;
    shader.uniforms.snowpack = climateUniforms.snowpack;
    shader.uniforms.night = climateUniforms.night;
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
      forestFade = ${fade};
      float distantCrown = smoothstep(700.,2450.,crownDistance);
      float snow = smoothstep(snowline-180.,snowline+410.,origin.y) * snowpack;
      crownSnow = snow * ${region === 'regional' ? 'smoothstep(1110.,1580.,origin.y)' : 'smoothstep(1370.,1820.,origin.y)'};
      vec3 world = origin + right * position.x * length(instanceMatrix[0].xyz) * (1. - .18*distantCrown)
        + vec3(0.,position.y * height,0.);
      if (forestFade <= 0.) world = origin;
    `).replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(world,1.); gl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(world,1.);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float night;
      varying float crownDirection;
      varying float crownRow;
      varying float crownSnow;
      varying float crownDistance;
      varying float forestFade;
    `).replace('#include <map_fragment>', `
      vec2 frameUV = vec2((vMapUv.x + crownDirection)*.25, (vMapUv.y + 5.0 - crownRow) / 6.0);
      vec4 sampleCrown = texture2D(map,frameUV);
      vec3 crown = sampleCrown.rgb;
      float shade = smoothstep(.015,.16,crown.g);
      const vec3 dimmer = vec3(.78,.91,1.02);
      crown *= mix(dimmer,vec3(.86,.92,1.04),smoothstep(700.,2450.,crownDistance));
      crown = mix(crown,vec3(.29,.36,.41), crownSnow * (.14 + shade*.48));
      diffuseColor *= vec4(crown * mix(vec3(1.),vec3(.18,.25,.36),night),sampleCrown.a);
    `).replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      ${coverage}
      if (forestFade < 1.0 && forestFade <= forestThreshold) discard;
    `);
  };
  material.customProgramCacheKey = () => `forest-crown-atlas-${region}`;
  proxyMaterials.set(region,material);
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

export function makeForestCrowns(region, species) {
  if (!atlas) return null;
  const geometry = card.clone();
  geometry.setAttribute('crownSpecies',new THREE.InstancedBufferAttribute(Float32Array.from(species),1));
  const mesh = new THREE.InstancedMesh(geometry,crownMaterial(region),species.length);
  mesh.name = 'Baked conifer crowns';
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
    this.add(near,far);
    if (proxy) this.add(proxy);
    this.traverse(object => {
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    });
  }

  update(camera) {
    const distanceSq = this.position.distanceToSquared(camera.position);
    const useProxy = !forestQuality.max && !!this.proxy;
    this.near.visible = distanceSq <= (this.range.y + this.radius)**2;
    const distant = distanceSq >= Math.max(0,this.range.x - this.radius)**2;
    this.far.visible = distant && !useProxy;
    if (this.proxy) this.proxy.visible = distant && useProxy;
  }
}
