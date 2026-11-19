import { clamp, lerp, smoothstep } from './util.js';

export const STEVENS_OVERPASS_OSM = '167552492';

// Open surveyed channels near Hogsback and Skyline. The culverted reaches
// under the ski approaches stay covered.
export const STEVENS_CREEKS = [
  { points: [[-14,17.9],[-6.2,10.5],[10.3,-4],[7.9,-12.2],[7.3,-22.2],[8.4,-32.1]], width: 3.6, depth: 2.1 },
  { points: [[-35.8,-89.5],[-41.5,-134.3],[-65.3,-170.1]], width: 4.3, depth: 1.8 },
  { points: [[178.4,34.4],[171.2,25.7],[162.2,20.6],[143,15.8],[136.3,13.9]], width: 3.1, depth: 1.5 },
];

export const GEMINI_TRAVERSE = [[750.5,1834.8],[853.8,1795.6]];

function measureLine(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, len = Math.hypot(vx, vz);
  const t = clamp(((x - ax) * vx + (z - az) * vz) / (len * len), 0, 1);
  const px = ax + t * vx, pz = az + t * vz;
  const offset = ((x - px) * -vz + (z - pz) * vx) / len;
  return { t, px, pz, offset, distance: Math.hypot(x - px, z - pz) };
}

function creekCut(x, z, creek) {
  const { points, width, depth } = creek;
  let deepest = 0;
  for (let i = 1; i < points.length; i++) {
    const { t, distance } = measureLine(x, z, ...points[i - 1], ...points[i]);
    const from = i === 1 ? smoothstep(0, .7, t) : 1;
    const to = i === points.length - 1 ? 1 - smoothstep(.3, 1, t) : 1;
    deepest = Math.max(deepest, depth * (1 - smoothstep(.55, width, distance)) * from * to);
  }
  return deepest;
}

export function stevensHeightDetails() {
  return [
    { minX: -100, maxX: 250, minZ: -200, maxZ: 90, spacing: 2, adjust(x, z) {
      // Increase the rise along the center of the mapped rope tow.
      const tow = measureLine(x, z, 66.6, 8.8, 128.1, -24.9);
      const ramp = (tow.t - .5) * 4.8 * (1 - smoothstep(3.2, 16, tow.distance));
      return ramp - Math.max(...STEVENS_CREEKS.map(creek => creekCut(x, z, creek)));
    } },
    { minX: 520, maxX: 590, minZ: 1370, maxZ: 1440, spacing: 2, adjust(x, z) {
      const lateral = 1 - smoothstep(4.8, 9.5, Math.abs(x - 551.2));
      const crest = smoothstep(1387, 1396, z) * (1 - smoothstep(1396, 1400, z)) * .52;
      const down = smoothstep(1396, 1400, z) * (1 - smoothstep(1404, 1420, z)) * .77;
      return lateral * (crest - down);
    } },
    { minX: 740, maxX: 900, minZ: 1750, maxZ: 1870, spacing: 2, adjust(x, z, heightAt) {
      const line = measureLine(x, z, ...GEMINI_TRAVERSE[0], ...GEMINI_TRAVERSE[1]);
      const feather = smoothstep(.03, .23, line.t) * (1 - smoothstep(.80, .98, line.t));
      if (!feather || line.distance > 28) return 0;
      const benchWidth = 1 - smoothstep(4.25, 7.7, line.distance);
      const bench = heightAt(line.px, line.pz) - heightAt(x, z);
      const lengthwise = lerp(1.65, -1.65, smoothstep(.18, .78, line.t));
      const flatFloor = (bench - lengthwise) * benchWidth;
      const upslope = -line.offset;
      const rock = 4.2 * smoothstep(5.8, 9.6, upslope) * (1 - smoothstep(13, 28, upslope));
      return feather * (flatFloor + rock);
    } },
  ];
}
