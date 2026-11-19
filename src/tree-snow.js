import { Vector3 } from 'three';
import { climateUniforms } from './climate-state.js';
import { smoothstep } from './util.js';

const slots = Array.from({ length: 6 }, () => new Vector3());
const hitCount = { value: 0 };
const holdTime = 8;
const recoveryTime = 46;

// Store only trees with a disturbed snow load. Their roots identify the same
// tree to the solid crown, its separate detail meshes, and the atlas.
export function strikeTreeSnow(tree) {
  const climate = climateUniforms;
  const line = climate.snowline.value;
  const snow = climate.snowpack.value * smoothstep(line - 180, line + 410, tree.y);
  if (snow < .085) return 0;
  let index = -1, oldest = 0;
  for (let i = 0; i < hitCount.value; i++) {
    const hit = slots[i];
    if (Math.hypot(hit.x - tree.x, hit.y - tree.z) < .5) index = i;
    if (hit.z > slots[oldest].z) oldest = i;
  }
  if (index >= 0 && slots[index].z < 11) return 0;
  const remaining = index < 0 ? 1 : smoothstep(holdTime, recoveryTime, slots[index].z);
  if (index < 0) index = hitCount.value < slots.length ? hitCount.value++ : oldest;
  slots[index].set(tree.x, tree.z, 0);
  return snow * remaining;
}

export function updateTreeSnow(dt) {
  let live = 0;
  for (let i = 0; i < hitCount.value; i++) {
    const hit = slots[i];
    hit.z += dt;
    if (hit.z < recoveryTime) slots[live++].copy(hit);
  }
  hitCount.value = live;
}

export function bindTreeSnow(shader) {
  shader.uniforms.treeSnowHits = { value: slots };
  shader.uniforms.treeSnowHitCount = hitCount;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
    uniform vec3 treeSnowHits[${slots.length}];
    uniform int treeSnowHitCount;
    float attachedTreeSnow(vec2 root) {
      for (int index = 0; index < treeSnowHitCount; index++) {
        vec3 hit = treeSnowHits[index];
        vec2 delta = root - hit.xy;
        if (dot(delta,delta) < .25) return mix(.19, 1., smoothstep(${holdTime}., ${recoveryTime}., hit.z));
      }
      return 1.;
    }
  `);
}
