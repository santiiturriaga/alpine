import * as THREE from 'three';
import { canvasTexture, makeCanvas, mulberry32 } from './util.js';

function barkMap() {
  const { canvas, ctx } = makeCanvas(128, 256);
  ctx.fillStyle = '#9a775a';
  ctx.fillRect(0, 0, 128, 256);
  const random = mulberry32(14134);
  for (let i = 0; i < 780; i++) {
    const y = random() * 256, x = random() * 128, height = 4 + random() ** 1.7 * 79;
    ctx.strokeStyle = i % 5 ? (i % 2 ? '#342a3350' : '#51403376') : '#d7ba8c7d';
    ctx.lineWidth = .42 + random() ** 3 * 3.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + random() * 2 - 1, y + height * .49);
    ctx.lineTo(x + random() * 3 - 1, y + height);
    ctx.stroke();
  }
  return canvasTexture(canvas, { repeat: [1, 7] });
}

function foliageMap() {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  const random = mulberry32(123231);
  ctx.fillStyle = '#698278';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 25000; i++) {
    const x = random() * size, y = 107 + random() * 149;
    ctx.strokeStyle = ['#3e674471', '#1b3b3270', '#b1af6f78', '#739c8182'][i % 4];
    ctx.lineWidth = .45 + random() * .8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 2 + random() * 8, y + (random() - .5) * 9);
    ctx.stroke();
  }
  ctx.fillStyle = '#e3eff3';
  ctx.fillRect(0, 0, size, 101);
  for (let i = 0; i < 7850; i++) {
    const x = random() * size, y = random() * 101;
    ctx.fillStyle = i % 3 ? '#f8fffcbd' : '#a9c7d04e';
    ctx.fillRect(x, y, .3 + random() * 1.7, .5 + random() * 1.2);
  }
  return canvasTexture(canvas);
}

function foliage(detail) {
  const segments = detail === 2 ? 4 : 2, sides = detail === 2 ? 5 : 4;
  const positions = [], uv = [], normals = [], colors = [], indices = [];
  const random = mulberry32(255822);
  const snow = new THREE.Color('#ffffff'), snowShadow = new THREE.Color('#a3bfca');
  const needle = new THREE.Color('#90a487'), needleShadow = new THREE.Color('#5e796d');
  const color = new THREE.Color(), normal = new THREE.Vector3();

  function bough(x, y, z, angle, reach, width, droop, phase, frosted) {
    const alongX = Math.cos(angle), alongZ = Math.sin(angle);
    const crossX = -alongZ, crossZ = alongX;
    const first = positions.length / 3;
    for (let k = 0; k <= segments; k++) {
      const t = k / segments, bulge = Math.sin(t * Math.PI) ** .65 * (1.1 - .27 * t);
      const bend = Math.sin(t * 4 + phase) * width * .17 * t;
      const height = Math.sin(t * 6 + phase) * width * .11 - droop * t ** 1.8;
      const flare = .93 + .10 * Math.sin(t * 16 + phase);
      for (let i = 0; i <= sides; i++) {
        const a = i / sides * 2 * Math.PI, side = Math.cos(a), up = Math.sin(a);
        const scallop = 1 + .13 * Math.sin(3 * a + t * 11 + phase);
        const across = side * width * bulge * flare * scallop + bend;
        const lift = bulge * width * up * (frosted ? .47 : .52) * flare * scallop;
        positions.push(x + alongX * reach * t + crossX * across, y + height + lift,
          z + alongZ * reach * t + crossZ * across);
        normal.set(alongX * (t - .5) * .45 + crossX * side, up * 1.4 + .11,
          alongZ * (t - .5) * .45 + crossZ * side).normalize().toArray(normals, normals.length);
        const shade = (1 - up) * .35 + Math.sin(i * 2.3 + k * 4.4 + phase) * .08;
        color.copy(frosted ? snow : needle).lerp(frosted ? snowShadow : needleShadow, shade)
          .toArray(colors, colors.length);
        uv.push(t, (frosted ? .678 : .021) + i / sides * (frosted ? .296 : .53));
        if (k === segments || i === sides) continue;
        const index = first + k * (sides + 1) + i, next = index + sides + 1;
        if (k > 0) indices.push(index, next, index + 1);
        if (k < segments - 1) indices.push(index + 1, next, next + 1);
      }
    }
  }

  const levels = detail === 2 ? 9 : detail ? 8 : 6;
  const radial = detail === 2 ? 4 : 3;
  for (let tier = 0; tier < levels; tier++) {
    const t = tier / (levels - 1);
    const height = .17 + t * .81;
    for (let i = 0; i < radial; i++) {
      const phase = random() * Math.PI * 2;
      const yaw = tier * 2.39996 + i / radial * Math.PI * 2 + (random() - .5) * .57;
      const len = (.18 * (1 - t) ** .78 + .014) * (.77 + random() * .47);
      const width = len * (.30 + random() * .15), drop = len * (.14 + random() * .13);
      const y = height + (.050 - .025 * t) * (random() - .5);
      const x = Math.sin(y * 5.2) * y * .016, z = Math.cos(y * 4) * y * .011;
      bough(x, y, z, yaw, len, width, drop, phase, false);
      if (detail === 2 && t < .74 && (i + tier) % 2 === 0) {
        const turn = tier % 2 ? -.66 : .54;
        bough(x + Math.cos(yaw) * len * .32, y - width * .12, z + Math.sin(yaw) * len * .32,
          yaw + turn, len * .74, width * .58, drop * 1.08, phase * 1.5, false);
      }
      if ((i + tier * 2) % 5 !== 3) {
        const inset = len * (.10 + .10 * random());
        bough(x + Math.cos(yaw) * inset, y + width * .43, z + Math.sin(yaw) * inset, yaw + .045,
          len * (.72 + random() * .14), width * .84, drop * .91, phase + 1.1, true);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, values, size] of [['position', positions, 3], ['normal', normals, 3], ['uv', uv, 2], ['color', colors, 3]]) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  }
  geometry.setIndex(indices);
  return geometry;
}

export function sledTreeAssets() {
  const trunk = new THREE.CylinderGeometry(.0015, .043, .99, 9, 5);
  const position = trunk.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i) + .465, z = position.getZ(i);
    const rootFlare = 1 + .16 * Math.sin(Math.atan2(z, x) * 5) * Math.exp(-Math.max(0, y) * 68);
    position.setXYZ(i, x * rootFlare + .012 * y * y, y, z * rootFlare);
  }
  trunk.computeVertexNormals();
  return {
    trunk,
    trunkMaterial: new THREE.MeshStandardMaterial({ map: barkMap(), roughness: .94 }),
    needleMaterial: new THREE.MeshStandardMaterial({ map: foliageMap(), vertexColors: true, roughness: .99 }),
    full: foliage(2), medium: foliage(1), distant: foliage(0),
  };
}
