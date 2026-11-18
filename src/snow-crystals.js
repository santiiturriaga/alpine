import { climateUniforms } from './climate-state.js';

export function bindSnowCrystals(shader) {
  shader.uniforms.snowSun = climateUniforms.snowSun;
  shader.uniforms.snowSunDirection = climateUniforms.snowSunDirection;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', /* glsl */ `
    #include <common>
    uniform float snowSun;
    uniform vec3 snowSunDirection;

    vec3 crystalHash(vec2 cell) {
      vec3 p = fract(cell.xyx * vec3(.1031, .1099, .0973));
      p += dot(p, p.yzx + 33.33);
      return fract((p.xxy + p.yzz) * p.zyx);
    }

    float snowCrystalFlash(vec3 p, vec3 viewNormal, float distanceToEye, float snowCover) {
      vec2 grid = p.xz * 8.3;
      float pixel = length(fwidth(grid));
      float visible = snowSun * snowCover * (1.0 - smoothstep(.36, .95, pixel))
        * (1.0 - smoothstep(15., 35., distanceToEye));
      if (visible < .01) return 0.;
      vec3 variation = crystalHash(floor(grid));
      if (variation.z < .62) return 0.;

      // The crystals stay fixed in the snow. Only facets facing the sun and viewer flash.
      vec3 n = normalize(viewNormal * mat3(viewMatrix));
      vec3 facet = normalize(n * .72 + vec3(variation.x-.5, (variation.z-.80)*.8, variation.y-.5)*1.55);
      vec3 halfway = normalize(snowSunDirection + normalize(cameraPosition-p));
      float angle = dot(facet, halfway);
      float flash = smoothstep(.976, .9985, angle) * smoothstep(.015,.19,dot(n,snowSunDirection));
      vec2 delta = fract(grid) - mix(vec2(.25),vec2(.75),variation.xy);
      float size = mix(.031, .069, variation.z);
      float foot = pixel * .53;
      float dotMask = 1.0-smoothstep(max(.0,size-foot*.42),size+foot,length(delta));
      return visible * flash * dotMask * min(1., .22 / max(.22, pixel));
    }
  `);
}
