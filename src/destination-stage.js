import {
  Group, MathUtils, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry,
  Raycaster, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer,
} from 'three';

const PITCH = .57;
const SIN_PITCH = Math.sin(PITCH), COS_PITCH = Math.cos(PITCH);
const UP = new Vector3(0, COS_PITCH, -SIN_PITCH);
const TOWARD_CAMERA = new Vector3(0, SIN_PITCH, COS_PITCH);
const SHADOW_SCALE = 1.16;

export function createDestinationStage(container) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'destination-view';
  const renderer = new WebGLRenderer({
    canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power',
  });
  container.prepend(canvas);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 2600);
  camera.position.set(0, SIN_PITCH * 1100, COS_PITCH * 1100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const shadow = new PlaneGeometry(2, 2);
  shadow.rotateX(-Math.PI / 2);
  shadow.translate(0, -.003, 0);
  const shadowMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 floorUV;
      void main() {
        floorUV = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 floorUV;
      void main() {
        float edge = smoothstep(0.04, 0.38, length(max(abs(floorUV) - 0.62, 0.0)));
        gl_FragColor = vec4(0.017, 0.039, 0.062, (1.0 - edge) * 0.55);
      }
    `,
  });
  const ray = new Raycaster(), hitPoint = new Vector2();
  const pickable = [];
  let width = 0, height = 0, diameter = 0, floorY = 0, compact = false;

  function resize() {
    width = container.clientWidth;
    height = container.clientHeight;
    if (!width || !height) return;
    compact = width <= 620;
    diameter = Math.min(width * (compact ? .65 : .36), height * 1.07, 620);
    floorY = height * (compact && height > 330 ? .615 : .57);
    const maxRatio = compact ? 1.5 : 1.1;
    const ratio = Math.min(devicePixelRatio || 1, maxRatio, Math.sqrt(950000 / (width * height)));
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
  }

  function attach(tile, relief, index) {
    const group = new Group();
    const material = new MeshBasicMaterial({ vertexColors: true });
    const terrain = new Mesh(relief.terrain, material);
    terrain.userData.destination = index;
    group.visible = false;
    group.add(terrain);
    for (const geometry of [relief.routes, relief.details]) {
      if (geometry.attributes.position.count) group.add(new Mesh(geometry, material));
      else geometry.dispose();
    }

    const { width: reliefWidth, depth, peak } = relief;
    const radius = Math.hypot(reliefWidth, depth) / 2;
    const floor = new Mesh(shadow, shadowMaterial);
    floor.scale.set(reliefWidth * SHADOW_SCALE / 2, 1, depth * SHADOW_SCALE / 2);
    group.add(floor);
    scene.add(group);
    tile.model = { group, material, terrain, radius, projectedPeak: (peak + .035) * COS_PITCH + radius * SIN_PITCH };
  }

  function draw(tiles) {
    if (!width || !height || renderer.getContext().isContextLost()) return;
    pickable.length = 0;
    const rowSpan = compact ? width : Math.min(width, diameter * 3.3);
    const labelInset = compact ? Math.min(width * .139, 62) : Math.min(width * .075, 90);
    for (const tile of tiles) {
      const { button, model, angle, distance } = tile;
      const gap = Math.abs(distance);
      const side = Math.min(1, gap);
      const outer = MathUtils.clamp(gap - 1, 0, 1);
      const size = diameter * (1 - side * (compact ? .53 : .45) - outer * .18);
      const x = Math.sin(distance * (compact ? .67 : .625)) * rowSpan * (compact ? .655 : .458) +
        Math.sign(distance) * Math.max(0, gap - (compact ? 1 : 2)) * diameter * (compact ? .8 : .6);
      const visible = gap < (compact ? 1.52 : 2.53);
      if (button.hidden === visible) button.hidden = !visible;
      if (model) model.group.visible = visible;
      if (!visible) continue;

      const y = floorY - (side * .088 + outer * .045) * diameter;
      const labelX = MathUtils.clamp(width / 2 + x, labelInset, width - labelInset);
      const labelY = Math.min(height - 40, y + size * .30 + 7);
      const label = `translate3d(${labelX}px, ${labelY}px, 0) translateX(-50%)`;
      const opacity = String(MathUtils.smoothstep(gap, .39, .86) *
        (1 - .22 * outer) * (1 - MathUtils.smoothstep(gap, compact ? 1.1 : 2.04, compact ? 1.51 : 2.52)));
      if (button.style.transform !== label) button.style.transform = label;
      if (button.style.opacity !== opacity) button.style.opacity = opacity;
      if (!model) continue;

      const scale = Math.min(size / (2 * model.radius), (y - 6) / model.projectedPeak);
      model.group.scale.setScalar(scale);
      model.group.rotation.y = angle;
      model.group.position.copy(UP).multiplyScalar(height / 2 - y)
        .addScaledVector(TOWARD_CAMERA, -diameter * (side * .37 + outer * .16));
      model.group.position.x = x;
      model.material.color.setScalar(1 - side * .20 - outer * .24);
      pickable.push(model.terrain);
    }
    renderer.render(scene, camera);
  }

  function rotate(tile) {
    if (!tile.model || !width || !height || renderer.getContext().isContextLost()) return;
    tile.model.group.rotation.y = tile.angle;
    // Redraw any neighbouring terrain that shares the selected footprint.
    const extent = Math.ceil(tile.model.group.scale.x * tile.model.radius * SHADOW_SCALE) + 2;
    const left = Math.floor(tile.model.group.position.x + width / 2 - extent);
    renderer.setScissor(left, 0, Math.ceil(extent * 2) + 1, height);
    renderer.setScissorTest(true);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
  }

  function hit(x, y) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    hitPoint.set((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
    ray.setFromCamera(hitPoint, camera);
    return ray.intersectObjects(pickable, false)[0]?.object.userData.destination ?? -1;
  }

  return { attach, canvas, draw, hit, resize, rotate };
}
