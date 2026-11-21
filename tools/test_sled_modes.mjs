import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSledSegment, freshRun, freshRival, movingBalls, simulate, simulateRival,
  LANE, RACE_LENGTH, SLED_SEGMENT_LENGTH, STEP, snowHeight,
  sledDifficulty, steeringDistance, caveRoofHeight, houseRampHeight, fallState, featureX, featureRaise,
} from '../src/sled-course.js';

const SEED = 0x3ac09016;
const collections = ['gaps', 'treeRows', 'logs', 'balls', 'tokens', 'line', 'sections', 'features', 'rows'];

function courseTo(distance, seed, length = Infinity) {
  const course = Object.fromEntries(collections.map(key => [key, []]));
  for (let index = 0; index < Math.ceil(distance / SLED_SEGMENT_LENGTH); index++) {
    const segment = buildSledSegment(index, seed, length);
    for (const key of collections) course[key].push(...segment[key]);
  }
  return course;
}

function worldFor(course, length = Infinity, race = false) {
  return { course, treeRows: course.treeRows, balls: movingBalls(course), length, forgiving: true,
    pace: race ? 'race' : 'free' };
}

function blankCourse() {
  return Object.fromEntries(collections.map(key => [key, []]));
}

function playerAt(d, x = 0, speed = 33) {
  return { ...freshRun(), d, x, speed, y: snowHeight(x, d) };
}

function driveStep(run, world, controls = {}) {
  const result = simulate(run, world, action => !!controls[action], STEP);
  assert.equal(result, '', `Terminal collision at ${run.d.toFixed(2)} m: ${result}`);
}

test('procedural segments repeat by seed, vary across runs and extend beyond the race', () => {
  for (const index of [0, 1, 3, 11, 37]) {
    const segment = buildSledSegment(index, SEED);
    assert.deepEqual(segment, buildSledSegment(index, SEED));
    const another = buildSledSegment(index, SEED + 1);
    assert.notDeepEqual(segment.tokens, another.tokens);
    assert.equal(segment.start, index * SLED_SEGMENT_LENGTH);
    assert.equal(segment.end, (index + 1) * SLED_SEGMENT_LENGTH);
    assert.ok(segment.tokens.length > 0 && segment.gaps.length > 0);
    for (const gap of segment.gaps) {
      assert.ok(gap.start > segment.start && gap.end < segment.end && gap.end > gap.start, gap.name);
      assert.ok(gap.lanes.length > 0 && gap.lanes.every(lane => [-1, 0, 1].includes(lane)), gap.name);
    }
    assert.ok(segment.gaps.every((gap, i) => i === 0 || gap.start > segment.gaps[i - 1].end));
  }
});

test('sleds jump higher and a held jump still fires only once', t => {
  const legacyApex = 1.916; // Same start and controls before the 10.7 m/s jump impulse increased.
  const world = worldFor(blankCourse());
  const run = freshRun();
  let apex = 0;
  for (let frame = 0; frame < 150; frame++) {
    driveStep(run, world, { jump: true });
    apex = Math.max(apex, run.y - snowHeight(run.x, run.d));
  }
  assert.equal(run.hops, 1);
  assert.equal(run.air, null);
  assert.ok(apex > legacyApex * 1.18, `Old ${legacyApex.toFixed(2)} m, new ${apex.toFixed(2)} m`);
  t.diagnostic(`Jump apex ${legacyApex.toFixed(2)} m → ${apex.toFixed(2)} m`);
});

test('all sled hazard types slow the runner once and allow it to continue', () => {
  const hazards = {
    tree: { treeRows: [{ d: 12, x: 0, hit: 1.2, h: 22 }] },
    log: { logs: [{ d: 12, x: 0, radius: .46, halfWidth: 3.1 }] },
    snowball: { balls: [[12, 0, 4.8, 1.9]] },
    ravine: { gaps: [{ start: 12, end: 46, lanes: [1], name: 'Test crossing' }] },
  };
  for (const [name, entries] of Object.entries(hazards)) {
    const world = worldFor({ ...blankCourse(), ...entries });
    const run = playerAt(11, name === 'ravine' ? -LANE : 0, name === 'ravine' ? 14 : 33);
    for (let frame = 0; frame < 280 && !run.bumps; frame++) driveStep(run, world, { brake: name === 'ravine' });
    assert.equal(run.bumps, 1, name);
    assert.ok(run.recovery > 0, name);
    assert.ok(run.speed < 30, `${name} had no speed penalty`);
    const impactDistance = run.d;
    for (let frame = 0; frame < 340; frame++) driveStep(run, world, { tuck: true });
    assert.equal(run.bumps, 1, `${name} counted the same impact twice`);
    assert.equal(run.recovery, 0, name);
    assert.ok(run.d > impactDistance + 25 && run.speed > 27, `${name} stopped the run`);
  }
});

test('a free descent keeps generating playable terrain beyond the finite race distance', t => {
  const goal = RACE_LENGTH * 3;
  const run = freshRun();
  const course = courseTo(goal + SLED_SEGMENT_LENGTH, SEED);
  const world = worldFor(course);
  while (run.d < goal && run.elapsed < 750) {
    const village = course.sections.some(s => s.kind === 'village' && run.d > s.start - 30 && run.d < s.end);
    driveStep(run, world, village ? followGround(run, course) : { tuck: true });
  }
  assert.ok(run.d >= goal, `Endless run stopped at ${run.d.toFixed(1)} m`);
  assert.ok(run.bumps > 0, 'The generated hazards were never encountered');
  t.diagnostic(`${run.d.toFixed(0)} m with ${run.bumps} recovered obstacle hits`);
});

test('an overlapping rival does not trigger a player collision', () => {
  const course = courseTo(SLED_SEGMENT_LENGTH, SEED, RACE_LENGTH);
  const solo = worldFor(course, RACE_LENGTH, true);
  const rival = freshRival();
  const together = { ...worldFor(course, RACE_LENGTH, true), rival };
  const a = freshRun(), b = freshRun();
  for (let frame = 0; frame < 100; frame++) {
    rival.x = a.x;
    rival.d = a.d;
    driveStep(a, together, { tuck: true });
    simulateRival(rival, a, course, STEP);
    driveStep(b, solo, { tuck: true });
    assert.equal(a.bumps, 0);
    assert.equal(a.speed, b.speed);
    assert.equal(a.d, b.d);
  }
});

test('the regular race pace is about three minutes without tucking', t => {
  const run = freshRun();
  const course = courseTo(RACE_LENGTH, SEED, RACE_LENGTH);
  const world = worldFor(course, RACE_LENGTH, true);
  while (run.d < RACE_LENGTH && run.elapsed < 220) driveStep(run, world);
  assert.equal(run.d, RACE_LENGTH);
  assert.ok(run.elapsed > 170 && run.elapsed < 200, `Finished at ${run.elapsed.toFixed(2)} s`);
  t.diagnostic(`Default pace reached the finish in ${run.elapsed.toFixed(2)} s`);
});

test('a rider can beat the rival on a full marked course after a recoverable hit', t => {
  const course = courseTo(RACE_LENGTH, SEED, RACE_LENGTH);
  const world = worldFor(course, RACE_LENGTH, true);
  const run = freshRun();
  const rival = freshRival();
  const forcedHit = course.logs.find(log => log.d > 35);
  assert.ok(forcedHit, 'A generated log is needed for the recovery replay');
  let overlaps = 0;
  while (run.d < RACE_LENGTH && run.elapsed < 215) {
    const marker = course.tokens.find(token => !token.route && token.d > run.d + 8);
    const hitDistance = forcedHit.d - run.d;
    const tryingHit = !run.bumps && hitDistance > -2 && hitDistance < 50;
    const target = tryingHit ? forcedHit.x : marker?.x ?? 0;
    const error = target - run.x - run.dx * .13;
    const log = course.logs.find(item => item.d > run.d && item.d - run.d < run.speed * .26 && Math.abs(item.x - run.x) < 4.8);
    const lip = course.gaps.some(gap => gap.start > run.d && gap.start - run.d < 1.6);
    driveStep(run, world, { tuck: true, left: error < -.24, right: error > .24, jump: !tryingHit && !!(log || lip) });
    simulateRival(rival, run, course, STEP);
    if (Math.abs(run.d - rival.d) < .8) overlaps++;
  }
  assert.ok(run.bumps > 0, 'The generated replay did not hit a real obstacle');
  assert.equal(run.d, RACE_LENGTH);
  assert.ok(run.elapsed >= 147 && run.elapsed <= 205, `Race took ${run.elapsed.toFixed(2)} seconds`);
  assert.ok(rival.d < RACE_LENGTH, `Rival won a ${run.elapsed.toFixed(2)} s run with ${run.bumps} hits`);
  assert.ok(overlaps > 0, 'The player and opponent never ran alongside each other');
  t.diagnostic(`Finished in ${run.elapsed.toFixed(2)} s with ${run.bumps} hits and a ${(RACE_LENGTH - rival.d).toFixed(0)} m lead`);
});


function followGround(run, course) {
  const marker = course.tokens.find(t => !t.route && t.d > run.d + 8);
  const error = (marker?.x ?? 0) - run.x - run.dx * .13;
  const nearLip = course.gaps.some(g => g.start > run.d && g.start - run.d < 1.6);
  return { tuck: true, left: error < -.24, right: error > .24, jump: nearLip };
}

test('seeded obstacle rows preserve reaction distance, clearance and breather rows at maximum pace', t => {
  let rows = 0, earlyBlocks = 0, lateBlocks = 0, earlyRows = 0, lateRows = 0;
  for (let seed = 1; seed <= 64; seed++) {
    for (const index of [0, 1, 2, 3, 16, 17, 18, 19, 120, 121, 122, 123]) {
      const course = buildSledSegment(index, seed * 8021);
      if (course.sections[0].kind === 'river') assert.equal(course.rows[0].lane, 0);
      if (course.sections[0].kind === 'cave') assert.equal(course.gaps[0].lanes[0], -course.sections[0].roofExitSide);
      let prev, turns = 0, tight = 0;
      for (const row of course.rows) {
        rows++;
        assert.ok(!row.blockedLanes.includes(row.lane));
        assert.ok(row.blockedLanes.length <= 2);
        turns = row.lane === row.previousLane ? 0 : turns + 1;
        tight = row.blockedLanes.length < 2 ? 0 : tight + 1;
        assert.ok(turns <= 2 && tight <= 2);
        const dx = LANE * Math.abs(row.lane - row.previousLane);
        assert.ok(dx <= LANE);
        if (prev) assert.ok(row.d - prev.d >= 24 + steeringDistance(sledDifficulty(prev.d), dx) - 1e-6);
        if (index === 0) { earlyBlocks += row.blockedLanes.length; earlyRows++; }
        if (index === 120) { lateBlocks += row.blockedLanes.length; lateRows++; }
        const x = row.lane * LANE;
        for (const f of course.features.filter(f => f.d === row.d)) {
          if (f.kind === 'openHouse') assert.ok(f.doorHalfWidth > 2 && f.x === x);
          else assert.ok(Math.abs(f.x - x) > f.halfWidth + .82 + 1.5, f.kind);
        }
        for (const [d, side, , radius] of course.balls.filter(b => b[0] + 10 === row.d)) {
          assert.ok(Math.abs(side - x) - 3.75 - radius > 1.5, d);
        }
        prev = row;
      }
    }
  }
  assert.ok(lateBlocks / lateRows > earlyBlocks / earlyRows + .2);
  assert.ok(sledDifficulty(60000).speedGain > sledDifficulty(0).speedGain + 5);
  t.diagnostic(rows + ' rows sampled across 64 seeds and early, mid and late game');
});

test('playing the lower coin route at full tuck clears every biome at early and maximum difficulty', t => {
  let distance = 0;
  for (const seed of [7, 64, 802, 5150, 50934, 175930]) {
    for (const first of [0, 120]) {
      const run = playerAt(first * SLED_SEGMENT_LENGTH);
      run.elapsed = seed % 193;
      let jumps = 0;
      for (let index = first; index < first + 4; index++) {
        const course = buildSledSegment(index, seed);
        const world = worldFor(course);
        while (run.d < course.end) driveStep(run, world, followGround(run, course));
        jumps += course.gaps.length;
        assert.equal(run.bumps, 0, seed + ' ' + index + ' ' + run.recoveryHint);
        assert.equal(run.jumps, jumps, seed + ' ' + index);
        distance += SLED_SEGMENT_LENGTH;
      }
      assert.equal(run.flightPickups, 0);
    }
  }
  t.diagnostic(distance + ' m driven using the same steer, tuck and jump inputs as the game');
});

test('optional flight lands on the snowy cave crown and rejoins by ramp or a real airborne drop', () => {
  const course = buildSledSegment(1, 13);
  const cave = course.sections[0], f = course.features.find(f => f.kind === 'flightPickup');
  for (const dismount of [false, true]) {
    const run = playerAt(f.d - 5, f.x);
    const world = worldFor(course);
    let onRoof = false, airborneExit = false;
    while (run.d < cave.end - 2) {
      const steerOff = dismount && run.d > cave.tunnelEnd - 65 && Math.abs(run.x) > .6;
      driveStep(run, world, { left: steerOff && f.x > 0, right: steerOff && f.x < 0 });
      if (run.d > cave.tunnelStart + 8 && run.d < cave.tunnelEnd - 8) {
        assert.ok(Math.abs(run.y - snowHeight(run.x, run.d) - caveRoofHeight(cave, run.x, run.d)) < .02);
        onRoof = true;
      }
      if (run.d > cave.tunnelEnd && run.air) airborneExit = true;
    }
    assert.ok(onRoof);
    assert.equal(airborneExit, dismount);
    assert.equal(run.flightPickups, 1);
    assert.equal(run.upperRoute, null);
    assert.equal(run.bumps, 0);
    assert.ok(Math.abs(run.y - snowHeight(run.x, run.d)) < .02);
  }
});

test('falling debris warns before contact, stays clear between falls, and uses the rendered trajectory', () => {
  const course = buildSledSegment(1, 84);
  const falling = course.features.filter(f => f.kind.startsWith('falling'));
  assert.equal(new Set(falling.map(f => f.kind)).size, 3);
  for (const f of falling) {
    assert.ok(fallState(f, f.period + 1.18 - f.phase).height > fallState(f, f.period + 1.83 - f.phase).height);
    for (const [time, phase, bumps] of [[.3, 'warning', 0], [2.25, 'impact', 1], [3.4, 'idle', 0]]) {
      const run = playerAt(f.d - .4, f.x);
      run.elapsed = f.period + time - f.phase;
      assert.equal(fallState(f, run.elapsed).phase, phase);
      driveStep(run, worldFor(course));
      assert.equal(run.bumps, bumps, f.kind + ' ' + phase);
    }
  }
});

test('river hazards have a bypass and both full-width launches clear their far lip while braking', () => {
  const course = buildSledSegment(2, 84);
  const hazards = course.features;
  assert.equal(new Set(hazards.map(f => f.kind)).size, 4);
  for (const f of hazards) {
    const x = featureX(f, 0);
    const run = playerAt(f.d - .2, x);
    driveStep(run, worldFor(course));
    assert.equal(run.bumps, 1, f.kind);
  }
  for (const gap of course.gaps) {
    for (const x of [-14.8, 0, 14.8]) {
      const run = playerAt(gap.start - .5, x, 16);
      const world = worldFor(course);
      while (run.d < gap.end + 36) driveStep(run, world, { brake: true });
      assert.equal(run.bumps, 0, gap.name);
      assert.equal(run.jumps, 1, gap.name);
      assert.equal(run[gap.kind === 'riverEntry' ? 'riverEntries' : 'waterfallLaunches'], 1);
    }
  }
});

test('village passages, solid shutters and a rideable roof produce different outcomes', () => {
  const course = buildSledSegment(3, 147);
  const open = course.features.find(f => f.kind === 'openHouse');
  for (const [x, hits] of [[open.x, 0], [open.x + open.doorHalfWidth, 1]]) {
    const run = playerAt(open.d - open.halfDepth, x);
    driveStep(run, worldFor(course));
    assert.equal(run.bumps, hits);
  }
  const closed = course.features.find(f => f.kind === 'closedHouse');
  const solo = playerAt(closed.d - closed.halfDepth, closed.x);
  assert.match(simulate(solo, worldFor(course), () => false, STEP), /shuttered chalet/);
  const race = playerAt(closed.d - closed.halfDepth, closed.x);
  const raceWorld = worldFor(course, RACE_LENGTH, true);
  while (race.d < closed.d + 45) driveStep(race, raceWorld);
  assert.equal(race.bumps, 1);
  assert.equal(race.recovery, 0);
  const roof = course.features.find(f => f.kind === 'roofRamp');
  const run = playerAt(roof.rampStart - 3, roof.x);
  const world = worldFor(course);
  let deck = false, flying = false;
  while (run.d < roof.d + 69) {
    driveStep(run, world);
    if (Math.abs(run.d - roof.d) < 4) {
      assert.equal(houseRampHeight(roof, run.x, run.d), roof.height);
      assert.ok(Math.abs(run.y - snowHeight(run.x, run.d) - roof.height) < .02);
      deck = true;
    }
    if (run.roofLaunches && run.air) flying = true;
  }
  assert.ok(deck && flying);
  assert.equal(run.roofLaunches, 1);
  assert.equal(run.bumps, 0);
});


test('the coin line clears even synchronized cave impacts with delayed steering on ice', () => {
  for (const seed of [11, 88, 782, 3515]) {
    const course = buildSledSegment(1, seed);
    // Pin the contact phase so every falling volume is solid throughout this
    // replay. A delayed rider never needs an opening between debris phases.
    for (const f of course.features.filter(f => f.kind.startsWith('falling'))) {
      f.period = 4.8;
      f.phase = 0;
    }
    const run = playerAt(course.start);
    const world = worldFor(course);
    const wait = Array.from({ length: Math.ceil(.25 / STEP) }, () => ({ tuck: true }));
    let debrisContacts = 0;
    for (let n = 0; run.d < course.end && n < 4000; n++) {
      for (const f of course.features.filter(f => f.kind.startsWith('falling'))) {
        f.phase = f.period + 2.3 - (run.elapsed % f.period);
        if (Math.abs(run.d - f.d) < f.halfDepth) {
          assert.equal(fallState(f, run.elapsed).phase, 'impact');
          debrisContacts++;
        }
      }
      const controls = followGround(run, course);
      wait.push(controls);
      const delayed = wait.shift();
      driveStep(run, world, { ...delayed, jump: controls.jump });
    }
    assert.ok(debrisContacts > 0);
    assert.ok(run.d >= course.end);
    assert.equal(run.bumps, 0, run.recoveryHint);
    assert.equal(run.jumps, 1);
  }
});

test('cave ice increases uncapped ground pace while the roof and forest keep snow handling', () => {
  const course = buildSledSegment(1, 41);
  const cave = course.sections[0];
  const d = cave.tunnelStart + 24;
  const snow = { ...course, sections: [{ kind: 'forest', start: cave.start, end: cave.end }], features: [] };
  const iceWorld = worldFor({ ...course, features: [] }), snowWorld = worldFor(snow);
  const a = playerAt(d), b = playerAt(d);
  for (let i = 0; i < 110; i++) {
    driveStep(a, iceWorld);
    driveStep(b, snowWorld);
  }
  assert.ok(a.speed > b.speed + .65);
});


test('the solid cave exit bank deflects the lower rider once and leaves the opposite lane open', () => {
  const course = buildSledSegment(1, 249);
  const cave = course.sections[0];
  for (const [lane, hits] of [[cave.roofExitSide, 1], [-cave.roofExitSide, 0]]) {
    const run = playerAt(cave.tunnelEnd - 2, lane * LANE);
    const world = worldFor(course);
    while (run.d < cave.tunnelEnd + 74) driveStep(run, world);
    assert.equal(run.bumps, hits);
    if (hits) assert.match(run.recoveryHint, /cave exit bank/);
  }
});

test('a drifting ice floe uses its animated position and height for runner contact', () => {
  const course = buildSledSegment(2, 84);
  const ice = course.features.find(f => f.kind === 'iceChunk');
  assert.ok(ice);
  for (const sign of [-1, 1]) {
    const time = (Math.PI * (sign === 1 ? 2.5 : 3.5) - ice.phase) / .76;
    const x = ice.x + ice.halfWidth + .48;
    const run = playerAt(ice.d - .2, x);
    run.elapsed = time - STEP;
    assert.ok(Math.abs(featureX(ice, time) - ice.x - sign * .34) < .001);
    assert.ok(Math.abs(featureRaise(ice, time)) <= .07);
    driveStep(run, worldFor(course));
    assert.equal(run.bumps, sign === 1 ? 1 : 0);
  }
});


test('the introductory forest eases into free-ride speed while its first gap still clears without tucking', () => {
  const speeds = {};
  for (const tuck of [false, true]) {
    const run = freshRun();
    const samples = [];
    for (let index = 0; index < 4; index++) {
      const course = buildSledSegment(index, 741);
      const world = worldFor(course);
      const limits = [23, 816, 2230];
      while (run.d < course.end) {
        const controls = followGround(run, course);
        driveStep(run, world, { ...controls, tuck, jump: false });
        if (run.d >= limits[samples.length]) samples.push(run.speed);
      }
    }
    assert.equal(run.bumps, 0);
    assert.equal(run.jumps, 5);
    assert.ok(samples[0] < (tuck ? 29 : 24));
    assert.ok(samples[1] > samples[0] + 3 && samples[2] > samples[1] + 3);
    speeds[tuck ? 'tuck' : 'neutral'] = samples.map(s => Math.round(s * 3.6));
  }
  assert.ok(speeds.tuck[0] < 105);
});
