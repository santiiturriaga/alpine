import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { MOUNTAIN } from './worlddata.js';
import { buildingData } from '../data/osm-whistler.js';
import { box, beam, part, cacheStaticTransforms, mergedMesh, mergeParts } from './scenery.js';
import { makeCanvas, canvasTexture, lerp, mulberry32 } from './util.js';
import { surfaceMaterial } from './materials.js';
import { makePeak2PeakBadge } from './lift-stations.js';
import { LODGE_FRAME, LODGE_CAFE, LODGE_TERRACE, LODGE_ANNEX, blackcombPeakTerminalSite, terraceStairHeight } from './roundhouse-site.js';
import { furnishShop } from './shop-interiors.js';
import { addStoneFloor, addWoolCarpet } from './interior-floors.js';

// Only these mapped village buildings are replaced with open-door shells.
// Furnishings and room plans are an interpretation; mapped anchors are retained.
export const ENTERABLE_VILLAGE_IDS = new Set(['295033275', '147438106']);
const rooms = [];
const decks = [];
const socialSlots = [];
const diningCounters = [];
const lodgeRunner = ['#473334', '#764641', '#d9b484'];
export function lodgeSocialSlots() { return socialSlots; }

function lodgeGuest(room, x, z, turn, activity, options = {}) {
  socialSlots.push({ ...world(room,x,z), y:room.y, heading:room.yaw+turn, lodge:room.id, activity, ...options });
}

function diningCounter(room, x, z, title, item, price) {
  diningCounters.push({ ...world(room,x,z), y:room.y, room:room.id, title, item, price });
}

function label(parent, title, sub, x, y, z, width = 4, yaw = 0) {
  const { canvas, ctx } = makeCanvas(1024, 256);
  ctx.fillStyle = '#263b3e'; ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#d6c4a0'; ctx.lineWidth = 7; ctx.strokeRect(10, 10, 1004, 236);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3e9d6';
  ctx.font = 'bold 81px Arial'; ctx.fillText(title, 512, sub ? 96 : 130, 944);
  if (sub) { ctx.font = '36px Arial'; ctx.fillStyle = '#c0d7d7'; ctx.fillText(sub, 512, 190, 950); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshStandardMaterial({
    map: canvasTexture(canvas), roughness: .8, emissive: 0xffffff, emissiveIntensity: .12,
  }));
  m.position.set(x, y, z); m.rotation.y = yaw; parent.add(m);
}

function transform(room, x, z) {
  const dx = x - room.x, dz = z - room.z, c = Math.cos(room.yaw), s = Math.sin(room.yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
function world(room, x, z) {
  const c = Math.cos(room.yaw), s = Math.sin(room.yaw);
  return { x: room.x + x * c + z * s, z: room.z - x * s + z * c };
}
function collider(grid, room, x, z, w, d, type = 'lodge', top = type === 'furniture' ? 2.35 : room.h + .35) {
  const p = world(room, x, z);
  // ColliderGrid uses a planar positive-angle convention opposite Object3D yaw.
  grid.addBox(p.x, p.z, w / 2, d / 2, -room.yaw, type,
    { room: room.id, minY: room.y - .55, maxY: room.y + top });
}
function mesh(parent, parts, material) {
  if (!parts.length) return;
  const m = material ? new THREE.Mesh(mergeParts(parts), material) : mergedMesh(parts);
  m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}

function ramp(room, parent) {
  const length = room.rampLength || 11, half = room.doorWidth / 2 + .4;
  const vertices = [], indices = [], front = room.d / 2;
  // Terrain is sampled at every step, so the last strip meets actual snow.
  for (let i = 0; i <= 20; i++) {
    const t = i / 20, z = front + length * t;
    for (const x of [room.doorX - half, room.doorX + half]) {
      const p = world(room, x, z), y = lerp(room.y, heightAt(p.x, p.z) + .025, t);
      vertices.push(x, y - room.y, z);
    }
    if (i < 20) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.setIndex(indices); g.computeVertexNormals();
  const m = new THREE.Mesh(g, surfaceMaterial('stone', { color: '#a1a5a2', side: THREE.DoubleSide }));
  m.receiveShadow = true; parent.add(m);
}

function furnish(room, group, grid) {
  if(room.kind === 'dining') return furnishDining(room,group,grid);
  if(room.kind === 'barber' || room.kind === 'outfitter') {
    return furnishShop(room, group, (x,z,w,d)=>collider(grid,room,x,z,w,d,'furniture'), label);
  }
  const timber = [], details = [], stone = [], hw = room.w / 2, hd = room.d / 2;
  // Keep the centre aisle and door approach clear.
  const table = (x, z, w = 2.05) => {
    timber.push(box(w, .13, 1.0, '#a47c51', [x, .78, z]));
    for (const side of [-1, 1]) {
      details.push(box(.07, .7, .7, '#3c4447', [x + side * (w / 2 - .18), .35, z]));
      timber.push(box(w, .12, .34, '#876347', [x, .45, z + side * .89]));
      details.push(box(.08, .42, .31, '#414747', [x + side * .7, .21, z + side * .89]));
    }
    collider(grid, room, x, z, w + .15, 2.25, 'furniture');
    details.push(box(.12, .15, .12, '#e7e0d0', [x + .45, .92, z]));
  };
  const tableColumns = room.w > 25 ? [-hw + 3.4, -6.4, 6.4, hw - 3.4] : [-hw + 3.4, hw - 3.4];
  for (const x of tableColumns) {
    for (const z of [-hd + 4.2, .5]) {
      if (room.w < 13 && x > 0 || room.d < 10 && z > 0) continue;
      table(x, z, room.w < 13 ? 1.6 : 2.5);
      if (room.id === 'roundhouse') {
        lodgeGuest(room,x-.39,z+.89,Math.PI,'diner',{seated:1});
        if(z>.1)lodgeGuest(room,x+.45,z-.89,0,'diner',{seated:1});
      }
    }
  }
  const hearthX = hw - 2.1, hearthZ = -hd + 1.0;
  stone.push(box(3, 2.1, .65, '#696258', [hearthX, 1.05, hearthZ]));
  details.push(box(1.55, .86, .08, '#201f1d', [hearthX, .65, hearthZ + .36]));
  const fire = new THREE.Mesh(new THREE.PlaneGeometry(1.18, .5), new THREE.MeshBasicMaterial({ color: '#ed9751' }));
  fire.position.set(hearthX, .61, hearthZ + .41); group.add(fire);
  room.hearth = { ...world(room, hearthX, hearthZ + .41), y: room.y + .61 };
  collider(grid, room, hearthX, hearthZ, 3.1, 1.1, 'furniture');
  // Service counter at the back with hand-built cups and a menu board.
  const counterW = Math.min(5.7, room.w * .4);
  const cappBar = room.id === 'roundhouse', counterZ = -hd + (cappBar ? 2.05 : 1.0);
  timber.push(box(counterW, .98, 1.0, '#78573d', [-1.2, .49, counterZ]));
  stone.push(box(counterW + .16, .09, 1.12, '#c2b7a1', [-1.2, 1.03, counterZ]));
  collider(grid, room, -1.2, counterZ, counterW + .2, 1.2, 'furniture');
  const cup = new THREE.CylinderGeometry(.049,.039,.105,12), lid = new THREE.CylinderGeometry(.053,.053,.022,12);
  for (let i = 0; i < 4; i++) {
    const x = -2.3 + i * .27;
    details.push(part(cup,'#d7cbb4',[x,1.132,counterZ+.22]),part(lid,'#edeadf',[x,1.190,counterZ+.22]));
  }
  if (cappBar) {
    label(group, 'ROUNDHOUSE CAPP BAR', 'HOT CHOCOLATE  ·  2 COINS', -1.2, 2.14, -hd + .19, 4.5);
    details.push(box(.94,.35,.45,'#464d50',[-3.42,1.26,counterZ-.11]));
    details.push(box(.96,.075,.48,'#676d6e',[-3.42,1.474,counterZ-.1]));
    details.push(box(.79,.19,.035,'#a4aba9',[-3.42,1.25,counterZ+.13]));
    details.push(box(.47,.037,.22,'#373d40',[-3.42,1.11,counterZ+.238]));
    for(let i=0;i<3;i++)details.push(part(cup,'#e5dfd1',[-3.72+i*.26,1.579,counterZ-.1]));
    timber.push(box(1.6,.092,.29,'#715439',[1.3,1.46,-hd+.26]));
    for(let i=0;i<5;i++)details.push(part(cup,i%2?'#b3b8a7':'#c4af8a',[.82+i*.23,1.56,-hd+.31]));
    diningCounter(room,-1.2,counterZ+.9,'Roundhouse Capp Bar','Hot chocolate',2);
    lodgeGuest(room,-1.2,counterZ-1.05,0,'server',{shift:1.3});
    lodgeGuest(room,1.15,counterZ+1.78,Math.PI,'customer');
  } else {
    label(group, 'MOUNTAIN CAFÉ', 'WARM UP • TAKE A SEAT', -1.2, Math.min(2.1, room.h - .55), -hd + .3, Math.min(4.2, room.w * .6));
  }
  label(group, 'EXIT →', 'BACK TO THE MOUNTAIN', hw - 2.1, 2.0, hd - .18, 2.1, Math.PI);
  // Timber ceiling joists and warm pendant fixtures use emissive geometry;
  // no extra point lights are needed across the open world.
  for (let z = -hd + 1.5; z < hd; z += 3) {
    timber.push(box(room.w - .4, .19, .19, '#5c4230', [0, room.h - .13, z]));
    details.push(box(1.3, .045, .36, '#efcb89', [0, room.h - .25, z]));
  }
  mesh(group, timber, surfaceMaterial('timber', { vertexColors: true }));
  mesh(group, stone, surfaceMaterial('stone', { vertexColors: true }));
  mesh(group, details, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .62, emissive: 0x7d603a, emissiveIntensity: .1 }));
}

function furnishDining(room,group,grid) {
  const wood=[],metal=[],details=[],lamps=[];
  const chair=(x,z,yaw)=>{
    const rotate=(px,pz)=>[x+px*Math.cos(yaw)+pz*Math.sin(yaw),z-px*Math.sin(yaw)+pz*Math.cos(yaw)];
    const at=(w,h,d,col,px,y,pz)=>{const p=rotate(px,pz);return box(w,h,d,col,[p[0],y,p[1]],[0,yaw,0]);};
    wood.push(at(.46,.075,.45,'#a07549',0,.48,0),at(.46,.36,.065,'#92704e',0,.79,-.2));
    for(const sx of [-.18,.18])for(const sz of [-.16,.16])metal.push(at(.035,.46,.035,'#424d50',sx,.23,sz));
    for(const sx of [-.18,.18])metal.push(at(.035,.58,.035,'#424d50',sx,.7,-.2));
  };
  for(const x of [-15,-9,-4,5,11])for(const z of [-2.7,3.5]){
    wood.push(box(1.75,.115,1.04,'#b68c5a',[x,.79,z]));
    metal.push(box(.65,.09,.65,'#555d59',[x,.075,z]),box(.11,.68,.11,'#56615d',[x,.4,z]));
    for(const side of [-1,1])for(const dx of [-.47,.47])chair(x+dx,z+side*.91,side>0?Math.PI:0);
    if ((x+z)>-12) {
      lodgeGuest(room,x-.47,z+.91,Math.PI,'diner',{seated:1});
      if (z > 0 || x === 11) lodgeGuest(room,x+.47,z-.91,0,'diner',{seated:1});
    }
    collider(grid,room,x,z,2.0,2.65,'furniture');
    // Trays, plates, cups, rolled napkins and an open glove break up the table.
    details.push(box(.40,.018,.29,'#6f7a70',[x-.38,.862,z+.08]));
    details.push({geo:new THREE.CylinderGeometry(.12,.13,.022,16),color:'#eeece1',pos:[x-.38,.88,z+.08],rot:[0,0,0],scale:[1,1,1]});
    details.push({geo:new THREE.CylinderGeometry(.044,.035,.12,12),color:'#e9e3cc',pos:[x+.44,.91,z-.18],rot:[0,0,0],scale:[1,1,1]});
    details.push(box(.12,.025,.19,'#2d4145',[x+.51,.862,z+.15],[0,.23,0]));
    details.push(box(.075,.02,.14,'#ede6d6',[x+.16,.857,z-.2],[0,-.3,0]));
  }
  // Glazing-height counter seats look out over the plaza and the Coast range.
  wood.push(box(24.5,.12,.51,'#a27e54',[-3.3,1.05,7.73]));
  for(let x=-14.7;x<9;x+=2.5){
    wood.push(box(.43,.075,.4,'#92704b',[x,.7,7.12]));
    for(const side of [-1,1])metal.push(box(.035,.67,.31,'#566267',[x+side*.17,.35,7.12]));
  }
  const outlets=[[-13.2,'Kettle','Beef & bean chili',4],[-5.7,'Black Diamond Burger Co.','Bacon cheeseburger',6],
    [1.8,'Good Bowls','Tofu green curry',5],[9.3,'The Coop','Chicken tenders & fries',5]];
  for(const [x,title,item,price] of outlets){
    wood.push(box(6.75,1.08,1.15,'#7a6046',[x,.54,-6.7]));
    details.push(box(6.98,.10,1.3,'#b5b6a7',[x,1.13,-6.7]));
    metal.push(box(6.2,.08,.38,'#bac2bb',[x,1.48,-6.96]));
    for(const side of [-1,1])metal.push(box(.035,.44,.04,'#b8c4c1',[x+side*2.7,1.31,-6.96]));
    label(group,title.toUpperCase(),`${item.toUpperCase()}  ·  ${price} COINS`,x,2.58,-8.27,5.45);
    collider(grid,room,x,-6.7,6.75,1.4,'furniture');
    diningCounter(room,x,-5.55,title,item,price);
    lodgeGuest(room,x,-7.84,0,'server',{shift:1.65});
    if (x<3) lodgeGuest(room,x+1.95,-5.28,Math.PI,'customer');
    for(let i=0;i<4;i++){
      details.push(box(.38,.10,.27,'#484c40',[x-1.5+i*.75,1.23,-6.67]));
      details.push(box(.31,.032,.185,i%2?'#bb9563':'#9baf83',[x-1.5+i*.75,1.288,-6.67]));
    }
  }
  // Paired posts and knee braces carry the visibly high timber ceiling.
  for(const x of [-17.7,15.8])for(const z of [-4.9,5.7]){
    wood.push(box(.30,room.h-.18,.30,'#624631',[x,(room.h-.18)/2,z]));
    for(const side of [-1,1])wood.push(beam([x,room.h-1.4,z],[x+side*1.1,room.h-.25,z],.16,.20,'#70503a'));
    collider(grid,room,x,z,.35,.35,'furniture');
  }
  for(const z of [-5.2,-.2,5.0]){
    wood.push(box(room.w-.3,.25,.29,'#60412c',[0,room.h-.18,z]));
    for(const x of [-12,-4,5,12]){
      metal.push(box(.021,.65,.021,'#554b3c',[x,room.h-.62,z]));
      lamps.push({geo:new THREE.ConeGeometry(.34,.18,16,1,true),color:'#bc9a6a',pos:[x,room.h-1,z],rot:[0,0,Math.PI],scale:[1,1,1]});
      lamps.push({geo:new THREE.CylinderGeometry(.24,.24,.035,16),color:'#f8dd9a',pos:[x,room.h-1.08,z],rot:[0,0,0],scale:[1,1,1]});
    }
  }
  label(group,'ROUNDHOUSE LODGE','MOUNTAIN MARKET',-18.1,2.2,0,4.0,Math.PI/2);
  label(group,'TERRACE →','MOUNTAIN VIEWS',15.5,2.3,8.47,3.3,Math.PI);
  mesh(group,wood,surfaceMaterial('timber',{vertexColors:true,emissive:0xaa754e,emissiveIntensity:.13}));
  mesh(group,metal,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:.35}));
  mesh(group,details);mesh(group,lamps,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.5,emissive:0xffc775,emissiveIntensity:.32,side:THREE.DoubleSide}));
}

function buildRoundhouseBalcony(scene,grid,base,market) {
  const room={...LODGE_FRAME,y:base+LODGE_TERRACE.floor,id:'roundhouse-balcony',h:3.2};
  const group=new THREE.Group();group.name='Roundhouse terrace · accessible timber balcony';
  group.position.set(room.x,room.y,room.z);group.rotation.y=room.yaw;scene.add(group);
  const wood=[],metal=[],details=[];
  const end=29.86, marketFront=market.z+market.d/2;
  for(let x=-20.1;x<=30.2;x+=.22){
    const start=Math.abs(x-market.x)<market.w/2 ? marketFront : 24.84;
    wood.push(box(.204,.022,end-start,'#8f7355',[x,.013,(start+end)/2]));
  }
  for(const x of [-16.6,-8.9,1.6,10.2,17.5]){
    wood.push(box(2.05,.10,.85,'#a17d53',[x,.81,27.25]));
    for(const side of [-1,1]){
      wood.push(box(2.05,.1,.30,'#8d6c49',[x,.48,27.25+side*.77]));
      metal.push(box(.09,.7,.67,'#515c58',[x+side*.7,.35,27.25]));
    }
    details.push(box(.1,.12,.1,'#ebe4cf',[x+.5,.92,27.25]));
    collider(grid,room,x,27.25,2.18,2.35,'furniture',1);
  }
  // Side rails and the long outer rail are physical barriers at deck height.
  collider(grid,room,1.6,29.71,44.2,.16,'lodge',.99);
  collider(grid,room,28.9,29.71,3.2,.16,'lodge',.99);
  collider(grid,room,-20.45,27.29,.14,4.88,'lodge',.99);
  collider(grid,room,30.45,27.29,.14,4.88,'lodge',.99);
  for(const z of [26,28.5])for(const x of [-20.4,30.4])wood.push(box(.13,1.0,.13,'#654934',[x,.51,z]));
  mesh(group,wood,surfaceMaterial('timber',{vertexColors:true}));mesh(group,metal);mesh(group,details);
  decks.push({ ...room, floorAt(x,z){
    const p=transform(room,x,z);
    if(p.x>=-20.5 && p.x<=30.5 && p.z>=24.77 && p.z<=29.925)return room.y;
    const stair=terraceStairHeight(p.x,p.z);
    return stair===null ? null : base+stair;
  }});
  for(const [x,z,heading] of [[-12.3,28.7,0],[-11.2,28.6,2.9],[5.7,28.6,.6],[6.9,28.6,3.5],[20.9,28.6,0]])socialSlots.push({...world(room,x,z),y:room.y,heading:room.yaw+heading,lodge:room.id,kind:'social'});
}

function buildRoom(scene, grid, room, shell = true) {
  rooms.push(room);
  const group = new THREE.Group(); group.name = `${room.name} · walkable interior`;
  group.position.set(room.x, room.y, room.z); group.rotation.y = room.yaw; scene.add(group);
  const details = new THREE.Group();
  group.add(details);
  const hw = room.w / 2, hd = room.d / 2, walls = [], frame = [], panes = [];
  const doorL = room.doorX - room.doorWidth / 2, doorR = room.doorX + room.doorWidth / 2;
  const wall = (x, z, w, d, h = room.h, y = h / 2) => {
    walls.push(box(w, h, d, '#a18b6e', [x, y, z]));
    collider(grid, room, x, z, w, d);
  };
  for (const x of [-hw, hw]) {
    if (shell) {
      wall(x, 0, .32, room.d, .7);
      walls.push(box(.32, room.h - 2.75, room.d, '#70533c', [x, (room.h + 2.75) / 2, 0]));
      panes.push(box(.045, 2.05, room.d, '#88b3c0', [x, 1.725, 0]));
      for (let z = -hd; z <= hd; z += 2.4) frame.push(box(.14, 2.15, .10, '#574d42', [x, 1.77, z]));
    } else wall(x, 0, .32, room.d);
  }
  wall(0, -hd, room.w, .32);
  if (shell) {
    // Wide glazed frontage: low sill, clear upper windows, and open central door.
    for (const [left, right] of [[-hw, doorL], [doorR, hw]]) {
      const width = right - left, center = (left + right) / 2;
      wall(center, hd, width, .32, .7);
      walls.push(box(width, room.h - 2.75, .32, '#70533c', [center, (room.h + 2.75) / 2, hd]));
      panes.push(box(width, 2.05, .045, '#88b3c0', [center, 1.725, hd]));
      for (let x = left; x <= right; x += 2.4) frame.push(box(.10, 2.15, .14, '#574d42', [x, 1.77, hd]));
    }
    walls.push(box(room.doorWidth, room.h - 2.75, .32, '#70533c', [room.doorX, (room.h + 2.75) / 2, hd]));
    walls.push(box(room.w + .8, .34, room.d + .8, '#e8eeef', [0, room.h + .16, 0]));
    for (const x of [-hw, hw]) frame.push(beam([x, room.h, -hd], [x, room.h, hd], .16, .22, '#554431'));
    label(group, room.name.toUpperCase(), 'OPEN • WALK INSIDE', room.doorX, 3.35, hd + .22, Math.min(room.w - .5, 6.7));
  } else if(room.frontWindows) {
    const clearTop=Math.min(3.13,room.h-.15),clearH=clearTop-.62;
    const random=mulberry32(room.kind==='dining'?46141:372);
    for(const [l,r] of [[-hw,doorL],[doorR,hw]]){
      const width=r-l,center=(l+r)/2;
      wall(center,hd,width,.17,.62);
      walls.push(box(width,room.h-clearTop,.17,'#72543e',[center,(room.h+clearTop)/2,hd]));
      frame.push(box(width,.10,.23,'#635b51',[center,.615,hd+.064]));
      frame.push(box(width,.081,.16,'#69675e',[center,clearTop,hd+.068]));
      const bays=Math.ceil(width/2.08),bayW=width/bays;
      for(let i=0;i<bays;i++){
        const end=l+(i+1)*bayW,x=end-bayW/2;
        const glaze=['#6d8994','#799599','#7896a0','#6f8a9b'][Math.floor(random()*4)];
        panes.push(box(bayW-.085,clearH-.092,.037,glaze,[x,.62+clearH/2,hd-.008]));
        frame.push(box(.113,clearH-.04,.21,'#554c42',[end,.62+clearH/2,hd+.058]));
        frame.push(box(.045,clearH-.11,.041,'#85847a',[end,.62+clearH/2,hd+.171]));
        frame.push(box(bayW-.019,.49,.109,i%3===1?'#898277':'#817d73',[x,.31,hd+.131]));
        frame.push(box(bayW-.022,.094,.146,'#73716a',[x,.104,hd+.146]));
      }
      frame.push(box(.105,clearH+.051,.188,'#665649',[l,.62+clearH/2,hd+.058]));
    }
    const head=room.doorHead??2.75, lintel=room.h-head;
    if(lintel>0)walls.push(box(room.doorWidth,lintel,.18,'#72543e',[room.doorX,head+lintel/2,hd]));
  } else {
    // Roundhouse exterior is built by roundhouse.js, including its door opening.
    for (const [l, r] of [[-hw, doorL], [doorR, hw]]) wall((l + r) / 2, hd, r - l, .2);
  }
  // Keep the walk surface and threshold datum as the base for the stone and runner.
  walls.push(box(room.w, .21, room.d, '#8f785b', [0, -.105, 0]));
  addStoneFloor(details, { w: room.w, d: room.d });
  if (shell) {
    const low = Math.min(...[-hw, -hw / 2, 0, hw / 2, hw].flatMap(x => [-hd, -hd / 2, 0, hd / 2, hd].map(z => {
      const p = world(room, x, z); return heightAt(p.x, p.z);
    }))) - room.y - .7;
    mesh(group, [box(room.w, -low, room.d, '#858681', [0, low / 2 - .13, 0])], surfaceMaterial('stone', { vertexColors: true }));
  }
  walls.push(box(room.w - .2, .13, room.d - .2, '#5b4c3c', [0, room.h + .04, 0]));
  // A fixed warm fill avoids altering the renderer's light count at a doorway.
  mesh(group, walls, surfaceMaterial('timber', { vertexColors: true, emissive:0xa97955, emissiveIntensity:.20 }));
  mesh(group, frame);
  const glassOptions = { vertexColors:true, roughness:.30, metalness:.11, transparent:true, opacity:.36, depthWrite:false };
  const glass = room.frontWindows
    ? surfaceMaterial('glass', { ...glassOptions, opacity:.46 })
    : new THREE.MeshStandardMaterial(glassOptions);
  mesh(group, panes, glass);
  // Twin jambs and a runner centered on the doorway mark the way inside.
  const doorHead=room.doorHead??2.75;
  mesh(group, [...[doorL, doorR].map(x => box(.12, doorHead, .27, '#60442f', [x, doorHead/2, hd])),
    box(room.doorWidth+.15,.095,.22,'#60442f',[room.doorX,doorHead,hd])]);
  const runnerLength = room.kind === 'dining' ? 2.25 : room.kind === 'cafe' ? Math.min(6.4, room.d * .32) : 1.0;
  addWoolCarpet(details, {
    w: room.doorWidth - .28, d: runnerLength, x: room.doorX, z: hd - .12 - runnerLength / 2,
    palette: room.kind === 'outfitter' || room.kind === 'barber' ? ['#303e3e','#425551','#979481'] : lodgeRunner,
    name: 'Woven entrance runner',
  });
  if(room.entrySteps){
    const frames=[],glass=[],leaf=.79;
    for(const side of [-1,1]){
      const x=room.doorX+side*(room.doorWidth/2-.04),z=hd-leaf/2;
      glass.push(box(.035,doorHead-.18,leaf-.13,'#88a8a9',[x,doorHead/2,z]));
      for (const edge of [-1,1]) frames.push(box(.068,doorHead,.067,'#63564c',[x,doorHead/2,z+edge*leaf/2]));
      for (const y of [.065,doorHead/2,doorHead-.06]) frames.push(box(.068,.074,leaf,'#5c5345',[x,y,z]));
      frames.push(box(.097,.073,.25,'#a4a5a1',[x,1.02,hd-.62]));
    }
    mesh(group,frames);
    mesh(group,glass,new THREE.MeshStandardMaterial({vertexColors:true,transparent:true,opacity:.24,depthWrite:false,roughness:.30}));
  }
  if (room.rampLength) ramp(room, group);
  furnish(room, details, grid);
  room.group = group;
  room.details = details;
  room.entry = { ...world(room, room.doorX, hd + .7), y: room.y, heading: room.yaw + Math.PI };
  cacheStaticTransforms(group);
  return room;
}

function mappedVillageRoom(lot, id, name, kind) {
  const x = lot.points.reduce((sum, p) => sum + p[0], 0) / lot.points.length;
  const z = lot.points.reduce((sum, p) => sum + p[1], 0) / lot.points.length;
  let length = 0, yaw = 0;
  for (let i = 0; i < lot.points.length; i++) {
    const a = lot.points[i], b = lot.points[(i + 1) % lot.points.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > length) { length = d; yaw = -Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  // Choose the frontage which faces the pedestrian plaza near the origin.
  const front = world({ x, z, yaw }, 0, 5);
  if (Math.hypot(front.x, front.z) > Math.hypot(x, z)) yaw += Math.PI;
  const local = lot.points.map(p => transform({ x, z, yaw }, ...p));
  const w = Math.max(...local.map(p => p.x)) - Math.min(...local.map(p => p.x));
  const d = Math.max(...local.map(p => p.z)) - Math.min(...local.map(p => p.z));
  const y = Math.max(...lot.points.map(p => heightAt(...p))) + .19;
  const rampLength = 5;
  const approach = { ...world({x,z,yaw},0,d/2+rampLength+.65), heading:yaw+Math.PI, footMode:true };
  return { id, name, kind, x, z, yaw, w, d, y, h: 3.9, doorX: 0, doorWidth: 2.2, rampLength, approach };
}

export function buildLodgeInteriors(scene, grid) {
  rooms.length = 0;
  decks.length = 0; socialSlots.length=0;
  diningCounters.length=0;
  const base = heightAt(LODGE_FRAME.datumX, LODGE_FRAME.datumZ) - .15;
  const roundhouse = { ...LODGE_FRAME, id: 'roundhouse', name: 'Roundhouse Lodge', kind: 'cafe' };
  const roomCenter = world(roundhouse, LODGE_CAFE.x, LODGE_CAFE.front - 8.7);
  buildRoom(scene, grid, { ...roundhouse, ...roomCenter, y:base+LODGE_CAFE.floor, w:16.4, d:17.4, h:2.62,
    doorX:0, doorWidth:3.1, doorHead:2.26, entrySteps:LODGE_CAFE, frontWindows:true }, false);
  const market={x:4.6,z:18.5,w:38.8,d:17.0};
  const diningCenter=world(roundhouse,market.x,market.z);
  buildRoom(scene,grid,{...roundhouse,...market,...diningCenter,id:'roundhouse-dining',name:'Roundhouse Mountain Market',kind:'dining',y:base+LODGE_TERRACE.floor,h:4.70,doorX:16.2,doorWidth:2.6,frontWindows:true},false);
  buildRoundhouseBalcony(scene,grid,base,market);
  const annex = LODGE_ANNEX;
  const annexFloor = new THREE.Group();
  annexFloor.name = 'Roundhouse annex · walk-in floor';
  annexFloor.position.set(LODGE_FRAME.x, base + annex.floor, LODGE_FRAME.z);
  annexFloor.rotation.y = LODGE_FRAME.yaw;
  scene.add(annexFloor);
  addStoneFloor(annexFloor, { w: annex.width, d: annex.depth, x: annex.x, z: annex.z });
  addWoolCarpet(annexFloor, { w: annex.doorWidth - .28, d: 5.6, x: annex.doorX,
    z: annex.z + annex.depth / 2 - 2.92, palette: lodgeRunner, name: 'Woven entrance runner' });
  decks.push({ floorAt(x,z) {
    const p=transform(LODGE_FRAME,x,z);
    const inside=Math.abs(p.x-annex.x)<=annex.width/2 && Math.abs(p.z-annex.z)<=annex.depth/2;
    const fromDoor=p.z-annex.z-annex.depth/2;
    const landing=fromDoor>=0 && fromDoor<=1.44 && Math.abs(p.x-annex.doorX)<=(annex.doorWidth+.45)/2;
    return inside || landing ? base+annex.floor : null;
  }});
  const rendezvous = { id: 'rendezvous', name: 'Rendezvous Lodge', kind: 'cafe', ...MOUNTAIN.rendezvous, yaw: .45, w: 35, d: 22 };
  const corners = [-17.5, 0, 17.5].flatMap(x => [-11, 0, 11].map(z => world(rendezvous, x, z)));
  const y = Math.max(...corners.map(p => heightAt(p.x, p.z))) + .25;
  buildRoom(scene, grid, { ...rendezvous, y, h: 5.6, doorX: 0, doorWidth: 3.2, rampLength: 15 });
  for (const lot of buildingData.filter(b => ENTERABLE_VILLAGE_IDS.has(b.id))) {
    const barber = lot.id === '295033275';
    buildRoom(scene, grid, mappedVillageRoom(lot, barber ? 'village-barber' : 'village-outfitter',
      barber ? 'Whistler Village Barber' : 'Whistler Village Outfitters', barber ? 'barber' : 'outfitter'));
  }
  return {
    rooms,
    updateDetail(camera, reduced) {
      for (const room of rooms) {
        room.details.visible = !reduced || !camera || (room.x - camera.position.x) ** 2 +
          (room.z - camera.position.z) ** 2 < 250 ** 2;
      }
    },
    stairTreadAt(x,z) {
      const p=transform(LODGE_FRAME,x,z), tread=terraceStairHeight(p.x,p.z,true);
      return tread===null ? null : base+tread;
    },
    serviceAt(x,z,y) {
      const room=this.interiorAt(x,z,y);
      if(!room)return null;
      let closest=null,distance=2.55;
      for(const counter of diningCounters){
        const d=Math.hypot(x-counter.x,z-counter.z);
        if(counter.room===room.id&&d<distance){closest=counter;distance=d;}
      }
      return closest;
    },
    interiorAt(x, z, currentY) {
      return rooms.find(room => { const p = transform(room, x, z); return Math.abs(p.x) < room.w / 2 && Math.abs(p.z) < room.d / 2
        && (currentY===undefined || currentY>=room.y-.55 && currentY<=room.y+room.h); }) || null;
    },
    walkSurfaceAt(x, z, currentY) {
      const candidates=[];
      for (const room of rooms) {
        const p = transform(room, x, z), hd = room.d / 2;
        if (Math.abs(p.x) <= room.w / 2 && Math.abs(p.z) <= hd) candidates.push(room.y);
        if(room.rampLength){
          const t=(p.z-hd)/room.rampLength;
          if(t>=0&&t<=1&&Math.abs(p.x-room.doorX)<=room.doorWidth/2+.4)candidates.push(lerp(room.y,heightAt(x,z)+.025,t));
        }
        if(room.entrySteps){
          const {steps,tread,floor,width}=room.entrySteps, step=Math.floor((p.z-hd)/tread);
          if(step>=0&&step<steps&&Math.abs(p.x)<=width/2-step*.045)candidates.push(room.y-floor*step/steps);
        }
      }
      for(const deck of decks){const y=deck.floorAt(x,z);if(y!==null)candidates.push(y);}
      if(currentY===undefined)return candidates[0]??null;
      // Select a reachable floor instead of snapping a guest in the café onto
      // the dining floor above. Stairs gradually bridge their two elevations.
      const reachable=candidates.filter(y=>y<=currentY+.7).sort((a,b)=>Math.abs(a-currentY)-Math.abs(b-currentY));
      return reachable[0]??null;
    },
  };
}

export function buildBlackcombTerminal(scene, grid, def) {
  const { x, z, yaw, width, depth, centerZ, track, deck, entryZ, entryWidth, rampLength } = blackcombPeakTerminalSite(def);
  const y = heightAt(x, z);
  const sideWall = width / 2, rear = centerZ - depth / 2, front = centerZ + depth / 2;
  const leftDoor = entryZ - entryWidth / 2, rightDoor = entryZ + entryWidth / 2;
  const room = { x, z, y, yaw, h: 10, id: 'blackcomb-terminal' };
  const group = new THREE.Group(); group.name = 'PEAK 2 PEAK · Blackcomb mapped terminal';
  group.position.set(x, y, z); group.rotation.y = yaw; scene.add(group);
  group.userData.station = { id: def.id, base: false, datum: y, deck: y + deck };
  const parts = [], steel = [], glass = [];
  // Both ropes terminate inside the roofed drive hall, rather than in open air
  // beside an offset generic building. The mapped cable endpoint is local 0,0.
  const footing = Math.min(...[-sideWall, 0, sideWall].flatMap(sx => [rear, centerZ, front].map(sz => {
    const p = world(room, sx, sz);
    return heightAt(p.x, p.z) - y;
  }))) - .6;
  // The cabin hangs below the rail. Its boarding level belongs to the hall's
  // raised deck, clear of the exterior snow at the survey datum.
  parts.push(box(width, deck - footing, depth, '#858e90', [0, (footing + deck) / 2, centerZ]));
  const foundation = world(room, 0, centerZ);
  grid.addBox(foundation.x, foundation.z, width / 2, depth / 2, -yaw, 'station',
    { room: room.id, minY: y + footing, maxY: y + deck - .24 });
  parts.push(box(23.3, .45, 38, '#e7eeef', [0, 11.5, -5]));
  parts.push(box(22.2, 1.35, 36, '#596770', [0, 10.6, -5]));
  parts.push(box(22, 9.6, .36, '#646c70', [0, 4.8, -23]));
  for (const side of [-1, 1]) {
    const sx = side * sideWall;
    const spans = side > 0 ? [[rear, leftDoor], [rightDoor, front]] : [[rear, front]];
    for (const [from, to] of spans) {
      const mid = (from + to) / 2, length = to - from;
      parts.push(box(.35, 1.15, length, '#7a8386', [sx, .3, mid]));
      glass.push(box(.055, 8.5, length, '#668c9e', [sx, 5.3, mid]));
      collider(grid, room, sx, mid, .4, length, 'station');
      const count = Math.ceil(length / 4);
      for (let i = 0; i <= count; i++) steel.push(box(.2, 10, .22, '#48575e', [sx, 4.8, lerp(from, to, i / count)]));
    }
  }
  const header = deck + 2.7;
  glass.push(box(.055, 9.55 - header, entryWidth, '#668c9e', [sideWall, (header + 9.55) / 2, entryZ]));
  steel.push(box(.29, .24, entryWidth + .24, '#667881', [sideWall, header, entryZ]));
  label(group, 'RENDEZVOUS LODGE', 'BOARDING · EXIT', sideWall + .16, header + .43, entryZ, entryWidth, Math.PI / 2);

  const farEdge = sideWall + rampLength;
  const approach = world(room, farEdge, entryZ);
  const lastTread = heightAt(approach.x, approach.z) - y + .06;
  const steps = Math.max(1, Math.ceil(Math.abs(deck - lastTread) / .185));
  const treadSize = rampLength / steps;
  const treadAt = index => lerp(deck, lastTread, (index + 1) / steps);
  for (let step = 0; step < steps; step++) {
    const top = treadAt(step), base = Math.min(footing, lastTread - .32);
    const center = sideWall + (step + .5) * treadSize;
    parts.push(box(treadSize, top - base, entryWidth, '#828c8d', [center, (base + top) / 2, entryZ]));
    steel.push(box(.04, .017, entryWidth - .12, '#b5baa4', [center + treadSize / 2 - .04, top + .0085, entryZ]));
  }
  for (const localZ of [leftDoor, rightDoor]) {
    steel.push(beam([sideWall, deck + 1, localZ], [farEdge, lastTread + 1, localZ], .068, .07, '#6d7f84'));
    for (let step = 0; step < steps; step += Math.max(1, Math.round(1.4 / treadSize))) {
      steel.push(box(.075, 1, .075, '#70828a', [sideWall + step * treadSize, treadAt(step) + .5, localZ]));
    }
    collider(grid, room, (sideWall + farEdge) / 2, localZ, rampLength, .09, 'station', Math.max(deck, lastTread) + 1);
  }
  group.userData.walkSurfaceAt = (px, pz, currentY) => {
    const point = transform(room, px, pz);
    let localHeight;
    if (Math.abs(point.x) <= sideWall && point.z >= rear && point.z <= front) localHeight = deck;
    else if (point.x > sideWall && point.x <= farEdge && Math.abs(point.z - entryZ) < entryWidth / 2) {
      localHeight = treadAt(Math.min(steps - 1, Math.floor((point.x - sideWall) / treadSize)));
    }
    if (localHeight === undefined || currentY !== undefined && y + localHeight > currentY + .68) return null;
    return y + localHeight;
  };
  const interior = { id: 'peak-to-peak-blackcomb', kind: 'lift-terminal' };
  group.userData.interiorAt = (px, pz, currentY) => {
    if (currentY < y + deck - .28 || currentY > y + 9.55) return null;
    const point = transform(room, px, pz);
    return Math.abs(point.x) <= sideWall && point.z >= rear && point.z <= front ? interior : null;
  };
  collider(grid, room, 0, -23, 22, .4, 'station');
  // Large cable aperture at the valley face, with rollers aligned to both lines.
  for (const sx of [-9.7, 9.7]) parts.push(box(2.6, 9.5, .5, '#5b686d', [sx, 4.75, 13]));
  steel.push(box(17, .4, .75, '#adb9bc', [0, 8.4, 13]));
  for (const sx of [-3.5, 3.5]) {
    for (let localZ = -8; localZ < 11; localZ += 1.6) {
      const wheel = new THREE.CylinderGeometry(.22, .22, .14, 12); wheel.rotateZ(Math.PI / 2);
      steel.push({ geo: wheel, color: '#37454b', pos: [sx, track - .1, localZ], rot: [0, 0, 0], scale: [1, 1, 1] });
    }
    steel.push(box(.15, .2, 23, '#71818b', [sx, track - .05, 0]));
  }
  const peakBadge=makePeak2PeakBadge(8.8,1.55);peakBadge.position.set(0,9.7,13.32);group.add(peakBadge);
  label(group, 'RENDEZVOUS LODGE →', 'EXIT TO BLACKCOMB', 5.4, 2.4, -23.23, 5.2, Math.PI);
  mesh(group, parts); mesh(group, steel);
  mesh(group, glass, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .3, metalness: .2, transparent: true, opacity: .46, depthWrite: false }));
  return group;
}
