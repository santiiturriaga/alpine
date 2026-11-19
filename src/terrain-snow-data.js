// Shared by the single boot worker and its yielding main-thread fallback.
// This module deliberately uses explicit local imports: worker modules do not
// inherit the document's import map. Math and grid sampling stay DOM-free.
import { DataUtils } from '../vendor/three.module.js';
import { clamp, lerp, smoothstep, noise, noise2 } from './math.js';
import { triangleHeight, worldIndex, boxBlurGrid } from './terrain-grid.js';

export async function generateSnowData({ bounds: WORLD, heights, cover: landCover, mask, runs: RUNS },
  yieldFrame = () => Promise.resolve()) {
  const n = WORLD.grid, maskN = Math.sqrt(mask.length);
  async function buildSnowField(yieldFrame) {
    const data = new Uint8Array(maskN * maskN * 4);
    // A land-cover cell spans about 17 metres. Feather mapped forest edges
    // before packing coverage so a single cell cannot color an entire patch.
    const woodland = boxBlurGrid(Float32Array.from(landCover, kind => Number(kind === 10)), n, 1, 2);
    const gridScale = (n - 1) / maskN;
    for (let j = 0; j < maskN; j++) {
      if (j && j % 16 === 0) await yieldFrame();
      const z = WORLD.minZ + (j + .5) * WORLD.sizeZ / maskN;
      const gz = (j + .5) * gridScale;
      const row = Math.floor(gz) * n, tz = gz % 1;
      for (let i = 0; i < maskN; i++) {
        const x = WORLD.minX + (i + .5) * WORLD.sizeX / maskN;
        const gx = (i + .5) * gridScale;
        const gridIndex = row + Math.floor(gx), tx = gx % 1;
        const index = j * maskN + i, key = 4 * index;
        const piste = mask[index];
        const h = triangleHeight(heights, n, gx, gz);
        const drift = .5 + .5 * noise.fbm(x * .034, z * .027, 3);
        const scoured = noise2.fbm(x * .062 + z * .019, z * .024 - x * .009, 3);
        const wind = .5 + .5 * noise.fbm(x * .012 + 12, z * .014, 2);
        const crossing = Math.hypot(x - 481, z - 4855);
        const pad = 1 - smoothstep(23, 99, crossing);
        const powder = (.26 + .74 * smoothstep(.21, .78, drift)) * (1 - .88 * smoothstep(.18, .72, piste)) * (1 - pad);
        const scale = smoothstep(745, 1210, h) * (1 - pad) * (1 - .61 * powder);
        const ice = smoothstep(.285, .57, scoured + .205 * piste + .15 * wind)
          * smoothstep(.06, .71, .55 * piste + .67 * wind) * scale;
        data[key] = Math.round(255 * piste);
        data[key + 1] = Math.round(255 * powder);
        data[key + 2] = Math.round(255 * ice);
        const forest = lerp(lerp(woodland[gridIndex], woodland[gridIndex + 1], tx),
          lerp(woodland[gridIndex + n], woodland[gridIndex + n + 1], tx), tz);
        data[key + 3] = Math.round(255 * forest);
      }
    }
    return data;
  }

  async function buildGroomingMap(yieldFrame) {
    const data = new Uint16Array(maskN * maskN);
    const closest = new Float32Array(maskN * maskN).fill(Infinity);
    const dx = WORLD.sizeX / maskN, dz = WORLD.sizeZ / maskN;
    for (const [runIndex, run] of RUNS.entries()) {
      if (runIndex && runIndex % 32 === 0) await yieldFrame();
      if (run.gladed) continue;
      const reach = run.width * .5 + 2 * Math.max(dx, dz);
      for (let k = 1; k < run.points.length; k++) {
        const [ax, az] = run.points[k - 1], [bx, bz] = run.points[k];
        const vx = bx - ax, vz = bz - az;
        const length = Math.hypot(vx, vz);
        if (length === 0) continue;
        const inverseLength = 1 / length;
        const inverseLengthSquared = inverseLength * inverseLength;
        const reachSquared = reach * reach;
        const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - WORLD.minX) / dx));
        const iz0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - WORLD.minZ) / dz));
        const ix1 = Math.min(maskN - 1, Math.floor((Math.max(ax, bx) + reach - WORLD.minX) / dx));
        const iz1 = Math.min(maskN - 1, Math.floor((Math.max(az, bz) + reach - WORLD.minZ) / dz));
        for (let iz = iz0; iz <= iz1; iz++) {
          const z = WORLD.minZ + (iz + .5) * dz - az;
          for (let ix = ix0; ix <= ix1; ix++) {
            const index = iz * maskN + ix;
            if (mask[index] < .24) continue;
            const x = WORLD.minX + (ix + .5) * dx - ax;
            const t = clamp((x * vx + z * vz) * inverseLengthSquared, 0, 1);
            const distance = (x - t * vx) ** 2 + (z - t * vz) ** 2;
            if (distance > reachSquared || distance >= closest[index]) continue;
            closest[index] = distance;
            const across = (z * vx - x * vz) * inverseLength;
            data[index] = DataUtils.toHalfFloat(across);
          }
        }
      }
    }
    return data;
  }

  async function buildMountainShade(yieldFrame) {
    const size = 385, shade = new Uint8Array(size * size);
    // The sun vector's horizontal bearing in easting/southing coordinates.
    const horizontal = Math.hypot(.56, .715);
    const dx = -.56 / horizontal, dz = .715 / horizontal, slope = .415 / horizontal;
    const distances = [28, 45, 70, 110, 165, 235, 335, 460, 625, 840, 1120, 1500, 1950, 2450, 3100];
    const sample = (x, z) => triangleHeight(heights, n, ...worldIndex(x,z,WORLD));
    for (let j = 0; j < size; j++) {
      if (j && j % 16 === 0) await yieldFrame();
      const z = WORLD.minZ + (j + .5) * WORLD.sizeZ / size;
      for (let i = 0; i < size; i++) {
        const x = WORLD.minX + (i + .5) * WORLD.sizeX / size;
        const local = sample(x,z);
        let obstruction = -1;
        for (const distance of distances) {
          const tx = x + distance * dx, tz = z + distance * dz;
          if (tx < WORLD.minX || tx > WORLD.maxX || tz < WORLD.minZ || tz > WORLD.maxZ) break;
          obstruction = Math.max(obstruction, (sample(tx,tz)-local)/distance - slope);
        }
        shade[j * size + i] = Math.round(255 * (1 - smoothstep(-.018, .041, obstruction)));
      }
    }
    return shade;
  }

  return {
    snowField: await buildSnowField(yieldFrame),
    shade: await buildMountainShade(yieldFrame),
    grooming: await buildGroomingMap(yieldFrame),
  };
}
