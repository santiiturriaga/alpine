import * as THREE from 'three';
import { batchRigidParts } from './skier-hardware.js';
import { canvasTexture, makeCanvas, mulberry32 } from './util.js';

export const DEFAULT_GOGGLES = 'black-smoke';
export const GOGGLES = {
  'black-smoke': { name: 'Black / Smoke', frame: '#17181a', strap: '#18191a', lens: 'smoke' },
  'red-amber': { name: 'Red / Amber', frame: '#c52527', strap: '#aa2023', lens: 'amber' },
  'blue-amber': { name: 'Blue / Amber', frame: '#224c9f', strap: '#21428b', lens: 'amber' },
};
export const isGoggleColor = (id) => typeof id === 'string' && Object.hasOwn(GOGGLES, id);

const { lerp } = THREE.MathUtils;
let parts;

// The upper and lower contours share one cylindrical wrap, with a rounded
// outer corner and a lifted center that leaves space for the bridge of the nose.
function contour(u, upper, inset = 0, depth = 0) {
  const edge = Math.abs(u);
  const arch = Math.exp(-((u / .205) ** 2));
  const corner = Math.sqrt(Math.max(0, 1 - edge ** 10));
  const brow = .143 + (.047 - .008 * edge - inset) * corner;
  const cheek = .143 - (.054 - .037 * arch + .006 * edge - inset) * corner;
  const angle = u * 1.13 * (1 - inset / .22);
  return [.135 * Math.sin(angle), upper ? brow : cheek, .009 + .158 * Math.cos(angle) + depth];
}

function surface(columns, rows, point, verticalUV = (_, v) => v) {
  const positions = [], uv = [], faces = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      const position = point(i / columns, j / rows);
      positions.push(...position);
      uv.push(i / columns, verticalUV(position, j / rows));
      if (i === columns || j === rows) continue;
      const a = j * (columns + 1) + i, b = a + columns + 1;
      faces.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(faces);
  geo.computeVertexNormals();
  return geo;
}

function rim(sections) {
  const spans = 144;
  return surface(spans, sections.length - 1, (s, t) => {
    const index = Math.round(t * (sections.length - 1));
    const [inset, depth, lift = 0] = sections[index];
    const angle = s * 2 * Math.PI;
    const position = contour(-Math.cos(angle), s > .5, inset, depth);
    position[1] += lift;
    return position;
  });
}

function shield(u, v, depth = 0) {
  const [x, bottom, z] = contour(u, false, .0085, depth);
  const top = contour(u, true, .0085, depth)[1];
  return [x, lerp(bottom, top, v), z + .0025 * Math.sin(Math.PI * v) * (1 - u * u)];
}

function lensTexture(amber) {
  const { canvas, ctx } = makeCanvas(256, 128);
  const base = ctx.createLinearGradient(0, 0, 0, 128);
  const stops = amber
    ? [[0, '#371710'], [.20, '#633016'], [.49, '#b2520c'], [.76, '#e7952b'], [1, '#72360d']]
    : [[0, '#14161d'], [.20, '#1c2028'], [.49, '#444851'], [.76, '#292d36'], [1, '#101119']];
  for (const [at, color] of stops) base.addColorStop(at, color);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 128);

  const edge = ctx.createLinearGradient(0, 0, 256, 0);
  edge.addColorStop(0, '#09090bd8');
  edge.addColorStop(.27, '#09090b12');
  edge.addColorStop(.73, '#09090b00');
  edge.addColorStop(1, '#09090b99');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, 256, 128);

  const sheen = ctx.createLinearGradient(0, 13, 123, 108);
  sheen.addColorStop(0, amber ? '#ffe1b71a' : '#d6e5fc5e');
  sheen.addColorStop(1, '#ffffff03');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.moveTo(10, 24);
  ctx.bezierCurveTo(67, 19, 138, 31, 211, 33);
  ctx.lineTo(208, 47);
  ctx.bezierCurveTo(141, 45, 111, 48, 66, 41);
  ctx.lineTo(51, 112);
  ctx.lineTo(28, 112);
  ctx.closePath();
  ctx.fill();
  return canvasTexture(canvas);
}

function strapTexture(color) {
  const { canvas, ctx } = makeCanvas(1024, 96);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 3) {
    ctx.fillStyle = y % 6 ? '#00000033' : '#ffffff15';
    ctx.fillRect(0, y, canvas.width, 1);
    for (let x = y % 2; x < canvas.width; x += 5) ctx.fillRect(x, y + 1, 2, 1);
  }
  ctx.fillStyle = '#00000050';
  ctx.fillRect(0, 1, canvas.width, 4);
  ctx.fillRect(0, 91, canvas.width, 4);
  ctx.fillStyle = '#fffdf7';
  ctx.font = 'italic 700 72px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const x of [126, 512, 898]) ctx.fillText('Supreme', x, 48, 216);
  return canvasTexture(canvas);
}

function browTexture() {
  const { canvas, ctx } = makeCanvas(256, 64);
  ctx.fillStyle = '#fffdfa';
  ctx.font = 'italic 900 58px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SMITH', 128, 33, 244);
  return canvasTexture(canvas);
}

function foamTexture() {
  const { canvas, ctx } = makeCanvas(128, 128);
  const random = mulberry32(933);
  const pixels = ctx.createImageData(128, 128);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = 70 + random() * 160;
    pixels.data.set([value, value, value, 255], i);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvasTexture(canvas, { srgb: false, repeat: [4, 2] });
}

const strapStart = 1.11;
const strapEnd = 2 * Math.PI - strapStart;
function strapPoint(angle, v, offset = 0) {
  const temple = Math.abs(Math.sin(angle));
  const x = .129 + offset, z = .134 + offset;
  return [x * Math.sin(angle), .144 + .010 * Math.cos(angle) + (v - .5) * (.035 + .008 * temple),
    -.004 + z * Math.cos(angle)];
}

function goggleParts() {
  if (parts) return parts;
  const lenses = {};
  for (const name of ['smoke', 'amber']) {
    const texture = lensTexture(name === 'amber');
    lenses[name] = new THREE.MeshPhysicalMaterial({
      map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: .16,
      metalness: .26, roughness: .22, clearcoat: .82, clearcoatRoughness: .14,
      side: THREE.DoubleSide,
    });
  }
  const finishes = Object.fromEntries(Object.entries(GOGGLES).map(([id, color]) => [id, {
    frame: new THREE.MeshStandardMaterial({ color: color.frame, roughness: .39, side: THREE.DoubleSide }),
    strap: new THREE.MeshStandardMaterial({ map: strapTexture(color.strap), roughness: .91, side: THREE.DoubleSide }),
    lens: lenses[color.lens],
  }]));
  const hardware = new THREE.MeshStandardMaterial({ color: '#151416', roughness: .54, side: THREE.DoubleSide });
  parts = {
    finishes,
    foam: rim([[.006, -.013], [.003, -.022, .002], [.001, -.037, .004],
      [.009, -.048, .004], [.015, -.050, .003], [.018, -.039], [.016, -.014]]),
    foamMaterial: new THREE.MeshStandardMaterial({ color: '#1b1a1b', bumpMap: foamTexture(), bumpScale: .00075,
      roughness: .99, side: THREE.DoubleSide }),
    frame: rim([[.005, -.021], [.000, -.013], [-.002, -.006], [.000, .000], [.004, .002], [.008, -.002]]),
    trim: buildTrim(hardware),
    lens: surface(56, 16, (s, v) => shield(s * 2 - 1, v), ([, y]) => (y - .091) / .091),
    brow: surface(18, 4, (s, v) => contour((s - .5) * .37, true, .002 + .0053 * (1 - v), .003)),
    browMaterial: new THREE.MeshBasicMaterial({ map: browTexture(), alphaTest: .46, toneMapped: false }),
    strap: surface(56, 8, (s, v) => strapPoint(lerp(strapStart, strapEnd, s), v)),
  };
  return parts;
}

function mesh(parent, name, geometry, material) {
  const part = new THREE.Mesh(geometry, material);
  part.name = name;
  parent.add(part);
  return part;
}

function buildTrim(hardware) {
  const trim = new THREE.Group();
  mesh(trim, 'Lens gasket', rim([[.007, .000], [.009, .0012], [.011, -.001]]), hardware);
  const vents = new THREE.CircleGeometry(1, 10);
  for (let i = -7; i <= 7; i++) {
    const u = i * .113;
    const vent = mesh(trim, 'Lens vents', vents, hardware);
    vent.position.set(...shield(u, .922, .0011));
    vent.rotation.y = 1.08 * u;
    vent.scale.set(.0020, .0028, 1);
  }
  const buckle = new THREE.Group(), angle = 2.40;
  const buckleParts = [[0, .021, .027, .004], [0, -.021, .027, .004],
    [-.012, 0, .004, .044], [0, 0, .004, .044], [.012, 0, .004, .044]];
  for (const [x, y, w, h] of buckleParts) {
    mesh(buckle, 'Strap buckle', new THREE.BoxGeometry(w, h, .005), hardware).position.set(x, y, 0);
  }
  buckle.position.set(...strapPoint(angle, .5, .004));
  buckle.rotation.y = angle;
  trim.add(buckle);
  batchRigidParts(buckle);
  batchRigidParts(trim);
  return trim;
}

export function buildSkiGoggles(initialColor = DEFAULT_GOGGLES) {
  const p = goggleParts();
  const group = new THREE.Group();
  group.name = 'Smith × Supreme goggles';
  mesh(group, 'Black face foam', p.foam, p.foamMaterial);
  const frame = mesh(group, 'Molded frame', p.frame, p.finishes[DEFAULT_GOGGLES].frame);
  const strap = mesh(group, 'Woven Supreme strap', p.strap, p.finishes[DEFAULT_GOGGLES].strap);
  const lens = mesh(group, 'Cylindrical lens', p.lens, p.finishes[DEFAULT_GOGGLES].lens);
  mesh(group, 'Smith brow mark', p.brow, p.browMaterial);
  group.add(p.trim.clone());

  function setColor(id) {
    const color = isGoggleColor(id) ? id : DEFAULT_GOGGLES;
    if (group.userData.goggles === color) return;
    const finish = p.finishes[color];
    group.userData.goggles = color;
    frame.material = finish.frame;
    strap.material = finish.strap;
    lens.material = finish.lens;
  }
  setColor(initialColor);
  return { group, setColor };
}
