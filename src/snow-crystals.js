import { Vector3 } from 'three';
import { climateUniforms } from './climate-state.js';

// Horizontal travel during a short virtual exposure, in metres, and the
// remaining contrast of centimetre-scale grain. Shared by both snow shaders.
const shutter = { value: new Vector3(0, 0, 1) };
let motionBlurEnabled = true;

export function bindSnowMotionBlur(input, hint) {
  const key = 'alpine.snow-motion-blur';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let preferred = true;
  try { preferred = localStorage.getItem(key) !== 'off'; } catch {}

  function sync() {
    motionBlurEnabled = preferred && !reducedMotion.matches;
    if (!motionBlurEnabled) shutter.value.set(0, 0, 1);
    input.checked = motionBlurEnabled;
    input.disabled = reducedMotion.matches;
    hint.hidden = !reducedMotion.matches;
  }
  input.addEventListener('change', () => {
    preferred = input.checked;
    try { localStorage.setItem(key, preferred ? 'on' : 'off'); } catch {}
    sync();
  });
  reducedMotion.addEventListener('change', sync);
  sync();
}

export function updateSnowShutter(player, active) {
  if (!motionBlurEnabled || !active || !(player.speed > 10)) {
    shutter.value.set(0, 0, 1);
    return;
  }
  const t = Math.min(1, (player.speed - 10) / 16);
  const duration = t * t * (3 - 2 * t) * Math.min(1 / 175, .18 / player.speed);
  const x = player.vel.x * duration, z = player.vel.z * duration;
  shutter.value.set(x, z, 1 / (1 + 30 * (x*x + z*z)));
}

export function bindSnowCrystals(shader) {
  shader.uniforms.snowShutter = shutter;
  shader.uniforms.snowSun = climateUniforms.snowSun;
  shader.uniforms.snowSunDirection = climateUniforms.snowSunDirection;
  shader.uniforms.iceHorizon = climateUniforms.reflectedHorizon;
  shader.uniforms.iceZenith = climateUniforms.reflectedZenith;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', /* glsl */ `
    #include <common>
    uniform float snowSun;
    uniform vec3 snowSunDirection;
    uniform vec3 iceHorizon, iceZenith;
    uniform vec3 snowShutter;

    // Contrast of a narrow periodic feature averaged over a short exposure.
    float snowBandContrast(float cycles) { return 1./(1.+1.7*cycles*cycles); }

    // Broken wind lips approximately a metre apart. A shorter harmonic
    // steepens the sheltered face. Integrate each frequency along travel
    // so sliding across the ridges softens them more than following them.
    float windLipHeight(vec2 ground, float drift, float crust, float eye, float loose) {
      vec2 crosswind = vec2(.52,.79);
      float phase = dot(ground,crosswind) + 1.48*(drift-.5) + .17*(crust-.5);
      float pixel = fwidth(phase);
      float strength = loose * (1.-smoothstep(9.,32.,eye))
        * (1.-smoothstep(.18,.48,pixel)) * smoothstep(.22,.66,drift);
      if (strength < .001) return 0.;
      float travel = dot(snowShutter.xy,crosswind);
      float angle = phase*6.2831853;
      float shape = sin(angle)*snowBandContrast(travel)
        + .34*sin(2.*angle+.55)*(1.-smoothstep(.12,.32,pixel))*snowBandContrast(2.*travel);
      return .019*strength*shape;
    }

    vec3 shadeWinterSurface(vec3 radiance, vec3 viewNormal, vec3 toEye, float snow, float ice, float powder) {
      float snowWeight = clamp(snow,0.,1.);
      if (snowWeight == 0.) return radiance;
      vec3 n = normalize(viewNormal * mat3(viewMatrix));
      float crustWeight = clamp(ice,0.,1.);
      vec3 winterLight = radiance;
      bool scatter = powder > 0. && snowSun > 0. && crustWeight < 1.;
      vec3 v = vec3(0.);
      if (scatter || crustWeight > 0.) v = normalize(toEye * mat3(viewMatrix));
      // Porous snow scatters skylight into sheltered slopes. The long optical
      // path through dense snow absorbs more red than blue light.
      if (crustWeight < 1.) {
        float nl = dot(n, snowSunDirection);
        float shelter = 1. - smoothstep(-.12,.48,nl);
        winterLight = radiance * mix(vec3(1.), vec3(.79,.907,1.025), shelter * (.42 + .55 * powder));
        if (scatter && nl > 0.) {
          float backscatter = pow(max(dot(v,snowSunDirection),0.), 10.) * nl;
          winterLight += radiance * powder * backscatter * snowSun * .19;
        }
      }
      // Air/ice reflectance (n≈1.31). A smooth wind crust picks up the actual
      // horizon and sky palette, including the colour change after sunset.
      if (crustWeight > 0.) {
        float nv = clamp(dot(n, v), 0., 1.);
        vec3 reflected = reflect(-v,n);
        vec3 sky = mix(iceHorizon, iceZenith, smoothstep(-.04,.86,reflected.y));
        float fresnel = .018 + .982 * pow(1. - nv, 5.);
        vec3 crust = mix(radiance * vec3(.82,.92,.975), sky, fresnel);
        winterLight = mix(winterLight, crust, crustWeight);
      }
      return mix(radiance, winterLight, snowWeight);
    }

    vec3 crystalHash(vec2 cell) {
      vec3 p = fract(cell.xyx * vec3(.1031, .1099, .0973));
      p += dot(p, p.yzx + 33.33);
      return fract((p.xxy + p.yzz) * p.zyx);
    }

    float snowCrystalFlash(vec3 p, vec3 viewNormal, float distanceToEye, float snowCover) {
      if (snowSun == 0.) return 0.;
      vec2 grid = p.xz * 8.3;
      float pixel = length(fwidth(grid));
      float visible = snowSun * snowCover * (1.0 - smoothstep(.36, .95, pixel))
        * (1.0 - smoothstep(15., 35., distanceToEye));
      if (visible < .01) return 0.;
      vec3 variation = crystalHash(floor(grid));
      if (variation.z < .62) return 0.;

      // The crystals stay fixed in the snow. Only facets facing the sun and viewer flash.
      vec3 n = normalize(viewNormal * mat3(viewMatrix));
      vec3 facet = normalize(n * .72 + vec3(variation.x-.5, (variation.z-.80)*.8, variation.y-.5)*1.55);
      vec3 halfway = normalize(snowSunDirection + normalize(cameraPosition-p));
      float angle = dot(facet, halfway);
      float flash = smoothstep(.976, .9985, angle) * smoothstep(.015,.19,dot(n,snowSunDirection));
      vec2 delta = fract(grid) - mix(vec2(.25),vec2(.75),variation.xy);
      float size = mix(.031, .069, variation.z);
      float foot = pixel * .53;
      float dotMask = 1.0-smoothstep(max(.0,size-foot*.42),size+foot,length(delta));
      return visible * flash * dotMask * min(1., .22 / max(.22, pixel)) * snowShutter.z;
    }
  `);
}
