import * as THREE from 'three';

// Direct model previews need a finished group; the world streams the same steps on approach.
export function finishConstruction(steps) {
  let step;
  do { step = steps.next(); } while (!step.done);
  return step.value;
}

export function part(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  return { geo, color, pos, rot, scale };
}

export function box(w, h, d, color, pos = [0, 0, 0], rot = [0, 0, 0]) {
  return part(new THREE.BoxGeometry(w, h, d), color, pos, rot);
}

export function mergeParts(parts, indexed = false) {
  // Preserve triangle order for the call sites which append UV or timber coordinates.
  // Transform each source into the final arrays without keeping expanded geometry copies.
  let count = 0, corners = 0;
  for (const { geo } of parts) {
    const triangles = geo.index?.count ?? geo.attributes.position.count;
    count += indexed && geo.attributes.normal ? geo.attributes.position.count : triangles;
    corners += triangles;
  }
  const indices = indexed ? (count < 65536 ? new Uint16Array(corners) : new Uint32Array(corners)) : null;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  // Some emissive detail uses linear HDR color values, so retain float colors there.
  const color = new THREE.Color();
  const wideColor = parts.some(p => {
    color.set(p.color);
    return Math.max(color.r, color.g, color.b) > 1 || Math.min(color.r, color.g, color.b) < 0;
  });
  const colors = wideColor ? new Float32Array(count * 3) : new Uint16Array(count * 3);
  const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
  const v = new THREE.Vector3(), scale = new THREE.Vector3();
  const q = new THREE.Quaternion(), euler = new THREE.Euler();
  let offset = 0, corner = 0;
  for (const part of parts) {
    let g = part.geo;
    if (!g.attributes.normal) {
      g = g.index ? g.toNonIndexed() : g.clone();
      g.computeVertexNormals();
    }
    matrix.compose(v.fromArray(part.pos), q.setFromEuler(euler.fromArray(part.rot)), scale.fromArray(part.scale));
    normalMatrix.getNormalMatrix(matrix);
    const { position, normal } = g.attributes;
    color.set(part.color);
    const r = wideColor ? color.r : Math.round(color.r * 65535);
    const green = wideColor ? color.g : Math.round(color.g * 65535);
    const b = wideColor ? color.b : Math.round(color.b * 65535);
    const length = indexed ? position.count : g.index?.count ?? position.count;
    if (indices) {
      const base = offset / 3;
      const n = g.index?.count ?? position.count;
      for (let i = 0; i < n; i++) indices[corner++] = base + (g.index ? g.index.getX(i) : i);
    }
    for (let i = 0; i < length; i++) {
      const j = !indexed && g.index ? g.index.getX(i) : i;
      v.fromBufferAttribute(position, j).applyMatrix4(matrix).toArray(positions, offset);
      v.fromBufferAttribute(normal, j).applyNormalMatrix(normalMatrix);
      normals[offset] = v.x;
      normals[offset + 1] = v.y;
      normals[offset + 2] = v.z;
      colors[offset] = r; colors[offset + 1] = green; colors[offset + 2] = b;
      offset += 3;
    }
    if (g !== part.geo) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  if (indices) out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3, !wideColor));
  out.computeBoundingSphere();
  return out;
}

export function mergedMesh(parts, { roughness = 0.82, metalness = 0.02, emissive = false } = {}) {
  const geo = mergeParts(parts, true);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness, metalness,
    emissive: emissive ? 0xffb45c : 0x000000,
    emissiveIntensity: emissive ? 0.9 : 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Call after attaching a completed subtree whose descendants have fixed local transforms.
// Materials, geometry, instance matrices and visibility can still change independently.
export function cacheStaticTransforms(group) {
  group.updateWorldMatrix(true, true);
  for (const child of group.children) {
    child.traverse(object => {
      object.matrixAutoUpdate = false;
      object.matrixWorldNeedsUpdate = false;
    });
  }
  let previousParent = group.parent;
  const lastParentWorld = previousParent?.matrixWorld.clone() ?? new THREE.Matrix4();
  const lastLocal = group.matrix.clone();
  const update = group.updateMatrixWorld;
  group.updateMatrixWorld = function () {
    if (this.matrixAutoUpdate) this.updateMatrix();
    const parent = this.parent;
    if (parent === previousParent && (!parent || lastParentWorld.equals(parent.matrixWorld)) && lastLocal.equals(this.matrix)) {
      this.matrixWorldNeedsUpdate = false;
      return;
    }
    previousParent = parent;
    if (parent) lastParentWorld.copy(parent.matrixWorld);
    lastLocal.copy(this.matrix);
    update.call(this, true);
  };
}

export function beam(a, b, width, depth, color) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const span = to.clone().sub(from);
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion()
    .setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize()));
  return box(width, span.length(), depth, color, from.lerp(to, .5).toArray(), rotation.toArray().slice(0, 3));
}

