// Shared references are deliberately independent of the scene graph: materials,
// conifers and the weather controller can all use them without import cycles.
export const climateUniforms = {
  snowpack: { value: 1 },
  snowline: { value: 630 },
  autumn: { value: 0 },
  spring: { value: 0 },
  wetness: { value: 0 },
  night: { value: 0 },
};

export const climateState = { season: 'winter', weather: 'flurries', time: 'day' };
