import { BufferAttribute, BufferGeometry, Matrix3, Mesh, Vector3 } from 'three';

// All parts in one draw follow the same joint and use the exact same material.
// Clothing with moving vertices and individually switchable groups stay separate.
export function batchRigidParts(joint) {
  const bySurface = new Map();
  for (const mesh of [...joint.children]) {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.children.length || !mesh.visible ||
        Array.isArray(mesh.material) || mesh.material.transparent || mesh.morphTargetInfluences ||
        !mesh.frustumCulled || !mesh.geometry.attributes.normal) continue;
    const key = `${mesh.material.id}/${mesh.castShadow}/${mesh.receiveShadow}/${mesh.renderOrder}`;
    if (!bySurface.has(key)) bySurface.set(key, []);
    bySurface.get(key).push(mesh);
  }
  for (const parts of bySurface.values()) {
    if (parts.length < 2) continue;
    const first = parts[0], geo = new BufferGeometry();
    const count = parts.reduce((n, p) => n + p.geometry.attributes.position.count, 0);
    const corners = parts.reduce((n, p) => n + (p.geometry.index?.count ?? p.geometry.attributes.position.count), 0);
    const pos = new Float32Array(3*count), normal = new Float32Array(3*count), uv = new Float32Array(2*count);
    const color = first.material.vertexColors ? new Float32Array(3*count) : null;
    const index = count <= 65535 ? new Uint16Array(corners) : new Uint32Array(corners);
    const point = new Vector3(), norm = new Matrix3();
    let base = 0, offset = 0;
    for (const mesh of parts) {
      mesh.updateMatrix();
      const a = mesh.geometry.attributes, n = a.position.count;
      norm.getNormalMatrix(mesh.matrix);
      for (let i = 0; i < n; i++) {
        const j = base + i;
        point.fromBufferAttribute(a.position, i).applyMatrix4(mesh.matrix).toArray(pos, 3*j);
        point.fromBufferAttribute(a.normal, i).applyNormalMatrix(norm).toArray(normal, 3*j);
        if (a.uv) { uv[2*j] = a.uv.getX(i); uv[2*j+1] = a.uv.getY(i); }
        if (color) {
          if (a.color) point.fromBufferAttribute(a.color, i);
          else point.set(1, 1, 1);
          point.toArray(color, 3*j);
        }
      }
      const src = mesh.geometry.index;
      for (let i = 0; i < (src?.count ?? n); i++) index[offset++] = base + (src ? src.getX(i) : i);
      base += n;
      joint.remove(mesh);
    }
    geo.setIndex(new BufferAttribute(index, 1));
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(normal, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    if (color) geo.setAttribute('color', new BufferAttribute(color, 3));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, first.material);
    mesh.name = first.name || 'Rigid skier trim';
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    joint.add(mesh);
  }
}
