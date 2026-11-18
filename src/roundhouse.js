import { addPassGate } from './pass-gates.js';
import * as THREE from 'three';
import { LIFTS, PEAK_TO_PEAK, VILLAGE_GONDOLA_UPPER } from './worlddata.js';
import { heightAt } from './terrain.js';
import { beam, box, mergeParts, mergedMesh, part } from './scenery.js';
import { surfaceMaterial } from './materials.js';
import { makeCanvas, canvasTexture, mulberry32 } from './util.js';
import { slowBanner } from './alpine-landmarks.js';
import { timberMesh } from './plaza-materials.js';
import { makePeak2PeakBadge } from './lift-stations.js';
import { createRoofSnow, createIcicles } from './roof-weather.js';
import { LODGE_FRAME, LODGE_CAFE, LODGE_TERRACE, ROUNDHOUSE_OLYMPIC_SITE } from './roundhouse-site.js';
import { ROUNDHOUSE_STONE_SITE } from './inukshuk.js';

const snow = '#ebf0f4';
const frame = '#677987';
const slate = '#596774';
const concrete = '#a5a7a7';
const wood = '#655042';
const timber = '#503425';

function site(scene, name, x, z, yaw = 0, y = heightAt(x, z)) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, y, z);
  group.rotation.y = yaw;
  scene.add(group);
  group.updateMatrixWorld(true);
  return group;
}

function layer(parent, parts, options = {}, surface) {
  if (!parts.length) return;
  let mesh;
  if (surface === 'timber') {
    mesh = timberMesh(parts);
  } else if (surface) {
    mesh = new THREE.Mesh(mergeParts(parts), surfaceMaterial(surface, { vertexColors: true, ...options }));
    mesh.castShadow = mesh.receiveShadow = true;
  } else {
    mesh = mergedMesh(parts, options);
  }
  parent.add(mesh);
}

function panel(parts, a, b, c, d, color) {
  const geometry = new THREE.BufferGeometry();
  const vertices = d === c ? [...a,...b,...c] : [...a,...b,...c,...a,...c,...d];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  parts.push(part(geometry, color));
}

function sign(parent, title, subtitle, width, height, position, color = '#293947', options = {}) {
  if (options.peakBadge) {
    const mesh = makePeak2PeakBadge(width, height); mesh.position.set(...position);
    mesh.rotation.y = options.yaw ?? 0; parent.add(mesh); return mesh;
  }
  const { canvas, ctx } = makeCanvas(1024, 256);
  if (options.badge) {
    ctx.fillStyle = '#c3c5c4';
    ctx.beginPath();
    ctx.moveTo(8, 128); ctx.lineTo(102, 18); ctx.lineTo(922, 18); ctx.lineTo(1016, 128);
    ctx.lineTo(922, 238); ctx.lineTo(102, 238); ctx.closePath(); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(22, 128); ctx.lineTo(109, 31); ctx.lineTo(915, 31); ctx.lineTo(1002, 128);
    ctx.lineTo(915, 225); ctx.lineTo(109, 225); ctx.closePath(); ctx.fill();
    if (options.peakBadge) {
      // The photo's left PEAK is red; the 2 and right PEAK sit on black.
      ctx.save(); ctx.clip();
      ctx.fillStyle='#151b20'; ctx.fillRect(468,0,556,256);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#c3c5c4';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 1008, 240);
  }
  ctx.fillStyle = '#f3f3ee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = options.badge ? 'bold 119px Arial' : 'bold 100px Barlow, Arial';
  ctx.fillText(title, 512, subtitle ? 113 : 132, 865);
  if (subtitle) {
    ctx.fillStyle = '#c7d8e0';
    ctx.font = '600 39px Barlow, Arial';
    ctx.fillText(subtitle, 512, 195, 890);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), transparent: !!options.badge,
      alphaTest: .4, roughness: .67, emissive: 0xffffff, emissiveIntensity: .045 }));
  mesh.position.set(...position);
  mesh.rotation.y = options.yaw ?? 0;
  parent.add(mesh);
  return mesh;
}

function collide(grid, group, x, z, width, length, yaw = 0, maxY = Infinity) {
  const p = group.localToWorld(new THREE.Vector3(x, 0, z));
  grid.addBox(p.x, p.z, width / 2, length / 2, -group.rotation.y - yaw, 'lodge', { maxY: group.position.y + maxY });
}

function groundFoot(group, x, z, width, length) {
  return Math.min(...[-width / 2, 0, width / 2].flatMap(dx => [-length / 2, 0, length / 2].map(dz => {
    const p = group.localToWorld(new THREE.Vector3(x + dx, 0, z + dz));
    return heightAt(p.x, p.z) - group.position.y;
  }))) - .34;
}

function pier(parts, group, x, z, width, length, top, color) {
  const base = Math.min(top - .24, groundFoot(group, x, z, width, length));
  parts.push(box(width, top - base, length, color, [x, (top + base) / 2, z]));
}

function roundhouseBadge(parent, position) {
  const {canvas,ctx}=makeCanvas(512,512);
  ctx.translate(256,256);
  ctx.fillStyle='#7f3437';ctx.strokeStyle='#e0d9c7';ctx.lineWidth=12;
  ctx.beginPath();ctx.arc(0,0,224,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,192,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#e9ddc5';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='bold 51px Arial';ctx.fillText('ROUNDHOUSE',0,-46,365);
  ctx.font='bold 45px Arial';ctx.fillText('LODGE',0,110);
  ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(-116,62);ctx.lineTo(-39,-5);
  ctx.lineTo(5,39);ctx.lineTo(55,-20);ctx.lineTo(121,62);ctx.stroke();
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.18,1.18),
    new THREE.MeshStandardMaterial({map:canvasTexture(canvas),transparent:true,alphaTest:.4,roughness:.78}));
  mesh.position.set(...position);parent.add(mesh);
}

const masonryTones = ['#827463','#968b79','#817b6a','#a49986','#8c806b','#968876','#948a79'];
function splitStone(parts, left, right, bottom, top, face, rng) {
  for(let y=bottom;y<top-.035;){
    const height=Math.min(top-y,.089+rng()*.082);
    for(let x=left;x<right-.026;){
      const width=Math.min(right-x,.24+rng()*.57),proud=.018+rng()*.041;
      const color=masonryTones[Math.floor(rng()*masonryTones.length)];
      parts.push(box(width-.018,height-.014,proud+.018,color,[x+width/2,y+height/2,face+proud/2],
        [(rng()-.5)*.08,0,(rng()-.5)*.022]));
      x+=width;
    }
    y+=height;
  }
}

function entranceArch(group, grid, masonry, woodwork, roof) {
  const { x, front, floor, width, steps, tread } = LODGE_CAFE;
  const z = front + .59, stone = '#8d8980', spring = 2.36, crown = 3.11, half = 3.35;
  const bottom = Math.min(-.28, groundFoot(group, x, z, width + 1.8, 1.3));
  const archHeight = px => spring + (crown - spring) * Math.sqrt(Math.max(0, 1 - (px / half) ** 2));
  for (const side of [-1, 1]) {
    masonry.push(box(1.23, 3.83 - bottom, 1.34, stone, [x + side * 3.96, (3.83 + bottom) / 2, z]));
    collide(grid, group, x + side * 3.96, z, 1.24, 1.35, 0, 3.83);
    woodwork.push(box(.11, 1.10, .12, timber, [x + side * 3.13, 1.18, front + .86]));
    const sideWallWidth = 2.6;
    const sideX = x + side * 5.87;
    pier(masonry, group, sideX, z - .32, sideWallWidth, 1.08, .83, stone);
  }
  // Each tapered stone has an actual curved opening below it.
  const random=mulberry32(6630);
  const joints = [];
  for (let i = 0; i <= 24; i++) joints.push(-half * Math.cos(Math.PI * i / 24));
  for (let i = 0; i < 24; i++) {
    const a = joints[i], b = joints[i + 1], left = x + a, right = x + b;
    const yA = archHeight(a), yB = archHeight(b), color = masonryTones[(random()*masonryTones.length)|0];
    panel(masonry,[left,yA,z+.68],[right,yB,z+.68],[right,3.828,z+.68],[left,3.828,z+.68],color);
    panel(masonry,[right,yB,z-.65],[left,yA,z-.65],[left,3.828,z-.65],[right,3.828,z-.65],color);
    panel(masonry,[left,yA,z-.65],[right,yB,z-.65],[right,yB,z+.68],[left,yA,z+.68],color);
  }
  for (const side of [-1, 1]) {
    const pillarX=x+side*3.96;
    splitStone(masonry,pillarX-.615,pillarX+.615,0,3.77,z+.674,random);
  }
  // Shallow front steps fit inside the stone returns and meet the plaza grade.
  for (let i = 0; i < steps; i++) {
    const y = floor * (1 - i / steps), at = front + (i + .5) * tread;
    pier(masonry, group, x, at, width - i * .09, tread + .018, y, '#8e8980');
    masonry.push(box(width - i * .09 + .035, .065, tread + .026, '#a8a398', [x, y - .032, at]));
  }
  woodwork.push(box(width + 1.53,.19,1.45,'#865b3c',[x,3.84,z]));
  woodwork.push(box(width + 1.65,.14,1.54,'#50372a',[x,3.99,z]));
  sign(group,'ROUNDHOUSE LODGE','',3.45,.36,[x,3.51,z+.691],'#51392a');
  roof.push(box(width-.5,.034,.08,'#adaca2',[x,floor+.014,front+.078]));
}

function carvedBears(group, grid, masonry, woodwork) {
  const figure = new THREE.IcosahedronGeometry(1,2);
  for (const side of [-1,1]) {
    const x=LODGE_CAFE.x+side*4.91,z=LODGE_CAFE.front+1.18;
    const p=group.localToWorld(new THREE.Vector3(x,0,z)), y=heightAt(p.x,p.z)-group.position.y+.25;
    pier(masonry,group,x,z,1.13,1.06,y,'#8a8781');
    collide(grid,group,x,z,1.13,1.06,0,y+1.45);
    const grain='#664a35', dark='#513624';
    woodwork.push(part(figure,grain,[x,y+.54,z],[0,0,-side*.08],[.36,.54,.30]));
    woodwork.push(part(figure,grain,[x+side*.10,y+1.05,z+.034],[0,side*.14,-side*.11],[.272,.30,.245]));
    woodwork.push(part(figure,'#73543d',[x+side*.09,y+1.005,z+.213],[0,side*.12,0],[.185,.146,.156]));
    woodwork.push(part(figure,dark,[x+side*.089,y+1.042,z+.321],[0,0,0],[.079,.055,.050]));
    for(const s of [-1,1]){
      woodwork.push(part(figure,grain,[x+side*.12+s*.189,y+1.253,z-.015],[0,0,-s*.20],[.104,.11,.083]));
      woodwork.push(part(figure,dark,[x+s*.227,y+.166,z+.22],[0,s*.12,0],[.185,.139,.239]));
      woodwork.push(part(figure,grain,[x+s*.27,y+.49,z+.17],[-.34,0,-s*.16],[.112,.265,.119]));
    }
  }
}

function lodge(scene, grid) {
  const locus = LODGE_FRAME;
  const group = site(scene, 'Roundhouse Lodge', locus.x, locus.z, locus.yaw,
    heightAt(locus.datumX, locus.datumZ) - .15);
  const block = [], woodwork = [], roof = [], glazing = [], masonry = [];
  const mainFront = 25.5;
  const random = mulberry32(6108);

  // Ground-floor café occupies x[-14,2.4], z[10,27.35]. Keep the
  // surrounding foundation, with an actual hollow room behind the open door.
  for (const [x,z,w,d] of [[-18.125,5,8.25,40],[14.825,5,24.85,40],[-5.8,-2.5,16.4,25]]) {
    pier(masonry, group, x, z, w, d, 3.38, '#8b8881');
  }
  // Hollow upper dining hall. The exterior used to be one solid volume,
  // which filled the room and made the glass read as painted wall panels.
  block.push(box(48, 5.75, .36, '#90877d', [2.5, 5.85, -14.32]));
  for(const x of [-21.32,26.32]) block.push(box(.36,5.75,39,'#90877d',[x,5.85,5]));
  block.push(box(47.6,.24,38.5,'#7c6b54',[2.5,3.57,5]));
  masonry.push(box(15.6, 4.1, 39.15, '#9b9991', [-21.8, .45, -1.1]));
  masonry.push(box(4.4, 4.1, 30.675, '#9b9991', [-11.8, .45, -5.3375]));

  // Timber-framed entrance, deep gable and matching balcony from the photos.
  const atrium = LODGE_CAFE.x, span = 17.25, gable = 12.55, eave = 9.65, depth = 12.7;
  const front = LODGE_CAFE.front, back = front - depth, portalZ = front + .59;
  panel(woodwork, [atrium-span/2,eave,front], [atrium+span/2,eave,front],
    [atrium,gable,front], [atrium,gable,front], '#64473a');
  woodwork.push(beam([atrium-span/2-.8,eave,front+.67], [atrium,gable+.25,front+.67], .33, .42, timber));
  woodwork.push(beam([atrium,gable+.25,front+.67], [atrium+span/2+.8,eave,front+.67], .33, .42, timber));
  for (const side of [-1, 1]) {
    panel(roof, [atrium,gable,back-1], [atrium + side*(span/2+1.1),eave,back-1],
      [atrium + side*(span/2+1.1),eave,front+1.2], [atrium,gable,front+1.2], '#49382d');
    const ridgeX=atrium+side*.06, lipX=atrium+side*(span/2+1.1);
    const eaveFront=[lipX,eave,front+1.2],eaveBack=[lipX,eave,back-1];
    group.add(createRoofSnow([[ridgeX,gable,front+1.2],[ridgeX,gable,back-1],eaveBack,eaveFront],
      {seed:136+side,depth:.32,overhang:.17}),createIcicles(eaveBack,eaveFront,{seed:809+side,length:.49}));
    const x = atrium + side*4.00;
    woodwork.push(box(.54, 5.95, .56, timber, [x, 6.73, portalZ]));
    woodwork.push(beam([x,6.93,portalZ], [atrium+side*1.6,10.40,portalZ], .34,.48, timber));
    woodwork.push(beam([x,8.08,portalZ], [atrium+side*6.9,10.03,portalZ], .34,.45, timber));
  }
  woodwork.push(box(16.3, .36, .56, timber, [atrium,9.50,portalZ]));
  woodwork.push(beam([atrium-4.05,7.95,portalZ], [atrium,10.55,portalZ], .20,.27, '#796352'));
  woodwork.push(beam([atrium+4.05,7.95,portalZ], [atrium,10.55,portalZ], .20,.27, '#796352'));
  entranceArch(group,grid,masonry,woodwork,roof);
  carvedBears(group,grid,masonry,woodwork);

  const deckX = 5, deckZ = 27.35;
  woodwork.push(box(51, .49, 5.15, wood, [deckX,3.6,deckZ]));
  for (const x of [-19.6, -13.5, 2.5, 8.6, 14.8, 20.9, 29.3]) {
    pier(masonry, group, x, 28.8, .73, .86, 3.38, '#8a8881');
    collide(grid, group, x, 28.8, .75, .88, 0, 3.38);
    splitStone(masonry,x-.365,x+.365,0,3.36,29.233,random);
  }
  for (const y of [3.77, 4.76]) {
    woodwork.push(box(44.2,.15,.12,timber,[1.6,y,deckZ+2.36]));
    woodwork.push(box(3.2,.15,.12,timber,[28.9,y,deckZ+2.36]));
    for(const x of [-20.45,30.45])woodwork.push(box(.12,.15,4.88,timber,[x,y,deckZ-.06]));
  }
  for (let i = 0; i <= 101; i++) {
    const x = deckX - 25.2 + .5*i;
    if(x>23.7 && x<27.3)continue; // open stair landing
    woodwork.push(box(i%7===0?.16:.065,.96,.10,timber,[x,4.24,deckZ+2.36]));
  }
  const { stairX, stairTop, stairBottom, stairWidth, floor, steps } = LODGE_TERRACE;
  const tread = (stairBottom - stairTop) / steps;
  for (let i = 0; i < steps; i++) {
    const y = floor / steps * (i+1), z = stairBottom - tread * (i+.5);
    pier(masonry, group, stairX, z, stairWidth, tread+.018, y, '#999b9b');
    roof.push(box(stairWidth-.085,.031,tread-.05,snow,[stairX,y+.011,z]));
  }
  woodwork.push(box(stairWidth,.24,1.28,wood,[stairX,floor-.12,30.02]));
  for (const x of [stairX-1.79,stairX+1.79]) {
    woodwork.push(beam([x,1.12,stairBottom],[x,floor+.99,stairTop],.115,.17,wood));
    woodwork.push(beam([x,floor+.99,stairTop],[x,floor+.99,29.64],.115,.17,wood));
    for (let i = 0; i <= 5; i++) {
      const t = i/5, z = stairBottom - (stairBottom - stairTop) * t;
      woodwork.push(box(.11,1.07,.11,wood,[x,.52+floor*t,z]));
      collide(grid, group, x, z, .14, .14, 0, 1.22 + floor*t);
    }
  }
  function lowRoof(x,y,z,w,d,pitch,seed) {
    roof.push(box(w,.15,d,'#586168',[x,y,z],[-pitch,0,0]));
    const edge=(s,t)=>[x+s*w/2,y+.08+t*d/2*Math.sin(pitch),z+t*d/2*Math.cos(pitch)];
    group.add(createRoofSnow([edge(-1,-1),edge(1,-1),edge(1,1),edge(-1,1)],{seed,depth:.31}),
      createIcicles(edge(-1,1),edge(1,1),{seed,length:.36,spacing:.62}));
  }
  lowRoof(14,8.88,7,27,29,.045,792);
  lowRoof(1,8.8,-4.1,52,18.5,0,832);
  lowRoof(-17.8,8.84,17.5,7.6,19.5,.03,883);

  const rear = { x: 7, z: -15.1, w: 39.25, d: 33.2, eave: 10.90, ridge: 14.04 };
  const rearFloor=groundFoot(group,rear.x,rear.z,rear.w,rear.d);
  const rearY=(rear.eave+rearFloor)/2;
  block.push(box(rear.w,rear.eave-rearFloor,rear.d,'#827364',[rear.x,rearY,rear.z]));
  collide(grid,group,rear.x,rear.z,rear.w,rear.d,0,rear.eave);
  for(const side of [-1,1]){
    const z=rear.z+side*(rear.d/2+.62),l=rear.x-rear.w/2-.65,r=rear.x+rear.w/2+.65;
    const face=[[l,rear.ridge,rear.z],[r,rear.ridge,rear.z],[r,rear.eave,z],[l,rear.eave,z]];
    panel(roof,...face,'#51473b');
    group.add(createRoofSnow(face,{depth:.26,seed:151+side,overhang:.08}));
    woodwork.push(beam([l,rear.eave,z],[r,rear.eave,z],.18,.255,'#5e4e41'));
  }
  for(const side of [-1,1]){
    const x=rear.x+side*rear.w/2;
    panel(roof,[x,rear.eave,rear.z-rear.d/2],[x,rear.eave,rear.z+rear.d/2],
      [x,rear.ridge,rear.z],[x,rear.ridge,rear.z],'#675447');
  }

  // Glazed annex on the left, vertical mullions on the lodge's two floors.
  const annexX=-21.6, annexZ=11;
  const annexFeet = [-6.55,6.55].flatMap(dx => [-12.4,12.4].map(dz => {
    const at = group.localToWorld(new THREE.Vector3(annexX + dx, 0, annexZ + dz));
    return heightAt(at.x, at.z) - group.position.y;
  }));
  const annexBase = Math.min(-.8, ...annexFeet) - .55;
  masonry.push(box(12.95, -.30-annexBase, 24.55, '#747875',
    [annexX, (annexBase-.30)/2, annexZ]));
  block.push(box(13.1,7.61,24.8,'#475968',[annexX,3.42,annexZ]));
  lowRoof(annexX,7.24,annexZ,13.6,25.3,0,891);
  const annexGlass=[];
  const shellTones=['#415968','#517082','#476673','#566e77','#476475'];
  for (let i=0;i<9;i++) {
    const x=annexX-5.8+i*1.46;
    for(const h of [2.01,5.13]){
      annexGlass.push(box(1.362,3.037,.054,shellTones[Math.floor(random()*shellTones.length)],[x,h,annexZ+12.439]));
    }
    block.push(box(.135,6.6,.156,'#495a62',[x+.72,3.57,annexZ+12.484]));
    block.push(box(.064,6.57,.085,'#aeb9bb',[x+.72,3.57,annexZ+12.589]));
  }
  for (const y of [.43,3.60,6.76]) block.push(box(13,.115,.214,'#88979e',[annexX,y,annexZ+12.49]));
  for (let i=0;i<17;i++) {
    const z = annexZ-12+i*1.49;
    for(const h of [2.01,5.13]){
      annexGlass.push(box(.052,3.039,1.397,shellTones[Math.floor(random()*shellTones.length)],[annexX-6.579,h,z]));
    }
    block.push(box(.159,6.56,.118,'#4c5b63',[annexX-6.621,3.57,z+.71]));
    block.push(box(.075,6.51,.059,'#a4aeb1',[annexX-6.733,3.57,z+.71]));
  }
  for (const y of [.41,3.65,6.79,7.62]){
    block.push(box(.115,.105,25.02,'#b5c6ca',[annexX-6.61,y,annexZ]));
    if(y>7)block.push(box(13.2,.105,.12,'#b5c6ca',[annexX,y,annexZ+12.48]));
  }
  for (let col=0;col<18;col++) {
    const x=-19.6+col*2.74;
    if(Math.abs(x-atrium)<4.85||x>26.35)continue;
    const y=1.38,h=2.4,z=(Math.abs(x-atrium)<8?front-.13:mainFront-.93)+.09;
    for(const side of [-1,1]){
      block.push(box(.10,h+.16,.13,'#454642',[x+side*1.175,y,z]));
      block.push(box(2.45,.10,.13,'#454642',[x,y+side*(h/2+.03),z]));
    }
    const color = ['#5b7988','#637983','#506d7d','#557587'][Math.floor(random()*4)];
    glazing.push(box(2.24,h,.064,color,[x,y,z+.085]));
    block.push(box(.065,h,.13,'#adb0a8',[x,y,z+.09]));
  }
  roundhouseBadge(group,[atrium,11.05,front+.74]);
  layer(group,masonry,{},'stone');
  layer(group,block);
  layer(group,woodwork,{},'timber');
  layer(group,roof,{roughness:.85,side:THREE.DoubleSide});
  layer(group,glazing,{roughness:.29,metalness:.14,transparent:true,opacity:.44,depthWrite:false},'glass');
  layer(group,annexGlass,{roughness:.29,metalness:.18,transparent:true,opacity:.68,depthWrite:false},'glass');
  collide(grid,group,-18.125,5,8.25,40,0,3.3);
  collide(grid,group,14.825,5,24.85,40,0,3.3);
  collide(grid,group,-5.8,-2.5,16.4,25,0,3.3);
  collide(grid,group,annexX,annexZ,13,24.8);
  return group;
}

function controlBooth(parent, grid, x, z, floor, yaw = 0) {
  const cab = new THREE.Group(), structure = [], glazing = [];
  const w = 2.58, d = 2.23, h = 2.32;
  cab.name = 'Lift operator cabin'; cab.position.set(x,floor,z); cab.rotation.y=yaw; parent.add(cab);
  cab.updateWorldMatrix(true,false);
  structure.push(box(w,.13,d,'#596167',[0,.065,0]),box(w+.25,.17,d+.25,'#464f53',[0,h+.08,0]));
  structure.push(box(w,h,.12,'#566671',[0,h*.5,-d/2]));
  for (const side of [-1,1]) {
    structure.push(box(w,.79,.11,'#889399',[0,.516,d/2]));
    structure.push(box(.11,.79,d,'#889399',[side*w/2,.516,0]));
    glazing.push(box(.045,1.27,d-.17,'#77939b',[side*w/2,1.576,0]));
    for (const end of [-1,1]) structure.push(box(.113,h,.112,'#4b626b',[side*w/2,h*.5,end*d/2]));
  }
  glazing.push(box(w-.14,1.27,.043,'#92a8a8',[0,1.576,d/2]));
  structure.push(box(1.55,.083,.54,'#454b4e',[.15,1.0,.6]));
  structure.push(box(.49,.32,.077,'#2e3c43',[.38,1.26,.59],[-.11,0,0]));
  structure.push(box(.41,.245,.019,'#a0bc9b',[.38,1.26,.623],[-.11,0,0]));
  for (let i=0;i<4;i++) structure.push(box(.056,.049,.074,i===0?'#d45944':'#61a38c',[-.39+i*.129,1.061,.71]));
  sign(cab,'LIFT OPERATIONS','',1.12,.235,[0,2.12,d/2+.03],'#465760');
  layer(cab,structure,{roughness:.62,metalness:.14});
  layer(cab,glazing,{transparent:true,opacity:.39,depthWrite:false,roughness:.32},'glass');
  collide(grid,parent,x,z,w,d,yaw,floor+h);
  const world=cab.localToWorld(new THREE.Vector3(.01,.13,.27));
  return { x:world.x,y:world.y,z:world.z,heading:parent.rotation.y+yaw,
    activity:'operator',lodge:'lift-operations' };
}

function scannerGate(parent, structure, x, y, z) {
  structure.push(box(.31,.095,.32,'#738187',[x,y+.048,z]));
  structure.push(box(.145,.96,.16,'#565f63',[x,y+.55,z]));
  structure.push(box(.25,.33,.26,'#34434a',[x,y+1.18,z]));
  addPassGate(parent,x,y,z,-.69);
}

function peakTerminal(scene, grid, lift) {
  const [[ax,az],[bx,bz]] = lift.points;
  const yaw = Math.atan2(ax-bx,az-bz);
  const terminal = site(scene, 'PEAK 2 PEAK · Whistler terminal', 539.6, 4823.7, yaw, heightAt(ax, az) - .75);
  const span = 27.5, depth = 45, w=span/2, d=depth/2;
  const platform=[], roof=[], structure=[], glass=[];
  const rng=mulberry32(2803);
  const upper = (x) => 9.7 - x * .115;

  platform.push(box(span + .32,.64,depth + .4,concrete,[0,-.22,0]));
  platform.push(box(span,3.3,depth-1.65,'#74797a',[0,1.75,-.86]));
  // Set the covered lower entrance behind its own fascia. The projection
  // ends at the loading aperture, clear of the neighbouring lodge stairs.
  platform.push(box(10.63,.31,5.5,'#a8acae',[8.51,3.6,d+.58]));
  roof.push(box(10.71,.17,5.6,snow,[8.51,3.83,d+.58]));
  for (const x of [-w+1.4, -6.75, 0, 6.75, w-1.4]) {
    for (const z of [-d+1.4, -12, 0, 12, d-1.4]) {
      pier(platform, terminal, x, z, 1.22, 1.33, -.14, '#888d8d');
      collide(grid, terminal, x, z, 1.22, 1.33, 0, .10);
    }
  }
  // The long side walls sit on stepped retaining bands. The exposed piers
  // continue down to grade below the valley end of the hall.
  for (const x of [-w+.22, w-.22]) {
    for (let z=-d+2.25; z<d; z+=4.5) {
      pier(platform, terminal, x, z, .44, 4.53, .20, '#888d8d');
    }
  }

  // Angled blue upper curtain wall over the sheltered walkway.
  for (const xSide of [-1,1]) {
    const x = w*xSide;
    const tones = ['#477181','#4d7486','#497889','#507487'];
    const dz = depth/33;
    for (let i=0;i<33;i++) {
      const z0 = -d+i*dz, z1=z0+dz;
      const outward=xSide*.095;
      const y=upper(x);
      panel(glass,[x+outward,3.43,z0],[x+outward,3.43,z1],[x+outward,y,z1],[x+outward,y,z0],
        tones[Math.floor(rng()*tones.length)]);
      structure.push(box(.078,y-3.45,.09,'#70929f',[x+outward,(y+3.45)/2,z0]));
    }
    for (const y of [3.43,4.21,5.51,7.11,8.17].filter(y=>y<upper(x))) {
      structure.push(box(.13,.071,depth+.13,frame,[x+xSide*.14,y,0]));
    }
  }
  for (let i=0;i<28;i++) {
    const x0=-w+span*i/28,x1=-w+span*(i+1)/28;
    if(x1>-13.3 && x0<3.9)continue; // return track and passenger entrance
    const color=['#426777','#456d81','#456a7c'][Math.floor(rng()*3)];
    panel(glass,[x0,3.66,d+.09],[x1,3.66,d+.09],[x1,upper(x1),d+.09],[x0,upper(x0),d+.09],color);
    structure.push(box(.065,upper(x0)-3.68,.10,'#75949f',[x0,(upper(x0)+3.68)/2,d+.143]));
  }
  for (const y of [4.31,5.52,6.82,8.01]) {
    structure.push(box(.45,.085,.12,'#9db0b6',[-13.525,y,d+.145]));
    structure.push(box(9.85,.085,.12,'#9db0b6',[8.825,y,d+.145]));
  }
  // The front curtain wall ends at a corrugated service bay in the photo.
  structure.push(box(6.4,4.17,.18,'#5d6668',[10.43,6.03,d+.23]));
  structure.push(box(.45,.71,.24,'#bdc4c5',[-13.525,3.93,d+.27]));
  structure.push(box(9.85,.71,.24,'#bdc4c5',[8.825,3.93,d+.27]));
  for(let i=0;i<47;i++) {
    const x=7.28+i*.135;
    structure.push(box(.018,upper(x)-3.94,.039,'#758081',[x,(upper(x)+3.94)/2,d+.34]));
  }
  for(let i=0;i<194;i++) {
    const x=-w+i*span/193;
    if(x>-13.3 && x<3.9)continue;
    structure.push(box(.014,.67,.034,'#919da1',[x,3.93,d+.405]));
  }
  sign(terminal,'THE DOUG FORSETH','CHAIR PLAZA',3.35,.71,[10.35,7.04,d+.39],'#586164');
  for(const side of [-1,1]) {
    const x=side*w;
    structure.push(box(.21,upper(x)+.22,.19,'#aab6bd',[x,upper(x)/2,d+.17]));
    structure.push(beam([x,upper(x)+.09,-d-.6],[x,upper(x)+.09,d+.39],.22,.23,'#c6ccd0'));
  }
  const topCorners=[[-w-.32,upper(-w)+.19,-d-.58],[w+.32,upper(w)+.19,-d-.58],
    [w+.32,upper(w)+.19,d+.58],[-w-.32,upper(-w)+.19,d+.58]];
  panel(roof,...topCorners,'#606e76');
  terminal.add(createRoofSnow(topCorners,{depth:.24,seed:474,overhang:.12}),
    createIcicles(topCorners[1],topCorners[2],{seed:95,length:.48}));
  for(const z of [-d-.52,d+.55]) {
    structure.push(beam([-w-.37,upper(-w)+.08,z],[w+.36,upper(w)+.08,z],.22,.3,'#bac3c8'));
  }
  for(let i=0;i<3;i++){
    const x=4.35+i*3.02;
    const base = groundFoot(terminal, x, d+2.84, .32, .41);
    structure.push(box(.32,3.58-base,.41,'#858b8c',[x,(3.58+base)/2,d+2.84]));
    pier(platform, terminal, x+1.26, d-.48, 2.54, .34, .24, '#9b9d99');
    glass.push(box(2.35,2.48,.094,i%2?'#516c7d':'#355667',[x+1.26,1.46,d-.46]));
    structure.push(box(.075,2.58,.14,'#84939a',[x+1.26,1.46,d-.40]));
    collide(grid,terminal,x,d+2.84,.34,.44,0,3.6);
  }
  for(let i=0;i<6;i++){
    const z = -d + 3.1*i + 1.2;
    structure.push(box(span-.75,.28,.32,frame,[0,8.15,z]));
  }
  for(const x of [-11.05,-4.05]){
    structure.push(box(.15,.14,depth,'#667984',[x,7.36,0]));
    for(let z=-d+.8;z<d;z+=1.35){
      const wheel=new THREE.CylinderGeometry(.19,.19,.15,12);wheel.rotateZ(Math.PI/2);
      structure.push(part(wheel,'#2c3b43',[x,7.37,z]));
    }
  }
  // Passenger island sits a handspan below the cabin threshold. The public
  // stair enters on the right of the two guide rails.
  const deck=3.77, stairX=1.3, stairW=3.12, stepCount=20, stepDepth=.43, stairEnd=d+stepCount*stepDepth;
  platform.push(box(span-.30,.43,depth+.04,'#777e7c',[0,deck-.215,0]));
  structure.push(box(5.75,.075,8.0,'#d0d2b5',[-3.95,deck+.038,d-8.5]));
  for(const x of [-12.93,-2.48]){
    structure.push(box(.085,.055,13.65,'#c4aa49',[x,deck+.035,d-8.1]));
  }
  const atFoot=terminal.localToWorld(new THREE.Vector3(stairX,0,stairEnd));
  const foot=heightAt(atFoot.x,atFoot.z)-terminal.position.y;
  const stairRise=(deck-foot)/stepCount;
  for(let i=0;i<stepCount;i++){
    const y=deck-i*stairRise,z=d+(i+.5)*stepDepth;
    pier(platform,terminal,stairX,z,stairW,stepDepth+.017,y,'#8f989a');
    structure.push(box(stairW-.045,.027,.068,'#a5a793',[stairX,y-.01,z+stepDepth*.37]));
  }
  for(const x of [stairX-stairW*.5,stairX+stairW*.5]){
    structure.push(beam([x,deck+.93,d],[x,foot+1.04,stairEnd],.058,.071,'#53646b'));
    for(let i=0;i<=4;i++){
      const t=i/4,z=d+(stairEnd-d)*t,y=deck-(deck-foot)*t;
      structure.push(box(.077,1,.067,'#59676b',[x,y+.46,z]));
      collide(grid,terminal,x,z,.1,.1,0,y+1);
    }
  }
  const operator=controlBooth(terminal,grid,4.65,d-4.75,deck);
  for(const x of [.25,2.33]){
    scannerGate(terminal,structure,x,deck,d-1.7);
    collide(grid,terminal,x,d-1.7,.22,.24,0,deck+1.3);
  }
  sign(terminal,'GONDOLA ENTRANCE','TICKET SCAN',2.52,.58,[1.25,deck+1.98,d+.38],'#344e59');
  // The northeast door admits moving cabins from the mapped ropeway.
  for (const x of [-w,-7.25,7.25,w]) structure.push(box(.42,upper(x),.49,slate,[x,upper(x)/2,-d]));
  structure.push(box(15.55,.29,.62,'#7b858e',[0,8.3,-d]));
  sign(terminal,'PEAK 2 PEAK','',7.85,1.65,[7.75,6.11,d+.32],'#b91f35',{badge:true,peakBadge:true});
  sign(terminal,'PEAK 2 PEAK','',8.6,1.82,[-w-.235,6.6,4.3],'#b91f35',{badge:true,peakBadge:true,yaw:-Math.PI/2});
  sign(terminal,'GONDOLA','TO BLACKCOMB',3.2,.82,[-7.4,2.81,d-1.61],'#233f50');
  layer(terminal,platform,{},'stone');
  layer(terminal,structure);
  layer(terminal,roof,{roughness:.8,side:THREE.DoubleSide});
  // Double-sided faces keep the glass continuous on both tapered sides.
  const glazing = new THREE.Mesh(mergeParts(glass),
    surfaceMaterial('glass', { vertexColors:true, side:THREE.DoubleSide, roughness:.27, metalness:.13 }));
  terminal.add(glazing);
  collide(grid,terminal,0,-.86,span+.12,depth-1.65,0,3.46);
  for(const side of [-1,1]) collide(grid,terminal,side*w,0,.25,depth+.2,0,10);
  collide(grid,terminal,8.825,d+.09,9.85,.36,0,9.4);
  return { operator, walkSurfaceAt(x,z,y) {
    const dx=x-terminal.position.x,dz=z-terminal.position.z,c=Math.cos(yaw),s=Math.sin(yaw);
    const u=dx*c-dz*s,v=dx*s+dz*c;
    const step=Math.floor((v-d)/stepDepth);
    if(Math.abs(u-stairX)<=stairW/2&&step>=0&&step<stepCount)return terminal.position.y+deck-step*stairRise;
    if(u>=-2.38&&u<=w&&v<=d&&v>=-d&&y>=terminal.position.y+deck-.7)return terminal.position.y+deck;
    return null;
  }};
}


function villageTerminal(scene, grid, lift) {
  const [x,z]=lift.points.at(-1), [ax,az]=lift.points.at(-2);
  const heading=Math.atan2(x-ax,z-az);
  const p=site(scene,'Whistler Village Gondola · upper unload',x-.50,z+2.0,heading,heightAt(x,z)-.15);
  const steel=[],panels=[],snowCover=[];
  const floorTop=heightAt(x,z)+.39-p.position.y;
  const floor=[];
  pier(floor,p,.1,1.03,10.45,18.74,floorTop,'#a4a5a1');
  for (const x of [-4.32,4.47]){
    steel.push(box(.12,.037,17.8,'#b29b3f',[x,floorTop+.022,1.0]));
    for(let z=-7.9;z<=9;z+=2.1)steel.push(box(.065,.9,.072,'#6d7d7e',[x,floorTop+.43,z]));
    steel.push(box(.060,.050,18.15,'#82908d',[x,floorTop+.87,1.0]));
  }
  for(const side of [-1,1]){
    for(const z of [-10,-1.2,8.6]){
      steel.push(box(.62,6.9,.62,'#555d62',[side*5.15,3.08,z]));
      pier(steel,p,side*5.15,z,1.22,1.23,.40,concrete);
      collide(grid,p,side*5.15,z,1.22,1.23,0,7.15);
    }
    steel.push(box(.16,.29,21.5,'#788b97',[side*5.19,6.63,-.42]));
    for(let i=0;i<13;i++){
      const z=-10.3+i*1.68;
      panels.push(box(.13,1.3,1.58,i%2?'#527385':'#43687c',[side*5.26,7.21,z]));
    }
  }
  steel.push(box(11.4,.31,22.3,'#7f8d96',[0,8.1,-.4]));
  snowCover.push(box(11.62,.2,22.5,snow,[0,8.34,-.4]));
  steel.push(box(10.7,.67,.29,'#596b76',[0,7.73,10.46]));
  const operator=controlBooth(p,grid,-4.1,7.42,floorTop,Math.PI/2);
  for (const x of [-3.85,-2.30])scannerGate(p,steel,x,floorTop,9.65);
  for (let i=-4;i<=4;i++) {
    steel.push(box(.095,1.16,.07,'#7d8b8c',[4.7,.58,10.2+i*1.62]));
  }
  sign(p,'WHISTLER VILLAGE GONDOLA','UPPER STATION',7.9,1.6,[0,7.12,10.64]);
  layer(p,floor,{},'stone');
  layer(p,steel,{roughness:.52,metalness:.19}); layer(p,panels,{roughness:.31,metalness:.2}); layer(p,snowCover);
  return { operator, walkSurfaceAt(x,z,y) {
    const dx=x-p.position.x,dz=z-p.position.z,c=Math.cos(heading),s=Math.sin(heading);
    const u=dx*c-dz*s,v=dx*s+dz*c,level=p.position.y+floorTop;
    return Math.abs(u-.1)<=5.225&&Math.abs(v-1.03)<=9.37&&y>=level-.7?level:null;
  }};
}

function ringGeometry(radius, thickness, depth, phase, weave) {
  const bore=radius-thickness;
  const points=[],indices=[];
  const count=112;
  const faces=[
    [[radius,depth/2],[bore,depth/2]],
    [[bore,depth/2],[bore,-depth/2]],
    [[bore,-depth/2],[radius,-depth/2]],
    [[radius,-depth/2],[radius,depth/2]],
  ];
  for (const face of faces) {
    const base=points.length/3;
    for(let i=0;i<=count;i++) {
      const a=i/count*Math.PI*2, bump=weave*Math.cos(2*a+phase);
      for(const [r,z] of face) points.push(Math.cos(a)*r,Math.sin(a)*r,z+bump);
      if(i<count) {
        const k=base+i*2;
        indices.push(k,k+2,k+1,k+1,k+2,k+3);
      }
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function olympicRings(scene, grid) {
  const { x, z, yaw } = ROUNDHOUSE_OLYMPIC_SITE;
  const g=site(scene,'Olympic rings overlook',x,z,yaw,heightAt(x,z)+.14);
  const slab=[],rails=[],posts=[];
  const west=-6.2,east=1.38,south=-8.15,north=5.15;
  const strips=Math.ceil((north-south)/1.1), stride=(north-south)/strips;
  for (let i=0;i<strips;i++) {
    const x=south+(i+.5)*stride;
    pier(slab,g,x,(west+east)/2,stride+.014,east-west,.025,'#777a77');
    slab.push(box(stride-.014,.075,east-west-.05,'#a8a9a1',[x,.016,(west+east)/2]));
  }
  for (let x=south+.12;x<=north;x+=1.45) {
    rails.push(box(.088,1.16,.088,'#59615e',[x,.61,west+.17]));
  }
  for(const y of [.32,.66,1.15]){
    rails.push(box(north-south,.052,.061,'#65706d',[(north+south)/2,y,west+.17]));
    rails.push(box(.059,.052,east-west,'#65706d',[north-.49,y,(west+east)/2]));
  }
  rails.push(box(.10,1.16,.10,'#59615e',[north-.49,.61,east-.12]));
  collide(grid,g,(north+south)/2,west+.16,north-south,.16,0,1.21);
  collide(grid,g,north-.49,(west+east)/2,.16,east-west,0,1.21);
  const stairDepth=.39, steps=12, approach=south-stairDepth*steps, near=-2.36, far=east;
  const bottomSpot=g.localToWorld(new THREE.Vector3(approach,0,(near+far)/2));
  const bottom=heightAt(bottomSpot.x,bottomSpot.z)-g.position.y;
  const rise=(.054-bottom)/steps;
  for(let i=0;i<steps;i++){
    const u=south-(i+.5)*stairDepth, y=.054-i*rise;
    pier(slab,g,u,(near+far)/2,stairDepth+.018,far-near,y,'#9a9c96');
  }
  for(const v of [near,far]){
    rails.push(beam([south,.97,v],[approach,bottom+.96,v],.061,.07,'#6f7770'));
    for(let i=0;i<=4;i++){
      const t=i/4, y=.054-(.054-bottom)*t, u=south-(south-approach)*t;
      rails.push(box(.079,.98,.081,'#58635e',[u,y+.475,v]));
      collide(grid,g,u,v,.10,.10,0,y+.99);
    }
  }
  slab.push(box(4.78,.48,1.52,'#858b89',[0,.267,-2.83]),box(4.86,.105,1.57,'#a4b0ad',[0,.545,-2.83]));
  collide(grid,g,0,-2.83,4.81,1.52,0,.61);
  for(const x of [-1.37,0,1.37]){
    posts.push(box(.11,1.35,.12,'#667075',[x,1.19,-2.87]));
    posts.push(box(.23,.036,.20,'#7e8b8b',[x,.61,-2.87]));
  }
  layer(g,slab,{},'stone');
  layer(g,rails,{roughness:.67,metalness:.36});
  layer(g,posts,{roughness:.52,metalness:.48});
  sign(g,'WHISTLER 2010','OLYMPIC PHOTO PLATFORM',2.35,.295,[0,.30,-2.032],'#52686a');
  const rings=[
    [-1.37,2.17,0x008ac2,.3], [0,2.17,0x0b1015,2.2], [1.37,2.17,0xde173c,.3],
    [-.685,1.49,0xffd719,3.43], [.685,1.49,0x00ac7c,3.43],
  ];
  for(const [x,y,color,phase] of rings){
    const ring=new THREE.Mesh(ringGeometry(.765,.129,.14,phase,.062),
      new THREE.MeshStandardMaterial({color,metalness:.32,roughness:.29,emissive:color,emissiveIntensity:.035,side:THREE.DoubleSide}));
    ring.position.set(x,y,-2.83);
    ring.castShadow=true;
    ring.receiveShadow=true;
    g.add(ring);
  }
  return (x,z,currentY) => {
    const u=g.position.z-z,v=x-g.position.x,y=g.position.y+.054;
    const step=Math.floor((south-u)/stairDepth);
    if(step>=0&&step<steps&&v>=near&&v<=far)return y-step*rise;
    return u>=south&&u<=north&&v>=west&&v<=east&&(currentY===undefined||currentY>=y-.7) ? y : null;
  };
}

function umbrellaBar(scene,grid) {
  const bar=site(scene,'Umbrella Bar · Roundhouse ridge',467.4,4749.1,.12);
  const sides=12,radius=5.65,eave=3.18,roofRadius=6.08;
  const foundation=[],frame=[],roof=[],glass=[],wood=[];
  const corner=(i,r,y)=>[Math.cos(i/sides*Math.PI*2)*r,y,Math.sin(i/sides*Math.PI*2)*r];
  const foot=groundFoot(bar,0,0,13.4,13.4);
  foundation.push(part(new THREE.CylinderGeometry(6.7,6.65,.25-foot,48),'#777c79',[0,(foot+.25)/2,0]));
  wood.push(part(new THREE.CylinderGeometry(6.68,6.68,.11,48),'#6e6252',[0,.27,0]));
  frame.push(part(new THREE.CylinderGeometry(.72,.72,.36,18),'#68767c',[0,4.27,0]));
  frame.push(part(new THREE.CylinderGeometry(.80,.80,.095,18),'#a2a9ab',[0,4.495,0]));
  const top=[0,4.16,0];
  for(let i=0;i<sides;i++){
    const [x,,z]=corner(i,radius,0),a=corner(i,roofRadius,eave),b=corner(i+1,roofRadius,eave);
    panel(roof,a,b,top,top,i%2?'#35434a':'#303e46');
    frame.push(beam(a,b,.12,.235,'#596773'),beam(a,top,.071,.105,'#55626b'));
    frame.push(box(.109,eave-.20,.106,'#7a8f98',[x,(eave+.26)/2,z]));
    if(i===1)continue;
    const lo=corner(i,radius,.56), hi=corner(i+1,radius,.56);
    const left=corner(i,radius,eave-.11), right=corner(i+1,radius,eave-.11);
    panel(glass,lo,hi,right,left,i%3?'#70909e':'#66818f');
    frame.push(beam(lo,hi,.10,.19,'#819198'));
  }
  const woodScreen=[];
  for(const x of [-1.9,-.95,0,.95,1.9]){
    woodScreen.push(box(.86,.89,.56,'#524c42',[x,.77,-1]));
    woodScreen.push(box(.9,.032,.59,'#a59479',[x,1.24,-1]));
    for(let i=0;i<3;i++)woodScreen.push(box(.09,.15,.09,i===0?'#dbd8c7':'#718c8e',[x-.23+i*.20,1.33,-1]));
  }
  layer(bar,foundation,{},'stone');
  layer(bar,wood,{},'timber');
  layer(bar,woodScreen,{},'timber');
  layer(bar,frame,{metalness:.22,roughness:.55});
  layer(bar,roof,{roughness:.75,side:THREE.DoubleSide});
  layer(bar,glass,{side:THREE.DoubleSide,roughness:.36,transparent:true,opacity:.43,depthWrite:false},'glass');
  const signYaw=Math.PI*.36;
  sign(bar,'UMBRELLA BAR','',2.7,.44,[Math.sin(signYaw)*5.72,2.78,Math.cos(signYaw)*5.72],'#3e4f56',{yaw:signYaw});
  grid.addCircle(bar.position.x,bar.position.z,5.64,'lodge',{maxY:bar.position.y+4.51});
}

function ridgeView(scene,grid) {
  const {x,z,yaw}=ROUNDHOUSE_STONE_SITE;
  const view=site(scene,'Roundhouse inukshuk viewpoint',x,z,yaw), slab=[], posts=[], glass=[];
  const back=-2.2, front=1.75, left=-3.7, right=3.7;
  pier(slab,view,0,(front+back)/2,right-left,front-back,.015,'#97988c');
  for(let i=0;i<=5;i++){
    const u=left+(right-left)*i/5;
    posts.push(box(.085,1.43,.086,'#47565b',[u,.72,back]));
    posts.push(box(.17,.07,.16,'#68716f',[u,.045,back]));
    if(i<5){
      const panelWidth=(right-left)/5;
      glass.push(box(panelWidth-.07,1.24,.047,'#a2bdbe',[u+panelWidth/2,.80,back]));
    }
  }
  for(const side of [-1,1]){
    posts.push(box(.093,1.43,.09,'#46545c',[side*right,.72,back+1.12]));
    glass.push(box(.047,1.24,1.07,'#9bb3b7',[side*right,.80,back+.56]));
    collide(grid,view,side*right,back+.56,.125,1.12,0,1.4);
  }
  collide(grid,view,0,back,right-left,.13,0,1.43);
  collide(grid,view,0,0,1.53,.79,0,1.95);
  layer(view,slab,{},'stone');
  layer(view,posts,{metalness:.28});
  layer(view,glass,{roughness:.34,transparent:true,opacity:.25,depthWrite:false},'glass');
  return (x,z,y)=>{
    const dx=x-view.position.x,dz=z-view.position.z,c=Math.cos(yaw),s=Math.sin(yaw);
    const u=dx*c-dz*s,v=dx*s+dz*c,level=view.position.y+.015;
    return u>=left&&u<=right&&v>=back&&v<=front&&(y===undefined||y>=level-.7)?level:null;
  };
}

function skiRack(parts, x,z,y,yaw,rand) {
  const start=parts.length;
  for(const side of [-1,1]){
    parts.push(box(.095,1.03,.09,'#647681',[x+side*1.36,y+.45,z]));
    parts.push(box(.18,.095,.5,'#697b84',[x+side*1.36,y+.02,z]));
  }
  parts.push(box(2.88,.069,.088,'#667b89',[x,y+.855,z]));
  const colors=['#303335','#437687','#3b546c','#b13d47','#ada7a3','#b09c38','#dedfd0'];
  for(let i=0;i<8;i++){
    if(rand()<.25) continue;
    const cx=x-1.1+.28*i;
    const color=colors[Math.floor(rand()*colors.length)];
    const length=1.52+rand()*.27;
    for(const side of [-1,1]){
      const sx=cx+side*.052;
      parts.push(box(.087,length,.025,color,[sx,y+length*.47,z+.12],[-.18,0,.05*side]));
      parts.push(box(.092,.118,.052,'#333b40',[sx,y+length*.43,z+.18],[-.18,0,.05*side]));
    }
  }
  const turn=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
  for(let i=start;i<parts.length;i++) {
    const p=parts[i],v=new THREE.Vector3(p.pos[0]-x,p.pos[1]-y,p.pos[2]-z).applyQuaternion(turn);
    p.pos=[x+v.x,y+v.y,z+v.z];
    const q=turn.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rot)));
    p.rot=new THREE.Euler().setFromQuaternion(q).toArray().slice(0,3);
  }
}

function plazaFixtures(scene, grid) {
  const décor=site(scene,'Roundhouse ski racks and rope lines',0,0,0,0);
  const props=[];
  const rng=mulberry32(8950);
  for (const [x,z] of [[465,4838],[470,4838.5],[487.2,4837],[491.8,4837],
    [464,4834],[469,4834.5],[487.2,4833],[491.8,4833],
    [449,4836],[453,4841],[444,4829],[460,4845.5],[466,4847.3],
    [491.2,4844.8],[497.55,4841.9],[497.8,4846.1],[516,4860],[522,4864]]) {
    const yaw=.075+(rng()-.5)*.19;
    skiRack(props,x,z,heightAt(x,z),yaw,rng);
    grid.addBox(x,z,1.4,.39,-yaw,'station');
  }
  for (const [x,z] of [[463.8,4831.1],[493.4,4830.52]]) {
    const y=heightAt(x,z);
    for(const offset of [-.69,.69]){
      const base=heightAt(x+offset,z)-.1;
      props.push(box(.15,y+.47-base,.42,'#676761',[x+offset,(base+y+.47)/2,z]));
    }
    props.push(box(2.05,.092,.48,'#6d5140',[x,y+.48,z]),box(2.05,.42,.07,'#745943',[x,y+.78,z-.195]));
    grid.addBox(x,z,1.03,.27,0,'station',{maxY:y+1});
  }
  for(const [x,z] of [[449.4,4851.7],[451.4,4848.2],[453.4,4844.7],[455.4,4841.2],[457.6,4837.8]]){
    const y=heightAt(x,z);
    props.push(box(.046,1.3,.046,'#b2713e',[x,y+.61,z],[.036,0,-.041]));
    for(let i=0;i<5;i++)props.push(box(.052,.078,.052,'#eeeeed',[x,y+.17+i*.21,z]));
  }
  const rope=[[449.4,4851.7],[451.4,4848.2],[453.4,4844.7],[455.4,4841.2],[457.6,4837.8]];
  for(let i=1;i<rope.length;i++){
    const [a,b]=rope[i-1],[c,d]=rope[i];
    const y0=heightAt(a,b)+.83,y1=heightAt(c,d)+.83;
    const x=(a+c)/2,z=(b+d)/2,y=(y0+y1)/2-.082;
    props.push(beam([a,y0,b],[x,y,z],.018,.021,'#b35b58'));
    props.push(beam([x,y,z],[c,y1,d],.018,.021,'#b35b58'));
  }
  const animateFlags=[];
  for(const [x,z] of [[445.94,4825],[445.94,4820.2],[445.94,4814.1],[449.4,4814.7]]) {
    const p=site(scene,'Canadian flag',x,z,.19);
    p.position.y=Math.max(p.position.y,heightAt(ROUNDHOUSE_OLYMPIC_SITE.x,ROUNDHOUSE_OLYMPIC_SITE.z)+.194);
    layer(p,[part(new THREE.CylinderGeometry(.022,.035,4.4,11),'#6b767a',[0,2.2,0])],{roughness:.77});
    const {canvas,ctx}=makeCanvas(320,160);
    ctx.fillStyle='#ba2933';ctx.fillRect(0,0,320,160);
    ctx.fillStyle='#f2efeb';ctx.fillRect(80,0,160,160);
    ctx.fillStyle='#ba2933';
    ctx.beginPath();
    const outline=[[0,.69],[.19,.27],[.33,.37],[.30,.12],[.58,.20],[.48,-.055],[.64,-.13],
      [.21,-.34],[.125,-.32],[.12,-.56],[-.105,-.56],[-.09,-.31],[-.27,-.35],[-.62,-.14],
      [-.46,-.055],[-.56,.22],[-.28,.14],[-.32,.38],[-.18,.26]];
    outline.forEach(([x,y],i)=> i ? ctx.lineTo(160+x*75,81-y*76) : ctx.moveTo(160+x*75,81-y*76));
    ctx.closePath();ctx.fill();
    const geometry=new THREE.PlaneGeometry(1.24,.62,18,7);
    const position=geometry.attributes.position;
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:canvasTexture(canvas),side:THREE.DoubleSide,roughness:.88}));
    mesh.position.set(.62,3.79,.025);
    mesh.castShadow=mesh.receiveShadow=true;
    p.add(mesh);
    animateFlags.push(time=>{
      for(let i=0;i<position.count;i++){
        const u=geometry.attributes.uv.getX(i),v=geometry.attributes.uv.getY(i);
        position.setZ(i,u*(.106*Math.sin(time*2.7-u*8.1)+.033*Math.sin(time*1.3+u*19+v*4)));
      }
      position.needsUpdate=true;geometry.computeVertexNormals();
    });
  }
  const trailSign=site(scene,'Roundhouse trail directions',510.2,4868,-.71);
  layer(trailSign,[-1.08,1.08].map(x=>box(.13,2.72,.14,timber,[x,1.29,0])));
  const rows=[
    ['SLOW ZONE','#bda126'], ['EASIEST ROUTE  ↖','#235d48'],
    ['UPPER WHISKEY JACK  ↖','#235d48'], ['EGO BOWL  ↖','#235d48'],
    ['MARMOT  ↑','#235d48'], ['EMERALD 6 EXPRESS  ↑','#33434f'],
    ['HARMONY 6 EXPRESS  ↑','#33434f'],
  ];
  rows.forEach(([text,color],i)=>sign(trailSign,text,'',2.69,.35,[0,2.76-i*.38,.047],color));
  layer(décor,props,{roughness:.62,metalness:.12});
  const slow=slowBanner(décor,[521.2,4881.5],[533.6,4884.4]);
  const traffic=slowBanner(décor,[540,4891.2],[550,4890.4],'MERGING TRAFFIC');
  return (time) => { slow(time); traffic(time); for(const update of animateFlags) update(time); };
}

export function buildRoundhouseArrival(scene, grid) {
  const villageLift = LIFTS.find(({id}) => id === VILLAGE_GONDOLA_UPPER);
  const peakLift = LIFTS.find(({id}) => id === PEAK_TO_PEAK);
  lodge(scene,grid);
  const village=villageTerminal(scene,grid,villageLift);
  const peak=peakTerminal(scene,grid,peakLift);
  const olympic=olympicRings(scene,grid);
  umbrellaBar(scene,grid);
  const ridge=ridgeView(scene,grid);
  return { update:plazaFixtures(scene,grid), operators:[village.operator,peak.operator],
    walkSurfaceAt(x,z,y) { return olympic(x,z,y)??peak.walkSurfaceAt(x,z,y)??village.walkSurfaceAt(x,z,y)??ridge(x,z,y); } };
}
