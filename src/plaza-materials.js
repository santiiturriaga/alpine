import * as THREE from 'three';
import { mergeParts } from './scenery.js';

// Object coordinates survive the batching step. Grain follows the long axis of
// every post, rail and brace instead of running horizontally across the lodge.
export function timberMesh(parts) {
  const coordinates = [];
  for (const p of parts) {
    const geo = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const long = size.y >= size.x && size.y >= size.z ? 1 : size.x >= size.z ? 0 : 2;
    const a = geo.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const v = [a.getX(i), a.getY(i), a.getZ(i)];
      coordinates.push(v[(long + 1) % 3], v[(long + 2) % 3], v[long]);
    }
    if (geo !== p.geo) geo.dispose();
  }
  const geometry = mergeParts(parts);
  geometry.setAttribute('timberPoint', new THREE.Float32BufferAttribute(coordinates, 3));
  const material = detailedMaterial('timber');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const noise = /* glsl */ `
  varying vec3 detailPoint;
  float plazaHash(vec3 p) {
    p = fract(p * .1031); p += dot(p, p.yzx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float plazaNoise(vec3 p) {
    vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(plazaHash(i),plazaHash(i+vec3(1,0,0)),f.x),
      mix(plazaHash(i+vec3(0,1,0)),plazaHash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(plazaHash(i+vec3(0,0,1)),plazaHash(i+vec3(1,0,1)),f.x),
      mix(plazaHash(i+vec3(0,1,1)),plazaHash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  vec3 plazaBump(vec3 n, float h) {
    vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
    vec3 a=cross(dy,n),b=cross(n,dx); float d=dot(dx,a);
    return normalize(max(abs(d),1e-12)*n-sign(d)*(dFdx(h)*a+dFdy(h)*b));
  }
  float stoneEdges(vec2 p) {
    vec2 cell=floor(p),f=fract(p);float first=20.0,second=20.0;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec2 offset=vec2(float(x),float(y)),id=cell+offset;
      vec2 seed=vec2(plazaHash(vec3(id,3.7)),plazaHash(vec3(id,8.1)));
      vec2 d=offset+.16+.68*seed-f;float distance=dot(d,d);
      if(distance<first){second=first;first=distance;}else{second=min(second,distance);}
    }
    return second-first;
  }
`;

const timber = /* glsl */ `
  vec3 p=detailPoint;
  float warp=plazaNoise(vec3(p.xy*5.0,p.z*.23));
  float fibers=plazaNoise(vec3(p.xy*92.0+warp*2.3,p.z*1.8));
  float growth=.5+.5*sin(length(p.xy+vec2(.23,.41))*88.0+warp*3.0);
  float split=1.0-smoothstep(.027,.10,abs(plazaNoise(vec3(p.xy*17.0,p.z*.51))-.51));
  float fade=1.0-smoothstep(.35,1.1,length(fwidth(p*vec3(92,92,1.8))));
  float relief=.0014*fibers*fade+.0028*growth-.004*split;
  diffuseColor.rgb *= .78+.16*growth+.17*fibers*fade;
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.50,.48,.43),split*.58);
`;

const granite = /* glsl */ `
  vec3 p=detailPoint;
  float broad=plazaNoise(p*vec3(7.4,11.7,6.9));
  float strata=plazaNoise(vec3(p.x*4.1,p.y*36.0+p.x*7.7,p.z*5.0));
  float grit=plazaNoise(p*148.0);
  float grainFade=1.0-smoothstep(.32,1.1,length(fwidth(p*148.0)));
  float fracture=stoneEdges(vec2(p.x*3.1+p.y*.29,p.y*3.7+p.z*1.6));
  float branch=smoothstep(.24,.56,plazaNoise(p*vec3(7.2,6.4,6.7)));
  float crack=(1.0-smoothstep(.003,.017,fracture))*branch;
  float flake=1.0-smoothstep(.012,.031,abs(strata-.46));
  float damp=plazaNoise(p*vec3(19.0,3.5,16.0));
  float moss=crack*smoothstep(.53,.71,damp);
  float relief=.022*broad+.007*strata+.0012*grit*grainFade-.005*crack-.001*flake;
  diffuseColor.rgb *= .81+.25*broad+.15*strata+(grit-.5)*.17*grainFade;
  diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.048,.043,.030),crack*.64);
  diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.071,.078,.037),moss*.65);
`;

export function detailedMaterial(kind) {
  const wood = kind === 'timber';
  const material = new THREE.MeshStandardMaterial({ vertexColors:true,roughness:wood?.81:.94 });
  material.customProgramCacheKey = () => 'plaza-' + kind + '-v1';
  material.onBeforeCompile = shader => {
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 detailPoint;'+(wood?'\nattribute vec3 timberPoint;':''))
      .replace('#include <begin_vertex>','#include <begin_vertex>\ndetailPoint='+(wood?'timberPoint;':'position;'));
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\n'+noise)
      .replace('#include <color_fragment>','#include <color_fragment>\n'+(wood?timber:granite))
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=plazaBump(normal,relief);');
  };
  return material;
}
