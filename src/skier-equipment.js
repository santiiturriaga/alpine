import * as THREE from 'three';
import { makeCanvas, canvasTexture, mulberry32 } from './util.js';
import { DEFAULT_SKI_ID, DEFAULT_SNOWBOARD_ID, SKI_MODELS, SNOWBOARD_MODELS } from './gear-catalog.js';
import { deckProfile } from './deck-shape.js';
import { deckFinishes, paintDeckArtwork } from './gear-topsheets.js';

// Each section is [forward position, half width, rocker height].
export const skiProfile = [
  [-.82,.041,.018],[-.77,.049,.009],[-.72,.052,.007],[-.46,.049,.001],
  [-.17,.044,.003],[.11,.043,.009],[.39,.05,.004],[.67,.064,.003],
  [.76,.065,.012],[.81,.064,.02],[.87,.059,.039],[.92,.05,.062],[.957,.036,.081],[.98,.018,.093],
];
export const baseThickness = .013;

const decks = new Map();
let baseMaterial;

export function isSkiStyle(style) {
  return Object.hasOwn(SKI_MODELS, style);
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

function deckTop(model) {
  const { tip, base, seed, coat } = deckFinishes[model.id];
  const width = model.kind === 'snowboard' ? 256 : 128, length = 1024;
  const { canvas, ctx } = makeCanvas(width, length);
  const rough = makeCanvas(width, length);
  const rand = mulberry32(seed);
  const fill = ctx.createLinearGradient(0, 0, 0, length);
  for (const [at, color] of [[0,tip],[.16,tip],[.36,base],[.7,base],[1,tip]]) fill.addColorStop(at, color);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, length);
  paintDeckArtwork(ctx, model, width, rand);
  const image = ctx.getImageData(0, 0, width, length);
  const roughness = rough.ctx.createImageData(width, length);
  for (let y = 0; y < length; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / length;
    const edge = Math.max(0, Math.abs(u - .5) * 16 - 6);
    const grain = (rand() - .5) * 11;
    const n = (y * width + x) * 4, polish = 198 - coat * 75 + grain * 4 - edge * 7;
    for (let k = 0; k < 3; k++) {
      image.data[n + k] += grain + edge;
      roughness.data[n + k] = polish;
    }
    roughness.data[n + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  rough.ctx.putImageData(roughness, 0, 0);
  scratches(ctx, rand, 180, width, length, .12);
  for (let i = 0; i < 58; i++) {
    const x = rand() < .5 ? rand() * 5 : width - rand() * 5;
    ctx.fillStyle = 'rgba(184,194,189,' + (rand() * .40) + ')';
    ctx.fillRect(x, rand() * length, .25 + rand() * 2.5, 1 + rand() * 4);
  }
  const map = canvasTexture(canvas);
  map.anisotropy = 6;
  return new THREE.MeshPhysicalMaterial({
    map, roughnessMap: canvasTexture(rough.canvas, { srgb: false }),
    metalness: .055, roughness: .79, clearcoat: coat, clearcoatRoughness: .34,
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
  return makeDeck(isSkiStyle(style) ? SKI_MODELS[style] : SKI_MODELS[DEFAULT_SKI_ID]);
}

export function snowboardDeck(id) {
  return makeDeck(Object.hasOwn(SNOWBOARD_MODELS, id) ? SNOWBOARD_MODELS[id] : SNOWBOARD_MODELS[DEFAULT_SNOWBOARD_ID]);
}

function makeDeck(model) {
  if (decks.has(model.id)) return decks.get(model.id);
  const profile = deckProfile(model);
  const sections = deckProfile(model, 5);
  const lateral = sections.some(section => section[3]) ? [-1, -.5, 0, .5, 1] : [-1, 1];
  const top = lateral.map(ratio => [ratio, .0019, 0]);
  const bottom = [...lateral].reverse().map(ratio => [ratio, .0016, -baseThickness]);
  const sides = [-1, 1].map(sign => [[sign, 0, -.0034], [sign, 0, -.0103]]);
  const [left, right] = sides;
  const bands = [
    [0, top], [1, [top.at(-1), right[0]]], [2, right], [3, [right[1], bottom[0]]],
    [4, bottom], [3, [bottom.at(-1), left[1]]], [2, [left[1], left[0]]], [1, [left[0], top[0]]],
  ];
  const position = [], uv = [];
  const faces = Array.from({ length: 5 }, () => []);
  const geometry = new THREE.BufferGeometry();
  const tail = profile[0][0], extent = profile.at(-1)[0] - tail;
  const fullWidth = Math.max(model.tipMm, model.tailMm) / 1000;
  const addCorner = ([z, half, y, spoon], [ratio, inset, depth]) => {
    const x = ratio * (half - Math.min(inset, half * .35));
    position.push(x, y + depth - spoon * (1 - ratio * ratio), z);
    // In the top view with the nose up, screen right is -X.
    uv.push(.5 - x / fullWidth, (z - tail) / extent);
  };
  for (const [material, strip] of bands) {
    const firstVertex = position.length / 3, count = strip.length;
    for (const [i, section] of sections.entries()) {
      for (const corner of strip) addCorner(section, corner);
      if (i + 1 === sections.length) continue;
      for (let j = 0; j < count - 1; j++) {
        const a = firstVertex + i * count + j;
        faces[material].push(a, a + count, a + 1, a + 1, a + count, a + count + 1);
      }
    }
  }
  const corners = [...top, ...right, ...bottom, left[1], left[0]];
  for (const end of [0, sections.length - 1]) {
    const center = position.length / 3;
    addCorner(sections[end], [0, 0, -baseThickness / 2]);
    for (const corner of corners) addCorner(sections[end], corner);
    for (let i = 0; i < corners.length; i++) {
      const a = center + 1 + i, b = center + 1 + (i + 1) % corners.length;
      if (end === 0) faces[2].push(center, a, b);
      else faces[2].push(center, b, a);
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
  const deck = { model, profile, geometry, materials: [deckTop(model), bevel, sidewall, edge, skiBase()] };
  decks.set(model.id, deck);
  return deck;
}
