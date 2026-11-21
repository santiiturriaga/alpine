import * as THREE from 'three';
import { mix, mulberry32 } from './math.js';
import { courseParts, SledMeshBuilder, tintedMaterial } from './sled-biome-mesh.js';

const SNOW = '#e7f3fa';
const STONE = '#746c72';
const WOOD = '#57413b';
const TRIM = '#392e32';
const THROUGH = '#d88c30';
const palettes = [
  ['#b67656', '#d8a880', '#643d3a'],
  ['#778b81', '#cdd6c2', '#404c50'],
  ['#855653', '#e0b295', '#664346'],
  ['#8c7768', '#d5ae81', '#444b51'],
];

function gableGeometry() {
  const outline = new THREE.Shape().moveTo(-.5, -.5).lineTo(.5, -.5).lineTo(0, .5).closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: 1, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -.5);
  return geometry;
}

function chalet(group, model, pointAt, materials, random, gable) {
  const { d, x, halfWidth: w, halfDepth: l, height, kind } = model;
  const ear = Math.min(.55, w * .16);
  const body = courseParts(pointAt, x, d);
  const light = courseParts(pointAt, x, d);
  const box = body.box;
  const [wall, boarding, roof] = palettes[Math.floor(random() * palettes.length)];
  const isOpen = kind === 'openHouse';
  const isRideable = kind === 'roofRamp';
  const gate = model.doorHalfWidth ?? w * .57;
  const opening = model.doorHeight ?? Math.max(3.3, height - 1.05);
  const eave = isRideable ? height - .26 : Math.max(height, isOpen ? opening + .65 : 3.6);

  function window(wx, wy, wz, depthways = false) {
    const width = Math.min(1.25, w * .38);
    const sizes = (wide, high, depth) => depthways ? [depth, high, wide] : [wide, high, depth];
    box(...sizes(width + .24, 1.43, .19), TRIM, [wx, wy, wz]);
    light.box(...sizes(width, 1.16, .21), random() > .22 ? '#ffbd64' : '#dd8656', [wx, wy, wz]);
    box(...sizes(.073, 1.18, .26), WOOD, [wx, wy, wz]);
    box(...sizes(width, .065, .26), WOOD, [wx, wy + .06, wz]);
    box(...sizes(width + .31, .11, .35), boarding, [wx, wy - .67, wz]);
    if (!depthways) {
      for (const side of [-1, 1]) box(.19, 1.23, .21, roof, [wx + side * (width * .5 + .18), wy, wz]);
    }
  }

  for (const side of [-1, 1]) {
    box(ear, eave + .6, 2 * l, wall, [side * (w - ear * .5), (eave - .6) * .5, 0]);
    box(.36, .74, 2 * l, STONE, [side * (w - .10), .35, 0]);
    for (let p = -l + .27; p < l; p += Math.max(1.6, l * .48)) {
      box(.15, eave, .14, WOOD, [side * w, eave * .5, p]);
    }
    for (let y = 1.12; y < eave - .18; y += .49) {
      box(.085, .045, 2 * l, boarding, [side * w, y, 0]);
    }
    for (const p of [-l * .51, l * .51]) window(side * (w + .04), eave * .55, p, true);
  }

  for (const end of [-1, 1]) {
    const z = end * (l - .15);
    if (isOpen) {
      for (const side of [-1, 1]) {
        const width = w - gate;
        const at = side * (gate + width * .5);
        box(width, eave + .4, .30, wall, [at, (eave - .4) * .5, z]);
        box(.23, opening + .14, .48, THROUGH, [side * (gate + .13), opening * .5, z]);
        box(.35, .23, .53, '#eac8a1', [side * (gate + .17), .19, z]);
        if (width > 1.2) window(at, Math.min(opening - .7, eave * .58), z + end * .15);
      }
      box(w * 2, eave - opening, .38, WOOD, [0, (eave + opening) * .5, z]);
      box(gate * 2 + .53, .19, .54, THROUGH, [0, opening + .12, z]);
      light.box(.7, .16, .56, '#ffe6b4', [0, opening + .35, z]);
    } else {
      box(w * 2, eave + .52, .30, wall, [0, (eave - .52) * .5, z]);
      if (!isRideable) {
        box(.95, 2.35, .36, TRIM, [0, 1.16, z]);
        box(.72, .14, .37, boarding, [0, 2.13, z]);
        box(.065, .08, .39, '#e2a864', [.24, .96, z]);
      }
      for (const side of [-1, 1]) window(side * w * .53, eave * .60, z + end * .15);
    }
    for (let y = 1.03; y < eave - .13; y += .49) {
      if (isOpen && y < opening) {
        for (const side of [-1, 1]) box(w - gate - .23, .045, .052, boarding,
          [side * (w + gate + .23) * .5, y, z + end * .16]);
      } else if (isRideable || isOpen || y > 2.4) {
        box(w * 2, .045, .052, boarding, [0, y, z + end * .16]);
      }
    }
  }

  if (isRideable) {
    box(2 * w, .30, 2 * l, roof, [0, height - .35, 0]);
    for (const side of [-1, 1]) {
      for (const z of [-l + .6, l - .53]) {
        box(.115, 1.1, .115, '#465d6d', [side * (w + .12), height + .45, z]);
        box(.44, .34, .09, THROUGH, [side * (w + .31), height + .88, z]);
      }
    }
    roofApproach(group, model, pointAt, materials.snow);
  } else {
    const rise = Math.min(w * .59, 3.3);
    box(2 * w, rise, 2 * l, wall, [0, eave + rise * .5, 0], undefined, gable);
    const run = w + .61;
    const slope = Math.atan(rise / w);
    const width = run / Math.cos(slope);
    for (const side of [-1, 1]) {
      const rx = side * run * .5;
      const ry = eave + rise - run * .5 * rise / w;
      box(width, .24, 2 * l + 1.36, roof, [rx, ry, 0], [0, 0, -side * slope]);
      box(width * .985, .27, 2 * l + 1.0, SNOW, [rx + side * .045, ry + .19, .02], [0, 0, -side * slope]);
      for (const z of [-l - .49, l + .49]) {
        box(width, .165, .18, WOOD, [rx, ry - .08, z], [0, 0, -side * slope]);
      }
    }
    if (random() > .18) {
      box(.79, 2.1, .75, STONE, [w * .42, eave + rise * .72, -l * .44]);
      box(.96, .19, .91, SNOW, [w * .42, eave + rise * .72 + 1.07, -l * .44]);
    }
  }

  if (isOpen) {
    for (const side of [-1, 1]) {
      box(.14, .21, 2 * l - .55, '#d4a56d', [side * (gate + .09), .13, 0]);
      box(.12, .32, 2 * l - .48, STONE, [side * (w - ear - .04), .20, 0]);
      for (const z of [-l * .7, -l * .25, l * .25, l * .7]) {
        box(.18, eave, .18, WOOD, [side * (w - ear - .035), eave * .46, z]);
      }
      for (const z of [-l * .58, l * .58]) {
        box(.26, .46, .24, TRIM, [side * (w - ear - .08), opening * .66, z]);
        light.box(.28, .23, .19, '#ffcf78', [side * (w - ear - .24), opening * .66, z]);
      }
    }
    for (const z of [-l * .7, 0, l * .7]) box(2 * (w - ear), .33, .24, WOOD, [0, eave - .09, z]);
  }
  body.add(group, isOpen ? 'Chalet with open sled passage' : isRideable ? 'Snow roof launch chalet' : 'Snow-covered chalet', materials.body);
  light.add(group, 'Chalet windows and passage lanterns', materials.light);
  body.dispose();
  light.dispose();
}

function roofApproach(group, { x, d, halfWidth: w, halfDepth, height, rampStart }, pointAt, material) {
  const end = d - halfDepth;
  if (!(end > rampStart)) return;
  const ramp = new SledMeshBuilder();
  const approach = Math.max(4, Math.ceil((end - rampStart) / 1.3));
  const deck = Math.max(4, Math.ceil(halfDepth * 2 / 1.3));
  const spans = Array.from({ length: 13 }, (_, i) => (i / 6 - 1) * w);
  const rowSize = spans.length + 4;
  const bank = new THREE.Color('#9ab6c5');
  const snow = new THREE.Color(SNOW);
  const track = new THREE.Color('#d2e5ed');
  for (let i = 0; i <= approach + deck; i++) {
    const t = Math.min(1, i / approach);
    const at = i <= approach ? mix(rampStart, end, t) : mix(end, d + halfDepth, (i - approach) / deck);
    for (let j = 0; j < spans.length; j++) {
      const offset = spans[j];
      const tint = j === 2 || j === 10 ? track : snow;
      const index = ramp.vertex(pointAt(x + offset, at, height * t + .012), tint);
      if (i && j) ramp.quad(index - rowSize - 1, index - rowSize, index, index - 1);
    }
    for (const sign of [-1, 1]) {
      const upper = ramp.vertex(pointAt(x + sign * w, at, height * t), bank);
      const lower = ramp.vertex(pointAt(x + sign * (w + .82 * (1 - t)), at, i <= approach ? -.10 : height - .38), bank);
      if (i) ramp.quad(upper - rowSize, lower - rowSize, lower, upper);
    }
  }
  ramp.add(group, 'Packed snow chute and rideable chalet deck', material);
}

export function buildVillageArt(group, section, features, pointAt) {
  const random = mulberry32((section.start ^ 19881) >>> 0);
  const materials = {
    body: tintedMaterial(),
    light: new THREE.MeshBasicMaterial({ vertexColors: true }),
    snow: tintedMaterial({ side: THREE.DoubleSide }),
  };
  const gable = gableGeometry();
  const houses = features.filter(({ kind }) => kind === 'openHouse' || kind === 'closedHouse' || kind === 'roofRamp');
  for (let d = section.start + 38; d < section.end - 22; d += 23 + random() * 15) {
    for (const side of [-1, 1]) {
      const width = 3.1 + random() * 2.2;
      const depth = 4.1 + random() * 3;
      const x = side * (21.1 + width + random() * 7.7);
      houses.push({ kind: 'closedHouse', x, d: d + random() * 8, height: 3.8 + random() * 1.7, halfWidth: width, halfDepth: depth });
    }
  }
  for (const house of houses) chalet(group, house, pointAt, materials, random, gable);
  gable.dispose();

  const props = courseParts(pointAt, 0, section.start);
  const lamps = courseParts(pointAt, 0, section.start);
  for (let d = section.start + 17; d < section.end - 18; d += 21 + random() * 13) {
    for (const side of [-1, 1]) {
      const x = side * (16.9 + random() * 1.5);
      const z = section.start - d - random() * 5;
      props.box(.19, 3.3, .19, TRIM, [x, 1.58, z]);
      props.box(.37, .15, .38, STONE, [x, .08, z]);
      props.box(.45, .17, .45, TRIM, [x, 3.05, z]);
      lamps.box(.37, .35, .37, '#ffc987', [x, 3.28, z]);
      props.box(.49, .16, .49, SNOW, [x, 3.50, z]);
      if (random() > .50) {
        const far = x + side * 1.4;
        for (const offset of [-1.1, 0, 1.1]) {
          props.box(.11, .87, .11, WOOD, [far, .40, z + offset]);
        }
        props.box(.10, .15, 2.3, boardingColor(side), [far, .52, z]);
      }
    }
  }
  props.add(group, 'Snow village lamps and split-rail fences', materials.body);
  lamps.add(group, 'Street lantern glass', materials.light);
  props.dispose();
  lamps.dispose();
}

function boardingColor(side) {
  return side < 0 ? '#856452' : '#7c6055';
}
