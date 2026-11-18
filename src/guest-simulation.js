import * as THREE from 'three';
import { climateUniforms } from './climate-state.js';
import { heightAt } from './terrain.js';
import { clamp, smoothstep } from './util.js';
import { createGuestNavigation, guestClear, makeGuestPath, sampleGuestPath, turnDelta } from './guest-navigation.js';

const STEP = 1 / 20;
const CELL = 12;
const GUEST_RADIUS = .48;
const mix = (a, b, t) => a + (b - a) * t;
const mod = (a, b) => ((a % b) + b) % b;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const bucketId = (x, z) => x * 32768 + z;
const angles = (heading, x, z, anchor) => ({
  x: anchor.x + Math.cos(heading) * x + Math.sin(heading) * z,
  z: anchor.z - Math.sin(heading) * x + Math.cos(heading) * z,
});
const poses = ['x', 'y', 'z', 'heading', 'speed', 'turn', 'recovery', 'seated', 'sip', 'stride'];
const statsTemplate = () => ({ boarded: 0, discharged: 0, completedLaps: 0, runChanges: 0, cafeVisits: 0, collisions: 0, recovered: 0 });

export function createGuestSimulation({ grid, lifts, queueSlots, interiors, person, people, parties, random }) {
  const nav = createGuestNavigation(grid), stations = [], routes = [], guests = [], cafes = new Map();
  const traffic = new Map(), trafficPool = [], routePoint = {}, renderPose = {};
  const cablePos = new THREE.Vector3(), tangent = new THREE.Vector3(), carrierState = {};
  let now, alpha = 0, stats = statsTemplate(), elapsed = 0;
  let warm = false, snowline = -Infinity;

  const stationPose = (station, id, time, out) => {
    const { lift } = station;
    if (lift.circulation) lift.circulation.at(time + id * station.headway, cablePos, tangent, carrierState);
    else lift.samplers[0].at(mod((time + id * station.headway) / station.cycle, 1), cablePos, tangent);
    out.x = cablePos.x;
    out.y = cablePos.y;
    out.z = cablePos.z;
    out.heading = Math.atan2(tangent.x, tangent.z);
    return out;
  };
  const onGround = p => ({ ...p, y: heightAt(p.x, p.z) });
  const outside = (p, pad = .55) => guestClear(p.x, p.z, pad, grid.query(p.x, p.z, 6), p.y);

  // Lodge routes use the playable door and floor/ramp service. The shared
  // table stop has several separate standing positions in the café aisle.
  const cafeRoutes = upper => {
    const nearby = (interiors?.rooms ?? []).filter(room => room.kind === 'cafe' && dist(upper, room.entry) < 220);
    const floorFor = room => (x, z) => interiors.walkSurfaceAt(x, z, room.y) ?? heightAt(x, z);
    for (const room of nearby.sort((a, b) => dist(upper, a.entry) - dist(upper, b.entry))) {
      const floor = floorFor(room);
      const approachLength=room.entrySteps ? room.entrySteps.steps*room.entrySteps.tread : room.rampLength;
      const ramp = angles(room.yaw, 0, approachLength + .5, room.entry);
      const approach = nav.transfer(upper, ramp, { floor, pad: .36, maxSlope: .8 });
      if (!approach) continue;
      const entry = nav.transfer(ramp, room.entry, { floor, pad: .30, maxSlope: .95 });
      if (!entry) continue;
      if (!cafes.has(room.id)) cafes.set(room.id, { name: room.name, spots: Array.from({ length: 4 }, () => ({ guest: null })) });
      const cafe = cafes.get(room.id);
      const spots = [-1.1, -.54, .54, 1.1].map((x, i) => {
        const target = angles(room.yaw, x, -5.7 - (i % 2) * 1.25, room.entry);
        const inside = nav.transfer(room.entry, target, { floor, pad: .30, maxSlope: .95 });
        if (!inside) return null;
        const points = [...approach, ...entry, ...inside];
        return { occupied: cafe.spots[i], in: makeGuestPath(points), out: makeGuestPath(points.reverse()), floor,
          face: room.yaw + (i < 2 ? Math.PI * .5 : -Math.PI * .5) };
      }).filter(Boolean);
      if (spots.length > 1) return { name: room.name, spots };
    }
    return null;
  };

  for (const lift of lifts?.lifts ?? []) {
    if (!lift.def.rideable || !lift.def.aerial || lift.def.type === 'p2p') continue;
    const chair = lift.def.type === 'chair', sampler = lift.samplers[0];
    const cycle = lift.circulation?.duration ?? sampler.total / lift.def.speed;
    const count = chair ? lift.perSide : lift.perSide * 2;
    const station = {
      lift, chair, cycle, count, headway: cycle / count, lanes: [],
      loadAt: chair ? .30 : -1.9,
      offAt: chair ? cycle - 1.55 : lift.circulation.sections[0].duration - 1.35,
      onDuration: chair ? .72 : 1.6,
      offDuration: chair ? 1.50 : 1.62,
    };
    const on = stationPose(station, 0, station.loadAt + .29, {});
    const off = stationPose(station, 0, station.offAt + station.offDuration, {});
    const upper = [-1, 1].map(side => onGround(angles(off.heading, side * (chair ? 2.9 : 1.9), chair ? 4.6 : .45, off)))
      .filter(p => outside(p));
    const slots = queueSlots.filter(s => s.liftId === lift.def.id);
    const firstLaneEnd = slots.find(s => s.slot === 3);
    if (!firstLaneEnd || !upper.length) continue;
    for (const [x, z] of [[0, -3.6], [0, -5.8], [2.5, -3.6], [-2.5, -3.6], [0, -1.7], [0, -8]]) {
      const lower = onGround(angles(firstLaneEnd.heading, x, z, firstLaneEnd));
      if (!outside(lower, .8) || upper.every(p => p.y - lower.y < 60)) continue;
      const bottom = nav.anchors(lower, 98);
      if (!bottom.length) continue;
      for (const p of upper) {
        const fromTop = nav.anchors(p, 90);
        const laps = nav.laps(fromTop, bottom, p, lower);
        if (!laps.length) continue;
        Object.assign(station, { lower, upper: p, laps });
        break;
      }
      if (station.laps) break;
    }
    if (!station.laps) continue;
    const laneCount = Math.min(chair ? lift.def.seats || 4 : 3, 3);
    for (let i = 0; i < laneCount; i++) {
      const row = slots.filter(s => (s.slot / 4 | 0) === i).sort((a, b) => b.slot - a.slot);
      if (row.length !== 4 || row.some(p => !outside(p, .37))) continue;
      const back = [-3.6, -2.2, -1.1].map(z => onGround(angles(row[0].heading, 0, z, row[0]))).find(p => outside(p));
      if (!back) continue;
      const entrance = nav.transfer(station.lower, back, { pad: .38, maxSlope: .85 });
      const front = angles(row[3].heading, 0, 2.3, row[3]);
      const near = angles(on.heading, chair ? -(laneCount - 1 - i) * .51 - .20 : -1.33 - i * .33, chair ? .3 : -.27 * i, on);
      const gate = nav.transfer(front, near, { pad: .37, maxSlope: 1.05 });
      if (!entrance || !gate) continue;
      const path = makeGuestPath([...entrance, ...row, front, ...gate]);
      station.lanes.push({ index: i, path, queue: [], station });
    }
    if (!station.lanes.length) continue;
    station.cafe = cafeRoutes(station.upper);
    stations.push(station);
    routes.push(...station.laps);
  }

  const setPath = (p, state, path, progress = 0) => {
    p.state = state;
    p.path = path;
    p.progress = progress;
  };
  const selectRun = (p, count) => {
    const options = p.party.options;
    return options[(p.party.start + count) % options.length];
  };
  const joinLane = (p, preferred) => {
    const lane = preferred ?? p.station.lanes.reduce((a, b) => a.queue.length <= b.queue.length ? a : b);
    lane.queue.push(p);
    p.lane = lane;
    setPath(p, 'queue', lane.path);
  };
  const leaveLane = p => {
    const i = p.lane.queue.indexOf(p);
    if (i !== -1) p.lane.queue.splice(i, 1);
  };
  const startLap = p => {
    const previous = p.route;
    p.route = selectRun(p, p.laps);
    if (previous.name !== p.route.name) stats.runChanges++;
    p.ride = null;
    setPath(p, 'skiing', p.route);
  };
  const snapGround = (p, path, progress) => {
    sampleGuestPath(path, progress, p);
    p.y = heightAt(p.x, p.z) + .018;
    p.stride = p.progress;
  };
  const flushPose = p => {
    p.previous ??= {};
    for (const k of poses) p.previous[k] = p[k];
  };
  const seed = () => {
    stats = statsTemplate();
    for (const station of stations) {
      for (const lane of station.lanes) lane.queue.length = 0;
    }
    for (const cafe of cafes.values()) for (const spot of cafe.spots) spot.guest = null;
    for (const p of guests) {
      p.route = p.initialRoute;
      p.laps = 0;
      p.liftsRidden = 0;
      p.cafeReady = true;
      p.crashTime = 0;
      p.immunity = 0;
      p.ride = null;
      p.cafe = null;
      p.rest = false;
      p.foot = false;
      p.turn = p.recovery = p.seated = p.sip = p.avoidOffset = 0;
      if (p.homeLane) {
        joinLane(p, p.homeLane);
        p.progress = p.path.length - p.queueOrder * 2.55 - 2;
        p.speed = 0;
      } else {
        setPath(p, 'skiing', p.route, p.initialProgress);
        p.speed = p.cruise;
      }
      snapGround(p, p.path, p.progress);
      flushPose(p);
    }
  };

  for (const station of stations) {
    const bySkill = {};
    for (const path of station.laps) (bySkill[path.skill] ??= []).push(path);
    const addParty = (skill, count, lane) => {
      const skillRoutes = bySkill[skill], names = new Map();
      for (const r of [...skillRoutes, ...station.laps.filter(p => p.skill === 'green' || p.skill === 'blue' && skill === 'black')]) {
        if (!names.has(r.name)) names.set(r.name, r);
      }
      const options = [...names.values()], start = Math.floor(random() * options.length), route = options[start];
      const party = { id: parties.length, options, start, members: [], kind: 'lap', topic: Math.floor(random() * 6) };
      const phase = .03 + random() * .94;
      const speed = skill === 'green' ? 5.3 : skill === 'blue' ? 8.7 : 13.4;
      for (let i = 0; i < count; i++) {
        const personProgress = clamp(route.length * phase + (i - 1) * 7.5, 4, route.length - 12);
        const p = person({ kind: 'lap', party, station, skill, index: i, homeLane: lane, queueOrder: i + 1,
          initialRoute: route, initialProgress: personProgress, cruise: speed + random() * 1.1, weave: (i - 1) * .44 });
        party.members.push(p);
        guests.push(p);
      }
      parties.push(party);
    };
    const skills = Object.keys(bySkill);
    for (const lane of station.lanes) addParty(skills[lane.index % skills.length], 2, lane);
    const partiesOnRun = Math.min(12, Math.max(3, Math.floor(station.laps[0].length / 135)));
    for (let i = 0; i < partiesOnRun; i++) addParty(skills[i % skills.length], 2 + Math.floor(random() * 2));
  }
  seed();
  const circuits = stations.map(s => ({
    lift: s.lift.def.name, runs: [...new Set(s.laps.map(r => r.name))], cafe: s.cafe?.name ?? null,
  }));

  const groundY = (p, x, z) => p.cafe?.floor(x, z) ?? heightAt(x, z);
  const footState = p => !!p.cafe || (!p.station.chair && p.state !== 'skiing') || (warm && p.y < snowline);
  const move = (p, target, speedLimit, dt, weave) => {
    const path = p.path;
    const point = sampleGuestPath(path, p.progress, routePoint);
    const remaining = Math.max(0, target - p.progress);
    const desired = Math.min(speedLimit / (1 + point.bend * 1.7), Math.sqrt(remaining * 6.8));
    const dv = (desired < p.speed ? 3.4 : 2.2) * dt;
    p.speed += clamp(desired - p.speed, -dv, dv);
    const travel = Math.min(remaining, p.speed * dt);
    p.progress += travel;
    p.stride += travel;
    sampleGuestPath(path, p.progress, point);
    const amplitude = Math.min(1, p.progress / 9, (path.length - p.progress) / 15) * Math.min(1, p.speed / 4);
    p.avoidOffset += ((p.avoidSide || 0) - p.avoidOffset) * (1 - Math.exp(-dt * 2.6));
    const turn = p.weave + Math.sin(p.progress / (p.skill === 'green' ? 9 : 17) + p.party.id) * .53;
    const edge = weave ? clamp(turn + p.avoidOffset, -1.10, 1.10) * amplitude : 0;
    p.turn = edge;
    p.x = point.x - Math.cos(point.heading) * edge;
    p.z = point.z + Math.sin(point.heading) * edge;
    p.y = groundY(p, p.x, p.z) + .018;
    p.heading += clamp(turnDelta(p.heading, point.heading + edge * .20), -dt * 2.9, dt * 2.9);
    return remaining < .028 && p.speed < .16;
  };
  const seatPose = (p, time, out) => {
    const station = p.station;
    stationPose(station, p.ride.id, time, out);
    let across = p.ride.seat, along;
    if (station.chair) {
      out.y -= 2.13 + .53 * p.height;
      along = .08;
    } else {
      out.y -= 3.09;
      along = -.42 + p.lane.index * .42;
    }
    out.x += Math.cos(out.heading) * across + Math.sin(out.heading) * along;
    out.z += -Math.sin(out.heading) * across + Math.cos(out.heading) * along;
    out.seated = station.chair ? 1 : .34;
    return out;
  };
  const riderPose = (p, time, out) => {
    const ride = p.ride, station = p.station;
    seatPose(p, time, out);
    const cabinY=out.y, cabinHeading=out.heading;
    let fraction;
    if (p.state === 'boarding') {
      fraction = smoothstep(0, station.onDuration, time - ride.start);
      out.x = mix(ride.from.x, out.x, fraction);
      out.y = mix(ride.from.y, out.y, fraction);
      out.z = mix(ride.from.z, out.z, fraction);
      out.heading = ride.from.heading + turnDelta(ride.from.heading, out.heading) * fraction;
      out.seated *= fraction;
    } else if (p.state === 'unloading') {
      fraction = smoothstep(0, station.offDuration, time - ride.exit);
      out.x = mix(out.x, station.upper.x, fraction);
      out.y = mix(out.y, station.upper.y + .018, fraction);
      out.z = mix(out.z, station.upper.z, fraction);
      const exitHeading = station.laps[0].nodes[0].heading;
      out.heading += turnDelta(out.heading, exitHeading) * fraction;
      out.seated *= 1 - fraction;
    }
    if(!station.chair&&fraction!==undefined){
      const boarding=p.state==='boarding', c=Math.cos(cabinHeading), s=Math.sin(cabinHeading);
      const dx=out.x-cablePos.x,dz=out.z-cablePos.z;
      const across=Math.abs(dx*c-dz*s), along=dx*s+dz*c;
      const platformY=boarding?ride.from.y:station.upper.y+.018;
      // Approach the center of the moving doorway and step up to the cabin
      // floor before the rider's boots reach the threshold.
      const withinDoors=1-smoothstep(.18,.54,Math.abs(across-.98));
      const toCenter=(clamp(along,-.17,.17)-along)*withinDoors;
      out.x+=s*toCenter;out.z+=c*toCenter;
      out.y=mix(cabinY,platformY,smoothstep(.98,1.33,across));
      const phase=boarding?clamp((time-ride.start)/station.onDuration,0,1):clamp((time-ride.exit)/station.offDuration,0,1);
      out.stride=ride.from.stride+(boarding?phase:phase+1)*1.4;
      out.speed=6*phase*(1-phase)*1.05;
    }
    return out;
  };
  const descend = p => {
    const station = p.station;
    const spot = station.cafe?.spots.find(s => !s.occupied.guest);
    if (spot && p.cafeReady) {
      p.cafe = spot;
      spot.occupied.guest = p;
      p.cafeReady = false;
      setPath(p, 'cafe-in', spot.in);
    } else {
      p.cafeReady = true;
      startLap(p);
    }
  };
  const updateRider = (p, t) => {
    const { station, ride } = p;
    if (p.state === 'boarding' && t >= ride.start + station.onDuration) {
      p.state = 'riding';
      p.speed = 0;
      stats.boarded++;
    }
    if (p.state === 'riding' && t >= ride.exit) p.state = 'unloading';
    riderPose(p, t, p);
    if (p.state === 'unloading' && t >= ride.exit + station.offDuration) {
      p.x = station.upper.x;
      p.z = station.upper.z;
      p.y = station.upper.y + .018;
      p.seated = 0;
      stats.discharged++;
      p.liftsRidden++;
      descend(p);
    }
  };
  const updateGuest = (p, t, dt) => {
    flushPose(p);
    p.foot = footState(p);
    if (p.crashTime > 0) {
      p.crashTime = Math.max(0, p.crashTime - dt);
      if (p.path && p.speed > .1) move(p, p.path.length, 0, dt, p.state === 'skiing');
      const age = 2.65 - p.crashTime;
      p.recovery = smoothstep(0, .43, age) * (1 - smoothstep(1.54, 2.65, age));
      if (!p.crashTime) stats.recovered++;
      return;
    }
    if (p.state === 'skiing') {
      const speed = Math.min(p.foot ? 1.65 : p.cruise, p.trafficPace ?? Infinity);
      if (move(p, p.path.length, speed, dt, !p.foot)) {
        stats.completedLaps++;
        p.laps++;
        joinLane(p);
      }
    } else if (p.state === 'queue') {
      const i = p.lane.queue.indexOf(p);
      const other = i > 0 ? p.lane.queue[i - 1] : null;
      const stop = other ? Math.max(0, other.progress - 2.25) : p.path.length;
      const staged = move(p, stop, p.foot ? 1.63 : 2.35, dt, false);
      const hold = p.station;
      const event = Math.floor((t - hold.loadAt + .000001) / hold.headway);
      const eventTime = hold.loadAt + event * hold.headway;
      if (staged && !other && t - eventTime < dt + .00001 && p.lane.lastEvent !== event) {
        p.lane.lastEvent = event;
        const id = mod(-event, hold.count);
        const seat = hold.chair ? (p.lane.index - (hold.lanes.length - 1) * .5) * .51 : -.13;
        p.ride = { start: eventTime, exit: eventTime - hold.loadAt + hold.offAt, id, seat,
          from: { x: p.x, y: p.y, z: p.z, heading: p.heading, stride: p.stride } };
        p.state = 'boarding';
        p.speed = 0;
        leaveLane(p);
      }
    } else if (p.state === 'cafe-in') {
      if (move(p, p.path.length, 1.62, dt, false)) {
        p.state = 'cafe';
        p.rest = true;
        p.restStart = t;
        stats.cafeVisits++;
      }
    } else if (p.state === 'cafe') {
      const age = t - p.restStart;
      p.heading += clamp(turnDelta(p.heading, p.cafe.face), -dt * 2, dt * 2);
      p.sip = smoothstep(.45, 1.15, age % 5.2) * (1 - smoothstep(1.7, 2.45, age % 5.2));
      if (age > 19 + p.index * 1.8) {
        p.rest = false;
        p.sip = 0;
        setPath(p, 'cafe-out', p.cafe.out);
      }
    } else if (p.state === 'cafe-out') {
      if (move(p, p.path.length, 1.62, dt, false)) {
        p.cafe.occupied.guest = null;
        p.cafe = null;
        startLap(p);
      }
    } else if (p.ride) updateRider(p, t);
  };
  const groundedGuest = p => p.kind !== 'lap' || p.state === 'skiing' || p.state === 'queue'
    || p.state === 'cafe-in' || p.state === 'cafe' || p.state === 'cafe-out';
  const rebuildTraffic = density => {
    for (const list of traffic.values()) { list.length = 0; trafficPool.push(list); }
    traffic.clear();
    for (const p of people) {
      p.trafficPace = Infinity;
      p.avoidSide = 0;
      if (p.seed > density || !groundedGuest(p)) continue;
      p.ground = p.y ?? heightAt(p.x, p.z) + .018;
      const key = bucketId(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      if (!traffic.has(key)) traffic.set(key, trafficPool.pop() ?? []);
      traffic.get(key).push(p);
    }
    for (const p of guests) {
      if (p.state !== 'skiing' || p.seed > density) continue;
      const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
        const cell = traffic.get(bucketId(x, z));
        if (!cell) continue;
        for (const other of cell) {
          if (other === p || Math.abs(p.ground - other.ground) > 1.5) continue;
          const dx = other.x - p.x, dz = other.z - p.z, ahead = dx * fx + dz * fz;
          if (ahead <= 0 || ahead >= 15 || Math.abs(dx * fz - dz * fx) > 1.30) continue;
          const crossing = other.state === 'skiing' && Math.cos(p.heading - other.heading) < .35;
          if (crossing) {
            p.avoidSide = -.65;
            if (p.id < other.id) continue;
          }
          const otherSpeed = other.state === 'skiing' && !other.crashTime ? other.speed : 0;
          const limit = Math.sqrt(otherSpeed ** 2 + Math.max(0, ahead - 2.2) * 5.7);
          p.trafficPace = Math.min(p.trafficPace, limit);
        }
      }
    }
  };
  const step = (t, dt, density) => {
    for (const p of guests) updateGuest(p, t, dt);
    for (const p of people) if (p.kind !== 'lap' && p.crashTime > 0) {
      p.crashTime = Math.max(0, p.crashTime - dt);
      const age = 2.65 - p.crashTime;
      p.recovery = smoothstep(0, .43, age) * (1 - smoothstep(1.54, 2.65, age));
      if (!p.crashTime) stats.recovered++;
    }
    rebuildTraffic(density);
  };

  return {
    routes, stations, cafes,
    reset() {
      seed();
      for (const station of stations) for (const lane of station.lanes) lane.lastEvent = undefined;
      for (const p of people) if (p.kind !== 'lap') p.crashTime = p.recovery = p.immunity = 0;
      now = undefined;
      elapsed = alpha = 0;
      traffic.clear();
    },
    advance(time, density) {
      warm = climateUniforms.snowpack.value < .8;
      snowline = climateUniforms.snowline.value + 100;
      if (now === undefined || time < now) {
        now = time;
        rebuildTraffic(density);
      }
      // Use the actual carrier clock for the per-frame pose, with fixed steps
      // for terrain movement and decisions. Brief rAF gaps still cross events.
      const limit = Math.min(time, now + .25);
      while (now + STEP <= limit + 1e-8) {
        now += STEP;
        elapsed += STEP;
        step(now, STEP, density);
      }
      if (time > now + .4) {
        const skipped = time - now;
        for (const p of guests) if (p.ride) {
          // Leave at the actual terminal on a long inactive-tab gap instead
          // of following a departing carrier back around past the unload.
          if (now < p.ride.exit && time > p.ride.exit) updateRider(p, p.ride.exit + p.station.offDuration);
        } else if (p.state === 'cafe') p.restStart += skipped;
        now = time;
      }
      alpha = clamp((time - now) / STEP, 0, 1);
    },
    pose(p, time) {
      if (p.kind !== 'lap') {
        p.seasonFoot = warm && (p.y ?? p.ground) < snowline;
        return p;
      }
      Object.assign(renderPose, p);
      if (p.ride && !groundedGuest(p)) {
        // Directly sample the same carrier at this render instant. Interpolating
        // a stale simulation step would leave riders behind fast chairs.
        const at = clamp(time, p.ride.start, p.ride.exit + p.station.offDuration);
        return riderPose(p, at, renderPose);
      }
      for (const k of poses) renderPose[k] = mix(p.previous[k], p[k], alpha);
      renderPose.heading = p.previous.heading + turnDelta(p.previous.heading, p.heading) * alpha;
      return renderPose;
    },
    hitPlayer(previous, current, dt, density) {
      if (!(dt > 0) || now === undefined || density <= 0) return null;
      const dx = current.x - previous.x, dz = current.z - previous.z, length2 = dx * dx + dz * dz;
      // Position resets and lift transitions are discontinuous by design.
      if (!Number.isFinite(length2) || length2 > 64) return null;
      const radius = .53, vx = dx / dt, vz = dz / dt;
      const minX = Math.floor((Math.min(previous.x, current.x) - radius) / CELL);
      const maxX = Math.floor((Math.max(previous.x, current.x) + radius) / CELL);
      const minZ = Math.floor((Math.min(previous.z, current.z) - radius) / CELL);
      const maxZ = Math.floor((Math.max(previous.z, current.z) + radius) / CELL);
      let hit = null, first = Infinity;
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        for (const p of traffic.get(bucketId(x, z)) ?? []) {
          if (p.seed > density || p.crashTime > 0 || (p.immunity ?? 0) > now) continue;
          const px = p.kind === 'lap' ? mix(p.previous.x, p.x, alpha) : p.x;
          const pz = p.kind === 'lap' ? mix(p.previous.z, p.z, alpha) : p.z;
          const py = p.kind === 'lap' ? mix(p.previous.y, p.y, alpha) : p.ground;
          const f = length2 > 1e-8 ? clamp(((px - previous.x) * dx + (pz - previous.z) * dz) / length2, 0, 1) : 0;
          const y = mix(previous.y, current.y, f);
          if (y - py > 1.22 * p.height || py - y > .85) continue;
          if ((previous.x + dx * f - px) ** 2 + (previous.z + dz * f - pz) ** 2 > radius ** 2) continue;
          const pace = p.kind === 'lap' ? p.speed : 0;
          if (Math.hypot(vx - Math.sin(p.heading) * pace, vz - Math.cos(p.heading) * pace) < 8.4) continue;
          if (f < first) { first = f; hit = p; }
        }
      }
      if (hit) {
        hit.immunity = now + 5.5;
        hit.crashTime = 2.65;
        stats.collisions++;
      }
      return hit;
    },
    debug() {
      const states = {};
      for (const p of guests) states[p.state] = (states[p.state] ?? 0) + 1;
      return { ...stats, elapsed, states, circuits };
    },
  };
}
