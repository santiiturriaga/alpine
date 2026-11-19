import * as THREE from 'three';
import { canvasTexture, makeCanvas, mulberry32 } from './util.js';

function barkMap() {
  const {canvas,ctx}=makeCanvas(384,640);
  const rand=mulberry32(14134);
  ctx.fillStyle='#514c43';
  ctx.fillRect(0,0,384,640);
  for(let i=0;i<1850;i++){
    const x=rand()*384, y=rand()*720-80, h=5+rand()**1.5*73, w=1+rand()**1.7*11;
    const r=88+rand()*37, bend=(rand()-.5)*5;
    ctx.fillStyle=`rgb(${r},${r*.94},${r*.82})`;
    ctx.beginPath();ctx.moveTo(x,y);
    ctx.bezierCurveTo(x+w*.63,y+h*.12,x+w*.34+bend,y+h*.74,x+bend,y+h);
    ctx.bezierCurveTo(x-w*.26+bend,y+h*.64,x-w*.54,y+h*.35,x,y);
    ctx.fill();
    if(w>5){
      ctx.strokeStyle='rgba(190,181,158,.34)';ctx.lineWidth=.6;
      ctx.beginPath();ctx.moveTo(x+.4,y+h*.12);
      ctx.quadraticCurveTo(x+w*.4,y+h*.41,x+w*.15+bend,y+h*.73);ctx.stroke();
    }
  }
  for(let i=0;i<12500;i++){
    const x=rand()*384,y=rand()*640;
    ctx.fillStyle=i%3?'#c9b99527':'#252b2844';
    ctx.fillRect(x,y,.4+rand()*1.3,.5+rand()*3.9);
  }
  return canvasTexture(canvas,{repeat:[1,6]});
}

// Each atlas tile contains a single fork down to its needles. The branch
// meshes carry the shape and the hanging leaders in three dimensions.
function foliageMap() {
  const cell = 384;
  const { canvas, ctx } = makeCanvas(cell * 2, cell * 2);
  for (let tile = 0; tile < 4; tile++) {
    const rand = mulberry32(5151 + tile * 829);
    ctx.save();
    ctx.translate((tile & 1) * cell, (tile >> 1) * cell);
    ctx.scale(cell / 512, cell / 512);
    ctx.lineCap = 'round';
    const stroke = (ax,ay,bx,by,width,color) => {
      ctx.strokeStyle=color; ctx.lineWidth=width;
      ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
    };
    const greens = ['#324d41','#3d5844','#47654e','#546c4e','#668167'];
    const snowy = tile === 0 ? .07 : tile === 1 ? .33 : tile === 2 ? .64 : .87;
    function twig(x,y,angle,length,depth) {
      const ux=Math.sin(angle), uy=-Math.cos(angle), bend=(rand()-.5)*.13;
      const dx=ux*length, dy=uy*length;
      const at=t=>[x+dx*t-uy*bend*length*t*t, y+dy*t+ux*bend*length*t*t];
      const [ex,ey]=at(1);
      stroke(x,y,ex,ey,depth === 2 ? 4.3 : depth ? 2.4 : 1.3, depth ? '#5c5749' : '#46614d');
      if (depth) {
        const pairs=depth === 2 ? 13 : 6;
        for (let side of [-1,1]) {
          for (let k=0;k<pairs;k++) {
            const t=(.7+k+rand()*.5)/(pairs+1);
            const bias=1-Math.pow(t,.9)*.85;
            const reach=length*(depth === 2 ? .49 : .41)*(.75+rand()*.30)*bias;
            const [bx,by]=at(t);
            twig(bx,by,angle+side*(.49+rand()*.32),reach,depth-1);
          }
        }
        if (depth===1 && rand() < snowy) {
          // Packed snow connects adjacent shoots; the underside and the
          // extreme tips still show through.
          const start=.12+rand()*.10, end=.70+rand()*.14;
          const width=length*(.035+snowy*.060);
          const lumps=7;
          for(let i=0;i<lumps;i++){
            const t=start+(end-start)*i/lumps;
            const next=start+(end-start)*(i+1)/lumps;
            const [ax,ay]=at(t),[bx,by]=at(next);
            const cap=1+width*(1-.56*t)*(.81+rand()*.3);
            stroke(ax,ay,bx,by,cap*2.4,'#82989a');
            stroke(ax-1.2,ay-.9,bx-.9,by-1.3,cap*2.12,'#c8d6d7');
            stroke(ax-.7,ay-1.4,bx-1.4,by-1.7,cap*1.45,'#e4e9e5');
          }
        }
      } else {
        const count=Math.max(4, Math.ceil(length*.76));
        const frost = rand() < snowy*.63;
        for(let k=0;k<count;k++){
          const t=(k+rand())/count, [ax,ay]=at(t);
          for (const side of [-1,1]) {
            const spread=side*(2.4+rand()*4.5)*(1-.48*t);
            const along=2.2+rand()*4.8;
            stroke(ax,ay,ax+ux*along-uy*spread,ay+uy*along+ux*spread,
              1.25+rand()*.87,greens[Math.floor(rand()*greens.length)]);
          }
        }
        if(frost && length>5) {
          // A broken mantle leaves the tips and shaded fringe exposed.
          const from=.12+rand()*.22, to=.63+rand()*.24, [ax,ay]=at(from), [bx,by]=at(to);
          const w=2.5+rand()*4.2;
          stroke(ax,ay,bx,by,w+1.4,'#879d9f');
          stroke(ax-.5,ay-.7,bx-.6,by-1,w,rand()>.42?'#d6e2df':'#c0d0cd');
        }
      }
    }
    twig(255,493,(rand()-.5)*.051,467,2);
    ctx.restore();
  }
  return canvasTexture(canvas);
}

function foliage(detail, seed) {
  const rand=mulberry32(seed);
  const points=[], normals=[], uv=[], colors=[], indices=[];
  const tau=2*Math.PI;
  const whorls=13;
  const skirt=.16+rand()*.09, spread=.17+rand()*.04;
  const lean=(rand()-.5)*.05;
  const mainSteps=detail===2?3:2;
  // Each fork is curved along its length and across its rib. Matching the
  // entire main skeleton between detail tiers keeps the outline in place.
  function spray(x,y,z,yaw,length,width,drop,roll,tile,tint,fork=false) {
    const alongSteps=fork?2:mainSteps;
    const cols=fork||detail===0?2:3;
    const dx=Math.cos(yaw), dz=Math.sin(yaw);
    const first=points.length/3;
    for(let i=0;i<=alongSteps;i++){
      const t=i/alongSteps;
      for(let j=0;j<cols;j++){
        const side=2*j/(cols-1)-1;
        const cross=side*width;
        const arch=length*(.16*Math.sin(Math.PI*t)-drop*t*t);
        const blanket=width*((cols===3?.37*Math.abs(side):.13)+side*roll)*(.3+.7*Math.sin(Math.PI*t));
        points.push(x+dx*t*length-dz*cross,y+arch-blanket,z+dz*t*length+dx*cross);
        const lift= .79, nx=dx*(drop*t-.10)+dz*side*.32, nz=dz*(drop*t-.10)-dx*side*.32;
        const norm=Math.hypot(nx,lift,nz);
        normals.push(nx/norm,lift/norm,nz/norm);
        colors.push(tint*.98,tint,tint*.98);
        uv.push(((tile & 1)+.012+j/(cols-1)*.976)/2, (1-(tile>>1)+.015+t*.97)/2);
        if (i && j) {
          const v=first+i*cols+j;
          indices.push(v-cols-1,v-cols,v-1,v-cols,v,v-1);
        }
      }
    }
  }
  const firstAngle=rand()*tau;
  for(let level=0;level<whorls;level++){
    const t=level/(whorls-1), y=skirt+t*(.985-skirt);
    const n=t>.88?4:6;
    const phase=firstAngle+level*2.399+rand()*.65;
    for(let b=0;b<n;b++){
      const yaw=phase+b*tau/n+(rand()-.5)*.33;
      const length=spread*(.08+.92*(1-t)**.78)*(.76+rand()*.41);
      const h=y+(rand()-.5)*.041*(1-.66*t);
      const x=lean*h*h, z=.009*Math.sin(h*6);
      const droop=.11+rand()*.32;
      const roll=(rand()-.5)*.6;
      const tile=Math.floor(rand()*4);
      const tint=.80+.18*t+.11*rand();
      spray(x,h,z,yaw,length,length*.49,droop,roll,tile,tint);
      // Branch ends carry short lateral leaders below and beside the parent.
      for(const side of [-1,1]){
        const a=.27+rand()*.19, bend=.51+rand()*.35, forkLength=length*(.51+rand()*.20);
        const forkTile=Math.floor(rand()*4);
        if(detail===0 || detail===1 && (level+b+(side===1?1:0))%2)continue;
        spray(x+Math.cos(yaw)*a*length,h+length*(.14*Math.sin(a*Math.PI)-droop*a*a),
          z+Math.sin(yaw)*a*length,yaw+side*bend,forkLength,forkLength*.47,droop+.18,side*.48,forkTile,tint*.94,true);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  for(const [name,data,n] of [['position',points,3],['normal',normals,3],['uv',uv,2],['color',colors,3]]) {
    geometry.setAttribute(name,new THREE.Float32BufferAttribute(data,n));
  }
  geometry.setIndex(indices);
  return geometry;
}

export function sledTreeAssets() {
  const trunk = new THREE.CylinderGeometry(.0015, .043, .99, 12, 10);
  // Concentrate the lowest two rings around the snow line for root flare.
  const position = trunk.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i) + .465, z = position.getZ(i);
    const rootFlare = 1 + (.28 + .22 * Math.sin(Math.atan2(z, x) * 5)) * Math.exp(-Math.max(0, y) * 29);
    position.setXYZ(i, x * rootFlare + .012 * y * y, y, z * rootFlare);
  }
  trunk.computeVertexNormals();
  return {
    trunk,
    trunkMaterial: new THREE.MeshStandardMaterial({ map: barkMap(), roughness: .94 }),
    needleMaterial: new THREE.MeshStandardMaterial({ emissive: 0x17221d, emissiveIntensity: .45, map: foliageMap(), vertexColors: true, side: THREE.DoubleSide, alphaTest: .22, alphaToCoverage: true, roughness: .96 }),
    crowns: [255822, 98521, 7339].map(seed => ({ full:foliage(2,seed), medium:foliage(1,seed), distant:foliage(0,seed) })),
  };
}
