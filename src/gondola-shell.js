import * as THREE from 'three';
import { box, beam, part, mergeParts } from './scenery.js';
import { makeCanvas, canvasTexture, mulberry32 } from './util.js';
import { createRoofSnow } from './roof-weather.js';
import { climateUniforms } from './climate-state.js';
import { heightAt } from './terrain.js';

// The same plug-slide motion drives the rendered fleet and the occupied cabin.
// The first quarter of travel lifts the seals out of the jambs before the
// leaves slide clear. Instancing keeps all leaves in the existing layer draws.
function fleetDoorShader(shader) {
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
    #ifdef USE_INSTANCING
      attribute float doorOpen;
      attribute vec2 doorMotion;
    #endif`).replace('#include <begin_vertex>',`#include <begin_vertex>
    #ifdef USE_INSTANCING
      transformed.x += doorMotion.x * smoothstep(0., .28, doorOpen);
      transformed.z += doorMotion.y * smoothstep(.18, 1., doorOpen);
    #endif`);
}

export function gondolaDoorsAtDistance(distance) {
  return 1-THREE.MathUtils.smoothstep(distance,2,5.5);
}

export const PEAK_TO_PEAK_BERTH_TIME=5;

export function peakToPeakBerthOpening(time, departing) {
  return departing
    ? 1-THREE.MathUtils.smoothstep(time,PEAK_TO_PEAK_BERTH_TIME-1.1,PEAK_TO_PEAK_BERTH_TIME)
    : THREE.MathUtils.smoothstep(time,0,1.1);
}

function geometryView(source) {
  const geometry = new THREE.BufferGeometry();
  for(const [name,attribute] of Object.entries(source.attributes)) geometry.setAttribute(name,attribute);
  geometry.boundingSphere=source.boundingSphere;
  geometry.userData.gondolaShared=true;
  return geometry;
}

export function gondolaFleetGeometry(shell, key, doorOpen) {
  const source=shell.fleet[key];
  if(!source)return shell[key];
  const geometry=geometryView(source);
  geometry.setAttribute('doorOpen',doorOpen);
  return geometry;
}

// The fleet and the occupied cabin use this same shell. Cable origins, loading
// clearance and floor height deliberately match the original carrier envelope.
let finishes, localGlass, localReflection;
const shellCache=new Map();
const reflectionState={night:NaN,snowpack:NaN,pending:false,faces:[],generation:0};
export function gondolaReflectionStatus() { return { ...reflectionState,faces:[...reflectionState.faces] }; }
function cabinMaterials(creekside=false){
  const base=cabinFinishes();
  if(!creekside)return base;
  if(!localGlass){localGlass=base.glass.clone();localGlass.onBeforeCompile=base.glass.onBeforeCompile;
    localGlass.customProgramCacheKey=base.glass.customProgramCacheKey;localGlass.userData.gondolaShared=true;}
  localGlass.envMapIntensity=1.10*(1-.83*climateUniforms.night.value);
  return {...base,glass:localGlass};
}
function reflectionScene(scene,origin){
  const probe=new THREE.Scene();probe.background=scene.background?.clone?.()||new THREE.Color('#bccedc');
  const hemi=scene.getObjectByName('hemisphere');if(hemi)probe.add(hemi.clone());
  const sourceSun=scene.getObjectByName('sun');
  if(sourceSun){const light=new THREE.DirectionalLight(sourceSun.color,sourceSun.intensity);
    light.position.copy(origin).add(new THREE.Vector3(-56,42,72));light.target.position.copy(origin);probe.add(light,light.target);}
  // Sample the actual elevation service on a coarse regional grid. Reflection
  // needs the real mountain skyline, not the millions of pressed snow triangles.
  const terrain=new THREE.PlaneGeometry(8500,8500,70,70);terrain.rotateX(-Math.PI/2);
  const positions=terrain.attributes.position,colors=[];
  const rock=new THREE.Color('#53615b'), snowColor=new THREE.Color('#c2cdd2'), color=new THREE.Color();
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i)+origin.x,z=positions.getZ(i)+origin.z,h=heightAt(x,z);
    positions.setXYZ(i,x,h,z);
    const snow=THREE.MathUtils.clamp((h-climateUniforms.snowline.value)/280+.3+climateUniforms.snowpack.value*.62,0,1);
    color.copy(rock).lerp(snowColor,snow);colors.push(color.r,color.g,color.b);
  }
  terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrain.computeVertexNormals();
  const terrainMaterial=new THREE.MeshLambertMaterial({vertexColors:true});
  probe.add(new THREE.Mesh(terrain,terrainMaterial));
  const mats=new Map(),position=new THREE.Vector3(),matrix=new THREE.Matrix4(),bounds=new THREE.Sphere();
  const proxyRange=560, structureRange=450, vertexBudget=520000;
  const excluded=/Resort terrain|Detailed snow|Coast Mountains|rocks ·|Lift network|people/i;
  let total=0;
  scene.updateMatrixWorld();
  function capture(object) {
    if(object.userData.gondolaCarrier||excluded.test(object.name))return;
    if(object.name==='Mapped mature forest cell'&&object.position.distanceToSquared(origin)>(proxyRange+object.radius)**2)return;
    if(object.isMesh)captureMesh(object);
    for(const child of object.children)capture(child);
  }
  function captureMesh(object) {
    if(object.name==='sky'){
      const sky=new THREE.Mesh(object.geometry,object.material);sky.position.copy(origin);sky.frustumCulled=false;probe.add(sky);return;
    }
    if(object.isInstancedMesh){
      if(object.name!=='mature conifer silhouettes')return;
      bounds.copy(object.boundingSphere).applyMatrix4(object.matrixWorld);
      if(bounds.center.distanceToSquared(origin)>(proxyRange+bounds.radius)**2)return;
      const matrices=[];
      for(let i=0;i<object.count&&matrices.length<100;i++){
        object.getMatrixAt(i,matrix);matrix.premultiply(object.matrixWorld);position.setFromMatrixPosition(matrix);
        if(position.distanceToSquared(origin)<proxyRange**2)matrices.push(matrix.clone());
      }
      if(matrices.length){
        const forest=new THREE.InstancedMesh(object.geometry,new THREE.MeshLambertMaterial({color:'#38534b',vertexColors:!!object.geometry.attributes.color}),matrices.length);
        matrices.forEach((matrix,i)=>forest.setMatrixAt(i,matrix));forest.frustumCulled=false;probe.add(forest);
      }
      return;
    }
    if(total>vertexBudget||object.material?.isShaderMaterial||object.material?.transparent)return;
    position.setFromMatrixPosition(object.matrixWorld);
    if(position.distanceToSquared(origin)>structureRange**2)return;
    const source=Array.isArray(object.material)?object.material[0]:object.material;
    if(!source)return;
    const key=(source.color?.getHexString()||'ffffff')+!!object.geometry.attributes.color;
    if(!mats.has(key))mats.set(key,new THREE.MeshLambertMaterial({color:source.color||0xffffff,
      vertexColors:!!object.geometry.attributes.color,side:THREE.DoubleSide}));
    const mesh=new THREE.Mesh(object.geometry,mats.get(key));mesh.matrix.copy(object.matrixWorld);mesh.matrixAutoUpdate=false;
    probe.add(mesh);total+=object.geometry.attributes.position.count;
  }
  capture(scene);
  return {scene:probe,dispose(){terrain.dispose();terrainMaterial.dispose();for(const m of mats.values())m.dispose();
    probe.traverse(m=>{if(m.isInstancedMesh)m.material.dispose();});}};
}
export function attachCreeksideReflection(mesh, scene, origin) {
  mesh.onBeforeRender=renderer=>{
    cabinMaterials(true);
    const night=climateUniforms.night.value,pack=climateUniforms.snowpack.value;
    const changed=localReflection&&(Math.abs(night-reflectionState.night)>.82||Math.abs(pack-reflectionState.snowpack)>.42);
    if(reflectionState.pending||localReflection&&!changed)return;
    reflectionState.pending=true;reflectionState.faces=[];
    // Match the existing winter PMREM's 64px cube size so assigning the local
    // map does not invalidate the occupied-cabin shader warmed during loading.
    const target=new THREE.WebGLCubeRenderTarget(64,{type:THREE.HalfFloatType,generateMipmaps:false});
    const cube=new THREE.CubeCamera(.5,14000,target);cube.position.copy(origin);
    cube.coordinateSystem=renderer.coordinateSystem;cube.updateCoordinateSystem();cube.updateMatrixWorld(true);
    let face=0,snapshot;
    const captureFace=()=>{
      if(!snapshot)snapshot=reflectionScene(scene,origin);
      const current=renderer.getRenderTarget(),currentFace=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
      const auto=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;
      const begin=performance.now();
      try {renderer.setRenderTarget(target,face);renderer.render(snapshot.scene,cube.children[face]);}
      finally {renderer.setRenderTarget(current,currentFace,mip);renderer.shadowMap.autoUpdate=auto;}
      reflectionState.faces.push(performance.now()-begin);
      if(++face<6){requestAnimationFrame(captureFace);return;}
      setTimeout(()=>{
        const generator=new THREE.PMREMGenerator(renderer),old=localReflection;
        localReflection=generator.fromCubemap(target.texture);
        localReflection.texture.name='Creekside · actual village and mountain reflection';
        cabinMaterials(true).glass.envMap=localReflection.texture;cabinMaterials(true).glass.needsUpdate=true;
        generator.dispose();old?.dispose();target.dispose();snapshot.dispose();
        reflectionState.night=night;reflectionState.snowpack=pack;
        reflectionState.generation++;reflectionState.pending=false;
      },0);
    };
    requestAnimationFrame(captureFace);
  };
}
function cabinFinishes() {
  if (finishes) return finishes;
  const { canvas, ctx } = makeCanvas(2048, 512), rand = mulberry32(8191);
  ctx.clearRect(0, 0, 2048, 512);
  // Frost settles at seals; the middle of each window remains genuinely clear.
  // A circumferential UV avoids the striped frost caused by repeating a whole
  // window texture over every small curved facet.
  for (let i = 0; i < 48000; i++) {
    const x = rand() * 2048, y = rand() * 512;
    const edge = Math.max(Math.exp(-y / 49), Math.exp(-(512-y) / 27) * .88);
    const seam = Math.max(Math.exp(-Math.abs(x-512) / 5), Math.exp(-Math.abs(x-1536) / 5));
    const scallop = .86 + .28 * Math.sin(x * .037) + .14 * Math.sin(x * .091);
    if (rand() > Math.min(.97, edge * scallop + seam * .48)) continue;
    const r = .55 + rand() * 2.65;
    ctx.fillStyle = `rgba(${204+Math.floor(rand()*35)},239,244,${.14+rand()*.70})`;
    ctx.fillRect(x, y, r * (1+rand()), r);
    if (rand() > .93) {
      ctx.strokeStyle = 'rgba(227,244,247,.46)'; ctx.lineWidth = .6;
      ctx.beginPath(); ctx.moveTo(x-r*3,y); ctx.lineTo(x+r*3,y);
      ctx.moveTo(x,y-r*3); ctx.lineTo(x,y+r*3); ctx.stroke();
    }
  }
  const frost = canvasTexture(canvas); frost.anisotropy = 8;
  const mark = makeCanvas(1024, 256);
  mark.ctx.clearRect(0, 0, 1024, 256);
  // The broad, asymmetric WB swoop is hand drawn as an emblem rather than a
  // generic mountain icon, with the two resort names on its installed baseline.
  const c = mark.ctx; c.fillStyle = '#e8e9e4';
  c.beginPath(); c.moveTo(269,114); c.bezierCurveTo(335,98,367,74,405,68);
  c.bezierCurveTo(440,63,459,77,455,98); c.bezierCurveTo(478,94,523,73,558,62);
  c.bezierCurveTo(617,43,697,49,719,75); c.bezierCurveTo(743,103,695,132,624,139);
  c.bezierCurveTo(663,123,696,101,681,86); c.bezierCurveTo(662,65,612,70,577,84);
  c.bezierCurveTo(534,101,487,127,448,131); c.bezierCurveTo(418,134,406,120,412,102);
  c.bezierCurveTo(370,117,335,123,269,124); c.closePath(); c.fill();
  c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '700 48px "Barlow Condensed", Arial';
  c.fillStyle = '#edf0e9'; c.fillText('WHISTLER', 180, 190);
  const nameWidth = c.measureText('WHISTLER').width;
  c.fillStyle = '#c64544'; c.fillText('BLACKCOMB', 195 + nameWidth, 190);
  const logo = canvasTexture(mark.canvas); logo.anisotropy = 8;
  const peakMark=makeCanvas(1024,256),p=peakMark.ctx;
  p.fillStyle='#13212a';p.strokeStyle='#f1f0e5';p.lineWidth=11;
  p.beginPath();p.moveTo(24,133);p.lineTo(111,38);p.lineTo(910,38);p.lineTo(1000,133);p.lineTo(910,216);p.lineTo(111,216);p.closePath();p.fill();p.stroke();
  p.fillStyle='#ecede8';p.textAlign='center';p.textBaseline='middle';
  p.font='italic 900 136px "Barlow Condensed",Arial';p.fillText('PEAK 2 PEAK',512,131,850);
  finishes = {
    hull: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .38, metalness: .51, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x4d6b7d, transparent: true, opacity: .59,
      roughness: .065, metalness: .23, reflectivity: .91, envMapIntensity: 1.10,
      clearcoat: 1, clearcoatRoughness: .065, side: THREE.DoubleSide, depthWrite: false }),
    frost: new THREE.MeshStandardMaterial({ map: frost, transparent: true, opacity: .96,
      roughness: .76, metalness: .02, side: THREE.DoubleSide, depthWrite: false, alphaTest: .08 }),
    logo: new THREE.MeshStandardMaterial({ map: logo, transparent: true, alphaTest: .1,
      roughness: .57, metalness: .12, side: THREE.DoubleSide, depthWrite: false }),
    peakLogo:new THREE.MeshStandardMaterial({map:canvasTexture(peakMark.canvas),transparent:true,alphaTest:.1,
      roughness:.52,metalness:.12,side:THREE.DoubleSide,depthWrite:false}),
  };
  finishes.glass.onBeforeCompile=shader=>{
    shader.uniforms.cabinRealism = climateUniforms.realism;
    shader.uniforms.cabinHorizon = climateUniforms.reflectedHorizon;
    shader.uniforms.cabinZenith = climateUniforms.reflectedZenith;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying vec2 cabinUv;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      cabinUv=uv;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 cabinUv;
      uniform float cabinRealism;
      uniform vec3 cabinHorizon, cabinZenith;`).replace('#include <opaque_fragment>',`
      float rim=pow(1.-max(0.,dot(normal,normalize(vViewPosition))),3.4);
      float outside=gl_FrontFacing?1.:0.;
      // The actual captured valley is reflected in the front surface. A
      // shallow top-to-bottom tint and Fresnel edge distinguish curved glass
      // from a flat translucent sheet without blocking the rider's view.
      float cloudBand=exp(-pow((cabinUv.y-.81-.033*sin(cabinUv.x*17.))/.075,2.));
      float narrowBand=exp(-pow((cabinUv.y-.92)/.021,2.));
      float lowerTint=1.-smoothstep(.04,.82,cabinUv.y);
      outgoingLight*=mix(1.,.32+.14*(1.-lowerTint),outside);
      #ifdef USE_ENVMAP
        vec3 valleyReflection=getIBLRadiance(normalize(vViewPosition),normal,.065);
        outgoingLight+=valleyReflection*outside*(.26+rim*.70);
      #endif
      outgoingLight+=outside*(cloudBand*.11+narrowBand*.10)*vec3(.68,.77,.80);
      diffuseColor.a=mix(.10+.10*rim,.78+.18*rim,outside);
      if (cabinRealism > .5) {
        vec3 ray = reflect(-normalize(vViewPosition), normal) * mat3(viewMatrix);
        vec3 skyTint = mix(cabinHorizon, cabinZenith, smoothstep(-.02,.82,ray.y));
        float glassFresnel = .042 + .958 * pow(1. - abs(dot(normal,normalize(vViewPosition))), 5.);
        outgoingLight = mix(outgoingLight, skyTint, (.12 + .69*glassFresnel)*smoothstep(-.09,.15,ray.y));
        diffuseColor.a = mix(.085, .58, outside) + .34*glassFresnel;
      }
      #include <opaque_fragment>`);
    fleetDoorShader(shader);
  };
  finishes.glass.customProgramCacheKey=()=> 'curved-gondola-fresnel-sliding-doors';
  finishes.hull.onBeforeCompile=finishes.frost.onBeforeCompile=fleetDoorShader;
  for(const material of Object.values(finishes)) material.userData.gondolaShared=true;
  return finishes;
}

export function makeGondolaShell(color = '#26343a', accent = '#d1d3ce', big = false, creekside = false) {
  const cacheKey=[color,accent,big,creekside].join('|');
  if(shellCache.has(cacheKey))return shellCache.get(cacheKey);
  const w = big ? 1.55 : .96, d = big ? 1.94 : 1.01;
  const floor = big ? -3.32 : -3.12, sill = big ? -2.69 : -2.50, top = big ? -1.46 : -1.51;
  const profile = big?[[floor-.15,.92],[floor-.035,.98],[sill,1],[(sill+top)*.5,1.005],[top,.99],[-1.28,.96],[-1.18,.91]]
    : [[floor-.15,.73],[floor-.035,.92],[sill,1],[(sill+top)*.5,1.025],[top,.95],[-1.28,.79],[-1.18,.68]];
  const doorHalf = big ? .86 : .49, header = -1.28, threshold = floor+.024;
  const scaleAtThreshold = THREE.MathUtils.lerp(profile[1][1], 1, (threshold-profile[1][0])/(sill-profile[1][0]));
  profile.splice(2,0,[threshold,scaleAtThreshold]);
  const perimeter=[];
  for(let corner=0;corner<4;corner++) {
    const centers=big?[[.88,.90],[-.88,.90],[-.88,-.90],[.88,-.90]]:[[.70,.73],[-.70,.73],[-.70,-.73],[.70,-.73]];
    for(let k=0;k<=6;k++) {
      const a=(corner+k/6)*Math.PI/2;
      perimeter.push([centers[corner][0]+(big?.12:.30)*Math.cos(a),centers[corner][1]+(big?.10:.27)*Math.sin(a)]);
    }
  }
  perimeter.reverse();
  for(let i=perimeter.length-1;i>=0;i--){
    const a=perimeter[i],b=perimeter[(i+1)%perimeter.length];
    if(Math.hypot(b[0]-a[0],b[1]-a[1])<.6)continue;
    const inserts=[];
    for(let step=1;step<4;step++){
      const t=step/4,bulge=Math.sin(t*Math.PI)*(big?.008:.050);
      const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      inserts.push(Math.abs(a[0]-b[0])<.2?[x+Math.sign(x)*bulge,z]:[x,z+Math.sign(z)*bulge]);
    }
    perimeter.splice(i+1,0,...inserts);
  }
  // Subdivide the long sides at the actual door jambs. The shell, seals and
  // glazing share this cut from the low boarding sill to the header rail.
  for(let i=perimeter.length-1;i>=0;i--){
    const a=perimeter[i],b=perimeter[(i+1)%perimeter.length];
    if(Math.abs(a[0])<.96||Math.abs(b[0])<.96||a[0]*b[0]<0||a[1]===b[1])continue;
    const cuts=[-doorHalf/d,doorHalf/d].map(z=>(z-a[1])/(b[1]-a[1])).filter(t=>t>0&&t<1).sort((a,b)=>a-b);
    perimeter.splice(i+1,0,...cuts.map(t=>[THREE.MathUtils.lerp(a[0],b[0],t),THREE.MathUtils.lerp(a[1],b[1],t)]));
  }
  const perimeterU=[0];
  for(let i=0;i<perimeter.length;i++){
    const a=perimeter[i],b=perimeter[(i+1)%perimeter.length];
    perimeterU.push(perimeterU.at(-1)+Math.hypot((b[0]-a[0])*w,(b[1]-a[1])*d));
  }
  const perimeterLength=perimeterU.at(-1);for(let i=0;i<perimeterU.length;i++)perimeterU[i]/=perimeterLength;
  const n=perimeter.length, at=(i,y,scale=1)=>{
    const p=perimeter[(i+n)%n];return[p[0]*w*scale,y,p[1]*d*scale];
  };
  const opaque=[], panes=[], frost=[], graphics=[];
  const leaves=[-1,1].flatMap(side=>[-1,1].map(direction=>({side,direction,
    x:side*(big?.13:.16),z:direction*(doorHalf+.028),hull:[],glass:[],frost:[]})));
  const doorSegments=perimeter.map((a,i)=>{
    const b=perimeter[(i+1)%n],x=(a[0]+b[0])*.5,z=(a[1]+b[1])*.5*d;
    if(Math.abs(x)<.96||Math.abs(z)>doorHalf)return null;
    return leaves[(x>0?2:0)+(z>0?1:0)];
  });
  const quad=(target,a,b,c,e,tint='#ffffff',uv=null)=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([...a,...b,...c,...a,...c,...e],3));
    if(uv)geometry.setAttribute('uv',new THREE.Float32BufferAttribute([
      uv[0],uv[1],uv[2],uv[1],uv[2],uv[3],uv[0],uv[1],uv[2],uv[3],uv[0],uv[3]],2));
    geometry.computeVertexNormals();target.push(part(geometry,tint));
  };
  const ring=(y,scale,radius,tint)=>{
    for(let i=0;i<n;i++){
      const parts=(y>threshold&&y<header?doorSegments[i]?.hull:null)||opaque;
      parts.push(beam(at(i,y,scale),at(i+1,y,scale),radius,radius,tint));
    }
  };
  for(let i=0;i<n;i++) {
    const leaf=doorSegments[i];
    for(let j=1;j<profile.length;j++) {
      const [y0,s0]=profile[j-1],[y1,s1]=profile[j];
      const a=at(i,y0,s0),b=at(i+1,y0,s0),c=at(i+1,y1,s1),e=at(i,y1,s1);
      const moving=y0>=threshold&&y1<=header?leaf:null;
      if(y0>=sill&&y1<=header) {
        const v0=(y0-sill)/(-1.28-sill),v1=(y1-sill)/(-1.28-sill);
        quad(moving?.glass||panes,a,b,c,e,'#ffffff',[perimeterU[i],v0,perimeterU[i+1],v1]);
        const outward=p=>[p[0]*1.002,p[1],p[2]*1.002];
        quad(moving?.frost||frost,outward(a),outward(b),outward(c),outward(e),'#ffffff',[perimeterU[i],v0,perimeterU[i+1],v1]);
      } else quad(moving?.hull||opaque,a,b,c,e,j===1?'#53636a':y0===header?accent:color);
    }
    quad(opaque,at(i,floor,.91),at(i+1,floor,.91),[0,floor,0],[0,floor,0],'#354047');
    quad(opaque,at(i,-1.18,big?.91:.68),at(i+1,-1.18,big?.91:.68),[0,-1.18,0],[0,-1.18,0],accent);
  }
  // Rolled aluminium rails, dark continuous seals, narrow corner mullions.
  ring(floor-.045,.934,.041,'#a7b2b1');ring(sill+.005,1.004,.044,'#bbc4bf');
  ring(sill+.042,1.005,.022,'#202b2e');ring(-1.28,big?.965:.796,.031,'#aeb8b5');
  ring(top-.015,.958,.016,'#1c272c');ring(-1.18,big?.91:.68,.033,'#89999c');
  // Pressed silver ribs wrap the rounded lower pan. These are shallow three
  // sided ridges, with lit crests and darker undersides, not painted stripes.
  for(let rib=0;rib<(big?1:4);rib++){
    const y=floor+.025+rib*.051,scale=.946+rib*.0068;
    for(let i=0;i<n;i++){
      const parts=doorSegments[i]?.hull||opaque;
      quad(parts,at(i,y-.013,scale-.003),at(i+1,y-.013,scale-.003),
        at(i+1,y,scale+.005),at(i,y,scale+.005),'#6b7d84');
      quad(parts,at(i,y,scale+.005),at(i+1,y,scale+.005),
        at(i+1,y+.012,scale-.001),at(i,y+.012,scale-.001),'#b4c0c0');
    }
  }
  for(const x of [-1,1])for(const z of [-1,1]){
    opaque.push(part(new THREE.CapsuleGeometry(.044,.25,3,7),'#1e292e',
      [x*w*.916,top-.25,z*d*.823]));
    opaque.push(part(new THREE.SphereGeometry(.047,7,5),'#718287',
      [x*w*.923,floor+.05,z*d*.82]));
  }
  const frameIndices=[[-.95,-.80],[-.95,.80],[.95,-.80],[.95,.80]].map(([x,z])=>{
    let best=0,dist=Infinity;perimeter.forEach((p,i)=>{const d=(p[0]-x)**2+(p[1]-z)**2;if(d<dist){dist=d;best=i;}});return best;
  });
  for(const i of frameIndices) {
    const a=at(i,sill),b=at(i,top,big?.99:.95);
    opaque.push(beam(a,b,.028,.036,'#26363c'));
    opaque.push(beam([a[0]*1.008,a[1],a[2]*1.008],[b[0]*1.008,b[1],b[2]*1.008],.018,.028,big?color:accent));
    opaque.push(beam(b,at(i,-1.28,big?.96:.79),big?.060:.021,.031,big?color:accent));
  }
  for(const {side,direction,hull} of leaves){
    const jamb=perimeter.findIndex(([x,z])=>side*x>.96&&Math.abs(z*d-direction*doorHalf)<1e-6);
    const edge=(index,middle)=>{
      const [y,scale]=profile[index];
      if(!middle)return at(jamb,y,scale);
      return [side*w*scale*(1+(big?.008:.05)),y,direction*.012];
    };
    for(let j=3;j<profile.length-1;j++){
      hull.push(beam(edge(j-1,true),edge(j,true),.025,.031,'#1a252a'));
      const a=edge(j-1,false),b=edge(j,false);
      hull.push(beam(a,b,.025,.031,'#a4b0ae'));
      a[2]+=direction*.024;b[2]+=direction*.024;
      opaque.push(beam(a,b,.027,.039,'#37464b'));
    }
    const pullZ=direction*.115,pullX=side*w*1.054;
    hull.push(beam([pullX,sill+.13,pullZ],[pullX,sill+.32,pullZ],.022,.024,'#d5d9d4'));
    for(const y of [sill+.13,sill+.32])hull.push(box(.065,.023,.028,'#a5b3b3',[pullX-side*.018,y,pullZ]));
  }
  for(const side of [-1,1]) {
    opaque.push(box(.21,.048,doorHalf*2.05,'#a5b0b3',[side*w*.87,floor-.01,0]));
    opaque.push(beam([side*w*profile.at(-2)[1],header-.007,-doorHalf],[side*w*profile.at(-2)[1],header-.007,doorHalf],.04,.032,'#9ca9ac'));
    for(const z of [-.52,.52])opaque.push(box(.045,.11,.11,'#87979a',[side*w*.95,sill-.31,z*d]));
    // Recessed padded benches and slim seat supports are seen through glass.
    opaque.push(box(w*1.36,.10,.33,'#40545a',[0,floor+.43,side*d*.73]));
    opaque.push(box(w*1.36,.31,.065,'#3c4b50',[0,floor+.64,side*d*.86]));
    opaque.push(box(w*1.16,.29,.034,'#697b7f',[0,floor+.19,side*d*.73]));
    for(const x of [-w*.43,w*.43])opaque.push(box(.035,.13,.34,'#222c32',[x,floor+.52,side*d*.73]));
    // Wide black installed badge on both broad ends, just below the glazing.
    const badgeY=sill-.285;
    const facing=side===1?1:-1;
    const badgePoint=(x,y,offset)=>{
      const scale=(big?.98:.92)+(y-(floor-.035))/(sill-(floor-.035))*(big?.02:.08);
      const f=THREE.MathUtils.clamp((x/(w*scale)+.70)/1.40,0,1);
      const bulge=(big?.008:.050)*Math.sin(f*Math.PI);
      return[x,y,side*(d*scale*(1+bulge)+offset)];
    };
    for(let panel=0;panel<8;panel++){
      const x0=(-.67+panel/8*1.34)*w*facing,x1=(-.67+(panel+1)/8*1.34)*w*facing;
      quad(opaque,badgePoint(x0,badgeY-.22,.009),badgePoint(x1,badgeY-.22,.009),
        badgePoint(x1,badgeY+.22,.009),badgePoint(x0,badgeY+.22,.009),big?color:'#172328');
      quad(graphics,badgePoint(x0,badgeY-.18,.020),badgePoint(x1,badgeY-.18,.020),
        badgePoint(x1,badgeY+.18,.020),badgePoint(x0,badgeY+.18,.020),'#ffffff',[panel/8,0,(panel+1)/8,1]);
    }
  }
  // Cast aluminium chassis, bent hanger and detachable grip. The hanger bends
  // to one side exactly as on the photographed older Creekside carrier.
  opaque.push(box(w*1.18,.11,d*1.36,'#53636a',[0,floor-.09,0]));
  for(const x of [-w*.52,w*.52])opaque.push(box(.055,.045,d*1.56,'#a1afaf',[x,floor-.155,0]));
  if(!big){
  const hangerCurve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.12,-1.145,0),new THREE.Vector3(-.29,-1.10,0),new THREE.Vector3(-.365,-.91,0),
    new THREE.Vector3(-.365,-.61,0),new THREE.Vector3(-.29,-.30,0),new THREE.Vector3(-.11,-.075,0)]);
  opaque.push(part(new THREE.TubeGeometry(hangerCurve,18,.057,8,false),'#a0aaab'));
  const innerCurve= new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.12,-1.145,.045),new THREE.Vector3(-.29,-1.10,.045),new THREE.Vector3(-.365,-.91,.045),
    new THREE.Vector3(-.365,-.61,.045),new THREE.Vector3(-.29,-.30,.045),new THREE.Vector3(-.11,-.075,.045)]);
  opaque.push(part(new THREE.TubeGeometry(innerCurve,18,.014,5,false),'#d0d5cf'));
  for(const [x,y] of [[-.29,-1.08],[-.35,-.78],[-.28,-.31]])
    opaque.push(part(new THREE.CylinderGeometry(.024,.024,.135,8),'#4b5b61',[x,y,0],[Math.PI/2,0,0]));
  opaque.push(box(.62,.075,.56,'#819296',[0,-1.165,0]));
  for(const x of [-.25,.25])opaque.push(box(.055,.08,.63,'#c0c7c4',[x,-1.10,0]));
  opaque.push(box(.44,.085,.40,'#4b5c63',[-.07,-.035,0]));
  for(const z of [-.25,.25]) {
    opaque.push(box(.50,.055,.10,'#b6bfbd',[-.05,-.005,z]));
    opaque.push(beam([-.27,.04,z],[.09,.04,z],.050,.050,'#626e71'));
    opaque.push(part(new THREE.CylinderGeometry(.056,.056,.10,10),'#27383c',[.17,.035,z],[Math.PI/2,0,0]));
  }
  // External ski cradle with actual U rails, drain slots and three pairs of skis.
  const rackX=w*.34,rackZ=d+.16;
  opaque.push(box(.72,.075,.31,'#344449',[rackX,floor+.16,rackZ]));
  for(const x of [rackX-.32,rackX+.32]) {
    opaque.push(beam([x,floor+.68,d*.97],[x,floor+.68,d+.28],.034,.034,'#9eacad'));
    opaque.push(beam([x,floor+.68,d+.28],[x,floor+.82,d+.28],.034,.034,'#9eacad'));
  }
  opaque.push(beam([rackX-.32,floor+.82,d+.28],[rackX+.32,floor+.82,d+.28],.034,.034,'#a1afb0'));
  for(let i=0;i<6;i++) {
    const x=rackX+(i-2.5)*.104,z=rackZ+.025+(i%2)*.025,h=1.72+(i%3)*.08;
    const tint=['#4d9d9a','#d6b96b','#a0b65f'][Math.floor(i/2)];
    opaque.push(box(.07,h,.055,tint,[x,floor+.20+h/2,z],[.072,0,0]));
    opaque.push(beam([x,floor+.16+h,z+.059],[x,floor+.30+h,z+.015],.072,.056,tint));
    opaque.push(box(.085,.16,.081,'#202d31',[x,floor+.98,z+.025]));
    opaque.push(box(.10,.065,.079,'#c3cac6',[x,floor+.85,z+.025]));
    opaque.push(box(.074,.28,.058,'#263b45',[x,floor+h-.02,z+.042],[.072,0,0]));
  }
  } else {
    // A 3S carriage rides on two fixed track ropes. It is not the monocable
    // curved grip of the small Creekside cabins. Eight running wheels and the
    // deep triangulated hanger are visible above the wide 28-person body.
    for(const side of [-1,1]){
      opaque.push(beam([side*.62,-1.18,0],[side*.30,-.35,0],.12,.18,'#9aa8ac'));
      opaque.push(beam([side*.30,-.35,0],[side*.49,-.13,0],.10,.12,'#7c8c93'));
      opaque.push(box(.14,.15,1.32,'#a9b5b7',[side*.50,-.11,0]));
      for(let i=0;i<4;i++){
        const z=(i-1.5)*.33;
        opaque.push(part(new THREE.CylinderGeometry(.125,.125,.085,12),'#25343b',[side*.50,.006,z],[0,0,Math.PI/2]));
        opaque.push(part(new THREE.CylinderGeometry(.071,.071,.099,10),'#b9c3c2',[side*.50,.006,z],[0,0,Math.PI/2]));
      }
      opaque.push(box(.34,.11,d*1.28,'#848f93',[side*w*.71,-1.15,0]));
    }
    opaque.push(box(1.30,.11,1.54,'#78898f',[0,-1.15,0]));
    opaque.push(box(.63,.15,.31,'#9eacb0',[0,-.14,0]));
    for(const z of [-d*.70,d*.70])for(const x of [-w*.46,0,w*.46])
      opaque.push(box(.026,.17,.36,'#83959a',[x,floor+.49,z]));
  }
  const mergeTextured=parts=>{
    // mergeParts intentionally handles only position/normal/colour. Preserve
    // UVs separately for the transparent layers and the two installed badges.
    const uv=[];for(const p of parts)uv.push(...p.geo.attributes.uv.array);
    const geometry=mergeParts(parts);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return geometry;
  };
  const cap=big?.88:.64;
  const snow=createRoofSnow([[-w*cap,-1.165,-d*cap],[w*cap,-1.165,-d*cap],
    [w*cap,-1.165,d*cap],[-w*cap,-1.165,d*cap]],{seed:416,depth:.062,overhang:.055,spacing:.18});
  if(!big)for(const key of ['position','meltAnchor']){
    const attr=snow.geometry.attributes[key];
    for(let i=0;i<attr.count;i++){
      const x=attr.getX(i),z=attr.getZ(i),qx=Math.max(0,Math.abs(x)-w*.46)/(w*.22),qz=Math.max(0,Math.abs(z)-d*.48)/(d*.20);
      const length=Math.hypot(qx,qz);
      if(length>1)attr.setXYZ(i,Math.sign(x)*(Math.min(Math.abs(x),w*.46)+qx/length*w*.22),
        attr.getY(i),Math.sign(z)*(Math.min(Math.abs(z),d*.48)+qz/length*d*.20));
    }
  }
  snow.geometry.computeVertexNormals();snow.geometry.computeBoundingSphere();
  snow.material.userData.gondolaShared=true;
  const materials={...cabinMaterials(creekside),snow:snow.material};
  if(big)materials.logo=materials.peakLogo;
  const shell={fleet:{},leaves:leaves.map(({side,direction,x,z})=>({side,direction,x,z})),logo:mergeTextured(graphics),
    snow:snow.geometry,materials,w,d,floor,sill,top,perimeter,doorBays:doorSegments.map(Boolean)};
  shell.logo.userData.gondolaShared=shell.snow.userData.gondolaShared=true;
  for(const [key,parts] of Object.entries({hull:opaque,glass:panes,frost})){
    const build=key==='hull'?mergeParts:mergeTextured;
    const geometry=build(parts.concat(...leaves.map(leaf=>leaf[key])));
    const motion=new Float32Array(geometry.attributes.position.count*2);
    const countParts=parts=>parts.reduce((count,{geo})=>count+(geo.index?.count??geo.attributes.position.count),0);
    let start=countParts(parts);
    const fixed=shell[key]=geometryView(geometry);
    fixed.setDrawRange(0,start);
    for(let j=0;j<leaves.length;j++){
      const leaf=leaves[j],count=countParts(leaf[key]);
      const moving=shell.leaves[j][key]=geometryView(geometry);
      moving.setDrawRange(start,count);
      for(let i=start;i<start+count;i++){motion[i*2]=leaf.x;motion[i*2+1]=leaf.z;}
      start+=count;
    }
    geometry.setAttribute('doorMotion',new THREE.BufferAttribute(motion,2));
    shell.fleet[key]=geometry;
  }
  shellCache.set(cacheKey,shell);return shell;
}

export function addGondolaShell(group, shell) {
  const addLayer=(parent,key,geometry)=>{
    const mesh=new THREE.Mesh(geometry,shell.materials[key]);
    mesh.name='Gondola · '+key;mesh.castShadow=key==='hull';
    if(key!=='hull'&&key!=='snow')mesh.renderOrder=key==='glass'?2:key==='frost'?3:1;
    if(key==='glass')mesh.onBeforeRender=()=>{if(shell.materials.glass===localGlass)cabinMaterials(true);};
    parent.add(mesh);
  };
  for(const key of ['hull','glass','frost','logo','snow'])addLayer(group,key,shell[key]);
  const doors=shell.leaves.map(leaf=>{
    const door=new THREE.Group();
    door.name=`Gondola door · ${leaf.side<0?'left':'right'} ${leaf.direction<0?'rear':'front'}`;
    for(const key of ['hull','glass','frost'])addLayer(door,key,leaf[key]);
    group.add(door);
    return door;
  });
  return open=>{
    const slide=THREE.MathUtils.smoothstep(open,.18,1),plug=THREE.MathUtils.smoothstep(open,0,.28);
    doors.forEach((door,i)=>door.position.set(shell.leaves[i].x*plug,0,shell.leaves[i].z*slide));
  };
}
