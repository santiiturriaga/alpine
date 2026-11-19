import * as THREE from 'three';
import { canvasTexture, clamp, damp, makeCanvas, mulberry32 } from './util.js';
import { baseThickness, isSkiStyle, skiDeck, snowboardDeck } from './skier-equipment.js';
import { DEFAULT_SNOWBOARD_ID, SNOWBOARD_MODELS } from './gear-catalog.js';
import { embroideredMaterial } from './garment-marks.js';
import { buildSnowShoe } from './snow-shoes.js';
import { buildSkiGoggles } from './ski-goggles.js';
import { buildSkierBackpack } from './skier-backpacks.js';
import { batchRigidParts } from './skier-hardware.js';
import { frontBindingSide } from './ride-dynamics.js';

export { skiProfile } from './skier-equipment.js';

const down = new THREE.Vector3(0, -1, 0);
const up = new THREE.Vector3(0, 1, 0);
let sharedBindings;

function loft(a, b, c, d, t) {
  const value = b + .5 * t * ((c - a) + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  return clamp(value, Math.min(b, c), Math.max(b, c));
}

function profileAt(profile, y) {
  let i = 0;
  while (i < profile.length - 2 && y > profile[i + 1][0]) i++;
  const a = profile[Math.max(0, i - 1)], b = profile[i], c = profile[i + 1], d = profile[Math.min(i + 2, profile.length - 1)];
  const t = clamp((y - b[0]) / (c[0] - b[0]), 0, 1);
  return b.slice(1).map((v, j) => loft(a[j + 1], v, c[j + 1], d[j + 1], t));
}

// Cross-sections let the garment follow shoulders, elbows, cuffs and folds.
function shell(profile, folds = 0.018, segments = 32, tailored = false) {
  const positions = [], uv = [], indices = [], colors = [];
  const rings = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[Math.max(0, i - 1)], b = profile[i], c = profile[i + 1], d = profile[Math.min(i + 2, profile.length - 1)];
    for (let j = 0; j < 3; j++) rings.push(b.map((v, k) => k === 0 ? v + (c[k] - v) * j / 3 : loft(a[k], v, c[k], d[k], j / 3)));
  }
  rings.push(profile.at(-1));
  for (const [j, [y, width, depth, z]] of rings.entries()) {
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2;
      const warp = 1 + folds * (Math.sin(a * 5 + y * 33) + 0.58 * Math.sin(a * 9 - y * 24));
      const bunch = tailored ? Math.exp(-(((y - .06) / .17) ** 2)) : 0;
      const crease = bunch * Math.sin(y * 68 + Math.sin(a) * 2.1);
      const ridge = crease * .0032 * (.4 + .6 * Math.max(0, Math.cos(a)));
      positions.push(Math.sin(a) * (width * warp + ridge * .5), y, z + Math.cos(a) * (depth * warp + ridge));
      uv.push(i / segments, j / (rings.length - 1));
      // Broad folds have a little self shading even before a distant rider is
      // large enough for the woven bump map to resolve. This is garment-local,
      // so it follows the cloth rather than looking like noise on the screen.
      const yoke = tailored
        ? THREE.MathUtils.smoothstep(y, .332 + .15 * Math.abs(Math.cos(a)), .347 + .15 * Math.abs(Math.cos(a)))
        : 0;
      const hem = tailored ? .16 * (1 - THREE.MathUtils.smoothstep(y, -.082, -.063)) : 0;
      const shade = (1 - hem - yoke * .38) * (1 - folds * 1.1 + folds * (.65 * Math.sin(a * 5 + y * 33)
        + .32 * Math.sin(a * 9 - y * 24)) + crease * .025);
      colors.push(shade, shade, shade);
      if (i === segments || j === rings.length - 1) continue;
      const k = j * (segments + 1) + i;
      indices.push(k, k + 1, k + segments + 1, k + 1, k + segments + 2, k + segments + 1);
    }
  }
  for (const top of [false, true]) {
    const ring = top ? rings.length - 1 : 0;
    const start = positions.length / 3;
    const [y, , , z] = rings[ring];
    const base = ring * (segments + 1);
    positions.push(0, y, z);
    uv.push(.5, .5);
    colors.push(1, 1, 1);
    for (let i = 0; i <= segments; i++) {
      const v = (base + i) * 3;
      positions.push(positions[v], positions[v + 1], positions[v + 2]);
      uv.push(i / segments, top ? 1 : 0);
      colors.push(colors[v], colors[v + 1], colors[v + 2]);
      if (i > 0) {
        if (top) indices.push(start, start + i, start + i + 1);
        else indices.push(start, start + i + 1, start + i);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const normal = geo.attributes.normal;
  const seam = new THREE.Vector3(), other = new THREE.Vector3();
  for (let j = 0; j < rings.length; j++) {
    const first = j * (segments + 1), last = first + segments;
    seam.fromBufferAttribute(normal, first).add(other.fromBufferAttribute(normal, last)).normalize();
    normal.setXYZ(first, seam.x, seam.y, seam.z);
    normal.setXYZ(last, seam.x, seam.y, seam.z);
  }
  return geo;
}

function shapeJacket(geometry) {
  const base = geometry.attributes.position;
  for (const correction of ['breath', 'compression', 'gust', 'flutter']) {
    const target = geometry.clone();
    const position = target.attributes.position;
    for (let i = 0; i < base.count; i++) {
      const x = base.getX(i), y = base.getY(i), z = base.getZ(i);
      if (x === 0 && (y < -.09 || y > .572)) continue;
      const angle = Math.atan2(x, z + .012);
      const chest = Math.exp(-(((y - .32) / .122) ** 2));
      const waist = Math.exp(-(((y - .075) / .135) ** 2));
      const zipAnchor = 1 - .83 * Math.exp(-((angle * 8) ** 2));
      const freeHem = (1 - THREE.MathUtils.smoothstep(y, -.093, .175)) * zipAnchor;
      let fold = 0, drape = 0, sway = 0;
      if (correction === 'breath') fold = .0065 * chest * zipAnchor;
      if (correction === 'compression') {
        fold = (.007 * Math.sin(y * 74 + angle * 2) + .003 * Math.sin(y * 135 - angle * 4)) * waist * zipAnchor;
        drape = .014 * waist * (.24 - .76 * Math.cos(angle)) * zipAnchor;
      }
      if (correction === 'gust') {
        sway = .052 * freeHem;
        fold = -.021 * Math.cos(angle) * freeHem;
      }
      if (correction === 'flutter') {
        drape = .026 * freeHem * Math.sin(angle * 2 - .35);
        fold = .020 * freeHem * Math.cos(angle * 3 + y * 37);
      }
      position.setXYZ(i, x + Math.sin(angle) * fold + sway, y + drape, z + Math.cos(angle) * fold);
    }
    target.computeVertexNormals();
    (geometry.morphAttributes.position ??= []).push(position);
    (geometry.morphAttributes.normal ??= []).push(target.attributes.normal);
  }
  return geometry;
}

function shapeHelmetSleeve(geometry, side) {
  const target = geometry.clone();
  const position = target.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i), middle = Math.sin(Math.PI * Math.abs(y)) ** 2;
    position.setX(i, position.getX(i) + side * .036 * middle);
    position.setZ(i, position.getZ(i) + .019 * middle * Math.sin(y * 49));
  }
  target.computeVertexNormals();
  geometry.morphAttributes.position = [position];
  geometry.morphAttributes.normal = [target.attributes.normal];
  return geometry;
}

function put(parent, geometry, material, x = 0, y = 0, z = 0) {
  if (material.vertexColors && !geometry.hasAttribute('color')) {
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    colors.fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function block(parent, mat, w, h, d, x, y, z) {
  return put(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
}

function rounded(parent, mat, w, h, d, x, y, z, radius) {
  const outline = new THREE.Shape();
  outline.moveTo(radius - w / 2, radius - h / 2);
  outline.lineTo(w / 2 - radius, radius - h / 2);
  outline.lineTo(w / 2 - radius, h / 2 - radius);
  outline.lineTo(radius - w / 2, h / 2 - radius);
  outline.closePath();
  const geo = new THREE.ExtrudeGeometry(outline, {
    depth: d - radius * 2, bevelEnabled: true, bevelSize: radius, bevelThickness: radius, bevelSegments: 3,
  });
  geo.translate(0, 0, radius - d / 2);
  return put(parent, geo, mat, x, y, z);
}

function piping(parent, mat, points, radius = 0.003) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return put(parent, new THREE.TubeGeometry(curve, 18, radius, 6, false), mat);
}

const haircutGeometry = new Map();
function haircutMesh(style) {
  if (haircutGeometry.has(style)) return haircutGeometry.get(style);
  const steps = 56, rows = 22, positions = [], indices = [], colors = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= steps; i++) {
      const a = i / steps * Math.PI * 2;
      const front = Math.max(0, Math.cos(a));
      const hairline = THREE.MathUtils.lerp(1.98, 1.24, front ** .45) +
        (style === 'part' ? .15 * Math.sin(a + .40) * front : 0);
      const p = Math.max(.001, j / rows) * hairline;
      const curl = Math.sin(15 * a - 16 * p) * Math.cos(p * 19 + a * 7);
      const grain = Math.cos(17 * a + p * 8 * Math.cos(a));
      const strandFalloff = THREE.MathUtils.smoothstep(p, .03, .32);
      const strand = (style === 'curls' ? .065 * curl : style === 'part' ? .027 * grain : 0) * strandFalloff;
      const lift = style === 'curls' ? .111 : style === 'part' ? .105 : .091;
      const sweep = style === 'part' ? -.023 * Math.cos(p) ** 2 * front : 0;
      const ring = Math.sin(p) * (1 + strand);
      positions.push(Math.sin(a) * ring * .084 + sweep, .127 + Math.cos(p) * lift * (1 + strand),
        .007 + Math.cos(a) * ring * .091);
      const split = Math.exp(-((Math.sin(a + .43 + p * .22) * 13) ** 2)) * front * strandFalloff;
      const shade = style === 'part' ? .91 + .09 * grain - .35 * split : style === 'curls' ? .90 + .1 * curl : .9 + .045 * grain;
      colors.push(shade, shade, shade);
      if (j === rows || i === steps) continue;
      const k = j * (steps + 1) + i;
      indices.push(k, k + steps + 1, k + 1, k + 1, k + steps + 1, k + steps + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  haircutGeometry.set(style, geo);
  return geo;
}

// A sewn garment rounds the changing joint angle. Two capped cylinders
// leave a wedge of daylight through the joint as soon as it bends.
const foldTables = new Map();

// Garment topology never changes. Accumulate the same area-weighted face
// normals directly in the live attribute instead of reading each triangle
// through BufferAttribute accessors four times per skier animation frame.
function garmentNormals(positions, indices, normals) {
  normals.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i+1] * 3, c = indices[i+2] * 3;
    const cx = positions[c] - positions[b], cy = positions[c+1] - positions[b+1], cz = positions[c+2] - positions[b+2];
    const ax = positions[a] - positions[b], ay = positions[a+1] - positions[b+1], az = positions[a+2] - positions[b+2];
    const x = cy*az - cz*ay, y = cz*ax - cx*az, z = cx*ay - cy*ax;
    normals[a] += x; normals[a+1] += y; normals[a+2] += z;
    normals[b] += x; normals[b+1] += y; normals[b+2] += z;
    normals[c] += x; normals[c+1] += y; normals[c+2] += z;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], y = normals[i+1], z = normals[i+2];
    const scale = 1 / (Math.sqrt(x*x + y*y + z*z) || 1);
    normals[i] = x*scale; normals[i+1] = y*scale; normals[i+2] = z*scale;
  }
}

function garmentFolds(rows, angles, profile, side, sleeve) {
  const key = `${rows}/${angles.length}/${side}/${sleeve}/${JSON.stringify(profile)}`;
  if (foldTables.has(key)) return foldTables.get(key);
  const columns = angles.length;
  const folds = new Float64Array((rows + 1) * columns * 3), rings = [];
  for (let row = 0; row <= rows; row++) {
    const s = row / rows;
    let k = 0;
    while (k < profile.length-2 && profile[k+1][0] < s) k++;
    const a = profile[k], b = profile[k+1], t = (s-a[0]) / (b[0]-a[0]);
    const loose = Math.sin(Math.PI*s) ** 1.6;
    rings.push([THREE.MathUtils.lerp(a[1], b[1], t), THREE.MathUtils.lerp(a[2], b[2], t), loose]);
    const knee = Math.exp(-(((s-.48)/.18)**2));
    const hem = Math.exp(-(((s-.91)/.12)**2));
    for (let i = 0; i < columns; i++) {
      const { angle, sin, cos } = angles[i], at = (row * columns + i) * 3;
      const base = .0049 * Math.sin(s * 74 + sin * 2.2 + side) * knee;
      folds[at] = base * .4 + .0037 * Math.sin(s * 98 - cos * 2.4 + side * 1.2) * hem
        + .0019 * Math.sin(s * 45 + angle * 4 + side) * loose;
      folds[at+1] = base * .6 * (1.1 - cos * .65);
      const panel = sleeve ? .74 + .26 * THREE.MathUtils.smoothstep(s, .21 + sin*.02, .245 + sin*.02)
        : cos > .39 && s > .36 && s < .68 ? .925 : 1;
      folds[at+2] = panel * (Math.abs(cos) < .025 ? .84 : 1);
    }
  }
  const table = { folds, rings };
  foldTables.set(key, table);
  return table;
}

function garmentCrossFrame(tangent, right, front) {
  right.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
  front.crossVectors(tangent, right).normalize();
}

function jointGarment(parent, material, options = {}) {
  const rows = 28, sides = 36, stride = sides + 1;
  const positions = new Float32Array(((rows + 1) * stride + 2) * 3);
  const colors = new Float32Array(positions.length), uvs = [], indices = [];
  const angles = Array.from({ length: stride }, (_, i) => {
    const angle = i / sides * Math.PI * 2;
    const sin = Math.sin(angle), cos = Math.cos(angle);
    return { angle, sin, cos, windShape: .6 * cos - .36 * Math.sin(angle * 3) };
  });
  const profile = options.profile || [[0,.064,.067],[.09,.096,.097],[.19,.102,.107],[.35,.096,.098],
    [.47,.091,.091],[.57,.088,.094],[.7,.080,.081],[.86,.079,.077],[1,.081,.078]];
  const bias = options.side ?? 1;
  const { folds, rings } = garmentFolds(rows, angles, profile, bias, !!options.sleeve);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= sides; i++) {
    uvs.push(i / sides, j / rows);
    if (j === rows || i === sides) continue;
    const a = j * stride + i;
    indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
  }
  for (let i = 0; i < sides; i++) {
    indices.push((rows + 1) * stride, i, i + 1);
    indices.push((rows + 1) * stride + 1, rows * stride + i + 1, rows * stride + i);
  }
  uvs.push(.5, 0, .5, 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const normal = new THREE.BufferAttribute(new Float32Array(positions.length), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('normal', normal);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const mesh = put(parent, geometry, material);
  mesh.name = options.name || 'Continuous articulated trouser shell';
  mesh.frustumCulled = false;
  const upper = new THREE.Vector3(), lower = new THREE.Vector3(), start = new THREE.Vector3();
  const finish = new THREE.Vector3(), center = new THREE.Vector3(), tangent = new THREE.Vector3();
  const beforeJoint = new THREE.Vector3(), afterJoint = new THREE.Vector3();
  const upperRight = new THREE.Vector3(), upperFront = new THREE.Vector3();
  const lowerRight = new THREE.Vector3(), lowerFront = new THREE.Vector3();
  const bendRight = new THREE.Vector3(), bendFront = new THREE.Vector3();
  const seam = new THREE.Vector3(), opposite = new THREE.Vector3();
  return {
    mesh,
    update(hip, knee, ankle, windPhase, wind) {
      upper.subVectors(knee, hip).normalize();
      lower.subVectors(ankle, knee).normalize();
      const compression = clamp((1 - upper.dot(lower)) * 1.4, 0, 1);
      start.copy(hip).addScaledVector(upper, -(options.topOverlap ?? .038));
      beforeJoint.copy(knee).addScaledVector(upper, -.055);
      afterJoint.copy(knee).addScaledVector(lower, .055);
      finish.copy(ankle).addScaledVector(lower, options.bottomOverlap ?? .043);
      garmentCrossFrame(upper, upperRight, upperFront);
      garmentCrossFrame(lower, lowerRight, lowerFront);
      for (let j = 0; j <= rows; j++) {
        const s = j / rows;
        let right, front;
        if (s < .43) {
          center.copy(start).lerp(beforeJoint, s / .43);
          right = upperRight;
          front = upperFront;
        } else if (s > .57) {
          center.copy(afterJoint).lerp(finish, (s - .57) / .43);
          right = lowerRight;
          front = lowerFront;
        } else {
          const t = (s - .43) / .14, u = 1 - t;
          center.copy(beforeJoint).multiplyScalar(u * u).addScaledVector(knee, 2 * u * t).addScaledVector(afterJoint, t * t);
          tangent.copy(upper).lerp(lower, t).normalize();
          garmentCrossFrame(tangent, bendRight, bendFront);
          right = bendRight;
          front = bendFront;
        }
        if (j === 0 || j === rows) {
          const offset = ((rows + 1) * stride + (j === rows ? 1 : 0)) * 3;
          positions[offset] = center.x;
          positions[offset + 1] = center.y;
          positions[offset + 2] = center.z;
          colors[offset] = colors[offset + 1] = colors[offset + 2] = .97;
        }
        const [width, depth, looseCloth] = rings[j];
        const flutter = wind * (options.sleeve ? .013 : .010) * looseCloth * Math.sin(windPhase + s * 14 + bias * 1.9);
        center.addScaledVector(right, flutter * bias * .85);
        for (let i = 0; i <= sides; i++) {
          const offset = (j * stride + i) * 3;
          const { sin, cos, windShape } = angles[i];
          const crease = folds[offset] + compression * folds[offset+1] + flutter * windShape;
          const x = sin * (width + crease), z = cos * (depth + crease);
          positions[offset] = center.x + right.x * x + front.x * z;
          positions[offset + 1] = center.y + right.y * x + front.y * z;
          positions[offset + 2] = center.z + right.z * x + front.z * z;
          const shade = (.97 + crease * 4.5) * folds[offset+2];
          colors[offset] = colors[offset + 1] = colors[offset + 2] = shade;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      garmentNormals(positions, geometry.index.array, normal.array);
      for (let j = 0; j <= rows; j++) {
        const a = j * stride, b = a + sides;
        seam.fromBufferAttribute(normal, a).add(opposite.fromBufferAttribute(normal, b)).normalize();
        normal.setXYZ(a, seam.x, seam.y, seam.z);
        normal.setXYZ(b, seam.x, seam.y, seam.z);
      }
      normal.needsUpdate = true;
    },
  };
}

let wovenFabric, ripstopFabric;
function fabricMaps() {
  if (wovenFabric) return wovenFabric;
  const height = makeCanvas(128, 128), surface = makeCanvas(128, 128);
  const bump = height.ctx.createImageData(128, 128), color = surface.ctx.createImageData(128, 128);
  const rand = mulberry32(2217);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4;
      const warp = Math.cos((x + (y % 4)) * Math.PI / 2), weft = Math.cos((y - (x % 5)) * Math.PI / 2);
      const grain = rand() - .5;
      const twill = 126 + warp * 39 + weft * 23 + grain * 30;
      const fiber = 244 + warp * 8 + weft * 5 + grain * 11 + 3 * Math.sin(x * .22 + y * .19);
      bump.data.set([twill, twill, twill, 255], i);
      color.data.set([fiber, fiber, fiber, 255], i);
    }
  }
  height.ctx.putImageData(bump, 0, 0);
  surface.ctx.putImageData(color, 0, 0);
  return wovenFabric = {
    bumpMap: canvasTexture(height.canvas, { srgb: false, repeat: [3, 3] }),
    map: canvasTexture(surface.canvas, { repeat: [3, 3] }),
  };
}

function patrolFabric() {
  if (ripstopFabric) return ripstopFabric;
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = '#dcdfe2';
  ctx.fillRect(0, 0, 128, 128);
  ctx.lineWidth = 1;
  for (const direction of [-1, 1]) {
    ctx.strokeStyle = direction > 0 ? '#aeb4bc' : '#b9bec4';
    ctx.beginPath();
    for (let j = -128; j <= 256; j += 8) {
      ctx.moveTo(j, 0);
      ctx.lineTo(j + 128 * direction, 128);
    }
    ctx.stroke();
  }
  return ripstopFabric = canvasTexture(canvas, { repeat: [2, 2] });
}

const skiEdges = [-1, 1];
const bootContactProfile = [[-.18, .061, .034], [.13, .061, .034]];

function decalShapes(parent, mat) {
  const make = (points) => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  };
  const peak = new THREE.Group();
  put(peak, make([[-.93,-.54],[-.31,.61],[.03,.03],[.38,.67],[.93,-.54],[.61,-.54],[.37,.05],
    [.03,-.45],[-.29,.06],[-.59,-.54]]), mat);
  const maple = new THREE.Group();
  put(maple, make([[0,.97],[.19,.56],[.38,.65],[.30,.23],[.56,.44],[.62,.28],[.91,.33],
    [.79,.03],[.92,-.06],[.44,-.45],[.47,-.58],[.07,-.49],[.07,-.89],[-.07,-.89],[-.07,-.49],
    [-.47,-.58],[-.44,-.45],[-.92,-.06],[-.79,.03],[-.91,.33],[-.62,.28],[-.56,.44],[-.30,.23],
    [-.38,.65],[-.19,.56]]), mat);
  const snowflake = new THREE.Group();
  const branch = make([[-.055,-.04],[.055,-.04],[.055,.46],[.24,.63],[.19,.72],
    [.055,.59],[.055,.88],[-.055,.88],[-.055,.59],[-.19,.72],[-.24,.63],[-.055,.46]]);
  for (let i = 0; i < 6; i++) put(snowflake, branch, mat).rotation.z = i * Math.PI / 3;
  const shapes = { peak, snowflake, maple };
  parent.add(...Object.values(shapes));
  return shapes;
}

function helmetTrim(profile, start, end, minY, maxY, ribbon = false) {
  const columns = ribbon ? 84 : 18;
  const position = [], index = [];
  for (let j = 0; j <= 3; j++) for (let i = 0; i <= columns; i++) {
    const t = i / columns, angle = THREE.MathUtils.lerp(start, end, t);
    const turn = ribbon ? .96 + .04 * Math.cos(angle * 2) : Math.sin(Math.PI * t) ** .36;
    const y = (minY + maxY) * .5 + (maxY - minY) * (j / 3 - .5) * turn;
    const [w, d, z] = profileAt(profile, y);
    position.push(Math.sin(angle) * (w + .0021), y, z + Math.cos(angle) * (d + .0021));
    if (j < 3 && i < columns) {
      const a = j * (columns + 1) + i, b = a + columns + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

export function createSkier({
  jacket: jacketColor = 0x925041, pants: pantsColor = 0x2e3237,
  helmet: helmetColor = 0xddd9cc, backpack: backpackColor = 0x24282a, accessories = true,
  snowDetail = false, backpackModel: initialBackpackModel,
} = {}) {
  const group = new THREE.Group();
  group.name = 'Skier';
  const cloth = fabricMaps();
  const textile = (color, bumpScale = .0015) =>
    new THREE.MeshStandardMaterial({ color, vertexColors: true, ...cloth, bumpScale, roughness: .86 });
  const material = (color, roughness, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const fabricColor=new THREE.Color(jacketColor);
  const jacket=textile(fabricColor), shoulderPanel=textile(fabricColor.clone().multiplyScalar(.58));
  const stitch=textile(fabricColor.clone().multiplyScalar(.47),.0005), pants=textile(pantsColor);
  const seamThread = textile(fabricColor.clone().multiplyScalar(.8), .0005);
  const black = material(0x212426, .77), bootShell = material(0x38474f, .53, .1);
  const gloveBase = new THREE.Color(0x303536);
  const gloveLeather = material(gloveBase, .72), skin = material(0xc69b80, .76);
  const gaiter = textile(0x40484b, .001);
  const steel = material(0x9caab1, .36, .65), accent = material(0xdcaf6d, .6);
  const poleShaft = material(0xc8d5dc, .46, .19);
  const helmetMaterial = material(helmetColor, .46);
  const helmetDecalMaterial = material(0x364048, .64);

  const body = new THREE.Group();
  const torso = new THREE.Group();
  group.add(body);
  body.add(torso);
  put(body, shell([[-.13,.122,.097,-.018],[-.08,.168,.118,-.016],[.014,.166,.111,-.012],[.091,.148,.096,-.008]]), pants);

  const jacketProfile = [
    [-.093,.192,.136,-.029],[-.063,.198,.146,-.028],[-.022,.197,.148,-.025],[.055,.188,.145,-.026],
    [.116,.193,.134,-.022],[.181,.182,.127,-.018],[.241,.178,.115,-.012],
    [.302,.193,.126,-.011],[.363,.205,.138,-.006],[.426,.219,.132,.002],
    [.475,.218,.12,.006],[.52,.19,.105,.009],[.549,.135,.083,.012],[.573,.092,.075,.02],
  ];
  const jacketFront = (points, lift = .005) => {
    const path = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)));
    return path.getPoints(Math.max(8, points.length * 3)).map(({ x, y }) => {
      const [w, d, z] = profileAt(jacketProfile, y);
      return [x, y, z + Math.sqrt(Math.max(0, 1 - (x / w) ** 2)) * d + lift];
    });
  };
  const jacketMesh = put(torso, shapeJacket(shell(jacketProfile, .021, 40, true)), jacket);
  let rescueTrim;
  const jacketMarks = new Map();
  function patrolTrim() {
    const group = new THREE.Group();
    group.name = 'Patrol shell · high storm collar, bonded pockets and stitched crest';
    torso.add(group);
    const trim = material(0x272d31, .82);
    put(group, shell([[.535,.112,.103,.006],[.58,.114,.111,.009],[.627,.108,.102,.016],
      [.649,.099,.092,.019]], .018, 28), shoulderPanel);
    piping(group, trim, jacketFront([[-.184,.318],[-.092,.331],[0,.332],[.092,.331],[.184,.318]], .009), .0027);
    for (const side of [-1, 1]) {
      const start = side * .09;
      piping(group, trim, jacketFront([[start,.066],[side*.102,.158],[side*.112,.253],[side*.108,.310]], .009), .0044);
      rounded(group, black, .010,.024,.008, ...jacketFront([[side*.108,.287],[side*.108,.291]],.017)[0], .002);
    }
    return group;
  }
  put(torso, shell([[.495,.103,.082,-.058],[.54,.107,.094,-.067],[.603,.105,.096,-.056],[.657,.089,.083,-.017],[.688,.077,.069,.014]], .026), shoulderPanel);
  piping(torso, black, jacketFront([[0,-.065],[0,.115],[0,.24],[0,.36],[0,.48],[0,.563]], .0075), .0043);
  piping(torso, accent, jacketFront([[0,.475],[0,.499]], .012), .0037);
  for (const side of [-1, 1]) {
    piping(torso, stitch, [[side*.139,.128,-.111],[side*.146,.181,-.105],[side*.152,.314,-.102],[side*.187,.432,-.077]]);
    piping(torso, stitch, [[side*.04,.455,-.126],[side*.098,.452,-.119],[side*.156,.47,-.077],[side*.193,.49,-.034]], .0023);
    piping(torso, black, jacketFront([[side*.133,.108],[side*.103,.197],[side*.079,.251]], .006), .0027);
    piping(torso, seamThread, jacketFront([[side*.140,.11],[side*.108,.197],[side*.085,.253]], .006), .0011);
    piping(torso, accent, jacketFront([[side*.079,.24],[side*.076,.254]], .010), .0019);
  }

  const pack = accessories ? buildSkierBackpack(torso, {
    color: backpackColor, model: initialBackpackModel, textile, material, shell, put, piping, rounded,
    jacketFront, seamThread, black, bootShell, accent, decalShapes,
  }) : null;

  const head = new THREE.Group();
  head.position.set(0, .563, .015);
  torso.add(head);
  const skiHead = new THREE.Group();
  head.add(skiHead);
  let casualHead, hair, haircut = 'helmet', snowShoes = false;
  const face = new THREE.SphereGeometry(.095, 32, 24);
  face.scale(.84, 1.07, .90);
  put(skiHead, face, skin, 0, .109, .010);
  put(skiHead, shell([[-.003,.066,.066,.008],[.035,.079,.075,.011],
    [.068,.089,.083,.014],[.089,.09,.089,.019],[.111,.082,.093,.020],[.129,.067,.085,.019]], .024), gaiter);
  const helmetProfile = [
    [.104,.101,.108,-.015],[.117,.108,.114,-.012],[.151,.117,.123,-.009],
    [.185,.114,.123,-.014],[.215,.102,.113,-.016],[.243,.077,.083,-.018],
    [.259,.052,.055,-.016],[.267,.007,.008,-.013],
  ];
  put(skiHead, shell(helmetProfile, .002, 48), helmetMaterial);
  put(skiHead, helmetTrim(helmetProfile, .79, Math.PI * 2 - .79, .135, .158, true), black).castShadow = false;
  const rearDecal = new THREE.Group();
  rearDecal.position.set(.014, .186, -.143);
  rearDecal.rotation.set(-.24, Math.PI + .12, 0);
  rearDecal.scale.setScalar(.021);
  skiHead.add(rearDecal);
  const helmetDecals = decalShapes(rearDecal, helmetDecalMaterial);
  const goggles = buildSkiGoggles();
  skiHead.add(goggles.group);
  for (const side of [-1, 1]) {
    const ear = shell([[.052,.004,.011,-.012],[.063,.017,.027,-.014],[.093,.023,.035,-.02],
      [.131,.019,.038,-.023],[.157,.011,.031,-.023]], .008, 24);
    put(skiHead, ear, gaiter, side * .087);
    for (const [a, b, y] of [[.19,.88,.247],[1.27,1.9,.239],[2.06,2.63,.226],[2.53,2.94,.196]]) {
      const start = side > 0 ? a : -b, end = side > 0 ? b : -a;
      put(skiHead, helmetTrim(helmetProfile, start, end, y - .003, y + .003), black).castShadow = false;
    }
    piping(skiHead, gaiter, [[side*.061,.069,.071],[side*.045,.063,.092],[side*.019,.061,.101]], .0018);
  }
  rounded(skiHead, gaiter, .03, .025, .008, 0, .146, -.137, .0016);

  function buildCasualHead() {
    casualHead = new THREE.Group();
    casualHead.name = 'Uncovered head';
    casualHead.visible = false;
    head.add(casualHead);
    put(casualHead, face, skin, 0, .109, .01);
    const sphere = new THREE.SphereGeometry(1, 18, 12);
    const detail = (mat, x, y, z, sx, sy, sz) => {
      const mesh = put(casualHead, sphere, mat, x, y, z);
      mesh.scale.set(sx, sy, sz);
      return mesh;
    };
    const white = material(0xede7db, .72), iris = material(0x4f5549, .65);
    const lips = material(0x965b53, .75), eyebrows = material(0x593931, .90);
    detail(skin, 0, .109, .092, .015, .025, .020);
    detail(lips, 0, .064, .085, .021, .0038, .006);
    for (const side of [-1, 1]) {
      detail(skin, side * .075, .106, .004, .012, .024, .016);
      detail(white, side * .031, .132, .084, .015, .0065, .006);
      detail(iris, side * .030, .132, .089, .0058, .0056, .0026);
      detail(eyebrows, side * .033, .148, .082, .016, .0035, .004).rotation.z = side * -.12;
    }
    hair = put(casualHead, haircutMesh('part'), new THREE.MeshStandardMaterial({ color: 0x372c27, roughness: .86, vertexColors: true }));
    hair.name = 'Haircut';
  }

  let activeStyle = 'all-mountain', activeDeck = skiDeck(activeStyle);
  const skiContact = { start: activeDeck.profile[0][0], end: activeDeck.profile.at(-1)[0], profile: activeDeck.profile };
  let discipline = 'ski', boardStance = 'regular', boardId = DEFAULT_SNOWBOARD_ID;
  let activeBoard, boardMesh;
  const board = new THREE.Group();
  board.name = 'Snowboard';
  board.visible = false;
  group.add(board);
  const boardContact = {
    point: new THREE.Vector3(), axis: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0),
    start: 0, end: 0, compression: 0,
  };
  const decks = [];
  const snowCoats = [];
  const snowClump = snowDetail ? new THREE.IcosahedronGeometry(1, 1) : null;
  const trappedSnow = snowDetail ? material(0xe7f0f6, .93) : null;
  const arms = [], legs = [], helmetHands = [];
  const helmetGear = new THREE.Group();
  helmetGear.name = 'Helmet view arms';
  helmetGear.visible = false;
  group.add(helmetGear);
  const carriedSkis = new THREE.Group();
  carriedSkis.name = 'Skis carried on pack';
  carriedSkis.visible = false;
  body.add(carriedSkis);
  function addEquipment(equipment) {
    const deck = put(equipment, activeDeck.geometry, activeDeck.materials);
    deck.name = 'Ski topsheet, beveled sidewalls, steel edges, and running base';
    decks.push(deck);
    if (sharedBindings) {
      equipment.add(sharedBindings.clone(true));
      return;
    }
    // The left, right and carried skis all mount the same binding hardware.
    const bindings = new THREE.Group();
    bindings.name = 'Bindings';
    equipment.add(bindings);
    equipment = bindings;
    rounded(equipment, steel, .079, .018, .29, 0, .016, -.035, .0035);
    put(equipment, shell([[.016,.044,.039,0],[.023,.051,.046,0],[.057,.05,.044,-.005],
      [.074,.036,.034,-.006],[.077,.029,.028,-.008]], .0015, 26), black, 0, 0, -.24);
    put(equipment, shell([[.021,.051,.032,0],[.03,.057,.034,0],[.056,.052,.032,-.003],
      [.069,.042,.028,-.004],[.077,.032,.019,-.007]], .0015, 26), black, 0, 0, .153);
    rounded(equipment, accent, .056, .012, .033, 0, .075, .147, .003);
    rounded(equipment, black, .085, .017, .342, 0, .03, -.027, .003);
    for (const wing of [-1, 1]) {
      const toeWing = rounded(equipment, steel, .018, .036, .072, wing * .046, .061, .137, .004);
      toeWing.rotation.z = -wing * .17;
      rounded(equipment, bootShell, .022, .012, .044, wing * .045, .079, .14, .0033);
      for (const z of [-.269, .169]) {
        const screw = put(equipment, new THREE.CylinderGeometry(.006,.006,.002,12), steel, wing * .028, .075, z);
        rounded(screw, black, .007, .001, .0017, 0, .0012, 0, .0004);
      }
      piping(equipment, steel, [[wing*.038,.06,-.219],[wing*.055,.039,-.233],
        [wing*.069,.018,-.264],[wing*.07,.012,-.294]], .0038);
      rounded(equipment, black, .011, .01, .032, wing * .070, .013, -.287, .002);
    }
    const heelLever = rounded(equipment, bootShell, .071, .018, .074, 0, .08, -.245, .004);
    heelLever.rotation.x = -.23;
    rounded(equipment, steel, .042, .011, .022, 0, .091, -.261, .002);
    for (const z of [-.27, -.282, -.294]) rounded(equipment, black, .046, .003, .004, 0, .085, z, .001);
    rounded(equipment, steel, .028, .016, .003, 0, .049, -.286, .0012);
    // Include the recessed screw slots in the joint's material batches.
    for (const part of [...bindings.children]) {
      for (const detail of [...part.children]) bindings.attach(detail);
    }
    batchRigidParts(bindings);
    sharedBindings = bindings.clone(true);
  }
  for (const side of [-1, 1]) {
    const ski = new THREE.Group();
    group.add(ski);
    const equipment = new THREE.Group();
    equipment.name = 'Ski equipment';
    ski.add(equipment);
    addEquipment(equipment);
    if (snowDetail) {
      const dust = new THREE.InstancedMesh(snowClump, trappedSnow, 17);
      dust.name = 'Wind-packed crystals on ski tops';
      dust.count = 0;
      dust.frustumCulled = false;
      equipment.add(dust);
      const random = mulberry32(side === 1 ? 405 : 883);
      const grains = Array.from({length: 17}, (_, i) => ({
        fraction: i / 17, width: .62 * (random() * 2 - 1),
        zone: .08 + random() * .85, diameter: .009 + random() * .017, rotation: random() * 6.28,
      }));
      snowCoats.push({ dust, grains });
    }
    const carried = new THREE.Group();
    carried.position.set(side * .066, .23, -.319);
    carried.rotation.set(-Math.PI / 2, side * .035, side * .075);
    carriedSkis.add(carried);
    addEquipment(carried);
    const skiBoot = new THREE.Group();
    ski.add(skiBoot);
    const boot = put(skiBoot, shell([[.036,.058,.163,-.025],[.06,.067,.176,-.023],[.097,.067,.162,-.02],
      [.122,.064,.12,-.038],[.154,.065,.09,-.052],[.183,.062,.076,-.05]], .003, 36), bootShell);
    boot.name = 'Molded ski boot lower shell';
    put(skiBoot, shell([[.021,.060,.156,-.026],[.032,.067,.167,-.026],[.047,.065,.166,-.026]], .001), black);
    const cuff = new THREE.Group();
    cuff.position.set(0,.168,-.056);
    skiBoot.add(cuff);
    put(cuff, shell([[-.041,.06,.070,.002],[-.023,.068,.084,.002],[.02,.071,.081,.000],
      [.057,.071,.073,.002],[.086,.07,.071,.008],[.096,.066,.068,.013]], .005, 36), bootShell);
    put(cuff, shell([[.068,.065,.054,.008],[.091,.067,.063,.013],[.111,.058,.053,.017]], .009), gaiter);
    for (const edgeSide of [-1, 1]) {
      const rivet = put(cuff, new THREE.CylinderGeometry(.012,.012,.006,16), steel, edgeSide * .065, -.009, -.004);
      rivet.rotation.z = Math.PI / 2;
      piping(skiBoot, black, [[edgeSide*.060,.053,.093],[edgeSide*.066,.061,.018],[edgeSide*.062,.063,-.064]], .0022);
    }
    for (const [part, y, z] of [[skiBoot,.099,.113],[skiBoot,.127,.064],[cuff,.018,.077],[cuff,.064,.075]]) {
      const strap = piping(part, black, [[-side*.051,y-.015,z-.04],[0,y,z],[side*.051,y-.018,z-.041]], .0053);
      strap.name = 'Boot buckle ladder';
      const buckle = rounded(part, steel, .032, .012, .023, side * .038, y - .004, z - .008, .0028);
      buckle.rotation.z = -side * .3;
      rounded(buckle, black, .014, .0027, .013, .003, .006, .001, .0007);
    }

    const trousers = jointGarment(group, pants, { side });
    legs.push({ side, ski, equipment, trousers, cuff, skiBoot });

    const shoulder = new THREE.Group();
    shoulder.position.set(side * .205, .454, -.006);
    torso.add(shoulder);
    const sleeve = jointGarment(shoulder, jacket, {
      name: 'Continuous articulated jacket sleeve', topOverlap: .036, bottomOverlap: .012, sleeve: true, side,
      profile: [[0,.038,.046],[.08,.080,.085],[.18,.091,.094],[.3,.085,.087],
        [.4,.078,.082],[.5,.075,.077],[.6,.072,.077],[.75,.065,.068],[.9,.055,.061],[1,.048,.051]],
    });
    piping(shoulder, seamThread, [[side*.066,-.237,.022],[side*.074,-.177,.026],
      [side*.074,-.127,.031],[side*.078,-.051,.034],[side*.069,.009,.046]], .0018);
    piping(shoulder, shoulderPanel, [[side*.055,-.108,-.047],[side*.06,-.07,-.05],
      [side*.058,-.021,-.053]], .0025);
    const elbow = new THREE.Group();
    elbow.position.set(0, -.303, .009);
    shoulder.add(elbow);
    // Glove gauntlets enter the sleeve; the rolled cuff sits outside both.
    // There is no exposed end cap or coplanar ring to split at the wrist.
    put(elbow, shell([[-.368,.025,.028,.019],[-.355,.037,.041,.02],[-.32,.043,.044,.018],
      [-.285,.041,.044,.012],[-.25,.04,.041,.004],[-.229,.034,.034,.003]], .017), gloveLeather);
    put(elbow, shell([[-.283,.048,.052,.001],[-.274,.052,.055,.001],[-.248,.055,.057,.001],
      [-.239,.052,.055,.001]], .008), shoulderPanel);
    const thumb = new THREE.SphereGeometry(1, 18, 12);
    thumb.scale(.022, .038, .026);
    const gloveThumb = put(elbow, thumb, gloveLeather, -side * .035, -.316, .042);
    gloveThumb.rotation.z = -side * .35;
    piping(elbow, black, [[-side*.032,-.347,.047],[0,-.351,.06],[side*.028,-.34,.048]], .0016);
    const gloveDetails = new THREE.Group();
    elbow.add(gloveDetails);
    for (const [i, x] of [-.025, -.007, .011, .029].entries()) {
      const knuckle = rounded(gloveDetails, gaiter, .013, .019 - i * .0018, .009,
        x * side, -.323 + i * .0028, .059 - Math.abs(x) * .16, .0029);
      knuckle.rotation.x = -.12;
    }
    piping(elbow, seamThread, [[side*.048,-.247,.022],[side*.056,-.177,.027],
      [side*.061,-.1,.028],[side*.061,-.036,.026]], .0017);
    block(elbow, black, .024, .015, .007, side * .029, -.262, .048);
    const pole = new THREE.Group();
    pole.name = 'Ski pole';
    pole.position.set(0, -.329, .023);
    elbow.add(pole);
    put(pole, new THREE.CylinderGeometry(.007,.0048,1.172,12), poleShaft, 0,-.52,0);
    put(pole, new THREE.CylinderGeometry(.009,.009,.12,12), accent, 0,-.22,0);
    put(pole, new THREE.CylinderGeometry(.012,.010,.12,14), black, 0,.04,0);
    put(pole, new THREE.CylinderGeometry(.030,.027,.006,12), black, 0,-1.02,0);
    put(pole, new THREE.CylinderGeometry(.003,.0015,.043,8), steel, 0,-1.10,0);
    piping(pole, gaiter, [[-.007,.084,0],[-.023,.047,-.025],[-.023,.01,-.024],[-.007,.008,-.003]], .0035);
    arms.push({ side, shoulder, elbow, pole, sleeve });
    // Share the glove, cuff and pole meshes with the close view. The two skis
    // themselves remain the actual planted equipment in both views.
    const hand = new THREE.Group();
    // The gauntlet, trim, thumb and knuckle panels are shared in both views.
    // The elbow also owns seams running up the third-person sleeve.
    for (const part of elbow.children.slice(0,5)) hand.add(part.clone());
    hand.name = side < 0 ? 'Right helmet view glove' : 'Left helmet view glove';
    const closePole=pole.clone(true);
    closePole.name = 'Helmet view ski pole';
    hand.add(closePole);
    const forearm = put(helmetGear, shapeHelmetSleeve(shell([[-1,.043,.047,0],[-.985,.050,.051,0],[-.95,.050,.053,0],
      [-.93,.045,.049,0],[-.88,.057,.059,0],[-.81,.061,.057,.006],[-.77,.054,.058,.008],
      [-.69,.065,.061,.015],[-.62,.063,.061,.021],[-.51,.068,.067,.035],
      [-.43,.079,.074,.044],[-.35,.084,.071,.040],[-.25,.077,.079,.026],
      [-.10,.082,.078,.013],[0,.087,.082,0]],.062,22), side), jacket);
    forearm.name = 'Helmet view jacket sleeve';
    helmetGear.add(hand);
    helmetHands.push({ hand, side, pole: closePole, forearm });
  }

  function buildBoardHardware() {
    for (const leg of legs) {
      const boot = leg.boardBoot = new THREE.Group();
      boot.name = 'Soft snowboard boot';
      leg.ski.add(boot);
      boot.visible = false;
      put(boot, shell([[.015,.057,.152,-.009],[.028,.063,.16,-.009],[.042,.065,.16,-.009]], .005), black);
      put(boot, shell([[.038,.061,.15,-.006],[.063,.063,.146,-.009],[.089,.063,.13,-.016],
        [.13,.057,.105,-.033],[.167,.057,.078,-.044],[.207,.059,.069,-.039],[.242,.057,.057,-.035]], .012), gaiter);
      rounded(boot, bootShell, .081, .054, .065, 0, .209, .003, .016).rotation.x = -.34;
      rounded(boot, bootShell, .11, .047, .074, 0, .056, .099, .016).rotation.x = -.20;
      for (let i = 0; i < 5; i++) {
        const y = .086 + i * .026, z = .096 - i * .02;
        piping(boot, accent, [[-.032,y-.006,z],[.031,y+.012,z-.013]], .0025);
        piping(boot, black, [[.032,y,z],[-.031,y+.012,z-.013]], .0019);
      }
      const binding = leg.boardBinding = new THREE.Group();
      binding.name = leg.side > 0 ? 'Left snowboard binding' : 'Right snowboard binding';
      board.add(binding);
      rounded(binding, black, .147, .023, .303, 0, .013, -.013, .008);
      rounded(binding, steel, .101, .012, .063, 0, .024, .097, .004);
      const highback = rounded(binding, bootShell, .114, .194, .022, 0, .124, -.155, .02);
      highback.rotation.x = -.15;
      for (const wing of [-1, 1]) {
        piping(binding, bootShell, [[wing*.055,.123,-.15],[wing*.071,.051,-.144],
          [wing*.073,.035,-.069],[wing*.069,.031,.075]], .010);
      }
      const straps = leg.boardStraps = new THREE.Group();
      binding.add(straps);
      for (const [y, z, width] of [[.168,-.018,.036],[.091,.094,.027]]) {
        for (const offset of [-width * .3, width * .3]) {
          piping(straps, bootShell, [[-.069,.049,z+offset],[-.047,y-.03,z+offset],[0,y,z+offset],
            [.047,y-.028,z+offset],[.069,.047,z+offset]], width * .28);
        }
        rounded(straps, steel, .029, .013, width, leg.side * .048, y-.025, z, .0035).rotation.z = -leg.side * .45;
      }
      batchRigidParts(binding);
      batchRigidParts(straps);
      batchRigidParts(boot);
    }
  }

  function setEquipment({ discipline: kind, skiModel, snowboardModel, stance, skis, snowboard } = {}) {
    if (kind !== undefined) discipline = kind === 'snowboard' ? 'snowboard' : 'ski';
    if (stance !== undefined) boardStance = stance === 'goofy' ? 'goofy' : 'regular';
    const requestedSki = (skiModel?.id ?? skiModel) ?? skis;
    if (isSkiStyle(requestedSki) && activeStyle !== requestedSki) {
      activeStyle = requestedSki;
      activeDeck = skiDeck(activeStyle);
      skiContact.start = activeDeck.profile[0][0];
      skiContact.end = activeDeck.profile.at(-1)[0];
      skiContact.profile = activeDeck.profile;
      const snow = snowCoverage;
      snowCoverage = -1;
      setSkiSnow(Math.max(0, snow));
      for (const deck of decks) {
        deck.geometry = activeDeck.geometry;
        deck.material = activeDeck.materials;
      }
    }
    const requestedBoard = (snowboardModel?.id ?? snowboardModel) ?? snowboard;
    if (Object.hasOwn(SNOWBOARD_MODELS, requestedBoard)) boardId = requestedBoard;
    if (discipline !== 'snowboard' && !boardMesh) return;
    if (activeBoard?.model.id === boardId) return;
    activeBoard = snowboardDeck(boardId);
    boardContact.start = activeBoard.profile[0][0];
    boardContact.end = activeBoard.profile.at(-1)[0];
    boardContact.profile = activeBoard.profile;
    if (boardMesh) {
      boardMesh.geometry = activeBoard.geometry;
      boardMesh.material = activeBoard.materials;
    } else {
      boardMesh = put(board, activeBoard.geometry, activeBoard.materials);
      boardMesh.name = 'Snowboard topsheet, beveled sidewalls, steel edges, and running base';
      buildBoardHardware();
    }
    board.userData.labelPoint = new THREE.Vector3(0, .025, boardContact.end * .68);
  }

  const hip = new THREE.Vector3(), ankle = new THREE.Vector3(), knee = new THREE.Vector3();
  const direction = new THREE.Vector3(), bend = new THREE.Vector3();
  const frameMatrix = new THREE.Matrix4(), inverseFrame = new THREE.Matrix4();
  const frameRotation = new THREE.Quaternion(), inverseRotation = new THREE.Quaternion();
  const skiRotation = new THREE.Quaternion(), edgeRotation = new THREE.Quaternion();
  const skiCenter = new THREE.Vector3(), tipDirection = new THREE.Vector3();
  const crossDirection = new THREE.Vector3(), groundNormal = new THREE.Vector3();
  const sample = new THREE.Vector3(), skiBasis = new THREE.Matrix4();
  const skiForward = new THREE.Vector3(0, 0, 1);
  const contactPoints = legs.map(() => new THREE.Vector3());
  const skiAxes = legs.map(() => new THREE.Vector3(0, 0, 1));
  const skiRights = legs.map(() => new THREE.Vector3(1, 0, 0));
  const skiSink = [0, 0], skiPlanted = [false, false];
  const snowPoint = new THREE.Object3D();
  let snowCoverage = -1;

  function setSkiSnow(amount) {
    if (!snowCoats.length || Math.abs(amount - snowCoverage) < .008) return;
    snowCoverage = amount;
    for (const { dust, grains } of snowCoats) {
      const sections = activeDeck.profile;
      const base = sections[0][0], length = sections.at(-1)[0] - base;
      let count = 0;
      for (const grain of grains) {
        if (grain.fraction >= amount) break;
        const z = base + grain.zone * length;
        const index = sections.findIndex(section => section[0] >= z);
        const first = sections[index - 1], second = sections[index];
        const t = (z - first[0]) / (second[0] - first[0]);
        const width = first[1] + (second[1] - first[1]) * t;
        const rocker = first[2] + (second[2] - first[2]) * t;
        const size = grain.diameter * clamp((amount - grain.fraction) * 5, .22, 1.2);
        snowPoint.position.set(grain.width * width, rocker + .003, z);
        snowPoint.rotation.y = grain.rotation;
        snowPoint.scale.set(size * .8, size * .19, size * 1.46);
        snowPoint.updateMatrix();
        dust.setMatrixAt(count++, snowPoint.matrix);
      }
      dust.count = count;
      dust.visible = count > 0;
      dust.instanceMatrix.needsUpdate = true;
    }
  }

  function plantRunner(ski, groundHeight, edgeAngle, footMode, sink, stairTreadAt, profile = activeDeck.profile) {
    skiCenter.copy(ski.position).applyMatrix4(frameMatrix);
    const tread = stairTreadAt?.(skiCenter.x, skiCenter.z);
    tipDirection.copy(skiForward).applyQuaternion(ski.quaternion).applyQuaternion(frameRotation);
    tipDirection.y = 0;
    tipDirection.normalize();
    crossDirection.set(tipDirection.z, 0, -tipDirection.x);
    const gradient = (axis, range) => (
      groundHeight(skiCenter.x + axis.x * range, skiCenter.z + axis.z * range)
      - groundHeight(skiCenter.x - axis.x * range, skiCenter.z - axis.z * range)
    ) / (range * 2);
    const contactRange = (profile.at(-1)[0] - profile[0][0]) * .375;
    tipDirection.y = tread == null ? gradient(tipDirection, footMode ? .13 : contactRange) : 0;
    crossDirection.y = tread == null ? gradient(crossDirection, .10) : 0;
    tipDirection.normalize();
    groundNormal.crossVectors(tipDirection, crossDirection).normalize();
    crossDirection.crossVectors(groundNormal, tipDirection).normalize();
    skiBasis.makeBasis(crossDirection, groundNormal, tipDirection);
    skiRotation.setFromRotationMatrix(skiBasis)
      .multiply(edgeRotation.setFromAxisAngle(skiForward, edgeAngle));

    // Support the base on the highest point beneath either metal edge.
    // The raised shovel and tail ride above this contact on level snow.
    let support = -Infinity;
    for (const [z, width, y] of (footMode ? bootContactProfile : profile)) {
      for (const side of skiEdges) {
        sample.set(side * width, y - baseThickness, z).applyQuaternion(skiRotation);
        support = Math.max(support, (tread ?? groundHeight(skiCenter.x + sample.x, skiCenter.z + sample.z)) - sample.y);
      }
    }
    skiCenter.y = support + .002 - sink;
    ski.position.copy(skiCenter).applyMatrix4(inverseFrame);
    ski.quaternion.copy(inverseRotation).multiply(skiRotation);
  }

  let lean = 0, crouch = .2, airtuck = 0, phase = 0, windPhase = 0, wind = 0, switchLook = 0;
  let powderTurn = 0, powderFlex = 0;
  const sleeveStart = new THREE.Vector3(0, .012, .008), sleeveEnd = new THREE.Vector3();
  const armRotation = new THREE.Quaternion(), poleTarget = new THREE.Quaternion();
  // Ski planting still needs the frame inverse after the arms are posed.
  const inverseJoint = new THREE.Matrix4();
  const poleDirection = new THREE.Vector3(), poleGrip = new THREE.Vector3(), poleTip = new THREE.Vector3();
  const cuffRotation = new THREE.Quaternion();
  const boardTilt = new THREE.Quaternion(), bindingYaw = new THREE.Quaternion();
  const boardEyes = new THREE.Vector3(), boardEyeLocal = new THREE.Vector3();
  function animate(dt, params, groundHeight) {
    const { speed = 0, steer = 0, tuck = 0, brake = 0, airborne = false, grab = 0, crash = false, crashTime = 0,
      stride = 0, stridePhase = 0, climb = 0, footMode = false, walk = 0, snowSink = 0,
      walkStride = .49, walkDirection = 1, switchStance = false, switchSide = 1, stairTreadAt, mount, display = false,
      powder = 0, landingLoad = 0, stop = 0, stopSign = 1, skiYaw = 0, poleSwing = -1, poleSide = 1,
      boardEdge = 0, boardOneFoot = 0, boardGroundSink = snowSink } = params;
    const snowboarder = discipline === 'snowboard';
    const onBoard = snowboarder && !footMode && !mount;
    const front = frontBindingSide(boardStance);
    if (groundHeight) {
      frameMatrix.copy(group.parent.matrix);
      inverseFrame.copy(frameMatrix).invert();
      frameRotation.copy(group.parent.quaternion);
      inverseRotation.copy(frameRotation).invert();
    }
    const sf = clamp(speed / 36, 0, 1);
    carriedSkis.visible = !snowboarder && footMode && !mount && !display;
    board.visible = snowboarder && !mount && (!display || !footMode);
    if (casualHead) {
      casualHead.visible = footMode && haircut !== 'helmet';
      skiHead.visible = !casualHead.visible;
    }
    const edgeLoad = footMode || airborne || crash ? 0 : clamp((speed - 1.4) / 10, 0, 1);
    const stanceSteer = steer * (switchStance ? -1 : 1);
    const deep = clamp((powder - .32) / .53, 0, 1);
    const powderEdge = groundHeight && !footMode && !airborne && !crash ? deep : 0;
    powderTurn = damp(powderTurn, powderEdge * edgeLoad * (stanceSteer * (1 - stop) + stopSign * stop * .68), 11, dt);
    powderFlex = damp(powderFlex, powderEdge * clamp(edgeLoad * .24 + Math.abs(powderTurn) * .52 + landingLoad * .68, 0, 1),
      landingLoad > .2 ? 17 : 9, dt);
    const steerLean = stanceSteer * edgeLoad * (.38 + sf * .49);
    lean = damp(lean, steerLean * (1 - .23 * brake) + powderTurn * .28, 8, dt);
    switchLook = damp(switchLook, switchStance && !airborne && !crash ? switchSide : 0, 8, dt);
    const racingTuck = airborne || crash || footMode ? 0 : clamp(tuck, 0, 1);
    const gait = airborne || crash ? 0 : footMode ? walk : stride;
    const relaxedCrouch = footMode ? .025 + gait * .075
      : Math.min(.96, .25 + sf * .31 + gait * .07 + stop * .24 + powderFlex * .42);
    crouch = damp(crouch, airborne ? .57 + grab * .28 : relaxedCrouch + (.94 - relaxedCrouch) * racingTuck,
      landingLoad > .2 && powderEdge > .15 ? 17 : 8, dt);
    airtuck = damp(airtuck, airborne ? 1 : 0, 7, dt);
    phase += dt * (1.7 + sf * 3.5);
    windPhase += dt * (3.6 + sf * 8.2);
    wind = .52 + sf * .48 + .16 * Math.sin(phase * .56);
    const breath = Math.sin(phase * .94) * (1 - sf * .42) * (1 - airtuck * .6);
    const stepBob = -Math.cos(stridePhase * 2) * gait * (footMode ? .024 : .017);
    body.position.set(-lean * .36 - powderTurn * .075,
      .944 - crouch * .238 - Math.abs(lean) * .12 - powderFlex * .13 + stepBob + breath * .0039,
      footMode ? -.026 : -.104 - crouch * .129 + racingTuck * .042 - powderFlex * .033);
    body.rotation.set(crash ? .38 + Math.sin(crashTime * 8) * .15 : 0, 0, lean * .78, 'XYZ');
    // Stabilize the chest and gaze above the hips, then fold forward for a race tuck.
    torso.rotation.set((footMode ? .025 : .139) + crouch * .52 + racingTuck * .52 + breath * .005,
      -steer * .15 * (1 - racingTuck * .75) + .68 * switchLook - powderTurn * .18,
      -lean * .22 - powderTurn * .08);
    head.rotation.set((footMode ? -.025 : -.09) - crouch * .35 - racingTuck * .32 + breath * .011,
      -steer * .16 + 1.15 * switchLook, -lean * .42);
    if (onBoard) {
      const edge = boardEdge / .82;
      const lead = switchStance ? -1 : 1;
      body.position.set(-edge * .31, .94 - crouch * .24 - Math.abs(edge) * .10 - grab * airtuck * .10 - powderFlex * .10,
        lead * (.031 + steer * .021) + boardOneFoot * .12);
      body.rotation.set(-.12 * front * lead, -.5 * Math.PI * front, boardEdge * .67 + (crash ? .34 : 0), 'ZYX');
      torso.rotation.set(.07 + crouch * .22 + racingTuck * .45 + grab * airtuck * .56,
        front * lead * (.24 + racingTuck * .22) - steer * .17, -.08 * front * lead);
      head.rotation.set(-.03 - crouch * .11 - racingTuck * .25, front * lead * (.92 - racingTuck * .12), -.1 * edge);
    }
    if (mount) {
      body.position.set(0, mount.hipY, mount.hipZ);
      body.rotation.set(0, 0, 0);
      torso.rotation.set(mount.hinge, 0, 0);
      head.rotation.set(-mount.hinge * .68, mount.gaze ?? 0, 0);
    }
    jacketMesh.morphTargetInfluences[0] = .52 + breath * .44;
    jacketMesh.morphTargetInfluences[1] = .12 + .32 * crouch + .54 * racingTuck;
    jacketMesh.morphTargetInfluences[2] = wind * (.58 * Math.sin(windPhase * .71) + .22 * Math.sin(windPhase * 1.71 + .8));
    jacketMesh.morphTargetInfluences[3] = wind * (.67 * Math.sin(windPhase * 1.94) + .21 * Math.cos(windPhase * 2.7));
    body.updateMatrix();
    torso.updateMatrix();
    if (onBoard) {
      head.updateMatrix();
      boardEyeLocal.set(0, .134, .122).applyMatrix4(head.matrix).applyMatrix4(torso.matrix).applyMatrix4(body.matrix);
      boardEyes.copy(boardEyeLocal).applyMatrix4(group.parent.matrix);
    }
    if (board.visible) {
      if (onBoard) {
        board.position.set(0, .018 + airtuck * (.08 + grab * .15), 0);
        board.rotation.set(airtuck * (.12 - grab * .25), 0, groundHeight ? 0 : boardEdge);
        boardContact.compression = groundHeight ? snowSink : 0;
        if (groundHeight) plantRunner(board, groundHeight, boardEdge, false, boardGroundSink, null, activeBoard.profile);
      } else {
        board.position.set(0, .21, -.405).applyMatrix4(body.matrix);
        board.rotation.set(-1.46, .14 * front, .25 * front);
        boardTilt.copy(board.quaternion);
        board.quaternion.copy(body.quaternion).multiply(boardTilt);
      }
      board.updateMatrix();
      if (onBoard) {
        const parentMatrix = group.parent.matrix;
        const parentRotation = group.parent.quaternion;
        boardContact.point.set(0, -baseThickness, 0).applyMatrix4(board.matrix).applyMatrix4(parentMatrix);
        boardContact.axis.copy(skiForward).applyQuaternion(board.quaternion).applyQuaternion(parentRotation);
        boardContact.right.set(1, 0, 0).applyQuaternion(board.quaternion).applyQuaternion(parentRotation);
      }
    }
    for (const { side, shoulder, elbow, pole, sleeve } of arms) {
      const swing = Math.sin(phase + side * 1.57) * (.025 + sf * .065);
      // Recover the opposite pole as the supporting ski pushes back.
      const poleCycle = stridePhase + (side < 0 ? Math.PI : 0);
      const polePlant = Math.sin(poleCycle - (footMode ? 0 : .71)) * gait;
      const planting = Math.max(0, Math.cos(poleCycle - .55)) * gait;
      const sweep = side === poleSide && poleSwing >= 0 ? Math.sin(poleSwing * Math.PI) : 0;
      const flick = sweep * Math.cos((poleSwing - .2) * Math.PI * 1.1);
      const outside = side * lean;
      const insideReach = Math.max(0, -side * powderTurn);
      const reach = Math.max(0, outside) * (1 - racingTuck) * 1.16;
      shoulder.rotation.set(
        (-(footMode ? .16 : .36) - crouch * .43 + swing + outside * .41) * (1 - racingTuck)
          - .34 * racingTuck + polePlant * (footMode ? .48 : .64) - flick * .52 - insideReach * .37,
        -side * (.08 + racingTuck * .20) + side * sweep * .44,
        side * (.19 * (1 - racingTuck) - .04 * racingTuck + airtuck * .54 + reach + sweep * .69) - lean * .24,
      );
      elbow.rotation.x = (-.66 + crouch * .17 - grab * .35 - outside * .29) * (1 - racingTuck)
        - 2.44 * racingTuck - gait * .22 - planting * .24 - flick * .38;
      if (onBoard) {
        const leading = side === front * (switchStance ? -1 : 1);
        shoulder.rotation.set(-.34 + .27 * Number(leading) - racingTuck * .58 + swing - grab * airtuck * .31,
          -side * (.1 + .28 * grab * airtuck), side * (.55 + Math.abs(boardEdge) * .31 - racingTuck * .23 - grab * airtuck * .29));
        elbow.rotation.set(-.32 - racingTuck * .63 + .16 * grab * airtuck, 0, side * .08);
      } else if (!mount) elbow.rotation.y = elbow.rotation.z = 0;
      if (mount) {
        const [gripX, gripY, gripZ] = mount.grip;
        poleGrip.set(side * gripX, gripY, gripZ);
        poleGrip.applyMatrix4(inverseJoint.copy(body.matrix).invert())
          .applyMatrix4(inverseJoint.copy(torso.matrix).invert()).sub(shoulder.position);
        const reach = clamp(poleGrip.length(), .14, .625);
        const forearm = .328, upper = Math.hypot(.303, .009);
        poleGrip.normalize();
        const along = (upper * upper + reach * reach - forearm * forearm) / (2 * reach);
        poleTip.set(side * .25, -1, 0).addScaledVector(poleGrip, -poleTip.dot(poleGrip)).normalize()
          .multiplyScalar(Math.sqrt(Math.max(0, upper * upper - along * along))).addScaledVector(poleGrip, along);
        shoulder.quaternion.setFromUnitVectors(poleDirection.copy(elbow.position).normalize(), direction.copy(poleTip).normalize());
        poleDirection.copy(poleGrip).multiplyScalar(reach).sub(poleTip).normalize()
          .applyQuaternion(armRotation.copy(shoulder.quaternion).invert());
        elbow.quaternion.setFromUnitVectors(down, poleDirection);
      }
      elbow.updateMatrix();
      sleeveEnd.set(0, -.257, .003).applyMatrix4(elbow.matrix);
      if (body.visible) sleeve.update(sleeveStart, elbow.position, sleeveEnd, windPhase, wind);
      pole.visible = !snowboarder && !mount && !display;
      if (!pole.visible) continue;
      // Keep the shaft trailing independently of forearm flex, and let the pole
      // trail further if its unadjusted tip would pass through the snow.
      poleDirection.set(side * (.23 + sf * .09) * (1 - racingTuck) + side * sweep * 1.48,
        -1 + racingTuck * .91 + sweep * .78,
        (footMode ? -.34 : (-.37 - sf * .45) * (1 - 2 * Math.abs(switchLook)))
          - racingTuck * .34 + polePlant * .78 + sweep * .92).normalize();
      if (groundHeight) {
        shoulder.updateMatrix();
        poleGrip.copy(pole.position).applyMatrix4(elbow.matrix).applyMatrix4(shoulder.matrix)
          .applyMatrix4(torso.matrix).applyMatrix4(body.matrix).applyMatrix4(frameMatrix);
        poleDirection.applyQuaternion(frameRotation);
        for (let i = 0; i < 2; i++) {
          poleTip.copy(poleGrip).addScaledVector(poleDirection, 1.122);
          const clearance = poleTip.y - groundHeight(poleTip.x, poleTip.z);
          if (clearance >= .005) break;
          const heading = Math.atan2(poleDirection.x, poleDirection.z);
          const drop = clamp(poleDirection.y + (.005 - clearance) / 1.122, -.993, 1);
          const horizontal = Math.sqrt(1 - drop * drop);
          poleDirection.set(Math.sin(heading) * horizontal, drop, Math.cos(heading) * horizontal);
        }
        poleDirection.applyQuaternion(inverseRotation);
      }
      armRotation.copy(body.quaternion).multiply(torso.quaternion)
        .multiply(shoulder.quaternion).multiply(elbow.quaternion).invert();
      poleTarget.setFromUnitVectors(down, poleDirection);
      pole.quaternion.copy(armRotation).multiply(poleTarget);
    }
    for (const [i, { side, ski, equipment, trousers, cuff, skiBoot, walkShoe, boardBoot, boardBinding, boardStraps }] of legs.entries()) {
      equipment.visible = !snowboarder && !footMode && (!mount || !!mount.skis);
      const showSnowshoe = footMode && snowShoes;
      if (walkShoe) walkShoe.visible = showSnowshoe;
      skiBoot.visible = !snowboarder && !showSnowshoe;
      if (boardBoot) boardBoot.visible = snowboarder && !showSnowshoe;
      const cycle = stridePhase + (side < 0 ? Math.PI : 0);
      const walkPhase = ((cycle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / Math.PI;
      const step = footMode ? (walkPhase < 1 ? 1 - 2 * walkPhase : -Math.cos((walkPhase - 1) * Math.PI)) : Math.sin(cycle);
      const recovery = footMode ? (walkPhase < 1 ? 0 : Math.sin((walkPhase - 1) * Math.PI)) : Math.max(0, Math.cos(cycle));
      const skating = footMode ? 0 : gait * (1 - climb);
      // Flex the inside knee and lead with its ski. Both skis still use the same
      // terrain contact solver, including under the more heavily loaded edge.
      const skiLead = -side * powderTurn * .21 * (1 - 2 * Math.abs(switchLook)) * (1 - gait);
      const stanceWidth = (footMode ? .135 : .21 - stop * .063 + Math.abs(powderTurn) * .05)
        + brake * .09 * (1 - stop) + skating * (.035 + recovery * .105);
      ski.position.set(side * stanceWidth, .018 + airtuck * .065,
        airtuck * .07 * side + skiLead + step * gait * (footMode ? walkStride * .5 * walkDirection : .23 + climb * .09));
      if (stop > .002) ski.position.applyAxisAngle(up, skiYaw);
      const edge = footMode ? 0 : clamp(lean * .96 * (1 - stop) + stopSign * stop * .48 + powderTurn * .10, -.91, .91);
      ski.rotation.set(-airtuck * .06, skiYaw - side * brake * .25 * (1-stop) - steer * (footMode ? .025 : .072)
        + side * skating * (.12 + recovery * .14) - powderTurn * .087, groundHeight ? 0 : edge);
      const stepLift = recovery * gait * (footMode ? .105 : .035 + climb * .065);
      if (mount) {
        ski.position.copy(mount.feet[i]);
        ski.rotation.set(-.04, 0, 0);
      }
      // The outside ski carries the turn. A recovering ski first unloads
      // the loose layer, then rises clear of the uncompressed snow surface.
      const loadedDepth = groundHeight && !footMode
        ? snowSink * (1 + side * (stanceSteer * sf * .32 + powderTurn * .15)) * (1 - recovery * gait) : 0;
      skiSink[i] = onBoard ? 0 : Math.max(0, loadedDepth - stepLift);
      skiPlanted[i] = !!groundHeight && !footMode && !onBoard && stepLift < loadedDepth + .004;
      if (groundHeight && !onBoard) {
        plantRunner(ski, groundHeight, edge, footMode, loadedDepth, stairTreadAt);
        // Lift only the recovering ski; the other remains supported by its base.
        // Up is transformed into the model frame so lift stays vertical on slopes.
        sample.set(0, stepLift, 0).applyQuaternion(inverseRotation);
        ski.position.add(sample);
      }
      if (boardBinding) {
        const leading = side === front;
        const offset = activeBoard.model.stanceWidthCm * .005;
        const duckAngle = leading ? .274 : boardId === DEFAULT_SNOWBOARD_ID ? -.196 : -.065;
        const yaw = front * (-Math.PI * .5 + duckAngle);
        boardBinding.position.set(0, .004, leading ? offset : -offset);
        boardBinding.rotation.y = yaw;
        const freeFoot = onBoard && !leading ? boardOneFoot : 0;
        boardStraps.rotation.x = freeFoot * -.54;
        if (onBoard) {
          ski.position.copy(boardBinding.position);
          ski.position.y += .013;
          ski.position.applyMatrix4(board.matrix);
          ski.quaternion.copy(board.quaternion).multiply(bindingYaw.setFromAxisAngle(up, yaw));
          if (freeFoot > .01) {
            const pushPhase = Math.sin(stridePhase);
            ski.position.x -= front * .34 * freeFoot;
            ski.position.z += (.12 + pushPhase * .30) * freeFoot;
            if (groundHeight) {
              plantRunner(ski, groundHeight, 0, true, 0);
              sample.set(0, .055 * Math.max(0, -pushPhase) * freeFoot, 0).applyQuaternion(inverseRotation);
              ski.position.add(sample);
            }
          }
        }
      }
      ski.updateMatrix();
      contactPoints[i].set(0, -baseThickness, 0).applyMatrix4(ski.matrix).applyMatrix4(group.parent.matrix);
      skiAxes[i].copy(skiForward).applyQuaternion(ski.quaternion).applyQuaternion(group.parent.quaternion);
      skiRights[i].set(1, 0, 0).applyQuaternion(ski.quaternion).applyQuaternion(group.parent.quaternion);
      hip.set(side * .127, -.014, .023).applyMatrix4(body.matrix);
      ankle.set(0, snowboarder ? .204 : .232, -.058).applyMatrix4(ski.matrix);
      direction.subVectors(ankle, hip);
      const gap = direction.length();
      direction.normalize();
      if (onBoard) bend.set(0, 0, 1).applyQuaternion(ski.quaternion);
      else bend.set(side * .10 - lean * .65, 0, 1);
      bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      knee.copy(hip).lerp(ankle, .49).addScaledVector(bend,
        Math.sqrt(Math.max(.016 ** 2, .365 ** 2 - (gap * .5) ** 2)));
      // The cuff flexes around the ankle rivets while the boot sole stays fixed.
      bend.subVectors(knee, ankle).applyQuaternion(cuffRotation.copy(ski.quaternion).invert());
      cuff.rotation.x = clamp(Math.atan2(bend.z, bend.y) * .53, -.06, .34);
      cuff.updateMatrix();
      if (snowboarder) ankle.set(0, .234, -.040).applyMatrix4(ski.matrix);
      else ankle.set(0, .087, .011).applyMatrix4(cuff.matrix).applyMatrix4(ski.matrix);
      if (trousers.mesh.visible) trousers.update(hip, knee, ankle, windPhase, wind);
    }
  }

  function showHelmetGear(on, player) {
    const snowboarder = discipline === 'snowboard';
    const onBoard = snowboarder && !player.footMode;
    body.visible = !on;
    head.visible = !on;
    for (const leg of legs) leg.trousers.mesh.visible = !on || onBoard;
    helmetGear.visible = on;
    if (on && player.footMode) {
      for (const { equipment } of legs) equipment.visible = false;
      board.visible = false;
    }
    helmetGear.rotation.y = player.switchStance ? Math.PI : 0;
    if (!helmetGear.visible) return;
    if (onBoard) helmetGear.position.copy(boardEyeLocal);
    else helmetGear.position.set(0, 0, 0);
    const front = frontBindingSide(boardStance) * (player.switchStance ? -1 : 1);
    const boardEdge = player.boardEdge ?? 0;
    for (const { hand, side, pole, forearm } of helmetHands) {
      const plant = Math.sin(player.stridePhase + (side < 0 ? Math.PI : 0))
        * (player.footMode ? player.walkAmount * .77 : player.strideAmount);
      hand.position.set(side * (.54 - player.tuckAmount * .10),
        (player.footMode ? .93 : .99) - player.tuckAmount * .12 + plant * .055,
        .24 + plant * .16 - player.tuckAmount * .05);
      hand.rotation.set(-.99 + plant * .21, side * .09, side * -.14 - player.steer * .08);
      pole.visible = !snowboarder;
      pole.rotation.set(1.00 + player.tuckAmount * .88 - plant * .46, 0, side * .22);
      if (player.poleSide === side && player.poleSwing > 0) {
        const hit = Math.sin(player.poleSwing / .54 * Math.PI);
        hand.position.z += hit * .22;
        hand.rotation.y += side * hit * .43;
        pole.rotation.z += side * hit * .74;
      }
      // The arm enters from the elbow beside the ribcage and ends inside
      // the existing rolled gauntlet, including when a pole is planted.
      forearm.position.set(side*.46,.88-player.tuckAmount*.17,-.54);
      if (onBoard) {
        const leading = side === front;
        hand.position.set(side * (leading ? .47 : .54), -.56 + side * boardEdge * .19, leading ? .32 : .13);
        hand.rotation.set(-.54, -side * .43, side * -.36 + boardEdge * .54);
        forearm.position.set(side * .73, -.78, leading ? -.10 : -.23);
      }
      forearm.scale.x = forearm.scale.z = onBoard ? .83 : 1;
      sample.set(0,-.257,.011).applyQuaternion(hand.quaternion).add(hand.position).sub(forearm.position);
      forearm.scale.y=sample.length();
      forearm.quaternion.setFromUnitVectors(down,sample.normalize());
      forearm.morphTargetInfluences[0] = wind * Math.sin(windPhase * 1.2 + side * 1.7);
    }
  }

  const acceptsColor = (value) => typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value);
  function setAppearance({ jacket: color, pants: trousers, helmet: shellColor, backpack, backpackModel, sticker, apparel,
    haircut: cut, hairColor, footwear, goggles: goggleColor, ...equipment } = {}) {
    if (goggleColor !== undefined) goggles.setColor(goggleColor);
    const patrol = apparel === 'patrol-shell';
    if (patrol && !rescueTrim) rescueTrim = patrolTrim();
    if (rescueTrim) rescueTrim.visible = patrol;
    jacket.map = shoulderPanel.map = patrol ? patrolFabric() : cloth.map;
    const brand = patrol ? 'fossil' : apparel === 'summit-shell' ? 'half-dome' : null;
    if (brand && !jacketMarks.has(brand)) {
      jacketMarks.set(brand, embroideredMaterial(jacket, brand, .065, .404, .081));
    }
    jacketMesh.material = jacketMarks.get(brand) ?? jacket;
    if (acceptsColor(color)) {
      jacket.color.set(color);
      shoulderPanel.color.copy(jacket.color).multiplyScalar(.58);
      stitch.color.copy(jacket.color).multiplyScalar(.47);
      seamThread.color.copy(jacket.color).multiplyScalar(.8);
      gloveLeather.color.copy(gloveBase).lerp(jacket.color, .11);
    }
    if (acceptsColor(trousers)) pants.color.set(trousers);
    if (cut !== undefined) {
      haircut = ['crop', 'part', 'curls'].includes(cut) ? cut : 'helmet';
      if (haircut !== 'helmet') {
        if (!casualHead) buildCasualHead();
        hair.geometry = haircutMesh(haircut);
      }
    }
    if (hair && acceptsColor(hairColor)) hair.material.color.set(hairColor);
    if (footwear !== undefined) {
      snowShoes = footwear === 'traverse';
      if (snowShoes) for (const leg of legs) {
        if (leg.walkShoe) continue;
        leg.walkShoe = buildSnowShoe(leg.side);
        leg.walkShoe.visible = false;
        leg.ski.add(leg.walkShoe);
      }
    }
    if (acceptsColor(shellColor)) {
      helmetMaterial.color.set(shellColor);
      const { r, g, b } = helmetMaterial.color;
      helmetDecalMaterial.color.set(.2126 * r + .7152 * g + .0722 * b > .35 ? 0x364048 : 0xe8e2d6);
    }
    pack?.setAppearance({ color: acceptsColor(backpack) ? backpack : undefined, model: backpackModel, decal: sticker });
    if (sticker !== undefined) for (const [name, decal] of Object.entries(helmetDecals)) {
      decal.visible = sticker === name;
    }
    setEquipment(equipment);
  }
  setAppearance({ sticker: 'none' });
  for (const joint of [torso, skiHead, ...Object.values(helmetDecals)]) batchRigidParts(joint);
  for (const { skiBoot, cuff } of legs) { batchRigidParts(skiBoot); batchRigidParts(cuff); }
  for (const { elbow, pole } of arms) { batchRigidParts(elbow); batchRigidParts(pole); }
  for (const { hand, pole } of helmetHands) { batchRigidParts(hand); batchRigidParts(pole); }
  const gearAnchors = {
    jacket: torso, goggles: goggles.group, helmet: skiHead, backpack: pack?.group,
    pants: legs[0].trousers.mesh, skis: legs[0].equipment, snowboard: board,
  };
  return { group, torso, animate, contactPoints, skiAxes, skiRights, skiSink, skiPlanted, skiContact,
    showHelmetGear, setAppearance, setEquipment, setSkiSnow, gearAnchors, boardContact, boardEyes };
}
