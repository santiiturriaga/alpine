import * as THREE from 'three';

function layer(bytes, cols, rows, bounds) {
  const texture = new THREE.DataTexture(bytes, cols, rows, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
  return { texture, limits: new THREE.Vector4(bounds.minX, bounds.minZ, width, depth),
    sample(x, z, out) {
      // The source stores area averages at cell centers, matching filtered GPU texels.
      const gx = Math.max(0, Math.min(cols - 1, (x - bounds.minX) / width * cols - .5));
      const gz = Math.max(0, Math.min(rows - 1, (z - bounds.minZ) / depth * rows - .5));
      const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
      const a = 4 * (j * cols + i), b = a + (i + 1 < cols ? 4 : 0);
      const step = j + 1 < rows ? 4 * cols : 0;
      for (let c = 0; c < out.length; c++) {
        const top = bytes[a+c] * (1-u) + bytes[b+c] * u;
        const bottom = bytes[a+step+c] * (1-u) + bytes[b+step+c] * u;
        out[c] = top * (1-v) + bottom * v;
      }
      return out;
    } };
}

export async function loadForestSurvey(baseURL, config) {
  if (!config.forest.survey) return null;
  const response = await fetch(new URL(config.forest.survey, baseURL));
  if (!response.ok) throw new Error(`Forest survey returned HTTP ${response.status}`);
  const buffer = await response.arrayBuffer(), header = new DataView(buffer);
  if (buffer.byteLength < 12 || header.getUint32(0) !== 0x464f5232) throw new Error('Invalid forest survey header');
  const [w, h, rw, rh] = [4, 6, 8, 10].map(i => header.getUint16(i, true));
  const size = w * h * 4;
  if (!w || !h || !rw || !rh || 12 + size + rw * rh * 4 !== buffer.byteLength) {
    throw new Error('Invalid forest survey dimensions');
  }
  return {
    local: layer(new Uint8Array(buffer, 12, size), w, h, config.bounds),
    region: layer(new Uint8Array(buffer, 12 + size), rw, rh, config.backdrop.bounds),
  };
}
