import * as THREE from 'three';
import { box, mergedMesh, cacheStaticTransforms } from './scenery.js';
import { clamp, lerp, makeCanvas, mulberry32, smoothstep } from './util.js';
import { STEVENS_OVERPASS_OSM } from './stevens-pass-terrain.js';

export const STEVENS_OVERPASS_START = { x: 192.5, z: -87, heading: -2.98 };
const width = 3.52;
const deckDepth = 1.20;
const asphalt = '#494946';
const stone = '#88735c';
const rail = '#3b3733';

function texture(build, size = 128) {
  const { canvas, ctx } = makeCanvas(size, size);
  build(ctx, size);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  return map;
}

function groundGrain() {
  return texture((ctx, size) => {
    const random = mulberry32(81517);
    const pixels = ctx.createImageData(size, size);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = 163 + random() * 83;
      pixels.data.set([gray, gray + 3, gray + 5, 255], i);
    }
    ctx.putImageData(pixels, 0, 0);
  });
}

function retainingStone() {
  return texture((ctx, size) => {
    ctx.fillStyle = '#8f8474';
    ctx.fillRect(0, 0, size, size);
    const random = mulberry32(2719);
    for (let y = -20; y < size + 18; y += 19) {
      const offset = Math.round(random() * 19);
      for (let x = -28 + offset; x < size; x += 27) {
        const value = 150 + Math.floor(random() * 75);
        ctx.fillStyle = 'rgb(' + value + ',' + (value - 11) + ',' + (value - 23) + ')';
        ctx.beginPath();
        ctx.moveTo(x + 1, y + 4);
        ctx.lineTo(x + 6, y + 1);
        ctx.lineTo(x + 24, y + 2);
        ctx.lineTo(x + 25, y + 13);
        ctx.lineTo(x + 21, y + 18);
        ctx.lineTo(x + 3, y + 16);
        ctx.closePath();
        ctx.fill();
      }
    }
  });
}

function roadTexture() {
  const map = texture((ctx, size) => {
    const random = mulberry32(512488);
    const pixels = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + .5) / size;
      const distance = Math.abs(u - .5);
      const grain = random();
      const asphaltShade = 62 + grain * 23;
      const yellow = 1 - smoothstep(.003, .005, Math.abs(distance - .008));
      const white = 1 - smoothstep(.0026, .0048, Math.abs(distance - .464));
      const slush = .26 * smoothstep(.448, .496, distance) * (.5 + grain * .5);
      const lane = Math.max(yellow, white) * (.68 + .21 * grain);
      const tint = yellow > white ? [201, 165, 86] : [199, 202, 198];
      for (let c = 0; c < 3; c++) {
        pixels.data[(y * size + x) * 4 + c] = lerp(lerp(asphaltShade + c * 2, 185, slush), tint[c], lane);
      }
      pixels.data[(y * size + x) * 4 + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  }, 256);
  map.wrapS = THREE.ClampToEdgeWrapping;
  return map;
}

function stations(curve, step) {
  const length = curve.getLength();
  const count = Math.ceil(length / step);
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    const p = curve.getPointAt(t), tangent = curve.getTangentAt(t);
    const heading = Math.atan2(tangent.x, tangent.z);
    return { x: p.x, y: p.y, z: p.z, heading, s: t * length,
      ux: Math.cos(heading), uz: -Math.sin(heading) };
  });
}

function bridgePoint(p, offset = 0, lift = 0) {
  return new THREE.Vector3(p.x + p.ux * offset, p.y + lift, p.z + p.uz * offset);
}

function strip(group, points, columns, vertex, material, name) {
  const position = [], uv = [], color = [], index = [];
  for (let row = 0; row < points.length; row++) {
    for (let col = 0; col <= columns; col++) {
      const { p, u, v, tint = 1 } = vertex(points[row], col / columns);
      position.push(p.x, p.y, p.z);
      uv.push(u, v);
      color.push(tint, tint, tint);
      if (!row || !col) continue;
      const d = row * (columns + 1) + col, a = d - columns - 2;
      index.push(a, d - 1, a + 1, a + 1, d - 1, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function beam(a, b, w, h, color) {
  const vector = b.clone().sub(a);
  const yaw = Math.atan2(vector.x, vector.z);
  const pitch = -Math.atan2(vector.y, Math.hypot(vector.x, vector.z));
  return box(w, h, vector.length() + .012, color, a.clone().lerp(b, .5).toArray(), [pitch, yaw, 0, 'YXZ']);
}

function profilePath(points) {
  const path = new THREE.CurvePath();
  const corners = points.map(p => new THREE.Vector3(...p));
  let start = corners[0];
  for (let i = 1; i < corners.length - 1; i++) {
    const here = corners[i], previous = corners[i - 1], next = corners[i + 1];
    const entry = here.clone().lerp(previous, .10);
    const exit = here.clone().lerp(next, .10);
    path.add(new THREE.LineCurve3(start, entry));
    path.add(new THREE.QuadraticBezierCurve3(entry, here, exit));
    start = exit;
  }
  path.add(new THREE.LineCurve3(start, corners.at(-1)));
  return path;
}

function findCrossingPoint(points, x, z, buffer) {
  if (x < 146 - buffer || x > 194 + buffer || z < -194 - buffer || z > -88 + buffer) return;
  const threshold = buffer ** 2;
  let best = threshold, floor;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const along = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
    if ((i === 1 && along < 0) || (i === points.length - 1 && along > 1)) continue;
    const t = clamp(along, 0, 1);
    const distance = (x - lerp(a.x, b.x, t)) ** 2 + (z - lerp(a.z, b.z, t)) ** 2;
    if (distance >= best) continue;
    best = distance;
    floor = lerp(a.y, b.y, t);
  }
  return floor;
}

function overpass(group, ground, env, way, grain) {
  const [[nx,nz], [sx,sz]] = way.points;
  const north = [175.9, -189.1], south = [192.6, -90.1];
  const top = 1246.72;
  const northWalk = stations(profilePath([
    [north[0], ground.heightAt(...north) + .018, north[1]], [169.7, 1244.96, -181.8],
    [155.7, 1246.35, -171.1], [nx, top, nz],
  ]), .64);
  const bridge = stations(new THREE.LineCurve3(
    new THREE.Vector3(nx, top, nz), new THREE.Vector3(sx, top + .22, sz)), 1.5);
  const southWalk = stations(profilePath([
    [sx, top + .22, sz], [192.1, 1246.23, -104], [192.5, 1246.12, -98],
    [south[0], ground.heightAt(...south) + .018, south[1]],
  ]), .64);
  // The drawing and contact surface share the same rounded approach centre lines.
  for (const approach of [northWalk, southWalk]) {
    for (const p of approach) p.y = Math.max(p.y, ground.heightAt(p.x, p.z) + .018);
  }
  // Use the bridge cross-section at either join so the paved strips meet edge to edge.
  northWalk[northWalk.length - 1] = { ...bridge[0], s: northWalk.at(-1).s };
  southWalk[0] = { ...bridge.at(-1), s: 0 };
  const all = [...northWalk, ...bridge.slice(1), ...southWalk.slice(1)];
  const pavement = new THREE.MeshStandardMaterial({ color: asphalt, map: grain, roughness: .97, vertexColors: true });
  const fascia = new THREE.MeshStandardMaterial({ color: '#a8957c', map: retainingStone(), roughness: .93, side: THREE.DoubleSide });
  const snow = new THREE.MeshStandardMaterial({ color: '#e8eeed', roughness: .91, vertexColors: true });
  const concreteParts = [], railingParts = [];
  for (const [path, structure] of [[northWalk,'North parking ramp'], [bridge,'US 2 bridge'], [southWalk,'Lodge approach']]) {
    const raised = path === bridge;
    strip(group, path, 10, (p, across) => {
      const edge = smoothstep(.77, .98, Math.abs(across * 2 - 1));
      const offset = (across - .5) * width;
      return { p: bridgePoint(p, offset, .012), u: offset / 3.8, v: p.s / 3.8,
        tint: .81 + edge * .34 + .052 * Math.sin(p.s * .76 + across * 39) };
    }, pavement, structure + ' · walking surface');
    for (const side of [-1, 1]) {
      const fasciaEdge = width * .5 * side;
      strip(group, path, 3, (p, across) => {
        const drift = .12 * Math.sin(p.s * .65 + side * 2) + .10 * Math.sin(p.s * 1.49 + side);
        const snowWidth = clamp(.18 + drift, .025, .39);
        const fromEdge = snowWidth * (side === 1 ? 1 - across : across);
        const height = .017 + .048 * (1 - fromEdge / snowWidth) ** 2;
        return { p: bridgePoint(p, fasciaEdge - side * fromEdge, height), u: across, v: p.s,
          tint: .83 + .17 * (1 - fromEdge / snowWidth) };
      }, snow, structure + ' · snow along rail');
      strip(group, path, 1, (p, vertical) => {
        const point = bridgePoint(p, fasciaEdge, .13);
        const bottom = raised ? p.y - .57 : ground.heightAt(point.x, point.z) - .19;
        point.y = lerp(point.y, Math.min(p.y - .22, bottom), vertical);
        return { p: point, u: p.s * .62, v: point.y * .58 };
      }, fascia, structure + ' · stone veneer');
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        if (raised) {
          concreteParts.push(beam(bridgePoint(a, side * 1.15, -.71), bridgePoint(b, side * 1.15, -.71),
            .54, .98, '#615f5a'));
        }
        const railOffset = fasciaEdge - side * .10;
        const aRail = bridgePoint(a, railOffset, 1.12), bRail = bridgePoint(b, railOffset, 1.12);
        const midpoint = aRail.clone().lerp(bRail, .5);
        railingParts.push(beam(aRail, bRail, .060, .056, rail));
        railingParts.push(beam(bridgePoint(a, railOffset, .24), bridgePoint(b, railOffset, .24), .048, .057, rail));
        env.addBox(midpoint.x, midpoint.z, .07, Math.hypot(bRail.x - aRail.x, bRail.z - aRail.z) * .5,
          -Math.atan2(bRail.x - aRail.x, bRail.z - aRail.z), 'bridge-railing',
          { minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) + 1.12 });
        if (i % (raised ? 2 : 4) === 0 || i === path.length - 1) {
          railingParts.push(box(.084, 1.15, .084, rail, bridgePoint(b, railOffset, .58).toArray()));
        }
        const bars = Math.ceil(Math.hypot(bRail.x - aRail.x, bRail.z - aRail.z) / .195);
        for (let j = 1; j <= bars; j++) {
          const center = aRail.clone().lerp(bRail, (j - .5) / bars);
          center.y -= .44;
          railingParts.push(box(.024, .88, .024, '#48433e', center.toArray()));
        }
        if (raised && a.s >= 13 && b.s <= 36) {
          railingParts.push(beam(bridgePoint(a, fasciaEdge, 1.79), bridgePoint(b, fasciaEdge, 1.79), .039, .038, rail));
          if (i % 2 === 0) railingParts.push(box(.045, 1.57, .048, rail, bridgePoint(b, fasciaEdge, 1.03).toArray()));
          for (let v = .37; v < 1.77; v += .19) {
            railingParts.push(beam(bridgePoint(a, fasciaEdge, v), bridgePoint(b, fasciaEdge, v), .008, .008, '#5c5650'));
          }
        }
      }
    }
  }
  // Abutments and the intermediate pier are outside the cleared travel lanes.
  for (const index of [0, Math.round(bridge.length * .67), bridge.length - 1]) {
    const p = bridge[index];
    const isPier = index !== 0 && index !== bridge.length - 1;
    const bottom = ground.heightAt(p.x, p.z) - .52;
    const height = p.y - (isPier ? deckDepth : .37) - bottom;
    const across = isPier ? 2.31 : 3.72;
    const depth = isPier ? .91 : 1.22;
    const center = [p.x, bottom + height * .5, p.z];
    concreteParts.push(box(across, height, depth, isPier ? '#9a8f7e' : stone, center, [0, p.heading, 0]));
    if (isPier) concreteParts.push(box(3.17, .29, 1.22, '#a09788', [p.x, bottom + height + .06, p.z], [0, p.heading, 0]));
    env.addBox(p.x, p.z, across * .5, depth * .5, -p.heading, 'bridge-pier', { minY: bottom, maxY: bottom + height });
  }
  const construction = mergedMesh(concreteParts);
  construction.name = 'Prestressed girders and abutments';
  const fixtures = mergedMesh(railingParts, { roughness: .63, metalness: .25 });
  fixtures.name = 'Dark picket railing and highway screen';
  for (const item of [...concreteParts, ...railingParts]) item.geo.dispose();
  group.add(construction, fixtures);

  const floorAt = (x, z, eye) => {
    const deck = findCrossingPoint(all, x, z, width * .5);
    if (deck == null || (Number.isFinite(eye) && eye < deck - .62)) return;
    return Math.max(ground.heightAt(x, z), deck + .013);
  };
  env.walkSurfaceAt = floorAt;
  // A change of equipment on the deck preserves the player's height.
  env.raisedPadAt = floorAt;
  return (x, z) => findCrossingPoint(all, x, z, 4.75) != null;
}

function highway(group, config, ground) {
  // These consecutive OSM ways form the mainline across the summit.
  const ways = ['119112486', '1034966986', '1087578188', '1087578187', '23610865'];
  const entries = ways.map(id => config.roads.find(road => road.osmId === id));
  if (entries.some(way => !way)) return;
  const line = entries.flatMap(({ points }, i) => points.slice(i > 0 ? 1 : 0));
  const curve = new THREE.CatmullRomCurve3(line.map(([x,z]) => new THREE.Vector3(x, 0, z)));
  const path = stations(curve, 1.65);
  const material = new THREE.MeshStandardMaterial({
    map: roadTexture(), roughness: .94, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1,
  });
  const shoulder = p => 5.25 + 3.85 * (1 - smoothstep(310, 685, Math.hypot(p.x - 140, p.z + 138)));
  // Chunk the highway so distant bends can be culled independently.
  const interval = 110;
  for (let start = 0; start < path.length - 1; start += interval) {
    strip(group, path.slice(start, start + interval + 1), 16, (p, across) => {
      const offset = (across * 2 - 1) * shoulder(p);
      const plowEdge = smoothstep(.80, .99, Math.abs(across * 2 - 1));
      const edgeVariation = plowEdge * (.20 * Math.sin(p.s * 1.44) + .15 * Math.sin(p.s * .6));
      const vertex = bridgePoint(p, offset + edgeVariation);
      vertex.y = ground.heightAt(vertex.x, vertex.z) + .067;
      return { p: vertex, u: across, v: p.s / 8.4,
        tint: .67 + plowEdge * .38 + .11 * Math.sin(offset * 2.1) ** 6 + .045 * Math.sin(p.s * .69 + offset) };
    }, material, 'US 2 · plowed asphalt');
  }
}

export function buildStevensCrossing(parent, config, ground, env) {
  const way = config.roads.find(entry => entry.osmId === STEVENS_OVERPASS_OSM);
  if (way?.points.length !== 2) return () => false;
  const group = new THREE.Group();
  group.name = 'US 2 · Stevens Pass pedestrian crossing';
  parent.add(group);
  const grain = groundGrain();
  highway(group, config, ground);
  const isNear = overpass(group, ground, env, way, grain);
  cacheStaticTransforms(group);
  return isNear;
}
