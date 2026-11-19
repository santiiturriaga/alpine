// Geospatial positions in the Niseko resort grid (EPSG:32654, positive z south).
// Terminal anchors follow the OpenStreetMap lift ways. The surrounding roofs
// and clearings were traced from GSI's nationwide orthophotography.
export const nisekoSite = {
  buildings: ['193450666'],
  runSections: {
    'beginners-access': 'Grand Hirafu',
    center: 'Grand Hirafu',
    'connector-331223295': 'Grand Hirafu',
    shirakaba: 'Grand Hirafu',
  },
  clearings: [
    { points: [[2445, -1174], [2492, -1202], [2562, -1219], [2606, -1174],
      [2588, -1095], [2516, -1103], [2465, -1124]] },
    { points: [[1028, -1909], [1103, -1914], [1132, -1859], [1099, -1819], [1033, -1818]] },
    { points: [[2569, -4690], [2736, -4708], [2763, -4616], [2751, -4534],
      [2718, -4476], [2676, -4427], [2605, -4447], [2604, -4528], [2563, -4576]] },
  ],
  markers: [
    { id: 'ace-gondola-plaza', name: 'Hirafu · Ace Gondola Plaza', kind: 'viewpoint',
      point: [2518, -1151.1], view: { x: 2538, z: -1139, heading: -2.02 } },
    { id: 'nest813', name: 'Hirafu · NEST813 Terrace', kind: 'viewpoint', elevation: 813,
      point: [1094.8, -1844.4], view: { x: 1094.8, z: -1844.4, heading: 1.53 } },
    { id: 'hanazono-edge', name: 'Hanazono · EDGE & Lift 1', kind: 'viewpoint',
      point: [2683, -4519], view: { x: 2648, z: -4500, heading: 1.98 } },
    { id: 'hanazono-308', name: 'Hanazono · 308 Resort Center', kind: 'viewpoint',
      point: [2708.5, -4668.7], view: { x: 2716, z: -4639, heading: -2.92 } },
  ],
  lifts: {
    'ace-gondola': {
      section: 'Grand Hirafu',
      bottomArchitecture: 'ace-gondola', topArchitecture: 'nest813',
      stationEnclosure: { bottom: 25, top: 28 },
      color: '#343f48',
      board: { x: 2520.84, z: -1147.21, heading: -2.041 },
      unload: { x: 1052.5, z: -1892, heading: -2.22 },
    },
    'hanazono1-hanazono-hooded-lift-1': {
      section: 'Hanazono',
      manufacturer: 'POMA', speed: 5, detachable: true, color: '#426b85',
      bottomArchitecture: 'hanazono-1', topArchitecture: 'hanazono-1',
      board: { x: 2667.95, z: -4493.50, heading: -.899 },
    },
    'hanazono-hanazono-symphony-gondola': {
      section: 'Hanazono',
      manufacturer: 'POMA', speed: 5, color: '#426b85',
      bottomArchitecture: 'hanazono-symphony',
      board: { x: 2645.36, z: -4529.06, heading: -1.362 },
    },
  },
};

export const hanazonoCenterFootprint = [
  [2739.9, -4667.1], [2722.5, -4650.7], [2714, -4659.95],
  [2679.2, -4658.2], [2677.5, -4691.7], [2712.4, -4693.5],
];
