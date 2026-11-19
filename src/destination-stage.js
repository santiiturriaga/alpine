import {
  Group, MathUtils, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry,
  Raycaster, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer,
} from 'three';

const PITCH = .57;
const SIN_PITCH = Math.sin(PITCH), COS_PITCH = Math.cos(PITCH);
const UP = new Vector3(0, COS_PITCH, -SIN_PITCH);
const SHADOW_SCALE = 1.13;

export function createDestinationStage(container) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'destination-view';
  const renderer = new WebGLRenderer({
    canvas, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power',
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
        float edge = smoothstep(0.26, 1.0, length(floorUV));
        gl_FragColor = vec4(0.017, 0.039, 0.062, (1.0 - edge) * 0.55);
      }
    `,
  });
  const ray = new Raycaster(), hitPoint = new Vector2();
  const pickable = [];
  let width = 0, height = 0, diameter = 0, spacing = 0;

  function resize() {
    width = container.clientWidth;
    height = container.clientHeight;
    if (!width || !height) return;
    const compact = width <= 620;
    diameter = Math.min(width * (compact ? .73 : .466), height * 1.36, 760);
    spacing = Math.max(diameter * .77 + (compact ? 8 : 14), width * .32);
    const ratio = Math.min(devicePixelRatio || 1, 1.2, Math.sqrt(950000 / (width * height)));
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

    let radius = 0, high = 0, low = 0;
    for (const { x, y, z } of relief.points) {
      const r = Math.hypot(x, z);
      radius = Math.max(r, radius);
      high = Math.max(high, y * COS_PITCH + r * SIN_PITCH);
      low = Math.min(low, y * COS_PITCH - r * SIN_PITCH);
    }
    const floor = new Mesh(shadow, shadowMaterial);
    floor.scale.setScalar(radius * SHADOW_SCALE);
    group.add(floor);
    scene.add(group);
    tile.model = { group, material, terrain, radius, mid: (high + low) / 2, low };
  }

  function draw(tiles) {
    if (!width || !height || renderer.getContext().isContextLost()) return;
    pickable.length = 0;
    const midY = height * .475 - 7;
    for (const tile of tiles) {
      const { button, model, angle, distance } = tile;
      const gap = Math.abs(distance);
      const side = Math.min(1, gap);
      const size = diameter * (1 - side * .53 - Math.min(Math.max(0, gap - 1), 1) * .09);
      const x = distance * spacing;
      const visible = gap < 2.34 && Math.abs(x) < width / 2 + size * .58;
      if (button.hidden === visible) button.hidden = !visible;
      if (model) model.group.visible = visible;
      if (!visible) continue;

      const y = midY - side * Math.min(26, diameter * .055);
      const labelY = model ? y + (model.mid - model.low) * size / (2 * model.radius) : y + size * .22;
      const label = `translate3d(${width / 2 + x}px, ${Math.min(height - 20, labelY + 10)}px, 0) translateX(-50%)`;
      const opacity = String(MathUtils.smoothstep(gap, .29, .86));
      if (model?.label !== label) {
        button.style.transform = label;
        if (model) model.label = label;
      }
      if (button.style.opacity !== opacity) button.style.opacity = opacity;
      if (!model) continue;

      const scale = size / (2 * model.radius);
      model.group.scale.setScalar(scale);
      model.group.rotation.y = angle;
      model.group.position.copy(UP).multiplyScalar(height / 2 - y - model.mid * scale);
      model.group.position.x = x;
      model.material.color.setScalar(1 - side * .27);
      pickable.push(model.terrain);
    }
    renderer.render(scene, camera);
  }

  function rotate(tile) {
    if (!tile.model || !width || !height || renderer.getContext().isContextLost()) return;
    tile.model.group.rotation.y = tile.angle;
    // The carousel leaves enough room to clear just the center footprint.
    // Retain the neighbouring previews until the next layout change.
    const extent = Math.ceil(diameter / 2) + 2;
    for (const terrain of pickable) terrain.parent.visible = terrain === tile.model.terrain;
    renderer.setScissor(width / 2 - extent, 0, extent * 2, height);
    renderer.setScissorTest(true);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    for (const terrain of pickable) terrain.parent.visible = true;
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
