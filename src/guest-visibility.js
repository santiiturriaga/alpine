import { Frustum, Matrix4, Sphere } from 'three';
import { climateUniforms } from './climate-state.js';

// Actors share instanced draws. Reject whole people before posing their limbs.
// Include the projected shadow of a nearby guest even if the guest is behind us.
export function guestVisibility() {
  const view = new Frustum(), clip = new Matrix4(), body = new Sphere();
  return {
    prepare(camera) {
      if (!camera) return;
      camera.updateWorldMatrix(true, false);
      view.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    },
    contains(x, y, z, shadow) {
      body.center.set(x, y + 1, z);
      body.radius = 3.5;
      if (view.intersectsSphere(body)) return true;
      if (!shadow) return false;
      const light = climateUniforms.snowSunDirection.value;
      const halfLength = Math.min(35, 1.2 / Math.max(.028, light.y));
      body.center.addScaledVector(light, -halfLength);
      body.radius += halfLength;
      return view.intersectsSphere(body);
    },
  };
}
