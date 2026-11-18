import * as THREE from 'three';

const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const cube = new THREE.BoxGeometry(1, 1, 1);
const ball = new THREE.SphereGeometry(1, 20, 12);
const detailBall = new THREE.SphereGeometry(1, 11, 6);
const barrel = new THREE.CylinderGeometry(1, 1, 1, 12);

function material(color, roughness = .55, metalness = .1, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...options });
}
const red = material(0xbd102a, .31, .31, { side: THREE.DoubleSide });
red.onBeforeCompile = shader => {
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    if (!gl_FrontFacing) diffuseColor.rgb = mix(vec3(.032,.035,.04), diffuseColor.rgb, .12);`);
};
const brightRed = material(0xc61523, .32, .22);
const white = material(0xe9edf0, .42, .2, { side: THREE.DoubleSide });
const pinstripe = material(0xbad6e2, .32, .24);
const graphite = material(0x20262a, .58, .16);
const trim = material(0x131a1d, .74, .04);
const rubber = material(0x222829, .94, .02);
const metal = material(0x859099, .44, .62);
const steel = material(0x485158, .42, .62);
const darkSteel = material(0x32373c, .5, .41);
const dullSilver = material(0xabb2b8, .59, .45);
const amber = material(0xff981a, .34, .1, { emissive: 0xff6610, emissiveIntensity: .38 });
const lamp = material(0xe7f5ff, .32, .06, { emissive: 0xcfe6ff, emissiveIntensity: .52 });
const portLamp = material(0xff241c, .35, .06, { emissive: 0xff1418, emissiveIntensity: .44 });
const starboardLamp = material(0x29e4aa, .35, .06, { emissive: 0x00af74, emissiveIntensity: .44 });
const cabin = material(0x424a51, .82, .04);
const leather = material(0x394148, .81, .04);
const glass = new THREE.MeshPhysicalMaterial({
  color: 0x688ba2, roughness: .15, metalness: .5, clearcoat: .8,
  clearcoatRoughness: .15, transparent: true, opacity: .34, depthWrite: false, side: THREE.DoubleSide,
});
const windshield = glass.clone();
windshield.opacity = .25;
const inspectionGlass = glass.clone();
inspectionGlass.opacity = .46;

function part(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = !mat.transparent;
  mesh.receiveShadow = !mat.transparent;
  parent.add(mesh);
  return mesh;
}
function box(parent, mat, x, y, z, sx, sy, sz) {
  const mesh = part(parent, cube, mat, x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
}
function ellipse(parent, mat, x, y, z, sx, sy, sz) {
  const mesh = part(parent, Math.max(sx,sy,sz) < .093 ? detailBall : ball, mat, x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
}
function rod(parent, mat, endA, endB, radius) {
  const a = new THREE.Vector3(...endA);
  const b = new THREE.Vector3(...endB);
  const axis = b.clone().sub(a);
  const mesh = part(parent, barrel, mat, ...(a.add(b).multiplyScalar(.5).toArray()));
  mesh.quaternion.setFromUnitVectors(Y_AXIS, axis.clone().normalize());
  mesh.scale.set(radius, axis.length(), radius);
  return mesh;
}
function line(parent, mat, radius, points, closed = false) {
  const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
  return part(parent, new THREE.TubeGeometry(path, (points.length - 1) * 4, radius, 7), mat);
}
function gridGeometry(cols, rows, point) {
  const xyz = [];
  const tex = [];
  const index = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const v = j / rows;
      xyz.push(...point(u, v));
      tex.push(u, v);
      if (i && j) {
        const k = xyz.length / 3 - 1;
        index.push(k - cols - 2, k - 1, k - cols - 1, k - cols - 1, k - 1, k);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
function surface(parent, mat, cols, rows, point) {
  return part(parent, gridGeometry(cols, rows, point), mat);
}

function ringPoint(profile, z, theta, offset = 0) {
  let i = 1;
  while (i < profile.length - 1 && z > profile[i][0]) i++;
  const a = profile[i - 1];
  const b = profile[i];
  const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  const prev = profile[Math.max(0,i-2)];
  const next = profile[Math.min(profile.length-1,i+1)];
  const interpolate = j => {
    const interval = b[0] - a[0];
    const m0 = interval * (b[j] - prev[j]) / (b[0] - prev[0]);
    const m1 = interval * (next[j] - a[j]) / (next[0] - a[0]);
    return THREE.MathUtils.lerp(a[j],b[j],t*t*(3-2*t)) + t*(1-t)*((1-t)*m0-t*m1);
  };
  const w = interpolate(1);
  const center = interpolate(2);
  const cos = Math.cos(theta);
  const radius = cos >= 0 ? 3 : 4;
  const h = interpolate(radius);
  return [(w + offset) * Math.sin(theta), center + (h + offset) * cos, z];
}
function ringSkin(parent, mat, profile, start, end, angleA = 0, angleB = TAU, offset = 0) {
  return surface(parent, mat, Math.max(4, Math.ceil((angleB - angleA) * 9)), Math.max(2, Math.ceil((end - start) * 8)), (u, v) =>
    ringPoint(profile, start + (end - start) * v, angleA + (angleB - angleA) * u, offset));
}
function shape(parent, mat, points, depth, plane, center = 0, bevel = 0) {
  const outline = new THREE.Shape();
  points.forEach(([a, b], i) => i ? outline.lineTo(a, b) : outline.moveTo(a, b));
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  if (plane === 'yz') {
    // Dimensions in the outline are longitudinal position and elevation.
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(center, 0, 0);
  } else if (plane === 'xz') {
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, center, 0);
  } else {
    geometry.translate(0, 0, center);
  }
  return part(parent, geometry, mat);
}

const lettering = new Map();
function decalMaterial(text, color) {
  const key = text + color;
  if (lettering.has(key)) return lettering.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'italic 800 90px Arial';
  const width = ctx.measureText(text).width;
  ctx.translate(256,64);
  ctx.scale(Math.min(1.9,496/width),1);
  ctx.fillText(text,0,0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mat = material(0xffffff, .47, .04, { map: texture, alphaTest: .45, polygonOffset: true, polygonOffsetFactor: -2 });
  lettering.set(key, mat);
  return mat;
}
function label(parent, text, color, x, y, z, width, height, rotation = 0, tilt = 0) {
  const mesh = part(parent, new THREE.PlaneGeometry(width, height), decalMaterial(text, color), x, y, z);
  mesh.rotation.set(0, rotation, tilt, 'YXZ');
  mesh.castShadow = false;
}

function staticBatches(group) {
  const byMaterial = new Map();
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.material.transparent || mesh.material.alphaTest) continue;
    let batch = byMaterial.get(mesh.material);
    if (!batch) byMaterial.set(mesh.material, batch = []);
    batch.push(mesh);
  }
  const normalMatrix = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const [mat, meshes] of byMaterial) {
    if (meshes.length < 2) continue;
    const positions = [], normals = [], uvs = [];
    for (const mesh of meshes) {
      mesh.updateMatrix();
      normalMatrix.getNormalMatrix(mesh.matrix);
      const g = mesh.geometry;
      const pos = g.getAttribute('position');
      const norm = g.getAttribute('normal');
      const uv = g.getAttribute('uv');
      const indices = g.getIndex();
      const length = indices ? indices.count : pos.count;
      for (let i = 0; i < length; i++) {
        const index = indices ? indices.getX(i) : i;
        p.fromBufferAttribute(pos, index).applyMatrix4(mesh.matrix);
        n.fromBufferAttribute(norm, index).applyMatrix3(normalMatrix).normalize();
        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        uvs.push(uv.getX(index), uv.getY(index));
      }
      group.remove(mesh);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    part(group, geometry, mat);
  }
}

function seat(parent, x, y, z, width = .44) {
  box(parent, darkSteel, x, y - .11, z, width * .8, .21, .29);
  ellipse(parent, leather, x, y, z, width * .55, .092, .244);
  ellipse(parent, leather, x, y + .27, z - .195, width * .51, .303, .069).rotation.x = -.11;
  ellipse(parent, trim, x, y + .53, z - .224, width * .34, .093, .066);
  for (const s of [-1, 1]) {
    rod(parent, trim, [x + width * s * .41, y + .46, z - .15], [x + width * s * .25, y + .07, z + .03], .021);
  }
}
const suitBlue = material(0x087e8e, .74, .02);
const suitPants = material(0x172a40, .81, .02);
const helmet = material(0x243343, .28, .15);
const goggle = material(0x436d92, .22, .59);
function segment(parent, mat, a, b, width, depth) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const mesh = ellipse(parent, mat, ...start.lerp(end, .5).toArray(), width, axis.length() * .55, depth);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, axis.normalize());
  return mesh;
}
function head(parent, x, y, z, tint = helmet) {
  ellipse(parent, tint, x, y, z, .104, .123, .114);
  ellipse(parent, goggle, x, y + .019, z + .075, .094, .049, .046);
  for (const s of [-1, 1]) ellipse(parent, trim, x + s * .09, y - .015, z - .011, .024, .052, .069);
}
function seatedPilot(x, y, z, hands, feet, lean = .07) {
  const pilot = new THREE.Group();
  ellipse(pilot, suitPants, x, y + .078, z, .188, .14, .157);
  const shoulderZ = z + lean;
  const shoulderY = y + .445;
  ellipse(pilot, suitBlue, x, y + .30, z + lean * .5, .216, .25, .137).rotation.x = lean * 4;
  head(pilot, x, y + .60, shoulderZ + .037);
  for (const [i, s] of [-1, 1].entries()) {
    const shoulder = [x + s * .162, shoulderY, shoulderZ];
    const elbow = [x + s * .215, y + .265, shoulderZ + .13];
    segment(pilot, suitBlue, shoulder, elbow, .063, .069);
    segment(pilot, suitBlue, elbow, hands[i], .055, .057);
    ellipse(pilot, trim, ...hands[i], .044, .045, .064);
    const hip = [x + s * .093, y + .083, z];
    const knee = [x + s * .152, y + .083, z + .27];
    segment(pilot, suitPants, hip, knee, .094, .087);
    segment(pilot, suitPants, knee, feet[i], .072, .077);
    ellipse(pilot, trim, ...feet[i], .069, .055, .12);
  }
  staticBatches(pilot);
  pilot.visible = false;
  return pilot;
}
function occupiedPilot(group, pilot) {
  group.add(pilot);
  return (occupied, cockpit = false) => { pilot.visible = occupied && !cockpit; };
}

const factories = {
  helicopter: () => helicopter(),
  snowcat: () => snowcat(),
  snowmobile: () => snowmobile(),
  wingsuit: () => wingsuit(),
  bike: () => mountainBike(),
};

export function createServiceAsset(id) {
  if (!Object.hasOwn(factories,id)) throw new RangeError('Unknown service asset ' + id);
  return factories[id]();
}
function fuselageWindow(parent, profile, z0, z1, low, high, mat = glass, edge = .021) {
  const bounds = v => {
    const end = Math.max(0, .20 - Math.min(v, 1 - v)) / .20;
    const radius = end * end * .12;
    return [low + radius, high - radius];
  };
  const point = (u, v, offset = 0) => {
    const [lo, hi] = bounds(v);
    return ringPoint(profile, THREE.MathUtils.lerp(z0, z1, v), THREE.MathUtils.lerp(lo, hi, u), .009 + offset);
  };
  surface(parent, mat, 13, Math.ceil((z1 - z0) * 16), (u, v) => point(u, v));
  const samples = Array.from({ length: 9 }, (_, i) => i / 8);
  const outline = [...samples.slice(0,-1).map(v => point(0,v)), ...samples.slice(0,-1).map(u => point(u,1)),
    ...samples.slice(1).reverse().map(v => point(1,v)), ...samples.slice(1).reverse().map(u => point(u,0))];
  line(parent, trim, edge, outline, true);
  surface(parent, red, 5, 18, (u,v) => ringPoint(profile, THREE.MathUtils.lerp(z0,z1,v), THREE.MathUtils.lerp(low-.025,bounds(v)[0]+.012,u), -.013));
  surface(parent, red, 5, 18, (u,v) => ringPoint(profile, THREE.MathUtils.lerp(z0,z1,v), THREE.MathUtils.lerp(bounds(v)[1]-.012,high+.025,u), -.013));
}

function heliStripe(group, profile, mat, start, end, angle, width) {
  surface(group, mat, 4, Math.ceil((end - start) * 10), (u, v) => {
    return ringPoint(profile, THREE.MathUtils.lerp(start, end, v), angle(v) + width * u, .014);
  });
}

function lampBox(group, housing, glow, x, y, z, width, height, depth = .072) {
  box(group, housing, x, y, z, width, height, depth);
  box(group, glow, x, y, z + depth * .51, width * .8, height * .74, .013);
}
function rotorDisc(parent, radius) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 18, 128, 128, 127);
  gradient.addColorStop(0, '#25292b16');
  gradient.addColorStop(.65, '#35434e26');
  gradient.addColorStop(.9, '#35434e40');
  gradient.addColorStop(.95, '#a4292327');
  gradient.addColorStop(1, '#ffffff00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: .78 });
  const plane = part(parent, new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.visible = false;
  return plane;
}

function flightInstruments(parent) {
  const canvas=document.createElement('canvas');
  canvas.width=512;canvas.height=168;
  const ctx=canvas.getContext('2d');
  const gradient=ctx.createLinearGradient(0,0,0,168);
  gradient.addColorStop(0,'#202a33');gradient.addColorStop(1,'#0e151b');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,512,168);
  for(const [i,caption] of ['AIRSPEED','ATTITUDE','ALTITUDE','TURN','HEADING','V / SPEED'].entries()){
    const x=65+i%3*84,y=i<3?42:119,r=33;
    ctx.fillStyle='#a3adb3';ctx.beginPath();ctx.arc(x,y,r+4,0,TAU);ctx.fill();
    ctx.fillStyle='#151c22';ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
    for(let j=0;j<16;j++){
      const a=j*TAU/16,ux=Math.cos(a),uy=Math.sin(a),start=j%4===0?r-8:r-5;
      ctx.strokeStyle=j%4?'#8fa1ad':'#eef3f5';ctx.lineWidth=j%4?1:2;
      ctx.beginPath();ctx.moveTo(x+ux*start,y+uy*start);ctx.lineTo(x+ux*(r-2),y+uy*(r-2));ctx.stroke();
    }
    if(i===1){
      ctx.fillStyle='#5a91a9';ctx.fillRect(x-16,y-13,32,12);
      ctx.fillStyle='#ab7856';ctx.fillRect(x-16,y-1,32,12);
    }
    ctx.strokeStyle='#e5ebec';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(i*.94-1)*23,y+Math.sin(i*.94-1)*23);ctx.stroke();
    ctx.fillStyle='#eef3f4';ctx.font='7px sans-serif';ctx.textAlign='center';ctx.fillText(caption,x,y+18);
  }
  const display=ctx.createLinearGradient(308,44,475,131);
  display.addColorStop(0,'#477b90');display.addColorStop(.5,'#1b445e');display.addColorStop(.51,'#575d45');display.addColorStop(1,'#9f7d58');
  ctx.fillStyle='#829097';ctx.fillRect(298,24,196,119);
  ctx.fillStyle='#1a2229';ctx.fillRect(303,30,186,107);
  ctx.fillStyle=display;ctx.fillRect(314,40,163,86);
  ctx.strokeStyle='#cadac5';ctx.lineWidth=1;
  for(let i=0;i<6;i++){
    ctx.beginPath();ctx.moveTo(386+i%2*4,56+i*9);ctx.lineTo(404-i%2*4,56+i*9);ctx.stroke();
  }
  ctx.fillStyle='#deebde';ctx.font='10px monospace';ctx.fillText('067',335,85);ctx.fillText('6650',455,85);
  const map=new THREE.CanvasTexture(canvas);
  map.colorSpace=THREE.SRGBColorSpace;
  map.anisotropy=4;
  const mat=material(0xd7e2e7,.48,.17,{map,emissive:0x344b64,emissiveMap:map,emissiveIntensity:.43});
  const instrument=part(parent,new THREE.PlaneGeometry(.83,.252),mat,0,1.518,1.588);
  instrument.rotation.set(.47,Math.PI,0,'XYZ');
}

function helicopter() {
  // Bell 407's 10.66 m rotor and 10.57 m fuselage set the scale of the reference aircraft.
  const group = new THREE.Group();
  const shell = [
    [-2.66,.35,1.39,.33,.19], [-2.22,.69,1.49,.48,.43], [-1.72,.92,1.52,.66,.63],
    [-1.28,1.018,1.55,.71,.77], [-.58,1.072,1.56,.73,.80], [.24,1.068,1.57,.72,.78],
    [.89,1.032,1.57,.65,.73], [1.41,.945,1.57,.55,.66], [1.78,.84,1.53,.43,.56],
    [2.09,.69,1.43,.31,.46], [2.37,.49,1.34,.23,.34], [2.57,.25,1.25,.14,.17], [2.64,.055,1.21,.05,.05],
  ];
  const sections = [-2.66,-1.67,-.53,-.44,.32,.42,1.38,1.47,2.40,2.64];
  for (let i = 1; i < sections.length; i++) {
    const z0 = sections[i-1], z1 = sections[i];
    const windshieldBand = z0 >= 1.47 && z1 <= 2.45;
    const doorBand = (z0 === -1.67 || z0 === -.44 || z0 === .42);
    const inspectionBand = z0 === 1.47;
    const doorLow = z0 > 0 ? .74 : .92;
    const doorHigh = z0 > 0 ? 1.61 : 1.68;
    for (const side of [-1, 1]) {
      const skin = (mat, a, b) => {
        const lo = side < 0 ? -b : a, hi = side < 0 ? -a : b;
        ringSkin(group, mat, shell, z0, z1, lo, hi);
        ringSkin(group, mat, shell, Math.max(shell[0][0],z0-.018), Math.min(2.64,z1+.018), lo-.014, hi+.014, -.024);
      };
      const window = (low, high, mat, edge) => fuselageWindow(group, shell, z0, z1, side < 0 ? -high : low, side < 0 ? -low : high, mat, edge);
      if (windshieldBand) {
        skin(red, 0, .019);
        window(.019, 1.15, windshield, .018);
        if (inspectionBand) {
          skin(red, 1.15, 1.82);
          window(1.82, 2.48, inspectionGlass, .025);
          skin(white, 2.48, Math.PI);
        } else {
          skin(red, 1.15, 2.31);
          skin(white, 2.31, Math.PI);
        }
      } else if (doorBand) {
        skin(red, 0, doorLow);
        window(doorLow, doorHigh, glass, .019);
        skin(red, doorHigh, 2.30);
        skin(white, 2.30, Math.PI);
      } else {
        skin(red, 0, 2.30);
        skin(white, 2.30, Math.PI);
      }
    }
  }
  for (const s of [-1, 1]) {
    heliStripe(group, shell, pinstripe, -2.42, 2.47, v => s * (1.70 + .098 * Math.sin(Math.PI * v)) - .019, .038);
    heliStripe(group, shell, white, -2.36, .87, v => s * (1.87 + .48 * v) - .034, .068);
    heliStripe(group, shell, white, -2.30, .44, v => s * (1.68 + .49 * v) - .018, .036);
    label(group, 'C-GFCC', '#e8edf1', s * .985, 1.23, .87, .83, .182, s * Math.PI / 2, s * .07);
    label(group, 'ALPINE', '#f7f9fa', s * 1.018, 1.34, -.73, .57, .16, s * Math.PI / 2);
    label(group, 'HELI-SKIING', '#e3e7eb', s * 1.006, 1.24, -.73, .60, .104, s * Math.PI / 2);
    for (const z of [1.34,.36,-.52,-1.66]) {
      line(group, graphite, .008, [ringPoint(shell, z, s * .78,.011),ringPoint(shell,z,s*1.51,.011),
        ringPoint(shell,z,s*1.98,.011),ringPoint(shell,z,s*2.24,.011)]);
    }
    for (const z of [-1.42,-.39,.55]) {
      const [x,y] = ringPoint(shell,z,s*1.78,.026);
      box(group, steel, x, y, z, .043,.061,.142);
      box(group, dullSilver, x + s*.025, y + .008, z, .017,.028,.104);
    }
    const navX = s * 1.035;
    ellipse(group, graphite, navX,1.71,-1.51,.062,.049,.104);
    ellipse(group, s < 0 ? starboardLamp : portLamp, navX+s*.033,1.72,-1.51,.038,.039,.071);
  }

  const cowling = [[-2.52,.10,2.05,.04,.11],[-2.06,.40,2.12,.23,.20],[-1.58,.61,2.25,.32,.26],
    [-.94,.67,2.38,.36,.29],[-.22,.63,2.49,.32,.32],[.30,.51,2.39,.24,.19],[.63,.22,2.31,.11,.06],[.75,.03,2.28,.02,.02]];
  ringSkin(group, red, cowling, -2.52, .75);
  for (const s of [-1, 1]) {
    ellipse(group, trim, s*.557, 2.55, -.43, .035,.15,.13).rotation.z = s*.21;
    for (const z of [-1.08,-1.23,-1.38,-1.53]) {
      ellipse(group, graphite, s*(.644 - .075*Math.abs(z+.95)), 2.43-.14*Math.abs(z+.94), z, .022,.09,.034).rotation.z = s*.37;
    }
    const a = [s*.43,2.50,-1.28], b = [s*.43,2.56,-1.87];
    rod(group, metal, a, b, .115);
    rod(group, graphite, [s*.43,2.56,-1.83], [s*.43,2.563,-1.882], .072);
  }
  const tail = [[-7.79,.09,1.89,.12,.09],[-7.47,.139,1.88,.15,.14],[-6.3,.185,1.85,.17,.152],
    [-4.98,.237,1.80,.20,.174],[-3.57,.329,1.72,.27,.205],[-2.08,.535,1.66,.36,.365]];
  ringSkin(group, red, tail, -7.79,-2.08,-1.98,1.98);
  ringSkin(group, white, tail, -7.79,-2.08, 1.98, TAU-1.98);
  for (const s of [-1,1]) heliStripe(group,tail,pinstripe,-7.76,-2.20,() => s*1.71-.033,.065);
  shape(group, red, [[-7.75,1.68],[-7.87,2.94],[-7.60,2.99],[-7.0,1.94],[-7.11,1.72]],.115,'yz',0,.036);
  shape(group, white,[[-7.78,1.79],[-7.82,1.12],[-7.64,.91],[-7.48,.96],[-7.17,1.76]],.103,'yz',0,.023);
  shape(group, red, [[-1.09,-4.93],[-1.09,-5.22],[0,-5.61],[1.08,-5.22],[1.08,-4.93],[0,-4.76]], .092, 'xz', 1.82, .025);
  shape(group, white, [[-.98,-5.12],[-.98,-5.20],[0,-5.54],[.98,-5.20],[.98,-5.12],[0,-5.31]], .101, 'xz', 1.82);
  ellipse(group, portLamp, 0,3.009,-7.61,.058,.046,.061);

  box(group, cabin,0, .96, -.09,1.64,.105,3.36);
  ellipse(group, cabin,0,1.56,-1.80,.78,.58,.068);
  for (const x of [-.48,.48]) seat(group,x,1.22,.79);
  for (const x of [-.52,0,.52]) seat(group,x,1.22,-1.16,.42);
  const dash = ellipse(group, graphite, 0,1.46,1.875,.56,.235,.255);
  dash.rotation.x = .13;
  box(group, trim,0,1.21,1.40,.28,.50,.38).rotation.x=-.23;
  flightInstruments(group);
  for (const s of [-1,1]) {
    const x=s*.45;
    rod(group, metal,[x,1.02,1.13],[x,1.41,1.23],.024);
    rod(group, trim,[x-.045,1.413,1.231],[x+.045,1.413,1.231],.027);
    for (const dx of [-.08,.08]) box(group, steel,x+dx,1.03,1.78,.075,.06,.14).rotation.x=.48;
  }

  for (const s of [-1,1]) {
    const x=s*1.19;
    line(group, dullSilver,.055,[[x,.115,-2.39],[x,.057,-2.16],[x,.057,-1.65],[x,.057,1.30],
      [x,.085,1.85],[x,.241,2.20],[x,.30,2.41]]);
    for (const z of [-1.50,1.02]) {
      line(group, metal,.061,[[x,.109,z],[s*1.09,.29,z],[s*.95,.55,z],[s*.77,.75,z],[0,.81,z]]);
      box(group, steel,x,.09,z,.13,.098,.15);
      ellipse(group, graphite,x,.015,z,.113,.015,.61);
    }
    rod(group, dullSilver,[s*1.02,.51,-1.49],[s*1.02,.51,1.05],.028);
  }
  const bx=1.43;
  box(group, steel,bx,.31,-.08,.49,.036,2.52);
  for (const x of [bx-.24,bx+.24]) for (const y of [.35,.69]) {
    rod(group, dullSilver,[x,y,-1.29],[x,y,1.14],.025);
  }
  for (const z of [-1.28,-.49,.33,1.13]) {
    for (const x of [bx-.24,bx+.24]) rod(group, metal,[x,.35,z],[x,.69,z],.022);
    rod(group, dullSilver,[bx-.24,.69,z],[bx+.24,.69,z],.021);
  }
  for (let i = 0; i < 21; i++) {
    const z = -1.245 + i * .109;
    rod(group,metal,[bx+.24,.36,z],[bx+.24,.681,z+.16],.006);
    rod(group,metal,[bx+.24,.36,z+.16],[bx+.24,.681,z],.006);
  }
  for (const [z, color] of [[.31,brightRed], [-.41,trim]]) {
    ellipse(group,color,bx,.51,z,.208,.153,.33);
    for (const dz of [-.125,.125]) line(group, trim,.022,[[bx-.21,.37,z+dz],[bx-.19,.57,z+dz],
      [bx,.666,z+dz],[bx+.19,.57,z+dz],[bx+.21,.37,z+dz]]);
  }
  ellipse(group, graphite,0,1.134,2.49,.18,.12,.078);
  ellipse(group, lamp,0,1.118,2.56,.124,.074,.028);
  rod(group, graphite,[-.36,2.241,.65],[-.37,2.616,.506],.011);
  rod(group, graphite,[.36,.84,-1.91],[.37,.52,-2.04],.014);

  rod(group, metal,[0,2.68,-.26],[0,3.31,-.26],.068);
  rod(group, graphite,[0,2.89,-.26],[0,3.03,-.26],.159);
  const rotor = new THREE.Group();
  rotor.position.set(0,3.32,-.26);
  rotor.rotation.y=.36;
  group.add(rotor);
  ellipse(rotor, graphite,0,0,0,.37,.095,.37);
  ellipse(rotor, red,0,.09,0,.33,.058,.33);
  const blades = new THREE.Group();
  rotor.add(blades);
  for (let i=0; i<4; i++) {
    const blade = new THREE.Group();
    blade.rotation.y = i * Math.PI / 2;
    rod(blade, steel,[0,-.10,.29],[0,-.12,.85],.064);
    shape(blade, graphite,[[-.11,.46],[.124,.44],[.17,1.28],[.123,5.23],[.065,5.33],[-.095,5.28],[-.142,1.47]],.037,'xz',-.13,.009);
    box(blade, white,0,-.108,5.115,.228,.01,.105);
    box(blade, red,0,-.108,5.233,.209,.011,.092);
    staticBatches(blade);
    blades.add(blade);
  }
  const blur = rotorDisc(group, 5.33);
  blur.position.copy(rotor.position);
  blur.position.y -= .07;
  const antiTorque = new THREE.Group();
  antiTorque.position.set(.22,1.93,-7.65);
  antiTorque.rotation.x = .46;
  group.add(antiTorque);
  rod(group, steel,[0,1.93,-7.65],[.23,1.93,-7.65],.10);
  ellipse(antiTorque, graphite,0,0,0,.07,.105,.105);
  const tailBlades = new THREE.Group();
  antiTorque.add(tailBlades);
  for (const s of [-1,1]) {
    box(tailBlades, graphite,0,s*.419,.018,.041,.77,.14);
    box(tailBlades, red,.008,s*.747,.018,.045,.105,.145);
    box(tailBlades, white,.016,s*.806,.018,.031,.046,.13);
  }
  const tailBlur = rotorDisc(group,.83);
  tailBlur.position.copy(antiTorque.position);
  tailBlur.rotation.set(0,Math.PI/2,0);

  const pilot = seatedPilot(-.48,1.28,.69,[[-.55,1.42,1.22],[-.40,1.41,1.25]],[[-.56,1.055,1.52],[-.39,1.055,1.52]], .095);
  const posePilot = occupiedPilot(group,pilot);
  let occupied=false;
  let power=0;
  staticBatches(group);
  return {
    group, eye: new THREE.Vector3(-.43,1.89,.90),
    setOccupied(active,cockpit) { occupied=active; posePilot(active,cockpit); },
    animate(dt) {
      power = dt ? THREE.MathUtils.damp(power,occupied?1:0,3.2,dt) : 0;
      rotor.rotation.y -= dt * power * 37;
      antiTorque.rotation.x -= dt * power * 75;
      blur.visible = tailBlur.visible = power > .55;
      blades.visible = tailBlades.visible = power < .87;
    },
  };
}
function trackPoint(z0, z1, cy, radius, t) {
  const straight = z1-z0;
  const arc = Math.PI * radius;
  const length = 2 * (straight + arc);
  const d = ((t % length) + length) % length;
  if (d < straight) return [cy + radius,z0 + d,0];
  if (d < straight + arc) {
    const a = (d-straight)/radius;
    return [cy+radius*Math.cos(a),z1+radius*Math.sin(a),a];
  }
  if (d < 2 * straight + arc) return [cy - radius,z1 - (d - straight - arc),Math.PI];
  const a = Math.PI + (d-2*straight-arc)/radius;
  return [cy+radius*Math.cos(a),z0+radius*Math.sin(a),a];
}

function trackedAssembly(group,{x,width,z0,z1,y,radius,links,grouser,cleats=true}) {
  const length = 2 * (z1-z0 + Math.PI*radius);
  const bands = cleats ? 4 : 1;
  for (let j=0;j<bands;j++) {
    const center = x + width * ((j+.5)/bands-.5);
    const size = width * (cleats ? .105 : .94);
    surface(group,rubber,2,120,(u,v) => {
      const [py,pz] = trackPoint(z0,z1,y,radius-.034,v*length);
      return [center+(u-.5)*size,py,pz];
    });
  }
  const count=cleats?links*4:links*3;
  const treads=new THREE.InstancedMesh(cube,grouser,count);
  treads.castShadow=true;
  treads.receiveShadow=true;
  treads.frustumCulled=false;
  group.add(treads);
  const transform=new THREE.Object3D();
  let distance=0;
  function animate(dt,speed) {
    distance = (distance + speed * dt) % length;
    for(let i=0;i<links;i++) {
      const [py,pz,a] = trackPoint(z0,z1,y,radius,i*length/links+distance);
      transform.rotation.x=a;
      transform.position.set(x,py,pz);
      transform.scale.set(width,.037,cleats?.069:.035);
      transform.updateMatrix();
      const stride=cleats?4:3;
      treads.setMatrixAt(i*stride,transform.matrix);
      for(let j=1;j<stride;j++){
        const offset=(j-(stride)/2)/(stride-1)*width*.86;
        transform.position.set(x+offset,py+Math.cos(a)*.029,pz+Math.sin(a)*.029);
        transform.scale.set(width*(cleats?.155:.258),cleats?.060:.054,cleats?.032:.020);
        transform.rotation.y=(j%2<1?1:-1)*.31;
        transform.updateMatrix();
        treads.setMatrixAt(i*stride+j,transform.matrix);
        transform.rotation.y=0;
      }
    }
    treads.instanceMatrix.needsUpdate=true;
  }
  animate(0,0);
  return animate;
}
function wheel(parent,x,y,z,r,depth) {
  const group=new THREE.Group();
  group.position.set(x,y,z);
  parent.add(group);
  rod(group,rubber,[-depth/2,0,0],[depth/2,0,0],r);
  for(const s of [-1,1]){
    const dx=s*depth/2;
    rod(group,steel,[dx,0,0],[dx+s*.022,0,0],r*.73);
    rod(group,graphite,[dx+s*.022,0,0],[dx+s*.044,0,0],r*.59);
    rod(group,dullSilver,[dx+s*.044,0,0],[dx+s*.071,0,0],r*.275);
    for(let i=0;i<6;i++){
      const a=TAU*i/6;
      ellipse(group,dullSilver,dx+s*.047,Math.sin(a)*r*.44,Math.cos(a)*r*.44,.013,r*.072,r*.072);
    }
  }
  staticBatches(group);
  return group;
}

function fourCorners(a,b,c,d,u,v) {
  return a.map((value,i) => THREE.MathUtils.lerp(THREE.MathUtils.lerp(value,b[i],u),THREE.MathUtils.lerp(d[i],c[i],u),v));
}
function panel(group,mat,corners,cols=2,rows=2){
  return surface(group,mat,cols,rows,(u,v)=>fourCorners(...corners,u,v));
}
const paintedPanel=brightRed.clone();
paintedPanel.side=THREE.DoubleSide;
const edgePanel=graphite.clone();
edgePanel.side=THREE.DoubleSide;
function cabWindow(parent,corners,glassMat,border=.043) {
  const quad=(u,v)=>fourCorners(...corners,u,v);
  for(const [u0,u1,v0,v1] of [[0,1,0,border],[0,1,1-border,1],[0,border,border,1-border],[1-border,1,border,1-border]]){
    panel(parent,edgePanel,[quad(u0,v0),quad(u1,v0),quad(u1,v1),quad(u0,v1)]);
  }
  const glazing=[quad(border,border),quad(1-border,border),quad(1-border,1-border),quad(border,1-border)];
  panel(parent,glassMat,glazing,7,4);
  glazing.forEach((p,i)=>rod(parent,trim,p,glazing[(i+1)%4],.023));
  return quad;
}

let snowBlade;
function bladeMaterial() {
  if (snowBlade) return snowBlade;
  const canvas=document.createElement('canvas');
  canvas.width=1024; canvas.height=256;
  const ctx=canvas.getContext('2d');
  const gradient=ctx.createLinearGradient(0,0,0,256);
  gradient.addColorStop(0,'#c2cbd2');
  gradient.addColorStop(.31,'#8d989e');
  gradient.addColorStop(.7,'#61696f');
  gradient.addColorStop(1,'#3f494e');
  ctx.fillStyle=gradient;
  ctx.fillRect(0,0,1024,256);
  let state=975817357;
  const random=()=>((state = (Math.imul(1664525,state)+1013904223)>>>0)/4294967296);
  for(let i=0;i<750;i++) {
    const x=random()*1024, y=random()*256;
    const len=3+random()*88, a=random()*.15;
    ctx.fillStyle=i%2 ? 'rgba(242,250,255,'+a+')' : 'rgba(22,31,34,'+a+')';
    ctx.fillRect(x,y,len,1+random()*3);
  }
  for(let i=0;i<560;i++) {
    const x=random()*1024, y=random()*256, pockets=(Math.cos(x*.016)+Math.cos(x*.037))*.5;
    if (y < 74+pockets*39 || y>206+pockets*16) {
      ctx.fillStyle=i%4?'#dfe9f1':'#f4f8fb';
      ctx.globalAlpha=.12 + random()*.4;
      ctx.beginPath();ctx.ellipse(x,y,5+random()*25,2+random()*11,0,0,TAU);ctx.fill();
    }
  }
  const map=new THREE.CanvasTexture(canvas);
  map.anisotropy=4;map.colorSpace=THREE.SRGBColorSpace;
  snowBlade=material(0xe4e9ec,.69,.33,{ map,side:THREE.DoubleSide });
  return snowBlade;
}
function piston(group,outer,inner,radius=.089) {
  const center=outer.map((p,i)=>THREE.MathUtils.lerp(p,inner[i],.60));
  rod(group,graphite,outer,center,radius);
  rod(group,dullSilver,center,inner,radius*.59);
  ellipse(group,steel,...outer,radius*1.22,radius*.84,radius*.95);
  ellipse(group,steel,...inner,radius*1.22,radius*.84,radius*.95);
}

function snowcat() {
  // PistenBully 600 with an open 5.25 m all-way blade and a 5.5 m rear tiller.
  const group=new THREE.Group();
  box(group,graphite,0,.72,-.04,2.01,.66,4.96);
  box(group,steel,0,.58,.17,2.16,.26,4.62);
  const running=[];
  const wheels=[];
  for(const s of [-1,1]){
    const x=s*1.42;
    running.push(trackedAssembly(group,{x,width:1.60,z0:-1.97,z1:1.87,y:.497,radius:.447,links:44,grouser:dullSilver}));
    box(group,trim,x,.49,-.03,1.14,.46,3.85);
    for(const z of [-1.96,-1.19,-.42,.35,1.12,1.86]) {
      const r=z < -1.9 || z > 1.8 ? .40 : .339;
      wheels.push({mesh:wheel(group,s*1.88,.476,z,r,.43),r});
      rod(group, darkSteel,[s*.70,.67,z-.17],[s*1.90,.466,z],.079);
    }
    box(group,steel,s*1.36,.995,0,.52,.083,2.64);
    box(group,graphite,s*1.20,1.006,.64,.43,.132,2.46);
    for(let i=0;i<14;i++)box(group,dullSilver,s*1.40,1.064,-.42+i*.138,.195,.017,.018);
  }
  const cfL=[-1.10,1.48,1.76],cfR=[1.10,1.48,1.76],ctL=[-1.03,2.68,1.33],ctR=[1.03,2.68,1.33];
  const cbL=[-.97,1.45,-.50],cbR=[.97,1.45,-.50],crL=[-.98,2.68,-.47],crR=[.98,2.68,-.47];
  const floor = [[-1.09,1.14,1.68],[1.09,1.14,1.68],[1.03,1.14,-.57],[-1.03,1.14,-.57]];
  panel(group,paintedPanel,[cfR,cfL,floor[0],floor[1]]);
  panel(group,paintedPanel,[cbL,cbR,floor[2],floor[3]]);
  const frontPane=[cfR,cfL,ctL,ctR];
  const windshieldPoint=cabWindow(group,frontPane,windshield,.049);
  const rearPane=[cbL,cbR,crR,crL];
  cabWindow(group,rearPane,glass,.064);
  for(const s of [-1,1]){
    const [f0,f1,b0,b1,da,db]=s<0?[cfL,ctL,cbL,crL,floor[0],floor[3]]:[cfR,ctR,cbR,crR,floor[1],floor[2]];
    panel(group,paintedPanel,[da,db,b0,f0]);
    const sidePoint=cabWindow(group,[f0,b0,b1,f1],glass,.071);
    rod(group,graphite,sidePoint(.58,.07),sidePoint(.58,.935),.036);
    const surround=(u,v)=>sidePoint(u,v).map((value,i)=>i===0?value+s*.026:value);
    panel(group,paintedPanel,[surround(.765,.03),surround(1,.03),surround(1,1),surround(.865,1)]);
    panel(group,paintedPanel,[[s*1.123,1.26,1.58],surround(.81,.03),surround(1,.19),surround(1,.012)]);
    box(group,trim,s*1.105,1.49,.458,.046,.093,.27);
    box(group,dullSilver,s*1.133,1.506,.458,.028,.039,.185);
    line(group,steel,.025,[[s*1.08,2.18,1.19],[s*1.37,2.27,1.22],[s*1.48,2.23,1.29]]);
    box(group,graphite,s*1.44,2.13,1.28,.184,.37,.085).rotation.y=s*.42;
    box(group,metal,s*1.44,2.13,1.229,.154,.315,.017).rotation.y=s*.42;
    label(group,'600','#f4f7f9',s*1.033,1.736,-.38,.43,.165,s*Math.PI/2,s*.63);
    label(group,'PistenBully','#f4f7f9',s*1.11,1.34,.85,.70,.119,s*Math.PI/2);
    box(group,graphite,s*1.026,2.385,-.423,.117,.49,.223).rotation.z=s*.08;
    for(const [x,z] of [[s*.87,2.24],[s*1.00,2.67]]) {
      const pos=windshieldPoint((1-x/1.1)/2,(z-1.48)/1.2);
      const a=[pos[0],pos[1],pos[2]+.038],b=[pos[0]-.24,pos[1]-.24,pos[2]+.126];
      rod(group,graphite,a,b,.017);
      rod(group,trim,[b[0],b[1]-.15,b[2]+.045],[b[0]-.15,b[1]+.272,b[2]-.10],.018);
    }
  }
  shape(group,brightRed,[[-1.09,-.54],[1.09,-.54],[1.087,1.14],[.96,1.43],[-.96,1.43],[-1.087,1.14]],.10,'xz',2.724,.039);
  for(const x of [-.825,-.551,.551,.825]) lampBox(group,trim,lamp,x,2.703,1.393,.202,.119);
  box(group,graphite,.734,2.817,-.18,.228,.057,.145);
  ellipse(group,amber,.734,2.86,-.18,.085,.055,.068);
  rod(group,graphite,[-.845,2.781,-.407],[-.88,3.069,-.48],.013);
  for(const x of [-.836,.836]) {
    box(group,trim,x,2.694,-.558,.226,.119,.087);
    box(group,lamp,x,2.694,-.609,.173,.077,.017);
  }
  box(group,cabin,0,1.163,.524,1.93,.082,2.039);
  seat(group,0,1.416,.35,.61);
  seat(group,.643,1.372,-.065,.37);
  const dash=box(group,graphite,0,1.46,1.39,1.89,.31,.48);
  dash.rotation.x=-.20;
  const console=box(group,trim,-.40,1.661,1.28,.31,.083,.31);
  console.rotation.x=-.41;
  box(group,starboardLamp,-.40,1.698,1.27,.255,.009,.22).rotation.x=-.41;
  const steering=part(group,new THREE.TorusGeometry(.156,.018,8,30),trim,0,1.745,1.073);
  steering.rotation.x=-.72;
  rod(group,steel,[0,1.47,1.34],[0,1.735,1.073],.026);
  for(let i=0;i<3;i++){
    const a=i*TAU/3;
    rod(group,trim,[0,1.735,1.073],[.149*Math.sin(a),1.735+.111*Math.cos(a),1.073-.099*Math.cos(a)],.018);
  }
  rod(group,trim,[.40,1.49,.73],[.387,1.67,.76],.028);

  shape(group,brightRed,[[-2.46,1.03],[-.54,1.03],[-.51,1.79],[-.92,1.83],[-1.35,1.62],[-2.40,1.31]],1.74,'yz',0,.041);
  for (const s of [-1,1]){
    const x=s*.916;
    shape(group,graphite,[[-2.28,1.14],[-.78,1.16],[-.70,1.54],[-.93,1.61],[-2.24,1.35]],.030,'yz',x,.015);
    for(let i=0;i<9;i++) {
      const z=-.92-i*.15;
      box(group,trim,x+s*.024,1.42-i*.021,z,.037,.25-i*.019,.091).rotation.x=-.18;
    }
    box(group,trim,s*.82,1.47,-2.54,.24,.125,.14);
    box(group,portLamp,s*.82,1.47,-2.621,.187,.083,.021);
    rod(group,graphite,[s*.88,1.45,-1.14],[s*.88,1.72,-2.50],.038);
    for(const z of [-1.20,-1.62,-2.11,-2.50])rod(group,graphite,[s*.88,1.31,z],[s*.88,1.45+(-1.14-z)*.199,z],.034);
  }
  const ex=[.66,1.52,-.64],ey=[.66,2.37,-.64];
  rod(group,metal,ex,ey,.099);
  rod(group,graphite,[.66,2.362,-.64],[.66,2.48,-.694],.076);
  for(let i=0;i<7;i++){
    const a=i*TAU/7;
    rod(group,graphite,[.66+Math.cos(a)*.098,1.59,-.64+Math.sin(a)*.098],
      [.66+Math.cos(a)*.098,2.27,-.64+Math.sin(a)*.098],.008);
  }

  const blade=(u,v)=> {
    const x=(u-.5)*5.25;
    const offset=Math.max(Math.abs(x)-1.88,0);
    const y=.105+v*(1.14+.035*offset);
    const z=4.119-.156*(1-Math.cos(v*TAU))-.27*v+offset*.368;
    return [x,y,z];
  };
  surface(group,bladeMaterial(),44,18,blade);
  surface(group,steel,36,12,(u,v)=>blade(u,v).map((p,i)=>i===2?p-.079:p));
  for(const v of [0,1]){
    line(group,v?dullSilver:steel,v?.054:.055,Array.from({length:15},(_,i)=>blade(i/14,v)));
  }
  for(let i=0;i<14;i++){
    const u=(i+.5)/14, [x,y,z]=blade(u,.064);
    ellipse(group,graphite,x,y,z+.013,.031,.027,.012);
  }
  const edge = [[3.81,.15],[4.30,.13],[4.38,.39],[4.28,1.24],[3.89,1.25],[3.76,.65]];
  for(const s of [-1,1]) {
    shape(group,steel,edge,.069,'yz',s*2.60,.024);
    piston(group,[s*.74,1.01,2.04],[s*1.37,.62,3.83],.105);
    piston(group,[s*.76,1.33,1.94],[s*.81,1.06,3.66],.097);
    rod(group,steel,[s*.62,.55,1.75],[s*.85,.52,3.79],.144);
    line(group,trim,.036,[[s*.77,1.17,2.47],[s*.77,1.55,2.81],[s*.92,1.51,3.19],[s*.98,1.10,3.70]]);
    for(const x of [s*1.10,s*1.81]) rod(group,steel,[x,.26,3.97],[x,1.14,3.77],.067);
    rod(group,graphite,[s*2.43,1.202,4.01],[s*2.43,1.53,4.05],.026);
    ellipse(group,amber,s*2.43,1.53,4.05,.052,.043,.052);
  }
  const tiller=new THREE.Group();
  tiller.position.z=-3.62;
  group.add(tiller);
  shape(tiller,brightRed,[[.35,.20],[.49,.31],[.48,.54],[.28,.72],[-.35,.68],[-.59,.42],[-.59,.18]],5.38,'yz',0,.034);
  box(tiller,graphite,0,.192,-.42,5.48,.193,.76);
  box(tiller,steel,0,.147,.22,5.43,.17,.14);
  rod(tiller,dullSilver,[-2.66,.52,-.17],[2.66,.52,-.17],.055);
  for(let i=0;i<55;i++)box(tiller,rubber,-2.696+i*.1,.101,-.78,.067,.122,.378);
  for(const s of [-1,1]){
    box(tiller,trim,s*2.67,.43,-.317,.166,.33,.56);
    box(tiller,white,s*2.669,.51,-.608,.13,.126,.022);
    box(tiller,portLamp,s*2.669,.51,-.626,.085,.079,.015);
    piston(group,[s*.81,1.20,-2.31],[s*1.25,.63,-3.51],.088);
    rod(group,steel,[s*.67,.73,-2.26],[s*1.42,.39,-3.49],.129);
    line(group,trim,.038,[[s*.81,1.33,-2.24],[s*1.02,1.45,-2.64],[s*1.28,1.15,-3.18],[s*1.43,.59,-3.56]]);
  }
  label(tiller,'ALPIN FLEX','#eef4f7',0,.407,-.67,.98,.163,Math.PI);
  staticBatches(tiller);
  const pilot=seatedPilot(0,1.461,.35,[[-.127,1.753,1.047],[.129,1.753,1.047]],[[-.115,1.231,.75],[.117,1.231,.75]],.17);
  const setOccupied=occupiedPilot(group,pilot);
  staticBatches(group);
  return {
    group,eye:new THREE.Vector3(0,2.164,.737),setOccupied,
    animate(dt,speed) {
      if (!dt || !speed) return;
      for(const run of running) run(dt,speed);
      for(const wheel of wheels) wheel.mesh.rotation.x += speed*dt/wheel.r;
    },
  };
}

const yellow = material(0xdba800,.33,.22);
const warmYellow = material(0xffc530,.36,.12);
const grip = material(0x171c1d,.95,.025);
const orange = material(0xe75c23,.76,.03);
const lightOrange = material(0xf78836,.76,.02);
const ivory = material(0xc9dce0,.81,.04);

function snowmobile() {
  // Skandic utility sled proportions: 3.22 m long, 889 mm ski stance and 20 in track.
  const group=new THREE.Group();
  const running=trackedAssembly(group,{x:0,width:.50,z0:-1.31,z1:-.005,y:.23,radius:.196,links:43,grouser:rubber,cleats:false});
  const wheels=[];
  for(const z of [-1.31,-1.05,-.80,-.56,-.33,-.04]) {
    const r = z < -1.28 || z > -.08 ? .175 : .131;
    for(const s of [-1,1]) {
      const wheelY = r < .15 ? .169 : .227;
      wheels.push({mesh:wheel(group,s*.218,wheelY,z,r,.047),r});
    }
  }
  shape(group,metal,[[-1.50,.437],[-1.44,.588],[-1.09,.639],[-.57,.688],[.209,.555],[.220,.453]],.529,'yz',0,.016);
  shape(group,graphite,[[-1.52,.521],[-1.40,.72],[-.79,.752],[-.19,.823],[.20,.65],[.176,.518]],.529,'yz',0,.018);
  shape(group,grip,[[-1.11,.698],[-.98,.805],[-.69,.83],[-.50,.832],[-.23,.887],[.02,.872],[.17,.815],
    [.06,.717],[-.43,.685],[-.79,.689]],.399,'yz',0,.024);
  for (let i=0;i<7;i++) {
    const z=-.89+i*.141;
    const y=.825+.057*(i/7);
    rod(group,graphite,[-.187,y,z],[.187,y,z],.008);
  }
  const hood=[[-.37,.203,.714,.105,.159],[-.10,.284,.754,.209,.200],[.185,.342,.751,.293,.242],
    [.45,.349,.702,.327,.251],[.74,.311,.615,.288,.216],[.93,.226,.548,.202,.14],[1.07,.056,.510,.072,.08]];
  ringSkin(group,yellow,hood,-.37,1.068,-1.77,1.77);
  ringSkin(group,graphite,hood,-.37,1.068,1.77,TAU-1.77);
  ringSkin(group,warmYellow,hood,.219,.976,-.323,.323,.009);
  for(const s of [-1,1]){
    shape(group,graphite,[[-.09,.533],[.111,.762],[.535,.73],[.628,.65],[.549,.548],[.145,.473]],.037,'yz',s*.306,.014);
    for(let i=0;i<6;i++) {
      const z=.163+i*.065;
      box(group,trim,s*.335,.616,z,.022,.14,.035).rotation.x=-.48;
    }
    const step=box(group,steel,s*.317,.469,-.53,.21,.031,1.409);
    step.rotation.x=-.035;
    for(let i=0;i<12;i++)box(group,dullSilver,s*.316,.488,-1.11+i*.103,.162,.019,.025);
    label(group,'SKANDIC','#eff4f6',s*.362,.675,.326,.42,.096,s*Math.PI/2);
    const z=.752;
    ellipse(group,graphite,s*.147,.756,z,.135,.084,.102).rotation.x=-.34;
    ellipse(group,lamp,s*.147,.761,z+.049,.104,.057,.068).rotation.x=-.34;
  }
  line(group,graphite,.03,[[-.322,.513,.479],[-.34,.488,.790],[-.245,.449,1.059],[0,.456,1.147],
    [.245,.449,1.059],[.34,.488,.790],[.322,.513,.479]]);
  line(group,graphite,.022,[[-.24,.641,-1.09],[-.275,.664,-1.45],[0,.681,-1.59],[.275,.664,-1.45],[.24,.641,-1.09]]);
  for(const x of [-.218,.218])rod(group,graphite,[x,.701,-.97],[x,.701,-1.47],.024);
  for(const z of [-1.08,-1.24,-1.41])rod(group,graphite,[-.26,.715,z],[.26,.715,z],.019);
  box(group,trim,0,.58,-1.51,.31,.13,.10);
  box(group,portLamp,0,.591,-1.567,.231,.072,.021);
  rod(group,darkSteel,[0,.422,-1.41],[0,.365,-1.60],.039);

  const skiGroups=[];
  for(const s of [-1,1]) {
    const x=s*.4445;
    const ski=new THREE.Group();
    ski.position.set(x,0,.81);
    group.add(ski);
    skiGroups.push(ski);
    shape(ski,grip,[[-.47,.031],[-.38,.062],[.335,.061],[.614,.115],[.807,.222],[.819,.147],[.644,.075],[.439,.029],[-.37,.018]],.149,'yz',0,.012);
    line(ski,warmYellow,.025,[[0,.124,.393],[0,.211,.486],[0,.292,.628],[0,.303,.753],[0,.223,.799]]);
    for(const sign of [-1,1])rod(ski,graphite,[0,.078,-.071],[sign*.079,.113,.083],.025);
    rod(ski,steel,[0,.110,-.057],[0,.273,-.02],.042);
    rod(group,steel,[s*.205,.506,.734],[x,.116,.756],.040);
    rod(group,graphite,[s*.164,.547,.535],[x,.191,.762],.029);
    const coil=[];
    for(let i=0;i<=45;i++) {
      const t=i/45,a=t*TAU*6;
      coil.push([THREE.MathUtils.lerp(s*.270,x,t)+.043*Math.cos(a),THREE.MathUtils.lerp(.505,.202,t),.752+.043*Math.sin(a)]);
    }
    line(group,trim,.009,coil);
    staticBatches(ski);
  }

  const wind=(u,v)=>{
    const d=u*2-1;
    return [d*(.276-.033*v), .972+.405*v-.025*d*d,.55-.204*v-.138*d*d];
  };
  surface(group,windshield,16,8,wind);
  const windEdge=[
    ...Array.from({length:9},(_,i)=>wind(i/8,0)),
    ...Array.from({length:8},(_,i)=>wind(1,(i+1)/8)),
    ...Array.from({length:8},(_,i)=>wind(1-(i+1)/8,1)),
    ...Array.from({length:8},(_,i)=>wind(0,1-(i+1)/8)),
  ];
  line(group,graphite,.009,windEdge);
  const dash=box(group,trim,0,1.00,.381,.221,.079,.141);
  dash.rotation.x=-.46;
  box(group,glass,0,1.037,.378,.158,.013,.106).rotation.x=-.46;
  box(group,material(0x87b3a8,.51,.03),0,1.031,.377,.143,.012,.080).rotation.x=-.46;

  const handles=new THREE.Group();
  handles.position.set(0,1.115,.207);
  group.add(handles);
  rod(group,graphite,[0,.812,.117],[0,1.117,.207],.037);
  line(handles,steel,.026,[[-.337,-.009,-.069],[-.252,-.001,-.014],[-.10,-.046,.019],[0,-.055,.029],
    [.10,-.046,.019],[.252,-.001,-.014],[.337,-.009,-.069]]);
  for(const s of [-1,1]){
    rod(handles,grip,[s*.219,.004,-.009],[s*.344,-.005,-.078],.033);
    rod(handles,graphite,[s*.225,.027,.008],[s*.335,.024,-.015],.011);
    box(handles,brightRed,s*.204,.031,-.007,.033,.014,.031);
    rod(group,graphite,[s*.242,1.051,.33],[s*.339,1.198,.358],.019);
    ellipse(group,graphite,s*.353,1.218,.353,.091,.039,.019);
    ellipse(group,metal,s*.353,1.218,.336,.08,.033,.012);
  }
  const mount = { hipY:.925, hipZ:-.37, hinge:.47, grip:[.28,1.12,.16],
    feet:[new THREE.Vector3(-.31,.469,-.43),new THREE.Vector3(.31,.469,-.43)] };
  staticBatches(group);
  return {
    group,eye:new THREE.Vector3(0,1.64,-.29),mount,
    animate(dt,speed,clock,steering=0) {
      handles.rotation.y = -steering*.24;
      mount.grip[1] = 1.117;
      mount.grip[2] = .16;
      for(const ski of skiGroups) ski.rotation.y = -steering*.29;
      if(!dt || !speed) return;
      running(dt,speed);
      for(const wheel of wheels) wheel.mesh.rotation.x+=speed*dt/wheel.r;
    },
  };
}

function mountainBike() {
  const group = new THREE.Group();
  const frame = material(0x2d7482, .32, .48);
  const front = new THREE.Group(), crank = new THREE.Group();
  front.position.set(0,.85,.454);
  crank.position.set(0,.385,-.095);
  group.add(front, crank);
  const main = [0,.385,-.095], collar = [0,.79,-.24], top = [0,.867,.454], lower = [0,.69,.505];
  rod(group, frame, top, collar, .028);
  rod(group, frame, lower, main, .048);
  rod(group, frame, main, collar, .036);
  rod(group, frame, top, lower, .041);
  rod(group, steel, collar, [0,.891,-.27], .015);
  ellipse(group, leather, 0,.9,-.307,.09,.029,.146);
  for (const side of [-1,1]) {
    const back = [side*.073,.366,-.638];
    rod(group, frame, [side*.061,.405,-.11], back, .019);
    rod(group, frame, [side*.04,.71,-.24], back, .016);
    rod(front, graphite, [side*.073,-.048,.016], [side*.072,-.484,.187], .025);
    rod(front, metal, [side*.075,-.088,.036], [side*.074,-.304,.116], .016);
  }
  line(group, metal, .017, [[0,.584,.32],[0,.542,.21],[0,.493,.114],[0,.436,.027]]);
  const cable = [[-.27,.988,.49],[-.07,.934,.558],[.039,.762,.492],[.035,.515,-.095],[.049,.397,-.58]];
  line(group, trim, .004, cable);
  rod(front, graphite, [0,-.019,0], [0,.143,.029], .015);
  line(front, steel, .014, [[-.36,.144,-.028],[-.21,.126,.016],[0,.135,.031],[.21,.126,.016],[.36,.144,-.028]]);
  for (const side of [-1,1]) {
    rod(front, rubber, [side*.245,.134,.008], [side*.366,.147,-.033], .0155);
    rod(front, metal, [side*.274,.157,.038], [side*.347,.157,.025], .0045);
  }
  function wheelModel(parent, y, z) {
    const wheel = new THREE.Group();
    wheel.position.set(0,y,z);
    parent.add(wheel);
    const tire = part(wheel, new THREE.TorusGeometry(.33,.035,10,58), rubber);
    const rim = part(wheel, new THREE.TorusGeometry(.304,.012,6,58), graphite);
    tire.rotation.y = rim.rotation.y = Math.PI / 2;
    for (const side of [-1,1]) {
      rod(wheel, steel, [0,0,0], [side*.052,0,0], .027);
      for (let i=0; i<12; i++) {
        const phase = (i + (side > 0 ? .46 : 0)) * TAU / 12;
        rod(wheel, metal, [side*.048,0,0], [0,.305*Math.sin(phase),.305*Math.cos(phase)], .0015);
      }
    }
    for (let i=0; i<40; i++) {
      const a = i * TAU / 40;
      const block = box(wheel, graphite, 0,.362*Math.cos(a),.362*Math.sin(a),.05,.008,.026);
      block.rotation.x = a;
    }
    staticBatches(wheel);
    return wheel;
  }
  const wheels = [wheelModel(group,.366,-.638),wheelModel(front,-.484,.187)];
  const pedals = [];
  const mount = { hipY:.977, hipZ:-.248, hinge:.63, grip:[.325,.99,.448],
    feet:[new THREE.Vector3(),new THREE.Vector3()] };
  for (const side of [-1,1]) {
    rod(crank, steel, [side*.079,0,0], [side*.091,side*.167,0], .012);
    const pedal = new THREE.Group();
    pedal.position.set(side*.132,side*.167,0);
    box(pedal, trim, 0,0,0,.118,.018,.096);
    crank.add(pedal);
    pedals.push(pedal);
  }
  staticBatches(group);
  staticBatches(front);
  staticBatches(crank);
  return {
    group, eye:new THREE.Vector3(0,1.6,.107),mount,
    animate(dt,speed,clock,steer,pedalling) {
      front.rotation.y = -steer * .32;
      for (const wheel of wheels) wheel.rotation.x += speed * dt / .366;
      if (pedalling) crank.rotation.x += dt * Math.min(10.1,3 + speed * .54);
      for (const [i,pedal] of pedals.entries()) {
        pedal.rotation.x = -crank.rotation.x;
        mount.feet[i].copy(pedal.position).applyEuler(crank.rotation).add(crank.position);
      }
    },
  };
}

function inflatingWing(parent,{top,bottom,leading,trailing,lift}) {
  surface(parent,top,16,10,(u,v)=>{
    const chord=1-u;
    const front=leading(chord), back=trailing(chord);
    const [x,y,z]=front.map((p,i)=>THREE.MathUtils.lerp(p,back[i],v));
    return [x,y+Math.sin(Math.PI*v)*lift(chord),z];
  });
  surface(parent,bottom,16,10,(u,v)=>{
    const front=leading(u), back=trailing(u);
    const [x,y,z]=front.map((p,i)=>THREE.MathUtils.lerp(p,back[i],v));
    return [x,y-Math.sin(Math.PI*v)*lift(u)*.62,z];
  });
  for(const edge of [leading,trailing]) {
    line(parent,trim,.009,Array.from({length:12},(_,i)=>edge(i/11)));
  }
  for(let i=1;i<6;i++){
    const u=i/6, a=leading(u), b=trailing(u);
    line(parent,bottom,.004,Array.from({length:8},(_,j)=>{
      const v=j/7;
      return [THREE.MathUtils.lerp(a[0],b[0],v),
        THREE.MathUtils.lerp(a[1],b[1],v)+Math.sin(Math.PI*v)*lift(u)+.003,
        THREE.MathUtils.lerp(a[2],b[2],v)];
    }));
  }
}
function flightMembranes() {
  const pilot = new THREE.Group();
  for(const s of [-1,1]) {
    const leading=u=>[s*THREE.MathUtils.lerp(.175,.909,u),.506-u*.058,.398-.247*u];
    const trailing=u=>[s*THREE.MathUtils.lerp(.16,.909,u),.494-u*.043,-.34+.491*u**2];
    inflatingWing(pilot,{top:lightOrange,bottom:orange,leading:s<0?u=>leading(1-u):leading,
      trailing:s<0?u=>trailing(1-u):trailing,lift:u=>.066*Math.sin(Math.PI*u)+.017});
    const ventZ=.24;
    ellipse(pilot,trim,s*.385,.539,ventZ,.054,.017,.069).rotation.y=s*.2;
    ellipse(pilot,darkSteel,s*.385,.548,ventZ-.024,.048,.014,.032);
  }
  inflatingWing(pilot,{
    top:orange,bottom:suitPants,
    leading:u=>[(u-.5)*.236,.50,-.286-.091*Math.sin(u*Math.PI)],
    trailing:u=>[(u-.5)*.50,.457,-1.061-.042*Math.sin(u*Math.PI)],
    lift:u=>.062*Math.sin(Math.PI*u),
  });
  staticBatches(pilot);
  return pilot;
}
function readyPilot() {
  const pilot=new THREE.Group();
  ellipse(pilot,orange,0,1.228,0,.225,.31,.145);
  ellipse(pilot,suitPants,0,.962,-.015,.179,.146,.127);
  ellipse(pilot,trim,0,1.27,-.159,.181,.268,.107);
  ellipse(pilot,darkSteel,0,1.33,-.218,.148,.182,.056);
  for(const s of [-1,1]) {
    segment(pilot,orange,[s*.16,1.42,.005],[s*.286,1.15,.02],.080,.074);
    segment(pilot,suitPants,[s*.286,1.15,.02],[s*.29,.965,.139],.063,.062);
    ellipse(pilot,trim,s*.29,.956,.155,.052,.075,.054);
    const start=[s*.102,.982,-.003], knee=[s*.169,.584,.065], ankle=[s*.188,.155,.011];
    segment(pilot,suitPants,start,knee,.104,.092);
    segment(pilot,orange,knee,ankle,.085,.081);
    ellipse(pilot,trim,s*.187,.073,.076,.079,.073,.167);
    const armCloth=orange.clone();armCloth.side=THREE.DoubleSide;
    panel(pilot,armCloth,[[s*.185,1.387,-.015],[s*.253,1.173,-.019],[s*.284,1.014,.084],[s*.120,.958,-.079]],8,8);
    line(pilot,trim,.017,[[s*.10,1.48,-.126],[s*.137,1.41,.085],[s*.132,1.265,.142],[s*.115,1.073,.127]]);
    box(pilot,metal,s*.126,1.282,.141,.048,.056,.016);
  }
  const legCloth=suitPants.clone();legCloth.side=THREE.DoubleSide;
  panel(pilot,legCloth,[[-.101,.902,-.043],[.115,.937,-.049],[.17,.278,.010],[-.17,.311,.01]],8,8);
  rod(pilot,trim,[-.14,1.213,.13],[.14,1.217,.13],.023);
  box(pilot,metal,0,1.216,.153,.045,.049,.02);
  head(pilot,0,1.622,.016);
  staticBatches(pilot);
  return pilot;
}
function wingsuit() {
  const group=new THREE.Group();
  const flight=flightMembranes();
  const parked=readyPilot();
  group.add(flight,parked);
  flight.visible=false;
  const mount = { hipY:.84, hipZ:.05, hinge:.10, grip:[.7,1.14,.18],
    feet:[new THREE.Vector3(-.232,.032,.17),new THREE.Vector3(.232,.032,.17)] };
  return {
    group,eye:new THREE.Vector3(0,.585,.80), mount, span:.70,
    setOccupied(occupied,cockpit) {
      parked.visible=!occupied;
      flight.visible=occupied&&!cockpit;
    },
    animate(dt,speed,clock,steering,posture=0) {
      const phase=clock*.8;
      const spread = 1 - posture * .21;
      flight.rotation.z = .012*Math.sin(phase*1.19);
      flight.scale.set(.76*spread,1+posture*.07,1-posture*.07);
      mount.grip[0] = .7*spread;
      mount.grip[1] = 1.14-posture*.15;
      mount.hipY = .84-posture*.04;
      mount.hinge = .10+posture*.10;
      mount.feet[0].set(-.208*spread,.032+Math.max(0,posture)*.07,.17);
      mount.feet[1].set(.208*spread,.032+Math.max(0,posture)*.07,.17);
      this.span = .70*spread;
    },
  };
}
