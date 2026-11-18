import * as THREE from 'three';
import { LIFTS, PEAK_TO_PEAK } from './worlddata.js';
import { heightAt } from './terrain.js';
import { box, beam, part, mergedMesh, mergeParts } from './scenery.js';
import { makeCanvas, canvasTexture } from './util.js';
import { surfaceMaterial } from './materials.js';
import { createRoofSnow, createIcicles } from './roof-weather.js';
import { ropeOffset, stationPoint, stationSite } from './station-sites.js';

const white = '#d8dedc', steel = '#9ba9ad';
const queueSlots = [];
// The old Creekside terminal has an OSM building footprint. Its roof and
// loading hall are reconstructed below; the generic village extruder must
// not put a three-storey block through the moving cabins and arched hood.
export const REPLACED_STATION_BUILDING_IDS = new Set([
  '151613603', '1415325549', '1174567116',
  // Excalibur lower, mapped as an aerialway station on layer 1.
  '50677443',
  // Previous Blackcomb base roof and the Magic Chair's upper return housing.
  // Both overlap their present-day station drive and ride lanes.
  '50677440', '173080605',
]);
// Kadenwood lower terminal: OSM aerialway way 682523542 starts at node
// 6391839691 (-122.9888472,50.0933912), inside building way 1174567116.
// Its 179 m² footprint is the station, so a generic building cannot also occupy
// the same cabin loading envelope. The authored terminal replaces that mass.

export function makePeak2PeakBadge(width = 8, height = 1.55) {
  const { canvas, ctx } = makeCanvas(1536, 320);
  // The installed sign is a narrow pointed badge: red PEAK, black 2 PEAK,
  // a white keyline and an aluminium outer edge, with slanted condensed type.
  const shape = (inset) => {
    ctx.beginPath(); ctx.moveTo(8 + inset, 160);
    ctx.lineTo(99 + inset * .55, 21 + inset); ctx.lineTo(1437 - inset * .55, 21 + inset);
    ctx.lineTo(1528 - inset, 160); ctx.lineTo(1437 - inset * .55, 299 - inset);
    ctx.lineTo(99 + inset * .55, 299 - inset); ctx.closePath();
  };
  ctx.fillStyle = '#b8c4c9'; shape(0); ctx.fill();
  ctx.fillStyle = '#eff0ec'; shape(7); ctx.fill();
  shape(17); ctx.save(); ctx.clip();
  ctx.fillStyle = '#aa1631'; ctx.fillRect(0, 0, 720, 320);
  ctx.fillStyle = '#121b22'; ctx.fillRect(720, 0, 820, 320);
  ctx.restore();
  ctx.fillStyle = '#f5f5ee'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.font = 'italic 900 214px "Barlow Condensed", "Arial Narrow", Arial';
  ctx.fillText('PEAK', 404, 170, 557);
  ctx.fillText('2', 793, 170, 145);
  ctx.fillText('PEAK', 1140, 170, 505);
  const result = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({
    map: canvasTexture(canvas), transparent: true, alphaTest: .35, roughness: .52,
  }));
  result.name = 'PEAK 2 PEAK · pointed red and black station badge';
  return result;
}

function stationFrame(def, index = 0) {
  const site = stationSite(def, index);
  return { ...site, y: heightAt(site.x, site.z) };
}
const world = stationPoint;
function localFloor(frame, x, z) { const p = world(frame, x, z); return heightAt(p.x, p.z) - frame.y; }
function addParts(parent, parts, options = {}) { if (parts.length) parent.add(mergedMesh(parts, options)); }
function addWeatherBatch(parent, meshes) {
  const batches=new Map();
  for(const mesh of meshes){
    if(!batches.has(mesh.material))batches.set(mesh.material,[]);
    batches.get(mesh.material).push(mesh);
  }
  for(const [material,items] of batches){
    const attributes=Object.keys(items[0].geometry.attributes),geometry=new THREE.BufferGeometry();
    const total=items.reduce((n,m)=>n+m.geometry.attributes.position.count,0);
    for(const key of attributes){
      const size=items[0].geometry.attributes[key].itemSize,values=new Float32Array(total*size);let offset=0;
      for(const item of items){values.set(item.geometry.attributes[key].array,offset);offset+=item.geometry.attributes[key].array.length;}
      geometry.setAttribute(key,new THREE.BufferAttribute(values,size));
    }
    const indices=[];let base=0;
    for(const item of items){for(const i of item.geometry.index.array)indices.push(i+base);base+=item.geometry.attributes.position.count;item.geometry.dispose();}
    geometry.setIndex(indices);geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=items[0].name+' · merged terminal weather';
    mesh.receiveShadow=true;mesh.castShadow=!!items[0].castShadow;mesh.customDepthMaterial=items[0].customDepthMaterial;
    parent.add(mesh);
  }
}
function board(parent, text, sub, x, y, z, width, yaw = Math.PI, bg = '#d9e1e0', fg = '#1c313a') {
  const {canvas,ctx}=makeCanvas(1024,192);
  ctx.fillStyle=bg;ctx.fillRect(0,0,1024,192);ctx.strokeStyle='#a4b4b8';ctx.lineWidth=6;ctx.strokeRect(8,8,1008,176);
  ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='700 100px "Barlow Condensed", Arial';
  const titleSize=Math.min(100,100*940/Math.max(1,ctx.measureText(text).width));
  ctx.font=`700 ${titleSize}px "Barlow Condensed", Arial`;ctx.fillText(text,512,sub?125:101);
  if(sub){ctx.font='600 31px "Barlow Condensed", Arial';
    const size=Math.min(31,31*940/Math.max(1,ctx.measureText(sub).width));ctx.font=`600 ${size}px "Barlow Condensed", Arial`;
    ctx.fillText(sub,512,43);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 5.3), new THREE.MeshStandardMaterial({
    map: canvasTexture(canvas), roughness: .68,
  }));
  m.position.set(x, y, z); m.rotation.y = yaw; parent.add(m); return m;
}
function groupAt(scene, name, frame) {
  const group = new THREE.Group(); group.name = name; group.position.set(frame.x, frame.y, frame.z);
  group.rotation.y = frame.yaw; scene.add(group); return group;
}
let cedarMaterial;
function cedar() {
  if(cedarMaterial)return cedarMaterial;
  const {canvas,ctx}=makeCanvas(512,1024);
  ctx.fillStyle='#76543d';ctx.fillRect(0,0,512,1024);
  for(let x=0;x<512;x++){
    const q=Math.sin(x*.31)*.5+Math.sin(x*.93)*.19;
    ctx.strokeStyle=`rgba(${q>0?'189,145,94':'40,27,21'},${Math.abs(q)*.27})`;
    ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,0);
    for(let y=0;y<=1024;y+=16)ctx.lineTo(x+Math.sin(y*.018+x*.07)*1.4,y);
    ctx.stroke();
  }
  for(const [x,y] of [[89,274],[341,713],[210,933]])for(let ring=1;ring<9;ring++){
    ctx.strokeStyle=`rgba(43,27,18,${.16-ring*.008})`;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.ellipse(x,y,ring*2.0,ring*6.3,.05,0,Math.PI*2);ctx.stroke();
  }
  const texture=canvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(3,1);
  cedarMaterial=new THREE.MeshStandardMaterial({map:texture,roughness:.92,vertexColors:true});
  return cedarMaterial;
}
function cedarMesh(parent,parts) {
  const uv=[];
  for(const p of parts){
    const g=p.geo.index?p.geo.toNonIndexed():p.geo;
    uv.push(...g.attributes.uv.array);if(g!==p.geo)g.dispose();
  }
  const geometry=mergeParts(parts);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  const mesh=new THREE.Mesh(geometry,cedar());mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);
}

function creeksideSign(parent,x,y,z,width) {
  const {canvas,ctx}=makeCanvas(1280,256);
  ctx.fillStyle='#102d2b';ctx.fillRect(0,0,1280,256);
  ctx.strokeStyle='#66827a';ctx.lineWidth=7;ctx.strokeRect(4,4,1272,248);
  ctx.fillStyle='#e9e5d3';ctx.textBaseline='middle';ctx.textAlign='left';
  ctx.font='italic 224px Georgia,serif';ctx.fillText('C',111,144);
  ctx.font='700 111px Georgia,serif';ctx.fillText('REEKSIDE',258,104,895);
  ctx.font='700 73px Georgia,serif';ctx.fillText('GONDOLA',421,198,610);
  ctx.strokeStyle='#d0b783';ctx.lineWidth=5;ctx.beginPath();
  ctx.moveTo(182,178);ctx.bezierCurveTo(242,125,319,159,358,171);ctx.stroke();
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,width/5),new THREE.MeshStandardMaterial({
    map:canvasTexture(canvas),roughness:.65,metalness:.12}));
  mesh.position.set(x,y,z);mesh.rotation.y=Math.PI;mesh.name='Creekside · installed serif gondola sign';parent.add(mesh);
}

function creeksideKioskRoof(parent,parts,hutX) {
  const roofW=7.9,front=-5.62,rear=-.78,ridge=-3.20,eave=3.01,peak=3.89;
  // Small staggered cedar shingles produce a real pitched roof silhouette,
  // including dark exposed rows below the uneven snow and frozen eave.
  const shingles=[];
  for(const side of [-1,1])for(let row=0;row<9;row++){
    const f=(row+.5)/9,z=ridge+side*(Math.abs((side<0?front:rear)-ridge))*f;
    const y=peak-(peak-eave)*f,slope=Math.atan2(peak-eave,Math.abs(front-ridge));
    for(let col=0;col<26;col++){
      const x=hutX-roofW/2+(col+.5)*roofW/26+(row%2?.06:0);
      const tint=['#4d4840','#5d5143','#665748','#514b43'][(row*13+col*7)%4];
      shingles.push(box(roofW/26-.012,.044,.34,tint,[x,y+.026,z],[side*slope,0,0]));
    }
    if(row===0)continue;
  }
  addParts(parent,shingles,{roughness:.96,metalness:0});
  for(const z of [front,rear])parts.push(box(8.04,.19,.17,'#3d3630',[hutX,eave-.04,z]));
  for(const side of [-1,1]){
    const edge=side<0?front:rear;
    parent.add(createRoofSnow([[hutX-roofW/2,peak+.055,ridge],[hutX+roofW/2,peak+.055,ridge],
      [hutX+roofW/2,eave+.055,edge],[hutX-roofW/2,eave+.055,edge]],
      {seed:617+side,depth:.22+(side===1?.05:0),overhang:.17,spacing:.53}));
    parent.add(createIcicles([hutX-roofW/2,eave-.035,edge],[hutX+roofW/2,eave-.035,edge],
      {seed:912+side,spacing:.36,length:.39}));
  }
  parts.push(box(roofW+.10,.12,.15,'#645543',[hutX,peak+.065,ridge]));
}
function postCollider(grid, frame, x, z, radius = .38) {
  const p = world(frame, x, z); grid.addCircle(p.x, p.z, radius, 'station');
}

function footing(parts, frame, x, z, width, length, top = .14) {
  const base = Math.min(...[-width / 2, 0, width / 2].flatMap(dx =>
    [-length / 2, 0, length / 2].map(dz => localFloor(frame, x + dx, z + dz)))) - .22;
  const bottom = Math.min(top - .2, base);
  parts.push(box(width, top - bottom, length, '#8d9390', [x, (top + bottom) / 2, z]));
}

function groundBoard(parent, parts, frame, title, subtitle, x, z, width) {
  const y = localFloor(frame, x, z);
  board(parent, title, subtitle, x, y + 1.80, z, width);
  for (const side of [-1, 1]) {
    const sx = x + side * (width / 2 - .22), sy = localFloor(frame, sx, z + .08);
    parts.push(box(.062, y + 1.96 - sy, .068, '#63747a', [sx, (sy + y + 1.96) / 2, z + .08]));
  }
}

function curvedHood(parent, parts, { halfW = 4.4, eave = 4.3, rise = 1.85, length = 18, centerZ = 1, color = '#e1e5e4', green = false }) {
  const panels = [], weather=[], steps = 20, rear = centerZ - length / 2, front = centerZ + length / 2;
  const point = (a, z) => [Math.sin(a) * halfW, eave + Math.cos(a) * rise, z];
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI / 2 + i / steps * Math.PI, b = a + Math.PI / steps;
    const p = point(a, rear), q = point(b, rear), r = point(b, front), s = point(a, front);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...p, ...q, ...r, ...p, ...r, ...s], 3));
    geo.computeVertexNormals();
    panels.push(part(geo, i < 2 || i > steps - 3 ? color : '#344b57'));
    // Rolled aluminium seams with deposits concentrated above the curved hood.
    parts.push(beam(p, s, .055, .065, '#7c969e'));
    for (const z of [rear, front]) parts.push(beam(point(a, z), point(b, z), .16, .2, green ? '#d5dddb' : white));
    if (i > 4 && i < steps - 5) {
      const z0 = rear + .05, z1 = front - .04;
      weather.push(createRoofSnow([point(a,z0),point(b,z0),point(b,z1),point(a,z1)],{
        seed:810+i,depth:.17+Math.sin(i*.71)*.055,overhang:.025,spacing:.84,
      }));
    }
    // The lower exposed glass catches little frozen beads instead of an
    // implausible solid rectangular blanket across the whole curved roof.
    if (i===1||i===steps-2) for(const z of [rear,front]) {
      const lo=point(a,z),hi=point(b,z);
      weather.push(createIcicles(lo,hi,{seed:71+i+Math.round(z*3),spacing:.27,length:.23}));
    }
  }
  addParts(parent, panels, { roughness: .34, metalness: .34 });
  for(const side of [-1,1]){
    weather.push(createRoofSnow([[side*(halfW-.16),eave+.06,rear],[side*(halfW+.16),eave+.06,rear],
      [side*(halfW+.16),eave+.06,front],[side*(halfW-.16),eave+.06,front]],
      {seed:211+side,depth:.10,overhang:.06,spacing:.55}));
    weather.push(createIcicles([side*(halfW+.10),eave-.02,rear],[side*(halfW+.10),eave-.02,front],
      {seed:512+side,spacing:.51,length:.34}));
  }
  addWeatherBatch(parent,weather);
  return { rear, front };
}

function fixedChair(parent, frame, grid, def, base) {
  const parts = [], wheelY = 2.85, radius = def.seats >= 4 ? 2.4 : 1.9;
  footing(parts, frame, 0, -1.9, 1.4, 1.5, .07);
  parts.push(box(1.05, 2.25, 1.15, '#bac1be', [0, 1.075, -1.9]));
  parts.push(box(1.55, .42, 1.8, '#8a9799', [0, 2.30, -1.9]));
  parts.push(box(2.6, .24, 5.4, steel, [0, 2.62, -.3]));
  const wheel = new THREE.TorusGeometry(radius, .11, 8, 48); wheel.rotateX(Math.PI / 2);
  parts.push(part(wheel, '#aab6b7', [0, wheelY, -1.9]));
  const inner = new THREE.TorusGeometry(radius - .23, .045, 6, 48); inner.rotateX(Math.PI / 2);
  parts.push(part(inner, '#58686d', [0, wheelY, -1.9]));
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    parts.push(beam([0,wheelY,-1.9],[Math.sin(a)*radius,wheelY,-1.9+Math.cos(a)*radius],.12,.18,steel));
  }
  parts.push(part(new THREE.CylinderGeometry(.31,.31,.45,14), '#778c93', [0,wheelY,-1.9]));
  // Ladder, tensioning gear and an operator hut distinguish open fixed grips.
  for(let i=0;i<7;i++) parts.push(box(.73,.048,.055,steel,[1.02,.36+i*.32,-2.55]));
  for(const x of [.66,1.38]) parts.push(box(.055,2.25,.055,steel,[x,1.35,-2.55]));
  parts.push(box(2.8,2.25,2.9,'#776451',[5,1.02,-2.5]));
  footing(parts, frame, 5, -2.5, 2.8, 2.9, -.08);
  parts.push(box(3.2,.24,3.3,'#e5e9e7',[5,2.3,-2.5]));
  parts.push(box(2.1,1,.06,'#526e78',[5,1.36,-4]));
  groundBoard(parent, parts, frame, def.name.toUpperCase(), base ? 'LOAD HERE' : 'UNLOAD', -3.4, -6.8, 3);
  addParts(parent, parts, { roughness:.61,metalness:.25 });
  postCollider(grid,frame,0,-1.9,.8); postCollider(grid,frame,5,-2.5,1.5);
}

export function buildMappedTerminal(scene, grid, def, index) {
  const frame = stationFrame(def,index), base = index === 0, chair = def.type === 'chair';
  const creek = def.name === 'Creekside Gondola',showcase=/Showcase/.test(def.name),redTerminal=/Jersey Cream|Showcase|Big Red|Garbanzo/.test(def.name);
  const group = groupAt(scene,`${def.name} · ${base ? 'loading terminal' : 'unload terminal'}`,frame);
  group.userData.station = { id: def.id, base, datum: frame.y };
  if(chair && (def.seats || 2) <= 3) { fixedChair(group,frame,grid,def,base); return group; }
  const parts=[], structure=[], glazing=[];
  const gondola=!chair, halfW=showcase?3.6:gondola ? (def.id === 'way-1525850290' && base ? 4.05 : 5.65) : 4.2, length=showcase?11:gondola ? 23 : 17.5;
  const eave=showcase?4.60:gondola ? 5.6 : 4.25, rise=showcase?1.35:gondola ? 2.2 : 1.7;
  const trim=creek ? '#16645e' : redTerminal ? '#b0263b' : '#cad5d8';
  curvedHood(group,parts,{halfW,eave,rise,length,centerZ:1,color:trim,green:creek});
  if(gondola||showcase||/Jersey Cream/.test(def.name)){
    const caps=[];
    for(const z of [1-length/2,1+length/2]){
      if(creek){
        // The old Creekside terminal has broad, dark tinted facets above
        // the green ribbed fascia; a light reflection shader washed them out.
        const cuts=[-halfW,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,halfW];
        const top=x=>eave+rise*Math.sqrt(Math.max(0,1-(x/halfW)**2));
        for(let i=0;i<cuts.length-1;i++){
          const x0=cuts[i],x1=cuts[i+1],p=[x0,eave+.015,z],q=[x1,eave+.015,z],r=[x1,top(x1),z],s=[x0,top(x0),z];
          const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([...p,...q,...r,...p,...r,...s],3));g.computeVertexNormals();
          caps.push(part(g,['#182329','#101d22','#202d32','#15232b'][i%4]));
          if(i>0)parts.push(beam([x0,eave+.015,z-.025],[x0,top(x0),z-.025],.052,.065,'#c2beb0'));
        }
        continue;
      }
      for(let i=0;i<20;i++){
        const a=-Math.PI/2+i/20*Math.PI,b=a+Math.PI/20;
        const p=[Math.sin(a)*halfW,eave+Math.cos(a)*rise,z],q=[Math.sin(b)*halfW,eave+Math.cos(b)*rise,z];
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,eave,z,...p,...q],3));g.computeVertexNormals();
        caps.push(part(g,'#345560'));
        if(i%2===0)parts.push(beam([p[0],eave,z],p,.045,.06,'#8da3a8'));
      }
    }
    const capMesh=new THREE.Mesh(mergeParts(caps),
      creek?new THREE.MeshStandardMaterial({vertexColors:true,roughness:.33,metalness:.28,side:THREE.DoubleSide}):
        surfaceMaterial('glass',{vertexColors:true,roughness:.31,metalness:.15,side:THREE.DoubleSide}));
    group.add(capMesh);
  }
  for(const side of [-1,1]) {
    parts.push(box(.21,.62,length,creek ? '#135f59' : redTerminal?trim:'#e1e5e4',[side*halfW,eave-.31,1]));
    parts.push(box(.09,.12,length,creek ? '#d2d9d2' : trim,[side*(halfW+.12),eave+.04,1]));
    for(const z of [-length*.27,length*.26]) {
      const chairHalf=((def.seats||4)*.51+.18)/2;
      const x=side*(chair?Math.max(halfW-.85,1.9+chairHalf+.43):halfW-.85), h=eave-.6;
      structure.push(box(.64,h,.73,'#7f898a',[x,h/2-.05,z]));
      footing(structure, frame, x, z, 1.05, 1.27, .29);
      if(chair) structure.push(box(.72,1.12,.83,'#eb7a2a',[x,.56,z]));
      postCollider(grid,frame,x,z,.51);
    }
    const trackY=chair?2.85:3.65;
    structure.push(box(.21,.25,length-.8,'#798d96',[side*(chair?1.9:1.6),trackY,1]));
    if(!showcase)for(let z=-length/2+1;z<length/2;z+=1.13) {
      const wheel=new THREE.CylinderGeometry(.19,.19,.13,10);wheel.rotateZ(Math.PI/2);
      structure.push(part(wheel,'#34474e',[side*(chair?1.9:1.6),trackY-.10,z]));
    }
  }
  for(const z of [1-length/2,1+length/2]) {
    parts.push(box(halfW*2,.56,.22,creek ? '#17645e' : redTerminal?trim:'#dce3e3',[0,eave-.31,z]));
    parts.push(box(halfW*2,.11,.25,trim,[0,eave+.025,z]));
  }
  if(showcase){
    const wheelY=eave-.83,centerZ=1-length/2+3.18,radius=1.9;
    for(const [r,tint] of [[radius,'#9ca9ad'],[radius-.16,'#424f57']]){
      const ring=new THREE.TorusGeometry(r,.071,6,48);ring.rotateX(Math.PI/2);structure.push(part(ring,tint,[0,wheelY,centerZ]));
    }
    structure.push(part(new THREE.CylinderGeometry(.38,.38,.22,20),'#798b92',[0,wheelY,centerZ]));
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;
      structure.push(beam([Math.sin(a)*.35,wheelY,centerZ+Math.cos(a)*.35],
        [Math.sin(a)*(radius-.17),wheelY,centerZ+Math.cos(a)*(radius-.17)],.15,.18,'#6e818a'));
    }
    for(let i=0;i<32;i++){
      const a=i*Math.PI/16;
      structure.push(part(new THREE.CylinderGeometry(.017,.017,.034,6),'#cad2cd',
        [Math.sin(a)*radius,wheelY-.071,centerZ+Math.cos(a)*radius]));
    }
  }
  // Cable bays remain completely open at cabin/chair level.
  const operatorX=(creek&&base?-1:1)*(halfW+1.7);
  footing(structure, frame, operatorX, -2.8, 2.55, 3.25, -.04);
  structure.push(box(2.5,2.2,3.2,creek ? '#645746' : '#6c7372',[operatorX,1.05,-2.8]));
  glazing.push(box(1.75,1.15,.05,'#708e99',[operatorX,1.45,-4.43]));
  structure.push(box(2.8,.17,3.5,'#717e7b',[operatorX,2.25,-2.8]));
  group.add(createRoofSnow([[operatorX-1.40,2.34,-4.55],[operatorX+1.40,2.34,-4.55],
    [operatorX+1.40,2.34,-1.05],[operatorX-1.40,2.34,-1.05]],{seed:103,depth:.17,overhang:.12,spacing:.61}));
  group.add(createIcicles([operatorX-1.45,2.27,-4.57],[operatorX+1.45,2.27,-4.57],
    {seed:205,spacing:.36,length:.23}));
  postCollider(grid,frame,operatorX,-2.8,1.6);
  if(creek && base) {
    // The reference-era green Creekside hood, clock, ribbed fascia and map hut.
    for(let x=-halfW+.1;x<halfW;x+=.16) parts.push(box(.018,.64,.028,'#427f75',[x,eave-.31,1-length/2-.13]));
    creeksideSign(group,-1.1,eave-.26,1-length/2-.17,4.9);
    const {canvas,ctx}=makeCanvas(256,256);ctx.fillStyle='#f4f3df';ctx.beginPath();ctx.arc(128,128,118,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#283d3d';ctx.lineWidth=7;ctx.stroke();
    for(let i=0;i<12;i++){const a=i*Math.PI/6;ctx.beginPath();ctx.moveTo(128+Math.sin(a)*98,128-Math.cos(a)*98);ctx.lineTo(128+Math.sin(a)*109,128-Math.cos(a)*109);ctx.lineWidth=3;ctx.stroke();}
    ctx.beginPath();ctx.moveTo(128,128);ctx.lineTo(98,83);ctx.moveTo(128,128);ctx.lineTo(182,112);ctx.lineWidth=6;ctx.stroke();
    const clock=new THREE.Mesh(new THREE.CircleGeometry(.4,32),new THREE.MeshStandardMaterial({map:canvasTexture(canvas),roughness:.6}));
    clock.position.set(2.9,eave-.25,1-length/2-.2);clock.rotation.y=Math.PI;group.add(clock);
    const hutX=11;
    const wood=[box(7.4,2.85,4.3,'#ffffff',[hutX,1.35,-3.2])];
    for(let x=hutX-3.7;x<hutX+3.71;x+=.27)
      wood.push(box(.035,2.87,.045,'#80705c',[x,1.35,-5.38]));
    for(const x of [hutX-3.66,hutX-.80,hutX+3.66])wood.push(box(.17,2.90,.16,'#d1b495',[x,1.4,-5.43]));
    for(const x of [hutX-3.1,hutX+3.1])wood.push(box(.14,3.4,.14,'#9d8c75',[x,4.78,-5.27]));
    cedarMesh(group,wood);creeksideKioskRoof(group,parts,hutX);
    footing(structure, frame, hutX, -3.2, 7.55, 4.42, .06);
    glazing.push(box(5.6,1.2,.05,'#546d76',[hutX,1.59,-5.39]));
    for(const x of [hutX-2.85,hutX,hutX+2.85])parts.push(box(.065,1.34,.09,'#c6c9be',[x,1.59,-5.46]));
    for(const y of [.96,2.22])parts.push(box(5.78,.065,.09,'#d0cec1',[hutX,y,-5.46]));
    parts.push(box(7.3,3.72,.19,'#293b3b',[hutX,4.96,-5.44]));
    const atlas=new THREE.TextureLoader().load(new URL('../assets/maps/panorama-preview.webp',import.meta.url).href);
    atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=4;
    const mapPanel=new THREE.Mesh(new THREE.PlaneGeometry(6.96,3.38),new THREE.MeshStandardMaterial({map:atlas,roughness:.82,emissive:0xffffff,emissiveIntensity:.035}));
    mapPanel.position.set(hutX,4.96,-5.55);mapPanel.rotation.y=Math.PI;mapPanel.name='Creekside trail map · original resort panorama';group.add(mapPanel);
    const mapHeader=board(group,'WHISTLER · BLACKCOMB','',hutX,7.06,-5.5,5.3,Math.PI,'#293b3b','#e9ecdf');
    mapHeader.scale.y=.32;
    parts.push(box(7.47,.11,.29,'#89918a',[hutX,6.89,-5.44]));
    group.add(createRoofSnow([[hutX-3.8,6.94,-5.65],[hutX+3.8,6.94,-5.65],
      [hutX+3.8,6.94,-5.23],[hutX-3.8,6.94,-5.23]],{seed:244,depth:.10,overhang:.06,spacing:.48}));
    group.add(createIcicles([hutX-3.78,6.88,-5.63],[hutX+3.78,6.88,-5.63],{seed:812,spacing:.56,length:.15}));
    board(group,'CREEKSIDE','GONDOLA ENTRANCE',7.9,2.0,-13.3,3.6);
    postCollider(grid,frame,hutX,-3.2,3.7);
    // The red operator canopy and little Canadian flag punctuate the green
    // terminal in both supplied Creekside photographs.
    parts.push(part(new THREE.ConeGeometry(1.78,.66,4),'#b61f43',[-8.1,3.11,-8.2],[0,Math.PI/4,0]));
    for(const dx of [-1.14,1.14])for(const dz of [-1.14,1.14])parts.push(box(.033,2.82,.033,'#d4d5cf',[-8.1+dx,1.41,-8.2+dz]));
    parts.push(box(.04,3.4,.04,'#b8c0bd',[3.5,7.18,1-length/2]));
    const flag=new THREE.Mesh(new THREE.PlaneGeometry(.8,.40),new THREE.MeshStandardMaterial({side:THREE.DoubleSide,roughness:.8}));
    const flagCanvas=makeCanvas(240,120);flagCanvas.ctx.fillStyle='#b52235';flagCanvas.ctx.fillRect(0,0,240,120);flagCanvas.ctx.fillStyle='#f4f1df';flagCanvas.ctx.fillRect(60,0,120,120);
    flagCanvas.ctx.fillStyle='#b52235';flagCanvas.ctx.beginPath();
    const leaf=[[0,-.81],[.15,-.39],[.33,-.48],[.26,-.1],[.66,-.26],[.49,.04],[.77,.11],[.26,.43],[.1,.40],[.10,.76],[-.10,.76],[-.10,.4],[-.26,.43],[-.77,.11],[-.49,.04],[-.66,-.26],[-.26,-.10],[-.33,-.48],[-.15,-.39]];
    leaf.forEach(([x,y],i)=>i?flagCanvas.ctx.lineTo(120+x*49,61+y*49):flagCanvas.ctx.moveTo(120+x*49,61+y*49));flagCanvas.ctx.closePath();flagCanvas.ctx.fill();
    flag.material.map=canvasTexture(flagCanvas.canvas);flag.position.set(3.9,8.43,1-length/2);group.add(flag);
  } else {
    const badge=board(group,def.name.replace(' Upper','').replace(' Lower','').replace(' Quad','').toUpperCase(),
      def.access === 'private' ? 'PRIVATE · RESIDENTS AND GUESTS' : gondola ? 'GONDOLA' : showcase?`EL. ${Math.round(frame.y)} m`:'',
      0,eave-.28,1-length/2-.15,Math.min(7.3,halfW*1.7),Math.PI,redTerminal?trim:'#d9e1e0',redTerminal?'#f2f1e7':'#1c313a');
    if(redTerminal)badge.scale.y=.43;
    if(/Big Red/.test(def.name)) board(group,'TSEWTSÍQWA QIĹQ','BIG RED EXPRESS',-halfW-.13,eave-.3,1,5.5,-Math.PI/2);
  }
  addParts(group,structure,{roughness:.68,metalness:.26});addParts(group,parts,{roughness:.49,metalness:.16});
  addParts(group,glazing,{roughness:.26,metalness:.22});
  return group;
}

function ropeSegment(parts, a, b, color) {
  const midpoint=[(a[0]+b[0])/2,(a[1]+b[1])/2-.07,(a[2]+b[2])/2];
  parts.push(beam(a,midpoint,.021,.025,color),beam(midpoint,b,.021,.025,color));
}

function loadingBelt(parent, frame, animations, conveyors, def) {
  const chair=def.type==='chair';
  const width=chair ? 3.6 : 1.55, length=chair ? 6.2 : 10.5;
  const centerX=chair ? -ropeOffset(def)-.05 : -3.15, centerZ=chair ? -5.0 : -3.2;
  const parts=[], first = centerZ - length / 2, last = centerZ + length / 2;
  const sections = Math.ceil(length / 1.25), step = length / sections;
  const floor = z => localFloor(frame, centerX, z);
  for (let i=0; i<sections; i++) {
    const a=first+i*step,b=a+step,za=floor(a),zb=floor(b),y=(za+zb)/2+.058,z=(a+b)/2;
    const angle=-Math.atan2(zb-za,step), incline=Math.hypot(zb-za,step), rotation=[angle,0,0];
    parts.push(box(width+.3,.12,incline+.035,'#7d8b8b',[centerX,y,z],rotation));
    parts.push(box(width,.07,incline+.035,'#28312f',[centerX,y+.085,z],rotation));
    for(const side of [-1,1]) parts.push(box(.11,.10,incline+.033,'#c8b044',[centerX+side*(width/2+.06),y+.11,z],rotation));
  }
  for(const z of [first,last]) parts.push(box(width,.13,.22,'#9aa9a7',[centerX,floor(z)+.07,z]));
  addParts(parent,parts,{roughness:.72,metalness:.3});
  const treads=new THREE.InstancedMesh(new THREE.BoxGeometry(width-.08,.027,.045),new THREE.MeshStandardMaterial({color:'#626a60',roughness:.85}),Math.ceil(length/.21));
  treads.name=chair?'Moving chair loading carpet slats':'Gondola boarding walkway slats';
  parent.add(treads);const dummy=new THREE.Object3D();
  conveyors.push({frame,cx:centerX,cz:centerZ,width,length,offset:.203,speed:.43});
  animations.push(Object.assign(time=>{for(let i=0;i<treads.count;i++){
    const z=first+(i*.21+time*.43)%length;
    dummy.position.set(centerX,floor(z)+.192,z);
    dummy.rotation.x=-Math.atan2(floor(Math.min(last,z+.21))-floor(Math.max(first,z-.21)),.42);
    dummy.updateMatrix();treads.setMatrixAt(i,dummy.matrix);
  }treads.instanceMatrix.needsUpdate=true;},{frame}));
}

export function stationQueueSlots() { return queueSlots; }

export function buildStationOperations(scene, grid) {
  queueSlots.length=0;const animations=[];const groups=[],conveyors=[];
  for(const def of LIFTS.filter(d=>d.aerial && d.rideable)) {
    const frame=stationFrame(def), chair=def.type==='chair', peak=def.id===PEAK_TO_PEAK;
    // Keep the PEAK 2 PEAK queue outside the side entrance of its large hall.
    if(peak){frame.x=539.6;frame.z=4823.7;frame.y=heightAt(...def.points[0])-.75;}
    const group=groupAt(scene,`${def.name} · rope and metal queue corral`,frame),parts=[];groups.push(group);
    const dense=/Creekside|Village|Blackcomb/.test(def.name), lanes=dense?4:3, railStart=peak?-29:-12.2, railEnd=peak?-44:-26;
    const originX=peak?-18:-6, pitch=2.25;
    for(let lane=0;lane<=lanes;lane++){
      const x=originX-lane*pitch;
      for(let z=railStart;z>=railEnd;z-=2.7){const y=localFloor(frame,x,z);
        parts.push(box(.055,1.03,.055,dense?'#bdc9c9':'#ba6c43',[x,y+.5,z]));
        if(dense) parts.push(box(.35,.045,.22,'#a7b3b2',[x,y+.015,z]));
      }
      for(let z=railStart;z>railEnd;z-=2.7){
        const end=Math.max(railEnd,z-2.7),a=[x,localFloor(frame,x,z)+.91,z],b=[x,localFloor(frame,x,end)+.91,end];
        if(dense){parts.push(beam(a,b,.039,.045,'#bcc7c8'));parts.push(beam([a[0],a[1]-.42,a[2]],[b[0],b[1]-.42,b[2]],.025,.033,'#c3cbcc'));}
        else ropeSegment(parts,a,b,'#b25348');
      }
      if(lane<lanes)for(let k=0;k<4;k++){
        const localX=x-pitch/2,z=railStart-1.4-k*3.0,p=world(frame,localX,z);
        queueSlots.push({...p,y:heightAt(p.x,p.z),heading:frame.yaw,liftId:def.id,kind:'queue',slot:lane*4+k});
      }
    }
    // Gate bars, scanner posts and the board-here line lead from the corral.
    for(let lane=0;lane<Math.min(lanes,3);lane++){
      const x=originX-(lane+.5)*pitch,y=localFloor(frame,x,railStart+1.5),z=railStart+1.5;
      parts.push(box(.22,1.12,.22,'#697d83',[x-.78,y+.55,z]));
      parts.push(box(.27,.32,.24,'#344f5b',[x-.78,y+1.25,z]));
      parts.push(box(.12,.08,.04,'#69bcb1',[x-.78,y+1.27,z-.14]));
      parts.push(beam([x-.7,y+.81,z],[x+.72,y+.81,z],.045,.055,'#8d9fa3'));
    }
    groundBoard(group,parts,frame,chair?'SKIS STRAIGHT · POLES FREE':'REMOVE SKIS · BOARD HERE',chair?'WAIT FOR THE GATE':'GONDOLA ENTRANCE',originX-1.1,railStart-2,3);
    addParts(group,parts,{roughness:.52,metalness:.38});
    if(!peak) loadingBelt(group,frame,animations,conveyors,def);
  }
  // Actual mapped beginner carpets retain their ground-following incline.
  for(const def of LIFTS.filter(d=>d.surfaceType==='magic_carpet')) {
    const [a,b]=[def.points[0],def.points.at(-1)],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const frame=stationFrame(def),group=groupAt(scene,def.name+' · moving beginner carpet',frame),parts=[];
    conveyors.push({frame,cx:0,cz:length/2,width:1.04,length,speed:def.speed,offset:.13});
    const count=Math.ceil(length/.6),dummy=new THREE.Object3D();
    const tread=new THREE.InstancedMesh(new THREE.BoxGeometry(1.02,.04,.45),new THREE.MeshStandardMaterial({color:'#36403c',roughness:.84}),count);group.add(tread);
    for(let z=0;z<length;z+=1.5){
      const end=Math.min(z+1.5,length);
      for(const x of [-.59,.59]) parts.push(beam([x,localFloor(frame,x,z)+.086,z],
        [x,localFloor(frame,x,end)+.086,end],.075,.14,'#bec1af'));
    }
    groundBoard(group,parts,frame,def.name.toUpperCase(),'SKIS STRAIGHT',-1.9,-2.2,2.5);
    addParts(group,parts,{roughness:.62,metalness:.2});
    animations.push(Object.assign(time=>{for(let i=0;i<count;i++){const z=(i*.6+time*def.speed)%length;
      dummy.position.set(0,localFloor(frame,0,z)+.105,z);dummy.rotation.x=-Math.atan2(localFloor(frame,0,Math.min(length,z+.4))-localFloor(frame,0,Math.max(0,z-.4)),.8);
      dummy.updateMatrix();tread.setMatrixAt(i,dummy.matrix);
    }tread.instanceMatrix.needsUpdate=true;},{frame}));
  }
  for(const animate of animations)animate(0);
  return { queueSlots, groups, conveyors,
    conveyorAt(x,z) {
      for(const belt of conveyors){const dx=x-belt.frame.x,dz=z-belt.frame.z,c=Math.cos(belt.frame.yaw),s=Math.sin(belt.frame.yaw);
        const lx=dx*c-dz*s,lz=dx*s+dz*c;
        if(Math.abs(lx-belt.cx)<=belt.width/2 && Math.abs(lz-belt.cz)<=belt.length/2) {
          const p=world(belt.frame,belt.cx,lz);
          return {vx:s*belt.speed,vz:c*belt.speed,y:heightAt(p.x,p.z)+belt.offset};
        }
      }
      return null;
    },update(time,camera) {
    for(const fn of animations){
      if(!camera || Math.hypot(camera.position.x-fn.frame.x,camera.position.z-fn.frame.z)<1000)fn(time);
    }
  } };
}
