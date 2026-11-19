import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreRide, rideOptions, equipRide } from '../src/ride-inventory.js';
import { encodeRiderKit, readRiderKit } from '../src/rider-kit-link.js';

test('an existing skier keeps earned equipment and can switch disciplines and back', () => {
  const s = { ...restoreRide({ owned:['powder','removed'], skis:'powder' }), balance:0 };
  assert.equal(s.discipline,'ski');
  assert.equal(s.skis,'powder');
  assert.ok(!s.owned.includes('removed'));
  assert.ok(equipRide(s,'snowboard','jones-flagship'));
  assert.equal(s.discipline,'snowboard');
  assert.equal(s.skis,'powder');
  const reload = restoreRide(JSON.parse(JSON.stringify(s)));
  assert.equal(reload.snowboard,'jones-flagship');
  assert.equal(reload.discipline,'snowboard');
  assert.ok(equipRide(s,'skis','powder'));
  assert.equal(s.discipline,'ski');
});

test('starter skis and boards are available immediately and bought skis charge once', () => {
  const s = { ...restoreRide(null), balance:17 };
  assert.ok(rideOptions(s,'snowboard').every(i=>i.owned));
  assert.ok(equipRide(s,'skis','laser-wrt-pro'));
  assert.equal(equipRide(s,'skis','carver'),false);
  assert.equal(s.skis,'laser-wrt-pro');
  assert.equal(s.balance,17);
  s.balance++;
  assert.equal(equipRide(s,'skis','carver'),true);
  assert.equal(s.balance,0);
  assert.equal(equipRide(s,'skis','carver'),true);
  assert.equal(s.owned.filter(i=>i==='carver').length,1);
  assert.equal(equipRide(s,'snowboard','carver'),false);
});

test('remote board, stance, brand and colours survive a gear update', () => {
  const appearance = { snowboard:'jones-flagship', discipline:'snowboard', stance:'goofy', skis:'laser-wrt-pro',
    backpackModel:'soelden-22', backpack:'#694e42', pants:'#323e48', helmet:'#d6d6d1', sticker:'peak' };
  const payload = encodeRiderKit(appearance), kit = readRiderKit(payload);
  assert.deepEqual(kit,{ ...appearance, skiModel:appearance.skis, snowboardModel:appearance.snowboard });
  assert.equal(readRiderKit(payload.replace('jones-flagship','unknown')),null);
  assert.equal(readRiderKit(payload + '/extra'),null);
  assert.equal(readRiderKit(payload.replace('#323e48','red')),null);
  assert.equal(readRiderKit(encodeRiderKit({})).discipline,'ski');
});
