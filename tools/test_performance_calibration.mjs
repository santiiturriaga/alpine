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

test('60 FPS cap resumes without a catch-up burst after a stall', () => {
  const limiter = createFrameLimiter();
  const times = [0, 16.7, 33.4, 140, 144.2, 148.4, 152.6, 156.8, 161, 173.5];
  assert.deepEqual(times.filter(time => limiter(time, 60)), [0, 16.7, 33.4, 140, 156.8, 173.5]);
});

test('60 FPS cap keeps near-aligned callbacks with timestamp jitter', () => {
  for (const refresh of [59.94, 60, 62.7]) {
    let seed = 90;
    const callbacks = Array.from({ length: Math.floor(refresh * 20) }, (_, index) => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const jitter = seed / 2 ** 32 * 4 - 2;
      return 10 + index * 1000 / refresh + jitter;
    });
    const limiter = createFrameLimiter();
    const frames = callbacks.filter(now => limiter(now, 60));
    const intervals = frames.slice(1).map((now, index) => now - frames[index]).sort((a, b) => a - b);
    const fps = 1000 * intervals.length / (frames.at(-1) - frames[0]);
    const p95 = intervals[Math.floor(intervals.length * .95)];
    assert.ok(fps >= Math.min(refresh, 60) - .2 && fps <= 60.15, { refresh, fps });
    assert.ok(p95 < 21 && intervals[0] >= 500 / 60 - .01, { refresh, p95, minimum: intervals[0] });
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
  const open = (resort = 'test', compact = false, search = '') => createPerformanceCalibration({
    query: new URLSearchParams(search), profiles, resort, viewport, compact,
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

test('adaptive resolution holds 60 FPS at native and respects a lower manual cap', () => {
  const { open, storage } = setupCalibration();
  for (const [preference, cap] of [[0, 60], [120, 60], [240, 60], [30, 30]]) {
    storage.set('alpine.performance-options', JSON.stringify({ frameLimit: preference }));
    const calibration = open('test', false, 'resolution=adaptive&quality=low');
    const { renders } = simulate(calibration, { duration: 6000, fps: 240 });
    assert.ok(Math.abs(renders - cap * 6) <= 1, { preference, renders });
    assert.equal(calibration.resolutionScale, 1);
    assert.equal(calibration.quality, 1);
    assert.equal(calibration.testing, false);
  }
});

test('adaptive resolution ignores the menu and a pause, then steps down on sustained gameplay shortfall', async () => {
  const { open, viewport } = setupCalibration();
  const calibration = open('test', true, 'resolution=adaptive&quality=low');
  const intro = simulate(calibration, { duration: 8000, fps: 24, context: 'intro' });
  const active = simulate(calibration, { start: intro.now, duration: 1600, fps: 45 });
  const pause = simulate(calibration, { start: active.now, duration: 6000, fps: 30, eligible: false });
  const resumed = simulate(calibration, { start: pause.now, duration: 1900, fps: 45 });
  assert.equal(calibration.resolutionScale, 1);
  const downscaled = simulate(calibration, { start: resumed.now, duration: 1200, fps: 45 });
  assert.equal(calibration.resolutionScale, .85);
  const stable = simulate(calibration, { start: downscaled.now, duration: 10_000, fps: 60 });
  assert.equal(calibration.resolutionScale, .85);
  assert.equal(calibration.quality, 1);

  viewport.clientWidth = 540;
  viewport.clientHeight = 960;
  calibration.viewportChanged();
  simulate(calibration, { start: stable.now, duration: 5000, fps: 20 });
  assert.equal(calibration.resolutionScale, .85);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(calibration.resolutionScale, 1);
});

test('adaptive resolution rolls back a scale drop when the device delivers no more frames', () => {
  const { open } = setupCalibration();
  const calibration = open('test', false, 'resolution=adaptive');
  const trial = simulate(calibration, { duration: 3600, fps: 45 });
  assert.equal(calibration.resolutionScale, .85);
  simulate(calibration, { start: trial.now, duration: 11_000, fps: 45 });
  assert.equal(calibration.resolutionScale, 1);
});

function bindControls(calibration) {
  class Control extends EventTarget {
    setAttribute() {}
    get valueAsNumber() { return Number(this.value); }
  }
  const controls = new Map();
  const control = id => {
    if (!controls.has(id)) controls.set(id, new Control());
    return controls.get(id);
  };
  globalThis.document = { getElementById: control };
  const draw = { calls: 1100, triangles: 2_200_000 };
  const renderer = {
    domElement: { width: 960, height: 540 }, info: { render: draw },
    getContext: () => ({ getExtension: () => null, getContextAttributes: () => ({ antialias: false }) }),
  };
  calibration.bind({ apply() {}, resize() {}, renderer });
  return { control, draw };
}

test('adaptive plateau is reconsidered after graphics or the rendered scene changes', () => {
  const { open } = setupCalibration();
  const calibration = open('test', false, 'resolution=adaptive');
  const { control, draw } = bindControls(calibration);
  assert.ok(control('pause-auto-quality').disabled && control('pause-benchmark').disabled);
  assert.match(control('benchmark-status').textContent, /Adaptive cap 60 FPS.*Graphics stay Budget/);
  const plateau = simulate(calibration, { duration: 15_000, fps: 45 });
  assert.equal(calibration.resolutionScale, 1);

  draw.calls = 660;
  const changed = simulate(calibration, { start: plateau.now, duration: 3200, fps: 45 });
  assert.equal(calibration.resolutionScale, .85);
  const returned = simulate(calibration, { start: changed.now, duration: 3900, fps: 45 });
  assert.equal(calibration.resolutionScale, 1);

  const slider = control('pause-quality');
  slider.value = '1';
  slider.dispatchEvent(new Event('change'));
  simulate(calibration, { start: returned.now, duration: 3200, fps: 45 });
  assert.equal(calibration.quality, 1);
  assert.equal(calibration.resolutionScale, .85);
});

test('adaptive recovers detail after headroom returns and avoids repeating a failed recovery', () => {
  const { open } = setupCalibration();
  const calibration = open('test', false, 'resolution=adaptive');
  const { draw } = bindControls(calibration);
  const down = simulate(calibration, { duration: 3200, fps: 45 });
  assert.equal(calibration.resolutionScale, .85);
  const up = simulate(calibration, { start: down.now, duration: 13_000, fps: 60 });
  assert.equal(calibration.resolutionScale, 1);
  const failed = simulate(calibration, { start: up.now, duration: 3800, fps: 45 });
  assert.equal(calibration.resolutionScale, .85);
  const held = simulate(calibration, { start: failed.now, duration: 25_000, fps: 60 });
  assert.equal(calibration.resolutionScale, .85);

  draw.triangles = 1_400_000;
  simulate(calibration, { start: held.now, duration: 16_000, fps: 60 });
  assert.equal(calibration.resolutionScale, 1);
});
