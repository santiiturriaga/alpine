import * as THREE from 'three';
import { buildingData } from '../data/osm-whistler.js';
import { heightAt } from './terrain.js';
import { box, beam, part, cacheStaticTransforms, mergeParts } from './scenery.js';
import { mulberry32, makeCanvas, canvasTexture, makeRadialTexture } from './util.js';
import { climateUniforms } from './climate-state.js';
import { createRoofSnow, createIcicles } from './roof-weather.js';
import { coniferGeometry, coniferMaterial } from './conifers.js';
import { detailedMaterial } from './plaza-materials.js';

// Main hotel, the connected meeting wing and its narrow north connector.
// The cached OSM commercial property 295166836 identifies the unnamed hotel
// footprint 50903854. Its long room wing bears NE/SW, overlooking Blackcomb
// to the southeast. Heights and roof articulation are photo interpretations.
// https://www.openstreetmap.org/way/50903854
// https://www.fairmont.com/en/hotels/whistler/fairmont-chateau-whistler.html
export const FAIRMONT_REPLACED_IDS = new Set(['50903854', '173950357', '173950343']);
const ORIGIN = { x: 523, z: -434, yaw: .79 };
export const FAIRMONT_START = { x: 505, z: -350, heading: 3.12, holdAtUnload: true };
export const FAIRMONT_VIEW = { eye: [505, 691.3, -350], target: [486, 708, -420], fov: 84 };

const C = {
  plaster: '#d8c8a8', sunny: '#e4d6b8', shadow: '#c9bca4', trim: '#ecdfc4',
  recess: '#2d3839', copper: '#244d4d', rib: '#3a6964', fascia: '#3b5351',
  stone: '#8b8170', bronze: '#3a3d34', glass: '#3c5d68', snow: '#e7eef3',
};

// NRCan BC-Squamish 2016 DSM/DTM, 1 m samples: peak 734.75 m at
// local (-21.73,-3.27), median building-lot ground 685.15 m. Broad room-wing
// roofs are 24–30 m high; the contiguous central crown is about 50 m high.
function surveyedY(x,y,z){
  if(y<=27)return y;
  const tower=x>-32&&x<1&&z>-23&&z<28;
  return 27+(y-27)*(tower?.65:.35);
}
function surveyGeometry(g){
  for(const key of ['position','meltAnchor']){
    const p=g.attributes[key];if(!p)continue;
    for(let i=0;i<p.count;i++)p.setY(i,surveyedY(p.getX(i),p.getY(i),p.getZ(i)));
    p.needsUpdate=true;
  }
  g.computeVertexNormals();g.computeBoundingSphere();return g;
}

function localPoint(x, y, z, yaw = 0, offset = [0, 0, 0]) {
  return [offset[0] + x * Math.cos(yaw) + z * Math.sin(yaw), offset[1] + y,
    offset[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
}
function worldPoint(x, z) {
  const [wx, , wz] = localPoint(x, 0, z, ORIGIN.yaw, [ORIGIN.x, 0, ORIGIN.z]);
  return [wx, wz];
}
function polygon(points, bottom, height) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, bottom, 0);
  return geo;
}
function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.computeVertexNormals(); return g;
}
function triangle(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals(); return g;
}
function joinWeather(meshes, name) {
  if (!meshes.length) return null;
  const arrays = {}, itemSizes = {};
  for (const mesh of meshes) {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    for (const [key, attr] of Object.entries(g.attributes)) {
      (arrays[key] ||= []).push(attr.array); itemSizes[key] = attr.itemSize;
    }
    if (g !== mesh.geometry) g.dispose();
    mesh.geometry.dispose();
  }
  const g = new THREE.BufferGeometry();
  for (const [key, chunks] of Object.entries(arrays)) {
    const data = new Float32Array(chunks.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
    g.setAttribute(key, new THREE.BufferAttribute(data, itemSizes[key]));
  }
  surveyGeometry(g);
  const mesh = new THREE.Mesh(g, meshes[0].material);
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true;
  mesh.customDepthMaterial = meshes[0].customDepthMaterial;
  return mesh;
}

/** Hand-built, walk-scale Chateau; every room opening and roof is geometry. */
export function buildFairmont(scene, { grid } = {}) {
  const root = new THREE.Group(); root.name = 'Fairmont Chateau Whistler · slope facade';
  const ground = 685.20;
  root.position.set(ORIGIN.x, ground, ORIGIN.z); root.rotation.y = ORIGIN.yaw;
  scene.add(root);
  const masonry = [], trim = [], roofs = [], metal = [], dark = [], glass = [],
    rooms = [], curtains = [], stone = [], timber = [], bulbs = [], snow = [], ice = [];
  const lights = [], glows = [], warmMaterials = [];
  const rand = mulberry32(1989509); let roofSeed = 9381, roomCount = 0;
  const buckets={masonry,trim,roofs,metal,dark,glass,rooms,curtains,stone,timber,bulbs};
  const snapshot=()=>({...Object.fromEntries(Object.entries(buckets).map(([key,a])=>[key,a.length])),snow:snow.length,ice:ice.length});
  function moveSince(start,dx,dz){
    for(const [key,a] of Object.entries(buckets))for(const p of a.slice(start[key])){p.pos[0]+=dx;p.pos[2]+=dz;}
    for(const key of ['snow','ice'])for(const mesh of (key==='snow'?snow:ice).slice(start[key])){
      mesh.geometry.translate(dx,0,dz);
      const a=mesh.geometry.attributes.meltAnchor;
      if(a)for(let i=0;i<a.count;i++)a.setXYZ(i,a.getX(i)+dx,a.getY(i),a.getZ(i)+dz);
    }
  }

  const putBox = (bucket, w, h, d, color, x, y, z, yaw = 0) => bucket.push(box(w, h, d, color, [x, y, z], [0, yaw, 0]));
  const piece = (bucket, geo, color, position = [0, 0, 0], yaw = 0) => bucket.push(part(geo, color, position, [0, yaw, 0]));
  const transformedBox = (bucket, w, h, d, color, x, y, z, yaw, offset) => {
    const p = localPoint(x, y, z, yaw, offset); putBox(bucket, w, h, d, color, ...p, yaw);
  };
  const roofFace = (corners, color = C.copper, depth = .23, steep = false) => {
    piece(roofs, quad(...corners), color);
    if (!steep) snow.push(createRoofSnow(corners, { seed: roofSeed++, depth, overhang: .14, spacing: 1.55 }));
    else {
      // Snow sheds from the very steep Chateau roofs. Keep cornices along
      // the eave and ridge, and a few narrow downslope ribbons in the seams.
      const [a,b,c,d]=corners.map(p=>new THREE.Vector3(...p));
      const p=(u,v)=>new THREE.Vector3().lerpVectors(a,b,u).lerp(new THREE.Vector3().lerpVectors(d,c,u),v).toArray();
      const eaveAtA=a.y<b.y;
      const patches=eaveAtA?[[0,.075,0,1],[.955,1,0,1],[.11,.94,.18,.215],[.34,.85,.69,.72]]
        :[[0,.045,0,1],[.925,1,0,1],[.06,.89,.18,.215],[.15,.66,.69,.72]];
      for(const [u0,u1,v0,v1] of patches)snow.push(createRoofSnow([p(u0,v0),p(u1,v0),p(u1,v1),p(u0,v1)],{seed:roofSeed++,depth:depth*.68,overhang:.045,spacing:1.2}));
    }
  };
  const eaveIce = (a, b, length = .27) => ice.push(createIcicles(a, b, { seed: roofSeed++, spacing: 1.17, length }));
  function gableRoof(x, z, w, d, eave, rise, yaw = 0, options = {}) {
    const tr = (a, b, c) => localPoint(a, b, c, yaw, [x, 0, z]);
    const left = [tr(-w / 2, eave, -d / 2), tr(0, eave + rise, -d / 2), tr(0, eave + rise, d / 2), tr(-w / 2, eave, d / 2)];
    const right = [tr(0, eave + rise, -d / 2), tr(w / 2, eave, -d / 2), tr(w / 2, eave, d / 2), tr(0, eave + rise, d / 2)];
    const steep=options.exposed ?? rise>w*.50;
    roofFace(left, options.color, options.snowDepth ?? .20, steep); roofFace(right, options.color, options.snowDepth ?? .20, steep);
    for (const zz of [-d / 2 + .035, d / 2 - .035]) {
      piece(masonry, triangle(tr(-w / 2, eave - .12, zz), tr(w / 2, eave - .12, zz), tr(0, eave + rise - .16, zz)), options.wall || C.plaster);
      metal.push(beam(tr(-w / 2 - .09, eave, zz), tr(0, eave + rise + .02, zz), .15, .18, C.fascia));
      metal.push(beam(tr(w / 2 + .09, eave, zz), tr(0, eave + rise + .02, zz), .15, .18, C.fascia));
    }
    metal.push(beam(tr(0, eave + rise + .06, -d / 2 - .1), tr(0, eave + rise + .06, d / 2 + .1), .17, .21, C.rib));
    // Raised copper standing seams remain visible between snow pillows.
    const bays = Math.ceil(d / 1.18);
    for (let i = 0; i <= bays; i++) {
      const zz = -d / 2 + d * i / bays;
      for (const side of [-1, 1]) metal.push(beam(tr(side * w / 2, eave + .055, zz), tr(0, eave + rise + .055, zz), .045, .055, C.rib));
    }
    if (options.icicles) for (const side of [-1, 1]) eaveIce(tr(side * w / 2, eave, -d / 2), tr(side * w / 2, eave, d / 2), options.icicles);
  }
  function hipRoof(x, z, w, d, eave, rise, yaw = 0, snowDepth = .23) {
    const tr = (a, b, c) => localPoint(a, b, c, yaw, [x, 0, z]);
    const inset = Math.min(w * .26, d * .31), ridge = Math.max(0, w / 2 - inset);
    // Ridge runs along the long dimension, with clipped ends at the hips.
    roofFace([tr(-w / 2, eave, -d / 2), tr(w / 2, eave, -d / 2), tr(ridge, eave + rise, 0), tr(-ridge, eave + rise, 0)], C.copper, snowDepth);
    roofFace([tr(-ridge, eave + rise, 0), tr(ridge, eave + rise, 0), tr(w / 2, eave, d / 2), tr(-w / 2, eave, d / 2)], C.copper, snowDepth);
    roofFace([tr(-w / 2, eave, d / 2), tr(-w / 2, eave, -d / 2), tr(-ridge, eave + rise, 0), tr(-ridge, eave + rise, 0)], C.copper, snowDepth);
    roofFace([tr(w / 2, eave, -d / 2), tr(w / 2, eave, d / 2), tr(ridge, eave + rise, 0), tr(ridge, eave + rise, 0)], C.copper, snowDepth);
    for (const side of [-1, 1]) {
      metal.push(beam(tr(-w / 2, eave, side * d / 2), tr(w / 2, eave, side * d / 2), .18, .22, C.fascia));
      eaveIce(tr(-w / 2, eave, side * d / 2), tr(w / 2, eave, side * d / 2));
      const step = 1.08;
      for (let xx = -ridge; xx <= ridge; xx += step) metal.push(beam(tr(xx, eave, side * d / 2), tr(xx, eave + rise, 0), .045, .06, C.rib));
    }
  }
  function room(x, y, z, w = 1.75, h = 1.66, yaw = 0, { french = false, lit = null, balcony = false } = {}) {
    roomCount++;
    const tr = (a, b, c) => localPoint(a, b, c, yaw, [x, y, z]);
    const add = (bucket, ww, hh, dd, color, a, b, c) => putBox(bucket, ww, hh, dd, color, ...tr(a, b, c), yaw);
    add(dark, w + .23, h + .22, .12, '#374240', 0, 0, 0);
    const warm = lit ?? rand() > .31;
    const tone = ['#dfa854', '#ffdda2', '#d09344', '#ffe3a8', '#c5b38f', '#e8bd70'][Math.floor(rand() * 6)];
    add(warm ? rooms : glass, w, h, .055, warm ? tone : ['#45616a', '#48616a', '#294750'][Math.floor(rand() * 3)], 0, 0, .072);
    // Different drawn curtains keep the facade from becoming a perfect grid.
    const left = w * (.10 + rand() * .17), right = w * (.07 + rand() * .15);
    add(curtains, left, h - .1, .028, warm ? '#cbb17c' : '#6d7974', -w / 2 + left / 2, 0, .11);
    add(curtains, right, h - .1, .028, warm ? '#bfa882' : '#616b65', w / 2 - right / 2, 0, .11);
    for (const xx of [-w / 2 - .065, w / 2 + .065]) add(trim, .105, h + .26, .17, C.trim, xx, 0, .12);
    for (const yy of [-h / 2 - .075, h / 2 + .075]) add(trim, w + .23, .105, .17, C.trim, 0, yy, .12);
    add(metal, .053, h, .06, '#aeb0a2', 0, 0, .12);
    if (french || h > 2) add(metal, w, .055, .055, '#d8cfb3', 0, h * .12, .13);
    add(trim, w + .39, .13, .36, '#cbbb99', 0, -h / 2 - .13, .15);
    if (balcony) {
      add(trim, w + .65, .18, .92, C.shadow, 0, -h / 2 - .23, .38);
      add(metal, w + .55, .06, .055, C.bronze, 0, -h / 2 + .62, .79);
      add(metal, w + .55, .05, .055, C.bronze, 0, -h / 2 - .04, .79);
      for (let xx = -w / 2 - .22; xx <= w / 2 + .23; xx += .24) add(metal, .035, .68, .035, C.bronze, xx, -h / 2 + .29, .79);
    }
  }
  function facade(x, z, width, floors, yaw = 0, { bottom = 5.4, spacing = 3.55, floorHeight = 3.05, skip = null, h = 1.72 } = {}) {
    const count = Math.max(1, Math.floor(width / spacing));
    for (let floor = 0; floor < floors; floor++) for (let bay = 0; bay < count; bay++) {
      const lx = (bay + .5) * width / count - width / 2;
      if (skip?.(lx, floor)) continue;
      const p = localPoint(lx, bottom + floor * floorHeight, 0, yaw, [x, 0, z]);
      room(...p, Math.min(1.92, width / count * .54), h, yaw);
    }
  }
  function wallBlock(x, z, w, d, top, yaw = 0, color = C.plaster, bottom = .8) {
    putBox(masonry, w, top - bottom, d, color, x, (top + bottom) / 2, z, yaw);
    transformedBox(trim, w + .34, .25, d + .34, C.trim, 0, top - .10, 0, yaw, [x, 0, z]);
  }
  function dormer(x, z, w, bottom, yaw = 0, rise = 3.1) {
    const tr = (a, b, c) => localPoint(a, b, c, yaw, [x, 0, z]);
    transformedBox(masonry, w, 2.7, 2.6, C.plaster, 0, bottom + 1.35, 0, yaw, [x, 0, z]);
    gableRoof(x, z, w + .52, 3.2, bottom + 2.68, rise, yaw, { snowDepth: .17 });
    room(...tr(0, bottom + 1.45, 1.34), Math.max(.7, w * .48), 1.62, yaw);
  }

  // The lower podium follows the surveyed outline, including the oblique
  // west return, projecting stair bays, and the southeast terrace side.
  for (const id of FAIRMONT_REPLACED_IDS) {
    const lot = buildingData.find(p => p.id === id); if (!lot) continue;
    const points = lot.points.map(([x, z]) => {
      const dx = x - ORIGIN.x, dz = z - ORIGIN.z;
      return [dx * Math.cos(ORIGIN.yaw) - dz * Math.sin(ORIGIN.yaw), dx * Math.sin(ORIGIN.yaw) + dz * Math.cos(ORIGIN.yaw)];
    });
    piece(stone, polygon(points, -3.2, 5.0), C.stone);
    if (id !== '50903854') {
      piece(masonry, polygon(points, 1.5, id === '173950357' ? 7.0 : 4.7), C.shadow);
      piece(roofs, polygon(points, id === '173950357' ? 8.5 : 6.2, .16), C.copper);
    }
  }
  // Eight-storey room wing, two setback attic storeys, and its end pavilion.
  wallBlock(41, 10.6, 91, 45.0, 25.55);
  wallBlock(39, 5.4, 89, 30.5, 26.1, 0, C.shadow);
  hipRoof(40, 20.3, 94, 27, 25.8, 9.3);
  roofFace([[-7,25.85,-12.2],[87,25.85,-12.2],[87,25.85,7.0],[-7,25.85,7.0]],C.copper,.21);
  facade(41, 33.28, 90, 7, 0, { bottom: 6.05 });
  facade(41, -12.15, 89, 7, Math.PI, { bottom: 6.05 });
  facade(86.55, 10.5, 44, 7, Math.PI / 2, { bottom: 6.05 });
  facade(-4.55, 10.5, 44, 7, -Math.PI / 2, { bottom: 6.05 });
  // Paired rows of recessed rooms under the copper attic eaves.
  for (const level of [0, 1]) for (let x = 0; x < 88; x += 5.45) {
    const z = 30.9 - level * 5.25, y = 29.25 + level * 3.27;
    putBox(dark, 4.55, 2.05, 1.2, C.recess, x, y, z - .30);
    room(x, y, z + .34, 2.28, 1.44, 0, { balcony: true });
    putBox(roofs, 4.83, .22, 1.72, C.copper, x, y + 1.17, z + .02);
  }
  // Pronounced vertical projecting gables interrupt the long horizontal wing.
  for (const [x, w, top, rise] of [[1.8, 9.2, 31.5, 7.2], [80.1, 12.4, 31.1, 7.8]]) {
    wallBlock(x, 28.2, w, 17, top, 0, C.sunny);
    gableRoof(x, 27.4, w + .55, 19.5, top, rise, 0, { icicles: .24 });
    for (let floor = 0; floor < 8; floor++) {
      room(x - 1.68, 5.95 + floor * 3.03, 36.80, 1.25, 1.84);
      room(x + 1.68, 5.95 + floor * 3.03, 36.80, 1.25, 1.84);
    }
    room(x, top + 2.15, 37.25, 1.55, 2.56, 0, { french: true });
    for (const sx of [-1, 1]) putBox(trim, .25, top - 1, .34, C.trim, x + sx * (w / 2 - .24), (top + 1) / 2, 36.88);
  }

  // The distinct, asymmetrical Chateau tower: a broad limestone gable in
  // front, a much taller steep copper roof behind it, and smaller setbacks.
  const towerBegin=snapshot();
  wallBlock(42.5, 13.5, 17.5, 41.0, 37.2, 0, C.sunny);
  wallBlock(42.5,35.0,5.2,2.1,36.95,0,C.sunny,1.8);
  gableRoof(42.5, 13.5, 18.1, 43.4, 36.95, 13.3, 0, { icicles: .37, snowDepth: .26 });
  // A stepped second shoulder gives the tall roof its photographed notch.
  const upperTowerBegin=snapshot();
  wallBlock(34.5, 2.3, 17.6, 25.5, 45.4, 0, C.shadow);
  // The occupied shoulder is clad in steep slate/copper, including its
  // visible side, rather than presenting a blank vertical stucco slab.
  for(const side of [-1,1]){
    const lower=34.5+side*10.1,upper=34.5+side*8.84;
    roofFace([[lower,34.7,-10.5],[upper,45.42,-10.5],[upper,45.42,15.1],[lower,34.7,15.1]],C.copper,.16,true);
    for(const z of [-7.5,-3.6,.3,4.2,8.1,12])room(34.5+side*9.6,42.7,z,1.28,1.72,side*Math.PI/2,{lit:z!==.3});
  }
  roofFace([[25.65,34.7,17.0],[43.35,34.7,17.0],[43.35,45.42,15.15],[25.65,45.42,15.15]],C.copper,.16,true);
  for(const x of [28,31.3,34.6,37.9,41.2])room(x,42.7,16.1,1.35,1.72,0,{lit:x!==37.9});
  // The upper occupied roof turns across the lower gable. Its broad slate
  // face and set-back crown, rather than a single front triangle, make the
  // asymmetrical summit of the Chateau recognisable from the ski lawn.
  gableRoof(34.5, 2.2, 27.0, 18.5, 45.2, 12.5, Math.PI/2, { snowDepth: .21, exposed:true, wall:C.copper });
  wallBlock(34.5, 10.7, 9.6, 4.4, 52.0, 0, C.sunny, 49.5);
  putBox(roofs,10.4,.20,5.2,C.copper,34.5,52.1,10.7);
  for(let k=0;k<5;k++)room(30.6+k*1.95,50.75,12.98,1.12,1.85,0,{lit:k!==3,french:true});
  putBox(trim,10.0,.22,.35,C.trim,34.5,49.58,13.08);
  // The ridge belvedere has four small vertical lights and its own roof.
  wallBlock(34.5, 3.3, 7.0, 8.2, 57.5, 0, C.copper, 53.2);
  gableRoof(34.5, 3.3, 7.8, 9.1, 57.55, 4.0, 0, { snowDepth: .18,wall:C.copper });
  for (let k = 0; k < 4; k++) room(31.6 + k * 1.92, 55.15, 7.48, .95, 2.05, 0, { lit:k===1||k===2 });
  moveSince(upperTowerBegin,0,5.4);
  for (const [x, z, y, h] of [[25.2, 3, 45, 7.5], [48, -4, 49, 8.8], [54, 21, 37, 6.2], [31.4, 35, 36, 5.4]]) {
    putBox(masonry, 1.05, h, 1.14, C.trim, x, y + h / 2, z);
    putBox(trim, 1.33, .25, 1.39, '#e8dbc0', x, y + h, z);
  }
  // Main gable window composition: narrow paired French doors through the
  // centre, broad rooms outside, then two upper sets and a pointed attic.
  for (let floor = 0; floor < 10; floor++) {
    const y = 6.0 + floor * 3.07;
    for (const x of [35.15, 49.85]) if (y < 38.5) room(x, y, 34.12, 1.90, 1.81);
    for (const x of [40.95, 44.05]) room(x, y, 35.99, 1.23, 2.17, 0, { french: true, balcony: floor > 6 });
  }
  for (const [y, w, h] of [[38.2, 3.9, 3.45], [42.0, 3.25, 3.7], [46.25, 2.25, 3.15]]) room(42.5, y, 35.35, w, h, 0, { french: true, balcony: y < 44 });
  room(42.5, 49.0, 35.35, .65, .70, 0, { lit: false });
  for (const x of [33.98, 39.1, 45.9, 51.02]) putBox(trim, .24, 34.0, .32, C.trim, x, 18.2, 36.1);
  facade(33.70,13.5,40.2,10,-Math.PI/2,{bottom:5.9});
  facade(51.30,13.5,40.2,10,Math.PI/2,{bottom:5.9});
  moveSince(towerBegin,-56.2,-12.0);
  // The right hand turret is recognisably smaller and has an eight-sided cap.
  wallBlock(80.4, 10.9, 9.8, 14, 34.6, 0, C.shadow, 29.2);
  const turret = new THREE.CylinderGeometry(4.9, 5.6, 2.1, 8);
  piece(masonry, turret, C.trim, [80.4, 33.4, 10.9], Math.PI / 8);
  piece(roofs, new THREE.ConeGeometry(6.1, 5.7, 8), '#32645f', [80.4, 36.85, 10.9], Math.PI / 8);
  for (const xx of [77.4, 80.4, 83.4]) room(xx, 33.4, 17.98, 1.45, 1.62);
  metal.push(beam([80.4, 39.7, 10.9], [80.4, 40.8, 10.9], .065, .065, C.bronze));

  // West return. Its facade bends inward at 45 degrees instead of reading
  // as an extension of the long tower wing in the supplied photograph.
  wallBlock(-77, -36.4, 73, 31.4, 24.2, 0, C.shadow);
  hipRoof(-77, -36.4, 75, 33.2, 24.4, 9.1);
  facade(-77, -20.53, 72.5, 6, 0, { bottom: 5.9 });
  facade(-113.7, -36.4, 31, 6, -Math.PI / 2, { bottom: 5.9 });
  facade(-77, -52.3, 72, 6, Math.PI, { bottom: 5.9 });
  const elbowYaw = -.78, elbow = [-33.5, 0, -9.5];
  transformedBox(masonry, 52, 26.3, 28.7, C.plaster, 0, 14.0, 0, elbowYaw, elbow);
  hipRoof(elbow[0], elbow[2], 53.5, 30.4, 27.3, 8.7, elbowYaw);
  const ef = localPoint(0, 0, 14.47, elbowYaw, elbow);
  facade(ef[0], ef[2], 51.6, 7, elbowYaw, { bottom: 5.95 });
  for(const side of [-1,1]){
    const p=localPoint(side*26.05,0,0,elbowYaw,elbow);
    facade(p[0],p[2],28.5,7,elbowYaw+side*Math.PI/2,{bottom:5.95});
  }
  // Projecting west pavilion with a steep central gable and lower shoulders.
  wallBlock(-82.0, -21.8, 13.2, 22.3, 28.45, 0, C.sunny);
  gableRoof(-82.0, -22.0, 13.9, 24.1, 28.5, 10.5, 0, { icicles: .34 });
  for (let f = 0; f < 8; f++) {
    for (const xx of [-87.0, -77.0]) room(xx, 5.7 + f * 2.99, -10.53, 1.88, 1.77);
    for (const xx of [-83.5, -80.5]) room(xx, 5.7 + f * 2.99, -10.40, 1.13, 2.05, 0, { french: true, balcony: f > 5 });
  }
  room(-82, 31.0, -9.82, 2.45, 3.0, 0, { french: true, balcony: true });
  for(const x of [-106,-55]){
    wallBlock(x,-26,9.2,12,27.0,0,C.sunny);
    gableRoof(x,-26,9.8,14.0,27.1,8.0,0,{snowDepth:.18,icicles:.27});
    for(let f=0;f<7;f++)for(const side of [-1,1])room(x+side*1.8,5.9+f*3.0,-19.86,1.22,1.8);
    room(x,28.5,-18.92,1.2,1.75,0,{french:true});
    for(const side of [-1,1])putBox(trim,.21,25.0,.26,C.trim,x+side*4.35,14.0,-19.77);
  }
  for(const x of [-15,7]){
    const p=localPoint(x,0,13.1,elbowYaw,elbow);
    dormer(p[0],p[2],4.2,27.1,elbowYaw,4.8);
  }
  for (let x = -101; x < -47; x += 7.7) dormer(x, -24.8, 3.3, 25.2, 0, 2.9);
  // Tall narrow cream chimney stacks punctuate the roof, as on the photo.
  for (const [x, z, y, h] of [[-111,-34,27,5],[-95,-34,31,4],[-64,-34,30,4.4],[-49,-18,29,6],[-29,-6,31,5.3],[-12,14,29,7.4],[12,7,35,3.2],[62,10,35,3]]) {
    putBox(masonry, 1.28, h, 1.18, C.trim, x, y + h / 2, z);
    putBox(trim, 1.58, .25, 1.48, C.trim, x, y + h, z);
  }
  // Raised plaster bands and the delicate pilasters are restrained; punched
  // room windows and the intricate roofs carry the Chateau's identity.
  for (const y of [2.2, 4.2, 24.3, 25.45]) putBox(trim, 91.8, .18, .31, C.trim, 41, y, 33.48);
  for (const x of [-4, 10.7, 24.8, 59.4, 73.3, 86.4]) putBox(trim, .22, 22.0, .32, C.trim, x, 15.1, 33.54);
  for (const y of [3.8, 22.45, 24.15]) putBox(trim, 73.5, .18, .27, C.trim, -77, y, -20.4);

  // Open stone arcade and heated terrace at the base of the slopeside wing.
  putBox(stone, 100, 1.18, 13.0, '#847965', 37, -.15, 39.5);
  putBox(stone, 100.7, .20, 13.6, '#a0937b', 37, .55, 39.5);
  for (let x = -8; x <= 82; x += 9.0) {
    putBox(stone, 1.2, 4.2, 1.18, '#8f826b', x, 2.67, 40.3);
    putBox(trim, 1.3, .24, 1.45, '#c4b694', x, 4.70, 40.3);
    if (x < 80) {
      const shape = new THREE.Shape();
      const r = 3.6, thick = .30;
      shape.absarc(0, 0, r + thick, 0, Math.PI, false);
      shape.absarc(0, 0, r, Math.PI, 0, true); shape.closePath();
      const a = new THREE.ExtrudeGeometry(shape, { depth: .8, bevelEnabled: false, curveSegments: 16 });
      piece(stone, a, '#998c73', [x + 4.5, 1.25, 39.88]);
      putBox(dark, 7.5, 2.6, .12, '#2c3c3a', x + 4.5, 2.2, 34.22);
      for (let p = -1; p <= 1; p++) room(x + 4.5 + p * 2.25, 2.45, 34.35, 2.06, 2.54, 0, { lit: true });
    }
  }
  putBox(stone, 100.9, .38, 9.1, '#9a8e77', 37, 5.22, 38.3);
  roofFace([[-13.5,5.43,33.5],[87.5,5.43,33.5],[87.5,5.43,43.3],[-13.5,5.43,43.3]], '#3d5751', .24);
  eaveIce([-13.5, 5.43, 43.3], [87.5, 5.43, 43.3], .40);
  // Stone triangular portico under the tallest gable, rather than a flat door.
  const porticoBegin=snapshot();
  for (const z of [38.8, 50.8]) putBox(stone, 1.18, 5.4, 1.1, '#a5987e', 39.8, 3.17, z);
  gableRoof(42.5, 44.8, 15.7, 10.0, 5.7, 6.3, -Math.PI/2, { wall: '#b8a78a', icicles: .45, snowDepth: .32 });
  piece(dark, triangle([37.42,6,39.9],[37.42,6,49.7],[37.42,10.4,44.8]), '#3f4b3e');
  for (const dz of [-1,1]) timber.push(beam([37.35,10.4,44.8],[37.35,5.8,44.8+dz*5],.20,.24,'#635a40'));
  putBox(timber, .26, .18, 10.0, '#635a40', 37.35, 6.0, 44.8);
  moveSince(porticoBegin,-56.2,-12);
  // An open glass conservatory and copper-roofed pool pavilion to the west.
  wallBlock(-54, -1.9, 33, 14, 4.2, 0, '#7e795f', .2);
  hipRoof(-54, -1.9, 35.0, 16.1, 4.3, 1.95, 0, .27);
  for (let x = -69; x < -38; x += 3.9) room(x, 2.0, 5.21, 3.5, 3.15, 0, { lit: true });
  for (let x = -71; x <= -37; x += 3.9) putBox(metal, .12, 4.1, .15, C.bronze, x, 2.3, 5.35);
  piece(roofs, new THREE.ConeGeometry(3.5, 6.5, 8), '#3d756a', [-60, 8.2, -1.8], Math.PI / 8);
  putBox(stone, 40, .32, 18, '#978e79', -54, -.04, 11.9);
  // Low lamps, copper handrails, cafe furniture and rope-edge planters give
  // the first few metres the scale and detail needed when arriving on foot.
  const lamp = (x, z, height = 3.7, power = 28) => {
    const [wx, wz] = worldPoint(x, z); const y = heightAt(wx, wz) - ground;
    putBox(metal, .11, height, .11, '#333e38', x, y + height / 2, z);
    putBox(stone, .43, .28, .43, '#807761', x, y + .14, z);
    putBox(metal, .42, .50, .42, '#303b33', x, y + height - .13, z);
    putBox(bulbs, .31, .35, .31, '#ffd590', x, y + height - .13, z);
    hipRoof(x, z, .60, .60, y + height + .14, .22, 0, .09);
    const light = new THREE.PointLight('#ffbf6d', 0, 13, 1.7);
    light.visible = false;
    light.position.set(x, y + height - .1, z); light.userData.power = power;
    root.add(light); lights.push(light);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeRadialTexture(64), color: '#ffbf70', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.position.copy(light.position); sprite.scale.set(1.8, 1.8, 1); root.add(sprite); glows.push(sprite);
  };
  for (const [x, z] of [[-71,22],[-40,23],[-11,48],[16,49],[58,50],[85,48],[101,43]]) lamp(x,z,3.7,38);
  for (const [x,z,tx,ty,tz] of [[-85,-6,-85,16,-20],[-58,10,-58,20,-20],[-27,33,-24,25,20],[-8,37,-13.7,27,24],[18,45,18,20,33.1],[49,45,49,20,33.1],[77,45,77,20,33.1]]) {
    const light = new THREE.SpotLight('#ffd08c', 0, 46, .29, .62, 1.2);
    light.visible = false;
    light.position.set(x,.85,z); light.target.position.set(tx,ty,tz);
    light.userData.power = 165; root.add(light, light.target); lights.push(light);
  }
  for (const x of [-61,-49,-37,-7,9,25,62,76]) {
    const z=x< -20?15:45.3;
    piece(timber,new THREE.CylinderGeometry(.71,.71,.09,20),'#66573c',[x,1.24,z]);
    putBox(metal,.11,1.04,.11,C.bronze,x,.71,z);
    for (const dx of [-1,1]) {
      putBox(timber,.66,.08,.67,'#6f6044',x+dx*1.05,.59,z);
      putBox(timber,.66,.70,.07,'#6f6044',x+dx*1.05,.99,z-.29);
      for(const dz of [-.23,.23])putBox(metal,.045,.5,.045,C.bronze,x+dx*1.05,.28,z+dz);
    }
  }
  for(const x of [-74,-33, -13, 12, 65, 88]) {
    const z=x< -20?19.5:48.6;
    putBox(stone,1.2,.83,1.05,'#938367',x,.68,z);
    piece(timber,new THREE.ConeGeometry(.77,1.25,8),'#4c5f3d',[x,1.57,z]);
  }
  // Low rail is deliberately open across the entrance and the ski lawn.
  for (const [a,b,z] of [[-75,-31,22.0],[-13,28,46.5],[55,89,46.5]]) {
    for (const y of [.95,1.45]) metal.push(beam([a,y,z],[b,y,z],.055,.055,C.bronze));
    for (let x=a;x<=b;x+=1.8) putBox(metal,.06,1.18,.06,C.bronze,x,.88,z);
  }
  // Small sign is type, not a facade photograph or billboard.
  const {canvas,ctx}=makeCanvas(1024,240);
  ctx.fillStyle='#263a36';ctx.fillRect(0,0,1024,240);
  ctx.fillStyle='#e7d5a7';ctx.textAlign='center';ctx.font='italic 90px Georgia';ctx.fillText('Fairmont',512,112);
  ctx.font='26px Georgia';ctx.fillText('CHATEAU WHISTLER',512,170);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(4.2,.98),new THREE.MeshStandardMaterial({map:canvasTexture(canvas),roughness:.7}));
  sign.position.set(-18.94,4.73,32.8);sign.rotation.y=-Math.PI/2;root.add(sign);

  const material = (bucket, mat, name, cast = true) => {
    if (!bucket.length) return;
    const mesh = new THREE.Mesh(surveyGeometry(mergeParts(bucket)), mat); mesh.name=name;
    mesh.castShadow=cast;mesh.receiveShadow=true;root.add(mesh); return mesh;
  };
  const plaster = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.87,side:THREE.DoubleSide});
  plaster.onBeforeCompile = shader => {
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 chateauPoint;').replace('#include <begin_vertex>','#include <begin_vertex>\nchateauPoint=position;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 chateauPoint;').replace('#include <color_fragment>',`#include <color_fragment>
      float fine=fract(sin(dot(floor(chateauPoint*37.),vec3(13.17,71.91,44.7)))*43758.5453);
      float resolve=1.-smoothstep(.45,1.25,length(fwidth(chateauPoint*37.)));
      float weather=.5+.5*sin(chateauPoint.y*.48+sin(chateauPoint.x*.39)*2.);
      diffuseColor.rgb *= .97+.04*weather+(fine-.5)*.055*resolve;`);
  };
  material(masonry,plaster,'Cream stucco and stepped Chateau gables');
  material(trim,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.78}),'Limestone surrounds, lintels and cornices');
  material(roofs,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.51,metalness:.38,side:THREE.DoubleSide}),'Green copper standing-seam roofs');
  material(metal,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.42,metalness:.52}),'Raised copper seams, bronze rails and window mullions');
  material(dark,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9}),'Deep window reveals and arcade shadow');
  material(glass,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.20,metalness:.34,envMapIntensity:1.1}),'Cool reflecting unoccupied rooms',false);
  const roomMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.43,metalness:.03,emissive:'#ffbb68',emissiveIntensity:.025});
  roomMat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor;');};
  material(rooms,roomMat,'Individual warm hotel rooms',false);warmMaterials.push(roomMat);
  material(curtains,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96}),'Parted curtains at individual rooms',false);
  material(stone,detailedMaterial('granite'),'Split stone podium, arcade and terrace');
  material(timber,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.83}),'Portico timber, terrace chairs and planters');
  const bulbMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.3,emissive:'#ffcd87',emissiveIntensity:.02});
  material(bulbs,bulbMat,'Warm lantern glass',false);warmMaterials.push(bulbMat);
  const snowMesh=joinWeather(snow,'Fairmont · accumulated roof snow');if(snowMesh)root.add(snowMesh);
  const iceMesh=joinWeather(ice,'Fairmont · uneven meltwater icicles');if(iceMesh)root.add(iceMesh);

  // Deliberately placed evergreens frame the hotel without a wall of trees
  // between the arrival lawn and its distinctive facade.
  const trees=[[-91,9,18],[-84,27,18],[-29,41,14],[95,29,23],[104,45,28],[118,34,24],[106,10,27],[95,-8,23],[-116,-3,19]];
  const treeMaterial=coniferMaterial(0);
  for(let i=0;i<trees.length;i++){
    const [x,z,h]=trees[i],[wx,wz]=worldPoint(x,z),y=heightAt(wx,wz)-ground;
    const tree=new THREE.Mesh(coniferGeometry(i%3===0?'fir':'spruce',0,i%3),treeMaterial);
    tree.position.set(x,y,z);tree.scale.setScalar(h);tree.rotation.y=rand()*6.28;
    tree.castShadow=tree.receiveShadow=true;tree.name='Fairmont terrace evergreen';root.add(tree);
    grid?.addCircle(wx,wz,.30+h*.016,'landmark-tree');
  }
  for(const [x,z,w,d,yaw] of [[41,10,91,45,0],[-77,-36,73,31,0],[-33.5,-9.5,52,28.7,-.78]]){
    const [wx,wz]=worldPoint(x,z);grid?.addBox(wx,wz,w/2,d/2,-ORIGIN.yaw-yaw,'lodge',{name:'Fairmont Chateau Whistler'});
  }
  let lastNight=-1;
  function update(dt=0,time=0,camera=null){
    const night=climateUniforms.night.value;
    if(Math.abs(night-lastNight)>.001){
      roomMat.emissiveIntensity=.025+night*.89;
      bulbMat.emissiveIntensity=.02+night*3.1;
      for(const lamp of lights)lamp.intensity=lamp.userData.power*night;
      for(const glow of glows)glow.material.opacity=night*.23;
      lastNight=night;
    }
    // Local lamps are useful only around the hotel. They never illuminate the
    // entire ski resort or consume light slots during a distant summit visit.
    const near=!camera || Math.hypot(camera.position.x-ORIGIN.x,camera.position.z-ORIGIN.z)<340;
    for(const lamp of lights)lamp.visible=near&&night>.015;
  }
  update();
  root.userData={footprint:'50903854',windowOpenings:roomCount,height:49.46,surveyedPeak:[505.38,734.75,-420.87],origin:{...ORIGIN},ground};
  cacheStaticTransforms(root);
  return {group:root,update,setClimate(){update();},start:FAIRMONT_START,view:FAIRMONT_VIEW};
}
