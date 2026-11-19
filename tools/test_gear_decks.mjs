import assert from 'node:assert/strict';
import { DEFAULT_SKI_ID, DEFAULT_SNOWBOARD_ID, SKI_MODELS, SNOWBOARD_MODELS } from '../src/gear-catalog.js';
import { deckProfile, deckShapes } from '../src/deck-shape.js';

function close(value, expected, message, epsilon = 1e-9) {
  assert.ok(Math.abs(value - expected) < epsilon, `${message} expected ${expected}, got ${value}`);
}

assert.equal(DEFAULT_SKI_ID, 'all-mountain');
assert.equal(DEFAULT_SNOWBOARD_ID, 'burton-custom-camber');
for (const style of ['all-mountain', 'carver', 'powder', 'park']) assert.equal(SKI_MODELS[style].id, style);

for (const model of [...Object.values(SKI_MODELS), ...Object.values(SNOWBOARD_MODELS)]) {
  const { waistAt } = deckShapes[model.id];
  for (const density of [1, 5]) {
    // Physics and mesh profiles must agree on the measured stations.
    const profile = deckProfile(model, density);
    const [tail, nose] = [profile[0], profile.at(-1)];
    const waist = profile.find(row => row[0] === waistAt);
    close((nose[0] - tail[0]) * 100, model.lengthCm, `${model.name} length in cm`);
    close(waist[1] * 2000, model.waistMm, `${model.name} waist in mm`);
    close(Math.max(...profile.filter(row => row[0] > waistAt).map(row => row[1])) * 2000, model.tipMm, `${model.name} tip in mm`);
    close(Math.max(...profile.filter(row => row[0] < waistAt).map(row => row[1])) * 2000, model.tailMm, `${model.name} tail in mm`);
    const contacts = profile.filter(row => Math.abs(row[2]) < 1e-9);
    assert.equal(contacts.length, 2, model.name);
    assert.ok(tail[2] > 0 && nose[2] > waist[2] && waist[2] > 0, `${model.name} camber and end rise`);
    assert.ok(profile.every((row, i) => row.every(Number.isFinite) && (i === 0 || row[0] > profile[i - 1][0])));
    if (model.kind === 'snowboard') {
      const [rear, front] = contacts;
      close((front[0] - rear[0]) * 1000, model.runningLengthMm, `${model.name} running length in mm`);
      close((front[0] + rear[0]) * 500, model.setbackMm, `${model.name} setback in mm`);
      const bindings = profile.filter(row => Math.abs(row[0]) === model.stanceWidthCm / 200);
      close((bindings[1][0] - bindings[0][0]) * 100, model.stanceWidthCm, `${model.name} stance width in cm`);
    }
  }
  // The sidecut approaches the sourced radius around the waist.
  const fineProfile = deckProfile(model, 64);
  const next = fineProfile.find(section => section[0] > waistAt + .0001);
  const run = next[0] - waistAt;
  const sag = next[1] - model.waistMm / 2000;
  const radius = (run * run + sag * sag) / (2 * sag);
  close(radius, model.radiusM, `${model.name} sidecut radius in m`, .01);
}

assert.ok(SKI_MODELS.powder.handling.float > SKI_MODELS.carver.handling.float);
assert.ok(SKI_MODELS.carver.handling.grip > SKI_MODELS.powder.handling.grip);
assert.ok(SKI_MODELS.park.handling.switch > SKI_MODELS['laser-wrt-pro'].handling.switch);
assert.ok(SNOWBOARD_MODELS['jones-flagship'].handling.float > SNOWBOARD_MODELS[DEFAULT_SNOWBOARD_ID].handling.float);
assert.ok(SNOWBOARD_MODELS[DEFAULT_SNOWBOARD_ID].handling.pop > SNOWBOARD_MODELS['jones-flagship'].handling.pop);
console.log('Five ski models and two snowboards match catalogue dimensions, radius and reference stance.');
