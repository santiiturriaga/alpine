import * as THREE from 'three';
import { buildingData } from '../data/osm-whistler.js';
import { heightAt } from './terrain.js';
import { part, box, beam, cacheStaticTransforms, mergeParts, mergedMesh } from './scenery.js';
import { detailedMaterial, timberMesh } from './plaza-materials.js';
import { climateUniforms } from './climate-state.js';
import { createRoofSnow, createIcicles } from './roof-weather.js';
import { applyPaverWeather, makeShoveledBanks } from './plaza-winter.js';
import { guestClear } from './guest-navigation.js';
import { makeCanvas, canvasTexture, lerp, mulberry32 } from './util.js';

// The named buildings retain their mapped OSM outlines. The hotel façades,
// stepped roof volumes and terrace fitouts are interpreted from photographs.
export const SKIERS_PLAZA_BUILDING_IDS = new Set(['50677441', '147438099', '147438097']);
export const SKIERS_PLAZA_START = { x: -39, z: -74, heading: -2.78, holdAtUnload: true };
// Pan Pacific's 18.2 m plaza-facing wall runs from [-16.8,-89.1] to [1.2,-92].
const salomonSite = { x: -8.2, z: -90.486, yaw: Math.atan2(2.9,18) };
// Inferred by resection against Sundial's corner and the Salomon shop front.
// The supplied map camera coordinates resolve uphill of these two landmarks.
export const SKIERS_PLAZA_VIEW = {
  get eye() { return [-33, heightAt(-33, -74) + 1.68, -74]; },
  get target() { return [-45, heightAt(-33, -74) + 9.7, -120]; },
  fov: 66, aspect: 1762 / 1030,
};

const timber = '#574033';
const steel = '#303c41';
const dark = '#2c2d29';
const mortar = '#8b8277';
const roofs = ['#3d4b53', '#46545d', '#42505b', '#505c65'];
const panes = ['#597784', '#4b5d63', '#49656f', '#29363d', '#63838c', '#6e7371'];
const names = {
  carleton: 'Carleton Lodge · Longhorn Saloon',
  sundial: 'Sundial Hotel · Showcase Village',
  panPacific: 'Pan Pacific Mountainside · Salomon and Dubh Linn Gate',
};
const specs = [
  { id: '50677441', style: 'carleton', podium: 3.65, floors: 4, storey: 2.83, peak: 3.6,
    stone: '#77736a', wall: '#d6bf9b', pier: '#efdfbb', sill: '#a9916e', roof: '#475259' },
  { id: '147438099', style: 'sundial', podium: 4, floors: 5, storey: 2.78, peak: 7.2,
    stone: '#70655a', wall: '#bd804b', pier: '#ae6844', sill: '#c89b74', roof: '#3e4d5b' },
  { id: '147438097', style: 'panPacific', podium: 3.65, floors: 4, storey: 3, peak: 5.2,
    stone: '#9d9b90', wall: '#c9be9d', pier: '#e0d5b5', sill: '#b8ad92', roof: '#62737a' },
];

function quadPart(a, b, c, d, tint) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  geometry.computeVertexNormals();
  return part(geometry, tint);
}

function planePart(points, y, tint) {
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z))));
  geometry.rotateX(-Math.PI / 2).translate(0, y, 0);
  return part(geometry, tint);
}

function collect() {
  return { wall: [], granite: [], timber: [], metal: [], glass: [], foliage: [], roof: [], light: [] };
}

function finish(parent, parts) {
  for (const [kind, group] of Object.entries(parts)) {
    if (!group.length) continue;
    let mesh;
    if (kind === 'granite') {
      mesh = new THREE.Mesh(mergeParts(group), detailedMaterial('granite'));
      mesh.castShadow = mesh.receiveShadow = true;
    } else if (kind === 'timber') mesh = timberMesh(group);
    else mesh = mergedMesh(group, {
      roughness: kind === 'glass' ? .38 : kind === 'roof' ? .72 : .85,
      metalness: kind === 'glass' ? .18 : kind === 'metal' ? .22 : .03,
      emissive: kind === 'light',
    });
    if (kind === 'glass' || kind === 'light') mesh.castShadow = false;
    // Plane-based roof and wall skins share draw calls even where winding
    // reverses around concave building footprints.
    if (kind === 'wall' || kind === 'roof' || kind === 'granite' || kind === 'foliage') mesh.material.side = THREE.DoubleSide;
    mesh.name = kind;
    parent.add(mesh);
  }
}

function frameAt(x, z, yaw, y = heightAt(x, z)) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    y, yaw,
    point: (u, v, d = 0) => [x + c * u + s * d, y + v, z - s * u + c * d],
    inverse: (px, pz) => [(px - x) * c - (pz - z) * s, (px - x) * s + (pz - z) * c],
  };
}

function façadeBox(layers, layer, frame, x, y, d, w, h, depth, color) {
  layers[layer].push(box(w, h, depth, color, frame.point(x, y, d), [0, frame.yaw, 0]));
}

function panel(parent, frame, x, y, d, w, h, line, options = {}) {
  const { canvas, ctx } = makeCanvas(1024, 256);
  const { bg = '#252c2c', ink = '#f5e6c9', type = 'Arial', sub = '', border = true } = options;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1024, 256);
  if (border) {
    ctx.strokeStyle = ink; ctx.globalAlpha = .45; ctx.lineWidth = 4; ctx.strokeRect(8, 8, 1008, 240);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.font = `bold ${sub ? 102 : 123}px ${type}`;
  ctx.fillText(line, 512, sub ? 103 : 131, 935);
  if (sub) { ctx.font = `bold 42px ${type}`; ctx.fillText(sub, 512, 192, 875); }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: canvasTexture(canvas), roughness: .72, emissive: '#ffffff', emissiveIntensity: .12,
  }));
  mesh.name = line;
  mesh.position.fromArray(frame.point(x, y, d)); mesh.rotation.y = frame.yaw;
  parent.add(mesh);
}

function windowBay(layers, frame, x, y, w, h, edge, tone, mullions = 2, rows = 2, offset = .045) {
  façadeBox(layers, 'metal', frame, x, y, offset, w + .16, h + .16, .14, edge);
  façadeBox(layers, 'glass', frame, x, y, offset + .078, w, h, .04, tone);
  for (let i = 1; i < mullions; i++)
    façadeBox(layers, 'metal', frame, x + (i / mullions - .5) * w, y, offset + .104, .061, h, .07, edge);
  for (let i = 1; i < rows; i++)
    façadeBox(layers, 'metal', frame, x, y + (i / rows - .5) * h, offset + .104, w, .054, .07, edge);
}

function rail(layers, frame, x0, x1, y, offset, color = steel, spacing = .21) {
  const width = x1 - x0;
  façadeBox(layers, 'metal', frame, (x0 + x1) / 2, y + .92, offset, width, .08, .065, color);
  façadeBox(layers, 'metal', frame, (x0 + x1) / 2, y + .13, offset, width, .05, .053, color);
  const count = Math.ceil(width / spacing);
  for (let i = 0; i <= count; i++)
    façadeBox(layers, 'metal', frame, lerp(x0, x1, i / count), y + .5, offset,
      i % 7 === 0 ? .072 : .034, .91, .048, color);
}

function stoneWall(layers, frame, x0, x1, y0, y1, face, tint, large = false) {
  const h = y1 - y0, len = x1 - x0;
  façadeBox(layers, 'granite', frame, (x0 + x1) / 2, (y0 + y1) / 2, face - .055, len, h, .16, tint);
  const rowHeight = large ? .39 : .29;
  const count = Math.max(1, Math.ceil(h / rowHeight)), rand = mulberry32(Math.round(7139 + len * 123));
  for (let n = 0; n < count; n++) {
    const cY = y0 + h * ((n + .5) / count), slabH = h / count - .027;
    let cursor = x0;
    while (cursor < x1 - .045) {
      const width = Math.min(x1 - cursor, (large ? .49 : .31) + rand() * (large ? .98 : .38));
      const color = new THREE.Color(tint).multiplyScalar(.77 + rand() * .35);
      façadeBox(layers, 'granite', frame, cursor + width / 2, cY, face + rand() * .018,
        Math.max(.02, width - .028), Math.max(.025, slabH), .15 + rand() * .055, color);
      cursor += width;
    }
  }
}

function eave(layers, a, b, trim = '#464541') {
  layers.metal.push(beam(a, b, .17, .22, trim));
}

function roofSkin(parent, layers, points, tint, seed, { seams = 0, snow = .25, icicles = false } = {}) {
  layers.roof.push(quadPart(...points, tint));
  const [a, b, c, d] = points;
  if (seams) {
    const count = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / seams);
    const along = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t) + .024, lerp(p[2], q[2], t)];
    for (let i = 0; i <= count; i++)
      layers.roof.push(beam(along(a, b, i / count), along(d, c, i / count), .045, .039, '#52616b'));
  }
  if (snow) parent.add(createRoofSnow(points, { seed, depth: snow, spacing: 1.2 }));
  if (icicles) parent.add(createIcicles(d, c, { seed: seed + 517, spacing: .68, length: .29 }));
}

function gable(parent, layers, frame, w, depth, y, rise, tint, seed, { hip = 0, cover = true, span = 0 } = {}) {
  const a = w / 2, b = depth / 2, ridge = Math.max(.06, a - hip);
  const verts = [[-a, y, -b], [a, y, -b], [a, y, b], [-a, y, b], [-ridge, y + rise, 0], [ridge, y + rise, 0]];
  const p = verts.map(q => frame.point(...q));
  roofSkin(parent, layers, [p[4], p[5], p[2], p[3]], tint, seed, { seams: .52, snow: cover ? .27 : 0, icicles: cover && w > 9 });
  roofSkin(parent, layers, [p[5], p[4], p[0], p[1]], tint, seed + 1, { seams: .52, snow: cover ? .23 : 0 });
  if (hip) {
    layers.roof.push(quadPart(p[4], p[3], p[0], p[4], tint), quadPart(p[5], p[1], p[2], p[5], tint));
  } else {
    const wall = span || '#88715d';
    layers.wall.push(quadPart(p[4], p[3], p[0], p[4], wall), quadPart(p[5], p[1], p[2], p[5], wall));
  }
  for (let i = 0; i < 4; i++) eave(layers, p[i], p[(i + 1) % 4]);
  eave(layers, p[4], p[5], '#4f5b64');
}

function dormer(parent, layers, frame, x, y, d, width, color, seed) {
  façadeBox(layers, 'wall', frame, x, y + .72, d - .81, width, 2.55, 1.9, color);
  windowBay(layers, frame, x, y + .82, width * .52, 1.55, dark, '#435b66', 2, 2, d + .17);
  const [dx, dy, dz] = frame.point(x, 0, d - 1.03);
  const rotated = frameAt(dx, dz, frame.yaw + Math.PI / 2, dy);
  gable(parent, layers, rotated, 3.13, width + .56, y + 1.97, width * .50, '#465463', seed, { span: color });
}

function splitAt(points, x, east) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const inA = east ? a[0] >= x : a[0] <= x, inB = east ? b[0] >= x : b[0] <= x;
    if (inA) out.push(a);
    if (inA !== inB) out.push([x, lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]))]);
  }
  return out;
}

function mansard(parent, layers, frame, local, y, rise, tint, seed, deep) {
  const middle = [0, 1].map(k => local.reduce((sum, point) => sum + point[k] / local.length, 0));
  const ring = (scaleX, scaleZ, y) => local.map(([x, z]) => frame.point(
    lerp(middle[0], x, scaleX), y, lerp(middle[1], z, scaleZ)));
  const eaves = ring(1.039, 1.054, y);
  const shoulder = ring(deep ? .82 : .59, deep ? .65 : .42, y + rise * (deep ? .76 : .66));
  const cap = ring(.55, .19, y + rise);
  for (let i = 0; i < local.length; i++) {
    const j = (i + 1) % local.length;
    const run = Math.hypot(eaves[i][0] - eaves[j][0], eaves[i][2] - eaves[j][2]);
    if (run < .2) continue;
    roofSkin(parent, layers, [shoulder[i], shoulder[j], eaves[j], eaves[i]], tint, seed + i, {
      seams: run > 2 ? .59 : 0, snow: run > 3 ? .24 : 0, icicles: run > 8,
    });
    roofSkin(parent, layers, [cap[i], cap[j], shoulder[j], shoulder[i]], roofs[seed % roofs.length], seed + 30 + i,
      { seams: run > 2 ? .6 : 0, snow: run > 2 ? .27 : 0 });
    eave(layers, eaves[i], eaves[j], '#45443e');
  }
  layers.roof.push(planePart(cap.map(([x, , z]) => [x, z]), frame.y + y + rise -.017, tint));
}

function displayWindow(layers, frame, center, width, ground, type) {
  const set = (group, x, y, depth, w, h, d, tint) =>
    façadeBox(layers, group, frame, center + x, ground + y, depth, w, h, d, tint);
  const retail = type !== 'cafe';
  const glass = retail ? '#534c3d' : '#5c5543';
  const trim = retail ? '#302f2b' : '#4d3c2e';
  set('metal', 0, 1.37, .262, width - .08, 2.33, .20, trim);
  set('glass', 0, 1.38, .366, width - .28, 1.99, .051, glass);
  set('timber', 0, 1.39, .403, width - .31, 1.73, .032, retail ? '#73654e' : '#7d664c');
  set('metal', 0, .38, .45, width - .16, .115, .17, trim);
  set('metal', 0, 2.42, .46, width - .13, .112, .16, trim);
  for (const side of [-1, 1]) set('metal', side * (width * .5 - .105), 1.41, .459, .10, 2.1, .13, trim);
  set('light', 0, 2.305, .444, width * .81, .030, .057, '#bda276');

  if (type === 'skis') {
    const groups = ['#d7ae45', '#697779', '#a85b40', '#d2d6c6'];
    set('timber', 0, .51, .457, width * .85, .24, .13, '#47433c');
    for (let i = 0; i < groups.length; i++) {
      const x = (i - 1.5) * width * .19;
      for (const side of [-1, 1]) {
        const heel = frame.point(center + x + side * .054, ground + .66, .502);
        const tip = frame.point(center + x + side * .054 + (i - 1.4) * .046, ground + 1.96 + .071 * (i % 2), .473);
        layers.wall.push(beam(heel, tip, .077, .022, groups[i]));
        set('metal', x + side * .054, 1.22, .51, .06, .18, .03, '#414746');
      }
    }
  } else {
    const rows = retail ? [.65, 1.19, 1.77] : [.59, 1.32, 1.92];
    for (const [i, y] of rows.entries()) {
      set('timber', 0, y, .461, width * .82, .054, .119, '#403c30');
      for (const side of [-1, 1]) {
        const x = side * width * (i === 1 ? .21 : .25);
        const tone = retail ? ['#a59c7f', '#696a55', '#a14f3f'][i] : ['#4e5c45', '#8b6547', '#d3b790'][i];
        if (retail && i <= 1) {
          set('wall', x, y + .095, .487, .21, .13, .096, i ? '#45595f' : '#383e42');
          set('wall', x - .04, y + .208, .47, .129, .19, .084, tone);
          set('metal', x - .045, y + .22, .518, .118, .026, .018, '#a29a88');
        } else if (i === 1 || i === 2) {
          for (let j = 0; j <= 2; j++) set('wall', x + (j - 1) * .105, y + .097 + .014 * j,
            .477, .074, .15 + .035 * j, .07, j === 2 ? '#a69c82' : tone);
        } else {
          set('wall', x, y + .18, .478, width * .19, .295, .10, tone);
          set('glass', x, y + .18, .535, width * .13, .216, .021, '#8f7959');
        }
      }
    }
  }
  set('metal', 0, 1.59, .545, .034, 1.58, .028, trim);
  set('metal', 0, 2.20, .539, width - .23, .036, .034, trim);
}

function storefront(layers, frame, center, width, ground, style, important, display) {
  if (display && width > 1.28) {
    displayWindow(layers, frame, center, width, ground, display);
    return;
  }
  const color = style === 'sundial' ? '#514038' : '#293639';
  windowBay(layers, frame, center, ground + 1.35, width - .24, 2.18, color,
    important ? '#334a50' : '#3c5151', Math.max(2, Math.round(width / .9)), 2, .20);
  façadeBox(layers, 'granite', frame, center, ground + .22, .19, width, .39, .24, '#625f53');
  façadeBox(layers, 'metal', frame, center, ground + 2.58, .21, width, .20, .29, '#302e27');
  for (let i = -1; i <= 1; i += 2) {
    façadeBox(layers, 'metal', frame, center + i * .15, ground + 1.16, .34, .039, .30, .065, '#b9a980');
    if (important) façadeBox(layers, 'light', frame, center + i * width * .37, ground + 2.65,
      .24, width * .14, .043, .031, '#d7a351');
  }
}

function projectionBay(parent, layers, frame, center, w, y, levelHeight, levels, wallColor, depth) {
  const points = [[center - w / 2, .05], [center - w * .36, depth],
    [center + w * .36, depth], [center + w / 2, .05]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const [x, , z] = frame.point(a[0], 0, a[1]), [bx, , bz] = frame.point(b[0], 0, b[1]);
    const wing = frameAt(x, z, -Math.atan2(bz - z, bx - x), frame.y);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    façadeBox(layers, 'wall', wing, len / 2, y + levelHeight * levels / 2, -.04,
      len + .09, levelHeight * levels, .18, wallColor);
    for (let floor = 0; floor < levels; floor++) {
      windowBay(layers, wing, len / 2, y + (floor + .57) * levelHeight, len - .25,
        levelHeight * .68, '#313b40', panes[(floor + i) % panes.length], i === 1 ? 4 : 1, 3, .055);
      façadeBox(layers, 'wall', wing, len / 2, y + (floor + .12) * levelHeight,
        .085, len + .025, .18, .22, '#8b5344');
    }
  }
  const [cx, cy, cz] = frame.point(center, 0, depth * .14);
  gable(parent, layers, frameAt(cx, cz, frame.yaw, cy), w + 1.28, depth * 2.42,
    y + levelHeight * levels, 1.13, '#3c4851', Math.round(center * 77 + 520), { hip: 1.1 });
}

function building(parent, grid, spec) {
  const { points } = buildingData.find(lot => lot.id === spec.id);
  const [x, z] = [0, 1].map(k => points.reduce((sum, pt) => sum + pt[k] / points.length, 0));
  const group = new THREE.Group(); group.name = names[spec.style]; parent.add(group);
  const layers = collect();
  const facing = { carleton: .86, sundial: -.44, panPacific: .29 }[spec.style];
  const frontage = { carleton: [-74, -42], sundial: [-58, -92], panPacific: [-15, -88] }[spec.style];
  const datum = heightAt(...frontage) + .2;
  const frame = frameAt(x, z, facing, datum);
  const eaveHeight = spec.podium + spec.floors * spec.storey;
  const eaveAt = u => eaveHeight - (spec.style === 'sundial' && u < -.15 ? 2.45 : 0)
    - (spec.style === 'panPacific' && u < -8 ? 1.55 : 0);
  const local = points.map(p => frame.inverse(...p));
  const signedArea = points.reduce((sum, [ax, az], i) => {
    const [bx, bz] = points[(i + 1) % points.length];
    return sum + ax * bz - bx * az;
  }, 0);
  grid.addBuilding({ id: spec.id, points, model: group, roofAt: (px, pz) => datum + eaveAt(frame.inverse(px, pz)[0]) + spec.peak,
    upperGround: datum, measured: spec.style === 'sundial' });
  let eastCorner;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < .2) continue;
    const u0 = local[i][0], u1 = local[(i + 1) % local.length][0];
    const top = Math.max(eaveAt(u0), eaveAt(u1));
    const outward = signedArea > 0 ? -1 : 1;
    const face = outward > 0
      ? frameAt(ax, az, -Math.atan2(bz - az, bx - ax), datum)
      : frameAt(bx, bz, -Math.atan2(az - bz, ax - bx), datum);
    const foundation = Math.min(heightAt(ax, az), heightAt(bx, bz), heightAt((ax + bx) / 2, (az + bz) / 2)) - datum - .7;
    grid.addBox((ax + bx) / 2, (az + bz) / 2, len / 2 + .06, .20, Math.atan2(bz - az, bx - ax), 'building-wall',
      { buildingId: spec.id, maxY: datum + top + spec.peak });
    const split = spec.style === 'sundial' ? -.15 : spec.style === 'panPacific' ? -8 : Infinity;
    const left = outward > 0 ? u0 : u1, right = outward > 0 ? u1 : u0;
    const slices = (left < split) !== (right < split) ? [0, (split - left) / (right - left), 1] : [0, 1];
    // Keep continuous foundations even where the upper wings step in height.
    stoneWall(layers, face, 0, len, foundation, spec.podium, .016, spec.stone, spec.style === 'panPacific');
    for (let s = 0; s < slices.length - 1; s++) {
      const a = slices[s], b = slices[s + 1], y = eaveAt(lerp(left, right, (a + b) / 2));
      façadeBox(layers, 'wall', face, len * (a + b) / 2, (spec.podium + y) / 2, -.10,
        len * (b - a) + .04, y - spec.podium + .08, .22, spec.wall);
      façadeBox(layers, 'metal', face, len * (a + b) / 2, y - .16, .026, len * (b - a), .26, .27, spec.sill);
    }
    if (len < 2.2) continue;
    const front = spec.style === 'carleton' ? i < 6 : spec.style === 'sundial' ? i <= 12 : i >= 3 && i < 23;
    const bays = Math.max(1, Math.round(len / (spec.style === 'carleton' && front ? 4.4 : 3.05)));
    for (let j = 0; j < bays; j++) {
      const middle = (j + .5) / bays, center = len * middle, cell = len / bays;
      const edgeTop = eaveAt(lerp(left, right, middle));
      const [sx, , sz] = face.point(center, 0);
      const grade = Math.min(spec.podium - 2.56, Math.max(-.1, heightAt(sx, sz) - datum));
      const display = spec.style === 'sundial' && ((i === 5 || i === 10) && j === 0 || i === 0 && j >= 2 && j % 3 === 2)
        ? 'cafe' : spec.style === 'panPacific' && i === 10 && j % 3 === 0 ? 'boots' : null;
      const salomonBays = spec.style === 'panPacific' && Math.abs(sx - salomonSite.x) < 3.7 && Math.abs(sz - salomonSite.z) < .8;
      if (!salomonBays) storefront(layers, face, center, Math.min(cell * .91, 3.5), grade, spec.style, front, display);
      for (let floor = 0; floor < spec.floors; floor++) {
        const y = spec.podium + (floor + .52) * spec.storey;
        if (edgeTop - y < 1.02) continue;
        const balcony = front && (spec.style === 'carleton' ? j % 2 === 1 || cell > 3.5 :
          spec.style === 'panPacific' ? (j + i) % 3 === 1 : i >= 6 && i <= 12 && (i + j) % 3 === 1);
        const aperture = spec.style === 'carleton' ? .74 : spec.style === 'panPacific' && balcony ? .68 : .52;
        windowBay(layers, face, center, y, Math.min(cell * aperture, 3), balcony ? 1.98 : 1.56,
          spec.style === 'panPacific' ? '#536364' : '#34302d', panes[(floor * 3 + i + j) % panes.length],
          spec.style === 'sundial' ? 3 : 2, spec.style === 'sundial' ? 3 : 2);
        façadeBox(layers, 'wall', face, center, y - .85, .10, cell * aperture + .16, .12, .24, spec.sill);
        if (!balcony) continue;
        const width = cell * .72, depth = spec.style === 'sundial' ? .63 : 1.2, floorY = y - 1.05;
        façadeBox(layers, 'wall', face, center, floorY, depth * .47, width, .19, depth, spec.sill);
        rail(layers, face, center - width / 2, center + width / 2, floorY + .04, depth, '#5e6059', .20);
        for (const turn of [-1, 1]) {
          const ex = center + turn * width / 2;
          layers.metal.push(beam(face.point(ex, floorY + 1, .06), face.point(ex, floorY + 1, depth), .058, .06, steel));
          if (spec.style === 'panPacific') façadeBox(layers, 'wall', face, ex, y + .12, depth * .43,
            .24, 2.35, depth * .84, spec.pier);
        }
      }
      if (spec.style === 'sundial' && front && (i === 0 || i === 4 || i === 5 || i === 10) && cell > 2.15 && (i !== 0 || j % 3 !== 2)) {
        dormer(parent, layers, face, center, edgeTop + .16, -.33, Math.min(cell * .76, 2.13), spec.wall, i * 112 + j + 54);
      }
      if ((spec.style === 'carleton' && front && j === 0) || spec.style === 'panPacific' && (i === 10 || i === 18) && j % 2 === 1) {
        const [rx, ry, rz] = face.point(center + (spec.style === 'carleton' ? cell * .36 : 0), 0, -1.24);
        const span = spec.style === 'carleton' ? Math.min(len * .85, 8.5) : cell * 2.14;
        gable(parent, layers, frameAt(rx, rz, face.yaw + Math.PI / 2, ry), 7.4, span,
          edgeTop - .15, spec.style === 'carleton' ? 1.87 : 2.1, spec.roof, i * 11 + j + 818, { span: spec.pier });
      }
    }
    if (front && spec.style === 'carleton') {
      for (const ex of [0, len * .49]) façadeBox(layers, 'wall', face, ex,
        (.35 + spec.podium + top) / 2, .05, .55, top - spec.podium, .37, spec.pier);
    }
    if (spec.style === 'sundial' && i === 10) eastCorner = { face, len };
  }
  if (eastCorner) {
    const { face, len } = eastCorner;
    projectionBay(group, layers, face, len * .54, Math.min(len * .92, 6.35), spec.podium + .26,
      3, 5, '#9f5c45', 1.24);
  }
  const split = spec.style === 'sundial' ? -.15 : spec.style === 'panPacific' ? -8 : null;
  const wings = split === null ? [local] : [splitAt(local, split, false), splitAt(local, split, true)];
  wings.forEach((wing, i) => {
    const u = wing.reduce((sum, pt) => sum + pt[0] / wing.length, 0);
    const high = i === 1 || wings.length === 1;
    mansard(group, layers, frame, wing, eaveAt(u), spec.peak * (high ? 1 : .79), spec.roof,
      Number(spec.id) % 10000 + i * 95, spec.style === 'sundial');
  });
  if (spec.style === 'sundial') {
    const [rx, ry, rz] = frame.point(9.5, 0, -3.5);
    const roofFrame = frameAt(rx, rz, facing, ry);
    façadeBox(layers, 'wall', roofFrame, 0, eaveHeight + spec.peak + .37, 0, 5.9, .86, 4.3, '#836045');
    gable(group, layers, roofFrame, 6.4, 4.85, eaveHeight + spec.peak + .72, 1.21, '#43515c', 7063, { hip: 2 });
  }
  if (spec.style === 'panPacific') for (const [u, depth, top] of [[4, 2, 23.1], [15.7, -5.8, 23.7], [-15.2, 5.8, 21.1]]) {
    façadeBox(layers, 'wall', frame, u, top - 1.25, depth, 1.44, 3.4, 1.6, '#ad9d80');
    façadeBox(layers, 'roof', frame, u, top + .49, depth, 1.69, .16, 1.82, steel);
  }
  finish(group, layers);
}

function paving(parent) {
  // Skier's Plaza: push the pavers up the north street and west village walk,
  // while the ski return and chair loading apron keep their original snow.
  const perimeter = [[-110, -18], [-106, -27], [-95, -33], [-88, -45], [-86, -80], [-103, -90],
    [-102, -105], [-91, -111], [-81, -99], [-63, -97], [-51, -94], [-41, -104], [-34, -120],
    [-24, -114], [-28, -97], [-22, -91], [0, -94], [22, -97], [35, -91], [30, -74],
    [19, -65], [3, -54], [-13, -42], [-30, -28], [-48, -19], [-61, -16], [-64, -2],
    [-52, 6], [-55, 19], [-65, 20], [-80, 7], [-96, 2], [-108, 8], [-117, 17], [-123, 14], [-118, 0]];
  const { canvas, ctx } = makeCanvas(512, 512);
  const rand = mulberry32(2479);
  ctx.fillStyle = '#70645b'; ctx.fillRect(0, 0, 512, 512);
  for (let j = -1; j < 24; j++) for (let i = -1; i < 12; i++) {
    const x = i * 512 / 12 + (j % 2) * 512 / 24, y = j * 512 / 24;
    const value = Math.round(rand() * 29);
    ctx.fillStyle = `rgb(${128 + value},${111 + value},${98 + value})`;
    ctx.fillRect(x + 1.2, y + 1.1, 40.2, 19.2);
    for (let n = 0; n < 16; n++) {
      ctx.fillStyle = rand() < .44 ? '#d0beaa46' : '#594c3b38';
      ctx.fillRect(x + rand() * 39 + 1, y + rand() * 18 + 1, 2, 1);
    }
  }
  const tex = canvasTexture(canvas, { repeat: [1, 1] }); tex.anisotropy = 8;
  const indices = THREE.ShapeUtils.triangulateShape(perimeter.map(([x, z]) => new THREE.Vector2(x, z)), []);
  const coords = [], uv = [], tints = [], randTone = new THREE.Color(), c = Math.cos(.19), s = Math.sin(.19);
  const surfaceCells = new Map(), cellSize = 3.5;
  const key = (x, z) => `${x}:${z}`;
  function add(a, b, d) {
    const longest = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - d[0], b[1] - d[1]), Math.hypot(d[0] - a[0], d[1] - a[1]));
    if (longest > 3.4) {
      const midpoint = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const ab = midpoint(a, b), bd = midpoint(b, d), da = midpoint(d, a);
      add(a, ab, da); add(ab, b, bd); add(da, bd, d); add(da, ab, bd);
      return;
    }
    const triangle = [a,d,b].map(([x,z]) => [x,heightAt(x,z)+.083,z]);
    const minX = Math.floor(Math.min(a[0],b[0],d[0])/cellSize), maxX = Math.floor(Math.max(a[0],b[0],d[0])/cellSize);
    const minZ = Math.floor(Math.min(a[1],b[1],d[1])/cellSize), maxZ = Math.floor(Math.max(a[1],b[1],d[1])/cellSize);
    for (let cz=minZ;cz<=maxZ;cz++) for (let cx=minX;cx<=maxX;cx++) {
      const id=key(cx,cz);
      if (!surfaceCells.has(id)) surfaceCells.set(id,[]);
      surfaceCells.get(id).push(triangle);
    }
    for (const [x, y, z] of triangle) {
      coords.push(x, y, z);
      uv.push((x * c + z * s) / 3.05, (z * c - x * s) / 3.05);
      const wash = .5 + .5 * Math.sin(x * .16 + Math.sin(z * .15) * .76);
      randTone.setRGB(.80 + .17 * wash, .81 + .14 * wash, .82 + .09 * wash);
      tints.push(randTone.r, randTone.g, randTone.b);
    }
  }
  for (const tri of indices) add(...tri.map(i => perimeter[i]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, side: THREE.DoubleSide, roughness: .95 });
  applyPaverWeather(mat);
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
  mesh.name = 'Skiers Plaza · cleared clay and granite block pavers'; parent.add(mesh);
  return (x, z) => {
    const cell = surfaceCells.get(key(Math.floor(x/cellSize), Math.floor(z/cellSize)));
    if (!cell) return null;
    for (const [a,b,d] of cell) {
      const ux=b[0]-a[0], uz=b[2]-a[2], vx=d[0]-a[0], vz=d[2]-a[2];
      const px=x-a[0], pz=z-a[2], det=ux*vz-uz*vx;
      if (Math.abs(det) < 1e-8) continue;
      const u=(px*vz-pz*vx)/det, v=(ux*pz-uz*px)/det;
      if (u >= -1e-7 && v >= -1e-7 && u+v <= 1+1e-7) return a[1]+u*(b[1]-a[1])+v*(d[1]-a[1]);
    }
    return null;
  };
}

function umbrella(layers, frame, x, z, y, radius, tint) {
  const center = frame.point(x, y, z);
  layers.metal.push(part(new THREE.CylinderGeometry(.032, .035, 2.55, 8), '#53585a', [center[0], center[1] + 1.27, center[2]]));
  const top = frame.point(x, y + 2.51, z);
  const cloth = new THREE.ConeGeometry(radius, .405, 8, 1, true);
  layers.wall.push(part(cloth, tint, top, [0, Math.PI / 8, 0]));
  const rim = new THREE.CylinderGeometry(radius, radius * .996, .125, 8, 1, true);
  layers.wall.push(part(rim, new THREE.Color(tint).multiplyScalar(.84), frame.point(x, y + 2.283, z), [0, Math.PI / 8, 0]));
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI * i / 4 + Math.PI / 8;
    layers.metal.push(beam(frame.point(x, y + 2.58, z), frame.point(x + Math.cos(angle) * radius, y + 2.33, z + Math.sin(angle) * radius), .024, .022, '#57513f'));
  }
}

function cafeTable(layers, frame, x, z, y, color, showUmbrella = true) {
  const pos = (dy, dx = 0, dz = 0) => frame.point(x + dx, y + dy, z + dz);
  layers.metal.push(part(new THREE.CylinderGeometry(.055, .055, .73, 8), '#483d33', pos(.39)));
  layers.timber.push(part(new THREE.CylinderGeometry(.55, .55, .087, 12), '#74634f', pos(.78)));
  for (const side of [-1, 1]) {
    layers.timber.push(box(.37, .064, .38, '#5b4c3e', pos(.47, side * .83), [0, frame.yaw, 0]),
      box(.39, .34, .056, '#514641', pos(.68, side * .99), [0, frame.yaw + Math.PI / 2, 0]));
    for (const p of [-1, 1]) layers.metal.push(box(.035, .45, .03, steel, pos(.22, side * .89, p * .15)));
  }
  if (showUmbrella) umbrella(layers, frame, x, z, y, 1.34, color);
}

function rope(layers, frame, start, end, y, d) {
  const posts = Math.ceil((end - start) / 2.8);
  for (let i = 0; i <= posts; i++) {
    const x = lerp(start, end, i / posts);
    const pos = frame.point(x, y + .49, d);
    layers.timber.push(box(.13, .98, .13, '#917b60', pos, [0, frame.yaw, 0]));
    layers.metal.push(part(new THREE.SphereGeometry(.074, 8, 5), '#3e4242', frame.point(x, y + 1.01, d)));
    if (i === posts) continue;
    const next = lerp(start, end, (i + 1) / posts);
    for (let j = 0; j < 7; j++) {
      function at(t) { return frame.point(lerp(x, next, t), y + .87 - Math.sin(Math.PI * t) * .23, d); }
      layers.timber.push(beam(at(j / 7), at((j + 1) / 7), .039, .039, '#b0a18b'));
    }
  }
}

function patio(parent, grid, walkways, spec) {
  const { x, z, yaw, w, d, top, name, color } = spec;
  const frame = frameAt(x, z, yaw);
  const layers = collect(), group = new THREE.Group(); group.name = name; parent.add(group);
  const hx = w / 2, hz = d / 2, stairs = .18;
  const edgeY = Math.min(...[-hx, hx].flatMap(u => [-hz, hz].map(v => {
    const [px, , pz] = frame.point(u, 0, v);
    return heightAt(px, pz) - frame.y - .16;
  })));
  const topY = Math.max(top, edgeY + .23);
  façadeBox(layers, 'wall', frame, 0, topY - .10, 0, w, .20, d, '#8d8073');
  stoneWall(layers, frame, -hx, hx, edgeY, topY - .11, hz, '#6c6a60');
  const addFloor = (minX, maxX, minZ, maxZ, target) => walkways.push({ frame, minX, maxX, minZ, maxZ, target: frame.y + target });
  addFloor(-hx, hx, -hz, hz, topY);
  const gap = Math.min(1.46, w / 5), stairX = hx - gap;
  rail(layers, frame, -hx + .06, stairX - gap, topY, hz - .065, '#4c4941', .29);
  const [stX, , stZ] = frame.point(stairX, 0, hz + .9);
  const stairGround = heightAt(stX, stZ) - frame.y + .077;
  const steps = Math.max(1, Math.min(11, Math.ceil((topY - stairGround) / stairs)));
  if (topY > stairGround + .07) {
    for (let j = 0; j < steps; j++) {
      const offset = hz + .32 * j;
      const elevation = lerp(topY, stairGround, (j + 1) / steps);
      façadeBox(layers, 'granite', frame, stairX, (elevation + edgeY) / 2, offset + .175, gap * 1.9,
        Math.max(.10, elevation - edgeY + .018), .37, '#777269');
      addFloor(stairX - gap, stairX + gap, offset, offset + .35, elevation);
    }
  }
  const [lx, , lz] = frame.point((-hx + stairX - gap) / 2, 0, hz - .065);
  grid.addBox(lx, lz, (stairX - gap + hx) / 2, .09, -yaw, 'plaza-railing', { minY: frame.y + topY - .1, maxY: frame.y + topY + 1 });
  const seats = Math.floor((w - 2.5) / 2.85);
  for (let i = 0; i < seats; i++) cafeTable(layers, frame, lerp(-hx + 1.36, hx - 2.45, i / Math.max(1, seats - 1)),
    .52 - (i % 2) * 1.1, topY, color, i !== 3);
  finish(group, layers);
}

function leafCluster(layers, origin, r, rand) {
  const colors = ['#526645', '#3e543a', '#63764a', '#486143', '#5c7146'];
  for (const tint of colors) {
    const vertices = [];
    for (let i = 0; i < 56; i++) {
      const az = rand() * Math.PI * 2, u = 2 * rand() - 1;
      const radius = Math.cbrt(rand()) * r, side = Math.sqrt(1 - u * u) * radius;
      const [x, y, z] = [origin[0] + side * Math.cos(az), origin[1] + u * radius, origin[2] + side * Math.sin(az)];
      const s = .045 + .080 * rand(), angle = rand() * Math.PI * 2, pitch = (rand() - .5) * 2.5;
      const a = Math.cos(angle) * s, b = Math.sin(angle) * s, v = Math.cos(pitch) * s, h = Math.sin(pitch) * s;
      const p = [x - a, y - h, z - b], q = [x + b * .67, y + v, z - a * .67],
        t = [x + a, y + h, z + b], d = [x - b * .67, y - v, z + a * .67];
      vertices.push(...p, ...q, ...t, ...p, ...t, ...d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals(); layers.foliage.push(part(geometry, tint));
  }
}

function greenery(layers, x, z, scale, seed) {
  const y = heightAt(x, z) + .21, rand = mulberry32(seed);
  layers.timber.push(part(new THREE.CylinderGeometry(.059 * scale, .127 * scale, 2.2 * scale, 8), '#756b52', [x, y + scale, z]));
  for (let i = 0; i < 12; i++) {
    const angle = i * 2.39996, spread = (.25 + rand() * .83) * scale;
    const end = [x + Math.cos(angle) * spread, y + (2.02 + rand() * .63) * scale, z + Math.sin(angle) * spread];
    layers.timber.push(beam([x, y + (1.18 + rand() * .55) * scale, z], end, .044, .056, '#73684f'));
    leafCluster(layers, [end[0], end[1] + .17, end[2]], (.45 + rand() * .36) * scale, rand);
  }
}

function lamppost(layers, x, z, yaw) {
  const frame = frameAt(x, z, yaw), base = frame.point(0, 0, 0);
  layers.metal.push(part(new THREE.CylinderGeometry(.071, .112, 3.74, 10), '#40515d', [x, base[1] + 1.87, z]));
  const arm = [[0, 3.59, 0], [.38, 3.72, 0], [.72, 3.65, 0], [.89, 3.44, 0]];
  for (let i = 0; i < arm.length - 1; i++) layers.metal.push(beam(frame.point(...arm[i]), frame.point(...arm[i + 1]), .095, .092, '#40515d'));
  layers.metal.push(part(new THREE.CylinderGeometry(.13, .25, .16, 12), '#40515d', frame.point(.89, 3.37)));
  layers.light.push(part(new THREE.SphereGeometry(.142, 10, 5), '#e0ca8d', frame.point(.89, 3.27), [0, 0, 0], [1.26, .44, 1.03]));
}

function patioFrontage(parent, grid, walkways) {
  patio(parent, grid, walkways, { x: -70.1, z: -43, yaw: .85, w: 25.4, d: 6.5, top: .53,
    name: 'Longhorn · slopeside terrace', color: '#eeb630' });
  patio(parent, grid, walkways, { x: -53.8, z: -88.25, yaw: -.32, w: 19.9, d: 4.9, top: .48,
    name: 'Black’s Pub · lower Sundial terrace', color: '#eac23e' });
  patio(parent, grid, walkways, { x: 9.8, z: -94.1, yaw: .28, w: 13.8, d: 4.85, top: .36,
    name: 'Dubh Linn Gate · raised patio', color: '#772d36' });
  const group = new THREE.Group(); group.name = 'Skiers Plaza · planters, lamp posts and patio signage'; parent.add(group);
  const layers = collect();
  const black = frameAt(-51, -93.5, -.31);
  const deck = 2.68;
  façadeBox(layers, 'granite', black, 0, deck - .185, .18, 21.2, .37, 4.25, '#7a786e');
  stoneWall(layers, black, -10.63, 10.63, deck - .39, deck + .13, 2.3, '#878175');
  rail(layers, black, -10.45, 10.46, deck + .04, 2.23, '#463e35', .27);
  for (const x of [-10.1,-4.9,1.3,7.8,10.08]) stoneWall(layers, black, x - .24, x + .24, -.13, deck + .21, 2.19, '#828075');
  for (let i = 0; i < 6; i++) cafeTable(layers, black, -8.3 + i * 3.21, .72, deck + .05, '#f1c543');
  const [rx, ry, rz] = black.point(-3.75, 0, -1.45);
  gable(group, layers, frameAt(rx, rz, black.yaw, ry), 9.9, 4.4, deck + 2.38, .76, '#3b4f54', 1683, { hip: 1.7 });
  panel(group, black, .31, deck + 1.79, -.20, 4.8, .61, 'BLACK’S PUB', { type: 'Georgia', bg: '#24342e', ink: '#c7785b' });
  const longhorn = frameAt(-71.5, -44.2, .86);
  panel(group, longhorn, 0, 2.74, .44, 7.4, .86, 'LONGHORN SALOON', { type: 'Georgia', bg: '#382f22', ink: '#e9c25d' });
  const irish = frameAt(8.6, -97.8, .28);
  panel(group, irish, 0, 2.8, .28, 6.4, .93, 'DUBH LINN GATE', { type: 'Georgia', bg: '#243f38', ink: '#dfbb77', sub: 'IRISH PUB & PATIO' });
  const sundial = frameAt(-51.2, -95.9, -.48);
  panel(group, sundial, 0, 5.8, .53, 4.7, .9, 'SUNDIAL', { type: 'Georgia', bg: '#783f30', ink: '#e8bd83' });
  const wood = frameAt(-49.9, -83.8, -.29);
  // The shallow fence encloses the dining patio and leaves the pedestrian gap open.
  for (const y of [.42, .74]) façadeBox(layers, 'timber', wood, -2.6, y, 0, 15.4, .126, .084, '#b48657');
  for (let i = 0; i < 7; i++) façadeBox(layers, 'timber', wood, -10.23 + 2.53 * i, .47, .018, .12, .94, .128, '#b38860');
  const planters = [[-37.7, -94.3, 3.26], [-59.6, -85.6, 1.55], [-65.9, -87.6, 1.48], [-72.3, -90.5, 1.59], [-83.5, -94.1, 1.22], [-17.3, -84.3, 1.05],
    [21, -84.5, 1.26], [-105.3, -68.6, 1.25], [-96, -24.3, 1.54]];
  for (const [i, [x, z, scale]] of planters.entries()) {
    const y = heightAt(x, z), r = 1.06 + .29 * scale;
    layers.granite.push(part(new THREE.CylinderGeometry(r, r * 1.07, .44, 12), '#8a887c', [x, y + .24, z]));
    layers.granite.push(part(new THREE.CylinderGeometry(r + .07, r + .09, .092, 12), '#a5a092', [x, y + .48, z]));
    layers.wall.push(part(new THREE.CylinderGeometry(r - .15, r - .15, .022, 12), '#4a4937', [x, y + .531, z]));
    greenery(layers, x, z, scale, 147 + i * 91);
    grid.addCircle(x, z, r, 'plaza-planter', { maxY: y + .55 });
  }
  // Recess the shop into the actual Pan Pacific podium wall instead of
  // building a second free-standing stone frontage in the walking lane.
  const salomon = frameAt(salomonSite.x, salomonSite.z, salomonSite.yaw);
  for (const side of [-1,1]) façadeBox(layers,'granite',salomon,-.67+side*2.53,1.38,.20,.285,2.94,.47,'#a19e92');
  façadeBox(layers,'granite',salomon,-.67,2.96,.20,5.34,.30,.47,'#a19e92');
  storefront(layers, salomon, -.71, 1.78, .01, 'panPacific', true);
  displayWindow(layers, salomon, -2.26, 1.31, .01, 'boots');
  displayWindow(layers, salomon, .856, 1.37, .01, 'skis');
  façadeBox(layers, 'metal', salomon, -.67, 2.56, .40, 4.58, .14, .34, '#292820');
  façadeBox(layers, 'metal', salomon, -.71, .105, .632, 1.80, .034, .50, '#474742');
  for (const x of [-4.56, -2.96]) {
    façadeBox(layers, 'metal', salomon, x, .063, .37, .063, .10, .67, '#424b4c');
    façadeBox(layers, 'metal', salomon, x, .43, .28, .065, .84, .065, '#505952');
  }
  for (const y of [.27, .79]) façadeBox(layers, 'metal', salomon, -3.76, y, .28, 1.68, .076, .075, '#48535a');
  for (const [i, tint] of ['#b3a06c', '#58747b', '#83493a', '#d0c7ae', '#5e5e51'].entries()) {
    const x = -4.36 + i * .28;
    for (const side of [-1, 1]) {
      layers.wall.push(beam(salomon.point(x + side * .049, .12, .53), salomon.point(x + side * .049 + (i - 2) * .05,
        1.49 + .061 * (i % 3), .31), .085, .030, tint));
    }
  }
  const [rackX, rackY, rackZ] = salomon.point(-3.76, 0, .29);
  grid.addBox(rackX, rackZ, .85, .31, -salomon.yaw, 'plaza-building-wall', { maxY: rackY + 1.70 });
  façadeBox(layers, 'metal', salomon, -.67, 2.84, .456, 4.61, .60, .11, '#172629');
  panel(group, salomon, -.67, 2.84, .515, 4.45, .52, 'SALOMON  ▰', { border: false, bg: '#172629', ink: '#f0eeeb' });
  for (const [x, z, a] of [[-23.3, -86.4, .6], [-81.8, -84.7, 2.2], [-48.1, -37.2, -.9], [-97.3, -14.2, 1.45]]) lamppost(layers, x, z, a);
  finish(group, layers);
  return group;
}

function stationStorefront(parent, grid, walks) {
  // GLC is part of the gondola station. Its eastern wing starts near the
  // surveyed pub point. The operating drive and both cabins pass to the west.
  const group = new THREE.Group(); group.name = 'Garibaldi Lift Co. · station annex and ski rentals'; parent.add(group);
  const layers = collect(), frame = frameAt(-60.15, 9.5, Math.PI + .125);
  const width = 21.7, half = width / 2, deckY = 3.78, terraceFront = 1.32;
  const g = (band, x, y, z, w, h, d, color) => façadeBox(layers, band, frame, x, y, z, w, h, d, color);
  const worldFloor = Math.min(...[-half, half].map(u => {
    const [x, , z] = frame.point(u, 0, terraceFront);
    return heightAt(x, z) - frame.y;
  })) - .48;
  g('wall', 0, (worldFloor + deckY) / 2, -3.7, width, deckY - worldFloor, 9.9, '#716b5c');
  g('wall', 0, deckY, -3.7, width + .30, .23, 9.92, '#898376');
  for (let i = 0; i < 5; i++) {
    const x = -7.68 + i * 3.31;
    // The base façade faces the plaza with the same rhythm of narrow glazed doors.
    windowBay(layers, frame, x, 1.45, 3.16, 2.23, '#b9bab1', '#485b5b', 3, 2, terraceFront + .04);
  }
  for (const x of [-half + .32, half - .35]) stoneWall(layers, frame, x - .32, x + .32, worldFloor, deckY - .57, terraceFront + .05, '#88887a');
  panel(group, frame, .61, 2.89, terraceFront + .065, 15.4, .47, 'SKI & SNOWBOARD RENTALS',
    { border: false, bg: '#292725', ink: '#f1e4d1' });
  panel(group, frame, -.75, 7.32, -2.10, 4.43, 1.15, 'GARIBALDI LIFT CO.',
    { type: 'Georgia', bg: '#32322a', ink: '#e0d1b0', sub: 'WHISTLER MOUNTAIN' });
  g('wall', -.9, 5.37, -5.29, 17.35, 3.17, 5.94, '#514d3f');
  for (let i = 0; i < 6; i++) {
    const x = -8.15 + i * 2.9;
    windowBay(layers, frame, x, 5.91, 2.67, 2.98, '#46545a', panes[i], 2, 2, -2.27);
  }
  const l = -10.1, r = 8.5, back = -8.5, nose = -1.83;
  roofSkin(group, layers, [frame.point(l, 8.55, back), frame.point(r, 7.13, back),
    frame.point(r, 7.75, nose), frame.point(l, 9.17, nose)], '#4b5e62', 2171, { seams: .50, snow: .33, icicles: true });
  eave(layers, frame.point(l, 9.19, nose), frame.point(r, 7.77, nose));
  g('granite', 2.5, 8.73, -6.33, 1.2, 2.97, 1.42, '#5a5146');
  g('roof', 2.5, 10.3, -6.33, 1.45, .21, 1.67, '#424849');
  rail(layers, frame, -half + .2, half - .12, deckY, terraceFront, '#596166', .17);
  for (let i = 0; i < 5; i++) cafeTable(layers, frame, -7.65 + i * 3.4, -.28, deckY + .07, '#304b74');
  // Stone operations tower and period status panel sit outside the turnaround.
  g('metal', -11.35, 3.62, .55, 2.47, 7.26, 2.1, '#394446');
  g('glass', -11.35, 3.63, 1.63, 1.98, 2.62, .07, '#42555a');
  panel(group, frame, -11.35, 3.76, 1.69, 1.78, .8, 'GARIBALDI',
    { type: 'Georgia', bg: '#3c4039', sub: 'LIFT CO.' });
  panel(group, frame, -11.35, 6.53, 1.69, 2.06, .72, 'WHISTLER', { bg: '#272e30', sub: 'MOUNTAIN' });
  const runs = ['VILLAGE GONDOLA', 'EMERALD EXPRESS', 'BIG RED EXPRESS', 'CREEKSIDE GONDOLA', 'FITZSIMMONS EXPRESS', 'GARBANZO EXPRESS', 'PEAK 2 PEAK', 'HARMONY 6 EXPRESS'];
  const { canvas, ctx } = makeCanvas(340, 315);
  ctx.fillStyle = '#232b2a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle'; ctx.font = 'bold 25px "Arial Narrow", Arial';
  runs.forEach((run, i) => {
    const y = 23 + i * 38;
    ctx.fillStyle = '#e7e2c8'; ctx.fillText(run, 10, y, 261);
    for (const [x, color] of [[289, i === 6 ? '#633a33' : '#95cf72'], [319, i === 6 ? '#d4634f' : '#445242']]) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    }
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.89), new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: .68 }));
  board.name = 'Whistler Mountain · multi-lift dispatch board';
  board.position.fromArray(frame.point(-11.35, 5.18, 1.696)); board.rotation.y = frame.yaw; group.add(board);
  // The retired silver cabin is a display above the stairs, outside the live
  // gondola's swept volume. It has its own hanger and opaque lower doors.
  const displayed = -13.62;
  g('metal', displayed, 3.97, -.24, 1.73, 1.35, 1.32, '#8d9b99');
  g('metal', displayed, 4.93, -.24, 1.45, .61, 1.20, '#899794');
  windowBay(layers, frame, displayed, 4.78, 1.42, .81, '#959e97', '#667b80', 3, 1, .42);
  layers.metal.push(part(new THREE.SphereGeometry(1, 12, 6), '#aeb9b5', frame.point(displayed, 5.24, -.24),
    [0, frame.yaw, 0], [.86, .27, .72]));
  layers.metal.push(beam(frame.point(displayed, 5.27, -.24), frame.point(-11.73, 6.18, -.20), .12, .10, '#747d76'));
  g('metal', displayed, 3.87, .44, .42, .25, .032, '#447d76');
  // Plausible access beside the office tower, on the eastern side of the terminal.
  const sx = -11.13, stZ = -1.2;
  for (let i = 0; i < 21; i++) {
    const top = (i + 1) * deckY / 21, z = stZ - i * .277;
    g('granite', sx, (top + worldFloor) / 2, z, 1.72, top - worldFloor, .285, '#726e61');
    walks.push({ frame, minX: sx - .87, maxX: sx + .87, minZ: z - .144, maxZ: z + .144, target: frame.y + top });
  }
  for (const edge of [-.9, .9]) layers.metal.push(beam(frame.point(sx + edge, 1.1, stZ + .16),
    frame.point(sx + edge, deckY + .93, stZ - 5.81), .071, .071, '#4e5759'));
  walks.push({ frame, minX: -half - 1.1, maxX: half, minZ: -8.65, maxZ: terraceFront, target: frame.y + deckY + .08 });
  const [fx, , fz] = frame.point(.35, 0, terraceFront);
  grid.addBox(fx, fz, half - .3, .16, -frame.yaw, 'plaza-building-wall', { maxY: frame.y + deckY - .105 });
  const [rx, , rz] = frame.point(.35, 0, terraceFront);
  grid.addBox(rx, rz, half - .3, .12, -frame.yaw, 'plaza-railing', { minY: frame.y + deckY + .10, maxY: frame.y + deckY + 1.05 });
  rope(layers, frame, -7.3, 6.2, .10, 4.95);
  const red = frameAt(-44.7, 6.4, -.1);
  const fabric = new THREE.ConeGeometry(2.33, .91, 4, 1, true);
  layers.wall.push(part(fabric, '#a92338', red.point(0, 2.62), [0, red.yaw + Math.PI / 4, 0]));
  for (const x of [-1.65, 1.65]) for (const z of [-1.65, 1.65]) {
    const [px, , pz] = red.point(x, 0, z);
    const ground = heightAt(px, pz), top = red.y + 2.28;
    layers.metal.push(beam([px, ground, pz], [px, top, pz], .045, .045, '#aebab8'));
    grid.addCircle(px, pz, .07, 'plaza-canopy', { maxY: top });
  }
  façadeBox(layers, 'wall', red, 0, 2.17, 1.66, 3.31, .19, .025, '#a72339');
  finish(group, layers);
}

function summerSign(parent) {
  const group = new THREE.Group(); group.name = 'Bike park · seasonal plaza approach'; parent.add(group);
  const layers = collect();
  const frame = frameAt(-35.2, -83.1, -.38);
  for (const [u, offset] of [[0, 0], [4.7, -.75]]) {
    const width = 2.7;
    for (const x of [-width / 2, width / 2]) {
      façadeBox(layers, 'metal', frame, x + u, .48, offset, .05, .95, .054, '#879caa');
      façadeBox(layers, 'metal', frame, x + u, .075, offset, .06, .064, .8, '#778893');
    }
    for (const y of [.15, .94]) façadeBox(layers, 'metal', frame, u, y, offset, width, .051, .047, '#96a7ae');
    for (let i = 0; i < 15; i++) façadeBox(layers, 'metal', frame, u - width / 2 + (i + 1) * width / 16,
      .545, offset, .027, .79, .027, '#899da6');
  }
  panel(group, frame, -.21, .57, .036, 2.18, .51, 'PLEASE WALK BIKES',
    { border: false, bg: '#ddba26', ink: '#252423' });
  finish(group, layers);
  return group;
}

export function buildSkiersPlaza(scene, { grid }) {
  const group = new THREE.Group(); group.name = 'Whistler Village · Skiers Plaza'; scene.add(group);
  const walks = [];
  const pavedHeightAt = paving(group);
  const snowBanks = makeShoveledBanks();
  group.add(snowBanks);
  for (const spec of specs) building(group, grid, spec);
  const planters = patioFrontage(group, grid, walks);
  stationStorefront(group, grid, walks);
  const bikePark = summerSign(group);
  const lights = [], winterSurfaces = [];
  group.traverse(mesh => {
    if (mesh.name === 'light') lights.push(mesh.material);
    if (mesh.geometry?.attributes.meltAnchor) winterSurfaces.push(mesh);
  });
  const deciduous = planters.getObjectByName('foliage');
  let roofsVisible;
  cacheStaticTransforms(group);
  return {
    group,
    socialSlots: [[-44.3, -86.6, .5], [-45.3, -86.1, 1.8], [-43.9, -85.1, -2.5],
      [-33, -88.2, -.8], [-32, -87.4, 2.3], [-27.0, -83.1, -.3], [-27.8, -82.7, .9],
      [-9.6, -88.1, -2.97], [-9.7, -86.91, -2.97], [-9.8, -85.72, -2.97],
      [-55.76, -83.55, -2.92], [-56.92, -83.04, 2.93],
      [-44.3, -33.1, .4], [-43.6, -32.3, -2.7]]
      .filter(([x, z]) => guestClear(x, z, .44, grid.query(x, z, 1.5), heightAt(x, z)))
      .map(([x, z, heading]) => ({ x, z, heading, y: pavedHeightAt(x,z) ?? heightAt(x,z), lodge: 'skiers-plaza' })),
    update(_dt, _time, camera) {
      const close = !camera || Math.hypot(camera.position.x + 46, camera.position.z + 60) < 900;
      const snow = climateUniforms.snowpack.value;
      snowBanks.visible = close && snow > .75;
      const winter = close && snow > .22;
      if (winter !== roofsVisible) {
        for (const surface of winterSurfaces) surface.visible = winter;
        roofsVisible = winter;
      }
      if (!close) return;
      for (const material of lights) material.emissiveIntensity = .14 + climateUniforms.night.value * .85;
      if (deciduous) deciduous.visible = snow < .91;
      bikePark.visible = snow < .4;
    },
    walkSurfaceAt(x, z, y) {
      if (x < -125 || x > 40 || z < -122 || z > 25) return null;
      const ground = heightAt(x, z);
      let surface = pavedHeightAt(x,z);
      for (const { frame, minX, maxX, minZ, maxZ, target } of walks) {
        if (target < ground - .03 || (y !== undefined && target > y + .52)) continue;
        const [u, v] = frame.inverse(x, z);
        if (u >= minX && u <= maxX && v >= minZ && v <= maxZ && (surface === null || target > surface)) surface = target;
      }
      return surface;
    },
  };
}
