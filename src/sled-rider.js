import * as THREE from 'three';
import { clamp, mix } from './math.js';
import { createSkier } from './skier.js';

const ASH = [0xbf824e, 0xd4a06b, 0xe6b783, 0xc38a55, 0xd7a575];
const STEEL = 0x526777;
const STRAP = 0x263c4a;
const JACKET = 0xab442d;
const STAIN = 0x62332f;
const CUSHION = 0x3a4650;
const CORD = 0xc37a3d;

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

function sledTimber(material, cube, round, redSled) {
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
    sled.add(cube, STAIN, [0, .355, z], [1.06, .109, .16]);
    sled.add(cube, ASH[0], [0, .399, z], [1.08, .043, .171]);
    for (const x of [-.465, .465]) {
      sled.add(cube, ASH[1], [x, .246, z], [.113, .247, .13], [.18 * Math.sign(z), 0, 0]);
      sled.add(round, STEEL, [x + Math.sign(x) * .066, .349, z], [.044, .015, .044], [0, 0, Math.PI / 2]);
    }
  }
  sled.add(cube, STRAP, [0, .466, .424], [.748, .064, .57]);
  sled.add(cube, redSled ? 0xa13e31 : CUSHION, [0, .497, .433], [.725, .022, .547]);
  sled.add(cube, CORD, [0, .478, .717], [.70, .022, .014]);
  sled.add(rope([[-.465,.54,-1.26],[-.31,.505,-1.55],[.12,.472,-1.66],[.42,.511,-1.41],[.465,.54,-1.26]], .019), 0xe1b660);
  return sled.mesh('Laminated ash sled and tow cord');
}

function steeringRig(material, cube) {
  const bar = batch(material);
  bar.add(cube, STAIN, [0, -.161, -.005], [.063, .305, .09], [-.16, 0, 0]);
  bar.add(rope([[-.28, .008, .014], [-.20, .006, 0], [0, -.022, -.019], [.2, .006, 0], [.28, .008, .014]], .024), CORD);
  for (const side of [-1, 1]) {
    bar.add(cube, STRAP, [side * .22, .004, .006], [.105, .044, .046]);
  }
  return bar.mesh('Steering handle');
}

function ownRenderedParts(rider) {
  // The goggles and textile maps are cached across resort avatars. Give
  // the sled renderer its own disposable copies of these static resources.
  const copies = new Map();
  const copy = original => {
    if (!copies.has(original)) copies.set(original, original.clone());
    return copies.get(original);
  };
  function ownMaterial(material) {
    const local = copy(material);
    local.onBeforeCompile = material.onBeforeCompile;
    local.customProgramCacheKey = material.customProgramCacheKey;
    for (const [key, value] of Object.entries(material)) {
      if (value?.isTexture) local[key] = copy(value);
    }
    return local;
  }
  rider.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    // Articulated garments already have private geometry written by the rig.
    if (mesh.geometry.attributes.position.usage !== THREE.DynamicDrawUsage) mesh.geometry = copy(mesh.geometry);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(ownMaterial) : ownMaterial(mesh.material);
  });
}

function flightWing() {
  const wing = new THREE.Group();
  wing.name = 'Deployable sled wing';
  const positions = [], colors = [], indices = [];
  const blue = new THREE.Color('#378aaf'), cream = new THREE.Color('#f1e5ce');
  const columns = 16, rows = 5;
  for (let chord = 0; chord <= rows; chord++) {
    const t = chord / rows;
    for (let column = 0; column <= columns; column++) {
      const span = 2 * column / columns - 1;
      const tip = Math.abs(span);
      const x = span * 2.15;
      const y = 2.43 - tip ** 1.9 * .47 + Math.sin(t * Math.PI) * (.12 + .10 * (1 - tip));
      const z = -.9 + tip ** 1.7 * .83 + t * (1.28 - .63 * tip);
      positions.push(x, y, z);
      (column > 3 && column < 13 && chord > 0 ? cream : blue).toArray(colors, colors.length);
      if (chord && column) {
        const i = chord * (columns + 1) + column;
        indices.push(i - columns - 2, i - columns - 1, i, i - columns - 2, i, i - 1);
      }
    }
  }
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  canopy.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  canopy.setIndex(indices);
  canopy.computeVertexNormals();
  wing.add(new THREE.Mesh(canopy, new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, roughness: .82,
  })));
  const cords = new THREE.BufferGeometry();
  const lines = [];
  for (const side of [-1, 1]) {
    for (const z of [-.21, .51]) lines.push(side * .49, .38, .4, side * 1.80, 2.1, z);
  }
  cords.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  wing.add(new THREE.LineSegments(cords, new THREE.LineBasicMaterial({ color: '#214054' })));
  wing.visible = false;
  return wing;
}

export function sledModel(outfit, redSled = false) {
  const group = new THREE.Group();
  group.name = 'Ash runner sled and rider';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .73 });
  const cube = new THREE.BoxGeometry(), round = new THREE.CylinderGeometry(1, 1, 1, 9);
  const rider = createSkier();
  rider.setAppearance(outfit);
  // The regular skier faces +Z. The runners point along the course's -Z.
  rider.group.rotation.y = Math.PI;
  const steering = steeringRig(material, cube);
  group.add(sledTimber(material, cube, round, redSled), rider.group, steering);
  const wing = redSled ? null : flightWing();
  if (wing) group.add(wing);

  const mount = {
    hipY: .605, hipZ: -.39, hinge: .24, gaze: 0,
    feet: [-1, 1].map(side => new THREE.Vector3(side * .195, .423, .29)),
    grip: [.215, .754, .15],
  };
  const sled = { group, rider, steering, mount, wing, steer: 0, tuck: 0, brake: 0, landing: 0, airborne: false };
  poseSledRider(sled, { dx: 0, dy: 0, speed: 0 }, 0, 0, 0, 0);
  ownRenderedParts(rider.group);
  return sled;
}

export function poseSledRider(sled, run, dt, steer, tuck, brake, impact = 0) {
  const damping = 1 - Math.exp(-dt * 11);
  const weight = clamp(run.dx / 18 + steer * .2, -1, 1);
  sled.steer = mix(sled.steer, weight, damping);
  sled.tuck = mix(sled.tuck, tuck, damping);
  sled.brake = mix(sled.brake, brake, damping);
  sled.airborne = Boolean(run.air);
  sled.landing = Math.max(impact, sled.landing * Math.exp(-dt * 9));
  if (sled.wing) {
    sled.wing.visible = Boolean(run.upperRoute && run.d < run.flightUntil);
    if (sled.wing.visible) {
      const open = clamp((run.d - run.upperRoute.pickupD + 1.5) / 5, .28, 1);
      sled.wing.scale.set(open, .60 + .40 * open, 1);
      sled.wing.rotation.z = -.012 * run.dx;
    }
  }
  const { mount, steering } = sled;
  mount.hipY = .605 - .019 * sled.tuck - .052 * sled.landing;
  mount.hipZ = -.39 + .063 * sled.tuck - .034 * sled.brake;
  mount.hinge = .24 + .38 * sled.tuck - .13 * sled.brake + .15 * sled.landing;
  mount.gaze = -.24 * sled.steer;
  mount.grip[1] = .754 - .034 * sled.tuck;
  mount.grip[2] = .15 + .036 * sled.tuck;
  steering.position.set(0, mount.grip[1] - .02, -mount.grip[2]);
  steering.rotation.z = -.10 * sled.steer;
  sled.rider.animate(dt, {
    speed: run.speed, steer: 0, tuck: sled.tuck, brake: sled.brake, airborne: sled.airborne,
    grab: 0, crash: Boolean(run.crash), crashTime: 0, mount,
  });
}
