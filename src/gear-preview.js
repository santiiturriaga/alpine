import * as THREE from 'three';
import { createSkier } from './skier.js';

export function createBarberPreview(renderer, canvas) {
  const { width, height } = canvas;
  const context = canvas.getContext('2d');
  const output = context.createImageData(width, height);
  const pixels = new Uint8Array(width * height * 4);
  const target = new THREE.WebGLRenderTarget(width, height, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1d3037');
  scene.add(new THREE.HemisphereLight('#fff7e8', '#596c73', 2.25));
  for (const [color, strength, position] of [
    ['#fff0d6', 2.9, [-3, 5, 4]], ['#ade1ff', 1.95, [3, 2, -3]], ['#e4f1f7', .6, [2, 2, 4]],
  ]) {
    const light = new THREE.DirectionalLight(color, strength);
    light.position.set(...position);
    scene.add(light);
  }
  const camera = new THREE.PerspectiveCamera(31, width / height, .04, 15);
  camera.position.set(0, 1.64, 1.16);
  camera.lookAt(0, 1.51, 0);
  const rig = createSkier();
  const pose = { speed: 0, steer: 0, tuck: 0, brake: 0, grab: 0, footMode: true, display: true };
  scene.add(rig.group);
  rig.animate(.35, pose, null);

  return function draw(appearance, angle) {
    rig.setAppearance(appearance);
    rig.group.rotation.y = angle;
    rig.animate(.20, pose, null);
    const previous = renderer.getRenderTarget();
    const shadowUpdate = renderer.shadowMap.needsUpdate;
    try {
      renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } finally {
      renderer.setRenderTarget(previous);
      renderer.shadowMap.needsUpdate = shadowUpdate;
    }
    for (let y = 0; y < height; y++) {
      const row = (height - 1 - y) * width * 4;
      output.data.set(pixels.subarray(row, row + width * 4), y * width * 4);
    }
    context.putImageData(output, 0, 0);
  };
}
