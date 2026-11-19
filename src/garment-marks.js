import { TextureLoader, Vector4 } from 'three';

// Sample the embroidery in the garment's rest pose. The cloth and the stitching
// then share the same folds, morph targets, lighting and wind animation.
const textures = new Map();
export const jacketFinishes = { 'patrol-shell': '#323538', 'summit-shell': '#4a676c' };
const shellByColor = new Map(Object.entries(jacketFinishes).map(([shell, color]) => [color, shell]));

// Older lobby clients already send these distinct outfitter colours.
export function shellForColor(color) {
  return shellByColor.get(color.toLowerCase());
}

export function embroideredMaterial(cloth, brand, x, y, width, back = false) {
  let map = textures.get(brand);
  if (!map) {
    map = new TextureLoader().load(new URL('../assets/equipment/' + brand + '.svg', import.meta.url).href);
    textures.set(brand, map);
  }
  const height = width * (brand === 'fossil' ? 309 / 465 : 63 / 134);
  const material = cloth.clone();
  material.name = back ? 'Fossil embroidery on pack' : brand + ' chest embroidery';
  material.color = cloth.color;
  material.onBeforeCompile = shader => {
    shader.uniforms.embroidery = { value: map };
    shader.uniforms.printArea = { value: new Vector4(x, y, (back ? -1 : 1) / width, 1 / height) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 stitchPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nstitchPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 stitchPosition; uniform vec4 printArea; uniform sampler2D embroidery;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 stitchUV = (stitchPosition.xy - printArea.xy) * printArea.zw + 0.5;
        float ink = texture2D(embroidery, stitchUV).a;
        float facing = printArea.z < 0.0 ? step(stitchPosition.z, -0.195) : step(0.02, stitchPosition.z);
        vec2 border = min(stitchUV, 1.0 - stitchUV);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.79, 0.81, 0.78), ink * facing * step(0.0, min(border.x, border.y)));
      `);
  };
  material.customProgramCacheKey = () => 'garment-embroidery-v1';
  return material;
}
