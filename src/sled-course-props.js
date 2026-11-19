import * as THREE from 'three';
import { mergeParts, part } from './scenery.js';
import { smoothstep } from './math.js';

function logGeometry() {
  const positions = [], colors = [], faces = [];
  const segments = 14, sides = 12;
  const bark = new THREE.Color('#504038'), snow = new THREE.Color('#dcebef');
  const wood = new THREE.Color('#b58d63'), rings = new THREE.Color('#876344'), shade = new THREE.Color();

  function add(x, y, z, color) {
    const index = positions.length / 3;
    positions.push(x, y, z);
    color.toArray(colors, colors.length);
    return index;
  }

  function crossSection(x, angle, scale = 1) {
    const bow = Math.sin(x * Math.PI) * .16;
    const r = (.90 + .055 * Math.cos(x * 7 + angle * 5) + .035 * Math.sin(x * 16 - angle * 3)) * scale;
    return [x, r * Math.sin(angle) - x * x * .075, r * Math.cos(angle) + bow];
  }

  for (let i = 0; i <= segments; i++) {
    const x = i / segments * 2 - 1;
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * 2 * Math.PI;
      const frost = smoothstep(.26, .88, Math.sin(a) + .14 * Math.sin(x * 18 + a));
      shade.copy(bark).multiplyScalar(.92 + .17 * Math.cos(a * 5 + x * 6) + .12 * Math.sin(a * 4 - x * 27)).lerp(snow, frost);
      add(...crossSection(x, a), shade);
      if (i === segments || j === sides) continue;
      const index = i * (sides + 1) + j, next = index + sides + 1;
      faces.push(index, next, index + 1, next, next + 1, index + 1);
    }
  }
  for (const x of [-1, 1]) {
    const center = add(...crossSection(x, 0, 0), wood);
    const first = positions.length / 3;
    for (const [r, tint] of [[.35, rings], [.43, wood], [.67, rings], [.76, wood], [1, rings]]) {
      for (let j = 0; j <= sides; j++) add(...crossSection(x, j / sides * 2 * Math.PI, r), tint);
    }
    const face = (a, b, c) => x < 0 ? faces.push(a, b, c) : faces.push(a, c, b);
    for (let j = 0; j < sides; j++) {
      face(center, first + j, first + j + 1);
      for (let ring = 0; ring < 4; ring++) {
        const a = first + ring * (sides + 1) + j, b = a + sides + 1;
        face(a, b, a + 1);
        face(a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return geometry;
}

function tokenGeometry() {
  const face = new THREE.CylinderGeometry(.47, .47, .085, 26);
  const rim = new THREE.TorusGeometry(.54, .039, 5, 26);
  const hoop = new THREE.TorusGeometry(.73, .035, 5, 30);
  const stamp = new THREE.Shape()
    .moveTo(0, .33).lineTo(.14, .15).lineTo(.095, .15).lineTo(.215, .015).lineTo(.143, .015)
    .lineTo(.267, -.135).lineTo(.045, -.135).lineTo(.045, -.255).lineTo(-.045, -.255)
    .lineTo(-.045, -.135).lineTo(-.267, -.135).lineTo(-.143, .015).lineTo(-.215, .015)
    .lineTo(-.095, .15).lineTo(-.14, .15).closePath();
  const emblem = new THREE.ShapeGeometry(stamp);
  const geometry = mergeParts([
    part(face, '#edb154', [0, 0, 0], [Math.PI / 2, 0, 0]),
    part(rim, '#ffeab2', [0, 0, .025]), part(hoop, '#ffcc77'),
    part(emblem, '#67412c', [0, 0, .044]),
  ], true);
  for (const piece of [face, rim, hoop, emblem]) piece.dispose();
  return geometry;
}

export function addSledCourseProps(scene, course, pointAt) {
  if (course.logs.length) {
    const logs = new THREE.InstancedMesh(logGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 }), course.logs.length);
    logs.name = 'Fallen cedar obstacles';
    const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    course.logs.forEach(({ d, x, halfWidth, radius }, i) => {
      matrix.compose(pointAt(x, d, radius), rotation, scale.set(halfWidth, radius, radius));
      logs.setMatrixAt(i, matrix);
    });
    scene.add(logs);
  }
  if (!course.tokens.length) return [];
  const geometry = tokenGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .41, metalness: .16, emissive: '#d27840', emissiveIntensity: .22,
  });
  return course.tokens.map(({ d, x, height }) => {
    const token = new THREE.Mesh(geometry, material);
    token.name = 'Trail medallion';
    token.position.copy(pointAt(x, d, height));
    scene.add(token);
    return token;
  });
}
