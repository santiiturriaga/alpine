import { DataTexture, LinearFilter, RedFormat, Vector3 } from 'three';
import { clamp, lerp } from './util.js';

const side = 192;
const spacing = 1.45;
const reach = side * spacing;
const gridKey = (x, z) => x * 65536 + z;
const trafficWindow = { value: new Vector3() };
const trafficTexture = { value: null };
let samplePressure = () => 0;

export const snowTrafficGLSL = `
  uniform sampler2D trafficSnow;
  uniform vec3 trafficWindow;
  float trackPressure(vec2 p) {
    vec2 uv = (p - trafficWindow.xy) / max(1.0, trafficWindow.z);
    float edge = min(min(uv.x, uv.y), min(1.0-uv.x, 1.0-uv.y));
    if (trafficWindow.z < 1.0 || edge <= 0.0) return 0.0;
    return textureLod(trafficSnow, uv, 0.0).r * smoothstep(0.0, .07, edge);
  }
`;

export function bindSnowTraffic(shader) {
  shader.uniforms.trafficSnow = trafficTexture;
  shader.uniforms.trafficWindow = trafficWindow;
}

export function compressSnow(x, z, surface) {
  if (surface.id === 'ground' || surface.id === 'ice') return surface;
  const pressure = samplePressure(x, z);
  if (pressure < .003) return surface;
  surface.powder *= 1 - .79 * pressure;
  surface.grip = lerp(surface.grip, .93, pressure * .65);
  surface.drag = lerp(surface.drag, 1.0, pressure * .82);
  if (surface.id === 'powder' && surface.powder < .49) surface.id = 'packed';
  return surface;
}

export function createSnowTraffic() {
  const pixels = new Uint8Array(side * side);
  const map = new DataTexture(pixels, side, side, RedFormat);
  map.minFilter = map.magFilter = LinearFilter;
  map.needsUpdate = true;
  trafficTexture.value = map;
  const cells = new Map();
  const recent = new WeakMap();
  let left = 0, top = 0, elapsed = 0, clock = 0, snowfall = 0;
  const read = (x, z) => pixels[clamp(z, 0, side - 1) * side + clamp(x, 0, side - 1)] / 255;

  samplePressure = (x, z) => {
    if (!trafficWindow.value.z) return 0;
    const u = x / spacing - left, v = z / spacing - top;
    const edge = Math.min(u, v, side - u, side - v);
    if (edge <= 0) return 0;
    const i = Math.floor(u - .5), j = Math.floor(v - .5);
    const tx = u - .5 - i, tz = v - .5 - j;
    const blend = clamp(edge / (side * .07), 0, 1);
    return lerp(lerp(read(i, j), read(i + 1, j), tx), lerp(read(i, j + 1), read(i + 1, j + 1), tx), tz)
      * blend * blend * (3 - 2 * blend);
  };

  function stamp(actor, x, z, amount) {
    const prev = recent.get(actor);
    recent.set(actor, { x, z, time: clock });
    if (!prev || clock - prev.time > .65) return;
    const dx = x - prev.x, dz = z - prev.z, distance = Math.hypot(dx, dz);
    if (distance < .20 || distance > 19) return;
    const segments = Math.ceil(distance / spacing);
    let lastKey;
    for (let i = 0; i <= segments; i++) {
      const ix = Math.floor((prev.x + i / segments * dx) / spacing);
      const iz = Math.floor((prev.z + i / segments * dz) / spacing);
      const key = gridKey(ix, iz);
      if (lastKey === key) continue;
      lastKey = key;
      const previous = cells.get(key);
      const strength = previous?.value ?? 0;
      cells.set(key, { ix, iz, value: strength + (1 - strength) * amount });
    }
  }

  function update(dt, player, visitors, climate, onGround) {
    clock += dt;
    elapsed += dt;
    snowfall += dt * climate.snowfall;
    if (elapsed < .24) return;
    const recovery = Math.exp(-elapsed * .0005 - snowfall * .021);
    elapsed = snowfall = 0;
    const { x, z } = player.pos;
    const centerX = Math.floor(x / spacing), centerZ = Math.floor(z / spacing);
    const moved = !trafficWindow.value.z || Math.abs(centerX - left - side / 2) > 21 || Math.abs(centerZ - top - side / 2) > 21;
    if (moved) {
      left = centerX - side / 2; top = centerZ - side / 2;
      trafficWindow.value.set(left * spacing, top * spacing, reach);
    }
    if (climate.season !== 'summer') {
      if (onGround && player.grounded && !player.crash && !player.footMode && player.surfaceType !== 'ice') {
        stamp(player, x, z, .11);
      }
      for (const guest of visitors) {
        if (guest.state !== 'skiing' || guest.speed < 2 || (guest.seed ?? guest.trafficSeed ?? .5) > climate.crowd) continue;
        if (Math.abs(guest.x - x) > reach * .65 || Math.abs(guest.z - z) > reach * .65) continue;
        stamp(guest, guest.x, guest.z, .093);
      }
    }
    if (!moved && !cells.size) return;
    pixels.fill(0);
    for (const [key, cell] of cells) {
      cell.value *= recovery;
      if (cell.value < .015 || cells.size > 12000) {
        cells.delete(key);
        continue;
      }
      const u = cell.ix - left, v = cell.iz - top;
      if (u >= 0 && u < side && v >= 0 && v < side) pixels[v * side + u] = Math.round(cell.value * 255);
    }
    map.needsUpdate = true;
  }
  return { update, get packedCells() { return cells.size; } };
}
