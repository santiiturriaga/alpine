import { ACESFilmicToneMapping, Frustum, Group, Matrix4, PCFSoftShadowMap, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from 'three';
import { climateUniforms } from './climate-state.js';
import { compactDevice } from './device-budget.js';
import { watchRenderer } from './renderer-recovery.js';

// All resorts keep the same shadow shader when changing detail. Resizing its
// depth target costs one allocation; toggling shadows recompiles visible materials.
export const graphicsProfiles = [
  { name: 'BUDGET', pixel: 1, samples: 1, maxPixels: Infinity, shadow: 384, shadowInterval: .12 },
  { name: 'LOW', pixel: 1, samples: .86, maxPixels: 1800000, shadow: 512, shadowInterval: .05 },
  { name: 'BALANCED', pixel: 1.6, samples: 1, maxPixels: 3600000, shadow: 1024, shadowInterval: .025 },
  { name: 'HIGH', pixel: 2.2, samples: 1.35, maxPixels: 6000000, shadow: 2048, shadowInterval: .025 },
  { name: 'MAX', pixel: 2.5, samples: 1.55, maxPixels: 8800000, shadow: 3072, shadowInterval: .025 },
];

const realismPreference = 'alpine.realism';
const shadowRight = new Vector3();
const shadowUp = new Vector3();
const viewportSize = new Vector2();
const appleTouch = compactDevice && (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && navigator.platform === 'MacIntel'));
const presentedSurfaces = new WeakMap();

export function renderMountainFrame(renderer, scene, camera) {
  renderer.render(scene, camera);
  if (!appleTouch) return;
  const presentation = presentedSurfaces.get(renderer);
  if (!presentation) {
    presentedSurfaces.set(renderer, {});
  } else if (presentation.context) {
    // Sample before WebGL releases this frame's default framebuffer.
    presentation.context.drawImage(renderer.domElement, 0, 0);
    if (presentation.waitingForFrame) {
      presentation.context.canvas.style.visibility = '';
      renderer.domElement.style.opacity = '0';
      presentation.waitingForFrame = false;
    }
  }
}

function resizePresentation(renderer) {
  const presentation = presentedSurfaces.get(renderer);
  if (!presentation) return;
  const source = renderer.domElement;
  if (!presentation.context) {
    // Mobile WebKit can keep rendering into a resized WebGL buffer while
    // its compositor shows an empty layer. Keep the live context and inputs.
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    canvas.setAttribute('aria-hidden', 'true');
    source.after(canvas);
    presentation.context = context;
  }
  const canvas = presentation.context.canvas;
  canvas.style.visibility = 'hidden';
  canvas.width = source.width;
  canvas.height = source.height;
  presentation.waitingForFrame = true;
}

export function createRenderer({ exposure = 1, shadows = false, antialias = !compactDevice } = {}) {
  const renderer = new WebGLRenderer({
    antialias,
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
  watchRenderer(renderer.domElement);
  return renderer;
}

export function resizeViewport({ host, renderer, camera, quality, storm, tuckWind, resolution = 'native', resolutionScale = 1 }) {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  const deviceRatio = window.devicePixelRatio || 1;
  const heightLimit = Number.parseInt(resolution, 10) || Infinity;
  const scale = resolution === 'adaptive' ? resolutionScale : 1;
  const ratio = resolution === 'scaled'
    ? Math.min(quality.pixel, deviceRatio * quality.samples, Math.sqrt(quality.maxPixels / (width * height)))
    : Math.min(Math.max(1, deviceRatio) * scale, heightLimit / height);
  renderer.getSize(viewportSize);
  if (viewportSize.x !== width || viewportSize.y !== height || renderer.getPixelRatio() !== ratio) {
    // Window resize and ResizeObserver can report the same dimensions.
    renderer.setDrawingBufferSize(width, height, ratio);
    resizePresentation(renderer);
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  storm?.resize(renderer.domElement.height);
  tuckWind?.resize(width, height);
}

// Queue the first camera's material programs together. A synchronous first draw
// waits for each program in turn and can stall WebKit while the loader is rolling.
export async function prepareFirstFrame(renderer, scene, camera) {
  if (!renderer.extensions.has('KHR_parallel_shader_compile')) return;
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const visible = new Group();
  scene.traverseVisible(object => {
    if (object.isLOD && object.autoUpdate) object.update(camera);
    if (object.material && object.layers.test(camera.layers) &&
        (!object.frustumCulled || frustum.intersectsObject(object))) {
      // A temporary read-only render list; do not reparent live objects.
      visible.children.push(object);
    }
  });
  try {
    await renderer.compileAsync(visible, camera, scene);
  } finally {
    visible.children.length = 0;
  }
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

export function bindRealism(button, query) {
  let enabled;
  try { enabled = localStorage.getItem(realismPreference) === 'on'; } catch { enabled = false; }
  if (query.has('realism')) enabled = query.get('realism') === 'on';
  const update = () => {
    climateUniforms.realism.value = Number(enabled);
    button.classList.toggle('on', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('span').textContent = enabled ? 'ON' : 'OFF';
  };
  update();
  button.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem(realismPreference, enabled ? 'on' : 'off'); } catch {}
    update();
  });
}

export function sunShadowRefreshDue(elapsed, distanceSquared, interval, budget = false) {
  if (!compactDevice && !budget) return elapsed >= interval || distanceSquared >= 4;
  // Recenter immediately after a jump to another view. During continuous
  // motion, cap depth passes at 20 Hz and use a slower cadence at rest.
  if (distanceSquared >= 24 ** 2) return true;
  const moving = distanceSquared >= .5 ** 2;
  return elapsed >= (budget ? interval * (moving ? 1 : 2) : Math.max(interval, moving ? .05 : .12));
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
