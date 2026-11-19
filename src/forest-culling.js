import * as THREE from 'three';

const viewCache = new WeakMap();
const geometryBounds = new WeakMap();
const tolerance = .08;

export function forestView(camera) {
  let view = viewCache.get(camera);
  if (!view) {
    view = {
      world: new THREE.Matrix4(), projection: new THREE.Matrix4(), clip: new THREE.Matrix4(),
      frustum: new THREE.Frustum(), eye: new THREE.Vector3(), revision: 0,
    };
    viewCache.set(camera, view);
  }
  if (!view.revision || !view.world.equals(camera.matrixWorld) || !view.projection.equals(camera.projectionMatrix)) {
    view.world.copy(camera.matrixWorld);
    view.projection.copy(camera.projectionMatrix);
    view.clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    view.frustum.setFromProjectionMatrix(view.clip);
    view.eye.setFromMatrixPosition(camera.matrixWorld);
    view.revision++;
  }
  return view;
}

function localBounds(geometry) {
  if (geometryBounds.has(geometry)) return geometryBounds.get(geometry);
  const bounds = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const next = new THREE.Box3();
  // Snow and the detail fades interpolate between these positions. The trunk
  // shader's separate downward extension is added after applying the scale.
  for (const name of ['branchAnchor', 'snowCenter']) {
    if (geometry.attributes[name]) bounds.union(next.setFromBufferAttribute(geometry.attributes[name]));
  }
  const result = [bounds.getCenter(new THREE.Vector3()), bounds.getSize(new THREE.Vector3()).multiplyScalar(.5)];
  geometryBounds.set(geometry, result);
  return result;
}

export function setConiferBounds(out, offset, geometry, matrix, i = 0) {
  const [c, e] = localBounds(geometry);
  const x = matrix[i], y = matrix[i + 1], z = matrix[i + 2];
  const u = matrix[i + 4], v = matrix[i + 5], w = matrix[i + 6];
  const a = matrix[i + 8], b = matrix[i + 9], d = matrix[i + 10];
  out[offset] = x * c.x + u * c.y + a * c.z + matrix[i + 12];
  out[offset + 1] = y * c.x + v * c.y + b * c.z + matrix[i + 13] - .775;
  out[offset + 2] = z * c.x + w * c.y + d * c.z + matrix[i + 14];
  out[offset + 3] = Math.abs(x) * e.x + Math.abs(u) * e.y + Math.abs(a) * e.z + tolerance;
  out[offset + 4] = Math.abs(y) * e.x + Math.abs(v) * e.y + Math.abs(b) * e.z + .775 + tolerance;
  out[offset + 5] = Math.abs(z) * e.x + Math.abs(w) * e.y + Math.abs(d) * e.z + tolerance;
}

export function coniferInView(view, ranges, offset = 0, margin = 0) {
  const x = ranges[offset], y = ranges[offset + 1], z = ranges[offset + 2];
  const hx = ranges[offset + 3], hy = ranges[offset + 4], hz = ranges[offset + 5];
  for (const { normal, constant } of view.frustum.planes) {
    if (normal.x * x + normal.y * y + normal.z * z + constant <
        -(Math.abs(normal.x) * hx + Math.abs(normal.y) * hy + Math.abs(normal.z) * hz + margin)) return false;
  }
  return true;
}

export function crownDistanceSquared(eye, x, y, z, top) {
  const rise = Math.max(0, y - eye.y, eye.y - top);
  return (x - eye.x) ** 2 + (z - eye.z) ** 2 + rise * rise;
}

// Keep the original batch and instance order for the shadow pass. The color
// pass can use an identical smaller instance buffer when only part is visible.
export function compactCrownBatch(source) {
  const total = source.count;
  const indices = new Uint32Array(total);
  const initialDraw = source.onBeforeRender;
  const initialShadow = source.onBeforeShadow;
  const world = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  let active = false, stream, footprints, previous, lastView, revision, lastRange;
  source.onBeforeRender = function (...args) {
    source.count = active ? 0 : total;
    initialDraw.apply(this, args);
  };
  source.onBeforeShadow = function (...args) {
    source.count = total;
    initialShadow.apply(this, args);
  };

  function computeFootprints() {
    if (footprints && world.equals(source.matrixWorld)) return;
    footprints ??= new Float32Array(total * 10);
    world.copy(source.matrixWorld);
    for (let i = 0; i < total; i++) {
      matrix.fromArray(source.instanceMatrix.array, i * 16).premultiply(world);
      const m = matrix.elements, offset = i * 10;
      setConiferBounds(footprints, offset, source.geometry, m);
      footprints[offset + 6] = m[12];
      footprints[offset + 7] = m[13];
      footprints[offset + 8] = m[14];
      footprints[offset + 9] = m[13] + m[5];
    }
    revision = undefined;
  }

  function makeStream() {
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, total);
    mesh.name = source.name;
    mesh.layers.mask = source.layers.mask;
    mesh.receiveShadow = source.receiveShadow;
    mesh.boundingSphere = source.boundingSphere.clone();
    mesh.matrix.copy(source.matrix);
    mesh.matrixAutoUpdate = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (source.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    source.parent.add(mesh);
    mesh.updateWorldMatrix(false, false);
    previous = new Int32Array(total).fill(-1);
    return mesh;
  }

  function upload(mesh, count) {
    let first = count, last = -1;
    const transforms = source.instanceMatrix.array, colors = source.instanceColor?.array;
    const target = mesh.instanceMatrix.array, tint = mesh.instanceColor?.array;
    for (let i = 0; i < count; i++) {
      const index = indices[i];
      if (previous[i] === index) continue;
      previous[i] = index;
      first = Math.min(first, i);
      last = i;
      for (let n = 0; n < 16; n++) target[i * 16 + n] = transforms[index * 16 + n];
      if (tint) for (let n = 0; n < 3; n++) tint[i * 3 + n] = colors[index * 3 + n];
    }
    if (last < first) return;
    for (const attribute of [mesh.instanceMatrix, mesh.instanceColor]) {
      if (!attribute) continue;
      attribute.addUpdateRange(first * attribute.itemSize, (last - first + 1) * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  let count = total;
  return (view, range, visible) => {
    if (visible && view.frustum.intersectsObject(source)) {
      computeFootprints();
      if (view !== lastView || view.revision !== revision || range !== lastRange) {
        lastView = view;
        revision = view.revision;
        lastRange = range;
        count = 0;
        const maxDistance = (range + tolerance) ** 2;
        for (let offset = 0; offset < footprints.length; offset += 10) {
          if (crownDistanceSquared(view.eye, footprints[offset + 6], footprints[offset + 7],
            footprints[offset + 8], footprints[offset + 9]) > maxDistance || !coniferInView(view, footprints, offset)) continue;
          indices[count++] = offset / 10;
        }
        if (count && count < total) {
          stream ??= makeStream();
          upload(stream, count);
          stream.count = count;
        }
      }
      active = count < total;
      source.visible = !active || source.castShadow;
      if (stream) stream.visible = active && count > 0;
    } else {
      active = false;
      source.visible = visible;
      if (stream) stream.visible = false;
    }
  };
}
