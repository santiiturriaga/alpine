import { heightAt } from './terrain.js';
import { WORLD, RUNS, LIFTS, MOUNTAIN } from './worlddata.js';
import { peakToPeakAccess, stationSite, stationPoint } from './station-sites.js';
import { ROUNDHOUSE_SITE, ROUNDHOUSE_OLYMPIC_SITE, LODGE_FRAME, lodgePoint } from './roundhouse-site.js';
import { PEAK_STONE_SITE, ROUNDHOUSE_STONE_SITE } from './inukshuk.js';
import { DUSTYS_START } from './creekside-village.js';
import { FAIRMONT_START } from './fairmont.js';
import { GLACIER_CAVE_START } from './glacier-cave.js';
import { ALPINE_CLIFF_START } from './alpine-cliffs.js';
import { OLYMPIC_PLAZA } from './village-lights.js';
import { SKIERS_PLAZA_START } from './skiers-plaza.js';
import { mappedLakes } from './valley-scenery.js';
import { buildingData } from '../data/osm-whistler.js';

const lodgeWings = [
  { minX: -21.5, maxX: 26.5, minZ: -14.5, maxZ: 27.45 },
  { minX: -28.2, maxX: -15, minZ: -1.5, maxZ: 23.5 },
  { minX: -12.625, maxX: 26.625, minZ: -31.7, maxZ: 1.5 },
];
const lodgeFootprints = lodgeWings.map(({ minX, maxX, minZ, maxZ }) => ({
  points: [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]].map(([x, z]) => {
    const position = lodgePoint(x, z);
    return [position.x, position.z];
  }),
}));

export function inRoundhouseBuilding(x, z) {
  const dx = x - LODGE_FRAME.x, dz = z - LODGE_FRAME.z;
  const c = Math.cos(LODGE_FRAME.yaw), s = Math.sin(LODGE_FRAME.yaw);
  const e = dx * c - dz * s, n = dx * s + dz * c;
  return lodgeWings.some(({ minX, maxX, minZ, maxZ }) =>
    e > minX - .7 && e < maxX + .7 && n > minZ - .7 && n < maxZ + .7);
}

const landmarks = [
  { id: 'skiers-plaza', name: 'Skiers Plaza', ...SKIERS_PLAZA_START },
  { id: 'village', name: 'Whistler Village', ...MOUNTAIN.village, overview: true },
  { id: 'olympic-plaza', name: 'Whistler Olympic Plaza', ...OLYMPIC_PLAZA.rings, arrival: OLYMPIC_PLAZA.start },
  { id: 'upper-village', name: 'Blackcomb Daylodge', ...MOUNTAIN.upperVillage },
  { id: 'fairmont', name: 'Fairmont Château Whistler', ...FAIRMONT_START },
  { id: 'creekside', name: 'Creekside Village', ...MOUNTAIN.creekside, overview: true },
  { id: 'dustys', name: 'Dusty’s Bar & BBQ', ...DUSTYS_START },
  { id: 'roundhouse', name: 'Roundhouse Lodge', ...ROUNDHOUSE_SITE, approachRadius: 32, overview: true },
  { id: 'roundhouse-rings', name: 'Roundhouse Olympic Rings', ...ROUNDHOUSE_OLYMPIC_SITE },
  { id: 'roundhouse-stone', name: 'Roundhouse Inukshuk', ...ROUNDHOUSE_STONE_SITE, approachRadius: 2.5, description: 'Stone sculpture past the Olympic rings' },
  { id: 'peak-stone', name: 'Whistler Peak Inukshuk', ...PEAK_STONE_SITE, description: 'Stone sculpture by the Peak Express summit' },
  { id: 'whistler-peak', name: 'Whistler Peak', ...MOUNTAIN.whistlerPeak, kind: 'peak', overview: true },
  { id: 'blackcomb-peak', name: 'Blackcomb Peak', ...MOUNTAIN.blackcombPeak, kind: 'peak', overview: true },
  { id: 'rendezvous', name: 'Rendezvous Lodge', ...MOUNTAIN.rendezvous, approachRadius: 23, overview: true },
  { id: 'cliff-overlook', name: 'Whistler Peak Cliff Lookout', ...ALPINE_CLIFF_START },
  { id: 'glacier-cave', name: 'Blackcomb Glacier Cave', ...GLACIER_CAVE_START },
  { id: 'crystal-hut', name: 'Crystal Hut', x: 4402.2, z: 575.8, approachRadius: 11 },
  { id: 'horstman-hut', name: 'Horstman Hut', x: 4957.7, z: 2346.5, approachRadius: 11 },
];

const view = (id, name, minX, minZ, maxX, maxZ) => ({ id, name, bounds: { minX, minZ, maxX, maxZ } });
const views = [
  view('whistler', 'Whistler Mountain', -3000, -380, 3150, 7750),
  view('blackcomb', 'Blackcomb Mountain', 140, -1100, 6300, 5010),
  view('roundhouse', 'Roundhouse & Whistler Peak', -760, 4510, 1290, 6350),
  view('symphony', 'Symphony & Flute Bowl', 400, 4950, 3500, 7850),
  view('seventh', '7th Heaven', 3370, 1920, 5310, 4720),
  view('glacier', 'Blackcomb Glacier', 4600, -170, 6350, 2540),
  view('village', 'Whistler & Upper Village', -630, -880, 940, 440),
  view('creekside', 'Creekside Village', -3120, 1650, -1870, 2580),
];

export function whistlerAtlasSettings(liftExitFor, terrain) {
  function section(def, direction) {
    const points = direction ? [...def.points].reverse() : def.points;
    const index = direction ? def.points.length - 1 : 0;
    const board = def.type === 'p2p' ? peakToPeakAccess(def, direction).board : def.type === 'surface'
      ? stationPoint(stationSite(def, index), 3.5, -3.5)
      : stationPoint(stationSite(def, index), 8.5, -17);
    return { ...def, points, board, exit: () => liftExitFor(def, direction) };
  }
  const lifts = LIFTS.map(def => {
    const lift = section(def, 0);
    if (def.type === 'p2p') lift.reverse = section(def, 1);
    return lift;
  });
  return {
    name: 'Whistler Blackcomb', bounds: WORLD, regionalBounds: terrain.regionalBounds, heightAt,
    lakes: mappedLakes(), curatedOverview: true,
    buildings: [...buildingData, ...lodgeFootprints],
    runs: RUNS, lifts, landmarks, views, source: new URL('../assets/maps/whistler-blackcomb-winter-2025-26.pdf', import.meta.url).href,
  };
}
