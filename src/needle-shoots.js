import * as THREE from 'three';
import { attachChaseFoliage } from './chase-foliage.js';
import { mulberry32 } from './util.js';
import { terrain } from './terrain.js';
import { climateUniforms } from './climate-state.js';

// One last season's growth, in metres. The shoot points along local +Z.
// Each needle tapers, bends toward the bud and has a raised midrib.
function makeShoot(species, seed) {
  const random = mulberry32(seed);
  const position = [], normal = [], color = [], root = [], indices = [];
  const vertices = new WeakMap();
  const green = new THREE.Color(species === 'spruce' ? 0x365342 : 0x355636);
  const tipGreen = new THREE.Color(species === 'spruce' ? 0x778e74 : 0x759457);
  const wood = new THREE.Color(0x716148);
  const stem = (t) => [.014 * t * t, -.016 * t * t, t * .26];
  const normalize = (x, y, z) => {
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
  };
  const vertex = (p, n, tint, anchor) => {
    const existing = vertices.get(p);
    if (existing !== undefined) { indices.push(existing); return; }
    const index = position.length/3;
    indices.push(index);
    vertices.set(p,index);
    position.push(...p); normal.push(...n); color.push(tint.r, tint.g, tint.b); root.push(...anchor);
  };
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * .4, b = (k + 1) * Math.PI * .4;
    const ring = (t, angle) => {
      const p = stem(t), r = .0014 * (1 - t) + .00055;
      return [p[0] + r * Math.cos(angle), p[1] + r * Math.sin(angle), p[2]];
    };
    for (const [t, angle] of [[0,a],[0,b],[1,a],[1,a],[0,b],[1,b]]) {
      vertex(ring(t, angle), [Math.cos(angle),Math.sin(angle),0], wood, stem(.5));
    }
  }
  const count = species === 'spruce' ? 92 : 76;
  const tuftCount = count / 4;
  const tufts = Array.from({length:tuftCount},(_, i) => ({
    t: .045 + (i + .16 + random() * .68) / tuftCount * .93,
    spread: .63 + random() * .68,
    angle: (random() - .5) * 1.8,
    tint: .70 + random() * .56,
  }));
  for (let i = 0; i < count; i++) {
    const tuft = tufts[Math.floor(i / 4)];
    const t = tuft.t + (random() - .5) * .045;
    const a = species === 'spruce' ? i * 2.39996 + tuft.angle + random() * .71
      : (i % 2 ? Math.PI : 0) + tuft.angle + (random() - (species === 'hemlock' ? .6 : .45)) * 2.15;
    const dx = Math.cos(a), dy = Math.sin(a);
    const origin = stem(t);
    origin[0] += dx * .001;
    origin[1] += dy * .001;
    const size = (.016 + random() ** .76 * .027) * tuft.spread * (1 - .48 * t ** 3);
    const forward = -.14 + random() * .91 + t * .21;
    const curve = (random() - .53) * .28;
    const width = (.00055 + random() * .00067) * (species === 'hemlock' ? .81 : 1);
    const twist = (random() - .5) * 1.65;
    const side = [-dy * Math.cos(twist), dx * Math.cos(twist), Math.sin(twist)];
    const mid = [origin[0] + dx * size * .42, origin[1] + dy * size * .42, origin[2] + size * (forward - curve) * .42];
    const left = mid.map((value, j) => value + side[j] * width);
    const right = mid.map((value, j) => value - side[j] * width);
    const tip = [origin[0] + (dx - dy * curve) * size, origin[1] + (dy + dx * curve) * size,
      origin[2] + size * forward];
    const n = normalize(dy * side[2] - forward * side[1], forward * side[0] - dx * side[2], dx * side[1] - dy * side[0]);
    const ridge = mid.map((value, j) => value + n[j] * width * .46);
    const leaf = green.clone().multiplyScalar(tuft.tint * (.76 + random() * .42));
    const tipColor = leaf.clone().lerp(tipGreen, .09 + random() * .52);
    const ribColor = leaf.clone().multiplyScalar(1.12);
    const edgeNormal = (s) => normalize(...n.map((v,j) => v + side[j] * s * .27));
    const leftNormal = edgeNormal(1), rightNormal = edgeNormal(-1);
    for (const tri of [[origin,ridge,left],[origin,right,ridge],[left,ridge,tip],[ridge,right,tip]]) {
      for (const v of tri) {
        const direction = v === left ? leftNormal : v === right ? rightNormal : n;
        const tint = v === tip ? tipColor : v === ridge ? ribColor : leaf;
        vertex(v,direction,tint,origin);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  for (const [name, values] of [['position',position],['normal',normal],['color',color],['needleRoot',root]]) {
    g.setAttribute(name, new THREE.Float32BufferAttribute(values, 3));
  }
  g.computeBoundingSphere();
  return g;
}

// Contour the snow thread between exposed roots with the actual terrain's
// surface data. The outer ring is buried so its outline cannot lift off a slope.
function makeRootSnow(group) {
  const capacity = 28, sides = 20;
  const rings = [[.20,.042],[.42,.15],[.66,.185],[.89,.050],[1.27,-.035]];
  const stride = sides * rings.length;
  const geometry = new THREE.BufferGeometry(), index = [];
  const channels = ['position','normal','color'].map(name => {
    const attribute = new THREE.BufferAttribute(new Float32Array(capacity * stride * 3),3);
    geometry.setAttribute(name,attribute.setUsage(THREE.DynamicDrawUsage));
    return attribute;
  });
  for (let i = 0; i < capacity; i++) for (let row = 0; row < rings.length - 1; row++) {
    for (let j = 0; j < sides; j++) {
      const a = i * stride + row * sides + j, b = i * stride + row * sides + (j + 1) % sides;
      index.push(a,b,a+sides,b,b+sides,a+sides);
    }
  }
  const indicesPerTree = 6 * sides * (rings.length - 1);
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry,terrain.snowMaterial);
  mesh.name = 'Snow tucked between conifer roots';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.visible = false;
  group.add(mesh);
  const [position,normal,color] = channels;
  const snow = new THREE.Color(), up = new THREE.Vector3();
  return (eye, candidates) => {
    const snowpack = climateUniforms.snowpack.value, snowline = climateUniforms.snowline.value;
    let count = 0;
    for (const {tree} of candidates) {
      if (!tree || count === capacity) continue;
      const {x,y,z,apex,stretch,yaw} = tree;
      if (apex < 7) continue;
      const distance = Math.hypot(x-eye.x,y-eye.y,z-eye.z);
      const cover = 1 - THREE.MathUtils.smoothstep(distance,9,18);
      const season = THREE.MathUtils.smoothstep(y,snowline-160,snowline+35)*snowpack;
      const fraction = cover * season;
      if (fraction < .03) continue;
      const size = apex * stretch * .025;
      for (let j = 0; j < sides; j++) {
        const a = j / sides * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        const spread = size * (.90 + .14*Math.sin(a*3 + yaw*3) + .10*Math.cos(a*5 - yaw)
          + .12*Math.cos(a - .67));
        const shelter = (.56 + .33*Math.cos(a - yaw) + .12*Math.sin(a*3 + yaw));
        const lift = shelter * THREE.MathUtils.clamp(apex / 26,.45,1.25) * fraction;
        for (let row = 0; row < rings.length; row++) {
          const [radius,height] = rings[row];
          const tx = x + dx*radius*spread, tz = z + dz*radius*spread;
          const base = terrain.sampleSnowSurface(tx,tz,snow,up);
          const i = count*stride + row*sides + j;
          const buried = row === rings.length - 1;
          position.setXYZ(i,tx,base + (buried ? height : height*lift - .011),tz);
          const left = rings[Math.max(0,row-1)], right = rings[Math.min(rings.length-1,row+1)];
          const grade = buried ? 0 : lift * (right[1] - left[1]) / Math.max(.04,(right[0] - left[0])*spread);
          up.x -= grade*dx; up.z -= grade*dz;
          up.normalize();
          normal.setXYZ(i,up.x,up.y,up.z);
          const hollow = 1 - THREE.MathUtils.smoothstep(radius,.36,.92);
          snow.multiplyScalar(1 - hollow * (.39-.18*shelter) * fraction);
          color.setXYZ(i,snow.r,snow.g,snow.b);
        }
      }
      count++;
    }
    mesh.visible = count > 0;
    geometry.setDrawRange(0,count*indicesPerTree);
    if (!mesh.visible) return;
    for (const attribute of channels) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0,count*stride*3);
      attribute.needsUpdate = true;
    }
  };
}

export function buildNeedleShoots(group, trees, species, templates) {
  const updateRootSnow = makeRootSnow(group);
  const material = new THREE.MeshStandardMaterial({ vertexColors:true, side:THREE.DoubleSide, roughness:.91 });
  material.onBeforeCompile = (shader) => {
    attachChaseFoliage(shader);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 needleRoot;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 attachment = (modelMatrix * instanceMatrix * vec4(needleRoot, 1.)).xyz;
        float growth = 1.0 - smoothstep(3.0, 6.9, distance(cameraPosition, attachment));
        transformed = mix(needleRoot, transformed, growth);
      `);
  };
  const meshes = species.map((kind, i) => {
    const m = new THREE.InstancedMesh(makeShoot(kind, 5743 + i), material, 2048);
    m.name = kind + ' needle shoots';
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(),10);
    m.count = 0; m.visible = false; group.add(m);
    return m;
  });
  const lastEye = new THREE.Vector3(Infinity, Infinity, Infinity);
  let lastSnowpack = -1, lastSnowline = -1;
  const root = new THREE.Vector3(), tip = new THREE.Vector3(), direction = new THREE.Vector3();
  const facing = new THREE.Vector3(0,0,1), shootScale = new THREE.Vector3();
  const quat = new THREE.Quaternion(), roll = new THREE.Quaternion(), matrix = new THREE.Matrix4();
  return (eye) => {
    // A 9 m search leaves room to move before a shader-faded needle can be
    // visible at 7 m. Camera bob and tiny cabin motions keep existing uploads.
    if (lastEye.distanceToSquared(eye) < 2.56 && Math.abs(lastSnowpack-climateUniforms.snowpack.value) < .02
        && Math.abs(lastSnowline-climateUniforms.snowline.value) < 7) return;
    lastEye.copy(eye);
    lastSnowpack = climateUniforms.snowpack.value;
    lastSnowline = climateUniforms.snowline.value;
    const candidates = trees.query(eye.x,eye.z,22);
    updateRootSnow(eye,candidates);
    for (const mesh of meshes) mesh.count = 0;
    for (const collider of candidates) {
      const tree = collider.tree;
      if (!tree) continue;
      const { apex, kind, stretch, yaw, x, y, z } = tree;
      const shoots = templates[kind].geometry.userData.terminalShoots;
      const horizontal = (eye.x-x)**2 + (eye.z-z)**2;
      const vertical = Math.max(y-eye.y-2,eye.y-y-apex-1,0);
      if (!shoots || horizontal > (9 + .32 * apex)**2 || vertical > 9) continue;
      const mesh = meshes[kind % species.length];
      const azimuthX = Math.cos(yaw)*apex*stretch, azimuthZ = Math.sin(yaw)*apex*stretch;
      function transform(vector, point) {
        vector.set(x + point[0]*azimuthX + point[2]*azimuthZ,
          y-.1 + point[1]*apex,z - point[0]*azimuthZ + point[2]*azimuthX);
      }
      for (const shoot of shoots) {
        transform(tip,shoot.end);
        const distance = eye.distanceToSquared(tip);
        if (distance > (shoot.inner ? 5.8 : 9) ** 2 || mesh.count === mesh.instanceMatrix.count) continue;
        transform(root,shoot.start);
        direction.subVectors(tip, root);
        const length = direction.length();
        if (length < .015) continue;
        direction.multiplyScalar(1 / length);
        const scale = Math.min(1.24, length / .26, .46 + apex * .042);
        const twist = kind % species.length === 1 ? 2.1 : 1.14;
        quat.setFromUnitVectors(facing,direction)
          .multiply(roll.setFromAxisAngle(facing, Math.sin(yaw + shoot.end[1]*196) * twist));
        if (!shoot.inner) root.copy(tip).addScaledVector(direction,-.26 * scale);
        matrix.compose(root,quat,shootScale.setScalar(scale));
        mesh.setMatrixAt(mesh.count++,matrix);
      }
    }
    for (const m of meshes) {
      m.visible = m.count > 0;
      if (!m.visible) continue;
      m.boundingSphere.center.copy(eye);
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, m.count * 16);
      m.instanceMatrix.needsUpdate = true;
    }
  };
}
