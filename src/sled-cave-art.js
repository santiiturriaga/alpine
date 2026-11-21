import * as THREE from 'three';
import { hash2, mix, mulberry32, noise2, smoothstep } from './math.js';
import { caveRoofHeight } from './sled-course-plan.js';
import { glacierIceMaterial } from './glacier-cave.js';
import { sledIceMaterials } from './sled-ice-material.js';
import { SledMeshBuilder, tintedMaterial } from './sled-biome-mesh.js';
import { mergeParts, part } from './scenery.js';

const shade = new THREE.Color();
const iceDark = new THREE.Color('#204f69');
const iceLight = new THREE.Color('#69b7ca');
const snow = new THREE.Color('#d9edf5');
const blueSnow = new THREE.Color('#9ebfd3');
const pi = Math.PI;

// Scale up the elongated melt pockets used on the Whistler cave vault.
function meltPockets(theta, d) {
  const x = theta * 5.6, z = d * .19 + .32 * Math.sin(theta * 4.2 + d * .09);
  const ix = Math.floor(x), iz = Math.floor(z);
  let relief = 0;
  for (let j = iz - 1; j <= iz + 1; j++) {
    for (let i = ix - 1; i <= ix + 1; i++) {
      const dx = x - i - .16 - .68 * hash2(i, j, 19), dz = z - j - .17 - .66 * hash2(i, j, 67);
      const bowl = Math.max(0, 1 - .77 * dx * dx - .52 * (dz - .35 * dx) ** 2);
      relief += (.28 + 1.07 * hash2(i, j, 102)) * bowl ** 3;
    }
  }
  return relief;
}

function inside(section, theta, d, pointAt) {
  const w = d - section.tunnelStart;
  const arch = Math.sin(theta);
  const wave = .70 * Math.sin(w * .038 + theta * 4.2) + .33 * Math.cos(w * .164 - theta * 4.4);
  const bowl = meltPockets(theta, w);
  const drift = .88 * noise2.fbm(theta * 1.85 + w * .041, w * .096, 3);
  const x = section.centerX - (section.halfWidth + wave + bowl + drift) * Math.cos(theta)
    + 1.04 * arch ** 2 * Math.sin(w * .09 + .7);
  const h = -.86 + section.ceilingHeight * arch ** .76
    + arch * (bowl * .91 + drift + .68 * Math.sin(w * .057 + theta * 4));
  return pointAt(x, d, h);
}

function crust(section, x, d, pointAt) {
  const border = Math.abs(x - section.centerX);
  const shoulder = smoothstep(section.halfWidth + .1, 37.5, border);
  const ridges = 1.45 * Math.sin(x * .48 + d * .104) * Math.sin(d * .085 + x * .41);
  const thickness = caveRoofHeight(section, x, d);
  return pointAt(x, d, (thickness + ridges * smoothstep(16.05, 19, border)) * (1 - shoulder) - shoulder * .33 + .014);
}

function makeRoof(group, section, pointAt, material, start, end) {
  const roof = new SledMeshBuilder();
  const spans = [-38, -32, -27, -23, -20, -18.4, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8.6,
    -7, -5, -3, -1.5, 0, 1.5, 3, 5, 7, 8.6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18.4, 20, 23, 27, 32, 38];
  const rows = Math.max(2, Math.ceil((end - start) / 2.3));
  for (let row = 0; row <= rows; row++) {
    const d = mix(start, end, row / rows);
    for (let col = 0; col < spans.length; col++) {
      const x = spans[col] + section.centerX;
      const blue = smoothstep(14, 34, Math.abs(x)) * .57;
      const track = .07 * Math.exp(-((x - 4 * Math.sin(d * .018)) ** 2) / 13);
      const ripple = .038 * Math.sin(d * .20 + x * .61) + .026 * Math.cos(d * .38 - x * .38);
      shade.copy(snow).lerp(blueSnow, blue + track).multiplyScalar(1 + ripple);
      const i = roof.vertex(crust(section, x, d, pointAt), shade, x, d);
      if (row && col) roof.quad(i - spans.length - 1, i - spans.length, i, i - 1);
    }
  }
  roof.add(group, 'Rideable snowfield above the ice cave', material);
}

function makeRoofExit(group, section, pointAt, ice, snowMaterial) {
  const ramp = new SledMeshBuilder();
  const sides = new SledMeshBuilder();
  const center = section.roofExitSide * 8.6;
  const halfWidth = section.exitHalfWidth;
  const start = section.tunnelEnd;
  const spans = [-1, -.85, -.48, 0, .48, .85, 1];
  for (let row = 0; row <= 32; row++) {
    const d = start + row / 32 * 72;
    for (let col = 0; col < spans.length; col++) {
      const x = center + spans[col] * halfWidth;
      const h = caveRoofHeight(section, x, d);
      shade.copy(snow).lerp(blueSnow, .27 * Math.abs(spans[col]) ** 2);
      const i = ramp.vertex(pointAt(x, d, h + .013), shade);
      if (row && col) ramp.quad(i - spans.length - 1, i - spans.length, i, i - 1);
    }
    for (const sign of [-1, 1]) {
      const x = center + sign * halfWidth;
      const h = caveRoofHeight(section, x, d);
      const upper = sides.vertex(pointAt(x, d, h), iceLight);
      const lower = sides.vertex(pointAt(x + sign * .57, d, -.15), iceDark);
      if (row) sides.quad(upper - 4, lower - 4, lower, upper);
    }
  }
  for (let col = 0; col <= 9; col++) {
    const x = center + (col / 4.5 - 1) * halfWidth;
    const h = caveRoofHeight(section, x, start);
    const upper = sides.vertex(pointAt(x, start, h), iceLight);
    const lower = sides.vertex(pointAt(x, start, -.2), iceDark);
    if (col) sides.quad(upper - 2, lower - 2, lower, upper);
  }
  ramp.add(group, 'Snow chute from ice cave roof', snowMaterial);
  sides.add(group, 'Ice walls below the snow chute', ice);
}

function makeIceTunnel(group, section, pointAt, materials) {
  const { tunnelStart: start, tunnelEnd: end } = section;
  const liner = new SledMeshBuilder();
  const portal = new SledMeshBuilder();
  const rings = 47;
  const rows = Math.ceil((end - start) / 2.45);
  for (let row = 0; row <= rows; row++) {
    const d = mix(start, end, row / rows);
    const axis = pointAt(0, d).x;
    for (let col = 0; col < rings; col++) {
      const theta = col / (rings - 1) * pi;
      const p = inside(section, theta, d, pointAt);
      const i = liner.vertex(p, iceLight, p.x - axis, d - start);
      if (row && col) liner.quad(i - rings - 1, i - 1, i, i - rings);
    }
  }
  liner.add(group, 'Sculpted Blackcomb meltwater vault', materials.wall);

  // The entrance has a solid glacier cross-section around a genuinely open arch.
  const lips = [-36, -32, -28, -23, -17, -11, 0, 11, 17, 23, 28, 32, 36];
  const layers = 14;
  for (const edge of [start, end]) {
    const inward = edge === start ? 1 : -1;
    for (let col = 0; col < rings; col++) {
      const t = col / (rings - 1);
      const theta = t * pi;
      const k = Math.min(lips.length - 2, Math.floor(t * (lips.length - 1)));
      const x = mix(lips[k], lips[k + 1], t * (lips.length - 1) - k);
      const outer = crust(section, x, edge, pointAt);
      const inner = inside(section, theta, edge, pointAt);
      const normal = Math.sin(theta) ** .7;
      for (let layer = 0; layer < layers; layer++) {
        const p = layer / (layers - 1);
        const vertex = inner.clone().lerp(outer, p);
        const curl = Math.sin(p * pi) * (2.2 + .64 * Math.sin(theta * 5.3) + .44 * Math.sin(theta * 13.1));
        vertex.z += inward * curl * (.45 + normal * .55);
        vertex.y += Math.sin(p * pi) * normal * (.99 + .34 * Math.cos(theta * 5.1));
        const i = portal.vertex(vertex, iceLight, vertex.x - pointAt(0, edge).x, -vertex.z - start);
        if (col && layer) portal.quad(i - layers - 1, i - 1, i, i - layers);
      }
    }
  }
  portal.add(group, 'Fractured glacier arches and snow cornice', materials.portal);
}

function iceBed(group, section, pointAt, gaps, material) {
  const start = section.tunnelStart, end = section.tunnelEnd;
  const cuts = [start];
  for (const gap of gaps) if (gap.start < end && gap.end > start) cuts.push(Math.max(start, gap.start), Math.min(end, gap.end));
  cuts.push(end);
  const bed = new SledMeshBuilder();
  const spans = [-20.5, -18.4, -16.8, -15, -13, -11, -9, -7, -5, -3, -1.5, 0,
    1.5, 3, 5, 7, 9, 11, 13, 15, 16.8, 18.4, 20.5];
  for (let i = 0; i < cuts.length - 1; i += 2) {
    const a = cuts[i], b = cuts[i + 1];
    const rows = Math.max(1, Math.ceil((b - a) / 2.3));
    for (let row = 0; row <= rows; row++) {
      const d = mix(a, b, row / rows);
      for (let col = 0; col < spans.length; col++) {
        const x = spans[col];
        const rise = .049 + .13 * smoothstep(11.3, 18, Math.abs(x));
        const i = bed.vertex(pointAt(x, d, rise), iceLight, x, d - start);
        if (row && col) bed.quad(i - spans.length - 1, i - spans.length, i, i - 1);
      }
    }
  }
  bed.add(group, 'Worn snow lanes over planed glacier ice', material);
}

function needleGeometry() {
  const geometry = new THREE.LatheGeometry([
    new THREE.Vector2(.012, -1), new THREE.Vector2(.13, -.83), new THREE.Vector2(.26, -.58),
    new THREE.Vector2(.48, -.35), new THREE.Vector2(.67, -.15), new THREE.Vector2(.88, -.045),
    new THREE.Vector2(1, 0), new THREE.Vector2(0, 0),
  ], 9);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const jitter = 1 + .24 * noise2.fbm(x * 3.7 + 3, z * 4.7 + y * 11.1, 3);
    position.setXYZ(i, x * jitter + .16 * y, y, z * jitter - .132 * y * y);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function addCrystals(group, section, pointAt) {
  const random = mulberry32((section.start ^ 14179) >>> 0);
  const core = needleGeometry();
  const shard = new THREE.IcosahedronGeometry(1, 1);
  const positions = shard.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const split = Math.max(.68, .99 - .55 * Math.max(0, y * .22 + z * .41 - x * .24));
    const warp = split + .34 * noise2.fbm(x * 3.31 + y * 5.23, z * 4.1 - y * 2.2, 3);
    positions.setXYZ(i, x * warp, y * warp, z * warp);
  }
  shard.computeVertexNormals();
  const material = glacierIceMaterial(true);
  material.transmission = 0;
  material.vertexColors = true;
  material.color.set('#d7eff8');
  material.emissive.set('#1d617b');
  material.emissiveIntensity = .22;
  const frost = new THREE.Color('#99dbe9');
  const aqua = new THREE.Color('#317c9a');
  const { tunnelStart: start, tunnelEnd: end } = section;
  for (let chunk = start; chunk < end; chunk += 64) {
    const parts = [];
    const span = Math.min(64, end - chunk);
    const count = Math.floor(span / 1.35) + (chunk === start ? 29 : 0);
    for (let i = 0; i < count; i++) {
      const d = chunk + random() * (chunk === start && i > 35 ? 13 : span);
      const side = random() < .5 ? -1 : 1;
      const theta = side < 0 ? .40 + random() * 1.06 : 2.74 - random() * 1.06;
      const base = inside(section, theta, d, pointAt);
      const len = .47 + random() ** 2.6 * 3.85;
      const xSkew = side * (.05 + random() * .21);
      base.y += .07;
      parts.push(part(core, frost.clone().lerp(aqua, random() * .68), base.toArray(),
        [(.5 - random()) * .13, random() * 2 * pi, xSkew], [.11 + len * .19, len, .10 + len * .20]));
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 21; i++) {
        const d = chunk + random() * span;
        const cluster = side * (16.75 + random() * 1.71);
        const size = .32 + random() ** 1.7 * 1.58;
        const p = pointAt(cluster, d, size * .19);
        parts.push(part(shard, aqua.clone().lerp(frost, random() * .86), p.toArray(),
          [(.5 - random()) * .85, random() * pi, side * (.25 + .34 * random())], [.66 * size, .91 * size, size]));
      }
    }
    const mesh = new THREE.Mesh(mergeParts(parts, true), material);
    mesh.name = 'Warped ice stalactites and fractured glacier clasts';
    group.add(mesh);
  }
  core.dispose();
  shard.dispose();
}

export function buildCaveArt(group, section, pointAt, gaps) {
  const { tunnelStart: start, tunnelEnd: end } = section;
  if (!(end > start)) return;
  const ice = sledIceMaterials(pointAt(0, start).y, end - start);
  const snowMaterial = tintedMaterial({ roughness: .93 });
  makeIceTunnel(group, section, pointAt, ice);
  iceBed(group, section, pointAt, gaps, ice.floor);
  addCrystals(group, section, pointAt);
  makeRoof(group, section, pointAt, snowMaterial, start, end);
  if (section.roofExitSide) makeRoofExit(group, section, pointAt,
    tintedMaterial({ side: THREE.DoubleSide, roughness: .64 }), snowMaterial);
}
