import { addPassGate } from './pass-gates.js';
import * as THREE from 'three';
import { beam, box, cacheStaticTransforms, mergeParts, part } from './scenery.js';
import { canvasTexture, makeCanvas } from './util.js';
import { createIcicles, createRoofSnow } from './roof-weather.js';

const dark = '#28343a', zinc = '#7d8c93', light = '#aebbc0', iron = '#53646b';
const rubber = '#263239', snow = '#f2f5f3';
const liftMetal = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.57, metalness:.22 });
const ropeMetal = new THREE.MeshStandardMaterial({ color:'#26323a', roughness:.69, metalness:.24,
  transparent:true, depthWrite:false });
const ropeViewportHeight = { value: 720 };
const ropeViewport = new THREE.Vector2();
let ropeRenderer, ropeFrame = -1;
ropeMetal.onBeforeRender = renderer => {
  if (ropeRenderer === renderer && ropeFrame === renderer.info.render.frame) return;
  ropeRenderer = renderer;
  ropeFrame = renderer.info.render.frame;
  ropeViewportHeight.value = Math.max(1, renderer.getDrawingBufferSize(ropeViewport).y);
};
ropeMetal.customProgramCacheKey = () => 'subpixel-lift-cable';
ropeMetal.onBeforeCompile = shader => {
  shader.uniforms.ropeViewportHeight = ropeViewportHeight;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float cableRadius;
      uniform float ropeViewportHeight;
      varying float cableCoverage;
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      float depth = -(modelViewMatrix * vec4(position,1.)).z;
      float projectedDepth = isPerspectiveMatrix(projectionMatrix) ? max(.01, depth) : 1.;
      float minRadius = min(18., 1.3 * projectedDepth / (ropeViewportHeight * projectionMatrix[1][1]));
      float drawRadius = max(cableRadius, minRadius);
      transformed += normal * (drawRadius - cableRadius);
      cableCoverage = cableRadius / drawRadius;
    `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float cableCoverage;
    `).replace('#include <opaque_fragment>', `
      if (cableCoverage < .999) {
        // Approximate fractional coverage without requiring a multisampled target.
        float facing = abs(dot(normal, normalize(vViewPosition)));
        float edge = smoothstep(.06,.58,facing);
        diffuseColor.a *= cableCoverage * mix(edge,1.,smoothstep(.72,1.,cableCoverage));
      }
      #include <opaque_fragment>
    `);
};
const windowGlass = new THREE.MeshStandardMaterial({ color:'#435b65', roughness:.24, metalness:.28 });
export const movingGlass = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.17, metalness:.14,
  transparent:true, opacity:.27, depthWrite:false, side:THREE.DoubleSide });

function cylinder(radius, length, tint, at, rotation, topRadius = radius, sides = 10) {
  return part(new THREE.CylinderGeometry(topRadius, radius, length, sides), tint, at, rotation);
}

function pipe(from, to, radius, tint) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
  return cylinder(radius, direction.length(), tint, a.lerp(b, .5).toArray(), rotation.toArray(), radius, 7);
}

function elbow(points, radius, tint) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return part(new THREE.TubeGeometry(curve, points.length * 4, radius, 7), tint);
}

export function liftParts(parts) {
  const geometry = mergeParts(parts,true);
  for (const item of parts) item.geo.dispose();
  return geometry;
}

function assembly(group, parts, name, shadows = true) {
  const mesh = new THREE.Mesh(liftParts(parts), liftMetal);
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export function createLiftInstances(group, geometry, n, name, material=liftMetal) {
  const mesh = new THREE.InstancedMesh(geometry,material,n);
  mesh.name = name;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  group.add(mesh);
  return mesh;
}

export function chairGeometry(lift) {
  const { seats, detachable, paint, vintage } = lift;
  const pitch = .52, width = seats * pitch + .13, arm = width / 2 - .045;
  const pad = vintage ? '#263236' : '#222b2e';
  const structure = [
    box(.26, .155, .47, iron, [0, -.057, .01]),
    box(.105, .15, .34, zinc, [-.10, -.08, 0]),
    elbow([[0,-.128,0],[.014,-.43,-.03],[.02,-1.37,-.245],[0,-1.63,-.29]], .051, zinc),
    box(width,.072,.078,zinc,[0,-1.67,-.305]),
    box(width,.09,.078,iron,[0,-2.23,-.266]),
    box(width,.087,.12,iron,[0,-2.23,.205]),
    box(.155,.103,.025,paint,[0,-1.733,-.355]),
  ];
  for (const side of [-1, 1]) {
    const x = side * arm;
    structure.push(elbow([[x,-1.68,-.29],[x,-1.98,-.255],[x,-2.23,-.19],[x,-2.23,.237]], .04, light));
    structure.push(cylinder(.068,.085,iron,[x,-1.77,-.253],[0,0,Math.PI/2]));
  }
  for (let i = 0; i < seats; i++) {
    const x = (i - (seats - 1) / 2) * pitch;
    structure.push(box(.488,.059,.473,pad,[x,-2.176,.005]));
    structure.push(box(.486,.044,.064,'#374145',[x,-2.17,.236]));
    if (!vintage) structure.push(box(.483,.36,.057,pad,[x,-1.946,-.206],[-.076,0,0]));
    for (let slat = 0; slat < (vintage ? 5 : 3); slat++) {
      structure.push(box(.469,.042,.045,vintage ? iron : '#46555c',[x,-2.106+slat*.077,vintage ? -.238 : -.244]));
    }
    structure.push(box(.43,.020,.021,'#49575a',[x,-2.143,.208]));
    structure.push(box(.030,.410,.033,zinc,[x + pitch*.452,-1.955,-.279]));
    structure.push(box(.27,.034,.023,paint,[x,-1.745,-.275]));
  }
  if (detachable) {
    structure.push(box(.31,.122,.45,light,[.025,-.054,.04]));
    structure.push(cylinder(.072,.23,iron,[.196,-.045,.04],[Math.PI/2,0,0]));
    for (const z of [-.054,.01,.074,.138])
      structure.push(part(new THREE.TorusGeometry(.074,.012,5,10),'#71848b',[.196,-.045,z]));
    structure.push(cylinder(.068,.085,rubber,[.16,-.012,.304],[0,0,Math.PI/2]));
  } else {
    structure.push(box(.15,.14,.31,light,[0,-.052,0]));
    for (const z of [-.133,.133]) structure.push(cylinder(.036,.065,dark,[.091,-.055,z],[0,0,Math.PI/2]));
  }
  // Geometry is local to the rear hinges. The restraint lifts through the station.
  const bar = [pipe([-arm,-.012,.74],[arm,-.012,.74],.032,light),
    pipe([-arm*.74,-.012,.74],[arm*.74,-.012,.74],.035,rubber)];
  for (const x of [-arm,arm]) bar.push(elbow([[x,0,0],[x,.034,.32],[x,.003,.665],[x,-.012,.74]], .030, zinc));
  for (let i = 0; i < Math.ceil(seats/2); i++) {
    const x = (i - (Math.ceil(seats/2) - 1) / 2) * pitch * 2;
    bar.push(elbow([[x,-.013,.731],[x,-.50,.695],[x,-.83,.58]], .028, zinc));
    bar.push(box(Math.min(width*.73,.72),.045,.19,iron,[x,-.823,.597]));
  }
  const far = [box(width,.10,.54,'#35444b',[0,-2.20,0]),
    box(width,.39,.057,'#394b55',[0,-1.95,-.235]),
    box(width,.052,.055,light,[0,-1.74,-.24]),
    beam([0,-.07,0],[0,-1.73,-.3],.074,.074,zinc)];
  return { body:liftParts(structure), bar:liftParts(bar), far:liftParts(far) };
}

export function seatedRiderGeometry(palette) {
  const [jacket,pants,helmet] = palette;
  const ellipsoid = (sx,sy,sz,tint,p) => part(new THREE.SphereGeometry(1,10,7),tint,p,[0,0,0],[sx,sy,sz]);
  const pieces = [ellipsoid(.198,.257,.117,jacket,[0,.625,-.126]),
    ellipsoid(.158,.105,.123,pants,[0,.392,-.09]),
    ellipsoid(.123,.135,.122,helmet,[0,.997,-.081]),
    ellipsoid(.102,.056,.041,'#344f5b',[0,1.002,.020]),
    ellipsoid(.075,.046,.056,'#b8927e',[0,.941,.008]),
    box(.301,.045,.12,'#334656',[0,.456,-.167])];
  for (const s of [-1,1]) {
    const x = s * .105;
    pieces.push(pipe([x,.397,-.065],[x,.374,.272],.097,pants));
    pieces.push(pipe([x,.375,.262],[x,.039,.343],.075,pants));
    pieces.push(box(.15,.118,.285,dark,[x,.027,.390]));
    pieces.push(box(.094,.019,1.60,s<0?'#b28e41':'#cfaa5c',[x,-.042,.697],[-.043,0,s*.018]));
    pieces.push(pipe([s*.159,.780,-.108],[s*.213,.575,-.014],.064,jacket));
    pieces.push(pipe([s*.209,.571,-.019],[s*.182,.542,.234],.057,jacket));
    pieces.push(ellipsoid(.063,.048,.072,dark,[s*.183,.545,.264]));
  }
  return liftParts(pieces);
}

export function gondolaGeometry(lift, distantDetail = false) {
  const parts = [box(.25,.15,.46,iron,[0,-.06,0]),
    elbow([[0,-.09,0],[0,-.39,.05],[0,-.775,0]],.068,zinc),
    box(1.80,.14,1.91,lift.paint,[0,-.92,0]),
    box(1.92,.29,2.02,lift.paint,[0,-3.13,0]),
    box(1.92,.08,2.02,light,[0,-2.946,0]),
    box(1.43,.09,.78,iron,[0,-2.69,-.52]),
  ];
  const glass=[];
  for (const x of [-.93,.93]) {
    glass.push(box(.012,1.94,1.94,'#446370',[x,-1.99,0]));
    parts.push(box(.094,2.18,.081,iron,[x,-1.99,0]));
  }
  for (const z of [-.965,.965]) {
    glass.push(box(1.82,1.94,.012,'#4d707f',[0,-1.995,z]));
    for (const x of [-.91,.91]) parts.push(box(.091,2.18,.092,zinc,[x,-1.992,z]));
  }
  const far = distantDetail ? liftParts([
    box(.25,.15,.46,iron,[0,-.06,0]),
    beam([0,-.09,0],[0,-.88,0],.117,.117,zinc),
    box(1.80,.14,1.91,lift.paint,[0,-.92,0]),
    box(1.92,.29,2.02,lift.paint,[0,-3.13,0]),
    box(1.92,.08,2.02,light,[0,-2.946,0]),
    box(1.84,1.95,1.94,'#455963',[0,-1.988,0]),
    ...[-.91,.91].flatMap(x => [-.965,.965].map(z => box(.094,2.18,.092,zinc,[x,-1.99,z]))),
  ]) : null;
  return { body:liftParts(parts), glass:liftParts(glass), far };
}

function simplifyRope(points) {
  const last = points.length - 1;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[last] = 1;
  const pending = [[0,last]], chord = new THREE.Line3(), closest = new THREE.Vector3();
  while (pending.length) {
    const [first,end] = pending.pop();
    chord.set(points[first],points[end]);
    let next = -1, error = .012**2;
    for (let i = first + 1; i < end; i++) {
      chord.closestPointToPoint(points[i],true,closest);
      const deviation = points[i].distanceToSquared(closest);
      if (deviation <= error) continue;
      next = i;
      error = deviation;
    }
    if (next < 0) continue;
    keep[next] = 1;
    pending.push([first,next],[next,end]);
  }
  return points.filter((point,index) => keep[index]);
}

function ropeTube(points, radius) {
  const sides = 6, vertices = [], indices = [], normals = [];
  const tangent = new THREE.Vector3(), sideways = new THREE.Vector3(), upright = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    tangent.subVectors(points[Math.min(i+1,points.length-1)], points[Math.max(i-1,0)]).normalize();
    sideways.set(tangent.z,0,-tangent.x).normalize();
    upright.crossVectors(tangent,sideways);
    for (let s = 0; s < sides; s++) {
      const angle = s * Math.PI * 2 / sides, a = Math.cos(angle), b = Math.sin(angle);
      const nx = a*sideways.x+b*upright.x, ny = b*upright.y, nz = a*sideways.z+b*upright.z;
      vertices.push(p.x+radius*nx,p.y+radius*ny,p.z+radius*nz);
      normals.push(nx,ny,nz);
      if (i > 0) {
        const c = i*sides+s, d = i*sides+(s+1)%sides, prev = c-sides, next = d-sides;
        indices.push(prev,next,c,next,d,c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('cableRadius', new THREE.BufferAttribute(new Float32Array(vertices.length / 3).fill(radius), 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += 18;
  return new THREE.Mesh(geometry,ropeMetal);
}

function sheaves(parts, gauge, distance, angle, wheels, vintage) {
  for (const x of [-gauge,gauge]) {
    const frame = (y,z) => [x,y*Math.cos(angle)-z*Math.sin(angle),y*Math.sin(angle)+z*Math.cos(angle)];
    const spacing = vintage ? .271 : .305;
    parts.push(box(.24,.12,spacing*wheels+.12,zinc,frame(-.34,distance),[angle,0,0]));
    for (let i = 0; i < wheels; i++) {
      const z = distance+(i-(wheels-1)/2)*spacing;
      parts.push(cylinder(.139,.134,rubber,frame(-.143,z),[0,0,Math.PI/2],.139,14));
      parts.push(cylinder(.100,.161,zinc,frame(-.143,z),[0,0,Math.PI/2],.1,12));
      parts.push(cylinder(.054,.189,light,frame(-.143,z),[0,0,Math.PI/2],.054,9));
      parts.push(cylinder(.025,.199,dark,frame(-.143,z),[0,0,Math.PI/2],.025,6));
    }
    for (const s of [-1,1]) {
      const a = frame(-.39,distance+s*.48), b = frame(-.38,distance-s*.03);
      parts.push(beam(a,b,.26,.18,iron));
    }
  }
}

function support(group, lift, frame, previous, next, index, ground, colliders, distantDetail) {
  const { gauge, paint, vintage } = lift;
  const y = ground.heightAt(frame.x,frame.z), height = frame.y-y;
  const root = distantDetail ? new THREE.LOD() : new THREE.Group();
  root.position.set(frame.x,frame.y,frame.z); root.rotation.y = frame.heading;
  root.name = `${lift.def.name} · tower ${index + 1}`;
  group.add(root);
  const radius = vintage ? .31 : .42;
  const grade = Math.atan2(next.y-previous.y,Math.hypot(next.x-previous.x,next.z-previous.z));
  function buildDetail(parent) {
    const parts = [cylinder(radius*1.25,height-.20,paint,[0,-height/2-.20,0],undefined,.70*radius,12),
      cylinder(radius+.25,.55,'#777e7c',[0,-height+.04,0],undefined,radius+.24,12),
      cylinder(radius+.12,.092,'#a7b3b2',[0,-height+.341,0],undefined,radius+.12,12),
      box(gauge*2+.37,.194,.22,paint,[0,-.37,0]),
      box(gauge*2+.42,.098,.31,zinc,[0,-.493,0]),
      box(gauge*2+.12,.07,.84,iron,[0,-.645,.155]),
      box(.7,.063,.59,'#b3aa70',[0,-.64,.684]),
      box(.078,height-1.23,.052,light,[-.178,-height/2-.10,-radius]),
      box(.078,height-1.23,.052,light,[.178,-height/2-.10,-radius])];
    for (let z = -height + .69; z < -.7; z += .29) parts.push(box(.368,.027,.042,zinc,[0,z,-radius-.015]));
    for (const x of [-gauge,gauge]) {
      parts.push(beam([0,-1.12,0],[x*.79,-.47,0],.095,.122,paint));
      parts.push(beam([x*.89,.18,.58],[x*.89,-.64,.58],.042,.042,light));
    }
    parts.push(pipe([-gauge*.89,.18,.58],[gauge*.89,.18,.58],.022,light));
    sheaves(parts,gauge,0,-grade,index%4 === 0 ? 8 : 6,vintage);
    parts.push(box(.20,.20,.08,'#5d5131',[0,-1.05,-radius-.05]));
    return assembly(parent,parts,'Galvanized mast, foundation, ladder, crosshead and sheaves');
  }
  if (distantDetail) {
    const silhouette = [
      cylinder(radius*1.25,height-.20,paint,[0,-height/2-.20,0],undefined,.70*radius,8),
      cylinder(radius+.25,.55,'#777e7c',[0,-height+.04,0],undefined,radius+.24,8),
      box(gauge*2+.42,.26,.31,paint,[0,-.42,0]),
      box(gauge*2+.12,.07,.84,iron,[0,-.645,.155]),
    ];
    for (const x of [-gauge,gauge]) {
      silhouette.push(beam([0,-1.12,0],[x*.79,-.47,0],.095,.122,paint),
        box(.26,.33,index%4 === 0 ? 2.55 : 1.96,dark,[x,-.17,0],[-grade,0,0]));
    }
    const detailed = new THREE.Group();
    const distant = assembly(root,silhouette,'Distant mast, crosshead and sheaves');
    root.addLevel(detailed);
    root.addLevel(distant,210,.08);
    distant.visible = false;
    let mesh;
    root.update = camera => {
      THREE.LOD.prototype.update.call(root,camera);
      if (detailed.visible && !mesh) {
        mesh = buildDetail(detailed);
        mesh.updateWorldMatrix(false,false);
        mesh.matrixAutoUpdate = false;
      } else if (mesh && !detailed.visible && root.position.distanceToSquared(camera.position) > 335 ** 2) {
        mesh.geometry.dispose();
        detailed.remove(mesh);
        mesh = null;
      }
    };
  } else {
    buildDetail(root);
  }
  colliders.push({ x:frame.x,z:frame.z,r:radius+.21,radius:radius+.21,type:'lift-tower',maxY:frame.y-1.2 });
}

function liftSignTexture(title, detail) {
  const { canvas,ctx } = makeCanvas(768,178);
  ctx.fillStyle='#202e36';ctx.fillRect(0,0,768,178);
  ctx.fillStyle='#c5a56e';ctx.fillRect(0,0,768,12);
  ctx.fillStyle='#f7f8ed';ctx.font='700 66px "Barlow Condensed", Arial';
  ctx.textBaseline='middle'; ctx.textAlign='center';
  ctx.fillText(title.toUpperCase(),384,83,704);
  ctx.font='600 32px "Barlow", Arial';ctx.fillStyle='#d5cdb2';
  ctx.fillText(detail,384,142,714);
  return canvasTexture(canvas);
}

function sign(group, title, detail, x,y,z,width,faceOffset) {
  if (typeof document === 'undefined') return;
  const material = new THREE.MeshStandardMaterial({ roughness:.74 });
  const halfWidth = width / 2, halfHeight = halfWidth * 178 / 768;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([
    -halfWidth,-halfHeight,faceOffset, halfWidth,-halfHeight,faceOffset,
    -halfWidth,halfHeight,faceOffset, halfWidth,halfHeight,faceOffset,
    halfWidth,-halfHeight,-faceOffset, -halfWidth,-halfHeight,-faceOffset,
    halfWidth,halfHeight,-faceOffset, -halfWidth,halfHeight,-faceOffset,
  ],3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1,0,0,1,0,0,1,1,1],2));
  geometry.setIndex([0,1,2,1,3,2,4,5,6,5,7,6]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry,material);
  mesh.onBeforeRender = () => {
    material.map = liftSignTexture(title, detail);
    material.needsUpdate = true;
    mesh.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
  };
  mesh.name=title;mesh.position.set(x,y,z);group.add(mesh);
}

function skinSection(parts, a, b, tint) {
  const points = [...a[0],...a[1],...b[1], ...a[0],...b[1],...b[0]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  geometry.computeVertexNormals(); parts.push(part(geometry,tint));
}

function hood(parts, gauge, length, top, paint, cableRise, stevensHogsback = false, coarse = false, weather) {
  const width = gauge + 1.05, end = top ? 1 : -1;
  const sections = [[-width,0],[-width-.05,.35],[-width+.36,.84],[-width+.82,1.08],
    [-.42,1.22],[.42,1.22],[width-.82,1.08],[width-.36,.84],[width+.05,.35],[width,0]];
  const z0 = end*(gauge+.38), z1 = z0-end*length;
  const shape = (i,z) => [sections[i][0],sections[i][1]+.34+cableRise(z),z];
  const panel = (a,b,tint) => top ? skinSection(parts,b,a,tint) : skinSection(parts,a,b,tint);
  const lining = ([x,y,z]) => [x,y-.038,z];
  for (let i = 0; i < sections.length-1; i++) {
    const start=[shape(i,z1),shape(i+1,z1)],finish=[shape(i,z0),shape(i+1,z0)];
    const skin = stevensHogsback ? (i === 0 || i === 8 ? '#caad77' : '#bdb7a2') : i === 0 || i === 8 ? iron : paint;
    panel(start,finish,skin);
    panel(finish.map(lining),start.map(lining),'#33454e');
    if (i > 2 && i < 6) {
      const a = z1+end*.25, b = z0-end*.14;
      if (weather) {
        const high = i === 5 ? i : i+1, low = i === 5 ? i+1 : i;
        weather.add(createRoofSnow([shape(high,a),shape(high,b),shape(low,b),shape(low,a)],
          { seed: 540+i*38+Number(top), depth: i === 4 ? .126 : .164, spacing: .67, overhang: .037 }));
      } else {
        const loft = (j,z) => shape(j,z).map((v,k) => v + (k === 1 ? .10 : 0));
        panel([loft(i,a),loft(i+1,a)], [loft(i,b),loft(i+1,b)],snow);
      }
    }
    if (!coarse) {
      for (const z of [z0,z1]) parts.push(beam(shape(i,z),shape(i+1,z),.08,.11,light));
      parts.push(pipe(shape(i,z0),shape(i,z1),.025,light));
    }
  }
  if (weather) for (const i of [2,7]) {
    const a = shape(i,z0-end*.22), b = shape(i,z1+end*.52);
    weather.add(createIcicles(a,b,{ seed: 840+i*14+Number(top), spacing: .74, length: .19 }));
  }
  for (const s of [-1,1]) {
    const x=s*(width+.009), lo=Math.min(z0,z1), hi=Math.max(z0,z1);
    const step = coarse ? length : .49;
    for(let i=0;i<Math.ceil(length/step);i++) {
      const a=lo+i*step,b=Math.min(a+step,hi),z=(a+b)/2;
      const slope=-Math.atan2(cableRise(b)-cableRise(a),b-a);
      parts.push(box(.075,.28,b-a+.012,iron,[x,.29+cableRise(z),z],[slope,0,0]));
      parts.push(box(.067,stevensHogsback ? .12 : .078,b-a+.012,stevensHogsback ? '#a93c27' : paint,[x,.13+cableRise(z),z],[slope,0,0]));
      if (!coarse) parts.push(box(.081,.26,.026,zinc,[x,.29+cableRise(a),a]));
    }
  }
}

function footing(frame, ground, parts, colliders, x,z,radius, color, railY=-.25) {
  const p = frame.world(x,z);
  const floor=ground.heightAt(p.x,p.z)-frame.y;
  const top = Math.max(floor+.3,railY), height = top-floor;
  parts.push(cylinder(radius,height,color,[x,floor+height/2,z],undefined,radius*.89));
  parts.push(cylinder(radius+.17,.39,'#868677',[x,floor+.07,z],undefined,radius+.17));
  colliders.push({ ...p,r:radius+.10,radius:radius+.10,type:'station',maxY:frame.y+top });
}

function deck(group, frame, ground, centerX, centerZ, width, length, carpet = false) {
  const xCount=Math.max(3,Math.ceil(width/.65)), zCount=Math.max(3,Math.ceil(length/.52));
  const positions=[], indices=[], colors=[];
  const color=new THREE.Color();
  for (let j=0;j<=zCount;j++) for (let i=0;i<=xCount;i++) {
    const x=centerX+width*(i/xCount-.5), z=centerZ+length*(j/zCount-.5);
    const p=frame.world(x,z), height=ground.heightAt(p.x,p.z)-frame.y;
    const edge = i === 0 || i === xCount;
    positions.push(x,height + (carpet ? .105 : .045),z);
    color.set(carpet ? edge ? 0xb49e4e : 0x333d43 : edge ? 0xd8e3e5 : 0xe9eeee);
    color.multiplyScalar(.965+.035*Math.sin(j*2.7+i*.57));
    colors.push(color.r,color.g,color.b);
    if(i&&j) {
      const d=j*(xCount+1)+i,c=d-1,b=d-xCount-1,a=b-1;
      indices.push(a,c,b,b,c,d);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,polygonOffset:true,polygonOffsetFactor:-2}));
  mesh.name=carpet?'Conveyor belt and edge guards':'Graded loading and unloading snow deck';
  mesh.receiveShadow=true;group.add(mesh);
}

function guardRails(parts, frame, ground, x, start, end, paint) {
  let last;
  const count=Math.max(1,Math.ceil(Math.abs(end-start)/2.15));
  for (let i=0;i<=count;i++) {
    const z=start+(end-start)*i/count, p=frame.world(x,z), y=ground.heightAt(p.x,p.z)-frame.y;
    parts.push(cylinder(.039,1.04,paint,[x,y+.50,z],undefined,.032,7));
    if(last) {
      parts.push(beam([x,last.y+.91,last.z],[x,y+.91,z],.035,.04,paint));
      parts.push(beam([x,last.y+.45,last.z],[x,y+.45,z],.025,.03,paint));
    }
    last={y,z};
  }
}

function shelterRoof(root, parts, { x, z, y, width, depth, rise, color, seed, pack }) {
  const half = width / 2, near = z - depth / 2, far = z + depth / 2;
  const span = Math.hypot(half, rise), pitch = Math.atan2(rise, half);
  for (const side of [-1, 1]) {
    const edge = x + side * half, ridge = y + rise;
    parts.push(box(span + .06, .135, depth, color, [(edge+x)/2, y+rise/2-.06, z], [0, 0, -side*pitch]));
    if (rise > .04) {
      for (const end of [near + .16, far - .16]) {
        const face = new THREE.BufferGeometry();
        const vertices = [[x, y, end], [edge - side*.14, y, end], [x, ridge - .045, end]];
        face.setAttribute('position', new THREE.Float32BufferAttribute([...vertices.flat(), ...vertices.reverse().flat()], 3));
        face.computeVertexNormals();
        parts.push(part(face, color));
        parts.push(beam([edge,y,end], [x,ridge,end], .09, .12, color));
      }
    }
    const ae = [edge, y, near], be = [edge, y, far];
    root.add(createRoofSnow([[x,ridge+.01,near], [x,ridge+.01,far], be, ae],
      { seed: seed + side * 17, depth: pack * (side === 1 ? 1 : .73), spacing: .29, overhang: .105 }));
    root.add(createIcicles([edge + side*.013, y-.03, near], [edge + side*.013, y-.03, far],
      { seed: seed + side * 57, spacing: .36, length: pack * 1.52 }));
  }
}

function operatorShelter(root, parts, frame, ground, colliders, x,z,lift) {
  const p=frame.world(x,z), floor=ground.heightAt(p.x,p.z)-frame.y, bottom=floor-.58;
  const alpine = /vallees|arlberg|cervinia|disere|mont-blanc/.test(lift.resortId);
  const wood = alpine ? '#755940' : lift.vintage ? '#6b5b4b' : '#647477';
  const trim = alpine ? '#463b32' : '#4a555a';
  const rise = alpine ? .68 : lift.vintage ? .32 : .075;
  parts.push(box(2.46,.73,2.82,'#727877',[x,floor-.24,z]));
  parts.push(box(2.44,1.08,2.81,wood,[x,floor+.59,z]));
  parts.push(box(2.58,.16,2.94,trim,[x,floor+1.14,z]));
  parts.push(box(2.42,1.01,2.81,iron,[x,floor+1.69,z]));
  parts.push(box(2.52,.18,2.91,trim,[x,floor+2.24,z]));
  shelterRoof(root, parts, { x, z, y: floor+2.37, width: 2.92, depth: 3.20, rise,
    color: alpine ? '#434448' : lift.paint, seed: Math.round(Math.abs(p.x * 37 + p.z * 13)) + 29, pack: .19 });
  const panes = [];
  for (const s of [-1,1]) {
    panes.push(box(2.19,.71,.026,'#fff',[x,floor+1.74,z+s*1.412]),
      box(.027,.71,2.51,'#fff',[x+s*1.22,floor+1.74,z]));
    for(const dx of [-.37,.37]) parts.push(box(.04,.76,.039,light,[x+dx,floor+1.73,z+s*1.429]));
    for (const dz of [-.88, .17, .88]) parts.push(box(.06,.77,.045,trim,[x+s*1.24,floor+1.74,z+dz]));
    for (const h of [.33,.55,.77,.99]) parts.push(box(2.44,.018,.025,trim,[x,floor+h,z+s*1.407]));
  }
  const windows = new THREE.Mesh(liftParts(panes),windowGlass);
  windows.name = 'Operator shelter windows';
  root.add(windows);
  parts.push(box(.08,1.99,.83,wood,[x+1.267,floor+1.01,z+.64]));
  parts.push(box(.08,.65,.63,'#475c63',[x+1.275,floor+1.60,z+.64]));
  parts.push(box(.08,.045,.15,light,[x+1.32,floor+1.04,z+.93]));
  colliders.push({ ...p,hw:1.22,hd:1.40,rot:-frame.heading,type:'station',minY:frame.y+bottom,maxY:frame.y+floor+2.60+rise });
}

function stevensCabin(root, parts, frame, ground, colliders, x, z, platform) {
  const point = frame.world(x, z), floor = ground.heightAt(point.x, point.z) - frame.y;
  const deck = floor + platform;
  const siding = '#8b8175', trim = '#976847', glass = '#435156';
  const width = 2.9, depth = 2.65, roof = deck + 2.55;
  parts.push(box(width - .14, platform + .35, depth - .15, siding, [x, floor + platform * .5, z]));
  parts.push(box(width + .02, .22, depth + .02, trim, [x, deck + .02, z]));
  parts.push(box(width, 2.18, depth, siding, [x, deck + 1.16, z]));
  parts.push(box(width + .28, .16, depth + .30, trim, [x, roof - .15, z]));
  shelterRoof(root, parts, { x, z, y: roof-.058, width: width+.39, depth: depth+.39,
    rise: .045, color: trim, seed: Math.round(Math.abs(point.x * 29 + point.z * 11)) + 17, pack: .29 });
  for (const side of [-1, 1]) {
    const glassZ = z + side * (depth * .5 + .018);
    parts.push(box(width - .48, 1.18, .04, glass, [x, deck + 1.50, glassZ]));
    for (const mullion of [-1.22, 0, 1.22]) {
      parts.push(box(.07, 1.27, .077, trim, [x + mullion, deck + 1.50, glassZ]));
    }
    parts.push(box(.04, 1.15, depth - .36, glass, [x + side * (width * .5 + .017), deck + 1.52, z]));
  }
  parts.push(box(.08, 2.02, .83, trim, [x - width * .5, deck + 1.02, z + .56]));
  parts.push(box(.094, .86, .62, glass, [x - width * .5 - .014, deck + 1.45, z + .56]));

  const stairX = x - width * .5 - .78, a = z + .96, b = a + platform * 1.8;
  const count = Math.ceil(platform / .18);
  for (let step = 0; step < count; step++) {
    const f = step / count;
    parts.push(box(1.05, .052, (b - a) / count + .018, zinc,
      [stairX, deck - platform * f, THREE.MathUtils.lerp(a, b, f)]));
  }
  parts.push(box(1.07, .071, .83, zinc, [stairX, deck, a - .37]));
  for (const side of [-.54, .54]) {
    const sx = stairX + side;
    parts.push(pipe([sx, deck + .92, a], [sx, floor + .92, b], .026, zinc));
    parts.push(pipe([sx, deck - .17, a], [sx, floor, b], .048, iron));
    for (const f of [0, .5, 1]) {
      const sy = deck - platform * f, sz = THREE.MathUtils.lerp(a, b, f);
      parts.push(pipe([sx, sy, sz], [sx, sy + .93, sz], .023, zinc));
    }
  }
  parts.push(pipe([x + .98, roof, z - .76], [x + .98, roof + 1.49, z - .76], .027, iron));
  colliders.push({ ...point, hw: width / 2, hd: depth / 2, rot: -frame.heading,
    type: 'station', minY: frame.y + floor - .1, maxY: frame.y + roof });
}

function tyeMillSummitHardware(root, parts, frame, ground, colliders, gauge) {
  const foot = frame.world(0, 1.76), floor = ground.heightAt(foot.x, foot.z) - frame.y;
  parts.push(pipe([0, floor, 1.76], [0, -.33, .41], .27, '#242d2e'));
  parts.push(pipe([0, floor, -.93], [0, -.35, .34], .13, '#242d2e'));
  parts.push(box(.92, .37, .93, '#626761', [0, floor + .03, 1.77]));
  for (const x of [-gauge, gauge]) {
    parts.push(pipe([0, -.42, .36], [x, -.39, -.38], .075, '#252c2d'));
  }
  parts.push(pipe([0, .05, .17], [0, 1.87, .17], .046, '#2a3031'));
  parts.push(pipe([-1.18, 1.81, .17], [1.18, 1.81, .17], .04, '#2a3031'));
  for (const x of [-1.18, 1.18]) parts.push(pipe([0, 1.06, .17], [x, 1.81, .17], .03, '#2a3031'));
  for (const x of [-1.20, -.42, .42, 1.20]) {
    parts.push(box(.36, .30, .21, iron, [x, 2.01, .17], [.30, 0, 0]));
    parts.push(box(.27, .21, .03, '#d2d7c8', [x, 1.99, .052], [.30, 0, 0]));
  }
  stevensCabin(root, parts, frame, ground, colliders, -gauge - 3.7, 1.12, 1.08);
}

export function buildLiftTerminal(group, lift, top, ground, colliders, sharedMidstation = false) {
  const frame = top ? lift.profile.top : lift.profile.bottom;
  const { gauge,paint,detachable,seats,vintage }=lift;
  const detail = new THREE.LOD();
  detail.name=`${lift.def.name} · ${top?'unload':'loading'}`;
  detail.position.set(frame.x,frame.y,frame.z);detail.rotation.y=frame.heading;group.add(detail);
  const root = new THREE.Group();
  detail.addLevel(root);
  const end = top ? 1 : -1;
  const tyeSummit = lift.stationStyle === 'tye-mill' && top;
  const architecturalShelter = top ? lift.def.topArchitecture : lift.def.bottomArchitecture;
  const parts=[];
  const halfWidth=seats*.26+.14;
  if (!tyeSummit) deck(root,frame,ground,gauge,(top?-1.8:-4.2),halfWidth*2+.63,top?4.5:10.0);
  const rail = new THREE.Vector3();
  const cableRise = z => lift.profile.at((top?1:0)+z/lift.profile.horizontal,rail,null,0).y-frame.y;
  const coarseParts = [];
  function keep(from = 0) {
    for (let i = from; i < parts.length; i++) {
      coarseParts.push({ ...parts[i], geo: parts[i].geo.clone() });
    }
  }
  if (!sharedMidstation) {
    footing(frame,ground,parts,colliders,0,0,detachable?.59:.44,tyeSummit ? paint : iron,-.24);
    parts.push(box(gauge*1.55,.17,2.75,iron,[0,-.22,-end*.35]));
    parts.push(cylinder(.31,.34,iron,[0,-.104,0],undefined,.31,16));
    keep();
    coarseParts.push(part(new THREE.TorusGeometry(gauge - .013, .08, 4, 18), light, [0,-.033,0], [Math.PI/2,0,0]));
    const wheel=[part(new THREE.TorusGeometry(gauge-.013,tyeSummit ? .094 : .062,8,48),tyeSummit ? paint : light,[0,-.033,0],[Math.PI/2,0,0]),
      part(new THREE.TorusGeometry(gauge-.09,.037,7,42),dark,[0,-.106,0],[Math.PI/2,0,0])];
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4;
      wheel.push(box(.118, .12, gauge - .08, tyeSummit || i === 0 ? paint : light,
        [Math.sin(a) * (gauge - .08) * .5, -.106, Math.cos(a) * (gauge - .08) * .5], [0, a, 0]));
    }
    lift.wheels.push(assembly(root,wheel,'Rotating bullwheel'));
    if (detachable) {
      if (!architecturalShelter) {
        hood(parts,gauge,top?7.3:9.3,top,paint,cableRise,lift.stationStyle === 'hogsback-express',false,root);
        hood(coarseParts,gauge,top?7.3:9.3,top,paint,cableRise,lift.stationStyle === 'hogsback-express',true);
      }
      const inner = -end*4.25;
      const supportStart = parts.length;
      footing(frame,ground,parts,colliders,0,inner,.52,iron,cableRise(inner)-.24);
      keep(supportStart);
      parts.push(beam([0,cableRise(inner*1.7)-.26,inner*1.7],[0,-.26,0],.98,.22,iron));
      for(const z of [end*.61,inner]) {
        const y=cableRise(z);
        parts.push(box(.22,1.37,.27,iron,[0,y+.52,z]));
        for(const side of [-1,1])parts.push(beam([0,y+.20,z],[side*(gauge+.51),y+.88,z],.087,.09,zinc));
      }
      for(const x of [-gauge,gauge]) for(let i=0;i<8;i++) {
        const z=-end*(1.4+i*.56);
        parts.push(cylinder(.12,.106,rubber,[x,cableRise(z)-.119,z],[0,0,Math.PI/2]));
        parts.push(cylinder(.065,.139,light,[x,cableRise(z)-.119,z],[0,0,Math.PI/2]));
      }
    } else if (tyeSummit) {
      const cabinStart = parts.length;
      tyeMillSummitHardware(root, parts, frame, ground, colliders, gauge);
      keep(cabinStart);
      sheaves(parts,gauge,-1.28,0,4,true);
    } else {
      const motorStart = parts.length;
      parts.push(box(1.25,.31,1.37,paint,[0,.159,0]));
      parts.push(box(.7,.39,.57,zinc,[0,.394,-end*.16]));
      keep(motorStart);
      for(let i=0;i<7;i++) parts.push(box(.09,.030,.44,iron,[(i-3)*.10,.597,-end*.16]));
      sheaves(parts,gauge,-end*1.22,0,4,vintage);
    }
    if (!tyeSummit && !architecturalShelter) {
      const cabinStart = parts.length;
      operatorShelter(root,parts,frame,ground,colliders,-gauge-3.0,end*1.2,lift);
      keep(cabinStart);
    }
  } else {
    footing(frame,ground,parts,colliders,0,0,.42,iron,-.38);
    parts.push(box(gauge*2+.33,.21,.26,paint,[0,-.44,0]));
    keep();
    sheaves(parts,gauge,0,0,6,true);
  }
  if(!top) {
    for (const x of [gauge-halfWidth-.30,gauge+halfWidth+.31]) guardRails(parts,frame,ground,x,-12,-2.9,paint);
    for (let i=0;i<seats-1;i++) guardRails(parts,frame,ground,gauge+(i-(seats-2)*.5)*.52,-10.4,-5.6,zinc);
    for (const x of [gauge-halfWidth-.29,gauge+halfWidth+.30]) {
      const q=frame.world(x,-2.30), y=ground.heightAt(q.x,q.z)-frame.y;
      parts.push(cylinder(.069,.92,paint,[x,y+.46,-2.30]));
      parts.push(box(.15,.124,.185,'#a94d38',[x,y+1,-2.30]));
      addPassGate(root,x,y-.24,-2.30,x<gauge?.66:-.66,-1);
    }
  }
  // The Ace valley architecture already includes its bilingual queue sign.
  if (architecturalShelter !== 'ace-gondola') {
    const signX = top ? -gauge-1.15 : gauge+halfWidth+.83, signZ = top ? -3.65 : -9.0;
    const signPoint=frame.world(signX,signZ), signY=ground.heightAt(signPoint.x,signPoint.z)-frame.y;
    parts.push(box(.07,2.05,.08,iron,[signX-1.14,signY+.98,signZ]));
    parts.push(box(.07,2.05,.08,iron,[signX+1.14,signY+.98,signZ]));
    parts.push(box(2.66,.618,.08,iron,[signX,signY+1.97,signZ]));
    sign(root,lift.def.name,top?'UNLOAD':'LIFT ACCESS',signX,signY+1.97,signZ,2.65,.042);
  }
  assembly(root,parts,'Terminal bullwheel, equipment guards and lift queue');
  detail.addLevel(assembly(detail,coarseParts,'Distant terminal silhouette'),Infinity,.10);
  detail.levels[1].object.visible = false;
  return detail;
}

export function buildAerialLanes(parent,lift,ground,colliders,sharedMidstation,distantDetail = false) {
  const { profile,gauge,detachable }=lift;
  const group = new THREE.Group();
  group.name = 'Aerial lift line';
  parent.add(group);
  const samples=profile.samples;
  for(const side of [-1,1]) {
    const points=samples.map(s=>s.point.clone().addScaledVector(s.offset,gauge*side));
    // Keep the mesh within half a cable radius of the carrier's full path.
    const rope=ropeTube(simplifyRope(points),.029);
    rope.name=side === 1?'Uphill haul rope':'Return haul rope';group.add(rope);
  }
  for(const [top,frame] of [[false,profile.bottom],[true,profile.top]]) {
    if(top&&sharedMidstation) continue;
    const points=[];
    for(let i=0;i<=24;i++) {
      const a=i*Math.PI/24, p=frame.world(gauge*Math.cos(a),gauge*Math.sin(a)*(top?1:-1));
      points.push(new THREE.Vector3(p.x,frame.y,p.z));
    }
    const rope=ropeTube(points,.029);rope.name='Terminal return wrap';group.add(rope);
  }
  const towers=[profile.bottom,...profile.towers,profile.top];
  profile.towers.forEach((frame,i)=>support(group,lift,frame,towers[i],towers[i+2],i,ground,colliders,distantDetail));
  if (detachable || !lift.vintage) {
    const droop=[];
    for(let i=0;i<towers.length-1;i++) {
      const a=towers[i],b=towers[i+1];
      for(let j=0;j<5;j++) {
        const f=j/5;
        droop.push(new THREE.Vector3(THREE.MathUtils.lerp(a.x,b.x,f),
          THREE.MathUtils.lerp(a.y,b.y,f)+.26-2.5*f*(1-f),THREE.MathUtils.lerp(a.z,b.z,f)));
      }
    }
    droop.push(new THREE.Vector3(profile.top.x,profile.top.y+.26,profile.top.z));
    const wire=ropeTube(droop,.011);wire.name='Signal line';group.add(wire);
  }
  cacheStaticTransforms(group);
}

export function buildLiftConnector(group, a, b, ground, colliders) {
  const paths = [];
  for(const lane of [-1,1]) {
    const point = new THREE.Vector3(), aTan = new THREE.Vector3(), bTan = new THREE.Vector3();
    const start=a.profile.at(1,point,aTan,a.gauge*lane).clone();
    const end=b.profile.at(1,point,bTan,-b.gauge*lane).clone();
    aTan.y=bTan.y=0;
    const span=start.distanceTo(end), bend=Math.min(3,span*.22);
    const ahead=start.clone().addScaledVector(aTan.normalize(),bend);
    const back=end.clone().addScaledVector(bTan.normalize(),bend);
    const curve = new THREE.CubicBezierCurve3(start,ahead,back,end);
    const knots=curve.getPoints(32);
    for(let i=1;i<knots.length-1;i++) {
      const p=knots[i],terminal=Math.min(i,knots.length-1-i)/knots.length;
      const needed=ground.heightAt(p.x,p.z)+THREE.MathUtils.lerp(2.64,3.35,Math.min(terminal*4,1));
      p.y=Math.max(p.y,needed);
    }
    const rope=ropeTube(knots,.029);rope.name='Shared ridge haul rope';group.add(rope);
    paths.push(new THREE.CatmullRomCurve3(knots));
  }
  const p=paths[0].getPoint(.5),q=paths[1].getPoint(.5),mid=p.clone().lerp(q,.5);
  if(paths[0].getLength()>26) {
    const y=ground.heightAt(mid.x,mid.z),height=mid.y-y;
    assembly(group,[cylinder(.36,height-.30,iron,[mid.x,y+height/2-.15,mid.z]),
      beam([p.x,p.y-.34,p.z],[q.x,q.y-.34,q.z],.19,.24,zinc)],'Shared ridge support');
    colliders.push({x:mid.x,z:mid.z,r:.46,radius:.46,type:'lift-tower',maxY:mid.y-.25});
  }
  return paths;
}

export function buildSurfaceLine(group, lift, ground, colliders) {
  const { profile,carpet,paint }=lift;
  const width=carpet?1.12:.89;
  if(carpet) {
    const pivots=profile.samples.map(s=>s.point);
    const vertices=[],colors=[],indices=[];
    const darkBelt=new THREE.Color('#333c42'), band=new THREE.Color('#ccb15d');
    for (let i=0;i<pivots.length;i++) {
      const {point,offset}=profile.samples[i];
      for (const [side,tint] of [[-1,band],[-.83,darkBelt],[.83,darkBelt],[1,band]]) {
        const p=point.clone().addScaledVector(offset,side*width/2);
        p.y=ground.heightAt(p.x,p.z)+.10;
        vertices.push(p.x,p.y,p.z);
        colors.push(tint.r,tint.g,tint.b);
      }
      if(i) for(let n=0;n<3;n++) {
        const a=(i-1)*4+n,b=i*4+n;indices.push(a,b,a+1,a+1,b,b+1);
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const belt=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93,side:THREE.DoubleSide}));
    belt.name='Moving carpet';belt.receiveShadow=true;group.add(belt);
  } else {
    for(const offset of [-.24,.24]) {
      const wire=ropeTube(profile.samples.map(s=>s.point.clone().addScaledVector(s.offset,offset)),.025);
      wire.name='Rope tow loop';group.add(wire);
    }
  }
  const p=new THREE.Vector3(),tan=new THREE.Vector3(),footings=[];
  const count=Math.max(2,Math.ceil(profile.length/(carpet?12:18)));
  for(let i=0;i<=count;i++) {
    profile.at(i/count,p,tan,0);
    const x=p.x,z=p.z,y=ground.heightAt(x,z);
    if(carpet) {
      for (const s of [-1,1]) footings.push(box(.10,.16,.11,paint,[x+s*tan.z*.59,y+.10,z-s*tan.x*.59]));
    } else {
      footings.push(box(.14,1.49,.15,paint,[x,y+.77,z]));
      footings.push(box(.68,.12,.18,iron,[x,y+1.46,z],[0,Math.atan2(tan.x,tan.z),0]));
      footings.push(cylinder(.104,.06,iron,[x,y+1.53,z]));
    }
  }
  assembly(group,footings,carpet?'Conveyor edge guards':'Low-level rope supports');
  for(const [counter,frame] of [profile.bottom,profile.top].entries()) {
    const root=new THREE.Group();root.position.set(frame.x,frame.y,frame.z);root.rotation.y=frame.heading;group.add(root);
    const floor=ground.heightAt(frame.x,frame.z)-frame.y;
    const terminal=[box(1.51,.37,1.35,paint,[0,floor+.20,counter?.52:-.57])];
    if (lift.stationStyle === 'rope-tow') {
      const z = counter ? .43 : -.65;
      for (const x of [-2.17, 2.17]) {
        const point = frame.world(x, z), base = ground.heightAt(point.x, point.z) - frame.y;
        const poleTop = floor + 4.5;
        terminal.push(cylinder(.20, poleTop - base, '#42433d', [x, (poleTop + base) / 2, z], undefined, .16, 12));
        terminal.push(cylinder(.34, .37, '#929187', [x, base + .09, z], undefined, .28, 12));
        terminal.push(pipe([x, poleTop - 1.9, z], [x * .47, poleTop - .18, z], .057, iron));
        colliders.push({ ...point, r: .30, type: 'lift-tower', minY: frame.y + base, maxY: frame.y + poleTop });
      }
      terminal.push(pipe([-2.35, floor + 4.4, z], [2.35, floor + 4.4, z], .081, zinc));
      terminal.push(pipe([0, floor + 4.35, z], [0, .09, z], .029, iron));
      terminal.push(cylinder(.35, .11, dark, [0, .035, z], undefined, .35, 16));
      if (counter) stevensCabin(root, terminal, frame, ground, colliders, 0, 3.9, 1.51);
    }
    const signX = lift.stationStyle === 'rope-tow' ? -3.25 : 0;
    const signWidth = lift.stationStyle === 'rope-tow' ? 1.64 : 2.58;
    for(const x of [signX-signWidth*.46,signX+signWidth*.46]) terminal.push(box(.076,1.41,.076,zinc,[x,floor+.66,-.4]));
    terminal.push(box(signWidth,.60,.083,iron,[signX,floor+1.67,-.40]));
    sign(root,lift.def.name,counter?'EXIT':'BEGINNER AREA',signX,floor+1.67,-.4,signWidth-.03,.043);
    assembly(root,terminal,'Surface lift drive and approach markers');
  }
}
