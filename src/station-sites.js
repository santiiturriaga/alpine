import { LIFTS, FITZSIMMONS, PEAK_TO_PEAK, VILLAGE_GONDOLA_UPPER } from './worlddata.js';
import { smoothstep } from './util.js';
import { LODGE_FRAME, LODGE_CAFE, LODGE_TERRACE, LODGE_ANNEX, ROUNDHOUSE_OLYMPIC_SITE,
  blackcombPeakTerminalSite, lodgePoint, whistlerPeakTerminalSite } from './roundhouse-site.js';

// Transfer stages share a surveyed point at the centre of the building. Give
// each drive its own bay on the inbound side of that point.
const transferBays = new Map([
  ['way-1525849949:upper', 15], ['way-29362437:base', 15],
  ['way-1525850290:upper', 15], ['way-29512562:base', 15],
  ['way-1525851044:upper', 15], [VILLAGE_GONDOLA_UPPER + ':base', 15],
]);

export function stationSite(lift, index) {
  const base = index === 0;
  const [surveyX, surveyZ] = lift.points[index];
  const [nextX, nextZ] = lift.points[base ? 1 : index - 1];
  const yaw = Math.atan2(nextX - surveyX, nextZ - surveyZ);
  const offset = lift.id === PEAK_TO_PEAK && base ? 18.5
    : lift.id === 'way-1525850290' && base ? 4
      : transferBays.get(lift.id + ':' + (base ? 'base' : 'upper')) ?? 0;
  return {
    x: surveyX + Math.sin(yaw) * offset,
    z: surveyZ + Math.cos(yaw) * offset,
    yaw,
    surveyX,
    surveyZ,
  };
}

export function stationPoint(site, x, z) {
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  return { x: site.x + x * c + z * s, z: site.z - x * s + z * c };
}

// The survey points follow the ropeway. Passengers use the entrances and
// walk out toward the transfer plazas at each end.
export function peakToPeakAccess(lift, blackcomb) {
  if (blackcomb) {
    const site = blackcombPeakTerminalSite(lift);
    const wall = site.width / 2, heading = site.yaw + Math.PI / 2;
    return {
      board: { ...stationPoint(site, wall + site.rampLength + 2.3, site.entryZ), heading: heading - Math.PI },
      unload: { ...stationPoint(site, wall - .9, site.entryZ), heading },
      threshold: { ...stationPoint(site, wall + .30, site.entryZ), heading },
    };
  }
  const site = whistlerPeakTerminalSite(lift);
  const front = site.depth / 2;
  return {
    board: { ...stationPoint(site, site.entryX, front + site.canopyDepth + 2), heading: site.yaw + Math.PI },
    unload: { ...stationPoint(site, site.entryX, front - .9), heading: site.yaw },
    threshold: { ...stationPoint(site, site.entryX, front + .48), heading: site.yaw },
  };
}

export function ropeOffset(lift) {
  if (lift.id === FITZSIMMONS) return 3.85;
  if (lift.type === 'p2p') return 3.5;
  return lift.type === 'chair' ? 1.9 : 1.6;
}

// Cut and fill only at the loading apron. Sample one datum for each shared
// transfer so the intervening footpath stays level while the main slope
// outside the ramps remains the original elevation model.
export function createStationGrading(sampleOriginal) {
  const cellSize = 64, cells = new Map();
  function apron(site, minX, maxX, minZ, maxZ, feather, elevation, approach = null) {
    const radius = Math.hypot(Math.max(-minX, maxX), Math.max(-minZ, maxZ)) + feather;
    const datum = elevation ?? sampleOriginal(site.surveyX, site.surveyZ);
    const pad = { ...site, c: Math.cos(site.yaw), s: Math.sin(site.yaw), minX, maxX, minZ, maxZ, feather, datum, approach };
    for (let z = Math.floor((site.z - radius) / cellSize); z <= Math.floor((site.z + radius) / cellSize); z++) {
      for (let x = Math.floor((site.x - radius) / cellSize); x <= Math.floor((site.x + radius) / cellSize); x++) {
        const key = x * 512 + z;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(pad);
      }
    }
  }

  for (const lift of LIFTS.filter(({ aerial }) => aerial)) {
    for (const i of [0, lift.points.length - 1]) {
      const site = stationSite(lift, i);
      if (lift.id === PEAK_TO_PEAK) {
        if (i > 0) apron(site, -11.8, 11.8, -24, 17, 18);
        else {
          const entry = whistlerPeakTerminalSite(lift);
          const front = entry.depth / 2;
          // The walk-in apron meets the constructed deck, whose survey point
          // lies at the terrace grading and terrain LOD transition.
          const level = sampleOriginal(entry.surveyX, entry.surveyZ) + entry.datumOffset + entry.deck + .67;
          // The broad pad falls gradually toward the plaza. Keep the survey
          // point behind it at the existing ropeway elevation.
          apron(entry, entry.entryX - 7.8, entry.entryX + 7.4, front - 3.3, 55, 6.4, level,
            { landing: front + 8.2, slope: .10 });
        }
        continue;
      }
      if (lift.id === FITZSIMMONS) apron(site, -8.8, 9.8, -11, 13, 18);
      // The Crystal Ridge unload straddles a major terrain-tile seam. Extend
      // its local apron across both rows of the shared low-resolution edge.
      else if (lift.id === 'way-244981854' && i > 0) apron(site, -17, 17, -13, 16, 17);
      else if (lift.type === 'chair') apron(site, -7.3, 7.3, -10, 12.5, 17);
      else apron(site, -8.5, lift.name === 'Creekside Gondola' && i === 0 ? 15 : 9.3, -12, 15, 19);
    }
  }
  // The two floors must still read independently. The short foot of the
  // Roundhouse stair is graded to the lodge datum at the lower plaza.
  const lodgeDatum = sampleOriginal(LODGE_FRAME.datumX, LODGE_FRAME.datumZ) - .15;
  const cafeApproach = lodgePoint(LODGE_CAFE.x, LODGE_CAFE.front + LODGE_CAFE.steps * LODGE_CAFE.tread + .7);
  const stairFoot = lodgePoint(LODGE_TERRACE.stairX, LODGE_TERRACE.stairBottom);
  const annexFront = lodgePoint(LODGE_ANNEX.doorX, LODGE_ANNEX.z + LODGE_ANNEX.depth / 2);
  const annexCenter = lodgePoint(LODGE_ANNEX.x, LODGE_ANNEX.z);
  apron({ ...cafeApproach, yaw: LODGE_FRAME.yaw }, -4.2, 4.2, -.6, 1.8, 3.4, lodgeDatum);
  apron({ ...stairFoot, yaw: LODGE_FRAME.yaw }, -2.1, 2.1, -1.4, 2.2, 5.5, lodgeDatum);
  apron({ ...annexCenter, yaw: LODGE_FRAME.yaw }, -LODGE_ANNEX.width/2, LODGE_ANNEX.width/2,
    -LODGE_ANNEX.depth/2, LODGE_ANNEX.depth/2, 4, lodgeDatum + LODGE_ANNEX.floor - .09);
  apron({ ...annexFront, yaw: LODGE_FRAME.yaw }, -2.55, 2.55, -2, 4.4, 5.2, lodgeDatum + LODGE_ANNEX.floor - .025);
  const cliff = ROUNDHOUSE_OLYMPIC_SITE;
  apron({ ...cliff, yaw: 0 }, -.25, 1.4, 4.1, 9.5, 5.5, sampleOriginal(cliff.x, cliff.z) + .12);

  return (x, z, elevation) => {
    const pads = cells.get(Math.floor(x / cellSize) * 512 + Math.floor(z / cellSize));
    if (!pads) return elevation;
    let total = 0, elevationSum = 0, strongest = 0;
    for (const pad of pads) {
      const dx = x - pad.x, dz = z - pad.z;
      const u = dx * pad.c - dz * pad.s, v = dx * pad.s + dz * pad.c;
      const distance = Math.hypot(Math.max(0, pad.minX - u, u - pad.maxX), Math.max(0, pad.minZ - v, v - pad.maxZ));
      if (distance >= pad.feather) continue;
      let weight = 1 - smoothstep(0, pad.feather, distance);
      let target = pad.datum;
      if (pad.approach) {
        weight *= smoothstep(6.1, 9, Math.hypot(x - pad.surveyX, z - pad.surveyZ));
        target -= Math.max(0, v - pad.approach.landing) * pad.approach.slope;
      }
      // An adjacent apron can blend the approaches without tilting the core
      // under another terminal's sleepers and pier shoes.
      const priority = weight ** 6;
      elevationSum += target * priority;
      total += priority;
      strongest = Math.max(strongest, weight);
    }
    return total ? elevation + (elevationSum / total - elevation) * strongest : elevation;
  };
}
