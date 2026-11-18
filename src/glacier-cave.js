import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { lerp, mulberry32, noise2, smoothstep } from './util.js';

// The chamber is a historical interpretation of the glacier's lower eastern flank.
// The generated entrance and its dimensions are independent of current ice extent.
const site = { x: 6090, y: 2062.8, z: 2258 };
const end = 46;
export const GLACIER_CAVE_START = { x: site.x - 2.4, z: site.z - 10.5, heading: .075, holdAtUnload: true };

const centerAt = (w) => 1.28 * Math.sin(w*.135) - smoothstep(15,37,w) * 4.5;
const widthAt = (w) => (8.5 + .9*Math.sin(w*.16) + 1.9*smoothstep(9,24,w)) * (1-.93*smoothstep(30,end,w));
const crownAt = (w) => (5.15 + 1.8*smoothstep(2,18,w) + .46*Math.sin(w*.21)) * (1-.96*smoothstep(31,end,w));
const streamAt = (w) => centerAt(w) + 1.65 + .60*Math.sin(w*.49) + .42*Math.sin(w*.23+2);
const streamWidth = (w) => .88 + .51*smoothstep(1,19,w) + .22*Math.sin(.64*w);

function bedHeight(u,w) {
  const channel = 1-smoothstep(.35,1.22,Math.abs(u-streamAt(w))/streamWidth(w));
  const banks = .075*Math.sin(u*1.02+w*.74) + .046*Math.cos(u*1.7-w*.34);
  return site.y + w*.14 + .08*Math.sin(w*.36) - .33*channel + banks;
}

const entranceGrade = (u,w) => smoothstep(-6.6,-.55,w)
  * (1 - smoothstep(.72,1.025,Math.abs(u-centerAt(w)) / widthAt(w)));

// Grade the terrain and collision surface together, leaving the original raster at
// the edges of the interpretive ice lobe and below the downhill approach.
export function gradeGlacierCave(x,z,ground) {
  const u=x-site.x, w=z-site.z;
  if (Math.abs(u)>39 || w < -28 || w > 79) return ground;
  const axial = smoothstep(-28,-8,w) * (1 - smoothstep(47,64,w));
  const lateral = 1 - smoothstep(11,27,Math.abs(u-centerAt(w)));
  const fromWall = Math.abs(u - centerAt(w)) - widthAt(w);
  const tail = 1 - smoothstep(55,78,w);
  const shoulder = smoothstep(.70,4.6,fromWall) * (1 - smoothstep(8.3,21.5,fromWall))
    * smoothstep(-7,8,w) * tail;
  const back = smoothstep(43,53,w) * tail * (1 - smoothstep(9,26,Math.abs(u-centerAt(w))));
  const debris = .48 + .52 * noise2.fbm(u*.21,w*.15,3);
  const bed = bedHeight(u,w);
  const approach = entranceGrade(u,w) * (1 - smoothstep(-.36,.22,w));
  return lerp(lerp(ground,bed-.46,axial*lateral),bed+.057,approach)
    + shoulder * (1.6 + 2.1 * debris + .8 * Math.sin(w*.12)**2)
    + back * (1.5 + 2.3 * debris);
}

function positionAt(u,y,w) { return [site.x+u,y,site.z+w]; }

function archPoint(theta,w) {
  const cosine=Math.cos(theta), sine=Math.sin(theta);
  const warp = noise2.fbm(theta*3.7+w*.15, w*.41, 3);
  const basin = noise2.fbm(theta*8.1+w*.38,w*1.13-theta,2);
  const cups=.26*basin + .19*Math.cos(basin*5.8);
  const u=centerAt(w) + cosine * (widthAt(w)+.52*warp+cups);
  const overhang=.51*Math.sin(theta*2.26+.21)*Math.exp(-.032*Math.max(w,0));
  const y=bedHeight(u,w)-.35 + crownAt(w)*Math.pow(sine,.72) + sine*(.75*warp+cups+overhang);
  return [u,y,w];
}

function surface(rows,cols,point,reverse = false) {
  const pos=[],idx=[];
  for(let i=0;i<=rows;i++) for(let j=0;j<=cols;j++) pos.push(...point(i/rows,j/cols));
  for(let i=0;i<rows;i++) for(let j=0;j<cols;j++) {
    const a=i*(cols+1)+j,b=a+1,c=a+cols+1,d=c+1;
    if (reverse) idx.push(a,c,b,b,c,d);
    else idx.push(a,b,c,b,d,c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const iceNoise = /* glsl */ `
  varying vec3 glacierPoint;
  uniform float iceSnow, iceMelt, iceNight, iceTime;
  float iceHash(vec3 p) {
    p = fract(p*vec3(.1031,.11369,.13787)); p += dot(p, p.yxz+19.19);
    return fract((p.x+p.y)*p.z);
  }
  float iceNoise(vec3 p) {
    vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(mix(iceHash(i),iceHash(i+vec3(1,0,0)),f.x),
      mix(iceHash(i+vec3(0,1,0)),iceHash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(iceHash(i+vec3(0,0,1)),iceHash(i+vec3(1,0,1)),f.x),
      mix(iceHash(i+vec3(0,1,1)),iceHash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float glacierDim(vec3 p) {
    float sky=exp(-max(p.z+1.,0.)*.071);
    float spill=.34*exp(-length((p-vec3(4.5,5.2,17.))*vec3(.11,.26,.091)));
    float tail=.40*exp(-length((p-vec3(-4.,5.,33.))*vec3(.19,.35,.15)));
    return (sky+spill+tail)*(1.-iceNight*.77);
  }
`;

function caveMaterial(kind,time) {
  const water=kind==='water';
  const m = new THREE.MeshStandardMaterial({
    roughness:water?.18:kind==='interior'?.26:.88,
    color:0xffffff,side:THREE.DoubleSide,transparent:water,opacity:water?.80:1,depthWrite:!water,
    envMapIntensity:water?.9:kind==='interior'?.39:.38,
  });
  m.name = {interior:'Stratified glacial ice',outside:'Snow over blue glacial ice',floor:'Moraine gravel and ice',water:'Flowing glacial meltwater',stone:'Wet stone and glacial till',moraine:'Glacial moraine and frost'}[kind];
  m.onBeforeCompile = (shader) => {
    shader.uniforms.iceSnow=climateUniforms.snowpack;
    shader.uniforms.iceMelt=climateUniforms.wetness;
    shader.uniforms.iceNight=climateUniforms.night;
    shader.uniforms.iceTime=time;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 glacierPoint;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 icePoint=vec4(position,1.);
        #ifdef USE_INSTANCING
          icePoint=instanceMatrix*icePoint;
        #endif
        glacierPoint=(modelMatrix*icePoint).xyz-vec3(${site.x.toFixed(1)},${site.y.toFixed(1)},${site.z.toFixed(1)});`);
    const color = {
      outside: /* glsl */ `
        vec3 p=glacierPoint;
        float up = abs(dot(normalize(vNormal),mat3(viewMatrix)*vec3(0,1,0)));
        float strata=iceNoise(vec3(p.x*.30,(p.y+.022*p.x*p.x)*5.1,p.z*.44));
        float cornice=iceNoise(p*.68);
        float grainCoverage=1.-smoothstep(.33,1.3,length(fwidth(p*20.)));
        float granules=mix(.5,iceNoise(p*20.),grainCoverage);
        float snow=smoothstep(.13,.65,up+.53*iceSnow+cornice*.30-.44);
        vec3 blue=mix(vec3(.025,.13,.19),vec3(.22,.54,.66),.61*strata+.39*cornice);
        float iceBand = (p.y + .32*sin(p.x*.42) + .16*cos(p.z*.82))*10.5 + 1.8*strata;
        float layer=.5+.5*cos(iceBand)*(1.-smoothstep(.5,2.3,fwidth(iceBand)));
        vec3 rime=mix(vec3(.50,.65,.75),vec3(.90,.94,.98),.25*strata+.18*granules+.49*cornice+.08*layer);
        diffuseColor.rgb=mix(blue,rime,snow);`,
      moraine: /* glsl */ `
        vec3 p=glacierPoint;
        float grit = iceNoise(p * vec3(3.1,2.0,3.8));
        float bands = iceNoise(vec3(p.x*.53,(p.y+.19*p.z)*2.5,p.z*.40));
        float top = clamp(dot(normalize(vNormal),mat3(viewMatrix)*vec3(0,1,0)),0.,1.);
        float drift = smoothstep(.35,.91,top*.71+iceNoise(.97*p)*.36)*iceSnow;
        vec3 schist = mix(vec3(.16,.166,.157),vec3(.32,.329,.31),.58*bands+.42*grit);
        diffuseColor.rgb *= mix(schist,vec3(.69,.77,.82),drift);`,
      interior: /* glsl */ `
        vec3 p=glacierPoint;
        vec3 flow=vec3(p.x*.52+p.z*.15,(p.y+.015*p.x*p.x+.35*sin(p.z*.39))*3.6,p.z*.48);
        float strata=iceNoise(flow);
        float deformation=iceNoise(p*vec3(.40,.58,.66));
        float coarseness=iceNoise(p*vec3(2.8,3.3,2.0));
        float cups=iceNoise(vec3(p.x*.95+p.z*.15,p.y*1.5,p.z*.7));
        vec3 microPosition=p*vec3(16.,16.,18.);
        float grit=iceNoise(microPosition);
        float depth=glacierDim(p);
        float vein=1.-smoothstep(.035,.092,abs(fract(flow.y*.51+coarseness*.16)-.5));
        float silt=vein*smoothstep(.57,.67,deformation)*(.20+.80*smoothstep(.33,.64,strata));
        float entrainedAir=smoothstep(.52,.73,.46*strata+.35*cups+.19*coarseness);
        float lowIce=smoothstep(-.4,2.2,p.y-.14*p.z);
        float shear=flow.y*3.40+coarseness*.94+.54*sin(p.x*.86+p.z*.46);
        float shimmer=1.-smoothstep(.018,.069+fwidth(shear)*.11,abs(fract(shear)-.5));
        float cloudyVein=shimmer*smoothstep(.41,.67,.62*cups+.22*deformation+.16*strata);
        vec3 cleanIce=mix(vec3(.010,.062,.102),vec3(.051,.26,.35),smoothstep(.13,.73,deformation*.49+cups*.51));
        vec3 milkyIce=mix(vec3(.13,.34,.45),vec3(.44,.66,.74),.55*strata+.45*deformation);
        vec3 ice=mix(cleanIce,milkyIce,entrainedAir*.69)*(1.-silt*.31);
        ice+=vec3(.19,.34,.43)*cloudyVein*depth*.31;
        float frost = (1.-smoothstep(0.,4.8,p.z))*iceSnow*smoothstep(.51,.84,strata*.58+cups*.42);
        ice=mix(ice,vec3(.43,.67,.77),frost*.68);
        ice*=mix(.51,1.,lowIce);
        diffuseColor.rgb=ice*(.44+depth*.36);
        float microFade=1.-smoothstep(.26,.82,length(fwidth(microPosition)));
        float heightRelief=.15*cups+.045*coarseness+.003*cloudyVein+.006*grit*microFade;`,
      floor: /* glsl */ `
        vec3 p=glacierPoint;
        float dim=glacierDim(p);
        float chunks=iceNoise(p*3.9);
        float chips=iceNoise(p*15.);
        float sediment=iceNoise(p*vec3(.51,1.7,.73));
        float banks=smoothstep(.41,.71,chunks*.29+sediment*.71);
        float cover=(1.-smoothstep(-1.5,6.,p.z))*.96*iceSnow;
        vec3 silt=mix(vec3(.023,.031,.038),vec3(.16,.154,.143),chunks*.46+chips*.54);
        vec3 planedIce=mix(vec3(.035,.13,.16),vec3(.26,.46,.52),sediment*.39+chips*.61);
        diffuseColor.rgb=mix(mix(silt,planedIce,banks),vec3(.58,.72,.81),cover)
          * mix(.53,1.,dim);`,
      water: /* glsl */ `
        vec3 p=glacierPoint;
        float ripple=iceNoise(vec3(p.x*3.5,p.y*1.4,p.z*11.+iceTime*4.3));
        float wake=iceNoise(vec3(p.x*6.5,p.y*1.6,p.z*24.+iceTime*8.5));
        float glint=smoothstep(.50,.91,.63*ripple+.37*wake);
        float dim=glacierDim(p);
        diffuseColor.rgb=mix(vec3(.009,.039,.055),vec3(.090,.28,.37),.21*dim+.54*glint);
        float heightRelief=.008*ripple+.003*wake;`,
      stone: /* glsl */ `
        vec3 p=glacierPoint;
        float feldspar=iceNoise(p*11.5);
        float stratum=iceNoise(p*vec3(3.8,15.7,4.8));
        float stain=iceNoise(p*vec3(5.2,3.1,4.4));
        vec3 rock=mix(vec3(.036,.046,.050),vec3(.24,.252,.236),feldspar*.37+stratum*.27+stain*.36);
        rock+=smoothstep(.70,.92,stratum)*vec3(.055,.073,.082);
        diffuseColor.rgb*=rock*(.49+glacierDim(p)*.51);`,
    }[kind];
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\n'+iceNoise)
      .replace('#include <color_fragment>','#include <color_fragment>\n'+color);
    if (kind==='interior' || water) {
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 dxG=dFdx(-vViewPosition), dyG=dFdy(-vViewPosition);
          vec3 rxG=cross(dyG,normal), ryG=cross(normal,dxG);
          float deG=dot(dxG,rxG);
          normal=normalize(max(abs(deG),1e-8)*normal-sign(deG)*(dFdx(heightRelief)*rxG+dFdy(heightRelief)*ryG));`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          float spill=glacierDim(glacierPoint);
          float grazing=pow(1.-max(dot(normal,normalize(vViewPosition)),0.),3.);
          reflectedLight.directDiffuse *= .19+.22*spill;
          reflectedLight.indirectDiffuse *= .26+.38*spill;
          reflectedLight.directSpecular *= .50*spill;
          reflectedLight.indirectSpecular *= .18+.62*spill;
          totalEmissiveRadiance += diffuseColor.rgb*(.060 + spill*(.41+.45*grazing));`);
    }
  };
  m.customProgramCacheKey=()=>`blackcomb-glacier-${kind}`;
  return m;
}

// Small clear specimens share one physical material; fogged fresh ice uses the
// same tint but a shorter attenuation distance and more internal scattering.
export function glacierIceMaterial(frosted=false) {
  return new THREE.MeshPhysicalMaterial({
    color:frosted?0xa8d6e8:0xc7ebf8,
    transmission:frosted?.16:.64,
    roughness:frosted?.45:.16,
    ior:1.31,thickness:frosted?.28:.12,attenuationDistance:frosted?.42:2.1,
    attenuationColor:new THREE.Color(frosted?0x437f9a:0x60c3ec),
    clearcoat:.26,clearcoatRoughness:.17,envMapIntensity:.53,
  });
}

function icicleGeometry() {
  const tube = new THREE.LatheGeometry([
    new THREE.Vector2(.01,-1),new THREE.Vector2(.10,-.83),new THREE.Vector2(.22,-.62),
    new THREE.Vector2(.45,-.36),new THREE.Vector2(.67,-.17),new THREE.Vector2(.92,-.052),
    new THREE.Vector2(1.00,0),new THREE.Vector2(.0,0),
  ],12);
  const p=tube.attributes.position;
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
    const warp=1+.19*noise2.fbm(x*3.7+3,z*4.7+y*11.1,3);
    p.setXYZ(i,x*warp+y*.12,y,z*warp-y*y*.13);
  }
  tube.computeVertexNormals();
  return tube;
}

function addWallColliders(grid) {
  const outerEdge=(w,side)=>centerAt(w)+side*(widthAt(w)*.88-.25);
  for (const side of [-1,1]) for(let a=-1;a<40;a+=2.6) {
    const b=a+2.6, u=outerEdge(a,side), v=outerEdge(b,side);
    const w=(a+b)*.5, x=(u+v)*.5+side*1.44;
    grid.addBox(site.x+x,site.z+w,1.47,Math.hypot(v-u,b-a)*.5+.24,
      Math.atan2(u-v,b-a),'ice-wall',{minY:bedHeight(x,w)-1.8,maxY:bedHeight(x,w)+2.45});
  }
  grid.addBox(site.x+centerAt(40),site.z+40,5.6,.6,0,'ice-wall',{minY:site.y+1,maxY:site.y+10.4});
}

export function buildGlacierCave(scene,grid,ground) {
  const cave=new THREE.Group();
  cave.name='Blackcomb Glacier · historical meltwater cave';
  scene.add(cave);
  const time={value:0};
  const mesh=(name,geometry,material)=>{
    const object=new THREE.Mesh(geometry,material);
    object.name=name;cave.add(object);return object;
  };

  const mouthShift=(theta)=>-.65 + .61*Math.cos(theta*2.8) - .28*Math.sin(theta*7.1);
  mesh('Scalloped ice vault',surface(108,62,(a,b)=>{
    const theta=b*Math.PI, w=lerp(mouthShift(theta),end,a);
    const [u,y]=archPoint(theta,w);
    return positionAt(u,y,w);
  },true),caveMaterial('interior',time));

  const apron=mesh('Layered terminus and seasonal cornice',surface(71,80,(a,b)=>{
    const theta=b*Math.PI, w0=mouthShift(theta), w=lerp(w0,55,a);
    const [u,y]=archPoint(theta,w0);
    const fan=Math.cos(theta) * (5.6+8.2*Math.sin(a*Math.PI*.82));
    const span=u+fan*smoothstep(0,.24,a);
    const lipWave=.52+.34*Math.sin(6.6*theta)+.27*Math.cos(9.7*theta);
    const wrap=(.55+4.15*Math.sin(theta)**.76+lipWave)*smoothstep(0,.16,a);
    const crossSlope=Math.max(.12,Math.sin(theta))**.6;
    const lip=w0-.46*Math.sin(theta);
    const face=lerp(y,y+wrap+.12,a<.12 ? smoothstep(0,.12,a):1);
    const rest=bedHeight(span,w)+crossSlope*(11.4 + 2.4*noise2.fbm(span*.12,w*.17,3))*Math.sin(Math.PI*(.43+a*.50));
    const [x,,z]=positionAt(span,0,lerp(lip,w,smoothstep(.025,.16,a)));
    const tuck=ground(x,z)-.69;
    const exterior=lerp(lerp(face,rest,smoothstep(.10,.38,a)),tuck,smoothstep(.61,.99,a));
    const sideTuck=(1-smoothstep(.11,.49,Math.sin(theta)))*smoothstep(.025,.15,a);
    return [x,lerp(exterior,tuck,sideTuck),z];
  }),caveMaterial('outside',time));
  apron.castShadow=true;

  const floorAt=(x,z)=>bedHeight(x-site.x,z-site.z)+.015;
  mesh('Sediment banks and meltwater channel bed',surface(98,49,(a,b)=>{
    const w=lerp(-5.8,end,a), edge=1-Math.abs(2*b-1);
    const width=widthAt(w)*lerp(.65,1.002,smoothstep(-5.8,1.1,w));
    const u=centerAt(w)+(b*2-1)*width;
    const [x,,z]=positionAt(u,0,w);
    const feather=smoothstep(0,.18,edge) * smoothstep(-1.5,1.8,w+1.1*Math.sin(b*13.01));
    const y=lerp(ground(x,z)-.20,floorAt(x,z),feather);
    return [x,y,z];
  }),caveMaterial('floor',time));
  mesh('Ice and silt back wall',surface(9,40,(a,b)=>{
    const theta=b*Math.PI, w=end-.82-.68*Math.sin(theta*1.5);
    const [u,y]=archPoint(theta,w);
    return positionAt(lerp(centerAt(w),u,a),lerp(bedHeight(u,w)-.47,y,a),w);
  }),caveMaterial('interior',time));

  const water=mesh('Flowing meltwater',surface(121,12,(a,b)=>{
    const w=lerp(-.14,37.1,a), u=streamAt(w)+(b*2-1)*streamWidth(w)*.84*smoothstep(-.14,.95,w);
    const y=site.y+w*.14+.08*Math.sin(w*.36)-.19;
    return positionAt(u,y,w);
  }),caveMaterial('water',time));
  water.renderOrder=3;

  const rng=mulberry32(712193);
  const ice = glacierIceMaterial();
  const icicles = new THREE.InstancedMesh(icicleGeometry(),ice,61);
  const obj=new THREE.Object3D();
  const drips=[];
  for(let i=0;i<icicles.count;i++) {
    const inner=i>=24, w=inner?lerp(4.3,32,rng()):lerp(-.4,1.6,rng());
    const angle=inner?lerp(.39,2.73,rng()):lerp(.19,2.98,rng());
    const [u,y]=archPoint(angle,w);
    const allowable=Math.max(.10,y-bedHeight(u,w)-.48);
    const pathCenter=Math.abs(u-centerAt(w))<widthAt(w)*.55;
    const length=Math.min(allowable,lerp(.13,(!inner || pathCenter)?1.45:3.60,rng()**2.6));
    const radius=.03+length*.065+rng()*.022;
    obj.position.set(...positionAt(u,y+.10,w));
    obj.scale.set(radius,length,radius*(.60+rng()*.7));
    obj.rotation.set(0,rng()*Math.PI*2,0);
    obj.updateMatrix();icicles.setMatrixAt(i,obj.matrix);
    if(i%3===0)drips.push({x:site.x+u,y:y-length,z:site.z+w,phase:rng()*9});
  }
  icicles.name='Clear icicles on glacial roof';
  cave.add(icicles);

  const stoneGeo=new THREE.IcosahedronGeometry(1,2);
  const pts=stoneGeo.attributes.position;
  for(let i=0;i<pts.count;i++) {
    const x=pts.getX(i), y=pts.getY(i), z=pts.getZ(i);
    const cleave=Math.max(.64,.93-.65*Math.max(0,y*.22+z*.41-x*.24));
    const jag=cleave+.50*noise2.fbm(x*3.31+y*5.23,z*4.1-y*2.2,3);
    pts.setXYZ(i,x*jag,y*jag,z*jag);
  }
  stoneGeo.computeVertexNormals();
  const stones=new THREE.InstancedMesh(stoneGeo,caveMaterial('stone',time),167);
  const clasts=new THREE.InstancedMesh(stoneGeo,glacierIceMaterial(true),26);
  const stoneColor=new THREE.Color();
  for(let i=0;i<stones.count;i++) {
    const w=lerp(-2,37,rng()), side=(i%3===0?-1:1);
    const edge=widthAt(w)*lerp(.62,1.01,rng()), u=centerAt(w)+side*edge;
    const size=lerp(.11,1.23,rng()**3.4);
    obj.position.set(...positionAt(u,bedHeight(u,w)+size*.13,w));
    obj.scale.set(size,lerp(.37,.79,rng())*size,lerp(.7,1.37,rng())*size);
    obj.rotation.set(rng()*.7,rng()*Math.PI*2,rng()*.6);
    obj.updateMatrix();stones.setMatrixAt(i,obj.matrix);
    stoneColor.setScalar(lerp(.51,.88,rng())*(.57+.43*Math.exp(-Math.max(0,w)*.042)));
    stones.setColorAt(i,stoneColor);
    if(size>.88)grid.addCircle(site.x+u,site.z+w,size*.74,'rock',{minY:bedHeight(u,w)-.4,maxY:bedHeight(u,w)+size});
  }
  stones.name='Broken schist and glacial till on the banks';
  cave.add(stones);
  const moraine = new THREE.InstancedMesh(stoneGeo,caveMaterial('moraine',time),71);
  const rubble = mulberry32(911071);
  for(let i=0;i<moraine.count;i++) {
    const behind = i >= 49;
    const w = behind ? lerp(42.0,69.2,rubble()) : lerp(-3.8,56.5,rubble());
    const side = i % 2 === 0 ? 1 : -1;
    const u = centerAt(w) + side * (behind ? lerp(1.9,18.6,rubble()) : widthAt(w)+lerp(3.2,17.8,rubble()));
    const radius = lerp(.18,1.74,rubble()**2.7);
    const x = site.x+u, z = site.z+w, y = ground(x,z);
    obj.position.set(x,y-radius*.18,z);
    obj.rotation.set(rubble()*.58,rubble()*Math.PI*2,rubble()*.42);
    obj.scale.set(radius*lerp(.86,1.55,rubble()),radius*lerp(.38,.87,rubble()),radius);
    obj.updateMatrix();
    moraine.setMatrixAt(i,obj.matrix);
    if(radius>1.22)grid.addCircle(x,z,radius*.74,'rock',{minY:y-.3,maxY:y+radius*.67});
  }
  moraine.name='Moraine rubble seated into the glacial shoulders';
  moraine.receiveShadow=true;
  cave.add(moraine);
  for(let i=0;i<clasts.count;i++) {
    const w=lerp(2,31,rng()), side=i%2===0?1:-1;
    const u=centerAt(w)+side*widthAt(w)*lerp(.76,.97,rng());
    const radius=lerp(.19,.71,rng()**2.2);
    obj.position.set(...positionAt(u,bedHeight(u,w)+radius*.15,w));
    obj.rotation.set(rng()*.85,rng()*Math.PI*2,rng()*.67);
    obj.scale.set(radius,lerp(.61,1.18,rng())*radius,radius);
    obj.updateMatrix();clasts.setMatrixAt(i,obj.matrix);
  }
  clasts.name='Broken translucent ice at the wall bases';
  cave.add(clasts);

  const dropletGeo=new THREE.BufferGeometry();
  const dropPositions=new THREE.BufferAttribute(new Float32Array(drips.length*3),3);
  dropletGeo.setAttribute('position',dropPositions);
  const drops=new THREE.Points(dropletGeo,new THREE.PointsMaterial({color:0xb4deed,size:.040,transparent:true,depthWrite:false,opacity:.46}));
  drops.name='Seasonal drips';drops.frustumCulled=false;drops.visible=false;
  cave.add(drops);
  addWallColliders(grid);

  const mouthX=site.x-5.4, mouthZ=site.z-16.6;
  const withinCave=(x,z,y,widthFactor,maxDistance)=>{
    const w=z-site.z,u=x-site.x;
    if (w < -.75 || w > maxDistance) return false;
    const relative=Math.abs(u-centerAt(w))/widthAt(w);
    if (relative>widthFactor) return false;
    const floor=bedHeight(u,w);
    const ceiling=floor+crownAt(w)*Math.pow(1-relative*relative,.36);
    return y>=floor-4.6 && y<ceiling+.26;
  };
  return {
    views:{
      entrance:{eye:[mouthX,ground(mouthX,mouthZ)+4.3,mouthZ],target:positionAt(.9,site.y+2.66,1.7),fov:48,aspect:1.5},
      interior:{eye:positionAt(-3.55,bedHeight(-3.55,25.3)+1.51,25.3),target:positionAt(.9,site.y+2.95,-1.4),fov:61,aspect:1.42},
    },
    walkSurfaceAt(x,z,y) {
      return withinCave(x,z,y,.94,40.3) ? floorAt(x,z) : null;
    },
    interiorAt(x,z,y) {
      return z>site.z-.39 && withinCave(x,z,y,.94,40.9) ? cave : null;
    },
    update(seconds,camera) {
      const distance=camera?Math.hypot(camera.position.x-site.x,camera.position.z-site.z):Infinity;
      // Sub-metre glass outside the clearing cannot be resolved. Leaving a
      // single transmissive draw active makes Three redraw the whole valley.
      const near=distance<(icicles.visible?155:130);
      icicles.visible=clasts.visible=near;
      if(!near) {
        drops.visible=false;
        return;
      }
      time.value=seconds;
      const season=1-climateUniforms.snowpack.value;
      drops.visible=season>.15 || climateUniforms.wetness.value>.31;
      if(!drops.visible)return;
      for(const [i,{x,y,z,phase}] of drips.entries()) {
        const t=((seconds*.73+phase)%1.7);
        const tail=y-t*t*4.9;
        dropPositions.setXYZ(i,x,tail>=bedHeight(x-site.x,z-site.z)?tail:site.y-14,z);
      }
      dropPositions.needsUpdate=true;
    },
  };
}
