import * as THREE from 'three';
import { clamp, mix, mulberry32, smoothstep as smooth } from './util.js';

const TITLE = 'White Fir Chute';
const LENGTH = 1560;
const EDGE = 15;
const LANE = 8.6;
const STEP = 1 / 90;
const STORAGE = 'alpine.sled.white-fir.best';
const GAPS = [
  { start: 310, end: 333, lanes: [0], name: 'Creek crossing' },
  { start: 603, end: 630, lanes: [-1, 1], name: 'Split Rock' },
  { start: 956, end: 987, lanes: [1], name: 'Icefall' },
  { start: 1281, end: 1313, lanes: [-1, 0], name: 'Lower gorge' },
];
const RAMP_LENGTH = 19;
const RAMP_HALF = 3.7;
const RAMP_HEIGHT = 3.65;
const SECTORS = [
  [0, 'Old-growth forest'], [342, 'Split Rock'], [689, 'Icefall traverse'], [1050, 'Lower gorge'], [1350, 'Cedar straight'],
];
// Keep at least one clear line through each obstacle row.
const TREES = [
  [57, 0], [103, -1], [115, 1], [151, 0], [164, -1], [215, 1], [250, -1], [266, 1],
  [365, 0], [378, -1], [411, 1], [433, 0], [493, -1], [511, 1], [537, 0], [555, -1],
  [674, 1], [709, -1], [725, 0], [757, 1], [797, -1], [818, 0], [852, 1], [877, -1], [888, 0],
  [1023, 1], [1054, 0], [1067, -1], [1102, 1], [1125, -1], [1143, 0], [1186, 1], [1233, 0],
  [1352, 0], [1364, 1], [1400, -1], [1420, 0], [1460, 1], [1492, -1], [1506, 0],
];
const BALLS = [
  [126, -4, 7, 1.5], [226, 5, 8, 1.9], [247, -5, 7, 2.0], [397, 4, 9, 2.2],
  [468, -4, 9, 1.9], [515, 5, 8, 2.0], [658, -5, 6, 2.0], [708, 5, 9, 2.45], [799, -5, 8, 2.2],
  [856, 5, 9, 2.1], [1001, -4, 8, 2.4], [1070, 6, 8, 2.0], [1171, -5, 8, 2.1],
  [1330, 4, 9, 2.6], [1401, -5, 8, 2.3], [1458, 4, 9, 2.3],
];
const COLORS = {
  sky: 0x9ebfd3, mist: 0xb5cfdb, snow: 0xe7f2f7, compact: 0xc6dce7,
  ice: 0x598ba5, cedar: 0x504247, fir: 0x264f52,
  firSnow: 0xd7e7ea, rock: 0x697b89, red: 0xbb422d, amber: 0xffbd65, metal: 0x354454,
};

const center = d => 14 * Math.sin(d / 101) + 12 * Math.sin(d / 211);
const altitude = d => -.286 * d + 6.3 * Math.sin(d / 66) + 3.2 * Math.sin(d / 26);
const slope = d => -.286 + (6.3 / 66) * Math.cos(d / 66) + (3.2 / 26) * Math.cos(d / 26);
const gapAt = d => GAPS.find(gap => d >= gap.start && d < gap.end);
function timeText(time) {
  const tenths = Math.round(time * 10);
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
}

function snowHeight(x, d) {
  const offset = Math.abs(x);
  const drifts = 1.2 * Math.sin(offset * .53 + d * .091) + 1.05 * Math.sin(x * .16 - d * .129);
  const banks = smooth(9, 20, offset) * (.8 + drifts * .8);
  const highSide = x > 0 ? .38 : .27;
  return altitude(d) + banks + Math.max(0, offset - EDGE) * highSide + smooth(18, 74, offset) * drifts * 3.2;
}

function rampHeight(x, d) {
  for (const gap of GAPS) {
    if (d < gap.start - RAMP_LENGTH || d >= gap.start) continue;
    const lane = gap.lanes.find(line => Math.abs(x - line * LANE) < RAMP_HALF);
    if (lane !== undefined) return RAMP_HEIGHT * ((d - gap.start + RAMP_LENGTH) / RAMP_LENGTH) ** 1.8;
  }
  return 0;
}

function surfaceHeight(x, d) {
  return snowHeight(x, d) + rampHeight(x, d);
}

function surfacePoint(x, d, rise = 0) {
  return new THREE.Vector3(center(d) + x, snowHeight(x, d) + rise, -d);
}

function meshGeometry(positions, colors, uvs) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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

function terrain(scene, random, materials) {
  const snow = new THREE.Color(COLORS.snow);
  const light = new THREE.Color();
  const stations = [-49, ...GAPS.flatMap(gap => [gap.start, gap.end]), LENGTH + 155];
  const across = [-120, -100, -83, -69, -57, -48, -40, -34, -29, -24, -20, -17, -15, -13, -11, -9, -7, -5, -3, -1.5, 0,
    1.5, 3, 5, 7, 9, 11, 13, 15, 17, 20, 24, 29, 34, 40, 48, 57, 69, 83, 100, 120];
  for (let section = 0; section < stations.length - 1; section += 2) {
    const start = stations[section], end = stations[section + 1];
    const rows = Math.ceil((end - start) / 3.65);
    const positions = [], colors = [], uvs = [], indices = [];
    for (let row = 0; row <= rows; row++) {
      const d = mix(start, end, row / rows);
      for (let col = 0; col < across.length; col++) {
        const x = across[col];
        positions.push(center(d) + x, snowHeight(x, d), -d);
        uvs.push((center(d) + x) * .48, d * .48);
        const tint = .055 * Math.sin(x * .66 + d * .031) + .035 * Math.sin(x * .34 + d * .087) + random() * .054;
        const lane = Math.min(Math.abs(x + LANE), Math.abs(x), Math.abs(x - LANE));
        const packed = (1 - smooth(.15, 2.85, lane)) * smooth(0, 19, d) * .06;
        light.copy(snow).multiplyScalar(1.01 + tint - packed).toArray(colors, colors.length);
        if (col && row) {
          const i = row * across.length + col;
          indices.push(i - across.length - 1, i - across.length, i - 1, i - 1, i - across.length, i);
        }
      }
    }
    const geometry = meshGeometry(positions, colors, uvs);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, materials.snow));
  }
  const rock = new THREE.Color(COLORS.rock), ice = new THREE.Color(COLORS.ice);
  const tint = new THREE.Color();
  for (const gap of GAPS) {
    const floor = Math.min(altitude(gap.start), altitude(gap.end)) - 28;
    for (const [edge, side] of [[gap.start, 1], [gap.end, -1]]) {
      const verts = [], col = [];
      for (let x = -120; x < 120; x += 3) {
        const upperA = surfacePoint(x, edge), upperB = surfacePoint(x + 3, edge);
        const seamA = surfacePoint(x - .7, edge + side * 4), seamB = surfacePoint(x + 2.3, edge + side * 4);
        seamA.y = mix(upperA.y, floor, .29) - 2.4 * Math.sin(x * .12);
        seamB.y = mix(upperB.y, floor, .29) - 2.4 * Math.sin((x + 3) * .12);
        const footA = surfacePoint(x + .9, edge + side * 6.6), footB = surfacePoint(x + 3.9, edge + side * 6.6);
        footA.y = footB.y = floor;
        for (const [layer, quad] of [[0, [upperA, upperB, seamB, upperA, seamB, seamA]], [1, [seamA, seamB, footB, seamA, footB, footA]]]) {
          tint.copy(random() < .41 ? ice : rock).multiplyScalar((layer ? .52 : .9) + random() * .39);
          for (const vertex of quad) {
            verts.push(vertex.x, vertex.y, vertex.z);
            col.push(tint.r, tint.g, tint.b);
          }
        }
      }
      scene.add(new THREE.Mesh(meshGeometry(verts, col), materials.cliff));
    }
    const basin = new THREE.Mesh(new THREE.PlaneGeometry(245, gap.end - gap.start + 1), materials.water);
    basin.rotation.x = -Math.PI / 2;
    basin.position.set(center((gap.start + gap.end) / 2), floor, -(gap.start + gap.end) / 2);
    scene.add(basin);
  }
}

function skyline(scene, random) {
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
  for (const [depth, radius, base, color, cap] of [
    [-2230, 1680, -620, 0x809baa, 0xc3d2d7], [-1940, 1120, -570, 0x648693, 0xa9c3cd],
  ]) {
    const positions = [], colors = [];
    const ridge = new THREE.Color(color), snow = new THREE.Color(cap), tint = new THREE.Color();
    const points = Array.from({ length: 85 }, (_, i) => {
      const angle = (i / 84 - .5) * Math.PI * 1.68;
      const x = Math.sin(angle) * radius, z = depth - Math.cos(angle) * radius * .62;
      const shape = Math.abs(Math.sin(angle * 9.1 + .84)) ** 1.64;
      return { x, z, y: base + 350 + 335 * shape + random() * 111 };
    });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const ar = [a.x, a.y, a.z], br = [b.x, b.y, b.z];
      const k = 18 + random() * 85;
      const c = [mix(a.x, b.x, .44), Math.min(a.y,b.y) - k, (a.z + b.z) / 2 + 35];
      const lowA = [a.x, base - 150, a.z + 70], lowB = [b.x, base - 150, b.z + 70];
      for (const [triangle, color] of [[[ar, br, c], snow], [[ar, c, lowA], ridge], [[c, br, lowB], ridge], [[lowA, c, lowB], ridge]]) {
        tint.copy(color).multiplyScalar(.87 + random() * .26);
        for (const vertex of triangle) {
          positions.push(...vertex);
          colors.push(tint.r, tint.g, tint.b);
        }
      }
    }
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
    scene.add(new THREE.Mesh(meshGeometry(positions, colors), material));
  }
  return sky;
}

function branchGeometry(tiers, rings) {
  const points = [], palette = [];
  const dark = new THREE.Color(COLORS.fir), snow = new THREE.Color(COLORS.firSnow);
  const random = mulberry32(25812);
  for (let tier = 0; tier < tiers; tier++) {
    const level = tier / (tiers - 1);
    const y = .19 + level * .73;
    const radius = .145 * (1 - level * .77);
    const skirt = [], shoulder = [];
    for (let j = 0; j < rings; j++) {
      const phase = j / rings * Math.PI * 2 + tier * 1.14;
      const irregular = j % 2 ? .7 + random() * .16 : 1 + random() * .3;
      const x = Math.cos(phase) * radius * irregular, z = Math.sin(phase) * radius * irregular;
      skirt.push([x, y + random() * .024, z]);
      shoulder.push([x * .46, y + .045 + random() * .012, z * .46]);
    }
    for (let j = 0; j < rings; j++) {
      const next = (j + 1) % rings;
      const end = [0, y + .121, 0], body = [0, y + .016, 0];
      const triangles = [
        [[skirt[j], skirt[next], body], dark, .61], [[skirt[j], shoulder[j], skirt[next]], dark, .88],
        [[shoulder[j], shoulder[next], skirt[next]], snow, .84], [[shoulder[j], end, shoulder[next]], snow, .96],
      ];
      for (const [triangle, tint, intensity] of triangles) {
        const c = tint.clone().multiplyScalar(intensity + random() * .23);
        for (const p of triangle) {
          points.push(...p);
          palette.push(c.r, c.g, c.b);
        }
      }
    }
  }
  return meshGeometry(points, palette);
}

function forest(scene, random, materials) {
  const branches = branchGeometry(11, 10), lowerBranches = branchGeometry(7, 6);
  const bark = new THREE.CylinderGeometry(.013, .043, .99, 7);
  bark.translate(0, .465, 0);
  const boulder = new THREE.IcosahedronGeometry(1, 0);
  const treeRows = TREES.map(([d, lane], i) => ({
    d, x: lane * LANE + (i ? random() * 1.45 - .72 : 0), h: 22 + random() * 14, hit: 1.05 + random() * .29,
  }));
  const shadowSpots = [], chunks = [];
  const o = new THREE.Object3D(), color = new THREE.Color();
  for (let chunk = -60; chunk < LENGTH + 145; chunk += 100) {
    const group = treeRows.filter(tree => tree.d >= chunk && tree.d < chunk + 100);
    const rocks = [];
    for (let side of [-1, 1]) {
      for (let i = 0; i < 53; i++) {
        const d = chunk + random() * 100;
        if (gapAt(d)) continue;
        const x = side * (17 + random() ** 1.86 * 94);
        group.push({ d, x, h: 12 + random() ** .77 * 29 });
      }
      for (let i = 0; i < 9; i++) {
        const d = chunk + random() * 100;
        if (gapAt(d)) continue;
        rocks.push({ d, x: side * (17 + random() ** 1.42 * 72), w: .9 + random() ** 2 * 4.3 });
      }
    }
    const trunks = new THREE.InstancedMesh(bark, materials.bark, group.length);
    const foliage = new THREE.InstancedMesh(branches, materials.foliage, group.length);
    const distantFoliage = new THREE.InstancedMesh(lowerBranches, materials.foliage, group.length);
    group.forEach((tree, i) => {
      o.position.copy(surfacePoint(tree.x, tree.d, -.25));
      o.rotation.set((random() - .5) * .035, random() * Math.PI * 2, (random() - .5) * .035);
      const width = tree.hit ? tree.hit / .043 : tree.h * (.74 + random() * .36);
      o.scale.set(width, tree.h, width);
      o.updateMatrix();
      trunks.setMatrixAt(i, o.matrix);
      foliage.setMatrixAt(i, o.matrix);
      color.setScalar(.76 + random() * .24);
      trunks.setColorAt(i, color);
      color.setScalar(.76 + random() * .29);
      foliage.setColorAt(i, color);
      if (Math.abs(tree.x) < 32) shadowSpots.push(tree);
    });
    const clasts = new THREE.InstancedMesh(boulder, materials.rock, rocks.length);
    rocks.forEach(({ d, x, w }, i) => {
      o.position.copy(surfacePoint(x, d, -.22));
      o.rotation.set(random(), random() * Math.PI * 2, (random() - .5) * .7);
      o.scale.set(w, w * (.72 + random() * .46), w * (1.1 + random() * .48));
      o.updateMatrix();
      clasts.setMatrixAt(i, o.matrix);
      clasts.setColorAt(i, color.setScalar(.72 + random() * .48));
    });
    distantFoliage.instanceMatrix = foliage.instanceMatrix;
    distantFoliage.instanceColor = foliage.instanceColor;
    const stand = new THREE.Group();
    stand.add(trunks, foliage, distantFoliage, clasts);
    scene.add(stand);
    chunks.push({ d: chunk, stand, foliage, distantFoliage });
  }
  return { treeRows, shadowSpots, chunks };
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

function treeShadows(scene, material, trees) {
  const positions = [], uvs = [], bands = 9;
  for (const { x, d, h } of trees) {
    const width = h * .18, length = h * .47;
    for (let i = 0; i < bands; i++) {
      if (gapAt(d - length * i / bands) || gapAt(d - length * (i + 1) / bands)) continue;
      for (const [u, v] of [[0, i], [1, i], [1, i + 1], [0, i], [1, i + 1], [0, i + 1]]) {
        const sampleD = d - length * v / bands;
        const sampleX = x + (u - .5) * width + length * v / bands * .51;
        const position = surfacePoint(sampleX, sampleD, .063);
        positions.push(position.x, position.y, position.z);
        uvs.push(u, v / bands);
      }
    }
  }
  scene.add(new THREE.Mesh(meshGeometry(positions, null, uvs), material));
}

function tracks(scene, material) {
  const surfaces = [-23, ...GAPS.flatMap(({start, end}) => [start - 20, end + 2]), LENGTH + 2];
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

function venue(scene, materials) {
  const { bark, red, amber, ramp, ice } = materials;
  for (const [d, title, color] of [[23, 'WHITE FIR CHUTE', '#a8452e'], [LENGTH, 'FINISH', '#234954']]) {
    const group = new THREE.Group();
    group.position.copy(surfacePoint(0, d));
    for (const side of [-1, 1]) {
      box(group, bark, .66, 6.45, .62, side * 12.8, 3.2, 0);
      box(group, red, .78, 1.52, .73, side * 12.8, 1.18, 0);
      const brace = box(group, bark, .33, 2.55, .37, side * 12, 5.26, 0);
      brace.rotation.z = side * -.67;
    }
    box(group, bark, 26.6, .46, .63, 0, 6.22, 0);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 2.12), printedSign(title, color));
    sign.position.set(0, 5.59, .37);
    group.add(sign);
    scene.add(group);
  }
  const markerGeometry = new THREE.CylinderGeometry(.052, .075, 1, 5);
  const reflectors = new THREE.InstancedMesh(markerGeometry, amber, 92);
  let count = 0;
  const transform = new THREE.Object3D();
  for (let d = 17; d < LENGTH; d += 39) {
    if (gapAt(d)) continue;
    for (const side of [-1, 1]) {
      transform.position.copy(surfacePoint(side * 15.1, d, .55));
      transform.rotation.z = side * .16;
      transform.updateMatrix();
      reflectors.setMatrixAt(count++, transform.matrix);
    }
  }
  reflectors.count = count;
  scene.add(reflectors);
  for (const gap of GAPS) {
    const start = gap.start - RAMP_LENGTH;
    for (const lane of gap.lanes) {
      const x = lane * LANE;
      const positions = [], sides = [], edges = [], face = [];
      for (let i = 0; i < 12; i++) {
        const a = start + i * RAMP_LENGTH / 12, b = start + (i + 1) * RAMP_LENGTH / 12;
        const top = (x, d, height = 0) => surfacePoint(x, d, .04 + height + RAMP_HEIGHT * ((d - start) / RAMP_LENGTH) ** 1.8);
        for (const [d, side] of [[a, -1], [a, 1], [b, 1], [a, -1], [b, 1], [b, -1]]) {
          const p = top(x + side * RAMP_HALF, d);
          positions.push(p.x, p.y, p.z);
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
      for (const [data, material] of [[positions, ramp], [sides, ice], [face, ice], [edges, amber]]) {
        scene.add(new THREE.Mesh(meshGeometry(data), material));
      }
      for (const offset of [-RAMP_HALF - .42, RAMP_HALF + .42]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(.071, .09, 2.55, 7), red);
        pole.position.copy(surfacePoint(x + offset, start - 1, 1.25));
        scene.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(.78, .54), amber);
        flag.position.copy(pole.position);
        flag.position.x += (offset < 0 ? -.38 : .38);
        flag.position.y += .9;
        scene.add(flag);
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
      scene.add(new THREE.Mesh(meshGeometry(marks), amber));
    }
    const boundary = box(scene, red, 31, .2, .3, center(gap.end + 1.4), altitude(gap.end + 1.4) - .05, -gap.end - 1.4);
    boundary.rotation.y = -.04;
  }
}

function sledModel(materials) {
  const group = new THREE.Group();
  const { metal, red, bark, cloth, amber, visor } = materials;
  for (const x of [-.48, .48]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, .13, 1), new THREE.Vector3(x, .09, .55), new THREE.Vector3(x, .09, -.74),
      new THREE.Vector3(x, .19, -1.19), new THREE.Vector3(x, .43, -1.41), new THREE.Vector3(x, .59, -1.37),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, .044, 7), metal));
    for (const z of [-.67, .6]) box(group, red, .08, .31, .11, x, .24, z);
  }
  for (let i = 0; i < 5; i++) box(group, bark, .145, .09, 1.61, (i - 2) * .171, .41, .02);
  for (const z of [-.68, .68]) box(group, red, 1.05, .11, .16, 0, .37, z);
  const rider = new THREE.Group();
  rider.position.set(0, .54, .25);
  const ball = (mat, x, y, z, sx, sy, sz) => {
    const part = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), mat);
    part.position.set(x, y, z);
    part.scale.set(sx, sy, sz);
    rider.add(part);
    return part;
  };
  const body = ball(red, 0, .31, -.095, .34, .45, .24);
  body.rotation.x = -.34;
  for (const side of [-1, 1]) {
    ball(cloth, side * .21, .014, -.37, .128, .15, .43);
    ball(metal, side * .22, .04, -.77, .116, .15, .26);
    const arm = ball(red, side * .31, .31, -.24, .108, .143, .28);
    arm.rotation.x = .76;
    ball(metal, side * .33, .16, -.44, .092, .105, .113);
  }
  ball(amber, 0, .77, -.25, .238, .242, .232);
  ball(visor, 0, .75, -.409, .22, .098, .104);
  ball(cloth, 0, .29, .112, .217, .27, .13);
  group.add(rider);
  return { group, rider };
}

function snowballGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 4);
  const position = geometry.attributes.position;
  const colors = [];
  const white = new THREE.Color(0xe8f5fa), ice = new THREE.Color(0xb6d4e1);
  const tint = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const layers = Math.sin((x * 3.8 + y * 2.6 + z * .7) * 4.5 + Math.sin(z * 8.6));
    const knots = Math.cos(x * 19 + z * 11) * Math.cos(y * 17 - z * 15);
    const r = 1 + .033 * layers + .027 * knots;
    position.setXYZ(i, x * r, y * r, z * r);
    tint.copy(white).lerp(ice, .56 + .22 * layers + .17 * knots).toArray(colors, colors.length);
  }
  geometry.computeVertexNormals();
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function makeWorld(scene) {
  const random = mulberry32(326276);
  const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .92, ...options });
  const materials = {
    snow: material(0xffffff, { vertexColors: true, map: snowTexture(random) }),
    cliff: material(0xffffff, { vertexColors: true, side: THREE.DoubleSide }),
    tracks: material(0xffffff, { vertexColors: true, side: THREE.DoubleSide }),
    bark: material(COLORS.cedar), foliage: material(0xffffff, { vertexColors: true, side: THREE.DoubleSide }), rock: material(COLORS.rock),
    water: material(0x285263, { roughness: .49, metalness: .26 }),
    red: material(COLORS.red), metal: material(COLORS.metal, { roughness: .38, metalness: .25 }),
    cloth: material(0x16383e), visor: material(0x12313b, { roughness: .24, metalness: .25 }),
    ice: material(COLORS.ice, { side: THREE.DoubleSide }), ramp: material(0xc1e1e9, { side: THREE.DoubleSide }),
    amber: new THREE.MeshBasicMaterial({ color: COLORS.amber, side: THREE.DoubleSide }),
  };
  const shadowMap = gradientMap();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x314765, map: shadowMap, transparent: true, depthWrite: false, opacity: .31, side: THREE.DoubleSide,
  });
  const sun = new THREE.DirectionalLight(0xffdfb4, 2.16);
  sun.position.set(-46, 61, -41);
  scene.add(sun, new THREE.HemisphereLight(0xe2f4ff, 0x627285, 2.05));
  const sky = skyline(scene, random);
  terrain(scene, random, materials);
  tracks(scene, materials.tracks);
  const forestData = forest(scene, random, materials);
  treeShadows(scene, shadowMaterial, forestData.shadowSpots);
  venue(scene, materials);
  const sled = sledModel(materials);
  const flat = new THREE.PlaneGeometry(1, 1);
  flat.rotateX(-Math.PI / 2);
  const sledShadow = new THREE.Mesh(flat, shadowMaterial);
  scene.add(sled.group, sledShadow);
  const ballGeometry = snowballGeometry();
  const ballMaterial = material(0xffffff, { vertexColors: true });
  const balls = BALLS.map(([start, side, rate, radius], i) => {
    const mesh = new THREE.Mesh(ballGeometry, ballMaterial);
    mesh.scale.setScalar(radius);
    const shadow = new THREE.Mesh(flat, shadowMaterial);
    scene.add(mesh, shadow);
    return { start, side, rate, radius, mesh, shadow, d: start, x: side, age: 0, angle: 0, phase: i * 1.42, passed: false };
  });
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
  return { ...forestData, sky, sled, sledShadow, balls, sprayPositions, random };
}

function updateBall(ball, player, dt) {
  if (player.d > ball.start - 73 && ball.d > player.d - 25) {
    ball.age += dt;
    const next = ball.d + ball.rate * dt;
    if (!gapAt(next) && next < LENGTH - 5) ball.d = next;
    ball.x = ball.side + 5.25 * Math.sin(ball.age * 1.36 + ball.phase);
    ball.angle += dt * ball.rate / ball.radius;
  }
}

function freshRun() {
  return { d: 0, x: 0, dx: 0, y: snowHeight(0, 0), dy: 0, speed: 19, elapsed: 0,
    jumps: 0, passes: 0, air: null, countdown: 2.65, crash: '' };
}

function points(run, finish = false) {
  const bonus = finish ? Math.max(0, Math.round((63 - run.elapsed) * 24)) : 0;
  return Math.floor(run.d) + run.jumps * 250 + run.passes * 110 + bonus;
}

function simulate(run, world, input, dt) {
  run.elapsed += dt;
  const before = run.d;
  const steer = Number(input('right')) - Number(input('left'));
  const lateralSpeed = run.air ? 5.9 : 13.8 + run.speed * .075;
  const grip = run.air ? 3.8 : 8.9;
  run.dx += (steer * lateralSpeed - run.dx) * (1 - Math.exp(-dt * grip));
  run.x = clamp(run.x + run.dx * dt, -EDGE - .7, EDGE + .7);
  const bank = smooth(12, EDGE + .7, Math.abs(run.x));
  const targetSpeed = (input('brake') ? 19.5 : input('tuck') ? 46 : 33) - bank * 6.2 - 10 * (slope(run.d) + .286);
  run.speed += (targetSpeed - run.speed) * (1 - Math.exp(-dt * (input('brake') ? 3.4 : 1.35)));
  run.d = Math.min(LENGTH, run.d + run.speed * dt);
  const gap = gapAt(run.d) || GAPS.find(g => before < g.start && run.d >= g.start);
  if (gap && !run.air) {
    const onRamp = gap.lanes.some(lane => Math.abs(run.x - lane * LANE) < RAMP_HALF - .15);
    run.air = { gap, launched: onRamp };
    run.y = snowHeight(run.x, gap.start) + (onRamp ? RAMP_HEIGHT : .05);
    run.dy = onRamp ? 8.7 + .1 * run.speed : slope(before) * run.speed;
  }
  if (run.air) {
    run.dy -= dt * 31;
    run.y += run.dy * dt;
    if (run.d >= run.air.gap.end && run.y <= snowHeight(run.x, run.d) + .025) {
      if (run.y < snowHeight(run.x, run.d) - .78) return `You came up short at ${run.air.gap.name}. Keep your speed through the ramp.`;
      if (run.air.launched) run.jumps++;
      run.air = null;
    } else if (gap && run.y < snowHeight(run.x, run.air.gap.start) - 10) {
      return run.air.launched ? `You came up short at ${gap.name}. Keep your speed through the ramp.` : `You missed the ramp at ${gap.name}. Follow the amber chevrons.`;
    }
  }
  if (!run.air) run.y = surfaceHeight(run.x, run.d);
  for (const tree of world.treeRows) {
    const distance = Math.hypot(tree.d - run.d, tree.x - run.x);
    if (distance < tree.hit + .58 && run.y < snowHeight(tree.x, tree.d) + 5) return 'You hit a fir. Steer into a clear line before the next trunk.';
    if (before < tree.d && tree.d <= run.d && distance < tree.hit + 2.05 && !run.air) run.passes++;
  }
  for (const ball of world.balls) {
    const oldD = ball.d;
    updateBall(ball, run, dt);
    const distance = Math.hypot(ball.d - run.d, ball.x - run.x);
    if (distance < ball.radius + .55 && run.y - snowHeight(ball.x, ball.d) < ball.radius * 1.8) return 'A rolling snowball caught you. The outside line gives you room to pass.';
    if (before < oldD && ball.d <= run.d && distance < ball.radius + 2.25 && !ball.passed) {
      ball.passed = true;
      run.passes++;
    }
  }
  return '';
}

function updateVisuals(world, camera, run, dt, state, input, view) {
  const { sled, sledShadow, balls, sky, sprayPositions, chunks } = world;
  const active = state === 'running';
  const d = run.d, x = center(d) + run.x;
  for (const chunk of chunks) {
    const ahead = chunk.d - d;
    chunk.stand.visible = ahead > -144 && ahead < 434;
    chunk.foliage.visible = ahead < 128;
    chunk.distantFoliage.visible = !chunk.foliage.visible;
  }
  const f = 1 - Math.exp(-dt * 9);
  const heading = Math.atan2(center(d + 1) - center(d) + run.dx / Math.max(12, run.speed), 1);
  sled.group.position.set(x, run.y + .015, -d);
  sled.group.rotation.y = mix(sled.group.rotation.y, -heading * .84, f);
  sled.group.rotation.z = mix(sled.group.rotation.z, -.023 * run.dx + (run.crash ? .49 : 0), f);
  const grade = run.air ? clamp(run.dy * .027, -.52, .48) : Math.atan(surfaceHeight(run.x, d + .13) - surfaceHeight(run.x, d - .13)) / .26;
  sled.group.rotation.x = mix(sled.group.rotation.x, grade, f);
  const tuck = Number(active && input('tuck'));
  sled.rider.scale.y = mix(sled.rider.scale.y, 1 - tuck * .31, f);
  sled.rider.rotation.x = mix(sled.rider.rotation.x, -.52 * tuck, f);
  sledShadow.visible = !gapAt(d);
  sledShadow.position.set(x, surfaceHeight(run.x, d) + .086, -d);
  sledShadow.rotation.x = -slope(d);
  sledShadow.scale.set(2.1 + (run.air ? .75 : 0), 1, 3.8);

  for (const ball of balls) {
    const visible = Math.abs(ball.d - d) < 285;
    ball.mesh.visible = ball.shadow.visible = visible;
    if (!visible) continue;
    const ballX = center(ball.d) + ball.x, y = surfaceHeight(ball.x, ball.d);
    ball.mesh.position.set(ballX, y + ball.radius, -ball.d);
    ball.mesh.rotation.set(-ball.angle, .28 + .19 * Math.cos(ball.age * 1.36 + ball.phase), ball.angle * .21);
    ball.shadow.position.set(ballX, y + .092, -ball.d);
    ball.shadow.rotation.x = -slope(ball.d);
    ball.shadow.scale.set(ball.radius * 2.75, 1, ball.radius * 2.5);
  }
  if (active && !view.reduced && !run.air) {
    view.sprayCarry += dt * (39 + Math.abs(run.dx) * 2.6 + (input('brake') ? 34 : 0));
    while (view.sprayCarry > 1) {
      view.sprayCarry--;
      const p = view.spray[view.sprayIndex++ % view.spray.length];
      const side = world.random() < .5 ? -1 : 1;
      p.x = x + side * .5;
      p.y = run.y + .13;
      p.z = -d + .91;
      p.dx = -run.dx * .24 + side * (world.random() * 2.35 + .11);
      p.dy = world.random() * 2.6 + .31;
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
  const lift = run.air ? Math.max(0, run.y - snowHeight(run.x, d)) * .64 : 0;
  const follow = state === 'intro' ? -12.3 : -9.6 - run.speed * .037;
  const desiredFov = view.reduced ? 64 : 61 + run.speed * .23;
  const cameraX = center(d + follow) + run.x * .84 - run.dx * .061;
  const cameraY = snowHeight(run.x, d + follow) + 4.05 + lift;
  if (!view.initialized) {
    camera.position.set(cameraX, cameraY, -(d + follow));
    camera.fov = desiredFov;
    view.initialized = true;
  } else {
    camera.position.x = mix(camera.position.x, cameraX, f);
    camera.position.y = mix(camera.position.y, cameraY, f);
    camera.position.z = mix(camera.position.z, -(d + follow), 1 - Math.exp(-dt * 17));
    camera.fov = mix(camera.fov, desiredFov, f);
  }
  camera.updateProjectionMatrix();
  const ahead = d + lead;
  camera.lookAt(center(ahead) + run.x * .61, altitude(ahead) + 2.34 + lift * .78, -ahead);
  if (!view.reduced) camera.rotateZ(-run.dx * .0019);
  sky.position.copy(camera.position);
}

function disposeScene(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
    if (object.isInstancedMesh) object.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    if (material.map) textures.add(material.map);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

function gameDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'sled-game';
  dialog.className = 'sled-game';
  dialog.dataset.minigameOverlay = 'sled';
  dialog.setAttribute('aria-label', `${TITLE} sled run`);
  dialog.innerHTML = `
    <div class="sled-stage" aria-hidden="true"></div>
    <div class="sled-scrim" aria-hidden="true"></div>
    <header class="sled-top">
      <div class="sled-course"><span>Sled run</span><h2>${TITLE}</h2><p data-sled-sector>Old-growth forest</p></div>
      <div class="sled-stats" aria-label="Run stats">
        <div><b data-sled-speed>0</b><span>km/h</span></div>
        <div><b data-sled-time>00:00.0</b><span>Time</span></div>
        <div><b data-sled-score>0</b><span>Points</span></div>
      </div>
      <div class="sled-actions">
        <button type="button" data-sled-pause aria-label="Pause sled run" class="sled-secondary">Pause</button>
        <button type="button" data-sled-exit class="sled-secondary">Exit <kbd>Esc</kbd></button>
      </div>
    </header>
    <div class="sled-progress" aria-label="Course progress">
      <div class="sled-progress-track"><i data-sled-progress></i>${GAPS.map(gap => `<s style="--gap-at:${100 * gap.start / LENGTH}%;--gap-width:${100 * (gap.end - gap.start) / LENGTH}%"></s>`).join('')}</div>
      <span><b data-sled-distance>0</b> / ${LENGTH.toLocaleString('en-US')} m</span>
      <span><b data-sled-jumps>0</b> / ${GAPS.length} jumps</span>
    </div>
    <aside class="sled-callout" hidden><em data-sled-callout-icon aria-hidden="true">↑</em><div><b data-sled-callout aria-live="polite"></b><span data-sled-callout-detail></span></div></aside>
    <div class="sled-countdown" aria-live="polite" hidden></div>
    <section class="sled-card" aria-labelledby="sled-card-title">
      <p class="sled-kicker" data-sled-kicker>1.56 km · Four crossings</p>
      <h2 id="sled-card-title">Drop in</h2>
      <p data-sled-description>Thread the firs and dodge rolling snowballs. Follow the amber chevrons and keep your speed through each ramp.</p>
      <div class="sled-card-controls" data-sled-controls>
        <span><kbd>A</kbd> <kbd>D</kbd> Steer</span><span><kbd>W</kbd> Tuck</span><span><kbd>S</kbd> Brake</span>
      </div>
      <div class="sled-results" data-sled-results hidden>
        <div><span>Run points</span><b data-sled-final>0</b></div>
        <div><span>Personal best</span><b data-sled-best>0</b></div>
      </div>
      <button type="button" data-sled-play class="sled-primary" autofocus>Start run</button>
    </section>
    <div class="sled-bottom">
      <p class="sled-key-hint"><kbd>A</kbd> <kbd>D</kbd> Steer <kbd>W</kbd> Tuck <kbd>S</kbd> Brake <kbd>R</kbd> Retry</p>
      <div class="sled-touch" aria-label="Hold a steering or speed button">
        <div><button type="button" data-sled-input="left" aria-label="Steer left">←</button><button type="button" data-sled-input="right" aria-label="Steer right">→</button></div>
        <div><button type="button" data-sled-input="brake">Brake</button><button type="button" data-sled-input="tuck">Tuck</button></div>
      </div>
    </div>`;
  return dialog;
}

const KEY_ACTION = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'tuck', KeyW: 'tuck', ArrowDown: 'brake', KeyS: 'brake',
};
const LANE_HINTS = { '-1': 'left', 0: 'center', 1: 'right' };
const LANE_ICONS = { '-1': '↖', 0: '↑', 1: '↗' };

export function openSledGame() {
  const current = document.getElementById('sled-game');
  if (current?.open) return current;
  const dialog = gameDialog();
  const restoreFocus = document.activeElement;
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.append(dialog);
  dialog.showModal();
  const get = name => dialog.querySelector(`[data-sled-${name}]`);
  const play = get('play'), pause = get('pause'), exit = get('exit');
  const card = dialog.querySelector('.sled-card'), title = card.querySelector('h2');
  const callout = dialog.querySelector('.sled-callout'), countdown = dialog.querySelector('.sled-countdown');
  const stats = ['speed', 'time', 'score', 'sector', 'distance', 'jumps'].map(get);
  const progress = get('progress');
  const stage = dialog.querySelector('.sled-stage');
  const listeners = new AbortController();
  const { signal } = listeners;
  const keys = new Set(), pointers = new Map();
  const input = action => {
    for (const code of keys) if (KEY_ACTION[code] === action) return true;
    for (const held of pointers.values()) if (held === action) return true;
    return false;
  };
  let run = freshRun(), state = 'intro', previousState = 'running', best = 0;
  let pendingTime = 0, last = performance.now();
  let renderer, observer, animation;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.mist, 116, 430);
  const camera = new THREE.PerspectiveCamera(64, 1, .12, 4900);
  let world;
  try {
    const saved = Number(localStorage.getItem(STORAGE));
    if (Number.isSafeInteger(saved) && saved >= 0) best = saved;
  } catch {}
  const view = {
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    initialized: false, sprayCarry: 0, sprayIndex: 0, spray: Array.from({ length: 126 }, () => ({ life: -1 })),
  };
  const text = (element, value) => {
    const string = String(value);
    if (element.textContent !== string) element.textContent = string;
  };
  const formatPoints = score => score.toLocaleString('en-US');

  function setState(next) {
    state = next;
    dialog.dataset.state = next;
    const running = next === 'running' || next === 'countdown';
    card.hidden = running;
    pause.hidden = !running && next !== 'paused';
    pause.textContent = next === 'paused' ? 'Resume' : 'Pause';
    pause.setAttribute('aria-label', `${pause.textContent} sled run`);
    if (!running) callout.hidden = countdown.hidden = true;
  }

  function reset() {
    if (!world) return;
    run = freshRun();
    pendingTime = 0;
    last = performance.now();
    view.initialized = false;
    view.sprayCarry = 0;
    view.sprayIndex = 0;
    for (const particle of view.spray) particle.life = -1;
    for (const ball of world.balls) {
      Object.assign(ball, { d: ball.start, x: ball.side, age: 0, angle: 0, passed: false });
    }
    setState('countdown');
    updateHud();
    exit.focus({ preventScroll: true });
  }

  function togglePause() {
    if (state === 'paused') {
      last = performance.now();
      setState(previousState);
      pause.focus({ preventScroll: true });
      return;
    }
    if (state !== 'running' && state !== 'countdown') return;
    previousState = state;
    keys.clear();
    pointers.clear();
    setState('paused');
    text(get('kicker'), TITLE);
    text(title, 'Run paused');
    text(get('description'), 'Resume from here or press R to start a new run.');
    get('controls').hidden = true;
    get('results').hidden = true;
    text(play, 'Resume run');
    play.focus({ preventScroll: true });
  }

  function finish(crash) {
    run.crash = crash;
    const score = points(run, !crash);
    const record = score > best;
    if (record) {
      best = score;
      try { localStorage.setItem(STORAGE, String(best)); } catch {}
    }
    setState(crash ? 'crashed' : 'finished');
    text(get('kicker'), record ? 'Personal best' : TITLE);
    text(title, crash ? 'Run ended' : 'Finish line');
    text(get('description'), crash || `${timeText(run.elapsed)} · ${run.jumps} crossings cleared · ${run.passes} close passes`);
    get('controls').hidden = true;
    get('results').hidden = false;
    text(get('final'), formatPoints(score));
    text(get('best'), formatPoints(best));
    text(play, 'Ride again');
    play.focus({ preventScroll: true });
  }

  function updateHud() {
    const sector = SECTORS.findLast(([d]) => d <= run.d)[1];
    const values = [run.d > 0 ? Math.round(run.speed * 3.6) : 0, timeText(run.elapsed), formatPoints(points(run, state === 'finished')),
      sector, formatPoints(Math.round(run.d)), run.jumps];
    values.forEach((value, i) => text(stats[i], value));
    progress.style.width = `${100 * run.d / LENGTH}%`;
    countdown.hidden = state !== 'countdown';
    if (state === 'countdown') text(countdown, Math.max(1, Math.ceil(run.countdown)));
    const next = GAPS.find(gap => run.d < gap.end);
    const running = state === 'running';
    callout.hidden = !running || !next || (next.start - run.d > 119);
    if (!callout.hidden) {
      const label = next.lanes.map(lane => LANE_HINTS[lane]).join(' or ');
      const icon = next.lanes.map(lane => LANE_ICONS[lane]).join(' ');
      text(get('callout-icon'), icon);
      text(get('callout'), next.name);
      text(get('callout-detail'), run.air ? 'Watch the landing' : `${label.charAt(0).toUpperCase() + label.slice(1)} ramp · ${Math.max(0, Math.round(next.start - run.d))} m`);
    }
  }

  function close() {
    if (dialog.open) dialog.close();
  }
  function cleanup() {
    listeners.abort();
    observer?.disconnect();
    cancelAnimationFrame(animation);
    disposeScene(scene);
    renderer?.dispose();
    dialog.remove();
    if (restoreFocus instanceof HTMLElement && restoreFocus.isConnected) restoreFocus.focus({ preventScroll: true });
  }

  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!renderer || !width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.55, Math.sqrt(2_700_000 / (width * height)));
    if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  dialog.addEventListener('close', cleanup, { once: true });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal });
  play.addEventListener('click', () => state === 'paused' ? togglePause() : reset(), { signal });
  pause.addEventListener('click', togglePause, { signal });
  exit.addEventListener('click', close, { signal });
  window.addEventListener('keydown', event => {
    if (!dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    event.stopImmediatePropagation();
    if (KEY_ACTION[event.code]) {
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseOnBlur(); else resize(); }, { signal });
  function pauseOnBlur() {
    keys.clear();
    pointers.clear();
    if (state === 'running' || state === 'countdown') togglePause();
  }
  for (const button of dialog.querySelectorAll('[data-sled-input]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
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
    stage.append(renderer.domElement);
    world = makeWorld(scene);
    observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
  } catch (error) {
    setState('unavailable');
    text(title, 'Sled run unavailable');
    text(get('description'), 'The 3D course needs hardware-accelerated graphics.');
    get('kicker').hidden = get('controls').hidden = play.hidden = true;
    exit.focus();
    console.warn('Could not create sled course', error);
    return dialog;
  }

  function draw(now) {
    const seconds = Math.max(0, (now - last) / 1000);
    const dt = Math.min(seconds, .12);
    last = now;
    if (state === 'countdown') {
      run.countdown -= seconds;
      if (run.countdown <= 0) setState('running');
    } else if (state === 'running') {
      pendingTime += dt;
      while (pendingTime + 1e-8 >= STEP) {
        pendingTime -= STEP;
        const crash = simulate(run, world, input, STEP);
        if (crash || run.d >= LENGTH) { finish(crash); break; }
      }
    }
    updateVisuals(world, camera, run, dt, state, input, view);
    updateHud();
    renderer.render(scene, camera);
    animation = requestAnimationFrame(draw);
  }
  last = performance.now();
  draw(last);
  return dialog;
}
