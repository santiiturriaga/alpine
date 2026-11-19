// Bump the pack version when the snow generator or binary layout changes.
// Canvas stroke rasterization varies between browsers, so the locally drawn
// piste mask is part of the input digest rather than a packaged texture.
const fieldSize = 1536, shadeSize = 385, headerBytes = 40;
const fieldCells = fieldSize * fieldSize;
const shadeCells = shadeSize * shadeSize;
const channelOffset = headerBytes + 2 * fieldCells + shadeCells;

export async function snowInputDigest({ heights, cover, mask, bounds, runs }) {
  const layout = JSON.stringify([bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, bounds.grid,
    runs.map(r => [r.width, r.gladed, r.points])]);
  const parts = await Promise.all([heights, cover, mask, new TextEncoder().encode(layout)]
    .map(array => crypto.subtle.digest('SHA-256', array)));
  const bytes = new Uint8Array(parts.length * 32);
  parts.forEach((part, i) => bytes.set(new Uint8Array(part), i * 32));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export function whistlerSnowPackCacheMode(terrainUrl) {
  const connection = navigator.connection;
  if (typeof DecompressionStream === 'undefined' || !globalThis.crypto?.subtle || connection?.saveData
    || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType)) return null;
  // The required DEM gives a same-origin measurement. NetInfo's reported link
  // speed is too coarse to decide whether another multi-megabyte request fits.
  const transfer = performance.getEntriesByName(terrainUrl).at(-1);
  const fastTransfer = transfer?.transferSize > 65536
    && transfer.transferSize / Math.max(1, transfer.duration) >= 16000;
  return fastTransfer ? 'default' : 'only-if-cached';
}

export async function loadWhistlerSnowPack(signal, cache = 'default') {
  try {
    const url = new URL('../data/whistler-snow.bin.gz?v=3', import.meta.url);
    const response = await fetch(url, { signal, cache, mode: 'same-origin', priority: 'low' });
    if (!response.ok) return null;
    let buffer = await response.arrayBuffer();
    if (new DataView(buffer).getUint16(0) === 0x1f8b) {
      buffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    if (signal?.aborted || buffer.byteLength !== channelOffset + 3 * fieldCells) return null;
    const header = new DataView(buffer);
    if (header.getUint32(0) !== 0x57425333 || header.getUint16(4, true) !== fieldSize
      || header.getUint16(6, true) !== shadeSize) return null;
    return buffer;
  } catch {
    return null;
  }
}

export async function unpackWhistlerSnowPack(buffer, inputs) {
  const signature = new Uint8Array(buffer, 8, 32);
  const digest = await snowInputDigest(inputs).catch(() => null);
  if (!digest?.every((byte, index) => byte === signature[index])) return null;
  const { mask } = inputs;
  const powder = new Uint8Array(buffer, channelOffset, fieldCells);
  const ice = new Uint8Array(buffer, channelOffset + fieldCells, fieldCells);
  const forest = new Uint8Array(buffer, channelOffset + 2 * fieldCells, fieldCells);
  const snowField = new Uint8Array(fieldCells * 4);
  const rowStride = 4 * fieldSize;
  for (let y = 0; y < fieldSize; y++) {
    let powderDelta = 0, forestDelta = 0;
    for (let x = 0; x < fieldSize; x++) {
      const i = y * fieldSize + x, k = 4 * i;
      // Integrating the row predictor recovers the difference from the pixel
      // above. Adding that pixel undoes the vertical part of the predictor.
      powderDelta = (powderDelta + powder[i]) & 255;
      forestDelta = (forestDelta + forest[i]) & 255;
      const above = k - rowStride;
      snowField[k] = Math.round(mask[i] * 255);
      snowField[k + 1] = powderDelta + (y ? snowField[above + 1] : 0);
      snowField[k + 2] = ice[i];
      snowField[k + 3] = forestDelta + (y ? snowField[above + 3] : 0);
    }
  }
  return { snowField,
    grooming: new Uint16Array(buffer, headerBytes, fieldCells).slice(),
    shade: new Uint8Array(buffer, headerBytes + 2 * fieldCells, shadeCells).slice(), execution: 'pack' };
}
