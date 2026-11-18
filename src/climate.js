import * as THREE from 'three';
import { climateState, climateUniforms } from './climate-state.js';

export { climateState, climateUniforms } from './climate-state.js';

export const CLIMATE_PRESETS = {
  seasons: {
    winter: { label: 'Winter', snowpack: 1, snowline: 630, autumn: 0, spring: 0 },
    spring: { label: 'Spring thaw', snowpack: .56, snowline: 1280, autumn: 0, spring: 1 },
    summer: { label: 'Alpine summer', snowpack: 0, snowline: 2080, autumn: 0, spring: 0 },
    autumn: { label: 'Autumn frost', snowpack: .16, snowline: 1750, autumn: 1, spring: 0 },
  },
  weather: {
    clear: { label: 'Clear', precipitation: 0, wind: 1.6, cloud: .14, fog: .000034 },
    flurries: { label: 'Passing flurries', precipitation: .22, wind: 2.8, cloud: .52, fog: .000065 },
    storm: { label: 'Snow squall', precipitation: .92, wind: 11.5, cloud: .98, fog: .0032 },
  },
  times: { day: { label: 'Daylight' }, alpenglow: {label:'Late afternoon'}, 'blue-hour': { label: 'Blue hour' } },
};

const daylight = {
  zenith: '#295b94', mid: '#648fb9', horizon: '#dbe9f1', sunColor: '#ffe6c2',
  cloudShade: '#626f7d', cloudLight: '#e8f2fa', fogColor: '#bdd0e1',
  hemiSky: '#d5e4f0', hemiGround: '#a7b7c0', fillColor: '#9dc4db', lightColor: '#fff1dc',
};
const blueHour = {
  zenith: '#1a355b', mid: '#40638b', horizon: '#a8bad2', sunColor: '#f6b280',
  cloudShade: '#374c69', cloudLight: '#91a4bc', fogColor: '#7388a5',
  hemiSky: '#9db6e0', hemiGround: '#667da4', fillColor: '#789dd5', lightColor: '#a3c1eb',
};
const alpenglow = {
  zenith:'#325780', mid:'#8497ac', horizon:'#efd1b5', sunColor:'#ffcc91',
  cloudShade:'#8090a4', cloudLight:'#ffe1b8', fogColor:'#c8b9ab',
  hemiSky:'#a5bedd', hemiGround:'#a3aeb8', fillColor:'#a2bedb', lightColor:'#ffcc93',
};
const colorKeys = Object.keys(daylight);
const colors = (palette) => Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, new THREE.Color(value)]));

/** One controller for real seasonal snow lines, sky, squalls and village lamps. */
export function createClimate({ scene, renderer, lighting, sky, storm, villageLights, terrain } = {}) {
  const listeners = new Set();
  const state = climateState;
  let seconds = 0;
  let night = 0;
  let late = 0;
  let precipitation = .22;
  let cloud = .52;
  let wind = 2.8;
  let fog = .000065;
  let instantNext = true;
  const dayColors = colors(daylight), eveningColors = colors(blueHour), lateColors=colors(alpenglow);
  const palette = colors(daylight);
  const stormTint = new THREE.Color('#87929c');
  const summary = { ...state, gust: 0, visibility: 0, snowfall: 0, night: 0 };
  const set = (next = {}, { instant = false } = {}) => {
    if (next.season in CLIMATE_PRESETS.seasons) state.season = next.season;
    if (next.weather in CLIMATE_PRESETS.weather) state.weather = next.weather;
    if (next.time in CLIMATE_PRESETS.times) state.time = next.time;
    instantNext ||= instant;
    villageLights?.setClimate(state);
    terrain?.setSeason?.(state.season);
    for (const listener of listeners) listener({ ...state });
    return { ...state };
  };
  function update(dt, camera) {
    seconds += dt;
    const amount = instantNext ? 1 : 1 - Math.exp(-dt * 1.9);
    const season = CLIMATE_PRESETS.seasons[state.season];
    const weather = CLIMATE_PRESETS.weather[state.weather];
    // Long pulses and smaller turbulent gusts keep a squall from being a
    // constant screen overlay. Visibility tightens only while a burst passes.
    const front = .5 + .5 * Math.sin(seconds * .167 + .7 * Math.sin(seconds * .039));
    const burst = front * front;
    const gust = state.weather === 'storm'
      ? .32 + .68 * burst + .10 * Math.sin(seconds * 1.31) * Math.sin(seconds * .73)
      : .16 + .14 * Math.sin(seconds * .39);
    precipitation += (weather.precipitation * (state.weather === 'storm' ? .52 + .48 * burst : 1) - precipitation) * amount;
    cloud += (weather.cloud - cloud) * amount;
    wind += (weather.wind * (.58 + gust * .69) - wind) * amount;
    night += ((state.time === 'blue-hour' ? 1 : 0) - night) * amount;
    late += ((state.time==='alpenglow'?1:0)-late)*amount;
    const altitude = camera?.position.y ?? 1850;
    const mountain = THREE.MathUtils.smoothstep(altitude, 850, 1800);
    const fogTarget = weather.fog * (state.weather === 'storm' ? (.47 + burst * .73) * (.70 + mountain * .30) : 1);
    fog += (fogTarget - fog) * amount;
    for (const key of colorKeys) palette[key].copy(dayColors[key]).lerp(lateColors[key],late).lerp(eveningColors[key], night);
    const overcast = THREE.MathUtils.smoothstep(cloud, .55, 1);
    palette.zenith.lerp(stormTint, overcast * .72 * (1 - night * .5));
    palette.mid.lerp(palette.cloudShade, overcast * .69);
    palette.horizon.lerp(palette.cloudLight, overcast * .36);
    palette.fogColor.lerp(palette.cloudShade, overcast * .30);
    Object.assign(palette, {
      cloud, night, late, sunStrength: (1 - overcast * .92) * (1 - night * .99),
      sunIntensity: (2.18 - overcast * 1.72) * (1 - night * .91),
      hemiIntensity: (1.13 - overcast * .24) * (1 - night * .48),
      fillIntensity: .32 + night * .14,
    });
    lighting?.setClimate?.(palette);
    sky?.setClimate?.(palette);
    if (scene.fog) { scene.fog.density = fog; scene.fog.color.copy(palette.fogColor); }
    scene.background?.copy?.(palette.fogColor);
    scene.environmentIntensity = 1 - night * .73 - overcast * .13;
    if (renderer) renderer.toneMappingExposure = 1.03 + night * .16 - overcast * .035;
    for (const key of ['snowpack', 'snowline', 'autumn', 'spring']) {
      climateUniforms[key].value += (season[key] - climateUniforms[key].value) * amount;
    }
    climateUniforms.night.value = night;
    climateUniforms.wetness.value += ((state.weather === 'clear' ? .07 : .72) - climateUniforms.wetness.value) * amount;
    storm?.setWeather?.({ precipitation, wind, gust, night, snowline: season.snowline - 420 });
    villageLights?.update(dt, seconds, { night, season: state.season },camera);
    Object.assign(summary, state, {
      gust: Math.round(wind * 3.6), visibility: Math.round(Math.sqrt(-Math.log(.05)) / Math.max(fog, .00001)),
      snowfall: precipitation, night,
    });
    instantNext = false;
  }
  return {
    set, update,
    get state() { return { ...summary, ...state }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
