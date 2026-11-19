import { DataTexture, LinearFilter, RGBAFormat, Vector4 } from 'three';
import { climateUniforms } from './climate-state.js';

// Each point records the highest visible ridge in eight compass directions.
// Two rows of RGBA samples fit all eight bearings into one texture binding.
export function terrainHorizon(elevations, cols, rows, bounds) {
  const size = 112;
  const field = new Uint8Array(size * size * 8);
  const dx = (cols - 1) / (bounds.maxX - bounds.minX);
  const dz = (rows - 1) / (bounds.maxZ - bounds.minZ);
  const step = Math.max(20, 1 / dx, 1 / dz);
  for (let bearing = 0; bearing < 8; bearing++) {
    const angle = bearing * Math.PI / 4;
    const vx = Math.cos(angle) * dx, vz = Math.sin(angle) * dz;
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      const i = Math.round(x * (cols - 1) / (size - 1)), j = Math.round(z * (rows - 1) / (size - 1));
      const floor = elevations[j * cols + i] + 1.7;
      let slope = 0;
      for (let distance = step; distance < 9000; distance *= 1.52) {
        const u = Math.round(i + vx * distance), v = Math.round(j + vz * distance);
        if (u < 0 || v < 0 || u >= cols || v >= rows) break;
        slope = Math.max(slope, (elevations[v * cols + u] - floor) / distance);
      }
      const index = (bearing >> 2) * size * size + z * size + x;
      field[4 * index + (bearing % 4)] = Math.round(255 * slope / Math.sqrt(1 + slope * slope));
    }
  }
  const texture = new DataTexture(field, size, size * 2, RGBAFormat);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const first = new Vector4(), second = new Vector4();
export function updateHorizonSun(direction) {
  const phase = ((Math.atan2(direction.z, direction.x) * 4 / Math.PI) + 8) % 8;
  const a = Math.floor(phase), b = (a + 1) % 8, blend = phase - a;
  first.set(0, 0, 0, 0);
  second.set(0, 0, 0, 0);
  (a < 4 ? first : second).setComponent(a % 4, 1 - blend);
  (b < 4 ? first : second).setComponent(b % 4, blend);
}

export function bindTerrainHorizon(shader, texture) {
  shader.uniforms.ridgeHorizon = { value: texture };
  shader.uniforms.ridgeFirst = { value: first };
  shader.uniforms.ridgeSecond = { value: second };
  shader.uniforms.ridgeSun = climateUniforms.snowSunDirection;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    uniform sampler2D ridgeHorizon;
    uniform vec4 ridgeFirst, ridgeSecond;
    uniform vec3 ridgeSun;
    vec2 terrainLight(vec2 uv) {
      vec2 cell = (clamp(uv, 0., 1.) * 111. + .5) / 112.;
      vec4 a = texture2D(ridgeHorizon, vec2(cell.x, .5 * cell.y));
      vec4 b = texture2D(ridgeHorizon, vec2(cell.x, .5 * cell.y + .5));
      float horizon = dot(a,ridgeFirst) + dot(b,ridgeSecond);
      float sunlight = smoothstep(horizon-.026, horizon+.026, ridgeSun.y);
      float skyView = 1. - (dot(a,a) + dot(b,b)) * .125;
      return vec2(sunlight, skyView);
    }`);
}
