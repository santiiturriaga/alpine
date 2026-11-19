import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCourse, freshRun, simulate, points, movingBalls, GAPS, STEP, LENGTH, LANE, snowHeight } from '../src/sled-course.js';

function setup(day) {
  const course = buildCourse(day);
  return { run: freshRun(), world: { course, treeRows: course.treeRows, balls: movingBalls(course) } };
}

// Drive using only steering, tuck and jump. The target is the upcoming visible
// marker. Replaying the same inputs at the same fixed step must reach the tape.
export function drive(day, frames) {
  const { world, run } = setup(day);
  while (run.d < LENGTH && run.elapsed < 95) {
    const marker = world.course.tokens.find(t => t.d > run.d + 8);
    const error = (marker?.x ?? 0) - run.x - run.dx * .13;
    const steer = Math.abs(error) > .24 ? Math.sign(error) : 0;
    const log = world.course.logs.find(l => l.d > run.d && l.d - run.d < run.speed * .26 && Math.abs(l.x - run.x) < 4.8);
    const ramp = GAPS.some(g => g.start > run.d && g.start - run.d < 1.6);
    const jump = Number(!!(log || ramp));
    frames?.push([steer, jump]);
    const input = k => k === 'tuck' || (k === 'left' && steer < 0) || (k === 'right' && steer > 0) || (k === 'jump' && jump === 1);
    const crash = simulate(run, world, input, STEP);
    assert.equal(crash, '', day + ' at ' + run.d.toFixed(1) + ' m: ' + crash);
  }
  assert.equal(run.d, LENGTH);
  assert.equal(run.jumps, GAPS.length);
  assert.ok(run.tokens >= world.course.tokens.length * .65);
  return run;
}

test('a month of marked daily lines can be driven from start to finish', () => {
  for (let day = 1; day <= 31; day++) drive('2026-12-' + String(day).padStart(2, '0'));
});

test('daily layouts repeat on retry and vary by date', () => {
  const course = buildCourse('2026-11-19');
  assert.deepEqual(buildCourse('2026-11-19'), course);
  assert.notDeepEqual(buildCourse('2026-11-20').logs, course.logs);
});

test('a held jump lifts the runners, lands and stays grounded until released', () => {
  const { run, world } = setup('2026-11-19');
  let maxHeight = 0;
  for (let i = 0; i < 95; i++) {
    assert.equal(simulate(run, world, k => k === 'jump', STEP), '');
    maxHeight = Math.max(maxHeight, run.y - snowHeight(run.x, run.d));
  }
  assert.ok(maxHeight > .9);
  assert.equal(run.air, null);
  assert.equal(run.hops, 1);
  simulate(run, world, () => false, STEP);
  simulate(run, world, k => k === 'jump', STEP);
  assert.equal(run.hops, 2);
});

test('a log can be jumped, bypassed at an end or struck head-on', () => {
  for (const [offset, hop, expected] of [[0, false, 'Clipped'], [0, true, ''], [5, false, '']]) {
    const { run, world } = setup('2026-11-19');
    const log = world.course.logs[0];
    run.d = log.d - 8;
    run.speed = 33;
    run.x = log.x + offset;
    run.y = snowHeight(run.x, run.d);
    let crash = '';
    while (!crash && run.d < log.d + 3) crash = simulate(run, world, k => k === 'jump' && hop, STEP);
    assert.ok(expected ? crash.includes(expected) : !crash, crash);
  }
});

test('the far wall rejects a slow sled that misses the launch', () => {
  const { run, world } = setup('2026-11-19');
  run.d = GAPS[0].start - 1;
  run.x = -LANE;
  run.y = snowHeight(run.x, run.d);
  let crash = '';
  while (!crash && run.d < GAPS[0].end + 5) crash = simulate(run, world, k => k === 'brake', STEP);
  assert.match(crash, /Missed|Short/);
  assert.equal(run.jumps, 0);
});

test('a brass marker scores once, and the score survives landing', () => {
  const { run, world } = setup('2026-11-19');
  const marker = world.course.tokens[0];
  run.d = marker.d - 2;
  run.x = marker.x;
  while (run.d < marker.d + 2) simulate(run, world, () => false, STEP);
  assert.equal(run.tokens, 1);
  assert.equal(points(run) - Math.floor(run.d), 40);
});
