import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TrickCombo, flipLabel } from '../src/trick-combo.js';

const pose = ({ spin = 0, flip = 0, grabTime = 0, airTime = 2 } = {}) => ({
  spin: spin * Math.PI / 180,
  flip: flip * Math.PI / 180,
  grabTime,
  airTime,
});

test('a completed backflip, spin, and mute grab stack their trick multipliers', () => {
  const combo = new TrickCombo();
  combo.begin();
  combo.update(pose({ flip: -359 }));
  assert.equal(combo.multiplier, 1);
  combo.update(pose({ flip: -360 }));
  assert.equal(flipLabel(combo.flips, combo.backflip), 'Backflip');
  assert.equal(combo.multiplier, 2);
  assert.equal(combo.points, (144 + 320) * 2);

  combo.update(pose({ flip: -360, spin: 180 }));
  assert.equal(combo.multiplier, 3);
  combo.update(pose({ flip: -360, spin: 180, grabTime: .5 }));
  assert.equal(combo.multiplier, 4);
  assert.equal(combo.points, (144 + 320 + 95 + 48) * 4);
});

test('a larger spin scratches and replaces the previous value', () => {
  const combo = new TrickCombo();
  combo.begin();
  combo.update(pose({ spin: -180 }));
  assert.equal(combo.points, (144 + 95) * 2);
  combo.update(pose({ spin: -360 }));
  assert.equal(combo.scratchedSpin, 180);
  assert.ok(combo.scratchTime > 0);
  assert.equal(combo.spin, 360);
  assert.equal(combo.multiplier, 2);
  assert.equal(combo.points, (144 + 190) * 2);
  combo.advance(1);
  assert.equal(combo.scratchTime, 0);
  assert.equal(combo.spin, 360);
});

test('a bank settles once and incorporates existing score bonuses', () => {
  const combo = new TrickCombo();
  const landing = pose({ spin: 360, flip: -360 });
  combo.begin();
  combo.update(landing, 1.5 * 2);
  assert.equal(combo.multiplier, 3);
  assert.equal(combo.bonus, 3);
  const provisional = combo.points;
  assert.equal(provisional, (144 + 190 + 320) * 3 * 3);
  assert.equal(combo.bank(landing, 3), provisional);
  assert.equal(combo.phase, 'banked');
  assert.equal(combo.bank(landing, 3), 0);
  combo.bail();
  assert.equal(combo.phase, 'banked');
  combo.advance(2);
  assert.equal(combo.resultTime, 0);
});

test('a bail retains the provisional display briefly and awards zero', () => {
  const combo = new TrickCombo();
  const landing = pose({ spin: 360, flip: -360 });
  combo.begin();
  combo.update(landing);
  const provisional = combo.points;
  combo.bail();
  assert.equal(combo.phase, 'bailed');
  assert.equal(combo.bank(landing), 0);
  assert.equal(combo.points, provisional);
  assert.ok(combo.resultTime > 0);
  combo.begin();
  assert.equal(combo.points, 0);
  assert.equal(combo.multiplier, 1);
  assert.equal(combo.resultTime, 0);
});

test('a clean landing keeps air-time scoring and allows a nearly completed rotation', () => {
  const combo = new TrickCombo();
  combo.begin();
  assert.equal(combo.bank(pose({ airTime: .4 })), 0);
  assert.equal(combo.phase, 'idle');
  combo.begin();
  assert.equal(combo.bank(pose()), 144);
  combo.begin();
  assert.equal(combo.bank(pose({ spin: 346, flip: -346 })), (144 + 190 + 320) * 3);
});
