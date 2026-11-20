import { TextureLoader, Vector2, Vector4 } from 'three';

// Sample the embroidery in the garment's rest pose. The cloth and the stitching
// then share the same folds, morph targets, lighting and wind animation.
const textures = new Map();
export const jacketFinishes = { 'patrol-shell': '#323538', 'summit-shell': '#4a676c' };
const shellByColor = new Map(Object.entries(jacketFinishes).map(([shell, color]) => [color, shell]));
const marks = {
  'summit-shell': { asset: 'half-dome', label: 'The North Face', ratio: 245 / 512,
    front: [.058, .431, .098, .045], rear: [-.153, .438, .072, -.048] },
  'patrol-shell': { asset: 'fossil', label: 'Arc’teryx', ratio: 340 / 512,
    front: [.059, .430, .103, .045] },
  'micon-pack': { asset: 'fossil', label: 'Arc’teryx', ratio: 340 / 512,
    rear: [0, .321, .151, -.195] },
};

// Older lobby clients already send these distinct outfitter colours.
export function shellForColor(color) {
  return shellByColor.get(color.toLowerCase());
}

export function embroideredMaterial(cloth, mark) {
  const { asset, label, ratio, front, rear } = marks[mark];
  let map = textures.get(asset);
  if (!map) {
    map = new TextureLoader().load(new URL('../assets/equipment/' + asset + '.svg', import.meta.url).href);
    map.anisotropy = 4;
    textures.set(asset, map);
  }
  const projection = (placement, direction) => {
    if (!placement) return new Vector4(0, 0, 1, 1);
    const [x, y, width] = placement;
    return new Vector4(x, y, direction / width, 1 / (width * ratio));
  };
  const acrossFront = projection(front, 1), acrossBack = projection(rear, -1);
  const facingDepth = new Vector2(front?.[3] ?? 10, rear?.[3] ?? -10);
  const material = cloth.clone();
  material.name = `${label} ${front ? 'shell' : 'pack'} embroidery`;
  material.color = cloth.color;
  material.onBeforeCompile = shader => {
    shader.uniforms.embroidery = { value: map };
    shader.uniforms.stitchFront = { value: acrossFront };
    shader.uniforms.stitchBack = { value: acrossBack };
    shader.uniforms.stitchDepth = { value: facingDepth };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 stitchPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nstitchPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 stitchPosition;
        uniform vec4 stitchFront, stitchBack;
        uniform vec2 stitchDepth;
        uniform sampler2D embroidery;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float front = step(stitchDepth.x, stitchPosition.z);
        float back = step(stitchPosition.z, stitchDepth.y);
        vec4 projection = mix(stitchBack, stitchFront, front);
        vec2 stitchUV = (stitchPosition.xy - projection.xy) * projection.zw + 0.5;
        float ink = smoothstep(0.10, 0.82, texture2D(embroidery, stitchUV).a);
        vec2 border = min(stitchUV, 1.0 - stitchUV);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.87), ink * (front + back) * step(0.0, min(border.x, border.y)));
      `);
  };
  material.customProgramCacheKey = () => 'garment-embroidery-v2';
  return material;
}
