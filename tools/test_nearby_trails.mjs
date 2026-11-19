import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { indexNearbyTrails } from '../src/nearby-trails.js';
import { initWorldData, RUNS } from '../src/worlddata.js';

function previousSearch(runs, px, pz) {
  let best = null, bestD2 = Infinity;
  for (const run of runs) {
    const samples = run.samples;
    if (!samples?.length) continue;
    const [left, top, right, bottom] = run.bounds;
    if (px < left - 46 || px > right + 46 || pz < top - 46 || pz > bottom + 46) continue;
    let localD2 = Infinity, localI = 0;
    for (let i = 0; i < samples.length; i += 3) {
      const dx = samples[i].x - px, dz = samples[i].z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < localD2) { localD2 = d2; localI = i; }
    }
    for (let i = Math.max(0, localI - 3); i <= Math.min(samples.length - 1, localI + 3); i++) {
      const dx = samples[i].x - px, dz = samples[i].z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < localD2) { localD2 = d2; localI = i; }
    }
    if (localD2 < bestD2) {
      bestD2 = localD2;
      best = { run, index: localI, dist: Math.sqrt(localD2) };
    }
  }
  return best?.dist <= 46 ? best : null;
}

test('indexed trail search matches the old search on real Whistler and mapped terrain', () => {
  let state = 52137;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const mapped = JSON.parse(readFileSync(new URL('../data/mountains/les-3-vallees/resort.json', import.meta.url))).runs;
  for (const runs of [RUNS, mapped]) {
    initWorldData(runs);
    const query = indexNearbyTrails(runs);
    for (let n = 0; n < 5000; n++) {
      const { samples } = runs[Math.floor(random() * runs.length)];
      const { x, z } = samples[Math.floor(random() * samples.length)];
      const px = x + (random() - .5) * 260, pz = z + (random() - .5) * 260;
      const expected = previousSearch(runs, px, pz), actual = query(px, pz);
      assert.equal(actual?.run, expected?.run);
      assert.equal(actual?.index, expected?.index);
      assert.equal(actual?.dist, expected?.dist);
    }
  }
});

test('keeps original ordering on ties and handles adjacent or negative cells', () => {
  const runs = [{ points: [[-300,-256],[-256,-256]] }, { points: [[-256,-256],[-300,-256]] }];
  initWorldData(runs);
  const query = indexNearbyTrails(runs);
  assert.equal(query(-256, -256).run, runs[0]);
  assert.equal(query(-256, -210).dist, 46);
  assert.equal(query(-256, -209.999), null);
  assert.equal(query(12000, -25000), null);
});
