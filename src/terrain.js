import * as THREE from 'three';
import {
  WORLD, RUNS, MOUNTAIN, initWorldData,
} from './worlddata.js';
import {
  clamp, lerp, smoothstep, noise, noise2, makeCanvas, mulberry32,
} from './util.js';

import { regionBounds, blackTuskBounds } from '../data/geography.js';
import { surfaceMaterial } from './materials.js';
import { climateUniforms } from './climate-state.js';
import { coniferGeometry, coniferMaterial } from './conifers.js';
import { ForestCell, batchBudgetForestCrowns, makeForestCrowns, preloadForestCrowns, shareForestInstances } from './forest-lod.js';
import { createSkiSnowSurface, SKI_SNOW_FOOTPRINT } from './ski-snow-surface.js';
import { prepareValleyLakes } from './valley-scenery.js';
import { createStationGrading } from './station-sites.js';
import { gradeGlacierCave } from './glacier-cave.js';
import { compressSnow } from './snow-traffic.js';
import { compactDevice } from './device-budget.js';
import { terrainHorizon } from './terrain-horizon.js';
import { createTerrainOcclusion } from './terrain-occlusion.js';
import { LODGE_FRAME, LODGE_ANNEX } from './roundhouse-site.js';
import { triangleHeight, worldIndex, boxBlurGrid } from './terrain-grid.js';
import { coarseTerrainTopology, createTerrainTileDetail } from './terrain-tile-detail.js';
import { startSnowGeneration } from './terrain-snow-worker-client.js';
import { loadWhistlerSnowPack, unpackWhistlerSnowPack, whistlerSnowPackCacheMode } from './whistler-snow-pack.js';
import { cacheStaticTransforms } from './scenery.js';
import { createBackcountry, createSurveyTerrain, insideTerrain } from './backcountry.js';

export const terrain = {
  heightAt,
  mesh: null,
  heights: null,
  n: 0,
  cell: 0,
  mask: null,
  maskN: 0,
  regionalBounds: regionBounds,
  get minX() { return WORLD.minX; },
  get maxX() { return WORLD.maxX; },
  get minZ() { return WORLD.minZ; },
  get maxZ() { return WORLD.maxZ; },
};

let heights, landCover, n, cell, mask, maskN, snowField;
let gradedHeights, gradeStation;
let backcountry, tuskGround, regionCover;

export async function loadGrid(file, bounds) {
  const response = await fetch(new URL(`../data/${file}`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status})`);
  const view = new DataView(await response.arrayBuffer());
  const length = bounds.grid ** 2;
  if (view.byteLength !== length * 3) throw new Error(`Invalid terrain grid ${file}`);

  const heights = new Float32Array(length);
  const cover = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    heights[i] = view.getUint16(i * 3, true) / 10;
    cover[i] = view.getUint8(i * 3 + 2);
  }
  return { heights, cover };
}

export function landCoverAt(x, z) {
  if (!landCover) return 0;
  if (!insideTerrain(WORLD, x, z)) return regionCover?.(x, z) ?? 0;
  const [gx, gz] = worldIndex(x, z, WORLD);
  return landCover[Math.round(gz) * n + Math.round(gx)];
}

export function treeCoverAt(x, z) {
  if (landCoverAt(x, z) === 10) return 1;
  let count = 0;
  for (const [dx, dz] of [[-22, 0], [22, 0], [0, -22], [0, 22]]) {
    count += Number(landCoverAt(x + dx, z + dz) === 10);
  }
  return count / 5;
}

// Use the same linear interpolation as the shader's surface sampler.
export function surfaceAt(x, z, out = {}) {
  if (!insideTerrain(WORLD, x, z)) {
    const alpine = smoothstep(-145, 115, heightAt(x, z) - climateUniforms.snowline.value);
    const cover = smoothstep(.25, .79, Math.max(climateUniforms.snowpack.value, alpine));
    out.id = cover < .28 ? 'ground' : 'powder';
    out.grip = cover < .28 ? 1 : .76;
    out.drag = cover < .28 ? 3 : 1.45;
    out.powder = cover < .28 ? 0 : .84 * cover;
    return compressSnow(x, z, out);
  }
  if (!snowField) {
    out.id = 'packed'; out.grip = 1; out.drag = 1; out.powder = .12;
    return out;
  }
  const u = clamp((x - WORLD.minX) / WORLD.sizeX * maskN - .5, 0, maskN - 1);
  const v = clamp((z - WORLD.minZ) / WORLD.sizeZ * maskN - .5, 0, maskN - 1);
  const ix = Math.min(maskN - 2, Math.floor(u)), iz = Math.min(maskN - 2, Math.floor(v));
  const tx = u - ix, tz = v - iz;
  const i = 4 * (iz * maskN + ix), row = 4 * maskN;
  const channel = (k) => lerp(lerp(snowField[i + k], snowField[i + 4 + k], tx),
    lerp(snowField[i + row + k], snowField[i + row + 4 + k], tx), tz) / 255;
  const pack = climateUniforms.snowpack.value;
  const alpine = pack < .80 ? smoothstep(-145,115,heightAt(x,z)-climateUniforms.snowline.value) : 1;
  const groomed = smoothstep(.21,.63,channel(0));
  const piste = .90*groomed*smoothstep(.02,.35,pack);
  const cover = Math.max(piste,smoothstep(.25,.79,Math.max(pack,alpine)));
  if (cover < .28) {
    out.id='ground';out.grip=1;out.drag=3;out.powder=0;
    return out;
  }
  const ice = smoothstep(.22, .53, channel(2));
  const powder = smoothstep(.23, .77, channel(1)) * (1 - ice);
  out.id = ice > .52 ? 'ice' : powder > .47 ? 'powder' : 'packed';
  out.grip = 1 - .61 * ice - .27 * powder;
  out.drag = 1 - .31 * ice + .53 * powder;
  out.powder = (.11 + powder * .88) * (1 - ice) * cover;
  return compressSnow(x, z, out);
}

function makePatches(n, attributes, material, patch = 64, detail = null) {
  const terrain = new THREE.Group();
  const nativeIndices = new Map();
  for (let z0 = 0; z0 < n - 1; z0 += patch) {
    for (let x0 = 0; x0 < n - 1; x0 += patch) {
      const w = Math.min(patch, n - 1 - x0) + 1;
      const h = Math.min(patch, n - 1 - z0) + 1;
      const key = `${w}:${h}`;
      if (!nativeIndices.has(key)) {
        const indices = new Uint16Array((w - 1) * (h - 1) * 6);
        let offset = 0;
        for (let z = 0; z < h - 1; z++) for (let x = 0; x < w - 1; x++) {
          const a = z * w + x;
          indices.set([a, a + w, a + 1, a + 1, a + w, a + w + 1], offset);
          offset += 6;
        }
        nativeIndices.set(key, indices);
      }
      const buildGeometry = ({ indices, points }) => {
        const geometry = new THREE.BufferGeometry();
        for (const [name, array, stride] of attributes) {
          const vertex = new Float32Array((points?.length ?? w * h) * stride);
          if (points) {
            for (let i = 0; i < points.length; i++) {
              const u = x0 + points[i] % w, v = z0 + Math.floor(points[i] / w);
              const src = (v * n + u) * stride;
              for (let channel = 0; channel < stride; channel++) vertex[i * stride + channel] = array[src + channel];
            }
          } else {
            for (let z = 0; z < h; z++) {
              const first = ((z0 + z) * n + x0) * stride;
              vertex.set(array.subarray(first, first + w * stride), z * w * stride);
            }
          }
          geometry.setAttribute(name, new THREE.BufferAttribute(vertex, stride));
        }
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
        return geometry;
      };
      const full = () => buildGeometry({ indices: nativeIndices.get(key) });
      if (detail && w > 2 && h > 2) {
        const position = attributes[0][1];
        const first = (z0 * n + x0) * 3, last = ((z0 + h - 1) * n + x0 + w - 1) * 3;
        detail.add(terrain, material, {
          minX: position[first], maxX: position[last], minZ: position[first + 2], maxZ: position[last + 2],
        }, full, () => buildGeometry(coarseTerrainTopology(w, h)));
        continue;
      }
      const mesh = new THREE.Mesh(full(), material);
      mesh.receiveShadow = true;
      terrain.add(mesh);
    }
  }
  return terrain;
}

const terrainTile = 32;
const detailStep = 4;
let detailTiles = new Map();
// Offscreen collision and tree placement repeatedly sample the same fine-grid
// corners. Keep exact doubles until a streamed tile supplies its own samples.
const vertexCacheSize = 16384;
const vertexKeys = new Uint32Array(vertexCacheSize);
const vertexHeights = new Float64Array(vertexCacheSize);

function fineGridHeight(i, j) {
  const key = j * ((n - 1) * detailStep + 1) + i + 1;
  const slot = key & (vertexCacheSize - 1);
  if (vertexKeys[slot] !== key) {
    vertexHeights[slot] = detailVertex(i / detailStep, j / detailStep);
    vertexKeys[slot] = key;
  }
  return vertexHeights[slot];
}

function smoothTerrainRow(i, t) {
  const a = heights[i - 1], b = heights[i], c = heights[i + 1], d = heights[i + 2];
  return b + .5 * t * ((c - a) + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

function detailVertex(gx, gz) {
  const detail = originalDetailVertex(gx, gz);
  const x = WORLD.minX + gx * cell;
  const z = WORLD.minZ + gz * WORLD.sizeZ / (n - 1);
  const graded = gradeStation(x, z, detail);
  // Use the same shared edge as the low-resolution tile at LOD seams.
  const edge = Math.min(gx % terrainTile, terrainTile - gx % terrainTile,
    gz % terrainTile, terrainTile - gz % terrainTile);
  return edge < 1 ? lerp(triangleHeight(gradedHeights, n, gx, gz), graded, smoothstep(0, 1, edge)) : graded;
}

function originalDetailVertex(gx, gz) {
  const base = triangleHeight(heights, n, gx, gz);
  const distX = gx % terrainTile, distZ = gz % terrainTile;
  const edge = Math.min(distX, terrainTile - distX, distZ, terrainTile - distZ);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  if (edge < 1e-7 || ix < 1 || iz < 1 || ix >= n - 2 || iz >= n - 2) return base;
  const tx = gx - ix, tz = gz - iz, i = iz * n + ix;
  const a = smoothTerrainRow(i - n, tx), b = smoothTerrainRow(i, tx);
  const c = smoothTerrainRow(i + n, tx), d = smoothTerrainRow(i + 2 * n, tx);
  const smooth = b + .5 * tz * ((c - a) + tz * (2 * a - 5 * b + 4 * c - d + tz * (3 * (b - c) + d - a)));
  const h0 = Math.min(heights[i], heights[i + 1], heights[i + n], heights[i + n + 1]);
  const h1 = Math.max(heights[i], heights[i + 1], heights[i + n], heights[i + n + 1]);
  return base + clamp(clamp(smooth, h0, h1) - base, -1.6, 1.6) * smoothstep(0, 2, edge);
}

function makeTerrainDetail(mesh, tileMaterials) {
  const terrain = new THREE.Group();
  terrain.name = 'Resort terrain';
  terrain.add(mesh);
  const tiles = mesh.children;
  const tileCount = (n - 1) / terrainTile;
  const spacingZ = WORLD.sizeZ / (n - 1);
  const verts = terrainTile * detailStep + 1;
  const detailWidth = verts - 1;
  const cache = new Map();
  const builders = new Map();
  const cacheLimit = 14;
  const indices = new Uint16Array(detailWidth * detailWidth * 6);
  let offset = 0;
  for (let j = 0; j < detailWidth; j++) {
    for (let i = 0; i < detailWidth; i++) {
      const a = j * verts + i;
      indices.set([a, a + verts, a + 1, a + 1, a + verts, a + verts + 1], offset);
      offset += 6;
    }
  }

  function* buildTile(ix, iz) {
    const original = tiles[iz * tileCount + ix];
    const values = new Float32Array(verts ** 2);
    const positions = new Float32Array(values.length * 3);
    const normals = new Float32Array(positions.length), colors = new Float32Array(positions.length);
    const color = original.geometry.attributes.color.array;
    const baseNormal = original.geometry.attributes.normal.array;
    const x0 = ix * terrainTile, z0 = iz * terrainTile;
    const coarseWidth = terrainTile + 1;

    const interpolate = (attribute, index, channel, u, v) =>
      lerp(lerp(attribute[index + channel], attribute[index + channel + 3], u),
        lerp(attribute[index + channel + coarseWidth * 3], attribute[index + channel + (coarseWidth + 1) * 3], u), v);

    for (let j = 0; j < verts; j++) {
      const gz = z0 + j / detailStep;
      for (let i = 0; i < verts; i++) {
        const gx = x0 + i / detailStep, k = j * verts + i;
        const y = detailVertex(gx, gz);
        values[k] = y;
        positions[k * 3] = WORLD.minX + gx * cell;
        positions[k * 3 + 1] = y;
        positions[k * 3 + 2] = WORLD.minZ + gz * spacingZ;
      }
      if (j % 8 === 7) yield;
    }

    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) {
        const k = j * verts + i;
        const u = i / detailStep, v = j / detailStep;
        const x = Math.min(terrainTile - 1, Math.floor(u)), z = Math.min(terrainTile - 1, Math.floor(v));
        const p = (z * coarseWidth + x) * 3;
        const mix = smoothstep(0, 4, Math.min(i, j, detailWidth - i, detailWidth - j));
        const dx = (values[k - Math.min(i, 1)] - values[k + Math.min(detailWidth - i, 1)]) * detailStep / (2 * cell);
        const dz = (values[k - Math.min(j, 1) * verts] - values[k + Math.min(detailWidth - j, 1) * verts]) * detailStep / (2 * spacingZ);
        const inv = 1 / Math.hypot(dx, 1, dz);
        normals[k * 3] = lerp(interpolate(baseNormal, p, 0, u - x, v - z), dx * inv, mix);
        normals[k * 3 + 1] = lerp(interpolate(baseNormal, p, 1, u - x, v - z), inv, mix);
        normals[k * 3 + 2] = lerp(interpolate(baseNormal, p, 2, u - x, v - z), dz * inv, mix);
        for (let ch = 0; ch < 3; ch++) colors[k * 3 + ch] = interpolate(color, p, ch, u - x, v - z);
      }
      if (j % 8 === 7) yield;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const detail = new THREE.Mesh(geometry, tileMaterials[iz * tileCount + ix]);
    detail.receiveShadow = true;
    detail.name = 'Detailed snow surface';
    return { values, detail, original };
  }

  function detailAround(centers, deadline) {
    const needed = new Set();
    const ahead = new Set();
    for (const center of centers) {
      const [gx, gz] = worldIndex(center.x, center.z, WORLD);
      const ix = Math.min(tileCount - 1, Math.floor(gx / terrainTile));
      const iz = Math.min(tileCount - 1, Math.floor(gz / terrainTile));
      needed.add(iz * tileCount + ix);
      const edgeX = gx - ix * terrainTile, edgeZ = gz - iz * terrainTile;
      for (const [distance, neighbor, available] of [
        [edgeX, iz * tileCount + ix - 1, ix > 0],
        [terrainTile - edgeX, iz * tileCount + ix + 1, ix < tileCount - 1],
        [edgeZ, (iz - 1) * tileCount + ix, iz > 0],
        [terrainTile - edgeZ, (iz + 1) * tileCount + ix, iz < tileCount - 1],
      ]) {
        if (!available) continue;
        if (distance < 5) needed.add(neighbor);
        else if (distance < 10 && deadline !== Infinity) ahead.add(neighbor);
      }
    }
    const wanted = new Set([...needed, ...ahead]);
    for (const key of builders.keys()) if (!wanted.has(key)) builders.delete(key);
    for (const key of wanted) {
      if (detailTiles.has(key)) continue;
      let tile = cache.get(key);
      if (!tile) {
        if (performance.now() >= deadline) continue;
        let builder = builders.get(key);
        if (!builder) builders.set(key, builder = buildTile(key % tileCount, Math.floor(key / tileCount)));
        let result;
        do result = builder.next(); while (!result.done && performance.now() < deadline);
        if (!result.done) continue;
        builders.delete(key);
        tile = result.value;
      }
      cache.delete(key);
      if (needed.has(key)) {
        tile.detail.material = tileMaterials[key];
        terrain.add(tile.detail);
        tile.original.visible = false;
        detailTiles.set(key, tile);
      } else cache.set(key, tile);
    }
    for (const [key, tile] of detailTiles) {
      if (needed.has(key)) continue;
      terrain.remove(tile.detail);
      tile.original.visible = true;
      tile.detail.material = tileMaterials[key];
      detailTiles.delete(key);
      cache.set(key, tile);
    }
    while (cache.size > cacheLimit) {
      const victim = cache.keys().next().value;
      cache.get(victim).detail.geometry.dispose();
      cache.delete(victim);
    }
  }

  return {
    terrain,
    updateDetail(...centers) { detailAround(centers, Infinity); },
    streamDetail(...centers) { detailAround(centers, performance.now() + 2.2); },
  };
}

function drawOldTracks(origin, span, seed, count, maxLength) {
  // A generated snow-compaction layer, projected onto the actual snow mesh.
  const random = mulberry32(seed);
  const resolution = compactDevice ? 1024 : 2048;
  const { canvas, ctx } = makeCanvas(resolution, resolution);
  const map = new THREE.CanvasTexture(canvas);
  // These three grayscale masks are sampled only in the red channel.
  map.format = THREE.RedFormat;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  const scale = resolution / span;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, resolution, resolution);
  ctx.lineCap = 'round';
  for (let route = 0; route < count; route++) {
    const x = random()*span, z = 8+random()*(span-16);
    const heading = (random()-.5)*1.24 + (route%4 === 0 ? 1.54 : Math.PI);
    const width = .036 + random()*.105;
    const length = 5 + random()**.77*maxLength;
    const swing = (random()-.5)*4;
    const stride = .31+random()*.18;
    for (const edge of [-1, 1]) {
      ctx.beginPath();
      for (let i=0;i<25;i++) {
        const t = i/24;
        const lateral = Math.sin(t*(1.5+route%4)*Math.PI+route)*swing+edge*stride*.5;
        const xx = (x+Math.sin(heading)*t*length+Math.cos(heading)*lateral)*scale;
        const zz = resolution-(z+Math.cos(heading)*t*length-Math.sin(heading)*lateral)*scale;
        if (i===0) ctx.moveTo(xx,zz); else ctx.lineTo(xx,zz);
      }
      ctx.lineWidth = width*scale;
      const bright = Math.round(39+random()*123);
      ctx.strokeStyle = `rgb(${bright},${bright},${bright})`;
      ctx.stroke();
    }
  }
  map.anisotropy = 8;
  return { map, origin, span };
}

function villageFootpaths() {
  const origin=new THREE.Vector2(-157,-656),span=66;
  const resolution = compactDevice ? 768 : 1536;
  const { canvas,ctx }=makeCanvas(resolution,resolution);
  const scale=canvas.width/span,rand=mulberry32(61843);
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  // Intersecting walks through the square and along the photo rail. Each
  // alternating sole compresses two lobes with a shallower scuff between.
  for(const [ax,az,bx,bz,walkers] of [
    [-146,-648,-116,-614,10],[-148,-619,-110,-620,13],[-129,-649,-128,-621,7],
    [-119,-644,-111,-609,7],[-139,-625,-127,-621,6],
  ]){
    const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),nx=dz/len,nz=-dx/len;
    for(let walk=0;walk<walkers;walk++){
      const offset=(rand()-.5)*3.1,phase=rand()*6.28,stride=.50+.20*rand(),sway=.18+.61*rand();
      let step=0;
      for(let s=rand()*2;s<len;s+=stride*(.87+.26*rand()),step++){
        const side=step%2===0?1:-1,t=s/len;
        const bend=offset+sway*Math.sin(phase+t*6.4)+side*.115;
        const x=(ax+t*dx+nx*bend-origin.x)*scale,z=(az+t*dz+nz*bend-origin.y)*scale;
        ctx.save();ctx.translate(x,z);
        ctx.rotate(Math.atan2(-dx,dz)+side*.1+(rand()-.5)*.23);
        const pressure=Math.round(68+rand()*112);
        ctx.scale(scale,scale);ctx.fillStyle=`rgb(${pressure},${pressure},${pressure})`;
        ctx.beginPath();ctx.ellipse(0,-.085,.051,.064,0,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.ellipse(.005,.061,.062,.102,0,0,Math.PI*2);ctx.fill();
        ctx.restore();
      }
    }
  }
  const map=new THREE.CanvasTexture(canvas);
  map.format=THREE.RedFormat;
  map.anisotropy=8;
  return { map,origin,span };
}

function buildTuskPatch(patch, regionHeight) {
  const bounds=blackTuskBounds;
  const n=bounds.grid;
  const dx=(bounds.maxX-bounds.minX)/(n-1), dz=(bounds.maxZ-bounds.minZ)/(n-1);
  const points=new Float32Array(n*n*3), colors=new Float32Array(points.length);
  const values = new Float32Array(n * n);
  const ice=new THREE.Color(0xe3edf3), stone=new THREE.Color(0x535860), color=new THREE.Color();
  for(let j=0;j<n;j++) {
    const z=bounds.minZ+j*dz;
    for(let i=0;i<n;i++){
      const x=bounds.minX+i*dx, k=j*n+i;
      const blend=smoothstep(0,105,Math.min(x-bounds.minX,bounds.maxX-x,z-bounds.minZ,bounds.maxZ-z));
      const xm=Math.max(0,i-1),xp=Math.min(n-1,i+1),zm=Math.max(0,j-1),zp=Math.min(n-1,j+1);
      const grade=Math.hypot((patch.heights[j*n+xp]-patch.heights[j*n+xm])/(dx*2),
        (patch.heights[zp*n+i]-patch.heights[zm*n+i])/(dz*2));
      const rock=smoothstep(.42,1.15,grade*(.87+noise.fbm(x*.018,z*.025,3)*.6));
      const y=lerp(regionHeight(x,z),patch.heights[k],blend);
      values[k] = y;
      color.copy(ice).lerp(stone,rock);
      points.set([x,y,z],k*3);
      colors.set([color.r,color.g,color.b],k*3);
    }
  }
  const peak=makePatches(n,[['position',points,3],['color',colors,3]],surfaceMaterial('mountain',{vertexColors:true}));
  peak.name='The Black Tusk Â· local Copernicus patch';
  const { x,z,elevation }=MOUNTAIN.blackTusk;
  const base=triangleHeight(patch.heights,n,...worldIndex(x,z,bounds))-12;
  // The sub-pixel volcanic neck is modeled up to the published summit elevation.
  const levels=[
    [base,86,88,-8,14],[base+(elevation-base)*.28,52,60,-4,9],
    [base+(elevation-base)*.62,31,39,2,-6],[elevation-8,13,16,3,-1],[elevation,5,8,0,0],
  ];
  const vertices=[], rockColor=[],indices=[], sides=11;
  const rockRng=mulberry32(13034), rockPattern=Array.from({length:sides},()=>.83+rockRng()*.29);
  for(const [i,[y,rx,rz,ox,oz]] of levels.entries()){
    for(let side=0;side<sides;side++){
      const a=side/sides*Math.PI*2, r=rockPattern[side];
      vertices.push(x+ox+Math.sin(a)*rx*r,y-(1-rockRng())*(i===levels.length-1?4:14),z+oz+Math.cos(a)*rz*r);
      color.setHex(side%4===0 ? 0x4c4b4e : 0x3d434c).multiplyScalar(.72+rockRng()*.35);
      rockColor.push(color.r,color.g,color.b);
      if(i<levels.length-1){
        const row=i*sides,out=(i+1)*sides,s2=(side+1)%sides;
        indices.push(row+side,out+side,row+s2,row+s2,out+side,out+s2);
      }
    }
  }
  for(let i=1;i<sides-1;i++)indices.push((levels.length-1)*sides,(levels.length-1)*sides+i,(levels.length-1)*sides+i+1);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(rockColor,3));
  geo.setIndex(indices);geo.computeVertexNormals();
  const tusk=new THREE.Mesh(geo,surfaceMaterial('mountain',{vertexColors:true,side:THREE.DoubleSide}));
  tusk.name='The Black Tusk volcanic neck';
  peak.add(tusk);
  const summitRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  function sample(px, pz, out) {
    const [gx, gz] = worldIndex(px, pz, bounds);
    const y = triangleHeight(values, n, gx, gz);
    if (Math.abs(px - x) < 116 && Math.abs(pz - z) < 124) {
      summitRay.ray.origin.set(px, elevation + 20, pz);
      const summit = summitRay.intersectObject(tusk)[0];
      if (summit && summit.point.y > y) {
        out?.copy(summit.face.normal);
        return summit.point.y;
      }
    }
    if (out) {
      const ix = Math.min(n - 2, Math.floor(gx)), iz = Math.min(n - 2, Math.floor(gz));
      const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
      if (gx - ix + gz - iz <= 1) out.set((values[a] - values[b]) / dx, 1, (values[a] - values[c]) / dz);
      else out.set((values[c] - values[d]) / dx, 1, (values[b] - values[d]) / dz);
      out.normalize();
    }
    return y;
  }
  tuskGround = {
    bounds, cols: n, rows: n,
    xAt: i => bounds.minX + i * dx,
    zAt: j => bounds.minZ + j * dz,
    sample,
    normalAt(x, z, out) {
      sample(x, z, out);
      return out;
    },
  };
  return peak;
}

function buildCoastMountains({ heights, cover }, tusk, local) {
  const bounds = regionBounds;
  const n = bounds.grid, step = (bounds.maxX - bounds.minX) / (n - 1);
  const northSnow = new THREE.Color(0xe0e7ec), stone = new THREE.Color(0x60636a);
  const forest = new THREE.Color(0x23342e), open = new THREE.Color(0xa4b0b1);
  const water = new THREE.Color(0x3b6570), ice = new THREE.Color(0xe0ebef), color = new THREE.Color();
  const at = (x, z) => triangleHeight(heights, n, ...worldIndex(x, z, bounds));
  regionCover = (x, z) => {
    if (!insideTerrain(bounds, x, z)) return 0;
    const [u, v] = worldIndex(x, z, bounds);
    return cover[Math.round(v) * n + Math.round(u)];
  };
  const colorAt = (x, h, z, up) => {
    color.copy(open).lerp(northSnow, smoothstep(940, 1700, h));
    color.lerp(stone, smoothstep(.13, .51, 1 - up) * .83);
    const kind = regionCover(x, z);
    if (kind === 10) color.lerp(forest, .87);
    if (kind === 70) color.lerp(ice, .85);
    if (kind === 80) color.copy(water);
    return color;
  };
  const material = surfaceMaterial('mountain', { vertexColors: true, roughness: .98 });
  const peak = buildTuskPatch(tusk, at);
  const survey = createSurveyTerrain({
    regional: { bounds, cols: n, rows: n, xAt: i => bounds.minX + i * step,
      zAt: j => bounds.minZ + j * step, sample: at },
    insets: [local, tuskGround], material, colorAt, name: 'Coast Mountains · Copernicus DEM',
  });
  backcountry = createBackcountry({ survey, material, colorAt, seed: 2728,
    compact: compactDevice, viewDistance: 39000 });
  const surrounding = survey.group;
  const surveyTiles = surrounding.children.slice();
  surrounding.add(peak);
  const random = mulberry32(2728);
  const groves = [];
  for (let j = 1; j < n - 1; j += 2) {
    const z = bounds.minZ + j * step;
    for (let i = 1; i < n - 1; i += 2) {
      const x = bounds.minX + i * step;
      const elevation = heights[j * n + i];
      if (Math.hypot(x, z - 2700) > 15500 || cover[j * n + i] !== 10 || elevation > 1920) continue;
      if (x > WORLD.minX - 75 && x < WORLD.maxX + 75 && z > WORLD.minZ - 75 && z < WORLD.maxZ + 75) continue;
      // The west-side subalpine stands are the foreground of the valley
      // panorama. Keep their mapped forest mask, but resolve individual
      // crowns rather than leaving widely spaced trees over bare terrain.
      const westSubalpine = (x < WORLD.minX || z < WORLD.minZ) && z < -1700
        && Math.hypot(x + 4300, z + 3400) < 3200
        && elevation > 1250;
      for (let t = 0; t < (westSubalpine ? 90 : 18); t++) {
        const tx = x + (random() - .5) * step * 1.7, tz = z + (random() - .5) * step * 1.7;
        const [u, v] = worldIndex(tx, tz, bounds);
        if (cover[Math.round(v) * n + Math.round(u)] !== 10) continue;
        if (tx > WORLD.minX && tx < WORLD.maxX && tz > WORLD.minZ && tz < WORLD.maxZ) continue;
        const altitude = heightAt(tx, tz);
        const size=altitude>1690?15+random()*15:24+random()**.65*25;
        groves.push([tx, altitude, tz, size, random() * 6.28]);
      }
    }
  }
  // Regional stands use their own spatial bounds. One giant instance batch
  // forced every distant tree through the GPU even while looking uphill.
  const groveCells = new Map(), groveCellSize = 600;
  for (const grove of groves) {
    const key = `${Math.floor(grove[0] / groveCellSize)},${Math.floor(grove[2] / groveCellSize)}`;
    if (!groveCells.has(key)) groveCells.set(key, []);
    groveCells.get(key).push(grove);
  }
  const regionalNear = coniferGeometry('hemlock', -1);
  const regionalFar = coniferGeometry('hemlock', -2);
  const regionalMaterial = coniferMaterial(-1, 'regional');
  const regionalFarMaterial = coniferMaterial(-2, 'regional');
  const tree = new THREE.Object3D();
  for (const groves of groveCells.values()) {
    const center = new THREE.Vector3();
    for (const [x, y, z] of groves) center.add(new THREE.Vector3(x, y + 12, z));
    center.multiplyScalar(1 / groves.length);
    const near = new THREE.InstancedMesh(regionalNear, regionalMaterial, groves.length);
    const proxy = makeForestCrowns('regional',groves.map(() => 2));
    const instances = proxy ?? new THREE.InstancedMesh(regionalFar, regionalFarMaterial, groves.length);
    for (const [index, [x, y, z, size, yaw]] of groves.entries()) {
      tree.position.set(x - center.x, y - center.y - .3, z - center.z);
      tree.scale.set(size * 1.12, size, size * 1.12);
      tree.rotation.set(0, yaw, 0);
      tree.updateMatrix();
      near.setMatrixAt(index, tree.matrix);
      instances.setMatrixAt(index, tree.matrix);
    }
    const far = proxy ? shareForestInstances(proxy, regionalFar, regionalFarMaterial) : instances;
    near.computeBoundingSphere(); far.computeBoundingSphere();
    proxy?.computeBoundingSphere();
    const radius = near.boundingSphere.radius + near.boundingSphere.center.length();
    surrounding.add(new ForestCell('regional',center,radius,near,far,proxy));
  }
  batchBudgetForestCrowns(surrounding, 'regional', 2400);
  cacheStaticTransforms(surrounding);
  surrounding.add(backcountry.group, backcountry.horizon);
  return { surrounding, surveyTiles };
}

export function buildMask(res = 1024) {
  const { canvas, ctx } = makeCanvas(res, res);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, res, res);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sx = res / WORLD.sizeX;
  const sz = res / WORLD.sizeZ;
  for (const run of RUNS) {
    ctx.beginPath();
    const pts = run.samples;
    ctx.strokeStyle = run.gladed ? '#568' : '#fff';
    ctx.lineWidth = Math.max(1, run.width * ((sx + sz) * 0.5));
    for (let i = 0; i < pts.length; i++) {
      const px = (pts[i].x - WORLD.minX) * sx;
      const py = (pts[i].z - WORLD.minZ) * sz;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  const img = ctx.getImageData(0, 0, res, res).data;
  const m = new Float32Array(res * res);
  for (let i = 0; i < m.length; i++) m[i] = img[i * 4] / 255;

  return { mask: boxBlurGrid(m, res, 1, 2), res };
}

function sampleMask(x, z) {
  const res = maskN;
  const fx = clamp((x - WORLD.minX) / WORLD.sizeX * (res - 1), 0, res - 1.001);
  const fz = clamp((z - WORLD.minZ) / WORLD.sizeZ * (res - 1), 0, res - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const i0 = iz * res + ix;
  const a = mask[i0], b = mask[i0 + 1], c = mask[i0 + res], d = mask[i0 + res + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

export async function buildTerrain(onProgress = () => {}, yieldFrame = () => Promise.resolve(), { quality = 'BALANCED' } = {}) {
  initWorldData();
  onProgress(0.08, 'Sounding the snowpack…');
  await yieldFrame();

  const N = WORLD.grid;
  const [local, region, tusk] = await Promise.all([
    loadGrid('resort.bin', WORLD), loadGrid('ranges.bin', regionBounds), loadGrid('black-tusk.bin', blackTuskBounds),
    preloadForestCrowns(),
  ]);
  const packCache = whistlerSnowPackCacheMode(new URL('../data/resort.bin', import.meta.url).href);
  const packDownload = packCache ? new AbortController() : null;
  let pack = null;
  if (packDownload) loadWhistlerSnowPack(packDownload.signal, packCache).then(result => { pack = result; });
  n = N;
  vertexKeys.fill(0);
  heights = local.heights;
  landCover = local.cover;
  prepareValleyLakes(heights, landCover, WORLD);
  const snowInputs = { heights, cover: landCover, bounds: WORLD, runs: RUNS };
  cell = WORLD.sizeX / (N - 1);
  const dz = WORLD.sizeZ / (N - 1);
  const stationGrading = createStationGrading((x, z) => originalDetailVertex(...worldIndex(x, z, WORLD)));
  gradeStation = (x, z, y) => gradeGlacierCave(x, z, stationGrading(x, z, y));
  gradedHeights = new Float32Array(heights.length);
  for (let j = 0; j < N; j++) {
    if (j && j % 16 === 0) await yieldFrame();
    for (let i = 0; i < N; i++) {
      const index = j * N + i;
      gradedHeights[index] = gradeStation(WORLD.minX + i * cell, WORLD.minZ + j * dz, heights[index]);
    }
  }

  onProgress(0.2, 'Tracing mapped ski runs…');
  await yieldFrame();
  // The download must finish while the required terrain is being prepared. A
  // slower transfer never holds up the generator or the remaining startup work.
  packDownload?.abort();
  maskN = 1536;
  mask = buildMask(maskN).mask;
  const inputs = { ...snowInputs, mask };
  const precomputed = pack && await unpackWhistlerSnowPack(pack, inputs);
  pack = null;
  const snowGeneration = precomputed ?? startSnowGeneration(inputs, yieldFrame);

  // Build mesh.
  const vcount = N * N;
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const colors = new Float32Array(vcount * 3);
  const dx = cell;

  const snow = new THREE.Color().setRGB(0.955, 0.972, 0.995, THREE.SRGBColorSpace);
  const snowPiste = new THREE.Color().setRGB(0.995, 0.998, 1.0, THREE.SRGBColorSpace);
  const snowShade = new THREE.Color().setRGB(0.84, 0.895, 0.95, THREE.SRGBColorSpace);
  const snowWind = new THREE.Color().setRGB(0.83, 0.895, 0.945, THREE.SRGBColorSpace);
  const col = new THREE.Color();
  const blurred = boxBlurGrid(gradedHeights.slice(), n, 3, 1);
  const winterShore = new THREE.Color(0x95aeba);
  const waterEdge = boxBlurGrid(Float32Array.from(landCover, kind => Number(kind === 80)), n, 1, 2);

  onProgress(0.5, 'Shading the alpine…');
  await yieldFrame();

  for (let j = 0; j < N; j++) {
    if (j && j % 16 === 0) await yieldFrame();
    const z = WORLD.minZ + j * dz;
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = WORLD.minX + i * cell;
      const h = gradedHeights[k];
      const hL = gradedHeights[j * N + Math.max(0, i - 1)];
      const hR = gradedHeights[j * N + Math.min(N - 1, i + 1)];
      const hD = gradedHeights[Math.max(0, j - 1) * N + i];
      const hU = gradedHeights[Math.min(N - 1, j + 1) * N + i];
      let nx = (hL - hR) / (2 * dx);
      let nz = (hD - hU) / (2 * dz);
      const nl = Math.hypot(nx, 1, nz);
      nx /= nl; nz /= nl;
      const ny = 1 / nl;
      positions[k * 3] = x;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = z;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;

      const slope = 1 - ny;
      const p = sampleMask(x, z);
      const nBig = noise2.fbm(x * 0.0042 + 2.1, z * 0.0042 - 1.4, 3);
      const nMid = noise.fbm(x * 0.017, z * 0.017, 2);
      const nFine = noise2.fbm(x * 0.06, z * 0.06, 2);

      col.copy(snow);
      // groomed corridor
      col.lerp(snowPiste, clamp(p * 1.45, 0, 1) * 0.9);
      // off-piste blue shadow / age
      col.lerp(snowShade, (1 - p) * (0.28 + 0.2 * nBig) * 0.5);
      // wind-scoured grey-blue alpine
      const wind = smoothstep(1770, 2200, h) * smoothstep(0.15, 0.7, nBig) * 0.4;
      col.lerp(snowWind, wind);
      // faint forest dapple
      const treePossible = smoothstep(700, 1000, h) * (1 - smoothstep(1680, 1880, h)) * (1 - smoothstep(0.38, 0.62, slope));
      const forest = treePossible * smoothstep(0.0, 0.5, nBig + nMid * 0.4) * (1 - p);
      col.lerp(snowShade, forest * 0.18);
      const cover = landCover[k];
      // Land-cover class 10 describes canopy seen from a distance, not the
      // uncovered snow beneath a skier. The snow shader adds distant canopy.
      if (cover === 50) col.multiplyScalar(0.86 + 0.14 * p);
      // concave shading / ambient depth
      const conc = clamp((blurred[k] - h) * 0.009, -0.05, 0.12);
      col.multiplyScalar(1 - conc * 0.85);
      // very subtle large-scale tonal drift
      col.offsetHSL(0, 0, nFine * 0.014);
      // Valley water is drawn by the exact lake outlines. Any high-elevation
      // water pixels grade into a pale frozen shoreline over the DEM.
      if (waterEdge[k] > .01) col.lerp(winterShore, waterEdge[k] * .60);

      colors[k * 3] = col.r;
      colors[k * 3 + 1] = col.g;
      colors[k * 3 + 2] = col.b;
    }
  }

  onProgress(0.66, 'Grooming corduroy…');
  await yieldFrame();

  const generatedSnow = await snowGeneration;
  snowField = generatedSnow.snowField;
  const pisteMap = new THREE.DataTexture(snowField, maskN, maskN, THREE.RGBAFormat);
  pisteMap.minFilter = pisteMap.magFilter = THREE.LinearFilter;
  pisteMap.needsUpdate = true;
  const tracks = {
    plaza: drawOldTracks(new THREE.Vector2(430,4812),96,1834,840,31),
    bowl: drawOldTracks(new THREE.Vector2(-24,4995),230,6529,625,81),
    village: villageFootpaths(),
  };
  const roomCutout = new THREE.Vector4(), annexCutout = new THREE.Vector4(), roomYaw = new THREE.Vector2(1, 0);
  const mountainShade = new THREE.DataTexture(generatedSnow.shade, 385, 385, THREE.RedFormat);
  const groomingMap = new THREE.DataTexture(generatedSnow.grooming, maskN, maskN, THREE.RedFormat, THREE.HalfFloatType);
  for (const map of [mountainShade, groomingMap]) {
    map.minFilter = map.magFilter = THREE.LinearFilter;
    map.needsUpdate = true;
  }
  const horizon = terrainHorizon(gradedHeights, N, N, WORLD);
  const snowMaps = { pisteMap, tracks, roomCutout, annexCutout, roomYaw, mountainShade, groomingMap, horizon };
  const mat = surfaceMaterial('snow', { vertexColors: true }, snowMaps);
  const openSnow = surfaceMaterial('snow', { vertexColors: true }, { ...snowMaps, interiorCutout: false });
  const baseDetail = createTerrainTileDetail(quality);
  const mesh = makePatches(N, [
    ['position', positions, 3], ['normal', normals, 3], ['color', colors, 3],
  ], openSnow, terrainTile, baseDetail);
  const tileMaterials = mesh.children.map(() => openSnow);
  detailTiles = new Map();
  const detail = makeTerrainDetail(mesh, tileMaterials);
  const occlusion = createTerrainOcclusion({ positions, size: N, tileSize: terrainTile });
  const tileCount = (N - 1) / terrainTile;
  const preciseWidth = terrainTile * detailStep + 1;
  const roomOpenings = [], skiOpenings = [], openings = [], hidden = [];
  const regionalTiles = [];
  const skiBoxes = [{}, {}];
  const worldBox = new THREE.Box3(), view = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
  function clearOfViewEdges(box) {
    // Very distant clipped polygons can differ at the viewport border even
    // when their surveyed bounds are behind a ridge. Leave those tiles alone.
    for (let i = 0; i < 4; i++) {
      const { normal, constant } = view.planes[i];
      const x = normal.x >= 0 ? box.min.x : box.max.x;
      const y = normal.y >= 0 ? box.min.y : box.max.y;
      const z = normal.z >= 0 ? box.min.z : box.max.z;
      if (normal.x * x + normal.y * y + normal.z * z + constant <= 0) return false;
    }
    return true;
  }
  // Bound the actual detailed mesh around the eye. A camera looking from
  // under the snow or from a clipped near plane cannot use it as a blocker.
  function visualCeiling(minX, maxX, minZ, maxZ) {
    if (minX <= WORLD.minX || maxX >= WORLD.maxX || minZ <= WORLD.minZ || maxZ >= WORLD.maxZ) return Infinity;
    const u0 = (minX - WORLD.minX) / cell, u1 = (maxX - WORLD.minX) / cell;
    const v0 = (minZ - WORLD.minZ) / dz, v1 = (maxZ - WORLD.minZ) / dz;
    let highest = -Infinity;
    for (let iz = Math.floor(v0 / terrainTile); iz <= Math.floor(v1 / terrainTile); iz++) {
      const z0 = Math.max(0, Math.floor((v0 - iz * terrainTile) * detailStep));
      const z1 = Math.min(preciseWidth - 1, Math.ceil((v1 - iz * terrainTile) * detailStep));
      for (let ix = Math.floor(u0 / terrainTile); ix <= Math.floor(u1 / terrainTile); ix++) {
        const live = detailTiles.get(iz * tileCount + ix);
        if (!live?.detail.visible) return Infinity;
        const x0 = Math.max(0, Math.floor((u0 - ix * terrainTile) * detailStep));
        const x1 = Math.min(preciseWidth - 1, Math.ceil((u1 - ix * terrainTile) * detailStep));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          highest = Math.max(highest, live.values[z * preciseWidth + x]);
        }
      }
    }
    return highest;
  }

  function restoreOccludedTiles() {
    for (const tile of hidden) tile.visible = true;
    hidden.length = 0;
  }
  terrain.restoreOccludedTiles = restoreOccludedTiles;
  terrain.hideOccludedTiles = (camera, includeSurvey = true) => {
    restoreOccludedTiles();
    if (!camera.isPerspectiveCamera || camera.parent || camera.view?.enabled || camera.filmOffset) return 0;
    const eye = camera.position;
    const projection = camera.projectionMatrix.elements;
    // Every point on the near plane is within this radius of the camera.
    const radius = camera.near * Math.hypot(1, 1 / projection[0], 1 / projection[5]) + .06;
    const ceiling = visualCeiling(eye.x - radius, eye.x + radius, eye.z - radius, eye.z + radius);
    if (!(eye.y - radius > ceiling)) return 0;
    openings.length = 0;
    openings.push(...roomOpenings, ...skiOpenings);
    camera.updateMatrixWorld();
    view.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
    for (let i = 0; i < occlusion.tiles.length; i++) {
      const original = mesh.children[i];
      if (!original.visible || original.castShadow) continue;
      const tile = occlusion.tiles[i];
      worldBox.min.set(tile.minX, tile.minY, tile.minZ);
      worldBox.max.set(tile.maxX, tile.maxY, tile.maxZ);
      if (view.intersectsBox(worldBox) && occlusion.blocked(tile, eye, openings)) {
        original.visible = false;
        hidden.push(original);
      }
    }
    // Only query the fixed survey meshes when a local ridge already blocks
    // the view. Streamed terrain and regional forest are separate objects.
    if (includeSurvey && hidden.length) {
      for (const { mesh, box, bounds } of regionalTiles) {
        if (!mesh.visible || mesh.castShadow || !view.intersectsBox(box)) continue;
        if (occlusion.blocked(bounds, eye, openings) && clearOfViewEdges(box)) {
          mesh.visible = false;
          hidden.push(mesh);
        }
      }
    }
    return hidden.length;
  };
  const nearDetail = ({ x, z }) =>
    x >= WORLD.minX - 100 && x <= WORLD.maxX + 100 && z >= WORLD.minZ - 100 && z <= WORLD.maxZ + 100;
  // Sample the rendered triangles' attributes, including their smooth detailed
  // normals. Recessed snow uses the same material and joins this surface exactly.
  const sampleSurface = (x, z, color, normal) => {
    if (!insideTerrain(WORLD, x, z)) {
      color.setRGB(.831, .890, .956);
      return heightAt(x, z, normal);
    }
    const gx = clamp((x - WORLD.minX) / WORLD.sizeX, 0, 1) * (N - 1);
    const gz = clamp((z - WORLD.minZ) / WORLD.sizeZ, 0, 1) * (N - 1);
    const ix = Math.min(tileCount - 1, Math.floor(gx / terrainTile));
    const iz = Math.min(tileCount - 1, Math.floor(gz / terrainTile));
    const tile = detailTiles.get(iz * tileCount + ix);
    const width = tile ? terrainTile * detailStep + 1 : N;
    const u = tile ? (gx - ix * terrainTile) * detailStep : gx;
    const v = tile ? (gz - iz * terrainTile) * detailStep : gz;
    const i = Math.min(width - 2, Math.floor(u)), j = Math.min(width - 2, Math.floor(v));
    const tx = u - i, tz = v - j, index = j * width + i;
    const first = tx + tz <= 1;
    const a = first ? index : index + width + 1;
    const b = index + 1, c = index + width;
    const wa = first ? 1 - tx - tz : tx + tz - 1;
    const wb = first ? tx : 1 - tz, wc = first ? tz : 1 - tx;
    const colorData = tile ? tile.detail.geometry.attributes.color.array : colors;
    const normalData = tile ? tile.detail.geometry.attributes.normal.array : normals;
    color.setRGB(
      colorData[a * 3] * wa + colorData[b * 3] * wb + colorData[c * 3] * wc,
      colorData[a * 3 + 1] * wa + colorData[b * 3 + 1] * wb + colorData[c * 3 + 1] * wc,
      colorData[a * 3 + 2] * wa + colorData[b * 3 + 2] * wb + colorData[c * 3 + 2] * wc,
    );
    normal.set(
      normalData[a * 3] * wa + normalData[b * 3] * wb + normalData[c * 3] * wc,
      normalData[a * 3 + 1] * wa + normalData[b * 3 + 1] * wb + normalData[c * 3 + 1] * wc,
      normalData[a * 3 + 2] * wa + normalData[b * 3 + 2] * wb + normalData[c * 3 + 2] * wc,
    ).normalize();
    const values = tile ? tile.values : gradedHeights;
    return values[a] * wa + values[b] * wb + values[c] * wc;
  };
  const cutoutMeshes = new Map();
  const skiSnow = createSkiSnowSurface({
    snowMaps, heightAt, surfaceAt, sampleSurface,
    setCutout(skis, cutoutMaterial) {
      for (const [mesh, key] of cutoutMeshes) mesh.material = tileMaterials[key];
      cutoutMeshes.clear();
      skiOpenings.length = 0;
      for (const ski of skis) {
        if (!ski.active) continue;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let end = 0; end < 2; end++) {
          const s = end ? SKI_SNOW_FOOTPRINT.front : SKI_SNOW_FOOTPRINT.back;
          for (let edge = -1; edge <= 1; edge += 2) {
            const t = edge * SKI_SNOW_FOOTPRINT.halfWidth;
            const x = ski.contact.x + ski.axis.x * s + ski.rightX * t;
            const z = ski.contact.z + ski.axis.z * s + ski.rightZ * t;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
          }
        }
        const hole = skiBoxes[skiOpenings.length];
        hole.minX = minX - .1; hole.maxX = maxX + .1;
        hole.minZ = minZ - .1; hole.maxZ = maxZ + .1;
        hole.maxY = visualCeiling(hole.minX, hole.maxX, hole.minZ, hole.maxZ);
        skiOpenings.push(hole);
        const x0 = clamp(Math.floor((minX - WORLD.minX) / cell / terrainTile), 0, tileCount - 1);
        const x1 = clamp(Math.floor((maxX - WORLD.minX) / cell / terrainTile), 0, tileCount - 1);
        const z0 = clamp(Math.floor((minZ - WORLD.minZ) / dz / terrainTile), 0, tileCount - 1);
        const z1 = clamp(Math.floor((maxZ - WORLD.minZ) / dz / terrainTile), 0, tileCount - 1);
        for (let iz = z0; iz <= z1; iz++) {
          for (let ix = x0; ix <= x1; ix++) {
            const key = iz * tileCount + ix;
            const original = mesh.children[key], local = detailTiles.get(key)?.detail;
            original.material = cutoutMaterial;
            cutoutMeshes.set(original, key);
            if (local) {
              local.material = cutoutMaterial;
              cutoutMeshes.set(local, key);
            }
          }
        }
      }
    },
  });
  detail.terrain.add(skiSnow.group);
  const localInset = {
    bounds: WORLD, cols: N, rows: N,
    xAt: i => WORLD.minX + i * cell,
    zAt: j => WORLD.minZ + j * dz,
    sample: (x, z) => triangleHeight(gradedHeights, N, ...worldIndex(x, z, WORLD)),
    normalAt(x, z, out) { sampleSurface(x, z, col, out); return out; },
  };
  const { surrounding, surveyTiles } = buildCoastMountains(region, tusk, localInset);
  terrain.ranges = surrounding;
  for (const surveyTile of surveyTiles) {
    surveyTile.geometry.computeBoundingBox();
    const box = surveyTile.geometry.boundingBox.clone().applyMatrix4(surveyTile.matrixWorld);
    const bounds = { minX: box.min.x, minY: box.min.y, minZ: box.min.z,
      maxX: box.max.x, maxY: box.max.y, maxZ: box.max.z };
    regionalTiles.push({ mesh: surveyTile, box, bounds });
  }

  terrain.mesh = detail.terrain;
  terrain.setQuality = baseDetail.setQuality;
  terrain.updateDetail = (...centers) => {
    baseDetail.update(...centers);
    detail.updateDetail(...centers.filter(nearDetail));
    backcountry.stream(...centers);
  };
  terrain.streamDetail = (...centers) => {
    baseDetail.update(...centers);
    detail.streamDetail(...centers.filter(nearDetail));
    backcountry.stream(...centers);
  };
  terrain.updateSkiSnow = (player, visible) => skiSnow.update(player,
    visible && insideTerrain(WORLD, player.pos.x, player.pos.z));
  terrain.skiSnowDepthAt = skiSnow.depthAt;
  terrain.sampleSnowSurface = sampleSurface;
  terrain.snowMaterial = mat;
  terrain.mountainShade = mountainShade;
  terrain.setInteriorCutout = (room) => {
    if (!room) return;
    roomCutout.set(room.x, room.z, room.w / 2 - .07, room.d / 2 - .07);
    roomYaw.set(Math.cos(room.yaw), Math.sin(room.yaw));
    const dx = LODGE_FRAME.x - room.x, dz = LODGE_FRAME.z - room.z;
    annexCutout.set(LODGE_ANNEX.x + dx * roomYaw.x - dz * roomYaw.y,
      LODGE_ANNEX.z + dx * roomYaw.y + dz * roomYaw.x,
      LODGE_ANNEX.width / 2 - .06, LODGE_ANNEX.depth / 2 - .06);
    const reserve = (x, z, halfWidth, halfDepth) => {
      const width = Math.abs(roomYaw.x) * halfWidth + Math.abs(roomYaw.y) * halfDepth + .1;
      const depth = Math.abs(roomYaw.y) * halfWidth + Math.abs(roomYaw.x) * halfDepth + .1;
      return { minX: x - width, maxX: x + width, minZ: z - depth, maxZ: z + depth, maxY: Infinity };
    };
    roomOpenings.length = 0;
    roomOpenings.push(reserve(room.x, room.z, roomCutout.z, roomCutout.w),
      reserve(room.x + annexCutout.x * roomYaw.x + annexCutout.y * roomYaw.y,
        room.z - annexCutout.x * roomYaw.y + annexCutout.y * roomYaw.x, annexCutout.z, annexCutout.w));
    // Only tiles touching the lodge need the fragment discard for its floor.
    // This circle encloses both rotated rectangles, including the offset annex.
    const reach = Math.max(Math.hypot(roomCutout.z, roomCutout.w),
      Math.hypot(annexCutout.x, annexCutout.y) + Math.hypot(annexCutout.z, annexCutout.w));
    const columns = (N - 1) / terrainTile;
    const width = WORLD.sizeX / columns, depth = WORLD.sizeZ / columns;
    for (let i = 0; i < tileMaterials.length; i++) {
      const x = WORLD.minX + (i % columns) * width, z = WORLD.minZ + Math.floor(i / columns) * depth;
      const overlaps = room.x + reach >= x && room.x - reach <= x + width &&
        room.z + reach >= z && room.z - reach <= z + depth;
      tileMaterials[i] = overlaps ? mat : openSnow;
      const original = mesh.children[i], local = detailTiles.get(i)?.detail;
      if (!cutoutMeshes.has(original)) original.material = tileMaterials[i];
      if (local && !cutoutMeshes.has(local)) local.material = tileMaterials[i];
    }
  };
  terrain.heights = gradedHeights;
  terrain.n = N;
  terrain.cell = cell;
  terrain.mask = mask;
  terrain.maskN = maskN;
  terrain.snowGeneration = generatedSnow.execution;

  onProgress(0.78, 'Snow is falling…');
  await yieldFrame();
  return terrain;
}

/* â”€â”€ sampling API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function heightAt(x, z, normal) {
  if (!heights) return 0;
  if (backcountry && !insideTerrain(WORLD, x, z)) {
    if (insideTerrain(blackTuskBounds, x, z)) return tuskGround.sample(x, z, normal);
    return backcountry.sample(x, z, normal);
  }
  const [gx, gz] = worldIndex(x, z, WORLD);
  const tileCount = (n - 1) / terrainTile;
  const ix = Math.min(tileCount - 1, Math.floor(gx / terrainTile));
  const iz = Math.min(tileCount - 1, Math.floor(gz / terrainTile));
  const tile = detailTiles.get(iz * tileCount + ix);
  const u = gx * detailStep, v = gz * detailStep;
  if (tile) {
    return triangleHeight(tile.values, terrainTile * detailStep + 1,
      u - ix * terrainTile * detailStep, v - iz * terrainTile * detailStep);
  }
  // Physics can sample the next tile before it becomes visible.
  const a = Math.min((n - 1) * detailStep - 1, Math.floor(u));
  const b = Math.min((n - 1) * detailStep - 1, Math.floor(v));
  const tx = u - a, tz = v - b;
  const h10 = fineGridHeight(a + 1, b);
  const h01 = fineGridHeight(a, b + 1);
  return tx + tz <= 1
    ? fineGridHeight(a, b) * (1 - tx - tz) + h10 * tx + h01 * tz
    : fineGridHeight(a + 1, b + 1) * (tx + tz - 1) + h10 * (1 - tz) + h01 * (1 - tx);
}

// Root trees against both surfaces when the detailed tile is streamed in.
// The lower portion of each trunk is buried on the higher of the two terrains.
export function treeAnchorHeightAt(x, z, detailedHeight = heightAt(x, z)) {
  if (!insideTerrain(WORLD, x, z)) return detailedHeight;
  const [gx, gz] = worldIndex(x, z, WORLD);
  return Math.max(detailedHeight, triangleHeight(gradedHeights, n, gx, gz));
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  if (backcountry && !insideTerrain(WORLD, x, z)) {
    heightAt(x, z, out);
    return out;
  }
  const e = 2.5;
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  out.set(hL - hR, 2 * e, hD - hU).normalize();
  return out;
}

export function slopeAt(x, z) {
  const nrm = normalAt(x, z, _tmpN);
  return 1 - nrm.y;
}

const _tmpN = new THREE.Vector3();

export function pisteAt(x, z) {
  if (!mask || !insideTerrain(WORLD, x, z)) return 0;
  return sampleMask(x, z);
}

export function isGroomed(x, z) {
  return pisteAt(x, z) > 0.34;
}

export function treeExclusion(x, z) {
  const p = pisteAt(x, z);
  return p;
}
