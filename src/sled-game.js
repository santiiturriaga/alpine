import * as THREE from 'three';
import { clamp, mix, mulberry32, makeNoise, smoothstep as smooth } from './math.js';
import { addSledCourseProps } from './sled-course-props.js';
import { poseSledRider, sledModel } from './sled-rider.js';
import { batchRigidParts } from './skier-hardware.js';
import { sledTreeAssets } from './sled-trees.js';
import { addSledBiomeArt } from './sled-biome-art.js';
import { fallState } from './sled-course-plan.js';

import {
  EDGE, LANE, STEP, RAMP_LENGTH, RAMP_HALF, RAMP_HEIGHT, RACE_LENGTH, SLED_SEGMENT_LENGTH,
  center, altitude, slope, gapAt, snowHeight, surfaceHeight, buildSledSegment, movingBalls, freshRun, points, simulate,
  freshRival, simulateRival, sectionAt, supportHeight,
} from './sled-course.js';

const IMPACT_TIME = .29;
const COLORS = {
  sky: 0x9ebfd3, mist: 0xb5cfdb, snow: 0xe7f2f7, compact: 0xc6dce7,
  ice: 0x598ba5, cedar: 0x504247, red: 0xbb422d, amber: 0xffbd65, metal: 0x354454,
};
const GROUND_START = -49;
const groundColumns = [-120, -100, -83, -69, -57, -48, -40, -34, -29, -24, -20, -17, -15, -13, -11, -9, -7, -5, -3, -1.5, 0,
  1.5, 3, 5, 7, 9, 11, 13, 15, 17, 20, 24, 29, 34, 40, 48, 57, 69, 83, 100, 120];
function courseLayout(course) {
  const { start, end, length, gaps } = course;
  const groundStart = start === 0 ? GROUND_START : start;
  const groundEnd = end === length ? end + 155 : end;
  const cuts = [groundStart, ...gaps.flatMap(gap => [gap.start, gap.end]), groundEnd];
  const strips = [];
  for (let i = 0; i < cuts.length - 1; i += 2) {
    const a = cuts[i], b = cuts[i + 1];
    strips.push({ start: a, end: b, rows: Math.ceil((b - a) / 3.65) });
  }
  return {start, end, length, gaps, groundStart, groundEnd, strips, sections: course.sections ?? []};
}

function timeText(time) {
  const tenths = Math.round(time * 10);
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
}

function surfacePoint(x, d, rise = 0) {
  return new THREE.Vector3(center(d) + x, snowHeight(x, d) + rise, -d);
}

function renderedSnowHeight(x, d, strips) {
  const strip = strips.find(({ start, end }) => d >= start && d <= end);
  if (!strip) return snowHeight(x, d);
  const { start, end, rows } = strip;
  const row = (d - start) / (end - start) * rows;
  const index = Math.min(rows - 1, Math.floor(row));
  const t = row - index;
  const a = mix(start, end, index / rows), b = mix(start, end, (index + 1) / rows);
  // The scene triangulates in world coordinates, including the centerline bend.
  const localX = clamp(x + center(d) - mix(center(a), center(b), t), groundColumns[0], groundColumns.at(-1));
  const next = Math.max(1, groundColumns.findIndex(column => column >= localX));
  const left = groundColumns[next - 1], right = groundColumns[next];
  const u = (localX - left) / (right - left);
  const h10 = snowHeight(right, a), h01 = snowHeight(left, b);
  return u + t <= 1
    ? snowHeight(left, a) * (1 - u - t) + h10 * u + h01 * t
    : snowHeight(right, b) * (u + t - 1) + h10 * (1 - t) + h01 * (1 - u);
}

function meshGeometry(positions, colors, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (indices) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function snowTexture(random) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f7fbff';
  context.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 3800; i++) {
    context.fillStyle = random() < .45 ? 'rgba(255,255,255,.78)' : `rgba(121,163,182,${random() * .23})`;
    context.fillRect(random() * 128, random() * 128, 1 + random() * 2.8, 1 + random() * 1.6);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

// Compressed layers, mineral seams and frost use metre-scale UVs across
// adjacent cliff faces. Generate the tile once when the course opens.
function glacierTexture() {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const rng = mulberry32(82634);
  const phase = Math.PI * 2 / size;
  for (let x = 0; x < size; x++) {
    const a = x * phase;
    const buckle = .44 * Math.sin(a) + .26 * Math.sin(2 * a + .6) + .10 * Math.cos(4 * a);
    for (let y = 0; y < size; y++) {
      const b = y * phase;
      const depth = b + buckle + .09 * Math.sin(a + b * 2);
      const layer = Math.sin(depth * 5 + .65 * Math.sin(depth * 3));
      const seam = Math.max(0, layer) ** 14;
      const rift = Math.max(0, Math.cos(a * 3 + b + 1.4 * Math.sin(2 * b))) ** 46;
      const grit = (rng() - .5) * (8 + seam * 15);
      const v = 206 + 19 * Math.sin(depth * 2) + 7 * Math.sin(depth * 39) - 45 * seam - 30 * rift + grit;
      const i = 4 * (y * size + x);
      pixels[i] = clamp(v - 6, 0, 255);
      pixels[i + 1] = clamp(v + 6, 0, 255);
      pixels[i + 2] = clamp(v + 13, 0, 255);
      pixels[i + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

function terrain(scene, random, materials, { strips, gaps }) {
  const snow = new THREE.Color(COLORS.snow);
  const light = new THREE.Color(), shaded = new THREE.Color(0xbad6e2);
  const across = groundColumns;
  for (const { start, end, rows } of strips) {
    const positions = [], colors = [], uvs = [], indices = [];
    for (let row = 0; row <= rows; row++) {
      const d = mix(start, end, row / rows);
      for (let col = 0; col < across.length; col++) {
        const x = across[col];
        positions.push(center(d) + x, snowHeight(x, d), -d);
        uvs.push((center(d) + x) * .48, d * .48);
        const tint = .051 * Math.sin(x * .63 + d * .032) + .03 * Math.sin(x * .34 + d * .087) + .021 * (1 + Math.sin(x * 29.37 + d * 19.11));
        const lane = Math.min(Math.abs(x + LANE), Math.abs(x), Math.abs(x - LANE));
        const packed = (1 - smooth(.15, 2.85, lane)) * smooth(0, 19, d) * .06;
        const bank = smooth(EDGE - 2, EDGE + 8, Math.abs(x)) * (.14 + .19 * Math.sin(d * .13 + x * .42) ** 2);
        light.copy(snow).lerp(shaded, bank).multiplyScalar(1.01 + tint - packed).toArray(colors, colors.length);
        if (col && row) {
          const i = row * across.length + col;
          indices.push(i - across.length - 1, i - across.length, i - 1, i - 1, i - across.length, i);
        }
      }
    }
    const strip = new THREE.Mesh(meshGeometry(positions, colors, uvs, indices), materials.snow);
    strip.name = 'Groomed terrain';
    scene.add(strip);
  }
  const rock = new THREE.Color(0x68939a), ice = new THREE.Color(0xc0e2e7), tint = new THREE.Color();
  for (const [index, gap] of gaps.entries()) {
    if (gap.kind === 'waterfall' || gap.kind === 'riverEntry') continue;
    const width = gap.end - gap.start;
    const floor = Math.min(altitude(gap.start), altitude(gap.end)) - (24.5 + index * 2.3);
    for (const [edge, side] of [[gap.start, 1], [gap.end, -1]]) {
      const verts = [], col = [], uvs = [];
      const layers = [[0, 0], [.09, 1.2], [.27, 3.1], [.53, 4.6], [.78, 5.7], [1, 6.6]];
      const profile = x => {
        const ledge = Math.sin(x * .42 + edge) * .65 + Math.cos(x * .15) * 1.1;
        const cut = renderedSnowHeight(x, edge, strips);
        return layers.map(([depth, reach]) => {
          const point = surfacePoint(x + depth * ledge, edge + side * (reach + ledge * depth));
          point.y = mix(cut, floor, depth) + Math.sin(depth * Math.PI) * ledge;
          return point;
        });
      };
      for (let x = -120; x < 120; x += 3) {
        const a = profile(x), b = profile(x + 3);
        const vein = .5 + .5 * Math.sin(x * .36 + edge * .07);
        for (let layer = 0; layer < a.length - 1; layer++) {
          const quad = [a[layer], b[layer], b[layer + 1], a[layer], b[layer + 1], a[layer + 1]];
          if (!layer) tint.copy(snow).lerp(ice, .31 + .2 * vein);
          else tint.copy(rock).lerp(ice, .16 + .50 * vein + (layer === 2 ? .23 : 0))
            .multiplyScalar(.91 - layer * .105 + .21 * random());
          for (const vertex of quad) {
            verts.push(vertex.x, vertex.y, vertex.z);
            uvs.push(vertex.x / 14, vertex.y / 8.5 + vertex.x * .009);
            tint.toArray(col, col.length);
          }
        }
      }
      const cut = new THREE.Mesh(meshGeometry(verts, col, uvs), materials.cliff);
      cut.name = `${gap.name} · layered ice wall`;
      scene.add(cut);
    }
    const bed = new THREE.PlaneGeometry(245, width + 1, 75, 12);
    bed.rotateX(-Math.PI / 2);
    const channels = [], surface = bed.attributes.position;
    for (let i = 0; i < surface.count; i++) {
      const x = surface.getX(i), z = surface.getZ(i);
      const fault = Math.sin(z * .53 + Math.sin(x * .17) * .5 + index) ** 6;
      surface.setY(i, .23 * Math.sin(x * .21 + z * .18) - .11 * fault);
      tint.setRGB(.32 + .56 * fault, .56 + .40 * fault, .75 + .25 * fault).toArray(channels, channels.length);
    }
    bed.setAttribute('color', new THREE.Float32BufferAttribute(channels, 3));
    bed.computeVertexNormals();
    const basin = new THREE.Mesh(bed, materials.water);
    basin.name = `${gap.name} · glacier bed`;
    basin.position.set(center((gap.start + gap.end) / 2), floor + .18, -(gap.start + gap.end) / 2);
    scene.add(basin);
  }
}

function skyline(scene) {
  const size = 4000;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(size, 22, 14), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      blue: { value: new THREE.Color(COLORS.sky) }, mist: { value: new THREE.Color(0xe0d9cc) },
      peak: { value: new THREE.Color(0x608bab) },
    },
    vertexShader: 'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vDirection;
      uniform vec3 blue;uniform vec3 mist;uniform vec3 peak;
      void main(){vec3 d=normalize(vDirection);float up=max(d.y,0.0);vec3 c=mix(mist,blue,smoothstep(0.02,.23,up));
      c=mix(c,peak,smoothstep(.22,.92,up));
      float sun=max(0.0,dot(d,normalize(vec3(-.53,.28,-.67))));
      c+=vec3(.30,.205,.108)*pow(sun,24.0)+vec3(.54,.32,.14)*pow(sun,187.0);
      gl_FragColor=vec4(c,1.0);
      #include <colorspace_fragment>
    }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);
  // A separate horizon mesh holds the same distance from the chase camera
  // on an endless descent. Small, bounded parallax leaves the stage in motion.
  const ridgeNoise = makeNoise(61238);
  const ranges = [
    { at: 2250, rise: 550, front: 560, back: 320, peaks: [[-1730, 680, 780], [-690, 490, 570], [610, 340, 400], [1380, 760, 590]] },
    { at: 2870, rise: 620, front: 670, back: 390, peaks: [[-1450, 560, 660], [-280, 700, 550], [410, 430, 500], [1620, 725, 770]] },
    { at: 3560, rise: 630, front: 620, back: 340, peaks: [[-2050, 720, 640], [-980, 710, 590], [400, 810, 710], [1680, 740, 650]] },
  ];
  const positions = [], indices = [], colors = [];
  const cols = 140, rows = 68;
  for (let j = 0; j <= rows; j++) {
    const d = 1640 + j / rows * 2450;
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols - .5) * 6900;
      let relief = 0;
      for (let k = 0; k < ranges.length; k++) {
        const range = ranges[k];
        const crest = range.at + 105 * Math.sin(x * .0027 + k) + 58 * ridgeNoise.noise2(x / 205, k);
        const delta = d - crest;
        const t = Math.max(0, 1 - Math.abs(delta) / (delta < 0 ? range.front : range.back));
        if (!t) continue;
        let summit = 0;
        for (const [peakX, height, width] of range.peaks) {
          summit = Math.max(summit, height * Math.exp(-(((x - peakX) / width) ** 2)));
        }
        const ribs = ridgeNoise.ridged(x / 90 + delta / 175, d / 310, 3);
        const shoulder = (range.rise + summit + 52 * ridgeNoise.noise2(x / 120, k + 13)) * t ** .8;
        relief = Math.max(relief, shoulder + (ribs - .52) * 148 * Math.sqrt(t));
      }
      positions.push(x, -620 + relief * .87, -d);
      if (i && j) {
        const v = j * (cols + 1) + i;
        indices.push(v - cols - 2, v - cols - 1, v - 1, v - 1, v - cols - 1, v);
      }
    }
  }
  const geometry = meshGeometry(positions, null, null, indices);
  const normal = geometry.getAttribute('normal');
  const granite = new THREE.Color(0x596675), snow = new THREE.Color(0xf4f1e7);
  const shade = new THREE.Color(0x94afc6), haze = new THREE.Color(0xc3d0d7), tint = new THREE.Color();
  for (let i = 0; i < normal.count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    const sun = clamp(-nx * .78 + ny * .35 - nz * .31, 0, 1);
    const stoneLine = .63 + .09 * ridgeNoise.noise2(x / 65, z / 88) - .08 * smooth(-150, 520, y);
    const coverage = smooth(stoneLine - .1, stoneLine + .08, ny);
    tint.copy(granite).lerp(snow, coverage).lerp(shade, .62 * (1 - sun)).multiplyScalar(.67 + sun * .42);
    tint.lerp(haze, .34 + .37 * smooth(2010, 3850, -z)).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const range = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  range.name = 'Distant alpine ridges';
  scene.add(range);
  return { sky, range };
}

function forestAssets() {
  const trees = sledTreeAssets();
  const boulder = new THREE.IcosahedronGeometry(1, 1);
  const cap = new THREE.Color(0xe0e8ec), stone = new THREE.Color(0x637482);
  const color = new THREE.Color();
  const stoneColors = [];
  for (let i = 0; i < boulder.attributes.position.count; i++) {
    const y = boulder.attributes.position.getY(i);
    color.copy(stone).lerp(cap, smooth(.08, .44, y)).toArray(stoneColors, stoneColors.length);
  }
  boulder.setAttribute('color', new THREE.Float32BufferAttribute(stoneColors, 3));
  const boulderMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93 });
  return { ...trees, boulder, boulderMaterial };
}

function forest(scene, random, { treeRows, sections }, { groundStart, groundEnd, gaps, strips }, assets) {
  const { trunk, trunkMaterial, needleMaterial, crowns, boulder, boulderMaterial } = assets;
  const o = new THREE.Object3D(), color = new THREE.Color();
  const shadowSpots = [], chunks = [];
  for (let chunk = groundStart; chunk < groundEnd; chunk += 75) {
    const { full, medium, distant } = crowns[chunks.length % crowns.length];
    const finish = Math.min(groundEnd, chunk + 75);
    const group = treeRows.filter(tree => tree.d >= chunk && tree.d < finish);
    const rocks = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < Math.round((finish - chunk) * .49); i++) {
        const d = mix(chunk, finish, random());
        if (gapAt(d, gaps)) continue;
        const ridge = Math.sin(d * .108 + side * 6) ** 2;
        const zone = sections?.find(section => d >= section.start && d < section.end)?.kind;
        const margin = zone === 'cave' ? 40 : zone === 'village' ? 32 : zone === 'river' ? 30 : 18;
        const x = side * (margin + ridge * 7 + random() ** 1.89 * (106 - margin));
        group.push({ d, x, h: 10 + random() ** .85 * 31 });
      }
      for (let i = 0; i < Math.round((finish - chunk) * .12); i++) {
        const d = mix(chunk, finish, random());
        if (gapAt(d, gaps)) continue;
        const w = .75 + random() ** 2 * 3.9;
        const zone = sections?.find(section => d >= section.start && d < section.end)?.kind;
        rocks.push({ d, x: side * (EDGE + (zone && zone !== 'forest' ? 15 : 0) + w * 1.18 + 1.1 + random() ** 1.72 * 61), w });
      }
    }
    const trunks = new THREE.InstancedMesh(trunk, trunkMaterial, group.length);
    trunks.name = 'Rooted fir trunks';
    const closeFoliage = tree => Math.abs(tree.x) < 29;
    const nearCount = group.filter(closeFoliage).length;
    const nearFoliage = new THREE.InstancedMesh(full, needleMaterial, nearCount);
    const hills = new THREE.InstancedMesh(medium, needleMaterial, group.length - nearCount);
    const distantFoliage = new THREE.InstancedMesh(distant, needleMaterial, group.length);
    const foliage = new THREE.Group();
    foliage.add(nearFoliage, hills);
    let nearIndex = 0, hillIndex = 0;
    group.forEach((tree, i) => {
      const roots = tree.hit ? snowHeight(tree.x, tree.d) : renderedSnowHeight(tree.x, tree.d, strips);
      o.position.set(center(tree.d) + tree.x, roots - .32, -tree.d);
      const tilt = tree.hit ? 0 : .09;
      o.rotation.set((random() - .5) * tilt, random() * Math.PI * 2, (random() - .5) * tilt);
      const width = tree.hit ? tree.hit / .043 : tree.h * (.74 + random() * .36);
      o.scale.set(width, tree.h, width);
      o.updateMatrix();
      if (!tree.hit) {
        // Crown spread and trunk diameter vary independently in natural stands.
        const radius = .40 + .14 * Math.min(1, tree.h / 34);
        o.scale.set(width * radius, tree.h, width * radius);
        o.updateMatrix();
      }
      trunks.setMatrixAt(i, o.matrix);
      o.scale.set(width, tree.h, width);
      o.updateMatrix();
      const near = closeFoliage(tree);
      const canopy = near ? nearFoliage : hills;
      const index = near ? nearIndex++ : hillIndex++;
      canopy.setMatrixAt(index, o.matrix);
      distantFoliage.setMatrixAt(i, o.matrix);
      color.setScalar(.81 + random() * .26);
      trunks.setColorAt(i, color);
      color.setScalar(.76 + random() * .29);
      canopy.setColorAt(index, color);
      distantFoliage.setColorAt(i, color);
      if (Math.abs(tree.x) < 32) shadowSpots.push(tree);
    });
    const clasts = new THREE.InstancedMesh(boulder, boulderMaterial, rocks.length);
    clasts.name = 'Snow-capped bankside rocks';
    rocks.forEach(({ d, x, w }, i) => {
      o.position.set(center(d) + x, renderedSnowHeight(x, d, strips) - .22, -d);
      o.rotation.set((random() - .5) * .24, random() * Math.PI * 2, (random() - .5) * .41);
      o.scale.set(w, w * (.72 + random() * .46), w * (1.1 + random() * .48));
      o.updateMatrix();
      clasts.setMatrixAt(i, o.matrix);
      clasts.setColorAt(i, color.setScalar(.72 + random() * .48));
    });
    const stand = new THREE.Group();
    stand.add(trunks, foliage, distantFoliage, clasts);
    scene.add(stand);
    chunks.push({ d: chunk, stand, foliage, distantFoliage });
  }
  return { shadowSpots, chunks };
}

function gradientMap() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 31.5);
  gradient.addColorStop(0, 'rgba(255,255,255,.86)');
  gradient.addColorStop(.65, 'rgba(255,255,255,.46)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function treeShadows(scene, material, trees, { strips, gaps, groundStart }) {
  const positions = [], uvs = [], bands = 9;
  for (const { x, d, h } of trees) {
    const width = h * .18, length = h * .47;
    const rootRadius = Math.max(.7, h * .061);
    for(const [u,v] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) {
      const px=x+(u*2-1)*rootRadius, pd=d+(v*2-1)*rootRadius;
      if (gapAt(pd, gaps)) {
        positions.push(center(d)+x,renderedSnowHeight(x,d,strips)+.04,-d);
      } else {
        positions.push(center(pd)+px,renderedSnowHeight(px,pd,strips)+.047,-pd);
      }
      uvs.push(u,v);
    }
    for (let i = 0; i < bands; i++) {
      const near = d - length * i / bands, far = d - length * (i + 1) / bands;
      if (far < groundStart || gapAt(near, gaps) || gapAt(far, gaps)) continue;
      for (const [u, v] of [[0, i], [1, i], [1, i + 1], [0, i], [1, i + 1], [0, i + 1]]) {
        const sampleD = d - length * v / bands;
        const sampleX = x + (u - .5) * width + length * v / bands * .51;
        positions.push(center(sampleD) + sampleX, renderedSnowHeight(sampleX, sampleD, strips) + .063, -sampleD);
        uvs.push(u, v / bands);
      }
    }
  }
  scene.add(new THREE.Mesh(meshGeometry(positions, null, uvs), material));
}

function tracks(scene, material, { start, end, length, gaps }) {
  const surfaces = [start === 0 ? -23 : start, ...gaps.flatMap(gap => [gap.start - 20, gap.end + 2]),
    end === length ? end + 2 : end];
  const chunks = [];
  for (let i = 0; i < surfaces.length - 1; i += 2) {
    const start = surfaces[i], end = surfaces[i + 1];
    const steps = Math.ceil((end - start) / 3);
    const positions = [], colors = [];
    for (const lane of [-1, 0, 1]) {
      for (const runner of [-.48, .48]) {
        const tint = new THREE.Color(COLORS.compact);
        for (let j = 0; j < steps; j++) {
          const a = mix(start, end, j / steps), b = mix(start, end, (j + 1) / steps);
          if ((j + 8 * (lane + 1)) % 22 < 3) continue;
          for (const [d, side] of [[a, -.08], [a, .08], [b, .08], [a, -.08], [b, .08], [b, -.08]]) {
            const x = lane * LANE + runner + .69 * Math.sin(d * .023 + lane * 3) + side;
            const p = surfacePoint(x, d, .036);
            positions.push(p.x, p.y, p.z);
            colors.push(tint.r, tint.g, tint.b);
          }
        }
      }
    }
    chunks.push(new THREE.Mesh(meshGeometry(positions, colors), material));
  }
  scene.add(...chunks);
}

function box(parent, mat, width, height, depth, x, y, z) {
  const part = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function printedSign(text, color = '#a8452e', ink = '#fff1df') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 116;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = ink;
  context.lineWidth = 4;
  context.strokeRect(10, 10, 492, 96);
  context.fillStyle = ink;
  context.font = '800 64px Barlow Condensed, Arial Narrow, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 61, 454);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
}

function venue(scene, materials, course, { start: sectionStart, end: sectionEnd, length, gaps }) {
  const { bark, red, amber, ramp, ice, metal } = materials;
  const gates = [];
  if (sectionStart === 0) {
    const start = new THREE.Group();
    const signMaterial = printedSign('START');
    const signGeometry = new THREE.PlaneGeometry(1.45, .55);
    for (const side of [-1, 1]) {
      const pole = box(start, bark, .18, 2.36, .18, 0, 0, 0);
      pole.position.copy(surfacePoint(side * 12, 23, 1.08));
      const mark = new THREE.Mesh(signGeometry, signMaterial);
      mark.position.copy(pole.position);
      mark.position.y += .78;
      mark.position.z += .1;
      start.add(mark);
    }
    scene.add(start);
  }
  if (sectionEnd === length) gates.push([length, 'FINISH', '#234954']);
  for (const [d, title, color] of gates) {
    const halfSpan = EDGE + 2.6;
    const group = new THREE.Group();
    group.position.copy(surfacePoint(0, d));
    for (const side of [-1, 1]) {
      box(group, bark, .66, 6.45, .62, side * halfSpan, 3.2, 0);
      box(group, red, .78, 1.72, .73, side * halfSpan, 1.16, 0);
      for (const y of [.52, 1.07, 1.64]) box(group, amber, .81, .095, .78, side * halfSpan, y, .02);
      const brace = box(group, bark, .33, 2.55, .37, side * (halfSpan - .8), 5.26, 0);
      brace.rotation.z = side * -.67;
      box(group, metal, .79, .16, .69, side * halfSpan, 5.98, 0);
    }
    box(group, bark, halfSpan * 2 + 1, .46, .63, 0, 6.22, 0);
    box(group, ramp, halfSpan * 2 + 1.16, .12, .72, 0, 6.51, 0);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.18), printedSign(title, color));
    sign.position.set(0, 6.0, .37);
    group.add(sign);
    batchRigidParts(group);
    scene.add(group);
  }
  const markerGeometry = new THREE.CylinderGeometry(.075, .085, 1.13, 6);
  const reflectors = new THREE.InstancedMesh(markerGeometry, amber, 2 * Math.ceil((sectionEnd - sectionStart) / 39));
  let count = 0;
  const transform = new THREE.Object3D();
  for (let d = sectionStart + 17; d < sectionEnd; d += 39) {
    if (gapAt(d, gaps)) continue;
    for (const side of [-1, 1]) {
      transform.position.copy(surfacePoint(side * (EDGE + 2.2), d, .63));
      transform.rotation.z = side * .16;
      transform.updateMatrix();
      reflectors.setMatrixAt(count++, transform.matrix);
    }
  }
  reflectors.count = count;
  scene.add(reflectors);
  for (const gap of gaps) {
    if (gap.kind === 'waterfall' || gap.kind === 'riverEntry') continue;
    const fixture = new THREE.Group();
    fixture.name = gap.name;
    const start = gap.start - RAMP_LENGTH;
    for (const lane of gap.lanes) {
      const x = lane * LANE;
      const positions = [], topUvs = [], sides = [], edges = [], face = [];
      for (let i = 0; i < 12; i++) {
        const a = start + i * RAMP_LENGTH / 12, b = start + (i + 1) * RAMP_LENGTH / 12;
        const top = (x, d, height = 0) => surfacePoint(x, d, .04 + height + RAMP_HEIGHT * ((d - start) / RAMP_LENGTH) ** 1.8);
        for (const [d, side] of [[a, -1], [a, 1], [b, 1], [a, -1], [b, 1], [b, -1]]) {
          const p = top(x + side * RAMP_HALF, d);
          positions.push(p.x, p.y, p.z);
          topUvs.push(p.x * .48, d * .48);
        }
        for (const side of [-1, 1]) {
          const offset = x + side * RAMP_HALF;
          for (const p of [surfacePoint(offset, a), top(offset, a), top(offset, b), surfacePoint(offset, a), top(offset, b), surfacePoint(offset, b)]) {
            sides.push(p.x, p.y, p.z);
          }
          for (const [d, edge] of [[a, -1], [a, 1], [b, 1], [a, -1], [b, 1], [b, -1]]) {
            const p = top(offset - side * .16 + edge * .115, d, .028);
            edges.push(p.x, p.y, p.z);
          }
        }
        if (i === 11) for (const p of [surfacePoint(x - RAMP_HALF, b), top(x - RAMP_HALF, b), top(x + RAMP_HALF, b), surfacePoint(x - RAMP_HALF, b), top(x + RAMP_HALF, b), surfacePoint(x + RAMP_HALF, b)]) {
          face.push(p.x, p.y, p.z);
        }
      }
      fixture.add(new THREE.Mesh(meshGeometry(positions, null, topUvs), materials.launchSnow));
      for (const [data, material] of [[sides, ice], [face, ice], [edges, amber]]) {
        fixture.add(new THREE.Mesh(meshGeometry(data), material));
      }
      for (const offset of [-RAMP_HALF - .42, RAMP_HALF + .42]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(.071, .09, 2.55, 7), red);
        pole.position.copy(surfacePoint(x + offset, start - 1, 1.25));
        fixture.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.08, .68), amber);
        flag.position.copy(pole.position);
        flag.position.x += (offset < 0 ? -.51 : .51);
        flag.position.y += .87;
        fixture.add(flag);
      }
      // Chevrons on the snow lead into the groomed launch surface.
      const marks = [];
      for (let i = 0; i < 4; i++) {
        const d = start - 38 + i * 9;
        for (const side of [-1, 1]) {
          for (const [xx, dd] of [[0, 1.8], [side * 2.25, -.1], [side * 2.25, -.72], [0, 1.8], [side * 2.25, -.72], [0, 1.1]]) {
            const p = surfacePoint(x + xx, d + dd, .105);
            marks.push(p.x, p.y, p.z);
          }
        }
      }
      fixture.add(new THREE.Mesh(meshGeometry(marks), amber));
    }
    batchRigidParts(fixture);
    scene.add(fixture);
    const landing = [];
    for (let x = -14.8; x < 14.8; x += 2.15) {
      for (const [dx, dz] of [[0, 0], [1.09, 0], [1.09, .48], [0, 0], [1.09, .48], [0, .48]]) {
        const p = surfacePoint(x + dx, gap.end + 1.28 + dz, .061);
        landing.push(p.x, p.y, p.z);
      }
    }
    const landingEdge = new THREE.Mesh(meshGeometry(landing), amber);
    landingEdge.name = `${gap.name} · far lip markers`;
    scene.add(landingEdge);
  }
  return addSledCourseProps(scene, course, surfacePoint);
}

function snowballGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 3);
  const position = geometry.attributes.position;
  const colors = [];
  const white = new THREE.Color(0xe8f5fa), ice = new THREE.Color(0x8cb5c6);
  const grit = new THREE.Color(0x9eaab0);
  const tint = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const layers = Math.sin((x * 3.8 + y * 2.6 + z * .7) * 4.5 + Math.sin(z * 8.6));
    const knots = Math.cos(x * 19 + z * 11) * Math.cos(y * 17 - z * 15);
    const r = 1 + .025 * layers + .02 * knots;
    position.setXYZ(i, x * r, y * r, z * r);
    tint.copy(white).lerp(ice, .47 + .24 * layers + .17 * knots)
      .lerp(grit, smooth(.62, .90, knots) * .56).toArray(colors, colors.length);
  }
  geometry.computeVertexNormals();
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function makeWorld(scene, outfit) {
  const random = mulberry32(326276);
  const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .92, ...options });
  const iceMap = glacierTexture();
  const materials = {
    snow: material(0xffffff, { vertexColors: true, map: snowTexture(random) }),
    cliff: material(0xffffff, { vertexColors: true, map: iceMap, bumpMap: iceMap, bumpScale: .12, roughness: .63, side: THREE.DoubleSide }),
    tracks: material(0xffffff, { vertexColors: true, side: THREE.DoubleSide }),
    bark: material(COLORS.cedar),
    water: material(0x285263, { vertexColors: true, roughness: .49, metalness: .26 }),
    red: material(COLORS.red), metal: material(COLORS.metal, { roughness: .38, metalness: .25 }),
    ice: material(COLORS.ice, { side: THREE.DoubleSide }), ramp: material(0xc1e1e9, { side: THREE.DoubleSide }),
    amber: new THREE.MeshBasicMaterial({ color: COLORS.amber, side: THREE.DoubleSide }),
  };
  materials.launchSnow = material(0xd9e9ee, { map: materials.snow.map, roughness: .79 });
  const shadowMap = gradientMap();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x314765, map: shadowMap, transparent: true, depthWrite: false, opacity: .31, side: THREE.DoubleSide,
  });
  const sun = new THREE.DirectionalLight(0xffdfb4, 2.16);
  sun.position.set(-46, 61, -41);
  scene.add(sun, new THREE.HemisphereLight(0xe2f4ff, 0x627285, 2.05));
  const { sky, range } = skyline(scene);
  const assets = forestAssets();
  const sled = sledModel(outfit);
  const flat = new THREE.PlaneGeometry(1, 1);
  flat.rotateX(-Math.PI / 2);
  const sledShadow = new THREE.Mesh(flat, shadowMaterial);
  scene.add(sled.group, sledShadow);
  const ballGeometry = snowballGeometry();
  const ballMaterial = material(0xffffff, { vertexColors: true });
  const shared = {
    geometries: new Set([flat, ballGeometry, assets.trunk, assets.boulder,
      ...assets.crowns.flatMap(({ full, medium, distant }) => [full, medium, distant])]),
    materials: new Set([...Object.values(materials), shadowMaterial, ballMaterial, assets.trunkMaterial,
      assets.needleMaterial, assets.boulderMaterial]),
  };
  const sprays = new Float32Array(3 * 126);
  sprays.fill(-6000);
  const sprayGeometry = new THREE.BufferGeometry();
  const sprayPositions = new THREE.BufferAttribute(sprays, 3).setUsage(THREE.DynamicDrawUsage);
  sprayGeometry.setAttribute('position', sprayPositions);
  const spray = new THREE.Points(sprayGeometry, new THREE.PointsMaterial({
    color: 0xf4fbff, size: .25, map: shadowMap, transparent: true, depthWrite: false, opacity: .78,
  }));
  spray.frustumCulled = false;
  scene.add(spray);
  const segments = new Map();
  const world = { sky, range, sled, sledShadow, sprayPositions, random, segments, length: Infinity, rival: null };
  let seed = 0, pace = 'free', rivalCourse;
  const indexAt = distance => Math.max(0, Math.floor(Math.min(distance, world.length - .001) / SLED_SEGMENT_LENGTH));
  function addSegment(index, description) {
    const group = new THREE.Group();
    group.name = `Sled course segment ${index}`;
    const roll = mulberry32(326276 ^ Math.imul(index, 88313) ^ seed);
    const layout = courseLayout(description);
    terrain(group, roll, materials, layout);
    tracks(group, materials.tracks, layout);
    const forestData = forest(group, roll, description, layout, assets);
    treeShadows(group, shadowMaterial, forestData.shadowSpots, layout);
    const tokenMeshes = venue(group, materials, description, layout);
    const biomeArt = addSledBiomeArt(group, description, { pointAt: surfacePoint });
    const balls = movingBalls(description);
    for (const ball of balls) {
      ball.mesh = new THREE.Mesh(ballGeometry, ballMaterial);
      ball.mesh.scale.setScalar(ball.radius);
      ball.shadow = new THREE.Mesh(flat, shadowMaterial);
      group.add(ball.mesh, ball.shadow);
    }
    scene.add(group);
    const segment = { chunks: forestData.chunks, treeRows: description.treeRows, group, course: description, balls, tokenMeshes, biomeArt,
      length: world.length, forgiving: true, pace };
    segments.set(index, segment);
    return segment;
  }
  function removeSegment(index, segment) {
    segment.group.removeFromParent();
    disposeScene(segment.group, [], shared);
    segments.delete(index);
  }
  world.stream = distance => {
    const first = indexAt(distance - 155), last = indexAt(distance + 490);
    for (const [index, segment] of segments) {
      if (index < first || index > last) removeSegment(index, segment);
    }
    for (let index = first; index <= last; index++) {
      if (!segments.has(index)) addSegment(index, buildSledSegment(index, seed, world.length));
    }
  };
  world.segmentAt = distance => segments.get(indexAt(distance));
  world.rivalCourseAt = distance => {
    const index = indexAt(distance);
    const mounted = segments.get(index)?.course;
    if (mounted) return mounted;
    if (rivalCourse?.start !== index * SLED_SEGMENT_LENGTH) rivalCourse = buildSledSegment(index, seed, world.length);
    return rivalCourse;
  };
  world.selectMode = (mode, trackSeed) => {
    for (const [index, segment] of segments) removeSegment(index, segment);
    seed = trackSeed;
    pace = mode;
    world.length = mode === 'race' ? RACE_LENGTH : Infinity;
    rivalCourse = undefined;
    if (mode === 'race' && !world.rival) {
      const rig = sledModel({ jacket: '#e4b443', helmet: '#a83126', pants: '#303536', backpack: '#72372c', goggles: 'red-amber' }, true);
      rig.group.name = 'Sled race rival';
      const shadow = new THREE.Mesh(flat, shadowMaterial);
      scene.add(rig.group, shadow);
      world.rival = { rig, shadow };
    }
    if (world.rival) world.rival.run = mode === 'race' ? freshRival() : null;
    world.stream(0);
  };
  return world;
}

function placeSled(sled, shadow, run, dt, gaps, steer, tuck, brake, landingLoad) {
  const d = run.d, x = center(d) + run.x;
  const f = 1 - Math.exp(-dt * 9);
  const heading = Math.atan2(center(d + 1) - center(d) + run.dx / Math.max(12, run.speed), 1);
  sled.group.position.set(x, run.y + .015, -d);
  sled.group.rotation.y = mix(sled.group.rotation.y, -heading * .84, f);
  sled.group.rotation.z = mix(sled.group.rotation.z, -.023 * run.dx + (run.recovery || 0) * .28, f);
  const flight = run.upperRoute && d < run.flightUntil;
  const grade = run.air || flight ? clamp(run.dy * .027, -.52, .48)
    : Math.atan((supportHeight(run, run.x, d + .13, gaps) - supportHeight(run, run.x, d - .13, gaps)) / .26);
  sled.group.rotation.x = mix(sled.group.rotation.x, grade, f);
  poseSledRider(sled, run, dt, steer, tuck, brake, landingLoad);
  shadow.visible = !flight && (!!run.upperRoute || !gapAt(d, gaps));
  shadow.position.set(x, supportHeight(run, run.x, d, gaps) + .086, -d);
  shadow.rotation.x = -grade;
  shadow.scale.set(2.1 + (run.air ? .75 : 0), 1, 3.8);
}

function updateVisuals(world, camera, run, dt, state, input, view, landingLoad = 0) {
  const { sled, sledShadow, sky, range, sprayPositions, segments, rival } = world;
  const active = state === 'running';
  const d = run.d, x = center(d) + run.x;
  for (const { course, group, chunks, tokenMeshes, balls, biomeArt } of segments.values()) {
    group.visible = course.start < d + 435 && course.end > d - 82;
    if (!group.visible) continue;
    const { gaps } = course;
    biomeArt?.update(run.elapsed, run);
    for (const chunk of chunks) {
      const ahead = chunk.d - d;
      chunk.stand.visible = ahead > -144 && ahead < 434;
      chunk.foliage.visible = ahead < 128;
      chunk.distantFoliage.visible = !chunk.foliage.visible;
    }
    for (let i = 0; i < tokenMeshes.length; i++) {
      const offset = course.tokens[i].d - d;
      const mesh = tokenMeshes[i];
      mesh.visible = !(run.tokenCourse === course && i < run.nextToken) && offset < 180 && offset > -2;
      if (mesh.visible) mesh.rotation.y = Math.sin(run.elapsed * 2.3 + i) * .52;
    }
    for (const ball of balls) {
      ball.mesh.visible = ball.shadow.visible = Math.abs(ball.d - d) < 285;
      if (!ball.mesh.visible) continue;
      const ballX = center(ball.d) + ball.x, y = surfaceHeight(ball.x, ball.d, gaps);
      ball.mesh.position.set(ballX, y + ball.radius, -ball.d);
      ball.mesh.rotation.set(-ball.angle, .28 + .19 * Math.cos(ball.age * 1.36 + ball.phase), ball.angle * .21);
      ball.shadow.position.set(ballX, y + .092, -ball.d);
      ball.shadow.rotation.x = -slope(ball.d);
      ball.shadow.scale.set(ball.radius * 2.75, 1, ball.radius * 2.5);
    }
  }
  const f = 1 - Math.exp(-dt * 9);
  const steer = active ? Number(input('right')) - Number(input('left')) : 0;
  const course = world.segmentAt(d).course;
  const { gaps } = course;
  const section = sectionAt(course, d);
  placeSled(sled, sledShadow, run, dt, gaps, steer, Number(active && input('tuck')), Number(active && input('brake')), landingLoad);
  if (rival) {
    const offset = rival.run ? rival.run.d - d : Infinity;
    rival.rig.group.visible = rival.shadow.visible = offset > -14 && offset < 145;
    if (rival.rig.group.visible) {
      const rivalGaps = world.rivalCourseAt(rival.run.d).gaps;
      placeSled(rival.rig, rival.shadow, rival.run, dt, rivalGaps, 0, active ? .37 : 0, 0, 0);
    }
  }
  const inWater = section?.kind === 'river' && d >= section.waterStart && d < section.waterEnd && !run.air;
  const wingFlying = run.upperRoute && d < run.flightUntil;
  if (active && !view.reduced && !run.air && !wingFlying) {
    view.sprayCarry += dt * (39 + Math.abs(run.dx) * 2.6 + (input('brake') ? 34 : 0));
    while (view.sprayCarry > 1) {
      view.sprayCarry--;
      const p = view.spray[view.sprayIndex++ % view.spray.length];
      const side = world.random() < .5 ? -1 : 1;
      p.x = x + side * .5;
      p.y = run.y + .13;
      p.z = -d + .91;
      p.dx = -run.dx * .24 + side * (world.random() * 2.35 + .11);
      p.dy = world.random() * (inWater ? 4.2 : 2.6) + .31;
      p.dz = 2.2 - run.speed * (.18 + world.random() * .22);
      p.life = .25 + world.random() * .36;
    }
  }
  for (let i = 0; i < view.spray.length; i++) {
    const p = view.spray[i];
    p.life -= dt;
    if (p.life > 0) {
      p.x += p.dx * dt;
      p.y += p.dy * dt;
      p.z += p.dz * dt;
      p.dy -= dt * 5.5;
      sprayPositions.setXYZ(i, p.x, p.y, p.z);
    } else {
      sprayPositions.setY(i, -6000);
    }
  }
  sprayPositions.needsUpdate = true;

  const lead = 29;
  // Follow the actual runner height on roofs as well as in the air.
  const rise = Math.max(0, run.y - snowHeight(run.x, d));
  const lift = rise * (run.upperRoute ? .93 : run.air ? .68 : .83);
  const follow = state === 'intro' ? -7.3 : -7.95 - run.speed * .026;
  const desiredFov = view.reduced ? 62 : 59 + run.speed * .155;
  const sideView = state === 'intro' ? Math.min(2.8, .68 + 2.2 * camera.aspect) : .8;
  const cameraX = center(d + follow) + run.x * .91 - run.dx * .045 + sideView;
  const cameraY = snowHeight(run.x, d + follow) + 3.45 + lift;
  const restingCamera = view.restingCamera ??= new THREE.Vector3();
  if (!view.initialized) {
    restingCamera.set(cameraX, cameraY, -(d + follow));
    camera.fov = desiredFov;
    view.initialized = true;
  } else {
    restingCamera.x = mix(restingCamera.x, cameraX, f);
    restingCamera.y = mix(restingCamera.y, cameraY, f);
    restingCamera.z = mix(restingCamera.z, -(d + follow), 1 - Math.exp(-dt * 17));
    camera.fov = mix(camera.fov, desiredFov, f);
  }
  camera.position.copy(restingCamera);
  camera.updateProjectionMatrix();
  const ahead = d + lead;
  // Preserve the view into the bend while keeping the rider inside the
  // middle of a portrait display even during a hard carve at the near bank.
  const focusDepth = Math.max(1, camera.position.z + ahead);
  const riderDepth = Math.max(1, camera.position.z + d);
  const riderLine = camera.position.x + (x - camera.position.x) * focusDepth / riderDepth;
  const allowedOffset = focusDepth * Math.tan(camera.fov * Math.PI / 360) * camera.aspect * .27;
  const focusX = riderLine + clamp(center(ahead) + run.x * .61 - riderLine, -allowedOffset, allowedOffset);
  camera.lookAt(focusX, altitude(ahead) + (state === 'intro' ? -2.7 : 2.34) + lift * .78, -ahead);
  if (!view.reduced) {
    camera.rotateZ(-run.dx * .0019);
    const impact = view.impact;
    if (impact) {
      const t = impact.age / IMPACT_TIME;
      const strength = impact.strength * (1 - t) ** 2;
      camera.translateX(Math.sin(t * 13) * strength * .064);
      camera.translateY(-Math.cos(t * 10) * strength * .11);
      camera.rotateZ(Math.sin(t * 12) * strength * .008);
    }
  }
  sky.position.copy(camera.position);
  range.position.set(restingCamera.x + 28 * Math.sin(d / 470), restingCamera.y + 10 * Math.sin(d / 690), restingCamera.z);
}

function disposeScene(scene, riders = [], shared) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  function collect(object) {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
    else if (object.material) materials.add(object.material);
    if (object.isInstancedMesh) object.dispose();
  }
  // Hidden skis, poles and unused finishes still belong to the shared rig caches.
  for (const rider of riders) {
    rider.removeFromParent();
    rider.traverseVisible(collect);
  }
  scene.traverse(collect);
  for (const geometry of geometries) {
    if (!shared?.geometries.has(geometry)) geometry.dispose();
  }
  for (const material of materials) {
    if (shared?.materials.has(material)) continue;
    for (const value of Object.values(material)) {
      if (value?.isTexture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

function gameDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'sled-game';
  dialog.className = 'sled-game';
  dialog.dataset.minigameOverlay = 'sled';
  dialog.setAttribute('aria-label', 'Sled run');
  dialog.innerHTML = `
    <div class="sled-stage" aria-hidden="true"></div>
    <header class="sled-top">
      <div class="sled-hud" data-sled-hud aria-label="Run stats">
        <div class="sled-stats">
          <span><b data-sled-speed>0</b> km/h</span>
          <b data-sled-time>00:00.0</b>
          <span><b data-sled-score>0</b> pts</span>
        </div>
        <div class="sled-progress-track" data-sled-track aria-hidden="true"><i data-sled-progress></i><s data-sled-rival-progress></s></div>
        <div class="sled-tallies">
          <span><b data-sled-distance>0</b><span data-sled-length></span> m</span>
          <span><b data-sled-jumps>0</b> <span data-sled-jump-label>gaps</span></span>
        </div>
        <div class="sled-race-status" data-sled-race-status hidden><b data-sled-place></b> <span data-sled-rival-gap></span></div>
      </div>
      <div class="sled-actions">
        <div class="sled-coins" data-sled-coin-hud role="group" aria-label="Coins collected"><span aria-hidden="true">✦</span><b data-sled-medals>0</b></div>
        <button type="button" data-sled-pause aria-label="Pause sled run" title="Pause (P)" class="sled-secondary"><span class="sled-pause-icon" aria-hidden="true"></span></button>
        <button type="button" data-sled-exit aria-label="Exit sled run" title="Exit (Esc)" class="sled-secondary"><span class="sled-exit-icon" aria-hidden="true">×</span></button>
      </div>
    </header>
    <div class="sled-callout" hidden><span data-sled-callout role="status"></span><span data-sled-callout-detail></span></div>
    <div class="sled-countdown" aria-live="polite" hidden></div>
    <section class="sled-card" aria-labelledby="sled-card-title">
      <h2 id="sled-card-title">Drop in</h2>
      <div class="sled-mode-options" data-sled-mode-options role="group" aria-label="Sled mode">
        <button type="button" data-sled-mode="free" aria-pressed="true">Free ride</button>
        <button type="button" data-sled-mode="race" aria-pressed="false">Race</button>
      </div>
      <p data-sled-description>Follow the coins and jump the creek gaps.</p>
      <div class="sled-card-controls" data-sled-controls>
        <span><kbd>A</kbd> <kbd>D</kbd> Steer</span><span><kbd>W</kbd> Tuck</span><span><kbd>S</kbd> Brake</span><span><kbd>Space</kbd> Jump</span>
      </div>
      <div class="sled-card-actions">
        <button type="button" data-sled-play class="sled-primary" autofocus>Start run</button>
        <button type="button" data-sled-show-modes class="sled-mode-back" hidden>Modes</button>
      </div>
    </section>
    <div class="sled-bottom">
      <p class="sled-key-hint"><kbd>A D</kbd> steer · <kbd>W</kbd> tuck · <kbd>S</kbd> brake · <kbd>Space</kbd> jump · <kbd>R</kbd> retry</p>
      <div class="sled-touch" aria-label="Sled controls">
        <div><button type="button" data-sled-input="left" aria-label="Steer left">←</button><button type="button" data-sled-input="right" aria-label="Steer right">→</button></div>
        <div><button type="button" data-sled-input="jump">Jump</button><button type="button" data-sled-input="brake">Brake</button><button type="button" data-sled-input="tuck">Tuck</button></div>
      </div>
    </div>`;
  return dialog;
}

const KEY_ACTION = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', ArrowUp: 'tuck', KeyW: 'tuck', ArrowDown: 'brake', KeyS: 'brake',
};
const LANE_HINTS = { '-1': 'left', 0: 'center', 1: 'right' };
const SECTOR_HINTS = {
  cave: ['Ice cave', 'Take the wing to ride above, or follow coins through the tunnel'],
  river: ['Glacial river', 'Steer around the ice and stay on the current'],
  village: ['Village', 'Look for open doors and snow ramps'],
};
const DEBRIS_HINTS = { fallingIce: 'Falling ice', fallingSnow: 'Falling snow', fallingRock: 'Rockfall' };

export function openSledGame({ resortRenderer, audio, outfit, returnLabel, opener } = {}) {
  const current = document.getElementById('sled-game');
  if (current?.open) return current;
  const seed = Math.floor(Math.random() * 0x1_0000_0000);
  const dialog = gameDialog();
  const restoreFocus = opener ?? document.activeElement;
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.append(dialog);
  dialog.showModal();
  const get = name => dialog.querySelector(`[data-sled-${name}]`);
  const play = get('play'), pause = get('pause'), exit = get('exit');
  if (returnLabel) {
    exit.setAttribute('aria-label', returnLabel);
    exit.title = returnLabel;
  }
  const card = dialog.querySelector('.sled-card'), title = card.querySelector('h2');
  const callout = dialog.querySelector('.sled-callout'), countdown = dialog.querySelector('.sled-countdown');
  const stats = ['speed', 'time', 'score', 'distance', 'jumps', 'medals'].map(get);
  const jumpLabel = get('jump-label');
  const coinHud = get('coin-hud');
  const progress = get('progress'), rivalProgress = get('rival-progress');
  const modeOptions = get('mode-options'), modeButtons = modeOptions.querySelectorAll('[data-sled-mode]');
  const raceStatus = get('race-status'), track = get('track'), back = get('show-modes');
  const place = get('place'), rivalGap = get('rival-gap'), lengthLabel = get('length');
  const description = get('description'), controls = get('controls');
  const calloutText = get('callout'), calloutDetail = get('callout-detail');
  const stage = dialog.querySelector('.sled-stage');
  const listeners = new AbortController();
  const { signal } = listeners;
  const keys = new Set(), pointers = new Map();
  let jumpQueued = false;
  const input = action => {
    if (action === 'jump' && jumpQueued) return true;
    for (const code of keys) if (KEY_ACTION[code] === action) return true;
    for (const held of pointers.values()) if (held === action) return true;
    return false;
  };
  let run = freshRun(), state = 'intro', previousState = 'running', mode = 'free';
  let pendingTime = 0, last = performance.now();
  let renderer, observer, animation;
  let dirty = true, contextLost = false;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.mist, 116, 430);
  const camera = new THREE.PerspectiveCamera(64, 1, .12, 4900);
  let world;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const view = {
    reduced: motion.matches, impact: null, crossingClearedAt: -Infinity, recoveryAt: -Infinity,
    initialized: false, sprayCarry: 0, sprayIndex: 0, spray: Array.from({ length: 126 }, () => ({ life: -1 })),
  };
  const text = (element, value) => {
    const string = String(value);
    if (element.textContent !== string) element.textContent = string;
  };
  const formatPoints = score => score.toLocaleString('en-US');

  function requestFrame() {
    if (world && !animation && !document.hidden && !contextLost) animation = requestAnimationFrame(draw);
  }

  function setState(next) {
    state = next;
    dirty = true;
    requestFrame();
    dialog.dataset.state = next;
    const running = next === 'running' || next === 'countdown';
    card.hidden = running;
    pause.hidden = !running;
    get('hud').hidden = next === 'intro' || next === 'unavailable';
    coinHud.hidden = next === 'intro' || next === 'unavailable';
    modeOptions.hidden = next !== 'intro';
    back.hidden = next !== 'paused' && next !== 'finished';
    if (!running) callout.hidden = countdown.hidden = true;
  }

  function resetRun() {
    run = freshRun();
    pendingTime = 0;
    last = performance.now();
    view.initialized = false;
    view.impact = null;
    view.crossingClearedAt = view.recoveryAt = -Infinity;
    view.sprayCarry = 0;
    view.sprayIndex = 0;
    for (const particle of view.spray) particle.life = -1;
    clearInput();
    for (const actor of [world.sled, world.rival?.rig]) {
      if (!actor) continue;
      actor.group.rotation.set(0, 0, 0);
      actor.tuck = actor.brake = actor.landing = actor.steer = 0;
    }
  }

  function selectMode(next) {
    if (!world || contextLost) return;
    mode = next;
    dialog.dataset.mode = mode;
    world.selectMode(mode, seed ^ (mode === 'race' ? 0x2f1e5 : 0));
    resetRun();
    track.hidden = raceStatus.hidden = mode !== 'race';
    text(lengthLabel, mode === 'race' ? ` / ${formatPoints(RACE_LENGTH)}` : '');
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.sledMode === mode));
    text(title, 'Drop in');
    text(description, mode === 'race' ? 'Race a ghost rider to the finish. About 3 minutes.' : 'Follow the coins through caves, waterfalls and villages.');
    text(play, mode === 'race' ? 'Start race' : 'Start run');
    description.hidden = controls.hidden = false;
    setState('intro');
  }

  function reset() {
    if (!world || contextLost) return;
    if (state !== 'intro') world.selectMode(mode, seed ^ (mode === 'race' ? 0x2f1e5 : 0));
    resetRun();
    setState('countdown');
    updateHud();
    dialog.focus({ preventScroll: true });
  }

  function clearInput() {
    jumpQueued = false;
    run.jumpHeld = false;
    keys.clear();
    pointers.clear();
    for (const button of dialog.querySelectorAll('[data-held]')) delete button.dataset.held;
  }

  function togglePause() {
    if (state === 'paused') {
      if (contextLost) return;
      last = performance.now();
      setState(previousState);
      pause.focus({ preventScroll: true });
      return;
    }
    if (state !== 'running' && state !== 'countdown') return;
    previousState = state;
    clearInput();
    view.impact = null;
    setState('paused');
    text(title, mode === 'race' ? 'Race paused' : 'Run paused');
    description.hidden = controls.hidden = true;
    text(play, mode === 'race' ? 'Resume race' : 'Resume run');
    play.focus({ preventScroll: true });
  }

  function finishRace(previousDistance) {
    clearInput();
    audio?.finish();
    const rivalTime = world.rival.run.finishTime;
    const finishTime = run.elapsed - STEP + clamp((world.length - previousDistance) / run.speed, 0, STEP);
    run.finishTime = finishTime;
    const won = rivalTime === null || finishTime <= rivalTime;
    setState('finished');
    text(title, won ? 'You won' : 'Rival won');
    text(description, won ? timeText(finishTime) : `You ${timeText(finishTime)} · Rival ${timeText(rivalTime)}`);
    description.hidden = false;
    controls.hidden = true;
    text(play, 'Race again');
    play.focus({ preventScroll: true });
  }

  function finishFreeRide(reason) {
    clearInput();
    audio?.crash();
    setState('finished');
    text(title, 'Run over');
    text(description, reason);
    description.hidden = false;
    controls.hidden = true;
    text(play, 'Try again');
    play.focus({ preventScroll: true });
  }

  function updateHud() {
    const values = [run.d > 0 ? Math.round(run.speed * 3.6) : 0, timeText(run.elapsed), formatPoints(points(run, mode === 'race' && state === 'finished')),
      formatPoints(Math.round(run.d)), run.jumps, run.tokens];
    values.forEach((value, i) => text(stats[i], value));
    text(jumpLabel, run.jumps === 1 ? 'gap' : 'gaps');
    coinHud.classList.toggle('coin-collected', run.lastToken >= 0 && run.elapsed - run.lastToken < .32);
    if (mode === 'race') {
      const rival = world.rival.run;
      const difference = run.d - rival.d;
      const ahead = rival.finishTime === null ? difference >= 0 : (run.finishTime ?? Infinity) <= rival.finishTime;
      progress.style.width = `${100 * run.d / RACE_LENGTH}%`;
      rivalProgress.style.left = `${100 * rival.d / RACE_LENGTH}%`;
      text(place, ahead ? '1st / 2' : '2nd / 2');
      text(rivalGap, rival.finishTime !== null ? '· Rival finished'
        : Math.abs(difference) < 2 ? '· Even'
          : `· Rival ${formatPoints(Math.round(Math.abs(difference)))} m ${ahead ? 'back' : 'ahead'}`);
    }
    countdown.hidden = state !== 'countdown';
    if (state === 'countdown') text(countdown, Math.max(1, Math.ceil(run.countdown)));
    const course = world.segmentAt(run.d).course;
    const section = sectionAt(course, run.d);
    const next = course.gaps.find(gap => run.d < gap.end);
    const crossed = run.elapsed - view.crossingClearedAt < 1.2;
    const recovering = run.elapsed - view.recoveryAt < 1.1;
    const nearRamp = next && next.start - run.d <= 75;
    const hint = section && run.d - section.start < 128 && SECTOR_HINTS[section.kind];
    const debris = !run.upperRoute && section?.kind === 'cave' && course.features.find(feature => {
      if (!DEBRIS_HINTS[feature.kind] || feature.d < run.d || feature.d - run.d > run.speed * 1.4) return false;
      if (Math.abs(run.x - feature.x) > feature.halfWidth + 1.7) return false;
      const { phase } = fallState(feature, run.elapsed);
      return phase === 'warning' || phase === 'falling';
    });
    callout.hidden = state !== 'running' || (!recovering && !crossed && !nearRamp && !hint && !debris);
    if (callout.hidden) return;
    if (recovering) {
      text(calloutText, run.recoveryHint);
      text(calloutDetail, '');
    } else if (crossed) {
      text(calloutText, 'Crossing cleared');
      text(calloutDetail, '');
    } else if (debris) {
      text(calloutText, DEBRIS_HINTS[debris.kind]);
      text(calloutDetail, 'Follow the coins');
    } else if (hint && !nearRamp) {
      text(calloutText, hint[0]);
      text(calloutDetail, hint[1]);
    } else if (next.kind === 'waterfall' || next.kind === 'riverEntry') {
      const launch = next.kind === 'waterfall' ? 'Waterfall ahead' : 'River drop ahead';
      text(calloutText, run.d < next.start ? launch : 'Watch the landing');
      text(calloutDetail, run.d < next.start ? `${Math.round(next.start - run.d)} m` : '');
    } else if (run.d >= next.start) {
      text(calloutText, 'Watch the landing');
      text(calloutDetail, '');
    } else {
      const label = next.lanes.map(lane => LANE_HINTS[lane]).join(' or ');
      text(calloutText, `${label[0].toUpperCase() + label.slice(1)} ramp`);
      text(calloutDetail, `${Math.round(next.start - run.d)} m`);
    }
  }

  function close() {
    if (dialog.open) dialog.close();
  }
  function cleanup() {
    listeners.abort();
    observer?.disconnect();
    cancelAnimationFrame(animation);
    disposeScene(scene, [world?.sled.rider.group, world?.rival?.rig.rider.group].filter(Boolean));
    renderer?.dispose();
    renderer?.forceContextLoss();
    dialog.remove();
    if (restoreFocus instanceof HTMLElement && restoreFocus.isConnected) restoreFocus.focus({ preventScroll: true });
  }

  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!renderer || !width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, resortRenderer?.getPixelRatio() ?? Infinity, 1.55, Math.sqrt(2_700_000 / (width * height)));
    dirty = true;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setDrawingBufferSize(width, height, ratio);
    requestFrame();
  }

  dialog.addEventListener('close', cleanup, { once: true });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal });
  play.addEventListener('click', () => {
    audio?.resume?.().catch(() => {});
    if (state === 'paused') togglePause();
    else reset();
  }, { signal });
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      if (button.dataset.sledMode !== mode) selectMode(button.dataset.sledMode);
    }, { signal });
  }
  back.addEventListener('click', () => {
    selectMode(mode);
    modeOptions.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
  }, { signal });
  pause.addEventListener('click', togglePause, { signal });
  exit.addEventListener('click', close, { signal });
  window.addEventListener('keydown', event => {
    if (!dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    event.stopImmediatePropagation();
    if (KEY_ACTION[event.code]) {
      if (event.code === 'Space' && state !== 'running' && state !== 'countdown') return;
      if (event.code === 'Space' && !event.repeat && state === 'running') jumpQueued = true;
      keys.add(event.code);
      event.preventDefault();
    } else if (event.code === 'Escape') {
      event.preventDefault();
      close();
    } else if (!event.repeat && event.code === 'KeyR') {
      reset();
    } else if (!event.repeat && event.code === 'KeyP') {
      togglePause();
    }
  }, { capture: true, signal });
  window.addEventListener('keyup', event => {
    keys.delete(event.code);
    // Key releases can also clear stale holds in the base resort.
  }, { capture: true, signal });
  window.addEventListener('blur', pauseOnBlur, { signal });
  window.addEventListener('focus', resize, { signal });
  window.addEventListener('resize', resize, { signal });
  motion.addEventListener('change', event => {
    view.reduced = event.matches;
    view.impact = null;
    if (view.reduced) for (const particle of view.spray) particle.life = -1;
    dirty = true;
    requestFrame();
  }, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseOnBlur(); else resize(); }, { signal });
  function pauseOnBlur() {
    clearInput();
    if (state === 'running' || state === 'countdown') togglePause();
  }
  for (const button of dialog.querySelectorAll('[data-sled-input]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      if (button.dataset.sledInput === 'jump' && state === 'running') jumpQueued = true;
      pointers.set(event.pointerId, button.dataset.sledInput);
      button.dataset.held = '';
    }, { signal });
    for (const eventName of ['pointerup', 'lostpointercapture', 'pointercancel']) {
      button.addEventListener(eventName, event => {
        pointers.delete(event.pointerId);
        delete button.dataset.held;
      }, { signal });
    }
  }

  setState('intro');
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(COLORS.sky);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      contextLost = true;
      pauseOnBlur();
    }, { signal });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      last = performance.now();
      resize();
    }, { signal });
    stage.append(renderer.domElement);
    world = makeWorld(scene, outfit);
    selectMode(mode);
    observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
  } catch (error) {
    setState('unavailable');
    text(title, 'Sled run unavailable');
    text(description, 'The 3D course needs hardware-accelerated graphics.');
    controls.hidden = play.hidden = true;
    exit.focus();
    console.warn('Could not create sled course', error);
    return dialog;
  }

  function draw(now) {
    animation = 0;
    const moving = state === 'running' || state === 'countdown';
    if (contextLost || document.hidden || (!moving && !dirty && !view.impact)) {
      last = now;
      return;
    }
    dirty = false;
    const seconds = Math.max(0, (now - last) / 1000);
    const dt = Math.min(seconds, .12);
    last = now;
    if (view.impact) {
      view.impact.age += dt;
      if (view.impact.age >= IMPACT_TIME) view.impact = null;
    }
    let landingLoad = 0;
    if (state === 'countdown') {
      run.countdown -= seconds;
      if (run.countdown <= 0) setState('running');
    } else if (state === 'running') {
      const startTokens = run.tokens, startJumps = run.jumps;
      world.stream(run.d);
      pendingTime += dt;
      while (pendingTime + 1e-8 >= STEP) {
        pendingTime -= STEP;
        const wasAirborne = Boolean(run.air);
        const previousBumps = run.bumps, previousDistance = run.d;
        const crash = simulate(run, world.segmentAt(run.d), input, STEP);
        jumpQueued = false;
        if (crash) {
          finishFreeRide(crash);
          break;
        }
        if (mode === 'race') {
          const rival = world.rival.run;
          simulateRival(rival, run, world.rivalCourseAt(rival.d), STEP);
        }
        if (run.bumps !== previousBumps) {
          audio?.crash();
          view.recoveryAt = run.elapsed;
          landingLoad = .52;
          if (!view.reduced) view.impact = { age: 0, strength: .85 };
        } else if (!wasAirborne && run.air) audio?.launch();
        else if (wasAirborne && !run.air) {
          const speed = Math.max(1, slope(run.d) * run.speed - run.dy);
          audio?.land(speed);
          landingLoad = clamp(speed * .036, .12, .85);
          if (!view.reduced) view.impact = { age: 0, strength: landingLoad };
        }
        if (run.d >= world.length) {
          finishRace(previousDistance);
          break;
        }
      }
      if (run.tokens > startTokens) audio?.coin(run.tokens % 12);
      if (run.jumps > startJumps) view.crossingClearedAt = run.elapsed;
    }
    updateVisuals(world, camera, run, dt, state, input, view, landingLoad);
    updateHud();
    renderer.render(scene, camera);
    if (state === 'running' || state === 'countdown' || view.impact) requestFrame();
  }
  cancelAnimationFrame(animation);
  last = performance.now();
  draw(last);
  return dialog;
}
