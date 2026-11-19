import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';

const stationClearance = 2.87;
const cableClearance = 4.35;
const stationApproach = 8;

export function liftPoint(point) {
  return Array.isArray(point) ? { x:point[0], z:point[1] } : { x:point.x, z:point.z };
}

export function liftFrame(p, q) {
  const heading = Math.atan2(q.x - p.x, q.z - p.z);
  const sin = Math.sin(heading), cos = Math.cos(heading);
  return { ...p, heading, world: (x, z) => ({ x:p.x + x * cos + z * sin, z:p.z - x * sin + z * cos }) };
}

function sampleRoute(points) {
  let length = 0;
  const levels = [0];
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    levels.push(length);
  }
  function at(distance) {
    const i = lowerIndex(levels, distance), a = points[i], b = points[i + 1];
    const t = (distance - levels[i]) / (levels[i + 1] - levels[i]);
    return liftFrame({ x:lerp(a.x, b.x, t), z:lerp(a.z, b.z, t) },
      { x:lerp(a.x, b.x, t) + b.x - a.x, z:lerp(a.z, b.z, t) + b.z - a.z });
  }
  function project(point) {
    let best = { distance:0, gap:Infinity };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const gap = Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t);
      if (gap < best.gap) best = { distance:lerp(levels[i], levels[i + 1], t), gap };
    }
    return best;
  }
  return { length, levels, at, project };
}

function lowerIndex(distances, distance) {
  let lo = 0, hi = distances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (distance < distances[mid]) hi = mid;
    else lo = mid;
  }
  return lo;
}

function stationY(frame, ground, gauge, isTop, carrierDrop, shoulder) {
  let highest = -Infinity;
  // Include the turnaround as well as the inbound and outbound grip lanes.
  for (let i = 0; i <= 10; i++) {
    const angle = i * Math.PI / 10;
    for (const edge of [-shoulder,0,shoulder]) {
      const radius=gauge+edge;
      const p = frame.world(radius * Math.cos(angle), radius * Math.sin(angle) * (isTop ? 1 : -1));
      highest = Math.max(highest, ground.heightAt(p.x, p.z));
    }
  }
  for (const x of [-gauge-shoulder,-gauge,gauge,gauge+shoulder]) {
    const p = frame.world(x, isTop ? -1.8 : 1.8);
    highest = Math.max(highest, ground.heightAt(p.x, p.z));
  }
  return highest + carrierDrop;
}

function sag(span) {
  return Math.min(3.9, span * span * .00023);
}

function clearTerminalPoint(anchor, towardLine, gauge, shoulder, ground, roofHeightNear, maxTrim) {
  const frame = liftFrame(anchor, towardLine);
  const room = Math.min(maxTrim, Math.hypot(anchor.x - towardLine.x, anchor.z - towardLine.z) - 5);
  const radius = Math.hypot(shoulder, .66) + .20;
  const clear = (x, z) => {
    const p = frame.world(x, z);
    return roofHeightNear(p.x, p.z, radius) <= ground.heightAt(p.x, p.z) + .18;
  };
  // Keep the turnaround and first few meters at boarding height. If a
  // separate mapped building overlaps them, find the nearest clear site
  // along the same lift alignment while retaining the first tower.
  const clearAt = offset => {
    for (let i = 0; i <= 12; i++) {
      const angle = i * Math.PI / 12;
      if (!clear(gauge * Math.cos(angle), offset - gauge * Math.sin(angle))) return false;
    }
    for (let z = 1; z <= stationApproach; z++) {
      if (!clear(gauge, offset + z) || !clear(-gauge, offset + z)) return false;
    }
    return true;
  };
  if (clearAt(0)) return anchor;
  for (let n = 2; n <= 24; n += 2) {
    if (n <= room && clearAt(n)) return frame.world(0, n);
    if (clearAt(-n)) return frame.world(0, -n);
  }
  return anchor;
}

function addSupportDistances(route, towers) {
  const explicit = towers.map(liftPoint).map(route.project).filter(p => p.gap < 20)
    .map(p => p.distance).sort((a, b) => a - b);
  const candidates = [0, ...route.levels.slice(1, -1), ...explicit, route.length].sort((a, b) => a - b);
  const stops = [0];
  for (const distance of candidates.slice(1, -1)) {
    if (distance - stops.at(-1) > 7 && distance < route.length - 7) stops.push(distance);
  }
  stops.push(route.length);
  const segments = [0];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i], gap = b - a;
    const span = explicit.length ? 138 : 78;
    const intervals = Math.ceil(gap / span);
    for (let n = 1; n <= intervals; n++) segments.push(lerp(a, b, n / intervals));
  }
  // Hold each chair or cabin to its loading deck through the first and last span.
  const throat = Math.min(route.length * .18, 13);
  if (segments[1] >= throat + 8) segments.splice(1, 0, throat);
  if (segments.at(-2) <= route.length - throat - 8) segments.splice(segments.length - 1, 0, route.length - throat);
  return segments;
}

export function buildLiftProfile(def, ground, gauge, shoulder, surface, carpet, roofHeightNear) {
  const points = def.points.map(liftPoint).filter((p, i, points) => !i ||
    Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > .015);
  if (!surface && roofHeightNear && !def.sharedLine) {
    const maxTrim = points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].z - points[1].z) * .5 - 2.5 : 24;
    const first = def.board ? points[0] : clearTerminalPoint(points[0], points[1], gauge, shoulder, ground, roofHeightNear, maxTrim);
    const last = def.unload ? points.at(-1) : clearTerminalPoint(points.at(-1), points.at(-2), gauge, shoulder, ground, roofHeightNear, maxTrim);
    points[0] = first;
    points[points.length - 1] = last;
  }
  const route = sampleRoute(points);
  const stationDrop = def.kind === 'gondola' ? 3.62 : stationClearance;
  const bottom = route.at(0), top = route.at(route.length);
  const supports = surface ? route.levels : addSupportDistances(route, def.towers ?? []);
  const edges = supports.map(route.at);
  const heights = edges.map((frame, i) => {
    if (surface) return ground.heightAt(frame.x, frame.z) + (carpet ? .09 : 1.55);
    if (i === edges.length - 1 && def.upperCableElevation != null) return def.upperCableElevation;
    if (i === 0 || i === edges.length - 1) return stationY(frame, ground, gauge, i > 0, stationDrop, shoulder);
    return ground.heightAt(frame.x, frame.z) + 6.65;
  });

  const terrainRail = (frame) => Math.max(...[-gauge - shoulder, -gauge, gauge, gauge + shoulder]
    .map(lateral => frame.world(lateral, 0)).map(p => ground.heightAt(p.x, p.z)));
  const sweepRadius = Math.hypot(shoulder, 1.5) + .55;
  const roofRail = (frame) => {
    const a = frame.world(gauge, 0), b = frame.world(-gauge, 0);
    return Math.max(roofHeightNear(a.x, a.z, sweepRadius), roofHeightNear(b.x, b.z, sweepRadius));
  };
  if (!surface) {
    for (let i = 1; i < supports.length; i++) {
      const start = supports[i - 1], span = supports[i] - start;
      for (let j = 1; j <= Math.ceil(span); j++) {
        const fraction = j / Math.ceil(span), distance = start + span * fraction;
        const terminal = Math.min(distance, route.length - distance);
        const frame = route.at(distance);
        const groundY = terrainRail(frame);
        const clearance = lerp(stationDrop - .24, Math.max(cableClearance, stationDrop + 1.05), smoothstep(0, 12, terminal));
        const roofY = roofHeightNear && terminal >= stationApproach ? roofRail(frame) : -Infinity;
        const requiredY = Math.max(groundY + clearance, roofY + stationDrop + .55);
        const deficit = requiredY + 4 * sag(span) * fraction * (1 - fraction)
          - lerp(heights[i - 1], heights[i], fraction);
        if (deficit <= 0) continue;
        if (i > 1 && i < supports.length - 1) {
          heights[i - 1] += deficit;
          heights[i] += deficit;
        } else if (i === 1) {
          heights[i] += deficit / fraction;
        } else if (fraction < 1) {
          heights[i - 1] += deficit / (1 - fraction);
        }
      }
    }
  }

  const horizontal = route.length;
  const sampleCount = Math.max(8, Math.ceil(horizontal / 1.25));
  const samples = [], distances = [0];
  let length = 0, clearance = Infinity;
  // Include tower anchors exactly so cable tubes meet the sheave grooves.
  const samplesAt = [...new Set([...supports, ...Array.from({ length:sampleCount + 1 }, (_, i) => horizontal * i / sampleCount)])]
    .sort((a, b) => a - b);
  for (const distance of samplesAt) {
    const frame = route.at(distance);
    const index = lowerIndex(supports, distance), span = supports[index + 1] - supports[index];
    const f = (distance - supports[index]) / span;
    const y = surface ? ground.heightAt(frame.x, frame.z) + (carpet ? .09 : 1.55)
      : lerp(heights[index], heights[index + 1], f) - 4 * sag(span) * f * (1 - f);
    const point = new THREE.Vector3(frame.x, y, frame.z);
    const previous = samples.at(-1);
    if (previous) {
      length += point.distanceTo(previous.point);
      distances.push(length);
    }
    const offset = new THREE.Vector3(Math.cos(frame.heading), 0, -Math.sin(frame.heading));
    samples.push({ point, offset });
    clearance = Math.min(clearance, y - (surface ? ground.heightAt(frame.x, frame.z) : terrainRail(frame)));
  }
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  function at(t, position, tangent, lane = gauge) {
    const distance = clamp(t, 0, 1) * length;
    const segment = lowerIndex(distances, distance), a = samples[segment], b = samples[segment + 1];
    const f = (distance - distances[segment]) / (distances[segment + 1] - distances[segment] || 1);
    p0.copy(a.point).addScaledVector(a.offset, lane);
    p1.copy(b.point).addScaledVector(b.offset, lane);
    position.lerpVectors(p0, p1, f);
    if (tangent) tangent.subVectors(p1, p0).normalize();
    return position;
  }
  bottom.y = heights[0];
  top.y = heights.at(-1);
  return { bottom, top, samples, distances, length, at, horizontal, clearance,
    towers:edges.slice(1, -1).map((frame, i) => ({ ...frame, y:heights[i + 1] })) };
}
