import * as THREE from 'three';
import { heightAt, normalAt } from './terrain.js';
import { RUNS } from './worlddata.js';
import { createSkier } from './skier.js';
import { guestClear, makeGuestPath, sampleGuestPath, turnDelta } from './guest-navigation.js';
import { box, mergedMesh } from './scenery.js';
import { clamp, makeTextTexture, smoothstep } from './util.js';

const SEARCH_RADIUS = 400;
const VIEW_RADIUS = 360;
const TRAILS = new Set([
  'Ego Bowl', 'Upper Whiskey Jack', 'Whiskey Jack', 'Green Acres', 'Olympic Run', 'Lower Olympic',
  'Saddle', 'Upper Peak to Creek', 'Dave Murray Downhill', 'Papoose', 'Franz’s Run', "Franz's Run",
  'Expressway', 'Springboard', 'Jersey Cream', 'Easy Out', 'Cruiser', 'Cloud Nine',
  'Panorama', 'Ridge Runner', 'Big Easy', 'Pony Trail', 'Hugh’s Heaven', "Hugh's Heaven",
  'Wishbone', 'Upper Fantastic', 'Lower Fantastic', 'Rainbow', 'Blackcomb Way', 'Burnt Stew Trail',
]);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const lerp = (a, b, t) => a + (b - a) * t;
const BOOT_STANCE = [new THREE.Vector3(-.20, .025, .09), new THREE.Vector3(.20, .025, -.06)];
const KNEEL_STANCE = [new THREE.Vector3(-.19, .025, .20), new THREE.Vector3(.17, .025, -.18)];
const KNEEL = { hipY: .54, hipZ: -.16, hinge: .58, gaze: -.08, feet: KNEEL_STANCE, grip: [.19, .45, .53] };
const PATIENT = { hipY: .86, hipZ: 0, hinge: .015, feet: BOOT_STANCE, grip: [.19, 1.03, .18] };
const TOW_FRONT = { skis: true, hipY: .80, hipZ: .08, hinge: .08, feet: BOOT_STANCE, grip: [.32, .85, -.32] };
const TOW_REAR = { skis: true, hipY: .75, hipZ: -.08, hinge: .27, feet: BOOT_STANCE, grip: [.22, .87, .46] };

function siteCandidates(env) {
  const sites = [];
  const clear = (p, pad) => guestClear(p.x, p.z, pad, env.queryColliders(p.x, p.z, 5), p.y ?? heightAt(p.x, p.z));
  const offset = (p, side, forward = 0) => {
    const x = p.x + Math.cos(p.heading) * side + Math.sin(p.heading) * forward;
    const z = p.z - Math.sin(p.heading) * side + Math.cos(p.heading) * forward;
    return { x, z, y: heightAt(x, z), heading: p.heading };
  };
  const direct = (a, b, pad) => {
    const length = distance(a, b), steps = Math.max(2, Math.ceil(length / 1.2));
    let previous = a.y;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t), y = heightAt(x, z);
      if (Math.abs(y - previous) > .48 + length / steps * .72 || !clear({ x, y, z }, pad)) return false;
      previous = y;
    }
    return true;
  };
  for (const run of RUNS) {
    if (!run.named || !run.samples || run.length < 250 || !(TRAILS.has(run.name) || ['green', 'blue'].includes(run.difficulty))) continue;
    if (/cat track|access|ascent|lift|crossover|hike/i.test(run.name)) continue;
    const a = run.samples[0], b = run.samples.at(-1);
    const forward = heightAt(a.x, a.z) > heightAt(b.x, b.z);
    const path = makeGuestPath(forward ? run.samples : [...run.samples].reverse());
    for (let eventD = 75; eventD < path.length - 150; eventD += 165) {
      const event = sampleGuestPath(path, eventD, {});
      if (sites.some(site => distance(site.park, event) < 104)) continue;
      const exitD = Math.min(path.length - 14, eventD + 230);
      for (const lane of [run.width * .18, -run.width * .18]) {
        const lanePoints = [];
        let clearLine = true;
        for (let d = eventD - 65; d <= exitD; d += 5) {
          const p = offset(sampleGuestPath(path, d, {}), lane);
          if (!clear(p, 1.18) || (lanePoints.length && Math.abs(p.y - lanePoints.at(-1).y) > 4.3)) {
            clearLine = false;
            break;
          }
          lanePoints.push(p);
        }
        if (!clearLine || event.y - lanePoints.at(-1).y < 15) continue;
        const lanePath = makeGuestPath(lanePoints);
        const incidentD = lanePath.nodes[13].d;
        const park = sampleGuestPath(lanePath, incidentD, {});
        const injury = offset(park, Math.sign(lane) * 2.1);
        if (!direct(park, injury, 1.03)) continue;
        let well;
        const trunks = env.queryColliders(park.x, park.z, 19).filter(c => c.type === 'tree')
          .map(tree => ({ tree, d: distance(park, tree) })).filter(({ d }) => d >= run.width * .29 && d < 18)
          .sort((a, b) => a.d - b.d);
        for (const { tree, d } of trunks) {
          const setback = clamp((tree.r + 1.4) / d, .13, .42);
          const x = lerp(tree.x, park.x, setback), z = lerp(tree.z, park.z, setback);
          const candidate = { x, z, y: heightAt(x, z) };
          if (direct(park, candidate, .84)) {
            well = { ...candidate, tree };
            break;
          }
        }
        sites.push({ path: lanePath, park, at: incidentD, injury, well, trail: run.name,
          pickupHeading: Math.atan2(injury.x - park.x, injury.z - park.z) });
        break;
      }
    }
  }
  return sites;
}

function uniformPatch(torso, rear) {
  const white = '#f2f0e5';
  const patch = new THREE.Group();
  patch.name = rear ? 'Back ski patrol cross' : 'Chest ski patrol cross';
  const width = rear ? .105 : .068, bar = width * .35;
  patch.add(mergedMesh([
    box(width, bar, .002, white),
    box(bar, width, .002, white),
  ], { roughness: .72 }));
  const texture = makeTextTexture('SKI PATROL', { width: 512, height: 112, bg: '#a71f25',
    fg: '#f7efe3', font: '700 63px Barlow Condensed,Arial' });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.65, width * .38),
    new THREE.MeshStandardMaterial({ map: texture, roughness: .75 }));
  label.position.set(0, -width * .73, .006);
  patch.add(label);
  patch.position.set(rear ? 0 : -.113, rear ? .354 : .353, rear ? -.259 : .119);
  patch.rotation.y = rear ? Math.PI : -.38;
  torso.add(patch);
}

function actor(jacket, patrol, companion, parent) {
  const frame = new THREE.Group();
  frame.name = patrol ? companion ? 'Ski patrol · tail guide' : 'Ski patrol · lead rescuer' : 'Guest receiving ski patrol assistance';
  const rig = createSkier({ jacket, helmet: patrol ? 0xd7d8cb : 0x414754, pants: 0x263039,
    backpack: 0xab272d, accessories: patrol });
  if (patrol) {
    uniformPatch(rig.torso, false);
    uniformPatch(rig.torso, true);
  }
  frame.add(rig.group);
  parent.add(frame);
  return { frame, rig };
}

function rescueSled(root) {
  const group = new THREE.Group();
  group.name = 'Rescue toboggan · raised runners, patient wrap and tie-down straps';
  const stations = [[-1.15, .24, .24], [-.91, .36, .10], [-.55, .405, .025], [.35, .40, .025], [.75, .35, .09], [1.10, .24, .28]];
  const vertices = [], indices = [];
  for (const [z, width, y] of stations) {
    vertices.push(-width, y + .27, z, -width * .77, y, z, 0, y - .015, z, width * .77, y, z, width, y + .27, z);
  }
  for (let r = 0; r < stations.length - 1; r++) for (let c = 0; c < 4; c++) {
    const a = r * 5 + c;
    indices.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  hull.setIndex(indices);
  hull.computeVertexNormals();
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0xc23324, roughness: .42, side: THREE.DoubleSide });
  const body = new THREE.Mesh(hull, hullMaterial);
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  const rail = new THREE.MeshStandardMaterial({ color: 0xd84c30, roughness: .36, metalness: .18 });
  for (const side of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3(stations.map(([z, width, y]) => new THREE.Vector3(side * width, y + .27, z)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(path, 28, .034, 7, false), rail));
  }
  group.add(mergedMesh([
    box(.48, .16, .14, '#c53a29', [0, .31, 1.08], [.24, 0, 0]),
    box(.45, .16, .16, '#c53a29', [0, .25, -1.12], [-.26, 0, 0]),
    box(.53, .075, 1.78, '#303c43', [0, .057, -.035]),
    box(.11, .035, 1.67, '#9ca8a7', [-.22, -.009, -.03]),
    box(.11, .035, 1.67, '#9ca8a7', [.22, -.009, -.03]),
  ], { roughness: .7, metalness: .13 }));
  const wrap = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 16),
    new THREE.MeshStandardMaterial({ color: 0xe2a83c, roughness: .89 }));
  wrap.position.set(0, .21, .16);
  wrap.scale.set(.30, .15, .72);
  wrap.castShadow = true;
  group.add(wrap);
  const straps = [-.34, .12, .53].map((z, i) => {
    const high = i === 0 ? .33 : .36;
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.37, .21, z), new THREE.Vector3(-.21, high - .01, z),
      new THREE.Vector3(.08, high + .02, z), new THREE.Vector3(.30, high - .06, z),
      new THREE.Vector3(.37, .21, z),
    ]);
    const strap = new THREE.Mesh(new THREE.TubeGeometry(path, 16, .024, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x2f373b, roughness: .84 }));
    strap.add(mergedMesh([box(.086, .031, .069, '#b3b5a9', [.08, high + .03, z])], { roughness: .4, metalness: .56 }));
    group.add(strap);
    return strap;
  });
  const bars = [0, 1, 2].map((_, i) => {
    const link = new THREE.Mesh(new THREE.CylinderGeometry(i === 2 ? .016 : .028, i === 2 ? .016 : .028, 1, 8),
      new THREE.MeshStandardMaterial({ color: i === 2 ? 0xdf9d2a : 0x495c63, roughness: .57, metalness: i === 2 ? 0 : .55 }));
    link.castShadow = true;
    root.add(link);
    return link;
  });
  root.add(group);
  return { group, wrap, straps, bars };
}

function snowHollow(parent) {
  const positions = [], colors = [], indices = [];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 28; i++) {
    const angle = i / 28 * Math.PI * 2;
    const radius = [.22, .69, 1.03][r] * (1 + .09 * Math.cos(angle * 5) + .04 * Math.sin(angle * 8));
    positions.push(Math.cos(angle) * radius, [.05, .19, .08][r] + .06 * Math.sin(angle * 3 + r), Math.sin(angle) * radius * 1.13);
    const intensity = [.45, .74, .94][r];
    colors.push(intensity * .72, intensity * .86, intensity * .96);
    if (r < 2) {
      const a = r * 28 + i, b = r * 28 + (i + 1) % 28;
      indices.push(a, b, a + 28, a + 28, b, b + 28);
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  surface.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  surface.setIndex(indices);
  surface.computeVertexNormals();
  const well = new THREE.Mesh(surface, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .99, side: THREE.DoubleSide }));
  parent.add(well);
  return well;
}

export function createSkiPatrol(scene, env) {
  const root = new THREE.Group();
  root.name = 'Whistler ski patrol';
  root.visible = false;
  scene.add(root);
  let cast;
  let sites, incident, elapsed = 0, cooldown = 4, proximity = 0, completed = 0;
  let phase = 'waiting';
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), basis = new THREE.Matrix4();
  const worldA = new THREE.Vector3(), worldB = new THREE.Vector3(), delta = new THREE.Vector3(), axis = new THREE.Vector3(0, 1, 0);
  const sample = {};

  function addCast() {
    const lead = actor(0xad242a, true, false, root);
    const tail = actor(0xa8262b, true, true, root);
    const patient = actor(0x3a6586, false, false, root);
    return { lead, tail, patient, sled: rescueSled(root), hollow: snowHollow(root) };
  }

  function orient(frame, p, heading, rise = 0) {
    frame.position.set(p.x, heightAt(p.x, p.z) + rise, p.z);
    normalAt(p.x, p.z, up);
    forward.set(Math.sin(heading), 0, Math.cos(heading));
    forward.addScaledVector(up, -forward.dot(up)).normalize();
    right.crossVectors(up, forward).normalize();
    frame.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, forward));
  }

  function pose(actor, p, heading, dt, { speed = 0, mount, walk = 0, tuck = 0, roll = 0, rise = 0, steer = 0 } = {}) {
    const { frame, rig } = actor;
    orient(frame, p, heading, rise);
    if (roll) frame.rotateX(roll);
    frame.updateMatrix();
    rig.animate(dt, { speed, mount, walk, footMode: !!walk, stridePhase: elapsed * 4.9, steer, tuck,
      brake: 0, airborne: false, grab: 0, crash: false, crashTime: 0 }, roll ? null : heightAt);
  }

  function along(site, d, lateral = 0) {
    sampleGuestPath(site.path, d, sample);
    return { x: sample.x + Math.cos(sample.heading) * lateral, z: sample.z - Math.sin(sample.heading) * lateral, heading: sample.heading };
  }

  function connect(bar, a, b) {
    delta.subVectors(b, a);
    bar.position.copy(a).addScaledVector(delta, .5);
    bar.quaternion.setFromUnitVectors(axis, delta.clone().normalize());
    bar.scale.y = delta.length();
  }

  function drawIncident(dt, time, camera) {
    const { site, pickup, treeWell } = incident;
    const { lead, tail, patient, sled, hollow } = cast;
    const arrived = (site.at + 5.8) / 7.4;
    const approachEnd = arrived + 5.4;
    const assistEnd = approachEnd + 7.2;
    const secureEnd = assistEnd + 5.6;
    const towingSpeed = 5.4;
    const towDistance = Math.max(0, time - secureEnd) * towingSpeed;
    const distanceGone = time >= secureEnd ? towDistance : 0;
    const focus = along(site, site.at + distanceGone);
    const range = Math.hypot(camera.position.x - focus.x, camera.position.z - focus.z);
    root.visible = range < VIEW_RADIUS;
    if (!root.visible) return time > secureEnd + (site.path.length - site.at - 5) / towingSpeed;
    lead.frame.visible = tail.frame.visible = patient.frame.visible = true;
    sled.group.visible = true;
    const load = clamp((time - (assistEnd - 2.1)) / 2.1, 0, 1);
    const secure = clamp((time - assistEnd) / 5.2, 0, 1);
    sled.wrap.visible = load > .9;
    for (const [i, strap] of sled.straps.entries()) strap.visible = secure > (i + 1) / 3.3;
    for (const bar of sled.bars) bar.visible = false;
    hollow.visible = treeWell;
    if (treeWell) {
      const wells = site.well;
      const foot = { x: lerp(wells.x, wells.tree.x, .35), z: lerp(wells.z, wells.tree.z, .35) };
      orient(hollow, foot, site.park.heading + .4, -.025);
    }
    const park = site.park, heading = park.heading;
    const patientHeading = treeWell ? Math.atan2(park.x - pickup.x, park.z - pickup.z) : heading + .08;
    const headTurn = turnDelta(patientHeading, heading);
    const carried = { x: lerp(pickup.x, park.x + Math.sin(heading) * .63, load), z: lerp(pickup.z, park.z + Math.cos(heading) * .63, load) };
    let bed = park;
    if (time < arrived) {
      phase = 'responding';
      for (const [i, responder] of [lead, tail].entries()) {
        const d = clamp(time * 7.4 - (i ? 3.5 : 0), 0, site.at + (i ? 2.15 : 0));
        const p = along(site, d, i ? 0 : .70);
        const speed = d >= site.at + (i ? 2.15 : 0) ? 0 : 7.4;
        pose(responder, p, p.heading, dt, { speed, mount: i ? TOW_FRONT : null, tuck: .18, steer: Math.sin(time * 1.1 + i) * .16 });
      }
      bed = along(site, clamp(time * 7.4 - 5.8, 0, site.at));
    } else if (time < secureEnd) {
      phase = time < approachEnd ? 'approaching' : time < assistEnd ? treeWell ? 'tree-well assistance' : 'assessing guest' : 'securing toboggan';
      for (const [i, responder] of [lead, tail].entries()) {
        const side = i ? 1 : -1;
        const walk = time < approachEnd ? clamp((time - arrived - i * .3) / 5, 0, 1) : 1;
        const retreat = load * .78;
        const working = { x: lerp(park.x, pickup.x, walk * (1 - retreat)) + Math.cos(heading) * side * .76,
          z: lerp(park.z, pickup.z, walk * (1 - retreat)) - Math.sin(heading) * side * .76 };
        const facing = time < approachEnd ? Math.atan2(pickup.x - working.x, pickup.z - working.z)
          : Math.atan2(carried.x - working.x, carried.z - working.z);
        const mount = time < approachEnd ? null : { ...KNEEL,
          hinge: .52 + .16 * Math.sin(time * 2.4 + i), grip: [.18 + secure * .07, .41 + .035 * Math.sin(time * 3), .50] };
        pose(responder, working, facing, dt, { speed: mount ? 0 : 1.1, walk: mount ? 0 : .68, mount });
      }
    } else {
      phase = 'towing';
      const d = site.at + towDistance;
      const pilot = along(site, d + 2.15), support = along(site, d - 2.15);
      bed = along(site, d);
      pose(lead, pilot, pilot.heading, dt, { mount: TOW_FRONT, speed: towingSpeed, steer: pilot.heading - bed.heading });
      pose(tail, support, support.heading, dt, { mount: TOW_REAR, speed: towingSpeed, steer: bed.heading - support.heading });
    }
    const angle = bed.heading;
    orient(sled.group, bed, angle, .06);
    sled.group.updateMatrix();
    if (time < arrived || time >= secureEnd) {
      const pulling = time < arrived ? tail : lead;
      for (const [i, side] of [-1, 1].entries()) {
        const bar = sled.bars[i];
        bar.visible = true;
        worldA.set(side * .32, .25, .90).applyMatrix4(sled.group.matrix);
        worldB.set(side * TOW_FRONT.grip[0], TOW_FRONT.grip[1], TOW_FRONT.grip[2]).applyMatrix4(pulling.frame.matrix);
        connect(bar, worldA, worldB);
      }
    }
    if (time >= secureEnd) {
      const onSled = { x: bed.x + Math.sin(angle) * .67, z: bed.z + Math.cos(angle) * .67 };
      pose(patient, onSled, angle, dt, { mount: PATIENT, roll: -Math.PI / 2, rise: .20 });
      sled.bars[2].visible = true;
      worldA.set(0, .23, -1.10).applyMatrix4(sled.group.matrix);
      worldB.set(0, TOW_REAR.grip[1], TOW_REAR.grip[2]).applyMatrix4(tail.frame.matrix);
      connect(sled.bars[2], worldA, worldB);
    } else {
      const assisting = smoothstep(approachEnd, assistEnd - 1.5, time);
      const tilt = treeWell ? lerp(-.77, -Math.PI / 2, assisting) : -Math.PI / 2;
      pose(patient, carried, patientHeading + headTurn * load, dt, { mount: PATIENT, roll: tilt,
        rise: lerp(treeWell ? -.20 : .055, .20, Math.max(assisting * .45, load)) });
    }
    return distanceGone > site.path.length - site.at - 6;
  }

  return {
    update(dt, player, camera, season) {
      if (!player || season === 'summer') { root.visible = false; return; }
      if (!dt) return;
      const p = player.pos;
      if (!incident) {
        cooldown -= dt;
        if (cooldown > 0) return;
        sites ??= siteCandidates(env);
        const nearby = sites.filter(site => distance(p, site.park) < SEARCH_RADIUS);
        if (!nearby.length) { cooldown = 2; return; }
        nearby.sort((a, b) => distance(p, a.park) - distance(p, b.park));
        const treeSites = nearby.filter(site => site.well).slice(0, 4);
        const treeWell = !!treeSites.length && Math.random() < .67;
        const candidates = treeWell ? treeSites : nearby.slice(0, 4);
        const site = candidates[Math.floor(Math.random() * candidates.length)];
        cast ??= addCast();
        incident = { site, treeWell, pickup: treeWell ? site.well : site.injury };
        elapsed = proximity = 0;
        phase = 'responding';
      }
      elapsed += dt;
      proximity = distance(p, incident.site.park);
      if (drawIncident(dt, elapsed, camera) || proximity > 720) {
        incident = null;
        phase = 'waiting';
        root.visible = false;
        completed++;
        cooldown = 55 + Math.random() * 65;
      }
    },
    debug() {
      return { phase, elapsed, proximity, completed, active: !!incident, visible: root.visible,
        trail: incident?.site.trail, treeWell: incident?.treeWell, site: incident?.site.park,
        sites: sites?.map(({ trail, park, well }) => ({ trail, x: park.x, z: park.z, treeWell: !!well })) };
    },
  };
}
