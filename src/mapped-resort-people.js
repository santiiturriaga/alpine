import * as THREE from 'three';
import { guestVisibility } from './guest-visibility.js';
import { climateUniforms } from './climate-state.js';
import { pointInPolygon, runStyle } from './mapped-resort-ground.js';
import { part, box, mergeParts } from './scenery.js';
import { skiProfile } from './skier-equipment.js';
import { clamp, lerp, makeRadialTexture, mulberry32, smoothstep } from './util.js';

const TAU = Math.PI * 2;
const skiGrades = new Set(['green', 'blue', 'black']);
const jacketColors = {
  green: [0x417a48, 0x76a150, 0x299680, 0x667a47],
  blue: [0x3376a8, 0x3c8eb4, 0x485da1, 0x276e83],
  black: [0x343e47, 0x29312f, 0x3d3543, 0x242c36],
  village: [0xaf533d, 0xbe8e42, 0x54766f, 0xa86780],
};
const pantsColors = [0x293238, 0x3d464e, 0x434459, 0x767061, 0x50605a, 0x382e30];
const helmetColors = [0xd8d8c9, 0x282f37, 0xbb7060, 0xa5b4b6, 0xe2ba6b];
const gearColors = [0x416071, 0xb16b46, 0x9a985f, 0x586484];
const sides = [-1, 1];
const lineWidths = [1, .55, .2, 0];
const pick = (values, random) => values[Math.floor(random() * values.length)];
const gap = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const heading = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const turn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const mix = (a, b, t) => ({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) });
const from = ([x, z]) => ({ x, z });
const shifted = (p, yaw, lateral, forward = 0) => ({
  x: p.x + Math.cos(yaw) * lateral + Math.sin(yaw) * forward,
  z: p.z - Math.sin(yaw) * lateral + Math.cos(yaw) * forward,
});

function makePath(points) {
  const nodes = [];
  let length = 0;
  for (const p of points) {
    const step = nodes.length ? gap(nodes.at(-1), p) : 0;
    if (nodes.length && step < .025) continue;
    length += step;
    nodes.push({ x: p.x, z: p.z, distance: length });
  }
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i], a = nodes[i - 1] ?? p, b = nodes[i + 1] ?? p;
    const into = a === p ? heading(p, b) : heading(a, p);
    const out = b === p ? into : heading(p, b);
    p.heading = into + turn(into, out) * .5;
  }
  return { nodes, length };
}

function sample(path, distance, out) {
  const { nodes, length } = path;
  if (nodes.length === 1) return Object.assign(out, nodes[0]);
  const d = clamp(distance, 0, length);
  let lo = 0, hi = nodes.length - 1;
  while (hi - lo > 1) {
    const i = (lo + hi) >> 1;
    if (nodes[i].distance <= d) lo = i;
    else hi = i;
  }
  const a = nodes[lo], b = nodes[hi], t = (d - a.distance) / (b.distance - a.distance);
  out.x = lerp(a.x, b.x, t);
  out.z = lerp(a.z, b.z, t);
  out.heading = a.heading + turn(a.heading, b.heading) * t;
  return out;
}

function navigation(world) {
  const { ground, env } = world;
  const height = p => ground.heightAt(p.x, p.z);
  const clear = (p, pad = .68) => {
    const y = height(p);
    return env.isOpen(p.x, y + .43, p.z, pad) && env.isOpen(p.x, y + 1.13, p.z, pad);
  };
  const check = (a, b, maxSlope = .52, pad = .72) => {
    const distance = gap(a, b), count = Math.max(1, Math.ceil(distance / 1.15));
    let last = height(a);
    for (let i = 0; i <= count; i++) {
      const p = mix(a, b, i / count), y = height(p);
      if (!clear(p, pad) || Math.abs(y - last) > .13 + maxSlope * distance / count) return false;
      last = y;
    }
    return true;
  };
  const connect = (a, b, maxSlope = .52, pad = .72) => {
    if (!clear(a, pad) || !clear(b, pad)) return null;
    if (check(a, b, maxSlope, pad)) return [a, b];
    const yaw = heading(a, b);
    for (const distance of [2.7, 5, 9, 15, 24]) for (const side of sides) {
      for (const middle of [.34, .64]) {
        const p = shifted(mix(a, b, middle), yaw, distance * side);
        if (check(a, p, maxSlope, pad) && check(p, b, maxSlope, pad)) return [a, p, b];
      }
      const p = shifted(mix(a, b, .22), yaw, distance * side);
      const q = shifted(mix(a, b, .78), yaw, distance * side);
      if (check(a, p, maxSlope, pad) && check(p, q, maxSlope, pad) && check(q, b, maxSlope, pad)) {
        return [a, p, q, b];
      }
    }
    return null;
  };
  return { height, clear, check, connect };
}

function routeSamples(run, nav) {
  const points = run.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  if (nav.height(points[0]) < nav.height(points.at(-1))) points.reverse();
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const nodes = curve.getSpacedPoints(Math.max(3, Math.ceil(length / 5))).map(p => ({ x: p.x, z: p.z }));
  return { run, nodes, top: nodes[0], bottom: nodes.at(-1), length };
}

function skiSection(source, start, finish, nav) {
  const width = runStyle(source.run).width;
  const points = [];
  for (let i = start; i <= finish; i++) {
    const { nodes } = source, p = nodes[i];
    const yaw = heading(nodes[Math.max(0, i - 1)], nodes[Math.min(nodes.length - 1, i + 1)]);
    const valid = [0, .14, -.14, .27, -.27, .40, -.40].some(fraction => {
      const next = shifted(p, yaw, fraction * width);
      if (!nav.clear(next, 1.03) || (points.length && !nav.check(points.at(-1), next, 1.13, .86))) return false;
      points.push(next);
      return true;
    });
    if (!valid) return null;
  }
  return points;
}

function stationFor(lift, sources, nav, preferredRun) {
  const { bottom, top } = lift.profile;
  const gauge = lift.surface ? 0 : lift.gauge;
  const load = bottom.world(gauge, 0), landing = top.world(gauge, 0);
  const wait = [14, 17.5, 21, 25].flatMap(distance => sides.map(side =>
    bottom.world(lift.surface ? side * 2.5 : gauge + side * .58, -distance)));
  const berths = wait.filter(p => nav.clear(p, .62) && gap(p, lift.boardPose) > 3.5);
  const approach = [1, 2.4, 4.4].flatMap(distance => [0, .45, -.45].map(offset => bottom.world(gauge + offset, -distance)))
    .find(p => nav.clear(p, .52) && nav.check(p, load, .86, .33));
  const exit = [0, 1.1, 2.3, 3.4, -1.4].flatMap(distance => [0, .6, -.6, 1.2, -1.2].map(offset => top.world(gauge + offset, distance)))
    .find(p => nav.clear(p, .65) && (gap(p, landing) < .16 || nav.check(landing, p, .9, .3)));
  if (!exit || !approach || berths.length < 2) return null;
  const queues = berths.map(berth => ({ berth, path: nav.connect(berth, approach, .63, .45) }))
    .filter(({ path }) => path);
  if (queues.length < 2) return null;
  const station = {
    lift, load, approach, exit, queue: [],
    queues: queues.map(q => ({ ...q, path: makePath(q.path) })),
  };
  const topRange = lift.surface ? 22 : 105;
  const baseRange = lift.surface ? 37 : 132;
  const options = sources.filter(source => {
    if (source.run.connector && !lift.surface) return false;
    if (lift.surface && source.run.difficulty !== 'green') return false;
    return gap(source.top, exit) < topRange && gap(source.bottom, berths[0]) < baseRange;
  }).map(source => ({
    source,
    score: gap(source.top, exit) + gap(source.bottom, berths[0]) - (source.run.id === preferredRun ? 175 : 0),
  })).sort((a, b) => a.score - b.score);
  const circuits = [];
  for (const { source } of options.slice(0, 7)) {
    const nodes = source.nodes;
    const maxTrim = Math.min(14, Math.floor(nodes.length * .18));
    let starts = 0, ends = 0;
    for (; starts <= maxTrim; starts++) {
      if (nav.clear(nodes[starts], 1.06) && gap(nodes[starts], exit) < topRange + 8) break;
    }
    for (; ends <= maxTrim; ends++) {
      if (nav.clear(nodes[nodes.length - 1 - ends], 1.06)) break;
    }
    if (starts > maxTrim || ends > maxTrim) continue;
    const piste = skiSection(source, starts, nodes.length - 1 - ends, nav);
    if (!piste || nav.height(piste[0]) - nav.height(piste.at(-1)) < 2.5) continue;
    if (nav.height(piste[0]) > nav.height(exit) + 8) continue;
    const outbound = nav.connect(exit, piste[0], .74), inbound = nav.connect(piste.at(-1), queues.at(-1).berth, .59);
    if (!outbound || !inbound || nav.height(piste.at(-1)) + 9 < nav.height(queues.at(-1).berth)) continue;
    const path = makePath([...outbound, ...piste, ...inbound]);
    circuits.push({ station, path, run: source.run, grade: source.run.difficulty, width: runStyle(source.run).width });
    if (circuits.length === 2) break;
  }
  station.circuits = circuits;
  return circuits.length ? station : null;
}

function villageSpots(config, station, nav, stations) {
  const clusters = [];
  const occupied = point => clusters.some(cluster => gap(cluster.center, point) < 9);
  const poses = [station.lift.boardPose, ...stations.map(item => item.lift.boardPose)];
  const add = (center, kind, count, yaw) => {
    if (occupied(center) || poses.some(p => gap(p, center) < 6.5)) return;
    const ring = Array.from({ length: count }, (_, i) => shifted(center, yaw + i * TAU / count, 0, count < 3 ? .82 : 1.18));
    if (!ring.every(point => nav.clear(point, .85) && Math.abs(nav.height(center) - nav.height(point)) < .43)) return;
    clusters.push({ center, ring, kind });
  };
  const mainHeading = station.lift.profile.bottom.heading;
  for (const [lateral, forward] of [[-7.6, 12], [7.6, 12], [-8.4, 18], [8.4, 18]]) {
    const count = clusters.length;
    add(shifted(station.lift.boardPose, mainHeading, lateral, forward), 'plaza', 2, mainHeading + .28);
    if (clusters.length > count) break;
  }
  for (const [lateral, forward, n] of [[-11, -9, 3], [11, -2, 2], [15, -13, 3], [-12, -20, 2]]) {
    add(shifted(station.lift.boardPose, mainHeading, lateral, forward), 'plaza', n, mainHeading + .28);
  }
  for (const building of config.buildings ?? []) {
    if (building.points?.length < 3 || !/lodge|ski school/i.test(building.name ?? '')) continue;
    const points = building.points.map(from);
    const center = points.reduce((a, b) => ({ x: a.x + b.x / points.length, z: a.z + b.z / points.length }), { x: 0, z: 0 });
    if (gap(center, station.load) > 320) continue;
    const edges = points.map((a, i) => ({ a, b: points[(i + 1) % points.length] }))
      .filter(({ a, b }) => gap(a, b) > 5).sort((a, b) => gap(b.a, b.b) - gap(a.a, a.b));
    const before = clusters.length;
    for (const { a, b } of edges.slice(0, 7)) {
      const mid = mix(a, b, .5), yaw = heading(a, b);
      for (const side of sides) {
        const p = shifted(mid, yaw, side * 4.65);
        if (pointInPolygon(p.x, p.z, building.points)) continue;
        add(p, building.name, 3, yaw);
      }
      if (clusters.length >= before + 2) break;
    }
  }
  return clusters;
}

function makeBoard() {
  const profile = Array.from({ length: 15 }, (_, i) => {
    const z = (i / 14 - .5) * 1.55;
    const taper = Math.sqrt(1 - clamp((Math.abs(z) - .57) / .206, 0, 1) ** 2);
    return [z, (.12 + .026 * Math.abs(z) / .775) * Math.max(.12, taper), .079 * (Math.max(0, Math.abs(z) - .51) / .27) ** 2];
  });
  return deckGeometry(profile);
}

function deckGeometry(profile) {
  const position = [], indices = [];
  for (const [z, half, y] of profile) position.push(-half, y, z, half, y, z, -half, y - .023, z, half, y - .023, z);
  for (let i = 0; i + 1 < profile.length; i++) {
    const p = i * 4;
    indices.push(p,p+4,p+1,p+1,p+4,p+5, p+2,p+3,p+6,p+3,p+7,p+6,
      p,p+2,p+4,p+2,p+6,p+4, p+1,p+5,p+3,p+3,p+5,p+7);
  }
  const last = position.length / 3 - 4;
  indices.push(0,1,2,1,3,2, last,last+2,last+1,last+1,last+2,last+3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildTrafficModel(parent, maximum) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .8 });
  const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .83 });
  const shell = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .11, roughness: .44 });
  const contact = new THREE.MeshBasicMaterial({ map: makeRadialTexture(64, [[0, 'rgba(26,40,56,.47)'],
    [.38, 'rgba(26,40,56,.28)'], [1, 'rgba(26,40,56,0)']]), transparent: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const ball = new THREE.SphereGeometry(1, 9, 6);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 7);
  const coat = new THREE.CapsuleGeometry(1, 1, 3, 10);
  const pack = new THREE.CapsuleGeometry(1, .9, 3, 9);
  const boot = mergeParts([
    part(ball, 0xb1b8b8, [0, .04, -.12], [0, 0, 0], [.48, .62, .42]),
    part(ball, 0x9b9f9f, [0, -.25, .1], [0, 0, 0], [.53, .36, .64]),
    box(1, .13, 1.12, 0x4e5558, [0, -.54, .04]),
    box(.95, .071, .43, 0xbbc4c2, [0, -.04, .24], [-.14, 0, 0]),
  ]);
  const head = mergeParts([
    part(ball, 0xcfad91, [0, -.15, .28], [0, 0, 0], [.74, .74, .71]),
    part(ball, 0xffffff, [0, .29, -.02], [0, 0, 0], [1, .93, .97]),
    part(ball, 0x456478, [0, .14, .82], [0, 0, 0], [.86, .43, .33]),
  ]);
  const jacket = mergeParts([
    part(coat, 0xffffff),
    part(ball, 0x959d9d, [0, 1.045, -.48], [-.22, 0, 0], [.63, .33, .66]),
    box(.043, 1.72, .043, 0x514d50, [0, -.08, .989]),
    box(.45, .30, .06, 0xbdbfb6, [.38, .34, .86], [.11, -.21, 0]),
  ]);
  const ski = deckGeometry(skiProfile);
  const board = makeBoard();
  const definitions = {
    jacket: [jacket, 1, cloth], head: [head, 1, shell], legs: [cylinder, 4, material],
    arms: [cylinder, 4, material], gloves: [ball, 2, material], boots: [boot, 2, cloth],
    pack: [pack, 1, material], skis: [ski, 2, material], board: [board, 1, material],
    poles: [cylinder, 2, material], cup: [new THREE.CylinderGeometry(.044, .030, .077, 7), 1, material],
    contact: [new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), 1, contact],
  };
  const batches = {};
  for (const [name, [geometry, count, mat]] of Object.entries(definitions)) {
    const mesh = new THREE.InstancedMesh(geometry, mat, maximum * count);
    mesh.name = `Mapped resort guests · ${name}`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.receiveShadow = name !== 'contact';
    parent.add(mesh);
    batches[name] = mesh;
  }
  const root = new THREE.Matrix4(), local = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion(), rot = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color(), euler = new THREE.Euler();
  const origin = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
  const write = (name, tint) => {
    const mesh = batches[name];
    mesh.setMatrixAt(mesh.count, matrix.multiplyMatrices(root, local.compose(pos, q, scale)));
    mesh.setColorAt(mesh.count++, color.setHex(tint));
  };
  const shape = (name, p, size, pitch, yaw, roll, tint) => {
    pos.set(...p); scale.set(...size);
    q.setFromEuler(euler.set(pitch, yaw, roll, 'YXZ'));
    write(name, tint);
  };
  const limb = (name, start, end, radius, taper, tint) => {
    a.set(...start); b.set(...end);
    pos.copy(a).lerp(b, .5);
    scale.set(radius, a.distanceTo(b) + radius * .55, radius * taper);
    q.setFromUnitVectors(yAxis, b.sub(a).normalize());
    write(name, tint);
  };
  function draw(p, clock, ground, detail) {
    const seated = p.seated ?? 0, movement = Math.min(1, p.speed * .095);
    const foot = p.foot || (climateUniforms.snowpack.value < .35 && p.y < climateUniforms.snowline.value);
    const snowboard = p.board && !foot;
    const step = foot ? Math.sin(p.stride * 5.1) * Math.min(1, p.speed * .55) : 0;
    const sway = Math.sin(clock * 1.13 + p.phase) * .016;
    const prone = p.recovery ? Math.sin(Math.PI * p.recovery / 2.48) : 0;
    const lean = p.lean * movement * (snowboard ? .26 : .20), yaw = p.heading;
    up.set(0, 1, 0);
    if ((!foot || detail) && !seated) {
      const dx = Math.sin(yaw) * .67, dz = Math.cos(yaw) * .67;
      const groundPitch = (ground.heightAt(p.x + dx, p.z + dz) - ground.heightAt(p.x - dx, p.z - dz)) / 1.34;
      const groundRoll = (ground.heightAt(p.x + dz * .38, p.z - dx * .38) - ground.heightAt(p.x - dz * .38, p.z + dx * .38)) / .5092;
      up.set(-Math.sin(yaw) * groundPitch - Math.cos(yaw) * groundRoll, 1,
        -Math.cos(yaw) * groundPitch + Math.sin(yaw) * groundRoll).normalize();
    }
    forward.set(Math.sin(yaw), 0, Math.cos(yaw)).addScaledVector(up, -up.dot(forward)).normalize();
    right.crossVectors(up, forward).normalize();
    rot.setFromRotationMatrix(local.makeBasis(right, up, forward));
    if (detail && !seated) {
      root.compose(origin.set(p.x, p.y + .032, p.z), rot, scale.setScalar(1));
      shape('contact', [0, 0, .02], [foot ? .83 : .96, 1, foot ? .79 : 1.90], 0, 0, 0, 0xffffff);
    }
    if (foot) rot.setFromAxisAngle(yAxis, yaw);
    rot.multiply(q.setFromEuler(euler.set(0, 0, (p.id % 2 ? -1 : 1) * prone * 1.14)));
    root.compose(origin.set(p.x, p.y + .022 - prone * .21, p.z), rot, scale.setScalar(p.height));
    const stance = snowboard ? .84 * p.boardSide * (1 - seated * .74) : 0;
    const hip = lerp(.88 - movement * .125 - (snowboard ? .07 : 0), .393, seated);
    const rise = hip + .27 + Math.abs(step) * .012;
    const pitch = lerp(.11 + movement * .26, -.035, seated);
    shape('jacket', [-lean * .29, rise, -.055 - seated * .07], [.199, .203, .139], pitch, stance, -lean + sway, p.jacket);
    shape('head', [-lean * .45, rise + .328, .017 - seated * .088], [.115, .117, .117], -pitch * .37,
      stance * (movement ? .30 : .57) + sway, lean * .31, p.helmet);
    if (detail && p.pack && !seated) shape('pack', [-lean * .24 - Math.sin(stance) * .14, rise - .035, -.179], [.121, .116, .080], pitch, stance, -lean, 0x3c4744);
    const sip = p.social && p.cup ? Math.max(0, Math.sin(clock * .66 + p.phase)) ** 8 : 0;
    for (const s of sides) {
      const dx = snowboard ? .019 : (foot ? .139 : .182);
      const footPos = [s * dx, lerp(.125 + Math.max(0, s * step) * .105, .051, seated),
        (snowboard ? s * .237 : s * step * .214) + seated * .36];
      const knee = [s * (snowboard ? .13 : .158) - lean * .47, lerp(.472 - movement * .049, .374, seated),
        (snowboard ? s * .212 : .105 + s * step * .13) + seated * .219];
      const pelvis = [s * (snowboard ? .082 : .115) - lean * .26, hip, (snowboard ? s * .085 : 0) - .033 - seated * .027];
      limb('legs', pelvis, knee, .086, .99, p.pants);
      limb('legs', knee, footPos, .064, 1.02, p.pants);
      shape('boots', footPos, [.151, .188, .24], 0, snowboard ? stance + s * .12 : .028 * s, 0, 0x45515b);
      const arm = [s * .186 - lean * .38, rise + .141, s * -stance * .17 - seated * .078];
      const elbow = [s * (.25 + movement * .023) - lean * .19, rise - .126, -.005 + seated * .013 + s * step * .081];
      const gesture = p.social ? .034 + .061 * Math.sin(clock * 2.1 + p.phase + s) : 0;
      const hand = [s * (.27 + gesture - (s > 0 ? sip * .12 : 0)) - lean * .12,
        rise - .215 + seated * .142 + gesture + (s > 0 ? sip * .45 : 0),
        .135 + movement * .089 + seated * .142 + gesture * .36 - s * step * .16];
      limb('arms', arm, elbow, .067, .97, p.jacket);
      limb('arms', elbow, hand, .055, 1, p.jacket);
      if (detail) shape('gloves', hand, [.045, .050, .043], 0, 0, 0, 0x293138);
      if (!foot && !snowboard) {
        const wedge = p.grade === 'green' ? movement * .18 : .023;
        shape('skis', [s * dx, .006 - seated * .04, seated * .61], [1, 1, 1], -seated * .047, -s * wedge, lean * .55, p.gear);
        if (detail) limb('poles', hand, [s * .36, .048, hand[2] - .45 - movement * .4], .006, 1, 0x819196);
      }
      if (detail && s > 0 && p.cup) shape('cup', [hand[0] - .015, hand[1] + .045, hand[2] + .029], [1, 1, 1], -.13 * sip, 0, 0, 0xf5ddbe);
    }
    if (snowboard) shape('board', [0, .015 - seated * .036, seated * .51], [1, 1, 1], 0, seated * .31, lean * .52, p.gear);
    if (foot && p.carries) {
      shape(p.board ? 'board' : 'skis', [.292, hip + .22, -.013],
        [1, 1, .94], -1.46, 0, -.18, p.gear);
      if (!p.board) shape('skis', [.358, hip + .21, -.057], [1, 1, .94], -1.53, 0, -.18, p.gear);
    }
  }
  return {
    begin() { for (const mesh of Object.values(batches)) mesh.count = 0; },
    draw,
    end() {
      for (const mesh of Object.values(batches)) {
        if (!mesh.count) continue;
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}

export function buildMappedResortPeople(scene, { config, world, liftSystem }) {
  const view = guestVisibility();
  const { ground } = world;
  const group = new THREE.Group();
  group.name = `${config.name} · Skiers and snowboarders`;
  scene.add(group);
  const nav = navigation(world), random = mulberry32(20261117);
  const sources = (config.runs ?? []).filter(run => skiGrades.has(run.difficulty) &&
    run.points?.length >= 2 && (!run.connector || run.difficulty === 'green') &&
    !/upload|download|tow line|chairlift line/i.test(run.name ?? ''))
    .map(run => routeSamples(run, nav)).filter(source => source.length > 18);
  const stations = liftSystem.lifts.filter(lift => lift.def.rideable && !lift.gondola &&
    (lift.surface || lift.fleet?.guestSeats)).map(lift => stationFor(lift, sources, nav,
    lift.def.id === config.startLift ? config.startRun : lift.def.id === config.beginnerLift ? config.beginnerRun : null))
    .filter(Boolean);
  const primary = stations.find(station => station.lift.def.id === config.startLift) ?? stations[0];
  const clusters = primary ? villageSpots(config, primary, nav, stations) : [];
  const people = [];
  const stats = { boarded: 0, unloaded: 0, laps: 0, collisions: 0, recovered: 0, lodgeBreaks: 0, visible: 0 };
  const groundPoint = {}, aim = {}, ahead = {};
  const carrier = new THREE.Vector3(), tangent = new THREE.Vector3();
  let clock = 0;

  function place(p, position, yaw = p.heading) {
    p.x = position.x;
    p.z = position.z;
    p.y = nav.height(position);
    p.heading = yaw;
  }

  function person(grade, props) {
    const p = {
      id: people.length, trafficSeed: (Math.imul(people.length + 1, 0x9e3779b1) >>> 0) / 4294967296,
      grade, speed: 0, stride: 0, lean: 0, bypass: 0, height: .91 + .17 * random(),
      board: random() < (grade === 'green' ? .18 : .35), boardSide: random() < .68 ? -1 : 1,
      jacket: pick(jacketColors[grade], random), pants: pick(pantsColors, random),
      helmet: pick(helmetColors, random), gear: pick(gearColors, random),
      phase: random() * TAU, heading: 0, pack: random() < .42, pace: .83 + random() * .31,
      recovery: 0, immunity: 0, seat: -1, seated: 0, ...props,
    };
    people.push(p);
    return p;
  }

  function segment(p, state, path, distance = 0) {
    p.state = state;
    p.path = path;
    p.distance = distance;
    p.foot = state === 'village walk' || state === 'lodge break';
    sample(path, distance, groundPoint);
    place(p, groundPoint, p.heading ?? groundPoint.heading);
  }

  function toQueue(p, initialize = false) {
    for (const q of p.station.queues) {
      if (q.guest) continue;
      const path = initialize ? [q.berth] : nav.connect(p, q.berth, .66, .54);
      if (!path) continue;
      q.guest = p;
      p.berth = q;
      p.station.queue.push(p);
      segment(p, initialize ? 'queue' : 'join queue', makePath(path));
      if (initialize) place(p, q.berth, p.station.lift.profile.bottom.heading);
      return true;
    }
    return false;
  }

  const carrierPhase = (lift, slot, when) => THREE.MathUtils.euclideanModulo(
    when + lift.fleet.shift + slot * lift.fleet.step - lift.departure, lift.fleet.duration);

  function claimChair(p, slot, when) {
    p.seat = slot;
    p.surfaceStart = when;
    if (slot >= 0) p.station.lift.fleet.guestSeats[slot] = 1;
  }

  function releaseChair(p) {
    if (p.seat >= 0) p.station.lift.fleet.guestSeats[p.seat] = 0;
    p.seat = -1;
  }

  function rideTime(p, when = clock) {
    return p.seat < 0 ? when - p.surfaceStart : carrierPhase(p.station.lift, p.seat, when);
  }

  function chairPose(p, when, phase, out) {
    const { lift } = p.station;
    const elapsed = clamp(phase, 0, lift.duration - .004);
    if (lift.surface) {
      lift.at(lift.timing.fractionAt(elapsed), carrier, tangent, 0);
    } else {
      liftSystem.sampleCarrier(lift, p.seat, when + elapsed - phase, carrier, tangent);
    }
    out.heading = Math.atan2(tangent.x, tangent.z);
    const side = lift.surface ? 0 : (lift.seats - 1) * .26 * (p.id % 2 ? -1 : 1);
    out.x = carrier.x + Math.cos(out.heading) * side;
    out.z = carrier.z - Math.sin(out.heading) * side;
    out.y = lift.surface ? nav.height(out) : carrier.y - 2.54;
    return out;
  }

  function seedRide(p, fraction) {
    const { lift } = p.station, start = lift.duration * fraction;
    if (lift.surface) claimChair(p, -1, -start);
    else {
      const fleet = lift.fleet;
      const slot = THREE.MathUtils.euclideanModulo(Math.round((lift.departure + start - fleet.shift) / fleet.step), fleet.n);
      if (fleet.guestSeats[slot] || carrierPhase(lift, slot, 0) > lift.duration - .4) return false;
      claimChair(p, slot, 0);
    }
    p.state = 'riding';
    p.seated = lift.surface ? 0 : 1;
    p.lastRideTime = rideTime(p, 0);
    chairPose(p, 0, p.lastRideTime, p);
    return true;
  }

  function startSki(p, distance = 0) {
    p.seated = 0;
    p.foot = false;
    p.bypass = 0;
    segment(p, 'skiing', p.circuit.path, distance);
    p.heading = groundPoint.heading;
  }

  for (const station of stations) {
    const central = station === primary;
    const circuit = station.circuits[0];
    const count = central ? 12 : station.lift.surface ? 6 : 8;
    const berths = Math.min(central ? 4 : 2, station.queues.length);
    const start = ground.startPose?.();
    let startDistance = 30;
    if (central && start) {
      const nearest = circuit.path.nodes.reduce((a, b) => gap(a, start) < gap(b, start) ? a : b);
      startDistance = nearest.distance + 12;
    }
    for (let i = 0; i < count; i++) {
      const route = i < berths + 2 ? circuit : station.circuits[i % station.circuits.length];
      const p = person(route.grade, { station, circuit: route, lane: (i % 2 ? -1 : 1) * (.84 + random() * 1.20) });
      if (i < berths && toQueue(p, true)) continue;
      if (i < berths + 2) {
        startSki(p, Math.min(startDistance + (i - berths) * 24, route.path.length * .62));
      } else {
        const earlyRide = central ? .04 : .36;
        if (i < berths + 4 && seedRide(p, i === berths + 2 ? earlyRide : .86)) continue;
        startSki(p, route.path.length * (.38 + .43 * random()));
      }
    }
  }

  for (const cluster of clusters) {
    for (const point of cluster.ring) {
      const p = person('village', { state: 'social', foot: true, social: true, cup: random() < .48,
        carries: random() < .31, venue: cluster.kind });
      place(p, point, heading(point, cluster.center));
    }
    if (cluster.kind !== 'plaza' && primary && gap(cluster.center, primary.load) < 185) {
      const berth = primary.queues.at(-1).berth;
      const rest = shifted(cluster.center, heading(cluster.center, berth), 1.98, 2.75);
      const entry = nav.connect(berth, rest, .53);
      if (entry) {
        primary.rests ??= [];
        primary.rests.push({ entry, rest, venue: cluster.kind,
          path: makePath(entry), facing: heading(rest, cluster.center) });
      }
    }
  }

  // An arriving pair walks between open lodge fronts. All sampling uses the
  // visible ground and the same solid edges used for the player.
  const lodging = clusters.filter(cluster => cluster.kind !== 'plaza');
  for (let i = 1; i < lodging.length && i < 5; i += 2) {
    const a = lodging[i - 1], b = lodging[i];
    const yaw = heading(a.center, b.center);
    let path;
    for (const side of sides) {
      const aa = shifted(a.center, yaw, 3.1 * side), bb = shifted(b.center, yaw, 3.1 * side);
      const link = nav.connect(aa, bb, .46);
      if (link) { path = makePath(link); break; }
    }
    if (!path || path.length < 8) continue;
    for (let j = 0; j < 2; j++) {
      const p = person('village', { carries: true, venue: b.kind, villagePath: path, villageDirection: 1 });
      segment(p, 'village walk', path, j * Math.min(2.2, path.length * .16));
      p.heading = groundPoint.heading;
    }
  }

  const model = buildTrafficModel(group, Math.max(1, Math.min(people.length, 72)));
  const circuitTraffic = new Map();
  for (const p of people) if (p.circuit) {
    if (!circuitTraffic.has(p.circuit)) circuitTraffic.set(p.circuit, []);
    circuitTraffic.get(p.circuit).push(p);
  }

  function nextChair(p) {
    const { lift } = p.station;
    if (lift.surface) return { slot: -1, wait: 1.18 };
    const fleet = lift.fleet;
    let choice = null;
    for (let slot = 0; slot < fleet.n; slot++) {
      if (fleet.guestSeats[slot] || (liftSystem.active?.lift.fleet === fleet && liftSystem.active.slot === slot)) continue;
      const phase = carrierPhase(lift, slot, clock);
      const wait = phase < .55 ? 0 : fleet.duration - phase;
      if (wait < .63 || wait > 18 || wait >= (choice?.wait ?? Infinity)) continue;
      choice = { slot, wait };
    }
    return choice;
  }

  function beginUnload(p, elapsed) {
    chairPose(p, clock, elapsed, p.unloadStart = {});
    p.state = 'unloading';
    p.unloadClock = clock;
    releaseChair(p);
    stats.unloaded++;
  }

  function advanceRide(p) {
    const { lift, approach, exit } = p.station;
    if (p.state === 'unloading') {
      const t = smoothstep(0, 1.16, clock - p.unloadClock);
      if (t >= 1) {
        startSki(p);
        p.speed = lift.surface ? 1.15 : 2;
      } else {
        p.x = lerp(p.unloadStart.x, exit.x, t);
        p.z = lerp(p.unloadStart.z, exit.z, t);
        p.y = lerp(p.unloadStart.y, nav.height(p), t);
        p.seated = lift.surface ? 0 : 1 - t;
        const target = p.circuit.path.nodes[0].heading;
        p.heading = p.unloadStart.heading + turn(p.unloadStart.heading, target) * t;
      }
      return;
    }
    const elapsed = rideTime(p);
    if (p.state === 'await chair') {
      const near = p.seat < 0 ? elapsed > -1.28 : elapsed > lift.fleet.duration - 1.25 || elapsed < 1.28;
      if (!near) {
        if (elapsed > 1.28 && elapsed < lift.duration * .5) {
          releaseChair(p);
          p.state = 'gate';
        }
        return;
      }
      p.state = 'loading';
    }
    if (p.state === 'loading') {
      const loading = p.seat < 0 ? elapsed : elapsed > lift.duration ? elapsed - lift.fleet.duration : elapsed;
      // Boarding the player's own chair can shift a fleet by part of a gap.
      // Keep the guest at the gate if their reserved chair has rolled past.
      if (loading > 3.4) {
        releaseChair(p);
        p.state = 'gate';
        place(p, approach, lift.profile.bottom.heading);
        p.seated = 0;
        return;
      }
      const t = smoothstep(-1.24, .62, loading);
      chairPose(p, clock, loading, aim);
      p.x = lerp(approach.x, aim.x, t);
      p.z = lerp(approach.z, aim.z, t);
      p.y = lerp(nav.height(approach), aim.y, t);
      p.heading = lift.profile.bottom.heading + turn(lift.profile.bottom.heading, aim.heading) * t;
      p.seated = lift.surface ? 0 : t;
      if (t >= 1) {
        p.state = 'riding';
        p.lastRideTime = elapsed;
        if (p.station.gate === p) p.station.gate = null;
        stats.boarded++;
      }
      return;
    }
    if (elapsed >= lift.duration - .03 && (p.seat < 0 || p.lastRideTime > lift.duration - 8)) {
      beginUnload(p, elapsed);
      return;
    }
    if (p.seat >= 0 && elapsed > lift.duration) {
      // The grip is still on its preceding turn after a small clock shift.
      p.state = 'loading';
      p.station.gate ??= p;
      p.seated = 0;
      return;
    }
    p.lastRideTime = elapsed;
    chairPose(p, clock, elapsed, p);
  }

  function nearPlayer(p, target, player, radius) {
    return player && !player.crash && Math.abs(player.pos.y - p.y) < 2.4 &&
      gap(player.pos, target) < radius;
  }

  function moveSkier(p, dt, player) {
    const { circuit, pace } = p, { path } = circuit;
    sample(path, p.distance, groundPoint);
    sample(path, p.distance + 9, ahead);
    const slope = (nav.height(groundPoint) - nav.height(ahead)) / 9;
    const bend = turn(groundPoint.heading, ahead.heading);
    const remaining = path.length - p.distance;
    const skillPace = circuit.grade === 'green' ? .77 : circuit.grade === 'black' ? 1.15 : 1;
    const target = Math.min(2.25 + Math.sqrt(Math.max(0, slope)) * 19 * skillPace * pace, 18 - Math.abs(bend) * 7,
      2.0 + remaining * .19);
    let speedLimit = target;
    for (const other of circuitTraffic.get(circuit)) {
      if (other.state !== 'skiing' || other.distance <= p.distance ||
        other.distance - p.distance > 6 || Math.abs(other.lane - p.lane) > 2.1) continue;
      speedLimit = Math.min(speedLimit, Math.max(0, (other.distance - p.distance - 1.3) * 2));
    }
    p.speed += (speedLimit - p.speed) * (1 - Math.exp(-dt * (speedLimit < p.speed ? 2.30 : 1.18)));
    const distance = Math.min(path.length, p.distance + p.speed * dt);
    sample(path, distance, aim);
    const taper = smoothstep(3, 16, distance) * smoothstep(2.2, 13, remaining);
    const amplitude = Math.min(circuit.width * .33, circuit.grade === 'green' ? 2.4 : 3.6);
    const arc = distance * (circuit.grade === 'green' ? .150 : .109) + p.phase;
    const offset = taper * (p.lane + amplitude * Math.sin(arc) * smoothstep(3, 11, p.speed));
    const yieldRoom = nearPlayer(p, aim, player, 6) ? 1 - smoothstep(3.8, 5.2, player.speed) : 0;
    const bypass = yieldRoom ? yieldRoom * (1 - smoothstep(2.8, 6, gap(player.pos, aim))) : 0;
    p.bypass += (bypass - p.bypass) * (1 - Math.exp(-dt * 4));
    const line = offset + 2.65 * p.bypass * Math.sign(p.lane);
    const maxStep = 2.05 * dt * Math.max(1.6, p.speed);
    let track = p;
    for (const width of lineWidths) {
      const candidate = width ? shifted(aim, aim.heading, line * width) : aim;
      if (!nav.clear(candidate, .65)) continue;
      const step = gap(p, candidate);
      // Narrow the carve where necessary and bound its lateral motion in m/s.
      if (step > maxStep) {
        const constrained = mix(p, candidate, maxStep / step);
        if (!nav.clear(constrained, .65)) continue;
        track = constrained;
        break;
      }
      track = candidate;
      break;
    }
    if (track === p || (yieldRoom && nearPlayer(p, track, player, 1.72) && gap(player.pos, track) <= gap(player.pos, p))) {
      p.speed *= Math.exp(-5 * dt);
      return false;
    }
    const step = gap(p, track);
    if (step > 1e-5) p.heading += turn(p.heading, heading(p, track)) * (1 - Math.exp(-dt * 7));
    p.lean += (clamp(-Math.sin(arc) + bend, -1, 1) - p.lean) * (1 - Math.exp(-dt * 4));
    p.stride += step;
    place(p, track);
    p.distance = distance;
    return remaining < .05;
  }

  function moveSlow(p, dt, player, pace) {
    const d = Math.min(p.path.length, p.distance + dt * pace);
    sample(p.path, d, aim);
    if (nearPlayer(p, aim, player, p.state === 'approach' ? 1.47 : 1.63)) {
      p.speed = 0;
      return false;
    }
    const step = gap(p, aim);
    p.speed = step / Math.max(dt, .001);
    if (step > 1e-5) p.heading += turn(p.heading, aim.heading) * (1 - Math.exp(-dt * 6));
    p.lean *= Math.exp(-6 * dt);
    p.stride += step;
    place(p, aim);
    p.distance = d;
    return d >= p.path.length - .015;
  }

  function updatePerson(p, dt, player) {
    if (p.recovery > 0) {
      p.recovery = Math.max(0, p.recovery - dt);
      p.speed *= Math.exp(-6 * dt);
      if (p.recovery === 0) stats.recovered++;
      return;
    }
    switch (p.state) {
      case 'social':
        return;
      case 'village walk':
        if (p.waitUntil > clock) return;
        if (moveSlow(p, dt, player, 1.18 * p.pace)) {
          p.villageDirection *= -1;
          const nodes = p.villageDirection > 0 ? p.villagePath.nodes : [...p.villagePath.nodes].reverse();
          segment(p, 'village walk', makePath(nodes));
          p.waitUntil = clock + 6.5 + random() * 7;
          p.speed = 0;
        }
        return;
      case 'skiing': {
        if (!moveSkier(p, dt, player)) return;
        stats.laps++;
        p.totalLaps = (p.totalLaps ?? 0) + 1;
        const rest = p.station.rests?.find(spot => !spot.guest && gap(p, spot.entry[0]) < 4.4);
        if (rest && (p.totalLaps + p.id) % 3 === 0) {
          p.rest = rest;
          rest.guest = p;
          p.venue = rest.venue;
          p.carries = true;
          segment(p, 'village walk to lodge', makePath([p, ...rest.entry]));
          p.foot = true;
        } else p.state = 'return';
        return;
      }
      case 'village walk to lodge':
        if (moveSlow(p, dt, player, 1.72 * p.pace)) {
          p.state = 'lodge break';
          p.waitUntil = clock + 19 + 20 * random();
          p.heading = p.rest.facing;
          p.social = p.cup = true;
          p.speed = 0;
          stats.lodgeBreaks++;
        }
        return;
      case 'lodge break':
        if (clock < p.waitUntil) return;
        p.cup = p.social = false;
        segment(p, 'walk from lodge', makePath([...p.rest.entry].reverse()));
        p.foot = true;
        return;
      case 'walk from lodge':
        if (moveSlow(p, dt, player, 1.88 * p.pace)) {
          p.state = 'return';
          p.rest.guest = null;
          p.rest = null;
          p.venue = null;
        }
        return;
      case 'return':
        p.speed = 0;
        if (!(p.nextTry > clock)) {
          p.nextTry = clock + .9 + random() * .9;
          toQueue(p);
        }
        return;
      case 'join queue':
        if (moveSlow(p, dt, player, 2.02 * p.pace)) p.state = 'queue';
        return;
      case 'queue':
        p.speed = 0;
        p.heading += turn(p.heading, p.station.lift.profile.bottom.heading) * (1 - Math.exp(-dt * 3));
        if (p.station.gate || p.station.queue[0] !== p || clock < (p.station.releaseAt ?? 1)) return;
        p.station.gate = p;
        p.station.queue.shift();
        segment(p, 'approach', p.berth.path);
        return;
      case 'approach':
        if (moveSlow(p, dt, player, 2.1 * p.pace)) {
          p.state = 'gate';
          p.berth.guest = null;
          p.berth = null;
          p.speed = 0;
        }
        return;
      case 'gate': {
        if (nearPlayer(p, p.station.load, player, 1.52)) return;
        const choice = nextChair(p);
        if (!choice) return;
        claimChair(p, choice.slot, clock + choice.wait);
        p.state = 'await chair';
        p.station.releaseAt = clock + choice.wait + (p.station.lift.surface ? 2.8 : 1);
        return;
      }
      case 'await chair':
      case 'loading':
      case 'riding':
      case 'unloading':
        advanceRide(p);
        return;
    }
  }

  let density = 1;
  const visiting = p => p.trafficSeed < density;

  function hitPlayer(previous, current, dt) {
    if (!(dt > 0)) return null;
    const dx = current.x - previous.x, dz = current.z - previous.z, length = dx * dx + dz * dz;
    if (!Number.isFinite(length) || length > 64) return null;
    const vx = dx / dt, vz = dz / dt;
    let hit = null, earliest = Infinity;
    for (const p of people) {
      if (!visiting(p)) continue;
      if (p.state !== 'skiing' && p.state !== 'social' && p.state !== 'village walk') continue;
      if (p.immunity > clock || p.recovery > 0) continue;
      const t = length > 1e-8 ? clamp(((p.x - previous.x) * dx + (p.z - previous.z) * dz) / length, 0, 1) : 0;
      const y = lerp(previous.y, current.y, t);
      if (t >= earliest || y - p.y > 1.23 || p.y - y > .85 ||
        (previous.x + dx * t - p.x) ** 2 + (previous.z + dz * t - p.z) ** 2 > .53 ** 2) continue;
      if (Math.hypot(vx - Math.sin(p.heading) * p.speed, vz - Math.cos(p.heading) * p.speed) < 8.4) continue;
      hit = p;
      earliest = t;
    }
    if (hit) {
      hit.recovery = 2.48;
      hit.immunity = clock + 5.3;
      stats.collisions++;
    }
    return hit;
  }

  function update(dt, time, camera, player) {
    clock = time;
    if (dt > 0) for (const p of people) updatePerson(p, dt, player);
    model.begin();
    view.prepare(camera);
    stats.visible = 0;
    for (const p of people) {
      if (!visiting(p)) continue;
      const d2 = camera ? (p.x - camera.position.x) ** 2 + (p.y - camera.position.y) ** 2 + (p.z - camera.position.z) ** 2 : 0;
      if (d2 > 295 ** 2 || stats.visible >= 72) continue;
      if (camera && !view.contains(p.x, p.y, p.z, false)) continue;
      model.draw(p, clock, ground, d2 < 64 ** 2);
      stats.visible++;
    }
    model.end();
  }

  return {
    group, update, hitPlayer, people,
    setDensity(value) { density = value; },
    debug() {
      const states = {};
      for (const p of people) states[p.state] = (states[p.state] ?? 0) + 1;
      return { ...stats, people: people.length, states, density,
        stations: stations.map(({ lift, circuits, queue, rests }) => ({ lift: lift.def.name,
          routes: circuits.map(circuit => ({ name: circuit.run.name || lift.def.name + ' practice slope',
            id: circuit.run.id, length: Math.round(circuit.path.length) })),
          queuing: queue.length, lodgeRoutes: rests?.length ?? 0 })),
        socialGroups: clusters.map(cluster => ({ venue: cluster.kind, count: cluster.ring.length })),
      };
    },
  };
}
