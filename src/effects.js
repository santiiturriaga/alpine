import * as THREE from 'three';
import { clamp, makeCanvas, mulberry32, makeRadialTexture } from './util.js';
import { heightAt, normalAt, terrain } from './terrain.js';
import { WORLD } from './worlddata.js';
import { climateUniforms } from './climate-state.js';
import { updateSnowShutter } from './snow-crystals.js';
import { coniferGeometry } from './conifers.js';
import { strikeTreeSnow, updateTreeSnow } from './tree-snow.js';

export const SUN_DIR = climateUniforms.snowSunDirection.value;
const middayDirection = SUN_DIR.clone(), skySunDirection = SUN_DIR.clone();
const lowSunDirection = new THREE.Vector3(-.89,.212,.403).normalize();
const goldenDirection = new THREE.Vector3(-.94,.085,.33).normalize();
const moonDirection = new THREE.Vector3(.55,.48,-.68).normalize();

/* ═══════════════════════════════════════════════════════════════
   LIGHT + SKY
   ═══════════════════════════════════════════════════════════════ */

export function createLighting(scene) {
  // Diffuse skylight reaches the needles from above and reflects back off
  // the snow below, especially on the shaded side of a run.
  const hemi = new THREE.HemisphereLight(0xd5e4f0, 0xa7b7c0, 1.13);
  hemi.name = 'hemisphere';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.18);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 2600;
  sun.shadow.camera.left = -73;
  sun.shadow.camera.right = 73;
  sun.shadow.camera.top = 73;
  sun.shadow.camera.bottom = -73;
  sun.shadow.bias = -0.00014;
  sun.shadow.normalBias = 0.065;
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x9dc4db, 0.32);
  fill.position.set(0.5, 0.35, -0.7);
  scene.add(fill);

  return { sun, hemi, fill,
    setClimate(palette) {
      if (palette.cycle) {
        const azimuth = (palette.hour - 12) * Math.PI / 12 + .47;
        skySunDirection.set(-Math.sin(azimuth), Math.max(-.24, palette.sunArc * .67), Math.cos(azimuth)).normalize();
      } else {
        skySunDirection.copy(middayDirection).lerp(lowSunDirection, palette.late)
          .lerp(goldenDirection, palette.golden).normalize();
      }
      SUN_DIR.copy(skySunDirection);
      SUN_DIR.y = Math.max(.028, SUN_DIR.y);
      SUN_DIR.lerp(moonDirection, palette.darkness).normalize();
      sun.color.copy(palette.lightColor); sun.intensity = palette.sunIntensity;
      hemi.color.copy(palette.hemiSky); hemi.groundColor.copy(palette.hemiGround);
      hemi.intensity = palette.hemiIntensity;
      fill.color.copy(palette.fillColor); fill.intensity = palette.fillIntensity;
    },
  };
}

export function createWinterEnvironment(renderer) {
  const width = 256, height = 128;
  const pixels = new Uint16Array(width * height * 4);
  const snow = new THREE.Color('#aebcca');
  const horizon = new THREE.Color('#deeaf2'), zenith = new THREE.Color('#5d8fbc');
  const cloud = new THREE.Color('#e7edf4'), color = new THREE.Color();
  const half = THREE.DataUtils.toHalfFloat;
  for (let y = 0; y < height; y++) {
    const latitude = ((y + .5) / height - .5) * Math.PI;
    const u = Math.sin(latitude), radius = Math.cos(latitude);
    for (let x = 0; x < width; x++) {
      const lon = (x + .5) / width * 2 * Math.PI;
      const dx = Math.cos(lon) * radius, dz = Math.sin(lon) * radius;
      const above = Math.max(0, u);
      const wind = Math.sin(dx*11+dz*4 + Math.sin(dz*13)*.56)
        + .51*Math.sin(dx*18.2-dz*14.9) + .22*Math.sin(dx*31.3+dz*26.4);
      const bank = clamp((wind + .54)*.48,0,.85) * (1 - .47 * above);
      const sunward = Math.max(0, dx*SUN_DIR.x+u*SUN_DIR.y+dz*SUN_DIR.z);
      color.copy(horizon).lerp(zenith, Math.pow(above,.5)).lerp(cloud, bank);
      if (u < 0) color.copy(snow).multiplyScalar(.38 + .25 * (1+u));
      color.multiplyScalar(.65 + Math.pow(sunward,12) * .74 + bank * .21);
      const offset = 4 * (y*width+x);
      pixels[offset] = half(color.r);
      pixels[offset+1] = half(color.g);
      pixels[offset+2] = half(color.b);
      pixels[offset+3] = half(1);
    }
  }
  const texture = new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat,THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromEquirectangular(texture);
  generator.dispose();
  texture.dispose();
  return environment.texture;
}

export function createSky(scene) {
  const skyGeo = new THREE.SphereGeometry(11000, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: skySunDirection },
      uEye: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uZenith: { value: new THREE.Color(0x295b94) },
      uMid: { value: new THREE.Color(0x648fb9) },
      uHorizon: { value: new THREE.Color(0xdbe9f1) },
      uSunColor: { value: new THREE.Color(0xffe6c2) },
      uCloudShade: { value: new THREE.Color('#626f7d') },
      uCloudLight: { value: new THREE.Color('#e8f2fa') },
      uCloud: { value: .52 },
      uNight: { value: 0 },
      uMoon: { value: moonDirection },
      uMoonStrength: { value: 0 },
      uSunStrength: { value: 1 },
      uGolden: { value: 0 },
      uWhiteout: { value: 0 },
      uCloudField: { value: null },
      uBakedClouds: { value: false },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uSun;
      uniform vec3 uZenith;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uEye;
      uniform float uTime;
      uniform vec3 uCloudShade;
      uniform vec3 uCloudLight;
      uniform float uCloud;
      uniform float uNight;
      uniform vec3 uMoon;
      uniform float uMoonStrength;
      uniform float uSunStrength;
      uniform float uGolden;
      uniform float uWhiteout;
      uniform sampler2D uCloudField;
      uniform bool uBakedClouds;

      float skyHash(vec2 p) {
        p = fract(p * vec2(.1031, .1030));
        p += dot(p, p.yx + 31.32);
        return fract((p.x + p.y) * p.x);
      }
      float skyNoise(vec2 p) {
        vec2 b = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(skyHash(b),skyHash(b+vec2(1,0)),f.x),
          mix(skyHash(b+vec2(0,1)),skyHash(b+vec2(1,1)),f.x),f.y);
      }
      float cloudNoise(vec2 p) {
        if (uBakedClouds) return texture2D(uCloudField, p / 32.0 + .5).r;
        mat2 rotation=mat2(.81,.586,-.586,.81);
        float sum=.54*skyNoise(p);
        p=rotation*p*2.06+vec2(4.1,-1.7);
        sum+=.252*skyNoise(p);
        p=rotation*p*2.02+vec2(-2.8,8.3);
        sum+=.132*skyNoise(p);
        p=rotation*p*2.1;
        return sum+.051*skyNoise(p)+.025*skyNoise(rotation*p*2.11);
      }
      float cloudDensity(vec2 p) {
        if (uBakedClouds) {
          float field = texture2D(uCloudField, p / 32.0 + .5).g * 1.25 - .125;
          return smoothstep(mix(.67,.24,uCloud), mix(.84,.49,uCloud), field);
        }
        float large=skyNoise(p*.36+13.1);
        vec2 curl=vec2(skyNoise(p*.69+7.0),skyNoise(p*.62-4.0));
        return smoothstep(mix(.67,.24,uCloud),mix(.84,.49,uCloud), cloudNoise(p + (curl-.5)*.98) + (large-.5)*.23);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        float horizon = exp(-h*5.8);
        vec3 col = mix(uMid,uZenith,smoothstep(.07,.86,h));
        col = mix(col,uHorizon,horizon*.9);
        float sd = max(dot(d, uSun), 0.0);
        float edge = max(fwidth(sd) * .85, .000006);
        float solarDisk = smoothstep(.999958-edge,.999958+edge,sd);
        float forwardScatter = pow(sd, mix(16.0, 7.0, uGolden)) * mix(.092, .33, uGolden);
        float sd2 = sd * sd, sd3 = sd2 * sd, sd4 = sd2 * sd2, sd8 = sd4 * sd4;
        float longPath = uGolden > 0. ? exp(-h * 6.5) * sd3 * uGolden : 0.;
        col = mix(col, uSunColor, longPath * uSunStrength * .40);
        vec3 sunlight = uSunColor*uSunStrength*(solarDisk*6.1 + pow(sd,175.0)*.33 + forwardScatter);
        if (uMoonStrength > 0.) {
          float md = max(dot(d, uMoon), 0.0);
          col += vec3(.66,.77,.98)*uMoonStrength*(smoothstep(.999968,.999984,md)*1.75 + pow(md,150.0)*.041);
        }
        col = mix(col, uHorizon, 1.0-smoothstep(-.12,0.0,d.y));
        if (d.y > .008 && uWhiteout < .995) {
          vec2 wind=vec2(uTime*.007,-uTime*.0028);
          vec2 farPlane=(uEye.xz*.43+d.xz*(2700.0/(d.y+.065)))*.00052;
          vec2 cirrus=vec2(farPlane.x*.72 + farPlane.y*.37,farPlane.y*3.71-farPlane.x*.75);
          cirrus.y+=2.9*skyNoise(farPlane*.76);
          float streak=smoothstep(.43,.74,cloudNoise(cirrus+wind*1.49));
          float veil=streak*(.08+.26*uCloud+.16*uGolden)*smoothstep(.008,.18,d.y)*(1.0-uWhiteout);
          col=mix(col,uCloudLight,veil);
          vec2 nearPlane=(uEye.xz*.57+d.xz*(1470.0/(d.y+.084)))*.00165+wind;
          float cloud=cloudDensity(nearPlane);
          // Keep the baked texture lookups coherent across the cloud edge.
          if (uBakedClouds || cloud > 0.) {
            float shade = cloudDensity(nearPlane + uSun.xz*.155);
            float ridges=cloudNoise(nearPlane*4.18+vec2(11.4,-9.5));
            cloud=clamp(cloud+(ridges-.5)*.76*cloud*(1.-cloud),0.,1.);
            float light = clamp(.57+.22*ridges-.24*shade+(cloud-shade)*.89+sd8*.24, 0.0, 1.0);
            vec3 cloudColor=mix(uCloudShade,uCloudLight,light);
            float backlit = sd8 * sd3 * uSunStrength * (.25 + .75 * uGolden);
            cloudColor += uSunColor * backlit * (.18 + .80 * max(0.0, cloud - shade));
            col=mix(col,cloudColor,cloud*.88*smoothstep(.008,.14,d.y)*(1.0-uWhiteout));
          }
          sunlight *= (1.0-veil*.33) * (1.0-cloud*mix(.74,.99,solarDisk));
          // A few dim stars emerge through clear gaps at the end of dusk.
          if (uNight > 0. && d.y > .12 && cloud < 1.) {
            vec2 starUv = vec2(atan(d.z,d.x),asin(d.y))*460.0;
            vec2 cell = floor(starUv);
            float star = step(.9965,skyHash(cell))*exp(-length(fract(starUv)-.5)*18.0);
            col += vec3(.48,.61,.87)*star*uNight*(1.0-cloud)*smoothstep(.12,.45,d.y);
          }
        }
        col += sunlight * smoothstep(-.02,.015,d.y) * (1.0-uWhiteout);
        if (uWhiteout > .01) {
          vec2 haze = d.xz*6.0 + vec2(uTime*.38,-uTime*.12);
          col *= 1.0 - uWhiteout*.07*skyNoise(haze + d.y*vec2(2.9,6.0));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  // The dome is at the far depth. Draw it after opaque terrain so only visible
  // sky pixels pay for cloud shading, including when standing inside a lodge.
  sky.renderOrder = 10000;
  scene.add(sky);

  let budget = false, cloudLoad;
  return {
    sky,
    setQuality(name) {
      budget = name === 'BUDGET';
      skyMat.uniforms.uBakedClouds.value = budget && !!skyMat.uniforms.uCloudField.value;
      if (!budget || cloudLoad) return;
      cloudLoad = new THREE.TextureLoader().loadAsync(new URL('../assets/weather/cloud-field.png', import.meta.url).href)
        .then(texture => {
          texture.flipY = false;
          texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
          texture.needsUpdate = true;
          skyMat.uniforms.uCloudField.value = texture;
          skyMat.uniforms.uBakedClouds.value = budget;
        }).catch(() => { cloudLoad = null; });
    },
    setClimate(palette) {
      for (const [uniform,key] of [['uZenith','zenith'],['uMid','mid'],['uHorizon','horizon'],
        ['uSunColor','sunColor'],['uCloudShade','cloudShade'],['uCloudLight','cloudLight']]) {
        skyMat.uniforms[uniform].value.copy(palette[key]);
      }
      skyMat.uniforms.uCloud.value = palette.cloud;
      skyMat.uniforms.uNight.value = palette.night;
      skyMat.uniforms.uMoonStrength.value = palette.darkness;
      skyMat.uniforms.uSunStrength.value = palette.sunStrength;
      skyMat.uniforms.uGolden.value = palette.golden;
      skyMat.uniforms.uWhiteout.value = palette.whiteout;
    },
    update(dt, camera) {
      sky.position.copy(camera.position);
      skyMat.uniforms.uEye.value.copy(camera.position);
      skyMat.uniforms.uTime.value += dt;
    },
  };
}

/* ═══════════════════════════════════════════════════════════════
   PARTICLES
   ═══════════════════════════════════════════════════════════════ */

const softTexture = makeRadialTexture(64, [
  [0, 'rgba(255,255,255,1)'],
  [0.28, 'rgba(255,255,255,.85)'],
  [1, 'rgba(255,255,255,0)'],
]);

// Changes can queue across several frames while a mesh is outside the view.
// Merge adjacent writes until Three uploads them; preserve the gap at a ring wrap.
function queueVertexRange(attribute, start, count) {
  if (!count) return;
  let first = start * attribute.itemSize;
  let end = first + count * attribute.itemSize;
  const pending = attribute.updateRanges;
  for (let i = pending.length - 1; i >= 0; i--) {
    const range = pending[i];
    if (first > range.start + range.count || end < range.start) continue;
    first = Math.min(first, range.start);
    end = Math.max(end, range.start + range.count);
    pending.splice(i, 1);
  }
  attribute.addUpdateRange(first, end - first);
  attribute.needsUpdate = true;
}

class ParticlePool {
  constructor(scene, count, { additive = false, snow = false, ground = terrain, sampleHeight = heightAt } = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    this.startSize = new Float32Array(count);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) this.seed[i]=(i*.6180339887)%1;
    this.floor = new Float32Array(count);
    this.normal = new Float32Array(count * 3);
    this.sunExposure = new Float32Array(count);
    this.sampleColor = new THREE.Color();
    this.sampleNormal = new THREE.Vector3(0,1,0);
    this.alpha = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    this.cursor = 0;
    this.liveSlots = 0;
    this.spawned = 0;
    this.snow = snow;
    this.ground = ground;
    this.sampleHeight = sampleHeight;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute(snow ? 'color' : 'aColor', new THREE.BufferAttribute(this.color, 3));
    if (snow) {
      geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
      geo.setAttribute('normal',new THREE.BufferAttribute(this.normal,3));
      geo.setAttribute('aSunExposure',new THREE.BufferAttribute(this.sunExposure,1));
    }
    for (const [name, attribute] of Object.entries(geo.attributes)) {
      if (name !== 'aSeed') attribute.setUsage(THREE.DynamicDrawUsage);
      attribute.onUpload(() => attribute.clearUpdateRanges());
    }
    geo.setDrawRange(0, 0);

    this.material = snow ? this.makeSnowMaterial() : new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uMap: { value: softTexture },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.75) },
      },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uPixelRatio;
        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(72.0, aSize * uPixelRatio * (160.0 / max(2.0, -mv.z)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float alpha = texture2D(uMap,gl_PointCoord).a * min(.32,vAlpha);
          if (alpha < .004) discard;
          gl_FragColor = vec4(vColor,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    if (snow) {
      this.points.receiveShadow=true;
      this.points.onBeforeRender=(renderer)=>{
        this.snowUniforms.uFrameHeight.value=renderer.domElement.height;
      };
    }
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.geo = geo;
  }

  makeSnowMaterial() {
    this.snowUniforms={uFrameHeight:{value:900}};
    // Snow uses the same physical light path as the terrain: sky/environment,
    // directional light, local shadows and the mountain's baked sun occlusion.
    const mat=new THREE.MeshStandardMaterial({
      vertexColors:true,roughness:.96,transparent:true,depthWrite:false,
    });
    mat.customProgramCacheKey=()=> 'physical-powder-billows-v3';
    mat.onBeforeCompile=(shader)=>{
      Object.assign(shader.uniforms,this.snowUniforms);
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>',`#include <common>
          attribute float aSize; attribute float aAlpha; attribute float aSeed;
          attribute float aSunExposure;
          uniform float uFrameHeight;
          varying float snowAlpha; varying float snowSeed; varying float snowSun;
        `)
        .replace('#include <project_vertex>',`#include <project_vertex>
          snowAlpha=aAlpha; snowSeed=aSeed; snowSun=aSunExposure;
          gl_PointSize=clamp(aSize*uFrameHeight*.5*projectionMatrix[1][1]/max(.4,-mvPosition.z),1.0,128.0);
          if (aAlpha < .001) gl_Position = vec4(2.,2.,2.,1.);
        `);
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <common>',`#include <common>
          varying float snowAlpha; varying float snowSeed; varying float snowSun;
        `)
        .replace('#include <color_fragment>',`#include <color_fragment>
          vec2 snowP=gl_PointCoord*2.0-1.0;
          float snowAngle=snowSeed*6.28318;
          snowP=mat2(cos(snowAngle),sin(snowAngle),-sin(snowAngle),cos(snowAngle))*snowP;
          float snowGrain=1.0-step(.18,snowSeed);
          // The wake separates into strands and denser pockets, then diffuses.
          vec2 swirl = snowP + .18*vec2(sin(snowP.y*5.+snowAngle),cos(snowP.x*4.-snowAngle));
          float eddy = sin(swirl.x*12.+snowAngle)*sin(swirl.y*9.-snowAngle);
          float snowLump=sin(snowP.x*7.0+snowAngle)*sin(snowP.y*6.0-snowAngle)*.105 + .07*eddy;
          float snowRadius=length(snowP*vec2(1.0,mix(.86,1.12,snowSeed)))+snowLump;
          float snowCore=1.0-smoothstep(mix(.10,.38,snowGrain),.98,snowRadius);
          diffuseColor.a*=pow(snowCore,1.35)*snowAlpha*mix(.77+.23*eddy,1.,snowGrain);
          if(diffuseColor.a<.004)discard;
        `)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          vec3 snowRound=normalize(vec3(snowP.x,-snowP.y,sqrt(max(.05,1.0-dot(snowP,snowP)))));
          normal=normalize(mix(normal,snowRound,.42));
        `)
        .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          reflectedLight.directDiffuse*=snowSun;
          reflectedLight.directSpecular*=snowSun;
        `);
    };
    return mat;
  }

  spawn(x, y, z, vx, vy, vz, size, life, color, airborne = false) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.liveSlots = Math.min(this.count, this.liveSlots + 1);
    this.spawned = Math.min(this.count, this.spawned + 1);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.startSize[i] = size;
    if (this.snow) {
      this.floor[i] = this.sampleHeight(x,z);
      this.sampleColor.setRGB(.88,.93,.98);
      this.sampleNormal.set(0,1,0);
      this.ground.sampleSnowSurface?.(x,z,this.sampleColor,this.sampleNormal);
      // Fresh loose grains keep the terrain's blue shadow, with a little less
      // grey crust than the pressed base they came out of.
      this.color[i*3]=Math.min(.98,this.sampleColor.r*1.12);
      this.color[i*3+1]=Math.min(.99,this.sampleColor.g*1.12);
      this.color[i*3+2]=Math.min(1,this.sampleColor.b*1.12);
      this.normal[i*3]=this.sampleNormal.x;
      this.normal[i*3+1]=this.sampleNormal.y;
      this.normal[i*3+2]=this.sampleNormal.z;
      // Advected powder retains the ski surface's downhill/uphill velocity,
      // then receives its extra lift; it does not float level over a drop.
      if (!airborne) {
        const slopeLimit = Math.max(2.8, Math.hypot(vx, vz) * .67);
        this.vel[i*3+1] += clamp(-(this.sampleNormal.x * vx + this.sampleNormal.z * vz)
          / Math.max(.4, this.sampleNormal.y), -slopeLimit, slopeLimit);
      }
      const map=this.ground.mountainShade?.image;
      if(map?.data) {
        const { minX, minZ, maxX, maxZ } = this.ground.bounds ?? WORLD;
        const mx=clamp(Math.floor((x-minX)/(maxX-minX)*map.width),0,map.width-1);
        const mz=clamp(Math.floor((z-minZ)/(maxZ-minZ)*map.height),0,map.height-1);
        this.sunExposure[i]=.24+.76*map.data[mz*map.width+mx]/255;
      } else this.sunExposure[i]=1;
    }
    this.alpha[i] = 0;
    if(!this.snow){this.color[i * 3] = color.r; this.color[i * 3 + 1] = color.g; this.color[i * 3 + 2] = color.b;}
  }

  update(dt, gravity = -2.2, drag = 1.4) {
    if (this.liveSlots === 0) return;
    const lifeArr = this.life;
    const alphaArr = this.alpha;
    const pos = this.pos, vel = this.vel;
    const start = (this.cursor - this.liveSlots + this.count) % this.count;
    const d = Math.exp(-drag * dt);
    for (let slot = 0; slot < this.liveSlots; slot++) {
      const i = (start + slot) % this.count;
      if (lifeArr[i] <= 0) continue;
      lifeArr[i] -= dt;
      const k = Math.max(0, lifeArr[i] / this.maxLife[i]);
      vel[i * 3] *= d; vel[i * 3 + 2] *= d;
      vel[i * 3 + 1] += gravity * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const age = 1 - k;
      const grain = this.seed[i] < .18;
      if (this.snow) {
        // Clumps fall quickly; fine powder expands and hangs in the wake.
        if (grain) vel[i * 3 + 1] += gravity * dt * .8;
        else {
          const curl=this.seed[i]*6.28318+age*5.3;
          vel[i*3]+=Math.cos(curl)*dt*.65;
          vel[i*3+2]+=Math.sin(curl)*dt*.65;
          vel[i*3+1]+=(1-age)*dt*1.0;
        }
        this.size[i] = this.startSize[i] * (1 + age * (grain ? .12 : 1.1));
        if (pos[i * 3 + 1] < this.floor[i] + .025) {
          this.floor[i] = this.sampleHeight(pos[i * 3], pos[i * 3 + 2]);
          if (pos[i * 3 + 1] < this.floor[i] + .025) {
            lifeArr[i] = 0;
            alphaArr[i] = 0;
            continue;
          }
        }
      }
      alphaArr[i] = (age < .065 ? age / .065 : 1) * Math.pow(k, .85) * (this.snow ? (grain ? .52 : .68) : .62);
    }
    const attributes = this.geo.attributes;
    this.uploadSlots(attributes.position, this.liveSlots);
    this.uploadSlots(attributes.aAlpha, this.liveSlots);
    this.uploadSlots(attributes.aSize, this.snow ? this.liveSlots : this.spawned);
    this.uploadSlots(this.snow ? attributes.color : attributes.aColor, this.spawned);
    if (this.snow) {
      this.uploadSlots(attributes.normal, this.spawned);
      this.uploadSlots(attributes.aSunExposure, this.spawned);
    }
    this.spawned = 0;
    let oldest = start;
    while (this.liveSlots > 0 && lifeArr[oldest] <= 0) {
      oldest = (oldest + 1) % this.count;
      this.liveSlots--;
    }
    // Preserve the original vertex/blend order across a wrap. Any intervening
    // retired slots have zero alpha, including their last queued GPU write.
    if (oldest + this.liveSlots <= this.count) this.geo.setDrawRange(oldest, this.liveSlots);
    else this.geo.setDrawRange(0, this.count);
  }

  uploadSlots(attribute, slots) {
    if (!slots) return;
    const start = (this.cursor - slots + this.count) % this.count;
    const first = Math.min(slots, this.count - start);
    queueVertexRange(attribute, start, first);
    if (slots > first) queueVertexRange(attribute, 0, slots - first);
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.liveSlots = this.spawned = 0;
    this.geo.setDrawRange(0, 0);
    queueVertexRange(this.geo.attributes.aAlpha, 0, this.count);
  }
}

export class SkiContact {
  constructor(scene, ground = terrain) {
    this.ground = ground;
    this.planes = [];
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      uniforms: { strength: { value: 0 }, softSnow: { value: 0 } },
      vertexShader: `
        varying vec2 patchUv;
        void main() {
          patchUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: `
        uniform float strength;
        uniform float softSnow;
        varying vec2 patchUv;
        void main() {
          vec2 p=2.0*patchUv-1.0;
          float foreAft=1.0-smoothstep(.62,1.0,abs(p.y));
          float bed=(1.0-smoothstep(.25,.51,abs(p.x)))*foreAft;
          float lip=exp(-pow((abs(p.x)-.59)/.12,2.0))*foreAft;
          float shade=bed*.66 + lip*.26;
          gl_FragColor=vec4(.30,.385,.45,shade*strength*(.55+softSnow*.45));
          #include <colorspace_fragment>
        }`,
    });
    for (let i = 0; i < 2; i++) {
      const geometry = new THREE.PlaneGeometry(1,1,4,10);
      geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      const mesh = new THREE.Mesh(geometry,material.clone());
      mesh.name = 'Ski contact shade';
      mesh.renderOrder = 2;
      mesh.frustumCulled = mesh.visible = false;
      scene.add(mesh);
      this.planes.push(mesh);
    }
  }

  update(player, active) {
    const sin = Math.sin(player.heading), cos = Math.cos(player.heading);
    const board = player.boarding ? player.rig.boardContact : null;
    this.planes.forEach((mesh, i) => {
      mesh.visible = active && player.grounded && !player.crash &&
        (board ? i === 0 : player.footMode || player.rig.skiPlanted?.[i] !== false);
      if (!mesh.visible) return;
      const p = board?.point ?? player.rig.contactPoints[i];
      const axis = board?.axis ?? player.rig.skiAxes?.[i];
      const sx = axis ? axis.x : sin, sz = axis ? axis.z : cos;
      const positions = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
      const heel = board ? (board.end - board.start) * .5 : player.footMode ? .30 : .88;
      const width = board ? player.snowboardModel.waistMm * .00090 : player.footMode ? .19 : .14;
      const sink = board?.compression ?? player.rig.skiSink?.[i] ?? player.snowSink ?? 0;
      mesh.material.uniforms.strength.value = (player.footMode ? .28 : .18 + Math.min(.18,sink*2))
        * (1 - clamp((p.y-this.ground.heightAt(p.x,p.z))/.18,0,1));
      mesh.material.uniforms.softSnow.value = player.powder;
      for(let v=0;v<positions.count;v++) {
        const across=(uv.getX(v)*2-1)*width, along=(uv.getY(v)*2-1)*heel;
        const x=p.x+sz*across+sx*along, z=p.z-sx*across+sz*along;
        // Follow the live pressed surface rather than floating over a sunk ski.
        const press=1-clamp(Math.abs(across)/.10,0,1);
        const baseY=this.ground.heightAt(x,z);
        const depth=this.ground.skiSnowDepthAt?.(x,z,baseY) ?? sink*press*.88;
        positions.setXYZ(v,x,baseY+.008-depth,z);
      }
      positions.needsUpdate=true;
    });
  }
}

export class TuckWind {
  constructor(host) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'speed-wind';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    host.append(this.canvas);
    this.context = this.canvas.getContext('2d');
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.energy = 0;
    this.time = 0;
    const rng = mulberry32(399);
    this.particles = Array.from({ length: 45 }, () => ({
      angle: rng() * Math.PI * 2, phase: rng(), rate: .45 + rng() * .48, scale: .35 + rng() * .65,
    }));
  }

  resize(width, height) {
    width = Math.max(1,width);
    height = Math.max(1,height);
    this.canvas.width = Math.min(width, 1440);
    this.canvas.height = Math.round(height * this.canvas.width / width);
  }

  update(dt, skier, active) {
    updateSnowShutter(skier, active && skier.grounded && !skier.footMode && !skier.crash && !this.reducedMotion.matches);
    const speed = clamp((skier.speed - 13) / 17, 0, 1);
    const target = active && !this.reducedMotion.matches ? speed * (skier.tuckAmount || 0) : 0;
    this.energy += (target - this.energy) * (1 - Math.exp(-dt * 7.5));
    if (this.energy < .012 || !this.context) {
      this.canvas.hidden = true;
      return;
    }
    this.canvas.hidden = false;
    this.time += dt * (.38 + speed * .95);
    const ctx = this.context, w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (const particle of this.particles) {
      const age = (particle.phase + this.time * particle.rate) % 1;
      const length = (.012 + age * .07) * particle.scale * this.energy;
      const radius = .35 + age * .40;
      const x = Math.cos(particle.angle), y = Math.sin(particle.angle);
      const stroke = ctx.createLinearGradient(
        w * (.50 + x * radius), h * (.415 + y * radius),
        w * (.50 + x * (radius + length)), h * (.415 + y * (radius + length)));
      stroke.addColorStop(0, 'rgba(216,237,253,0)');
      stroke.addColorStop(1, `rgba(222,240,253,${.23 * this.energy * Math.sin(age * Math.PI)})`);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = .5 + .8 * particle.scale;
      ctx.beginPath();
      ctx.moveTo(w * (.50 + x * radius), h * (.415 + y * radius));
      ctx.lineTo(w * (.50 + x * (radius + length)), h * (.415 + y * (radius + length)));
      ctx.stroke();
    }
  }
}

export class Snowstorm {
  constructor(scene) {
    this.count = 16384;
    const rand = mulberry32(5511);
    const positions = new Float32Array(this.count * 3);
    const motion = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      const near = i % 16 < 3;
      const span = near ? 19 : 92;
      positions.set([rand() * span, rand() * (near ? 11 : 44), rand() * span], i * 3);
      motion.set([.68 + rand() * .96, .008 + rand() ** 2 * (near ? .051 : .023), rand(), Number(near)], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('flake', new THREE.BufferAttribute(motion, 4));
    this.wind = 2.8;
    this.gust = .2;
    this.uniforms = {
      seconds: { value: 0 }, frameHeight: { value: 900 }, shelter: { value: 0 },
      fallSeconds: { value: 0 },
      precipitation: { value: .22 }, drift: { value: new THREE.Vector3() },
      squall: { value: 0 }, night: { value: 0 }, snowline: { value: 210 }, whiteout: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec4 flake;
        uniform float seconds;
        uniform float fallSeconds;
        uniform float frameHeight;
        uniform float shelter;
        uniform float precipitation;
        uniform vec3 drift;
        uniform float squall;
        uniform float snowline;
        uniform float whiteout;
        varying float opacity;
        varying float rotation;
        varying float aspectRatio;
        varying float rain;
        void main() {
          float nearLayer = flake.w;
          float density = mix(precipitation, mix(precipitation*.26, 1., whiteout),nearLayer);
          if (flake.z > density + .026) {
            gl_Position = vec4(2.,2.,2.,1.);
            gl_PointSize = 1.0;
            return;
          }
          float phase = flake.z * 6.283;
          rain = 1.0-smoothstep(snowline-120.0,snowline+120.0,cameraPosition.y);
          vec3 volume = mix(vec3(92.,44.,92.),vec3(19.,11.,19.),nearLayer);
          vec3 fall = vec3(0.,-flake.x*mix(fallSeconds,seconds*8.0,rain),0.);
          float eddies = 1.0 + nearLayer * squall * .85;
          vec3 flutter = vec3(sin(seconds*2.4+phase)*.23, cos(seconds*2.05+phase)*.16,
            cos(seconds*1.7+phase)*.32) * (1.0-rain) * eddies;
          vec3 eyeOffset = mod(position + drift + fall + flutter - cameraPosition, volume) - volume * .5;
          vec3 world = cameraPosition + eyeOffset;
          vec4 view = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * view;
          float distanceToEye = -view.z;
          float metresToPixels = frameHeight * .5 * projectionMatrix[1][1] / max(.35, distanceToEye);
          float windStretch = nearLayer * squall * mix(.65,2.85,whiteout);
          float flakePixels = flake.y * metresToPixels * (1.0 + windStretch * .94);
          gl_PointSize = clamp(flakePixels + 1.1 + rain * 2.0, 1.1, mix(10.0,19.0,max(nearLayer,rain)));
          vec3 edge = 1.0 - smoothstep(vec3(.38),vec3(.50),abs(eyeOffset)/volume);
          opacity = (.35 + .40 * flake.z) * edge.x * edge.y * edge.z
            * smoothstep(.48,1.85,distanceToEye) * (1.0-smoothstep(32.0,57.0,distanceToEye));
          opacity *= smoothstep(flake.z-.025,flake.z+.025,density) * mix(1.,1.39,whiteout*nearLayer);
          opacity *= 1.0-shelter;
          opacity *= mix(1.0,mix(.54,.13,nearLayer),rain);
          vec3 flow = mat3(viewMatrix) * vec3(-.78*squall,-.18,.39*squall);
          // Point coordinates increase down the screen, unlike the view basis.
          float windAngle = atan(flow.x,-flow.y);
          rotation = mix(phase + seconds * (flake.z - .5) * 1.9,windAngle,max(rain,smoothstep(.12,1.3,windStretch)));
          aspectRatio = mix((.63 + .33 * abs(sin(phase+seconds*1.2)))/(1.0+windStretch),.10,rain);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float night;
        varying float opacity;
        varying float rotation;
        varying float aspectRatio;
        varying float rain;
        void main() {
          vec2 p = gl_PointCoord - .5;
          p = mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation)) * p;
          float edge = length(p * vec2(1.0/aspectRatio,1.0));
          float core = 1.0 - smoothstep(.16,.37,edge);
          float rim = 1.0 - smoothstep(.32,.48,edge);
          if (opacity * rim < .008) discard;
          vec3 snow = mix(vec3(.45,.56,.64), vec3(.96,.98,1.0), core);
          snow *= mix(vec3(1.0),vec3(.57,.68,.87),night);
          gl_FragColor = vec4(snow, opacity * (.28 * rim + .72 * core));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.name = 'Altitude-aware squalls and flurries';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  setWeather({ precipitation = .22, wind = 2.8, gust = .2, night = 0, whiteout = 0, snowline = 210 } = {}) {
    this.uniforms.precipitation.value = precipitation;
    this.uniforms.night.value = night;
    this.uniforms.snowline.value = snowline;
    this.uniforms.squall.value = gust;
    this.uniforms.whiteout.value = whiteout;
    this.points.geometry.setDrawRange(0, precipitation < .30 ? 4096 : precipitation < .90 ? 12288 : this.count);
    this.wind = wind;
    this.gust = gust;
    this.points.visible = precipitation > .006;
  }

  resize(height) { this.uniforms.frameHeight.value = height; }

  update(dt, sheltered = false) {
    this.uniforms.seconds.value += dt;
    this.uniforms.fallSeconds.value += dt * (1 + this.gust * .9);
    this.uniforms.shelter.value += (Number(sheltered)-this.uniforms.shelter.value)*(1-Math.exp(-dt*12));
    const t=this.uniforms.seconds.value;
    // Integrate wind displacement rather than multiplying time by speed: a
    // gust accelerates existing flakes instead of teleporting the whole volume.
    this.uniforms.drift.value.x -= dt*this.wind*(.78+.12*Math.sin(t*.21));
    this.uniforms.drift.value.z += dt*this.wind*(.39+.13*Math.sin(t*.13));
    this.uniforms.drift.value.y -= dt*this.gust*.8;
  }
}

const white = new THREE.Color(.94, .97, 1);
const powder = new THREE.Color(.99, .995, 1);
const gold = new THREE.Color(1, .78, .33);
const cyan = new THREE.Color(.5, .92, 1);

function imprintTexture(boot) {
  const { canvas, ctx } = makeCanvas(32, 64);
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  if (boot) {
    ctx.beginPath();
    ctx.roundRect(4, 3, 25, 34, 9);
    ctx.roundRect(7, 43, 19, 17, 4);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,.77)';
  for (let row = 0; row < (boot ? 8 : 4); row++) {
    const left = boot ? (row < 5 ? 6 : 9) : 1;
    const gap = boot ? 3 : 2;
    const y = 6 + row * (boot ? 7 : 16);
    for (let x = left; x < 31 - left; x += 6 + gap) {
      ctx.fillRect(x, y + ((x - left) % 2) * 2, 5, boot ? 3 : 6);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

class TerrainImprints {
  constructor(scene, ground, { name, width, length, capacity, boot = false }) {
    this.ground = ground;
    this.cursor = 0;
    this.capacity = capacity;
    this.normal = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.pose = new THREE.Object3D();
    this.basis = new THREE.Matrix4();
    this.color = new THREE.Color();
    const geometry = new THREE.PlaneGeometry(width, length);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: imprintTexture(boot), transparent: true, opacity: .46, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  add(x, z, heading, bare) {
    const y = this.ground.heightAt(x, z);
    if (this.ground.normalAt) this.ground.normalAt(x,z,this.normal);
    else normalAt(x,z,this.normal);
    this.forward.set(Math.sin(heading), 0, Math.cos(heading))
      .addScaledVector(this.normal, -this.normal.dot(this.forward)).normalize();
    this.right.crossVectors(this.normal, this.forward).normalize();
    this.basis.makeBasis(this.right, this.normal, this.forward);
    this.pose.quaternion.setFromRotationMatrix(this.basis);
    this.pose.position.set(x, y, z).addScaledVector(this.normal, .012);
    this.pose.updateMatrix();
    this.mesh.setMatrixAt(this.cursor, this.pose.matrix);
    this.mesh.setColorAt(this.cursor, this.color.set(bare ? 0x30251a : 0x7996ad));
    this.mesh.instanceMatrix.needsUpdate = this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = Math.min(this.capacity, this.mesh.count + 1);
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  clear() { this.mesh.count = this.cursor = 0; }
}

export class WingTrails {
  constructor(scene) {
    this.length = 30;
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.length * 2 * 18);
    const colors = new Float32Array(this.length * 2 * 24);
    this.position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('color', this.color);
    const edge = new Float32Array(this.length*12);
    for (let i = 0; i < edge.length; i += 6) edge.set([0,0,1,0,1,1],i);
    this.geometry.setAttribute('ribbonEdge',new THREE.BufferAttribute(edge,1));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float ribbonEdge; varying float ribbonAcross;\n' + shader.vertexShader
        .replace('#include <begin_vertex>','#include <begin_vertex>\nribbonAcross = ribbonEdge;');
      shader.fragmentShader = 'varying float ribbonAcross;\n' + shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= smoothstep(.02, .44, min(ribbonAcross, 1.0 - ribbonAcross));');
    };
    material.customProgramCacheKey = () => 'wingtip-airflow';
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'Wingsuit wingtip airflow';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.samples = Array.from({ length: this.length + 1 }, () => [
      new THREE.Vector3(), new THREE.Vector3(),
    ]);
    this.clear();
  }

  update(dt, model, span, speed, visible) {
    this.mesh.visible = visible;
    this.age += dt;
    if (this.age < .028) return;
    this.age %= .028;
    this.cursor = (this.cursor + 1) % this.samples.length;
    const sample = this.samples[this.cursor];
    model.updateMatrixWorld(true);
    for (let side = 0; side < 2; side++) {
      sample[side].set((side * 2 - 1) * span, .445, .13).applyMatrix4(model.matrixWorld);
    }
    this.count = Math.min(this.samples.length, this.count + 1);
    let vertex = 0;
    for (let i = 0; i < this.count - 1; i++) {
      const close = this.samples[(this.cursor - i + this.samples.length) % this.samples.length];
      const far = this.samples[(this.cursor - i - 1 + this.samples.length) % this.samples.length];
      const width = .025 + i * .0015;
      const alpha = clamp((speed - 16) / 19, .12, 1) * .4 * (1 - i / this.length) ** 2;
      for (let side = 0; side < 2; side++) {
        const a = close[side], b = far[side], start = vertex;
        this.position.setXYZ(vertex++, a.x, a.y - width, a.z);
        this.position.setXYZ(vertex++, b.x, b.y - width, b.z);
        this.position.setXYZ(vertex++, b.x, b.y + width, b.z);
        this.position.setXYZ(vertex++, a.x, a.y - width, a.z);
        this.position.setXYZ(vertex++, b.x, b.y + width, b.z);
        this.position.setXYZ(vertex++, a.x, a.y + width, a.z);
        for (let j = start; j < vertex; j++) this.color.setXYZW(j, .74, .87, .96, alpha);
      }
    }
    this.position.needsUpdate = this.color.needsUpdate = true;
    this.geometry.setDrawRange(0, vertex);
  }

  clear() {
    this.cursor = 0;
    this.count = 0;
    this.age = 0;
    this.mesh.visible = false;
    this.geometry.setDrawRange(0, 0);
  }
}

export class ParticleFX {
  constructor(scene,sampleHeight=heightAt,ground=terrain) {
    this.sampleHeight=sampleHeight;
    this.spray = new ParticlePool(scene, 3200, { snow: true, ground, sampleHeight });
    this.spark = new ParticlePool(scene, 420, { additive: true });
    this.rand = mulberry32(1773);
    this.wakeAccum = [0, 0];
    this.wakeLast = [null, null];
    this.bootMarks = new TerrainImprints(scene,ground,{name:'Boot tread in snow and soil',width:.17,length:.34,capacity:256,boot:true});
    this.sledTracks = new TerrainImprints(scene,ground,{name:'Packed snowmobile track treads',width:.52,length:.27,capacity:1600});
    this.catTracks = new TerrainImprints(scene,ground,{name:'Twin groomer treads',width:1.53,length:.36,capacity:960});
    this.bikeTracks = new TerrainImprints(scene,ground,{name:'Knobby tire prints in dirt',width:.093,length:.22,capacity:720});
    this.vehicleTrail = null;
  }

  bootStep(point, heading, surface, softness) {
    this.bootMarks.add(point.x, point.z, heading, surface === 'ground');
    if (surface === 'ground' || softness < .19) return;
    const zero = { x:0, z:0 };
    this.skiSpray(point, zero, softness * .33);
  }

  vehicleTrack(id, point, heading, bare) {
    const last = this.vehicleTrail;
    if (!last || last.id !== id || Math.hypot(point.x-last.x,point.z-last.z) > 9) {
      this.vehicleTrail = {id,x:point.x,z:point.z};
      return;
    }
    const dx = point.x-last.x, dz = point.z-last.z;
    const distance = Math.hypot(dx,dz);
    const tracks = id === 'snowcat' ? this.catTracks : id === 'bike' ? this.bikeTracks : this.sledTracks;
    const gap = id === 'snowcat' ? .32 : id === 'bike' ? .20 : .24;
    for (let d = gap; d <= distance; d += gap) {
      const x = last.x+dx*d/distance, z = last.z+dz*d/distance;
      if (id === 'snowcat') {
        const acrossX = Math.cos(heading)*1.42, acrossZ = -Math.sin(heading)*1.42;
        tracks.add(x-acrossX,z-acrossZ,heading,bare);
        tracks.add(x+acrossX,z+acrossZ,heading,bare);
      } else tracks.add(x,z,heading,bare);
    }
    if (distance >= gap) {
      const fraction = Math.floor(distance/gap)*gap/distance;
      last.x += dx*fraction;
      last.z += dz*fraction;
    }
  }

  breakVehicleTrack() { this.vehicleTrail = null; }

  skiWake(left, right, velocity, heading, powderAmount, steer, brake, dt, surface = 'packed',
    planted = [true, true], landing = 0) {
    const speed = Math.hypot(velocity.x, velocity.z);
    const soft = surface === 'ice' || surface === 'ground' ? 0 : clamp(powderAmount, 0, 1);
    const deep = clamp((soft - .30) / .57, 0, 1);
    const carving = clamp(Math.abs(steer), 0, 1);
    const braking = clamp(Number(brake), 0, 1);
    const sideX = Math.cos(heading), sideZ = -Math.sin(heading);
    const pathX = velocity.x / Math.max(speed, .8), pathZ = velocity.z / Math.max(speed, .8);
    // Slip across an edged ski lifts more snow than simply pointing downhill.
    const across = pathX * sideX + pathZ * sideZ;
    const slip = Math.abs(across);
    const load = clamp(carving * .65 + slip * 1.3 + braking * .95, 0, 1.6);
    const roll = deep * clamp((speed - 2) / 9, 0, 1) * clamp(.17 + load * .77 + landing * .83, 0, 1);
    const loadedSide = braking && slip > .32 ? Math.sign(across) : carving > .05 ? Math.sign(steer) : 0;
    const rand = this.rand;
    const sources = [left, right];
    for (let ski = 0; ski < 2; ski++) {
      const p = sources[ski];
      const last = this.wakeLast[ski];
      if (!planted[ski] || speed < .8 || surface === 'ground') {
        this.wakeAccum[ski] = 0;
        this.wakeLast[ski] = null;
        continue;
      }
      const connected = last && Math.hypot(p.x-last.x, p.z-last.z) < 8;
      // Packed piste produces a low edge scratch. Ice only sheds a few grains.
      const side = ski === 0 ? -1 : 1;
      const outside = !loadedSide ? 1 : loadedSide === side ? 1.44 : .54;
      const rate = (surface === 'ice'
        ? (1.4 + speed * .12) * load
        : speed * (.12 + soft * 6.4) * (.62 + load * 2.4 + roll * 1.95)) * outside;
      this.wakeAccum[ski] += Math.min(dt, .12) * Math.min(720, rate);
      const count = Math.min(86, Math.floor(this.wakeAccum[ski]));
      this.wakeAccum[ski] -= count;
      for (let i = 0; i < count; i++) {
        const fraction = (i + rand()) / Math.max(count, 1);
        const x = connected ? last.x + (p.x-last.x)*fraction : p.x;
        const z = connected ? last.z + (p.z-last.z)*fraction : p.z;
        const y = connected ? last.y + (p.y-last.y)*fraction : p.y;
        const grain = this.spray.seed[this.spray.cursor] < .18;
        // The shovels carry a low, dense wave beside the boots. Snow released
        // along the edges moves out and back in a wider, slower fan.
        const shoveling = rand() < roll * (grain ? .40 : .68);
        const toss = shoveling ? (.35 + rand() * 1.25) * roll
          : (.35 + rand() * .9) * (.12 + soft * 1.15) * (1 + load * 3.1) * outside;
        const along = shoveling ? .16 + rand() * .61 : -.24 - rand() * .46;
        const lateral = side * (.063 + rand() * (shoveling ? .14 : .085));
        const px = x + pathX * along + sideX * lateral;
        const pz = z + pathZ * along + sideZ * lateral;
        const py = Math.max(y, this.sampleHeight(px, pz)) + .035 + rand() * (shoveling ? .11 : .035);
        const momentum = shoveling ? .81 + rand() * .22 : .19 + rand() * (.14 + .17 * deep);
        const lift = shoveling ? 1.45 + (1.05 + rand() * 2.5) * roll
          : Math.min(4.5, (.35 + rand() * 1.04) * (.08 + soft * .95) * (1 + load * 2.5) * outside);
        const size = grain ? .015 + rand() * .036
          : shoveling ? (.40 + rand() * .52) * (.70 + roll * .53)
            : (.18 + rand() * .31) * (.22 + soft * .95) * (1 + load * .35);
        const life = grain ? .28 + rand() * .33
          : shoveling ? .43 + rand() * .32 : .65 + soft * .58 + rand() * .51;
        this.spray.spawn(
          px, py, pz,
          velocity.x * momentum + sideX * side * toss + (rand() - .5) * .22,
          lift,
          velocity.z * momentum + sideZ * side * toss + (rand() - .5) * .22,
          size, life, soft > .45 ? powder : white,
        );
      }
      if (last) { last.x=p.x; last.y=p.y; last.z=p.z; }
      else this.wakeLast[ski] = { x: p.x, y: p.y, z: p.z };
    }
  }

  skiLanding(contacts, velocity, heading, softness, impact) {
    const rand = this.rand;
    const deep = clamp((softness - .29) / .57, 0, 1);
    const load = clamp(impact / 10, 0, 1);
    const speed = Math.hypot(velocity.x, velocity.z);
    const pathX = speed > 1 ? velocity.x / speed : Math.sin(heading);
    const pathZ = speed > 1 ? velocity.z / speed : Math.cos(heading);
    const count = Math.round((7 + 24 * load) * deep);
    for (const [ski, point] of contacts.entries()) {
      const side = ski ? 1 : -1;
      for (let i = 0; i < count; i++) {
        const grain = this.spray.seed[this.spray.cursor] < .18;
        const ahead = rand() * .84 - .23;
        const across = side * rand() * .37;
        const x = point.x + pathX * ahead + pathZ * across;
        const z = point.z + pathZ * ahead - pathX * across;
        const momentum = .40 + rand() * .54;
        const kick = side * (.7 + rand() * 2.8) * load;
        this.spray.spawn(x, this.sampleHeight(x, z) + .055 + rand() * .14, z,
          velocity.x * momentum + pathZ * kick, 1 + rand() * 1.6 + load * 2.1,
          velocity.z * momentum - pathX * kick,
          grain ? .016 + rand() * .055 : (.37 + rand() * .67) * (.67 + deep * .42),
          grain ? .30 + rand() * .32 : .55 + rand() * .46, powder);
      }
    }
  }

  breakWake() {
    this.wakeLast[0] = this.wakeLast[1] = null;
    this.wakeAccum[0] = this.wakeAccum[1] = 0;
  }

  carve(point, side, speed, powderAmount, dt) {
    const rand = this.rand;
    const n = Math.round((3 + speed * 0.45) * clamp(dt * 60, 0.2, 2) * (0.7 + powderAmount * 0.7));
    const sp = Math.min(speed, 32);
    for (let i = 0; i < n; i++) {
      const spread = 0.3 + rand();
      const color = powderAmount > 0.5 ? powder : white;
      this.spray.spawn(
        point.x + (rand() - 0.5) * 0.7,
        point.y + 0.05 + rand() * 0.25,
        point.z + (rand() - 0.5) * 0.7,
        side.x * (1.2 + rand() * 2.4) * spread * (0.35 + speed / 24) + (rand() - 0.5) * 1.3,
        1.1 + rand() * 2.2 + sp * 0.025,
        side.z * (1.2 + rand() * 2.4) * spread * (0.35 + speed / 24) + (rand() - 0.5) * 1.3,
        .08 + rand()*.18 + powderAmount*.1,
        0.55 + rand() * 0.75,
        color,
      );
    }
  }

  skiSpray(point, velocity, intensity = 1) {
    const rand = this.rand;
    const n = Math.round(5 * intensity);
    for (let i = 0; i < n; i++) {
      this.spray.spawn(
        point.x + (rand() - 0.5) * 1.2,
        point.y + 0.08,
        point.z + (rand() - 0.5) * 1.2,
        (rand() - 0.5) * 2 + velocity.x * 0.08,
        0.4 + rand() * 1.8,
        (rand() - 0.5) * 2 + velocity.z * 0.08,
        .06 + rand()*.22, 0.5 + rand() * 0.7, white,
      );
    }
  }

  burst(point, kind = 'snow', count = 24, scale = 1) {
    const rand = this.rand;
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 1 + rand() * 4.5;
      const up = 1.4 + rand() * 4;
      let col = white;
      if (kind === 'gold') col = gold;
      if (kind === 'cyan') col = cyan;
      const pool = kind === 'snow' ? this.spray : this.spark;
      pool.spawn(
        point.x + (rand() - 0.5) * 0.8,
        point.y + 0.35,
        point.z + (rand() - 0.5) * 0.8,
        Math.cos(a) * r, up, Math.sin(a) * r,
        (kind === 'snow' ? .10 + rand()*.26 : 0.35 + rand() * 0.6) * scale,
        kind === 'snow' ? 0.9 + rand() * 0.8 : 0.6 + rand() * 0.8,
        col,
      );
    }
  }

  shedTreeSnow(tree, contact) {
    const retained = strikeTreeSnow(tree);
    if (!retained) return;
    const height = tree.height ?? tree.apex;
    const yaw = tree.yaw ?? tree.rotation ?? 0;
    const width = tree.spread ?? tree.stretch ?? tree.width ?? 1;
    const cosine = Math.cos(yaw), sine = Math.sin(yaw);
    const broadleaf = tree.kind === 'deciduous';
    const species = ['fir', 'spruce', 'hemlock'];
    const deposits = broadleaf ? [
      { center: [.064, .32, -.048], width: .017 },
      { center: [-.082, .36, -.044], width: .014 },
      { center: [.021, .42, .097], width: .012 },
    ] : coniferGeometry(species[tree.kind % 3], -.5, Math.floor(tree.kind / 3)).userData.snowDeposits;
    const sites = deposits.map(({ center: [a, b, c], width: radius }) => {
      const x = (a * cosine + c * sine) * height * width, z = (-a * sine + c * cosine) * height * width;
      return { x: tree.x + x, y: tree.y + b * height, z: tree.z + z, xOffset: x, zOffset: z, radius: radius * height };
    }).filter(site => site.y > this.sampleHeight(site.x, site.z) + .38)
      .sort((a, b) => Math.abs(a.y - contact.y - 1.1) - Math.abs(b.y - contact.y - 1.1));
    const rand = this.rand;
    for (const { x, y, z, xOffset, zOffset, radius } of sites.slice(0, broadleaf ? 3 : 4)) {
      const count = Math.ceil((broadleaf ? 9 : 17) * retained);
      const heightAboveGround = y - this.sampleHeight(x, z);
      for (let i = 0; i < count; i++) {
        const spread = Math.max(.11, radius * 2);
        this.spray.spawn(x + (rand() - .5) * spread, y + (rand() - .5) * spread * .47,
          z + (rand() - .5) * spread, (rand() - .5) * 2 + xOffset * .22,
          -.65 - rand() * 1.15, (rand() - .5) * 2 + zOffset * .22,
          .085 + rand() * (broadleaf ? .18 : .31), .68 + Math.min(1.4, heightAboveGround * .13) + rand() * .48,
          white, true);
      }
    }
  }

  update(dt) {
    updateTreeSnow(dt);
    this.spray.update(dt, -4.2, 1.9);
    this.spark.update(dt, -1.5, 2.6);
  }

  clear() {
    this.spray.clear();
    this.spark.clear();
    this.breakWake();
    this.bootMarks.clear();
    this.sledTracks.clear();
    this.catTracks.clear();
    this.bikeTracks.clear();
    this.breakVehicleTrack();
  }
}

/* ═══════════════════════════════════════════════════════════════
   SKI TRACKS
   ═══════════════════════════════════════════════════════════════ */

export class SkiTracks {
  constructor(scene,maxSegments=8000,ground=terrain) {
    this.ground=ground;
    // A bounded ribbon pool: two tracks for roughly a kilometre of skiing.
    this.maxSegments = maxSegments;
    this.segmentCount = 0;
    this.segmentCursor = 0;
    this.segmentBirth = new Float64Array(maxSegments);
    this.chunkSize = 128;
    this.spacing = .24;
    this.columns = [-1, -.81, -.55, -.34, 0, .34, .55, .81, 1];
    this.profile = [0, .08, .75, .22, 0, .22, .75, .08, 0];
    this.inputs = [null, null];
    this.last = [null, null];
    this.remainder = [0, 0];
    this.sampleColor=new THREE.Color();
    this.sampleNormal=new THREE.Vector3();
    this.scene = scene;
    this.build();
    this.uploadStart = 0;
    this.uploadCount = 0;
  }

  createMaterial() {
    const base=this.ground.snowMaterial;
    const mat=base ? base.clone() : new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96});
    mat.transparent=true;
    mat.depthWrite=false;
    mat.side=THREE.DoubleSide;
    // This is an open snow surface, so drawing its front/back in separate
    // transparent passes only repeats work; the same normals serve both sides.
    mat.forceSinglePass=true;
    mat.polygonOffset=true;
    mat.polygonOffsetFactor=-1;
    mat.polygonOffsetUnits=-1;
    this.trackUniforms={
      uTime:{value:0},uSki0:{value:new THREE.Vector4()},uSki1:{value:new THREE.Vector4()},
      uSink:{value:new THREE.Vector2()},uHorizontal:{value:new THREE.Vector2(1,1)},
    };
    mat.uniforms=this.trackUniforms;
    mat.customProgramCacheKey=()=> 'terrain-pressed-trails-v3';
    mat.onBeforeCompile=(shader)=>{
      base?.onBeforeCompile(shader);
      Object.assign(shader.uniforms,this.trackUniforms);
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>',`#include <common>
          attribute float aBirth;attribute float aAcross;attribute float aSoft;
          uniform float uTime;
          varying float trackFade;varying float trackAcross;varying float trackSoft;
          varying vec2 trackGround;
        `)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          trackFade=1.0-smoothstep(130.0,210.0,uTime-aBirth);
          trackAcross=aAcross;trackSoft=aSoft;trackGround=position.xz;
        `);
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <common>',`#include <common>
          varying float trackFade;varying float trackAcross;varying float trackSoft;
          varying vec2 trackGround;
          uniform vec4 uSki0;uniform vec4 uSki1;uniform vec2 uSink;uniform vec2 uHorizontal;
          float trackLivePress(vec4 ski,float sink,float horizontal){
            vec2 delta=trackGround-ski.xy;
            float along=dot(delta,ski.zw)/(horizontal*horizontal);
            float across=dot(delta,vec2(ski.w,-ski.z))/horizontal;
            return sink*smoothstep(-1.85,-.82,along)*(1.0-smoothstep(1.0,1.12,along))
              *(1.0-smoothstep(.060,.235,abs(across)));
          }
        `)
        .replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
          // The profile normals point out of the snow even when skiing back
          // through a strip whose triangle winding has reversed.
          normal*=faceDirection;
        `)
        .replace('#include <color_fragment>',`#include <color_fragment>
          float trailAcross=abs(trackAcross);
          float trailBed=1.0-smoothstep(.30,.48,trailAcross);
          float trailCrest=exp(-pow((trailAcross-.55)/.23,2.0));
          float trailFeather=1.0-smoothstep(.72,1.0,trailAcross);
          float trailPress=max(trackLivePress(uSki0,uSink.x,uHorizontal.x),trackLivePress(uSki1,uSink.y,uHorizontal.y));
          diffuseColor.a*=(trailBed*(.56+trackSoft*.28)+trailCrest*(.30+trackSoft*.34))
            *trailFeather*trackFade*(1.0-smoothstep(.0007,.004,trailPress));
          if(diffuseColor.a<.004)discard;
        `);
    };
    return mat;
  }

  build() {
    const max = this.maxSegments;
    const cols = this.columns.length;
    const spanSize = Math.min(this.chunkSize, max);
    const idx = new Uint16Array(spanSize * (cols-1) * 6);
    for (let s = 0; s < spanSize; s++) {
      const base = s * cols * 2;
      for (let column = 0; column < cols-1; column++) {
        const i = s*(cols-1)*6 + column*6;
        const a = base+column, b = a+1, c = a+cols, d = c+1;
        idx.set([a,c,b,b,c,d],i);
      }
    }
    const index = new THREE.BufferAttribute(idx, 1);
    const mat = this.createMaterial();
    this.mesh = new THREE.Group();
    this.material=mat;
    this.mesh.name = 'Continuous pressed ski tracks and powder berms';
    // A new ribbon uploads only its own vertices. All spans reuse the same
    // local index pattern, including the shorter span at the end of the ring.
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.chunks=[];
    for (let start=0;start<max;start+=this.chunkSize) {
      const geometry=new THREE.BufferGeometry();
      const end = Math.min(max, start + this.chunkSize);
      const verts = (end - start) * cols * 2;
      for (const [name, size] of Object.entries({position:3, aBirth:1, aAcross:1, aSoft:1, color:3, normal:3})) {
        const attribute = new THREE.BufferAttribute(new Float32Array(verts * size), size).setUsage(THREE.DynamicDrawUsage);
        attribute.onUpload(() => attribute.clearUpdateRanges());
        geometry.setAttribute(name, attribute);
      }
      geometry.setIndex(index);
      geometry.setDrawRange(0,0);
      geometry.boundingBox=new THREE.Box3();
      geometry.boundingSphere=new THREE.Sphere();
      const mesh=new THREE.Mesh(geometry,[mat]);
      mesh.name=`Pressed ski trail span ${this.chunks.length+1}`;
      mesh.receiveShadow=true;
      mesh.renderOrder=1;
      mesh.visible=false;
      this.mesh.add(mesh);
      this.chunks.push({start,end,geometry,mesh,dirty:false});
      if (start === 0) {
        // Prepare the actual trail shader and the first span during the loader's
        // first scene draw. Zero indices leave the framebuffer untouched.
        geometry.addGroup(0, 0, 0);
        mesh.visible = true;
        mesh.frustumCulled = false;
        mesh.onAfterRender = () => {
          mesh.frustumCulled = true;
          if (geometry.drawRange.count === 0) {
            geometry.clearGroups();
            mesh.visible = false;
          }
          delete mesh.onAfterRender;
        };
      }
    }
  }

  addStep(left, right, time, snowDepth = 0, options = {}) {
    const points = [left, right];
    const soft = options.surface === 'ice' ? .012 : clamp(snowDepth, 0, 1);
    const carve = clamp(Math.abs(options.carve || 0) + Number(options.brake || 0)*.65, 0, 1.5);
    const stop = clamp(options.stop ?? 0, 0, 1);
    const motion = options.velocity;
    const acrossSlip = stop > .08 && motion && Math.hypot(motion.x, motion.z) > .3;
    for (let ski = 0; ski < 2; ski++) {
      if (options.planted?.[ski] === false) {
        this.inputs[ski] = this.last[ski] = null;
        this.remainder[ski] = 0;
        continue;
      }
      const p = points[ski];
      if (!Number.isFinite(p.x + p.z + time)) continue;
      const previous = this.inputs[ski];
      const heading = options.heading ?? (previous ? Math.atan2(p.x-previous.x,p.z-previous.z) : 0);
      const axis = options.axes?.[ski];
      const horizontal = axis ? Math.hypot(axis.x,axis.z) : 1;
      const slipSpeed = acrossSlip ? Math.hypot(motion.x, motion.z) : 1;
      const row = {
        x:p.x, z:p.z, time, rx:acrossSlip ? motion.z/slipSpeed : axis ? axis.z/horizontal : Math.cos(heading),
        rz:acrossSlip ? -motion.x/slipSpeed : axis ? -axis.x/horizontal : -Math.sin(heading),
        soft, carve, stop, widthScale: options.widthScale ?? 1,
        compression:clamp(options.compression?.[ski] ?? options.compression ?? soft*.075,0,.15),
      };
      const length = previous ? Math.hypot(row.x-previous.x,row.z-previous.z) : 0;
      // Teleports, landings and an individually lifted ski start a fresh strip.
      if (!previous || length > 7 || time-previous.time > .45) {
        this.inputs[ski] = this.last[ski] = row;
        this.remainder[ski] = 0;
        continue;
      }
      if (length < .0001) { this.inputs[ski]=row; continue; }
      let distance = this.spacing-this.remainder[ski];
      while (distance <= length) {
        const t = distance/length;
        let rx = previous.rx+(row.rx-previous.rx)*t, rz = previous.rz+(row.rz-previous.rz)*t;
        const scale = 1/(Math.hypot(rx,rz) || 1);
        rx*=scale; rz*=scale;
        const next = {
          x:previous.x+(row.x-previous.x)*t, z:previous.z+(row.z-previous.z)*t,
          time:previous.time+(time-previous.time)*t, rx, rz,
          soft:previous.soft+(soft-previous.soft)*t,
          carve:previous.carve+(carve-previous.carve)*t,
          stop:previous.stop+(stop-previous.stop)*t,
          widthScale:previous.widthScale+(row.widthScale-previous.widthScale)*t,
          compression:previous.compression+(row.compression-previous.compression)*t,
        };
        this.writeSegment(this.last[ski],next);
        this.last[ski]=next;
        distance+=this.spacing;
      }
      this.remainder[ski]=(this.remainder[ski]+length)%this.spacing;
      this.inputs[ski]=row;
    }
  }

  writeSegment(a,b) {
    const chunk = this.chunks[Math.floor(this.segmentCursor / this.chunkSize)];
    const {position, aBirth, aAcross, aSoft, color, normal} = chunk.geometry.attributes;
    const cols=this.columns.length, base=(this.segmentCursor - chunk.start)*cols*2;
    for (let row=0;row<2;row++) {
      const p=row === 0 ? a : b;
      const skim = Math.sin(p.x*1.6+p.z*.92 + 1.2*Math.sin(p.z*.81-p.x*.4));
      const brokenSnow = Math.sin(p.z*5.3 - p.x*2.7 + 2.8*skim);
      const width=(.112+p.soft*.074+p.carve*p.soft*.022+p.stop*.37) * (1 + p.soft*.095*skim) * (p.widthScale ?? 1);
      const berm=(.001+p.soft*.020+p.compression*.16+p.stop*p.soft*.09)*(1+p.carve*.25);
      this.sampleColor.setRGB(.85,.91,.96);
      this.sampleNormal.set(0,1,0);
      this.ground.sampleSnowSurface?.(p.x,p.z,this.sampleColor,this.sampleNormal);
      // Irregularity is attached to world snow, so all shared endpoints match.
      for (let c=0;c<cols;c++) {
        const across=this.columns[c], offset=across*width;
        const rough=.81+p.soft*(.19*skim + .13*brokenSnow*Math.sign(across));
        const x=p.x+p.rx*offset,z=p.z+p.rz*offset;
        const lift=this.profile[c]*berm*rough;
        const vertex=base+row*cols+c;
        position.setXYZ(vertex,x,this.ground.heightAt(x,z)+.009+lift,z);
        aBirth.setX(vertex,p.time);
        aAcross.setX(vertex,across);
        aSoft.setX(vertex,p.soft);
        const bed=1-clamp((Math.abs(across)-.30)/.18,0,1);
        const pressed=1-bed*(.05+p.soft*(.112+.027*brokenSnow));
        color.setXYZ(vertex,this.sampleColor.r*pressed,this.sampleColor.g*pressed,this.sampleColor.b*pressed);
        const before=Math.max(0,c-1),after=Math.min(cols-1,c+1);
        const slope=(this.profile[after]-this.profile[before])*berm*rough/
          ((this.columns[after]-this.columns[before])*width);
        const nx=this.sampleNormal.x-p.rx*slope*.65,ny=this.sampleNormal.y,nz=this.sampleNormal.z-p.rz*slope*.65;
        const length=Math.hypot(nx,ny,nz);
        normal.setXYZ(vertex,nx/length,ny/length,nz/length);
      }
    }
    this.segmentBirth[this.segmentCursor]=Math.max(a.time,b.time);
    chunk.dirty=true;
    if (this.uploadCount === 0) this.uploadStart = this.segmentCursor;
    this.uploadCount = Math.min(this.maxSegments, this.uploadCount + 1);
    this.segmentCursor = (this.segmentCursor + 1) % this.maxSegments;
    this.segmentCount = Math.min(this.maxSegments, this.segmentCount + 1);
  }

  breakTrack() {
    this.inputs[0]=this.inputs[1]=this.last[0]=this.last[1]=null;
    this.remainder[0]=this.remainder[1]=0;
  }

  clear() {
    this.breakTrack();
    this.segmentCount = 0;
    this.segmentCursor = 0;
    this.uploadCount=0;
    for (const chunk of this.chunks) {
      for (const attribute of Object.values(chunk.geometry.attributes)) attribute.clearUpdateRanges();
      chunk.mesh.visible=false;
      chunk.geometry.clearGroups();
      chunk.geometry.setDrawRange(0,0);
      chunk.dirty=false;
    }
  }

  updateChunks(time) {
    let oldest=(this.segmentCursor-this.segmentCount+this.maxSegments)%this.maxSegments;
    // The shader is completely transparent after 210 seconds. Retire a
    // segment only when both endpoints have reached that same fade boundary.
    while (this.segmentCount && time-this.segmentBirth[oldest]>=210) {
      this.chunks[Math.floor(oldest/this.chunkSize)].dirty=true;
      oldest=(oldest+1)%this.maxSegments;
      this.segmentCount--;
    }
    const full=this.segmentCount===this.maxSegments;
    const wraps=!full && this.segmentCount>0 && oldest>=this.segmentCursor;
    const indices=(this.columns.length-1)*6,vertices=this.columns.length*2;
    for (const chunk of this.chunks) {
      if (!chunk.dirty) continue;
      chunk.mesh.frustumCulled = true;
      const geometry=chunk.geometry;
      geometry.clearGroups();
      const addSpan=(start,end)=>{
        start=Math.max(chunk.start,start);end=Math.min(chunk.end,end);
        if (end>start) geometry.addGroup((start-chunk.start)*indices,(end-start)*indices,0);
      };
      if (full) addSpan(0,this.maxSegments);
      else if (this.segmentCount) {
        if (wraps) { addSpan(0,this.segmentCursor);addSpan(oldest,this.maxSegments); }
        else addSpan(oldest,this.segmentCursor);
      }
      chunk.mesh.visible=geometry.groups.length>0;
      if (chunk.mesh.visible) {
        const first=geometry.groups[0],last=geometry.groups[geometry.groups.length-1];
        geometry.setDrawRange(first.start,last.start+last.count-first.start);
        // Bounds follow the live rows, including both sides of a partially
        // overwritten chunk. Endpoints are unchanged across chunk boundaries.
        const bounds=geometry.boundingBox;
        const position=geometry.attributes.position;
        bounds.makeEmpty();
        for (const group of geometry.groups) {
          const begin=group.start/indices*vertices,end=begin+group.count/indices*vertices;
          for (let i=begin;i<end;i++) {
            const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
            bounds.min.x=Math.min(bounds.min.x,x);bounds.max.x=Math.max(bounds.max.x,x);
            bounds.min.y=Math.min(bounds.min.y,y);bounds.max.y=Math.max(bounds.max.y,y);
            bounds.min.z=Math.min(bounds.min.z,z);bounds.max.z=Math.max(bounds.max.z,z);
          }
        }
        bounds.getBoundingSphere(geometry.boundingSphere);
      } else geometry.setDrawRange(0,0);
      chunk.dirty=false;
    }
  }

  update(time,player=null,active=true) {
    this.material.uniforms.uTime.value = time;
    this.updateChunks(time);
    const uniforms=this.material.uniforms;
    uniforms.uSink.value.set(0,0);
    if (player && active) {
      for (let i=0;i<2;i++) {
        const point=player.rig.contactPoints[i],axis=player.rig.skiAxes?.[i];
        const x=axis?.x ?? Math.sin(player.heading),z=axis?.z ?? Math.cos(player.heading);
        uniforms[i === 0 ? 'uSki0' : 'uSki1'].value.set(point.x,point.z,x,z);
        uniforms.uHorizontal.value.setComponent(i,Math.max(.2,Math.hypot(x,z)));
        uniforms.uSink.value.setComponent(i,player.rig.skiPlanted?.[i] === false ? 0 : player.rig.skiSink?.[i] ?? player.snowSink ?? 0);
      }
    }
    if (this.uploadCount > 0) {
      const span = this.columns.length * 2;
      let start = this.uploadStart;
      while (this.uploadCount > 0) {
        const chunk = this.chunks[Math.floor(start / this.chunkSize)];
        const count = Math.min(this.uploadCount, chunk.end - start);
        for (const attribute of Object.values(chunk.geometry.attributes)) {
          queueVertexRange(attribute, (start - chunk.start) * span, count * span);
        }
        this.uploadCount -= count;
        start = chunk.end % this.maxSegments;
      }
    }
  }
}

/* ── Flags (used at summits / finish) ─────────────────────────── */

export function createFlag(color = 0xff6336, size = 1.3) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 4.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x7e8b90, roughness: 0.5, metalness: 0.35 })
  );
  pole.position.y = 2.1;
  pole.castShadow = true;
  group.add(pole);
  const geo = new THREE.PlaneGeometry(size * 1.8, size, 16, 6);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.82, side: THREE.DoubleSide,
    emissive: new THREE.Color(color).multiplyScalar(0.08),
  });
  const flag = new THREE.Mesh(geo, mat);
  flag.position.set(size * 0.9, 3.55, 0);
  flag.castShadow = true;
  flag.userData.base = geo.attributes.position.array.slice();
  group.add(flag);
  group.userData.flag = flag;
  group.userData.t = Math.random() * 100;
  return group;
}
