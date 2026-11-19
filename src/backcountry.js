import * as THREE from 'three';
import { clamp, lerp, makeNoise, smoothstep } from './math.js';

export function insideTerrain(bounds, x, z) {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

function cellAt(axis, value) {
  let lo = 0, hi = axis.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

function sampleQuad(a, b, c, d, u, v, dx, dz, normal) {
  if (u + v <= 1) {
    normal?.set((a - b) / dx, 1, (a - c) / dz).normalize();
    return a * (1 - u - v) + b * u + c * v;
  }
  normal?.set((c - d) / dx, 1, (b - d) / dz).normalize();
  return d * (u + v - 1) + b * (1 - v) + c * (1 - u);
}

function addMesh(group, material, positions, normals, indices, colors) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.Uint16BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  return mesh;
}

// Retain the regional DEM's native grid. Only cells cut by an inset acquire
// extra vertices. Each seam cell fans out to every surveyed edge vertex.
export function createSurveyTerrain({ regional, insets, material, colorAt, name }) {
  const { bounds } = regional;
  function axis(count, coordinateAt, lower, upper) {
    return [...new Set([
      ...Array.from({ length: count }, (_, i) => coordinateAt(i)),
      ...insets.flatMap(({ bounds }) => [bounds[lower], bounds[upper]]),
    ].map(Math.fround))].sort((a, b) => a - b);
  }
  const xs = axis(regional.cols, regional.xAt, 'minX', 'maxX');
  const zs = axis(regional.rows, regional.zAt, 'minZ', 'maxZ');
  const width = xs.length, height = zs.length;
  const elevations = new Float32Array(width * height);
  const normals = new Float32Array(elevations.length * 3);
  const sampleNearInset = (x, z) => {
    const y = regional.sample(x, z);
    for (const inset of insets) {
      const b = inset.bounds;
      const ex = clamp(x, b.minX, b.maxX), ez = clamp(z, b.minZ, b.maxZ);
      const distance = Math.hypot(x - ex, z - ez);
      if (distance < 240) {
        return y + (inset.sample(ex, ez) - regional.sample(ex, ez)) * (1 - smoothstep(0, 240, distance));
      }
    }
    return y;
  };
  const normal = new THREE.Vector3();
  const group = new THREE.Group();
  group.name = name;
  const fans = new Map();

  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    elevations[j * width + i] = sampleNearInset(xs[i], zs[j]);
  }
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const l = Math.max(0, i - 1), r = Math.min(width - 1, i + 1);
    const n = Math.max(0, j - 1), s = Math.min(height - 1, j + 1);
    normal.set(
      (elevations[j * width + l] - elevations[j * width + r]) / (xs[r] - xs[l]), 1,
      (elevations[n * width + i] - elevations[s * width + i]) / (zs[s] - zs[n]),
    ).normalize().toArray(normals, (j * width + i) * 3);
  }
  for (const inset of insets) {
    const { bounds: b, cols, rows, xAt, zAt } = inset;
    inset.edges = {
      x: Array.from({ length: cols }, (_, i) => Math.fround(xAt(i))),
      z: Array.from({ length: rows }, (_, i) => Math.fround(zAt(i))),
    };
    const i0 = xs.indexOf(b.minX), i1 = xs.indexOf(b.maxX);
    const j0 = zs.indexOf(b.minZ), j1 = zs.indexOf(b.maxZ);
    const setEdge = (i, j) => {
      const k = j * width + i;
      if (inset.normalAt) inset.normalAt(xs[i], zs[j], normal).toArray(normals, k * 3);
    };
    for (let i = i0; i <= i1; i++) { setEdge(i, j0); setEdge(i, j1); }
    for (let j = j0; j <= j1; j++) { setEdge(i0, j); setEdge(i1, j); }
  }

  const tile = 96;
  for (let j0 = 0; j0 < height - 1; j0 += tile) for (let i0 = 0; i0 < width - 1; i0 += tile) {
    const w = Math.min(tile + 1, width - i0), h = Math.min(tile + 1, height - j0);
    const positions = new Array(w * h * 3);
    const lighting = new Array(positions.length), colors = colorAt ? new Array(positions.length) : null;
    const indices = [];
    const put = (index, x, y, z, nx, ny, nz) => {
      const k = index * 3;
      positions[k] = x; positions[k + 1] = y; positions[k + 2] = z;
      lighting[k] = nx; lighting[k + 1] = ny; lighting[k + 2] = nz;
      colorAt?.(x, y, z, ny).toArray(colors, k);
    };
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const i = i0 + u, j = j0 + v, k = j * width + i, normalIndex = k * 3;
      put(v * w + u, xs[i], elevations[k], zs[j],
        normals[normalIndex], normals[normalIndex + 1], normals[normalIndex + 2]);
    }
    for (let v = 0; v < h - 1; v++) for (let u = 0; u < w - 1; u++) {
      const i = i0 + u, j = j0 + v, x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
      const a = v * w + u, b = a + 1, c = a + w, d = c + 1;
      if (insets.some(({ bounds }) => insideTerrain(bounds, (x0 + x1) / 2, (z0 + z1) / 2))) continue;
      const join = insets.find(({ bounds: r }) =>
        ((z1 === r.minZ || z0 === r.maxZ) && x0 >= r.minX && x1 <= r.maxX) ||
        ((x1 === r.minX || x0 === r.maxX) && z0 >= r.minZ && z1 <= r.maxZ));
      if (!join) {
        indices.push(a, c, b, b, c, d);
        continue;
      }
      const { bounds: r, edges } = join;
      const perimeter = [];
      const append = (corner, coords, lo, hi, fixed, alongX, reverse) => {
        perimeter.push(corner);
        if (!coords) return;
        const additions = coords.slice(cellAt(coords, lo) + 1, cellAt(coords, hi) + 1)
          .filter(value => value > lo && value < hi);
        if (reverse) additions.reverse();
        for (const value of additions) {
          const x = alongX ? value : fixed, z = alongX ? fixed : value;
          const y = join.sample(x, z);
          const index = positions.length / 3;
          if (join.normalAt) join.normalAt(x, z, normal);
          else normal.set(0, 1, 0);
          put(index, x, y, z, normal.x, normal.y, normal.z);
          perimeter.push(index);
        }
      };
      const withinX = x0 >= r.minX && x1 <= r.maxX, withinZ = z0 >= r.minZ && z1 <= r.maxZ;
      append(a, withinZ && x0 === r.maxX ? edges.z : null, z0, z1, x0, false, false);
      append(c, withinX && z1 === r.minZ ? edges.x : null, x0, x1, z1, true, false);
      append(d, withinZ && x1 === r.minX ? edges.z : null, z0, z1, x1, false, true);
      append(b, withinX && z0 === r.maxZ ? edges.x : null, x0, x1, z0, true, true);
      if (perimeter.length === 4) {
        indices.push(a, c, b, b, c, d);
        continue;
      }
      const x = Math.fround((x0 + x1) / 2), z = Math.fround((z0 + z1) / 2);
      const index = positions.length / 3;
      const n = (j * width + i) * 3;
      put(index, x, sampleNearInset(x, z), z, normals[n], normals[n + 1], normals[n + 2]);
      for (let k = 0; k < perimeter.length; k++) {
        indices.push(index, perimeter[k], perimeter[(k + 1) % perimeter.length]);
      }
      const vertex = i => positions.slice(i * 3, i * 3 + 3).map(Math.fround);
      fans.set(j * width + i, [vertex(index), perimeter.map(vertex)]);
    }
    if (indices.length) addMesh(group, material, positions, lighting, indices, colors);
  }

  function sample(x, z, normal) {
    const i = cellAt(xs, x), j = cellAt(zs, z);
    const dx = xs[i + 1] - xs[i], dz = zs[j + 1] - zs[j];
    const u = (x - xs[i]) / dx, v = (z - zs[j]) / dz, index = j * width + i;
    const fan = fans.get(index);
    if (fan) {
      const [a, perimeter] = fan;
      for (let k = 0; k < perimeter.length; k++) {
        const b = perimeter[k], c = perimeter[(k + 1) % perimeter.length];
        const bx = b[0] - a[0], bz = b[2] - a[2], cx = c[0] - a[0], cz = c[2] - a[2];
        const px = x - a[0], pz = z - a[2], area = bx * cz - bz * cx;
        const tb = (px * cz - pz * cx) / area, tc = (bx * pz - bz * px) / area;
        if (tb < -1e-6 || tc < -1e-6 || tb + tc > 1.000001) continue;
        const by = b[1] - a[1], cy = c[1] - a[1];
        normal?.set((bz * cy - by * cz) / area, 1, (by * cx - bx * cy) / area).normalize();
        return a[1] + tb * by + tc * cy;
      }
    }
    return sampleQuad(elevations[index], elevations[index + 1], elevations[index + width],
      elevations[index + width + 1], u, v, dx, dz, normal);
  }
  return { group, bounds, xCount: regional.cols, zCount: regional.rows, sample };
}

const PATCH = 32;
const HORIZON_SECTOR = 4;
const HORIZON_STEP = 8;

// Extend the regional grid on its native spacing so the last measured row
// and the first generated row share every vertex, even at the four corners.
export function createBackcountry({ survey, material, colorAt, seed, compact, viewDistance = 0 }) {
  const { bounds } = survey;
  const dx = (bounds.maxX - bounds.minX) / (survey.xCount - 1);
  const dz = (bounds.maxZ - bounds.minZ) / (survey.zCount - 1);
  const noise = makeNoise(seed);
  const group = new THREE.Group();
  group.name = 'Procedural backcountry';
  const horizon = new THREE.Group();
  horizon.name = 'Distant backcountry';
  const patches = new Map();
  const sectors = new Map();
  const radius = compact ? 3 : 5;
  const indices = new Uint16Array(PATCH * PATCH * 6);
  for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
    const a = j * (PATCH + 1) + i, b = a + 1, c = a + PATCH + 1;
    indices.set([a, c, b, b, c, c + 1], (j * PATCH + i) * 6);
  }
  const frameBudget = compact ? 1.35 : 2;
  let lastX, lastZ, viewX, viewZ, work, active = 0, queue = [];
  let horizonIndex = 0, horizonQueue = [], favorHorizon = false;
  let mean = 0;
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
    mean += survey.sample(lerp(bounds.minX, bounds.maxX, i / 4), lerp(bounds.minZ, bounds.maxZ, j / 4)) / 25;
  }
  const relief = clamp(mean * .38 + 130, 250, 980);
  const axis = (min, max, step) => {
    const span = step * PATCH;
    const last = Math.ceil((max - min) / span);
    return {
      last,
      index: value => value >= max ? last + Math.floor((value - max) / span) : Math.floor((value - min) / span),
      start: i => i >= last ? max + (i - last) * span : min + i * span,
    };
  };
  const xAxis = axis(bounds.minX, bounds.maxX, dx), zAxis = axis(bounds.minZ, bounds.maxZ, dz);

  function elevation(x, z) {
    const ex = clamp(x, bounds.minX, bounds.maxX), ez = clamp(z, bounds.minZ, bounds.maxZ);
    const edgeX = x - ex, edgeZ = z - ez, distance = Math.hypot(edgeX, edgeZ);
    if (distance > 3400) return generated(x, z);
    const here = survey.sample(ex, ez);
    if (!distance) return here;
    // Carry the measured slope a short distance. Limit its influence before
    // the generated valleys and ridges take over farther from the edge.
    const inset = Math.max(dx, dz);
    const previous = survey.sample(ex - edgeX / distance * inset, ez - edgeZ / distance * inset);
    const grade = clamp((here - previous) / inset, -.9, .9);
    const carry = here + grade * 420 * (1 - Math.exp(-distance / 420));
    return lerp(carry, generated(x, z), smoothstep(0, 3400, distance));
  }
  function generated(x, z) {
    const broad = noise.fbm(x / 5400, z / 6500, 3);
    const ridges = noise.ridged(x / 3100 + 7, z / 3500 - 9, 3);
    const gullies = noise.fbm(x / 920 + 1.4, z / 820 + 7.7, 3);
    return mean + relief * (.86 * broad + 1.49 * (ridges - .55) + .29 * gullies);
  }

  function patchSpec(i, j) {
    const x = xAxis.start(i), z = zAxis.start(j);
    const w = i === xAxis.last - 1 ? 1 + Math.round((bounds.maxX - x) / dx) : PATCH + 1;
    const h = j === zAxis.last - 1 ? 1 + Math.round((bounds.maxZ - z) / dz) : PATCH + 1;
    return { x, z, w, h };
  }
  function* build(patch) {
    const { x, z, w, h } = patchSpec(patch.i, patch.j);
    const values = new Float32Array(w * h);
    const positions = new Float32Array(w * h * 3);
    const normals = new Float32Array(positions.length);
    const colors = colorAt ? new Float32Array(positions.length) : null;
    const sampleBorder = new Float32Array((w + 2) * (h + 2));
    for (let j = -1; j <= h; j++) {
      for (let i = -1; i <= w; i++) sampleBorder[(j + 1) * (w + 2) + i + 1] = elevation(x + i * dx, z + j * dz);
      if (j % 4 === 2) yield;
    }
    const indexData = w === PATCH + 1 && h === PATCH + 1 ? indices : new Uint16Array((w - 1) * (h - 1) * 6);
    const normal = new THREE.Vector3();
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i, center = (j + 1) * (w + 2) + i + 1;
        const px = x + i * dx, pz = z + j * dz, y = sampleBorder[center];
        values[k] = y;
        positions.set([px, y, pz], k * 3);
        normal.set((sampleBorder[center - 1] - sampleBorder[center + 1]) / (2 * dx), 1,
          (sampleBorder[center - w - 2] - sampleBorder[center + w + 2]) / (2 * dz)).normalize();
        normal.toArray(normals, k * 3);
        colorAt?.(px, y, pz, normal.y).toArray(colors, k * 3);
        if (indexData !== indices && i < w - 1 && j < h - 1) {
          indexData.set([k, k + w, k + 1, k + 1, k + w, k + w + 1], (j * (w - 1) + i) * 6);
        }
      }
      if (j % 4 === 3) yield;
    }
    return { ...patch, mesh: addMesh(group, material, positions, normals, indexData, colors), values };
  }

  const inSurvey = (i, j) => i >= 0 && i < xAxis.last && j >= 0 && j < zAxis.last;
  const keyAt = (i, j) => `${i},${j}`;
  const sectorAt = (i, j) => Math.floor(i / HORIZON_SECTOR) + ',' + Math.floor(j / HORIZON_SECTOR);

  function* buildSector(sector) {
    const positions = [], normals = [], colors = colorAt ? [] : null;
    const tiles = [];
    const normal = new THREE.Vector3();
    const startX = sector.i * HORIZON_SECTOR, startZ = sector.j * HORIZON_SECTOR;
    for (let j = startZ; j < startZ + HORIZON_SECTOR; j++) {
      for (let i = startX; i < startX + HORIZON_SECTOR; i++) {
        if (inSurvey(i, j)) continue;
        const { x, z, w, h } = patchSpec(i, j);
        const indices = [];
        const vertices = new Map();
        const vertex = (u, v) => {
          const key = 4 * v * w + 2 * u;
          if (vertices.has(key)) return vertices.get(key);
          const px = x + dx * u, pz = z + dz * v, py = elevation(px, pz);
          normal.set((elevation(px - dx, pz) - elevation(px + dx, pz)) / (2 * dx), 1,
            (elevation(px, pz - dz) - elevation(px, pz + dz)) / (2 * dz)).normalize();
          const index = positions.length / 3;
          positions.push(px, py, pz);
          normals.push(normal.x, normal.y, normal.z);
          if (colorAt) {
            const color = colorAt(px, py, pz, normal.y);
            colors.push(color.r, color.g, color.b);
          }
          vertices.set(key, index);
          return index;
        };
        for (let v = 0; v < h - 1; v += HORIZON_STEP) for (let u = 0; u < w - 1; u += HORIZON_STEP) {
          const right = Math.min(w - 1, u + HORIZON_STEP), bottom = Math.min(h - 1, v + HORIZON_STEP);
          const a = vertex(u, v), b = vertex(right, v), c = vertex(u, bottom), d = vertex(right, bottom);
          if (u > 0 && right < w - 1 && v > 0 && bottom < h - 1) {
            indices.push(a, c, b, b, c, d);
            continue;
          }
          // Keep native vertices along every outer edge, so neighboring tiles
          // can independently switch detail without opening a gap.
          const perimeter = [a];
          if (!u) for (let t = v + 1; t < bottom; t++) perimeter.push(vertex(u, t));
          perimeter.push(c);
          if (bottom === h - 1) for (let t = u + 1; t < right; t++) perimeter.push(vertex(t, bottom));
          perimeter.push(d);
          if (right === w - 1) for (let t = bottom - 1; t > v; t--) perimeter.push(vertex(right, t));
          perimeter.push(b);
          if (!v) for (let t = right - 1; t > u; t--) perimeter.push(vertex(t, v));
          const center = vertex((u + right) / 2, (v + bottom) / 2);
          for (let k = 0; k < perimeter.length; k++) indices.push(center, perimeter[k], perimeter[(k + 1) % perimeter.length]);
        }
        tiles.push({ key: keyAt(i, j), indices });
        yield;
      }
    }
    const index = new Uint16Array(tiles.reduce((size, tile) => size + tile.indices.length, 0));
    const mesh = addMesh(horizon, material, positions, normals, index, colors);
    mesh.geometry.index.setUsage(THREE.DynamicDrawUsage);
    const result = { ...sector, tiles, mesh };
    updateSector(result);
    return result;
  }

  function updateSector(sector) {
    const { geometry } = sector.mesh;
    let count = 0;
    for (const tile of sector.tiles) {
      if (patches.has(tile.key)) continue;
      geometry.index.array.set(tile.indices, count);
      count += tile.indices.length;
    }
    geometry.setDrawRange(0, count);
    geometry.index.needsUpdate = true;
    sector.mesh.visible = count > 0;
  }

  function selectHorizon(camera) {
    if (!viewDistance) return;
    const patchSpan = Math.max(dx, dz) * PATCH;
    const edgeDistance = Math.min(camera.x - bounds.minX, bounds.maxX - camera.x,
      camera.z - bounds.minZ, bounds.maxZ - camera.z);
    const wanted = new Map();
    // Include the frustum corners and the camera's movement between tile
    // updates. Start prefetching before the rider reaches the survey edge.
    if (edgeDistance <= patchSpan * (radius - 1)) {
      const range = viewDistance * 1.55 + patchSpan;
      const x0 = Math.floor(xAxis.index(camera.x - range) / HORIZON_SECTOR);
      const x1 = Math.floor(xAxis.index(camera.x + range) / HORIZON_SECTOR);
      const z0 = Math.floor(zAxis.index(camera.z - range) / HORIZON_SECTOR);
      const z1 = Math.floor(zAxis.index(camera.z + range) / HORIZON_SECTOR);
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const sx = i * HORIZON_SECTOR, sz = j * HORIZON_SECTOR;
        if (inSurvey(sx, sz) && inSurvey(sx + HORIZON_SECTOR - 1, sz + HORIZON_SECTOR - 1)) continue;
        const x = clamp(camera.x, xAxis.start(sx), xAxis.start(sx + HORIZON_SECTOR));
        const z = clamp(camera.z, zAxis.start(sz), zAxis.start(sz + HORIZON_SECTOR));
        const distance = Math.hypot(camera.x - x, camera.z - z);
        if (distance > range) continue;
        const key = keyAt(i, j);
        wanted.set(key, { i, j, key, distance });
      }
    }
    for (const [key, sector] of sectors) {
      if (wanted.has(key)) continue;
      horizon.remove(sector.mesh);
      sector.mesh.geometry.dispose();
      sectors.delete(key);
    }
    if (work?.distant && !wanted.has(work.key)) work = null;
    horizonQueue = [...wanted.values()].filter(sector => !sectors.has(sector.key) &&
      (!work?.distant || work.key !== sector.key)).sort((a, b) => a.distance - b.distance);
    horizonIndex = 0;
  }

  function sample(x, z, normal) {
    if (insideTerrain(bounds, x, z)) return survey.sample(x, z, normal);
    const i = xAxis.index(x), j = zAxis.index(z);
    const spec = patchSpec(i, j);
    const u = (x - spec.x) / dx, v = (z - spec.z) / dz;
    const gx = clamp(Math.floor(u), 0, spec.w - 2), gz = clamp(Math.floor(v), 0, spec.h - 2);
    const values = patches.get(`${i},${j}`)?.values;
    const vertex = (i, j) => values ? values[j * spec.w + i] : Math.fround(elevation(spec.x + i * dx, spec.z + j * dz));
    return sampleQuad(vertex(gx, gz), vertex(gx + 1, gz), vertex(gx, gz + 1), vertex(gx + 1, gz + 1),
      u - gx, v - gz, dx, dz, normal);
  }

  function stream(pos, camera = pos) {
    const ix = xAxis.index(pos.x), iz = zAxis.index(pos.z);
    // Camera centers are useful at introductory overlooks, but a chase camera
    // straddling a chunk boundary must not churn the resident set.
    const cx = clamp(xAxis.index(camera.x), ix - 1, ix + 1), cz = clamp(zAxis.index(camera.z), iz - 1, iz + 1);
    if (ix !== lastX || iz !== lastZ || cx !== viewX || cz !== viewZ) {
      lastX = ix; lastZ = iz; viewX = cx; viewZ = cz;
      const wanted = new Map();
      for (let j = iz - radius; j <= iz + radius; j++) for (let i = ix - radius; i <= ix + radius; i++) {
        if (inSurvey(i, j)) continue;
        const distance = Math.min((i - ix) ** 2 + (j - iz) ** 2, (i - cx) ** 2 + (j - cz) ** 2 + .5);
        if (distance > (radius + .5) ** 2) continue;
        const key = keyAt(i, j);
        wanted.set(key, { i, j, key, distance });
      }
      const changedSectors = new Set();
      for (const [key, patch] of patches) if (!wanted.has(key)) {
        group.remove(patch.mesh);
        patch.mesh.geometry.dispose();
        patches.delete(key);
        const sector = sectors.get(sectorAt(patch.i, patch.j));
        if (sector) changedSectors.add(sector);
      }
      for (const sector of changedSectors) updateSector(sector);
      if (work && !work.distant && !wanted.has(work.key)) work = null;
      queue = [...wanted.values()].filter(patch => !patches.has(patch.key) && (work?.distant || patch.key !== work?.key))
        .sort((a, b) => a.distance - b.distance);
      active = 0;
      selectHorizon(camera);
    }
    if (!work) {
      const near = queue[active], distant = horizonQueue[horizonIndex];
      if (distant && (!near || (near.distance > 4 && favorHorizon))) {
        horizonIndex++;
        work = { key: distant.key, builder: buildSector(distant), distant: true };
      } else if (near) {
        active++;
        work = { key: near.key, builder: build(near), distant: false };
      }
      favorHorizon = !favorHorizon;
    }
    const deadline = performance.now() + frameBudget;
    while (work && performance.now() < deadline) {
      const chunk = work.builder.next();
      if (chunk.done) {
        if (work.distant) sectors.set(chunk.value.key, chunk.value);
        else {
          const patch = chunk.value;
          patches.set(patch.key, patch);
          const sector = sectors.get(sectorAt(patch.i, patch.j));
          if (sector) updateSector(sector);
        }
        work = null;
      }
    }
  }
  return { group, horizon, sample, stream };
}
