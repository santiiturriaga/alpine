import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { lerp, mulberry32, noise2, smoothstep } from './util.js';

// Shoulder above Glacier Bowl, on the Cirque and Couloir side of Whistler Peak.
// The cliff profiles are interpreted from the photograph, which has no GPS fix.
const ridge = { x: -127, z: 5836, ax: -.59, az: .8074 };
function ridgePoint(u, y, w) {
  return [ridge.x - ridge.az * u + ridge.ax * w, y, ridge.z + ridge.ax * u + ridge.az * w];
}

export const ALPINE_CLIFF_START = { x: -73, z: 5754, heading: -.58, holdAtUnload: true };

function cliffMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: .92, metalness: .02, side: THREE.DoubleSide });
  m.name = 'Dark jointed bedrock, crustose lichen and settled snow';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.cliffSnowpack = climateUniforms.snowpack;
    shader.uniforms.cliffWetness = climateUniforms.wetness;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 cliffPoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ncliffPoint = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 cliffPoint;
        uniform float cliffSnowpack, cliffWetness;
        float cragHash(vec3 p) {
          p = fract(p * vec3(.1031,.1030,.0973));
          p += dot(p,p.yxz+33.33);
          return fract((p.x+p.y)*p.z);
        }
        float cragNoise(vec3 p) {
          vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(mix(cragHash(i),cragHash(i+vec3(1,0,0)),f.x),
            mix(cragHash(i+vec3(0,1,0)),cragHash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(cragHash(i+vec3(0,0,1)),cragHash(i+vec3(1,0,1)),f.x),
            mix(cragHash(i+vec3(0,1,1)),cragHash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 rockPoint = cliffPoint - vec3(-127., 2090., 5836.);
        float upright = dot(normalize(vNormal),mat3(viewMatrix)*vec3(0,1,0));
        float g = cragNoise(rockPoint * vec3(.74,.15,.92));
        float mineral = cragNoise(rockPoint * 4.5);
        float streak = cragNoise((rockPoint + vec3(0,-2,0)) * vec3(.85,.037,1.1));
        float sediment = cragNoise(rockPoint*vec3(.16,.31,.12));
        float fracture = cragNoise(vec3(rockPoint.x*1.4,rockPoint.y*.48+rockPoint.x*.16,rockPoint.z*1.4));
        float seams = smoothstep(.016,.057,abs(fract((rockPoint.y*.21 + rockPoint.x*.091 + g*.23))-.5));
        float facets = (.48*fracture+.36*g+.16*mineral) * mix(.65,1.,seams);
        vec3 stone = mix(vec3(.019,.023,.026),vec3(.17,.156,.124),smoothstep(.12,.84,facets));
        float flecks=cragNoise(rockPoint*19.);
        float detailFade=1.-smoothstep(.33,1.05,length(fwidth(rockPoint)*19.));
        stone += detailFade*smoothstep(.78,.91,flecks)*vec3(.064,.062,.054);
        float colony = smoothstep(.46,.68,streak*.65+sediment*.18+mineral*.09+g*.08);
        float dryFace = (1.-.36*smoothstep(2.,17.,rockPoint.y))*(1.-smoothstep(.39,.75,upright));
        float lichen = colony*dryFace*smoothstep(.16,.53, .57*mineral+.43*fracture);
        vec3 olive = mix(vec3(.067,.069,.018),vec3(.249,.244,.084),g*.51+sediment*.36);
        stone=mix(stone,olive,lichen*.67)*(1.-cliffWetness*.26);
        float frosting=smoothstep(.27,.74,upright+.23*(g-.46)+.38*(sediment-.45));
        vec3 frost=mix(vec3(.49,.60,.71),vec3(.83,.89,.94),smoothstep(.09,.7,mineral));
        diffuseColor.rgb *= mix(stone,frost,frosting*cliffSnowpack);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 drx=dFdx(-vViewPosition), dry=dFdy(-vViewPosition);
        vec3 r1=cross(dry,normal), r2=cross(normal,drx);
        float det=dot(drx,r1);
        float relief=(.037*mineral+.018*fracture+.006*flecks*detailFade)*(1.-.81*frosting*cliffSnowpack);
        normal=normalize(max(abs(det),1e-8)*normal-sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2));`);
  };
  m.customProgramCacheKey = () => 'whistler-bedrock-v1';
  return m;
}

function rockGeometry(crags, ground) {
  const positions = [], indices = [];
  const append = (p) => { positions.push(...p); return positions.length / 3 - 1; };
  const quad = (a, b, c, d, inverse) => {
    if (inverse) indices.push(a, b, d, a, d, c);
    else indices.push(a, b, c, b, d, c);
  };

  for (const { center, depth, columns, seed, backfill = false } of crags) {
    const rng = mulberry32(seed);
    const profile = columns.map(([u, w, height]) => {
      const [x, ,z] = ridgePoint(u + center, 0, w + depth);
      return { u: u + center, w: w + depth, y: ground(x,z) - 1.9, height, lean: lerp(-2.6,2.1,rng()) };
    });
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i], b = profile[i+1];
      const joints = [.0,.12,.19,.33,.43,.61,.70,.81,.92,1.0];
      const face = [], shoulder = [];
      const slant = lerp(-7.6,7.5,rng());
      const rib = lerp(.30,2.3,rng());
      const setBack = (i % 4 === 1 ? 2.6 : .2) + rng() * 1.55;
      const crownReach = 10 + rng() * 17;
      for (let j = 0; j < joints.length; j++) {
        const t = joints[j];
        const upper = smoothstep(.64,1,t);
        const ledge = (j % 3 === 2 ? 2.7 : j % 3 === 0 ? .25 : -1.3)*(rib*.25+.66);
        const row = [];
        for (const [k, v] of (backfill ? [0,.21,.55,.84,1] : [.010,.19,.58,.86,.989]).entries()) {
          const edge = k === 0 || k === 4;
          const u = lerp(a.u,b.u,v) + t * lerp(a.lean,b.lean,v) + slant*t*.37;
          const height = lerp(a.height,b.height,v);
          const bench = (j === 0 ? 0 : (rng()-.5)*2.0) + 1.3*Math.sin(u*.27+j*.67) + .45*Math.cos(u*.64-j*.49);
          const w = lerp(a.w,b.w,v) + t*2.1 + 7.6*upper + ledge
            + setBack + rib * (edge ? .72 : -.55) + (rng()-.5)*.82;
          row.push(append(ridgePoint(u,lerp(a.y,b.y,v)+height*t+bench,w)));
          if(j === joints.length-1) {
            const back = w + crownReach;
            const [x,,z] = ridgePoint(u,0,back);
            shoulder.push(append(ridgePoint(u,ground(x,z)-2.4,back)));
          }
        }
        face.push(row);
      }
      for (let j = 0; j < face.length - 1; j++) {
        for (let k = 0; k < face[j].length - 1; k++)
          quad(face[j][k],face[j][k+1],face[j+1][k],face[j+1][k+1],(i+j+k)%3 === 1);
        // The recess at each vertical joint extends into solid rock.
        for (const k of [0,4]) {
          const side = [face[j][k],face[j+1][k]].map((id) => {
            const p = positions.slice(id*3,id*3+3);
            p[0] += ridge.ax * 5.2; p[2] += ridge.az * 5.2;
            return append(p);
          });
          quad(face[j][k],side[0],face[j+1][k],side[1],k===0);
        }
      }
      const crown = face.at(-1);
      for (let k = 0; k < crown.length-1; k++)
        quad(crown[k],crown[k+1],shoulder[k],shoulder[k+1],false);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// Follow the actual deformed rock surface as the inclined beds break across
// adjacent blocks. The upper faces collect snow through the cliff material.
function shelfGeometry(mountain,ground) {
  const pos=[],indices=[],origin=new THREE.Vector3(),dir=new THREE.Vector3(ridge.ax,0,ridge.az).normalize();
  const ray=new THREE.Raycaster(origin,dir,0,175);
  for(const [begin,end,base,rise] of [[-24,4,8,.37],[5,27,10,.43]]){
    let previous=null;
    for(let step=0;step<=36;step++){
      const t=step/36,u=lerp(begin,end,t),[gx,,gz]=ridgePoint(u,0,17);
      const y=ground(gx,gz)+base+(u-begin)*rise+1.3*Math.sin(t*4.6);
      ray.ray.origin.fromArray(ridgePoint(u,y,-100));
      const hit=ray.intersectObject(mountain,false)[0];
      if(!hit){previous=null;continue;}
      const edge=.18+Math.sin(Math.PI*t)*(.98+.26*Math.sin(t*17.2));
      const v=hit.point,idx=pos.length/3;
      for(const [offset,lift] of [[-.22,.14],[edge*.75,.16+edge*.12],[edge,.01],[.2,-edge*.43]]){
        pos.push(v.x-dir.x*offset,v.y+lift,v.z-dir.z*offset);
      }
      if(previous && previous.point.distanceToSquared(v)<21){
        for(let j=0;j<3;j++)indices.push(previous.idx+j,idx+j+1,idx+j,previous.idx+j,previous.idx+j+1,idx+j+1);
      }
      previous={idx,point:v};
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(indices);
  g.computeVertexNormals();return g;
}

export function buildAlpineCliffs(scene, grid, ground) {
  const crags = [
    { center:-42, depth:17, seed:711, columns:[[-22,6,2],[-17,-1,17],[-12,-3,24],[-6,-4,28],[0,-6,25],[5,-4,23],[12,-2,19],[18,5,6],[24,11,1]] },
    { center:1, depth:25, seed:459, columns:[[-31,12,6],[-24,6,17],[-19,2,26],[-13,-1,38],[-7,-5,45],[-1,-7,48],[6,-9,50],[11,-6,45],[17,-3,42],[22,4,34],[26,10,24],[30,18,12],[34,23,1]] },
    { center:53, depth:26, seed:45, columns:[[-10,15,5],[-5,10,16],[1,5,34],[8,-2,46],[15,1,49],[23,1,47],[29,5,38],[40,6,28],[49,12,13],[54,21,1]] },
  ];
  const parent = crags[1];
  const rockMass = {
    ...parent, depth:parent.depth+6, seed:80, backfill:true,
    columns:parent.columns.map(([u,w,height],i)=>[u-1.8,w,height*.64 + (i%3===1?4:0)]),
  };
  const spalls = [
    { center:-28,depth:10,seed:7851,columns:[[-6,4,1],[-3,0,3],[0,-2,4],[2,-1,3],[5,3,1]] },
    { center:12,depth:11,seed:9106,columns:[[-5,4,1],[-2,0,5],[1,1,7],[7,5,2]] },
    { center:-7,depth:12,seed:918,columns:[[-6,7,1],[-3,2,4],[0,4,5],[4,7,2]] },
  ];
  const mountain = new THREE.Mesh(rockGeometry([rockMass,...crags,...spalls],ground),cliffMaterial());
  mountain.name = 'Whistler alpine cliffs · jointed buttresses and snow chutes';
  mountain.castShadow = true;
  mountain.receiveShadow = true;
  scene.add(mountain);
  const shelves=new THREE.Mesh(shelfGeometry(mountain,ground),mountain.material);
  shelves.name='Sloping, snow-bearing rock shelves';shelves.castShadow=shelves.receiveShadow=true;scene.add(shelves);

  for (const {center,depth,columns} of crags) {
    for (const [u,w,height] of columns) {
      if (height < 14) continue;
      const [x,,z] = ridgePoint(u+center,0,w+depth+4.5);
      const floor = ground(x,z);
      grid.addCircle(x,z,3.1,'rock',{minY:floor-5,maxY:floor+height*.55});
    }
  }
  const [x,,z] = ridgePoint(45,0,-63);
  return {
    view: { eye:[x,ground(x,z)+9,z],target:ridgePoint(-2,2095,15),fov:30,aspect:1.5 },
  };
}
