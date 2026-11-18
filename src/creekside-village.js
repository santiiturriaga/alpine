import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { box, beam, part, cacheStaticTransforms, mergeParts, mergedMesh } from './scenery.js';
import { timberMesh, detailedMaterial } from './plaza-materials.js';
import { climateUniforms } from './climate-state.js';
import { createRoofSnow, createIcicles } from './roof-weather.js';
import { makeCanvas, canvasTexture, mulberry32 } from './util.js';

// Cached OSM footprints and named POIs establish these anchors. The supplied
// ground-level photographs establish the timberwork, fenestration and roofs.
// Room counts and hidden elevations are interpretations, rather than a survey.
export const CREEKSIDE_BUILDING_IDS = new Set(['151613609', '151613608', '151613604']);
const DUSTYS = { x: -2549.25, z: 2071.35, yaw: .456 };
// NRCan's 2016 one-metre DSM places the pub ridge at 666.17 m. The same
// vertical calibration applies to facade details, terrace and stair nosings.
const DUSTYS_HEIGHT_SCALE = .85;
const FIRST_TRACKS = { x: -2583.8, z: 2156.5, yaw: Math.PI / 2 };
const warmNight = climateUniforms.night;

function world(anchor, x, z) {
  const c = Math.cos(anchor.yaw), s = Math.sin(anchor.yaw);
  return { x: anchor.x + x * c + z * s, z: anchor.z - x * s + z * c };
}

const frontWalk = world(DUSTYS, 1.7, 31.5);
const entry = world(DUSTYS, .7, 8.8);
export const DUSTYS_START = {
  ...frontWalk, heading: Math.atan2(entry.x - frontWalk.x, entry.z - frontWalk.z), holdAtUnload: true,
};
export const DUSTYS_VIEW = {
  get eye() { const p = world(DUSTYS, -9.5, 31.5); return [p.x, heightAt(p.x, p.z) + 1.75, p.z]; },
  get target() { const p = world(DUSTYS, 1.5, 7.0); return [p.x, heightAt(DUSTYS.x, DUSTYS.z) + 4.4, p.z]; },
  fov: 53, aspect: 16 / 9,
};
export const CREEKSIDE_SLOPE_VIEW = {
  get eye() { return [-2475, heightAt(-2475, 2138) + 2.8, 2138]; },
  get target() { return [-2584, heightAt(-2584, 2157) + 8.8, 2157]; },
  fov: 51, aspect: 16 / 9,
};

function batch() {
  return { wood: [], plaster: [], roof: [], stone: [], metal: [], glow: [], glass: [], panes: [] };
}

function addBatch(group, b) {
  if (b.wood.length) group.add(timberMesh(b.wood));
  for (const [key, kind] of [['plaster', 'stone'], ['stone', 'granite']]) {
    if (!b[key].length) continue;
    const mesh = new THREE.Mesh(mergeParts(b[key]), detailedMaterial(kind));
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Creekside ' + key; group.add(mesh);
  }
  for (const key of ['roof', 'metal']) {
    if (!b[key].length) continue;
    const mesh = mergedMesh(b[key], { roughness: key === 'roof' ? .69 : .42, metalness: key === 'roof' ? .14 : .46 });
    mesh.name = 'Creekside ' + key; group.add(mesh);
  }
  if (b.glass.length) group.add(glazing(b.glass));
  if (b.glow.length) {
    const mesh = mergedMesh(b.glow, { emissive: true, roughness: .35 });
    mesh.name = 'Warm patio bulbs and lantern glass'; group.add(mesh);
    b.glowMaterial = mesh.material;
  }
}

function localGroup(parent, anchor, name, yOffset = 0) {
  const group = new THREE.Group(); group.name = name;
  group.position.set(anchor.x, heightAt(anchor.x, anchor.z) + yOffset, anchor.z);
  group.rotation.y = anchor.yaw; parent.add(group); return group;
}

// All panes are batched, but retain their individual UVs. Frost grows from the
// actual frame edges; warmer occupied rooms illuminate independently at dusk.
function glazing(panes) {
  const p = [], uv = [], seed = [], colors = [], indices = [];
  const tint = new THREE.Color();
  panes.forEach((pane, n) => {
    const c = Math.cos(pane.yaw || 0), s = Math.sin(pane.yaw || 0), offset = p.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const x = (u - .5) * pane.w, y = (v - .5) * pane.h;
      p.push(pane.x + x * c, pane.y + y, pane.z - x * s);
      uv.push(u, v); seed.push(pane.seed ?? n * .713);
      tint.set(pane.color || '#34434a'); colors.push(tint.r, tint.g, tint.b);
    }
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('paneSeed', new THREE.Float32BufferAttribute(seed, 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .23, metalness: .32, side: THREE.DoubleSide });
  material.customProgramCacheKey = () => 'creekside-glass-frost-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.creekNight = warmNight;
    shader.uniforms.creekSnow = climateUniforms.snowpack;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paneSeed; varying vec2 frostUV; varying float frostSeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfrostUV=uv; frostSeed=paneSeed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 frostUV; varying float frostSeed; uniform float creekNight, creekSnow;
        float iceHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))+frostSeed*31.7)*43758.5453); }
        float edgeIce() {
          vec2 q=frostUV; float edge=min(min(q.x,1.-q.x),min(q.y,1.-q.y));
          float grain=iceHash(floor(q*vec2(190.,250.)));
          float fingers=.006+.016*pow(.5+.5*sin(q.x*93.+sin(q.y*67.)*2.7+frostSeed),4.);
          float bottom=.045*pow(1.-q.y,12.);
          return (1.-smoothstep(fingers+bottom,fingers+bottom+.014,edge))*smoothstep(.25,.85,creekSnow)*(.48+.45*grain);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float frost=edgeIce();
        float sky=.25+.75*pow(frostUV.y,1.3);
        diffuseColor.rgb*=.79+sky*.34;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.71,.82,.86),frost);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float occupied=step(.27,fract(sin(frostSeed*17.13+2.)*145.1));
        float curtain=.71+.20*sin(frostUV.x*48.+frostSeed);
        vec3 roomLight=mix(vec3(.66,.30,.09),vec3(1.,.66,.28),fract(frostSeed*.719));
        totalEmissiveRadiance+=roomLight*creekNight*occupied*curtain*(1.-frost)*.95;`);
  };
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'Individual frosted reflective Creekside windows'; return mesh;
}

function window(b, x, y, z, w, h, { yaw = 0, seed = 1, timber = '#5e4b38', mullions = 1, color = '#334049' } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (px, py, pz) => [x + px * c + pz * s, y + py, z - px * s + pz * c];
  const solid = (a, bh, d, col, px, py, pz) => box(a, bh, d, col, at(px, py, pz), [0, yaw, 0]);
  b.wood.push(solid(w + .23, .13, .19, timber, 0, -h / 2 - .015, .06), solid(w + .18, .14, .19, timber, 0, h / 2 + .015, .06));
  for (const side of [-1, 1]) b.wood.push(solid(.12, h, .19, timber, side * (w / 2 + .015), 0, .06));
  b.glass.push({ x, y, z, w, h, yaw, seed, color });
  for (let i = 1; i <= mullions; i++) b.wood.push(solid(.055, h, .13, timber, -w / 2 + w * i / (mullions + 1), 0, .08));
  b.wood.push(solid(w + .25, .07, .32, '#a39478', 0, -h / 2 - .095, .12));
}

function triangularPrism(w, d, h, color, pos) {
  const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -d / 2); return part(geometry, color, pos);
}

function roof(group, b, { x = 0, z = 0, w, d, eave, rise, seed = 1, depth = .28, ice = true, color = '#303432' }) {
  const hw = w / 2, hd = d / 2, angle = Math.atan2(rise, hw), slope = Math.hypot(hw, rise);
  for (const side of [-1, 1]) {
    b.roof.push(box(slope, .15, d, color, [x + side * hw / 2, eave + rise / 2, z], [0, 0, -side * angle]));
    const corners = side < 0
      ? [[x - hw, eave + .1, z - hd], [x, eave + rise + .1, z - hd], [x, eave + rise + .1, z + hd], [x - hw, eave + .1, z + hd]]
      : [[x, eave + rise + .1, z - hd], [x + hw, eave + .1, z - hd], [x + hw, eave + .1, z + hd], [x, eave + rise + .1, z + hd]];
    group.add(createRoofSnow(corners, { seed: seed + (side + 1) * 73, depth, overhang: .13, spacing: 1.05 }));
    if (ice) group.add(createIcicles([x + side * hw, eave - .03, z - hd], [x + side * hw, eave - .03, z + hd], { seed: seed + side * 17, length: .36, spacing: .53 }));
    b.wood.push(beam([x + side * hw, eave, z + hd], [x, eave + rise, z + hd], .23, .27, '#624a35'));
    b.wood.push(beam([x + side * hw, eave, z - hd], [x, eave + rise, z - hd], .20, .25, '#5e4936'));
  }
  b.roof.push(box(.19, .14, d + .13, '#454744', [x, eave + rise + .16, z]));
}

function railing(b, x, y, z, width, { yaw = 0, height = 1.05, color = '#77583a', spacing = .25 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (dx, dy, dz) => [x + dx * c + dz * s, y + dy, z - dx * s + dz * c];
  for (const h of [.12, height]) b.wood.push(box(width, .13, .16, color, at(0, h, 0), [0, yaw, 0]));
  for (let dx = -width / 2; dx <= width / 2 + .01; dx += spacing) {
    b.wood.push(box(.055, height - .14, .065, '#705238', at(dx, height / 2, 0), [0, yaw, 0]));
  }
  for (const dx of [-width / 2, width / 2]) b.wood.push(box(.19, height + .16, .19, '#715139', at(dx, (height + .16) / 2, 0), [0, yaw, 0]));
}

function stoneWall(b, x, y, z, width, height, { seed = 7, depth = .65, yaw = 0, snow = true } = {}) {
  const rand = mulberry32(seed), c = Math.cos(yaw), s = Math.sin(yaw), rows = Math.ceil(height / .43);
  b.stone.push(box(width, height, depth * .8, '#5c625a', [x, y + height / 2, z], [0, yaw, 0]));
  for (let row = 0; row < rows; row++) {
    let left = -width / 2;
    while (left < width / 2 - .04) {
      const w = Math.min(.38 + rand() * .56, width / 2 - left), h = height / rows;
      const dx = left + w / 2, dy = y + row * h + h / 2, dz = depth * .47;
      const col = ['#8c8c7b', '#797f74', '#a0a18c', '#686f68', '#b2ac94'][Math.floor(rand() * 5)];
      b.stone.push(part(new THREE.DodecahedronGeometry(1, 0), col,
        [x + dx * c + dz * s, dy, z - dx * s + dz * c], [rand() * .4, yaw + rand() * .8, rand() * .2], [w * .56, h * .59, depth * .37]));
      if (snow && row === rows - 1) b.roof.push(box(w * .91, .07 + rand() * .05, depth * 1.03, '#e4eced', [x + dx * c, y + height + .035, z - dx * s], [0, yaw, 0]));
      left += w;
    }
  }
}

function sign(group, text, subtitle, x, y, z, w = 3.0, yaw = 0) {
  const { canvas, ctx } = makeCanvas(1024, 420);
  ctx.fillStyle = '#34281b'; ctx.fillRect(0, 0, 1024, 420);
  ctx.strokeStyle = '#c8ad78'; ctx.lineWidth = 9; ctx.strokeRect(18, 18, 988, 384);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e4ce9b';
  ctx.font = 'italic bold 175px Georgia'; ctx.fillText(text, 512, 175, 920);
  ctx.fillStyle = '#ddcba4'; ctx.font = 'bold 43px Georgia'; ctx.fillText(subtitle, 512, 330, 930);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 420 / 1024), new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: .79, emissive: '#b29559', emissiveIntensity: .1 }));
  mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.name = text + ' · painted sign'; group.add(mesh); return mesh;
}

function lamp(b, x, y, z) {
  b.metal.push(box(.19, .05, .24, '#282e2b', [x, y + .31, z]), box(.20, .06, .24, '#282e2b', [x, y - .21, z]), beam([x, y + .36, z - .25], [x, y + .36, z + .08], .04, .04, '#282e2b'));
  b.glow.push(box(.12, .39, .14, '#ffe2a4', [x, y + .025, z]));
  for (const side of [-1, 1]) b.metal.push(box(.025, .48, .025, '#232824', [x + side * .085, y + .025, z + .10]));
}

function patioTable(b, x, y, z, angle = 0) {
  const table = [];
  for (let n = 0; n < 5; n++) table.push(box(2.25, .095, .15, n % 2 ? '#887154' : '#927a5a', [0, .74, (n - 2) * .16]));
  for (const side of [-1, 1]) {
    table.push(box(2.28, .09, .31, '#8b7252', [0, .43, side * .88]));
    table.push(beam([side * .68, .05, -.7], [side * .33, .7, .38], .10, .13, '#735b40'));
    table.push(beam([side * .68, .05, .7], [side * .33, .7, -.38], .10, .13, '#735b40'));
  }
  const c = Math.cos(angle), s = Math.sin(angle);
  for (const p of table) { const [dx, dy, dz] = p.pos; p.pos = [x + dx * c + dz * s, y + dy, z - dx * s + dz * c]; p.rot[1] += angle; b.wood.push(p); }
  b.roof.push(box(2.1, .04, .76, '#edf1ef', [x, y + .805, z], [0, angle, 0]));
}

function heater(b, x, y, z) {
  b.metal.push(part(new THREE.CylinderGeometry(.29, .36, .45, 12), '#6d7370', [x, y + .225, z]));
  b.metal.push(part(new THREE.CylinderGeometry(.045, .055, 2.0, 10), '#9a9d92', [x, y + 1.35, z]));
  b.metal.push(part(new THREE.CylinderGeometry(.21, .15, .42, 12), '#424a47', [x, y + 2.29, z]));
  b.metal.push(part(new THREE.CylinderGeometry(.72, .27, .17, 24), '#a9ada4', [x, y + 2.61, z]));
  b.glow.push(part(new THREE.CylinderGeometry(.16, .13, .25, 12), '#e5ad68', [x, y + 2.3, z]));
}

function skiRacks(b, baseY) {
  const rand = mulberry32(9237), palette = ['#dc3e34', '#3e9fb8', '#e4e8db', '#293c49', '#c0b94f', '#e99a28', '#356ea0'];
  for (const [x, z, count] of [[-8.0, 25.0, 8], [7.4, 24.6, 10], [-13.5, 27.3, 5]]) {
    const firstWood = b.wood.length, firstMetal = b.metal.length, p = world(DUSTYS, x, z);
    // Equipment rests in the actual forecourt snow, below the raised patio.
    const ground = (heightAt(p.x, p.z) - baseY) / DUSTYS_HEIGHT_SCALE;
    b.wood.push(box(count * .48 + .6, .13, .14, '#776149', [x, 1.12, z]), box(count * .48 + .6, .12, .15, '#6c5943', [x, .25, z]));
    for (const side of [-1, 1]) b.wood.push(beam([x + side * count * .24, .05, z - .54], [x + side * count * .24, 1.34, z + .22], .12, .12, '#6b5a45'));
    for (let n = 0; n < count; n++) {
      const sx = x + (n - (count - 1) / 2) * .48, h = 1.65 + rand() * .35, lean = -.16 + rand() * .27, color = palette[Math.floor(rand() * palette.length)];
      const snowboard = n % 5 === 2;
      for (let j = 0; j < (snowboard ? 1 : 2); j++) {
        const px = sx + j * .105, width = snowboard ? .29 : .085;
        b.metal.push(box(width, h, .026, color, [px, .12 + h / 2, z + .16], [lean, 0, lean * .7]));
        b.metal.push(part(new THREE.CylinderGeometry(width / 2, width / 2, .03, 10, 1, false, 0, Math.PI), color, [px - lean * h * .25, .11 + h, z + .16], [Math.PI / 2, 0, 0], [1, 1, 1.4]));
        for (const by of [.61, .88]) b.metal.push(box(width * 1.1, .10, .10, '#202827', [px, by, z + .235]));
        if (snowboard) b.metal.push(box(.21, .045, .06, '#b0b7ac', [px, 1.16, z + .25], [0, 0, .4]));
      }
      if (n % 2) {
        b.metal.push(beam([sx + .22, .08, z + .1], [sx + .16, 1.35, z + .13], .016, .016, '#9da29b'));
        b.metal.push(box(.045, .14, .045, '#303936', [sx + .16, 1.35, z + .13]));
      }
    }
    for (const p of b.wood.slice(firstWood)) p.pos[1] += ground;
    for (const p of b.metal.slice(firstMetal)) p.pos[1] += ground;
  }
}

function winterAspen(b, x, y, z, height, seed) {
  const rand = mulberry32(seed), base = new THREE.Vector3(x, y, z);
  const limb = (a, end, radius, level) => {
    const direction = end.clone().sub(a), length = direction.length();
    const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion()
      .setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
    b.wood.push(part(new THREE.CylinderGeometry(radius * .58, radius, length, level ? 5 : 7),
      level > 1 ? '#635f52' : '#a6a391', a.clone().lerp(end, .5).toArray(), rotation.toArray().slice(0, 3)));
    if (level >= 4 || length < .35) return;
    const angle = Math.atan2(direction.x, direction.z);
    for (let n = 0; n < (level === 0 ? 3 : 2); n++) {
      const azimuth = angle + (n ? 1 : -1) * (.55 + rand() * 1.25), nextLength = length * (.47 + rand() * .26);
      const spread = level === 0 ? .53 : .75;
      const tip = end.clone().add(new THREE.Vector3(Math.sin(azimuth) * nextLength * spread, nextLength * (.54 + rand() * .29), Math.cos(azimuth) * nextLength * spread));
      limb(end, tip, radius * (.43 + rand() * .18), level + 1);
    }
  };
  const trunk = base.clone().add(new THREE.Vector3(.4, height * .40, -.28));
  limb(base, trunk, .17, 0);
  // Secondary forks begin below the crown, as on the clustered Creekside
  // aspens. Dark scars interrupt their pale, smooth trunks.
  const forkBase = base.clone().lerp(trunk, .65);
  limb(forkBase, forkBase.clone().add(new THREE.Vector3(-1.35, height * .31, .42)), .105, 0);
  for (let n = 0; n < 9; n++) {
    const t = .07 + n * .08, p = base.clone().lerp(trunk, t);
    b.wood.push(part(new THREE.CylinderGeometry(.174 - .06 * t, .177 - .06 * t, .035 + rand() * .025, 7, 1, true, rand() * 4, 1.4), '#68675e', p.toArray()));
  }
}

function flagTexture(kind) {
  const { canvas, ctx } = makeCanvas(192, 256); ctx.fillStyle = '#f1eee4'; ctx.fillRect(0, 0, 192, 256);
  if (kind === 'canada') {
    ctx.fillStyle = '#c93236'; ctx.fillRect(0, 0, 43, 256); ctx.fillRect(149, 0, 43, 256);
    ctx.beginPath(); const leaf = [[96,57],[105,90],[119,77],[117,108],[140,104],[129,126],[143,138],[112,144],[110,159],[100,155],[100,189],[91,189],[92,155],[81,160],[78,145],[49,138],[63,126],[53,103],[77,109],[75,79],[87,91]];
    leaf.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); ctx.fill();
  } else if (kind === 'usa') {
    ctx.fillStyle = '#b93637'; for (let n = 0; n < 13; n += 2) ctx.fillRect(0, n * 256 / 13, 192, 256 / 13);
    ctx.fillStyle = '#263e68'; ctx.fillRect(0, 0, 93, 138); ctx.fillStyle = '#eeeadd';
    for (let y = 12; y < 135; y += 16) for (let x = 10; x < 90; x += 17) ctx.fillRect(x, y, 3, 3);
  } else if (kind === 'swiss') {
    ctx.fillStyle = '#c72c33'; ctx.fillRect(0, 0, 192, 256); ctx.fillStyle = '#fff9e8'; ctx.fillRect(45, 102, 102, 34); ctx.fillRect(79, 68, 34, 102);
  } else if (kind === 'france') { ctx.fillStyle = '#294e88'; ctx.fillRect(0, 0, 64, 256); ctx.fillStyle = '#c3313b'; ctx.fillRect(128, 0, 64, 256); }
  else if (kind === 'japan') { ctx.fillStyle = '#b83a3c'; ctx.beginPath(); ctx.arc(96, 128, 45, 0, Math.PI * 2); ctx.fill(); }
  else if (kind === 'finland') { ctx.fillStyle = '#294e85'; ctx.fillRect(50, 0, 33, 256); ctx.fillRect(0, 99, 192, 37); }
  else { ctx.fillStyle = '#20385e'; ctx.fillRect(0, 0, 192, 256); ctx.fillStyle = '#faf0dd'; ctx.fillRect(79, 0, 34, 256); ctx.fillRect(0, 110, 192, 36); ctx.fillStyle = '#bc3338'; ctx.fillRect(87, 0, 18, 256); ctx.fillRect(0, 119, 192, 18); }
  return canvasTexture(canvas);
}

function hangingFlags(group, b, flags) {
  for (const [i, kind] of ['canada', 'france', 'swiss', 'finland', 'canada', 'japan', 'usa', 'uk'].entries()) {
    const x = -9.2 + i * 2.67, y = 6.7, z = 12.0;
    b.metal.push(beam([x, 5.8, 10.8], [x, y + .43, z], .035, .035, '#adae9e'));
    const geometry = new THREE.PlaneGeometry(.77, 1.30, 10, 14);
    const material = new THREE.MeshStandardMaterial({ map: flagTexture(kind), side: THREE.DoubleSide, roughness: .88 });
    const flag = new THREE.Mesh(geometry, material); flag.position.set(x + .36, y - .22, z);
    flag.rotation.z = -.15; flag.castShadow = true; group.add(flag);
    flags.push({ mesh: flag, base: geometry.attributes.position.array.slice(), seed: i * 1.37 });
  }
}

function buildDustys(parent, grid, flags, lights) {
  const group = localGroup(parent, DUSTYS, "Dusty's Bar & BBQ · mapped Creekside timber pub");
  const b = batch(), w = 17.8, d = 18.4, front = d / 2;
  b.wood.push(box(w, 4.7, d, '#6b543f', [0, 2.35, 0]));
  b.wood.push(box(14.2, 3.65, d, '#6b543f', [0, 6.525, 0]));
  b.wood.push(triangularPrism(14.2, d, 5.4, '#574635', [0, 8.35, 0]));
  // Narrow weathered vertical boards are visible between the heavy timbers.
  for (let x = -7.0; x < 7.05; x += .22) b.wood.push(box(.175, 3.0, .095, Math.floor(x * 7) % 3 ? '#81715a' : '#74664f', [x, 6.75, front + .05]));
  roof(group, b, { w: 16.4, d: 20.2, eave: 8.1, rise: 5.73, seed: 1940, depth: .23 });
  for (const side of [-1, 1]) {
    const upper = side * 7.1, outer = side * 10.3;
    b.roof.push(box(Math.hypot(3.2, 2.2), .14, 19.6, '#424538', [side * 8.7, 6.3, 0], [0, 0, -side * Math.atan2(2.2, 3.2)]));
    b.wood.push(beam([upper, 7.4, 9.8], [outer, 5.2, 9.8], .22, .26, '#654b33'));
    group.add(createRoofSnow([[upper, 7.48, -9.8], [outer, 5.28, -9.8], [outer, 5.28, 9.8], [upper, 7.48, 9.8]], { seed: 1960 + side, depth: .20, spacing: .9, overhang: .12 }));
    group.add(createIcicles([outer, 5.17, 9.8], [outer, 5.17, -9.8], { seed: 1948 + side, length: .31 }));
  }
  // Open timber gable over a deeply inset, almost black wall of upper glass.
  window(b, 0, 7.1, front + .13, 10.5, 3.8, { timber: '#48372c', mullions: 4, seed: 3 });
  window(b, 0, 11.35, front + .14, 2.2, 2.1, { timber: '#4b3529', mullions: 1, seed: 41 });
  for (const x of [-5.6, 0, 5.6]) b.wood.push(box(.32, 5.0, .39, '#653c29', [x, 7.4, front + .34]));
  b.wood.push(box(12.1, .33, .40, '#6e412a', [0, 8.9, front + .32]));
  for (const side of [-1, 1]) {
    b.wood.push(beam([side * 5.5, 6.15, front + .37], [side * 1.1, 12.8, front + .37], .24, .28, '#5c3e2d'));
    b.wood.push(beam([side * 6.8, 8.8, front + .5], [side * .1, 13.3, front + .5], .22, .31, '#69442d'));
  }
  // Main balcony wraps toward the stone stair tower on the right.
  b.wood.push(box(26.4, .35, 4.3, '#5f4835', [1.1, 4.75, front + 1.1]));
  for (let x = -11.8; x < 14.2; x += .28) b.wood.push(box(.24, .08, 4.1, '#8b6d4c', [x, 4.965, front + 1.1]));
  railing(b, 1.1, 4.99, front + 3.14, 26.3, { spacing: .23, height: 1.18 });
  railing(b, -12.1, 4.99, front + 1.1, 4.1, { yaw: Math.PI / 2, height: 1.18 });
  railing(b, 14.3, 4.99, front + .9, 4.5, { yaw: Math.PI / 2, height: 1.18 });
  for (let x = -11.9; x < 14.5; x += 3.75) {
    b.wood.push(box(.34, 4.85, .36, '#67432e', [x, 2.43, front + 2.7]));
    b.wood.push(beam([x, 3.3, front + 2.7], [x + 1.0, 4.56, front + 2.7], .19, .20, '#6c4a33'));
    lamp(b, x, 4.1, front + 2.92);
    b.roof.push(box(.35, .09, .39, '#e7efec', [x, 6.31, front + 3.14]));
  }
  // The real pub's under-balcony frontage is broken into recessed door bays.
  for (const x of [-5.7, -.4, 4.7]) {
    window(b, x, 1.82, front + .10, 3.45, 2.83, { seed: 53 + x, timber: '#7f7054', mullions: 2 });
    b.wood.push(box(.28, 3.62, .29, '#5d3d2a', [x - 2.1, 1.9, front + .28]));
    b.wood.push(beam([x - 2.1, 3.45, front + .40], [x, 4.01, front + .40], .20, .25, '#573c2b'));
  }
  b.wood.push(box(5.1, 4.55, 4.2, '#65462f', [10.7, 2.3, 6.4]));
  window(b, 10.45, 1.82, 8.56, 3.35, 2.7, { seed: 41, timber: '#6c4b33', mullions: 1, color: '#262c2a' });
  sign(group, "Dusty's", 'BAR & BBQ · CREEKSIDE', 10.8, 3.6, 8.72, 2.65);
  // Tall square watchtower and its octagonal louvred lantern distinguish Dusty's.
  const tx = -9.9, tz = 5.9;
  for (const x of [tx - 1.65, tx + 1.65]) for (const z of [tz - 1.65, tz + 1.65]) b.wood.push(box(.34, 10.85, .34, '#5b422e', [x, 5.425, z]));
  b.wood.push(box(3.65, 5.25, 3.65, '#9a8b68', [tx, 9.1, tz]));
  for (let x = tx - 1.68; x < tx + 1.74; x += .20) b.wood.push(box(.13, 5.1, .09, '#b0a083', [x, 9.11, tz + 1.87]));
  for (const y of [6.38, 11.78]) b.wood.push(box(4.0, .25, 4.0, '#5c452f', [tx, y, tz]));
  for (const side of [-1, 1]) {
    const face = tz + side * 1.93;
    for (const dx of [-.82, .82]) {
      b.wood.push(beam([tx + dx - .7, 6.6, face], [tx + dx + .7, 11.55, face], .16, .18, '#584b36'));
      b.wood.push(beam([tx + dx + .7, 6.6, face], [tx + dx - .7, 11.55, face], .16, .18, '#584b36'));
    }
  }
  for (const x of [tx - 1.6, tx + 1.6]) b.wood.push(beam([x, 1.0, tz + 1.65], [tx + (x < tx ? 1.6 : -1.6), 6.0, tz + 1.65], .20, .22, '#5a4733'));
  b.wood.push(part(new THREE.CylinderGeometry(1.75, 1.75, 2.0, 8), '#705139', [tx, 12.8, tz]));
  for (let face = 0; face < 8; face++) {
    const a = (face + .5) * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    for (let column = 0; column < 8; column++) {
      const dx = (column - 3.5) * .165;
      b.wood.push(box(.14, 1.88, .06, column % 3 ? '#775239' : '#846148', [tx + s * 1.65 + dx * c, 12.8, tz + c * 1.65 - dx * s], [0, a, 0]));
    }
  }
  for (const y of [11.82, 13.78]) b.wood.push(part(new THREE.CylinderGeometry(1.79, 1.79, .12, 8), '#5c452f', [tx, y, tz]));
  const capY = 13.82, capH = .91, capR = 2.37;
  b.roof.push(part(new THREE.ConeGeometry(capR, capH, 8), '#3d3d33', [tx, capY + capH / 2, tz], [0, Math.PI / 8, 0]));
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4, ab = a + Math.PI / 4;
    const ca = [tx + Math.sin(a) * capR, capY, tz + Math.cos(a) * capR], cb = [tx + Math.sin(ab) * capR, capY, tz + Math.cos(ab) * capR];
    // A vanishingly short ridge makes each of the eight roof planes retain a
    // drifted skin without substituting a featureless white cone.
    group.add(createRoofSnow([ca, cb, [tx + .003, capY + capH, tz + .003], [tx, capY + capH, tz]], { seed: 591 + i, depth: .12, spacing: .45, overhang: .08 }));
  }
  // Round river-rock stair enclosure visible at the right edge of the photo.
  for (const [x, z, width, yaw] of [[13.5, 6.6, 4.1, 0], [15.5, 4.8, 4.0, Math.PI / 2]]) stoneWall(b, x, 0, z, width, 9.1, { seed: 70 + x, yaw, depth: .75 });
  b.wood.push(box(4.5, .27, 4.5, '#725b3d', [13.4, 9.12, 4.55]));
  railing(b, 13.4, 9.25, 6.85, 4.4, { height: 1.08 });
  // Lower patio: open edge in front, side railings, picnic tables and heaters.
  b.wood.push(box(27.6, .22, 7.3, '#72624b', [0, .28, 15.3]));
  for (const x of [-13.7, 13.7]) railing(b, x, .42, 15.3, 7.2, { yaw: Math.PI / 2, height: .92 });
  for (const [x, z, yaw] of [[-8.7, 14.4, .03], [-4.3, 15.1, -.08], [.2, 13.9, .05], [4.6, 15.1, -.08], [8.9, 14.2, .07]]) patioTable(b, x, .42, z, yaw);
  for (const x of [-10.7, -2.1, 6.6, 12.7]) heater(b, x, .40, 13.0);
  for (let n = 0; n < 7; n++) {
    const sy = .28 - n * .245, sz = 19.1 + n * .47;
    b.wood.push(box(10.8, .22, .54, '#756954', [-1.7, sy, sz]));
    b.wood.push(part(new THREE.CylinderGeometry(.14, .16, 10.95, 9), '#6c6150', [-1.7, sy - .015, sz + .23], [0, 0, Math.PI / 2]));
    b.roof.push(box(10.4 - n * .06, .065, .27, '#e6eeed', [-1.7 + Math.sin(n) * .06, sy + .145, sz - .04]));
  }
  for (const [x, z, width, height, seed] of [[-10.0, 19.1, 6.7, .75, 80], [9.7, 18.7, 6.2, .63, 91], [15.2, 13.0, 6.1, 1.1, 85]]) stoneWall(b, x, -.35, z, width, height, { seed, depth: .72 });
  skiRacks(b, group.position.y); hangingFlags(group, b, flags);
  for (const [x, z, h, seed] of [[-20, 18.1, 16, 282], [-17.7, 12.5, 14.2, 311], [-20.4, 3.0, 16.4, 414], [-15.8, -.6, 12.7, 515]]) {
    const p = world(DUSTYS, x, z), base = heightAt(p.x, p.z) - group.position.y;
    winterAspen(b, x, base, z, h, seed); grid?.addCircle(p.x, p.z, .22, 'landmark');
  }
  for (let x = -12.0; x < 14.1; x += .48) b.glow.push(part(new THREE.SphereGeometry(.035, 5, 4), '#ffe1a2', [x, 4.57, 12.4]));
  addBatch(group, b);
  for (const [x, y, z, power, range] of [[-5, 3.7, 12, 17, 13], [5, 3.7, 12, 20, 15], [0, 8.0, 10.3, 22, 12]]) {
    const light = new THREE.PointLight('#ffd08a', 0, range, 1.8); light.visible=false;
    light.position.set(x, y, z); light.userData.power = power; group.add(light); lights.push(light);
  }
  const p = world(DUSTYS, 0, -.5);
  grid?.addBox(p.x, p.z, 9, 9.3, -DUSTYS.yaw, 'lodge', { minY: group.position.y - 1, maxY: group.position.y + 12.8 });
  group.scale.y = DUSTYS_HEIGHT_SCALE;
  return { group, b };
}

function balcony(b, x, y, z, width = 3.8, depth = 1.5, color = '#80583c') {
  b.wood.push(box(width, .16, depth, '#684b34', [x, y, z + depth / 2]));
  railing(b, x, y + .10, z + depth, width, { height: .91, color, spacing: .21 });
  for (const side of [-1, 1]) {
    railing(b, x + side * width / 2, y + .10, z + depth / 2, depth, { yaw: Math.PI / 2, height: .91, color });
    b.wood.push(beam([x + side * (width / 2 - .15), y - .9, z + .07], [x + side * (width / 2 - .15), y - .11, z + depth - .12], .13, .14, '#7d5d40'));
  }
}

function lodgeWing(parent, grid, anchor, { name, width, depth, floors = 4, rise = 4.2, seed = 500, dormers = [], stoneBase = 1.3, wall = '#a49370', balconies = true, height = 3.0, floorY }) {
  const group = localGroup(parent, anchor, name), b = batch(), rand = mulberry32(seed), eave = stoneBase + floors * height, front = depth / 2;
  if (floorY !== undefined) group.position.y = floorY;
  b.plaster.push(box(width, eave, depth, wall, [0, eave / 2, 0]));
  const endGables = triangularPrism(depth, width, rise, '#796043', [0, eave, 0]);
  endGables.rot = [0, Math.PI / 2, 0]; b.wood.push(endGables);
  stoneWall(b, 0, -.35, front + .09, width, stoneBase + .35, { seed, depth: .55 });
  // A long ridge follows each wing; projecting facade gables are separate
  // small roofs with their own valley seams and drifted overhangs.
  const roofGroup = new THREE.Group(); roofGroup.name = 'Lengthwise pitched lodge roof';
  roofGroup.rotation.y = Math.PI / 2; group.add(roofGroup);
  const rb = batch();
  roof(roofGroup, rb, { w: depth + 1.9, d: width + 1.6, eave: eave - .05, rise, seed, depth: .35 });
  addBatch(roofGroup, rb);
  const bays = Math.max(3, Math.floor((width - 2.6) / 5.2)), bayWidth = (width - 2.5) / bays;
  for (const side of [-1, 1]) {
    for (let n = 0; n < bays; n++) {
      const x = -width / 2 + 1.25 + (n + .5) * bayWidth;
      for (let floor = 0; floor < floors; floor++) {
        const y = stoneBase + .55 + floor * height + height * .35;
        window(b, side * x, y, side * (front + .06), Math.min(2.7, bayWidth - .8), 1.68,
          { yaw: side < 0 ? Math.PI : 0, seed: seed + floor * 37 + n * 13 + side, timber: '#655f48', mullions: 1, color: '#52616a' });
        if (balconies && floor > 0 && side > 0 && !dormers.some(v => Math.abs(v - x) < bayWidth * .53)) balcony(b, x, stoneBase + floor * height + .05, front + .11, bayWidth - .36, 1.42);
      }
      if (n % 3 === 0) b.wood.push(box(.23, eave - stoneBase, .24, '#7b6141', [x - bayWidth * .5, (eave + stoneBase) / 2, front + .20]));
    }
    b.wood.push(box(width + .35, .22, .25, '#755b3f', [0, eave - .11, side * (front + .13)]));
    for (let n = 1; n < floors; n++) b.wood.push(box(width, .14, .16, '#827151', [0, stoneBase + n * height, side * (front + .11)]));
  }
  for (const x of [-width / 2, width / 2]) for (const z of [-front, front]) {
    b.wood.push(box(.35, eave, .35, '#766046', [x, eave / 2, z]));
  }
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < 3; bay++) for (let floor = 0; floor < floors; floor++) {
      window(b, side * (width / 2 + .06), stoneBase + floor * height + 1.6, (bay - 1) * depth * .275, 2.6, 1.68,
        { yaw: side * Math.PI / 2, seed: seed + 211 + floor * 19 + bay * 7 + side, timber: '#72654c', mullions: 1 });
    }
    window(b, side * (width / 2 + .08), eave + 1.0, 0, 2.0, 1.35,
      { yaw: side * Math.PI / 2, seed: seed + 411 + side, timber: '#7e6746', mullions: 1 });
  }
  for (const [n, x] of dormers.entries()) {
    const dw = Math.min(6.4, width * .14), dz = front + .87;
    b.plaster.push(box(dw, eave - stoneBase + .15, 1.7, '#b2a17e', [x, (eave + stoneBase) / 2, dz - .7]));
    b.wood.push(triangularPrism(dw, 2.2, 2.6, name.startsWith('Legends') ? '#625b45' : '#9b8055', [x, eave + .03, dz - .6]));
    roof(group, b, { x, z: dz - .35, w: dw + .55, d: 3.2, eave: eave + .01, rise: 2.6, seed: seed + n * 33, depth: .27, ice: false });
    for (let floor = 0; floor < floors; floor++) window(b, x, stoneBase + floor * height + 1.55, dz + .19, dw - 1.7, 1.85, { seed: seed + n * 31 + floor, timber: '#93815c', mullions: 2, color: '#64727a' });
    window(b, x, eave + .8, dz + .21, 1.5, 1.2, { seed: seed + n + 222, timber: '#806747', mullions: 1 });
    b.wood.push(box(dw - .58, .20, .26, '#a17a48', [x, eave + .72, dz + 1.04]));
    b.wood.push(box(.18, 2.35, .26, '#947044', [x, eave + 1.39, dz + 1.04]));
    for (const side of [-1, 1]) {
      b.wood.push(box(.32, eave - stoneBase + .3, .34, '#9a7648', [x + side * (dw / 2 - .28), (eave + stoneBase) / 2, dz + .33]));
      b.wood.push(beam([x + side * (dw / 2 + .03), eave + .10, dz + 1.1], [x, eave + 2.66, dz + 1.1], .18, .24, '#a17a48'));
    }
  }
  // Metal stove flues and squat stone chimneys break up the broad snowfield.
  for (let x = -width / 2 + 8; x < width / 2 - 4; x += 20 + rand() * 8) {
    const z = (rand() - .5) * 5;
    b.stone.push(box(2.0, 2.4, 1.5, '#85887a', [x, eave + rise - .15, z]));
    b.roof.push(box(2.23, .17, 1.72, '#3e4744', [x, eave + rise + 1.12, z]));
  }
  addBatch(group, b);
  grid?.addBox(anchor.x, anchor.z, width / 2, depth / 2, -anchor.yaw, 'lodge', { minY: group.position.y - .7, maxY: group.position.y + eave + rise });
  return { group, b, eave };
}

function turret(parent, anchor, { floors = 5, height = 3.0, seed = 100, width = 6.2, base = 1.2, open = false, floorY } = {}) {
  const group = localGroup(parent, anchor, 'First Tracks square lookout tower'), b = batch(), h = base + floors * height;
  if (floorY !== undefined) group.position.y = floorY;
  b.plaster.push(box(width, h, width, '#b5a989', [0, h / 2, 0]));
  for (const x of [-width / 2, width / 2]) for (const z of [-width / 2, width / 2]) b.wood.push(box(.32, h + 2.4, .32, '#7e6543', [x, (h + 2.4) / 2, z]));
  for (let floor = 0; floor < floors; floor++) {
    window(b, 0, base + floor * height + 1.5, width / 2 + .06, width - 1.8, 1.85, { seed: seed + floor, timber: '#8d815f', mullions: 1 });
    window(b, width / 2 + .06, base + floor * height + 1.5, 0, width - 1.8, 1.85, { yaw: Math.PI / 2, seed: seed + floor + 19, timber: '#8d815f', mullions: 1 });
  }
  if (open) {
    b.wood.push(box(width, .2, width, '#766040', [0, h + 1.78, 0]));
    for (const side of [-1, 1]) railing(b, 0, h + .1, side * width / 2, width, { height: .65 });
  } else b.wood.push(box(width - .4, 1.55, width - .4, '#514a35', [0, h + .8, 0]));
  const hh = h + 2.02, r = width * .84;
  b.roof.push(part(new THREE.ConeGeometry(r, 2.25, 4), '#343d3c', [0, hh + 1.1, 0], [0, Math.PI / 4, 0]));
  const corners = [[-width * .59, hh, -width * .59], [width * .59, hh, -width * .59], [width * .59, hh, width * .59], [-width * .59, hh, width * .59]];
  for (let i = 0; i < 4; i++) group.add(createRoofSnow([corners[i], corners[(i + 1) % 4], [.002, hh + 2.2, .002], [0, hh + 2.2, 0]], { seed: seed + i * 17, depth: .20, spacing: .65 }));
  addBatch(group, b); return { group, b };
}

function buildLodges(parent, grid) {
  const all = [];
  // Legends' three joined wings wrap behind the freestanding pub. Keeping
  // these offsets leaves the real courtyard and the gondola corridor open.
  all.push(lodgeWing(parent, grid, { x: -2541.6, z: 2034.8, yaw: .456 }, {
    name: 'Legends Hotel · central courtyard facade', width: 66, depth: 23.2, floors: 5, rise: 4.3, seed: 700,
    dormers: [-21, .4, 22], wall: '#b09c74',
  }));
  all.push(lodgeWing(parent, grid, { x: -2578.5, z: 2034.7, yaw: -.64 }, {
    name: 'Legends Hotel · north courtyard wing', width: 45, depth: 23, floors: 5, rise: 4.1, seed: 730, dormers: [-12, 12],
  }));
  all.push(lodgeWing(parent, grid, { x: -2499.5, z: 2074.1, yaw: -1.14 }, {
    name: 'Legends Hotel · gondola-facing return', width: 58.0, depth: 22.0, floors: 5, rise: 4.2, seed: 760, dormers: [-18, 8], wall: '#9f9173',
  }));
  // First Tracks' east face is the long lodge in the slope photograph: two
  // tall glazed gables, rows of projecting balconies, and square end towers.
  all.push(lodgeWing(parent, grid, FIRST_TRACKS, {
    name: 'First Tracks Lodge · slope-facing balcony facade', width: 61.2, depth: 23.4, floors: 5, rise: 4.0, seed: 810, floorY: 653.02,
    dormers: [-14.4, 14.4], wall: '#9e957b',
  }));
  all.push(lodgeWing(parent, grid, { x: -2580.8, z: 2199.6, yaw: Math.PI / 2 + .30 }, {
    name: 'First Tracks Lodge · taller southern wing', width: 30, depth: 23.6, floors: 5, height: 3.3, rise: 3.8, seed: 850, floorY: 657.49,
    dormers: [-6.8], wall: '#8d8a75',
  }));
  all.push(lodgeWing(parent, grid, { x: -2607.8, z: 2111.4, yaw: 0 }, {
    name: 'First Tracks Lodge · London Lane return', width: 45.3, depth: 22.2, floors: 3, height: 3.3, rise: 3.9, seed: 900, floorY: 652.91,
    dormers: [-11.5, 11.5], wall: '#9e967b',
  }));
  for (const [x, z, floors, seed] of [[-2573.0, 2130.8, 4, 1001], [-2570.3, 2201.8, 5, 1101]]) {
    all.push(turret(parent, { x, z, yaw: Math.PI / 2 }, {
      floors, seed, open: floors === 5, height: floors === 5 ? 3.3 : 3.0, floorY: floors === 5 ? 657.49 : 653.02,
    }));
  }
  return all;
}

export function buildCreeksideVillage(scene, { grid } = {}) {
  const root = new THREE.Group(); root.name = 'Creekside · photo-studied Dustys, Legends and First Tracks'; scene.add(root);
  const flags = [], lights = [], dustys = buildDustys(root, grid, flags, lights), lodges = buildLodges(root, grid);
  const glowMaterials = [dustys, ...lodges].map(v => v.b.glowMaterial).filter(Boolean);
  const lampPosition = new THREE.Vector3(); let time = 0;
  cacheStaticTransforms(root);
  return {
    group: root, dustys: dustys.group,
    walkSurfaceAt(x, z, currentY) {
      const dx = x - DUSTYS.x, dz = z - DUSTYS.z, c = Math.cos(DUSTYS.yaw), s = Math.sin(DUSTYS.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c, base = dustys.group.position.y;
      const lower = base + .39 * DUSTYS_HEIGHT_SCALE, upper = base + 5.005 * DUSTYS_HEIGHT_SCALE;
      if (currentY > base + 3.6 * DUSTYS_HEIGHT_SCALE && upper <= currentY + .7
          && lx > -12.1 && lx < 14.3 && lz > 8.15 && lz < 12.45) return upper;
      if (Math.abs(lx) < 13.8 && lz > 11.65 && lz < 18.95
          && (currentY === undefined || lower <= currentY + .7)) return lower;
      // Tread intervals share their boundaries, so walking never falls through
      // the log nosings. The final step is only centimetres above the snow.
      if (lx > -7.1 && lx < 3.7 && lz >= 18.85 && lz <= 22.19) {
        const step = Math.max(0, Math.min(6, Math.floor((lz - 18.865) / .47)));
        const floor = base + (.39 - step * .245) * DUSTYS_HEIGHT_SCALE;
        return currentY === undefined || floor <= currentY + .7 ? floor : null;
      }
      return null;
    },
    update(dt = 0, _time, camera) {
      time += dt;
      const night = warmNight.value;
      for (const material of glowMaterials) material.emissiveIntensity = .06 + night * 1.7;
      for (const lamp of lights) {
        lamp.getWorldPosition(lampPosition);
        lamp.visible = night > .02 && (!camera || camera.position.distanceToSquared(lampPosition) < 150 * 150);
        lamp.intensity = night * lamp.userData.power;
      }
      for (const flag of flags) {
        const a = flag.mesh.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) {
          const x = flag.base[i * 3], y = flag.base[i * 3 + 1], looseness = (x + .385) / .77;
          a.setZ(i, Math.sin(x * 8.5 + y * 4.1 + time * 2.5 + flag.seed) * .10 * looseness + .035 * looseness);
        }
        a.needsUpdate = true; flag.mesh.geometry.computeVertexNormals();
      }
    },
  };
}
