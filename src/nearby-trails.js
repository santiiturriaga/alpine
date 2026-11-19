const reach = 46;
const cellSize = 256;
const coarseStride = 3;
const chunkStride = 16 * coarseStride;

function coarseChunks(samples) {
  const chunks = [];
  for (let start = 0; start < samples.length; start += chunkStride) {
    const end = Math.min(start + chunkStride, samples.length);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = start; i < end; i += coarseStride) {
      const { x, z } = samples[i];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    chunks.push({ start, end, minX, maxX, minZ, maxZ });
  }
  return chunks;
}

export function indexNearbyTrails(runs) {
  const grid = new Map();
  for (const run of runs) {
    if (!run.samples?.length) continue;
    const [left, top, right, bottom] = run.bounds;
    const minX = left - reach, maxX = right + reach, minZ = top - reach, maxZ = bottom + reach;
    const entry = { run, chunks: coarseChunks(run.samples), minX, maxX, minZ, maxZ };
    for (let x = Math.floor(minX / cellSize); x <= Math.floor(maxX / cellSize); x++) {
      let column = grid.get(x);
      if (!column) grid.set(x, column = new Map());
      for (let z = Math.floor(minZ / cellSize); z <= Math.floor(maxZ / cellSize); z++) {
        let cell = column.get(z);
        if (!cell) column.set(z, cell = []);
        cell.push(entry);
      }
    }
  }

  return (px, pz) => {
    const candidates = grid.get(Math.floor(px / cellSize))?.get(Math.floor(pz / cellSize));
    if (!candidates) return null;
    let bestRun = null, bestIndex = 0, bestD2 = Infinity;
    for (const { run, chunks, minX, maxX, minZ, maxZ } of candidates) {
      if (px < minX || px > maxX || pz < minZ || pz > maxZ) continue;
      const { samples } = run;
      let localD2 = Infinity, localI = 0;
      // Coarse points stay in their original order, so exactly tied samples
      // choose the same seed for the original fine search.
      for (const chunk of chunks) {
        const x = Math.max(0, chunk.minX - px, px - chunk.maxX);
        const z = Math.max(0, chunk.minZ - pz, pz - chunk.maxZ);
        if (x * x + z * z >= localD2) continue;
        for (let i = chunk.start; i < chunk.end; i += coarseStride) {
          const dx = samples[i].x - px, dz = samples[i].z - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 < localD2) { localD2 = d2; localI = i; }
        }
      }
      for (let i = Math.max(0, localI - 3); i <= Math.min(samples.length - 1, localI + 3); i++) {
        const dx = samples[i].x - px, dz = samples[i].z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < localD2) { localD2 = d2; localI = i; }
      }
      if (localD2 < bestD2) {
        bestRun = run;
        bestIndex = localI;
        bestD2 = localD2;
      }
    }
    const dist = Math.sqrt(bestD2);
    if (!bestRun || dist > reach) return null;
    return { run: bestRun, index: bestIndex, dist };
  };
}
