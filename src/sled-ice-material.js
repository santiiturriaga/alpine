import * as THREE from 'three';
import { hash2, mix } from './math.js';

const size = 128;
let texels;

function cloud(x, y, scale, seed) {
  const u = x * scale, v = y * scale;
  const a = Math.floor(u), b = Math.floor(v);
  const t = u - a, s = v - b;
  const dx = t * t * (3 - 2 * t), dy = s * s * (3 - 2 * s);
  const sample = (i, j) => hash2(i % scale, j % scale, seed);
  return mix(mix(sample(a, b), sample(a + 1, b), dx), mix(sample(a, b + 1), sample(a + 1, b + 1), dx), dy);
}

function packedNoise() {
  if (!texels) {
    texels = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const u = i / size, v = j / size;
        const broad = cloud(u, v, 4, 22) * .69 + cloud(u, v, 8, 31) * .31;
        const detail = cloud(u, v, 13, 75) * .62 + cloud(u, v, 28, 81) * .38;
        const k = (j * size + i) * 4;
        texels[k] = Math.round(broad * 255);
        texels[k + 1] = Math.round(detail * 255);
        texels[k + 2] = Math.round(hash2(i, j, 87) * 255);
        texels[k + 3] = 255;
      }
    }
  }
  const texture = new THREE.DataTexture(texels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const common = /* glsl */ `
  varying vec3 sledIce;
  uniform float iceLength;

  float glacierSpill(vec3 p) {
    float mouth = exp(-max(0.,p.z+1.)*.055);
    float exitLight = exp(-max(0.,iceLength-p.z-.5)*.074);
    float lens = .58+.20*sin(p.z*.087+sin(p.x*.4))+.14*cos(p.z*.127-p.y*.47);
    return clamp(.24+mouth*.70+exitLight*.58+lens*.35,0.,1.);
  }
`;

// Blackcomb's sediment layers, density changes and derivative relief use a
// packed periodic texture here to keep the long sled tunnel inexpensive.
const wall = /* glsl */ `
  vec3 p = sledIce;
  vec3 deformation = texture2D(map,vec2(p.x*.047+p.y*.013,p.z*.016+p.y*.038)).rgb;
  float flow = p.y+.268*p.z+.020*p.x*p.x+.81*sin(p.z*.19+p.x*.28)+3.0*deformation.r;
  vec3 strata = texture2D(map,vec2(p.z*.025+p.x*.029,flow*.20)).rgb;
  vec3 melt = texture2D(map,vec2(p.x*.092+p.z*.033,flow*.21+p.z*.017)).rgb;
  float seam = abs(fract(flow*.61+.72*deformation.r)-.5);
  float vein = 1.-smoothstep(.013,.090+fwidth(flow)*.17,seam);
  float silt = vein*smoothstep(.28,.69,melt.r);
  float bubbles = smoothstep(.25,.79,.36*strata.r+.35*melt.g+.29*deformation.r);
  vec3 blue = mix(vec3(.031,.142,.232),vec3(.117,.377,.494),deformation.r);
  vec3 clearIce = mix(vec3(.183,.437,.530),vec3(.57,.77,.82),.48*strata.g+.52*melt.r);
  vec3 ice = mix(blue,clearIce,bubbles*.83);
  ice *= mix(vec3(1.),vec3(.54,.65,.67),silt*.74);
  float frost = smoothstep(.52,.75,deformation.r*.21+melt.r*.50+strata.g*.29);
  ice = mix(ice,vec3(.48,.66,.74),frost*.36);
  diffuseColor.rgb = ice;
  float heightRelief = .074*melt.r+.020*strata.g-.031*silt+.007*melt.b;
`;

const portal = /* glsl */ `
  float up = dot(normalize(vNormal),mat3(viewMatrix)*vec3(0.,1.,0.));
  float surfaceSnow = smoothstep(.41,.94,up*.72+.29*deformation.g+.24*strata.r);
  vec3 powder = mix(vec3(.62,.77,.84),vec3(.91,.96,.98),deformation.r);
  diffuseColor.rgb = mix(ice,powder,surfaceSnow);
  heightRelief *= 1.-surfaceSnow*.64;
`;

const floor = /* glsl */ `
  vec3 p = sledIce;
  vec3 drift = texture2D(map,vec2(.029*p.x,.024*p.z)).rgb;
  vec3 tread = texture2D(map,vec2(.16*p.x+.031*p.z,.39*p.z)).rgb;
  float worn = 1.-smoothstep(.4,2.35,min(abs(p.x),min(abs(p.x-8.6),abs(p.x+8.6))));
  float frost = smoothstep(.37,.77,drift.r*.59+drift.g*.41-worn*.21);
  frost = clamp(frost+smoothstep(12.,18.5,abs(p.x))*.43,0.,.84);
  float scar = 1.-smoothstep(.025,.075+fwidth(p.x)*.07,abs(fract(.22*p.x+.066*p.z+.8*drift.r)-.5));
  vec3 glass = mix(vec3(.074,.183,.235),vec3(.231,.430,.505),tread.r*.40+drift.r*.60);
  glass = mix(glass,vec3(.37,.57,.62),scar*.40);
  vec3 powder = mix(vec3(.51,.646,.711),vec3(.74,.827,.86),tread.g);
  diffuseColor.rgb = mix(glass,powder,frost);
  float heightRelief = .019*drift.r+.025*tread.g*frost+.002*tread.b;
`;

export function sledIceMaterials(height, length) {
  const map = packedNoise();
  function material(kind) {
    const outer = kind === 'portal';
    const ice = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: kind === 'floor' ? .56 : .38 });
    ice.name = { wall: 'Layered Blackcomb meltwater ice', portal: 'Fractured ice and granular snow', floor: 'Worn snow and planed glacial ice' }[kind];
    ice.customProgramCacheKey = () => `sled-stratified-ice-${kind}`;
    ice.onBeforeCompile = shader => {
      shader.uniforms.iceDatum = { value: height };
      shader.uniforms.iceLength = { value: length };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 sledIce;\nuniform float iceDatum;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          sledIce=vec3(uv.x,(modelMatrix*vec4(position,1.)).y-iceDatum,uv.y);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + common)
        .replace('#include <map_fragment>', kind === 'floor' ? floor : wall + (outer ? portal : ''))
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
          vec3 rx=cross(dy,normal),ry=cross(normal,dx);
          float scale=dot(dx,rx);
          normal=normalize(max(abs(scale),1e-8)*normal-sign(scale)*(dFdx(heightRelief)*rx+dFdy(heightRelief)*ry));`);
      if (!outer) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          float spill=glacierSpill(sledIce);
          float graze=pow(1.-max(dot(normal,normalize(vViewPosition)),0.),3.);
          reflectedLight.directDiffuse*=.57*spill;
          reflectedLight.indirectDiffuse*=.35+.34*spill;
          reflectedLight.directSpecular*=.71*spill;
          totalEmissiveRadiance+=diffuseColor.rgb*(.26+spill*(.62+.25*graze));`);
      }
    };
    return ice;
  }
  return { wall: material('wall'), portal: material('portal'), floor: material('floor') };
}
