import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { hash2, mulberry32 } from './util.js';

const tau = Math.PI * 2;
const profiles = {
  BUDGET: [48, 24], LOW: [62, 39], BALANCED: [84, 62], HIGH: [108, 88], MAX: [138, 126],
};

function makePlants(kind, variant) {
  const rand = mulberry32(9481 + variant * 1733);
  const positions = [], colors = [], snowWeights = [];
  const wood = new THREE.Color(0x524135);
  const leaf = new THREE.Color(kind === 'sasa' ? 0x667650 : 0x3e5736);
  const deadLeaf = new THREE.Color(0x8c7958);
  function triangle(a, b, c, color, snow) {
    positions.push(...a, ...b, ...c);
    for (let j = 0; j < 3; j++) {
      colors.push(color.r, color.g, color.b);
      snowWeights.push(snow);
    }
  }
  function stem(a, b, radius, tip, color = wood) {
    const axis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const across = new THREE.Vector3(axis.y, -axis.x, 0).normalize();
    const around = new THREE.Vector3().crossVectors(axis, across);
    const rings = [a, b].map((p, ring) => [0, 1, 2, 3, 4].map(i => {
      const angle = i * tau / 5, size = ring ? tip : radius;
      return p.map((v, j) => v + (across.getComponent(j) * Math.cos(angle) + around.getComponent(j) * Math.sin(angle)) * size);
    }));
    for (let i = 0; i < 5; i++) {
      const j = (i + 1) % 5;
      triangle(rings[0][i], rings[0][j], rings[1][i], color, .04);
      triangle(rings[1][i], rings[0][j], rings[1][j], color, .04);
    }
  }
  if (kind === 'stump') {
    const bark = new THREE.Color(0x564133), heart = new THREE.Color(0xb58b58);
    const twist = rand() * tau, cuts = Array.from({ length: 16 }, () => rand());
    const rings = Array.from({ length: 7 }, (_, ring) => cuts.map((cut, i) => {
      const angle = i / cuts.length * tau;
      const root = .28 + .094 * Math.cos(angle * 5 + twist);
      const bole = .23 + .023 * Math.sin(angle * 7 + twist);
      const brokenTop = .56 + .16 * cut ** 2.7 + .1 * Math.sin(angle + twist);
      const radii = [root * 1.35, root, bole, bole * .978, bole * .69, bole * .38, .001];
      const heights = [-.15, .12, brokenTop, brokenTop - .048, .54 + .15 * cut ** 3, .555, .587];
      return [Math.cos(angle) * radii[ring], heights[ring], Math.sin(angle) * radii[ring]];
    }));
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const upper = ring >= 3;
      for (let i = 0; i < cuts.length; i++) {
        const j = (i + 1) % cuts.length;
        const color = (upper ? heart : bark).clone().multiplyScalar(.66 + cuts[i] * .35 + (ring % 2) * .10);
        const catchSnow = upper ? .58 + cuts[i] * .41 : .023;
        const a = rings[ring][i], b = rings[ring][j], c = rings[ring+1][i], d = rings[ring+1][j];
        triangle(a, c, b, color, catchSnow);
        triangle(b, c, d, color, catchSnow);
      }
    }
    stem([.02, .22, -.21], [.16, .31, -.38], .058, .033);
  } else {
    const bamboo = kind === 'sasa';
    for (let branch = 0; branch < (bamboo ? 12 : 10); branch++) {
      const angle = branch * 2.39996 + rand() * .85, dx = Math.sin(angle), dz = Math.cos(angle);
      const length = .35 + rand() * (bamboo ? .53 : .64);
      const base = [dx * .12, -.085, dz * .12];
      const elbow = [dx * length * .48, .37 + .32 * rand(), dz * length * .48];
      const tip = [dx * length, elbow[1] * (.68 + rand() * .33), dz * length];
      stem(base, elbow, .013, .006);
      stem(elbow, tip, .006, .0018);
      for (let n = 0; n < 5; n++) {
        const t = .1 + .19 * n, side = n % 2 ? 1 : -1;
        const attach = elbow.map((v, i) => v * (1 - t) + tip[i] * t);
        const bladeAngle = angle + side * (.54 + rand() * .75);
        const x = Math.sin(bladeAngle), z = Math.cos(bladeAngle);
        const blade = (bamboo ? .22 : .16) + rand() * .15;
        const width = blade * (bamboo ? .13 : .24);
        const crest = [attach[0] + x * blade * .53, attach[1] + blade * .21, attach[2] + z * blade * .53];
        const a = [crest[0] + z * width, crest[1] - width * .26, crest[2] - x * width];
        const b = [crest[0] - z * width, crest[1] - width * .4, crest[2] + x * width];
        const end = [attach[0] + x * blade, attach[1] - blade * .24, attach[2] + z * blade];
        const tone = leaf.clone().lerp(deadLeaf, rand() ** 5 * .80).multiplyScalar(.84 + rand() * .35);
        const coat = .33 + .65 * rand();
        triangle(attach, crest, a, tone, coat * .8);
        triangle(a, crest, end, tone, coat);
        triangle(attach, b, crest, tone, coat * .9);
        triangle(b, end, crest, tone, coat);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('snowWeight', new THREE.Float32BufferAttribute(snowWeights, 1));
  geo.computeVertexNormals();
  return geo;
}

export function makeForestUndergrowth(group, { region, heightAt, treesAt, permits }) {
  const range = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.lowPlantsSnow = climateUniforms.snowpack;
    shader.uniforms.lowPlantsLine = climateUniforms.snowline;
    shader.uniforms.lowPlantsRange = range;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float snowWeight;
      uniform float lowPlantsSnow;
      uniform float lowPlantsLine;
      varying float plantCoat;
      varying vec3 plantPoint;
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      plantPoint = (modelMatrix * instanceMatrix * vec4(position,1.)).xyz;
      float snowSeason = lowPlantsSnow * smoothstep(lowPlantsLine-260.,lowPlantsLine+230.,plantPoint.y);
      plantCoat = snowSeason * snowWeight;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float lowPlantsRange;
      varying float plantCoat;
      varying vec3 plantPoint;
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float drift = .61 + .39 * sin(plantPoint.x*10. + cos(plantPoint.z*12.))*sin(plantPoint.y*9.-plantPoint.z*7.);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.59,.70,.77), smoothstep(.18,.72,plantCoat*drift));
      float transition = smoothstep(lowPlantsRange-10., lowPlantsRange+1., length(cameraPosition.xz-plantPoint.xz));
      if (transition > fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))))) discard;
    `);
  };
  const shrubs = region === 'niseko-united' ? 'sasa' : 'shrub';
  const max = profiles.MAX[1];
  const meshes = [shrubs, 'stump'].flatMap(kind => [0, 1].map(variant => {
    const mesh = new THREE.InstancedMesh(makePlants(kind, variant), material, max);
    mesh.name = kind === 'sasa' ? 'Snow-draped sasa bamboo' : kind === 'stump' ? 'Fractured stumps and exposed wood' : 'Forest-floor shrubs';
    mesh.count = 0;
    mesh.visible = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.boundingSphere = new THREE.Sphere();
    group.add(mesh);
    return mesh;
  }));
  const pose = new THREE.Object3D(), last = new THREE.Vector3(Infinity, Infinity, Infinity);
  let currentQuality;
  return (camera, quality) => {
    const eye = camera.position;
    if (currentQuality === quality && last.distanceToSquared(eye) < 32) return;
    currentQuality = quality;
    last.copy(eye);
    const [radius, budget] = profiles[quality] || profiles.HIGH;
    range.value = radius;
    const candidates = [];
    for (const { tree } of treesAt(eye.x, eye.z, radius + 11)) {
      if (!tree) continue;
      const choice = hash2(tree.x, tree.z, 12337);
      if (choice > .46) continue;
      const angle = hash2(tree.x, tree.z, 7223) * tau;
      const offset = 2.3 + 4.6 * hash2(tree.x, tree.z, 721);
      const x = tree.x + Math.cos(angle) * offset, z = tree.z + Math.sin(angle) * offset;
      const distance = (eye.x - x) ** 2 + (eye.z - z) ** 2;
      if (distance < (radius + 7) ** 2) candidates.push({ x, z, choice, distance, angle });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (const mesh of meshes) mesh.count = 0;
    let planted = 0;
    for (const { x, z, choice, angle } of candidates) {
      if (!permits(x, z)) continue;
      const y = heightAt(x, z);
      if (Math.abs(y - eye.y) > radius * .82) continue;
      const type = choice < .085 ? 2 : 0;
      const mesh = meshes[type + (choice % .025 > .0125 ? 1 : 0)];
      const scale = .68 + hash2(x, z, 6211) * .85;
      pose.position.set(x, y - .085, z);
      pose.rotation.y = angle;
      pose.scale.set(scale, scale * (.76 + hash2(x, z, 311) * .49), scale);
      pose.updateMatrix();
      mesh.setMatrixAt(mesh.count++, pose.matrix);
      if (++planted === budget) break;
    }
    for (const mesh of meshes) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      mesh.boundingSphere.center.copy(eye);
      mesh.boundingSphere.radius = radius * 1.5;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
}
