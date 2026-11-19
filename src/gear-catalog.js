export const DEFAULT_SKI_ID = 'all-mountain';
export const DEFAULT_SNOWBOARD_ID = 'burton-custom-camber';

function catalog(kind, entries) {
  return Object.freeze(Object.fromEntries(Object.entries(entries).map(([id, entry]) => {
    const { brand, model, handling } = entry;
    return [id, Object.freeze({ id, kind, name: `${brand} ${model}`, ...entry, handling: Object.freeze(handling) })];
  })));
}

// Dimensions are the manufacturer's data for the listed length. Setback is a
// positive distance toward the tail. Handling values are game tuning factors.
export const SKI_MODELS = catalog('ski', {
  'all-mountain': {
    brand: 'Salomon', model: 'Stance Pro 96', category: 'All-mountain', color: '#ec7244',
    lengthCm: 182, tipMm: 132, waistMm: 96, tailMm: 114, radiusM: 20,
    camber: 'Rocker / Camber / Rocker', construction: 'Karuba and poplar core with double Titanal',
    description: 'Balanced edge hold and float for groomers, bumps and glades.',
    source: 'https://www.salomon.com/en-us/product/stance-pro-96-li8300/L47827100%2B',
    handling: { grip: 1, drag: 1, speed: 1, pop: 1, float: 1, stability: 1, switch: .91 },
  },
  'laser-wrt-pro': {
    brand: 'Stöckli', model: 'Laser WRT Pro', category: 'Race carver', color: '#dc4f4c',
    lengthCm: 172, tipMm: 119, waistMm: 67, tailMm: 101, radiusM: 14.8,
    camber: 'Race camber', construction: 'Beech and poplar race core with Titanal and carbon',
    description: 'Damp at speed with clean, powerful arcs on firm snow.',
    source: 'https://www.stoeckli.ch/media/contentmanager/content/File/Workbook-Winter-2026-27.pdf',
    handling: { grip: 1.34, drag: .93, speed: 1.08, pop: .99, float: .65, stability: 1.32, switch: .76 },
  },
  carver: {
    brand: 'Rossignol', model: 'Hero Elite ST Ti Konect', category: 'Slalom carver', color: '#f04a3f',
    lengthCm: 167, tipMm: 123, waistMm: 68, tailMm: 104, radiusM: 13,
    camber: 'Camber with a low tip rocker', construction: 'Beech core with Titanal',
    description: 'The shortest-radius ski snaps across the fall line on hard snow.',
    source: 'https://www.rossignol.com/gb-en/hero-elite-st-ti-konect-RALPH01000167.html',
    handling: { grip: 1.25, drag: 1.02, speed: .98, pop: .96, float: .69, stability: 1.17, switch: .76 },
  },
  powder: {
    brand: 'Atomic', model: 'Bent 110', category: 'Freeride / powder', color: '#729ab9',
    lengthCm: 180, tipMm: 133, waistMm: 110, tailMm: 124, radiusM: 18,
    camber: 'Powder Rocker 25 / 50 / 25', construction: 'Light wood core and Dura Cap sidewall',
    description: 'A wide waist and early rise carry speed through deep snow.',
    source: 'https://www.atomic.com/en-int/products/bent-110-aa7365-202600',
    handling: { grip: .89, drag: .83, speed: 1.03, pop: 1.06, float: 1.43, stability: 1.01, switch: .96 },
  },
  park: {
    brand: 'LINE', model: 'Chronic 94', category: 'Freestyle', color: '#a9c577',
    lengthCm: 178, tipMm: 123, waistMm: 94, tailMm: 117, radiusM: 16.3, setbackMm: 40,
    camber: 'Early rise and symmetric flex', construction: 'Thick-cut sidewalls and thin tips',
    description: 'Twin tips and symmetric flex make switch landings and park laps easier.',
    source: 'https://lineskis.com/en-us/p/chronic-94-skis-ln261773',
    handling: { grip: .96, drag: 1.07, speed: .96, pop: 1.24, float: .96, stability: .94, switch: 1.16 },
  },
});

export const SNOWBOARD_MODELS = catalog('snowboard', {
  'burton-custom-camber': {
    brand: 'Burton', model: 'Custom Camber', category: 'All-mountain freestyle', color: '#c1ef59',
    lengthCm: 158, tipMm: 297, waistMm: 254, tailMm: 297, radiusM: 7.9,
    stanceWidthCm: 56, setbackMm: 12.5, runningLengthMm: 1165, effectiveEdgeMm: 1215,
    camber: 'Traditional camber', construction: 'Super Fly II wood core and twin flex',
    description: 'Camber adds pop, and symmetric flex keeps switch riding familiar.',
    source: 'https://eu.burton.com/en-gb/products/mens-burton-custom-camber-snowboard-106881a-o?variant=42867455721549',
    handling: { grip: 1.06, drag: 1, speed: 1, pop: 1.19, float: 1.04, stability: 1.03, switch: 1.14 },
  },
  'jones-flagship': {
    brand: 'Jones', model: 'Flagship', category: 'Directional freeride', color: '#ceab75',
    lengthCm: 161, tipMm: 296, waistMm: 252, tailMm: 283, radiusM: 9.1,
    stanceWidthCm: 56, setbackMm: 20, runningLengthMm: 1090, effectiveEdgeMm: 1200, noseLengthMm: 330, tailLengthMm: 190,
    camber: 'Freeride CamRock', construction: 'Directional flex and ash veneer',
    description: 'A tapered tail and long rockered nose add float and stability in steep, deep terrain.',
    source: 'https://www.jonessnowboards.com/products/mens-flagship-snowboard',
    handling: { grip: 1.14, drag: .88, speed: 1.07, pop: .97, float: 1.46, stability: 1.26, switch: .80 },
  },
});
