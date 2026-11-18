import * as THREE from 'three';
import { TrailRouter } from './trail-router.js';

const SPACING = 16;
const ARROW_COUNT = 7;
const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function assembleRoute(edges) {
  const legs = [{ points: [] }];
  for (const { points, lift } of edges) {
    const last = legs.at(-1);
    if (lift) {
      legs.push({ lift, points: [lift.board, ...points, lift.exit] }, { points: [lift.exit] });
    } else for (const point of points) {
      if (!last.points.length || flatDistance(last.points.at(-1), point) > .01) last.points.push(point);
    }
  }
  for (const leg of legs) {
    let length = 0;
    leg.points = leg.points.map((p, i, points) => {
      if (i) length += flatDistance(points[i - 1], p);
      return { x: p.x, z: p.z, d: length };
    });
    leg.length = length;
  }
  return legs;
}

function arrowMesh() {
  const outline = new THREE.Shape();
  outline.moveTo(0, 2.3);
  outline.lineTo(1.64, .03);
  outline.lineTo(.66, .03);
  outline.lineTo(.66, -1.72);
  outline.lineTo(-.66, -1.72);
  outline.lineTo(-.66, .03);
  outline.lineTo(-1.64, .03);
  outline.closePath();
  const geo = new THREE.ExtrudeGeometry(outline, { depth: .15, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  const ink = new THREE.MeshBasicMaterial({ color: 0x422104, toneMapped: false });
  const amber = new THREE.MeshBasicMaterial({ color: 0xffc54e, toneMapped: false });
  const outer = new THREE.Mesh(geo, ink);
  const inset = new THREE.Mesh(geo, amber);
  inset.position.y = .159;
  inset.scale.set(.76, 1, .80);
  const arrow = new THREE.Group();
  arrow.add(outer, inset);
  arrow.visible = false;
  return arrow;
}

function sample(leg, distance) {
  const { points } = leg;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].d <= distance) lo = mid;
    else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const t = Math.max(0, Math.min(1, (distance - a.d) / (b.d - a.d || 1)));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
    heading: Math.atan2(b.x - a.x, b.z - a.z) };
}

export class RouteGuide {
  constructor(scene, settings) {
    this.settings = settings;
    this.heightAt = settings.heightAt;
    this.root = new THREE.Group();
    this.root.name = 'Trail navigation arrows';
    this.arrows = Array.from({ length: ARROW_COUNT }, arrowMesh);
    this.root.add(...this.arrows);
    scene.add(this.root);
    this.change = () => {};
  }

  setDestination(feature, start) {
    this.destination = feature;
    this.legs = [];
    this.legIndex = 0;
    this.progress = 0;
    this.projectIndex = 0;
    this.ride = false;
    this.root.visible = false;
    this.lastPlan = performance.now();
    if (!feature) {
      this.setGuidance('');
      return false;
    }
    if (!start) {
      this.setGuidance('Start skiing to begin guidance.');
      return true;
    }
    this.router ??= new TrailRouter(this.summer
      ? { ...this.settings, runs: this.settings.summerRoutes, lifts: this.settings.summerLifts }
      : this.settings);
    const result = this.router.plan(start, feature);
    if (!result) {
      this.setGuidance('No connected route from here.');
      return false;
    }
    this.legs = assembleRoute(result);
    this.setGuidance('Follow the amber arrows.');
    return true;
  }

  setGuidance(message, lift = null) {
    if (message === this.message && this.nextLift === lift) return;
    this.message = message;
    this.nextLift = lift;
    this.change();
  }

  get active() { return !!this.legs?.length && this.legIndex < this.legs.length; }

  setSummer(summer, stillAvailable) {
    if (summer === !!this.summer) return;
    this.summer = summer;
    this.router = null;
    if (this.destination) this.setDestination(stillAvailable ? this.destination : null);
  }

  nextLeg() {
    this.legIndex++;
    this.progress = 0;
    this.projectIndex = 0;
    if (!this.active) {
      this.root.visible = false;
      this.setGuidance('Destination reached.');
    }
  }

  update(player, { riding = false, hidden = false } = {}) {
    if (!player || !this.destination) { this.root.visible = false; return; }
    const p = player.pos;
    if (riding || hidden) {
      this.ride ||= riding;
      this.root.visible = false;
      return;
    }
    if (this.ride || this.message === 'Start skiing to begin guidance.') {
      this.setDestination(this.destination, p);
    }
    if (!this.active) return;
    const leg = this.legs[this.legIndex];
    if (leg.lift) {
      const { board, name, id } = leg.lift;
      this.setGuidance(`Board ${name} to continue.`, id);
      const d = flatDistance(p, board);
      this.root.visible = d > 5 && d < 65;
      for (let i = 0; i < this.arrows.length; i++) this.arrows[i].visible = i === 0;
      this.arrows[0].position.set(board.x, this.heightAt(board.x, board.z) + 1.2, board.z);
      this.arrows[0].rotation.y = Math.atan2(board.x - p.x, board.z - p.z);
      if (!this.root.visible && d >= 65 && performance.now() - this.lastPlan >= 4500) this.setDestination(this.destination, p);
      return;
    }
    const points = leg.points, last = points.at(-1), boarding = this.legs[this.legIndex + 1]?.lift;
    if (!last || (flatDistance(p, last) < (boarding ? 12 : 6) && (leg.length < 80 || leg.length - this.progress < 45))) {
      this.nextLeg();
      return;
    }
    if (boarding && flatDistance(p, boarding.board) < 45) this.setGuidance(`Board ${boarding.name} to continue.`, boarding.id);
    else this.setGuidance('Follow the amber arrows.');
    let nearest = Infinity, bestDistance = this.progress, bestIndex = this.projectIndex;
    for (let i = Math.max(0, this.projectIndex - 4); i < points.length - 1 && points[i].d < this.progress + 145; i++) {
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
      if (d >= nearest) continue;
      nearest = d;
      bestDistance = a.d + (b.d - a.d) * t;
      bestIndex = i;
    }
    if (nearest < 47 && bestDistance >= this.progress) {
      this.progress = bestDistance;
      this.projectIndex = bestIndex;
    }
    if (nearest > 78 && performance.now() - this.lastPlan >= 4500) {
      this.setDestination(this.destination, p);
      return;
    }
    this.root.visible = true;
    let next = (Math.floor((this.progress + (nearest < 12 ? 3 : 0)) / SPACING) + 1) * SPACING;
    if (next >= leg.length) next = leg.length;
    for (const arrow of this.arrows) {
      arrow.visible = next <= leg.length && points.length > 1;
      if (!arrow.visible) continue;
      const { x, z, heading } = sample(leg, next);
      arrow.position.set(x, this.heightAt(x, z) + 1.1, z);
      arrow.rotation.y = heading;
      if (next < leg.length && leg.length - next < SPACING) next = leg.length;
      else next += SPACING;
    }
  }
}
