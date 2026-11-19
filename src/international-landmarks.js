import * as THREE from 'three';
import { beam, box, mergedMesh, part } from './scenery.js';
import { liftFrame, liftPoint } from './mapped-lift-profile.js';
import { pointInPolygon } from './mapped-resort-ground.js';
import { makeTextTexture } from './util.js';
import { finishLandmarkMaterial } from './international-landmark-materials.js';
import { buildNisekoLandmarks } from './niseko-landmarks.js';
import { createIcicles, createRoofSnow } from './roof-weather.js';

const concrete = '#a5a49d', snow = '#e1e8e9', trim = '#a9b6bf';
const steel = '#596970', iron = '#333d43', zinc = '#b9c2c6';
const windowColor = '#263d49', basalt = '#626464';
const midpoint = (a, b) => (a + b) * .5;

function setUp(scene, name, ground, env, floorTests, x = 0, y = 0, z = 0, yaw = 0) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, y, z);
  group.rotation.y = yaw;
  scene.add(group);
  const colorParts = [], panels = new Map();
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const world = ([px, py, pz]) => [x + px * cos + pz * sin, py + y, z + pz * cos - px * sin];
  const floor = (px, pz) => {
    const [wx, , wz] = world([px, 0, pz]);
    return ground.heightAt(wx, wz) - y;
  };
  function block(w, h, d, color, px, py, pz) {
    colorParts.push(box(w, h, d, color, [px, py, pz]));
  }
  function line(a, b, width, color, depth = width) {
    colorParts.push(beam(a, b, width, depth, color));
  }
  function sheet(a, b, c, d, color, opacity = 1, finish) {
    const key = color + opacity + finish;
    if (!panels.has(key)) panels.set(key, { color, opacity, finish, points: [] });
    panels.get(key).points.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  function barrier(a, b, top, bottom, depth = .18) {
    const [ax, , az] = world(a), [bx, , bz] = world(b);
    env.addBox(midpoint(ax, bx), midpoint(az, bz), Math.hypot(ax - bx, az - bz) * .5, depth,
      Math.atan2(bz - az, bx - ax), 'building', { minY: bottom + y, maxY: top + y });
  }
  function surface(a, b, width, margin = .12, maxRise = Infinity) {
    const [ax, ay, az] = world(a), [bx, by, bz] = world(b);
    const length = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / length, dz = (bz - az) / length;
    floorTests.push((qx, qz, currentY) => {
      const rx = qx - ax, rz = qz - az;
      const t = rx * dx + rz * dz;
      if (t < -margin || t > length + margin || Math.abs(rx * dz - rz * dx) > width * .5) return;
      const surfaceY = THREE.MathUtils.lerp(ay, by, THREE.MathUtils.clamp(t / length, 0, 1));
      if (currentY == null || surfaceY <= currentY + maxRise) return surfaceY;
    });
  }
  function deck(outline, height, holes = []) {
    const points = [...outline, ...holes.flat()];
    const vectors = loop => loop.map(([x, z]) => new THREE.Vector2(x, z));
    for (const face of THREE.ShapeUtils.triangulateShape(vectors(outline), holes.map(vectors))) {
      const [a, b, c] = face.map(index => [points[index][0], height, points[index][1]]);
      sheet(a, b, c, c, zinc);
    }
    floorTests.push((x, z) => pointInPolygon(x, z, outline)
      && !holes.some(hole => pointInPolygon(x, z, hole)) ? height : undefined);
  }
  function circle(radius, thickness, color, position, rotation = [Math.PI / 2, 0, 0]) {
    colorParts.push(part(new THREE.TorusGeometry(radius, thickness, 8, 40), color, position, rotation));
  }
  function sign(title, px, py, pz, width, facing = 0, height = width * .19) {
    const map = makeTextTexture(title, {
      width: 768, height: 146, font: '700 88px Barlow Condensed,Arial',
      fg: '#e6edef', bg: '#27353e', border: '#ced9db',
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ map, roughness: .69 }));
    mesh.position.set(px, py, pz);
    mesh.rotation.y = facing;
    group.add(mesh);
  }
  function finish() {
    if (colorParts.length) {
      group.add(mergedMesh(colorParts, { roughness: .77, metalness: .1 }));
      for (const item of colorParts) item.geo.dispose();
    }
    for (const { color, opacity, finish, points } of panels.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      geometry.computeVertexNormals();
      const glass = opacity < 1;
      const material = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide,
        roughness: glass ? .21 : finish === 'glazing' ? .22 : .86,
        metalness: glass || finish === 'glazing' ? .19 : .04,
        opacity, transparent: glass, depthWrite: !glass });
      const mesh = new THREE.Mesh(geometry, finishLandmarkMaterial(material, finish));
      mesh.castShadow = !glass;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return { group, block, line, floor, sheet, barrier, surface, deck, circle, sign, finish };
}

function guard(model, a, b, glass = false) {
  const raised = (p, h) => [p[0], p[1] + h, p[2]];
  const length = Math.hypot(a[0] - b[0], a[2] - b[2]);
  const count = Math.max(1, Math.ceil(length / 1.55));
  const height = 1.12;
  model.line(raised(a, height), raised(b, height), .054, steel);
  model.line(raised(a, .10), raised(b, .10), .045, steel);
  for (let i = 0; i <= count; i++) {
    const p = a.map((v, j) => THREE.MathUtils.lerp(v, b[j], i / count));
    model.line(p, raised(p, height), .049, zinc);
  }
  if (glass) model.sheet(raised(a, .1), raised(b, .1), raised(b, height), raised(a, height), '#80acbf', .30);
  else for (let i = 1; i < count * 5; i++) {
    const p = a.map((v, j) => THREE.MathUtils.lerp(v, b[j], i / (count * 5)));
    model.line(raised(p, .1), raised(p, height), .027, zinc);
  }
  model.barrier(a, b, Math.max(a[1], b[1]) + height, Math.min(a[1], b[1]) + .1, .06);
}

function platform(model, x, z, y, w, d) {
  model.block(w, .26, d, steel, x, y - .13, z);
  for (let px = x - w / 2 + .22; px < x + w / 2; px += .46) {
    model.block(.038, .032, d, zinc, px, y, z);
  }
  model.surface([x, y, z - d / 2], [x, y, z + d / 2], w);
}

function galzig(scene, config, ground, env, floors) {
  const { points } = config.lifts.find(({ id }) => id === 'galzigbahn');
  const frame = liftFrame(liftPoint(points[0]), liftPoint(points[1]));
  const y = ground.heightAt(frame.x, frame.z) - .35;
  const m = setUp(scene, 'Galzigbahn · driendl glass terminal', ground, env, floors,
    frame.x, y, frame.z, frame.heading);
  // East-facing glass apron and the opened, uphill end over the Funitel lanes.
  const sections = [
    [-24, 11.3, 2.5, 3.5, 10.5], [-21, 11.4, 3.1, 5.1, 8.7],
    [-16, 11.5, 4.0, 8.6, 8.1], [-11, 11.6, 5.3, 12.4, 8.3],
    [-6, 11.8, 5.6, 15.0, 8.5], [0, 11.9, 6.2, 15.3, 8.7],
    [6, 11.8, 7.6, 15.2, 8.6], [12, 11.7, 8.5, 15.0, 8.5],
    [18, 11.0, 9.2, 15.0, 8.3], [24, 10.5, 9.9, 15.2, 8.3],
    [30, 10, 10.7, 15.8, 8.3], [36, 9.6, 11.8, 16.7, 8.3],
    [42, 9.0, 13.1, 17.8, 8.1],
  ];
  const bands = sections.map(([z, flank, baseline, crest, roofHalf]) =>
    [[-flank, baseline, z], [-roofHalf, crest - 1.25, z], [-roofHalf * .6, crest - .30, z],
      [0, crest, z], [roofHalf * .6, crest - .30, z], [roofHalf, crest - 1.25, z], [flank, baseline, z]]);
  const concreteColors = ['#b3b1aa', '#a4a6a4', '#bcb9b2'];
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    for (let j = 1; j < band.length; j++) m.line(band[j - 1], band[j], .097, iron);
    if (i === 0) continue;
    const before = bands[i - 1];
    for (let j = 1; j < band.length; j++) {
      m.sheet(before[j - 1], before[j], band[j], band[j - 1], j % 2 ? '#6596af' : '#7fabbe', .39);
      m.line(before[j - 1], band[j - 1], .09, steel);
      m.line(before[j - 1], band[j], .081, j === 1 || j === 6 ? zinc : steel);
    }
    m.line(before.at(-1), band.at(-1), .13, iron);
    for (const j of [0, band.length - 1]) {
      const a = before[j], b = band[j];
      const bottom = (p) => [p[0], Math.min(m.floor(p[0], p[2]) - .6, p[1] - .8), p[2]];
      // The open apron gives the skier a line into the original boarding queue.
      if (j === 0 || i < 2 || i > 5) {
        m.sheet(bottom(a), bottom(b), b, a, concreteColors[i % concreteColors.length]);
        m.barrier(a, b, Math.max(a[1], b[1]), Math.min(bottom(a)[1], bottom(b)[1]));
      } else {
        m.line(a, b, .31, concrete, .45);
        m.line(bottom(a), a, .32, concrete, .52);
      }
      m.line(a, b, .22, concrete, .31);
    }
  }
  for (let j = 0; j < bands[3].length - 1; j++) {
    const a = bands[0][j], b = bands[0][j + 1], c = bands[4][j + 1], d = bands[4][j];
    m.line(a, c, .11, zinc);
    m.line(b, d, .09, steel);
  }
  m.block(20.8, .29, 1.35, concrete, 0, 2.72, -24.0);
  for (let i = -5; i <= 5; i++) {
    const x = i * 1.76;
    m.sheet([x - .84, .14, -23.7], [x + .84, .14, -23.7], [x + .84, 2.57, -23.7],
      [x - .84, 2.57, -23.7], i === 2 || i === 3 ? '#91a8a9' : '#456e7d', .67);
    m.line([x - .88, .14, -23.72], [x - .88, 2.62, -23.72], .09, steel);
  }
  m.sign('GALZIGBAHN', -.4, 3.36, -24.7, 6.4, Math.PI, .66);
  // The photographed 9 m raise wheels are visible through the glass.
  for (const x of [-2.9, 2.9]) {
    m.circle(4.44, .16, '#4d778e', [x, 6.47, 5], [0, Math.PI / 2, 0]);
    m.circle(4.18, .073, steel, [x, 6.47, 5], [0, Math.PI / 2, 0]);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      m.line([x, 6.47, 5], [x, 6.47 + 4.33 * Math.sin(a), 5 + 4.33 * Math.cos(a)], .14, steel);
    }
  }
  for (const side of [-1, 1]) {
    m.circle(1.64, .11, steel, [side * 10.72, 6.19, 22.6], [0, Math.PI / 2, 0]);
    m.sheet([side * 10.76, 5, 21.4], [side * 10.76, 5, 23.8], [side * 10.76, 7.38, 23.8],
      [side * 10.76, 7.38, 21.4], windowColor);
  }
  m.finish();
}

function anteroom(m, x, z, y, w, d, height, { liftMouth = false, skirtDepth = Infinity, parapet = false } = {}) {
  const left = x - w / 2, right = x + w / 2, front = z - d / 2, back = z + d / 2;
  const roof = y + height;
  m.block(w + .45, .27, d + .46, '#808487', x, roof, z);
  const top = roof+.137;
  const edge = [left-.17,right+.17,front-.17,back+.17];
  m.group.add(createRoofSnow([[edge[0],top,edge[2]],[edge[1],top,edge[2]],
    [edge[1],top,edge[3]],[edge[0],top,edge[3]]],
  { seed: 29001+Math.round(w*61), depth: parapet ? .31 : .24, spacing: .72, overhang: .10 }));
  for (const px of edge.slice(0,2)) {
    m.group.add(createIcicles([px,roof+.024,edge[2]], [px,roof+.024,edge[3]],
      { seed: 1905+Math.round(Math.abs(px)*17), spacing: .69, length: .23 }));
  }
  const glass = ['#3a5366', '#526e7a', '#46606a', '#67767a', '#3d596d', '#637983'];
  const faces = [[left, front, left, back], [right, back, right, front], [left, back, right, back]];
  if (!liftMouth) faces.push([right, front, left, front]);
  for (const [face, [ax, az, bx, bz]] of faces.entries()) {
    const a = [ax, y, az], b = [bx, y, bz];
    const lower = (px, pz) => Math.max(y - skirtDepth, Math.min(m.floor(px, pz) - .45, y - .28));
    const sill = y + height * .50, lintel = roof - Math.min(height * .20, 1.05);
    const plinth = y + .56;
    const bays = Math.ceil(Math.hypot(ax - bx, az - bz) / 2.10);
    const at = (t, level, inset = 0) => {
      const px = THREE.MathUtils.lerp(ax, bx, t), pz = THREE.MathUtils.lerp(az, bz, t);
      return [THREE.MathUtils.lerp(px, x, inset), level, THREE.MathUtils.lerp(pz, z, inset)];
    };
    const faceBand = (t0, t1, low, high, color, finish) =>
      m.sheet(at(t0, low), at(t1, low), at(t1, high), at(t0, high), color, 1, finish);
    for (let i = 0; i < bays; i++) {
      const start = i / bays, end = (i + 1) / bays;
      const foundation = (t) => {
        const [px, , pz] = at(t, 0, .36);
        return [px, Math.min(m.floor(px, pz) - .42, y - .36), pz];
      };
      m.sheet(foundation(start), foundation(end), at(end, plinth), at(start, plinth),
        i % 3 === 1 ? '#737473' : '#686d6d', 1, 'masonry');
      const gap = .004;
      faceBand(start + gap, end - gap, plinth, sill, i % 3 === 0 ? '#a1a19b' : '#aeada2', 'concrete');
      faceBand(start + gap, end - gap, lintel, roof, '#969a99', 'concrete');
      faceBand(start + gap, end - gap, sill, lintel, glass[(i * 5 + face * 3) % glass.length], 'glazing');
      m.line(at(start, plinth), at(start, roof), .075, '#747c7e');
      if (height > 9) {
        const midway = sill + (lintel - sill) * .36;
        m.line(at(start, midway), at(end, midway), .096, '#adb4b2');
      }
      if (parapet && i % 2 === 0) {
        const h = .68 + (i % 3) * .13;
        faceBand(start + .02, end - .02, roof + .10, roof + h, '#999d9c', 'concrete');
        m.line(at(start + .02, roof + h), at(end - .02, roof + h), .10, snow, .15);
      }
    }
    for (const level of [plinth, sill, lintel, roof]) {
      m.line(at(0, level), at(1, level), .126, level === sill ? '#8b9a9f' : '#777f81', .15);
    }
    if (height > 9) m.line(at(0, midpoint(plinth, sill)), at(1, midpoint(plinth, sill)), .052, '#686d6a');
    m.barrier(a, b, roof, Math.min(lower(ax, az), lower(bx, bz)));
  }
  if (liftMouth) {
    const head = y + height * .73;
    m.sheet([left, head, front], [right, head, front], [right, roof, front], [left, roof, front],
      '#929892', 1, 'concrete');
    m.line([left, head, front], [right, head, front], .26, iron, .38);
    for (const px of [left, right]) m.line([px, y - .14, front], [px, roof, front], .34, steel, .52);
  }
}

function montFort(scene, config, ground, env, floors) {
  const { points } = config.lifts.find(({ id }) => id === 'mont-fort');
  const anchor = liftPoint(points.at(-1));
  const frame = liftFrame(anchor, liftPoint(points.at(-2)));
  const station = setUp(scene, 'Mont Fort · cable-car terminal', ground, env, floors,
    anchor.x, ground.heightAt(anchor.x, anchor.z), anchor.z, frame.heading + Math.PI);
  anteroom(station, 0, -.5, 0, 10.4, 13.7, 6.4, { liftMouth: true });
  for (const side of [-1, 1]) {
    station.sheet([side * 5.55, 6.59, -7.5], [side * 5.55, 6.59, 6.6],
      [0, 7.72, 6.6], [0, 7.72, -7.5], '#766866');
    for (let i = 1; i <= 11; i++) {
      const t = i / 12;
      const x = side * 5.55 * t, y = THREE.MathUtils.lerp(7.76, 6.63, t);
      station.line([x, y, -7.47], [x, y, 6.57], .041, i % 3 ? '#655654' : '#8b7c76');
    }
  }
  station.sign('MONT-FORT', 0, 5.77, -7.38, 5.4, Math.PI, .72);
  for (const side of [-1, 1]) {
    station.sign('MONT-FORT', side * 5.28, 2.62, .2, 4.9, side * Math.PI / 2, .66);
  }
  station.finish();
  const m = setUp(scene, 'Mont Fort · panorama platform and seven stair flights', ground, env, floors);
  const route = [
    [977.8, 3308.0, 3005.5], [981.9, 3310.85, 3000.1],
    [987.8, 3313.2, 2993.3], [991.0, 3315.65, 2988.8],
    [991.15, 3316.5, 2985.2], [994.45, 3320.05, 2980.4],
    [997.1, 3323.0, 2976.2], [1001.15, 3327.55, 2969.2],
  ];
  const steps = [11, 22, 24, 26, 20, 13, 14]; // 130 treads according to the fabricator.
  const w = 1.8;
  const entrance = [975.1, 3306.65, 3007.4], landing = route[0];
  m.surface(entrance, landing, w);
  m.line(entrance, landing, w, steel, .16);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    const nx = dz / length, nz = -dx / length;
    const count = steps[i - 1];
    for (let j = 0; j < count; j++) {
      const t = (j + .5) / count;
      m.line([a[0] + dx * t - nx * w / 2, THREE.MathUtils.lerp(a[1], b[1], t), a[2] + dz * t - nz * w / 2],
        [a[0] + dx * t + nx * w / 2, THREE.MathUtils.lerp(a[1], b[1], t), a[2] + dz * t + nz * w / 2],
        length / count + .025, zinc, .063);
    }
    const edge = (p, side) => [p[0] + nx * side * w / 2, p[1] - .04, p[2] + nz * side * w / 2];
    for (const side of [-1, 1]) {
      m.line(edge(a, side), edge(b, side), .13, steel, .19);
      // Leave room to turn from the top flight onto the terrace.
      const railEnd = i === route.length - 1 && side === -1
        ? b.map((v, axis) => THREE.MathUtils.lerp(v, a[axis], .28)) : b;
      guard(m, edge(a, side), edge(railEnd, side));
    }
    const pedestal = m.floor(b[0], b[2]) - .28;
    if (b[1] > pedestal + .48) {
      m.block(.66, b[1] - pedestal, .66, concrete, b[0], midpoint(pedestal, b[1]), b[2]);
    }
    m.surface(a, b, w, .6);
    m.line([b[0] - nx, b[1] - .08, b[2] - nz], [b[0] + nx, b[1] - .08, b[2] + nz], .71, steel, .16);
  }
  const y = route.at(-1)[1];
  const outline = [[1000.1, 2969.2], [1002.65, 2968.9], [1010.9, 2987.5],
    [1006.0, 2990.75], [998.9, 2987.65], [1001.0, 2974.0]];
  const rock = [[1001.4, 2980.3], [1002.65, 2980.0], [1002.75, 2981.7], [1001.15, 2981.8]];
  m.deck(outline, y, [rock]);
  for (let i = 1; i < outline.length; i++) {
    const [ax, az] = outline[i], [bx, bz] = outline[(i + 1) % outline.length];
    m.line([ax, y - .16, az], [bx, y - .16, bz], .22, iron, .28);
    guard(m, [ax, y, az], [bx, y, bz], true);
  }
  for (const [x, z] of [[1002, 2972.9], [1003.6, 2977.6], [1004.4, 2982.2], [1007.8, 2987.3]]) {
    const bottom = m.floor(x, z) - .38;
    m.line([x, bottom, z], [x, y - .15, z], .27, steel);
  }
  for (const x of [1001.76, 1002.04]) m.block(.09, 3.1, .10, iron, x, y + 1.43, 2980.9);
  for (const h of [2.18, 2.39]) m.block(2.13, .085, .105, iron, 1001.9, y + h, 2980.9);
  const igloo = new THREE.SphereGeometry(3.9, 24, 12, 0, Math.PI * 2, 0, Math.PI * .5);
  const snowDome = new THREE.Mesh(igloo, new THREE.MeshStandardMaterial({ color: snow, roughness: .91 }));
  snowDome.position.set(983.9, m.floor(983.9, 3015.7) + .25, 3015.7);
  snowDome.scale.y = .78;
  snowDome.castShadow = true;
  m.group.add(snowDome);
  m.finish();
}

function aiguilleDuMidi(scene, _config, ground, env, floors) {
  const m = setUp(scene, 'Aiguille du Midi · Piton Nord and bridge', ground, env, floors);
  // The LiDAR strips the overhanging station, exposing the cliff below its foundations.
  // Taper the retaining wall at the lift mouth so the upper cable meets an open berth.
  anteroom(m, 1566, 3339.2, 3777, 21.4, 17.3, 14.3, { liftMouth: true, skirtDepth: 6, parapet: true });
  m.block(21.8, .32, 17.9, concrete, 1566, 3776.84, 3339.2);
  m.surface([1566, 3777, 3330.4], [1566, 3777, 3347.8], 21.2);
  m.block(3.8, 6.8, 5.3, '#959b99', 1573.4, 3792.4, 3330.3);
  m.block(4.02, .23, 5.48, snow, 1573.4, 3795.84, 3330.3);
  m.sign('AIGUILLE DU MIDI', 1566, 3789.4, 3330.49, 9.9, Math.PI, 1.08);
  m.sign('PITON NORD', 1576.76, 3782.04, 3338.65, 5.4, Math.PI / 2, .84);
  m.sign('3777 m', 1564.6, 3780.3, 3347.9, 2.8, 0, .66);
  anteroom(m, 1547.4, 3357.5, 3773.8, 14.8, 12.2, 13.6, { skirtDepth: 6, parapet: true });
  anteroom(m, 1533.7, 3366.9, 3774.4, 15.9, 11.1, 16.2, { skirtDepth: 8.8, parapet: true });
  m.sign('LE 3842', 1541.67, 3781.3, 3365.6, 4.1, Math.PI / 2, .81);
  for (const side of [-1, 1]) {
    const px = 1566 + side * 10.4;
    const bottom = m.floor(px - side * 2.7, 3334.3);
    m.line([px - side * 2.7, bottom - .31, 3334.3], [px, 3777, 3331.1], .53, steel, .58);
  }
  m.block(9.6, .82, 7.2, concrete, 1541.0, 3774.8, 3362.0);
  for (const [x, z, y, w, d] of [
    [1578.9, 3335.9, 3793.5, 7.0, 8.1], [1567, 3351.4, 3777, 20.2, 7.6],
    [1574.5, 3356.9, 3777, 5.6, 5.3],
  ]) {
    platform(m, x, z, y, w, d);
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    if (z < 3340) guard(m, [x0, y, z0], [x1, y, z0]);
    guard(m, [x1, y, z0], [x1, y, z > 3355 ? 3356.4 : z1]);
    if (z < 3340) {
      guard(m, [x0, y, z1], [x1, y, z1]);
      guard(m, [x0, y, z0], [x0, y, z1]);
    }
  }
  const a = [1576.1, 3777, 3356.9], b = [1587.6, 3777, 3370.2];
  const horizontal = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const offsetX = (b[2] - a[2]) / horizontal, offsetZ = -(b[0] - a[0]) / horizontal;
  const bridgeSide = (p, i, height) => [p[0] + offsetX * i, p[1] + height, p[2] + offsetZ * i];
  const left = bridgeSide(a, -1.01, 0), right = bridgeSide(a, 1.01, 0);
  const endL = bridgeSide(b, -1.01, 0), endR = bridgeSide(b, 1.01, 0);
  m.sheet(left, right, endR, endL, steel);
  m.surface(a, b, 2.05);
  for (const side of [-1, 1]) {
    const start = bridgeSide(a, side, 0), end = bridgeSide(b, side, 0);
    guard(m, start, end);
    m.line(bridgeSide(a, side, -.64), bridgeSide(b, side, -.64), .15, steel);
    for (let i = 0; i < 8; i++) {
      const p = start.map((v, k) => THREE.MathUtils.lerp(v, end[k], i / 8));
      const q = start.map((v, k) => THREE.MathUtils.lerp(v, end[k], (i + 1) / 8));
      m.line(p, [q[0], q[1] - .64, q[2]], .08, zinc);
    }
  }
  m.finish();
  const top = setUp(scene, 'Aiguille du Midi · Terrasse 3842 and TDF spire', ground, env, floors);
  platform(top, 1593.5, 3408.4, 3842.6, 18.5, 10);
  platform(top, 1597.7, 3414.6, 3842.6, 8.0, 2.4);
  for (const [a, b] of [
    [[1584.25, 3403.4], [1602.75, 3403.4]], [[1602.75, 3403.4], [1602.75, 3413.4]],
    [[1584.25, 3403.4], [1584.25, 3404.93]], [[1584.25, 3413.4], [1584.25, 3406.68]],
    [[1584.25, 3413.4], [1593.7, 3413.4]],
    [[1593.7, 3413.4], [1593.7, 3415.8]], [[1593.7, 3415.8], [1601.7, 3415.8]],
    [[1601.7, 3415.8], [1601.7, 3413.4]],
  ]) guard(top, [a[0], 3842.6, a[1]], [b[0], 3842.6, b[1]]);
  const tx = 1593.2, tz = 3406.2;
  const base = 3842.55;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.72, 1.18, 12.6, 16),
    new THREE.MeshStandardMaterial({ color: '#d4d7d6', roughness: .76 }));
  mast.position.set(tx, base + 6.3, tz);
  mast.castShadow = true;
  top.group.add(mast);
  top.block(2.96, 1.55, 2.82, concrete, tx, base + .71, tz);
  env.addCircle(tx, tz, 1.48, 'building', { minY: base, maxY: base + 12.6 });
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(.16, .49, 16.4, 12),
    new THREE.MeshStandardMaterial({ color: '#b4bdc7', roughness: .61, metalness: .33 }));
  tip.position.set(tx, base + 20.8, tz);
  tip.castShadow = true;
  top.group.add(tip);
  for (const [h, r] of [[12.7, .68], [14.1, .55], [20.8, .39], [22.3, .34]]) {
    top.circle(r, .080, trim, [tx, base + h, tz]);
  }
  const glassX = 1582.75, glassY = 3842.62, glassZ = 3405.8;
  platform(top, glassX, glassZ, glassY, 3.12, 1.75);
  const p = [[glassX - 1.55, glassY, glassZ - .87], [glassX + 1.55, glassY, glassZ - .87],
    [glassX + 1.55, glassY, glassZ + .87], [glassX - 1.55, glassY, glassZ + .87]];
  for (const i of [0, 2, 3]) {
    const a = p[i], b = p[(i + 1) % p.length], c = [b[0], glassY + 2.68, b[2]], d = [a[0], glassY + 2.68, a[2]];
    top.sheet(a, b, c, d, '#83b1c8', .28);
    top.line(a, d, .095, zinc);
    top.line(d, c, .095, zinc);
    top.barrier(a, b, glassY + 2.68, glassY);
  }
  top.sign('TERRASSE 3842', 1602.82, 3841.64, 3408.2, 4.5, Math.PI / 2, .61);
  for (const [x, z, w, d] of [[1588, 3408, 1.55, 1.76], [1599, 3413, 1.43, 1.66], [1602, 3406, 1.43, 1.92]]) {
    const lower = top.floor(x, z) - 2;
    if (lower < 3842.4) top.block(w, 3842.4 - lower, d, basalt, x, midpoint(lower, 3842.4), z);
  }
  const pavilion = [1635.7, 3398.5];
  anteroom(top, ...pavilion, ground.heightAt(...pavilion), 12.1, 10.0, 4.8);
  const wing = [1604, 3449.7];
  anteroom(top, ...wing, ground.heightAt(...wing), 14.8, 8.9, 4.6);
  top.finish();
}

const builders = { 'ski-arlberg': galzig, 'verbier-4-vallees': montFort, 'chamonix-mont-blanc': aiguilleDuMidi,
  'niseko-united': buildNisekoLandmarks };

export function buildInternationalLandmarks(scene, config, ground, env) {
  const build = builders[config.id];
  if (!build) return;
  const floors = [];
  build(scene, config, ground, env, floors, setUp);
  if (!floors.length) return;
  env.walkSurfaceAt = (x, z, currentY) => {
    let y = -Infinity;
    for (const height of floors) y = Math.max(y, height(x, z, currentY) ?? -Infinity);
    return Number.isFinite(y) ? Math.max(y, ground.heightAt(x, z)) : undefined;
  };
}
