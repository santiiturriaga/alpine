import * as THREE from 'three';
import { updateHorizonSun } from './terrain-horizon.js';
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
    whiteout: { label: 'Extreme Whiteout', precipitation: 1, wind: 24, cloud: 1, fog: .026 },
  },
  times: {
    cycle: { label: '20-minute cycle' }, day: { label: 'Daylight' },
    alpenglow: { label: 'Late afternoon' }, 'golden-hour': { label: 'Golden Hour' },
    'blue-hour': { label: 'Blue hour' }, night: { label: 'Night' },
  },
  traffic: { scheduled: { label: 'By time of day' }, peak: { label: 'Peak crowds' } },
};

const DAY_SECONDS = 20 * 60;
const FIXED_TIMES = { day: 12, alpenglow: 16.25, 'golden-hour': 17.42, 'blue-hour': 18.50, night: 23 };
const nightSky = {
  zenith: '#070f27', mid: '#121f40', horizon: '#393f5e', sunColor: '#abc2eb',
  cloudShade: '#161e35', cloudLight: '#404e67', fogColor: '#384866',
  hemiSky: '#799cdb', hemiGround: '#596586', fillColor: '#6381ba', lightColor: '#b4d5ff',
};
const daylight = {
  zenith: '#295b94', mid: '#648fb9', horizon: '#dbe9f1', sunColor: '#ffe6c2',
  cloudShade: '#626f7d', cloudLight: '#e8f2fa', fogColor: '#bdd0e1',
  hemiSky: '#d5e4f0', hemiGround: '#a7b7c0', fillColor: '#9dc4db', lightColor: '#fff1dc',
};
const blueHour = {
  zenith: '#183659', mid: '#3e5d8a', horizon: '#ac9fbe', sunColor: '#faab80',
  cloudShade: '#374764', cloudLight: '#99a5bf', fogColor: '#798aaa',
  hemiSky: '#9db6e0', hemiGround: '#667da4', fillColor: '#789dd5', lightColor: '#a3c1eb',
};
const alpenglow = {
  zenith:'#325780', mid:'#8497ac', horizon:'#efd1b5', sunColor:'#ffcc91',
  cloudShade:'#8090a4', cloudLight:'#ffe1b8', fogColor:'#c8b9ab',
  hemiSky:'#a5bedd', hemiGround:'#a3aeb8', fillColor:'#a2bedb', lightColor:'#ffcc93',
};
const goldenHour = {
  zenith: '#284a81', mid: '#6b76a2', horizon: '#fbb58d', sunColor: '#ffb069',
  cloudShade: '#64608b', cloudLight: '#ffc17d', fogColor: '#d4b5ad',
  hemiSky: '#b7c9ed', hemiGround: '#a7acbd', fillColor: '#a5b8e1', lightColor: '#ffc17a',
};
const colorKeys = Object.keys(daylight);
const colors = (palette) => Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, new THREE.Color(value)]));
const smooth = (start, end, value) => THREE.MathUtils.smoothstep(value, start, end);

function timeOfDay(hour) {
  const sunArc = Math.sin((hour - 6) * Math.PI / 12);
  const night = 1 - smooth(-.40, -.17, sunArc);
  const blue = 1 - smooth(-.22, .07, sunArc);
  const golden = smooth(-.17, .05, sunArc) * (1 - smooth(.14, .48, sunArc));
  const late = smooth(-.04, .24, sunArc) * (1 - smooth(.26, .75, sunArc));
  // Softer morning arrival, a midday peak and a gradual clear-out at dusk.
  const crowd = .07 + .93 * smooth(7.3, 10.4, hour) * (1 - smooth(14.5, 17.8, hour));
  return { sunArc, night, blue, golden, late, crowd };
}

export function bindConditionsClock(climate, clock) {
  let previous;
  return () => {
    const { hour, crowd } = climate.state;
    const minutes = Math.floor(hour * 60) % 1440;
    const traffic = crowd > .74 ? 'Busy' : crowd >= .34 ? 'Steady' : 'Quiet';
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')} · ${traffic}`;
    if (previous !== value) clock.value = previous = value;
  };
}

/** One controller for real seasonal snow lines, sky, squalls and village lamps. */
export function createClimate({ scene, renderer, lighting, sky, storm, villageLights, slopeFixtures, terrain } = {}) {
  const listeners = new Set();
  const state = climateState;
  let seconds = 0;
  let hour = 9.5;
  let night = 0;
  let darkness = 0;
  let late = 0;
  let golden = 0;
  let whiteout = 0;
  let precipitation = .22;
  let cloud = .52;
  let wind = 2.8;
  let fog = .000065;
  let instantNext = true;
  const dayColors = colors(daylight), eveningColors = colors(blueHour), lateColors = colors(alpenglow);
  const goldenColors = colors(goldenHour), nightColors = colors(nightSky);
  const palette = colors(daylight);
  const stormTint = new THREE.Color('#87929c');
  const whiteoutTint = new THREE.Color('#b2bcc7');
  const summary = { ...state, gust: 0, visibility: 0, snowfall: 0, night: 0, hour, crowd: 1 };
  const set = (next = {}, { instant = false } = {}) => {
    if (Object.hasOwn(CLIMATE_PRESETS.seasons, next.season)) state.season = next.season;
    if (Object.hasOwn(CLIMATE_PRESETS.weather, next.weather)) state.weather = next.weather;
    if (Object.hasOwn(CLIMATE_PRESETS.times, next.time)) state.time = next.time;
    if (Object.hasOwn(CLIMATE_PRESETS.traffic, next.traffic)) state.traffic = next.traffic;
    if (Number.isFinite(next.hour)) hour = (next.hour % 24 + 24) % 24;
    instantNext ||= instant;
    villageLights?.setClimate(state);
    terrain?.setSeason?.(state.season);
    for (const listener of listeners) listener({ ...state });
    return { ...state };
  };
  function update(dt, camera, cycleSeconds = 0) {
    seconds += dt;
    if (state.time === 'cycle') hour = (hour + cycleSeconds * 24 / DAY_SECONDS) % 24;
    const clockHour = FIXED_TIMES[state.time] ?? hour;
    const localTime = timeOfDay(clockHour);
    const amount = instantNext ? 1 : 1 - Math.exp(-dt * 1.9);
    const season = CLIMATE_PRESETS.seasons[state.season];
    const weather = CLIMATE_PRESETS.weather[state.weather];
    // Long pulses and smaller turbulent gusts keep a squall from being a
    // constant screen overlay. Visibility tightens only while a burst passes.
    const front = .5 + .5 * Math.sin(seconds * .167 + .7 * Math.sin(seconds * .039));
    const burst = front * front;
    const squall = state.weather === 'storm';
    const extreme = state.weather === 'whiteout';
    const turbulent = .10 * Math.sin(seconds * 1.31) * Math.sin(seconds * .73);
    const gust = extreme ? .68 + .32 * burst + turbulent
      : squall ? .32 + .68 * burst + turbulent : .16 + .14 * Math.sin(seconds * .39);
    precipitation += (weather.precipitation * (extreme ? .91 + .09 * burst : squall ? .60 + .40 * burst : 1) - precipitation) * amount;
    cloud += (weather.cloud - cloud) * amount;
    wind += (weather.wind * (.58 + gust * .69) - wind) * amount;
    whiteout += (Number(extreme) - whiteout) * amount;
    const cycle = state.time === 'cycle';
    darkness += ((state.time === 'night' ? 1 : cycle ? localTime.night : 0) - darkness) * amount;
    night += ((state.time === 'night' || state.time === 'blue-hour' ? 1 : cycle ? localTime.blue : 0) - night) * amount;
    late += ((state.time === 'alpenglow' ? 1 : cycle ? localTime.late : 0) - late) * amount;
    golden += ((state.time === 'golden-hour' ? 1 : cycle ? localTime.golden : 0) - golden) * amount;
    const altitude = camera?.position.y ?? 1850;
    const mountain = THREE.MathUtils.smoothstep(altitude, 850, 1800);
    const fogTarget = weather.fog * (extreme ? (.81 + .36 * burst) * (.84 + mountain * .16)
      : squall ? (.47 + burst * .73) * (.70 + mountain * .30) : 1);
    fog += (fogTarget - fog) * amount;
    for (const key of colorKeys) palette[key].copy(dayColors[key]).lerp(lateColors[key], late)
      .lerp(goldenColors[key], golden).lerp(eveningColors[key], night).lerp(nightColors[key], darkness * .94);
    const overcast = THREE.MathUtils.smoothstep(cloud, .55, 1);
    palette.zenith.lerp(stormTint, overcast * .72 * (1 - night * .5));
    palette.mid.lerp(palette.cloudShade, overcast * .69);
    palette.horizon.lerp(palette.cloudLight, overcast * .36);
    palette.fogColor.lerp(palette.cloudShade, overcast * .30);
    const whiteHaze = whiteout * (1 - night * .56);
    palette.fogColor.lerp(whiteoutTint, whiteHaze * .80);
    palette.zenith.lerp(palette.fogColor, whiteout * .85);
    palette.mid.lerp(palette.fogColor, whiteout * .90);
    palette.horizon.lerp(palette.fogColor, whiteout * .99);
    const sunStrength = (1 - overcast * .96) * (1 - night);
    Object.assign(palette, {
      cloud, night, late, golden, cycle, hour: clockHour, sunArc: localTime.sunArc, darkness, whiteout,
      sunStrength,
      sunIntensity: (2.18 - overcast * 1.72) * (1 - night * .91) * (1 + .14 * golden) * (1 - darkness * .76),
      hemiIntensity: (1.13 - overcast * .24) * (1 - night * .48) * (1 - darkness * .79) * (1 - .22 * golden),
      fillIntensity: (.32 + night * .14) * (1 - darkness * .86),
    });
    lighting?.setClimate?.(palette);
    updateHorizonSun(climateUniforms.snowSunDirection.value);
    sky?.setClimate?.(palette);
    if (scene.fog) { scene.fog.density = fog; scene.fog.color.copy(palette.fogColor); }
    scene.background?.copy?.(palette.fogColor);
    scene.environmentIntensity = (1 - night * .73 - overcast * .13) * (1 - .50 * darkness);
    if (renderer) renderer.toneMappingExposure = 1.03 + night * .16 - overcast * .035;
    for (const key of ['snowpack', 'snowline', 'autumn', 'spring']) {
      climateUniforms[key].value += (season[key] - climateUniforms[key].value) * amount;
    }
    climateUniforms.night.value = night;
    climateUniforms.terrainSun.value = cycle ? smooth(.78, .98, localTime.sunArc) * .60 : (1 - Math.max(late * .53, golden * .88)) * (1 - night);
    climateUniforms.snowSun.value = sunStrength;
    climateUniforms.reflectedHorizon.value.copy(palette.horizon);
    climateUniforms.reflectedZenith.value.copy(palette.zenith);
    climateUniforms.wetness.value += ((state.weather === 'clear' ? .07 : .72) - climateUniforms.wetness.value) * amount;
    storm?.setWeather?.({ precipitation, wind, gust, night, whiteout, snowline: season.snowline - 420 });
    villageLights?.update(dt, seconds, { night, season: state.season },camera);
    slopeFixtures?.update(dt, seconds, { night, season: state.season, wind, precipitation, whiteout }, camera);
    Object.assign(summary, state, {
      gust: Math.round(wind * 3.6), visibility: Math.round(Math.sqrt(-Math.log(.05)) / Math.max(fog, .00001)),
      snowfall: precipitation, night, golden, hour: clockHour, crowd: state.traffic === 'peak' ? 1 : localTime.crowd,
    });
    instantNext = false;
  }
  return {
    set, update,
    get state() { return { ...summary, ...state }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
