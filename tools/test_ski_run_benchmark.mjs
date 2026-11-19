import assert from 'node:assert/strict';
import test from 'node:test';
import { RUNS } from '../src/worlddata.js';
import {
  DEFAULT_SKI_RUN, captureTitleArrival, driveSkiRun, summarizeSkiRun,
} from '../src/ski-run-benchmark.js';

const mappedRun = RUNS.find(run => run.id === DEFAULT_SKI_RUN);
const segments = [];
let distance = 0;
for (let i = 1; i < mappedRun.points.length; i++) {
  const [x,z] = mappedRun.points[i - 1], [endX,endZ] = mappedRun.points[i];
  const dx = endX - x, dz = endZ - z;
  const segmentLength = Math.hypot(dx, dz);
  if (!segmentLength) continue;
  segments.push({ x, z, dx, dz, start: distance, length: segmentLength });
  distance += segmentLength;
}

function pose(station) {
  const leg = segments.find(s => station < s.start + s.length) ?? segments.at(-1);
  const fraction = Math.min(1, (station - leg.start) / leg.length);
  return { x: leg.x + leg.dx * fraction, z: leg.z + leg.dz * fraction };
}

class Position {
  copy({ x, y, z }) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new Position().copy(this); }
  toArray() { return [this.x, this.y, this.z]; }
}

class BenchmarkKey extends Event {
  constructor(type, { code }) { super(type); this.code = code; }
}

// Scripted samples exercise the instrumentation independently of Three.js, a
// browser GPU, or the game's collision and steering simulation.
function rig() {
  let now = 0;
  const targetWindow = new EventTarget();
  const dropIn = new EventTarget();
  const document = new EventTarget();
  document.baseURI = new URL('../index.html', import.meta.url).href;
  document.hidden = false;
  document.getElementById = id => id === 'drop-in' ? dropIn : null;
  const keys = new Set();
  targetWindow.addEventListener('keydown', event => keys.add(event.code));
  targetWindow.addEventListener('keyup', event => keys.delete(event.code));
  const game = {
    state: { playing: true },
    scene: {}, camera: {},
    player: {
      pos: new Position(), vel: { x: 0, z: 0 }, heading: 0,
      speed: 0, stats: { distance: 0 },
      get travelHeading() { return this.heading; },
      teleport({ x, z, heading }) {
        this.pos.copy({ x, y: 1830, z });
        this.heading = heading;
      },
    },
    renderer: {
      domElement: new EventTarget(),
      info: { render: { calls: 107, triangles: 166000 } },
      getContext: () => ({ isContextLost: () => false, drawingBufferWidth: 1920, drawingBufferHeight: 1080 }),
      getRenderTarget: () => null,
      render() { now += .5; },
    },
  };
  const original = { render: game.renderer.render, teleport: game.player.teleport };
  const deadlines = new Map();
  let nextTimer = 0;
  Object.assign(targetWindow, {
    KeyboardEvent: BenchmarkKey, document, performance: { now: () => now }, __alpine: game,
    setTimeout(callback, delay) { const id = nextTimer++; deadlines.set(id, { callback, delay }); return id; },
    clearTimeout(id) { deadlines.delete(id); },
  });
  return {
    targetWindow, game, original, keys, dropIn, deadlines,
    advance(ms) { now += ms; },
    submit(station, interval) {
      now += interval - .5;
      Object.assign(game.player.pos, pose(station), { y: 1830 - station * .21 });
      game.player.stats.distance = station;
      game.renderer.render(game.scene, game.camera);
    },
  };
}

for (const fps of [5, 10, 15]) {
  test('complete route observations at ' + fps + ' FPS retain coverage and real time', async () => {
    const fixture = rig();
    const { targetWindow, game, original, keys, deadlines } = fixture;
    let observe;
    game.setFrameObserver = listener => { observe = listener; };
    const op = await driveSkiRun({ targetWindow, timeoutMs: 650000 });
    assert.deepEqual([...keys], ['KeyW']);
    const interval = 1000 / fps;
    const stepM = 18 * Math.min(interval, 120) / 1000;
    for (let station = 2 + stepM; station <= distance + stepM && !op.state.done; station += stepM) {
      observe(targetWindow.performance.now() + interval - 3.5, fps > 5);
      fixture.submit(station, interval);
    }
    const result = summarizeSkiRun(await op.done);
    assert.equal(result.passed, true);
    assert.equal(result.run.reason, 'mapped finish');
    assert.ok(result.run.result.coverage > .98);
    assert.ok(Math.abs(result.metrics.fullRun.p95FrameMs - interval) < 1e-7);
    assert.ok(Math.abs(result.metrics.fullRun.fps - fps) < 1e-7);
    assert.equal(result.metrics.fullRun.framesOver50ms, result.metrics.fullRun.submissions - 1);
    assert.ok(Math.abs(result.metrics.fullRun.beforeRenderMedianMs - 3) < 1e-7);
    assert.equal(result.metrics.fullRun.timerFrames, fps === 5 ? result.metrics.fullRun.submissions : 0);
    assert.equal(observe, null);
    assert.equal(result.metrics.fullRun.framesOver100ms, fps === 5 ? result.metrics.fullRun.submissions - 1 : 0);
    assert.equal(keys.size, 0);
    assert.equal(deadlines.size, 0);
    assert.equal(game.renderer.render, original.render);
    assert.equal(game.player.teleport, original.teleport);
  });
}

test('stopping a run restores input, leaves no timer, and cannot pass', async () => {
  const fixture = rig();
  const { targetWindow, game, original, keys, deadlines } = fixture;
  const op = await driveSkiRun({ targetWindow });
  fixture.submit(3, 60);
  op.stop('window resized');
  const summary = summarizeSkiRun(await op.done);
  assert.equal(summary.passed, false);
  assert.equal(summary.run.reason, 'window resized');
  assert.equal(game.renderer.render, original.render);
  assert.equal(game.player.teleport, original.teleport);
  assert.equal(keys.size, 0);
  assert.equal(deadlines.size, 0);
  assert.equal(summary.frames.length, 1);
  fixture.submit(1700, 120);
  assert.equal(summary.frames.length, 1);
});

test('GPU timing skips unfinished and disjoint samples and releases outstanding queries', async () => {
  const fixture = rig(), { game, targetWindow } = fixture;
  const ext = { TIME_ELAPSED_EXT: 1, QUERY_COUNTER_BITS_EXT: 2, GPU_DISJOINT_EXT: 3 };
  let next = 0, active = null, ready = false, disjoint = false;
  const deleted = [];
  const gl = Object.assign(game.renderer.getContext(), {
    CURRENT_QUERY: 4, QUERY_RESULT_AVAILABLE: 5, QUERY_RESULT: 6,
    getExtension: () => ext, getQuery: (_, type) => type === 2 ? 64 : active,
    createQuery: () => ++next, beginQuery: (_, q) => { assert.equal(active, null); active = q; },
    endQuery: () => { assert.ok(active); active = null; },
    getParameter: () => disjoint,
    getQueryParameter(q, type) {
      if (type === this.QUERY_RESULT_AVAILABLE) return ready;
      assert.equal(type, this.QUERY_RESULT);
      assert.ok(ready && !disjoint, 'a GPU timing read must never wait for a result');
      return q * 2000000;
    },
    deleteQuery: q => deleted.push(q),
  });
  game.renderer.getContext = () => gl;
  const op = await driveSkiRun({ targetWindow });
  fixture.submit(3, 1100); // First timed draw.
  fixture.submit(4, 1100); // Still pending.
  assert.equal(next, 1);
  disjoint = true;
  fixture.submit(5, 1100); // Discard first sample.
  disjoint = false;
  ready = true;
  fixture.submit(6, 1100); // Second sample took 4 ms.
  ready = false;
  op.stop();
  assert.deepEqual(op.state.gpu, {samples:1, medianMs:4});
  assert.deepEqual(deleted, [1,2,3]);
});

test('a teleport after staging invalidates a run even if it lands at the ending', async () => {
  const fixture = rig();
  const { targetWindow, game } = fixture;
  const op = await driveSkiRun({ targetWindow });
  game.player.teleport({ ...pose(distance), heading: 0 });
  fixture.submit(distance, 15);
  const summary = summarizeSkiRun(await op.done);
  assert.equal(summary.passed, false);
  assert.equal(summary.run.reason, 'unexpected teleport');
  assert.equal(summary.run.result.teleports, 1);
});

test('aborting title capture restores render and removes the pending click listener', async () => {
  const { targetWindow, game, original, dropIn } = rig();
  const abort = new AbortController();
  const arrival = captureTitleArrival({ targetWindow, signal: abort.signal });
  assert.notEqual(game.renderer.render, original.render);
  abort.abort();
  await assert.rejects(arrival, { name: 'AbortError' });
  assert.equal(game.renderer.render, original.render);
  dropIn.dispatchEvent(new Event('click'));
  assert.equal(targetWindow.skiBenchmarkBoot.clickMs, null);
});
