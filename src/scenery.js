import * as THREE from 'three';

export function part(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  return { geo, color, pos, rot, scale };
}

export function box(w, h, d, color, pos = [0, 0, 0], rot = [0, 0, 0]) {
  return part(new THREE.BoxGeometry(w, h, d), color, pos, rot);
}

export function mergeParts(parts) {
  let total = 0;
  const prep = [];
  for (const p of parts) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone());
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot[0], p.rot[1], p.rot[2])),
      new THREE.Vector3(p.scale[0], p.scale[1], p.scale[2]),
    );
    g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    prep.push({ g, color: new THREE.Color(p.color) });
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const { g, color } of prep) {
    const pa = g.attributes.position.array;
    const na = g.attributes.normal.array;
    pos.set(pa, o * 3);
    nor.set(na, o * 3);
    const count = g.attributes.position.count;
    for (let i = 0; i < count; i++) {
      col[(o + i) * 3] = color.r;
      col[(o + i) * 3 + 1] = color.g;
      col[(o + i) * 3 + 2] = color.b;
    }
    o += count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export function mergedMesh(parts, { roughness = 0.82, metalness = 0.02, emissive = false } = {}) {
  const geo = mergeParts(parts);
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

