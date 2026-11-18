import * as THREE from 'three';
import { cameraClipper } from './camera-obstacles.js';
import { buildMappedForest } from './mapped-resort-forest.js';
import { loadMappedGround, pointInPolygon, runStyle } from './mapped-resort-ground.js';
import { buildMappedLodges } from './stevens-pass-buildings.js';
import { buildStevensPassDetails } from './stevens-pass-details.js';
import { clamp, makeCanvas } from './util.js';

const HASH_CELL = 24;

function createEnvironment() {
  const cells = new Map();
  function inCells(x, z, r, callback) {
    const left = Math.floor((x - r) / HASH_CELL), right = Math.floor((x + r) / HASH_CELL);
    const top = Math.floor((z - r) / HASH_CELL), bottom = Math.floor((z + r) / HASH_CELL);
    for (let j = top; j <= bottom; j++) {
      for (let i = left; i <= right; i++) callback(`${i}:${j}`);
    }
  }
  function add(object, radius) {
    inCells(object.x, object.z, radius, key => {
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(object);
    });
    return object;
  }
  function queryColliders(x, z, radius = 3) {
    const objects = new Set();
    inCells(x, z, radius, key => {
      for (const object of cells.get(key) ?? []) objects.add(object);
    });
    return Array.from(objects);
  }
  function intersects(c, x, y, z, pad) {
    if (y < (c.minY ?? -Infinity) - pad || y > (c.maxY ?? Infinity) + pad) return false;
    const dx = x - c.x, dz = z - c.z;
    if (c.r) return dx * dx + dz * dz < (c.r + pad) ** 2;
    const s = Math.sin(c.rot), cos = Math.cos(c.rot);
    return Math.abs(dx * cos + dz * s) < c.hw + pad && Math.abs(dz * cos - dx * s) < c.hd + pad;
  }
  return {
    addCircle(x, z, r, type, extra = {}) { return add({ x, z, r, type, ...extra }, r); },
    addBox(x, z, hw, hd, rot, type, extra = {}) { return add({ x, z, hw, hd, rot, type, ...extra }, Math.hypot(hw, hd)); },
    isOpen(x, y, z, pad = .65) { return !queryColliders(x, z, pad).some(c => intersects(c, x, y, z, pad)); },
    queryColliders, clipCameraArm: cameraClipper(queryColliders),
  };
}

function downhillPoints(run, ground) {
  const points = run.points;
  return ground.heightAt(...points[0]) >= ground.heightAt(...points.at(-1)) ? points : [...points].reverse();
}

function toRoute(ground, run) {
  const points = downhillPoints(run, ground);
  let length = 0;
  const stations = points.map(([x, z], i) => {
    if (i) length += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    return { x, z, distance: length };
  });
  return {
    length,
    at(distance) {
      const d = clamp(distance, 0, length);
      const i = Math.max(1, stations.findIndex(p => p.distance >= d));
      const a = stations[i - 1], b = stations[i], size = b.distance - a.distance;
      const f = (d - a.distance) / (size || 1);
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    },
  };
}

function chooseStart(config, ground, env, runId = config.startRun, liftId = config.startLift) {
  const lift = config.lifts.find(({ id }) => id === liftId) ?? config.lifts[0];
  const ends = lift ? [lift.points[0], lift.points.at(-1)] : null;
  const upper = ends && (ground.heightAt(...ends[0]) > ground.heightAt(...ends[1]) ? ends[0] : ends[1]);
  const all = config.runs.filter(run => run.points.length >= 2 && !run.connector && runStyle(run).groomed);
  const suggested = all.find(({ id }) => id === runId);
  const runs = suggested ? [suggested, ...all.filter(run => run !== suggested)] : all;
  const field = {};
  let best = null;
  for (const run of runs) {
    const route = toRoute(ground, run);
    const top = route.at(0);
    if (upper && Math.hypot(top.x - upper[0], top.z - upper[1]) > 175 && run !== suggested) continue;
    for (let d = 6; d < Math.min(route.length - 26, 140); d += 3) {
      const a = route.at(d), b = route.at(d + 11), next = route.at(d + 26);
      const dist = upper ? Math.hypot(a.x - upper[0], a.z - upper[1]) : 38;
      const y = ground.heightAt(a.x, a.z);
      const slope = (y - ground.heightAt(b.x, b.z)) / 11;
      const ahead = (y - ground.heightAt(next.x, next.z)) / 26;
      const heading = Math.atan2(b.x - a.x, b.z - a.z);
      ground.fieldAt(a.x, a.z, field);
      if (dist < 24 || !env.isOpen(a.x, y, a.z, 1.8) || slope < .018 || ahead < .034) continue;
      const score = (run === suggested ? 88 : 0) + field.groomed * 16
        - Math.abs(slope - .22) * 34 - Math.abs(45 - dist) * .25 - d * .105;
      if (!best || score > best.score) best = { ...a, heading, score, runId: run.id, runName: run.name };
    }
  }
  if (best) {
    const { x, z, heading, runId, runName } = best;
    return { x, z, heading, runId, runName, holdAtUnload: true };
  }
  if (!upper) return { x: (ground.bounds.minX + ground.bounds.maxX) / 2,
    z: (ground.bounds.minZ + ground.bounds.maxZ) / 2, heading: 0 };
  const lower = upper === ends[0] ? ends[1] : ends[0];
  const angle = Math.atan2(lower[0] - upper[0], lower[1] - upper[1]);
  return { x: upper[0] + Math.sin(angle) * 26, z: upper[1] + Math.cos(angle) * 26,
    heading: angle, holdAtUnload: true };
}

function signGraphics(run) {
  const { canvas, ctx } = makeCanvas(512, 116);
  const style = runStyle(run);
  ctx.fillStyle = '#142121';
  ctx.fillRect(0, 0, 512, 116);
  ctx.strokeStyle = '#d1ded5';
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, 502, 106);
  ctx.fillStyle = style.easy ? '#4ba65e' : style.expert ? '#eff1e8' : '#4679bf';
  if (style.easy) {
    ctx.beginPath();
    ctx.arc(61, 58, 24, 0, Math.PI * 2);
    ctx.fill();
  } else if (style.expert) {
    const xs = run.difficulty === 'double' ? [46, 78] : [61];
    for (const x of xs) {
      ctx.beginPath();
      ctx.moveTo(x, 30);
      ctx.lineTo(x + 23, 58);
      ctx.lineTo(x, 86);
      ctx.lineTo(x - 23, 58);
      ctx.closePath();
      ctx.fill();
    }
  } else ctx.fillRect(37, 34, 48, 48);
  ctx.fillStyle = '#f1f0df';
  ctx.font = 'bold 49px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(run.name.toUpperCase(), 115, 58, 369);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function buildSigns(scene, ground, config, env) {
  const group = new THREE.Group();
  group.name = `${config.name} · trail signs`;
  const post = new THREE.CylinderGeometry(.074, .078, 2.23, 8);
  const panel = new THREE.PlaneGeometry(2.40, .54);
  const backing = new THREE.BoxGeometry(2.45, .59, .08);
  const cedar = new THREE.MeshStandardMaterial({ color: 0x605145, roughness: .88 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x242922, roughness: .87 });
  const positions = [];
  for (const run of config.runs) {
    if (!run.name || run.connector || run.points.length < 2) continue;
    const route = toRoute(ground, run);
    if (route.length < 44) continue;
    const a = route.at(15), b = route.at(38);
    const dir = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
    const offset = runStyle(run).width * .55;
    const x = a.x + dir.y * offset, z = a.z - dir.x * offset;
    const y = ground.heightAt(x, z);
    if (!env.isOpen(x, y + .5, z, .58) || positions.some(p => Math.hypot(x - p.x, z - p.z) < 9)) continue;
    positions.push({ x, z });
    const sign = new THREE.Group();
    sign.position.set(x, y, z);
    sign.rotation.y = Math.atan2(-dir.x, -dir.y);
    const stand = new THREE.Mesh(post, cedar);
    stand.position.set(0, .98, -.12);
    const body = new THREE.Mesh(backing, dark);
    body.position.y = 1.92;
    const face = new THREE.Mesh(panel, new THREE.MeshStandardMaterial({
      map: signGraphics(run), roughness: .81,
    }));
    face.position.set(0, 1.92, .043);
    sign.add(stand, body, face);
    group.add(sign);
    env.addCircle(x, z, .077, 'trail-post', { minY: y, maxY: y + 2.25 });
  }
  scene.add(group);
  return group;
}

export async function buildMappedResortWorld(scene, config, baseURL) {
  const root = new THREE.Group();
  root.name = config.name;
  const env = createEnvironment();
  const ground = await loadMappedGround(root, config, baseURL);
  const lodges = buildMappedLodges(root, config, ground, env);
  if (config.id === 'stevens-pass') buildStevensPassDetails(root, config, ground, env, pointInPolygon);
  const forest = await buildMappedForest(root, ground, config, env);
  const start = chooseStart(config, ground, env);
  const beginner = config.beginnerRun ? chooseStart(config, ground, env, config.beginnerRun, config.beginnerLift) : start;
  ground.startPose = () => ({ ...start });
  ground.beginnerPose = () => ({ ...beginner });
  const signs = buildSigns(root, ground, config, env);
  env.setSignsVisible = (visible) => { signs.visible = visible; };
  scene.add(root);
  return {
    root, ground, env, lodges, forest,
    setQuality: forest.setQuality,
    update(dt, camera) { if (camera) forest.update(camera); },
  };
}
