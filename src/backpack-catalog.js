export const DEFAULT_BACKPACK_MODEL = 'micon-litric-16';
export const BACKPACK_MODELS = {
  [DEFAULT_BACKPACK_MODEL]: {
    id: DEFAULT_BACKPACK_MODEL, brand: 'Arc’teryx', model: 'Micon LiTRIC 16',
    name: 'Arc’teryx · Micon LiTRIC 16',
    description: 'A compact 16 L pack with a low-profile shell, sealed seams and a glove-friendly pull.',
    source: 'https://arcteryx.com/us/en/shop/micon-litric-16-avalanche-airbag-9977',
  },
  'soelden-22': {
    id: 'soelden-22', brand: 'Osprey', model: 'Soelden 22',
    name: 'Osprey · Soelden 22',
    description: 'A deeper 22 L touring pack with a J-zip front pocket and side compression straps.',
    source: 'https://www.osprey.com/eu/osprey-soelden-22-f23',
  },
};
export const isBackpackModel = (id) => typeof id === 'string' && Object.hasOwn(BACKPACK_MODELS, id);
