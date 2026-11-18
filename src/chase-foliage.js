import { Vector3, Vector4 } from 'three';

const direction = new Vector3();
const sightline = { value: new Vector4(0, 0, 0, 0) };

export function updateChaseFoliage(camera, player) {
  const line = sightline.value;
  if (!player || player.cameraMode === 2) {
    line.w = 0;
    return;
  }
  camera.updateWorldMatrix(true, false);
  direction.copy(player.pos);
  direction.y += player.crash ? .58 : .92;
  direction.applyMatrix4(camera.matrixWorldInverse).negate();
  const length = direction.length();
  direction.normalize();
  line.set(direction.x, direction.y, direction.z, Math.min(16, length));
}

// Open a narrow sightline through branches that actually pass between the
// chase camera and the rider. The rest of the stand still renders normally.
export function attachChaseFoliage(shader) {
  shader.uniforms.chaseSightline = sightline;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
    '#include <common>\nuniform vec4 chaseSightline;')
    .replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      if (chaseSightline.w > 0.0 && vViewPosition.z < chaseSightline.w + .3) {
        float along = dot(vViewPosition, chaseSightline.xyz);
        if (along > 0.0 && along < chaseSightline.w + .2) {
          vec3 offset = vViewPosition - along * chaseSightline.xyz;
          float radius = mix(.48, 1.03, clamp(along / chaseSightline.w, 0.0, 1.0));
          float keep = smoothstep(radius * .63, radius, length(offset));
          float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))));
          if (keep <= threshold) discard;
        }
      }
    `);
}
