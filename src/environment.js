import * as THREE from 'three';
import { compactDevice } from './device-budget.js';
import { cameraClipper } from './camera-obstacles.js';
import {
  clamp, lerp, smoothstep, noise2, mulberry32, makeTextTexture, makeCanvas,
  canvasTexture, makeRadialTexture, formatNumber,
} from './util.js';
import {
  WORLD, RUNS, LIFTS, LODGES, FINISHES, MOUNTAIN, FITZSIMMONS, PEAK_TO_PEAK, VILLAGE_GONDOLA_UPPER, PEAK_EXPRESS, HARMONY_EXPRESS,
  runPointAt, runFromSource, startPose,
} from './worlddata.js';
import { heightAt, normalAt, slopeAt, pisteAt, landCoverAt, treeAnchorHeightAt } from './terrain.js';
import { createFlag } from './effects.js';
import { surfaceMaterial } from './materials.js';
import { coniferGeometry, coniferMaterial } from './conifers.js';
import { forestShadowTiles } from './forest-shadows.js';
import { climateUniforms } from './climate-state.js';
import { buildNeedleShoots } from './needle-shoots.js';
import { ForestCell, batchBudgetForestCrowns, forestDetailTiers, forestQuality, makeForestCrowns, shareForestInstances } from './forest-lod.js';
import { coniferInView, crownDistanceSquared, forestView, setConiferBounds } from './forest-culling.js';
import { makeForestUndergrowth } from './forest-undergrowth.js';
import { part, box, beam, cacheStaticTransforms, mergeParts, mergedMesh } from './scenery.js';
import { buildResortPeople } from './resort-people.js';
import { buildRoundhouseArrival } from './roundhouse.js';
import { stageFairmont,FAIRMONT_REPLACED_IDS } from './fairmont.js';
import { roofHeights } from '../data/roof-heights.js';
import { stageCreeksideVillage, creeksideFloor, CREEKSIDE_BUILDING_IDS } from './creekside-village.js';
import { buildSkiersPlaza, SKIERS_PLAZA_BUILDING_IDS } from './skiers-plaza.js';
import { buildSummitLandmarks, buildAlpineChairStation } from './alpine-landmarks.js';
import { buildingData } from '../data/osm-whistler.js';
import { buildLodgeInteriors, buildBlackcombTerminal, ENTERABLE_VILLAGE_IDS, lodgeSocialSlots } from './lodge-interiors.js';
import { buildChairTurnaround, buildMappedTerminal, buildStationOperations, REPLACED_STATION_BUILDING_IDS } from './lift-stations.js';
import { makeGondolaShell, addGondolaShell, attachCreeksideReflection, gondolaFleetGeometry,
  gondolaDoorsAtDistance } from './gondola-shell.js';
import { ropeOffset, stationPoint, stationSite } from './station-sites.js';
import { buildAlpineCliffs } from './alpine-cliffs.js';
import { buildGlacierCave } from './glacier-cave.js';
import { createRoofSnow, createIcicles } from './roof-weather.js';

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
    this.buildings = [];
    this.buildingCells = new Map();
  }

  key(x, z) {
    return `${Math.floor(x / GRID_CELL)},${Math.floor(z / GRID_CELL)}`;
  }

  addCircle(x, z, r, type, extra = {}) {
    const c = { x, z, r, type, ...extra };
    this.circles.push(c);
    this.register(c, r);
    return c;
  }

  addBox(x, z, hw, hd, rot, type, extra = {}) {
    const b = { x, z, hw, hd, rot, type, ...extra };
    this.boxes.push(b);
    this.register(b, Math.hypot(hw, hd));
    return b;
  }

  register(collider, rad) {
    const { x, z } = collider;
    const x0 = Math.floor((x - rad) / GRID_CELL), x1 = Math.floor((x + rad) / GRID_CELL);
    const z0 = Math.floor((z - rad) / GRID_CELL), z1 = Math.floor((z + rad) / GRID_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = `${ix},${iz}`;
        let arr = this.cells.get(k);
        if (!arr) { arr = []; this.cells.set(k, arr); }
        arr.push(collider);
      }
    }
  }

  addBuilding(building) {
    this.buildings.push(building);
    const xs = building.points.map(point => point[0]), zs = building.points.map(point => point[1]);
    for (let x = Math.floor(Math.min(...xs) / GRID_CELL); x <= Math.floor(Math.max(...xs) / GRID_CELL); x++) {
      for (let z = Math.floor(Math.min(...zs) / GRID_CELL); z <= Math.floor(Math.max(...zs) / GRID_CELL); z++) {
        const key = `${x},${z}`;
        if (!this.buildingCells.has(key)) this.buildingCells.set(key, []);
        this.buildingCells.get(key).push(building);
      }
    }
  }

  buildingsAt(x, z) {
    return (this.buildingCells.get(this.key(x, z)) ?? []).filter(({ points }) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [a, b] = points[i], [c, d] = points[j];
        if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) inside = !inside;
      }
      return inside;
    });
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

function buildForest(scene, grid, rand, detail) {
  const group = new THREE.Group();
  group.name = 'Forest · WorldCover tree mask';
  scene.add(group);
  const buckets = new Map();
  const clearings = LIFTS.filter((lift) => lift.aerial).flatMap(lift =>
    [stationSite(lift, 0), stationSite(lift, lift.points.length - 1)]);
  const treeSites = new Set();
  const exclusions = new Map(), exclusionCell = 256;
  const reserve = (shape, minX, maxX, minZ, maxZ) => {
    for(let ix=Math.floor(minX/exclusionCell);ix<=Math.floor(maxX/exclusionCell);ix++)
      for(let iz=Math.floor(minZ/exclusionCell);iz<=Math.floor(maxZ/exclusionCell);iz++) {
        const key=`${ix},${iz}`;
        if(!exclusions.has(key)) exclusions.set(key,[]);
        exclusions.get(key).push(shape);
      }
  };
  // The land-cover pixels are wider than a lodge or a lift cut. Keep the
  // actual footprints and cable corridors clear even as the canopy fills in.
  for(const lot of buildingData) {
    const xs=lot.points.map(p=>p[0]),zs=lot.points.map(p=>p[1]);
    const box={minX:Math.min(...xs)-8,maxX:Math.max(...xs)+8,minZ:Math.min(...zs)-8,maxZ:Math.max(...zs)+8};
    reserve(box,box.minX,box.maxX,box.minZ,box.maxZ);
  }
  for(const lodge of LODGES) {
    const radius=Math.hypot(lodge.size[0],lodge.size[2])*.5+9;
    const box={minX:lodge.x-radius,maxX:lodge.x+radius,minZ:lodge.z-radius,maxZ:lodge.z+radius};
    reserve(box,box.minX,box.maxX,box.minZ,box.maxZ);
  }
  for(const lift of LIFTS.filter(l=>l.type!=='p2p'))
    for(let i=1;i<lift.points.length;i++) {
      const [ax,az]=lift.points[i-1],[bx,bz]=lift.points[i];
      const r = lift.aerial ? 18 : 5;
      const cut={ax,az,bx,bz,dx:bx-ax,dz:bz-az,ll:(bx-ax)**2+(bz-az)**2,r};
      reserve(cut,Math.min(ax,bx)-r,Math.max(ax,bx)+r,Math.min(az,bz)-r,Math.max(az,bz)+r);
    }
  let count = 0;
  const patchSize = detail.budget ? 210 : 420;
  const species = ['fir', 'spruce', 'hemlock'];
  const variants = [...species, ...species];
  const needleMaterial = coniferMaterial(-1, 'mapped');
  const geometry = (kind, index, level) => coniferGeometry(kind, level, Math.floor(index / species.length));
  const distantTemplates = variants.map((kind, i) => geometry(kind, i, -1));
  const silhouetteTemplate = geometry('hemlock',2,-2);
  const silhouetteMaterial = coniferMaterial(-2, 'mapped');
  const shadows = forestShadowTiles(group);
  const setTree = (mesh, index, tree) => {
    dummy.position.set(tree.x, tree.y, tree.z);
    dummy.scale.set(tree.apex * tree.stretch, tree.apex, tree.apex * tree.stretch);
    dummy.rotation.set(0, tree.yaw, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    // Carry the same tint through every level so an older, blue-green tree
    // keeps its identity as the skier approaches the stand.
    const tone = Math.sin(tree.yaw * 13 + tree.apex) * .5 + .5;
    _c.setRGB(.76 + .24 * tone, .83 + .17 * tone, .84 + .13 * tone);
    mesh.setColorAt(index, _c);
  };

  const addTree = (x, z, young = false, source = rand) => {
    if (landCoverAt(x, z) !== 10 || pisteAt(x, z) > 0.23) return;
    if (clearings.some(({ x: cx, z: cz }) => (cx - x) ** 2 + (cz - z) ** 2 < 27 ** 2)) return;
    for(const shape of exclusions.get(`${Math.floor(x/exclusionCell)},${Math.floor(z/exclusionCell)}`)||[]) {
      if(shape.ll!==undefined) {
        const t=clamp(((x-shape.ax)*shape.dx+(z-shape.az)*shape.dz)/(shape.ll||1),0,1);
        if((x-shape.ax-shape.dx*t)**2+(z-shape.az-shape.dz*t)**2<shape.r**2) return;
      } else if(x>shape.minX&&x<shape.maxX&&z>shape.minZ&&z<shape.maxZ) return;
    }
    if (slopeAt(x, z) > 0.53) return;
    const key = `${Math.floor(x / 5.8)},${Math.floor(z / 5.8)}`;
    if (treeSites.has(key)) return;
    treeSites.add(key);
    const y = heightAt(x, z);
    const apex = young ? 2.8 + source() ** 1.4 * 7.2
      : y>1760 ? 12 + source()**.72*15
        : y>1580 ? 18 + source()**.62*22
          : 22 + source()**.55*31;
    const family = y > 1550 ? Math.round(source()) : Math.floor(source() * 3);
    const yaw = source() * Math.PI * 2;
    const stretch = .96 + source() * .29;
    const kind = family + (young || apex < 14 ? species.length : 0);
    const cell = `${Math.floor(x / patchSize)},${Math.floor(z / patchSize)},${kind}`;
    if (!buckets.has(cell)) buckets.set(cell, { kind, trees: [] });
    const tree = { x, y: treeAnchorHeightAt(x,z,y), z, apex, yaw, stretch, kind };
    buckets.get(cell).trees.push(tree);
    grid.addCircle(x, z, Math.min(.88, apex * .021), 'tree', { tree, minY:tree.y-.75, maxY:tree.y+apex });
    count++;
  };

  for (let z = WORLD.minZ + 18; z < WORLD.maxZ - 18; z += 23) {
    for (let x = WORLD.minX + 18; x < WORLD.maxX - 18; x += 23) {
      // Stratified jitter fills distant forest slopes without visible rows.
      // Every tree persists: distance changes geometry, never stand density.
      addTree(x + (rand() - 0.5) * 20, z + (rand() - 0.5) * 20);
      // Irregular groups close gaps in the canopy without making rows.
      if(noise2.fbm(x*.005,z*.005,2)>.16 && rand()<.58)
        addTree(x+(rand()-.5)*24,z+(rand()-.5)*24);
    }
  }
  // Fill forest around the runs and the lift corridors, where the skier sees it at ground level.
  for (const run of RUNS) {
    if (run.length < 65) continue;
    for (let i = 0; i < run.samples.length; i += 6) {
      const p = run.samples[i];
      for (const side of [-1, 1]) {
        for (let layer = 0; layer < 2; layer++) {
          const off = side * (run.width / 2 + 7 + layer * 13 + rand() * 13);
          addTree(p.x + p.nx * off + rand() * 10, p.z + p.nz * off + rand() * 10);
        }
      }
    }
  }
  for (let z = 26; z < 1805; z += 12) {
    for (let x = -410; x < 410; x += 13) {
      if (Math.abs(x - 2) < 12) continue;
      addTree(x + rand() * 8, z + rand() * 8);
    }
  }

  // Enrich real subalpine cover on the fall-away beside the Roundhouse plaza.
  for (let z = 4630; z < 4835; z += 11) {
    for (let x = 318; x < 440; x += 12) {
      addTree(x + rand() * 9, z + rand() * 9);
    }
  }

  // Small groups of young evergreens grow beside established trees, inside
  // the same mapped forest boundary. Separate seed preserves mature stands.
  const seedlings = mulberry32(71581);
  const parents = grid.circles.filter(({ tree }) => tree && seedlings() < .083);
  for (const { tree } of parents) {
    const bearing = seedlings() * Math.PI * 2;
    for (let i = 0; i < 2; i++) {
      const angle = bearing + seedlings() * 1.8, radius = 4.5 + seedlings() * 5.5;
      addTree(tree.x + Math.cos(angle) * radius, tree.z + Math.sin(angle) * radius, true, seedlings);
    }
  }

  const patchSizes = variants.map(() => []), stands = new Map();
  for (const { kind, trees } of buckets.values()) {
    const mesh = new THREE.InstancedMesh(distantTemplates[kind], needleMaterial, trees.length);
    const caster = geometry(variants[kind], kind, -2);
    for (const [i, tree] of trees.entries()) {
      setTree(mesh, i, tree);
      shadows.add(tree.x, tree.z, caster, dummy.matrix);
      tree.batch = mesh;
      tree.index = i;
    }
    mesh.computeBoundingSphere();
    mesh.instanceMatrix.needsUpdate = true;
    const cellKey = `${Math.floor(trees[0].x / 420)},${Math.floor(trees[0].z / 420)}`;
    if (!stands.has(cellKey)) stands.set(cellKey,{near:new THREE.Group(),trees:[]});
    const cell = stands.get(cellKey);
    cell.near.add(mesh);
    cell.trees.push(...trees);
    patchSizes[kind].push(trees.length);
  }
  shadows.finish();
  for (const { near,trees } of stands.values()) {
    const proxy = makeForestCrowns('mapped',trees.map(tree=>tree.kind));
    const instances = proxy ?? new THREE.InstancedMesh(silhouetteTemplate,silhouetteMaterial,trees.length);
    const center = new THREE.Vector3();
    for (const [i,tree] of trees.entries()) {
      setTree(instances,i,tree);
      center.x += tree.x;
      center.y += tree.y + tree.apex*.5;
      center.z += tree.z;
    }
    center.multiplyScalar(1/trees.length);
    const far = proxy ? shareForestInstances(proxy, silhouetteTemplate, silhouetteMaterial) : instances;
    far.name = 'mature conifer silhouettes';
    far.computeBoundingSphere();
    proxy?.computeBoundingSphere();
    near.position.copy(center).negate();
    far.position.copy(near.position);
    proxy?.position.copy(near.position);
    const radius = far.boundingSphere.radius + far.boundingSphere.center.distanceTo(center);
    group.add(new ForestCell('mapped',center,radius,near,far,proxy));
  }
  batchBudgetForestCrowns(group, 'mapped', 1680);

  // A detail query can touch at most nine patches. The actual
  // population bounds each instance buffer even when the whole query faces us.
  const capacities = patchSizes.map((sizes) => sizes.sort((a,b) => b-a)
    .slice(0,9).reduce((sum,n) => sum+n,0));
  const makeDetail = (level) => {
    const material = coniferMaterial(level);
    return variants.map((kind,i) => {
      const mesh = new THREE.InstancedMesh(geometry(kind,i,level),material,capacities[i]);
      mesh.name = kind + (level === -.5 ? ' lower branches' : level === 1 ? ' branch sprays' : ' terminal twigs');
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _c);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.boundingSphere = new THREE.Sphere();
      mesh.userData.trees = [];
      group.add(mesh);
      return mesh;
    });
  };
  const base = makeDetail(-.5), mid = makeDetail(1), close = makeDetail(2);
  const detailMeshes = [...base,...mid,...close];
  const updateNeedles = buildNeedleShoots(group,grid,species,close);
  const updateUndergrowth = makeForestUndergrowth(group, {
    region: 'whistler-blackcomb',
    heightAt,
    treesAt: (x, z, radius) => grid.query(x, z, radius),
    permits: (x, z) => landCoverAt(x, z) === 10 && pisteAt(x, z) < .18
      && slopeAt(x, z) < .42 && !grid.buildingsAt(x, z).length,
  });
  const lastEye = new THREE.Vector3(Infinity,Infinity,Infinity);
  const footprint = new Float64Array(6);
  let candidates = [], lastView, viewRevision;
  let detailScale = 0;
  function include(mesh, tree) {
    const dst = mesh.count++;
    const previous = mesh.userData.trees;
    if (previous[dst] === tree) return;
    previous[dst] = tree;
    const src = tree.index, batch = tree.batch;
    for (let i=0;i<16;i++) mesh.instanceMatrix.array[dst*16+i] = batch.instanceMatrix.array[src*16+i];
    for (let i=0;i<3;i++) mesh.instanceColor.array[dst*3+i] = batch.instanceColor.array[src*3+i];
    mesh.userData.uploadStart = Math.min(mesh.userData.uploadStart,dst);
  }
  function includeVisible(mesh, tree, view, matrices, i) {
    setConiferBounds(footprint, 0, mesh.geometry, matrices, i);
    if (coniferInView(view, footprint)) include(mesh, tree);
  }
  function updateDetail(camera) {
    const eye = camera.position;
    updateUndergrowth(camera, forestQuality.name);
    updateNeedles(eye);
    const scale = forestQuality.detail.value;
    const moved = scale !== detailScale || lastEye.distanceToSquared(eye) >= 25;
    camera.updateWorldMatrix(true, false);
    const view = forestView(camera);
    if (!moved && lastView === view && viewRevision === view.revision) return;
    lastView = view;
    viewRevision = view.revision;
    const baseDistance = forestDetailTiers[-.5][1]*scale+.08;
    const midDistance = forestDetailTiers[1][1]*scale+.08;
    const closeDistance = forestDetailTiers[2][1]*scale+.08;
    const baseDistanceSq = baseDistance ** 2, midDistanceSq = midDistance ** 2, closeDistanceSq = closeDistance ** 2;
    if (moved) {
      detailScale = scale;
      lastEye.copy(eye);
      candidates = grid.query(eye.x,eye.z,baseDistance+12-.08).filter(c => c.type === 'tree');
    }
    for (const mesh of detailMeshes) {
      mesh.count = 0;
      mesh.userData.uploadStart = Infinity;
      mesh.boundingSphere.center.copy(eye);
      mesh.boundingSphere.radius = baseDistance+62;
    }
    for (const { tree } of candidates) {
      const { batch, index, kind } = tree;
      const matrices = batch.instanceMatrix.array, i = index * 16;
      const distance = crownDistanceSquared(eye, matrices[i + 12], matrices[i + 13], matrices[i + 14],
        matrices[i + 13] + matrices[i + 5]);
      if (distance > baseDistanceSq) continue;
      includeVisible(base[kind], tree, view, matrices, i);
      if (distance < midDistanceSq) includeVisible(mid[kind], tree, view, matrices, i);
      if (distance < closeDistanceSq) includeVisible(close[kind], tree, view, matrices, i);
    }
    for (const mesh of detailMeshes) {
      mesh.visible = mesh.count > 0;
      const start = mesh.userData.uploadStart;
      if (!mesh.visible || !Number.isFinite(start)) continue;
      mesh.instanceMatrix.addUpdateRange(start*16,(mesh.count-start)*16);
      mesh.instanceColor.addUpdateRange(start*3,(mesh.count-start)*3);
      mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    }
  }
  cacheStaticTransforms(group);
  return { group, count, updateDetail, updateShadows: shadows.update };
}

/* ═══════════════════════════════════════════════════════════════
   ROCK & SNOW CAPS
   ═══════════════════════════════════════════════════════════════ */

function buildRocks(scene, grid, rand, detail) {
  const group = new THREE.Group();
  group.name = 'rocks · fractured Coast Range granite';
  scene.add(group);

  function fracturedRock(seed, fragment, reduced) {
    const rng=mulberry32(seed), positions=[], normals=[], capPositions=[], snowDepths=[];
    const vec=(x,y,z)=>new THREE.Vector3(x,y,z);
    // Intersect geological joint planes, rather than displacing a sphere.
    // The same outer mass is split into displaced, stepped fracture blocks.
    // Each exposed joint is a real planar face and every fissure has depth.
    const boundary=[];
    const turn=rng()*Math.PI*2;
    for(let i=0;i<7;i++) {
      const angle=turn+i*Math.PI*2/7+(rng()-.5)*.16;
      boundary.push({n:vec(Math.cos(angle),.06+rng()*.15,Math.sin(angle)),d:.78+rng()*.20});
    }
    boundary.push({n:vec(0,-1,0),d:.68});
    // Broad bevels trim corners without rounding the entire outcrop.
    for(let i=0;i<3;i++) {
      const angle=turn+i*2.18;
      boundary.push({n:vec(Math.cos(angle)*.63,.7,Math.sin(angle)*.63),d:1.10+rng()*.17});
    }
    const intersection=(a,b,c)=>{
      const bc=new THREE.Vector3().crossVectors(b.n,c.n),det=a.n.dot(bc);
      if(Math.abs(det)<1e-6)return null;
      return bc.multiplyScalar(a.d).add(new THREE.Vector3().crossVectors(c.n,a.n).multiplyScalar(b.d))
        .add(new THREE.Vector3().crossVectors(a.n,b.n).multiplyScalar(c.d)).multiplyScalar(1/det);
    };
    const polygon=(planes,face)=>{
      const vertices=[];
      for(let i=0;i<planes.length;i++)for(let j=i+1;j<planes.length;j++) {
        if(planes[i]===face||planes[j]===face)continue;
        const p=intersection(face,planes[i],planes[j]);
        if(!p||planes.some(q=>q.n.dot(p)>q.d+1e-5)||vertices.some(v=>v.distanceToSquared(p)<1e-8))continue;
        vertices.push(p);
      }
      if(vertices.length<3)return null;
      const center=vertices.reduce((v,p)=>v.add(p),vec(0,0,0)).multiplyScalar(1/vertices.length);
      const normal=face.n.clone().normalize();
      const u=new THREE.Vector3().crossVectors(Math.abs(normal.y)<.8?up:vec(1,0,0),normal).normalize();
      const v=new THREE.Vector3().crossVectors(normal,u);
      vertices.sort((a,b)=>Math.atan2(a.clone().sub(center).dot(v),a.clone().sub(center).dot(u))-
        Math.atan2(b.clone().sub(center).dot(v),b.clone().sub(center).dot(u)));
      return {vertices,center,normal};
    };
    const triangle=(buffer,a,b,c)=>buffer.push(...a.toArray(),...b.toArray(),...c.toArray());
    const smoothFace=(start,faceNormal)=>{
      const vertexNormals=new Map(),keyAt=i=>`${Math.round(positions[i]*10000)},${Math.round(positions[i+1]*10000)},${Math.round(positions[i+2]*10000)}`;
      for(let i=start;i<positions.length;i+=9) {
        const a=vec(positions[i],positions[i+1],positions[i+2]);
        const b=vec(positions[i+3],positions[i+4],positions[i+5]),c=vec(positions[i+6],positions[i+7],positions[i+8]);
        const n=new THREE.Vector3().crossVectors(b.sub(a),c.sub(a));
        for(let j=0;j<9;j+=3) {
          const key=keyAt(i+j);if(!vertexNormals.has(key))vertexNormals.set(key,vec(0,0,0));
          vertexNormals.get(key).add(n);
        }
      }
      for(let i=start;i<positions.length;i+=3) {
        const n=vertexNormals.get(keyAt(i)).clone().normalize().multiplyScalar(.72).addScaledVector(faceNormal,.28).normalize();
        normals.push(n.x,n.y,n.z);
      }
    };
    const xCuts=fragment?[-1.5,1.5]:[-1.5,-.32,.29,1.5],zCuts=fragment?[-1.5,1.5]:[-1.5,.035,1.5];
    const levels=fragment?[.58,.71,.52,.80,.47,.64]:[.50,.90,.65,.80,.37,.72];
    const weather=p=>{
      const q=p.clone();
      const notch=Math.max(0,.20-Math.abs(noise2.fbm(p.x*9.2+p.z*6.4+seed,p.y*8.6,2)))*.48;
      q.x+=noise2.fbm(p.x*4.1+p.z*1.71+seed,p.y*5.1,2)*.13-p.x*notch;
      q.y+=noise2.fbm(p.z*4.8+p.x*1.17,p.y*4.6+seed,2)*.11-notch*.35;
      q.z+=noise2.fbm(p.z*5.3+p.y*1.73+seed,p.x*4.9,2)*.14-p.z*notch;
      return q;
    };
    let block=0;
    for(let ix=0;ix<xCuts.length-1;ix++)for(let iz=0;iz<zCuts.length-1;iz++) {
      const top=levels[(block+seed)%levels.length]+(rng()-.5)*.12;
      const jointLean=.10+(rng()-.5)*.12;
      const planes=[...boundary,
        {n:vec(-1,-jointLean,-.11),d:-xCuts[ix]-.012},
        {n:vec(1,jointLean,.11),d:xCuts[ix+1]-.012},
        {n:vec(.08,-.12,-1),d:-zCuts[iz]-.014},
        {n:vec(-.08,.12,1),d:zCuts[iz+1]-.014},
        {n:vec((rng()-.5)*.44,1,(rng()-.5)*.46),d:top}];
      const cx=clamp((xCuts[ix]+xCuts[ix+1])*.5,-.60,.60),cz=clamp((zCuts[iz]+zCuts[iz+1])*.5,-.47,.47);
      // Broken upper corners and flakes leave oblique shoulders instead of
      // the square edges of a sawn slab. Adjacent blocks expose new arrises.
      for(let chip=0;chip<4;chip++) {
        const angle=turn+block*1.37+chip*1.72+(rng()-.5)*.6;
        const n=vec(Math.cos(angle)*.72,.65+rng()*.23,Math.sin(angle)*.72);
        const reach=(fragment ? .30 : .10)+rng()*(fragment ? .16 : .13);
        planes.push({n,d:n.x*cx+n.z*cz+n.y*top+reach});
      }
      // Different blocks have settled by a few centimetres along their joints.
      const lowerJoint=Math.min(.24+rng()*.25,top-.22);
      const jointX=(rng()-.5)*.46,jointZ=(rng()-.5)*.5;
      const layers=fragment?[[-.8,2,0]]:[[-.8,lowerJoint,0],[lowerJoint+.023,2,1]];
      for(const [bottom,ceiling,layer] of layers) {
        const layerPlanes=fragment?planes:[...planes,
          {n:vec(-jointX,-1,-jointZ),d:-bottom},{n:vec(jointX,1,jointZ),d:ceiling}];
        const settle=fragment?0:(1-layer)*.066;
        const shift=vec((ix-1)*(.025+settle)+(rng()-.5)*.045,
          (rng()-.5)*.025,(iz-.5)*(.04+settle*1.4)+(rng()-.5)*.06);
        for(const face of layerPlanes) {
          const poly=polygon(layerPlanes,face);if(!poly)continue;
          const {center,normal}=poly,vertices=[];
          // Sparse edge chips and shallow surface spalls stay in geometry.
          // The same deterministic erosion field matches both faces of an edge.
          for(let i=0;i<poly.vertices.length;i++) {
            const a=poly.vertices[i],b=poly.vertices[(i+1)%poly.vertices.length];
            const steps=Math.max(1,Math.ceil(a.distanceTo(b)/(fragment ? .26 : .12)));
            for(let j=0;j<steps;j++)vertices.push(weather(a.clone().lerp(b,j/steps)).add(shift));
          }
          center.copy(weather(center)).add(shift).addScaledVector(normal,-.009-rng()*.015);
          const faceStart=positions.length;
          for(let i=0;i<vertices.length;i++) {
            const a=center,b=vertices[i],c=vertices[(i+1)%vertices.length];
            // Keep the weathered rim and all fracture planes. At reduced detail
            // remove the small triangles that only sculpt the face interior.
            if (reduced) {
              triangle(positions,a,b,c);
              continue;
            }
            const steps=Math.max(2,Math.ceil(Math.max(a.distanceTo(b),a.distanceTo(c))/(fragment ? .30 : .15)));
            const stonePoint=(u,v)=>{
              const q=a.clone().multiplyScalar(1-u-v).addScaledVector(b,u).addScaledVector(c,v);
              const edge=Math.sin(Math.PI*(u+v));
              const chip=noise2.fbm(q.x*14.6+q.z*6.2+seed,q.y*15.2-q.z*2.3,3);
              const cutPlane=q.y*.82+q.x*.31-q.z*.21+noise2.fbm(q.x*8.1+seed,q.z*7.7,2)*.055;
              const crack=Math.max(0,1-Math.abs(cutPlane-(.16+(seed%7)*.043))/.037);
              const flake=Math.max(0,1-Math.abs(q.y*.67-q.x*.44+q.z*.35-.36)/.025);
              const relief=normal.y>.48?chip*.02:chip*.105-.056*crack-.024*flake;
              return q.addScaledVector(normal,relief*edge);
            };
            for(let u=0;u<steps;u++)for(let v=0;v<steps-u;v++) {
              const q=stonePoint(u/steps,v/steps),r=stonePoint((u+1)/steps,v/steps),t=stonePoint(u/steps,(v+1)/steps);
              triangle(positions,q,r,t);
              if(u+v<steps-1)triangle(positions,r,stonePoint((u+1)/steps,(v+1)/steps),t);
            }
          }
          smoothFace(faceStart,normal);
          if(normal.y<.48)continue;
          // Snow grows from these exact upward fracture faces. The outer ring
          // meets the stone, while the settled inner surface softens each ledge.
          const depth=(.027+rng()*.024)*normal.y;
          const outer=vertices.map(p=>p.clone().addScaledVector(normal,.003));
          const inner=vertices.map(p=>p.clone().lerp(center,.11+rng()*.045).addScaledVector(up,depth));
          const crest=center.clone().addScaledVector(up,depth*1.10);
          for(let i=0;i<vertices.length;i++) {
            const j=(i+1)%vertices.length;
            triangle(capPositions,outer[i],outer[j],inner[i]);snowDepths.push(.003,.003,depth);
            triangle(capPositions,outer[j],inner[j],inner[i]);snowDepths.push(.003,depth,depth);
            triangle(capPositions,inner[i],inner[j],crest);snowDepths.push(depth,depth,depth*1.1);
          }
        }
      }
      block++;
    }
    const rock = indexFracturedRock(positions, normals);
    const cap=new THREE.BufferGeometry();
    cap.setAttribute('position',new THREE.Float32BufferAttribute(capPositions,3));
    cap.setAttribute('snowDepth',new THREE.Float32BufferAttribute(snowDepths,1));
    cap.computeVertexNormals();cap.computeBoundingSphere();
    return {rock,cap};
  }
  const shapeCount=5;
  const makeShapes = reduced => [
    ...Array.from({length:shapeCount},(_,i)=>fracturedRock(1783+i*7919,false,reduced)),
    ...Array.from({length:shapeCount},(_,i)=>fracturedRock(3313+i*9677,true,reduced)),
  ];
  const initialBudget = detail.budget;
  const shapes = makeShapes(initialBudget);
  const cells=new Map(), outcrops=[];
  const addStone=(x,z,kind,stone)=>{
    const key=`${Math.floor(x/460)},${Math.floor(z/460)}`;
    if(!cells.has(key))cells.set(key,[]);
    cells.get(key).push({kind,...stone});
  };
  const place=(x,z,r,kind)=>{
    const h=heightAt(x,z);
    if(h<1080||pisteAt(x,z)>.20) return;
    if(slopeAt(x,z)<.06&&h<1500) return;
    if(grid.query(x,z,r+10).some(c=>c.type!=='tree'&&Math.hypot(c.x-x,c.z-z)<r+8))return;
    dummy.position.set(x,h-r*.28,z);
    dummy.rotation.set(rand()*.32-.16,rand()*Math.PI*2,rand()*.28-.14);
    dummy.scale.set(r*(.82+rand()*.36),r*(.72+rand()*.29),r*(.82+rand()*.36));
    dummy.updateMatrix();
    if(r<3.3)kind+=shapeCount;
    addStone(x,z,kind,{matrix:dummy.matrix.clone(),cap:r>1.4,tone:rand()});
    if(r>1.7)grid.addCircle(x,z,r*.8,r>3.3?'boulder':'rock',{height:h});
    if(r>3.3)outcrops.push({x,z,r,kind});
  };
  for(let i=0;i<680;i++) {
    const x=WORLD.minX+100+rand()*(WORLD.sizeX-200),z=WORLD.minZ+100+rand()*(WORLD.sizeZ-200),h=heightAt(x,z);
    const r=(.85+Math.pow(rand(),2.2)*5.8)*(h>1850?1.28:1);
    place(x,z,r,i%shapeCount);
    if(r>5)for(let j=0;j<3;j++)place(x+(rand()-.5)*r*3.3,z+(rand()-.5)*r*3.3,r*(.15+rand()*.30),(i+j)%shapeCount);
  }
  // Angular rockfall settles on the terrain below its parent outcrop. Use a
  // separate seed so changing talus does not move the mapped main boulders.
  for(const [index,{x,z,r,kind}] of outcrops.entries()) {
    const fall=mulberry32(43649+index*17117);
    const gx=heightAt(x+.75,z)-heightAt(x-.75,z),gz=heightAt(x,z+.75)-heightAt(x,z-.75);
    const down=Math.atan2(-gz,-gx),spread=.7+fall()*.6;
    const count=5+Math.floor(fall()*6);
    for(let j=0;j<count;j++) {
      const bearing=down+(fall()-.5)*spread*2.6;
      const radius=r*(.84+fall()*1.20),tx=x+Math.cos(bearing)*radius,tz=z+Math.sin(bearing)*radius;
      const size=r*(.075+fall()**1.7*.19),h=heightAt(tx,tz);
      if(pisteAt(tx,tz)>.20||Math.hypot(tx-x,tz-z)<r*.73)continue;
      if(grid.query(tx,tz,size+5).some(c=>!['tree','rock','boulder'].includes(c.type)&&Math.hypot(c.x-tx,c.z-tz)<size+6))continue;
      const k=shapeCount+(kind+j+1)%shapeCount;
      dummy.position.set(tx,h-size*.22,tz);
      dummy.rotation.set((fall()-.5)*.35,bearing+fall(),(fall()-.5)*.35);
      dummy.scale.set(size*(1+fall()*.35),size*(.48+fall()*.38),size*(.7+fall()*.42));dummy.updateMatrix();
      addStone(tx,tz,k,{matrix:dummy.matrix.clone(),cap:size>.72,tone:.24+fall()*.62});
      if(size>.65)grid.addCircle(tx,tz,size*.65,'rock',{height:h});
    }
  }
  const stoneMaterial=surfaceMaterial('granite',{color:0x777873,roughness:.95,metalness:.015});
  const capMaterial=new THREE.MeshStandardMaterial({color:0xe7f0f4,roughness:.94});
  capMaterial.onBeforeCompile=shader=>{
    shader.uniforms.snowpack=climateUniforms.snowpack;shader.uniforms.snowline=climateUniforms.snowline;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float snowpack; uniform float snowline; attribute float snowDepth; varying float rockSnowCoverage;')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vec4 rockOrigin=modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0);
        float settled=snowpack*smoothstep(snowline-200.0,snowline+350.0,rockOrigin.y);
        rockSnowCoverage=settled;
        transformed.y-=snowDepth*(1.0-settled);
      `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float rockSnowCoverage;')
      .replace('#include <color_fragment>','#include <color_fragment>\nif(rockSnowCoverage<.08)discard;');
  };
  capMaterial.customProgramCacheKey=()=> 'seasonal-fracture-ledges-v2';
  const replaceRocks = batchFracturedRocks(scene,group,cells,shapes,stoneMaterial,capMaterial,detail);
  let alternate;
  return () => {
    if (detail.budget === initialBudget) {
      replaceRocks(shapes);
    } else {
      alternate ??= makeShapes(detail.budget).map(({ rock, cap }) => { cap.dispose(); return { rock }; });
      replaceRocks(alternate);
    }
  };
}

function indexFracturedRock(positions, normals) {
  const positions32 = Float32Array.from(positions);
  const normals32 = Float32Array.from(normals);
  const positionBits = new Uint32Array(positions32.buffer);
  const normalBits = new Uint32Array(normals32.buffer);
  const vertices = new Map();
  const uniquePositions = [];
  const uniqueNormals = [];
  const indices = [];
  for (let i = 0; i < positions32.length; i += 3) {
    // Share only identical stored vertices. Hard fracture edges retain both normals.
    const key = `${positionBits[i]},${positionBits[i + 1]},${positionBits[i + 2]},${normalBits[i]},${normalBits[i + 1]},${normalBits[i + 2]}`;
    let index = vertices.get(key);
    if (index === undefined) {
      index = vertices.size;
      vertices.set(key, index);
      uniquePositions.push(positions32[i], positions32[i + 1], positions32[i + 2]);
      uniqueNormals.push(normals32[i], normals32[i + 1], normals32[i + 2]);
    }
    indices.push(index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(uniquePositions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(uniqueNormals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function batchFracturedRocks(scene, group, cells, shapes, stoneMaterial, capMaterial, detail) {
  const rockCounts = shapes.map(() => 0);
  const capCounts = shapes.map(() => 0);
  const stoneBox = new THREE.Box3();
  const regions = [];
  for (const stones of cells.values()) {
    const bounds = new THREE.Box3();
    for (const stone of stones) {
      const shape = shapes[stone.kind];
      const rockBounds = shape.rock.boundingSphere.clone();
      rockBounds.radius += .14; // Allow for detailed face relief after a quality change.
      stone.rockBounds = rockBounds.applyMatrix4(stone.matrix);
      bounds.union(stone.rockBounds.getBoundingBox(stoneBox));
      rockCounts[stone.kind]++;
      if (stone.cap) {
        const capBounds = shape.cap.boundingSphere.clone();
        // Include the snow shader's maximum downward movement before scaling.
        capBounds.radius += .06;
        stone.capBounds = capBounds.applyMatrix4(stone.matrix);
        bounds.union(stone.capBounds.getBoundingBox(stoneBox));
        capCounts[stone.kind]++;
      }
      const { tone } = stone;
      stone.color = new THREE.Color().setRGB(.83 + tone * .25, .83 + tone * .23, .80 + tone * .22);
    }
    regions.push({ bounds, stones });
  }

  function makePool(geometry, material, capacity, name, { color = false, shadow = false } = {}) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = !shadow;
    // The regions and individual stones are culled before the instance upload.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (color && capacity) {
      mesh.setColorAt(0, _c);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    // Shadow-only pools stay in the renderer's shadow traversal but never
    // submit their instances to the color pass.
    if (shadow) mesh.onBeforeRender = () => {
      mesh.count = 0;
      mesh.visible = false;
    };
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  }
  const rockPools = shapes.map(({ rock }, kind) => makePool(rock, stoneMaterial, rockCounts[kind], 'fractured granite outcrops', { color: true }));
  const capPools = shapes.map(({ cap }, kind) => makePool(cap, capMaterial, capCounts[kind], 'snow on fracture ledges'));
  const shadowMaterial = new THREE.MeshBasicMaterial();
  const shadowPools = shapes.map(({ rock }, kind) => makePool(rock, shadowMaterial, rockCounts[kind], 'fractured granite shadows', { shadow: true }));
  const colorPools = [...rockPools, ...capPools];
  const sun = scene.getObjectByName('sun');
  const viewProjection = new THREE.Matrix4();
  const lastViewProjection = new THREE.Matrix4();
  const view = new THREE.Frustum();
  const prior = scene.onBeforeRender;
  function publish(pools) {
    for (const mesh of pools) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }
  scene.onBeforeRender = function (renderer, activeScene, camera, target) {
    prior.call(this, renderer, activeScene, camera, target);
    if (!group.visible) return;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const shadowMap = renderer.shadowMap;
    let shadowView;
    if (sun?.castShadow && sun.visible && sun.layers.test(camera.layers) && shadowMap.enabled &&
        (shadowMap.autoUpdate || shadowMap.needsUpdate) && (sun.shadow.autoUpdate || sun.shadow.needsUpdate)) {
      // Include the off-camera stones that can still cast visible shadows.
      sun.shadow.updateMatrices(sun);
      shadowView = sun.shadow.getFrustum();
    }
    const cameraChanged = !viewProjection.equals(lastViewProjection);
    if (!cameraChanged && !shadowView) return;
    if (cameraChanged) {
      lastViewProjection.copy(viewProjection);
      view.setFromProjectionMatrix(viewProjection);
      for (const mesh of colorPools) mesh.count = 0;
    }
    if (shadowView) for (const mesh of shadowPools) mesh.count = 0;
    for (const { bounds, stones } of regions) {
      const cameraRegion = cameraChanged && view.intersectsBox(bounds);
      const shadowRegion = shadowView?.intersectsBox(bounds);
      if (!cameraRegion && !shadowRegion) continue;
      for (const { kind, rockBounds, capBounds, matrix, color } of stones) {
        if (cameraRegion && view.intersectsSphere(rockBounds)) {
          const rock = rockPools[kind];
          rock.setMatrixAt(rock.count, matrix);
          rock.setColorAt(rock.count++, color);
        }
        if (shadowRegion && (!detail.budget || rockBounds.distanceToPoint(camera.position) < 90)
            && shadowView.intersectsSphere(rockBounds)) {
          const shadow = shadowPools[kind];
          shadow.setMatrixAt(shadow.count++, matrix);
        }
        if (capBounds && cameraRegion && view.intersectsSphere(capBounds)) {
          const cap = capPools[kind];
          cap.setMatrixAt(cap.count++, matrix);
        }
      }
    }
    if (cameraChanged) publish(colorPools);
    if (shadowView) publish(shadowPools);
  };
  return nextShapes => nextShapes.forEach(({ rock }, kind) => {
    rockPools[kind].geometry = shadowPools[kind].geometry = rock;
  });
}

/* ═══════════════════════════════════════════════════════════════
   LIFT SYSTEM
   Two gondolas, six chairs, and the 4.4 km Peak 2 Peak.
   ═══════════════════════════════════════════════════════════════ */

function liftSupports(def, lateral, grid) {
  const begin = stationSite(def, 0), finish = stationSite(def, def.points.length - 1);
  const mapped = [[begin.x, begin.z], ...def.points.slice(1, -1), [finish.x, finish.z]];
  const positions = [];
  for (let i = 0; i < mapped.length - 1; i++) {
    const [ax, az] = mapped[i], [bx, bz] = mapped[i + 1];
    positions.push([ax, az]);
    // Some mapped lines have only endpoints. Fill the longest spans with supports.
    const steps = def.type === 'p2p' ? 1 : Math.ceil(Math.hypot(bx - ax, bz - az) / 245);
    for (let j = 1; j < steps; j++) positions.push([lerp(ax, bx, j / steps), lerp(az, bz, j / steps)]);
  }
  positions.push(mapped.at(-1));
  const nodes = positions.map(([x, z], i) => {
    const a = positions[Math.max(0, i - 1)];
    const b = positions[Math.min(positions.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const terminal = i === 0 || i === positions.length - 1;
    const height = terminal ? (def.type === 'p2p' ? (i===0 ? 6.6 : 7.5) : def.type === 'chair' ? 2.85 : 3.65)
      : def.type === 'p2p' ? [0, 35, 65, 39, 35][i] : def.type === 'chair' ? 11.5 : 13.5;
    const ground = i === 0 && def.type === 'p2p' ? heightAt(begin.surveyX, begin.surveyZ) : heightAt(x, z);
    // The upper Excalibur rope crosses above the lower Blackcomb line.
    // Raise the adjacent towers to give the hanging cabins separate levels.
    const crossing = def.id === 'way-29512562' && !terminal
      ? 6 * (1 - smoothstep(25, 113, Math.hypot(x - 1287, z - 190))) : 0;
    return { x, z, y: ground + height + crossing, nx: -(b[1] - a[1]) / len, nz: (b[0] - a[0]) / len, sag: 0, terminal };
  });

  function loadingRun(index, inward, length) {
    const terminal = nodes[index];
    let traveled = 0, a = terminal, b = nodes[index + inward], distance = Math.hypot(a.x - b.x, a.z - b.z);
    while (!b.terminal && traveled + distance <= length + 2) {
      traveled += distance;
      b.y = terminal.y;
      b.virtual = true;
      a = b;
      index += inward;
      b = nodes[index + inward];
      distance = Math.hypot(a.x - b.x, a.z - b.z);
    }
    if (traveled >= length - .1) return;
    const t = Math.min((length - traveled) / distance, .85);
    nodes.splice(index + (inward > 0 ? 1 : 0), 0, {
      x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), y: a.y,
      nx: lerp(a.nx, b.nx, t), nz: lerp(a.nz, b.nz, t), sag: 0, virtual: true,
    });
  }
  // The stationary drive rails stay level through both roofs. Begin the
  // elevation change and cable sag only after the carrier clears the hood.
  const loadingLength = def.type === 'chair' ? ((def.seats || 2) <= 3 ? 5.6 : 11.5) : 14;
  loadingRun(0, 1, def.type === 'p2p' ? 64 : loadingLength);
  loadingRun(nodes.length - 1, -1, def.type === 'p2p' ? 19 : loadingLength);

  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i];
    const planLength = Math.hypot(b.x - a.x, b.z - a.z);
    if (a.terminal || b.terminal || a.virtual && b.virtual) continue;
    if (def.type === 'p2p') {
      b.sag = Math.min(6, planLength * .01);
      if (planLength > 2500) {
        // Fit the middle span to the documented maximum cabin clearance.
        for (let j = 3; j < 97; j++) {
          const t = j / 100;
          const ground = heightAt(lerp(a.x, b.x, t), lerp(a.z, b.z, t));
          const required = (lerp(a.y, b.y, t) - ground - 439) / (4 * t * (1 - t));
          b.sag = Math.max(b.sag, required);
        }
      }
      continue;
    }
    b.sag = Math.min(4.5, planLength * .018);
    const steps = Math.max(2, Math.ceil(planLength / 2.5));
    const chair = def.type === 'chair', cabinHalf = chair ? ((def.seats || 4) * .51 + .26) / 2 : 1.04;
    const terminalHeight = chair ? 2.85 : 3.65;
    let raiseA = 0, raiseB = 0;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
      const nx = lerp(a.nx, b.nx, t), nz = lerp(a.nz, b.nz, t);
      const distanceFromTerminal = Math.min(a.virtual ? t * planLength : Infinity, b.virtual ? (1-t) * planLength : Infinity);
      const clearance = lerp(terminalHeight, chair ? 3.8 : 4.65, smoothstep(0, 26, distanceFromTerminal));
      let floor = -Infinity;
      for (const side of [-1, 1]) {
        const px = x + side * nx * lateral, pz = z + side * nz * lateral;
        floor = Math.max(floor, heightAt(px, pz));
        for (const edge of [-cabinHalf, 0, cabinHalf]) {
          const bx = px + nx * edge, bz = pz + nz * edge;
          floor = Math.max(floor, heightAt(bx, bz));
          for (const building of grid.buildingsAt(bx, bz)) floor = Math.max(floor, building.roofAt(bx, bz) + .45);
        }
      }
      const line = lerp(a.y, b.y, t) - 4 * t * (1 - t) * b.sag;
      const deficit = Math.max(0, floor + clearance - line);
      if (a.virtual && !b.virtual && t > .001) raiseB = Math.max(raiseB, deficit/t);
      else if (b.virtual && !a.virtual && t < .999) raiseA = Math.max(raiseA, deficit/(1-t));
      else if (!a.virtual && !b.virtual) { raiseA = Math.max(raiseA,deficit); raiseB = Math.max(raiseB,deficit); }
    }
    a.y += raiseA;
    b.y += raiseB;
  }
  return nodes;
}

function buildCablePath(nodes, lateral) {
  const points = [];
  const at = (a) => new THREE.Vector3(a.x + a.nx * lateral, a.y, a.z + a.nz * lateral);
  for (let i = 1; i < nodes.length; i++) {
    const a = at(nodes[i - 1]), b = at(nodes[i]);
    const distance = a.distanceTo(b);
    const steps = Math.max(2, Math.ceil(distance / 4));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const point = new THREE.Vector3().lerpVectors(a, b, t);
      point.y -= 4 * t * (1 - t) * nodes[i].sag;
      points.push(point);
    }
  }
  points.push(at(nodes.at(-1)));
  return makeSampler(points);
}

function makeSampler(points) {
  const distances = new Float64Array(points.length);
  const directions = new Float64Array(points.length * 3);
  const delta = new THREE.Vector3();
  // An entire span shares the same tangent. Calculate it once for the
  // riders, animated fleet, and lift queue instead of normalizing per sample.
  for (let i = 1; i < points.length; i++) {
    delta.subVectors(points[i], points[i - 1]);
    const length = delta.length();
    distances[i] = distances[i - 1] + length;
    delta.divideScalar(length || 1).toArray(directions, (i - 1) * 3);
  }
  const total = distances.at(-1);
  return {
    points, total,
    at(t, position, tangent) {
      const distance = clamp(t, 0, 1) * total;
      let lo = 0, hi = points.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (distances[mid] <= distance) lo = mid;
        else hi = mid;
      }
      const a = points[lo], b = points[hi];
      const fraction = (distance - distances[lo]) / (distances[hi] - distances[lo] || 1);
      position.lerpVectors(a, b, fraction);
      tangent.fromArray(directions, lo * 3);
    },
  };
}

function liftTube(points, radius, color, segments) {
  const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  return part(new THREE.TubeGeometry(path, segments, radius, 6), color);
}

function chairCushion(profile) {
  const shape = new THREE.Shape();
  shape.moveTo(-profile[0][1], profile[0][0]);
  for (const [y, z] of profile.slice(1)) shape.lineTo(-z, y);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {depth: 1, bevelEnabled: false})
    .translate(0, 0, -.5).rotateY(Math.PI / 2);
}

function makeChairGeometry(seatCount, modern = false) {
  // The wider carrier uses the documented 520 mm DCD seat width as its spacing.
  const pitch = modern ? .52 : .51, half = (seatCount * pitch + .18) / 2;
  const fixed = seatCount <= 3;
  const steel = modern ? '#9da8aa' : '#737f85', bright = '#b6c0bf', dark = '#3e4a51';
  const pad = modern ? '#9b2634' : '#34434a';
  const back = modern ? '#932431' : '#303d44';
  const sleeve = new THREE.CylinderGeometry(.064, .064, 1, 8);
  const parts = [
    // The jaw stays at the rope origin. The body and hanger run outboard,
    // clear of the wheel flanges on the support side of the rope.
    box(.15, .105, fixed ? .39 : .54, steel, [-.018, -.016, 0]),
    box(.15, .115, fixed ? .26 : .43, dark, [-.14, -.046, .006]),
    part(sleeve, bright, [-.167, -.13, .009], [0, 0, Math.PI / 2], [.84, .17, .84]),
    liftTube([[-.171,-.15,.01],[-.17,-.31,.04],[-.11,-.56,.11],[-.06,-1.27,-.02],[0,-1.73,-.26]], .055, steel, 7),
    box(.27, .12, .19, bright, [0, -1.71, -.25]),
    box(half * 1.98, .095, .115, steel, [0, -1.755, -.28]),
    box(half * 1.96, .105, .48, dark, [0, -2.236, -.015]),
    // The padded crossbar and both hinge arms are one bent tube.
    liftTube([[-half,-1.84,-.19],[-half,-1.80,.32],[-half+.08,-1.79,.46],
      [half-.08,-1.79,.46],[half,-1.80,.32],[half,-1.84,-.19]], .034, steel, 13),
    part(sleeve, dark, [0, -1.79, .46], [0, 0, Math.PI / 2], [.6, half * 1.66, .6]),
  ];

  if (!fixed) {
    const driveWheel = new THREE.CylinderGeometry(.078, .078, .047, 10);
    parts.push(part(driveWheel, '#3c484b', [-.249, .055, .12], [0, 0, Math.PI / 2]));
    parts.push(part(sleeve, modern ? '#b1313b' : dark, [-.14, .048, -.08], [Math.PI / 2, 0, 0], [.72, .29, .72]));
    parts.push(box(.11, .065, .19, bright, [-.247, -.026, -.19]));
  }
  for (const side of [-1, 1]) {
    const x = side * half;
    parts.push(liftTube([[x-.12*side,-1.76,-.28],[x,-1.82,-.27],[x,-2.15,-.24],
      [x,-2.26,-.11],[x,-2.25,.22],[x-.10*side,-2.25,.24]], .034, steel, 7));
    parts.push(part(sleeve, dark, [x, -1.85, -.22], [0, 0, Math.PI / 2], [1, .095, 1]));
  }

  const pads = fixed ? 1 : seatCount;
  const padWidth = fixed ? half * 1.82 : pitch - .057;
  const seatPad = chairCushion([[-.036,-.23],[-.036,.196],[-.018,.238],[.016,.240],[.041,.192],[.035,-.23]]);
  const backPad = chairCushion([[-.182,-.009],[-.166,.041],[.151,.005],[.190,-.029],[.175,-.069],[-.144,-.069]]);
  for (let i = 0; i < pads; i++) {
    const x = (i - (pads - 1) / 2) * pitch;
    parts.push(
      part(seatPad, pad, [x, -2.163, .008], [0, 0, 0], [padWidth, 1, 1]),
      part(backPad, back, [x, -1.99, -.216], [0, 0, 0], [padWidth, 1, 1]),
    );
  }
  // The crossbar can be identified from both sides. Its footrests are spaced
  // apart so the lower silhouette reads as a chair rather than a solid slab.
  const rests = fixed ? 1 : Math.ceil(seatCount / 2);
  for (let i = 0; i < rests; i++) {
    const x = (i - (rests - 1) / 2) * (half * 2 / rests);
    const width = half * (.90 / rests) * 2;
    parts.push(box(.048, .86, .046, steel, [x, -2.22, .447], [-.055, 0, 0]));
    parts.push(box(width, .054, .124, dark, [x, -2.68, .425]));
    parts.push(box(width * .82, .022, .094, '#667478', [x, -2.644, .425]));
  }
  const geometry = mergeParts(parts, true);
  geometry.userData.seatPitch = pitch;
  geometry.userData.seats = seatCount;
  return geometry;
}

function makeCabinGeometry(color = '#1d2529', accent = '#e7e1d3', big = false, creekside = false) {
  const shell = makeGondolaShell(color, accent, big, creekside);
  shell.hull.userData.carrierShell = shell;
  return shell.hull;
}

function distantChairGeometry(seats, modern) {
  const width = seats * (modern ? .52 : .51) + .18;
  const cushion = modern ? '#932431' : '#303d44';
  return mergeParts([
    box(.11, 1.75, .12, '#737f85', [-.1, -.88, -.09], [.13, 0, -.06]),
    box(width, .10, .49, cushion, [0, -2.21, 0]),
    box(width, .42, .08, cushion, [0, -1.95, -.20]),
    box(width, .065, .08, '#737f85', [0, -1.80, .38]),
    box(width * .72, .06, .10, '#3e4a51', [0, -2.66, .42]),
  ], true);
}

function distantCabinGeometry(color, big) {
  const section = new THREE.CylinderGeometry(.54, .54, 1, 8, 1, false, Math.PI / 8);
  const width = big ? 3.10 : 1.92, depth = big ? 3.88 : 2.02;
  return mergeParts([
    part(section, color, [0, big ? -3.04 : -2.89, 0], [0, 0, 0], [width, .70, depth]),
    part(section, '#3a5362', [0, -2.10, 0], [0, 0, 0], [width, big ? 1.23 : 1.0, depth]),
    part(section, '#ddd9cf', [0, -1.38, 0], [0, 0, 0], [width * .87, .37, depth * .87]),
    box(big ? .65 : .15, 1.2, .14, '#879398', [0, -.64, 0]),
  ], true);
}

function towerShaftGeometry() {
  return mergeParts([
    part(new THREE.CylinderGeometry(.29, .49, 1, 10), '#74828b', [0, .5, 0]),
    part(new THREE.CylinderGeometry(.52, .61, .024, 10), '#565d5f', [0, .04, 0]),
    part(new THREE.CylinderGeometry(.51, .64, .038, 10), '#9ca6a6', [0, .016, 0]),
  ], true);
}

function towerHeadGeometry(distant = false) {
  const parts = [
    box(4.2, .16, .28, '#65737a', [0, -.14, 0]),
    box(4.16, .345, .16, '#88949a', [0, -.36, 0]),
    box(4.2, .132, .3, '#66747c', [0, -.58, 0]),
  ];
  for (const x of [-1.65, 1.65]) {
    parts.push(box(.17, .24, 1.8, '#9da8ad', [x, -.32, 0]));
    parts.push(box(.55, .045, .94, '#909da1', [x, -.83, 0]));
    if (distant) {
      parts.push(box(.19, .21, 1.60, '#293137', [x, -.13, 0]));
      continue;
    }
    for (let i = -3; i <= 3; i++) {
      parts.push(part(new THREE.CylinderGeometry(.125, .125, .08, 12), '#293137',
        [x, -.12, i * .24], [0, 0, Math.PI / 2]));
      parts.push(part(new THREE.CylinderGeometry(.060,.060,.095,10),'#aab9bb',
        [x,-.12,i*.24],[0,0,Math.PI/2]));
      for(const side of [-1,1]){
        const tyre=new THREE.TorusGeometry(.109,.018,4,12);tyre.rotateY(Math.PI/2);
        parts.push(part(tyre,'#1d2c33',[x+side*.044,-.12,i*.24]));
      }
      if(i%2===0&&i<3){
        parts.push(box(.092,.083,.40,'#b3bec0',[x,-.32,i*.24+.12]));
        parts.push(box(.078,.22,.065,'#71868f',[x,-.25,i*.24]));
      }
    }
  }
  // Central access catwalk and railings remain between the two rope banks.
  parts.push(box(1.64,.055,1.34,'#82959c',[0,-.59,0]));
  for(const z of [-.64,.64]){
    parts.push(box(1.72,.042,.042,'#b4c1c1',[0,.30,z]));
    for(const x of [-.78,0,.78])parts.push(box(.035,.88,.035,'#aab7b9',[x,-.13,z]));
  }
  if (distant) return mergeParts(parts, true);
  for(let i=0;i<7;i++)parts.push(box(.43,.025,.027,'#c0c7c4',[0,-.62+i*.145,-.73]));
  for(const x of [-.24,.24])parts.push(box(.026,1.18,.028,'#80969e',[x,-.11,-.73]));
  return mergeParts(parts, true);
}

function chairTowerHeadGeometry() {
  const steel = '#829196', flange = '#a4b1b3', dark = '#596a72';
  const parts = [
    box(4.03, .14, .25, flange, [0, -.35, 0]),
    box(3.98, .29, .13, steel, [0, -.52, 0]),
    box(4.03, .105, .24, dark, [0, -.67, 0]),
    box(.66, .205, .49, steel, [0, -.62, 0]),
    box(.48, .53, .41, dark, [0, -.87, 0]),
    box(1.80, .062, 1.28, steel, [0, -.58, 0]),
  ];
  for (const side of [-1, 1]) {
    const x = side * 1.56;
    parts.push(box(.31, .34, .33, dark, [x, -.39, 0]));
    parts.push(box(.19, .16, 1.4, steel, [x, -.48, 0]));
    parts.push(beam([side*.24,-1.06,0],[side*1.55,-.67,0],.11,.14,flange));
    for (const z of [-.31, .31]) parts.push(beam([side*.31,-1.02,0],[side*1.45,-.42,z],.06,.075,dark));
  }
  for (const z of [-.59, .59]) {
    parts.push(box(1.75, .045, .045, flange, [0, .275, z]));
    parts.push(box(1.75, .035, .035, dark, [0, -.13, z]));
    for (const x of [-.86,0,.86]) parts.push(box(.035, .85, .035, steel, [x, -.15, z]));
  }
  for (const x of [-.22, .22]) parts.push(box(.041,1.18,.041,dark,[x,-.55,-.69]));
  for (let i = 0; i < 6; i++) parts.push(box(.42,.027,.034,flange,[0,-1.05+i*.18,-.69]));
  return mergeParts(parts, true);
}

function chairSheaveGeometry(distant = false) {
  const parts = [
    box(.29,.18,.30,'#66777d',[0,-.37,0]),
    box(.27,.12,.76,'#778b92',[0,-.26,0]),
  ];
  if (distant) {
    for (const z of [-.28, 0, .28]) parts.push(box(.17,.25,.25,'#283238',[0,-.142,z]));
    return mergeParts(parts, true);
  }
  // The rope sits in the groove, with steel flanges outside the rope width.
  const wheel = new THREE.LatheGeometry([
    [0,-.085], [.122,-.085], [.147,-.064], [.147,-.046], [.105,0],
    [.147,.046], [.147,.064], [.122,.085], [0,.085],
  ].map(([r, x]) => new THREE.Vector2(r, x)), 10).rotateZ(Math.PI / 2);
  const axle = new THREE.CylinderGeometry(.044, .044, .234, 8).rotateZ(Math.PI / 2);
  for (const z of [-.28, 0, .28]) {
    parts.push(part(wheel, '#283238', [0, -.142, z]));
    parts.push(part(axle, '#a4b0b2', [0, -.142, z]));
    for (const x of [-.107,.107]) parts.push(box(.038,.13,.11,'#8b9b9f',[x,-.205,z]));
  }
  return mergeParts(parts, true);
}

function latticeGeometry() {
  const pieces = [];
  const beam = (a, b, size) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const direction = B.clone().sub(A);
    const rot = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
    );
    pieces.push(box(size, direction.length(), size, '#737d83', A.lerp(B, .5).toArray(), [rot.x, rot.y, rot.z]));
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      beam([sx * 3.1, 0, sz * 2.7], [sx * .9, 45, sz * .8], .32);
      for (let i = 0; i < 8; i++) {
        const f0 = i / 8, f1 = (i + 1) / 8;
        const w0 = lerp(3.1, .9, f0), w1 = lerp(3.1, .9, f1);
        const d0 = lerp(2.7, .8, f0), d1 = lerp(2.7, .8, f1);
        beam([sx*w0, 45*f0, sz*d0], [-sx*w1, 45*f1, sz*d1], .135);
        beam([sx*w0, 45*f0, sz*d0], [sx*w1, 45*f1, -sz*d1], .135);
      }
    }
  }
  return mergeParts(pieces, true);
}

function surfaceLift(def, group, grid, material) {
  const points = [];
  const carpet = def.surfaceType === 'magic_carpet';
  const offset = carpet ? .13 : .095;
  for (let i = 1; i < def.points.length; i++) {
    const [ax, az] = def.points[i - 1], [bx, bz] = def.points[i];
    const count = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.2));
    for (let j = 0; j <= count; j++) {
      if (i > 1 && j === 0) continue;
      const x = lerp(ax, bx, j / count), z = lerp(az, bz, j / count);
      points.push(new THREE.Vector3(x, heightAt(x, z) + offset, z));
    }
  }
  const sampler = makeSampler(points);
  if (carpet) return { def, samplers: [sampler] };
  const tow = new THREE.Group();
  tow.name = def.name + ' · surface tow';
  group.add(tow);
  const bars = [], supports = [], p = new THREE.Vector3(), t = new THREE.Vector3();
  const height = 2.95, casing = '#7e9298';
  for (const side of [-1, 1]) {
    const cable = points.map((point, i) => {
      const back = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
      const axis = next.clone().sub(back).setY(0).normalize();
      return new THREE.Vector3(point.x - axis.z * side * 1.1, point.y + height, point.z + axis.x * side * 1.1);
    });
    tow.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cable), cable.length, .029, 5), material));
  }
  const spanCount = Math.ceil(sampler.total / 43);
  for (let i = 0; i <= spanCount; i++) {
    sampler.at(i / spanCount, p, t);
    const yaw = Math.atan2(t.x, t.z), y = p.y + height;
    supports.push(box(.31, height + .2, .29, casing, [p.x, p.y + height / 2 - .1, p.z], [0, yaw, 0]));
    supports.push(box(2.52, .13, .18, casing, [p.x, y - .10, p.z], [0, yaw, 0]));
    grid.addCircle(p.x, p.z, .26, 'station', { liftId: def.id, maxY: y });
    if (i === 0 || i === spanCount) {
      const wheel = new THREE.TorusGeometry(1.10, .095, 8, 40);
      wheel.rotateX(Math.PI / 2);
      supports.push(part(wheel, '#637b83', [p.x, y, p.z]));
      const sign = makeSign(def.name.toUpperCase(), i ? 'RELEASE BAR' : 'TAKE THE BAR', '#f5d18c', 2.5);
      const sx = p.x + Math.cos(yaw) * 2.9, sz = p.z - Math.sin(yaw) * 2.9;
      const sy = heightAt(sx, sz);
      supports.push(box(.075, 1.85, .077, casing, [sx, sy + .87, sz], [0, yaw, 0]));
      sign.position.set(sx, sy + 1.76, sz);
      sign.rotation.y = yaw + Math.PI;
      tow.add(sign);
    }
  }
  tow.add(mergedMesh(supports, { roughness: .63, metalness: .21 }));
  bars.push(box(.07, 1.99, .07, '#3d4f55', [0, -1.0, 0]), box(.94, .10, .12, '#8d5133', [0, -2.02, 0]));
  const carriers = new THREE.InstancedMesh(mergeParts(bars),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .66 }), Math.ceil(sampler.total / 27) * 2);
  carriers.name = def.name + ' · tow hangers';
  carriers.boundingSphere = new THREE.Box3().setFromPoints(points).getBoundingSphere(new THREE.Sphere());
  carriers.boundingSphere.radius += 5;
  tow.add(carriers);
  const dummy = new THREE.Object3D();
  return { def, samplers: [sampler], surfaceUpdate(clock, eye) {
    carriers.visible = !eye || carriers.boundingSphere.distanceToPoint(eye) < 380;
    if (!carriers.visible) return;
    for (let i = 0; i < carriers.count; i++) {
      const side = i % 2 ? -1 : 1, progress = (Math.floor(i / 2) / (carriers.count / 2) + clock * def.speed / sampler.total) % 1;
      sampler.at(side > 0 ? progress : 1 - progress, p, t);
      const yaw = Math.atan2(t.x, t.z);
      dummy.position.set(p.x - Math.cos(yaw) * side * 1.1, p.y + height, p.z + Math.sin(yaw) * side * 1.1);
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      carriers.setMatrixAt(i, dummy.matrix);
    }
    carriers.instanceMatrix.needsUpdate = true;
  } };
}

function terminalTurnEndpoints(samplers, upper) {
  const start = new THREE.Vector3(), end = new THREE.Vector3();
  const inward = new THREE.Vector3(), outward = new THREE.Vector3();
  if (upper) {
    samplers[0].at(1, start, inward);
    samplers[1].at(1, end, outward);
    outward.negate();
  } else {
    samplers[1].at(0, start, inward);
    inward.negate();
    samplers[0].at(0, end, outward);
  }
  inward.setY(0).normalize();
  outward.setY(0).normalize();
  const across = end.clone().sub(start).normalize();
  const axis = inward.clone().sub(outward).normalize();
  axis.addScaledVector(across, -axis.dot(across)).normalize();
  return { start, end, inward, outward, axis, across, radius: start.distanceTo(end) / 2 };
}

function terminalTurnPath({ start, end, inward, outward, axis, across, radius }, depth) {
  // Match the two exact sampler endpoints and tangents. The rounded end stays
  // level at the drive elevation while the grip moves between the haul lanes.
  const a = start.clone().addScaledVector(axis, depth), b = end.clone().addScaledVector(axis, depth);
  const center = a.clone().lerp(b, .5), nose = center.clone().addScaledVector(axis, radius);
  const handle = .5522847498 * radius, lead = depth / 3;
  const curve = new THREE.CurvePath();
  curve.add(new THREE.CubicBezierCurve3(start, start.clone().addScaledVector(inward, lead),
    a.clone().addScaledVector(axis, -lead), a));
  curve.add(new THREE.CubicBezierCurve3(a, a.clone().addScaledVector(axis, handle),
    nose.clone().addScaledVector(across, -handle), nose));
  curve.add(new THREE.CubicBezierCurve3(nose, nose.clone().addScaledVector(across, handle),
    b.clone().addScaledVector(axis, handle), b));
  curve.add(new THREE.CubicBezierCurve3(b, b.clone().addScaledVector(axis, -lead),
    end.clone().addScaledVector(outward, -lead), end));
  return { curve, center };
}

function buildLifts(scene, grid, detail) {
  const group = new THREE.Group();
  group.name = 'Lift network';
  scene.add(group);
  const staticNetwork = new THREE.Group();
  group.add(staticNetwork);

  const towers = [];
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x424e53, roughness: 0.48, metalness: 0.42 });
  const carrierMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.2 });
  const chairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .54, metalness: .18 });
  const chairGeometries = new Map();
  const distantGeometries = new Map();
  const lifts = [];
  const position = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const view = new THREE.Frustum(), projection = new THREE.Matrix4();
  const carrierBounds = new THREE.Sphere(position);
  const towerBatches = [];
  let occupied = null;

  function liftCircuit(samplers, speed, { slowSpeed, turnDepth, approach, cabin }) {
    const sections = [], joins = [], turns = [];
    let duration = 0;
    const append = (section) => {
      section.start = duration; duration += section.duration;
      sections.push(section); joins.push(duration);
    };
    const timedHaul = (sampler, direction) => {
      const length = sampler.total, zone = Math.min(approach, length * .08);
      let duration = length / speed;
      let distanceFractionAt = seconds => clamp(seconds / duration, 0, 1);
      if (slowSpeed < speed) {
        const steps = Math.max(64, Math.ceil(length / .5));
        const times = new Float64Array(steps + 1);
        const velocity = d => lerp(slowSpeed, speed, smoothstep(0, zone, Math.min(d, length - d)));
        const stride = length / steps;
        for (let i = 1; i <= steps; i++) {
          times[i] = times[i - 1] + stride * .5 * (1 / velocity((i - 1) * stride) + 1 / velocity(i * stride));
        }
        duration = times[steps];
        distanceFractionAt = seconds => {
          let lo = 0, hi = steps;
          while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (times[mid] <= seconds) lo = mid;
            else hi = mid;
          }
          const fraction = (seconds - times[lo]) / (times[hi] - times[lo] || 1);
          return (lo + clamp(fraction, 0, 1)) / steps;
        };
      }
      return { kind:'haul', direction, duration, length, zone,
        distanceFractionAt,
        at(seconds, position, tangent, state) {
          const along=distanceFractionAt(seconds);
          const t=direction?1-along:along;
          sampler.at(t,position,tangent);if(direction)tangent.negate();
          if (state) {
            state.direction = direction; state.t = t; state.kind = 'haul';
            if (cabin) state.doorOpening = gondolaDoorsAtDistance(Math.min(along, 1 - along) * length);
          }
        },
      };
    };
    const turn = (upper) => {
      const endpoints = terminalTurnEndpoints(samplers, upper);
      const turnPath = terminalTurnPath(endpoints, turnDepth);
      const { curve } = turnPath;
      const length = curve.getLength();
      const duration = length / slowSpeed;
      turns.push(curve);
      return {kind:'turn',upper,curve,length,duration,endpoints, center: turnPath.center,
        at(seconds,position,tangent,state){
          const t = clamp(seconds / duration, 0, 1);
          curve.getPoint(t, position);
          curve.getTangent(t, tangent);
          if (state) {
            state.direction = null; state.t = upper ? 1 : 0; state.kind = 'turn';
            if (cabin) state.doorOpening = 1;
          }
        },
      };
    };
    append(timedHaul(samplers[0],0));append(turn(true));
    append(timedHaul(samplers[1],1));append(turn(false));
    return {duration,sections,joins,turns,slowSpeed,
      at(seconds,position,tangent,state) {
        const phase=((seconds%duration)+duration)%duration;
        const section=sections.find(s=>phase<s.start+s.duration)||sections.at(-1);
        section.at(phase-section.start,position,tangent,state);return state;
      },
    };
  }

  for (const def of LIFTS) {
    if (!def.aerial) {
      if (def.type === 'surface') lifts.push(surfaceLift(def, group, grid, cableMat));
      continue;
    }
    const isP2P = def.type === 'p2p';
    const chair = def.type === 'chair';
    const lateral = ropeOffset(def);
    const supports = liftSupports(def, lateral, grid);
    const samplers = [buildCablePath(supports, lateral), buildCablePath(supports, -lateral)];
    const cablePaths = isP2P
      ? samplers.flatMap((sampler, i) => {
        const offset=(i===0?lateral:-lateral);
        return [sampler,buildCablePath(supports,offset-.5),buildCablePath(supports,offset+.5)];
      })
      : samplers;
    const ropes = cablePaths.map(sampler => {
      const curve = new THREE.CatmullRomCurve3(sampler.points);
      const steps = Math.ceil(sampler.total / (isP2P ? 9 : 6));
      const radius = isP2P ? 0.052 : 0.037;
      const build = reduced => new THREE.TubeGeometry(curve, reduced ? Math.ceil(steps / 2) : steps, radius, reduced ? 3 : 5, false);
      const rope = { full: null, reduced: null };
      const key = detail.budget ? 'reduced' : 'full';
      rope[key] = build(detail.budget);
      const cable = new THREE.Mesh(rope[key], cableMat);
      staticNetwork.add(cable);
      return { cable, rope, build };
    });

    for (let i = 1; i < supports.length - 1; i++) {
      const support = supports[i];
      const { x, z, y, nx, nz } = support;
      if (support.virtual) continue;
      const angle = Math.atan2(nz, -nx);
      const foot = isP2P ? 3.6 : .69;
      const base = Math.min(...[-foot, 0, foot].flatMap(dx => [-foot, 0, foot].map(dz => heightAt(x + dx, z + dz)))) - .24;
      towers.push({ x, z, y, base, angle, lateral, isP2P, chair, support,
        previous: supports[i - 1], next: supports[i + 1] });
      grid.addCircle(x, z, isP2P ? 3.6 : 1.15, 'lift-tower', { liftId: def.id, maxY: y + .4 });
    }

    const modernChair=/Fitzsimmons|Jersey Cream/.test(def.name),chairKey=def.seats+'|'+modernChair;
    if (chair && !chairGeometries.has(chairKey)) {
      chairGeometries.set(chairKey, makeChairGeometry(def.seats || 4,modernChair));
    }
    const cabinColor = isP2P ? '#b81630' : /Excalibur/.test(def.name) ? '#e2e5de' : '#273840';
    const geometry = chair ? chairGeometries.get(chairKey)
      : makeCabinGeometry(cabinColor, '#ddd9cf', isP2P, def.name==='Creekside Gondola');
    const perSide = Math.max(3, Math.ceil(samplers[0].total / (isP2P ? 300 : chair ? 49 : 94)));
    const fixedChair = chair && ((def.seats || 2) <= 3 || def.name === 'Showcase Quad');
    const circulation = liftCircuit(samplers, def.speed, {
      slowSpeed: chair ? (fixedChair ? def.speed : 1.1) : isP2P ? .76 : .65,
      turnDepth: fixedChair ? 1.9 : chair ? 4.45 : isP2P ? 6 : 7,
      approach: chair ? 18 : 24,
      cabin: !chair,
    });
    const terminals = [];
    for (const section of [circulation.sections[1], circulation.sections[3]]) {
      const start = group.children.length;
      let wheel;
      if (chair) {
        const ropeWrap = fixedChair ? section : terminalTurnPath(section.endpoints, .84);
        const rope = new THREE.Mesh(new THREE.TubeGeometry(ropeWrap.curve, 64, .044, 8), cableMat);
        rope.name = def.name + ' · bullwheel rope wrap'; group.add(rope);
        wheel = buildChairTurnaround(group, def, section, ropeWrap.center, fixedChair);
      } else {
        const rail = new THREE.Mesh(new THREE.TubeGeometry(section.curve, 48, .085, 6, false), cableMat);
        rail.name = def.name + ' · station turnaround drive rail'; group.add(rail);
      }
      terminals.push({ position: section.endpoints.start, objects: group.children.slice(start), wheel });
    }
    const shell=geometry.userData.carrierShell;
    const doorOpen=shell?new THREE.InstancedBufferAttribute(new Float32Array(perSide*2),1).setUsage(THREE.DynamicDrawUsage):null;
    const hull=shell?gondolaFleetGeometry(shell,'hull',doorOpen):geometry;
    const material = shell ? shell.materials.hull : chairMat;
    const carriers = new THREE.InstancedMesh(hull, material, perSide * 2);
    carriers.name = def.name;
    carriers.boundingSphere = new THREE.Box3()
      .setFromPoints(samplers.flatMap((sampler) => sampler.points))
      .getBoundingSphere(new THREE.Sphere());
    carriers.boundingSphere.radius += 14;
    group.add(carriers);
    const layers = [];
    if(shell) {
      carriers.userData.gondolaCarrier=true;
      // Every display layer shares the hull matrices and reads the same
      // per-carrier door fraction. Seals and glass follow the metal leaves.
      for(const key of ['glass','frost','logo','snow']) {
        const layer=new THREE.InstancedMesh(gondolaFleetGeometry(shell,key,doorOpen),shell.materials[key],0);
        layer.name=def.name+' · '+key;layer.instanceMatrix=carriers.instanceMatrix;layer.userData.gondolaCarrier=true;
        layer.count = carriers.count;
        if(key==='glass'&&def.name==='Creekside Gondola'){
          const origin=new THREE.Vector3();samplers[0].at(.04,origin,new THREE.Vector3());origin.y-=1.8;
          attachCreeksideReflection(layer,scene,origin);
        }
        layer.boundingSphere=carriers.boundingSphere;layer.renderOrder=key==='glass'?2:key==='frost'?3:1;
        layers.push(layer);
        group.add(layer);
      }
    }

    const distantKey = chair ? chairKey : cabinColor;
    if (!distantGeometries.has(distantKey)) {
      distantGeometries.set(distantKey, chair ? distantChairGeometry(def.seats || 4, modernChair)
        : distantCabinGeometry(cabinColor, isP2P));
    }
    const distantCarriers = new THREE.InstancedMesh(distantGeometries.get(distantKey), carrierMat, perSide * 2);
    distantCarriers.name = def.name + ' · distant carriers';
    distantCarriers.userData.gondolaCarrier = !!shell;
    distantCarriers.boundingSphere = carriers.boundingSphere;
    distantCarriers.count = 0;
    distantCarriers.visible = false;
    group.add(distantCarriers);

    const passenger=shell?new THREE.Group():new THREE.Mesh(geometry,material);
    const setPassengerDoors=shell?addGondolaShell(passenger,shell):null;
    passenger.userData.gondolaCarrier=!!shell;
    passenger.visible = false;
    passenger.castShadow = true;
    group.add(passenger);
    // Bound each full-detail carrier around its rope attachment. Include the
    // shader's plug-and-slide motion so open doors stay inside the envelope.
    let fleetRadius = 0;
    for (const mesh of [carriers, ...layers]) {
      const shape = mesh.geometry;
      if (!shape.boundingSphere) shape.computeBoundingSphere();
      const { center, radius } = shape.boundingSphere;
      const motion = shape.getAttribute('doorMotion');
      let travel = 0;
      if (motion) for (let i = 0; i < motion.count; i++) {
        travel = Math.max(travel, Math.hypot(motion.getX(i), motion.getY(i)));
      }
      fleetRadius = Math.max(fleetRadius, center.length() + radius + travel);
    }
    lifts.push({ def, samplers, supports, perSide, carriers, layers, distantCarriers, fleetRadius,
      passenger, circulation, terminals, doorOpen, setPassengerDoors,
      setRopeQuality(reduced) {
        const key = reduced ? 'reduced' : 'full';
        for (const { cable, rope, build } of ropes) cable.geometry = rope[key] ??= build(reduced);
      },
    });
  }

  const regular = towers.filter((t) => !t.isP2P);
  const valley = towers.filter((t) => t.isP2P);
  const chairs = towers.filter(t => t.chair);
  const gondolas = towers.filter(t => !t.chair);
  const setTower = (mesh, t, i, y, sx, sy) => {
    dummy.position.set(t.x, y, t.z);
    dummy.rotation.set(0, t.angle, 0);
    dummy.scale.set(sx, sy, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };

  function addTowerBatches(geometry, material, family, name, fill, stride = 1, distantGeometry) {
    // Split off-screen sections without turning each support into its own draw.
    const patchSize = distantGeometry ? 480 : 1000;
    const batches = new Map();
    for (const tower of family) {
      const key = `${Math.floor(tower.x / patchSize)},${Math.floor(tower.z / patchSize)}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(tower);
    }
    for (const towers of batches.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, towers.length * stride);
      mesh.name = name;
      mesh.castShadow = true;
      towers.forEach((tower, i) => fill(mesh, tower, i * stride));
      mesh.computeBoundingSphere();
      staticNetwork.add(mesh);
      let distant;
      if (distantGeometry) {
        distant = new THREE.InstancedMesh(distantGeometry, material, 0);
        distant.count = mesh.count;
        distant.instanceMatrix = mesh.instanceMatrix;
        distant.boundingSphere = mesh.boundingSphere;
        distant.name = name + ' · distant';
        distant.visible = false;
        staticNetwork.add(distant);
      }
      towerBatches.push({ mesh, distant });
    }
  }

  addTowerBatches(towerShaftGeometry(), carrierMat, regular, 'Lift tower shafts',
    (mesh, t, i) => setTower(mesh, t, i, t.base, 1, t.y - t.base));
  addTowerBatches(latticeGeometry(), carrierMat, valley, 'PEAK 2 PEAK lattice towers',
    (mesh, t, i) => setTower(mesh, t, i, t.base, 1, (t.y - t.base) / 45));
  const placeTowerHead = (mesh, tower, index) => setTower(mesh, tower, index, tower.y, tower.lateral / 1.65, 1);
  addTowerBatches(towerHeadGeometry(), carrierMat, gondolas, 'Gondola tower heads', placeTowerHead, 1, towerHeadGeometry(true));
  addTowerBatches(chairTowerHeadGeometry(), chairMat, chairs, 'Chairlift tower crossarms', placeTowerHead);
  const bankAxis = new THREE.Vector3(), bankUp = new THREE.Vector3(), bankBasis = new THREE.Matrix4();
  addTowerBatches(chairSheaveGeometry(), chairMat, chairs, 'Chairlift sheave groups', (mesh, tower, bankIndex) => {
    const { support, previous, next, lateral } = tower;
    for (const side of [-lateral, lateral]) {
      const origin = new THREE.Vector3(support.x + support.nx*side, support.y, support.z + support.nz*side);
      for (const half of [-1, 1]) {
        const node = half < 0 ? previous : next;
        // Pitch each bogie to the exact first sampled rope interval on its side
        // of the support. The line itself and the carrier path stay fixed.
        const adjacent = new THREE.Vector3(node.x + node.nx*side, node.y, node.z + node.nz*side);
        const fraction = 1 / Math.max(2, Math.ceil(adjacent.distanceTo(origin) / 4));
        adjacent.lerp(origin, 1-fraction);
        adjacent.y -= 4 * fraction * (1-fraction) * (half < 0 ? support.sag : next.sag);
        tangent.subVectors(adjacent, origin).normalize().multiplyScalar(half);
        bankAxis.set(tangent.z, 0, -tangent.x).normalize();
        bankUp.crossVectors(tangent, bankAxis);
        dummy.position.copy(origin).addScaledVector(tangent, half*.45);
        dummy.quaternion.setFromRotationMatrix(bankBasis.makeBasis(bankAxis, bankUp, tangent));
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(bankIndex++, dummy.matrix);
      }
    }
  }, 4, chairSheaveGeometry(true));
  cacheStaticTransforms(staticNetwork);

  function setPassenger(lift, direction, t, doorOpening) {
    if (occupied && (!lift || occupied.lift !== lift)) occupied.lift.passenger.visible = false;
    occupied = lift?.passenger ? { lift, direction, t } : null;
    if (!occupied) return;
    const passenger = lift.passenger;
    lift.samplers[direction].at(t, passenger.position, tangent);
    passenger.rotation.y = Math.atan2(tangent.x, tangent.z) + (direction ? Math.PI : 0);
    passenger.visible = true;
    if(lift.setPassengerDoors){
      const distance=Math.min(t,1-t)*lift.samplers[direction].total;
      doorOpening??=gondolaDoorsAtDistance(distance);
      lift.setPassengerDoors(doorOpening);
    }
    return doorOpening;
  }

  function update(clock, camera) {
    const useLod = (compactDevice || detail.budget) && !!camera;
    let focalPixels = 0;
    if (camera) {
      camera.updateMatrixWorld();
      view.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      if (useLod) focalPixels = camera.projectionMatrix.elements[5] * window.innerHeight * .5;
    }
    for (const { mesh, distant } of towerBatches) {
      const distance = detail.budget && camera ? mesh.boundingSphere.distanceToPoint(camera.position) : 0;
      mesh.castShadow = distance < 200;
      mesh.visible = !distant || distance < 155;
      if (distant) distant.visible = !mesh.visible;
    }
    const state={};
    for (const lift of lifts) {
      const eye = detail.budget ? camera?.position : null;
      if (!lift.def.aerial) { lift.surfaceUpdate?.(clock, eye); continue; }
      const { samplers, carriers, layers, distantCarriers, perSide, circulation, terminals, doorOpen, fleetRadius } = lift;
      for (const { position, objects, wheel } of terminals) {
        const close = !eye || position.distanceToSquared(eye) < 275 ** 2;
        for (const object of objects) object.visible = close;
        if (close) wheel?.(clock);
      }
      const count = perSide * 2, headway = circulation.duration / count;
      const own = occupied?.lift === lift;
      const size = lift.def.type === 'p2p' ? 4.2 : lift.def.type === 'chair' ? 2.75 : 3.3;
      const detailedRangeSquared = Math.max(34, size * focalPixels / (detail.budget ? 21 : 12)) ** 2;
      carrierBounds.radius = useLod ? size + .8 : fleetRadius;
      let nearCount = 0, farCount = 0;
      // Occupied cabins and the tower meshes keep their independent shadow
      // visibility. A regular fleet can be compacted against the color view.
      const clipFleet = camera && !carriers.castShadow && layers.every(layer => !layer.castShadow);
      const fleetVisible = !clipFleet || view.intersectsSphere(carriers.boundingSphere);
      for (let i = 0; fleetVisible && i < count; i++) {
        circulation.at(clock + i * headway, position, tangent, state);
        const sameRope = own && state.direction === occupied.direction
          && Math.abs(state.t - occupied.t) * samplers[occupied.direction].total < 8;
        const intersectsRider = own && position.distanceToSquared(lift.passenger.position) < 2.8 ** 2;
        if (useLod && (sameRope || intersectsRider)) continue;
        if (clipFleet && !view.intersectsSphere(carrierBounds)) continue;
        dummy.position.copy(position);
        dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0);
        dummy.scale.setScalar(sameRope || intersectsRider ? 0 : 1);
        dummy.updateMatrix();
        if (useLod && camera.position.distanceToSquared(position) > detailedRangeSquared) {
          distantCarriers.setMatrixAt(farCount++, dummy.matrix);
          continue;
        }
        carriers.setMatrixAt(nearCount, dummy.matrix);
        doorOpen?.setX(nearCount, state.doorOpening);
        nearCount++;
      }
      carriers.count = nearCount;
      carriers.visible = nearCount > 0;
      for (const layer of layers) {
        layer.count = nearCount;
        layer.visible = carriers.visible;
      }
      if (nearCount) {
        carriers.instanceMatrix.clearUpdateRanges();
        carriers.instanceMatrix.addUpdateRange(0, nearCount * 16);
        carriers.instanceMatrix.needsUpdate = true;
        if (doorOpen) {
          doorOpen.clearUpdateRanges();
          doorOpen.addUpdateRange(0, nearCount);
          doorOpen.needsUpdate = true;
        }
      }
      distantCarriers.count = farCount;
      distantCarriers.visible = farCount > 0;
      if (farCount) {
        distantCarriers.instanceMatrix.clearUpdateRanges();
        distantCarriers.instanceMatrix.addUpdateRange(0, farCount * 16);
        distantCarriers.instanceMatrix.needsUpdate = true;
      }
    }
  }

  update(0);
  return {
    lifts, update, setPassenger,
    setQuality() {
      for (const lift of lifts) lift.setRopeQuality?.(detail.budget);
    },
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
  return { sign, post, frame: board.children[0], face: board.children[1] };
}

function batchTrailSigns(scene, markers, signs) {
  const signCells = new Map();
  for (const marker of signs) {
    const { x, z } = marker.sign.position;
    const key = `${Math.floor(x / 460)},${Math.floor(z / 460)}`;
    if (!signCells.has(key)) signCells.set(key, []);
    signCells.get(key).push(marker);
  }

  markers.updateWorldMatrix(true, true);
  const markersInverse = markers.matrixWorld.clone().invert();
  const matrix = new THREE.Matrix4();
  const dimensions = new THREE.Vector3();
  const offset = new THREE.Vector3();
  function setSignPart(mesh, index, source) {
    const { width, height, depth = 1 } = source.geometry.parameters;
    dimensions.set(width, height, depth);
    matrix.multiplyMatrices(markersInverse, source.matrixWorld).scale(dimensions);
    // Keep instance offsets small when signs are far from the world origin.
    matrix.setPosition(offset.setFromMatrixPosition(matrix).sub(mesh.position));
    mesh.setMatrixAt(index, matrix);
  }

  const woodGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const markersInCell of signCells.values()) {
    const wood = new THREE.InstancedMesh(woodGeometry, woodMat, markersInCell.length * 2);
    wood.name = 'trail marker frames and posts';
    wood.position.copy(markersInCell[0].sign.position);
    wood.castShadow = true;
    for (const [i, { post, frame }] of markersInCell.entries()) {
      setSignPart(wood, i * 2, post);
      setSignPart(wood, i * 2 + 1, frame);
      // The original meshes also serve as sources for the cabin reflection.
      post.visible = frame.visible = false;
    }
    wood.computeBoundingSphere();
    markers.add(wood);
  }

  const prepareScene = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, activeScene, camera, target) {
    scene.onBeforeRender = prepareScene;
    prepareScene.call(this, renderer, activeScene, camera, target);
    if (!renderer.capabilities.isWebGL2) {
      cacheStaticTransforms(markers);
      return;
    }

    for (const markersInCell of signCells.values()) {
      // Isolated array layers preserve the original board pixels and mipmaps.
      // Limit each upload so a dense junction does not require a large texture.
      const layerLimit = 16;
      for (let offset = 0; offset < markersInCell.length; offset += layerLimit) {
        const layers = markersInCell.slice(offset, offset + layerLimit);
        if (layers.length === 1) continue;
        const sourceMaterial = layers[0].face.material;
        const { width, height } = sourceMaterial.map.image;
        const rowSize = width * 4;
        const layerSize = rowSize * height;
        const rgba = new Uint8Array(layerSize * layers.length);
        for (const [layer, { face }] of layers.entries()) {
          const map = face.material.map;
          const pixels = map.image.getContext('2d').getImageData(0, 0, width, height).data;
          for (let y = 0; y < height; y++) {
            const row = (height - 1 - y) * rowSize;
            rgba.set(pixels.subarray(row, row + rowSize), layer * layerSize + y * rowSize);
          }
          face.visible = false;
        }

        const texture = new THREE.DataArrayTexture(rgba, width, height, layers.length);
        texture.colorSpace = sourceMaterial.map.colorSpace;
        texture.magFilter = sourceMaterial.map.magFilter;
        texture.minFilter = sourceMaterial.map.minFilter;
        texture.anisotropy = sourceMaterial.map.anisotropy;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        const material = sourceMaterial.clone();
        material.map = null;
        material.customProgramCacheKey = () => 'trail-board-array';
        material.onBeforeCompile = shader => {
          shader.uniforms.trailBoards = { value: texture };
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float trailLayer; varying vec3 trailUv;')
            .replace('#include <uv_vertex>', '#include <uv_vertex>\ntrailUv = vec3(uv, trailLayer);');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray trailBoards; varying vec3 trailUv;')
            .replace('#include <map_fragment>', 'diffuseColor *= texture(trailBoards, trailUv);');
        };
        const geometry = new THREE.PlaneGeometry(1, 1);
        geometry.setAttribute('trailLayer', new THREE.InstancedBufferAttribute(Float32Array.from(layers, (_, i) => i), 1));
        const boards = new THREE.InstancedMesh(geometry, material, layers.length);
        boards.name = 'trail marker boards';
        boards.position.copy(layers[0].sign.position);
        for (const [i, { face }] of layers.entries()) {
          setSignPart(boards, i, face);
          face.material.map.dispose();
          face.material.map = null;
        }
        boards.computeBoundingSphere();
        markers.add(boards);
      }
    }
    cacheStaticTransforms(markers);
  };
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
  grid.addBox(lodge.x, lodge.z, w / 2 + 3.2, d / 2 + 3.5, -lodge.rot, 'lodge');
  return group;
}

function appendQuad(out, a, b, c, d, color) {
  out.xyz.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < 6; i++) out.rgb.push(color.r, color.g, color.b);
}

function appendGeometry(out, geometry, color) {
  const triangles = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const n of triangles.attributes.position.array) out.xyz.push(n);
  for (let i = 0; i < triangles.attributes.position.count; i++) out.rgb.push(color.r, color.g, color.b);
  if (triangles !== geometry) triangles.dispose();
  geometry.dispose();
}

function groundRoof(points, elevation, section) {
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z))));
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i), v = positions.getZ(i);
    positions.setXYZ(i, section.originX + u * section.cos - v * section.sin,
      elevation + section.pitch * Math.max(0, 1 - Math.abs(v) / section.width),
      section.originZ + u * section.sin + v * section.cos);
  }
  return geometry;
}

function roofHalf(points, sign) {
  const side = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (sign * a[1] >= 0) side.push(a);
    if (a[1] * b[1] < 0) side.push([lerp(a[0], b[0], a[1] / (a[1] - b[1])), 0]);
  }
  return side;
}

function buildVillage(scene, grid, district = null, detail = null) {
  const data = new Map();
  const patchSize = detail?.budget ? 700 : 350;
  const palette = [0x776659, 0x7c7771, 0x616b69, 0x887766, 0x777d72, 0x644f44];
  const frame = new THREE.Color(0x282c2b), glass = new THREE.Color(0x587582);
  const snow = new THREE.Color(0xe7eef1), stone = new THREE.Color(0x787f83);
  const bucket = () => ({ xyz: [], rgb: [] });

  for (const lot of buildingData) {
    if (district ? !district.has(lot.id) : ENTERABLE_VILLAGE_IDS.has(lot.id) || REPLACED_STATION_BUILDING_IDS.has(lot.id) ||
        FAIRMONT_REPLACED_IDS.has(lot.id) || CREEKSIDE_BUILDING_IDS.has(lot.id) || SKIERS_PLAZA_BUILDING_IDS.has(lot.id) || lot.id === '146628098') continue;
    const points = lot.points.filter((p, i, all) => {
      const previous = all[(i + all.length - 1) % all.length];
      return Math.hypot(p[0] - previous[0], p[1] - previous[1]) > .045;
    });
    if (points.length < 3) continue;
    const x = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const z = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const localHeights = points.flatMap(([x, z], i) => {
      const [bx, bz] = points[(i + 1) % points.length];
      const steps = Math.ceil(Math.hypot(bx - x, bz - z) / 2);
      return Array.from({ length: steps }, (_, j) => heightAt(lerp(x, bx, j / steps), lerp(z, bz, j / steps)));
    });
    const upperGround = Math.max(...localHeights);

    let bearing = 0, longest = 0;
    for (const [i, a] of points.entries()) {
      const b = points[(i + 1) % points.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length > longest) {
        longest = length;
        bearing = Math.atan2(b[1] - a[1], b[0] - a[0]);
      }
    }
    if (longest < .2) continue;
    const cos = Math.cos(bearing), sin = Math.sin(bearing);
    const local = points.map(([px, pz]) => [
      (px - x) * cos + (pz - z) * sin,
      (pz - z) * cos - (px - x) * sin,
    ]);
    const width = Math.max(.2, ...local.map((p) => Math.abs(p[1])));
    const measured=roofHeights[lot.id];
    const floors = Math.max(1, Math.min(12, lot['building:levels'] ||
      (measured ? Math.round(measured.eave/2.9) : longest > 16 ? 3 : longest > 6 ? 2 : 1)));
    const storyHeight = measured ? measured.eave/floors : lot.height ? lot.height / floors : 2.83;
    const top = upperGround + Math.max(.82, floors * storyHeight);
    const pitch=measured ? Math.max(.12,measured.ridge-measured.eave) : Math.min(lot.id === '146630821' ? 2.25 : 4.6,width*.52);
    const section = { originX: x, originZ: z, width, cos, sin, pitch };
    const key = `${Math.floor(x / patchSize)},${Math.floor(z / patchSize)}`;
    if (!data.has(key)) data.set(key, { walls: bucket(), foundations: bucket(), roof: bucket(), windows: {...bucket(),pane:[]} });
    const mesh = data.get(key);
    const trim = new THREE.Color(palette[Number(lot.id) % palette.length]);
    const clockwise = THREE.ShapeUtils.isClockWise(points.map(([x, z]) => new THREE.Vector2(x, z)));
    const roofY = (v) => top + section.pitch * Math.max(0, 1 - Math.abs(v) / width);
    const roofAt = (px, pz) => roofY((pz - z) * cos - (px - x) * sin) + .08;
    grid?.addBuilding({ id: lot.id, points, roofAt, upperGround, measured: !!measured, generic: true });

    for (const [i, a] of points.entries()) {
      const j = (i + 1) % points.length, b = points[j];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < .2) continue;
      const v0 = local[i][1], v1 = local[j][1];
      const corners = [[...a, v0], [...b, v1]];
      if (v0 * v1 < 0) {
        const t = v0 / (v0 - v1);
        corners.splice(1, 0, [lerp(a[0], b[0], t), lerp(a[1], b[1], t), 0]);
      }
      const base = (upperGround + .55);
      const length = Math.ceil(len / 2);
      for (let k = 0; k < length; k++) {
        const ax = lerp(a[0], b[0], k / length), az = lerp(a[1], b[1], k / length);
        const bx = lerp(a[0], b[0], (k + 1) / length), bz = lerp(a[1], b[1], (k + 1) / length);
        appendQuad(mesh.foundations, [ax, heightAt(ax, az) - .6, az], [bx, heightAt(bx, bz) - .6, bz],
          [bx, base, bz], [ax, base, az], stone);
      }
      for (let k = 1; k < corners.length; k++) {
        const [ax, az, va] = corners[k - 1], [bx, bz, vb] = corners[k];
        appendQuad(mesh.walls, [ax, base, az], [bx, base, bz], [bx, roofY(vb), bz], [ax, roofY(va), az], trim);
      }
      grid?.addBox((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len / 2 + .08, .16,
        Math.atan2(dz, dx), 'building-wall', { buildingId: lot.id, maxY: Math.max(roofY(v0), roofY(v1), v0 * v1 < 0 ? roofY(0) : -Infinity) });
      if (len < 3.1 || district) continue;
      const out = clockwise ? 1 : -1;
      const pane = (t0, t1, y, h, offset, material, seed=0, left=0, right=255) => {
        const nx = -dz / len * out * offset, nz = dx / len * out * offset;
        const x0 = lerp(a[0], b[0], t0) + nx, z0 = lerp(a[1], b[1], t0) + nz;
        const x1 = lerp(a[0], b[0], t1) + nx, z1 = lerp(a[1], b[1], t1) + nz;
        appendQuad(mesh.windows, [x0, y, z0], [x1, y, z1], [x1, y + h, z1], [x0, y + h, z0], material);
        mesh.windows.pane.push(left,0,seed,right,0,seed,right,255,seed,left,0,seed,right,255,seed,left,255,seed);
      };
      const bays = Math.max(1, Math.floor((len - 1.4) / 2.95));
      for (let bay = 0; bay < bays; bay++) {
        const c = (bay + .5) / bays, half = Math.min(1.0 / len, .27 / bays);
        for (let floor = 0; floor < floors - .3; floor++) {
          const y = upperGround + .89 + floor * storyHeight;
          const height = Math.min(1.38, storyHeight * .55, top - y - .2);
          if (height < .35) continue;
          const seed=1+Math.floor((Math.sin(Number(lot.id)%197+i*72.1+floor*138.6+bay*31.7)*.5+.5)*254);
          pane(c - half, c + half, y, height, .033, frame);
          pane(c - half * .83, c - .025 / len, y + .09, height - .17, .05, glass,seed,0,127);
          pane(c + .025 / len, c + half * .83, y + .09, height - .17, .05, glass,seed,128,255);
        }
      }
    }
    // Clip each real roof triangle at the ridge. Clipping the whole concave
    // ring at once can bridge disconnected parts of an L- or U-shaped plan.
    const triangles = THREE.ShapeUtils.triangulateShape(local.map(([x,z]) => new THREE.Vector2(x,z)), []);
    for (const triangle of triangles) {
      const face = triangle.map(i => local[i]);
      for (const sign of [-1, 1]) {
        const half = roofHalf(face, sign);
        if (half.length >= 3) appendGeometry(mesh.roof, groundRoof(half, top + .08, section), snow);
      }
    }
  }

  const materials = {
    walls: surfaceMaterial('timber', { vertexColors: true, side: THREE.DoubleSide }),
    foundations: surfaceMaterial('stone', { vertexColors: true, side: THREE.DoubleSide }),
    roof: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, side: THREE.DoubleSide }),
    windows: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: .1, side: THREE.DoubleSide }),
  };
  const village = new THREE.Group();
  village.name = district ? 'Distant village buildings' : 'Village · mapped building footprints';
  for (const parts of data.values()) {
    for (const [name, part] of Object.entries(parts)) {
      if (!part.xyz.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.xyz, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(Uint16Array.from(part.rgb, v => Math.round(v * 65535)), 3, true));
      if(part.pane)geometry.setAttribute('windowPane',new THREE.Uint8BufferAttribute(part.pane,3,true));
      geometry.computeVertexNormals();
      part.xyz.length = part.rgb.length = 0;
      if (part.pane) part.pane.length = 0;
      const mesh = new THREE.Mesh(geometry, materials[name]);
      mesh.name = 'Mapped village ' + name;
      mesh.castShadow = name !== 'windows';
      mesh.receiveShadow = true;
      village.add(mesh);
    }
  }
  scene.add(village);
  cacheStaticTransforms(village);
  return village;
}

// At summit distance the surveyed building envelopes occupy only a few pixels.
// Construct their architectural details and walk surfaces on approach, before entry.
function resortDistrict(scene, grid, ids, x, z, build, detail) {
  let district, steps;
  function assemble(deadline) {
    if (district) return;
    steps ??= build(scene, { grid });
    do {
      const step = steps.next();
      if (step.done) {
        district = step.value;
        steps = null;
        return;
      }
    } while (performance.now() < deadline);
  }
  if (!compactDevice && !detail.budget) assemble(Infinity);
  let outline = district ? null : buildVillage(scene, null, ids);
  const distanceSquared = (px, pz) => (px - x) ** 2 + (pz - z) ** 2;
  return {
    get group() { return district?.group; },
    prepare: assemble,
    update(dt, time, camera) {
      const distance = camera ? distanceSquared(camera.position.x, camera.position.z) : 0;
      if (!district && (distance < 2100 ** 2 || (!detail.budget && !compactDevice))) {
        assemble(performance.now() + 2);
      }
      const near = !!district && (!detail.budget || distance < (district.group.visible ? 1450 : 1200) ** 2);
      if (!near) outline ??= buildVillage(scene, null, ids);
      if (outline) outline.visible = !near;
      if (district) district.group.visible = near;
      if (near) district.update(dt, time, camera);
    },
    async prepareArrival(px, pz) {
      if (distanceSquared(px, pz) > 240 ** 2) return;
      while (!district) {
        assemble(performance.now() + 5);
        if (!district) await frame();
      }
    },
  };
}

function buildFitzTerminal(scene, grid, markers, def, pointIndex) {
  const [x, z] = def.points[pointIndex];
  const base = pointIndex === 0;
  const [nextX, nextZ] = base ? def.points[1] : def.points.at(-2);
  const yaw = Math.atan2(nextX - x, nextZ - z);
  const station = new THREE.Group();
  station.name = base ? 'Fitzsimmons bottom station' : 'Fitzsimmons top station';
  station.position.set(x, heightAt(x, z) - .12, z);
  station.rotation.y = yaw;
  station.userData.station = { id: def.id, base, datum: station.position.y };
  scene.add(station);

  const structure = [], hood = [], windows = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * 6.65, pz = 2 + sz * 7.4;
      structure.push(box(.62, 4.65, .62, '#4a565b', [px, 2.2, pz]));
      const cx = x + px * Math.cos(yaw) + pz * Math.sin(yaw);
      const cz = z - px * Math.sin(yaw) + pz * Math.cos(yaw);
      const footing = Math.min(-.2, heightAt(cx, cz) - station.position.y - .28);
      structure.push(box(1.12, .365 - footing, 1.04, '#859299', [px, (.365 + footing) / 2, pz]));
      grid.addCircle(cx, cz, .68, 'lift-tower');
    }
    structure.push(box(.44, .35, 17.1, '#63727a', [sx * 6.4, 4.46, 2.1]));
    hood.push(box(.16, 1.14, 16.6, '#a71836', [sx * 6.32, 5.12, 2.03]));
    hood.push(box(.24, .16, 16.9, '#c32541', [sx * 6.32, 5.74, 2.02]));
    for (let i = -3; i < 4; i++) {
      windows.push(box(.07, .64, 1.95, '#506c7c', [sx * 6.445, 5.16, 2 + i * 2.22]));
    }
  }
  hood.push(box(12.0, .19, 17.1, '#aebbc0', [0, 6.26, 2]));
  hood.push(box(12.0, .23, 17.15, '#646f73', [0, 6.06, 2]));
  for (const side of [-1, 1]) {
    hood.push(box(.7, .23, 17.05, '#c3d3da', [side * 6.10, 5.96, 2], [0, 0, -side * .31]));
  }
  for (const z of [-6.5, 10.5]) {
    hood.push(box(12.9,.26,.24,'#bd1e3b',[0,6.17,z]));
    hood.push(box(12.9,.19,.24,'#a51230',[0,4.67,z]));
    for(const side of [-1,1])hood.push(box(.29,1.69,.25,'#c62645',[side*6.32,5.43,z]));
    const pane=new THREE.BufferGeometry();
    pane.setAttribute('position',new THREE.Float32BufferAttribute([-6.14,4.78,z,6.14,4.78,z,6.14,6.03,z,-6.14,4.78,z,6.14,6.03,z,-6.14,6.03,z],3));pane.computeVertexNormals();
    windows.push(part(pane,'#315365'));
    for(let i=-3;i<=3;i++)hood.push(box(.035,1.24,.065,'#485c66',[i*1.69,5.40,z-.032]));
    structure.push(box(13.3, .23, .6, '#59676d', [0, 4.33, z]));
  }
  hood.push(box(2.3, .21, 5.8, '#9dabb1', [8.2, 2.84, .6]));
  hood.push(box(2.23, 2.64, 5.7, '#555957', [8.2, 1.35, .6]));
  windows.push(box(1.54, .93, .065, '#6a8793', [8.2, 1.62, -2.31]));
  const hut = stationPoint({ x, z, yaw }, 8.2, .6);
  grid.addBox(hut.x, hut.z, 1.12, 2.85, -yaw, 'station', { maxY: station.position.y + 2.96 });
  station.add(mergedMesh(structure, { roughness: .66, metalness: .26 }));
  station.add(mergedMesh(hood, { roughness: .58, metalness: .1 }));
  station.add(mergedMesh(windows, { roughness: .36, metalness: .1 }));
  station.add(createRoofSnow([[-6.15,6.37,-6.58],[6.15,6.37,-6.58],[6.15,6.37,10.58],[-6.15,6.37,10.58]],{seed:420,depth:.15,overhang:.11,spacing:.8}));
  station.add(createIcicles([-6.15,6.30,-6.62],[6.15,6.30,-6.62],{seed:818,spacing:.64,length:.22}));

  if (base) {
    const sign = makeSign('FITZSIMMONS EXPRESS', 'TSÍQTEN · SḴWEXWNÁCH', '#edf3f4', 11.5, '#aa1935');
    sign.scale.y=.19;sign.position.set(0,6.17,-6.67);
    sign.rotation.y = Math.PI;
    station.add(sign);
    const board = makeSign('FITZSIMMONS', '8-PASSENGER CHAIR', '#e5edf0', 3.15);
    board.position.set(-7.7, 2.25, -9);
    board.rotation.y = Math.PI;
    station.add(board);
    for (const side of [-1, 1]) {
      const x = side * 6.3;
      const fence = [];
      for (let k = 0; k < 6; k++) fence.push(box(.073, 1.06, .073, '#546771', [x, .52, -8.1 - k * 2.15]));
      fence.push(box(.046, .046, 11.2, '#8b9398', [x, .91, -13.44]));
      fence.push(box(.036, .046, 11.2, '#8b9398', [x, .49, -13.44]));
      station.add(mergedMesh(fence, { roughness: .56, metalness: .15 }));
    }
  } else {
    const sign = makeSign('FITZ', 'TO LOWER OLYMPIC', '#b9e8c2', 2.9, '#274333');
    const signX = 32, signZ = 1721;
    sign.position.set(signX, heightAt(signX, signZ) + 2.3, signZ);
    sign.rotation.y = Math.PI;
    markers.add(sign);
  }
}

function buildTerminal(scene, grid, markers, def, pointIndex) {
  if (def.id === PEAK_TO_PEAK && pointIndex === def.points.length - 1) return buildBlackcombTerminal(scene, grid, def);
  if ((def.id === PEAK_TO_PEAK && pointIndex === 0)
    || (def.id === VILLAGE_GONDOLA_UPPER && pointIndex === def.points.length - 1)) return;
  if (def.id === PEAK_EXPRESS || def.id === HARMONY_EXPRESS) return buildAlpineChairStation(scene, grid, def, pointIndex);
  if (def.id === FITZSIMMONS) return buildFitzTerminal(scene, grid, markers, def, pointIndex);
  return buildMappedTerminal(scene, grid, def, pointIndex);
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

function buildFlags(scene) {
  const group = new THREE.Group();
  group.name = 'flags';
  const flags = [];
  const spots = [
    { ...MOUNTAIN.whistlerPeak, color: 0xd8532c, rot: 0.4, size: 1.45 },
    { x: -19, z: 10, color: 0xffc75b, rot: -0.5, size: 1.35 },
    { x: 24, z: 1720, color: 0x2b7fc4, rot: 0.2, size: 1.2 },
    { ...MOUNTAIN.rendezvous, color: 0xe04b3a, rot: -0.2, size: 1.2 },
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

const cameraObstacles = new Set([
  'lodge', 'station', 'building-wall', 'lift-tower', 'furniture', 'landmark',
  'plaza-building-wall', 'plaza-railing', 'plaza-planter', 'plaza-canopy', 'tree', 'fallen log', 'ice-wall', 'patrol-pad',
]);

export async function buildEnvironment(scene, { onProgress = () => {}, quality } = {}) {
  const rand = mulberry32(9102026);
  const grid = new ColliderGrid();
  const detail = { budget: quality === 'BUDGET' };

  onProgress(0.03, 'Growing the old-growth forest…');
  await frame();
  const forest = buildForest(scene, grid, rand, detail);

  onProgress(0.24, 'Scattering alpine rock…');
  await frame();
  const updateRockQuality = buildRocks(scene, grid, rand, detail);
  const alpineCliffs = buildAlpineCliffs(scene, grid, heightAt);
  const glacierCave = buildGlacierCave(scene, grid, heightAt);

  onProgress(0.36, 'Stringing the lifts…');
  await frame();
  const markers = new THREE.Group();
  markers.name = 'markers';
  scene.add(markers);
  const village = buildVillage(scene, grid, null, detail);
  const villageWindows = village.children.filter(mesh => mesh.name === 'Mapped village windows');
  for (const mesh of villageWindows) mesh.geometry.computeBoundingSphere();
  const skiersPlaza = buildSkiersPlaza(scene, { grid });
  let distantSkiersPlaza;
  if (detail.budget) distantSkiersPlaza = buildVillage(scene, null, SKIERS_PLAZA_BUILDING_IDS);
  const lifts = buildLifts(scene, grid, detail);

  onProgress(0.52, 'Building the lodges…');
  await frame();
  for (const lodge of LODGES) {
    if (lodge.id !== 'roundhouse' && lodge.id !== 'rendezvous') buildLodge(scene, grid, markers, lodge, rand);
  }
  const roundhouseArrival = buildRoundhouseArrival(scene, grid, lifts);
  const updateSummitSigns = buildSummitLandmarks(scene);
  roundhouseArrival.update(0);
  updateSummitSigns(0);
  const fairmont = resortDistrict(scene, grid, FAIRMONT_REPLACED_IDS, 523, -434, stageFairmont, detail);
  const creeksideVillage = resortDistrict(scene, grid, CREEKSIDE_BUILDING_IDS, -2549, 2071, stageCreeksideVillage, detail);
  const interiors = buildLodgeInteriors(scene, grid);

  onProgress(0.65, 'Hanging the trail signs…');
  await frame();
  const terminalLods = [];
  for (const def of LIFTS.filter((lift) => lift.aerial)) {
    for (const index of [0, def.points.length - 1]) {
      const terminal = buildTerminal(scene, grid, markers, def, index);
      if (terminal?.userData.terminalDetail) terminalLods.push(terminal.userData.terminalDetail);
    }
  }

  const stationOperations = buildStationOperations(scene, grid);

  const signed = new Set();
  const trailSigns = [];
  for (const run of [...RUNS].sort((a, b) => b.length - a.length)) {
    if ((!run.named || run.length < 450) && run.name !== 'Fitz') continue;
    if (signed.has(run.name)) continue;
    const marker = addTrailSign(markers, run, rand);
    if (marker) trailSigns.push(marker);
    signed.add(run.name);
  }
  batchTrailSigns(scene, markers, trailSigns);

  onProgress(0.8, 'Marking the summits…');
  await frame();
  const peak = MOUNTAIN.whistlerPeak;
  addSummitSign(markers, peak.x, peak.z, 'WHISTLER PEAK', '2,182 M · WHISTLER MOUNTAIN', '#ffc75b');

  const finishArches = FINISHES.map((finish) => {
    const run = runFromSource(finish.run);
    return run ? buildFinishArch(scene, grid, markers, run, finish.title.toUpperCase(), `${finish.elevation} M`) : null;
  }).filter(Boolean);

  const flags = buildFlags(scene);
  const people = buildResortPeople(scene, { grid, interiors, lifts, queueSlots: stationOperations.queueSlots,
    socialSlots: [...lodgeSocialSlots(), ...skiersPlaza.socialSlots, ...roundhouseArrival.operators] });

  onProgress(0.95, 'Checking the snow…');
  await frame();

  let markersVisible = true;
  let clock = 0;

  const env = {
    scene, grid, forest, markers, lifts, flags, finishArches, interiors, stationOperations, people, fairmont, creeksideVillage, skiersPlaza,
    alpineCliffs, glacierCave,
    walkSurfaceAt(x, z, y) {
      return glacierCave.walkSurfaceAt(x,z,y) ?? skiersPlaza.walkSurfaceAt(x,z,y) ?? creeksideFloor(x,z,y)
        ?? roundhouseArrival.walkSurfaceAt(x,z,y) ?? interiors.walkSurfaceAt(x,z,y);
    },
    async prepareArrival({ x, z }) {
      await Promise.all([fairmont.prepareArrival(x, z), creeksideVillage.prepareArrival(x, z)]);
    },
    raisedPadAt: roundhouseArrival.raisedPadAt,
    interiorAt(x, z, y) { return glacierCave.interiorAt(x,z,y) ?? interiors.interiorAt(x,z,y); },
    get budget() { return detail.budget; },
    setQuality(name) {
      const budget = name === 'BUDGET';
      if (detail.budget === budget) return;
      detail.budget = budget;
      updateRockQuality();
      lifts.setQuality();
    },
    lodgeEntrances: interiors.rooms.map(({ id, name, entry }) => ({ id, name, ...entry })),
    queryColliders(x, z, r = 3) { return grid.query(x, z, r); },
    clipCameraArm: cameraClipper(grid.query.bind(grid), cameraObstacles),
    pointInBox,
    update(dt, time, camera) {
      clock = time;
      glacierCave.update(time,camera);
      fairmont.update(dt,time,camera);
      creeksideVillage.update(dt,time,camera);
      const nearPlaza = !detail.budget || !camera || (camera.position.x + 46) ** 2 +
        (camera.position.z + 60) ** 2 < (skiersPlaza.group.visible ? 1200 : 1050) ** 2;
      if (!nearPlaza) distantSkiersPlaza ??= buildVillage(scene, null, SKIERS_PLAZA_BUILDING_IDS);
      if (distantSkiersPlaza) distantSkiersPlaza.visible = !nearPlaza;
      skiersPlaza.group.visible = nearPlaza;
      if (nearPlaza) skiersPlaza.update(dt,time,camera);
      for (const mesh of villageWindows) mesh.visible = !detail.budget || !camera ||
        mesh.geometry.boundingSphere.distanceToPoint(camera.position) < 1000;
      interiors.updateDetail(camera, detail.budget);
      for (const update of terminalLods) update(detail.budget ? camera?.position : null);
      people.update(dt,time,camera);
      if (!camera || Math.hypot(camera.position.x-488,camera.position.z-4844)<1050) roundhouseArrival.update(time);
      if (!camera || camera.position.z>4400 && camera.position.z<6250) updateSummitSigns(time);
      if (camera) forest.updateDetail(camera);
      lifts.update(time, camera);
      stationOperations.update(time, camera);
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
        people: people.debug(),
        clock,
      };
    },
  };

  onProgress(1, 'Checking the snow…');
  return env;
}



