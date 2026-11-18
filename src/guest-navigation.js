import { RUNS } from './worlddata.js';
import { heightAt } from './terrain.js';
import { clamp } from './util.js';

const CELL = 14;
const GRADES = { green: 0, blue: 1, red: 2, unrated: 0, black: 2, double: 3 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const key = (x, z) => x * 32768 + z;

export function guestClear(x, z, pad, colliders, y = Infinity) {
  for (const c of colliders) {
    if (c.minY !== undefined && y !== Infinity && (y + 1.5 < c.minY || y > c.maxY)) continue;
    const dx = x - c.x, dz = z - c.z;
    if (c.hw === undefined) {
      if (dx * dx + dz * dz < (c.r + pad) ** 2) return false;
    } else {
      const a = Math.cos(c.rot), b = Math.sin(c.rot);
      if (Math.abs(dx * a + dz * b) < c.hw + pad && Math.abs(dz * a - dx * b) < c.hd + pad) return false;
    }
  }
  return true;
}

// Along-track distances are precomputed. The tangent turns gently through each
// vertex while the actual position stays on the checked corridor.
export function makeGuestPath(points) {
  const nodes = [];
  let length = 0;
  for (const p of points) {
    const previous = nodes.at(-1);
    const step = previous ? distance(previous, p) : 0;
    if (previous && step < .04) continue;
    length += step;
    nodes.push({ x: p.x, z: p.z, d: length, y: p.y ?? heightAt(p.x, p.z) });
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], a = nodes[Math.max(i - 1, 0)], b = nodes[Math.min(i + 1, nodes.length - 1)];
    const la = distance(a, n), lb = distance(n, b);
    const ax = la ? (n.x - a.x) / la : 0, az = la ? (n.z - a.z) / la : 0;
    const bx = lb ? (b.x - n.x) / lb : 0, bz = lb ? (b.z - n.z) / lb : 0;
    n.heading = Math.atan2(ax + bx, az + bz);
    n.bend = la && lb ? clamp((1 - ax * bx - az * bz) / .67, 0, 1) : 0;
  }
  return { nodes, length, minY: Math.min(...nodes.map(n => n.y)) };
}

export function turnDelta(from, to) {
  const a = to - from;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function sampleGuestPath(path, d, out) {
  const { nodes, length } = path;
  let lo = 0, hi = nodes.length - 1;
  d = clamp(d, 0, length);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = nodes[lo], b = nodes[hi], t = (d - a.d) / (b.d - a.d || 1);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.heading = a.heading + turnDelta(a.heading, b.heading) * t;
  out.bend = a.bend + (b.bend - a.bend) * t;
  return out;
}

class MinHeap {
  items = [];

  push(id, cost) {
    const heap = this.items, item = { id, cost };
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= cost) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = item;
  }

  pop() {
    const heap = this.items, best = heap[0], last = heap.pop();
    if (!heap.length) return best;
    let i = 0;
    while (i * 2 + 1 < heap.length) {
      let child = i * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
      if (heap[child].cost >= last.cost) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
    return best;
  }
}

export function createGuestNavigation(grid) {
  const vertices = [], cells = new Map();
  const checked = (a, b, pad, maxSlope, floor = heightAt) => {
    const length = distance(a, b), steps = Math.max(1, Math.ceil(length / 2));
    const nearby = grid.query((a.x + b.x) * .5, (a.z + b.z) * .5, length * .5 + 7);
    let lastY = floor(a.x, a.z);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = floor(x, z);
      if (!guestClear(x, z, pad, nearby, y) || Math.abs(y - lastY) > length / steps * maxSlope + .17) return false;
      lastY = y;
    }
    return true;
  };
  const transfer = (a, b, { pad = .52, maxSlope = .63, floor = heightAt } = {}) => {
    const open = (p, q) => checked(p, q, pad, maxSlope, floor);
    const withFloor = p => ({ x: p.x, z: p.z, y: floor(p.x, p.z) });
    if (open(a, b)) return [withFloor(a), withFloor(b)];
    // Detour around fences, lift pylons and furniture using the same colliders
    // as the player. Preserve the exact endpoints, including door thresholds.
    const stride = distance(a, b) < 22 ? 1 : 2.5;
    const bounds = Math.ceil(distance(a, b) / stride) + 10;
    const points = new Map(), heap = new MinHeap();
    const start = { ...a, ix: 0, iz: 0, cost: 0, prev: null };
    points.set(0, start);
    heap.push(0, distance(a, b));
    while (heap.items.length && points.size < 2000) {
      const current = points.get(heap.pop().id);
      if (current.closed) continue;
      current.closed = true;
      if (distance(current, b) < stride * 3.5 && open(current, b)) {
        const path = [b];
        for (let p = current; p; p = p.prev) path.push(p);
        path.reverse();
        const reduced = [withFloor(path[0])];
        for (let i = 0; i < path.length - 1;) {
          let j = Math.min(path.length - 1, i + 12);
          while (j > i + 1 && !open(path[i], path[j])) j--;
          reduced.push(withFloor(path[j]));
          i = j;
        }
        return reduced;
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const ix = current.ix + dx, iz = current.iz + dz;
        if (Math.abs(ix) > bounds || Math.abs(iz) > bounds) continue;
        const id = key(ix, iz), known = points.get(id);
        const x = a.x + ix * stride, z = a.z + iz * stride;
        const cost = current.cost + stride * Math.hypot(dx, dz);
        if (known?.cost <= cost || !open(current, { x, z })) continue;
        points.set(id, { x, z, ix, iz, cost, prev: current });
        heap.push(id, cost + distance({ x, z }, b));
      }
    }
    return null;
  };
  const adjacent = (p, radius, visit) => {
    const x = Math.floor(p.x / CELL), z = Math.floor(p.z / CELL), r = Math.ceil(radius / CELL);
    for (let i = x - r; i <= x + r; i++) for (let j = z - r; j <= z + r; j++) {
      const bucket = cells.get(key(i, j));
      if (bucket) for (const n of bucket) visit(n);
    }
  };
  const addEdge = (a, b, crossover = false) => {
    const d = distance(a, b), dy = b.y - a.y;
    if (d < .05) {
      a.edges.push({ to: b.id, cost: 1, crossover });
      b.edges.push({ to: a.id, cost: 1, crossover });
      return;
    }
    // Reversals are useful across flat accesses. A route may climb short
    // traverses, but it cannot send skiers up a downhill piste.
    if (dy <= .75 + d * .13) a.edges.push({ to: b.id, cost: d + 2 * Math.max(0, dy), crossover });
    if (-dy <= .75 + d * .13) b.edges.push({ to: a.id, cost: d + 2 * Math.max(0, -dy), crossover });
  };
  for (const run of RUNS) {
    if (!run.samples?.length || run.difficulty === 'double' || /ascent|chairlift line|tow line|upload|download/i.test(run.name)) continue;
    let previous = null;
    const grade = GRADES[run.difficulty] ?? 0;
    for (const s of run.samples) {
      const nearby = grid.query(s.x, s.z, 14);
      let node;
      for (const offset of [0, .15, -.15, .30, -.30]) {
        const x = s.x + s.nx * run.width * offset, z = s.z + s.nz * run.width * offset;
        const y = heightAt(x, z);
        if (!guestClear(x, z, 1.25, nearby, y)) continue;
        // The edge clearance test catches the trunks between map samples.
        if (previous && !checked(previous, { x, z }, 1.25, 1.15)) continue;
        node = { x, z, y, run, grade, id: vertices.length, edges: [] };
        break;
      }
      if (!node) { previous = null; continue; }
      if (previous) addEdge(previous, node);
      previous = node;
      vertices.push(node);
      const bucket = key(Math.floor(node.x / CELL), Math.floor(node.z / CELL));
      if (!cells.has(bucket)) cells.set(bucket, []);
      cells.get(bucket).push(node);
    }
  }
  for (const a of vertices) {
    const nearest = new Map();
    adjacent(a, CELL, b => {
      if (distance(a, b) > CELL || a.run === b.run || Math.abs(a.y - b.y) > 6) return;
      const d = distance(a, b);
      if ((nearest.get(b.run)?.d ?? Infinity) > d) nearest.set(b.run, { b, d });
    });
    for (const { b } of nearest.values()) {
      if (b.id <= a.id || !checked(a, b, 1.25, .65)) continue;
      addEdge(a, b, true);
    }
  }
  const anchors = (p, radius) => {
    const list = [], seen = new Map();
    adjacent(p, radius, n => {
      const d = distance(p, n);
      if (d > radius || Math.abs(n.y - p.y) > 7 + d * .62) return;
      const contenders = seen.get(n.run) ?? [];
      contenders.push({ n, d });
      seen.set(n.run, contenders);
    });
    for (const contenders of seen.values()) {
      contenders.sort((a, b) => a.d - b.d);
      list.push(...contenders.slice(0, 3));
    }
    list.sort((a, b) => a.d - b.d);
    const routes = new Set(), connections = [];
    for (const { n, d } of list.slice(0, 38)) {
      if (connections.length >= 10) break;
      if (routes.has(n.run)) continue;
      const points = checked(p, n, .75, .65) ? [p, n] : d < 45 ? transfer(p, n) : null;
      if (!points) continue;
      routes.add(n.run);
      connections.push({ n, points, cost: d * 1.32 });
    }
    return connections;
  };
  const laps = (top, bottom, upper, lower) => {
    const paths = [], minimum = distance(upper, lower) * .8;
    const high = upper.y + 45, low = lower.y - 25;
    const extent = 600 + distance(upper, lower) * .25;
    const minX = Math.min(upper.x, lower.x) - extent, maxX = Math.max(upper.x, lower.x) + extent;
    const minZ = Math.min(upper.z, lower.z) - extent, maxZ = Math.max(upper.z, lower.z) + extent;
    const tryPath = (grade, used) => {
      const targets = new Map(bottom.filter(a => a.n.grade <= grade).map(a => [a.n.id, a]));
      const roots = new Map(), previous = new Int32Array(vertices.length).fill(-1);
      const costs = new Float64Array(vertices.length).fill(Infinity), heap = new MinHeap();
      let best = Infinity, finish;
      for (const from of top) {
        if (from.n.grade > grade) continue;
        roots.set(from.n.id, from);
        costs[from.n.id] = from.cost;
        heap.push(from.n.id, from.cost);
      }
      while (heap.items.length) {
        const { id, cost } = heap.pop(), a = vertices[id];
        if (cost >= best) break;
        if (cost > costs[id]) continue;
        const target = targets.get(id);
        if (target && cost + target.cost < best) {
          best = cost + target.cost;
          finish = target;
        }
        for (const edge of a.edges) {
          const b = vertices[edge.to];
          if (b.grade > grade || b.y < low || b.y > high || b.x < minX || b.x > maxX || b.z < minZ || b.z > maxZ) continue;
          const travel = edge.cost * (used.has(b.run.name) ? 2.65 : 1);
          const join = edge.crossover ? 4.6 : 0;
          const next = cost + travel + join;
          if (next >= costs[b.id]) continue;
          previous[b.id] = id;
          costs[b.id] = next;
          heap.push(b.id, next);
        }
      }
      if (!finish) return null;
      const trail = [];
      for (let id = finish.n.id; id !== -1; id = previous[id]) trail.push(vertices[id]);
      trail.reverse();
      const approach = roots.get(trail[0].id);
      const points = [...approach.points, ...trail, ...finish.points.slice().reverse()];
      const path = makeGuestPath(points);
      if (path.length < minimum || path.length > minimum * 4.2) return null;
      const named = new Map();
      for (let i = 1; i < trail.length; i++) {
        const { run } = trail[i];
        if (run.named && !/access|connector/i.test(run.name) && trail[i - 1].run === run) {
          named.set(run.name, (named.get(run.name) ?? 0) + distance(trail[i - 1], trail[i]));
        }
      }
      const names = [...named.entries()].filter(([, length]) => length > 32).sort((a, b) => b[1] - a[1]).map(([name]) => name);
      if (!names.length) return null;
      return { ...path, name: names[0], names, skill: ['green', 'blue', 'black'][grade] };
    };
    for (let grade = 0; grade <= 2; grade++) {
      const used = new Set();
      for (let option = 0; option < 2; option++) {
        const path = tryPath(grade, used);
        if (!path) break;
        for (const name of path.names) used.add(name);
        if (paths.some(other => other.skill === path.skill && other.name === path.name)) break;
        paths.push(path);
      }
    }
    return paths;
  };
  return { transfer, anchors, laps };
}
