import * as THREE from 'three';
import { internationalLandmarkSite } from './international-landmark-sites.js';
import { pointInPolygon, segmentDistance } from './mapped-resort-ground.js';
import { liftPoint } from './mapped-lift-profile.js';
import { makeTextTexture, mulberry32 } from './util.js';
import { cacheStaticTransforms } from './scenery.js';
import { climateUniforms } from './climate-state.js';

const profiles = {
  'granite-peaks-lodge': {
    walls: 0x65574a, trim: 0x594537, roof: 0x344347, eave: 7.25, pitch: .49,
    title: 'GRANITE PEAKS LODGE', subtitle: 'T-BAR MARKET   •   BULL’S TOOTH', balcony: true, tickets: true, eaveOverhang: 1.45,
    front: [0, 1],
  },
  'tye-creek-lodge': {
    walls: 0x855d3e, trim: 0x544236, roof: 0x423f36, eave: 6.7, pitch: .31,
    title: 'TYE CREEK LODGE', subtitle: 'RENTALS   •   FOGGY GOGGLE', ticket: true,
  },
  'pacific-crest-lodge': {
    walls: 0xb4ad97, trim: 0x463b33, roof: 0x433c31, eave: 7.3, pitch: .25,
    title: 'PACIFIC CREST LODGE', subtitle: 'IRON GOAT PIZZERIA   •   FALL LINE SPORTS', awning: true, steps: true,
  },
  'school': {
    walls: 0x785a42, trim: 0x4d4036, roof: 0x454b42, eave: 4.8, pitch: .40,
    title: 'SKI & RIDE SCHOOL', subtitle: 'STEVENS PASS',
  },
};
const standardProfile = { walls: 0x766859, trim: 0x4e4134, roof: 0x414641, eave: 3.35, pitch: .37 };
const savoieProfiles = [
  { walls: 0x806249, trim: 0x4a352a, roof: 0x414448, eave: 4.75, pitch: .49 },
  { walls: 0x685649, trim: 0x3c332a, roof: 0x3b444a, eave: 5.35, pitch: .43 },
  { walls: 0x9c8871, trim: 0x503d30, roof: 0x4a4a49, eave: 4.40, pitch: .54 },
];

function textureSurface(color, kind, extra = {}) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .87, ...extra });
  material.customProgramCacheKey = () => 'stevens-building-' + kind;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 buildingPoint;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 buildingLocal = vec4(position,1.);
        #ifdef USE_INSTANCING
          buildingLocal = instanceMatrix * buildingLocal;
        #endif
        buildingPoint = (modelMatrix * buildingLocal).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 buildingPoint;
      float buildingHash(vec3 p) {
        p=fract(p*.1031); p+=dot(p,p.yzx+31.32); return fract((p.x+p.y)*p.z);
      }
    `).replace('#include <color_fragment>', `#include <color_fragment>
      vec3 v = buildingPoint;
      float fade = 1.-smoothstep(.27,1.40,length(fwidth(v))*9.);
      float grain = buildingHash(floor(v*vec3(66.,83.,65.)));
      ${kind === 'wood' ? `
      float course = abs(fract(v.y*5.5)-.5);
      float seam = fade * smoothstep(.446,.497,course);
      float board = buildingHash(vec3(floor(v.y*5.5),floor(v.x*.11),floor(v.z*.13)));
      float coarse = .5+.5*sin(v.y*116. + sin(v.x*9.1+v.z*3.)*3.);
      diffuseColor.rgb *= .81 + .245*board + .105*coarse*fade + .08*grain*fade - .34*seam;
      ` : kind === 'stone' ? `
      float band = floor(v.y*4.);
      vec2 grout = vec2(fract((v.x+v.z)*2.3+fract(band*.618)*.62),fract(v.y*4.));
      float join = smoothstep(.02,.09,min(grout.x,1.-grout.x)) * smoothstep(.03,.11,grout.y);
      float block = buildingHash(vec3(floor((v.x+v.z)*2.3+fract(band*.618)*.62),band,1.));
      diffuseColor.rgb *= mix(.44, .66+.46*block+.13*grain*fade,join);
      ` : `
      diffuseColor.rgb *= .93 + .08*sin(v.x*.77+sin(v.z*.56)) + .096*grain*fade;
      `}
    `);
  };
  return material;
}

function polygonBasis(points) {
  let ax = 1, az = 0, best = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length <= best) continue;
    best = length;
    ax = dx / length;
    az = dz / length;
  }
  const u = points.map(([x, z]) => x * ax + z * az);
  const v = points.map(([x, z]) => -x * az + z * ax);
  const u0 = (Math.max(...u) + Math.min(...u)) * .5;
  const v0 = (Math.max(...v) + Math.min(...v)) * .5;
  return {
    width: Math.max(...u) - Math.min(...u), depth: Math.max(...v) - Math.min(...v),
    center: [u0 * ax - v0 * az, u0 * az + v0 * ax],
    cross: (x, z) => -x * az + z * ax - v0,
  };
}

function shapeMesh(group, vertices, material) {
  if (!vertices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function quad(vertices, a, b, c, d) {
  vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
}

function triangleClip(points, cross, side) {
  const shape = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const da = cross(...a) * side, db = cross(...b) * side;
    if (da >= 0) shape.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      shape.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return shape;
}

function snowRoof(addShape, points, basis, eave, pitch, overhang, roof, snow) {
  const [cx, cz] = basis.center;
  const outline = points.map(([x, z]) => [cx + (x - cx) * (1 + overhang * 2 / basis.width),
    cz + (z - cz) * (1 + overhang * 2 / basis.depth)]);
  const roofY = ([x, z]) => eave + pitch * Math.max(0, basis.depth * .5 + overhang - Math.abs(basis.cross(x, z)));
  const snowY = (p) => roofY(p) + .18 + .08 * (Math.sin(p[0] * .74 + p[1] * .51) + 1);
  const surfaces = [], fascia = [];
  const contours = outline.map(p => new THREE.Vector2(...p));
  for (const indices of THREE.ShapeUtils.triangulateShape(contours, [])) {
    const face = indices.map(i => outline[i]);
    for (const side of [-1, 1]) {
      const clipped = triangleClip(face, basis.cross, side);
      if (clipped.length < 3) continue;
      for (let i = 1; i < clipped.length - 1; i++) {
        const a = clipped[0], b = clipped[i], c = clipped[i + 1];
        const order = (b[0] - a[0]) * (c[1] - a[1]) > (b[1] - a[1]) * (c[0] - a[0])
          ? [a, c, b] : [a, b, c];
        for (const p of order) surfaces.push(p[0], snowY(p), p[1]);
      }
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const da = basis.cross(...a), db = basis.cross(...b);
    const divisions = [a];
    if (da * db < 0) {
      const t = da / (da - db);
      divisions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    divisions.push(b);
    for (let j = 1; j < divisions.length; j++) {
      const p = divisions[j - 1], q = divisions[j];
      quad(fascia, [p[0], roofY(p) - .24, p[1]], [q[0], roofY(q) - .24, q[1]],
        [p[0], roofY(p) + .08, p[1]], [q[0], roofY(q) + .08, q[1]]);
      quad(surfaces, [p[0], roofY(p) + .08, p[1]], [q[0], roofY(q) + .08, q[1]],
        [p[0], snowY(p), p[1]], [q[0], snowY(q), q[1]]);
    }
  }
  addShape(fascia, roof);
  addShape(surfaces, snow);
  return { outline, roofY };
}

function indexLodgeRoofs() {
  const cells = new Map(), size = 24;
  const cell = value => Math.floor(value / size);
  return {
    add(outline, height) {
      const bounds = new THREE.Box2().setFromPoints(outline.map(point => new THREE.Vector2(...point)));
      const roof = { outline, height };
      for (let x = cell(bounds.min.x); x <= cell(bounds.max.x); x++) {
        for (let z = cell(bounds.min.y); z <= cell(bounds.max.y); z++) {
          const key = `${x}:${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(roof);
        }
      }
    },
    heightNear(x, z, radius) {
      let height = -Infinity;
      for (let i = cell(x - radius); i <= cell(x + radius); i++) {
        for (let j = cell(z - radius); j <= cell(z + radius); j++) {
          for (const roof of cells.get(`${i}:${j}`) ?? []) {
            if (roof.height <= height) continue;
            const { outline } = roof;
            if (pointInPolygon(x, z, outline) || outline.some(([ax, az], index) => {
              const [bx, bz] = outline[(index + 1) % outline.length];
              return segmentDistance(x, z, ax, az, bx, bz) <= radius;
            })) height = roof.height;
          }
        }
      }
      return height;
    },
  };
}

const mappedStationFootprints = new Set([
  '183549887', // Pas du Lac 1
  '250784923', // Pionniers
  '99265917', // Saulire Express 1
  '37718798', // Tougnète 1
]);

function replacesLiftTerminal(building, points, basis, terminals) {
  // The mapped structure enclosing a lift endpoint is often the station's
  // own machinery hood. The open generated terminal already models it.
  const namedStation = /^ski lift$|lift station|wheelhouse|gondola|télécabine|aerial tram/i.test(building.name ?? '');
  const compactStructure = !building.name && !building.height && !building.levels
    && basis.width <= 34 && basis.depth <= 16;
  return (namedStation || compactStructure || mappedStationFootprints.has(building.osmId)) &&
    terminals.some(({ x, z }) => pointInPolygon(x, z, points));
}

const batchSide = 210;
const buildingCell = (x,z) => `${Math.floor(x / batchSide)}:${Math.floor(z / batchSide)}`;

function batchBoxes(group, spatial) {
  const entries = new Map();
  const placeholder = new THREE.Object3D();
  function add(material, x, y, z, width, height, depth, yaw = 0, lean = 0) {
    placeholder.position.set(x, y, z);
    placeholder.scale.set(width, height, depth);
    placeholder.rotation.set(0, yaw, lean, 'YXZ');
    placeholder.updateMatrix();
    if (!entries.has(material)) entries.set(material, new Map());
    const cells = entries.get(material), id = spatial ? buildingCell(x,z) : '';
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id).push(placeholder.matrix.clone());
  }
  function flush() {
    const geometry = new THREE.BoxGeometry();
    const batches = [];
    for (const [material, cells] of entries) for (const matrices of cells.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      batches.push(mesh);
    }
    return batches;
  }
  return { add, flush };
}

function batchSurfaces(group) {
  const cells = new Map();
  return {
    at(x,z) {
      const id = buildingCell(x,z);
      if (!cells.has(id)) cells.set(id,new Map());
      const surfaces = cells.get(id);
      return (vertices, material) => {
        if (!vertices.length) return;
        if (!surfaces.has(material)) surfaces.set(material, []);
        surfaces.get(material).push(vertices);
      };
    },
    flush() {
      for (const surfaces of cells.values()) for (const [material, parts] of surfaces) {
        const vertices = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        for (const part of parts) { vertices.set(part,offset); offset += part.length; }
        shapeMesh(group, vertices, material);
      }
    },
  };
}

function windowBays(add, trim, glasses, { x, y, z, width, height, yaw, seed, addGlass = add }) {
  const fill = glasses[Math.floor(seed * glasses.length)];
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  add(trim, x, y, z, width + .18, height + .16, .15, yaw);
  addGlass(fill, x + nx * .095, y, z + nz * .095, width, height, .06, yaw);
  const divisions = width > 2.9 ? 3 : 2;
  for (let i = 1; i < divisions; i++) {
    const u = width * (i / divisions - .5);
    add(trim, x + ux * u + nx * .14, y, z + uz * u + nz * .14, .065, height, .045, yaw);
  }
  add(trim, x + nx * .14, y + .14 * height, z + nz * .14, width, .095, .05, yaw);
  add(trim, x + nx * .14, y - height * .5 - .07, z + nz * .14, width + .24, .12, .28, yaw);
}

function facadeSign(group, x, y, z, yaw, width, profile, dark, palette) {
  const material = new THREE.MeshStandardMaterial({
    map: makeTextTexture(profile.title, { sub: profile.subtitle, bg: dark ? '#433129' : '#322c2b',
      fg: '#fcf0d7', accent: '#f4a74e', width: 1024, height: 200,
      font: '800 64px "Barlow Condensed", Arial, sans-serif', ...palette }),
    roughness: .83,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width * .195), material);
  sign.position.set(x, y, z);
  sign.rotation.y = yaw;
  group.add(sign);
}

export function buildMappedLodges(scene, config, ground, env, initialQuality = 'BALANCED') {
  const group = new THREE.Group();
  group.name = `${config.name} · lodges and base landmarks`;
  const spatial = (config.buildings?.length ?? 0) > 160;
  const boxes = batchBoxes(group, spatial);
  const facadeBoxes = spatial ? batchBoxes(group, true) : boxes;
  const surfaces = spatial ? batchSurfaces(group) : null;
  const add = boxes.add;
  const palette = new Map();
  const snow = textureSurface(0xeaf2f5, 'snow', { side: THREE.DoubleSide });
  const stone = textureSurface(0x777c76, 'stone', { side: THREE.DoubleSide });
  const iron = new THREE.MeshStandardMaterial({ color: 0x252e29, roughness: .55, metalness: .39 });
  const glasses = [0x42585e, 0x546267, 0x637775, 0x816754, 0x978569].map((color, i) =>
    new THREE.MeshStandardMaterial({ color, roughness: .36, metalness: .14,
      emissive: i > 2 ? 0xdf9e58 : 0x829eb0, emissiveIntensity: i > 2 ? .19 : .07 }));
  const savoy = config.id === 'les-3-vallees';
  const villageWindows = savoy ? batchBoxes(group, true) : null;
  const warmGlasses = savoy ? [0x3a3d46, 0x664a35, 0x836345, 0xac824e, 0x76706c].map((color, i) =>
    new THREE.MeshStandardMaterial({ color, roughness: .47, emissive: i === 4 ? 0xd4c3ac : 0xffb66c,
      emissiveIntensity: .05 })) : glasses;
  const orange = new THREE.MeshStandardMaterial({ color: 0xa8471e, roughness: .76 });
  const navy = new THREE.MeshStandardMaterial({ color: 0x1c4d9c, roughness: .79, side: THREE.DoubleSide });
  const white = new THREE.MeshStandardMaterial({ color: 0xc9c6b8, roughness: .79, side: THREE.DoubleSide });
  const rand = mulberry32(841675);
  const clock = config.id === 'stevens-pass' && config.landmarks?.find(landmark => landmark.id === 'clock-tower');
  const roofs = indexLodgeRoofs();
  env.roofHeightNear = roofs.heightNear;
  const terminals = (config.lifts ?? []).filter(lift => lift.kind !== 'surface' && lift.points?.length > 1)
    .flatMap(lift => [liftPoint(lift.points[0]), liftPoint(lift.points.at(-1))]);
  const customBuildings = internationalLandmarkSite(config.id)?.buildings;
  for (const building of config.buildings ?? []) {
    if (customBuildings?.includes(building.osmId)) continue;
    const points = building.points.filter((point, i) => {
      const next = building.points[(i + 1) % building.points.length];
      return Math.hypot(point[0] - next[0], point[1] - next[1]) > .18;
    });
    if (points.length < 3) continue;
    const basis = polygonBasis(points);
    if (Math.min(basis.width, basis.depth) < .95) continue;
    if (replacesLiftTerminal(building, points, basis, terminals)) continue;
    const precise = profiles[building.id] || Object.values(profiles).find(p =>
      p.title === building.name?.toUpperCase()) || (/ski (and|&) ride school|ski.+snowboard school/i.test(building.name) ? profiles.school : null);
    const [cx, cz] = basis.center;
    const chalet = savoy && !precise && cx > -4400 && cx < -1060 && cz > -11600 && cz < -3960;
    const church = chalet && building.kind === 'church';
    const profile = precise || (chalet ? savoieProfiles[Math.floor(rand() * savoieProfiles.length)] : standardProfile);
    const addFacade = precise ? add : facadeBoxes.add;
    if (!palette.has(profile)) palette.set(profile,{
      trim: textureSurface(profile.trim, 'wood', { side: THREE.DoubleSide }),
      walls: textureSurface(profile.walls, 'wood', { side: THREE.DoubleSide }),
      roof: new THREE.MeshStandardMaterial({ color: profile.roof, roughness: .74, side: THREE.DoubleSide }),
    });
    const { trim,walls,roof } = palette.get(profile);
    const addShape = surfaces?.at(cx,cz) ?? ((vertices,material)=>shapeMesh(group,vertices,material));
    const cy = ground.heightAt(cx, cz);
    const base = cy + .08;
    const storeys = chalet && (building.levels || (basis.width * basis.depth > 420 ? 3 : 2));
    const eave = base + (building.height ? Math.min(16, building.height * .76) : storeys > 2 ? Math.min(13, storeys * 2.48) : profile.eave);
    const pitch = Math.min(profile.pitch, 10.8 / basis.depth);
    const overhang = precise?.eaveOverhang ?? (precise ? .78 : chalet ? .65 : .34);
    const { outline, roofY: riseAt } = snowRoof(addShape, points, basis, eave, pitch, overhang, roof, snow);
    const ridge = eave + pitch * (basis.depth * .5 + overhang);
    roofs.add(outline, ridge + (precise?.balcony ? 1.66 : .34));
    const foundation = [], siding = [];
    const centroid = points.reduce((p, [x, z]) => [p[0] + x / points.length, p[1] + z / points.length], [0, 0]);
    const plaza = clock?.point ?? [cx, cz - 14];
    const plazaDir = precise?.front ? new THREE.Vector2(...precise.front)
      : new THREE.Vector2(plaza[0] - cx, plaza[1] - cz).normalize();
    const orientation = Math.sign(THREE.ShapeUtils.area(points.map(p => new THREE.Vector2(...p))));
    const edges = points.map((a, i) => {
      const b = points[(i + 1) % points.length], dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      const nx = orientation * dz / length, nz = -orientation * dx / length;
      const toward = nx * plazaDir.x + nz * plazaDir.y;
      const score = precise?.front && length > 8 ? Math.sqrt(length) * (2 + 3 * toward) : length * (.64 + .36 * toward);
      return { a, b, dx, dz, length, nx, nz, score };
    });
    const front = edges.reduce((best, edge) => edge.score > best.score ? edge : best, edges[0]);
    for (const edge of edges) {
      const { a, b, dx, dz, length, nx, nz } = edge;
      const [ax, az] = a, [bx, bz] = b;
      const steps = Math.ceil(length / 3.7);
      const yard = edge === front;
      const x = (ax + bx) * .5, z = (az + bz) * .5;
      const yaw = Math.atan2(nx, nz);
      const hw = length * .5;
      const localGround = ground.heightAt(x + nx * 1.2, z + nz * 1.2);
      const rockTop = Math.min(eave - 1.1, Math.max(base + (chalet ? 1.24 : .7), localGround + .27));
      for (let i = 0; i < steps; i++) {
        const f = i / steps, g = (i + 1) / steps;
        const p = [ax + dx * f, az + dz * f], q = [ax + dx * g, az + dz * g];
        quad(foundation, [p[0], ground.heightAt(...p) - 1.95, p[1]], [q[0], ground.heightAt(...q) - 1.95, q[1]],
          [p[0], rockTop, p[1]], [q[0], rockTop, q[1]]);
      }
      const splits = [a];
      const da = basis.cross(...a), db = basis.cross(...b);
      if (da * db < 0) splits.push([ax + dx * da / (da - db), az + dz * da / (da - db)]);
      splits.push(b);
      for (let i = 1; i < splits.length; i++) {
        const p = splits[i - 1], q = splits[i];
        quad(siding, [p[0], rockTop, p[1]], [q[0], rockTop, q[1]],
          [p[0], riseAt(p), p[1]], [q[0], riseAt(q), q[1]]);
      }
      env.addBox(x, z, hw, .29, -yaw, 'building', { minY: Math.min(localGround - 1, cy - 5), maxY: eave + .6 });
      const local = (u, height, depth) => [x + Math.cos(yaw) * u + nx * depth, height,
        z - Math.sin(yaw) * u + nz * depth];
      const piece = (mat, u, y, depth, w, h, d, lean = 0) => addFacade(mat, ...local(u, y, depth), w, h, d, yaw, lean);
      if (length > 2.2) {
        piece(trim, 0, eave - .15, .025, length, .31, .19);
        for (const u of [-hw + .13, hw - .13]) piece(trim, u, (eave + rockTop) * .5, .085, .21, eave - rockTop, .22);
      }
      if (!precise && length < (chalet ? 4.6 : 7.5)) continue;
      const bays = Math.max(1, Math.floor(length / (precise ? 4.25 : chalet ? 4.7 : 5.1)));
      const width = length / (bays || 1);
      const floors = chalet && !church ? Math.min(4, Math.max(1, Math.floor((eave - base - .15) / 2.10)))
        : precise && profile.eave > 6 ? 2 : 1;
      for (let floor = 0; floor < floors; floor++) {
        const y = base + (chalet ? 2.10 + 2.19 * floor : floor ? 4.82 : 2.10);
        if (y < rockTop + .45 || y > eave - .72) continue;
        for (let j = 0; j < bays; j++) {
          const door = yard && !floor && j === Math.floor(bays / 2);
          const u = -hw + width * (j + .5);
          const [wx, wy, wz] = local(u, door ? Math.max(base, localGround) + 1.23 : y, .05);
          windowBays(addFacade, trim, chalet && !church ? warmGlasses : glasses,
            { x: wx, y: wy, z: wz, width: door ? Math.min(2.2, width * .65) : width * (chalet ? .49 : .70),
              height: door ? 2.30 : floor && !chalet ? 1.70 : 1.32, yaw, seed: rand(),
              addGlass: chalet ? villageWindows.add : addFacade });
          if (floor && profile.ticket) piece(iron, u, y + 1.15, .12, .16, .27, .28);
        }
        if (chalet && !church && yard && floor && length > 7 && rand() < .72) {
          const balcony = length * .71, deck = y - .70;
          piece(trim,0,deck,.59,balcony,.17,1.18);
          piece(snow,0,deck+.1,.60,balcony,.065,1.15);
          piece(trim,0,deck+.80,1.17,balcony,.065,.09);
          piece(trim,0,deck+.29,1.17,balcony,.07,.09);
          const spans = Math.ceil(balcony / .54);
          for (let k = 0; k <= spans; k++) piece(trim,balcony*(k/spans-.5),deck+.45,1.17,.039,.72,.043);
        }
      }
      if (!precise || !yard || length < 9) continue;
      const titleWidth = Math.min(11.5, length * .61);
      const titleY = Math.min(eave + .3, base + (profile.balcony ? 6.42 : profile.steps ? 4.6 : 3.45));
      facadeSign(group, ...local(0, titleY, .29), yaw, titleWidth, profile, profile.awning,
        profile.steps ? { bg: '#d4cabc', fg: '#a23229', accent: '#7a6c5e' } : null);
      const patio = Math.min(18.6, length * .80);
      if (profile.awning) {
        piece(orange, 0, base + 6.73, 1.1, patio, .18, 2.22);
        piece(snow, 0, base + 6.88, 1.1, patio + .1, .17, 2.32);
      }
      if (profile.steps) {
        const [bx,,bz] = local(0,0,4.58), apronY = ground.heightAt(bx,bz);
        const terraceY = Math.max(base + .11, localGround + .35, apronY + .89);
        // The lodge apron has a central snow-clear stair, with the fenced
        // private-lesson terrace to either side.
        const range = Math.min(5.6,patio*.5), stepWidth = 2.3;
        const topDepth = 2.61, outerDepth = 4.64;
        piece(stone,0,terraceY-.19,1.23,patio,.42,2.76);
        for (const side of [-1,1]) {
          const center = side * ((range + stepWidth*.5) / 2), span = range-stepWidth*.5;
          piece(stone, center, (terraceY+apronY-.14)*.5, 3.02, span, Math.max(.35,terraceY-apronY+.14), 1.34);
          piece(snow, center, terraceY + .10, 3.02, span + .10, .27, 1.47);
          for (let i=0;i<=5;i++) {
            const u = side*(stepWidth*.5+span*i/5);
            piece(navy,u,terraceY+.64,3.10,.054,1.2,.061);
          }
          for (const h of [.27,.58,.94]) piece(navy,center,terraceY+h,3.10,span,.066,.067);
          for (let i=0;i<22;i++) {
            const u = center+span*(i/21-.5);
            piece(navy,u,terraceY+.55,3.10,.020,.68,.024,i % 2 ? -.17 : .17);
          }
        }
        for(let i=0;i<6;i++) {
          const f = (i+1)/6, depth = topDepth+(outerDepth-topDepth)*f;
          const h = Math.max(.08,(terraceY - apronY)*(1-f)+.08);
          piece(stone,0,apronY + h*.50,depth,stepWidth+.13,h,.52);
          for(const side of [-1,1]) piece(iron,side*1.17,apronY+h+.48,depth,.043,.97,.043);
        }
      }
      if (profile.balcony) {
        piece(trim, 0, base + 3.59, 1.65, patio, .28, 3.3);
        piece(snow, 0, base + 3.76, 1.65, patio, .13, 3.24);
        piece(trim, 0, base + 4.83, 3.21, patio, .14, .16);
        piece(trim, 0, base + 4.03, 3.21, patio, .10, .08);
        for (let u = -patio * .5; u <= patio * .5; u += .34) piece(iron, u, base + 4.43, 3.21, .042, .85, .042);
        for (let u = -patio * .47; u <= patio * .5; u += patio / (profile.tickets ? 3 : 4)) {
          const [px, , pz] = local(u, 0, 2.98);
          const y = ground.heightAt(px, pz);
          const top = base + 3.63;
          if (y > top - .26) continue;
          const width = profile.tickets ? .93 : .25;
          piece(profile.tickets ? stone : trim, u, (y + top) * .5, 2.98, width, top - y, width+.03);
          if (profile.tickets) {
            piece(stone,u,y+.15,2.98,1.09,.36,1.11);
            piece(white,u,top-.095,2.98,1.04,.21,1.04);
          }
          env.addCircle(px, pz, width*.5, 'building', { minY: y, maxY: top });
        }
        if (profile.tickets) {
          piece(white,0,base+3.55,3.38,patio+.10,.73,.29);
          piece(orange,0,base+3.88,3.53,patio+.18,.087,.083);
          facadeSign(group, ...local(0, base + 3.54, 3.561), yaw, Math.min(3.4, patio * .31),
            { title: 'TICKETS', subtitle: '' }, false, { bg: '#c9c6b8', fg: '#a23229' });
          for (const u of [-patio*.39,-patio*.16,patio*.07]) {
            piece(iron,u,base+.63,3.28,patio*.19,.057,.075);
            piece(iron,u,base+.085,3.28,patio*.19,.057,.075);
            for(let i=0;i<8;i++) piece(iron,u+patio*.19*(i/7-.5),base+.35,3.28,.033,.57,.045);
          }
        }
      }
      // Ski racks immediately outside each lodge entrance.
      for (const u of [-patio * .44, patio * .44]) {
        const [rx, , rz] = local(u, 0, profile.balcony ? 5.2 : 4.2);
        const y = ground.heightAt(rx, rz);
        piece(iron, u, y + .76, profile.balcony ? 5.2 : 4.2, 3.38, .11, .13);
        for (const du of [-1.59, 1.59]) piece(iron, u + du, y + .42, profile.balcony ? 5.2 : 4.2, .1, 1.03, .11);
      }
    }
    addShape(foundation, stone);
    addShape(siding, walls);
    if (church) {
      const [px,pz] = centroid;
      const roofY = riseAt(centroid);
      const lower = roofY - 1.35, upper = roofY + 3.55, half = 1.46;
      add(stone, px, (lower+upper)/2, pz, half*2, upper-lower, half*2);
      for (const side of [-1,1]) {
        add(iron, px+side*(half+.018), upper-1.09, pz, .045, 1.25, .62);
        add(iron, px, upper-1.09, pz+side*(half+.018), .62, 1.25, .045);
      }
      const cap = [[px-1.68,upper,pz-1.68],[px+1.68,upper,pz-1.68],
        [px+1.68,upper,pz+1.68],[px-1.68,upper,pz+1.68]];
      const spire = [px,upper+3.1,pz];
      addShape(cap.flatMap((point,i) => [...point,...cap[(i+1)%4],...spire]),roof);
      add(iron, px, spire[1]+.39, pz, .075, .84, .075);
      add(iron, px, spire[1]+.56, pz, .45, .075, .075);
    }
    if (precise?.balcony && points.length > 3) {
      const [px, pz] = centroid;
      const chimneyY = riseAt([px, pz]);
      add(stone, px, chimneyY + .46, pz, 1.39, 2.1, 1.1);
      add(snow, px, chimneyY + 1.56, pz, 1.54, .19, 1.25);
    }
  }
  if (clock) buildClock(group, clock.point, ground, env, add, snow, stone, orange, iron);
  surfaces?.flush();
  boxes.flush();
  const windowMeshes = villageWindows?.flush() ?? [];
  for (const mesh of windowMeshes) mesh.castShadow = false;
  const facadeMeshes = spatial ? facadeBoxes.flush() : [];
  let budget = initialQuality === 'BUDGET', lastX = Infinity, lastZ = Infinity;
  function setQuality(name) {
    if (budget === (name === 'BUDGET')) return;
    budget = name === 'BUDGET';
    lastX = lastZ = Infinity;
  }
  function update(camera) {
    if (savoy) {
      const night = climateUniforms.night.value;
      const brightness = [.025, .59, 1.29, 1.85, .43];
      warmGlasses.forEach((material,i) => { material.emissiveIntensity = .018 + night*brightness[i]; });
    }
    const { x, z } = camera.position;
    if (Number.isFinite(lastX) && (!budget || (lastX - x) ** 2 + (lastZ - z) ** 2 < 32 ** 2)) return;
    lastX = x;
    lastZ = z;
    for (const mesh of facadeMeshes) {
      const { center, radius } = mesh.boundingSphere;
      const range = radius + (mesh.visible ? 630 : 565);
      const visible = !budget || (center.x - x) ** 2 + (center.z - z) ** 2 < range ** 2;
      if (mesh.visible && !visible) mesh.dispose();
      mesh.visible = visible;
    }
  }
  scene.add(group);
  cacheStaticTransforms(group);
  group.setQuality = setQuality;
  group.updateDetail = update;
  return group;
}

function buildClock(group, [x, z], ground, env, add, snow, stone, orange, iron) {
  const y = ground.heightAt(x, z), shaft = textureSurface(0x684934, 'wood');
  const trim = textureSurface(0x4c3528, 'wood', { side: THREE.DoubleSide });
  const siding = textureSurface(0xaea28b, 'wood', { side: THREE.DoubleSide });
  const face = new THREE.MeshStandardMaterial({ color: 0xf6f0cd, emissive: 0xf6c682, emissiveIntensity: .22, roughness: .67 });
  const tower = new THREE.Group();
  tower.name = 'Stevens Pass Clock Tower';
  tower.position.set(x, y, z);
  group.add(tower);
  add(stone, x, y + .28, z, 2.38, .9, 2.38);
  add(snow, x, y + .75, z, 2.43, .12, 2.43);
  add(siding, x, y + 7.00, z, 2.17, 1.94, 2.17);
  for (const v of [-.92, .92]) for (const u of [-.92, .92]) add(shaft, x + u, y + 3.53, z + v, .27, 5.61, .27);
  for (const h of [.88, 3.49, 6.02]) {
    for (const edge of [-.93, .93]) {
      add(shaft, x, y + h, z + edge, 2.01, .20, .24);
      add(shaft, x + edge, y + h, z, .24, .20, 2.01);
    }
  }
  for (const h of [2.18, 4.76]) for (const edge of [-.91, .91]) for (const lean of [-.64, .64]) {
    add(shaft, x, y + h, z + edge, .16, 3.11, .13, 0, lean);
    add(shaft, x + edge, y + h, z, .16, 3.11, .13, Math.PI / 2, lean);
  }
  add(trim, x, y + 6.02, z, 2.26, .16, 2.26);
  const roofDepth = 1.31, ridge = 8.93, eave = 7.83;
  const gables = [], fascia = [], snowPanels = [];
  function panel(points, position, output) {
    const rotation = new THREE.Matrix4().makeRotationY(position * Math.PI / 2);
    for (const p of points) output.push(...new THREE.Vector3(...p).applyMatrix4(rotation).toArray());
  }
  for (let i = 0; i < 4; i++) {
    panel([[-1.08,eave,1.09],[1.08,eave,1.09],[0,ridge-.18,1.09]], i, gables);
    for (const side of [-1, 1]) {
      const edge = [side * roofDepth, eave, roofDepth], mid = [0, ridge, roofDepth], center = [0, ridge, 0];
      panel([edge, mid, center], i, snowPanels);
      const lower = ([u, h, v]) => [u, h - .15, v];
      panel([edge, lower(edge), mid, mid, lower(edge), lower(mid)], i, fascia);
    }
  }
  shapeMesh(tower, gables, siding);
  shapeMesh(tower, fascia, trim);
  shapeMesh(tower, snowPanels.map((value, index) => value + (index % 3 === 1 ? .08 : 0)), snow);
  add(iron, x, y + 9.05, z, .094, .32, .094);
  add(orange, x, y + 9.21, z, .21, .17, .21);
  const ring = new THREE.CylinderGeometry(.65, .65, .085, 48);
  const glass = new THREE.CylinderGeometry(.56, .56, .105, 48);
  ring.rotateX(Math.PI / 2);
  glass.rotateX(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const dial = new THREE.Group();
    dial.position.set(Math.sin(i * Math.PI / 2) * 1.12, 7.03, Math.cos(i * Math.PI / 2) * 1.12);
    dial.rotation.y = i * Math.PI / 2;
    dial.add(new THREE.Mesh(ring, iron), new THREE.Mesh(glass, face));
    const marks = new THREE.InstancedMesh(new THREE.BoxGeometry(.035, .10, .024), iron, 12);
    const dummy = new THREE.Object3D();
    for (let tick = 0; tick < 12; tick++) {
      const t = Math.PI * 2 * tick / 12;
      dummy.rotation.z = -t;
      dummy.position.set(Math.sin(t) * .46, Math.cos(t) * .46, .064);
      dummy.updateMatrix();
      marks.setMatrixAt(tick, dummy.matrix);
    }
    marks.instanceMatrix.needsUpdate = true;
    dial.add(marks);
    for (const [length, angle] of [[.30, .93], [.44, -1.03]]) {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(.048, length, .023), iron);
      hand.rotation.z = angle;
      hand.position.set(-Math.sin(angle) * length * .36, Math.cos(angle) * length * .36, .081);
      dial.add(hand);
    }
    tower.add(dial);
  }
  for (const side of [-1, 1]) {
    const [bx, bz] = [x + side * 4.15, z + 2.5];
    const by = ground.heightAt(bx, bz);
    add(shaft, bx, by + .56, bz, 2.16, .15, .44);
    add(snow, bx, by + .66, bz, 2.2, .16, .48);
    for (const u of [-.78, .78]) add(iron, bx + u, by + .27, bz, .11, .57, .41);
  }
  add(orange, x + .75, y + 2.52, z + .989, .42, .49, .05);
  env.addBox(x, z, 1.16, 1.16, 0, 'building', { minY: y - .5, maxY: y + 9.4 });
}
