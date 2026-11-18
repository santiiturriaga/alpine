import * as THREE from 'three';
import { box, mergeParts, part } from './scenery.js';
import { lerp, makeCanvas, makeTextTexture, mulberry32 } from './util.js';
import { GEMINI_TRAVERSE, STEVENS_CREEKS } from './stevens-pass-terrain.js';

const steel = '#697878';
const snow = '#edf3f4';
const darkWood = '#46352b';

// OSM 41445468, Chief Joseph–Monroe, as it crosses Gemini in Mill Valley.
export const STEVENS_POWERLINE = [
  [117.5,2087.8], [529.1,1928.5], [978.5,1717.6], [1158.5,1629.3],
  [1372.9,1643.9], [1557.5,1660.2], [1607,1664.6], [1839.9,1685.2], [1938.7,1545.9],
];

function strut(a, b, width, color) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const length = to.clone().sub(from);
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion()
    .setFromUnitVectors(new THREE.Vector3(0, 0, 1), length.clone().normalize()));
  return box(width, width, length.length(), color, from.lerp(to, .5).toArray(), rotation.toArray());
}

function buildParts(group, parts, name, roughness = .81) {
  const geometry = mergeParts(parts);
  for (const item of parts) item.geo.dispose();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness }));
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function pylons(group, ground, env) {
  const wires = new THREE.MeshStandardMaterial({ color: '#36454c', roughness: .66 });
  const phases = [-7.4, 0, 7.4];
  const heights = [26, 24, 26];
  const heads = [];
  const pieces = [];
  const pad = [-1, 1].flatMap(x => [-1, 1].map(z => [x, z]));
  for (let i = 0; i < STEVENS_POWERLINE.length; i++) {
    const [x, z] = STEVENS_POWERLINE[i], y = ground.heightAt(x, z);
    const a = STEVENS_POWERLINE[Math.max(0, i - 1)];
    const b = STEVENS_POWERLINE[Math.min(STEVENS_POWERLINE.length - 1, i + 1)];
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]), s = Math.sin(yaw), c = Math.cos(yaw);
    const at = (u, v, w) => [x + u * c + w * s, y + v, z - u * s + w * c];
    const radius = h => 3.15 - h * .105;
    for (const [u, v] of pad) {
      const foot = at(u * 3.15, 0, v * 3.15);
      const footY = ground.heightAt(foot[0], foot[2]);
      pieces.push(box(1.12, .62, 1.12, '#929490', [foot[0], footY + .07, foot[2]]));
      pieces.push(strut([foot[0], footY + .15, foot[2]], at(u * radius(28), 28, v * radius(28)), .18, steel));
      env.addCircle(foot[0], foot[2], .57, 'utility-pylon', { minY: footY - .3, maxY: footY + 3.8 });
    }
    for (let h = 3; h < 28; h += 3.5) {
      const base = radius(h), top = radius(h + 3.5);
      for (const side of [-1, 1]) {
        pieces.push(strut(at(-base,h,side*base), at(top,h+3.5,side*top), .116, steel));
        pieces.push(strut(at(base,h,side*base), at(-top,h+3.5,side*top), .116, steel));
        pieces.push(strut(at(side*base,h,-base), at(side*top,h+3.5,top), .116, steel));
        pieces.push(strut(at(side*base,h,base), at(side*top,h+3.5,-top), .116, steel));
        pieces.push(strut(at(-base,h,side*base), at(base,h,side*base), .094, steel));
        pieces.push(strut(at(side*base,h,-base), at(side*base,h,base), .094, steel));
      }
    }
    pieces.push(strut(at(-8.2,28,0), at(8.2,28,0), .194, steel));
    for (const side of [-1, 1]) pieces.push(strut(at(side*1.2,25.6,0), at(side*7.7,28,0), .13, steel));
    const sockets = [];
    for (let n = 0; n < phases.length; n++) {
      const u = phases[n], h = heights[n];
      pieces.push(strut(at(u,28,0), at(u,h,0), .112, '#779598'));
      for (let d = h; d < 28; d += .29) {
        pieces.push(part(new THREE.CylinderGeometry(.17,.17,.055,7), '#9aa8a5', at(u,d,0)));
      }
      sockets.push(...[-.24, .24].map(side => at(u + side, h, 0)));
    }
    heads.push(sockets);
  }
  const bundled = [];
  for (let i = 1; i < heads.length; i++) {
    for (let line = 0; line < heads[i].length; line++) {
      const a = new THREE.Vector3(...heads[i - 1][line]), b = new THREE.Vector3(...heads[i][line]);
      const drop = Math.min(12, Math.hypot(b.x - a.x, b.z - a.z) * .036);
      const points = Array.from({ length: 11 }, (_, j) => {
        const t = j / 10, p = a.clone().lerp(b, t);
        p.y -= 4 * drop * t * (1 - t);
        return p;
      });
      bundled.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 25, .052, 5, false), '#39444b'));
    }
  }
  buildParts(group, pieces, 'Chief Joseph–Monroe lattice towers');
  const steelCables = buildParts(group, bundled, 'Mill Valley transmission cables', .66);
  steelCables.material.dispose();
  steelCables.material = wires;
  steelCables.castShadow = false;
}

function drawCreeks(group, ground) {
  const material = new THREE.MeshStandardMaterial({
    color: '#25373b', roughness: .26, metalness: .19, side: THREE.DoubleSide,
  });
  for (const { points } of STEVENS_CREEKS) {
    const vertices = [], index = [];
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const segments = Math.ceil(curve.getLength() / .8);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, p = curve.getPointAt(t), v = curve.getTangentAt(t);
      const fade = Math.sin(Math.PI * t) ** .35;
      const width = (.48 + Math.sin(i * .42) * .095) * fade;
      for (const side of [-1, 1]) {
        const x = p.x + side * v.z * width, z = p.z - side * v.x * width;
        vertices.push(x, ground.heightAt(x, z) + .052, z);
      }
      if (i > 0) index.push(i*2-2, i*2-1, i*2, i*2, i*2-1, i*2+1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const bed = new THREE.Mesh(geometry, material);
    bed.receiveShadow = true;
    bed.name = 'Tye River · open creek channel';
    group.add(bed);
  }
}

function parking(group, config, ground, env, pointInPolygon) {
  const colors = ['#566775', '#acb0ab', '#51473f', '#a7a693', '#315053', '#694341', '#3d4347'];
  const random = mulberry32(200131);
  for (const lot of config.parking) {
    const { points } = lot;
    if (points.length < 4 || Math.hypot(...points[0]) > 620) continue;
    let yaw = 0, longest = 0;
    for (let i = 1; i < points.length; i++) {
      const u = points[i][0] - points[i - 1][0], v = points[i][1] - points[i - 1][1];
      const distance = Math.hypot(u, v);
      if (distance > longest) { longest = distance; yaw = Math.atan2(u, v); }
    }
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const rows = points.map(([x,z]) => x*sin + z*cos);
    const spans = points.map(([x,z]) => x*cos - z*sin);
    const pieces = [];
    const minRow = Math.min(...rows) + 8, maxRow = Math.max(...rows) - 8;
    const minSpan = Math.min(...spans) + 3.5, maxSpan = Math.max(...spans) - 3.5;
    let cars = 0;
    for (let lane = minSpan; lane < maxSpan; lane += 12.8) {
      for (let bay = minRow; bay < maxRow; bay += 4.1) {
        const x = lane*cos + bay*sin, z = bay*cos - lane*sin;
        if (cars >= 29 || random() < .45 || !pointInPolygon(x, z, points) || Math.hypot(x+152,z+39) < 5.8) continue;
        if (![[-2.7,-1.45],[-2.7,1.45],[2.7,-1.45],[2.7,1.45]].every(([dx,dz]) =>
          pointInPolygon(x + dx*cos + dz*sin, z + dz*cos - dx*sin, points))) continue;
        const y = ground.heightAt(x, z);
        if (!env.isOpen(x, y + .6, z, 2.2) || ground.normalAt(x, z).y < .9) continue;
        const carYaw = yaw + (random() < .55 ? Math.PI / 2 : -Math.PI / 2);
        const carSin = Math.sin(carYaw), carCos = Math.cos(carYaw);
        const at = (u,h,v) => [x + u*carCos + v*carSin, y + h, z - u*carSin + v*carCos];
        const paint = colors[Math.floor(random() * colors.length)], height = .51 + random() * .35;
        const make = (w,h,d,tint,loc) => pieces.push(box(w,h,d,tint,at(...loc),[0,carYaw,0]));
        make(1.81,.50,4.53,paint,[0,.61,0]);
        make(1.57,height,2.43,'#323e44',[0,.84+height/2,-.16]);
        make(1.61,.09,2.46,paint,[0,.84+height,-.15]);
        make(1.61,.064,2.44,snow,[0,.90+height,-.13]);
        make(1.67,.07,.89,paint,[0,.912,1.52]);
        make(1.75,.17,.12,'#263139',[0,.48,2.22]);
        make(1.75,.14,.11,'#263139',[0,.47,-2.20]);
        for (const side of [-1,1]) {
          make(.32,.12,.06,'#dadccb',[side*.66,.71,2.28]);
          make(.30,.13,.06,'#a33830',[side*.67,.67,-2.26]);
          make(.064,height+.03,.085,paint,[side*.80,.84+height/2,-.61]);
          for (const axle of [-1.44,1.34]) {
            const tire = new THREE.CylinderGeometry(.355,.355,.22,10).rotateZ(Math.PI/2);
            pieces.push(part(tire,'#232626',at(side*.82,.33,axle),[0,carYaw,0]));
          }
        }
        env.addBox(x, z, .92, 2.26, -carYaw, 'parked-car', { minY: y, maxY: y + height + 1 });
        cars++;
      }
    }
    if (!pieces.length) continue;
    buildParts(group, pieces, 'Parking lot ' + lot.name + ' · parked vehicles', .59);
  }
}

function directionalSign(group, ground, env, x, z, heading, title, details, width = 3.3) {
  const at = new THREE.Group();
  at.position.set(x, ground.heightAt(x, z), z);
  at.rotation.y = heading;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, width * .263), new THREE.MeshStandardMaterial({
    map: makeTextTexture(title, { sub: details, width: 800, height: 210, bg: '#202a2c', fg: '#f7f2e1',
      accent: '#f0d293', font: '800 61px "Barlow Condensed", Arial' }),
    roughness: .82,
  }));
  face.position.set(0, 1.72, .065);
  at.add(face);
  const posts = [box(width, width * .263, .115, darkWood,[0,1.72,0])];
  for (const p of [-width*.43,width*.43]) {
    posts.push(box(.11,2.1,.11,darkWood,[p,.97,-.037]));
    env.addCircle(x + p * Math.cos(heading), z - p * Math.sin(heading), .09, 'trail-post');
  }
  buildParts(at, posts, title);
  group.add(at);
}

function basecamp(group, ground, env) {
  const [x,z] = [187.3,-25.2];
  const { canvas, ctx } = makeCanvas(128,128);
  const random = mulberry32(187128);
  ctx.fillStyle = '#494745';
  ctx.fillRect(0,0,128,128);
  for (let j = 0; j < 8; j++) for (let i = -1; i < 8; i++) {
    const c = 109 + Math.floor(random()*43);
    ctx.fillStyle = 'rgb(' + c + ',' + (c-5) + ',' + (c-11) + ')';
    ctx.fillRect(i*16 + (j%2)*8+1, j*16+1, 14,14);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 6;
  const vertices = [], uv = [], index = [];
  const w = 44, d = 30, cols = 36, rows = 25;
  const connectsTickets = (u,v) => {
    const t = (185 - u) / 17;
    return t > -.26 && t < 1 && Math.abs(v - lerp(-26,-35,t)) < 2.5 + (1-t)*1.1;
  };
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = x - w/2 + w*i/cols, v = z - d/2 + d*j/rows;
    vertices.push(u, ground.heightAt(u,v)+.040, v);
    uv.push(u/2.1,v/2.1);
    if (i === cols || j === rows) continue;
    const midX = u + w*.5/cols, midZ = v + d*.5/rows;
    const court = (Math.abs(midX-x)/10.9)**3 + (Math.abs(midZ-z)/7.3)**3;
    if (court > 1.04 + .070*Math.sin(u*1.31 + v*.83) && !connectsTickets(midX,midZ)) continue;
    const k = j*(cols+1)+i;
    index.push(k,k+cols+1,k+1,k+1,k+cols+1,k+cols+2);
  }
  const pavers = new THREE.BufferGeometry();
  pavers.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
  pavers.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  pavers.setIndex(index);
  pavers.computeVertexNormals();
  const plaza = new THREE.Mesh(pavers, new THREE.MeshStandardMaterial({ map, roughness: .96 }));
  plaza.name = 'Basecamp · paved Clock Tower courtyard';
  plaza.receiveShadow = true;
  group.add(plaza);
  directionalSign(group,ground,env,189,-22,-1.21,'STEVENS PASS BASECAMP','CLOCK TOWER   •   PACIFIC CREST LODGE',3.65);
}

function geminiRockCut(group, ground) {
  const [start, end] = GEMINI_TRAVERSE;
  const dx = end[0] - start[0], dz = end[1] - start[1], span = Math.hypot(dx,dz);
  const yaw = Math.atan2(-dz, dx);
  const random = mulberry32(7381), parts = [];
  for (const [begin, end] of [[.13,.34],[.44,.52],[.65,.79]]) {
    for (let t = begin; t < end; t += .021 + random()*.033) {
      const setback = 7.18 + random() * 2.1;
      const x = start[0] + dx*t + dz/span*setback;
      const z = start[1] + dz*t - dx/span*setback;
      const y = ground.heightAt(x,z);
      const color = ['#525a59','#626a68','#747975','#4a5254'][Math.floor(random()*4)];
      const rise = .48 + random()**1.5 * 1.34;
      const r = 1.04 + random() * 2.68;
      const geometry = new THREE.IcosahedronGeometry(1,1);
      const vertices = geometry.attributes.position;
      const phase = random()*8;
      for (let i = 0; i < vertices.count; i++) {
        const wx=vertices.getX(i), wy=vertices.getY(i), wz=vertices.getZ(i);
        const split = .83+.24*Math.sin(wx*7.11+wy*3.1+wz*4.53+phase);
        vertices.setXYZ(i,wx*split,wy*split,wz*split);
      }
      geometry.scale(r,rise,1.1+random()*1.0);
      geometry.rotateY(yaw+(random()-.5)*.4);
      for (let i = 0; i < vertices.count; i++) {
        const ox=vertices.getX(i), oy=vertices.getY(i), oz=vertices.getZ(i);
        const surface = ground.heightAt(x+ox,z+oz) - y;
        vertices.setY(i, surface + oy - rise*.48);
      }
      geometry.computeVertexNormals();
      parts.push(part(geometry,color,[x,y,z]));
    }
  }
  buildParts(group,parts,'Gemini · exposed rock cut');
}

export function stevensTraverseTrees() {
  const [a, b] = GEMINI_TRAVERSE, dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const random = mulberry32(21664);
  const trees = [];
  for (const side of [-1,1]) for (let d = 12; d < length - 6; d += 7.4) {
    const t = (d + (random()-.5)*3.2) / length;
    const setback = side * (7.8 + random()*3.0);
    trees.push([a[0]+t*dx - dz/length*setback, a[1]+t*dz + dx/length*setback, 16 + random()*15]);
  }
  return trees;
}

export function buildStevensPassDetails(scene, config, ground, env, pointInPolygon) {
  const group = new THREE.Group();
  group.name = 'Stevens Pass · basecamp, Tye River and Mill Valley';
  scene.add(group);
  drawCreeks(group, ground);
  parking(group, config, ground, env, pointInPolygon);
  basecamp(group, ground, env);
  pylons(group, ground, env);
  geminiRockCut(group, ground);
  directionalSign(group,ground,env,557.6,1388.8,Math.PI,'GEMINI','MILL VALLEY   •   SKID ROAD ↓');
  directionalSign(group,ground,env,754,1841.7,-Math.PI/2,'GEMINI','JUPITER EXPRESS   •   MILL VALLEY ↖');
  directionalSign(group,ground,env,-120,-40,Math.PI/2,'STEVENS PASS','WEST PARKING 3   •   BASE AREA →');
  return group;
}
