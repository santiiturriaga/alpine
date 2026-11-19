import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { beam, box, mergedMesh } from './scenery.js';
import { hash2, smoothstep } from './util.js';

function streetLamps(roads, ground, env) {
  const lamps = [], sites = new Set();
  for (const { points, ref, kind, lit } of roads) {
    if (lit === 'no' || !(/^D\s?90\b/.test(ref ?? '') || kind === 'residential' || lit === 'yes')) continue;
    let next = 12;
    for (let i = 1; i < points.length; i++) {
      const [ax,az] = points[i-1], [bx,bz] = points[i];
      const length = Math.hypot(bx-ax,bz-az);
      if (length < .07) continue;
      const dx = (bx-ax)/length, dz = (bz-az)/length;
      for (; next < length; next += 36) {
        const x = ax + dx*next, z = az + dz*next;
        if (x < -4210 || x > -1230 || z < -11450 || z > -4020) continue;
        const cell = `${Math.round(x/23)}:${Math.round(z/23)}`;
        if (sites.has(cell)) continue;
        const offset = (kind === 'secondary' ? 6.0 : 4.1) * (hash2(x,z,381) < .52 ? -1 : 1);
        const px = x + dz*offset, pz = z - dx*offset, y = ground.heightAt(px,pz);
        if (!env.isOpen(px,y+1,pz,.8)) continue;
        const height = kind === 'secondary' ? 6.6 : 5.2;
        const yaw = Math.sign(offset);
        lamps.push({ x, z, px, pz, y, height, dx: -yaw*dz, dz: yaw*dx });
        sites.add(cell);
      }
      next -= length;
    }
  }
  return lamps;
}

function lightField(lamps) {
  const step = 4, minX = -4300, minZ = -11520, width = 800, height = 1930;
  const data = new Uint8Array(width*height*4);
  for (const { x,z } of lamps) {
    const i0 = Math.floor((x-minX)/step), j0 = Math.floor((z-minZ)/step);
    for (let j = j0-7; j <= j0+7; j++) for (let i = i0-7; i <= i0+7; i++) {
      const dist = Math.hypot(x-minX-(i+.5)*step,z-minZ-(j+.5)*step);
      const strength = Math.round(144*(1-smoothstep(2,28,dist))**1.5);
      const index = (j*width+i)*4;
      data[index] = Math.min(230,data[index]+strength);
    }
  }
  const texture = new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
  texture.name = 'Méribel village street lighting';
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, limits: new THREE.Vector4(minX,minZ,width*step,height*step) };
}

export function buildTarentaiseLights(scene, config, ground, env) {
  if (config.id !== 'les-3-vallees') return null;
  const lamps = streetLamps(config.roads ?? [],ground,env);
  if (!lamps.length) return null;
  const group = new THREE.Group();
  group.name = 'Méribel and Les Allues · road lighting';
  const parts = [], emitters = [];
  for (const { px,pz,y,height,dx,dz } of lamps) {
    const end = [px+dx*.86,y+height+.11,pz+dz*.86];
    parts.push(beam([px,y-.18,pz],[px,y+height,pz],.083,.083,'#495151'),
      beam([px,y+height-.31,pz],end,.068,.06,'#3b4546'),
      box(.30,.09,.35,'#434846',end));
    emitters.push(end[0],end[1]-.052,end[2]);
  }
  const poles = mergedMesh(parts,{ roughness: .72, metalness: .18 });
  poles.castShadow = false;
  for (const piece of parts) piece.geo.dispose();
  group.add(poles);
  const strength = ground.setNightLightField(lightField(lamps)) ?? { value: 0 };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(emitters,3));
  const glow = new THREE.Points(geometry,new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), strength },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    vertexShader: `#include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position,1.);
        gl_Position = projectionMatrix*mvPosition;
        gl_PointSize = clamp(1250. / max(1.,-mvPosition.z),4.5,28.);
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform float strength;
      void main() {
        float r = length(gl_PointCoord-.5);
        float core = 1.-smoothstep(.047,.18,r);
        float bloom = exp(-23.*r*r)*(1.-smoothstep(.24,.50,r));
        #ifdef FOG_EXP2
          float fog = exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
        #else
          float fog = 1.;
        #endif
        gl_FragColor = vec4(vec3(1.,.55,.13),min(1.,strength*fog*(core*.98+bloom*.31)));
        #include <colorspace_fragment>
      }`,
  }));
  glow.name = 'Streetlamp bulbs and halos';
  group.add(glow);
  scene.add(group);
  return () => {
    strength.value = smoothstep(.36,.88,climateUniforms.night.value) * 1.6;
    glow.visible = strength.value > .006;
  };
}
