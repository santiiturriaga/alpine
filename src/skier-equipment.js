import * as THREE from 'three';
import { makeCanvas, canvasTexture, mulberry32 } from './util.js';

// Each section is [forward position, half width, rocker height].
export const skiProfile = [
  [-.82,.041,.018],[-.77,.049,.009],[-.72,.052,.007],[-.46,.049,.001],
  [-.17,.044,.003],[.11,.043,.009],[.39,.05,.004],[.67,.064,.003],
  [.76,.065,.012],[.81,.064,.02],[.87,.059,.039],[.92,.05,.062],[.957,.036,.081],[.98,.018,.093],
];
export const baseThickness = .013;

const styles = {
  'all-mountain': { brand:'SALOMON', length: 1, width: 1, rocker: 1, tip: '#517b84', base: '#253b40', ink: '#adcbca', seed: 1841 },
  carver: { brand:'ROSSIGNOL', length: .99, width: .93, rocker: .78, tip: '#ab532f', base: '#44342d', ink: '#efc5a5', seed: 248 },
  powder: { brand:'ATOMIC', length: 1.055, width: 1.24, rocker: 1.46, tip: '#527692', base: '#2f4159', ink: '#c9dced', seed: 425 },
  park: { brand:'LINE', length: .94, width: 1.035, rocker: .98, tip: '#729271', base: '#33483c', ink: '#e1ce8e', seed: 789 },
};
const decks = new Map();
let baseMaterial;

export function isSkiStyle(style) {
  return Object.hasOwn(styles, style);
}

function scratches(ctx, random, count, width, length, maxAlpha) {
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = random() * width, y = random() * length;
    const run = (2 + random() ** 2 * 110) * (i % 6 === 0 ? 3 : 1);
    ctx.strokeStyle = 'rgba(197,215,219,' + random() * maxAlpha + ')';
    ctx.lineWidth = .18 + random() ** 2 * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + random() * 3 - 1.5, y + run * .6, x + random() * 8 - 4, y + run);
    ctx.stroke();
  }
}

function skiTop({ tip, base, ink, seed, brand }) {
  const width = 128, length = 1024;
  const { canvas, ctx } = makeCanvas(width, length);
  const rough = makeCanvas(width, length);
  const fill = ctx.createLinearGradient(0, 0, 0, length);
  for (const [at, color] of [[0,tip],[.16,tip],[.36,base],[.7,base],[1,tip]]) fill.addColorStop(at, color);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, length);
  const image = ctx.getImageData(0, 0, width, length);
  const roughness = rough.ctx.createImageData(width, length);
  const rand = mulberry32(seed);
  for (let y = 0; y < length; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / length;
    const lateral = (u - .65 + .18 * Math.cos(v * 19)) * 3.7;
    const hillside = Math.hypot(lateral, (v - .13) * 10) + Math.sin(u * 7 + v * 31) * .27 + v * 4;
    const contour = (1 - THREE.MathUtils.smoothstep(Math.abs(Math.sin(hillside * 4.9)), .028, .22))
      * (1 - THREE.MathUtils.smoothstep(v, .28, .62)) * 32;
    const edge = Math.max(0, Math.abs(u - .5) * 16 - 6);
    const grain = (rand() - .5) * 11;
    const n = (y * width + x) * 4, polish = 168 + grain * 4 - edge * 7 - contour * 1.5;
    for (let k = 0; k < 3; k++) {
      image.data[n + k] += contour + grain + edge;
      roughness.data[n + k] = polish;
    }
    roughness.data[n + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  rough.ctx.putImageData(roughness, 0, 0);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  ctx.moveTo(28, 158);
  ctx.lineTo(62, 115);
  ctx.lineTo(70, 133);
  ctx.lineTo(92, 106);
  ctx.lineTo(109, 132);
  ctx.stroke();
  for (let i = 0; i < 3; i++) ctx.fillRect(25, 188 + i * 12, 23 - i * 6, 3);
  ctx.save();
  ctx.translate(79, 256);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = ink;
  ctx.font = '700 38px Barlow Condensed, Arial';
  ctx.fillText(brand, 0, 0, 223);
  ctx.restore();
  scratches(ctx, rand, 300, width, length, .17);
  for (let i = 0; i < 95; i++) {
    const x = rand() < .5 ? rand() * 5 : width - rand() * 5;
    ctx.fillStyle = 'rgba(184,194,189,' + (rand() * .40) + ')';
    ctx.fillRect(x, rand() * length, .25 + rand() * 2.5, 1 + rand() * 4);
  }
  const map = canvasTexture(canvas);
  map.anisotropy = 6;
  return new THREE.MeshPhysicalMaterial({
    map, roughnessMap: canvasTexture(rough.canvas, { srgb: false }),
    metalness: .06, roughness: .72, clearcoat: .32, clearcoatRoughness: .32,
  });
}

function skiBase() {
  if (baseMaterial) return baseMaterial;
  const { canvas, ctx } = makeCanvas(128, 1024);
  const rand = mulberry32(1672);
  ctx.fillStyle = '#1d2327';
  ctx.fillRect(0, 0, 128, 1024);
  scratches(ctx, rand, 740, 128, 1024, .15);
  const map = canvasTexture(canvas);
  const bumpMap = canvasTexture(canvas, { srgb: false });
  baseMaterial = new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: .0018, roughness: .67 });
  return baseMaterial;
}

const sidewall = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: .61 });
const bevel = new THREE.MeshStandardMaterial({ color: 0x82949b, metalness: .43, roughness: .38 });
const edge = new THREE.MeshStandardMaterial({ color: 0xb2bac0, metalness: .72, roughness: .32 });

export function skiDeck(style) {
  if (decks.has(style)) return decks.get(style);
  const settings = styles[style];
  const { length, width, rocker } = settings;
  const profile = skiProfile.map(([z, w, y]) => {
    const end = Math.abs(z) > .48;
    const tailRise = z < -.46 && style === 'park' ? (-z - .46) ** 2 * .49 : 0;
    const sidecut = style === 'carver' && !end ? .91 : 1;
    return [z * length, w * width * sidecut, y * (end ? rocker : 1) + tailRise];
  });
  const widthAtEdge = .0018;
  const corners = [
    [-1,.0026,0], [1,.0026,0], [1,0,-.0034], [1,0,-.0103],
    [1,widthAtEdge,-baseThickness], [-1,widthAtEdge,-baseThickness],
    [-1,0,-.0103], [-1,0,-.0034],
  ];
  const bands = [0,1,2,3,4,3,2,1];
  const position = [], uv = [];
  const faces = Array.from({ length: 5 }, () => []);
  const geometry = new THREE.BufferGeometry();
  const tail = profile[0][0], extent = profile.at(-1)[0] - tail;
  const addCorner = ([z, half, y], [sign, inset, depth]) => {
    position.push(sign * (half - inset), y + depth, z);
    uv.push(sign > 0 ? 1 : 0, (z - tail) / extent);
  };
  for (let band = 0; band < corners.length; band++) {
    const firstVertex = position.length / 3, index = faces[bands[band]];
    const next = (band + 1) % corners.length;
    for (const [i, section] of profile.entries()) {
      addCorner(section, corners[band]);
      addCorner(section, corners[next]);
      if (i + 1 === profile.length) continue;
      const a = firstVertex + i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  for (const end of [0, profile.length - 1]) {
    const firstVertex = position.length / 3;
    for (const corner of corners) addCorner(profile[end], corner);
    for (let i = 2; i < corners.length; i++) {
      const a = firstVertex + i;
      if (end === 0) faces[2].push(firstVertex, a - 1, a);
      else faces[2].push(firstVertex, a, a - 1);
    }
  }
  let offset = 0;
  for (const [material, index] of faces.entries()) {
    geometry.addGroup(offset, index.length, material);
    offset += index.length;
  }
  geometry.setIndex(faces.flat());
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const deck = { profile, geometry, materials: [skiTop(settings), bevel, sidewall, edge, skiBase()] };
  decks.set(style, deck);
  return deck;
}
