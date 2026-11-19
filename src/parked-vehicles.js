import * as THREE from 'three';
import { beam, box, mergedMesh, part } from './scenery.js';

const rubber = '#20262b', rimPaint = '#8d999d', trim = '#27353c';
const glazing = ['#405965', '#354d5c', '#47606b'];
const colors = ['#526e82', '#aeb9bb', '#52666a', '#d0c9b6', '#335b59', '#934a44', '#414a53'];
const sedan = { width:.88, waist:.84, roof:1.40, cabin:[-1.42,.94,-1.02,.22,.62], axles:[-1.40,1.38] };
const wagon = { width:.90, waist:.94, roof:1.57, cabin:[-2.06,.91,-1.79,.26,.70], axles:[-1.45,1.36] };
const pickup = { width:.91, waist:.99, roof:1.67, cabin:[-.89,.84,-.77,.20,.69], axles:[-1.49,1.36], bed:true };

function facets(points, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(),3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function panel(parts, tint, points, offset = 0) {
  const v = points.map(p => new THREE.Vector3(...p));
  if (offset) {
    const normal = v[1].clone().sub(v[0]).cross(v[3].clone().sub(v[0])).normalize();
    for (const p of v) p.addScaledVector(normal, offset);
  }
  parts.push(part(facets(v.map(p => p.toArray()),[0,1,2,0,2,3]),tint));
}

function bodyHeight(model, z) {
  const { waist, cabin } = model;
  const start = cabin[1];
  if (z >= start) return THREE.MathUtils.lerp(waist, waist-.15, ((z-start)/(2.26-start))**1.7);
  if (z <= cabin[0]) return waist - Math.min(.105,(cabin[0]-z)*.17);
  return waist + .013 * Math.sin((z-cabin[0])/(start-cabin[0])*Math.PI);
}

function bodyWidth(model, z) {
  return model.width * (1 - .22 * (Math.max(0,Math.abs(z)-1.71)/.55)**1.9);
}

function bodyShell(model, distant) {
  const lengths = new Set(distant ? [-2.26,-2.03,-.87,1.76,2.13,2.26]
    : [-2.26,-2.17,-2.06,-1.96,-1.79,-.88,-.73,-.20,.46,.82,1.54,1.76,1.98,2.13,2.26]);
  for (const z of model.cabin.slice(0,2)) lengths.add(z);
  const steps = distant ? 4 : 6;
  for (const axle of model.axles) {
    for (let step = 0; step <= steps; step++) lengths.add(axle - .394*Math.cos(step*Math.PI/steps));
  }
  const points = [], indices = [];
  const ring = 12;
  for (const z of [...lengths].sort((a,b)=>a-b)) {
    const width = bodyWidth(model,z), belt = bodyHeight(model,z);
    const offset = Math.min(...model.axles.map(axle => Math.abs(z-axle)));
    const fender = .33 + Math.sqrt(Math.max(0,.394**2-offset**2));
    const side = Math.min(belt-.10, fender);
    const bedY = model.bed && z > -2.06 && z < -.91 ? belt-.24 : belt;
    const base = points.length;
    for (const [x,y] of [
      [-width*.74,.306],[-width*.97,side],[-width,belt-.092],[-width*.94,belt-.033],
      [-width*.86,belt],[-width*.77,bedY],[width*.77,bedY],[width*.86,belt],
      [width*.94,belt-.033],[width,belt-.092],[width*.97,side],[width*.74,.306],
    ]) points.push([x,y,z]);
    if (base) {
      for (let i = 0; i < ring; i++) {
        const a = base-ring+i, b = base-ring+(i+1)%ring, c = base+i, d = base+(i+1)%ring;
        indices.push(a,c,b,b,c,d);
      }
    }
  }
  for (let i = 1; i < ring-1; i++) {
    const front = points.length-ring;
    indices.push(0,i,i+1,front,front+i+1,front+i);
  }
  return facets(points, indices);
}

function windowFace(parts, tint, corners, windows, distant) {
  const point = (u,v) => corners[0].map((_,axis) => THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(corners[0][axis],corners[1][axis],u),
    THREE.MathUtils.lerp(corners[3][axis],corners[2][axis],u),v));
  const patch = (left,right,bottom,top,color,inward) => panel(parts,color,[
    point(left,bottom),point(right,bottom),point(right,top),point(left,top),
  ],inward);
  if (distant) {
    patch(0,1,0,1,tint);
    patch(.055,.945,.095,.915,windows[0][2],.006);
    return;
  }
  patch(0,1,0,1,trim,-.026);
  patch(0,1,0,.085,tint);
  patch(0,1,.925,1,tint);
  let pillar = 0;
  for (const [left,right,glass] of windows) {
    patch(pillar,left,.085,.925,tint);
    patch(left,right,.085,.925,trim,-.018);
    patch(left+.012,right-.012,.109,.906,glass,-.014);
    pillar = right;
  }
  patch(pillar,1,.085,.925,tint);
}

function frost(parts, surface, phase, thickness) {
  const point = (u,v,lift) => surface[0].map((_,axis) => THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(surface[0][axis],surface[1][axis],u),
    THREE.MathUtils.lerp(surface[3][axis],surface[2][axis],u),v) + (axis===1 ? lift : 0));
  const outline = [[.08,.06],[.57,.035],[.92,.08],[.97,.24],[.94,.79],[.88,.93],
    [.49,.96],[.10,.92],[.035,.68],[.06,.25]];
  const edge = outline.map(([u,v],i) => point(u+Math.sin(i*19.1+phase)*.018,v,.004));
  const top = outline.map(([u,v],i) => point(.5+(u-.5)*.93,.5+(v-.5)*.93,thickness*(.69+.17*Math.sin(i*2.3+phase))));
  const peak = point(.47,.53,thickness);
  const center = outline.length;
  const indices = [];
  const walls = [];
  for (let i = 0; i < outline.length; i++) {
    const j = (i+1)%outline.length;
    indices.push(i,j,center);
    walls.push(i,j,j+center,i,j+center,i+center);
  }
  parts.push(part(facets([...top,peak],indices),'#e5edf1'),part(facets([...edge,...top],walls),'#c8d7de'));
}

function cabin(parts, model, tint, glass, frostPhase, distant) {
  const [back,front,backTop,frontTop,roofWidth] = model.cabin;
  const backY = bodyHeight(model,back)-.018, frontY = bodyHeight(model,front)-.018;
  const b = Math.min(bodyWidth(model,back),bodyWidth(model,front))*.90;
  // Keep each side coplanar so the inset panes and their backing cannot intersect.
  const taper = (roofWidth-b)/(model.roof-backY);
  const f = b+(frontY-backY)*taper, frontRoof = roofWidth-.027*taper;
  const bl=[-b,backY,back], br=[b,backY,back], fl=[-f,frontY,front], fr=[f,frontY,front];
  const tl=[-roofWidth,model.roof,backTop], tr=[roofWidth,model.roof,backTop];
  const ul=[-frontRoof,model.roof-.027,frontTop], ur=[frontRoof,model.roof-.027,frontTop];
  const sides = model === wagon ? [[.055,.32,glass],[.354,.62,glass],[.665,.93,glass]]
    : [[.07,.46,glass],[.522,.938,glass]];
  windowFace(parts,tint,[bl,fl,ul,tl],sides,distant);
  windowFace(parts,tint,[fr,br,tr,ur],sides.map(([a,b,color])=>[1-b,1-a,color]).reverse(),distant);
  windowFace(parts,tint,[fl,fr,ur,ul],[[.053,.947,'#4b6473']],distant);
  windowFace(parts,tint,[br,bl,tl,tr],[[.057,.943,glass]],distant);
  const roof = [tl,ul,ur,tr];
  panel(parts,tint,roof);
  if (frostPhase > .12) frost(parts,roof,frostPhase*50,.035 + frostPhase*.023);
  const hood = [
    [-f*.78,frontY+.02,front+.06],[-f*.75,bodyHeight(model,1.98)+.012,1.98],
    [f*.75,bodyHeight(model,1.98)+.012,1.98],[f*.78,frontY+.02,front+.06],
  ];
  if (frostPhase > .44) frost(parts,hood,frostPhase*81,.033);
}

function wheels(parts, model, distant) {
  const segments = distant ? 9 : 14;
  const tire = (distant ? new THREE.CylinderGeometry(.34,.34,.21,segments) : new THREE.LatheGeometry([
    [.208,-.108],[.286,-.108],[.328,-.089],[.342,-.060],[.342,.060],[.327,.088],[.286,.108],[.208,.108],
  ].map(([r,x])=>new THREE.Vector2(r,x)),segments)).rotateZ(Math.PI/2);
  const rim = new THREE.CircleGeometry(.218,segments).rotateY(Math.PI/2);
  const cap = distant ? null : new THREE.CircleGeometry(.065,8).rotateY(Math.PI/2);
  for (const side of [-1,1]) for (const axle of model.axles) {
    const y=.334, tread = side*(model.width-.113), rotate=[0,side < 0 ? Math.PI : 0,0];
    parts.push(part(tire,rubber,[tread,y,axle]),part(rim,distant ? rimPaint : '#424d54',[side*model.width,y,axle],rotate));
    if (distant) continue;
    parts.push(part(cap,rimPaint,[side*(model.width+.006),y,axle],rotate));
    for (let i = 0; i < 5; i++) {
      const angle = i*2*Math.PI/5 + axle, x = side*(model.width+.004);
      const at = (r,a) => [x,y+Math.sin(a)*r,axle+Math.cos(a)*r];
      let points = [at(.061,angle-.23),at(.191,angle-.14),at(.206,angle+.10),at(.065,angle+.29)];
      if (side > 0) points = points.reverse();
      panel(parts,rimPaint,points);
    }
    for (let i = 0; i < 14; i++) {
      const angle = (i+.55)*Math.PI/7;
      const at = (x,r,a) => [tread+side*x,y+Math.sin(a)*r,axle+Math.cos(a)*r];
      const block = [at(.025,.344,angle-.045),at(.065,.343,angle+.015),
        at(.065,.343,angle+.071),at(.025,.344,angle+.016)];
      panel(parts,'#30383d',side > 0 ? block : block.reverse());
    }
  }
}

function fittings(parts, model, tint, distant) {
  const nose = bodyHeight(model,2.26), tail = bodyHeight(model,-2.26);
  parts.push(
    box(1.32,.095,.052,trim,[0,nose-.30,2.235]),box(1.34,.104,.048,trim,[0,tail-.32,-2.232]),
    box(model.bed ? .93 : .78,.128,.014,'#283941',[0,nose-.145,2.268]),
    box(.28,.073,.013,'#aab9bb',[0,tail-.19,-2.268]),
  );
  if (!distant) for (const y of [nose-.163,nose-.119]) parts.push(box(.64,.012,.009,'#6c8088',[0,y,2.279]));
  for (const side of [-1,1]) {
    const front = (x,y) => [side*x,nose+y,2.269];
    const back = (x,y) => [side*x,tail+y,-2.269];
    const lamp = (tint, points) => panel(parts,tint,side===1?points:[...points].reverse());
    lamp('#cfdfdf',[front(.43,-.151),front(.648,-.17),front(.631,-.087),front(.46,-.075)]);
    lamp('#a33932',[back(.416,-.181),back(.433,-.081),back(.625,-.075),back(.649,-.158)]);
    if (distant) continue;
    lamp('#eef4f3',[front(.455,-.117),front(.632,-.139),front(.627,-.127),front(.459,-.105)].map(([x,y,z]) => [x,y,z+.003]));
    lamp('#d67859',[back(.437,-.139),back(.446,-.114),back(.624,-.105),back(.638,-.129)].map(([x,y,z]) => [x,y,z-.003]));
    const door = model.width*.987*side;
    for (const z of model.bed ? [-.25] : [-.69,.39]) {
      parts.push(box(.014,.025,.10,'#6c7a80',[door,model.waist-.082,z]),
        box(.010,.245,.011,trim,[door*.998,model.waist-.24,z-.065]));
    }
    const mirror = [side*Math.min(Math.abs(door),.87),model.waist+.071,.64];
    parts.push(box(.10,.065,.125,tint,mirror),
      box(.071,.045,.008,'#81969f',[mirror[0],mirror[1],mirror[2]-.065]));
    if (model.bed) parts.push(beam([door,model.waist-.015,-1.03],[door,model.waist-.015,-2.02],.035,.030,trim));
  }
}

function addParkedVehicle(parts, ground, { x, y, z, yaw, colorRoll, shapeRoll }, distant) {
  const model = shapeRoll < .36 ? sedan : shapeRoll < .77 ? wagon : pickup;
  const colorIndex = Math.floor(colorRoll*colors.length);
  const paint = colors[colorIndex], glass = glazing[colorIndex%glazing.length];
  const pieces = [part(bodyShell(model,distant),paint)];
  const snow = (shapeRoll*13.87 + colorIndex*.171)%1;
  cabin(pieces,model,paint,glass,snow,distant);
  wheels(pieces,model,distant);
  fittings(pieces,model,paint,distant);
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const up = new THREE.Vector3(0,1,0);
  const normal = ground.normalAt(x,z,new THREE.Vector3());
  const rotation = new THREE.Quaternion().setFromUnitVectors(up,normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(up,yaw));
  const tireHeight = model.axles.flatMap(axle => [-.76,.76].map(w =>
    ground.heightAt(x+w*cos+axle*sin,z-w*sin+axle*cos)));
  const base = Math.max(y-.20,Math.min(y+.20,tireHeight.reduce((sum,height)=>sum+height,0)/tireHeight.length));
  const local = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const offset = new THREE.Vector3();
  for (const piece of pieces) {
    offset.fromArray(piece.pos).applyQuaternion(rotation);
    piece.pos = [x+offset.x,base+offset.y,z+offset.z];
    local.setFromEuler(euler.fromArray(piece.rot)).premultiply(rotation);
    piece.rot = euler.setFromQuaternion(local).toArray();
  }
  parts.push(...pieces);
}

function vehicleMesh(ground, vehicles, name, distant) {
  const parts=[];
  for (const vehicle of vehicles) addParkedVehicle(parts,ground,vehicle,distant);
  const mesh = mergedMesh(parts,{ roughness:.55,metalness:.10 });
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  for (const geometry of new Set(parts.map(piece => piece.geo))) geometry.dispose();
  return mesh;
}

export function buildParkedVehicles(group, ground, vehicles, name) {
  const nearby = vehicleMesh(ground,vehicles,name,false);
  const distant = vehicleMesh(ground,vehicles,name,true);
  const { center, radius } = nearby.geometry.boundingSphere;
  const lot = new THREE.LOD();
  lot.position.copy(center);
  for (const mesh of [nearby,distant]) {
    mesh.position.copy(center).negate();
    mesh.updateMatrix();
  }
  lot.addLevel(nearby);
  // Measure from the whole lot and use hysteresis when the skier crosses the detail boundary.
  lot.addLevel(distant,radius+32,.08);
  distant.visible = false;
  group.add(lot);
}
