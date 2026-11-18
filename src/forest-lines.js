import * as THREE from 'three';
import { runPointAt } from './worlddata.js';
import { climateUniforms } from './climate-state.js';
import { coniferBarkMap } from './conifer-bark.js';

const approachPad = 1.6;
const baseColor = new THREE.Color();
const baseNormal = new THREE.Vector3();

function openAt(env, ground, x, z, radius = approachPad) {
  const y = ground.heightAt(x, z);
  if (env.isOpen) return env.isOpen(x, y + .3, z, radius);
  return !env.queryColliders(x, z, radius + 1).some(c => {
    if (y + .7 < (c.minY ?? -Infinity) || y > (c.maxY ?? Infinity)) return false;
    if (c.r) return Math.hypot(x - c.x, z - c.z) < c.r + radius;
    return env.pointInBox(x, z, c, radius, radius);
  });
}

function findLine(run, ground, env, fraction, side) {
  const a = run.samples[0], b = run.samples.at(-1);
  const forward = ground.heightAt(a.x, a.z) > ground.heightAt(b.x, b.z);
  const span = Math.min(150, run.length * .42);
  const start = Math.min(run.length - span - 16, run.length * fraction);
  const points = [];
  let wooded = 0;
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const s = (start + span * t) / run.length;
    const p = runPointAt(run, forward ? s : 1 - s);
    const excursion = Math.sin(Math.PI * t) ** 1.45;
    const bias = (run.width * .18 + excursion * (run.width * .62 + 12)) * side;
    let next;
    for (const shift of [0, -2.5, 2.5, -4.5, 4.5]) {
      const x = p.x + p.nx * (bias + shift), z = p.z + p.nz * (bias + shift);
      const y = ground.heightAt(x, z);
      const previous = points.at(-1);
      if (previous) {
        const gap = Math.hypot(x - previous.x, z - previous.z);
        if (gap < 1 || gap > 10 || Math.abs(previous.y - y) / gap > .82 || y > previous.y + .85) continue;
        const clear = [.25, .5, .75].every(t => openAt(env, ground,
          THREE.MathUtils.lerp(previous.x, x, t), THREE.MathUtils.lerp(previous.z, z, t)));
        if (!clear) continue;
      }
      if (openAt(env, ground, x, z)) {
        next = { x, y, z };
        break;
      }
    }
    if (!next) return null;
    wooded += Number((ground.forestAt(next.x, next.z) ?? 0) > .32);
    points.push(next);
  }
  if (wooded < 5 || points[0].y - points.at(-1).y < 19) return null;
  return points;
}

function direction(points, i) {
  const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
  return new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
}

function makeBump(points, index, shift, height, abrupt) {
  const p = points[index], { x: tx, y: tz } = direction(points, index);
  const span = abrupt ? 1.5 : 2.85, width = abrupt ? 2.3 : 3.15;
  return { x: p.x + tz * shift, z: p.z - tx * shift, tx, tz, span, width, height, abrupt };
}

function localOffset(bump, x, z) {
  const dx = x - bump.x, dz = z - bump.z;
  const a = (dx * bump.tx + dz * bump.tz) / bump.span;
  const b = (dx * bump.tz - dz * bump.tx) / bump.width;
  return bump.height * Math.max(0, 1 - a * a - b * b) ** 2;
}

function installBumpMesh(group, ground, bump, normalAt) {
  const steps = 24, stride = steps + 1;
  const positions = [], normals = [], colors = [], indices = [];
  for (let j = 0; j <= steps; j++) for (let i = 0; i <= steps; i++) {
    const across = (i / steps * 2 - 1) * bump.width;
    const along = (j / steps * 2 - 1) * bump.span;
    const x = bump.x + bump.tz * across + bump.tx * along;
    const z = bump.z - bump.tx * across + bump.tz * along;
    ground.sampleSnowSurface(x, z, baseColor, baseNormal);
    const lift = localOffset(bump, x, z);
    positions.push(x, ground.heightAt(x, z) + lift + Math.min(lift, .004), z);
    normalAt(x, z, baseNormal);
    normals.push(...baseNormal);
    colors.push(baseColor.r, baseColor.g, baseColor.b);
    if (i < steps && j < steps) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, ground.snowMaterial);
  mesh.receiveShadow = true;
  mesh.name = 'Wind-packed forest mogul';
  group.add(mesh);
}

function makeFallenLog(group, ground, env, line, index) {
  const p = line[index], { x: tx, y: tz } = direction(line, index);
  const radius = .26, half = 2.55;
  const unblocked = [-half, -half * .5, 0, half * .5, half]
    .every(d => openAt(env, ground, p.x + tz * d, p.z - tx * d, .85));
  if (!unblocked) return null;
  const local = distance => {
    const x = p.x + tz * distance, z = p.z - tx * distance;
    return new THREE.Vector3(x, ground.heightAt(x, z) + radius * .40, z);
  };
  const start = local(-half), end = local(half);
  const center = start.clone().lerp(end, .5);
  if (Math.abs(center.y - p.y) > .34) return null;
  const axis = end.clone().sub(start);
  const bark = new THREE.MeshStandardMaterial({ color: 0x574134, roughness: .99, bumpMap: coniferBarkMap(), bumpScale: .028 });
  const rings = new THREE.MeshStandardMaterial({ color: 0x9e7452, roughness: .96 });
  const log = new THREE.Mesh(new THREE.CylinderGeometry(radius * .77, radius, axis.length(), 11, 3), [bark, rings, rings]);
  log.name = 'Fallen fir';
  log.position.copy(center);
  log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  log.castShadow = log.receiveShadow = true;
  group.add(log);
  for (const d of [-1.51, -.38, .82]) {
    const branchAt = THREE.MathUtils.lerp(start.y, end.y, (d + half) / (2 * half));
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(.033, .072, .31 + Math.abs(d) * .17, 7), bark);
    branch.position.set(p.x + tz * d + .12 * tx, branchAt + .09, p.z - tx * d + .12 * tz);
    branch.rotation.set(.52 + d * .2, 0, -.86 + d * .22);
    log.parent.add(branch);
  }
  const addBox = (env.grid ?? env).addBox.bind(env.grid ?? env);
  const angle = Math.atan2(-tx, tz);
  for (let j = 0; j < 5; j++) {
    const t = (j + .5) / 5, d = (t * 2 - 1) * half;
    const y = THREE.MathUtils.lerp(start.y, end.y, t);
    addBox(p.x + tz * d, p.z - tx * d, half / 5, radius, angle, 'fallen log',
      { minY: y - radius - .22, maxY: y + radius });
  }
  return { x: p.x, z: p.z, y: center.y + radius, index };
}

// These small freeride detours are gameplay routes inside the simulated terrain.
// Their placement depends on the loaded DEM and existing tree collisions.
export function buildForestLines(scene, ground, env, runs) {
  const group = new THREE.Group();
  group.name = 'Off-piste forest lines';
  const zones = new Map();
  for (const run of runs) {
    if (!run.named || run.connector || run.length < 300 || !['blue', 'black'].includes(run.difficulty)) continue;
    const zone = run.section || run.mountain || '';
    if (!zones.has(zone)) zones.set(zone, []);
    zones.get(zone).push(run);
  }
  const routes = [], bumps = [], coins = [];
  for (const [zone, candidates] of zones) {
    const sorted = candidates.sort((a, b) => Number(a.difficulty === 'black') - Number(b.difficulty === 'black') || b.length - a.length);
    let count = 0;
    for (const run of sorted) {
      let points;
      for (const start of [.22, .40, .60]) {
        points = findLine(run, ground, env, start, 1) ?? findLine(run, ground, env, start, -1);
        if (points) break;
      }
      if (!points || routes.some(r => Math.hypot(r.points[14].x - points[14].x, r.points[14].z - points[14].z) < 180)) continue;
      const id = `forest-${routes.length + 1}`;
      const candidateBumps = [makeBump(points, 7, -.38, .31, false), makeBump(points, 10, .10, .61, true),
        makeBump(points, 13, .68, .43, false)].filter(bump => openAt(env, ground, bump.x, bump.z, 2.4));
      if (!candidateBumps.some(bump => bump.abrupt)) continue;
      let log;
      for (const index of [21, 20, 23, 18]) {
        log = makeFallenLog(group, ground, env, points, index);
        if (log) break;
      }
      if (!log) continue;
      const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
      routes.push({ id, zone, near: run.name, drop: points[0].y - points.at(-1).y, length, points, log, bumps: candidateBumps });
      bumps.push(...candidateBumps);
      for (let i = 0; i < points.length; i += 2) {
        const { x, z } = points[i];
        if (Math.abs(i - log.index) > 1) coins.push({ x, z, run: id });
      }
      coins.push({ x: log.x, z: log.z, run: id, y: log.y + .9, air: true });
      if (++count >= (zones.size <= 2 ? 2 : 1)) break;
    }
  }
  scene.add(group);
  const offsetAt = (x, z) => {
    let offset = 0;
    for (const bump of bumps) {
      if (Math.abs(x - bump.x) > 4.4 || Math.abs(z - bump.z) > 4.4) continue;
      offset = Math.max(offset, localOffset(bump, x, z));
    }
    return offset;
  };
  const snowOffset = (x, z) => climateUniforms.snowpack.value > .23 ? offsetAt(x, z) : 0;
  const normalAt = (x, z, normal, surface) => {
    const step = .18;
    const left = surface(x - step, z), right = surface(x + step, z);
    const near = surface(x, z - step), far = surface(x, z + step);
    ground.normalAt(x, z, normal);
    if (left || right || near || far) {
      const ny = Math.max(.05, normal.y);
      normal.set(normal.x / ny + (left - right) / (2 * step), 1,
        normal.z / ny + (near - far) / (2 * step)).normalize();
    }
    return normal;
  };
  const snow = new THREE.Group();
  snow.name = 'Natural snow bumps';
  for (const bump of bumps) installBumpMesh(snow, ground, bump, (x, z, out) => normalAt(x, z, out, offsetAt));
  group.add(snow);
  env.hitForestBump = (previous, next, speed) => {
    if (speed < 11 || climateUniforms.snowpack.value <= .23) return false;
    const travel = Math.hypot(next.x - previous.x, next.z - previous.z);
    if (travel < .02) return false;
    return bumps.some(bump => bump.abrupt && Math.abs(next.x - bump.x) < 4 && Math.abs(next.z - bump.z) < 4 &&
      speed * (localOffset(bump, next.x, next.z) - localOffset(bump, previous.x, previous.z)) / travel > 4.6);
  };
  return {
    routes, coins,
    update() { snow.visible = climateUniforms.snowpack.value > .23; },
    ground: { ...ground,
      heightAt: (x, z) => ground.heightAt(x, z) + snowOffset(x, z),
      normalAt: (x, z, out = new THREE.Vector3()) => normalAt(x, z, out, snowOffset),
      sampleSnowSurface(x, z, color, normal) {
        const y = ground.sampleSnowSurface(x, z, color ?? baseColor, normal ?? baseNormal);
        if (normal && snowOffset(x, z)) normalAt(x, z, normal, snowOffset);
        return y + snowOffset(x, z);
      },
    },
  };
}
