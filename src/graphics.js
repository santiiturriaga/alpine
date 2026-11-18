import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';

// All resorts keep the same shadow shader when changing detail. Resizing its
// depth target costs one allocation; toggling shadows recompiles visible materials.
export const graphicsProfiles = [
  { name: 'LOW', pixel: 1, samples: .86, maxPixels: 1800000, shadow: 512, shadowInterval: .05 },
  { name: 'BALANCED', pixel: 1.6, samples: 1, maxPixels: 3600000, shadow: 1024, shadowInterval: .025 },
  { name: 'HIGH', pixel: 2.2, samples: 1.35, maxPixels: 6000000, shadow: 2048, shadowInterval: .025 },
  { name: 'MAX', pixel: 2.5, samples: 1.55, maxPixels: 8800000, shadow: 3072, shadowInterval: .025 },
];

const preference = 'alpine.graphics';
const shadowRight = new Vector3();
const shadowUp = new Vector3();

export function createRenderer({ exposure = 1, shadows = false } = {}) {
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = shadows;
  return renderer;
}

export function resizeViewport({ host, renderer, camera, quality, storm, tuckWind }) {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  const ratio = Math.min(
    quality.pixel,
    (window.devicePixelRatio || 1) * quality.samples,
    Math.sqrt(quality.maxPixels / (width * height)),
  );
  if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  storm?.resize(renderer.domElement.height);
  tuckWind?.resize(width, height);
}

export function graphicsIndex(query, fallback) {
  let saved;
  try { saved = localStorage.getItem(preference); } catch {}
  const name = (query.get('quality') || saved || fallback).toUpperCase();
  const index = graphicsProfiles.findIndex(profile => profile.name === name);
  return index < 0 ? graphicsProfiles.findIndex(profile => profile.name === fallback) : index;
}
export function bindGraphics(slider, index, apply) {
  const output = document.getElementById('graphics-level');
  function present(i) {
    const name = graphicsProfiles[i].name;
    slider.value = i;
    slider.setAttribute('aria-valuetext', name);
    output.textContent = name.charAt(0) + name.slice(1).toLowerCase();
  }
  present(index);
  // While dragging, repaint only the label. Commit once on release. Keyboard
  // changes also dispatch change through the native range input.
  slider.addEventListener('input', () => present(slider.valueAsNumber));
  slider.addEventListener('change', () => {
    const next = slider.valueAsNumber;
    if (index === next) return;
    index = next;
    present(next);
    try { localStorage.setItem(preference, graphicsProfiles[next].name); } catch {}
    apply(next);
  });
}
export function applyShadowResolution(renderer, sun, resolution) {
  renderer.shadowMap.enabled = sun.castShadow = true;
  if (sun.shadow.mapSize.x !== resolution) {
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    sun.shadow.mapSize.set(resolution, resolution);
  }
  renderer.shadowMap.needsUpdate = true;
}

export function updateSunShadow(renderer, sun, direction, anchor, radius = sun.shadow.camera.right) {
  const camera = sun.shadow.camera;
  if (camera.right !== radius) {
    camera.left = camera.bottom = -radius;
    camera.right = camera.top = radius;
    camera.updateProjectionMatrix();
  }

  // Snap to shadow-map texels so nearby shadows stay steady as the skier moves.
  shadowRight.set(0, 1, 0).cross(direction).normalize();
  shadowUp.crossVectors(direction, shadowRight).normalize();
  const texel = 2 * radius / sun.shadow.mapSize.x;
  const right = anchor.dot(shadowRight), up = anchor.dot(shadowUp);
  sun.target.position.copy(anchor)
    .addScaledVector(shadowRight, Math.round(right / texel) * texel - right)
    .addScaledVector(shadowUp, Math.round(up / texel) * texel - up);
  sun.position.copy(sun.target.position).addScaledVector(direction, 460);
  sun.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
}
