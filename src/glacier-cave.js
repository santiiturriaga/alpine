import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { hash2, lerp, mulberry32, noise2, smoothstep } from './util.js';

// The chamber is a historical interpretation of the glacier's lower eastern flank.
// The generated entrance and its dimensions are independent of current ice extent.
const site = { x: 6090, y: 2062.8, z: 2258 };
const end = 46;
const rearWall = 41.3;
const shoulderStart = 5;
const shoulderEnd = 68;
export const GLACIER_CAVE_START = { x: site.x - 2.4, z: site.z - 10.5, heading: .075, holdAtUnload: true };

const centerAt = (w) => 1.28 * Math.sin(w*.135) - smoothstep(15,37,w) * 4.5;
const widthAt = (w) => (8.5 + .9*Math.sin(w*.16) + 1.9*smoothstep(9,24,w)) * (1-.93*smoothstep(30,end,w));
const crownAt = (w) => (5.15 + 1.8*smoothstep(2,18,w) + .46*Math.sin(w*.21)) * (1-.96*smoothstep(31,end,w));
const streamAt = (w) => centerAt(w) + 1.65 + .60*Math.sin(w*.49) + .42*Math.sin(w*.23+2);
const streamWidth = (w) => .88 + .51*smoothstep(1,19,w) + .22*Math.sin(.64*w);
const footpathAt = (w) => centerAt(w) - 2.65 - .27*Math.sin(w*.32);
const mouthAt = (theta) => -.56 + .72*Math.cos(theta*2.26+.2) + .29*Math.sin(theta*5.1);
const rearAt = (theta) => rearWall + .37*Math.cos(theta*2.87+.29);

function bedHeight(u,w) {
  const channel = 1-smoothstep(.35,1.22,Math.abs(u-streamAt(w))/streamWidth(w));
  const banks = .075*Math.sin(u*1.02+w*.74) + .046*Math.cos(u*1.7-w*.34);
  return site.y + w*.14 + .08*Math.sin(w*.36) - .33*channel + banks;
}

// Prepare the walk-in bed and merge the surrounding snow back into the slopes.
export function gradeGlacierCave(x,z,ground) {
  const u=x-site.x, w=z-site.z;
  if (Math.abs(u)>33 || w < -27 || w > 61) return ground;
  const relative=u-centerAt(w), distance=Math.abs(relative);
  const cut = smoothstep(-27,-4,w) * (1-smoothstep(39,61,w))
    * (1-smoothstep(Math.max(9,widthAt(w)+.6),relative>0?24:26,distance));
  const reservoir = bedHeight(u,w) - lerp(.025,.48,smoothstep(-1.6,1.9,w));
  const bankOffset=(u+14.8+2.1*Math.sin(w*.14))/3.0;
  const westBank=Math.exp(-bankOffset*bankOffset);
  const bankLength=smoothstep(-8,3,w)*(1-smoothstep(21,47,w));
  const rubbleRelief=.32+.68*noise2.fbm(u*.28+2.3,w*.30,3);
  return lerp(ground,reservoir,cut) + 1.65*westBank*bankLength*rubbleRelief;
}

function positionAt(u,y,w) { return [site.x+u,y,site.z+w]; }

// Each gently off-centre pocket is elongated in the direction of water flow.
function meltPockets(theta,w) {
  const x=theta*3.25, z=w*.52 + .28*Math.sin(theta*3.2+w*.12);
  const ix=Math.floor(x), iz=Math.floor(z);
  let relief=0;
  for(let j=iz-1;j<=iz+1;j++) for(let i=ix-1;i<=ix+1;i++) {
    const dx=x-i-.18-.64*hash2(i,j,19), dz=z-j-.18-.64*hash2(i,j,67);
    const radial=dx*dx*.79+(dz-.34*dx)**2*.53;
    const bowl=Math.max(0,1-radial);
    relief+=(.23+.31*hash2(i,j,103))*bowl**3;
  }
  return relief;
}

function archPoint(theta,w) {
  const cosine=Math.cos(theta), sine=Math.sin(theta);
  const drift=.49*noise2.fbm(theta*1.85+w*.09,w*.13,3);
  const ripple=.10*Math.sin(theta*5.7+w*.76);
  const relief=meltPockets(theta,w)+drift+ripple;
  const u=centerAt(w)+cosine*(widthAt(w)+relief) + .43*sine*sine*Math.sin(w*.17+.7);
  const overhang=.50*Math.sin(theta*2.47+.50)*Math.exp(-.040*Math.max(w,0));
  const skirt=.32*(1-smoothstep(0,.20,sine));
  const y=bedHeight(u,w)-.39-skirt+crownAt(w)*sine**.78+sine*(relief+overhang);
  return [u,y,w];
}

function shoulderProfile(w) {
  const climb=smoothstep(shoulderStart,59,w);
  const width=12.75+8.7*smoothstep(1.5,29,w)-2.1*smoothstep(44,shoulderEnd,w)
    + .58*Math.sin(w*.29+.4);
  return {
    center:1.10+12.1*climb-1.32*Math.sin(w*.127),
    width,
    shoulderBias:.49+1.85*Math.sin(w*.079+1.1),
  };
}

function shoulderHeight(u,w,theta,contact) {
  const taper=smoothstep(41,shoulderEnd,w);
  const crown=site.y+9.25+.42*w-.0018*w*w;
  const flex=1.30*Math.sin(w*.20+theta*3.76) + .47*Math.sin(w*.49-theta*4.1);
  const rollers=1.55*noise2.fbm(u*.16+9,w*.20,3);
  const runoff=theta*2.29 + w*.041 + .25*Math.sin(w*.17);
  const trough=.46*smoothstep(.68,.97,Math.sin(runoff*3.31));
  const crest=crown+flex+rollers-trough;
  const profile=lerp(contact-1.28,crest,Math.sin(theta)**1.26);
  return lerp(profile,contact-.82,taper);
}

function shoulderPoint(theta,w,ground) {
  const {center,width,shoulderBias}=shoulderProfile(w);
  const side=Math.cos(theta);
  const u=center+side*(width+shoulderBias*side);
  return [u,shoulderHeight(u,w,theta,ground(site.x+u,site.z+w)),w];
}

function shoulderSurfaceAt(u,w,ground) {
  const {center,width,shoulderBias}=shoulderProfile(w);
  const offset=u-center;
  if (offset<shoulderBias-width || offset>shoulderBias+width) return null;
  // Invert the swept section to sample the same surface the render uses.
  const side=2*offset/(width+Math.sqrt(width*width+4*shoulderBias*offset));
  const contact=ground(site.x+u,site.z+w);
  return Math.max(contact,shoulderHeight(u,w,Math.acos(THREE.MathUtils.clamp(side,-1,1)),contact));
}

function terminusPoint(theta,t,ground) {
  const inner=archPoint(theta,mouthAt(theta));
  const outer=shoulderPoint(theta,shoulderStart,ground);
  const tangent=shoulderPoint(theta,shoulderStart-.25,ground);
  const side=Math.cos(theta), up=Math.sin(theta);
  const curl=1.58+.51*Math.sin(theta*4.8+.77)+.40*Math.sin(theta*8.9);
  const lip=[inner[0]+side*1.62,inner[1]+up*(2.65+.85*Math.sin(theta*3.37)),inner[2]-curl*up];
  // Match the shoulder tangent through the rollover at the top of the cut face.
  const back=outer.map((v,i)=>v-(v-tangent[i])*9.6);
  const a=1-t;
  return inner.map((v,i)=>a**3*v+3*a*a*t*lip[i]+3*a*t*t*back[i]+t**3*outer[i]);
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
    float sky=exp(-max(p.z+1.,0.)*.118);
    float spill=.37*exp(-length((p-vec3(4.5,5.2,15.))*vec3(.11,.19,.079)));
    float tail=.36*exp(-length((p-vec3(-4.,6.6,32.))*vec3(.17,.21,.14)));
    return (sky+spill+tail)*(1.-iceNight*.77);
  }
  // Sediment follows the same deformed layers through the portal and the vault.
  float glacierFlow(vec3 p,float curl) {
    return p.y - .22*p.z + .020*p.x*p.x + .48*sin(p.z*.21+p.x*.19) + 1.16*curl;
  }
`;

function caveMaterial(kind,time) {
  const water=kind==='water';
  const m = new THREE.MeshStandardMaterial({
    roughness:water?.18:kind==='interior'?.45:.86,
    color:0xffffff,side:THREE.DoubleSide,transparent:water,opacity:water?.80:1,depthWrite:!water,
    envMapIntensity:water?.9:kind==='interior'?.28:.38,
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
        float up=dot(normalize(vNormal),mat3(viewMatrix)*vec3(0,1,0));
        float wind=iceNoise(p*vec3(.23,.41,.27));
        float drift=iceNoise(p*vec3(.53,1.0,.45));
        float dust=iceNoise(p*3.71);
        float snow=smoothstep(.40,.77,up*.84+(wind-.45)*.49+(drift-.5)*.20+(dust-.5)*.09+iceSnow*.47-.24);
        float flow=glacierFlow(p,wind);
        float strata=iceNoise(vec3(.14*p.x,2.1*flow,.15*p.z));
        float lens=iceNoise(p*vec3(.49,.29,.62));
        float seam=abs(fract(flow*.73+.53*wind)-.5);
        float silt=(1.-smoothstep(.012,.068+fwidth(flow)*.20,seam))*smoothstep(.39,.72,lens);
        vec3 blue=mix(vec3(.068,.25,.33),vec3(.36,.62,.69),smoothstep(.19,.79,lens*.54+strata*.46));
        float spoil=smoothstep(.65,.82,drift*.65+dust*.35)*(1.-smoothstep(.2,.76,up));
        blue=mix(blue,vec3(.26,.244,.22),silt*.37+spoil*.57);
        float scrim=smoothstep(.40,.82,.61*strata+.39*lens);
        blue=mix(blue,vec3(.44,.64,.71),scrim*.36);
        vec3 powder=mix(vec3(.73,.80,.87),vec3(.92,.96,.99),.68*wind+.22*drift+.10*dust);
        diffuseColor.rgb=mix(blue,powder,snow);
        float heightRelief=(.026*strata+.089*lens+.009*dust)*(1.-snow)+.025*drift*snow;`,
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
        float deformation=iceNoise(p*vec3(.23,.31,.39));
        float flow=glacierFlow(p,deformation);
        float strata=iceNoise(vec3(p.x*.23,flow*2.25,p.z*.20));
        float coarseness=iceNoise(p*vec3(2.3,2.6,1.7));
        float cups=iceNoise(vec3(p.x*.43+p.z*.075,p.y*.74,p.z*.45));
        vec3 microPosition=p*vec3(16.,16.,18.);
        float grit=iceNoise(microPosition);
        float depth=glacierDim(p);
        float vein=1.-smoothstep(.024,.068+fwidth(flow)*.20,abs(fract(flow*.73+.53*deformation)-.5));
        float silt=vein*smoothstep(.31,.62,cups)*(.38+.62*smoothstep(.25,.61,strata));
        float bubbles=smoothstep(.31,.77,.56*strata+.32*cups+.12*coarseness);
        float lowIce=smoothstep(-.25,2.6,p.y-.14*p.z);
        vec3 cleanIce=mix(vec3(.021,.104,.155),vec3(.055,.24,.33),smoothstep(.18,.72,deformation*.47+cups*.53));
        vec3 whiteIce=mix(vec3(.15,.37,.49),vec3(.47,.67,.74),.49*strata+.51*deformation);
        vec3 ice=mix(cleanIce,whiteIce,bubbles*.66);
        ice=mix(ice,ice*vec3(.53,.53,.43),silt*.41);
        float frost = (1.-smoothstep(-.5,3.8,p.z))*iceSnow*smoothstep(.47,.82,strata*.54+cups*.46);
        ice=mix(ice,vec3(.45,.63,.72),frost*.50);
        vec3 till=mix(vec3(.041,.046,.056),ice,.33+.67*lowIce);
        diffuseColor.rgb=till*(.56+depth*.38);
        float microFade=1.-smoothstep(.26,.82,length(fwidth(microPosition)));
        float heightRelief=.071*cups+.015*coarseness+.0015*grit*microFade;`,
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
        float pathCenter=1.28*sin(p.z*.135)-4.5*smoothstep(15.,37.,p.z)-2.65-.27*sin(p.z*.32);
        float wear=(1.-smoothstep(.36,1.24,abs(p.x-pathCenter)+(chunks-.5)*.48))
          *smoothstep(-3.8,.1,p.z)*(1.-smoothstep(30.,37.,p.z));
        vec3 tread=mix(vec3(.106,.108,.098),vec3(.23,.232,.214),sediment*.58+chips*.42);
        diffuseColor.rgb=mix(mix(mix(silt,planedIce,banks),tread,.82*wear),vec3(.58,.72,.81),cover*(1.-.72*wear))
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
    if (kind==='interior' || kind==='outside' || water) {
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 dxG=dFdx(-vViewPosition), dyG=dFdy(-vViewPosition);
          vec3 rxG=cross(dyG,normal), ryG=cross(normal,dxG);
          float deG=dot(dxG,rxG);
          normal=normalize(max(abs(deG),1e-8)*normal-sign(deG)*(dFdx(heightRelief)*rxG+dFdy(heightRelief)*ryG));`);
    }
    if (kind==='interior' || water) {
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          float spill=glacierDim(glacierPoint);
          float grazing=pow(1.-max(dot(normal,normalize(vViewPosition)),0.),3.);
          reflectedLight.directDiffuse *= .19+.22*spill;
          reflectedLight.indirectDiffuse *= .26+.38*spill;
          reflectedLight.directSpecular *= .37*spill;
          reflectedLight.indirectSpecular *= .12+.33*spill;
          totalEmissiveRadiance += diffuseColor.rgb*(.091+spill*(.41+.24*grazing));`);
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

function innerWall(w,side) {
  let near=0,far=Math.PI*.5;
  for(let i=0;i<9;i++) {
    const angle=(near+far)*.5;
    const [u,y]=archPoint(side>0?angle:Math.PI-angle,w);
    if(y-bedHeight(u,w)<1.82) near=angle; else far=angle;
  }
  const [u]=archPoint(side>0?far:Math.PI-far,w);
  return u-side*.15;
}

function addWallColliders(grid) {
  const start = -.36, spacing = 2.6;
  const count = Math.ceil((rearWall - start) / spacing);
  const walls = [-1,1].map(side => {
    const points = Array.from({ length: count + 1 }, (_, i) => innerWall(start + i * spacing, side));
    for (let i = 0; i < count; i++) {
      const a = points[i], b = points[i + 1], w = start + (i + .5) * spacing;
      const x = (a + b) * .5 + side * 1.44;
      grid.addBox(site.x+x,site.z+w,1.47,Math.hypot(b-a,spacing)*.5+.24,
        Math.atan2(a-b,spacing),'ice-wall',{minY:bedHeight(x,w)-1.8,maxY:bedHeight(x,w)+2.45});
    }
    return points;
  });
  grid.addBox(site.x+centerAt(rearWall),site.z+rearWall,5.1,.63,0,'ice-wall',
    {minY:site.y+3.8,maxY:site.y+10.4});
  return (w, side) => {
    const at = Math.max(0, Math.min(count - .0001, (w - start) / spacing));
    const i = Math.floor(at), points = walls[side > 0 ? 1 : 0];
    return lerp(points[i], points[i + 1], at - i);
  };
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

  mesh('Scalloped ice vault',surface(128,96,(a,b)=>{
    const theta=b*Math.PI, w=lerp(mouthAt(theta),rearAt(theta),a);
    const [u,y]=archPoint(theta,w);
    return positionAt(u,y,w);
  },true),caveMaterial('interior',time));

  const terminusRows=32, shellRows=140;
  const apron=mesh('Grounded glacial lobe and seasonal snow mantle',surface(shellRows,96,(a,b)=>{
    const row=a*shellRows, theta=b*Math.PI;
    const point=row<terminusRows
      ? terminusPoint(theta,row/terminusRows,ground)
      : shoulderPoint(theta,lerp(shoulderStart,shoulderEnd,(row-terminusRows)/(shellRows-terminusRows)),ground);
    return positionAt(...point);
  }),caveMaterial('outside',time));
  apron.castShadow=true;

  const floorAt=(x,z)=>bedHeight(x-site.x,z-site.z)+.015;
  mesh('Sediment banks and meltwater channel bed',surface(98,49,(a,b)=>{
    const w=lerp(-5.8,end,a), edge=1-Math.abs(2*b-1);
    const width=widthAt(w)*lerp(.65,1.002,smoothstep(-5.8,1.1,w));
    const u=centerAt(w)+(b*2-1)*width;
    const [x,,z]=positionAt(u,0,w);
    const edgeTuck=smoothstep(0,.155,edge);
    const threshold=smoothstep(-3.6,.14,w+.41*Math.sin(b*13.01));
    const feather=edgeTuck*threshold;
    const y=lerp(ground(x,z)-.20,floorAt(x,z),feather);
    return [x,y,z];
  }),caveMaterial('floor',time));
  mesh('Ice and silt back wall',surface(24,96,(a,b)=>{
    const theta=b*Math.PI, rim=rearAt(theta);
    const [u,y]=archPoint(theta,rim);
    const center=centerAt(rearWall), w=lerp(rearWall-.37,rim,a);
    return positionAt(lerp(center,u,a),lerp(bedHeight(center,w)-.73,y,a),w);
  }),caveMaterial('interior',time));

  const water=mesh('Flowing meltwater',surface(121,12,(a,b)=>{
    const w=lerp(-.14,37.1,a), u=streamAt(w)+(b*2-1)*streamWidth(w)*.84*smoothstep(-.14,.95,w);
    const y=site.y+w*.14+.08*Math.sin(w*.36)-.19;
    return positionAt(u,y,w);
  }),caveMaterial('water',time));
  water.renderOrder=3;

  const postsAt=[1.8,7.4,13.6,20.5,27.3,33.2];
  const posts=new THREE.InstancedMesh(
    new THREE.CylinderGeometry(.026,.037,.62,8),
    new THREE.MeshStandardMaterial({color:0x454847,roughness:.77}),postsAt.length);
  const reflectors=new THREE.InstancedMesh(
    new THREE.CylinderGeometry(.041,.041,.13,8),
    new THREE.MeshStandardMaterial({color:0xffa642,emissive:0xffa642,emissiveIntensity:.28,roughness:.68}),postsAt.length);
  const obj=new THREE.Object3D();
  for(const [i,w] of postsAt.entries()) {
    const u=footpathAt(w)-1.04+.12*Math.sin(w);
    const [x,,z]=positionAt(u,0,w), y=floorAt(x,z);
    const tilt=.093*Math.sin(w*5.13);
    obj.rotation.set(0,0,tilt);
    obj.position.set(x,y+.24,z);
    obj.updateMatrix();
    posts.setMatrixAt(i,obj.matrix);
    obj.position.set(x-.248*Math.sin(tilt),y+.24+.248*Math.cos(tilt),z);
    obj.updateMatrix();
    reflectors.setMatrixAt(i,obj.matrix);
  }
  posts.name='Walkway stakes in the gravel bank';
  reflectors.name='Amber walkway reflectors';
  cave.add(posts,reflectors);

  const rng=mulberry32(712193);
  const ice = glacierIceMaterial();
  const icicles = new THREE.InstancedMesh(icicleGeometry(),ice,47);
  const drips=[];
  for(let i=0;i<icicles.count;i++) {
    const inner=i>=18, w=inner?lerp(4.3,32,rng()):lerp(-.4,1.6,rng());
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
  const moraine = new THREE.InstancedMesh(stoneGeo,caveMaterial('moraine',time),94);
  const rubble = mulberry32(911071);
  for(let i=0;i<moraine.count;i++) {
    const foreland=i<25, side=i<66?-1:1;
    const w=foreland?lerp(-9,1.0,rubble()):lerp(2.8,60,rubble());
    const {center,width}=shoulderProfile(w);
    const edge=foreland?widthAt(w)+2.8:width;
    const u=(foreland?centerAt(w):center)+side*(edge+lerp(-1.0,4.6,rubble()))
      + 1.74*Math.sin(w*.22);
    const radius=lerp(.19,foreland?1.30:1.88,rubble()**2.7);
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
  const wallAt = addWallColliders(grid);

  const mouthX=site.x-5.4, mouthZ=site.z-16.6;
  const withinCave=(x,z,y,maxDistance)=>{
    const w=z-site.z,u=x-site.x;
    if (w < -.75 || w > maxDistance) return false;
    const relative=(u-centerAt(w)) / widthAt(w);
    if (Math.abs(relative)> .8) {
      const side = Math.sign(relative);
      if (side * (u - wallAt(w,side)) > .28) return false;
    }
    const floor=bedHeight(u,w);
    const ceiling=floor+Math.max(1.7,crownAt(w)*Math.pow(Math.max(0,1-relative*relative),.36));
    return y>=floor-4.6 && y<ceiling+.26;
  };
  return {
    views:{
      entrance:{eye:[mouthX,ground(mouthX,mouthZ)+5.6,mouthZ],target:positionAt(.9,site.y+3.40,1.7),fov:52,aspect:1.5},
      interior:{eye:positionAt(-3.55,bedHeight(-3.55,25.3)+1.51,25.3),target:positionAt(.9,site.y+2.95,-1.4),fov:61,aspect:1.42},
    },
    walkSurfaceAt(x,z,y) {
      if (withinCave(x,z,y,rearWall)) return floorAt(x,z);
      const w=z-site.z, u=x-site.x;
      if (w<shoulderStart || w>shoulderEnd || Math.abs(u)>38 || !Number.isFinite(y)) return null;
      const top=shoulderSurfaceAt(u,w,ground);
      return top!==null && y>=top-.78 ? top : null;
    },
    interiorAt(x,z,y) {
      return z>site.z-.39 && withinCave(x,z,y,rearWall) ? cave : null;
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
