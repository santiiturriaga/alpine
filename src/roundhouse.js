import { addPassGate } from './pass-gates.js';
import * as THREE from 'three';
import { LIFTS, PEAK_TO_PEAK, VILLAGE_GONDOLA_UPPER } from './worlddata.js';
import { heightAt, terrain } from './terrain.js';
import { triangleHeight } from './terrain-grid.js';
import { beam, box, mergeParts, mergedMesh, part } from './scenery.js';
import { surfaceMaterial } from './materials.js';
import { makeCanvas, canvasTexture, mulberry32, smoothstep } from './util.js';
import { slowBanner } from './alpine-landmarks.js';
import { timberMesh } from './plaza-materials.js';
import { makePeak2PeakBadge } from './lift-stations.js';
import { createRoofSnow, createIcicles } from './roof-weather.js';
import { LODGE_FRAME, LODGE_CAFE, LODGE_TERRACE, LODGE_ANNEX, ROUNDHOUSE_OLYMPIC_SITE,
  whistlerPeakTerminalSite } from './roundhouse-site.js';
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
    if (options.side !== undefined) mesh.material.side = options.side;
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
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#c3c5c4';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 1008, 240);
  ctx.fillStyle = '#f3f3ee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 100px Barlow, Arial';
  ctx.fillText(title, 512, subtitle ? 113 : 132, 865);
  if (subtitle) {
    ctx.fillStyle = '#c7d8e0';
    ctx.font = '600 39px Barlow, Arial';
    ctx.fillText(subtitle, 512, 195, 890);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: .67,
      emissive: 0xffffff, emissiveIntensity: .045 }));
  mesh.position.set(...position);
  mesh.rotation.y = options.yaw ?? 0;
  parent.add(mesh);
  return mesh;
}

function collide(grid, group, x, z, width, length, yaw = 0, maxY = Infinity, minY = -Infinity) {
  const p = group.localToWorld(new THREE.Vector3(x, 0, z));
  grid.addBox(p.x, p.z, width / 2, length / 2, -group.rotation.y - yaw, 'lodge',
    { minY: group.position.y + minY, maxY: group.position.y + maxY });
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
  ctx.fillStyle='#a64632';ctx.strokeStyle='#f0dec0';ctx.lineWidth=11;
  ctx.beginPath();
  for(let i=0;i<=160;i++) {
    const angle=i/160*2*Math.PI, radius=205+13*Math.cos(angle*8);
    const x=radius*Math.cos(angle),y=radius*Math.sin(angle);
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,179,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#f0dec0';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='bold 47px Georgia';
  const arced = (text, above) => {
    const radius=135, span=text.length*.148;
    for(let i=0;i<text.length;i++) {
      const angle=(i+.5)/text.length*span-span/2;
      ctx.save();ctx.rotate(angle*(above?1:-1));
      ctx.fillText(text[i],0,radius*(above?-1:1));ctx.restore();
    }
  };
  arced('ROUNDHOUSE',true);arced('LODGE',false);
  ctx.fillStyle='#214e68';ctx.lineWidth=6;ctx.beginPath();ctx.arc(0,0,72,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.strokeStyle='#e3be72';ctx.lineWidth=8;
  ctx.beginPath();ctx.moveTo(-49,29);ctx.lineTo(-19,-12);ctx.lineTo(-2,6);
  ctx.lineTo(22,-40);ctx.lineTo(51,29);ctx.stroke();
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.55,1.55),
    new THREE.MeshStandardMaterial({map:canvasTexture(canvas),transparent:true,alphaTest:.4,roughness:.65,side:THREE.DoubleSide}));
  mesh.name='Roundhouse Lodge suspended medallion';
  mesh.position.set(...position);parent.add(mesh);
}

const masonryTones = ['#aca699','#c5bcac','#a7a398','#bfb8aa','#9b958a','#d0c7b4','#b3aa9c'];
function splitStone(parts, left, right, bottom, top, face, rng) {
  for(let y=bottom;y<top-.035;){
    const height=Math.min(top-y,.068+rng()*.072);
    for(let x=left;x<right-.026;){
      const width=Math.min(right-x,.17+rng()*.45),proud=.018+rng()*.041;
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
  const z = front + .59, stone = '#a8a298', spring = 2.43, crown = 3.19, half = 3.35;
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
  // Pale arch blocks ring the opening, with staggered stone courses above them.
  const random=mulberry32(6630);
  for (let i = 0; i < 15; i++) {
    const a = -half+2*half*i/15, b = -half+2*half*(i+1)/15;
    const left=x+a, right=x+b, yA=archHeight(a), yB=archHeight(b);
    panel(masonry,[left,yA,z+.67],[right,yB,z+.67],[right,3.83,z+.67],[left,3.83,z+.67],stone);
    panel(masonry,[right,yB,z-.65],[left,yA,z-.65],[left,3.83,z-.65],[right,3.83,z-.65],stone);
    panel(masonry,[left,yA,z-.65],[right,yB,z-.65],[right,yB,z+.72],[left,yA,z+.72],'#a19b8e');
    const blockA=archHeight(a+.009), blockB=archHeight(b-.009), show=z+.726;
    const cap=i===7?.37:.255, color=i%2?'#bab3a2':'#cec5b0';
    panel(masonry,[left+.009,blockA,show],[right-.009,blockB,show],
      [right-.009,blockB+cap,show],[left+.009,blockA+cap,show],color);
    const top=Math.max(yA,yB)+cap+.019;
    splitStone(masonry,left,right,top,3.82,z+.675,random);
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
  woodwork.push(box(width + 1.65,.14,1.54,'#694635',[x,3.99,z]));
  sign(group,'ROUNDHOUSE LODGE','',3.25,.39,[x,3.10,front+.021],'#352e2a');
  for (const dx of [-2,0,2]) roof.push(box(.16,.045,.17,'#d6cbac',[x+dx,3.16,z+.11]));
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
  const footings = [[-14.55,5,1.1,40],[-18.675,-8.2,7.15,13.6],[-18.675,24.2,7.15,1.6],
    [14.825,5,24.85,40],[-5.8,-2.5,16.4,25]];
  for (const [x,z,w,d] of footings) {
    pier(masonry, group, x, z, w, d, 3.38, '#8b8881');
    collide(grid,group,x,z,w,d,0,3.3);
  }
  // Hollow upper dining hall. The exterior used to be one solid volume,
  // which filled the room and made the glass read as painted wall panels.
  block.push(box(48, 5.75, .36, '#90877d', [2.5, 5.85, -14.32]));
  for(const x of [-14.98,26.32]) block.push(box(.29,5.75,39,'#90877d',[x,5.85,5]));
  block.push(box(41.4,.24,38.5,'#7c6b54',[5.65,3.57,5]));
  masonry.push(box(15.6, 4.1, 19.27, '#9b9991', [-21.8, .45, -11.04]));
  masonry.push(box(4.4, 4.1, 30.675, '#9b9991', [-11.8, .45, -5.3375]));

  // Timber-framed entrance, deep gable and matching balcony from the photos.
  const atrium = LODGE_CAFE.x, span = 17.25, gable = 12.55, eave = 9.65, depth = 12.7;
  const front = LODGE_CAFE.front, back = front - depth, portalZ = front + .86;
  const lip = span/2+1.1, postDistance = 4.32;
  const underRoof = dx => gable - Math.abs(dx) / lip * (gable-eave) - .22;
  const glulam = '#a26940', fascia = '#8e5634', braces = '#72513a';
  const collar = new THREE.CylinderGeometry(.278,.278,.55,16);
  const post = new THREE.CylinderGeometry(.234,.255,1,16);
  const steel = [];
  for (const side of [-1, 1]) {
    const lipX=atrium+side*lip;
    panel(roof, [atrium,gable,back-1], [lipX,eave,back-1],
      [lipX,eave,front+1.2], [atrium,gable,front+1.2], '#4c3d32');
    const ridgeX=atrium+side*.06;
    const eaveFront=[lipX,eave,front+1.2],eaveBack=[lipX,eave,back-1];
    group.add(createRoofSnow([[ridgeX,gable,front+1.2],[ridgeX,gable,back-1],eaveBack,eaveFront],
      {seed:136+side,depth:.32,overhang:.17}),createIcicles(eaveBack,eaveFront,{seed:809+side,length:.49}));
    woodwork.push(beam([lipX,eave-.10,front+1.23],[atrium,gable-.10,front+1.23],.23,.34,fascia));
    woodwork.push(beam([lipX,eave+.09,front+1.27],[atrium,gable+.09,front+1.27],.12,.12,'#ba8d64'));
    for (const dx of [1.85,4.62,7.18,9.16]) {
      const x=atrium+side*dx;
      woodwork.push(beam([x,underRoof(dx)+.05,back-.95],[x,underRoof(dx)+.05,front+1.25],.22,.26,fascia));
    }
    const x=atrium+side*postDistance, top=underRoof(postDistance)-.04;
    const deckLevel=LODGE_TERRACE.floor;
    for (const [z,floor] of [[portalZ,deckLevel],[portalZ-3.1,deckLevel],[portalZ-6.5,8.84]]) {
      woodwork.push(part(post,glulam,[x,(floor+top)/2,z],[0,0,0],[1,top-floor,1]));
      woodwork.push(beam([x,top-2.9,z],[atrium+side*1.7,underRoof(1.7)-.25,z],.24,.32,braces));
      woodwork.push(beam([x,top-2.7,z],[atrium+side*7.22,underRoof(7.22)-.10,z],.23,.32,braces));
      woodwork.push(beam([lipX,eave-.22,z],[atrium,gable-.24,z],.22,.27,braces));
      if (floor === deckLevel) {
        steel.push(part(collar,'#9a9b92',[x,7.87,z]));
        for (const y of [7.61,8.13]) steel.push(part(new THREE.CylinderGeometry(.292,.292,.07,16),'#bec0b8',[x,y,z]));
        collide(grid,group,x,z,.49,.49,0,top,floor);
      }
    }
    const badgeAnchor=atrium+side*.48;
    steel.push(beam([atrium+side*3.7,underRoof(3.7),portalZ],[badgeAnchor,10.75,portalZ+.11],.023,.023,'#a9a8a2'));
    steel.push(beam([x,7.92,portalZ],[badgeAnchor,9.95,portalZ+.11],.023,.023,'#8b8a81'));
  }
  roundhouseBadge(group,[atrium,10.30,portalZ+.13]);
  entranceArch(group,grid,masonry,woodwork,roof);
  carvedBears(group,grid,masonry,woodwork);

  const deckX = 5, deckZ = 27.35;
  woodwork.push(box(51, .49, 5.15, wood, [deckX,3.6,deckZ]));
  for (const x of [-19.6, -13.5, 2.5, 8.6, 14.8, 20.9, 29.3]) {
    pier(masonry, group, x, 28.8, .73, .86, 3.38, '#8a8881');
    collide(grid, group, x, 28.8, .75, .88, 0, 3.38);
    splitStone(masonry,x-.365,x+.365,0,3.36,29.233,random);
  }
  const deckEdge=deckZ+2.36, porchWidth=postDistance*2+.86;
  for (const y of [3.77, 4.76]) {
    woodwork.push(box(44.2,.15,.12,timber,[1.6,y,deckEdge]));
    woodwork.push(box(3.2,.15,.12,timber,[28.9,y,deckZ+2.36]));
    for(const x of [-20.45,30.45])woodwork.push(box(.12,.15,4.88,timber,[x,y,deckZ-.06]));
  }
  for (const [i,color] of ['#986138','#a77041','#a26235','#b27945'].entries()) {
    const y=3.94+.218*i;
    woodwork.push(box(porchWidth,.204,.148,color,[atrium,y,deckEdge+.031]));
  }
  woodwork.push(box(porchWidth+.16,.12,.205,'#ca9b6b',[atrium,4.79,deckEdge+.05]));
  for (let i = 0; i <= 101; i++) {
    const x = deckX - 25.2 + .5*i;
    if(x>23.7 && x<27.3)continue; // open stair landing
    if(Math.abs(x-atrium)<porchWidth/2)continue;
    woodwork.push(box(i%7===0?.16:.065,.96,.10,timber,[x,4.24,deckZ+2.36]));
  }
  const { stairX, stairTop, stairBottom, stairWidth, floor, steps } = LODGE_TERRACE;
  const tread = (stairBottom - stairTop) / steps;
  for (let i = 0; i < steps; i++) {
    const y = floor / steps * (i+1), z = stairBottom - tread * (i+.5);
    const base = groundFoot(group,stairX,z,stairWidth,tread);
    pier(masonry, group, stairX, z, stairWidth, tread+.008, y-.025, '#999b9b');
    roof.push(box(stairWidth,.025,tread,snow,[stairX,y-.0125,z]));
    for (const side of [-1,1]) {
      const x = stairX+side*(stairWidth/2+.065);
      collide(grid,group,x,z,.13,tread,0,y+1.02,base);
    }
  }
  woodwork.push(box(stairWidth,.24,1.28,wood,[stairX,floor-.12,30.02]));
  for (const x of [stairX-1.79,stairX+1.79]) {
    woodwork.push(beam([x,1.12,stairBottom],[x,floor+.99,stairTop],.115,.17,wood));
    woodwork.push(beam([x,floor+.99,stairTop],[x,floor+.99,29.64],.115,.17,wood));
    for (let i = 0; i <= 5; i++) {
      const t = i/5, z = stairBottom - (stairBottom - stairTop) * t;
      woodwork.push(box(.11,1.07,.11,wood,[x,.52+floor*t,z]));
    }
    collide(grid,group,x,30,.15,.7,0,floor+1.075,floor-.24);
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

  const { x: annexX, z: annexZ, width: annexW, depth: annexD, floor: annexY,
    upperFloor: annexUpper, doorX, doorWidth } = LODGE_ANNEX;
  const annexFront=annexZ+annexD/2, annexBack=annexZ-annexD/2;
  const annexLeft=annexX-annexW/2, annexRight=annexX+annexW/2;
  const doorLeft=doorX-doorWidth/2, doorRight=doorX+doorWidth/2;
  const annexGlass=[], annexLights=[];
  pier(masonry,group,annexX,annexZ,annexW,annexD,annexY,'#878a84');
  pier(masonry,group,doorX,annexFront+.72,doorWidth+.45,1.44,annexY,'#a6a59a');
  woodwork.push(box(annexW-.16,.19,annexD-.12,wood,[annexX,annexUpper-.095,annexZ]));
  block.push(box(annexW,.45,annexD,'#617072',[annexX,7,annexZ]));
  lowRoof(annexX,7.24,annexZ,annexW+.5,annexD+.5,0,891);

  for (const [lo,hi] of [[annexLeft,doorLeft],[doorRight,annexRight]]) {
    const length=hi-lo, count=Math.ceil(length/1.47), width=length/count;
    for(let i=0;i<count;i++) {
      const x=lo+(i+.5)*width;
      annexGlass.push(box(width-.08,2.51,.045,'#718ea1',[x,1.93,annexFront]));
      block.push(box(.10,3.03,.16,'#60717b',[lo+i*width,1.925,annexFront]));
    }
    block.push(box(length,.21,.19,'#a2a69f',[(lo+hi)/2,annexY+.105,annexFront]));
    collide(grid,group,(lo+hi)/2,annexFront,length,.20,0,3.47,annexY-.45);
  }
  for(const x of [annexLeft,doorLeft,doorRight,annexRight]){
    block.push(box(.14,3.13,.2,'#78858a',[x,1.98,annexFront]));
  }
  block.push(box(doorWidth,.42,.21,'#969fa0',[doorX,3.24,annexFront]));
  for(let i=0;i<9;i++) {
    const width=annexW/9, x=annexLeft+(i+.5)*width;
    annexGlass.push(box(width-.08,2.69,.045,'#91a7b0',[x,5.2,annexFront]));
    block.push(box(.10,3.22,.16,'#637783',[annexLeft+i*width,5.17,annexFront]));
  }
  for(let i=0;i<17;i++) {
    const width=annexD/17, z=annexBack+(i+.5)*width;
    for(const y of [1.93,5.2]) annexGlass.push(box(.045,2.58,width-.08,'#819ca9',[annexLeft,y,z]));
    block.push(box(.175,6.36,.098,'#61737d',[annexLeft,3.65,annexBack+i*width]));
  }
  for(const y of [3.48,6.65]) {
    block.push(box(annexW,.13,.22,'#b7c1bd',[annexX,y,annexFront]));
    block.push(box(.22,.13,annexD,'#b7c1bd',[annexLeft,y,annexZ]));
  }
  for(const [x,z,w,d] of [[annexLeft,annexZ,.19,annexD],[annexRight,annexZ,.19,annexD],[annexX,annexBack,annexW,.21]]) {
    if(x!==annexLeft) block.push(box(w,6.35,d,'#8b8c80',[x,3.57,z]));
    collide(grid,group,x,z,w,d,0,6.8,annexY-.4);
  }
  for(const y of [annexY,annexUpper]) {
    for(const z of [1.5,7.8,14.1,20.4]) {
      annexLights.push(box(2.2,.054,.21,'#efe4ca',[annexX,y+2.83,z]));
      woodwork.push(box(.51,.12,3.2,'#725843',[annexLeft+.55,y+.48,z]));
      for(const end of [-1,1]) block.push(box(.09,.4,.12,'#6e7777',[annexLeft+.52,y+.23,z+end*1.25]));
      collide(grid,group,annexLeft+.55,z,.51,3.2,0,y+.53,y-.14);
    }
  }
  layer(group,annexLights,{emissive:0xecd5a6,emissiveIntensity:.36});
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
  layer(group,masonry,{},'stone');
  layer(group,block);
  layer(group,steel,{roughness:.52,metalness:.21});
  layer(group,woodwork,{},'timber');
  layer(group,roof,{roughness:.85,side:THREE.DoubleSide});
  layer(group,glazing,{roughness:.29,metalness:.14,transparent:true,opacity:.44,depthWrite:false},'glass');
  layer(group,annexGlass,{roughness:.27,metalness:.12,transparent:true,opacity:.46,depthWrite:false},'glass');
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

function peakApron(terminal, xCenter, doorWidth, zStart, deck) {
  // The DEM is sampled at metre-scale intervals around the entrance. Stitch
  // the last approach to the exact threshold and walk the very same triangles.
  const count=25, length=14.4, halfWidth=doorWidth*.5+2.7;
  const positions=[], colors=[], indices=[], heights=new Float32Array(count*count);
  const world=new THREE.Vector3(), color=new THREE.Color(), normal=new THREE.Vector3();
  for(let j=0;j<count;j++) {
    const run=j/(count-1)*length, z=zStart+run;
    for(let i=0;i<count;i++) {
      const side=(i/(count-1)*2-1)*halfWidth, x=xCenter+side;
      world.set(x,0,z);
      terminal.localToWorld(world);
      const ground=heightAt(world.x,world.z)-terminal.position.y;
      terrain.sampleSnowSurface(world.x,world.z,color,normal);
      const taper=(1-smoothstep(8.8,length-.1,run))*(1-smoothstep(doorWidth*.5,halfWidth-.1,Math.abs(side)));
      const apronY=deck-.086*Math.max(0,run-.38);
      const elevation=ground-.065+taper*Math.max(0,apronY-(ground-.065));
      const k=j*count+i;
      heights[k]=elevation;
      positions.push(x,elevation,z);
      colors.push(color.r,color.g,color.b);
      if(i<count-1&&j<count-1)indices.push(k,k+count,k+1,k+1,k+count,k+count+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const snowbank=new THREE.Mesh(geometry,terrain.snowMaterial);
  snowbank.receiveShadow=true;
  snowbank.name='PEAK 2 PEAK plaza · doorstep snow';
  terminal.add(snowbank);
  return function apronAt(x,z,worldX,worldZ) {
    const u=(x-xCenter+halfWidth)/(2*halfWidth), v=(z-zStart)/length;
    if(u<0||u>1||v<0||v>1)return null;
    const y=terminal.position.y+triangleHeight(heights,count,u*(count-1),v*(count-1));
    return y>heightAt(worldX,worldZ)?y:null;
  };
}

function terminalMachinery(terminal, grid, lift, deck, portalZ) {
  const path=lift.circulation.sections.find(section=>section.kind==='turn' && !section.upper);
  const toLocal=point=>terminal.worldToLocal(point.clone());
  const turn=path.curve.getSpacedPoints(48).map(toLocal);
  const center=toLocal(path.center);
  // Keep the visible steel and wheel bogies centered on the moving cabin grips.
  const start=turn[0], end=turn.at(-1);
  const approach=point=>new THREE.Vector3(point.x,point.y,portalZ+.7);
  const points=[approach(start),...turn,approach(end)];
  const drive=[], floor=[], horizontalRoller=new THREE.CylinderGeometry(.145,.145,.092,12);
  horizontalRoller.rotateX(Math.PI/2);
  const hub=new THREE.CylinderGeometry(.057,.057,.105,10); hub.rotateX(Math.PI/2);
  const red='#9d3229', deckZ=center.z-4.05;
  function edge(point, across, up) {
    const inward=new THREE.Vector3(center.x-point.x,0,center.z-point.z);
    // Each straight guide extends along the lift lanes before it enters the return arc.
    if(point.z<center.z)inward.z=0;
    return point.clone().addScaledVector(inward.normalize(),across).addScaledVector(THREE.Object3D.DEFAULT_UP,up);
  }
  for(let i=0;i<points.length-1;i++) {
    const a=points[i],b=points[i+1];
    for(const [offset,y,color] of [[.03,.21,red],[.04,.62,red],[.47,.49,'#777e7b']]) {
      drive.push(beam(edge(a,offset,y).toArray(),edge(b,offset,y).toArray(),.16,.19,color));
    }
    const gravel=['#51585b','#555a58','#595c5a','#535959'][i%4];
    const ground=(point,offset)=>edge(point,offset,deck+.012-point.y).toArray();
    panel(floor,ground(a,-1.90),ground(a,1.82),ground(b,1.82),ground(b,-1.90),gravel);
    panel(floor,ground(a,-1.92),ground(b,-1.92),ground(b,-2.02),ground(a,-2.02),'#c6a948');
  }
  for(let i=0;i<turn.length;i+=2) {
    const p=turn[i], tangent=turn[Math.min(i+1,turn.length-1)].clone().sub(turn[Math.max(i-1,0)]).normalize();
    const yaw=Math.atan2(tangent.x,tangent.z), rotation=[0,yaw+Math.PI/2,0];
    drive.push(part(horizontalRoller,'#32383a',edge(p,-.02,.41).toArray(),rotation));
    drive.push(part(hub,'#a7ada7',edge(p,-.032,.41).toArray(),rotation));
    if(i%6===0)drive.push(beam(edge(p,.02,.19).toArray(),edge(p,.47,.62).toArray(),.10,.095,red));
  }
  for(let z=portalZ+1.2;z<start.z-.35;z+=.93) {
    for(const line of [start,end]) {
      drive.push(part(horizontalRoller,'#2b3438',[line.x,line.y+.41,z],[0,Math.PI/2,0]));
      drive.push(part(hub,'#9ba19c',[line.x,line.y+.41,z],[0,Math.PI/2,0]));
    }
  }
  const column=new THREE.CylinderGeometry(.245,.285,center.y+.66-deck,16);
  const sleeve=new THREE.CylinderGeometry(.308,.308,.14,16);
  for(const z of [deckZ,center.z]) {
    drive.push(part(column,'#bc873b',[center.x,(deck+center.y+.66)/2,z]));
    drive.push(part(sleeve,'#9a773f',[center.x,deck+1.54,z]));
    drive.push(box(.83,.14,.83,'#777975',[center.x,deck+.07,z]));
    drive.push(box(end.x-start.x+.65,.30,.31,'#6c777c',[center.x,center.y+.68,z]));
    collide(grid,terminal,center.x,z,.55,.55,0,center.y+.67,deck);
  }
  layer(terminal,drive,{roughness:.58,metalness:.18});
  layer(terminal,floor,{side:THREE.DoubleSide},'stone');
}

function peakTerminal(scene, grid, lift) {
  const {x,z,yaw,surveyX,surveyZ,width:span,depth,datumOffset,deck,entryX,entryWidth,canopyDepth}=whistlerPeakTerminalSite(lift.def);
  const terminal = site(scene, 'PEAK 2 PEAK · Whistler terminal', x,z,yaw,heightAt(surveyX,surveyZ)+datumOffset);
  const w=span/2, d=depth/2, entryLeft=entryX-entryWidth/2, entryRight=entryX+entryWidth/2;
  const canopyTop=deck+2.96, canopyFront=d+canopyDepth;
  const platform=[], roof=[], structure=[], glass=[], windows=[], lights=[];
  const rng=mulberry32(2803);
  const upper = (x) => 9.7 - x * .115;

  platform.push(box(span-.18,.43,depth+.10,'#818783',[0,deck-.215,0]));
  const threshold=.92;
  pier(platform,terminal,entryX,d+threshold/2,entryWidth,threshold,deck,'#a0a5a1');
  structure.push(box(entryWidth-.02,.022,.19,'#929c9e',[entryX,deck+.011,d+.05]));
  const apronAt=peakApron(terminal,entryX,entryWidth,d+threshold,deck);
  for (const x of [-w+1.4, -6.75, 0, 6.75, w-1.4]) {
    for (const z of [-d+1.4, -12, 0, 12]) {
      const width=1.22, length=1.33, top=deck-.40;
      pier(platform, terminal, x, z, width,length,top,'#888d8d');
      collide(grid,terminal,x,z,width,length,0,top,groundFoot(terminal,x,z,width,length));
    }
  }
  for (const x of [-w+.22, w-.22]) {
    for (let z=-d+2.25; z<d; z+=4.5) {
      const base=groundFoot(terminal,x,z,.44,4.5);
      pier(platform,terminal,x,z,.44,4.501,deck-.38,'#888d8d');
      collide(grid,terminal,x,z,.44,4.5,0,deck,base);
    }
  }
  for (const [lo,hi] of [[-w,entryLeft],[entryRight,w]]) {
    const width=hi-lo,x=(lo+hi)/2;
    pier(platform,terminal,x,d,width,.36,deck+.24,'#848984');
    collide(grid,terminal,x,d,width,.32,0,canopyTop,groundFoot(terminal,x,d,width,.36));
    const count=Math.ceil(width/1.38), pane=width/count;
    for (let i=0;i<count;i++) {
      const x=lo+(i+.5)*pane;
      const tone=['#597989','#71909a','#63828c'][i%3];
      windows.push(box(pane-.088,2.30,.042,tone,[x,deck+1.42,d+.157]));
      structure.push(box(.091,2.34,.138,'#82949a',[lo+i*pane,deck+1.42,d+.19]));
      structure.push(box(.057,2.30,.043,'#a9b4b5',[lo+i*pane,deck+1.42,d+.278]));
    }
    for (const [y,thickness] of [[.25,.13],[1.16,.065],[2.58,.12]]) {
      structure.push(box(width,thickness,.22,'#9eaaac',[x,deck+y,d+.17]));
    }
    structure.push(box(width,.27,.23,'#a0a8a8',[x,deck+2.73,d+.16]));
  }

  // The plaza canopy shelters the front glazing and the low passenger opening.
  const canopyWidth=span+.35, canopyLeft=-canopyWidth/2, canopyRight=canopyWidth/2;
  const canopyBack=canopyTop+.13, canopyZ=(d+canopyFront)/2;
  const canopyCorners=[[canopyLeft,canopyBack,d],[canopyRight,canopyBack,d],
    [canopyRight,canopyTop,canopyFront+.12],[canopyLeft,canopyTop,canopyFront+.12]];
  panel(roof,...canopyCorners,'#777f80');
  terminal.add(createRoofSnow(canopyCorners,{depth:.15,seed:526,overhang:.09}),
    createIcicles(canopyCorners[3],canopyCorners[2],{seed:562,length:.26,spacing:.79}));
  structure.push(box(canopyWidth,.26,canopyDepth+.14,'#7f8c8e',[0,canopyTop-.135,canopyZ]));
  structure.push(box(canopyWidth+.10,.21,.16,'#b1b9ba',[0,canopyTop-.045,canopyFront+.09]));
  structure.push(box(canopyWidth+.10,.047,.22,'#66767a',[0,canopyTop-.163,canopyFront+.10]));
  // The outer corner cantilevers over the Roundhouse stair approach.
  // Its nearest bearing column stays on the station side of that route.
  for (const x of [-w+3.65,entryLeft-.22,entryRight+.22,w-.38]) {
    const z=canopyFront-.24, foot=groundFoot(terminal,x,z,.25,.28);
    structure.push(box(.25,canopyTop-foot,.28,'#8a9799',[x,(canopyTop+foot)/2,z]));
    collide(grid,terminal,x,z,.25,.28,0,canopyTop,foot);
  }
  for (const [x,side] of [[entryLeft,-1],[entryRight,1]]) {
    const leaf=1.11, center=x+side*leaf/2, z=d+.324;
    structure.push(box(.152,2.75,.17,'#a4b2b5',[x,deck+1.38,z]));
    structure.push(box(.083,2.45,.089,'#7d8e94',[x+side*leaf,deck+1.255,z+.056]));
    for(const y of [.08,1.0,2.45]) structure.push(box(leaf,.064,.09,'#889a9e',[center,deck+y,z+.058]));
    windows.push(box(leaf-.076,2.34,.04,'#89a5ad',[center,deck+1.26,z+.053]));
    structure.push(box(.035,.26,.061,'#a6adab',[x+side*.32,deck+1.01,z+.127]));
  }
  structure.push(box(entryWidth+2.35,.20,.24,'#6f7c80',[entryX,deck+2.58,d+.325]));
  structure.push(box(entryWidth-.15,.014,.82,'#474e50',[entryX,deck+.01,d-.58]));
  for (const x of [-9.2,entryX,9.2]) {
    lights.push(box(1.8,.042,.15,'#e1e2d3',[x,canopyTop-.27,d+1.1]));
  }

  // Angled blue upper curtain wall over the sheltered walkway.
  for (const xSide of [-1,1]) {
    const x = w*xSide;
    const tones = ['#275063','#305567','#2a5367','#365b6c'];
    const dz = depth/33;
    for (let i=0;i<33;i++) {
      const z0 = -d+i*dz, z1=z0+dz;
      const outward=xSide*.095;
      const y=upper(x);
      panel(glass,[x+outward,deck+1.62,z0],[x+outward,deck+1.62,z1],[x+outward,y,z1],[x+outward,y,z0],
        tones[Math.floor(rng()*tones.length)]);
      windows.push(box(.048,1.43,dz-.055,'#78919f',[x+outward,deck+.87,(z0+z1)/2]));
      structure.push(box(.080,y-deck,.125,'#6a8791',[x+outward,(y+deck)/2,z0]));
    }
    for (const y of [deck+.10,deck+1.62,6.51,7.48,8.37,9.54].filter(y=>y<upper(x))) {
      structure.push(box(.13,.09,depth+.13,frame,[x+xSide*.14,y,0]));
    }
  }
  for (let i=0;i<28;i++) {
    const x0=-w+span*i/28,x1=-w+span*(i+1)/28;
    const color=['#254a62','#315973','#2b5168','#2d566c'][Math.floor(rng()*4)];
    panel(glass,[x0,canopyTop,d+.09],[x1,canopyTop,d+.09],[x1,upper(x1),d+.09],[x0,upper(x0),d+.09],color);
    structure.push(box(.070,upper(x0)-canopyTop,.11,'#64818b',[x0,(upper(x0)+canopyTop)/2,d+.143]));
  }
  structure.push(box(span,.15,.18,'#c4cac9',[0,canopyTop+.14,d+.18]));
  for (const y of [7.25,8.29,9.33,10.37]) {
    const xEnd=Math.min(w,(9.67-y)/.115);
    structure.push(box(xEnd+w,.083,.12,'#a0b2b6',[(xEnd-w)/2,y,d+.14]));
  }
  sign(terminal,'THE DOUG FORSETH','CHAIR PLAZA',3.35,.71,[10.35,7.62,d+.25],'#586164');
  for(const side of [-1,1]) {
    const x=side*w;
    structure.push(box(.21,upper(x)-deck+.22,.19,'#aab6bd',[x,(upper(x)+deck)/2,d+.17]));
    structure.push(beam([x,upper(x)+.09,-d-.6],[x,upper(x)+.09,d+.39],.22,.23,'#c6ccd0'));
  }
  const topCorners=[[-w-.32,upper(-w)+.19,-d-.58],[w+.32,upper(w)+.19,-d-.58],
    [w+.32,upper(w)+.19,d+.58],[-w-.32,upper(-w)+.19,d+.58]];
  panel(roof,...topCorners,'#7a807d');
  terminal.add(createRoofSnow(topCorners,{depth:.24,seed:474,overhang:.12}),
    createIcicles(topCorners[1],topCorners[2],{seed:95,length:.48}));
  for(const z of [-d-.52,d+.55]) {
    structure.push(beam([-w-.37,upper(-w)+.08,z],[w+.36,upper(w)+.08,z],.22,.3,'#bac3c8'));
  }
  // Tapered roof trusses and service purlins are visible from the loading floor.
  for(let z=-d+1.4;z<d;z+=4.75) {
    structure.push(box(span-.5,.17,.19,'#88908b',[0,8.07,z]));
    structure.push(beam([-w+.25,upper(-w)-.16,z],[w-.25,upper(w)-.16,z],.22,.23,'#9aa19d'));
    for(let x=-w+.45;x<w-.6;x+=3.13) {
      structure.push(beam([x,8.08,z],[x+1.5,upper(x+1.5)-.17,z],.085,.077,'#899395'));
    }
    for(const x of [-9.7,1.1,9.6]) {
      lights.push(box(1.25,.077,.16,'#ddddc8',[x,7.93,z]));
    }
  }
  for(let x=-w+.20;x<w;x+=1.76) {
    structure.push(box(.079,.115,depth,'#757e7e',[x,upper(x)-.08,0]));
  }
  terminalMachinery(terminal,grid,lift,deck,-d);
  const operator=controlBooth(terminal,grid,4.65,d-4.75,deck);
  for(const x of [entryX-1.04,entryX+1.04]){
    scannerGate(terminal,structure,x,deck,d-1.7);
    collide(grid,terminal,x,d-1.7,.27,.30,0,deck+1.34,deck-.02);
  }
  sign(terminal,'GONDOLA ENTRANCE','TICKET SCAN',3.35,.56,[entryX,canopyTop-.40,canopyFront+.16],'#344e59');
  // The open ropeway bays sit under a continuous ribbed metal end wall.
  const portal=-d-.06, lintel=8.22;
  for (const x of [-w,-7.72,-1.46,7.25,w]) {
    structure.push(box(.42,upper(x)-deck,.47,slate,[x,(upper(x)+deck)/2,portal]));
  }
  for(let x0=-w;x0<w;x0+=.275) {
    const x1=Math.min(w,x0+.265), top=Math.max(lintel+.005,upper(x1));
    const color=Math.round((x0+w)/.275)%2?'#a5afb2':'#aeb8bb';
    structure.push(box(x1-x0,top-lintel,.12,color,[(x0+x1)/2,(top+lintel)/2,portal]));
  }
  structure.push(box(12.25,.29,.59,'#79868c',[-7.56,lintel-.11,portal]));
  structure.push(box(w+1.46,.55,.21,'#929d9f',[(w-1.46)/2,deck+.275,portal]));
  for(const [lo,hi] of [[-1.3,7.04],[7.46,w-.22]]) {
    const count=Math.ceil((hi-lo)/1.45), bay=(hi-lo)/count;
    for(let i=0;i<count;i++) {
      const x=lo+(i+.5)*bay;
      windows.push(box(bay-.082,upper(x)-deck-.72,.042,'#748e96',[x,(upper(x)+deck+.72)/2,portal]));
      structure.push(box(.07,upper(x)-deck-.52,.09,'#788e96',[lo+i*bay,(upper(x)+deck+.52)/2,portal]));
    }
  }
  sign(terminal,'PEAK 2 PEAK','',8.48,1.76,[-6.45,8.19,d+.28],'#b91f35',{peakBadge:true});
  sign(terminal,'PEAK 2 PEAK','',8.6,1.82,[-w-.235,7.82,4.3],'#b91f35',{peakBadge:true,yaw:-Math.PI/2});
  sign(terminal,'GONDOLA','TO BLACKCOMB',3.2,.76,[-5.4,deck+1.35,d+.312],'#233f50');
  layer(terminal,platform,{},'stone');
  layer(terminal,structure,{roughness:.60,metalness:.11});
  layer(terminal,roof,{roughness:.8,side:THREE.DoubleSide});
  const lightMesh=mergedMesh(lights);
  lightMesh.castShadow=false;
  lightMesh.material.emissive.set('#d6ddcf'); lightMesh.material.emissiveIntensity=.49;
  terminal.add(lightMesh);
  const glazing = new THREE.Mesh(mergeParts(glass, true),
    surfaceMaterial('glass', { vertexColors:true, side:THREE.DoubleSide, roughness:.36, metalness:.05,
      transparent:true, opacity:.77, depthWrite:false }));
  glazing.renderOrder=1;
  terminal.add(glazing);
  layer(terminal,windows,{transparent:true,opacity:.39,depthWrite:false,roughness:.32},'glass');
  for(const side of [-1,1]) collide(grid,terminal,side*w,0,.24,depth+.2,0,upper(side*w),deck-.06);
  collide(grid,terminal,0,d+.09,span,.16,0,upper(-w),canopyTop);
  const c=Math.cos(yaw), s=Math.sin(yaw), level=terminal.position.y+deck;
  function local(x,z) {
    const dx=x-terminal.position.x,dz=z-terminal.position.z;
    return {u:dx*c-dz*s,v:dx*s+dz*c};
  }
  const interior = { id: 'peak-to-peak-whistler', kind: 'lift-terminal' };
  return { operator, interiorAt(x,z,y) {
    if (y < level - .28 || y > level + 3.6) return null;
    const { u, v } = local(x,z);
    return u >= -w && u <= w && v >= -d && v <= d ? interior : null;
  }, walkSurfaceAt(x,z,y) {
    const {u,v}=local(x,z);
    if(v>d+threshold) return apronAt(u,v,x,z);
    if(y<level-.7)return null;
    if(u>=entryLeft&&u<=entryRight&&v>=d)return level;
    if(u>=-w+.09&&u<=w-.09&&v<=d&&v>=-d)return level;
    return null;
  } };
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

export function buildRoundhouseArrival(scene, grid, lifts) {
  const villageLift = LIFTS.find(({id}) => id === VILLAGE_GONDOLA_UPPER);
  const peakLift = lifts.lifts.find(({def}) => def.id === PEAK_TO_PEAK);
  lodge(scene,grid);
  const village=villageTerminal(scene,grid,villageLift);
  const peak=peakTerminal(scene,grid,peakLift);
  const olympic=olympicRings(scene,grid);
  umbrellaBar(scene,grid);
  const ridge=ridgeView(scene,grid);
  return { update:plazaFixtures(scene,grid), operators:[village.operator,peak.operator],
    raisedPadAt:peak.walkSurfaceAt,
    peakInteriorAt: peak.interiorAt,
    walkSurfaceAt(x,z,y) { return olympic(x,z,y)??peak.walkSurfaceAt(x,z,y)??village.walkSurfaceAt(x,z,y)??ridge(x,z,y); } };
}
