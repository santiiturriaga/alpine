import * as THREE from 'three';
import {
  clamp, lerp, smoothstep, noise2, mulberry32, makeTextTexture, makeCanvas,
  canvasTexture, makeRadialTexture, formatNumber,
} from './util.js';
import {
  WORLD, RUNS, LIFTS, LODGES, CHALETS, STATIONS, P2P_RIDE, KICKERS,
  runPointAt, startPose,
} from './worlddata.js';
import { heightAt, normalAt, slopeAt, pisteAt } from './terrain.js';
import { createFlag } from './effects.js';

/* ═══════════════════════════════════════════════════════════════
   ENVIRONMENT
   Old-growth forest, alpine rock, lift systems, lodges, signs,
   finish arches, and the collider grid that ties it together.
   ═══════════════════════════════════════════════════════════════ */

const up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const dummy = new THREE.Object3D();

/* ── geometry helpers ─────────────────────────────────────────── */

function part(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  return { geo, color, pos, rot, scale };
}

function box(w, h, d, color, pos = [0, 0, 0], rot = [0, 0, 0]) {
  return part(new THREE.BoxGeometry(w, h, d), color, pos, rot);
}

function mergeParts(parts) {
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

function mergedMesh(parts, { roughness = 0.82, metalness = 0.02, emissive = false } = {}) {
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

function frame() {
  return new Promise((res) => requestAnimationFrame(() => res()));
}

/* ═══════════════════════════════════════════════════════════════
   COLLIDERS
   A uniform spatial hash. Circles for trunks, towers and poles;
   oriented boxes for lodges, chalets and station buildings.
   ═══════════════════════════════════════════════════════════════ */

const GRID_CELL = 26;

class ColliderGrid {
  constructor() {
    this.cells = new Map();
    this.circles = [];
    this.boxes = [];
  }

  key(x, z) {
    return `${Math.floor(x / GRID_CELL)},${Math.floor(z / GRID_CELL)}`;
  }

  addCircle(x, z, r, type, extra = {}) {
    const c = { x, z, r, type, ...extra };
    this.circles.push(c);
    const k = this.key(x, z);
    let arr = this.cells.get(k);
    if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push(c);
    return c;
  }

  addBox(x, z, hw, hd, rot, type, extra = {}) {
    const b = { x, z, hw, hd, rot, type, ...extra };
    this.boxes.push(b);
    // register the box in all cells its bounding circle touches
    const rad = Math.hypot(hw, hd);
    const x0 = Math.floor((x - rad) / GRID_CELL), x1 = Math.floor((x + rad) / GRID_CELL);
    const z0 = Math.floor((z - rad) / GRID_CELL), z1 = Math.floor((z + rad) / GRID_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = `${ix},${iz}`;
        let arr = this.cells.get(k);
        if (!arr) { arr = []; this.cells.set(k, arr); }
        arr.push(b);
      }
    }
    return b;
  }

  query(x, z, radius = 3) {
    const out = [];
    const x0 = Math.floor((x - radius) / GRID_CELL), x1 = Math.floor((x + radius) / GRID_CELL);
    const z0 = Math.floor((z - radius) / GRID_CELL), z1 = Math.floor((z + radius) / GRID_CELL);
    const seen = new Set();
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(`${ix},${iz}`);
        if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c)) continue;
          seen.add(c);
          out.push(c);
        }
      }
    }
    return out;
  }
}

function pointInBox(px, pz, box, padX = 0, padZ = 0) {
  const c = Math.cos(-box.rot), s = Math.sin(-box.rot);
  const dx = px - box.x, dz = pz - box.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) < box.hw + padX && Math.abs(lz) < box.hd + padZ;
}

/* ═══════════════════════════════════════════════════════════════
   FOREST
   ═══════════════════════════════════════════════════════════════ */

function foliageGeometry(kind) {
  const specs = {
    fir: {
      layers: [
        [2.55, 5.0, 3.25],
        [2.0, 4.3, 5.3],
        [1.4, 3.5, 7.05],
        [0.78, 2.7, 8.65],
      ],
      colors: ['#264134', '#2b4a39', '#31543f', '#386048'],
    },
    spruce: {
      layers: [
        [1.9, 4.7, 3.1],
        [1.52, 4.1, 5.0],
        [1.12, 3.4, 6.7],
        [0.7, 2.9, 8.2],
        [0.34, 2.1, 9.55],
      ],
      colors: ['#223a30', '#274336', '#2c4c3d', '#335846', '#3b624e'],
    },
    hemlock: {
      layers: [
        [2.1, 4.1, 2.6],
        [1.65, 3.7, 4.35],
        [1.15, 3.1, 5.9],
        [0.62, 2.5, 7.2],
      ],
      colors: ['#2a4130', '#304b37', '#37543d', '#3e5f45'],
    },
  };
  const s = specs[kind];
  const parts = [];
  s.layers.forEach(([r, h, y], i) => {
    parts.push(part(new THREE.ConeGeometry(r, h, 9, 1), s.colors[i], [0, y, 0]));
  });
  return mergeParts(parts);
}

function trunkGeometry() {
  return mergeParts([
    part(new THREE.CylinderGeometry(0.15, 0.34, 7.4, 6), '#3a2b21', [0, 3.7, 0]),
    part(new THREE.CylinderGeometry(0.44, 0.5, 0.6, 6), '#33271f', [0, 0.3, 0]),
  ]);
}

function makeContactShadowTexture() {
  return makeRadialTexture(64, [
    [0, 'rgba(8,20,26,.62)'],
    [0.4, 'rgba(8,20,26,.3)'],
    [1, 'rgba(8,20,26,0)'],
  ]);
}

function buildForest(scene, grid, rand) {
  const group = new THREE.Group();
  group.name = 'forest';
  scene.add(group);

  const variants = ['fir', 'spruce', 'hemlock'];
  const matrices = { fir: [], spruce: [], hemlock: [] };
  const trunkMats = [];
  const shadowMats = [];
  const start = startPose();
  const clearings = [];
  for (const l of LODGES) clearings.push({ x: l.x, z: l.z, r: 54 + Math.max(l.size[0], l.size[2]) * 0.35 });
  for (const c of CHALETS) clearings.push({ x: c.x, z: c.z, r: 26 });
  clearings.push({ x: start.x, z: start.z, r: 26 });
  for (const s of Object.values(STATIONS)) clearings.push({ x: s.x, z: s.z, r: 60 });

  const isClear = (x, z, extra = 0) => {
    for (const c of clearings) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + extra) ** 2) return true;
    }
    return false;
  };

  const addTree = (x, z, scaleHint = 1) => {
    const h = heightAt(x, z);
    if (h < 682 || h > 1785) return;
    if (slopeAt(x, z) > 0.55) return;
    if (pisteAt(x, z) > 0.21) return;
    if (isClear(x, z)) return;
    const rn = noise2.fbm(x * 0.0031 + 2.7, z * 0.0031 - 4.2, 2);
    let kind;
    if (h > 1500) kind = rn > 0.05 ? 'spruce' : 'fir';
    else if (h < 980) kind = rn < -0.04 ? 'hemlock' : 'fir';
    else kind = rn < -0.12 ? 'hemlock' : rn > 0.16 ? 'spruce' : 'fir';

    const s = (0.72 + rand() * 0.95) * scaleHint;
    const sy = s * (0.9 + rand() * 0.28);
    dummy.position.set(x, h - 0.25, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(s * (0.86 + rand() * 0.28), sy, s * (0.86 + rand() * 0.28));
    dummy.updateMatrix();
    matrices[kind].push(dummy.matrix.clone());
    trunkMats.push(dummy.matrix.clone());

    if (Math.hypot(x - start.x, z - start.z) < 140 || rand() < 0.34) {
      // fake contact shadow — cheapest possible, still grounds the tree
      dummy.position.set(x, h + 0.07, z);
      dummy.rotation.set(-Math.PI / 2, 0, rand() * Math.PI * 2);
      dummy.scale.set(s * 3.3, s * 3.3, 1);
      dummy.updateMatrix();
      shadowMats.push(dummy.matrix.clone());
    }

    grid.addCircle(x, z, 0.34 + s * 0.18, 'tree', { height: h });
  };

  // ── open forest across the lower and middle mountain ─────────
  const attempts = 36000;
  for (let i = 0; i < attempts; i++) {
    const x = WORLD.minX + 70 + rand() * (WORLD.sizeX - 140);
    const z = WORLD.minZ + 70 + rand() * (WORLD.sizeZ - 140);
    const h = heightAt(x, z);
    if (h < 690 || h > 1780) continue;
    if (pisteAt(x, z) > 0.14) continue;
    if (slopeAt(x, z) > 0.54) continue;
    const mask = noise2.fbm(x * 0.0019 + 6.4, z * 0.0019 - 2.2, 4);
    const cluster = noise2.fbm(x * 0.0065 - 1.7, z * 0.0065 + 8.1, 2);
    const density = clamp(0.26 + mask * 1.15 + cluster * 0.35, 0.03, 1);
    if (rand() > density * 0.7) continue;
    addTree(x, z, 0.85 + rand() * 0.35);
    if (matrices.fir.length + matrices.spruce.length + matrices.hemlock.length > 4300) break;
  }

  // ── tight old-growth walls around the five hidden glades ─────
  for (const run of RUNS) {
    if (!run.hidden) continue;
    for (let i = 6; i < run.samples.length - 6; i += 3) {
      const p = run.samples[i];
      for (const side of [-1, 1]) {
        if (rand() < 0.42) continue;
        const lat = run.width * 0.5 + 1.4 + rand() * 6.4;
        const x = p.x + p.nx * lat * side + (rand() - 0.5) * 2.2;
        const z = p.z + p.nz * lat * side + (rand() - 0.5) * 2.2;
        addTree(x, z, 0.95 + rand() * 0.5);
        if (rand() < 0.34) {
          const lat2 = run.width * 0.5 + 7 + rand() * 8;
          addTree(p.x + p.nx * lat2 * side + (rand() - 0.5) * 4,
            p.z + p.nz * lat2 * side + (rand() - 0.5) * 4, 0.9 + rand() * 0.5);
        }
      }
    }
  }

  // ── build instanced meshes ───────────────────────────────────
  const foliageMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0,
  });
  const trunkMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0,
  });
  const trunkGeo = trunkGeometry();

  const tintPalette = [
    [0.86, 0.93, 0.82], [1.0, 1.0, 1.0], [0.8, 0.9, 0.86],
    [0.94, 1.02, 0.9], [0.76, 0.86, 0.82],
  ];
  let tintIndex = 0;
  for (const kind of variants) {
    const list = matrices[kind];
    if (!list.length) continue;
    const geo = foliageGeometry(kind);
    const mesh = new THREE.InstancedMesh(geo, foliageMat, list.length);
    mesh.name = `trees-${kind}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    for (let i = 0; i < list.length; i++) {
      mesh.setMatrixAt(i, list[i]);
      const t = tintPalette[(tintIndex + i) % tintPalette.length];
      _c.setRGB(t[0], t[1], t[2]);
      mesh.setColorAt(i, _c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    tintIndex++;
  }

  if (trunkMats.length) {
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trunkMats.length);
    trunks.name = 'tree-trunks';
    trunks.frustumCulled = false;
    for (let i = 0; i < trunkMats.length; i++) trunks.setMatrixAt(i, trunkMats[i]);
    trunks.instanceMatrix.needsUpdate = true;
    group.add(trunks);
  }

  if (shadowMats.length) {
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: makeContactShadowTexture(), transparent: true, opacity: 0.7,
      depthWrite: false, color: 0x0a171c, polygonOffset: true, polygonOffsetFactor: -1,
    });
    const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, shadowMats.length);
    shadows.name = 'tree-shadows';
    shadows.frustumCulled = false;
    shadows.renderOrder = 0;
    for (let i = 0; i < shadowMats.length; i++) shadows.setMatrixAt(i, shadowMats[i]);
    shadows.instanceMatrix.needsUpdate = true;
    group.add(shadows);
  }

  return {
    group,
    count: trunkMats.length,
    setVisible(v) { group.visible = v; },
  };
}

/* ═══════════════════════════════════════════════════════════════
   ROCK & SNOW CAPS
   ═══════════════════════════════════════════════════════════════ */

function buildRocks(scene, grid, rand) {
  const group = new THREE.Group();
  group.name = 'rocks';
  scene.add(group);

  const rockMats = [];
  const capMats = [];
  const rockGeo = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  // rough up the silhouette once, so every rock shares the same weathered shape
  const pa = rockGeo.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const d = Math.sin(x * 5.1 + y * 3.7) * 0.12 + Math.cos(z * 4.3 - y * 2.1) * 0.1;
    const l = Math.hypot(x, y, z) || 1;
    pa.setXYZ(i, x * (1 + d) / l * 1.1, y * (0.8 + d * 0.6) / l, z * (1 + d) / l * 1.1);
  }
  rockGeo.computeVertexNormals();

  for (let i = 0; i < 460; i++) {
    const x = WORLD.minX + 100 + rand() * (WORLD.sizeX - 200);
    const z = WORLD.minZ + 100 + rand() * (WORLD.sizeZ - 200);
    const h = heightAt(x, z);
    if (h < 1080) continue;
    const p = pisteAt(x, z);
    if (p > 0.26) continue;
    if (slopeAt(x, z) < 0.06 && h < 1500) continue;
    const r = (0.9 + Math.pow(rand(), 2.2) * 5.2) * (h > 1850 ? 1.25 : 1);
    const rot = rand() * Math.PI * 2;
    dummy.position.set(x, h - r * 0.24, z);
    dummy.rotation.set(rand() * 0.4, rot, rand() * 0.32 - 0.16);
    dummy.scale.set(r * (0.8 + rand() * 0.5), r * (0.6 + rand() * 0.45), r * (0.8 + rand() * 0.5));
    dummy.updateMatrix();
    rockMats.push({ m: dummy.matrix.clone(), r, x, z, h });

    if (r > 1.7) {
      dummy.position.set(x, h + r * 0.36, z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(r * 0.72, r * 0.2, r * 0.62);
      dummy.updateMatrix();
      capMats.push(dummy.matrix.clone());
      grid.addCircle(x, z, r * 0.78, r > 3.3 ? 'boulder' : 'rock', { height: h });
    }
  }

  if (rockMats.length) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6a6d69, roughness: 0.98, metalness: 0.02, flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(rockGeo, mat, rockMats.length);
    mesh.name = 'boulders';
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    for (let i = 0; i < rockMats.length; i++) {
      mesh.setMatrixAt(i, rockMats[i].m);
      _c.setRGB(0.8 + rand() * 0.32, 0.78 + rand() * 0.3, 0.76 + rand() * 0.28);
      mesh.setColorAt(i, _c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  if (capMats.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf3f8fb, roughness: 0.92, flatShading: true });
    const caps = new THREE.InstancedMesh(rockGeo, mat, capMats.length);
    caps.name = 'snow-caps';
    caps.frustumCulled = false;
    for (let i = 0; i < capMats.length; i++) caps.setMatrixAt(i, capMats[i]);
    caps.instanceMatrix.needsUpdate = true;
    group.add(caps);
  }

  return group;
}
