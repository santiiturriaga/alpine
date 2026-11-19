import { Color, Vector3 } from 'three';

// Shared references are deliberately independent of the scene graph: materials,
// conifers and the weather controller can all use them without import cycles.
export const climateUniforms = {
  snowpack: { value: 1 },
  snowline: { value: 630 },
  autumn: { value: 0 },
  spring: { value: 0 },
  wetness: { value: 0 },
  night: { value: 0 },
  realism: { value: 0 },
  terrainSun: { value: 1 },
  snowSun: { value: 1 },
  reflectedHorizon: { value: new Color('#dbe9f1') },
  reflectedZenith: { value: new Color('#295b94') },
  snowSunDirection: { value: new Vector3(-.56, .415, .715).normalize() },
};

export const climateState = { season: 'winter', weather: 'flurries', time: 'day', traffic: 'scheduled' };
