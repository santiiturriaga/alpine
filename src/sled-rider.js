import * as THREE from 'three';
import { clamp, mix } from './math.js';

const ASH = [0xbf824e, 0xd4a06b, 0xe6b783, 0xc38a55, 0xd7a575];
const STEEL = 0x526777;
const STRAP = 0x263c4a;
const JACKET = 0xab442d;
const SEAMS = 0x62332f;
const SHOULDERS = 0xd87545;
const TROUSERS = 0x294550;
const KNEE = 0x3a5663;
const GLOVES = 0x344250;
const BOOTS = 0x27343d;
const UP = new THREE.Vector3(0, 1, 0);

// Each stationary assembly or animated joint uses one vertex-colored mesh.
function batch(material) {
  const points = [], normals = [], colors = [];
  const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
  const euler = new THREE.Euler(), quat = new THREE.Quaternion();
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), color = new THREE.Color();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  function add(geometry, tint, offset = [0, 0, 0], size = [1, 1, 1], rotate = [0, 0, 0]) {
    position.fromArray(offset);
    scale.fromArray(size);
    quat.setFromEuler(euler.fromArray(rotate));
    matrix.compose(position, quat, scale);
    normalMatrix.getNormalMatrix(matrix);
    const p = geometry.attributes.position, n = geometry.attributes.normal;
    const index = geometry.index;
    if (typeof tint !== 'function') color.set(tint);
    for (let v = 0; v < (index?.count ?? p.count); v++) {
      const i = index ? index.getX(v) : v;
      point.fromBufferAttribute(p, i).applyMatrix4(matrix).toArray(points, points.length);
      normal.fromBufferAttribute(n, i).applyNormalMatrix(normalMatrix).toArray(normals, normals.length);
      if (typeof tint === 'function') tint(point, color);
      color.toArray(colors, colors.length);
    }
  }
  return {
    add,
    mesh(name) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      return mesh;
    },
  };
}

function loft(rings, count = 12) {
  const vertices = [], indices = [];
  for (const [y, rx, rz, z = 0] of rings) {
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      vertices.push(Math.cos(angle) * rx, y, z + Math.sin(angle) * rz);
    }
  }
  for (let row = 1; row < rings.length; row++) for (let i = 0; i < count; i++) {
    const a = (row - 1) * count + i, b = (row - 1) * count + (i + 1) % count;
    indices.push(a, a + count, b, b, a + count, b + count);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rope(points, radius) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(xyz => new THREE.Vector3(...xyz))), 20, radius, 5);
}

const RUNNER = [
  [1.1, .103], [.94, .072], [.57, .067], [.06, .065], [-.49, .068],
  [-.81, .091], [-1.02, .134], [-1.18, .225], [-1.31, .345], [-1.37, .455], [-1.36, .544], [-1.29, .602],
];

function runner(width, low, high) {
  const outline = new THREE.Shape();
  outline.moveTo(RUNNER[0][0], RUNNER[0][1] + low);
  for (const [z, y] of RUNNER.slice(1)) outline.lineTo(z, y + low);
  for (const [z, y] of [...RUNNER].reverse()) outline.lineTo(z, y + high);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: width, bevelThickness: .009, bevelSize: .009, bevelSegments: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

function sledTimber(material, cube, round) {
  const sled = batch(material);
  for (const [width, low, high, color] of [
    [.079, -.055, -.026, STEEL], [.119, -.023, .054, ASH[1]],
    [.121, .052, .070, ASH[0]], [.114, .070, .104, ASH[2]],
  ]) {
    const ski = runner(width, low, high);
    for (const x of [-.465, .465]) sled.add(ski, color, [x, 0, 0]);
  }
  for (let i = 0; i < ASH.length; i++) {
    const x = (i - 2) * .177;
    sled.add(cube, ASH[i], [x, .408, .04], [.162, .069, 1.73 - Math.abs(i - 2) * .09]);
    sled.add(cube, ASH[0], [x + .049, .443, .067], [.009, .003, 1.46 - Math.abs(i - 2) * .08]);
  }
  for (const z of [-.61, .653]) {
    sled.add(cube, SEAMS, [0, .355, z], [1.06, .109, .16]);
    sled.add(cube, JACKET, [0, .399, z], [1.08, .043, .171]);
    for (const x of [-.465, .465]) {
      sled.add(cube, ASH[1], [x, .246, z], [.113, .247, .13], [.18 * Math.sign(z), 0, 0]);
      sled.add(round, STEEL, [x + Math.sign(x) * .066, .349, z], [.044, .015, .044], [0, 0, Math.PI / 2]);
    }
  }
  sled.add(cube, STRAP, [0, .466, .424], [.748, .064, .57]);
  sled.add(cube, KNEE, [0, .497, .433], [.725, .022, .547]);
  sled.add(cube, SHOULDERS, [0, .478, .717], [.70, .022, .014]);

  sled.add(rope([[-.465,.54,-1.26],[-.31,.505,-1.55],[.12,.472,-1.66],[.42,.511,-1.41],[.465,.54,-1.26]], .019), 0xe1b660);
  for (const side of [-1, 1]) {
    const x = side * .245;
    sled.add(cube, BOOTS, [x, .483, -.66], [.209, .076, .352]);
    sled.add(cube, KNEE, [x, .536, -.755], [.179, .115, .221], [.08, 0, 0]);
    sled.add(cube, STEEL, [x, .568, -.735], [.177, .025, .052], [.08, 0, 0]);
  }
  return sled.mesh('Laminated ash sled and tow cord');
}

function steeringRig(material, cube, capsule) {
  const bar = batch(material);
  bar.add(cube, SEAMS, [0, -.15, .074], [.068, .297, .11], [-.35, 0, 0]);
  bar.add(rope([[-.39, .013, .01], [-.22, -.028, 0], [0, -.053, -.02], [.22, -.028, 0], [.39, .013, .01]], .029), JACKET);
  for (const side of [-1, 1]) {
    const x = side * .317;
    bar.add(capsule, STRAP, [x, .01, .015], [.045, .10, .043], [0, 0, Math.PI / 2]);
    bar.add(capsule, GLOVES, [x, .053, .031], [.073, .112, .064], [-.46, 0, .57 * side]);
    bar.add(capsule, SEAMS, [x - side * .025, .065, -.006], [.057, .078, .046], [-.52, 0, -side * .12]);
  }
  const rig = bar.mesh('Steering handhold and mittens');
  rig.position.set(0, .748, -.61);
  return rig;
}

function riderJacket(material, cube) {
  const jacket = batch(material);
  jacket.add(loft([[-.065, .002, .002], [-.026, .227, .182], [.09, .257, .198],
    [.24, .224, .170], [.46, .284, .153, -.023], [.53, .282, .146, -.036],
    [.602, .179, .117, -.034], [.623, .107, .099, -.031], [.63, .001, .001, -.03]], 14),
  ({ x, y, z }, color) => {
    color.set(y < .091 || Math.abs(x) > .21 && y < .39 ? SEAMS : y > .44 ? SHOULDERS : JACKET);
    if (z > .11 && y > .137 && y < .53 && Math.abs(x) < .10) color.set(0xc85234);
  });
  jacket.add(cube, 0xe7c9a0, [0, .46, .129], [.283, .023, .017], [.16, 0, 0]);
  jacket.add(cube, SEAMS, [0, .223, .169], [.216, .162, .038], [.15, 0, 0]);
  jacket.add(cube, 0xd28051, [0, .287, .193], [.183, .015, .016], [.15, 0, 0]);
  jacket.add(loft([[.593, .12, .113], [.675, .113, .104], [.692, .086, .075]], 12), STRAP, [0, 0, -.036]);
  return jacket.mesh('Rider shell jacket and back pocket');
}

function riderHelmet(material, cube, round, dome) {
  const helmet = batch(material);
  helmet.add(loft([[0, .086, .110], [.039, .155, .151], [.119, .194, .192],
    [.206, .201, .189], [.257, .170, .161], [.296, .114, .124], [.319, .001, .001]], 18),
  ({ x, y }, color) => {
    color.set(y < .043 ? STRAP : Math.abs(x) < .042 ? 0xc2573c : 0xd9e3e5);
  });
  helmet.add(loft([[.125, .191, .192], [.155, .200, .198], [.178, .199, .196]], 16),
    STRAP);
  helmet.add(dome, STRAP, [0, .142, -.16], [.186, .088, .086]);
  helmet.add(dome, 0x548da4, [0, .150, -.207], [.166, .066, .055]);
  helmet.add(dome, 0x8db4c5, [-.039, .173, -.235], [.095, .015, .026], [0, 0, -.12]);
  helmet.add(cube, SEAMS, [0, .152, .203], [.105, .067, .021]);
  for (const side of [-1, 1]) {
    helmet.add(round, STRAP, [side * .173, .096, .001], [.054, .030, .064], [0, 0, Math.PI / 2]);
    helmet.add(cube, STEEL, [side * .158, .233, .082], [.020, .022, .058], [.16, 0, .39 * side]);
  }
  const mesh = helmet.mesh('Helmet, blue goggles and wraparound strap');
  mesh.position.set(0, .668, -.046);
  return mesh;
}

function jointSegment(material, name, taper, upper, lower) {
  const limb = batch(material);
  const [root, elbow, tip] = taper;
  limb.add(loft([[-.13, .001, .001], [-.055, root, root * .97], [.33, root * .98, root * .92],
    [.77, elbow, elbow], [1.05, tip, tip], [1.17, .001, .001]], 9),
  ({ y }, color) => color.set(y > .70 ? lower : upper));
  return limb.mesh(name);
}

export function sledModel() {
  const group = new THREE.Group();
  group.name = 'Ash runner sled and rider';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .73 });
  const cube = new THREE.BoxGeometry(), round = new THREE.CylinderGeometry(1, 1, 1, 9);
  const capsule = new THREE.CapsuleGeometry(.64, .76, 4, 9);
  const dome = new THREE.SphereGeometry(1, 14, 9);
  const body = riderJacket(material, cube);
  const helmet = riderHelmet(material, cube, round, dome);
  const steering = steeringRig(material, cube, capsule);
  body.add(helmet);
  group.add(sledTimber(material, cube, round), body, steering);

  const sides = [-1, 1].map(side => {
    const thigh = jointSegment(material, 'Padded trouser thigh', [.135, .129, .113], TROUSERS, KNEE);
    const calf = jointSegment(material, 'Trouser leg and boot cuff', [.112, .101, .078], TROUSERS, BOOTS);
    const sleeve = jointSegment(material, 'Jacket upper sleeve', [.102, .100, .086], SHOULDERS, JACKET);
    const forearm = jointSegment(material, 'Jacket forearm', [.087, .081, .064], JACKET, SEAMS);
    group.add(thigh, calf, sleeve, forearm);
    return {
      thigh, calf, sleeve, forearm,
      shoulder: new THREE.Vector3(side * .266, .491, -.028),
      hip: new THREE.Vector3(side * .155, .003, .015),
      glovedHand: new THREE.Vector3(side * .305, .058, .045),
      boot: new THREE.Vector3(side * .245, .538, -.595),
      kneeBend: new THREE.Vector3(side * .32, 1, -.12),
      elbowBend: new THREE.Vector3(side * .85, -.6, .2),
    };
  });

  return {
    group, body, helmet, steering, sides, steer: 0, tuck: 0, brake: 0, landing: 0, airborne: false,
    start: new THREE.Vector3(), end: new THREE.Vector3(), joint: new THREE.Vector3(),
    axis: new THREE.Vector3(), bend: new THREE.Vector3(), segment: new THREE.Vector3(),
  };
}

function bendJoint(sled, firstLength, secondLength, preferred, first, second) {
  const { start, end, joint, axis, bend, segment } = sled;
  const distance = axis.subVectors(end, start).length();
  axis.multiplyScalar(1 / Math.max(distance, .001));
  const along = clamp((firstLength ** 2 - secondLength ** 2 + distance ** 2) / (distance * 2), .02, firstLength);
  bend.copy(preferred).addScaledVector(axis, -axis.dot(preferred)).normalize();
  joint.copy(start).addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(firstLength ** 2 - along ** 2));

  for (const [mesh, a, b] of [[first, start, joint], [second, joint, end]]) {
    mesh.position.copy(a);
    segment.subVectors(b, a);
    const length = Math.max(.001, segment.length());
    mesh.quaternion.setFromUnitVectors(UP, segment.multiplyScalar(1 / length));
    mesh.scale.y = length;
  }
}

export function poseSledRider(sled, run, dt, steer, tuck, brake) {
  const damping = 1 - Math.exp(-dt * 11);
  const weight = clamp(run.dx / 18 + steer * .2, -1, 1);
  sled.steer = mix(sled.steer, weight, damping);
  sled.tuck = mix(sled.tuck, tuck, damping);
  sled.brake = mix(sled.brake, brake, damping);
  if (sled.airborne && !run.air) sled.landing = clamp(-run.dy * .027, .16, .74);
  sled.airborne = Boolean(run.air);
  sled.landing *= Math.exp(-dt * 7.7);
  const crouch = sled.tuck, impact = sled.landing, bank = sled.steer;

  sled.body.position.set(bank * .086, .535 - .039 * crouch - .083 * impact, .285 - .112 * crouch + .064 * sled.brake);
  sled.body.rotation.set(-.19 - .39 * crouch - .22 * impact + .15 * sled.brake,
    -.075 * bank, -.165 * bank);
  sled.helmet.rotation.set(.105 + .21 * crouch + .095 * impact, -.20 * bank, .056 * bank);
  sled.steering.rotation.y = -.26 * bank;
  sled.body.updateMatrix();
  sled.steering.updateMatrix();

  for (const side of sled.sides) {
    sled.start.copy(side.hip).applyMatrix4(sled.body.matrix);
    sled.end.copy(side.boot);
    bendJoint(sled, .462, .478, side.kneeBend, side.thigh, side.calf);
    sled.start.copy(side.shoulder).applyMatrix4(sled.body.matrix);
    sled.end.copy(side.glovedHand).applyMatrix4(sled.steering.matrix);
    bendJoint(sled, .355, .411, side.elbowBend, side.sleeve, side.forearm);
  }
}
