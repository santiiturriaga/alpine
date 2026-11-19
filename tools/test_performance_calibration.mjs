import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibrationPlan, createFrameLimiter, createPerformanceCalibration, measureRefresh, summarizeFrames,
} from '../src/performance-calibration.js';

function plan(refresh, lastQuality = 4, frameLimit = 0) {
  return calibrationPlan({ refresh, firstQuality: 0, lastQuality, frameLimit });
}

function sample(fps, passed = true) {
  return { fps, passed, p90Ms: 1000 / fps };
}

test('passes 60, 120 and 240 in order before trying higher detail', () => {
  const run = plan(240);
  assert.deepEqual(run.next().value, { quality: 0, target: 60 });
  assert.deepEqual(run.next(sample(60)).value, { quality: 0, target: 120 });
  assert.deepEqual(run.next(sample(120)).value, { quality: 0, target: 240 });
  assert.deepEqual(run.next(sample(240)).value, { quality: 1, target: 240 });
  assert.deepEqual(run.next(sample(240)).value, { quality: 2, target: 240 });
  const result = run.next(sample(160, false));
  assert.equal(result.done, true);
  assert.equal(result.value.quality, 1);
  assert.equal(result.value.target, 240);
});

test('does not attempt rates unavailable from the display or above the manual cap', () => {
  for (const run of [plan(60, 0), plan(240, 0, 60)]) {
    assert.deepEqual(run.next().value, { quality: 0, target: 60 });
    assert.equal(run.next(sample(60)).done, true);
  }
  const run = plan(144, 0);
  assert.equal(run.next().value.target, 60);
  assert.equal(run.next(sample(60)).value.target, 120);
  assert.equal(run.next(sample(120)).done, true);
});

test('keeps the lowest tier and reports sub-60 measurements without inventing a pass', () => {
  const run = plan(60);
  assert.equal(run.next().value.target, 60);
  assert.equal(run.next(sample(48, false)).value.target, 0);
  const { value } = run.next(sample(48, false));
  assert.equal(value.target, 0);
  assert.equal(value.quality, 0);
  assert.equal(value.fps, 48);
});

test('manual detail stays fixed and a manual 30 cap tests only 30', () => {
  const run = calibrationPlan({ refresh: 144, firstQuality: 3, lastQuality: 3, frameLimit: 30 });
  assert.deepEqual(run.next().value, { quality: 3, target: 30 });
  assert.equal(run.next(sample(30)).value.quality, 3);
});

test('cadence estimation and observed frame stats reject weak or unstable samples', () => {
  const stable = Array(90).fill(1000 / 59.94);
  assert.equal(Math.round(measureRefresh([...stable, 80, 100, 120])), 60);
  assert.equal(summarizeFrames(stable, 60, 60).passed, true);
  assert.equal(summarizeFrames(Array(20).fill(48), 60, 60).passed, false);
  assert.equal(summarizeFrames(stable.slice(0, 2), 60, 60).passed, false);
  assert.equal(summarizeFrames([...Array(79).fill(14), ...Array(11).fill(31)], 60, 60).passed, false);
  assert.equal(summarizeFrames([...Array(76).fill(1000 / 60), 83], 60, 60).passed, false);
});

test('frame cap preserves cadence on aligned and unaligned refresh rates', () => {
  for (const [refresh, target] of [[59.94, 60], [60, 30], [144, 60], [144, 120], [240, 120], [240, 240]]) {
    const limiter = createFrameLimiter();
    const frames = [];
    for (let i = 0; i <= refresh * 4; i++) {
      const time = 1000 * i / refresh;
      if (limiter(time, target)) frames.push(time);
    }
    const intervals = frames.slice(1).map((time, index) => time - frames[index]);
    const stats = summarizeFrames(intervals, target, refresh);
    assert.ok(Math.abs(stats.fps - target) <= 1, `${refresh} Hz at ${target} cap delivered ${stats.fps}`);
    assert.ok(stats.passed, `${refresh} Hz at ${target} cap failed smoothness (${stats.p90Ms} ms)`);
  }
});

function setupCalibration() {
  const storage = new Map();
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.screen = { width: 3840, height: 2160 };
  globalThis.localStorage = {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  };
  const viewport = { clientWidth: 960, clientHeight: 540 };
  const profiles = [{ name: 'BUDGET' }, { name: 'LOW' }];
  const open = (resort = 'test', compact = false) => createPerformanceCalibration({
    query: new URLSearchParams(), profiles, resort, viewport, compact,
  });
  return { open, storage, viewport };
}

function simulate(calibration, { start = 0, duration, fps, context = 'game', eligible = true }) {
  const step = 1000 / fps;
  let renders = 0;
  let now = start;
  for (; now < start + duration; now += step) {
    if (calibration.shouldRender(now, { eligible, context })) {
      renders++;
      calibration.didRender(now);
    }
  }
  return { now, renders };
}

test('intro keeps rendering, and a pause does not contribute samples to gameplay', () => {
  const { open, storage } = setupCalibration();
  const calibration = open();
  const intro = simulate(calibration, { duration: 5000, fps: 120, context: 'intro' });
  assert.ok(intro.renders > 590);
  assert.equal(calibration.testing, false);
  assert.equal(storage.size, 0);
  const active = simulate(calibration, { start: intro.now, duration: 1000, fps: 60 });
  assert.equal(calibration.testing, true);
  const pause = simulate(calibration, { start: active.now, duration: 4500, fps: 120, eligible: false });
  assert.equal(calibration.result, null);
  simulate(calibration, { start: pause.now, duration: 6500, fps: 48 });
  assert.equal(calibration.result.quality, 0);
  assert.equal(calibration.result.target, 0);
  assert.ok(Math.abs(calibration.result.fps - 48) < 1);
  assert.equal(storage.size, 1);
});

test('a persisted result is scoped to its resort and a comparable render viewport', async () => {
  const { open, viewport } = setupCalibration();
  const first = open('test', true);
  simulate(first, { duration: 6500, fps: 60 });
  assert.equal(first.result.target, 60);
  assert.equal(open('test', true).result.target, 60);
  assert.equal(open('other-resort', true).result, null);
  viewport.clientHeight = 600;
  assert.equal(open('test', true).result.target, 60);
  first.viewportChanged();
  assert.equal(first.measuring, false);
  viewport.clientWidth = 1880;
  viewport.clientHeight = 1060;
  assert.equal(open('test', true).result, null);
  first.viewportChanged();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(first.result, null);
  assert.equal(first.measuring, true);
});
