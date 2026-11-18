const STRIDE = 22;
const CELL = 36;
const TRANSFER = 28;
const GRADE_COST = { green: 1, blue: 1.06, black: 1.19, double: 1.35, unrated: 1.07 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const cellKey = (x, z) => x * 65536 + z;
const fromPair = ([x, z]) => ({ x, z });

class Queue {
  items = [];
  add(node, cost) {
    const items = this.items, entry = { node, cost };
    let i = items.length;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= cost) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = entry;
  }
  take() {
    const items = this.items, first = items[0], last = items.pop();
    if (!items.length) return first;
    let i = 0;
    while (i * 2 + 1 < items.length) {
      let child = i * 2 + 1;
      if (child + 1 < items.length && items[child + 1].cost < items[child].cost) child++;
      if (items[child].cost >= last.cost) break;
      items[i] = items[child];
      i = child;
    }
    items[i] = last;
    return first;
  }
}

export class TrailRouter {
  constructor({ runs, lifts, heightAt, isOpen }) {
    this.heightAt = heightAt;
    this.isOpen = isOpen;
    this.cells = new Map();
    this.ends = new Map();
    this.count = 0;
    for (const run of runs) this.addRun(run);
    for (const lift of lifts) {
      this.addLift(lift);
      if (lift.reverse) this.addLift(lift.reverse);
    }
  }

  node(point, source, joinRadius = TRANSFER) {
    const { x, z } = point, y = this.heightAt(x, z);
    const key = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
    const node = { x, z, y, id: this.count++, source, joinRadius, edges: [] };
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(node);
    return node;
  }

  addRun(run) {
    if (!run.points?.length || /ascent|chairlift line|tow line|upload|download/i.test(run.name)) return;
    const points = run.points.map(fromPair);
    const height = p => this.heightAt(p.x, p.z);
    const hike = run.kind === 'hike';
    const reversed = height(points[0]) < height(points.at(-1));
    if (reversed && !hike) points.reverse();
    const id = `${run.kind === 'bike' || hike ? 'summer-run' : 'run'}:${run.id}`;
    const start = this.node(points[0], id);
    let previous = start;
    const factor = GRADE_COST[run.difficulty] ?? 1;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = distance(a, b);
      if (length < .05) continue;
      const steps = Math.ceil(length / STRIDE);
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const next = this.node({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, id);
        const d = length / steps, dy = next.y - previous.y;
        previous.edges.push({ to: next, cost: d * factor + Math.max(0, dy) * 3 });
        if (hike || (run.kind !== 'bike' && dy >= -.45 - d * .17)) {
          next.edges.push({ to: previous, cost: d * factor + Math.max(0, -dy) * 6 });
        }
        previous = next;
      }
    }
    this.ends.set(id, hike ? [start, previous] : previous);
  }

  addLift(lift) {
    if (!lift.board || !lift.exit) return;
    const id = `lift:${lift.id}`;
    const exit = typeof lift.exit === 'function' ? lift.exit() : lift.exit;
    const a = this.node(lift.board, id, 70), b = this.node(exit, id, 70);
    const length = lift.points.reduce((sum, p, i, points) =>
      i ? sum + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0, 0);
    a.edges.push({ to: b, cost: length * 1.14 + 145, lift: { ...lift, exit } });
    if (!this.ends.has(id)) this.ends.set(id, a);
  }

  nearby(p, radius, filter) {
    const x = Math.floor(p.x / CELL), z = Math.floor(p.z / CELL), reach = Math.ceil(radius / CELL);
    const candidates = new Map();
    for (let i = x - reach; i <= x + reach; i++) for (let j = z - reach; j <= z + reach; j++) {
      for (const node of this.cells.get(cellKey(i, j)) ?? []) {
        const d = distance(p, node);
        if (d > radius || !filter(node, d)) continue;
        const list = candidates.get(node.source) ?? [];
        list.push({ node, d });
        list.sort((a, b) => a.d - b.d);
        if (list.length > 3) list.pop();
        candidates.set(node.source, list);
      }
    }
    return [...candidates.values()].flat().sort((a, b) => a.d - b.d);
  }

  open(a, b, maxGrade = null) {
    const length = distance(a, b);
    if (length < .05) return true;
    const steps = Math.max(1, Math.ceil(length / .9));
    let previous = this.heightAt(a.x, a.z);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = this.heightAt(x, z), change = y - previous;
      if (maxGrade != null && (change > .65 + length / steps * maxGrade || change < -1.15 - length / steps * .85)) return false;
      if (this.isOpen && !this.isOpen(x, y, z)) return false;
      previous = y;
    }
    return true;
  }

  groundPath(start, target, proximity = 0) {
    const length = distance(start, target);
    if (length <= proximity) return [start];
    const stop = 1 - proximity / length;
    const approach = { x: start.x + (target.x - start.x) * stop, z: start.z + (target.z - start.z) * stop };
    if (this.open(start, approach, .56)) return [start, approach];
    const stride = length < 38 ? 2.5 : 5;
    const heap = new Queue();
    const nodes = new Map();
    const first = { ...start, ix: 0, iz: 0, cost: 0 };
    const limit = length * 1.2 + 23;
    heap.add(first, distance(start, target));
    nodes.set(0, first);
    while (heap.items.length && nodes.size < 1800) {
      const { node } = heap.take();
      if (node.closed || nodes.get(cellKey(node.ix, node.iz)) !== node) continue;
      node.closed = true;
      const gap = distance(node, target);
      if (gap <= proximity || (gap < stride * 2.2 && this.open(node, target, .56))) {
        const path = gap <= proximity ? [] : [target];
        for (let p = node; p; p = p.previous) path.push(p);
        path.reverse();
        const direct = [path[0]];
        for (let i = 0; i < path.length - 1;) {
          let j = Math.min(i + 10, path.length - 1);
          while (j > i + 1 && !this.open(path[i], path[j], .56)) j--;
          direct.push(path[j]);
          i = j;
        }
        return direct;
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const ix = node.ix + dx, iz = node.iz + dz, key = cellKey(ix, iz);
        const cost = node.cost + Math.hypot(dx, dz) * stride;
        if (cost > limit || (nodes.get(key)?.cost ?? Infinity) <= cost) continue;
        const next = { x: start.x + ix * stride, z: start.z + iz * stride, ix, iz, cost, previous: node };
        if (!this.open(node, next, .56)) continue;
        nodes.set(key, next);
        heap.add(next, cost + distance(next, target));
      }
    }
    return null;
  }

  plan(start, feature) {
    const endsForFeature = this.ends.get(feature.id);
    const end = Array.isArray(endsForFeature)
      ? [...endsForFeature].sort((a, b) => distance(start, b) - distance(start, a))[0]
      : endsForFeature;
    const target = end ?? feature.destination;
    if (!target) return null;
    const isTrail = feature.kind === 'run';
    const proximity = feature.approachRadius ?? 0;
    if (!isTrail && distance(start, target) < 155) {
      const direct = this.groundPath(start, target, proximity);
      if (direct) return [{ points: direct }];
    }
    const ends = new Map();
    if (end) ends.set(end.id, [end]);
    else if (!isTrail) {
      const targetY = this.heightAt(target.x, target.z);
      for (const { node } of this.nearby(target, 180, (n, d) => Math.abs(n.y - targetY) < 24 + d * .55).slice(0, 14)) {
        const path = this.groundPath(node, target, proximity);
        if (path) ends.set(node.id, path);
        if (ends.size >= 5) break;
      }
    }
    if (!ends.size) return null;
    const paths = new Map(), heap = new Queue(), finished = { id: -1, x: target.x, z: target.z };
    const update = (node, cost, previous, edge) => {
      if ((paths.get(node.id)?.cost ?? Infinity) <= cost) return;
      paths.set(node.id, { cost, previous, edge });
      heap.add(node, cost + distance(node, target));
    };
    const startY = this.heightAt(start.x, start.z);
    const nearby = this.nearby(start, 175, (n, d) => Math.abs(n.y - startY) < 6 + d * .48);
    for (const { node, d } of nearby.slice(0, 44)) {
      if (d >= .4 && !this.open(start, node, .48)) continue;
      update(node, (d + 4) * 1.6, null, { points: [start, node] });
      if (paths.size >= 11) break;
    }
    if (!paths.size) for (const { node, d } of nearby.slice(0, 5)) {
      const points = this.groundPath(start, node);
      if (points) update(node, (d + 4) * 1.8, null, { points });
    }
    while (heap.items.length) {
      const { node, cost } = heap.take(), link = paths.get(node.id);
      if (cost > link.cost + distance(node, target) + .001) continue;
      if (node === finished) {
        const edges = [];
        for (let p = link; p; p = p.previous) edges.push(p.edge);
        return edges.reverse();
      }
      for (const edge of node.edges) {
        const { to, cost, lift } = edge;
        if (lift) {
          update(to, link.cost + cost, link, { points: lift.points.map(fromPair), lift });
          continue;
        }
        if (!('ground' in edge)) {
          edge.ground = this.open(node, to) ? [node, to] : this.groundPath(node, to);
        }
        if (!edge.ground) continue;
        const extra = edge.ground.length > 2
          ? edge.ground.slice(1).reduce((sum, p, i) => sum + distance(p, edge.ground[i]), 0) - distance(node, to) : 0;
        update(to, link.cost + cost + extra, link, { points: edge.ground });
      }
      const transfers = node.transfers ??= this.nearby(node, Math.max(node.joinRadius, 70), (n, d) =>
        n.source !== node.source && d <= Math.max(node.joinRadius, n.joinRadius) &&
        n.y - node.y <= 2 + d * (node.joinRadius > TRANSFER || n.joinRadius > TRANSFER ? .31 : .19))
        .filter(({ node: to, d }) => d < 1.1 || this.open(node, to, .43));
      for (const { node: to, d } of transfers) update(to, link.cost + d * 1.2 + 6, link, { points: [node, to] });
      const finalPath = ends.get(node.id);
      if (finalPath) update(finished, link.cost + distance(node, target) * 1.6, link, { points: finalPath });
    }
    return null;
  }
}
