import * as THREE from 'three';
import { surfaceMaterial } from './materials.js';
import { canvasTexture, makeCanvas, mulberry32 } from './util.js';

let floorMaterial;

function stoneTileMaterial() {
  if (floorMaterial) return floorMaterial;
  const { canvas, ctx } = makeCanvas(512, 384);
  const stones = ['#817c6c', '#929081', '#908578', '#a39c8d', '#777b73', '#8d8a7c'];
  const random = mulberry32(344);
  ctx.fillStyle = '#625f57';
  ctx.fillRect(0, 0, 512, 384);
  for (let row = 0; row < 4; row++) {
    const tones = Array.from({ length: 4 }, () => stones[Math.floor(random() * stones.length)]);
    for (let tile = -1; tile < 4; tile++) {
      const x = tile * 128 + (row % 2) * 64, z = row * 96;
      ctx.fillStyle = '#403d3466';
      ctx.fillRect(x + 1, z + 1, 126, 94);
      ctx.fillStyle = tones[(tile + 4) % 4];
      ctx.fillRect(x + 2, z + 2, 123, 91);
      ctx.fillStyle = '#eae2cb26';
      ctx.fillRect(x + 2, z + 2, 123, 1);
    }
  }
  const map = canvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  floorMaterial = surfaceMaterial('stone', { map, emissive: '#706b66', emissiveIntensity: .13 });
  return floorMaterial;
}

function floorPlane(group, geometry, material, name, x, y, z) {
  const plane = new THREE.Mesh(geometry, material);
  plane.name = name;
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(x, y, z);
  plane.receiveShadow = true;
  group.add(plane);
}

export function addStoneFloor(group, { w, d, x = 0, y = 0, z = 0 }) {
  const geometry = new THREE.PlaneGeometry(w, d);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 3.76, uv.getY(i) * d / 2.88);
  floorPlane(group, geometry, stoneTileMaterial(), 'Staggered honed stone floor', x, y + .012, z);
}

export function addWoolCarpet(group, { w, d, x = 0, y = 0, z = 0, palette, name = 'Woven wool rug' }) {
  const scale = Math.min(144, 420 / w, 760 / d);
  const width = Math.round(w * scale), depth = Math.round(d * scale);
  const { canvas, ctx } = makeCanvas(width, depth);
  const [border, field, ink] = palette;
  const trim = Math.min(width, depth) * .063;
  ctx.fillStyle = border;
  ctx.fillRect(0, 0, width, depth);
  ctx.fillStyle = field;
  ctx.fillRect(trim, trim, width - 2 * trim, depth - 2 * trim);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.4;
  for (const inset of [.5, 1.25, 1.55]) {
    const edge = trim * inset;
    ctx.strokeRect(edge, edge, width - 2 * edge, depth - 2 * edge);
  }
  const span = trim * 2.1;
  const cols = Math.floor((width - 4 * trim) / span), rows = Math.floor((depth - 4 * trim) / span);
  const radius = span * .29;
  ctx.lineWidth = 2;
  ctx.fillStyle = ink;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const cx = (width + (2 * col - cols + 1) * span) * .5;
    const cy = (depth + (2 * row - rows + 1) * span) * .5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx + radius, cy); ctx.lineTo(cx, cy + radius); ctx.lineTo(cx - radius, cy);
    ctx.closePath(); ctx.stroke();
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
  }
  for (let i = 1; i < depth; i += 3) {
    ctx.fillStyle = i % 2 ? '#1a15151b' : '#f9e9ca1d';
    ctx.fillRect(0, i, width, 1);
  }
  const material = new THREE.MeshStandardMaterial({
    map: canvasTexture(canvas), roughness: .97, emissive: '#72584e', emissiveIntensity: .10,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  floorPlane(group, new THREE.PlaneGeometry(w, d), material, name, x, y + .026, z);
}
