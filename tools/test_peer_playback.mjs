import assert from 'node:assert/strict';
import test from 'node:test';
import { peerPlaybackTime, recordSnapshot, timePrefix } from '../src/peer-playback.js';

function packet(at, x = at * .012, flags = 0) {
  return [x, 1700, 0, 0, 0, 0, 1, 12, 0, 0, flags, 0, 0, 0, 0, '#ad4939', timePrefix + at];
}

test('a faster network packet and a new send cadence do not jump the playback clock', () => {
  const peer = {};
  recordSnapshot(peer, packet(0), 400);
  recordSnapshot(peer, packet(150), 550);
  recordSnapshot(peer, packet(300), 700);
  const before = peerPlaybackTime(peer, 739);
  recordSnapshot(peer, packet(510), 750);
  const adjusted = peerPlaybackTime(peer, 755);
  assert.ok(adjusted - before >= 12 && adjusted - before <= 20);
  assert.equal(peer.history.length, 4);
  assert.equal(peer.segment, 1);
});

test('packet loss holds at the prediction limit and resuming preserves chronology', () => {
  const peer = {};
  recordSnapshot(peer, packet(0), 100);
  recordSnapshot(peer, packet(150), 250);
  assert.equal(peerPlaybackTime(peer, 880), 242);
  assert.equal(peerPlaybackTime(peer, 896), 242);
  recordSnapshot(peer, packet(800), 900);
  const resumed = peerPlaybackTime(peer, 912);
  assert.ok(resumed > 242 && resumed <= 262);
});

test('arrival-based peers remain compatible and lift transitions or respawns start new segments', () => {
  const peer = {};
  const first = packet(0);
  first[16] = 1;
  recordSnapshot(peer, first, 400);
  assert.equal(peer.history[0].at, 400);
  assert.equal(peerPlaybackTime(peer, 500), 230);
  const boarding = packet(0, 0, 8);
  boarding[16] = 2;
  recordSnapshot(peer, boarding, 600);
  assert.equal(peer.segment, 2);
  assert.equal(peer.history.length, 1);
  assert.equal(peerPlaybackTime(peer, 600), 330);
  const respawn = packet(0, 60);
  respawn[16] = 3;
  recordSnapshot(peer, respawn, 800);
  assert.equal(peer.segment, 3);
  assert.equal(peer.history[0].pose[0], 60);
});
