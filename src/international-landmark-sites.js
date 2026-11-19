// Coordinates use the resort's projected metres, with positive z pointing south.
const sites = {
  'ski-arlberg': {
    markers: [{
      id: 'galzigbahn-terminal', name: 'Galzigbahn Valley Station', kind: 'viewpoint',
      point: [8439.2, 1410.4], view: { x: 8434, z: 1443, heading: 3.03 },
    }],
    buildings: ['193437922'],
    lifts: { galzigbahn: { bottomArchitecture: 'galzigbahn' } },
  },
  'verbier-4-vallees': {
    terrain: {
      file: 'mont-fort-height.bin', cols: 121, rows: 121, offset: 3170, scale: .01, blend: 46,
      bounds: { minX: 860, maxX: 1100, minZ: 2860, maxZ: 3100 },
    },
    markers: [{
      id: 'mont-fort-platform', name: 'Mont Fort Panorama Platform', kind: 'viewpoint',
      point: [1005.0, 2984.9], view: { x: 1005.0, z: 2984.9, heading: 1.31 },
    }],
    buildings: ['208449395'],
    lifts: { 'mont-fort': { topArchitecture: 'mont-fort' } },
  },
  'chamonix-mont-blanc': {
    terrain: {
      file: 'aiguille-du-midi-height.bin', cols: 221, rows: 221, offset: 3549, scale: .01, blend: 40,
      bounds: { minX: 1480, maxX: 1700, minZ: 3280, maxZ: 3500 },
      // Interpolate the rock lost under the classified station roof.
      rockRidge: [[1529, 3369, 3775], [1546, 3359, 3776], [1558, 3346, 3774], [1569, 3335, 3774]],
    },
    markers: [{
      id: 'piton-nord', name: 'Aiguille du Midi · Piton Nord', kind: 'viewpoint',
      point: [1578.9, 3335.9], view: { x: 1578.9, z: 3335.9, heading: .11 },
    }, {
      id: 'aiguille-du-midi', name: 'Aiguille du Midi · Terrasse 3842', kind: 'peak',
      point: [1598.0, 3408.5], elevation: 3842, view: { x: 1598.0, z: 3410.1, heading: -2.84 },
    }],
    buildings: ['231374774', '231374776', '231374780', '1449550791'],
    lifts: {
      'tph-aiguille-du-midi': {
        topArchitecture: 'aiguille-du-midi',
        upperCableElevation: 3781.4,
        unload: { x: 1570, z: 3352, heading: .63, footMode: true },
      },
    },
  },
};

export function internationalLandmarkSite(id) {
  return sites[id];
}

export function applyInternationalLandmarkSites(config) {
  const site = internationalLandmarkSite(config.id);
  if (!site) return;
  const ids = new Set(site.markers.map(marker => marker.id));
  config.landmarks = [...(config.landmarks ?? []).filter(marker => !ids.has(marker.id)), ...site.markers];
  for (const lift of config.lifts) Object.assign(lift, site.lifts[lift.id]);
}
