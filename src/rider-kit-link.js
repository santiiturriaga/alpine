import { SKI_MODELS, SNOWBOARD_MODELS, DEFAULT_SKI_ID, DEFAULT_SNOWBOARD_ID } from './gear-catalog.js';
import { DEFAULT_BACKPACK_MODEL, isBackpackModel } from './backpack-catalog.js';

const hex = /^#[0-9a-f]{6}$/i;
const decals = new Set(['none','peak','maple','snowflake']);

// A separate, infrequent message leaves the fixed 17-field pose readable by
// clients using older versions of the public resort.
export function encodeRiderKit(outfit) {
  return [outfit.discipline ?? 'ski', outfit.skis ?? DEFAULT_SKI_ID, outfit.snowboard ?? DEFAULT_SNOWBOARD_ID,
    outfit.stance ?? 'regular', outfit.backpackModel ?? DEFAULT_BACKPACK_MODEL, outfit.backpack ?? '#24282a',
    outfit.pants ?? '#323e48', outfit.helmet ?? '#d6d6d1', outfit.sticker ?? 'none'].join('/');
}

export function readRiderKit(payload) {
  if (payload.length > 152) return null;
  const fields = payload.split('/');
  if (fields.length !== 9) return null;
  const [discipline,skis,snowboard,stance,backpackModel,backpack,pants,helmet,sticker] = fields;
  if (!['ski','snowboard'].includes(discipline) || !['regular','goofy'].includes(stance) ||
      !Object.hasOwn(SKI_MODELS,skis) || !Object.hasOwn(SNOWBOARD_MODELS,snowboard) || !isBackpackModel(backpackModel) ||
      ![backpack,pants,helmet].every(color => hex.test(color)) || !decals.has(sticker)) return null;
  return { discipline, skis, snowboard, skiModel:skis, snowboardModel:snowboard, stance, backpackModel, backpack, pants, helmet, sticker };
}
