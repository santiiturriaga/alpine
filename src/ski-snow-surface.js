import * as THREE from 'three';
import { surfaceMaterial } from './materials.js';
import { skiProfile as profile } from './skier.js';

// Metres along the real ski axis. The tail is at -.82; its pressed bed
// recovers over the following metre, while the upturned nose exits the snow.
export const SKI_SNOW_FOOTPRINT = Object.freeze({ back: -1.85, front: 1.12, halfWidth: .235 });
// Keep profile breakpoints (especially the rising tip), with finer transverse
// samples at each ski edge and curved shoulder rather than a costly square grid.
const rows = [-1.85,-1.75,-1.65,-1.55,-1.45,-1.35,-1.25,-1.15,-1.05,-.95,-.87,
  -.82,-.77,-.72,-.63,-.54,-.46,-.36,-.27,-.17,-.08,.02,.11,.20,.30,.39,
  .48,.57,.67,.74,.81,.87,.92,.95,.98,1.02,1.07,1.12];
const longitudinalSteps = rows.length - 1, lateralSteps = 16;
const rowSize = lateralSteps + 1;
const { back, front, halfWidth } = SKI_SNOW_FOOTPRINT;
const span = front - back;
const smooth = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function skiSection(profile, s, channel) {
  if (s <= profile[0][0]) return profile[0][channel];
  for (let i = 1; i < profile.length; i++) {
    if (s > profile[i][0]) continue;
    const a = profile[i - 1], b = profile[i];
    const t = (s - a[0]) / (b[0] - a[0]);
    return a[channel] + (b[channel] - a[channel]) * t;
  }
  return profile.at(-1)[channel];
}

const profileWidths = new WeakMap();
function widthsFor(profile) {
  if (!profileWidths.has(profile)) profileWidths.set(profile, rows.map(s => skiSection(profile, s, 1) + .005));
  return profileWidths.get(profile);
}
const shoulderFractions = [0, .13, .34, .58, .8, 1];

function rockerAt(ski, projectedS) {
  const { profile } = ski;
  let a = profile[0], qa = a[0] + ski.rockerProjection * a[2];
  if (projectedS <= qa) return a[2];
  for (let i = 1; i < profile.length; i++) {
    const b = profile[i], qb = b[0] + ski.rockerProjection * b[2];
    if (projectedS <= qb) return THREE.MathUtils.lerp(a[2], b[2], (projectedS - qa) / (qb - qa));
    a = b; qa = qb;
  }
  return a[2];
}

function makeGeometry() {
  const count = (longitudinalSteps + 1) * rowSize;
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  }
  const indices = [];
  for (let row = 0; row < longitudinalSteps; row++) {
    for (let col = 0; col < lateralSteps; col++) {
      const a = row * rowSize + col;
      // Rows travel forward, columns travel to the skier's right.
      indices.push(a, a + rowSize, a + 1, a + 1, a + rowSize, a + rowSize + 1);
    }
  }
  geometry.setIndex(indices);
  return { geometry, baseNormals: new Float32Array(count * 3), drops: new Float32Array(count) };
}

export function createSkiSnowSurface({ snowMaps, heightAt, surfaceAt, sampleSurface, setCutout }) {
  const group = new THREE.Group();
  group.name = 'Pressed snow beneath weighted skis';
  const uniformData = {
    feet: [new THREE.Vector4(), new THREE.Vector4()],
    scale: [new THREE.Vector2(), new THREE.Vector2()],
  };
  const skis = [0, 1].map((index) => {
    const data = makeGeometry();
    const material = surfaceMaterial('snow', {
      vertexColors: true, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -1 - index,
    }, {
      ...snowMaps, skiSnow: { ...uniformData, mode: index + 1 },
    });
    const mesh = new THREE.Mesh(data.geometry, material);
    mesh.name = `Pressed ${index ? 'right' : 'left'} ski snow`;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    return {
      ...data, mesh, active: false, contact: new THREE.Vector3(), axis: new THREE.Vector3(),
      right: new THREE.Vector3(), drawnRight: new THREE.Vector3(), hasRight: false,
      horizontal: 1, rightX: 1, rightZ: 0,
      drawnAxis: new THREE.Vector3(), drawnSink: 0, sink: 0,
      depthRows: new Float32Array(longitudinalSteps + 1),
      crossGrade: 0, crossLong: 0, upY: 1, rockerProjection: 0,
    };
  });
  const cutoutMaterial = surfaceMaterial('snow', { vertexColors: true }, {
    ...snowMaps, skiSnow: { ...uniformData, mode: 0 },
  });
  const color = new THREE.Color(), normal = new THREE.Vector3(), surface = {};

  function skiDepth(ski, x, z, baseHeight) {
    if (!ski.active) return 0;
    const dx = x - ski.contact.x, dz = z - ski.contact.z;
    const s = (dx * ski.axis.x + dz * ski.axis.z) / (ski.horizontal * ski.horizontal);
    if (s <= back || s >= front) return 0;
    const acrossPoint = dx * ski.rightX + dz * ski.rightZ;
    const t = Math.abs(acrossPoint);
    if (t >= halfWidth) return 0;
    let row = Math.min(longitudinalSteps - 1, Math.floor((s - back) / span * longitudinalSteps));
    while (row > 0 && s < rows[row]) row--;
    while (row < longitudinalSteps - 1 && s > rows[row + 1]) row++;
    const u = (s - rows[row]) / (rows[row + 1] - rows[row]);
    const depth = ski.hasRight
      ? Math.max(0, Math.min(.19, baseHeight - ski.contact.y - ski.axis.y * s
        - ski.crossGrade * acrossPoint
        - rockerAt(ski, s - ski.crossLong * acrossPoint) / ski.upY + .004))
      : THREE.MathUtils.lerp(ski.depthRows[row], ski.depthRows[row + 1], u);
    const along = smooth(back, ski.profile[0][0], s) * (1 - smooth(ski.profile.at(-1)[0], front, s));
    const across = 1 - smooth(THREE.MathUtils.lerp(ski.rowWidths[row], ski.rowWidths[row + 1], u), halfWidth, t);
    return depth * along * across;
  }

  function depthAt(x, z, baseHeight) {
    if (!skis[0].active && !skis[1].active) return 0;
    const base = baseHeight ?? heightAt(x, z);
    return Math.max(skiDepth(skis[0], x, z, base), skiDepth(skis[1], x, z, base));
  }

  function drawSki(ski) {
    const position = ski.geometry.attributes.position;
    const colors = ski.geometry.attributes.color;
    ski.mesh.position.copy(ski.contact);
    for (let row = 0; row <= longitudinalSteps; row++) {
      const s = rows[row];
      const cx = ski.contact.x + ski.axis.x * s;
      const cz = ski.contact.z + ski.axis.z * s;
      const width = ski.rowWidths[row];
      const soft = smooth(.023,.071,ski.sink);
      const forebody = smooth(-.87,-.53,s) * (1 - smooth(.61,.94,s));
      for (let col = 0; col <= lateralSteps; col++) {
        const crossIndex = Math.abs(col - lateralSteps / 2);
        const side = Math.sign(col - lateralSteps / 2);
        const t = side * (crossIndex < 3 ? width * crossIndex / 3
          : width + (halfWidth - width) * shoulderFractions[crossIndex - 3]);
        const x = cx + ski.rightX * t, z = cz + ski.rightZ * t;
        const vertex = row * rowSize + col;
        const y = sampleSurface(x, z, color, normal);
        const drop = depthAt(x, z, y);
        // Under pressure the compact layer supports the base. Loose grains
        // above it fold over the edge and wash across part of the topsheet.
        const across = Math.abs(t);
        const curl = smooth(.19,.97,across / width) * (1 - smooth(width,width+.083,across));
        const drift = .78 + .22*Math.sin(s*8.1 + side*1.4 + .55*Math.sin(cx*.78+cz*.59));
        const looseLip = Math.min(drop,.047) * soft * forebody * curl * drift;
        position.setXYZ(vertex, x - ski.contact.x, y - drop + looseLip - ski.contact.y, z - ski.contact.z);
        colors.setXYZ(vertex, color.r, color.g, color.b);
        ski.baseNormals[vertex * 3] = normal.x;
        ski.baseNormals[vertex * 3 + 1] = normal.y;
        ski.baseNormals[vertex * 3 + 2] = normal.z;
        ski.drops[vertex] = drop;
      }
    }
    ski.geometry.computeVertexNormals();
    const normals = ski.geometry.attributes.normal;
    for (let i = 0; i < ski.drops.length; i++) {
      // At the join, use the exact normal sampled from the detailed terrain.
      // Inside the trench the actual curved geometry supplies its lighting.
      const mix = smooth(0, .008, ski.drops[i]);
      normal.fromBufferAttribute(normals, i).multiplyScalar(mix);
      normal.x += ski.baseNormals[i * 3] * (1 - mix);
      normal.y += ski.baseNormals[i * 3 + 1] * (1 - mix);
      normal.z += ski.baseNormals[i * 3 + 2] * (1 - mix);
      normal.normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    position.needsUpdate = colors.needsUpdate = normals.needsUpdate = true;
    ski.drawnAxis.copy(ski.axis);
    ski.drawnRight.copy(ski.right);
    ski.drawnSink = ski.sink;
  }

  function update(player, visible = true) {
    const rig = player?.rig;
    const enabled = visible && !!player?.grounded && !player.crash && !player.footMode && !player.riding;
    const board = player?.boarding ? rig?.boardContact : null;
    const runtimeProfile = (board ? board.profile : rig?.skiContact?.profile) ?? profile;
    let dirty = false;
    for (let i = 0; i < skis.length; i++) {
      const ski = skis[i];
      const point = board ? board.point : rig?.contactPoints?.[i];
      const axis = board ? board.axis : rig?.skiAxes?.[i];
      const sink = (board ? board.compression : rig?.skiSink?.[i]) ?? player?.snowSink ?? 0;
      const wasActive = ski.active;
      ski.active = !!(enabled && point && axis && sink > .001 && (board ? i === 0 : rig.skiPlanted?.[i] !== false)
        && surfaceAt(point.x, point.z, surface).id !== 'ice');
      if (ski.active) {
        ski.contact.copy(point);
        ski.axis.copy(axis).normalize();
        ski.horizontal = Math.hypot(ski.axis.x, ski.axis.z);
        ski.active = ski.horizontal > .25;
      }
      ski.mesh.visible = ski.active;
      dirty ||= wasActive !== ski.active;
      uniformData.scale[i].set(ski.active ? 1 / ski.horizontal : 1, Number(ski.active));
      if (!ski.active) continue;
      if (ski.profile !== runtimeProfile) {
        ski.profile = runtimeProfile;
        ski.rowWidths = widthsFor(runtimeProfile);
        dirty = true;
      }
      ski.rightX = ski.axis.z / ski.horizontal;
      ski.rightZ = -ski.axis.x / ski.horizontal;
      const right = board ? board.right : rig.skiRights?.[i];
      ski.hasRight = !!right;
      if (ski.hasRight) {
        ski.right.copy(right).normalize();
        const alongRight = (ski.right.x * ski.axis.x + ski.right.z * ski.axis.z) / ski.horizontal ** 2;
        const acrossRight = ski.right.x * ski.rightX + ski.right.z * ski.rightZ;
        ski.crossGrade = (ski.right.y - ski.axis.y * alongRight) / acrossRight;
        ski.crossLong = alongRight / acrossRight;
        ski.upY = Math.max(.25, ski.axis.z * ski.right.x - ski.axis.x * ski.right.z);
      } else {
        ski.right.set(ski.rightX, 0, ski.rightZ);
        ski.crossGrade = 0;
        ski.upY = ski.horizontal;
      }
      ski.rockerProjection = -ski.axis.y / ski.upY;
      dirty ||= ski.mesh.position.distanceToSquared(point) > .0003 ** 2
        || ski.drawnAxis.distanceToSquared(ski.axis) > .00015 ** 2
        || ski.drawnRight.distanceToSquared(ski.right) > .00015 ** 2
        || Math.abs(ski.drawnSink - sink) > .0003;
      ski.sink = sink;
      uniformData.feet[i].set(point.x, point.z, ski.axis.x / ski.horizontal, ski.axis.z / ski.horizontal);
    }
    setCutout(skis, cutoutMaterial);
    if (!dirty) return;
    for (const ski of skis) {
      if (!ski.active) continue;
      if (ski.hasRight) continue;
      const point = ski.contact;
      for (let row = 0; row <= longitudinalSteps; row++) {
        const s = rows[row];
        const x = point.x + ski.axis.x * s, z = point.z + ski.axis.z * s;
        // contactPoints are the transformed mid-sole (local y=-.013).
        // skiSection's rocker therefore locates the visible base above it.
        // Rocker lifts normal to the tilted ski. Invert its projected horizontal
        // shift before sampling, then put the bed just below the physical base.
        const projectedRocker = -ski.axis.y / ski.upY;
        let localS = s;
        for (let solve = 0; solve < 3; solve++) localS = s - projectedRocker * skiSection(ski.profile, localS, 2);
        const base = point.y + ski.axis.y * s + skiSection(ski.profile, localS, 2) / ski.upY - .004;
        ski.depthRows[row] = Math.max(0, Math.min(.19, heightAt(x, z) - base));
      }
    }
    for (const ski of skis) if (ski.active) drawSki(ski);
  }

  return { group, update, depthAt };
}
