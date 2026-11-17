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
  // A timer rather than rAF: world building must keep moving even when the
  // tab is in the background and compositor frames are paused.
  return new Promise((res) => setTimeout(res, 0));
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

export function pointInBox(px, pz, box, padX = 0, padZ = 0) {
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

/* ═══════════════════════════════════════════════════════════════
   LIFT SYSTEM
   Two gondolas, six chairs, and the 4.4 km Peak 2 Peak.
   ═══════════════════════════════════════════════════════════════ */

function buildCablePath(def, lateral = 0) {
  const nodes = def.points;
  const ys = nodes.map(([x, z]) => heightAt(x, z) + def.height);
  const pts = [];
  const isP2P = def.type === 'p2p';
  for (let i = 0; i < nodes.length - 1; i++) {
    const [x0, z0] = nodes[i];
    const [x1, z1] = nodes[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const segLen = Math.hypot(dx, dz);
    const nx = -dz / (segLen || 1), nz = dx / (segLen || 1);
    const sag = Math.min(isP2P ? 24 : 7, segLen * (isP2P ? 0.013 : 0.011));
    const steps = Math.max(2, Math.ceil(segLen / 9));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const y = lerp(ys[i], ys[i + 1], t) - sag * Math.sin(Math.PI * t);
      pts.push(new THREE.Vector3(
        lerp(x0, x1, t) + nx * lateral,
        y,
        lerp(z0, z1, t) + nz * lateral,
      ));
    }
  }
  const [lx, lz] = nodes[nodes.length - 1];
  pts.push(new THREE.Vector3(lx, ys[ys.length - 1], lz));
  return { pts, total: pathLength(pts) };
}

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += pts[i].distanceTo(pts[i - 1]);
  return d;
}

function makeSampler(pts) {
  const cum = new Float32Array(pts.length);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += pts[i].distanceTo(pts[i - 1]);
    cum[i] = total;
  }
  return {
    pts, cum, total: total || 1,
    at(t, outPos, outTan) {
      const d = clamp(t, 0, 0.999999) * total;
      let lo = 0, hi = pts.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid; else hi = mid;
      }
      const a = pts[lo], b = pts[Math.min(pts.length - 1, lo + 1)];
      const seg = cum[lo + 1] - cum[lo] || 1;
      const f = clamp((d - cum[lo]) / seg, 0, 1);
      outPos.lerpVectors(a, b, f);
      outTan.subVectors(b, a).normalize();
      return outPos;
    },
  };
}

function makeChairGeometry() {
  return mergeParts([
    part(new THREE.BoxGeometry(0.14, 0.2, 0.5), '#6f797d', [0, -0.08, 0]),
    part(new THREE.BoxGeometry(0.08, 2.15, 0.08), '#5e686c', [0, -1.18, 0]),
    part(new THREE.BoxGeometry(1.5, 0.16, 0.52), '#232b2f', [0, -2.2, 0.04]),
    part(new THREE.BoxGeometry(1.36, 0.09, 0.43), '#c65a2e', [0, -2.11, 0.04]),
    part(new THREE.BoxGeometry(1.5, 0.54, 0.12), '#2b3438', [0, -1.94, -0.22]),
    part(new THREE.BoxGeometry(1.34, 0.34, 0.05), '#b94f27', [0, -1.94, -0.17]),
    part(new THREE.BoxGeometry(0.06, 0.07, 0.55), '#5b6569', [-0.76, -1.64, 0.18]),
    part(new THREE.BoxGeometry(0.06, 0.07, 0.55), '#5b6569', [0.76, -1.64, 0.18]),
    part(new THREE.BoxGeometry(1.42, 0.05, 0.05), '#7b8589', [0, -1.62, 0.42]),
    part(new THREE.BoxGeometry(0.05, 0.5, 0.5), '#5b6569', [-0.76, -1.9, 0.18]),
    part(new THREE.BoxGeometry(0.05, 0.5, 0.5), '#5b6569', [0.76, -1.9, 0.18]),
  ]);
}

function makeCabinGeometry(color = '#1d2529', accent = '#e7e1d3', big = false) {
  const w = big ? 2.45 : 1.9;
  const h = big ? 2.2 : 1.9;
  const d = big ? 3.0 : 2.35;
  const bodyY = -1.15 - h / 2;
  const parts = [
    part(new THREE.BoxGeometry(0.16, 0.24, 0.6), '#5f696d', [0, -0.1, 0]),
    part(new THREE.BoxGeometry(0.1, 1.15, 0.1), '#4f5a5e', [0, -0.62, 0]),
    part(new THREE.BoxGeometry(0.62, 0.16, 0.62), '#3b4448', [0, -0.07, 0]),
    box(w, h, d, color, [0, bodyY, 0]),
    box(w * 0.92, 0.2, d * 0.92, accent, [0, bodyY + h / 2 - 0.02, 0]),
    box(w + 0.1, 0.12, d + 0.1, '#2a3236', [0, bodyY + h / 2 + 0.14, 0]),
    box(w + 0.06, 0.1, d + 0.06, '#1b2225', [0, bodyY - h / 2 + 0.04, 0]),
    box(w + 0.03, h * 0.5, d * 0.66, '#6c9aab', [0, bodyY + 0.1, 0]),
    box(w * 0.58, h * 0.42, 0.04, '#7ba9b7', [0, bodyY + 0.13, d / 2 + 0.03]),
    box(w * 0.58, h * 0.42, 0.04, '#6f9caa', [0, bodyY + 0.13, -d / 2 - 0.03]),
    box(w * 0.9, 0.08, 0.08, accent, [0, bodyY - h * 0.28, d / 2 + 0.06]),
    box(w * 0.9, 0.08, 0.08, accent, [0, bodyY - h * 0.28, -d / 2 - 0.06]),
  ];
  if (big) {
    parts.push(box(w * 1.004, 0.18, d * 1.004, accent, [0, bodyY + h * 0.28, 0]));
    parts.push(box(w * 0.4, 0.38, 0.06, '#b8332c', [0, bodyY - h * 0.05, d / 2 + 0.05]));
  }
  return mergeParts(parts);
}

function makeTowerGeometry() {
  return mergeParts([
    part(new THREE.CylinderGeometry(0.38, 0.72, 1, 8), '#6b7275', [0, 0.5, 0]),
    part(new THREE.BoxGeometry(4.4, 0.22, 0.34), '#747c80', [0, 0.96, 0]),
    part(new THREE.BoxGeometry(0.09, 0.42, 0.09), '#4d5559', [-1.65, 0.78, 0]),
    part(new THREE.BoxGeometry(0.09, 0.42, 0.09), '#4d5559', [1.65, 0.78, 0]),
    part(new THREE.BoxGeometry(0.28, 0.18, 0.56), '#3a4246', [-1.65, 0.95, 0]),
    part(new THREE.BoxGeometry(0.28, 0.18, 0.56), '#3a4246', [1.65, 0.95, 0]),
    part(new THREE.BoxGeometry(1.6, 0.5, 1.6), '#8a9294', [0, 0.2, 0]),
  ]);
}

function buildLifts(scene, grid, markers, rand) {
  const group = new THREE.Group();
  group.name = 'lifts';
  scene.add(group);

  const towerData = [];
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x495257, roughness: 0.55, metalness: 0.35 });
  const chairGeo = makeChairGeometry();
  const chairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, metalness: 0.16 });
  const chairCarriers = [];
  const cabinRigs = [];
  const lifts = [];

  const _pos = new THREE.Vector3();
  const _tan = new THREE.Vector3();

  for (const def of LIFTS) {
    const lateral = def.type === 'p2p' ? 3.1 : def.type === 'gondola' ? 1.45 : 1.2;
    const pathA = buildCablePath(def, lateral);
    const pathB = buildCablePath(def, -lateral);
    const samplerA = makeSampler(pathA.pts);
    const samplerB = makeSampler(pathB.pts);
    const lift = {
      def, samplerA, samplerB, pathA, pathB,
      length: samplerA.total,
      type: def.type,
    };

    for (const path of [pathA, pathB]) {
      const curve = new THREE.CatmullRomCurve3(path.pts, false, 'centripetal', 0.2);
      const geo = new THREE.TubeGeometry(curve, Math.min(420, Math.max(18, Math.ceil(path.total / 8))), def.type === 'p2p' ? 0.032 : 0.028, 4, false);
      const cable = new THREE.Mesh(geo, cableMat);
      cable.frustumCulled = false;
      group.add(cable);
    }

    for (let i = 0; i < def.points.length; i++) {
      const [x, z] = def.points[i];
      const prev = def.points[Math.max(0, i - 1)];
      const next = def.points[Math.min(def.points.length - 1, i + 1)];
      const dx = next[0] - prev[0], dz = next[1] - prev[1];
      const ang = Math.atan2(-dz, dx);
      towerData.push({ x, z, h: def.height + 3.2, ang });
      grid.addCircle(x, z, 1.15, 'lift-tower');
    }

    const n = def.type === 'gondola' || def.type === 'p2p' ? def.cabins : def.carriers;
    const groupCount = Math.ceil(n / 2);
    const speed = def.type === 'p2p' ? 8.2 : def.type === 'gondola' ? 5.1 : 4.1;
    const carriers = [];
    for (let i = 0; i < n; i++) {
      const dir = i % 2;
      const idx = Math.floor(i / 2);
      carriers.push({
        dir,
        offset: (idx + (dir === 0 ? 0.02 : 0.54)) / groupCount,
        speed,
        lift,
      });
    }

    if (def.type === 'chair') {
      for (const c of carriers) {
        c.mesh = null;
        c.index = chairCarriers.length;
        chairCarriers.push(c);
      }
    } else {
      const cabinColor = def.type === 'p2p' ? '#b8332c' : def.color;
      const accent = def.type === 'p2p' ? '#f2eee6' : '#e7e1d3';
      const geo = makeCabinGeometry(cabinColor, accent, def.type === 'p2p');
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.1 });
      const mesh = new THREE.InstancedMesh(geo, mat, carriers.length);
      mesh.name = `cabins-${def.id}`;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      carriers.forEach((c, i) => { c.mesh = mesh; c.index = i; });
      cabinRigs.push({ mesh, carriers, big: def.type === 'p2p' });
    }
    lift.carriers = carriers;
    lifts.push(lift);
  }

  let chairMesh = null;
  if (chairCarriers.length) {
    chairMesh = new THREE.InstancedMesh(chairGeo, chairMat, chairCarriers.length);
    chairMesh.name = 'chair-carriers';
    chairMesh.frustumCulled = false;
    chairMesh.castShadow = true;
    group.add(chairMesh);
  }

  if (towerData.length) {
    const geo = makeTowerGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.64, metalness: 0.28 });
    const towers = new THREE.InstancedMesh(geo, mat, towerData.length);
    towers.name = 'lift-towers';
    towers.frustumCulled = false;
    towers.castShadow = true;
    towers.receiveShadow = true;
    for (let i = 0; i < towerData.length; i++) {
      const t = towerData[i];
      const y = heightAt(t.x, t.z) - 0.25;
      dummy.position.set(t.x, y, t.z);
      dummy.rotation.set(0, t.ang, 0);
      dummy.scale.set(1, t.h, 1);
      dummy.updateMatrix();
      towers.setMatrixAt(i, dummy.matrix);
    }
    towers.instanceMatrix.needsUpdate = true;
    group.add(towers);
  }

  function updateCarriers(clock) {
    if (chairMesh) {
      for (const c of chairCarriers) {
        const S = c.dir === 0 ? c.lift.samplerA : c.lift.samplerB;
        const t = (c.offset + clock * c.speed / S.total) % 1;
        S.at(t, _pos, _tan);
        const yaw = Math.atan2(_tan.x, _tan.z);
        const swing = Math.sin(clock * 1.15 + c.index * 1.7) * 0.025;
        dummy.position.copy(_pos);
        dummy.rotation.set(swing, yaw, Math.sin(clock * 0.9 + c.index) * 0.015);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        chairMesh.setMatrixAt(c.index, dummy.matrix);
      }
      chairMesh.instanceMatrix.needsUpdate = true;
    }
    for (const rig of cabinRigs) {
      for (const c of rig.carriers) {
        const S = c.dir === 0 ? c.lift.samplerA : c.lift.samplerB;
        const t = (c.offset + clock * c.speed / S.total) % 1;
        S.at(t, _pos, _tan);
        const yaw = Math.atan2(_tan.x, _tan.z);
        const sway = Math.sin(clock * (rig.big ? 0.55 : 0.8) + c.index * 2.1) * (rig.big ? 0.012 : 0.025);
        dummy.position.copy(_pos);
        dummy.rotation.set(sway, yaw, Math.sin(clock * 0.7 + c.index) * 0.01);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        rig.mesh.setMatrixAt(c.index, dummy.matrix);
      }
      rig.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  updateCarriers(0);

  const p2p = lifts.find(l => l.def.id === 'p2p') || null;
  return {
    group, lifts, p2p, chairMesh, cabinRigs,
    update(clock) { updateCarriers(clock); },
  };
}

/* ═══════════════════════════════════════════════════════════════
   BOARDS, LODGES & TERMINALS
   ═══════════════════════════════════════════════════════════════ */

const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x7b858a, roughness: 0.38, metalness: 0.55 });
const glowMat = new THREE.MeshStandardMaterial({
  color: 0x29373b, emissive: 0xffb45c, emissiveIntensity: 1.15, roughness: 0.25, metalness: 0.12,
});

function boardTexture(text, sub, accent = '#ffc75b', bg = '#26352f', fg = '#f7f0e0') {
  const fs = text.length > 20 ? 44 : text.length > 15 ? 52 : text.length > 11 ? 60 : 70;
  return makeTextTexture(text, {
    width: 640, height: 220, bg, fg, accent,
    sub,
    font: `700 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`,
  });
}

function makeSign(text, sub, accent, width = 3.2, bg = '#26352f') {
  const group = new THREE.Group();
  const h = width / 2.909;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.16, h + 0.16, 0.12), woodMat);
  frame.position.z = -0.03;
  frame.castShadow = true;
  group.add(frame);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(width, h),
    new THREE.MeshStandardMaterial({
      map: boardTexture(text, sub, accent, bg),
      roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide,
      emissive: 0xffffff, emissiveIntensity: 0.045,
    }),
  );
  board.position.z = 0.04;
  group.add(board);
  return group;
}

function signPost(height = 2.1) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, height, 0.13), woodMat);
  post.position.y = height / 2;
  post.castShadow = true;
  return post;
}

function addTrailSign(markers, run, rand) {
  const p = runPointAt(run, run.hidden ? 0.055 : 0.022);
  if (!p) return;
  const sign = new THREE.Group();
  const diff = run.difficulty === 'hidden' ? 'hidden' : run.difficulty;
  const accent = diff === 'green' ? '#8be2a8' : diff === 'blue' ? '#8dc7ff'
    : diff === 'black' ? '#f7fbfd' : diff === 'double' ? '#ffd76e' : '#ffc75b';
  let board;
  if (run.hidden) {
    board = makeSign('LOCAL LINE', run.name, '#ffc75b', 2.35, '#45331f');
  } else {
    const label = run.difficulty === 'double' ? 'DOUBLE BLACK' : run.difficulty.toUpperCase();
    board = makeSign(run.name, `${run.mountain.toUpperCase()} · ${label}`, accent, 3.1);
  }
  const postH = run.hidden ? 1.65 : 2.15;
  const post = signPost(postH);
  sign.add(post);
  board.position.y = postH + (run.hidden ? 0.72 : 0.93);
  sign.add(board);
  const side = (run.id.charCodeAt(0) % 2 === 0) ? 1 : -1;
  const lat = run.width * 0.5 + (run.hidden ? 3.0 : 3.7) + rand() * 3.2;
  const y = heightAt(p.x + p.nx * lat * side, p.z + p.nz * lat * side);
  sign.position.set(p.x + p.nx * lat * side, y - 0.15, p.z + p.nz * lat * side);
  sign.rotation.y = Math.atan2(-p.tx, -p.tz);
  markers.add(sign);
}

function addSummitSign(markers, x, z, title, sub, accent = '#ffc75b') {
  const sign = new THREE.Group();
  const y = heightAt(x, z);
  const board = makeSign(title, sub, accent, 6.6, '#1e2b2e');
  board.position.y = 3.15;
  sign.add(board);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.8, 0.2), woodMat);
    post.position.set(side * 2.8, 1.4, -0.06);
    post.castShadow = true;
    sign.add(post);
  }
  sign.position.set(x, y - 0.2, z);
  sign.rotation.y = 0.35;
  markers.add(sign);
}

function addBuildingSign(markers, text, sub, accent, w = 4.6) {
  const sign = makeSign(text, sub, accent, w, '#1f2c2e');
  return sign;
}

function buildLodge(scene, grid, markers, lodge, rand) {
  const [w, h, d] = lodge.size;
  const group = new THREE.Group();
  group.name = `lodge-${lodge.id}`;
  const wallParts = [];
  const glowParts = [];
  const trim = lodge.type === 'base' ? '#6b4a2e' : lodge.type === 'hut' ? '#4f5a52' : '#5b4030';
  const wall = lodge.type === 'base' ? '#d8c7a4' : '#c9b993';
  const roofCol = '#dfe8ec';

  wallParts.push(box(w + 3, 1.7, d + 3, '#7a7f7a', [0, 0.85, 0]));
  wallParts.push(box(w, h, d, wall, [0, h / 2 + 1.25, 0]));
  wallParts.push(box(w + 0.4, 0.55, d + 0.4, trim, [0, 1.55, 0]));

  // gabled roof
  for (const side of [-1, 1]) {
    wallParts.push(box(w + 2.0, 0.32, d * 0.62, roofCol, [0, h + 1.85, side * d * 0.245], [side * 0.43, 0, 0]));
    wallParts.push(box(w + 2.2, 0.16, d * 0.64, '#8b9496', [0, h + 1.66, side * d * 0.25], [side * 0.43, 0, 0]));
  }
  wallParts.push(box(w + 2.0, 0.32, 0.4, trim, [0, h + 2.45, 0]));

  // deck + rails
  const deckZ = d / 2 + 2.2;
  wallParts.push(box(w + 8, 0.28, 4.4, '#6b5137', [0, 1.4, deckZ]));
  for (let i = -Math.floor((w + 6) / 4); i <= Math.floor((w + 6) / 4); i++) {
    wallParts.push(box(0.12, 1.05, 0.12, '#4b3a29', [i * 4, 2.0, d / 2 + 4.2]));
  }
  wallParts.push(box(w + 8, 0.12, 0.14, '#4b3a29', [0, 2.5, d / 2 + 4.2]));

  // windows and doors — emissive mesh
  const rows = lodge.type === 'hut' ? 1 : 2;
  const cols = Math.max(2, Math.floor(w / 9));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (c + 0.5) * (w / cols);
      const y = 2.7 + r * (h * 0.32);
      glowParts.push(box(1.65, 1.25, 0.08, '#6c8f96', [x, y, d / 2 + 0.04]));
      if (r === 0) glowParts.push(box(1.65, 1.25, 0.08, '#6c8f96', [x, y, -d / 2 - 0.04]));
    }
  }
  glowParts.push(box(2.0, 2.5, 0.08, '#7fa3aa', [w * 0.26, 2.4, d / 2 + 0.06]));
  glowParts.push(box(0.1, 2.4, 3.0, '#7fa3aa', [w / 2 + 0.06, 2.4, 0]));

  // chimney
  wallParts.push(box(1.5, 4.6, 1.5, '#7b7f7b', [w * 0.25, h + 1.9, -d * 0.16]));

  const mesh = mergedMesh(wallParts, { roughness: 0.85, metalness: 0.02 });
  group.add(mesh);
  if (glowParts.length) {
    const glow = new THREE.Mesh(mergeParts(glowParts), glowMat);
    glow.castShadow = false;
    group.add(glow);
  }

  if (lodge.type !== 'hut') {
    const sign = addBuildingSign(markers, lodge.name.toUpperCase(),
      lodge.type === 'summit' ? `${Math.round(heightAt(lodge.x, lodge.z))} M · ${lodge.id === 'roundhouse' ? 'WHISTLER' : 'BLACKCOMB'}` : 'WHISTLER BLACKCOMB',
      '#ffd694', lodge.type === 'base' ? 5.2 : 4.4);
    sign.position.set(0, h * 0.62 + 1.9, d / 2 + 4.32);
    group.add(sign);
  }

  const y = heightAt(lodge.x, lodge.z) - 0.75;
  group.position.set(lodge.x, y, lodge.z);
  group.rotation.y = lodge.rot;
  scene.add(group);
  grid.addBox(lodge.x, lodge.z, w / 2 + 3.2, d / 2 + 3.5, lodge.rot, 'lodge');
  return group;
}

function buildChalets(scene, grid, rand) {
  const group = new THREE.Group();
  group.name = 'chalets';
  for (const c of CHALETS) {
    const wallParts = [];
    const glowParts = [];
    const wood = ['#6e4f33', '#5b422d', '#7a5b3b'][Math.floor(rand() * 3)];
    wallParts.push(box(c.w + 1.4, 1.2, c.d + 1.4, '#7b7d76', [0, 0.6, 0]));
    wallParts.push(box(c.w, c.h, c.d, wood, [0, c.h / 2 + 0.9, 0]));
    for (const side of [-1, 1]) {
      wallParts.push(box(c.w + 1.4, 0.28, c.d * 0.62, '#e7eef1', [0, c.h + 1.35, side * c.d * 0.245], [side * 0.44, 0, 0]));
    }
    wallParts.push(box(0.9, 2.5, 0.9, '#6d6f6a', [c.w * 0.26, c.h + 0.9, -c.d * 0.18]));
    wallParts.push(box(1.4, 0.9, 0.08, '#5d4a35', [0, c.h + 0.5, c.d / 2 + 0.04]));
    glowParts.push(box(1.1, 1.15, 0.08, '#7b9aa0', [-c.w * 0.26, 2.3, c.d / 2 + 0.04]));
    glowParts.push(box(1.0, 1.05, 0.08, '#7b9aa0', [c.w * 0.26, 2.4, c.d / 2 + 0.04]));
    const mesh = mergedMesh(wallParts, { roughness: 0.88 });
    const holder = new THREE.Group();
    holder.add(mesh);
    if (glowParts.length) {
      const glow = new THREE.Mesh(mergeParts(glowParts), glowMat);
      holder.add(glow);
    }
    holder.position.set(c.x, heightAt(c.x, c.z) - 0.65, c.z);
    holder.rotation.y = c.rot;
    group.add(holder);
    grid.addBox(c.x, c.z, c.w / 2 + 1.2, c.d / 2 + 1.2, c.rot, 'chalet');
  }
  scene.add(group);
  return group;
}

function buildTerminal(scene, grid, markers, def, pointIndex, rand) {
  const [x, z] = def.points[pointIndex];
  const isP2P = def.type === 'p2p';
  const base = pointIndex === 0;
  const other = def.points[pointIndex === 0 ? 1 : def.points.length - 2];
  const dx = other[0] - x, dz = other[1] - z;
  const len = Math.hypot(dx, dz) || 1;
  const tx = dx / len, tz = dz / len;
  const nx = -tz, nz = tx;
  const off = isP2P ? 10.5 : 8.0;
  const cx = x + nx * off * (base ? 1 : -1);
  const cz = z + nz * off * (base ? 1 : -1);
  const yaw = Math.atan2(tx, tz);

  const w = isP2P ? 17 : 12;
  const h = isP2P ? 7.2 : 6.0;
  const d = isP2P ? 11 : 8.5;
  const parts = [];
  const glowParts = [];
  parts.push(box(w + 2, 1.0, d + 2, '#747b7b', [0, 0.5, 0]));
  parts.push(box(w, h, d, isP2P ? '#755047' : '#506064', [0, h / 2 + 0.9, 0]));
  parts.push(box(w + 1.2, 0.5, d + 1.2, isP2P ? '#b8332c' : '#2c3b3e', [0, h + 0.9, 0]));
  parts.push(box(w + 3.0, 0.35, d + 3.4, '#e2eaed', [0, h + 1.5, 0]));
  parts.push(box(w * 0.84, 0.2, d * 0.8, '#aab7bb', [0, h + 0.3, 0]));
  for (const side of [-1, 1]) {
    parts.push(box(0.22, h, 0.22, '#2a3235', [side * (w / 2 - 0.4), h / 2 + 0.9, d / 2 - 0.3]));
  }
  glowParts.push(box(w * 0.72, 2.0, 0.08, '#73949c', [0, 3.1, d / 2 + 0.04]));
  glowParts.push(box(2.0, 2.8, 0.08, '#86adb5', [-w * 0.3, 2.6, d / 2 + 0.05]));
  glowParts.push(box(2.0, 2.8, 0.08, '#86adb5', [w * 0.3, 2.6, d / 2 + 0.05]));

  const holder = new THREE.Group();
  holder.add(mergedMesh(parts, { roughness: 0.72, metalness: 0.1 }));
  if (glowParts.length) holder.add(new THREE.Mesh(mergeParts(glowParts), glowMat));
  holder.position.set(cx, heightAt(cx, cz) - 0.55, cz);
  holder.rotation.y = yaw + (base ? 0 : Math.PI);
  scene.add(holder);
  grid.addBox(cx, cz, w / 2 + 1.2, d / 2 + 1.2, holder.rotation.y, 'station');

  if (base) {
    const label = isP2P ? 'PEAK 2 PEAK' : def.name.toUpperCase();
    const sub = isP2P ? 'WHISTLER · BLACKCOMB' : `WHISTLER BLACKCOMB · ${def.type.toUpperCase()}`;
    const sign = makeSign(label, sub, isP2P ? '#ffc75b' : '#e6eef1', isP2P ? 6.0 : 4.8, '#1e2b2e');
    sign.position.set(cx + tx * (w / 2 + 0.3), heightAt(cx, cz) + 4.6, cz + tz * (w / 2 + 0.3));
    sign.rotation.y = yaw - Math.PI / 2;
    markers.add(sign);
  }
  return { x: cx, z: cz, boardX: x, boardZ: z, yaw };
}

function buildFinishArch(scene, grid, markers, run, title, sub) {
  const p = runPointAt(run, 0.968);
  if (!p) return null;
  const halfW = 7.4;
  const group = new THREE.Group();
  const y = heightAt(p.x, p.z);
  const parts = [];
  for (const side of [-1, 1]) {
    parts.push(box(0.36, 6.0, 0.36, '#b23a2b', [side * halfW, 3.0, 0]));
  }
  parts.push(box(halfW * 2 + 1.2, 0.28, 0.3, '#b23a2b', [0, 5.8, 0]));
  parts.push(box(halfW * 2, 1.8, 0.16, '#1c272b', [0, 4.8, 0]));
  const arch = mergedMesh(parts, { roughness: 0.66 });
  group.add(arch);

  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(halfW * 2 - 0.3, 1.6),
    new THREE.MeshStandardMaterial({ map: makeTextTexture(title, {
      width: 1024, height: 180, bg: '#1c272b', fg: '#fff7e8', accent: '#ffc75b', sub,
      font: '700 74px "Barlow Condensed", "Arial Narrow", sans-serif',
    }), roughness: 0.7, side: THREE.DoubleSide }),
  );
  banner.position.set(0, 4.82, 0.1);
  group.add(banner);

  const checkerCanvas = makeCanvas(256, 32);
  const cc = checkerCanvas.ctx;
  for (let x = 0; x < 32; x++) {
    for (let y = 0; y < 4; y++) {
      cc.fillStyle = (x + y) % 2 ? '#f5f8f9' : '#1d2529';
      cc.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(halfW * 2, 1.4),
    new THREE.MeshStandardMaterial({ map: canvasTexture(checkerCanvas.canvas, { repeat: [1, 1] }), roughness: 0.9 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.rotation.z = Math.PI / 2;
  strip.position.set(0, 0.07, 0);
  group.add(strip);

  group.position.set(p.x, y, p.z);
  group.rotation.y = Math.atan2(-p.tx, -p.tz);
  scene.add(group);
  for (const side of [-1, 1]) {
    const wx = p.x + Math.cos(group.rotation.y) * side * halfW;
    const wz = p.z - Math.sin(group.rotation.y) * side * halfW;
    grid.addCircle(wx, wz, 0.55, 'arch-pole');
  }
  markers.add(group);
  return { x: p.x, z: p.z, run, title };
}

function buildFlags(scene, rand) {
  const group = new THREE.Group();
  group.name = 'flags';
  const flags = [];
  const spots = [
    { x: 1010, z: -900, color: 0xd8532c, rot: 0.4, size: 1.45 },
    { x: -980, z: -760, color: 0xffc75b, rot: -0.5, size: 1.35 },
    { x: 380, z: 1770, color: 0x2b7fc4, rot: 0.2, size: 1.2 },
    { x: -350, z: 1740, color: 0xe04b3a, rot: -0.2, size: 1.2 },
  ];
  for (const s of spots) {
    const flag = createFlag(s.color, s.size);
    flag.position.set(s.x, heightAt(s.x, s.z) - 0.1, s.z);
    flag.rotation.y = s.rot;
    group.add(flag);
    flags.push(flag);
  }
  scene.add(group);
  function update(t) {
    for (const flag of flags) {
      const f = flag.userData.flag;
      const base = f?.userData.base;
      if (!base) continue;
      const geo = f.geometry;
      const pos = geo.attributes.position;
      const w = f.geometry.parameters.width;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        const k = (x / w + 0.5);
        pos.setZ(i, Math.sin(x * 2.2 + t * 4.2 + y * 0.7) * 0.28 * k + Math.sin(t * 2.1 + y) * 0.05 * k);
      }
      pos.needsUpdate = true;
    }
  }
  return { group, update };
}

/* ═══════════════════════════════════════════════════════════════
   ASSEMBLY
   ═══════════════════════════════════════════════════════════════ */

export async function buildEnvironment(scene, { onProgress = () => {} } = {}) {
  const rand = mulberry32(9102026);
  const grid = new ColliderGrid();

  onProgress(0.03, 'Growing the old-growth forest…');
  await frame();
  const forest = buildForest(scene, grid, rand);

  onProgress(0.24, 'Scattering alpine rock…');
  await frame();
  buildRocks(scene, grid, rand);

  onProgress(0.36, 'Stringing the lifts…');
  await frame();
  const markers = new THREE.Group();
  markers.name = 'markers';
  scene.add(markers);
  const lifts = buildLifts(scene, grid, markers, rand);

  onProgress(0.52, 'Building the lodges…');
  await frame();
  for (const lodge of LODGES) buildLodge(scene, grid, markers, lodge, rand);
  buildChalets(scene, grid, rand);

  onProgress(0.65, 'Hanging the trail signs…');
  await frame();
  for (const def of LIFTS) {
    buildTerminal(scene, grid, markers, def, 0, rand);
    buildTerminal(scene, grid, markers, def, def.points.length - 1, rand);
  }

  for (const run of RUNS) addTrailSign(markers, run, rand);

  onProgress(0.8, 'Marking the summits…');
  await frame();
  addSummitSign(markers, 1014, -916, 'WHISTLER PEAK', '2,182 M · WHISTLER MOUNTAIN', '#ffc75b');
  addSummitSign(markers, -970, -766, 'BLACKCOMB', '2,284 M · BLACKCOMB MOUNTAIN', '#ffc75b');

  const finishArches = [
    buildFinishArch(scene, grid, markers, RUNS.find(r => r.id === 'franz'), 'WHISTLER VILLAGE', 'FINISH · 675 M'),
    buildFinishArch(scene, grid, markers, RUNS.find(r => r.id === 'catskinner'), 'BLACKCOMB BASE', 'FINISH · 700 M'),
  ].filter(Boolean);

  const flags = buildFlags(scene, rand);

  // A dedicated centreline for the cinematic Peak 2 Peak ride.
  const p2pDef = LIFTS.find(l => l.id === 'p2p');
  const p2pCenter = buildCablePath(p2pDef, 0);
  const p2pSampler = makeSampler(p2pCenter.pts);

  onProgress(0.95, 'Checking the snow…');
  await frame();

  let markersVisible = true;
  let clock = 0;

  const env = {
    scene, grid, forest, markers, lifts, flags, finishArches,
    p2p: {
      sampler: p2pSampler,
      length: p2pSampler.total,
      fromWhistler: P2P_RIDE.fromWhistler,
      fromBlackcomb: P2P_RIDE.fromBlackcomb,
      boards: {
        whistler: P2P_RIDE.fromWhistler.board,
        blackcomb: P2P_RIDE.fromBlackcomb.board,
      },
    },
    queryColliders(x, z, r = 3) { return grid.query(x, z, r); },
    pointInBox,
    update(dt, time) {
      clock = time;
      lifts.update(time);
      flags.update(time);
    },
    setMarkersVisible(v) {
      markersVisible = v;
      markers.visible = v;
    },
    get markersVisible() { return markersVisible; },
    debug() {
      return {
        trees: forest.count,
        colliders: grid.circles.length,
        boxes: grid.boxes.length,
        lifts: lifts.lifts.length,
        clock,
      };
    },
  };

  onProgress(1, 'Ready.');
  return env;
}



