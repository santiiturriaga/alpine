import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { climateUniforms } from './climate-state.js';
import { makeCanvas, canvasTexture, mulberry32 } from './util.js';
import { detailedMaterial } from './plaza-materials.js';

// Hand-traced from the user's Peak photograph. Coordinates refer to a
// 900 × 1110 study crop, not to a symmetrical construction kit. The shallow
// grooves and all texture pixels below are generated; no photograph is used
// as a gameplay texture.
export const PEAK_STONE_OUTLINES = [
  { name:'left leg', depth:.45, outline:[[196,610],[302,614],[329,653],[343,1078],[326,1091],[201,1100],[181,1087],[170,1028],[185,934],[164,838],[170,714]],
    cracks:[[[.26,.02],[.36,.16],[.29,.34],[.24,.48],[.32,.60],[.29,.75],[.44,.91]],[[.82,.10],[.86,.29],[.78,.45],[.90,.62],[.84,.79],[.93,.96]],[[.05,.42],[.18,.48],[.24,.55],[.15,.66]]] },
  { name:'right leg', depth:.48, outline:[[607,614],[734,605],[766,630],[779,759],[780,849],[808,995],[786,1009],[608,1007],[590,986],[582,807],[588,688]],
    cracks:[[[.08,.11],[.40,.12],[.48,.10],[.76,.12]],[[.09,.20],[.35,.21],[.44,.19],[.78,.21]],[[.17,.37],[.26,.45],[.24,.56],[.33,.62]],[[.75,.44],[.64,.49],[.61,.61],[.49,.71],[.53,.83]],[[.11,.70],[.20,.79],[.18,.95]]] },
  { name:'torso', depth:.51, outline:[[246,414],[712,412],[738,461],[754,568],[735,595],[586,609],[315,612],[203,601],[183,581],[180,526],[193,474],[212,438]],
    cracks:[[[.08,.21],[.12,.36],[.10,.58],[.17,.65],[.18,.90]],[[.28,.27],[.24,.40],[.25,.58],[.22,.69],[.28,.84],[.30,.99]],[[.67,.61],[.62,.65],[.61,.82],[.59,.97]],[[.83,.28],[.87,.42],[.86,.61],[.92,.72],[.96,.73]],[[.36,.05],[.37,.19],[.41,.25]]] },
  { name:'arm lintel', depth:.50, outline:[[73,225],[249,226],[338,235],[421,230],[567,226],[648,219],[805,227],[855,240],[890,260],[814,402],[714,409],[592,402],[460,405],[242,404],[146,413],[76,411],[38,394],[28,369],[37,303],[49,259]],
    cracks:[[[.26,.04],[.24,.15],[.24,.40],[.255,.57],[.26,.81],[.26,.98]],[[.01,.67],[.13,.73],[.20,.69],[.24,.74]],[[.12,.61],[.17,.56],[.18,.51],[.24,.44]],[[.32,.54],[.36,.57],[.38,.67],[.42,.70]],[[.62,.79],[.67,.89],[.73,.84],[.78,.87]],[[.32,.95],[.50,.93],[.64,.96],[.79,.93]]],
    stains:[[.444,.025,.018,.71],[.474,.02,.014,.24],[.503,.02,.015,.31],[.586,.02,.009,.28],[.750,.03,.020,.34],[.794,.04,.018,.61],[.832,.06,.012,.22]] },
  { name:'head', depth:.43, outline:[[400,42],[536,41],[554,57],[568,214],[558,226],[417,224],[393,196]],
    cracks:[[[.58,.71],[.61,.77],[.60,.84],[.66,.92]],[[.13,.92],[.34,.95],[.47,.93],[.66,.97],[.94,.94]]], stains:[[.49,.48,.025,.026],[.70,.89,.12,.07]] },
];

const SCALE=.0031;
export const PEAK_STONE_SITE = { x: -264.4, z: 5950.4, yaw: -.49 };
// OSM artwork node 6629902959, on the ridge behind the lodge.
export const ROUNDHOUSE_STONE_SITE = { x: 478.6, z: 4726, yaw: .65 };
const toLocal=([x,y])=>[(x-450)*SCALE,(1100-y)*SCALE];
const worldPoint=(point)=>new THREE.Vector3(...point).applyAxisAngle(new THREE.Vector3(0,1,0),-.49)
  .add(new THREE.Vector3(-264.4,heightAt(-264.4,5950.4)-.025,5950.4)).toArray();
// Terrain is populated after module evaluation. Resolve elevation only when
// opening the view so a static import cannot freeze the camera at sea level.
export const INUKSHUK_VIEW={
  get eye(){return worldPoint([.17019,1.76195,7.57119]);},
  get target(){return worldPoint([.16839,1.90617,0]);},
  fov:54.99,aspect:.75,
};
export const INUKSHUK_START={x:-267.81303378905574,z:5957.1604055356875,heading:2.6740667429,holdAtUnload:true};
const hash=(x,y,seed=0)=>{
  let n=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(seed,69069);
  n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;
};
function noise(x,y,seed) {
  const ix=Math.floor(x),iy=Math.floor(y);let a=x-ix,b=y-iy;
  a=a*a*(3-2*a);b=b*b*(3-2*b);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iy,seed),hash(ix+1,iy,seed),a),
    THREE.MathUtils.lerp(hash(ix,iy+1,seed),hash(ix+1,iy+1,seed),a),b);
}

const stoneMaterials=new Map();
let edgeMaterial;
function stoneEdgeMaterial() {
  if(edgeMaterial)return edgeMaterial;
  edgeMaterial=detailedMaterial('granite');edgeMaterial.vertexColors=false;
  edgeMaterial.color.set('#7d8076');edgeMaterial.name='Three-dimensional fractured rock on slab edges';
  return edgeMaterial;
}
function stoneMaterial(def,index) {
  if(stoneMaterials.has(index))return stoneMaterials.get(index);
  const p=def.outline.map(toLocal),xs=p.map(v=>v[0]),ys=p.map(v=>v[1]);
  const w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);
  const W=Math.min(1536,Math.max(384,Math.round(720*w))),H=Math.min(1536,Math.max(384,Math.round(720*h)));
  const {canvas,ctx}=makeCanvas(W,H),data=ctx.createImageData(W,H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
    const u=x/W,v=y/H;
    const broad=noise(u*w*5,v*h*5,index+17),flake=noise(u*w*33,v*h*27,index+81);
    const grain=noise(u*w*210,v*h*210,index+119),fine=hash(x,y,index+53);
    const foliation=noise(u*w*18+v*h*3,v*h*47,index+19);
    const value=126+(broad-.5)*27+(flake-.5)*22+(grain-.5)*29+(fine-.5)*23+(foliation-.5)*10;
    const off=(y*W+x)*4;
    data.data[off]=value+1;data.data[off+1]=value+2;data.data[off+2]=value-4;data.data[off+3]=255;
  }
  ctx.putImageData(data,0,0);
  const rng=mulberry32(7463+index);
  // Small feldspar/quartz inclusions interrupt the fine, dark mineral grain.
  for(let i=0;i<W*H*.018;i++) {
    ctx.fillStyle=rng()<.57?'rgba(41,45,41,.18)':'rgba(220,219,204,.28)';
    const r=.4+rng()*1.25;ctx.fillRect(rng()*W,rng()*H,r,r*(.65+rng()));
  }
  function stroke(path,color,width,dx=0,dy=0) {
    ctx.beginPath();path.forEach(([u,v],i)=>i?ctx.lineTo(u*W+dx,v*H+dy):ctx.moveTo(u*W+dx,v*H+dy));
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='miter';ctx.stroke();
  }
  const plates=[
    [[[.11,.05],[.40,.03],[.51,.23],[.44,.52],[.25,.63],[.12,.45]],[[.80,.15],[.96,.19],[.91,.86],[.76,.98],[.79,.64]]],
    [[[.07,.02],[.18,.01],[.24,.66],[.18,.97],[.06,.98]],[[.42,.45],[.69,.40],[.60,.67],[.48,.87],[.47,.62]]],
    [[[.06,.26],[.18,.28],[.12,.58],[.22,.67],[.18,.89],[.05,.85]],[[.24,.38],[.28,.27],[.25,.58],[.30,.64],[.23,.72]],[[.67,.61],[.65,.68],[.60,.93],[.72,.96],[.78,.79]],[[.81,.26],[.88,.39],[.89,.62],[.95,.66],[.97,.42]]],
    [[[.255,.05],[.24,.16],[.24,.42],[.26,.58],[.275,.76],[.285,.36]],[[.30,.49],[.38,.60],[.39,.70],[.34,.66]],[[.03,.75],[.19,.82],[.26,.78],[.25,.95],[.08,.96]],[[.32,.91],[.53,.91],[.65,.94],[.84,.90],[.85,.99],[.33,.99]]],
    [[[.13,.89],[.34,.93],[.51,.90],[.66,.93],[.98,.89],[.98,1],[.14,1]]],
  ];
  for(const polygon of plates[index]) {
    ctx.beginPath();polygon.forEach(([u,v],i)=>i?ctx.lineTo(u*W,v*H):ctx.moveTo(u*W,v*H));ctx.closePath();
    ctx.fillStyle='rgba(40,43,37,.30)';ctx.fill();ctx.strokeStyle='rgba(188,185,168,.30)';ctx.lineWidth=1.7;ctx.stroke();
  }
  // Photo-specific joints: the lintel's left plate separation, torso flakes,
  // right leg's transverse lines, and the long split along the left leg.
  for(const path of def.cracks) {
    stroke(path,'rgba(54,55,44,.32)',Math.max(2,W*.0037));
    stroke(path,'rgba(43,45,36,.70)',Math.max(.8,W*.00145));
    stroke(path,'rgba(208,204,184,.45)',Math.max(.8,W*.0011),1.3,-1.2);
  }
  // Olive lichen/drainage is concentrated below the lintel's upper ledge.
  for(const [u,v,r,length] of def.stains||[]) {
    ctx.beginPath();ctx.moveTo((u-r)*W,v*H);
    const steps=18;
    for(let j=0;j<=steps;j++) {
      const t=j/steps,edge=r*(1-t*.72)*(1+.32*Math.sin(j*3.8+u*11));
      ctx.lineTo((u+edge)*W,(v+t*length)*H);
    }
    for(let j=steps;j>=0;j--) {
      const t=j/steps,edge=r*(1-t*.72)*(1+.37*Math.sin(j*2.1+v*39));
      ctx.lineTo((u-edge)*W,(v+t*length)*H);
    }
    ctx.closePath();ctx.fillStyle='rgba(57,59,35,.77)';ctx.fill();
  }
  const map=canvasTexture(canvas);map.anisotropy=8;
  const material=new THREE.MeshStandardMaterial({map,bumpMap:map,bumpScale:.024,roughness:.97,color:0xe0e0d7});
  material.name='Procedural fissured summit stone · '+def.name;
  stoneMaterials.set(index,material);return material;
}

function segmentDistance(x,y,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=THREE.MathUtils.clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1);
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
}

function stoneGeometry(def,index,roundhouse) {
  const points=def.outline.map(toLocal);
  // Roundhouse has a broader, lower head and a narrower leg opening in the
  // official rear-lodge reference; it is not a duplicate of Peak's statue.
  if(roundhouse)for(const p of points) {
    p[0]*=index===4?1.12:.94;
    if(index===0)p[0]+=.07;if(index===1)p[0]-=.07;
    if(index===4)p[1]=2.72+(p[1]-2.72)*.86;
  }
  const shape=new THREE.Shape(points.map(v=>new THREE.Vector2(...v)));
  const base=new THREE.ExtrudeGeometry(shape,{depth:def.depth,bevelEnabled:true,bevelThickness:.027,bevelSize:.025,bevelSegments:2,steps:1,curveSegments:1});
  base.translate(0,0,-def.depth/2);
  base.computeBoundingBox();const bounds=base.boundingBox,size=bounds.getSize(new THREE.Vector3());
  const source=base.index?base.toNonIndexed():base;
  const pos=source.attributes.position,frontVertices=[],frontUvs=[],edgeVertices=[],edgeUvs=[];
  const splits=[];
  for(const line of def.cracks)for(let i=1;i<line.length;i++)splits.push([line[i-1],line[i]]);
  function emit(a,b,c,level=0) {
    const ab=a.distanceTo(b),bc=b.distanceTo(c),ca=c.distanceTo(a);
    if(Math.max(ab,bc,ca)>.105&&level<7) {
      const mid=(p,q)=>p.clone().add(q).multiplyScalar(.5);
      const d=mid(a,b),e=mid(b,c),f=mid(c,a);
      emit(a,d,f,level+1);emit(d,b,e,level+1);emit(f,e,c,level+1);emit(d,e,f,level+1);return;
    }
    const normal=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
    const front=Math.abs(normal.z)>.85,vertices=front?frontVertices:edgeVertices,uvs=front?frontUvs:edgeUvs;
    for(const p of [a,b,c]) {
      const u=(p.x-bounds.min.x)/size.x,v=1-(p.y-bounds.min.y)/size.y;
      const onFace=Math.abs(p.z)>=def.depth*.49;
      let carve=0;
      if(onFace)for(const [a,b]of splits) {
        const d=segmentDistance(u,v,a,b);
        carve+=Math.max(0,1-d/.006)*.010;
      }
      const rough=(noise(p.x*37,p.y*37,index+4)-.5)*.010+(noise(p.x*12,p.y*12,index+8)-.5)*.026;
      const z=p.z+Math.sign(p.z)*(rough-carve)*(onFace?1:.3);
      vertices.push(p.x,p.y,z);uvs.push(u,1-v);
    }
  }
  for(let i=0;i<pos.count;i+=3)emit(new THREE.Vector3().fromBufferAttribute(pos,i),new THREE.Vector3().fromBufferAttribute(pos,i+1),new THREE.Vector3().fromBufferAttribute(pos,i+2));
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([...frontVertices,...edgeVertices],3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute([...frontUvs,...edgeUvs],2));
  geometry.addGroup(0,frontVertices.length/3,0);geometry.addGroup(frontVertices.length/3,edgeVertices.length/3,1);
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  base.dispose();if(source!==base)source.dispose();return geometry;
}

let snowMaterial;
function rimeMaterial() {
  if(snowMaterial)return snowMaterial;
  snowMaterial=new THREE.MeshStandardMaterial({color:0xe6edf2,roughness:.96});
  snowMaterial.onBeforeCompile=shader=>{
    shader.uniforms.inukSnowpack=climateUniforms.snowpack;
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float inukSnowpack;')
      .replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nif(inukSnowpack<.22)discard;');
  };
  snowMaterial.customProgramCacheKey=()=> 'inuk-irregular-rime-v1';return snowMaterial;
}

function rimeRibbon(parent,points,seed,radius=.035) {
  const rng=mulberry32(seed),rings=[],vertices=[],indices=[];
  for(let k=1;k<points.length;k++) {
    const a=new THREE.Vector3(...points[k-1]),b=new THREE.Vector3(...points[k]);
    const steps=Math.ceil(a.distanceTo(b)/.023);
    for(let i=0;i<steps;i++)rings.push(a.clone().lerp(b,i/steps));
  }
  rings.push(new THREE.Vector3(...points[points.length-1]));
  for(let i=0;i<rings.length;i++) {
    const p=rings[i],r=radius*(.57+rng()*.91);
    for(let j=0;j<7;j++) {
      const angle=j/7*Math.PI*2;
      vertices.push(p.x+Math.cos(angle)*r,p.y+(rng()-.5)*r*.65,p.z+Math.sin(angle)*r*.82);
      if(i&&j<7){const a=i*7+j,b=(i-1)*7+j,c=(i-1)*7+(j+1)%7,d=i*7+(j+1)%7;indices.push(a,b,c,a,c,d);}
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,rimeMaterial());mesh.castShadow=mesh.receiveShadow=true;mesh.name='Wind-grown rime · broken feather edge';parent.add(mesh);
}

function snowBank(parent) {
  const vertices=[],indices=[],rings=12,segments=64;
  parent.updateMatrixWorld(true);
  for(let r=0;r<=rings;r++)for(let j=0;j<=segments;j++) {
    const a=j/segments*Math.PI*2,t=r/rings;
    const radius=t*1.55*(1+.035*Math.sin(a*7)+.023*Math.sin(a*13));
    const x=Math.cos(a)*radius,z=Math.sin(a)*radius*.64;
    const world=parent.localToWorld(new THREE.Vector3(x,0,z));
    const drift=(.078+.27*Math.exp(-((x-.61)**2/.21+z*z/.15)))*(1-t*t)**2;
    const pock=(noise(x*29,z*29,641)-.5)*.021*(1-t);
    vertices.push(x,heightAt(world.x,world.z)-parent.position.y+.012+drift+pock,z);
    if(r<rings&&j<segments){const a=r*(segments+1)+j,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,rimeMaterial());mesh.receiveShadow=true;mesh.name='Scuffed asymmetric snow footing';parent.add(mesh);
}

export function buildInukshuk(scene,x,z,yaw,name,variant='peak') {
  const group=new THREE.Group(),roundhouse=variant==='roundhouse';
  group.name=name;group.position.set(x,heightAt(x,z)-.025,z);group.rotation.y=yaw;
  group.userData.landmark={variant,stoneCount:5,source:'user Peak photo; Roundhouse silhouette checked against Tourism Whistler',front:[0,0,1]};
  PEAK_STONE_OUTLINES.forEach((def,index)=>{
    const stone=new THREE.Mesh(stoneGeometry(def,index,roundhouse),[stoneMaterial(def,index),stoneEdgeMaterial()]);
    // The torso sits behind the long lintel, exposing a broken undercut seam.
    if(index===2){stone.position.z=-.072;stone.position.y=-.026;}
    if(index===3)stone.position.z=.028;
    stone.name=name+' · '+def.name;stone.castShadow=stone.receiveShadow=true;group.add(stone);
  });
  // The reference has frost only on windward edges and two broken upper
  // ledges, with exposed rock between them. Each ribbon is a rough volume.
  const path=(p,index=3)=>p.map(([x,y])=>{
    const point=toLocal([x,y]);
    if(roundhouse){point[0]*=index===4?1.12:.94;if(index===0)point[0]+=.07;if(index===1)point[0]-=.07;if(index===4)point[1]=2.72+(point[1]-2.72)*.86;}
    return [...point,index===2?.235:.300];
  });
  rimeRibbon(group,path([[400,48],[391,86],[391,144],[393,194],[408,219],[374,226],[350,225]],4),91,.030);
  rimeRibbon(group,path([[72,235],[53,275],[40,328],[29,369],[39,394],[73,411]]),93,.036);
  rimeRibbon(group,path([[236,408],[218,438],[196,487],[180,530],[183,571],[195,601],[196,633]],2),95,.028);
  rimeRibbon(group,path([[186,928],[178,987],[177,1035],[185,1084]],0),98,.024);
  rimeRibbon(group,path([[647,222],[680,226],[711,225],[746,227],[782,230],[817,232],[839,241]]),94,.027);
  rimeRibbon(group,path([[601,610],[619,611],[635,607]],1),100,.026);
  scene.add(group);snowBank(group);return group;
}
