import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { makeNoise, mulberry32 } from './util.js';

// The melt anchor sits on the roof underneath each snow vertex. Snow shrinks
// onto that surface as the weather changes; icicles retreat into the eave.
function winterShader(shader) {
  shader.uniforms.roofPack = climateUniforms.snowpack;
  shader.uniforms.roofSnowline = climateUniforms.snowline;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
    attribute vec3 meltAnchor;
    uniform float roofPack, roofSnowline;
    varying float retention;
    varying vec3 winterPoint;`).replace('#include <begin_vertex>', `#include <begin_vertex>
    vec4 anchor=vec4(meltAnchor,1.);
    #ifdef USE_INSTANCING
      anchor=instanceMatrix*anchor;
    #endif
    float elevation=(modelMatrix*anchor).y;
    float highSnow=smoothstep(roofSnowline+40.,roofSnowline+360.,elevation);
    retention=clamp(smoothstep(.18,1.,roofPack)+highSnow*(1.-roofPack),0.,1.);
    transformed=mix(meltAnchor,position,retention);
    vec4 world=vec4(transformed,1.);
    #ifdef USE_INSTANCING
      world=instanceMatrix*world;
    #endif
    winterPoint=(modelMatrix*world).xyz;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    varying float retention;
    varying vec3 winterPoint;`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
    if(retention<.025) discard;`);
}

const snow = new THREE.MeshStandardMaterial({color:0xffffff, vertexColors:true, roughness:.9, side:THREE.DoubleSide});
snow.onBeforeCompile = shader => {
  winterShader(shader);
  shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
    vec3 grainPos=winterPoint*119.;
    vec3 crystal=fract(grainPos+.31*sin(grainPos.zxy*.74));
    float glint=pow(max(0.,1.-2.1*length(crystal-.5)),8.);
    float resolved=1.-smoothstep(.26,1.15,length(fwidth(grainPos)));
    roughnessFactor=mix(.89,.36,glint*resolved);`);
};
const ice = new THREE.MeshStandardMaterial({
  color:0xffffff, vertexColors:true, roughness:.19, metalness:.07, transparent:true,
  opacity:.83, depthWrite:false, envMapIntensity:1.85, side:THREE.FrontSide,
});
ice.onBeforeCompile = shader => {
  winterShader(shader);
  shader.uniforms.iceNight = climateUniforms.night;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float iceNight;')
    .replace('#include <opaque_fragment>', /* glsl */ `
    float rim = pow(1.0-max(0.0,dot(normal,normalize(vViewPosition))),2.4);
    float striation = .5+.5*sin(winterPoint.y*243.0 + .9*sin(winterPoint.x*139.0+winterPoint.z*81.0));
    float band = striation*(1.0-smoothstep(.15,.75,fwidth(winterPoint.y)*243.0));
    outgoingLight += (vec3(.063,.15,.22)*rim + vec3(.031,.06,.08)*band) * mix(1.0,.30,iceNight);
    diffuseColor.a *= mix(.76,1.13,rim) + band*.07;
    #include <opaque_fragment>
  `);
};
const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking:THREE.RGBADepthPacking, side:THREE.DoubleSide });
depthMaterial.onBeforeCompile = winterShader;

function geometry(positions, colors, anchors, indices) {
  const g=new THREE.BufferGeometry();
  for (const [name,data] of [['position',positions],['color',colors],['meltAnchor',anchors]]) {
    g.setAttribute(name,new THREE.Float32BufferAttribute(data,3));
  }
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Four ordered corners of an actual roof skin in its local frame. Geometry
// crosses the sheathing edge and curls under it. The ridge, windward strip
// and leeward eave accumulate different depths in metres.
export function createRoofSnow(corners, { seed=185, depth=.26, overhang=.10, spacing=.85 }={}) {
  const [a,b,c,d]=corners.map(p=>new THREE.Vector3(...p));
  const along=(a.distanceTo(b)+c.distanceTo(d))*.5, across=(a.distanceTo(d)+b.distanceTo(c))*.5;
  const nx=Math.max(3,Math.min(112,Math.ceil(along/spacing)));
  const nz=Math.max(3,Math.min(90,Math.ceil(across/spacing)));
  const p=[], colors=[], anchors=[], indices=[], border=[];
  const profile=makeNoise(seed), rand=mulberry32(seed), phase=rand()*19;
  const lowAtD=(d.y+c.y)<(a.y+b.y);
  const upWinding=b.clone().sub(a).cross(d.clone().sub(a)).y>=0;
  const tint=new THREE.Color(), va=new THREE.Vector3(),vb=new THREE.Vector3(),base=new THREE.Vector3();
  function point(u,v) {return base.copy(va.lerpVectors(a,b,u)).lerp(vb.lerpVectors(d,c,u),v);}
  function sample(u,v){
    const x=u*along,z=v*across;
    const broad=profile.fbm(x*.17+phase,z*.21,3);
    const roll=profile.noise2(x*.70,z*.67+phase);
    const wind=lowAtD?v:1-v;
    const patch=.80+.45*broad+.21*roll+.36*Math.pow(wind,2.7);
    const exposed=Math.max(0,profile.noise2(x*.32-11,z*.20+4)-.26);
    return depth*Math.max(.12,patch-exposed*.85);
  }
  function vertex(u,v,radial,vertical,shade) {
    const t=p.length/3, localDepth=sample(u,v);
    const edgeNoise=profile.noise2(u*along*.65,v*across*.65+phase);
    const ou=u+(u===0?-1:u===1?1:0)*radial*(1+.57*edgeNoise)*overhang/Math.max(.01,along);
    const ov=v+(v===0?-1:v===1?1:0)*radial*(1+.57*edgeNoise)*overhang/Math.max(.01,across);
    const support=point(u,v);anchors.push(support.x,support.y+.003,support.z);
    const q=point(ou,ov);
    p.push(q.x,q.y+localDepth*vertical+.01,q.z);
    tint.setRGB(.86*shade,.92*shade,.95*shade);
    colors.push(tint.r,tint.g,tint.b);
    return t;
  }
  function quad(i,j,k,l) {
    if(upWinding)indices.push(i,j,k,i,k,l);
    else indices.push(i,k,j,i,l,k);
  }
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++) {
    const u=i/nx,v=j/nz;
    vertex(u,v,.46,1,.96+.035*profile.noise2(u*along*.56,v*across*.44));
    const k=j*(nx+1)+i;
    if(i<nx&&j<nz)quad(k,k+1,k+nx+2,k+nx+1);
  }
  for(let i=0;i<=nx;i++)border.push([i,i/nx,0]);
  for(let j=1;j<=nz;j++)border.push([j*(nx+1)+nx,1,j/nz]);
  for(let i=nx-1;i>=0;i--)border.push([nz*(nx+1)+i,i/nx,1]);
  for(let j=nz-1;j>0;j--)border.push([j*(nx+1),0,j/nz]);
  let prev=border.map(([i])=>i);
  for(const [radial,vertical,shade] of [[1,.76,.91],[.97,.30,.80],[.64,.065,.73],[0,-.025,.77]]) {
    const ring=border.map(([,u,v])=>vertex(u,v,radial,vertical,shade));
    for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;quad(prev[j],prev[i],ring[i],ring[j]);}
    prev=ring;
  }
  const mesh=new THREE.Mesh(geometry(p,colors,anchors,indices),snow);
  mesh.name='Drifted roof snow';mesh.castShadow=mesh.receiveShadow=true;mesh.customDepthMaterial=depthMaterial;
  return mesh;
}

export function createIcicles(a,b,{seed=821,spacing=.52,length=.34}={}) {
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),span=start.distanceTo(end);
  const rand=mulberry32(seed),pos=[],colors=[],anchors=[],idx=[];
  const origin=new THREE.Vector3(),hue=new THREE.Color(),sides=8;
  // Meltwater gathers in channels. A long, banded spike usually has a few
  // smaller neighbours, with dry stretches between channels.
  function spike(t,h) {
    origin.lerpVectors(start,end,t);
    const r=h*(.075+rand()*.057),twist=rand()*6.28,kx=(rand()-.5)*r*.72,kz=(rand()-.5)*r*.72;
    const offset=pos.length/3;
    const rings=[[0,1.13],[.038,.85],[.14,.74],[.22,.79],[.48,.55],[.54,.57],[.83,.25],[1,.016]];
    for(const [j,[v,radius]] of rings.entries())for(let i=0;i<sides;i++){
      const ang=twist+Math.PI*2*i/sides;
      const flutes=1+.10*Math.sin(ang*3.+twist)+.05*Math.sin(ang*5.+v*2.7);
      const dx=Math.cos(ang)*r*radius*flutes,dz=Math.sin(ang)*r*radius*flutes;
      pos.push(origin.x+dx+kx*v*v,origin.y-h*v,origin.z+dz+kz*v*v);
      anchors.push(origin.x,origin.y,origin.z);
      const s=.72+.24*(.5+.5*Math.sin(ang+twist))+.036*(j%2);
      const frost = (1-v)*(1-v)*.17;
      hue.setRGB(s*.79+frost,s*.92+frost,s*.99+frost);colors.push(hue.r,hue.g,hue.b);
      const k=offset+j*sides+i,next=offset+j*sides+(i+1)%sides;
      if(j+1<rings.length)idx.push(k,next,k+sides,next,next+sides,k+sides);
    }
  }
  for(let s=spacing*rand();s<span;s+=(1.4+rand()*3.5)*spacing){
    const primary=length*(.65+rand()**1.5*1.07);
    spike(s/span,primary);
    const count=1+Math.floor(rand()*5);
    for(let i=0;i<count;i++){
      const k=s+(rand()-.5)*spacing;
      if(k>0&&k<span)spike(k/span,primary*(.16+rand()*.52));
    }
  }
  const mesh=new THREE.Mesh(geometry(pos,colors,anchors,idx),ice);
  mesh.name='Drip ice at eave';mesh.receiveShadow=true;
  return mesh;
}
