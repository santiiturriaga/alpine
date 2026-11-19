import * as THREE from 'three';
import { mulberry32, smoothstep } from './util.js';
import { climateUniforms } from './climate-state.js';
import { compactDevice } from './device-budget.js';
import { attachChaseFoliage } from './chase-foliage.js';

const TAU=Math.PI*2, variants=3, geometryCache=new Map();
const profiles={
  BUDGET:{start:14,end:30,budget:19,far:1900},
  LOW:{start:17,end:35,budget:28,far:2100},
  BALANCED:{start:23,end:51,budget:72,far:2900},
  HIGH:{start:29,end:65,budget:112,far:3600},
  MAX:{start:42,end:94,budget:192,far:4800},
};
const species={
  birch:{seed:6193,spread:.27,bark:0xc6c7bc,twig:0x514b43,leaf:0x718349,fall:0xc6a34b},
  aspen:{seed:2503,spread:.22,bark:0xbfc3ad,twig:0x575347,leaf:0x7e9250,fall:0xd4b744},
  neutral:{seed:9817,spread:.29,bark:0x989181,twig:0x534e42,leaf:0x657a48,fall:0xa98a4b},
};
const pose=new THREE.Object3D(), eye=new THREE.Vector3(), up=new THREE.Vector3(0,1,0);
const _a=new THREE.Vector3();
const ATLAS_TILE_W=128,ATLAS_TILE_H=256;
let branchAtlas,leafAtlas;
let atlasLoad;
const farCard=new THREE.PlaneGeometry(.86,1.18);
farCard.translate(0,.565,0);
farCard.setAttribute('woodAge',new THREE.Float32BufferAttribute(new Float32Array(4),1));

function sharedGeometry(source) {
  const geometry=new THREE.BufferGeometry();
  for(const [name,attribute] of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
  geometry.setIndex(source.index);
  geometry.boundingSphere=source.boundingSphere?.clone()||null;
  return geometry;
}

function mipTexture(mipmaps) {
  const { data, width, height } = mipmaps[0];
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.mipmaps = mipmaps;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function atlasTexture(pixels,width,height) {
  // Alpha-weighted colour mips keep thin bark/twigs from turning into pale
  // rectangles or black fringes. No alpha dilation that would grow white poles.
  const mipmaps=[{data:pixels,width,height}];
  let previous=pixels,w=width,h=height;
  while(w>1||h>1){
    const nw=Math.max(1,w>>1),nh=Math.max(1,h>>1),next=new Uint8Array(nw*nh*4);
    for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){
      let alpha=0,r=0,g=0,b=0,count=0;
      for(let dy=0;dy<Math.min(2,h);dy++)for(let dx=0;dx<Math.min(2,w);dx++){
        const i=((y*2+dy)*w+x*2+dx)*4,a=previous[i+3];
        alpha+=a;r+=previous[i]*a;g+=previous[i+1]*a;b+=previous[i+2]*a;count++;
      }
      const i=(y*nw+x)*4;next[i]=alpha?r/alpha:88;next[i+1]=alpha?g/alpha:84;next[i+2]=alpha?b/alpha:76;next[i+3]=alpha/count;
    }
    mipmaps.push({data:next,width:nw,height:nh});previous=next;w=nw;h=nh;
  }
  return mipTexture(mipmaps);
}

function getBranchAtlases() {
  if(branchAtlas)return;
  const width=ATLAS_TILE_W*4,height=ATLAS_TILE_H*4;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d'),color=new THREE.Color();
  function render(leaves){
    ctx.clearRect(0,0,width,height);
    for(const [row,kind] of Object.keys(species).entries())for(let view=0;view<4;view++){
      const geo=treeGeometry(kind,0,leaves),p=geo.attributes.position,c=geo.attributes.color,index=geo.index.array;
      const angle=view*TAU/4,cos=Math.cos(angle),sin=Math.sin(angle),triangles=[];
      const projected=i=>{
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
        return [view*ATLAS_TILE_W+((x*cos-z*sin)/.86+.5)*ATLAS_TILE_W,
          row*ATLAS_TILE_H+(1-(y+.025)/1.18)*ATLAS_TILE_H,x*sin+z*cos];
      };
      for(let i=0;i<index.length;i+=3){
        const a=projected(index[i]),b=projected(index[i+1]),d=projected(index[i+2]);
        triangles.push({a,b,d,depth:(a[2]+b[2]+d[2])/3,index:i});
      }
      triangles.sort((a,b)=>a.depth-b.depth);
      ctx.save();ctx.beginPath();ctx.rect(view*ATLAS_TILE_W,row*ATLAS_TILE_H,ATLAS_TILE_W,ATLAS_TILE_H);ctx.clip();
      for(const t of triangles){
        const i=t.index,a=index[i],b=index[i+1],d=index[i+2];
        if(leaves)ctx.fillStyle='#ffffff';
        else {color.setRGB((c.getX(a)+c.getX(b)+c.getX(d))/3,(c.getY(a)+c.getY(b)+c.getY(d))/3,(c.getZ(a)+c.getZ(b)+c.getZ(d))/3);ctx.fillStyle=color.getStyle();}
        ctx.beginPath();ctx.moveTo(t.a[0],t.a[1]);ctx.lineTo(t.b[0],t.b[1]);ctx.lineTo(t.d[0],t.d[1]);ctx.closePath();ctx.fill();
      }
      ctx.restore();
    }
    return atlasTexture(new Uint8Array(ctx.getImageData(0,0,width,height).data),width,height);
  }
  branchAtlas=render(false);leafAtlas=render(true);
}

// Used by the offline baker and as a fallback on browsers without gzip decoding.
export function bakeDeciduousCrowns() {
  getBranchAtlases();
  return [branchAtlas, leafAtlas];
}

async function loadCrownTextures() {
  const url = new URL('../assets/forest/deciduous-crowns.bin.gz', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Deciduous crowns returned HTTP ${response.status}`);
  let buffer = await response.arrayBuffer();
  const magic = new DataView(buffer).getUint16(0);
  // A host can also serve this file with Content-Encoding: gzip.
  if (magic === 0x1f8b) {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    buffer = await new Response(stream).arrayBuffer();
  }
  const header = new DataView(buffer);
  if (header.getUint32(0) !== 0x464f4c31 || header.getUint16(4, true) !== ATLAS_TILE_W * 4
    || header.getUint16(6, true) !== ATLAS_TILE_H * 4) throw new Error('Invalid crown atlas header');
  let offset = 8;
  const chains = [];
  for (let atlas = 0; atlas < 2; atlas++) {
    const levels = [];
    let width = ATLAS_TILE_W * 4, height = ATLAS_TILE_H * 4;
    while (true) {
      const bytes = width * height * 4;
      levels.push({ width, height, data: new Uint8Array(buffer, offset, bytes) });
      offset += bytes;
      if (width === 1 && height === 1) break;
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);
    }
    chains.push(levels);
  }
  if (buffer.byteLength !== offset) throw new Error('Invalid crown atlas length');
  [branchAtlas, leafAtlas] = chains.map(mipTexture);
}

export function preloadDeciduousCrowns() {
  atlasLoad ??= loadCrownTextures().catch(() => { getBranchAtlases(); });
  return atlasLoad;
}

function kindAt(region,seed) {
  if (region === 'niseko-united') return seed < .82 ? 'birch' : 'neutral';
  if (region === 'vail') return seed < .88 ? 'aspen' : 'neutral';
  return 'neutral';
}

function treeSeed(tree) {
  return Math.abs(Math.sin(tree.x*12.9898+tree.z*78.233)*43758.5453)%1;
}

// This unit-height 3D graph supplies both nearby meshes and the generated far
// atlas. Its tapered tubes and folded leaves need no photographs or stock art.
function treeGeometry(kind,variant,leaves) {
  const key=`${kind}:${variant}:${leaves}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const spec=species[kind],rand=mulberry32(spec.seed+variant*7919);
  const positions=[],normals=[],colors=[],uvs=[],ages=[],indices=[];
  const bark=new THREE.Color(spec.bark),twig=new THREE.Color(spec.twig);
  const tips=[];
  const bend=.012+rand()*.019,phase=rand()*TAU;
  const trunk=y=>new THREE.Vector3(bend*y*y*Math.sin(phase+y*2.2),y,bend*y*y*Math.cos(phase+y*1.5)*.6);
  function vertex(p,n,u,v,age) {
    const i=positions.length/3,c=bark.clone().lerp(twig,age);
    positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);
    colors.push(c.r,c.g,c.b);uvs.push(u,v);ages.push(age);return i;
  }
  function tube(a,b,r0,r1,sides,age) {
    const axis=b.clone().sub(a).normalize();
    const across=new THREE.Vector3().crossVectors(axis,Math.abs(axis.y)>.93?_a.set(1,0,0):up).normalize();
    const lateral=new THREE.Vector3().crossVectors(axis,across).normalize();
    const first=positions.length/3;
    for(let row=0;row<2;row++)for(let side=0;side<=sides;side++){
      const angle=side/sides*TAU,n=across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(lateral,Math.sin(angle));
      const center=row?b:a,radius=row?r1:r0;
      vertex(center.clone().addScaledVector(n,radius),n,side/sides,center.y,age);
    }
    for(let i=0;i<sides;i++){
      const a=first+i,b=a+1,c=a+sides+1,d=c+1;indices.push(a,b,c,b,d,c);
    }
  }
  function leaf(center,axis,size,roll) {
    const normal=new THREE.Vector3(Math.sin(roll)*.8,.35+rand()*.6,Math.cos(roll)*.8).normalize();
    const across=new THREE.Vector3().crossVectors(axis,normal).normalize();
    const forward=new THREE.Vector3().crossVectors(normal,across).normalize();
    const points=[center.clone().addScaledVector(forward,-size*.65),center.clone().addScaledVector(across,-size*.49),
      center.clone().addScaledVector(forward,size),center.clone().addScaledVector(across,size*.49),
      center.clone().addScaledVector(normal,size*.16)];
    const first=positions.length/3;
    for(let i=0;i<points.length;i++)vertex(points[i],normal,i===1?0:i===3?1:.5,i===0?0:i===2?1:.5,0);
    indices.push(first,first+1,first+4,first+1,first+2,first+4,first+2,first+3,first+4,first+3,first,first+4);
  }
  const trunkRows=10,sides=9;
  if(!leaves)for(let i=0;i<trunkRows;i++){
    const a=i/trunkRows,b=(i+1)/trunkRows;
    tube(trunk(a===0?-.016:a),trunk(b),.0107*Math.pow(1-a,.76)+.0005,.0107*Math.pow(1-b,.76)+.0005,sides,a*.24);
  }
  for(let i=0;i<12;i++){
    const y=.29+i*.049+rand()*.021,angle=i*2.39996+phase+(rand()-.5)*.7;
    const spread=spec.spread*Math.sin((y-.18)/.94*Math.PI)*(.76+rand()*.41);
    const root=trunk(y),mid=root.clone().add(new THREE.Vector3(Math.cos(angle)*spread*.53,.025+rand()*.051,Math.sin(angle)*spread*.53));
    const end=root.clone().add(new THREE.Vector3(Math.cos(angle+.13)*spread,.10+rand()*.11,Math.sin(angle+.13)*spread));
    if(!leaves){
      tube(root,mid,.0037*(1-y*.7),.0018,5,.56);tube(mid,end,.0018,.00053,4,.83);
    }
    for(let j=0;j<5;j++){
      const t=.15+j*.16+rand()*.06,side=j%2?1:-1,turn=angle+side*(.56+rand()*.58);
      const attach=mid.clone().lerp(end,t),reach=spread*(.26+rand()*.23)*(1-t*.32);
      const tip=attach.clone().add(new THREE.Vector3(Math.cos(turn)*reach,.035+rand()*.059,Math.sin(turn)*reach));
      const elbow=attach.clone().lerp(tip,.56).add(new THREE.Vector3(0,-.008,0));
      if(!leaves){tube(attach,elbow,.00094,.00055,4,.78);tube(elbow,tip,.00055,.00014,3,.94);}
      tips.push({tip,axis:tip.clone().sub(attach).normalize()});
      for(let k=0;k<2;k++){
        const base=elbow.clone().lerp(tip,.22+k*.47),fork=turn+(k?1:-1)*(.49+rand()*.45);
        const twigEnd=base.clone().add(new THREE.Vector3(Math.cos(fork)*reach*.47,.022+rand()*.038,Math.sin(fork)*reach*.47));
        if(!leaves)tube(base,twigEnd,.00037,.00008,3,.98);
        tips.push({tip:twigEnd,axis:twigEnd.clone().sub(base).normalize()});
      }
    }
  }
  // Unequal upright leaders make the crown split and lean rather than read as
  // a central white pole with radial spokes. Their side shoots fill its volume.
  for(let i=0;i<3;i++){
    const angle=phase+i*2.39996,y=.29+i*.11,root=trunk(y),reach=.075+rand()*.07;
    const mid=root.clone().add(new THREE.Vector3(Math.cos(angle)*reach*.7,.27+rand()*.08,Math.sin(angle)*reach*.7));
    const top=new THREE.Vector3(Math.cos(angle+.2)*reach,1.0+rand()*.08,Math.sin(angle+.2)*reach);
    if(!leaves){tube(root,mid,.0041-i*.0005,.0018,6,.35);tube(mid,top,.0018,.0002,4,.72);}
    for(let j=0;j<6;j++){
      const t=.13+j*.13,attach=mid.clone().lerp(top,t),turn=angle+j*2.39996;
      const end=attach.clone().add(new THREE.Vector3(Math.cos(turn)*(.055+rand()*.055),.032+rand()*.04,Math.sin(turn)*(.055+rand()*.055)));
      if(!leaves)tube(attach,end,.00063,.00008,3,.92);
      tips.push({tip:end,axis:end.clone().sub(attach).normalize()});
    }
  }
  if(leaves){
    for(const {tip,axis} of tips)for(let i=0;i<8;i++){
      const center=tip.clone().addScaledVector(axis,(rand()-.65)*.033)
        .add(new THREE.Vector3((rand()-.5)*.024,(rand()-.5)*.027,(rand()-.5)*.024));
      leaf(center,axis,.0049+rand()*.0038,rand()*TAU);
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geo.setAttribute('woodAge',new THREE.Float32BufferAttribute(ages,1));
  geo.setIndex(indices);geo.computeBoundingSphere();geometryCache.set(key,geo);return geo;
}

function forestMaterial(kind,near,leaves,uniforms) {
  const spec=species[kind],material=new THREE.MeshStandardMaterial({
    color:leaves?spec.leaf:0xffffff,vertexColors:near&&!leaves,roughness:leaves?.87:.97,
    side:leaves?THREE.DoubleSide:THREE.FrontSide,alphaTest:.001,alphaToCoverage:true,
  });
  if(!near){getBranchAtlases();material.map=leaves?leafAtlas:branchAtlas;material.alphaTest=.002;}
  material.forceSinglePass=true;
  material.customProgramCacheKey=()=>`winter-deciduous-${kind}-${near}-${leaves}-v2`;
  material.onBeforeCompile=(shader,renderer)=>{
    const multisample=renderer.getContext().getContextAttributes().antialias;
    Object.assign(shader.uniforms,uniforms,{
      decSnow:climateUniforms.snowpack,decLine:climateUniforms.snowline,
      decAutumn:climateUniforms.autumn,decSpring:climateUniforms.spring,
      decFall:{value:new THREE.Color(spec.fall)},decGreen:{value:new THREE.Color(spec.leaf)},
    });
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      ${near?'':'attribute float detailWeight;'}
      attribute float woodAge;varying float decAge;varying vec2 decBark;
      varying float decCoverage;varying vec3 decWorld;varying vec3 decFacing;
      ${near?'':'varying float decFrame;'}
      uniform vec2 decNear;uniform vec2 decFar;
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      vec3 decRoot=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
      float decHeight=length(instanceMatrix[1].xyz);
      float decRise=max(0.,max(decRoot.y-cameraPosition.y,cameraPosition.y-decRoot.y-decHeight));
      float decDistance=length(vec3(cameraPosition.xz-decRoot.xz,decRise));
      float decJitter=fract(sin(dot(decRoot.xz,vec2(.1271,.2293)))*3375.73);
      float decStart=mix(decNear.x,decNear.y,.45*decJitter);
      float decBlend=1.-smoothstep(decStart,decStart+.55*(decNear.y-decNear.x),decDistance);
      decCoverage=${near?'decBlend':'(1.-detailWeight*decBlend)*(1.-smoothstep(decFar.x,decFar.y,decDistance))'};
      decWorld=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;
      decFacing=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
      decAge=woodAge;decBark=vec2(uv.x,uv.y*decHeight);
    `);
    if(!near){
      shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>',`#include <defaultnormal_vertex>
        vec3 decNormalRoot=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
        vec2 decNormalEye=normalize(cameraPosition.xz-decNormalRoot.xz+vec2(.00001,0.));
        transformedNormal=normalize(mat3(viewMatrix)*vec3(decNormalEye.x,.19,decNormalEye.y));
      `).replace('#include <project_vertex>',`
        vec2 decToward=normalize(cameraPosition.xz-decRoot.xz+vec2(.00001,0.));
        vec3 decRight=vec3(decToward.y,0.,-decToward.x);
        float decRotation=atan(instanceMatrix[2].x,instanceMatrix[2].z);
        decFrame=mod(floor((atan(decToward.x,decToward.y)-decRotation)*.6366197724+4.5),4.);
        vec3 decBillboard=decRoot+decRight*position.x*length(instanceMatrix[0].xyz)+vec3(0.,position.y*decHeight,0.);
        decWorld=decBillboard;
        vec4 mvPosition=viewMatrix*vec4(decBillboard,1.);gl_Position=projectionMatrix*mvPosition;
      `).replace('#include <worldpos_vertex>','vec4 worldPosition=vec4(decBillboard,1.);');
    }
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying float decAge;varying vec2 decBark;varying float decCoverage;varying vec3 decWorld;varying vec3 decFacing;
      uniform float decSnow;uniform float decLine;uniform float decAutumn;uniform float decSpring;
      uniform float decLeafCover;uniform vec3 decFall;uniform vec3 decGreen;
      ${near?'':'varying float decFrame;'}
      float decHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    `).replace('#include <color_fragment>',`#include <color_fragment>
      ${leaves?`
        float variation=decHash(floor(decWorld*7.).xz);
        diffuseColor.rgb=mix(decGreen,decFall,decAutumn*(.72+.28*variation));
        diffuseColor.rgb*=.82+.24*variation;
      `:near?`
        vec2 barkCell=vec2(decBark.x*13.,decBark.y*7.7);
        vec2 barkLocal=fract(barkCell);float mark=decHash(floor(barkCell));
        float lenticel=(1.-smoothstep(.028,.086,abs(barkLocal.y-(.27+mark*.43))))
          *(1.-smoothstep(.16,.44,abs(barkLocal.x-.5)))*step(.43,mark);
        float rough=.94+.06*sin(decBark.x*74.+sin(decBark.y*3.8)*1.4);
        diffuseColor.rgb*=rough*(1.-lenticel*(1.-decAge)*${kind==='neutral'?'.30':'.69'});
        float basal=(1.-smoothstep(.14,1.65,decBark.y))*(.31+.69*decHash(floor(decBark*vec2(19.,7.))));
        diffuseColor.rgb*=1.-basal*(1.-decAge)*${kind==='neutral'?'.24':'.46'};
        float snowDust=decSnow*smoothstep(decLine-230.,decLine+130.,decWorld.y)
          *smoothstep(.33,.85,decFacing.y)*(.18+.40*decAge);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.78,.85,.88),snowDust);
      `:'diffuseColor.rgb*=.94;'}
    `).replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      float decThreshold=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
      if(decCoverage${leaves?'*decLeafCover':''}${!near&&!multisample?'*diffuseColor.a':''}<=decThreshold)discard;
    `);
    if(!near){
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        vec2 decUV=vec2((vMapUv.x*.98+.01+decFrame)*.25,
          (1.-(vMapUv.y*.992+.004)+${Object.keys(species).indexOf(kind)}.)*.25);
        vec4 decTexel=texture2D(map,decUV);diffuseColor*=decTexel;
      `).replace('#include <opaque_fragment>',`#undef OPAQUE
        #include <opaque_fragment>`);
    }else attachChaseFoliage(shader);
  };
  return material;
}

/** Patch-instanced bare woods with a bounded nearby 3D twig/leaf tier. */
export function buildDeciduousForest(group,patches,region='') {
  const uniforms={decNear:{value:new THREE.Vector2(29,65)},decFar:{value:new THREE.Vector2(2600,3600)},decLeafCover:{value:0}};
  const farCells=[],allLeaves=[],nearBuckets=new Map(),materials=new Map(),plantedKinds=new Set();
  let currentQuality='',lastLeafVisible=null,lastX=Infinity,lastY=Infinity,lastZ=Infinity,selected=[];
  const material=(kind,near,leaf)=>{
    const key=`${kind}:${near}:${leaf}`;
    if(!materials.has(key))materials.set(key,forestMaterial(kind,near,leaf,uniforms));return materials.get(key);
  };
  const matrixFor=tree=>{
    pose.position.set(tree.x,tree.y,tree.z);pose.rotation.set(0,tree.rotation||0,0);
    pose.scale.set(tree.height*(tree.width||1),tree.height,tree.height*(tree.width||1));pose.updateMatrix();return pose.matrix;
  };
  for(const [key,patch] of patches){
    const byKind=new Map();
    for(const tree of patch){
      if(!Number.isFinite(tree.x+tree.y+tree.z+tree.height)||tree.height<=0)continue;
      const kind=kindAt(region,treeSeed(tree));
      // Retain the planted object; colliders still see its original kind.
      // Species/selection metadata belongs to the cell and nearby candidates.
      if(!byKind.has(kind))byKind.set(kind,[]);byKind.get(kind).push(tree);
    }
    for(const [kind,trees] of byKind){
      plantedKinds.add(kind);
      const weight=new THREE.InstancedBufferAttribute(new Float32Array(trees.length),1).setUsage(THREE.DynamicDrawUsage);
      // Only the per-patch selection weights are unique. The card's static
      // attributes/index and both generated atlases are shared across woods.
      const woodGeo=sharedGeometry(farCard),leafGeo=sharedGeometry(farCard);
      woodGeo.setAttribute('detailWeight',weight);leafGeo.setAttribute('detailWeight',weight);
      const wood=new THREE.InstancedMesh(woodGeo,material(kind,false,false),trees.length);
      const leaves=new THREE.InstancedMesh(leafGeo,material(kind,false,true),0);
      wood.name=`${region} ${kind} winter branches · ${key}`;leaves.name=`${kind} seasonal canopy · ${key}`;
      for(let i=0;i<trees.length;i++){
        const tree=trees[i];wood.setMatrixAt(i,matrixFor(tree));
      }
      leaves.instanceMatrix=wood.instanceMatrix;
      leaves.count=wood.count;
      wood.receiveShadow=true;leaves.receiveShadow=true;leaves.visible=false;
      wood.computeBoundingSphere();leaves.computeBoundingSphere();
      group.add(wood,leaves);allLeaves.push(leaves);
      const cellBounds=wood.boundingSphere.clone().union(leaves.boundingSphere);
      farCells.push({wood,leaves,trees,kind,weight,center:cellBounds.center,radius:cellBounds.radius});
    }
  }
  const mobileBudget=compactDevice?32:192;
  for(const kind of plantedKinds)for(let variant=0;variant<variants;variant++){
    const wood=new THREE.InstancedMesh(treeGeometry(kind,variant,false),material(kind,true,false),mobileBudget);
    const leaves=new THREE.InstancedMesh(treeGeometry(kind,variant,true),material(kind,true,true),0);
    wood.name=`Nearby ${kind} tapered trunks and twigs ${variant+1}`;leaves.name=`Nearby ${kind} individual leaves ${variant+1}`;
    wood.instanceMatrix.setUsage(THREE.DynamicDrawUsage);leaves.instanceMatrix=wood.instanceMatrix;
    wood.count=leaves.count=0;wood.visible=leaves.visible=false;
    wood.receiveShadow=leaves.receiveShadow=true;group.add(wood,leaves);allLeaves.push(leaves);
    nearBuckets.set(`${kind}:${variant}`,{wood,leaves});
  }
  group.name ||= 'Seasonal deciduous woods';
  group.userData.deciduous={trees:farCells.reduce((n,c)=>n+c.trees.length,0),patches:farCells.length,nearBudget:0,nearTrees:0};
  return {
    update(camera,qualityName='HIGH') {
      const quality=String(qualityName).toUpperCase(),base=profiles[quality]||profiles.HIGH;
      const budget=compactDevice?Math.min(quality==='LOW'?12:quality==='BALANCED'?20:32,base.budget):base.budget;
      const end=compactDevice?Math.min(base.end,47):base.end,start=Math.min(base.start,end*.61);
      const far=compactDevice?Math.min(base.far,1900):base.far;
      uniforms.decNear.value.set(start,end);uniforms.decFar.value.set(far*.72,far);
      uniforms.decLeafCover.value=(1-smoothstep(.68,.96,climateUniforms.snowpack.value))
        *(1-.45*climateUniforms.spring.value)*(1-.28*climateUniforms.autumn.value);
      const leafVisible=uniforms.decLeafCover.value>.008;
      if(leafVisible!==lastLeafVisible){
        for(const leaves of allLeaves)leaves.visible=leafVisible&&leaves.count>0;
        lastLeafVisible=leafVisible;
      }
      camera.getWorldPosition(eye);
      if(currentQuality===quality&&Math.hypot(eye.x-lastX,eye.y-lastY,eye.z-lastZ)<3)return;
      currentQuality=quality;lastX=eye.x;lastY=eye.y;lastZ=eye.z;
      const candidates=[];
      for(const cell of farCells){
        const distance=eye.distanceTo(cell.center);
        cell.wood.visible=distance<far+cell.radius;cell.leaves.visible=cell.wood.visible&&leafVisible;
        if(distance>end+cell.radius)continue;
        for(let index=0;index<cell.trees.length;index++){
          const tree=cell.trees[index];
          const rise=Math.max(0,tree.y-eye.y,eye.y-tree.y-tree.height);
          const distanceSq=(tree.x-eye.x)**2+(tree.z-eye.z)**2+rise*rise;
          if(distanceSq<end*end)candidates.push({tree,distanceSq,index,weight:cell.weight,
            kind:cell.kind,variant:Math.floor(treeSeed(tree)*variants)});
        }
      }
      candidates.sort((a,b)=>a.distanceSq-b.distanceSq);
      const next=candidates.slice(0,budget),changed=new Set();
      for(const entry of selected){entry.weight.setX(entry.index,0);entry.weight.addUpdateRange(entry.index,1);changed.add(entry.weight);}
      for(const {wood,leaves} of nearBuckets.values())wood.count=leaves.count=0;
      for(const entry of next){
        const {tree,kind,variant}=entry,bucket=nearBuckets.get(`${kind}:${variant}`),index=bucket.wood.count++;
        bucket.wood.setMatrixAt(index,matrixFor(tree));bucket.leaves.count++;
        entry.weight.setX(entry.index,1);entry.weight.addUpdateRange(entry.index,1);changed.add(entry.weight);
      }
      for(const weight of changed)weight.needsUpdate=true;
      for(const {wood,leaves} of nearBuckets.values()){
        wood.visible=wood.count>0;leaves.visible=wood.visible&&leafVisible;
        wood.castShadow=leaves.castShadow=!compactDevice&&quality!=='LOW'&&quality!=='BUDGET';
        if(wood.count){wood.instanceMatrix.needsUpdate=true;wood.computeBoundingSphere();leaves.computeBoundingSphere();}
      }
      selected=next;group.userData.deciduous.nearBudget=budget;group.userData.deciduous.nearTrees=next.length;
    },
  };
}
