import * as THREE from 'three';
import { buildLiftProfile, liftFrame, liftPoint } from './mapped-lift-profile.js';
import { makeCanvas } from './util.js';
import { hanazonoCenterFootprint } from './niseko-sites.js';
import { mergedMesh, part } from './scenery.js';

const graphite = '#252d34', mullion = '#303b43', darkZinc = '#414b51';
const timber = '#a27e54', soffit = '#c1a688', oak = '#84654c';
const silver = '#849097', concrete = '#858987', snow = '#e8eff1';
const blue = '#226a92', glass = '#537b91', warmGlass = '#8ba4a9';
const mid = (a, b) => (a + b) * .5;
const atY = ([x, , z], y) => [x, y, z];
const interpolate = (a, b, t) => a.map((value, i) => THREE.MathUtils.lerp(value, b[i], t));

function ceilingLights(model, positions) {
  const geometry = new THREE.BoxGeometry(.86, .028, .075);
  const material = new THREE.MeshStandardMaterial({ color: '#ffe9ca', roughness: .52, emissive: '#dfaa69', emissiveIntensity: .8 });
  const lights = new THREE.InstancedMesh(geometry, material, positions.length);
  const matrix = new THREE.Matrix4();
  positions.forEach(([x, y, z], i) => lights.setMatrixAt(i, matrix.makeTranslation(x, y, z)));
  lights.name = 'Warm recessed ceiling lights';
  model.group.add(lights);
}

function lettering(model, text, position, width, height, yaw, options = {}) {
  const { canvas, ctx } = makeCanvas(1024, 256);
  const { fg = '#f2f4ee', bg, subtitle, bold = 700 } = options;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = bold + ' 132px Arial, sans-serif';
  ctx.fillText(text, 512, subtitle ? 99 : 134, 963);
  if (subtitle) {
    ctx.font = '600 53px "Yu Gothic", Meiryo, sans-serif';
    ctx.fillText(subtitle, 512, 207, 948);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 6;
  const material = new THREE.MeshStandardMaterial({ map, roughness: .72,
    transparent: !bg, alphaTest: bg ? 0 : .35, depthWrite: true, emissive: '#383936' });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.fromArray(position);
  mesh.rotation.y = yaw;
  model.group.add(mesh);
}

function wall(model, a, b, low, high, color, finish) {
  model.sheet(atY(a, low), atY(b, low), atY(b, high), atY(a, high), color, 1, finish);
  model.barrier(a, b, high, low);
}

function curtain(model, a, b, sill, header, count, { solid = true, opacity = .57, tint = glass } = {}) {
  const length = Math.hypot(a[0] - b[0], a[2] - b[2]);
  const x = (b[0] - a[0]) / length, z = (b[2] - a[2]) / length;
  for (let i = 0; i < count; i++) {
    const l = interpolate(a, b, i / count), r = interpolate(a, b, (i + 1) / count);
    model.sheet(atY(l, sill), atY(r, sill), atY(r, header(r)), atY(l, header(l)), tint, opacity, 'glazing');
    model.line(atY(l, sill), atY(l, header(l)), .096, mullion);
    model.line(atY(l, header(l)), atY(r, header(r)), .12, mullion);
    model.line(atY(l, sill + .85), atY(r, sill + .85), .048, mullion);
    if (Math.min(header(l), header(r)) > sill + 4.3) {
      model.line(atY(l, sill + 3.32), atY(r, sill + 3.32), .065, mullion);
    }
    // Offset the cap from the face to catch the grazing winter sun.
    if (i % 3 === 0) model.line(atY([l[0] - z * .1, 0, l[2] + x * .1], sill),
      atY([l[0] - z * .1, 0, l[2] + x * .1], header(l)), .05, darkZinc);
  }
  model.line(atY(b, sill), atY(b, header(b)), .096, mullion);
  model.line(atY(a, sill), atY(b, sill), .12, darkZinc);
  if (solid) model.barrier(a, b, Math.max(header(a), header(b)), sill, .12);
}

function guard(model, a, b, glazed = false) {
  const length = Math.hypot(a[0] - b[0], a[2] - b[2]);
  const count = Math.ceil(length / (glazed ? 1.55 : 1.3));
  const above = ([x, y, z], rise) => [x, y + rise, z];
  for (let i = 0; i <= count; i++) {
    const p = interpolate(a, b, i / count);
    model.line(p, above(p, 1.10), .074, mullion);
  }
  model.line(above(a, 1.10), above(b, 1.10), .085, mullion);
  model.line(above(a, .11), above(b, .11), .055, mullion);
  if (glazed) model.sheet(above(a, .11), above(b, .11), above(b, 1.07), above(a, 1.07), glass, .34, 'glazing');
  else model.line(above(a, .58), above(b, .58), .051, silver);
  model.barrier(a, b, Math.max(a[1], b[1]) + 1.1, Math.min(a[1], b[1]), .08);
}

function platform(model, width, length, x, z, y, material, thickness = .2) {
  model.block(width, thickness, length, material, x, y - thickness * .5, z);
  model.surface([x, y, z - length * .5], [x, y, z + length * .5], width);
}

function stairs(model, x, z0, z1, y0, y1, width) {
  const count = Math.max(2, Math.ceil(Math.abs(y1 - y0) / .16));
  const depth = Math.abs(z1 - z0) / count;
  for (let i = 0; i < count; i++) {
    const z = THREE.MathUtils.lerp(z0, z1, (i + .5) / count);
    const ledge = THREE.MathUtils.lerp(y0, y1, (i + .5) / count);
    model.block(width, .27, depth + .022, concrete, x, ledge - .135, z);
    model.block(width, .024, .065, snow, x, ledge + .009, z + Math.sign(z1 - z0) * depth * .38);
  }
  model.surface([x, y0, z0], [x, y1, z1], width);
  for (const side of [-1, 1]) {
    const railX = x + width * .495 * side;
    guard(model, [railX, y0, z0], [railX, y1, z1]);
  }
}

function frameFor(lift, top) {
  const points = lift.points;
  return top ? liftFrame(liftPoint(points.at(-1)), liftPoint(points.at(-2))).heading + Math.PI
    : liftFrame(liftPoint(points[0]), liftPoint(points[1])).heading;
}

function station(scene, config, ground, env, floors, setup, id, label, isTop = false, adjustedYaw) {
  const lift = config.lifts.find(({ id: name }) => name === id);
  const [x, z] = isTop ? lift.points.at(-1) : lift.points[0];
  const y = ground.heightAt(x, z);
  return setup(scene, label, ground, env, floors, x, y, z, adjustedYaw ?? frameFor(lift, isTop));
}

function aceBase(scene, config, ground, env, floors, setup) {
  const model = station(scene, config, ground, env, floors, setup, 'ace-gondola', 'Hirafu · Ace Gondola valley station');
  // Glazed upper machinery case over the open loading level. The long case and
  // the compact, slanted end are visible in Tokyu's grand-opening photograph.
  const sections = [
    [-7.35, 4.34, 3.62, 4.17, 7.15], [-6.65, 4.55, 3.89, 4.12, 7.38],
    [1.3, 4.49, 3.86, 4.22, 7.49], [9.6, 4.35, 3.76, 4.56, 7.69],
    [18.7, 4.1, 3.58, 4.85, 7.88], [24.3, 3.97, 3.46, 5.18, 8.02],
  ];
  for (let i = 1; i < sections.length; i++) {
    const [az, ab, ah, al, ar] = sections[i - 1], [bz, bb, bh, bl, br] = sections[i];
    model.sheet([-ah, ar, az], [ah, ar, az], [bh, br, bz], [-bh, br, bz], graphite);
    model.sheet([-ah + .17, ar + .081, az], [ah - .17, ar + .081, az],
      [bh - .17, br + .081, bz], [-bh + .17, br + .081, bz], snow);
    for (const s of [-1, 1]) {
      const a = [s * ab, al, az], b = [s * bb, bl, bz];
      const c = [s * bh, br - .28, bz], d = [s * ah, ar - .28, az];
      model.sheet(a, b, c, d, glass, .62, 'glazing');
      model.line(a, b, .25, graphite);
      model.line(c, d, .24, graphite);
      const count = Math.ceil((bz - az) / 1.49);
      for (let j = 0; j <= count; j++) model.line(interpolate(a, b, j / count), interpolate(d, c, j / count), .074, mullion);
    }
  }
  const faceZ = -7.35;
  model.sheet([-3.81, 4.56, faceZ], [3.81, 4.56, faceZ], [3.29, 6.65, faceZ], [-3.29, 6.65, faceZ],
    '#7793a0', .75, 'glazing');
  for (const side of [-1, 1]) model.line([side * 4.04, 4.27, faceZ], [side * 3.49, 6.96, faceZ], .55, graphite);
  model.block(8.74, .35, .52, graphite, 0, 4.28, faceZ);
  model.block(7.46, .54, .44, graphite, 0, 6.94, faceZ);
  for (let i = -3; i <= 3; i++) model.line([i * .97, 4.49, faceZ], [i * .87, 6.76, faceZ], .095, mullion);
  lettering(model, 'ACE GONDOLA', [0, 6.99, faceZ - .234], 3.8, .63, Math.PI);
  lettering(model, 'エースゴンドラ', [-4.1, 5.53, -2.5], 6.1, .91, -Math.PI / 2);
  // Mapped station decks and pass gates remain aligned to the suspended cabins.
  for (const z of [3.1, 15.1]) for (const x of [-3.6, 3.6]) {
    const y = model.floor(x, z);
    model.line([x, y, z], [x * .81, 4.38, z], .25, silver);
    model.barrier([x, 0, z - .16], [x, 0, z + .16], 4.38, y, .14);
  }
  const signZ = -14.5, signX = 6.9;
  const y = model.floor(signX, signZ);
  model.block(.11, 2.01, .12, mullion, signX, y + 1, signZ);
  model.block(2.65, .72, .16, graphite, signX, y + 1.98, signZ);
  lettering(model, 'ACE GONDOLA', [signX, y + 1.98, signZ - .084], 2.5, .65, Math.PI,
    { subtitle: 'ゴンドラ乗り場 →' });
  model.finish();
}

function nest(scene, config, ground, env, floors, setup) {
  const m = station(scene, config, ground, env, floors, setup, 'ace-gondola', 'Hirafu · NEST813 summit station and terrace',
    true, -1.904);
  const left = -14.7, right = 21.3, down = -24.1, up = 29.5;
  // Leave room for grips beneath the slab over the sampled approach grade.
  const lobby = 5.84;
  const A = (x, z, y = 0) => [x, y, z];
  // Raised restaurant frontage and deep foundation over the downhill slope.
  // Keep the cable throat in the north half of the station open below level 2.
  wall(m, A(left, down), A(-6.3, down), -5.7, lobby, concrete, 'concrete');
  wall(m, A(7.4, down), A(right, down), -5.7, lobby, concrete, 'concrete');
  wall(m, A(left, down), A(left, up), -5.7, lobby, graphite, 'concrete');
  wall(m, A(right, down), A(right, 9), -5.7, lobby, concrete, 'concrete');
  wall(m, A(right, 14.4), A(right, up), -5.7, lobby, graphite, 'concrete');
  wall(m, A(left, up), A(-7, up), -3.0, lobby, graphite);
  wall(m, A(6.4, up), A(right, up), -3.0, lobby, graphite);
  m.block(right - left, .32, up - down, oak, mid(left, right), lobby - .16, mid(down, up));
  // Players walking through the cable level cannot snap to the floor above.
  m.surface(A(mid(left, right), down, lobby), A(mid(left, right), up, lobby), right - left, .04, .32);

  const northWest = A(left, up), southWest = A(left, down), southEast = A(right, down);
  const northEast = A(right, up);
  const roofY = ([x, , z]) => 9.28 + (z - down) * .016 - (x - left) * .008;
  curtain(m, southWest, southEast, lobby + .15, roofY, 19, { tint: warmGlass, opacity: .52 });
  curtain(m, southEast, A(right, 9), lobby + .15, roofY, 15, { tint: warmGlass, opacity: .57 });
  curtain(m, A(right, 14.4), northEast, lobby + .15, roofY, 6, { tint: warmGlass, opacity: .57 });
  curtain(m, northWest, southWest, lobby + .24, roofY, 23, { tint: glass, opacity: .79 });
  wall(m, northEast, northWest, lobby, 9.37, graphite);
  const roofOutline = [A(left - 1.18, down - 1.48), A(right + 1.18, down - 1.48),
    A(right + 1.18, up + 1.02), A(left - 1.18, up + 1.02)];
  m.sheet(...roofOutline.map(p => atY(p, roofY(p) + .31)), snow);
  m.sheet(...roofOutline.map(p => atY(p, roofY(p) - .06)), soffit);
  for (let i = 0; i < 4; i++) {
    const a = roofOutline[i], b = roofOutline[(i + 1) % 4];
    m.sheet(atY(a, roofY(a) - .08), atY(b, roofY(b) - .08),
      atY(b, roofY(b) + .33), atY(a, roofY(a) + .33), graphite);
  }

  // Keep the terrace and its side access on the Mt. Yotei-facing corner.
  const viewX = 14.95, viewZ = -27.2, deckWidth = 15.7;
  platform(m, deckWidth, 6.4, viewX, viewZ, lobby, oak, .29);
  const l = viewX - deckWidth / 2, r = viewX + deckWidth / 2;
  for (let z = -30.05; z < -24.06; z += .24) {
    m.block(deckWidth - .06, .005, .009, '#6b5140', viewX, lobby + .0025, z);
  }
  const benchShape = new THREE.SphereGeometry(1, 16, 10);
  const benchParts = [];
  for (const x of [8.5, 11.9, 16.8, 21]) {
    benchParts.push(part(benchShape, '#dcdcd5', [x, lobby + .25, -29.05], [0, 0, 0], [.7, .27, .38]));
    benchParts.push(part(benchShape, '#e4e4dd', [x + .42, lobby + .23, -28.92], [0, 0, 0], [.59, .24, .32]));
    m.barrier(A(x - .58, -29.02), A(x + .91, -29.02), lobby + .50, lobby, .31);
  }
  m.group.add(mergedMesh(benchParts, { roughness: .72 }));
  benchShape.dispose();
  guard(m, A(l, -30.38, lobby), A(r, -30.38, lobby), true);
  guard(m, A(l, down, lobby), A(l, -30.38, lobby), true);
  guard(m, A(r, -30.38, lobby), A(r, -24.04, lobby), true);
  platform(m, 2.6, 34, 22.55, -7, lobby, oak);
  guard(m, A(23.81, -24, lobby), A(23.81, 10, lobby), true);
  const arrivalFloor = m.floor(22.55, 23.7);
  stairs(m, 22.55, 23.7, 10, arrivalFloor, lobby, 2.6);
  const lights = [];
  for (const z of [-20, -14, -8, -2, 4, 10, 16, 22]) {
    for (const x of [-11.8, -5.6, .4, 6.4, 12.4, 18.4]) lights.push([x, roofY(A(x, z)) - .17, z]);
  }
  ceilingLights(m, lights);
  for (const z of [-21.7, -14.9, -5.5, 4.4]) {
    for (let x = 2.0; x < 19; x += 3.3) {
      m.block(1.08, .085, .72, timber, x, lobby + .81, z);
      m.line(A(x, z, lobby + .03), A(x, z, lobby + .77), .065, graphite);
      for (const dz of [-.64, .64]) {
        m.block(.48, .105, .49, oak, x, lobby + .44, z + dz);
        m.block(.32, .39, .32, graphite, x, lobby + .195, z + dz);
      }
    }
  }
  lettering(m, 'NEST813', [9.05, lobby + 3.14, down - .029], 7.2, 1.23, Math.PI,
    { subtitle: '展望テラス  ·  MT. YOTEI' });
  lettering(m, 'NEST813', [right + .027, lobby + 3.31, 5.2], 7.9, 1.15, Math.PI / 2);
  m.finish();
}

function pomaCover(scene, config, ground, env, floors, setup, id, name, top = false) {
  const isGondola = id.includes('symphony');
  const lift = config.lifts.find(({ id: key }) => key === id);
  const profile = buildLiftProfile(lift, ground, isGondola ? 2.18 : 1.75,
    isGondola ? 1.11 : lift.capacity * .26 + .11, false, false, env.roofHeightNear);
  const frame = top ? profile.top : profile.bottom;
  const base = ground.heightAt(frame.x, frame.z);
  const m = setup(scene, name, ground, env, floors, frame.x, base, frame.z, frame.heading);
  const width = isGondola ? 4.1 : 3.85;
  const section = [
    [-width, 3.35], [-width + .08, 4.22], [-width + .72, 5.16], [-width + 1.56, 5.48],
    [width - 1.56, 5.48], [width - .72, 5.16], [width - .08, 4.22], [width, 3.35],
  ];
  const run = top ? [-13, -8, -3, 2, 5.4] : [-5.8, -1, 5.2, 12.5, 19.5, 24.7];
  const sin = Math.sin(frame.heading), cos = Math.cos(frame.heading);
  const samples = profile.samples.map(({ point }) => [
    (point.x - frame.x) * sin + (point.z - frame.z) * cos, point.y,
  ]).filter(([z]) => z > -16 && z < 28);
  // Fit the soffit above the rope and around the actual grade into the station.
  // Holding the end of the profile also follows the level return wrap.
  function elevation(z) {
    const next = samples.findIndex(([sample]) => sample >= z);
    if (next === -1) return samples.at(-1)[1] - base - 3.13;
    if (next === 0) return samples[0][1] - base - 3.13;
    const [z0, y0] = samples[next - 1], [z1, y1] = samples[next];
    return THREE.MathUtils.lerp(y0, y1, (z - z0) / (z1 - z0)) - base - 3.13;
  }
  const ribPoint = ([x, y], z) => [x, elevation(z) + y, z];
  for (let n = 1; n < run.length; n++) {
    const start = run[n - 1], end = run[n];
    for (let i = 1; i < section.length; i++) {
      const a = section[i - 1], b = section[i], isWindow = i === 1 || i === 7;
      m.sheet(ribPoint(a, start), ribPoint(b, start), ribPoint(b, end), ribPoint(a, end),
        isWindow ? '#50636d' : i === 4 ? snow : darkZinc, isWindow ? .72 : 1, isWindow ? 'glazing' : undefined);
      m.line(ribPoint(a, end), ribPoint(b, end), .11, silver);
      m.line(ribPoint(a, start), ribPoint(a, end), .08, darkZinc);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const x = side * (width - .18 - i * .146);
        m.line([x, elevation(start) + 3.35, start], [x, elevation(end) + 3.35, end],
          .142, i % 2 ? timber : soffit, .12);
      }
    }
  }
  const cap = top ? run.at(-1) : run[0], h = elevation(cap);
  m.sheet([-width, h + 3.36, cap], [width, h + 3.36, cap], [width - .8, h + 5.18, cap],
    [-width + .8, h + 5.18, cap], '#5a6871', .93, 'glazing');
  const flag = top ? 1 : -1;
  lettering(m, isGondola ? 'SYMPHONY' : 'HANAZONO 1', [0, h + 4.57, cap + .03 * flag], 5.0, .72,
    top ? 0 : Math.PI, { subtitle: isGondola ? 'シンフォニーゴンドラ' : '第１リフト' });
  for (const z of (top ? [1.83, -7.2] : [3.3, 12.6, 20.1])) {
    for (const x of [-width + .35, width - .35]) {
      const y = m.floor(x, z);
      m.line([x, y + .1, z], [.88 * x, elevation(z) + 3.5, z], .239, '#687680');
      m.block(.36, .47, .39, blue, x, y + .23, z);
      m.barrier([x, 0, z - .19], [x, 0, z + .19], elevation(z) + 3.5, y, .18);
    }
  }
  m.finish();
}

function edge(scene, ground, env, floors, setup) {
  const cx = 2682.1, cz = -4520.0;
  const m = setup(scene, 'Hanazono EDGE · Nikken Sekkei restaurant and plaza', ground, env, floors,
    cx, ground.heightAt(cx, cz), cz, .990);
  const first = -22.7, last = 22, width = 30.7;
  const facade = -12.95, back = 13.0, floor = .55;
  // Ortho-traced ski-side plan and the opposing low rises of the bent roof.
  // The high end shelters the glass atrium and the ski-side stairs.
  const bends = [[-26, 12.25, 14.8], [-20, 10.96, 15.9], [-9, 8.64, 16.4],
    [3, 6.61, 16.05], [11.2, 6.01, 15.8], [24, 8.03, 15.1]];
  function roofHeight(z) {
    const i = Math.max(1, bends.findIndex(p => p[0] >= z));
    const [z0, y0] = bends[i - 1], [z1, y1] = bends[i];
    return THREE.MathUtils.lerp(y0, y1, THREE.MathUtils.clamp((z - z0) / (z1 - z0), 0, 1));
  }
  platform(m, back - facade, last - first, mid(facade, back), mid(first, last), floor, '#747674', .43);
  for (const x of [facade, back]) wall(m, [x, 0, first], [x, 0, last], -2.6, floor, concrete, 'concrete');
  wall(m, [facade, 0, first], [back, 0, first], -2.6, floor, concrete, 'concrete');
  wall(m, [facade, 0, last], [back, 0, last], -2.6, floor, concrete, 'concrete');
  for (let i = 1; i < bends.length; i++) {
    const [z0, h0, w0] = bends[i - 1], [z1, h1, w1] = bends[i];
    const x0 = -width + w0, x1 = -width + w1;
    m.sheet([x0, h0 + .71, z0], [w0, h0 + .71, z0], [w1, h1 + .71, z1], [x1, h1 + .71, z1], graphite);
    if (i !== 4) m.sheet([x0 + .14, h0 + .754, z0], [w0 - .15, h0 + .754, z0],
      [w1 - .15, h1 + .754, z1], [x1 + .14, h1 + .754, z1], snow);
    m.sheet([x0, h0, z0], [w0, h0, z0], [w1, h1, z1], [x1, h1, z1], soffit);
    for (const [l, r] of [[x0, x1], [w0, w1]]) {
      m.sheet([l, h0 - .02, z0], [r, h1 - .02, z1], [r, h1 + .72, z1],
        [l, h0 + .72, z0], '#b6a68e', 1, 'concrete');
      m.line([l, h0 + .72, z0], [r, h1 + .72, z1], .12, graphite);
      const joints = Math.ceil((z1 - z0) / .58);
      for (let j = 1; j < joints; j++) {
        const t = j / joints, x = THREE.MathUtils.lerp(l, r, t), z = THREE.MathUtils.lerp(z0, z1, t);
        const y = THREE.MathUtils.lerp(h0, h1, t);
        const edgeX = x + (x < 0 ? -.015 : .015);
        m.line([edgeX, y, z], [edgeX, y + .70, z], .021, '#948474');
      }
    }
  }
  for (const [z, y, w] of [bends[0], bends.at(-1)]) {
    m.block(width, .72, .112, '#ac9d87', w - width / 2, y + .36, z);
  }
  const skylight = p => roofHeight(p[2]) - .13;
  curtain(m, [facade, 0, first], [facade, 0, -17.5], floor, skylight, 3, { tint: warmGlass });
  curtain(m, [facade, 0, -13.7], [facade, 0, last], floor, skylight, 21, { tint: warmGlass });
  curtain(m, [facade, 0, -17.5], [facade, 0, -13.7], floor + 2.65, skylight, 2);
  curtain(m, [facade, 0, first], [back, 0, first], floor, skylight, 15, { tint: warmGlass });
  curtain(m, [facade, 0, last], [back, 0, last], floor, skylight, 15, { tint: glass });
  curtain(m, [back, 0, first], [back, 0, last], floor, skylight, 24, { tint: glass, opacity: .77 });
  // Visible timber mezzanine, tabletops, and the slanted atrium columns.
  m.block(20.8, .3, 29.6, oak, 2.35, 3.54, 7);
  for (const z of [-22.4, -12.7, -2.6, 8.1, 20.9]) {
    m.line([facade + 1.7, floor, z], [facade - 1.55, roofHeight(z), z], .21, mullion);
    if (z <= 8.1) m.line([back - .53, floor, z], [back + .71, roofHeight(z), z], .20, mullion);
  }
  const lights = [];
  for (const x of [-8.8, -3.7, 1.4, 6.65, 10.6]) {
    for (const z of [-16.5, -10.8, -5.1, .8, 6.7, 12.7, 18.6]) {
      m.block(2.28, .11, .81, timber, x, floor + .78, z);
      for (const q of [-.89, .89]) {
        m.block(.074, .76, .68, graphite, x + q, floor + .38, z);
        m.block(2.19, .11, .34, oak, x, floor + .46, z + q * .84);
      }
      if (z >= -5.1 && x > -8.8) m.block(2.21, .10, .86, timber, x, 4.39, z);
      lights.push([x + .57, roofHeight(z) - .10, z - .71]);
    }
    m.line([x, roofHeight(-20) - .28, -20], [x, roofHeight(19) - .30, 19], .145, timber);
  }
  ceilingLights(m, lights);
  platform(m, 2.15, 15.5, facade - 1.095, -14.55, floor, concrete);
  // Treads follow the plaza grade and share a continuous walk surface.
  const entryX = facade - 1.095, low = m.floor(entryX, -27.6);
  stairs(m, entryX, -27.6, -22.28, low, floor, 2.15);
  const rampStart = -2.5, lowEnd = m.floor(entryX, 5.3);
  stairs(m, entryX, 5.3, rampStart, lowEnd, floor, 2.15);
  platform(m, 2.15, 4.0, entryX, -4.5, floor, concrete);
  guard(m, [facade - 2.13, floor, -22.3], [facade - 2.13, floor, -2.5]);
  for (const z of [-31.8, -2.5, 7.4]) {
    const x = facade - 4.3, y = m.floor(x, z);
    m.block(.48, .11, 2.65, timber, x, y + .52, z);
    for (const dz of [-.9, .9]) m.block(.40, .49, .18, graphite, x, y + .24, z + dz);
    m.barrier([x, y, z - 1.32], [x, y, z + 1.32], y + .57, y, .23);
  }
  lettering(m, 'HANAZONO EDGE', [facade - .035, 4.01, -15.44], 10.65, 1.55, -Math.PI / 2,
    { subtitle: 'レストラン・カフェ・バー' });
  lettering(m, 'EDGE', [-1.35, 5.54, first - .026], 9.5, 1.79, Math.PI, { subtitle: 'RESTAURANT & BAR' });
  m.finish();
}

function center(scene, ground, env, floors, setup) {
  const m = setup(scene, 'Hanazono 308 · ski and booking center', ground, env, floors);
  const outline = hanazonoCenterFootprint;
  const base = ground.heightAt(2695, -4675);
  const eave = base + 6.4;
  const ridge = [2707, base + 8.3, -4675.5];
  const point = ([x, z], y) => [x, y, z];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const pa = point(a, eave), pb = point(b, eave);
    const low = Math.min(ground.heightAt(...a), ground.heightAt(...b)) - .7;
    m.sheet(pa, pb, ridge, ridge, snow);
    m.line(atY(pa, eave - .06), atY(pb, eave - .06), .245, darkZinc);
    wall(m, pa, pb, low, eave - 4.94, '#475050', 'concrete');
    if (i === 1 || i === 2 || i === 3 || i === 0) {
      curtain(m, pa, pb, eave - 4.96, () => eave - 1.46, Math.ceil(length / 1.62), { tint: glass, opacity: .80 });
    } else {
      wall(m, pa, pb, eave - 4.96, eave - 1.44, graphite);
      for (let j = 1; j < length; j += .56) {
        const pos = interpolate(pa, pb, j / length);
        m.line(atY(pos, eave - 4.96), atY(pos, eave - 1.44), .052, darkZinc);
      }
    }
    wall(m, pa, pb, eave - 1.45, eave, '#294555');
  }
  lettering(m, 'HANAZONO 308', [2698, eave - .67, -4659.16], 11.6, 1.30, .049,
    { subtitle: '花園スキーセンター' });
  lettering(m, 'NISEKO SPORTS', [2731.31, eave - .66, -4658.82], 9.4, .94, .815);
  const walkY = ground.heightAt(2720, -4649);
  platform(m, 16.8, 5.5, 2720, -4648.2, walkY + .17, '#909491', .25);
  for (const x of [2705.6, 2734.2]) {
    const z = -4643, y = ground.heightAt(x, z);
    m.block(.16, 3.55, .16, graphite, x, y + 1.77, z);
    m.block(.39, .13, .26, silver, x, y + 3.51, z - .09);
    m.barrier([x, 0, z - .13], [x, 0, z + .13], y + 3.58, y, .11);
  }
  m.finish();
}

function hanazonoPlaza(scene, ground, env, floors, setup) {
  const m = setup(scene, 'Hanazono · lift plaza wayfinding', ground, env, floors);
  // The common snow apron runs between the two lower stations.
  const labels = [
    [2649.7, -4517.9, -.49, 'SYMPHONY', 'シンフォニーゴンドラ', '#165777'],
    [2659.8, -4508.8, -.49, 'HANAZONO 1', '花園 第１リフト', '#165777'],
    [2709.8, -4549.8, -.89, '308', 'スキーセンター  ·  SKI CENTER', '#a35836'],
  ];
  for (const [x, z, yaw, title, subtitle, color] of labels) {
    const y = ground.heightAt(x, z), s = Math.sin(yaw), c = Math.cos(yaw);
    const a = [x - 1.39 * c, y, z + 1.39 * s], b = [x + 1.39 * c, y, z - 1.39 * s];
    for (const p of [a, b]) m.line(p, atY(p, y + 2.25), .075, mullion);
    m.line(atY(a, y + 1.94), atY(b, y + 1.94), .52, color, .079);
    lettering(m, title, [x + s * .047, y + 1.95, z + c * .047], 2.68, .45, yaw, { subtitle, bg: color });
    lettering(m, title, [x - s * .047, y + 1.95, z - c * .047], 2.68, .45, yaw + Math.PI, { subtitle, bg: color });
    m.barrier(a, b, y + 2.25, y, .06);
  }
  for (const [x, z] of [[2696.5, -4485.7], [2708.0, -4490.1], [2721.8, -4513.7], [2737.5, -4560.1]]) {
    const y = ground.heightAt(x, z);
    m.block(.145, 3.24, .17, graphite, x, y + 1.61, z);
    m.block(.43, .15, .29, graphite, x - .13, y + 3.23, z);
    m.block(.29, .025, .19, '#e0ddcd', x - .16, y + 3.144, z);
    env.addCircle(x, z, .11, 'building', { minY: y, maxY: y + 3.3 });
  }
  m.finish();
}

export function buildNisekoLandmarks(scene, config, ground, env, floors, setup) {
  aceBase(scene, config, ground, env, floors, setup);
  nest(scene, config, ground, env, floors, setup);
  edge(scene, ground, env, floors, setup);
  center(scene, ground, env, floors, setup);
  hanazonoPlaza(scene, ground, env, floors, setup);
  const chairId = 'hanazono1-hanazono-hooded-lift-1';
  pomaCover(scene, config, ground, env, floors, setup, chairId, 'Hanazono #1 · POMA valley station');
  pomaCover(scene, config, ground, env, floors, setup, chairId, 'Hanazono #1 · POMA summit station', true);
  pomaCover(scene, config, ground, env, floors, setup, 'hanazono-hanazono-symphony-gondola', 'Hanazono Symphony · POMA valley station');
}
