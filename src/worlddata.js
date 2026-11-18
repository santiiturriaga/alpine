import { areaData, liftData, runData } from '../data/osm-whistler.js';
import { landmarks, resortBounds } from '../data/geography.js';

export const WORLD = {
  ...resortBounds,
  get sizeX() { return this.maxX - this.minX; },
  get sizeZ() { return this.maxZ - this.minZ; },
};

export const MOUNTAIN = Object.fromEntries(
  Object.entries(landmarks).map(([key, [x, z, elevation]]) => [key, { x, z, elevation }]),
);

export const DIFFICULTY = {
  green:   { label: 'GREEN', color: '#2faa63', map: '#2f9e60' },
  blue:    { label: 'BLUE', color: '#2e7fe0', map: '#2f73c4' },
  black:   { label: 'BLACK', color: '#e9f3f7', map: '#20272c' },
  double:  { label: 'DOUBLE BLACK', color: '#f3f8fa', map: '#0f1418' },
  unrated: { label: 'UNRATED', color: '#bdcad0', map: '#6c7981' },
};

export const FITZSIMMONS = 'way-47941929';
export const PEAK_TO_PEAK = 'way-32774598';
export const VILLAGE_GONDOLA_UPPER = 'way-29166965';
export const PEAK_EXPRESS = 'way-32775430';
export const HARMONY_EXPRESS = 'way-32775428';
// South side of the unload terrace, facing the lodge and the connection plaza.
export const ROUNDHOUSE_START = { x: 477.5, z: 4874, heading: 3.09, holdAtUnload: true };
export const VILLAGE_START = { x: 3.5, z: -21, heading: -.075 };
export const COME_ALONG_START = { x: 3160.825, z: 527.701, heading: -2.482, holdAtUnload: true };
export const FINISHES = [
  { ...MOUNTAIN.village, title: 'Whistler Village', run: 'way/1174890337' },
  { ...MOUNTAIN.upperVillage, title: 'Upper Village', run: 'way/359277947' },
  { ...MOUNTAIN.creekside, title: 'Creekside', run: 'way/474638482' },
];

export function mountainAt(x, z) {
  // The Fitzsimmons Valley runs southeast between the two mountains.
  return x > 470 + z * 0.56 ? 'Blackcomb' : 'Whistler';
}

export const RUNS = runData.map((run) => ({
  ...run,
  name: run.name?.startsWith('Peak To Creek,') ? 'Peak to Creek – Upper' : run.name ?? 'Connector',
  named: !!run.name,
  // OSM provides centerlines. Width is a visual/gameplay estimate in metres.
  width: run.gladed ? 12 : run.name?.match(/access|connector|traverse/i) ? 11
    : run.difficulty === 'green' ? 24 : run.difficulty === 'blue' ? 30 : 23,
  mountain: mountainAt(...run.points[Math.floor(run.points.length / 2)]),
}));
export const PISTE_AREAS = areaData;

const liftsWithCable = new Set(['chair_lift', 'gondola', 'p2p']);
const surfaceLifts = new Set(['magic_carpet', 't-bar']);
export const LIFTS = liftData.map((lift) => ({
  ...lift,
  type: lift.type === 'chair_lift' ? 'chair'
    : surfaceLifts.has(lift.type) ? 'surface' : lift.type,
  surfaceType: surfaceLifts.has(lift.type) ? lift.type : undefined,
  aerial: liftsWithCable.has(lift.type),
  access: lift.id === 'way-682523542' ? 'private' : 'public',
  rideable: (liftsWithCable.has(lift.type) || surfaceLifts.has(lift.type)) && lift.id !== 'way-682523542',
  speed: lift.type === 'p2p' ? 6.7 : lift.id === FITZSIMMONS ? 5
    : lift.type === 'gondola' ? 5.5 : lift.type === 'magic_carpet' ? .68
      : lift.type === 't-bar' ? 2.45 : (lift.seats >= 4 ? 4.7 : 2.8),
}));

export const LODGES = [
  { id: 'roundhouse', name: 'Roundhouse Lodge', x: 483.5, z: 4798, rot: 0.07, size: [70, 13, 54], type: 'summit' },
  { id: 'rendezvous', name: 'Rendezvous Lodge', ...MOUNTAIN.rendezvous, rot: 0.45, size: [35, 10, 22], type: 'summit' },
];

const STASHES = [
  { name: 'Black Diamond', trail: 'Wild Card', t: 0.63 },
  { name: 'Glacier Glass', trail: 'Wolverine Trees', t: 0.64 },
  { name: 'Hollow Heart', trail: 'Little Cub', t: 0.56 },
  { name: 'Green Ice', trail: 'Coyote Trees', t: 0.52 },
  { name: 'Amber Ice', trail: "Dusty's Descent", t: 0.46 },
];
export const CRYSTALS = STASHES.flatMap(({ trail, ...stash }, i) => {
  const matches = RUNS.filter((run) => run.name === trail).sort((a, b) => b.points.length - a.points.length);
  return matches.length ? [{ ...stash, id: String(i), run: matches[0].id }] : [];
});

export function runFromSource(source, name) {
  return RUNS.find((run) => run.sources.includes(source) && (!name || run.name === name));
}

export function initWorldData(runs=RUNS) {
  for (const run of runs) {
    if (run.samples) continue;
    const points = run.points;
    let dist = 0;
    const samples = [{ x: points[0][0], z: points[0][1], dist }];
    for (let i = 1; i < points.length; i++) {
      const [x, z] = points[i - 1];
      const [ex, ez] = points[i];
      const dx = ex - x, dz = ez - z;
      const length = Math.hypot(dx, dz);
      if (length === 0) continue;
      const segments = Math.ceil(length / 8);
      for (let j = 1; j <= segments; j++) {
        const f = j / segments;
        samples.push({ x: x + dx * f, z: z + dz * f, dist: dist + length * f });
      }
      dist += length;
    }
    for (let i = 0; i < samples.length; i++) {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const tx = (b.x - a.x) / length, tz = (b.z - a.z) / length;
      Object.assign(samples[i], { tx, tz, nx: -tz, nz: tx });
    }
    run.length = dist;
    run.samples = samples;
    const xs = points.map(([x]) => x), zs = points.map(([, z]) => z);
    run.bounds = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  }
}

export function runPointAt(runOrId, t) {
  const run = typeof runOrId === 'string' ? RUNS.find((r) => r.id === runOrId) : runOrId;
  if (!run?.samples?.length) return null;
  const dist = Math.min(1, Math.max(0, t)) * run.length;
  let lo = 0, hi = run.samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (run.samples[mid].dist <= dist) lo = mid;
    else hi = mid;
  }
  const a = run.samples[lo], b = run.samples[hi];
  const f = (dist - a.dist) / (b.dist - a.dist);
  const tx = a.tx + (b.tx - a.tx) * f, tz = a.tz + (b.tz - a.tz) * f;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, tx, tz, nx: -tz, nz: tx };
}

export function startPose() {
  return ROUNDHOUSE_START;
}
