import * as THREE from 'three';
import { clamp, mulberry32 } from './math.js';
import { mergeParts, part } from './scenery.js';
import { fallState, featureRaise, featureX } from './sled-course-plan.js';
import { buildCaveArt } from './sled-cave-art.js';
import { buildRiverArt } from './sled-river-art.js';
import { buildVillageArt } from './sled-village-art.js';
import { tintedMaterial } from './sled-biome-mesh.js';

const TAU = Math.PI * 2;
const colors = {
  iceBlue: '#79bfd7', iceDeep: '#429fbf', icePale: '#c3e7ee', drift: '#d0e5ed',
  rock: '#617588', darkRock: '#465666', fur: '#e9e1d2', lightFur: '#f6eee0', darkerFur: '#b9ac9f',
  bark: '#5b4847', green: '#385c5b', white: '#e9f5fd',
};

function merged(group, name, parts, material) {
  const mesh = new THREE.Mesh(mergeParts(parts, true), material);
  mesh.name = name;
  group.add(mesh);
  return mesh;
}

function polarBear(group, feature, pointAt, assets, material) {
  const { sphere } = assets;
  const parts = [];
  const { fur, lightFur, darkerFur } = colors;
  function ball(color, at, size, rotation) {
    parts.push(part(sphere, color, at, rotation, size));
  }
  ball(fur, [0, 1.04, -.33], [.69, .67, 1.18]);
  ball(lightFur, [0, 1.15, .43], [.72, .78, .72]);
  ball(fur, [0, .98, -.93], [.60, .60, .61]);
  ball(fur, [0, 1.19, .97], [.47, .44, .68], [.19, 0, 0]);
  ball(lightFur, [0, 1.08, 1.48], [.395, .36, .58], [.09, 0, 0]);
  ball(darkerFur, [0, .89, 1.83], [.284, .16, .28]);
  ball(lightFur, [0, 1.01, 1.82], [.26, .19, .39]);
  ball('#322d32', [0, 1.06, 2.10], [.153, .092, .13]);
  ball('#a4a2a1', [.017, 1.113, 2.187], [.047, .025, .014]);
  const reachingSide = feature.x > 0 ? -1 : 1;
  for (const sign of [-1, 1]) {
    ball(fur, [sign * .344, 1.49, 1.31], [.15, .165, .095], [.09, 0, -.22 * sign]);
    ball(darkerFur, [sign * .356, 1.527, 1.365], [.076, .087, .047]);
    ball('#362f32', [sign * .226, 1.223, 1.845], [.043, .042, .037]);
    ball('#e9ddc5', [sign * .233, 1.237, 1.867], [.013, .012, .012]);
    if (sign !== reachingSide) {
      ball(fur, [sign * .46, .60, .54], [.27, .59, .29], [-.15, 0, .07 * sign]);
      ball(lightFur, [sign * .49, .19, .71], [.29, .16, .40]);
    }
    ball(fur, [sign * .47, .61, -.88], [.29, .54, .38], [.23, 0, -.06 * sign]);
    ball(lightFur, [sign * .51, .154, -1.02], [.30, .15, .38]);
  }
  ball(fur, [0, .89, -1.48], [.18, .20, .17]);
  const mesh = merged(group, 'Polar bear on river ice', parts, material);
  const paw = merged(mesh, 'Polar bear reaching forepaw', [
    part(sphere, fur, [0, -.34, .02], [-.15, 0, 0], [.23, .43, .27]),
    part(sphere, lightFur, [.013 * reachingSide, -.66, .16], [-.22, 0, 0], [.26, .18, .33]),
  ], material);
  paw.position.set(reachingSide * .49, .89, .58);
  return elapsed => {
    const step = elapsed * .68 + feature.phase;
    mesh.position.copy(pointAt(featureX(feature, elapsed), feature.d, .12));
    mesh.rotation.set(.015 * Math.cos(step * 2), .33 * Math.cos(step), .039 * Math.sin(step));
    const reach = Math.max(0, Math.sin(step * 1.6 + .8)) ** 1.8;
    paw.rotation.set(-.16 - reach * .70, 0, reachingSide * (.05 + reach * .88));
  };
}

function streamObstacle(group, feature, pointAt, assets, material) {
  const { rock, cone, cylinder } = assets;
  const { x, d, height, halfWidth: w, halfDepth: l, kind } = feature;
  const parts = [];
  const random = mulberry32(Math.round(d * 110.41));
  if (kind === 'iceChunk') {
    const palette = [colors.iceDeep, '#70aec8', colors.icePale, '#bbdbec'];
    for (let i = 0; i < 6; i++) {
      const theta = i / 6 * TAU;
      parts.push(part(rock, palette[i % palette.length], [.94 * Math.cos(theta), .36 + random() * .27, 1.15 * Math.sin(theta)],
        [.24 * random(), theta, .63 * random()], [.57 + random() * .54, .37 + random() * .19, .6 + random() * .58]));
    }
    parts.push(part(rock, '#d5eef4', [0, .81, .32], [.42, .1, .9], [1.15, .42, .73]));
  }
  if (kind === 'rockIsland') {
    for (let i = 0; i < 9; i++) {
      const theta = i / 9 * TAU;
      const at = [w * .59 * Math.cos(theta), height * (.23 + random() * .24), l * .62 * Math.sin(theta)];
      const size = [.62 + random() * .47, .45 + random() * .54, .60 + random() * .79];
      parts.push(part(rock, i % 3 ? colors.rock : colors.darkRock, at, [.13, theta, .22], size));
      parts.push(part(rock, colors.white, [at[0] - .08, at[1] + .70 * size[1], at[2]], [.11, theta, .05],
        [size[0] * .8, size[1] * .32, size[2] * .84]));
    }
    parts.push(part(rock, colors.rock, [0, height * .47, -.3], [.45, .1, .25], [1.35, .94, 1.7]));
    parts.push(part(rock, colors.drift, [.21, height * .87, -.19], [.42, .1, .25], [1.18, .32, 1.43]));
  }
  if (kind === 'bankLimb') {
    const side = x === 0 ? (random() < .5 ? -1 : 1) : Math.sign(x);
    parts.push(part(cylinder, colors.bark, [0, .43, 0], [0, 0, Math.PI / 2.1], [.22, w * 1.9, .23]));
    for (let i = 0; i < 8; i++) {
      const offset = (i / 7 * 2 - 1) * w * .77;
      const sign = i % 2 ? -1 : 1;
      const height = .63 + random() * .16;
      parts.push(part(cone, colors.green, [offset, height, sign * .53], [sign * 1.13, 0, side * .48],
        [.40, 1.74 + random() * .25, .52]));
      parts.push(part(rock, colors.drift, [offset + .16 * side, height + .22, sign * .39], [0, 0, .14], [.37, .19, .49]));
    }
    const from = new THREE.Vector3(side * w * .85, .67, -.2);
    const to = new THREE.Vector3(side * 4.3, 4.04, -.56);
    appendBranch(parts, cylinder, from, to, .23);
    const next = new THREE.Vector3(side * (17.5 - Math.abs(x)), 6.8, -1.2);
    appendBranch(parts, cylinder, to, next, .34);
    for (const t of [.25, .58, .87]) {
      const at = to.clone().lerp(next, t);
      parts.push(part(cone, colors.green, at.toArray(), [-Math.PI / 2.3, 0, side * .55], [.61, 2.2, .71]));
    }
  }
  const names = { iceChunk: 'Loose river ice', rockIsland: 'Snow-capped river island', bankLimb: 'Low cedar limb' };
  const mesh = merged(group, names[kind], parts, material);
  mesh.position.copy(pointAt(x, d, .12));
  if (kind === 'iceChunk') return elapsed => {
    const bob = featureRaise(feature, elapsed);
    mesh.position.copy(pointAt(featureX(feature, elapsed), d, .12 + bob));
    mesh.rotation.z = bob * .79;
  };
}

function appendBranch(parts, geometry, from, to, radius) {
  const delta = to.clone().sub(from);
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion()
    .setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
  parts.push(part(geometry, colors.bark, from.clone().lerp(to, .5).toArray(), rotation.toArray().slice(0, 3),
    [radius, delta.length(), radius * .86]));
}

function warningMark(group, feature, pointAt) {
  const geometry = new THREE.RingGeometry(.79, 1, 30);
  geometry.rotateX(-Math.PI / 2);
  const { position } = geometry.attributes;
  for (let i = 0; i < position.count; i++) {
    const x = feature.x + position.getX(i) * (feature.halfWidth + .37);
    const d = feature.d - position.getZ(i) * (feature.halfDepth + .51);
    const p = pointAt(x, d, .092);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#ffad4d', transparent: true,
    depthWrite: false, side: THREE.DoubleSide }));
  mesh.name = 'Falling debris warning on the snow';
  group.add(mesh);
  return mesh;
}

function fallingHazard(group, feature, pointAt, assets, material) {
  const { kind, x, d, height, halfWidth: w, halfDepth: l } = feature;
  const { rock, cone } = assets;
  const parts = [];
  const ice = kind === 'fallingIce';
  const snow = kind === 'fallingSnow';
  if (ice) {
    parts.push(part(cone, colors.icePale, [-.24, height * .5, .12], [Math.PI, .18, .2],
      [w * .70, height, l * .57]));
    parts.push(part(cone, colors.iceBlue, [.44, height * .59, .10], [Math.PI + .1, 0, -.20], [w * .48, height * .83, l * .65]));
    parts.push(part(rock, colors.iceDeep, [-.17, height * .74, -.31], [.54, .6, .4], [w * .70, height * .22, l * .69]));
  } else {
    parts.push(part(rock, snow ? colors.drift : colors.rock, [0, height * .5, 0], [.27, .32, .6], [w * .94, height * .55, l]));
    parts.push(part(rock, snow ? colors.white : colors.darkRock, [.32, height * .65, .31], [.04, .78, .33],
      [w * .72, height * .37, l * .66]));
  }
  const names = { fallingIce: 'Falling icicle', fallingSnow: 'Falling compact snow', fallingRock: 'Falling glacial rock' };
  const mesh = merged(group, names[kind], parts, material);
  const ring = warningMark(group, feature, pointAt);
  const impact = [];
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    impact.push(part(rock, ice ? colors.icePale : colors.drift, [w * Math.cos(a), .14, l * Math.sin(a)],
      [a, a * 2, -.21], [.22 + .06 * (i % 4), .19, .26]));
  }
  const spill = merged(group, 'Falling debris fragments', impact, material);
  spill.position.copy(pointAt(x, d, .05));
  return elapsed => {
    const state = fallState(feature, elapsed);
    mesh.visible = state.phase !== 'idle';
    mesh.position.copy(pointAt(x, d, state.height));
    mesh.rotation.y = state.phase === 'falling' ? state.progress * 2.8 : 0;
    ring.visible = state.phase === 'warning' || state.phase === 'falling';
    ring.material.opacity = .73 + .23 * Math.sin(state.progress * TAU * 2);
    spill.visible = state.phase === 'impact';
    if (spill.visible) spill.scale.setScalar(.71 + state.progress * .56);
  };
}

function flightPickup(group, feature, pointAt, assets) {
  const { x, d, height } = feature;
  const { diamond, halo } = assets;
  const pickup = new THREE.Group();
  pickup.name = 'Flight pickup in the snow lane';
  const geometry = mergeParts([
    part(diamond, '#ffe090', [0, 0, 0], [0, 0, 0], [.55, .84, .55]),
    part(diamond, '#81f5e9', [0, 0, 0], [0, 0, 0], [.86, .24, .28]),
    part(halo, '#fff0b1', [0, 0, 0], [Math.PI / 2, 0, 0], [.74, .74, .74]),
  ], true);
  const gem = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
  pickup.add(gem);
  for (const side of [-1, 1]) {
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(.075, .09, 1.5, 5), new THREE.MeshStandardMaterial({ color: '#9bceb8' }));
    marker.position.set(side * 1.72, -.35, 0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(.18, 7, 5), new THREE.MeshBasicMaterial({ color: '#9ffce0' }));
    lamp.position.set(side * 1.72, .43, 0);
    pickup.add(marker, lamp);
  }
  pickup.position.copy(pointAt(x, d, height));
  group.add(pickup);
  return (elapsed, run) => {
    pickup.visible = !(run?.upperRoute && run.d >= d - feature.halfDepth);
    gem.rotation.y = elapsed * 2.1;
    gem.position.y = .16 * Math.sin(elapsed * 4.3);
  };
}

export function addSledBiomeArt(group, { sections = [], gaps = [], features = [] }, { pointAt }) {
  const animations = [];
  for (const section of sections) {
    if (section.kind === 'cave') buildCaveArt(group, section, pointAt, gaps);
    if (section.kind === 'river') animations.push(buildRiverArt(group, section, gaps, pointAt));
    if (section.kind === 'village') buildVillageArt(group, section, features, pointAt);
  }
  const obstacles = features.filter(({ kind }) => !['closedHouse', 'openHouse', 'roofRamp'].includes(kind));
  if (obstacles.length) {
    const assets = {
      sphere: new THREE.SphereGeometry(1, 12, 8), rock: new THREE.IcosahedronGeometry(1, 0),
      cone: new THREE.ConeGeometry(1, 1, 5), cylinder: new THREE.CylinderGeometry(.57, 1, 1, 6),
      diamond: new THREE.OctahedronGeometry(1), halo: new THREE.TorusGeometry(1, .075, 5, 28),
    };
    const material = tintedMaterial({ roughness: .79 });
    let usesMaterial = false;
    for (const feature of obstacles) {
      const { kind } = feature;
      if (kind === 'flightPickup') {
        animations.push(flightPickup(group, feature, pointAt, assets));
      } else if (kind === 'polarBear') {
        animations.push(polarBear(group, feature, pointAt, assets, material));
        usesMaterial = true;
      } else if (kind.startsWith('falling')) {
        animations.push(fallingHazard(group, feature, pointAt, assets, material));
        usesMaterial = true;
      } else if (kind === 'iceChunk' || kind === 'rockIsland' || kind === 'bankLimb') {
        const animate = streamObstacle(group, feature, pointAt, assets, material);
        if (animate) animations.push(animate);
        usesMaterial = true;
      }
    }
    if (!usesMaterial) material.dispose();
    for (const geometry of Object.values(assets)) geometry.dispose();
  }
  function update(elapsed, run) {
    for (const animate of animations) animate(elapsed, run);
  }
  update(0);
  return { update };
}
