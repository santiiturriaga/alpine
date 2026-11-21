import * as THREE from 'three';
import { mergeParts, part } from './scenery.js';

export function tintedMaterial(options = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .84, ...options });
}

export class SledMeshBuilder {
  positions = [];
  colors = [];
  uvs = [];
  indices = [];

  vertex(point, color, u = 0, v = 0) {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.colors.push(color.r, color.g, color.b);
    this.uvs.push(u, v);
    return index;
  }

  quad(a, b, c, d) {
    this.indices.push(a, b, d, b, c, d);
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  add(group, name, material) {
    if (!this.indices.length) return;
    const mesh = new THREE.Mesh(this.geometry(), material);
    mesh.name = name;
    group.add(mesh);
    return mesh;
  }
}

// The course coordinate grid bends and descends. Project track structures
// vertex-by-vertex so their walls and snow surfaces match the collision slots.
export function courseParts(pointAt, x, d) {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const parts = [];

  function box(w, h, length, color, at, rotation, geometry = cube) {
    parts.push(part(geometry, color, at, rotation, [w, h, length]));
  }

  function add(group, name, material) {
    if (!parts.length) return;
    const geometry = mergeParts(parts, true);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const p = pointAt(x + positions.getX(i), d - positions.getZ(i), positions.getY(i));
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    group.add(mesh);
    parts.length = 0;
    return mesh;
  }

  return { box, add, dispose: () => cube.dispose() };
}
