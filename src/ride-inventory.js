import { DEFAULT_SKI_ID, DEFAULT_SNOWBOARD_ID, SKI_MODELS, SNOWBOARD_MODELS } from './gear-catalog.js';

// The long-standing ski IDs also identify purchases made in earlier saves.
const skiPrices = { carver: 18, powder: 24, park: 21 };
export function restoreRide(data = {}) {
  const owned = new Set(Object.keys(SKI_MODELS).filter(id => !skiPrices[id]));
  if (Array.isArray(data?.owned)) {
    for (const id of data.owned) if (typeof id === 'string' && Object.hasOwn(SKI_MODELS, id)) owned.add(id);
  }
  return {
    owned: [...owned],
    discipline: data?.discipline === 'snowboard' ? 'snowboard' : 'ski',
    skis: owned.has(data?.skis) ? data.skis : DEFAULT_SKI_ID,
    snowboard: Object.hasOwn(SNOWBOARD_MODELS, data?.snowboard) ? data.snowboard : DEFAULT_SNOWBOARD_ID,
    stance: data?.stance === 'goofy' ? 'goofy' : 'regular',
  };
}

export function rideOptions(state, slot) {
  const skis = slot === 'skis';
  const models = skis ? SKI_MODELS : SNOWBOARD_MODELS;
  return Object.values(models).map(model => ({
    id: model.id, name: model.name, color: model.color, description: model.description,
    price: skis ? skiPrices[model.id] ?? 0 : 0, owned: !skis || state.owned.includes(model.id),
    active: state.discipline === model.kind && state[slot] === model.id,
    specs: `${model.lengthCm} cm · ${model.tipMm}/${model.waistMm}/${model.tailMm} mm · ${model.radiusM} m radius`,
    source: model.source,
  }));
}

export function equipRide(state, slot, id) {
  if (slot !== 'skis' && slot !== 'snowboard') return false;
  const models = slot === 'skis' ? SKI_MODELS : SNOWBOARD_MODELS;
  if (!Object.hasOwn(models, id)) return false;
  if (slot === 'skis' && !state.owned.includes(id)) {
    const price = skiPrices[id] ?? 0;
    if (!Number.isSafeInteger(state.balance) || state.balance < price) return false;
    state.balance -= price;
    state.owned.push(id);
  }
  state.discipline = models[id].kind;
  state[slot] = id;
  return true;
}
