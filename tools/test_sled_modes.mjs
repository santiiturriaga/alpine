import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSledSegment, freshRun, freshRival, movingBalls, simulate, simulateRival,
  LANE, RACE_LENGTH, SLED_SEGMENT_LENGTH, STEP, snowHeight,
} from '../src/sled-course.js';

const SEED = 0x3ac09016;
const collections = ['gaps', 'treeRows', 'logs', 'balls', 'tokens', 'line'];

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
    ...(race ? { pace: 'race' } : {}) };
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
  while (run.d < goal && run.elapsed < 750) driveStep(run, world, { tuck: true });
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
    const marker = course.tokens.find(token => token.d > run.d + 8);
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
