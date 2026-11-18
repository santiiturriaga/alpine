import { createMapRelief, drawMapRelief } from './map-relief.js';

const STYLES = {
  green: { text: 'Easiest', ink: '#177141', symbol: 'circle' },
  blue: { text: 'Intermediate', ink: '#09579b', symbol: 'square' },
  black: { text: 'Most difficult', ink: '#1f2c38', symbol: 'diamond' },
  double: { text: 'Expert only', ink: '#1f2c38', symbol: 'double', dash: [4, 2] },
  unrated: { text: 'Unrated', ink: '#63787b', dash: [2, 2] },
  hike: { text: 'Hiking trail', ink: '#703971', dash: [1, 3] },
  lift: { text: 'Lift', ink: '#9a422c', dash: [6, 3] },
  landmark: { text: 'Landmark', ink: '#344b55' },
  peak: { text: 'Summit', ink: '#344b55' },
};
for (const difficulty of ['green', 'blue', 'black', 'double', 'unrated']) {
  STYLES[`bike-${difficulty}`] = { ...STYLES[difficulty], dash: [7, 2] };
}
const INK = '#203741';
const GOLD = '#df8209';
const MAX_ZOOM = 14;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toPoint = ([x, z]) => ({ x, z });

function pathLength(points) {
  return points.reduce((sum, [x, z], i) => i ? sum + Math.hypot(x - points[i - 1][0], z - points[i - 1][1]) : 0, 0);
}

function extent(points, pad = 0) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
}

function isIn(point, bounds) {
  return point.x > bounds.minX && point.x < bounds.maxX && point.z > bounds.minZ && point.z < bounds.maxZ;
}

function intersects(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function linePath(points, closed = false) {
  const path = new Path2D();
  path.moveTo(...points[0]);
  for (const point of points.slice(1)) path.lineTo(...point);
  if (closed) path.closePath();
  return path;
}

function lineDistance(x, z, points) {
  let minimum = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    minimum = Math.min(minimum, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return minimum;
}

function metric(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} km` : `${Math.round(value)} m`;
}

function lineFeatures(runs, lifts) {
  const runLines = runs.filter(run => run.points?.length > 1).map(run => {
    const difficulty = STYLES[run.difficulty] ? run.difficulty : 'unrated';
    return {
      id: `${run.kind === 'bike' || run.kind === 'hike' ? 'summer-run' : 'run'}:${run.id}`, name: run.name || 'Connector',
      named: run.named ?? !!run.name, section: run.section ?? run.mountain, kind: 'run', activity: run.kind,
      style: run.kind === 'bike' ? `bike-${difficulty}` : run.kind === 'hike' ? 'hike' : difficulty,
      description: run.kind === 'bike' ? `Bike trail · ${STYLES[difficulty].text}` : null,
      points: run.points, length: pathLength(run.points),
    };
  });
  const liftsLines = lifts.filter(lift => lift.points?.length > 1).map(lift => ({
    id: `lift:${lift.id}`, source: lift.id, name: lift.name, kind: 'lift', style: 'lift',
    points: lift.points, length: pathLength(lift.points), named: true, destination: lift.board ?? toPoint(lift.points[0]),
    approachRadius: lift.board ? 0 : 8, description: lift.rideable === false ? 'Private lift' : 'Lift · base station',
  }));
  return [...runLines, ...liftsLines].map(feature => ({
    ...feature, badge: STYLES[feature.style],
    bounds: extent(feature.points, 1), path: linePath(feature.points),
  }));
}

export function mappedAtlasSettings({ mountain, config, runs, ground, lifts }) {
  const inBounds = position => isIn(position, ground.bounds);
  const liftsById = new Map(lifts.map(lift => [lift.def.id, lift]));
  const base = liftsById.get(config.startLift) ?? lifts[0];
  const mappedLifts = config.lifts.map(def => {
    const lift = liftsById.get(def.id);
    return { ...def, board: lift?.boardPose, exit: lift?.exitPose };
  });
  const landmarks = (config.landmarks ?? []).map(({ point, ...landmark }) => ({ ...landmark, ...toPoint(point) }))
    .filter(inBounds);
  for (const { id, name, points } of config.buildings ?? []) {
    if (!name || !points?.length || !/lodge|ski school|warming|restaurant/i.test(name)) continue;
    const x = points.reduce((sum, [x]) => sum + x, 0) / points.length;
    const z = points.reduce((sum, [, z]) => sum + z, 0) / points.length;
    if (inBounds({ x, z })) landmarks.push({ id, name, x, z, approachRadius: 21 });
  }
  if (base) landmarks.push({ id: 'resort-base', name: `${mountain.label} Base`, ...base.boardPose });
  const sections = new Map();
  for (const run of runs) {
    if (!run.section) continue;
    if (!sections.has(run.section)) sections.set(run.section, []);
    sections.get(run.section).push(...run.points);
  }
  const views = [...sections].map(([name, points]) => ({ id: name, name, bounds: extent(points, 210) }));
  if (base) views.push({ id: 'base', name: 'Base area', bounds: extent(
    lifts.filter(lift => Math.hypot(lift.boardPose.x - base.boardPose.x, lift.boardPose.z - base.boardPose.z) < 550)
      .map(lift => [lift.boardPose.x, lift.boardPose.z]), 250,
  ) });
  const { href, summerHref } = mountain.atlas ?? {};
  const summerLifts = config.summerLifts ?? (config.id === 'crystal-mountain' ? ['mt-rainier-gondola']
    : config.id === 'snoqualmie' ? ['silver-fir-express', 'pacific-crest'] : []);
  return { name: mountain.label, bounds: ground.bounds, heightAt: ground.heightAt,
    landmarks, views, runs, lifts: mappedLifts, roads: config.roads ?? [], buildings: config.buildings ?? [],
    summerRoutes: config.summerRoutes ?? [], summerLifts: mappedLifts.filter(lift => summerLifts.includes(lift.id)), summerSource: summerHref,
    source: href ?? null };
}

export class ResortMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.viewport = canvas.parentElement;
    this.screen = $('map-screen');
    this.viewSelect = $('map-view');
    this.findSelect = $('map-landmark');
    this.title = $('map-feature-name');
    this.description = $('map-feature-details');
    this.badge = $('map-feature-badge');
    this.pointers = new Map();
    this.zoom = 1;
    this.bindControls();
    new ResizeObserver(() => this.scheduleDraw()).observe(this.viewport);
    document.fonts?.ready.then(() => this.scheduleDraw());
  }

  configure(settings, route) {
    this.settings = settings;
    this.route = route;
    this.winterLines = lineFeatures(settings.runs, settings.lifts);
    this.summerLines = settings.summerRoutes?.length ? lineFeatures(settings.summerRoutes, settings.summerLifts) : null;
    this.features = new Map([...this.winterLines, ...this.summerLines ?? []].map(feature => [feature.id, feature]));
    this.findSelect.replaceChildren(new Option('Choose a destination', ''));
    this.addLandmarks(settings.landmarks ?? []);
    this.roads = (settings.roads ?? []).filter(road => road.points?.length > 1)
      .map(road => ({ path: linePath(road.points), bounds: extent(road.points, 1) }));
    this.buildings = (settings.buildings ?? []).filter(building => building.points?.length > 2)
      .map(building => ({ path: linePath(building.points, true), bounds: extent(building.points, 1) }));
    $('map-resort-name').textContent = settings.name;
    this.configureLayers(false);
    if (route) route.change = () => {
      this.updateInfo();
      this.scheduleDraw();
    };
  }

  configureLayers(summer) {
    this.summer = summer;
    const settings = this.settings;
    this.lines = summer ? this.summerLines : this.winterLines;
    const points = this.lines.flatMap(feature => feature.points);
    for (const { x, z } of this.landmarks) points.push([x, z]);
    this.overview = { id: 'all', name: 'Entire resort', bounds: points.length ? extent(points, 230) : settings.bounds };
    const sections = new Map();
    if (summer) for (const feature of this.lines) {
      if (!feature.section) continue;
      if (!sections.has(feature.section)) sections.set(feature.section, []);
      sections.get(feature.section).push(...feature.points);
    }
    const views = summer ? [...sections].map(([name, points]) => ({ id: name, name, bounds: extent(points, 210) })) : settings.views ?? [];
    this.views = new Map([this.overview, ...views].map(view => [view.id, view]));
    this.viewSelect.replaceChildren(...[...this.views.values()].map(view => new Option(view.name, view.id)));
    this.addOptions('Lifts', this.lines.filter(feature => feature.kind === 'lift'));
    this.addOptions('Trails', this.lines.filter(feature => feature.kind === 'run' && feature.named));
    $('map-title').textContent = summer ? 'Summer trail map' : 'Trail map';
    const legend = this.screen.querySelector('.trail-key');
    legend.classList.toggle('summer-hike', summer && this.lines.some(feature => feature.activity === 'hike'));
    legend.classList.toggle('summer-bike', summer && this.lines.some(feature => feature.activity === 'bike'));
    const source = $('atlas-original');
    const reference = summer ? settings.summerSource ?? settings.source : settings.source;
    source.hidden = !reference;
    if (reference) source.href = reference;
    this.byStyle = Object.fromEntries(Object.keys(STYLES).map(style => [
      style, this.lines.filter(feature => feature.style === style),
    ]));
    const available = feature => feature?.kind === 'landmark' || this.lines.includes(feature);
    if (!available(this.selected)) this.selected = null;
    this.findSelect.value = this.selected?.id ?? '';
    this.route?.setSummer(summer, available(this.route?.destination));
    this.view = this.overview;
    this.baseValues = null;
    this.reset();
    this.updateInfo();
  }

  setSeason(season) {
    const summer = !!this.summerLines && season === 'summer';
    if (this.settings && summer !== this.summer) this.configureLayers(summer);
  }

  addLandmarks(landmarks) {
    const selected = this.findSelect.value;
    for (const landmark of landmarks) {
      const id = `point:${landmark.id}`, style = landmark.kind === 'peak' ? 'peak' : 'landmark';
      this.features.set(id, {
        ...landmark, id, kind: 'landmark', style, badge: STYLES[style], named: true,
        destination: landmark.arrival ?? landmark, approachRadius: landmark.approachRadius ?? 5,
        bounds: extent([[landmark.x, landmark.z]], 1),
      });
    }
    this.landmarks = [...this.features.values()].filter(feature => feature.kind === 'landmark');
    this.addOptions('Landmarks', this.landmarks);
    this.findSelect.value = selected;
    this.baseValues = null;
    this.scheduleDraw();
  }

  setDestination(id, player = this.player) {
    const feature = typeof id === 'string' ? this.features.get(id) ?? this.features.get(`point:${id}`) : id;
    if (!feature || !this.route) return false;
    this.choose(feature);
    const ready = this.route.setDestination(feature, player?.pos ?? player);
    this.updateInfo();
    this.scheduleDraw();
    return ready;
  }

  addOptions(label, features) {
    const existing = [...this.findSelect.querySelectorAll('optgroup')].find(group => group.label === label);
    if (!features.length) { existing?.remove(); return; }
    const counts = new Map();
    for (const { name } of features) counts.set(name, (counts.get(name) ?? 0) + 1);
    const group = existing ?? document.createElement('optgroup');
    group.label = label;
    group.replaceChildren();
    for (const feature of [...features].sort((a, b) => a.name.localeCompare(b.name))) {
      const suffix = counts.get(feature.name) > 1
        ? [feature.section, metric(feature.length ?? 0)].filter(Boolean).join(' · ') : '';
      group.append(new Option(suffix ? `${feature.name} · ${suffix}` : feature.name, feature.id));
    }
    if (!existing) this.findSelect.append(group);
  }

  bindControls() {
    $('map-zoom-in').addEventListener('click', () => this.zoomAt(this.zoom * 1.45));
    $('map-zoom-out').addEventListener('click', () => this.zoomAt(this.zoom / 1.45));
    $('map-fit').addEventListener('click', () => this.reset());
    $('map-locate').addEventListener('click', () => this.locate());
    $('map-route-start').addEventListener('click', () => this.setDestination(this.selected));
    $('map-route-clear').addEventListener('click', () => this.route?.setDestination(null));
    this.viewSelect.addEventListener('change', () => {
      this.view = this.views.get(this.viewSelect.value) ?? this.overview;
      this.reset();
    });
    this.findSelect.addEventListener('change', () => this.choose(this.features.get(this.findSelect.value), true));
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const p = this.localPointer(event);
      this.zoomAt(this.zoom * Math.exp(-clamp(event.deltaY, -250, 250) * .003), p.x, p.z);
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.canvas.focus({ preventScroll: true });
      this.canvas.setPointerCapture(event.pointerId);
      const p = this.localPointer(event);
      this.pointers.set(event.pointerId, { ...p, origin: p });
      if (this.pointers.size > 1) for (const item of this.pointers.values()) item.drag = true;
    });
    this.canvas.addEventListener('pointermove', event => {
      const current = this.localPointer(event), previous = this.pointers.get(event.pointerId);
      if (!previous) return this.setHover(this.hit(current));
      const before = [...this.pointers.values()];
      const drag = previous.drag || Math.hypot(current.x - previous.origin.x, current.z - previous.origin.z) > 5;
      if (!drag) return;
      this.setHover(null);
      this.canvas.classList.add('dragging');
      this.pointers.set(event.pointerId, { ...current, origin: previous.origin, drag });
      const after = [...this.pointers.values()];
      if (after.length === 1) this.pan(current.x - previous.x, current.z - previous.z);
      else if (after.length === 2) {
        const span = ([a, b]) => Math.hypot(a.x - b.x, a.z - b.z);
        const mid = ([a, b]) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
        const a = mid(before), b = mid(after);
        this.zoomAt(this.zoom * span(after) / Math.max(1, span(before)), a.x, a.z);
        this.pan(b.x - a.x, b.z - a.z);
      }
    });
    const release = event => {
      const p = this.pointers.get(event.pointerId);
      if (event.type === 'pointerup' && p && !p.drag) {
        this.setHover(null);
        this.choose(this.hit(this.localPointer(event), event.pointerType === 'touch' ? 17 : 9));
      }
      this.pointers.delete(event.pointerId);
      if (!this.pointers.size) this.canvas.classList.remove('dragging');
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) this.canvas.addEventListener(event, release);
    this.canvas.addEventListener('pointerleave', () => this.setHover(null));
    this.screen.addEventListener('keydown', event => {
      if (event.target.matches('select,input') && event.code !== 'Escape' && event.code !== 'Tab') {
        event.stopPropagation();
        return;
      }
      if (event.target === this.canvas && (event.code === 'Enter' || event.code === 'Space')) {
        const feature = this.hover ?? this.hit({ x: this.viewport.clientWidth / 2, z: this.viewport.clientHeight / 2 });
        if (feature) this.choose(feature);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const actions = {
        ArrowLeft: () => this.pan(75, 0), ArrowRight: () => this.pan(-75, 0),
        ArrowUp: () => this.pan(0, 75), ArrowDown: () => this.pan(0, -75),
        Equal: () => this.zoomAt(this.zoom * 1.4), NumpadAdd: () => this.zoomAt(this.zoom * 1.4),
        Minus: () => this.zoomAt(this.zoom / 1.4), NumpadSubtract: () => this.zoomAt(this.zoom / 1.4),
        Home: () => this.reset(), Digit0: () => this.reset(),
      };
      if (!actions[event.code]) return;
      event.preventDefault();
      event.stopPropagation();
      actions[event.code]();
    }, true);
  }

  localPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * this.viewport.clientWidth / Math.max(1, rect.width),
      z: (event.clientY - rect.top) * this.viewport.clientHeight / Math.max(1, rect.height),
    };
  }

  update(player) {
    this.player = player;
    $('map-locate').disabled = !player;
    if (this.settings && !this.relief) this.relief = createMapRelief(this.settings);
    this.scheduleDraw();
  }

  updateInfo() {
    const selected = this.selected;
    const state = this.route;
    this.title.textContent = selected?.name ?? 'Choose a destination';
    this.description.textContent = selected
      ? [selected.description ?? selected.badge.text, selected.section, selected.length && metric(selected.length)].filter(Boolean).join(' · ')
      : 'Select a trail, lift or landmark on the map.';
    this.badge.dataset.symbol = selected?.badge.symbol ?? selected?.style ?? '';
    this.badge.style.color = selected?.badge.ink ?? '';
    const destination = state?.destination;
    $('map-route-start').disabled = !selected || !state || (destination === selected && state.active);
    $('map-route-clear').hidden = !destination;
    $('map-route-message').textContent = destination && state.message ? `${destination.name} · ${state.message}` : '';
    $('route-guidance').hidden = !destination || !state.message;
    $('route-guidance-name').textContent = destination?.name ?? '';
    $('route-guidance-text').textContent = state?.message ?? '';
  }

  choose(feature, zoom = false) {
    this.selected = feature;
    this.findSelect.value = feature?.id ?? '';
    this.updateInfo();
    if (feature && zoom) {
      const { minX, minZ, maxX, maxZ } = feature.bounds;
      const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
      if (!isIn(center, this.view.bounds)) {
        this.view = this.overview;
        this.viewSelect.value = this.view.id;
      }
      const t = this.transform();
      if (t) this.zoom = clamp(Math.min(t.width / (maxX - minX + 440), t.height / (maxZ - minZ + 440)) / t.fit, 1, MAX_ZOOM);
      this.center = center;
    }
    this.scheduleDraw();
  }

  setHover(feature) {
    if (feature === this.hover) return;
    this.hover = feature;
    this.canvas.classList.toggle('feature-hover', !!feature);
    this.scheduleDraw();
  }

  hit(p, tolerance = 9) {
    const t = this.transform();
    if (!t) return null;
    const x = (p.x - t.x) / t.scale, z = (p.z - t.z) / t.scale;
    const radius = tolerance / t.scale;
    const bounds = { minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius };
    let best, closest = radius;
    for (const feature of this.landmarks) {
      const d = Math.hypot(feature.x - x, feature.z - z);
      if (d < closest) { best = feature; closest = d; }
    }
    if (best && closest * t.scale < tolerance * .65) return best;
    for (const label of this.labels ?? []) {
      if (p.x >= label.minX && p.x <= label.maxX && p.z >= label.minZ && p.z <= label.maxZ) return label.feature;
    }
    if (best) return best;
    for (const feature of this.lines) {
      if (!intersects(feature.bounds, bounds)) continue;
      const d = lineDistance(x, z, feature.points) + (feature.kind === 'run' && !feature.named ? radius * .15 : 0);
      if (d < closest) { best = feature; closest = d; }
    }
    return best;
  }

  locate() {
    if (!this.player) return;
    const { x, z } = this.player.pos;
    if (!isIn(this.player.pos, this.view.bounds)) {
      this.view = this.overview;
      this.viewSelect.value = this.view.id;
    }
    this.zoom = Math.max(this.zoom, 3.7);
    this.center = { x, z };
    this.scheduleDraw();
  }

  reset() {
    if (!this.view) return;
    this.zoom = 1;
    const { minX, minZ, maxX, maxZ } = this.view.bounds;
    this.center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    this.setHover(null);
    this.scheduleDraw();
  }

  transform() {
    const { clientWidth: width, clientHeight: height } = this.viewport;
    if (!this.center || !width || !height) return null;
    const { minX, maxX, minZ, maxZ } = this.view.bounds;
    const fit = Math.min((width - 28) / (maxX - minX), (height - 28) / (maxZ - minZ));
    const scale = fit * this.zoom;
    const x = width / 2 - this.center.x * scale, z = height / 2 - this.center.z * scale;
    return { width, height, scale, x, z, fit,
      visible: { minX: -x / scale, maxX: (width - x) / scale, minZ: -z / scale, maxZ: (height - z) / scale } };
  }

  clampCenter() {
    const { minX, maxX, minZ, maxZ } = this.settings.bounds;
    this.center.x = clamp(this.center.x, minX, maxX);
    this.center.z = clamp(this.center.z, minZ, maxZ);
  }

  zoomAt(value, x, z) {
    const t = this.transform();
    if (!t) return;
    x ??= t.width / 2;
    z ??= t.height / 2;
    const mapX = (x - t.x) / t.scale, mapZ = (z - t.z) / t.scale;
    this.zoom = clamp(value, 1, MAX_ZOOM);
    this.center.x = mapX - (x - t.width / 2) / (t.fit * this.zoom);
    this.center.z = mapZ - (z - t.height / 2) / (t.fit * this.zoom);
    this.clampCenter();
    this.scheduleDraw();
  }

  pan(dx, dz) {
    const t = this.transform();
    if (!t) return;
    this.center.x -= dx / t.scale;
    this.center.z -= dz / t.scale;
    this.clampCenter();
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (this.framePending || this.screen.classList.contains('hidden')) return;
    this.framePending = true;
    requestAnimationFrame(() => {
      this.framePending = false;
      this.draw();
    });
  }

  drawBase(t, dpr) {
    this.base ??= document.createElement('canvas');
    const values = [t.width, t.height, t.scale, t.x, t.z, dpr, this.player?.pos.x, this.player?.pos.z];
    if (values.every((value, i) => value === this.baseValues?.[i])) return;
    this.baseValues = values;
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    const ctx = this.base.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMapRelief(ctx, this.relief, t);
    ctx.save();
    ctx.translate(t.x, t.z);
    ctx.scale(t.scale, t.scale);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = '#7a8b88a6';
    ctx.lineWidth = 1.3 / t.scale;
    if (t.scale > .20) for (const road of this.roads) {
      if (intersects(road.bounds, t.visible)) ctx.stroke(road.path);
    }
    if (t.scale > .23) {
      ctx.fillStyle = '#a5aba4';
      ctx.strokeStyle = '#586f715e';
      ctx.lineWidth = .8 / t.scale;
      for (const building of this.buildings) if (intersects(building.bounds, t.visible)) {
        ctx.fill(building.path);
        ctx.stroke(building.path);
      }
    }
    for (const style of Object.keys(STYLES)) {
      const palette = STYLES[style];
      ctx.setLineDash([]);
      const width = style === 'lift' ? 1.8 : 1.65;
      const nearby = this.byStyle[style].filter(feature => intersects(feature.bounds, t.visible));
      ctx.strokeStyle = '#eef4f1';
      ctx.lineWidth = (width + 1.45) / t.scale;
      for (const feature of nearby) ctx.stroke(feature.path);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = width / t.scale;
      ctx.setLineDash((palette.dash ?? []).map(length => length / t.scale));
      for (const feature of nearby) ctx.stroke(feature.path);
    }
    ctx.restore();
    this.paintLabels(ctx, t);
  }

  draw() {
    const t = this.transform();
    if (!t || !this.relief) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = t;
    const canvas = this.canvas;
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.drawBase(t, dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const active = new Set([this.selected, this.hover]);
    for (const item of active) if (item) this.drawHighlight(ctx, t, item, item === this.selected);
    this.drawRoute(ctx, t);
    this.drawPosition(ctx, t);
    this.drawScale(ctx, t);
    $('map-zoom-value').textContent = `${Math.round(this.zoom * 100)}%`;
    $('map-zoom-out').disabled = this.zoom <= 1;
    $('map-zoom-in').disabled = this.zoom >= MAX_ZOOM;
  }

  paintLabels(ctx, t) {
    this.labels = [];
    const overview = this.settings.curatedOverview && this.view.id === 'all' && this.zoom < 1.45;
    const landmarkLabels = overview ? this.landmarks.filter(feature => feature.overview) : this.landmarks;
    const typed = this.lines.filter(feature => feature.named && intersects(feature.bounds, t.visible)
      && feature.length * t.scale > (feature.kind === 'lift' ? 55 : 93))
      .sort((a, b) => (b.kind === 'lift') - (a.kind === 'lift') || b.length - a.length);
    const seen = new Set();
    for (const feature of this.landmarks) {
      if (!isIn(feature, t.visible)) continue;
      const { x, z } = this.position(t, feature);
      this.dot(ctx, x, z, feature.style, false);
    }
    const limit = overview ? Math.floor(t.width / 83) + 6 : Infinity;
    for (const feature of [...landmarkLabels, ...typed]) {
      if (this.labels.length >= limit) break;
      if (seen.has(feature.name)) continue;
      const position = this.labelAnchor(feature, t);
      if (!position) continue;
      const { x, z } = this.position(t, position);
      const rect = this.label(ctx, t, feature, x + (feature.kind === 'landmark' ? 9 : 0), z - 10, false);
      if (rect) { this.labels.push(rect); seen.add(feature.name); }
    }
  }

  labelAnchor(feature, t) {
    if (!feature.points) return isIn(feature, t.visible) ? feature : null;
    const mid = Math.floor(feature.points.length / 2);
    for (let i = 0; i <= mid; i++) {
      for (const index of i ? [mid - i, mid + i] : [mid]) {
        if (!feature.points[index]) continue;
        const point = toPoint(feature.points[index]);
        if (isIn(point, t.visible)) return point;
      }
    }
    return null;
  }

  label(ctx, t, feature, x, z, vivid) {
    ctx.font = `600 ${feature.kind === 'landmark' ? 14 : 13}px "Barlow", sans-serif`;
    const icon = feature.badge.symbol === 'double' ? 16 : feature.badge.symbol ? 12 : 0;
    const width = ctx.measureText(feature.name).width + icon;
    const player = this.player && this.position(t, this.player.pos);
    const playerBox = player && { minX: player.x - 17, maxX: player.x + 17, minZ: player.z - 17, maxZ: player.z + 17 };
    if (vivid) {
      x = clamp(x, 15, t.width - width - 12);
      z = clamp(z, 20, t.height - 18);
      if (x + width > t.width - 45 && z < 64) z = 70;
      if (playerBox && x < playerBox.maxX && x + width > playerBox.minX && Math.abs(z - player.z) < 26) {
        z = player.z >= 47 ? player.z - 27 : player.z + 27;
      }
    }
    const rect = { minX: x - 4, maxX: x + width + 4, minZ: z - 9, maxZ: z + 9, feature };
    if (!vivid && (rect.minX < 8 || rect.maxX > t.width - 18 || rect.minZ < 14 || rect.maxZ > t.height - 33 ||
      (rect.maxX > t.width - 42 && rect.minZ < 60) ||
      (playerBox && intersects(playerBox, rect)) ||
      this.labels.some(existing => intersects(existing, rect)))) return null;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (vivid) {
      ctx.fillStyle = '#fff7dc';
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(rect.minX - 3, rect.minZ - 2, width + 13, 22, 4);
      ctx.fill();
      ctx.stroke();
    }
    if (icon) this.dot(ctx, x + 4, z, feature.style, vivid);
    ctx.fillStyle = feature.badge.ink;
    if (!vivid) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#f3f7f3';
      ctx.lineJoin = 'round';
      ctx.strokeText(feature.name, x + icon, z);
    }
    ctx.fillText(feature.name, x + icon, z);
    return rect;
  }

  dot(ctx, x, z, style, vivid) {
    if (style.startsWith('bike-')) style = style.slice(5);
    switch (style) {
      case 'black':
      case 'double': {
        ctx.fillStyle = STYLES[style].ink;
        const diamonds = style === 'double' ? [-2.6, 3.3] : [0];
        for (const dx of diamonds) {
          ctx.beginPath();
          ctx.moveTo(x + dx, z - 3.8); ctx.lineTo(x + dx + 2.8, z);
          ctx.lineTo(x + dx, z + 3.8); ctx.lineTo(x + dx - 2.8, z); ctx.closePath(); ctx.fill();
        }
        return;
      }
      case 'blue':
        ctx.fillStyle = STYLES.blue.ink;
        ctx.fillRect(x - 3.5, z - 3.5, 7, 7);
        return;
      case 'peak':
        ctx.beginPath();
        ctx.moveTo(x, z - 6); ctx.lineTo(x + 5.5, z + 4.2); ctx.lineTo(x - 5.5, z + 4.2); ctx.closePath();
        break;
      default:
        ctx.beginPath();
        ctx.arc(x, z, style === 'green' ? 3.6 : vivid ? 6.5 : 4.1, 0, Math.PI * 2);
    }
    ctx.lineWidth = 1.9;
    ctx.strokeStyle = vivid ? '#bd5d00' : '#f8faf6';
    ctx.fillStyle = STYLES[style].ink;
    if (style !== 'green') ctx.stroke();
    ctx.fill();
  }

  position(t, point) { return { x: t.x + point.x * t.scale, z: t.z + point.z * t.scale }; }

  drawHighlight(ctx, t, feature, selected) {
    if (feature.path) {
      ctx.save();
      ctx.translate(t.x, t.z);
      ctx.scale(t.scale, t.scale);
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.lineWidth = (selected ? 8 : 7) / t.scale;
      ctx.strokeStyle = selected ? '#faad39' : '#ffd775';
      ctx.stroke(feature.path);
      ctx.strokeStyle = feature.badge.ink;
      ctx.lineWidth = 2.6 / t.scale;
      ctx.setLineDash((feature.badge.dash ?? []).map(length => length / t.scale));
      ctx.stroke(feature.path);
      ctx.restore();
    } else {
      const { x, z } = this.position(t, feature);
      this.dot(ctx, x, z, feature.style, true);
    }
    const anchor = this.labelAnchor(feature, t);
    if (anchor) {
      const { x, z } = this.position(t, anchor);
      this.label(ctx, t, feature, x + 9, z - 14, true);
    }
  }

  drawRoute(ctx, t) {
    if (!this.route?.active) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [i, leg] of this.route.legs.entries()) {
      if (i < this.route.legIndex || leg.points.length < 2) continue;
      const points = leg.points.filter((p, n) => i !== this.route.legIndex || (leg.points[n + 1]?.d ?? p.d) >= this.route.progress);
      ctx.beginPath();
      for (const [i, point] of points.entries()) {
        const { x, z } = this.position(t, point);
        if (i) ctx.lineTo(x, z);
        else ctx.moveTo(x, z);
      }
      ctx.setLineDash(leg.lift ? [4, 5] : []);
      ctx.strokeStyle = '#5d360e';
      ctx.lineWidth = 5.2;
      ctx.stroke();
      ctx.strokeStyle = '#ffc24c';
      ctx.lineWidth = 3.1;
      ctx.stroke();
    }
    const end = this.route.legs.at(-1)?.points.at(-1);
    if (end) {
      const { x, z } = this.position(t, end);
      ctx.fillStyle = '#ffc24c'; ctx.strokeStyle = '#5d360e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, z, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  drawPosition(ctx, t) {
    if (!this.player) return;
    const { x, z } = this.position(t, this.player.pos);
    if (x < -20 || x > t.width + 20 || z < -20 || z > t.height + 20) return;
    ctx.save();
    ctx.translate(x, z);
    ctx.fillStyle = '#f4faf6';
    ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(Math.PI - this.player.heading);
    ctx.fillStyle = '#bd3524';
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(7.4, 7); ctx.lineTo(0, 4); ctx.lineTo(-7.4, 7); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawScale(ctx, t) {
    const target = 94 / t.scale, base = 10 ** Math.floor(Math.log10(target));
    const step = [5, 2, 1].find(value => value <= target / base) * base;
    const x = 15, z = t.height - 16, width = step * t.scale;
    ctx.fillStyle = '#f2f6f1ef';
    ctx.fillRect(x - 7, z - 24, width + 15, 32);
    ctx.fillRect(t.width - 37, 8, 29, 49);
    ctx.fillStyle = ctx.strokeStyle = INK;
    ctx.font = '600 12px "Barlow", sans-serif';
    ctx.lineWidth = 1.35;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(metric(step), x + width / 2, z - 12);
    ctx.fillText('N', t.width - 23, 18);
    ctx.beginPath();
    ctx.moveTo(x, z - 4); ctx.lineTo(x, z); ctx.lineTo(x + width, z); ctx.lineTo(x + width, z - 4);
    ctx.moveTo(t.width - 23, 28); ctx.lineTo(t.width - 23, 48); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(t.width - 23, 26); ctx.lineTo(t.width - 27, 35); ctx.lineTo(t.width - 19, 35); ctx.closePath(); ctx.fill();
  }
}
