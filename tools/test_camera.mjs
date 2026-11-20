import assert from 'node:assert/strict';
import { cameraClipper } from '../src/camera-obstacles.js';
import { Vector3 } from '../vendor/three.module.js';

const wall = { x: 0, z: 2, rot: 0, hw: 2, hd: .1, minY: 0, maxY: 3, type: 'wall' };
const post = { x: 0, z: 3, r: .1, minY: 0, maxY: 3, type: 'post' };

function clip(obstacles, from, to, types) {
  const eye = new Vector3(...to);
  const distance = cameraClipper(() => obstacles, types)(...from, eye);
  assert.ok(Math.abs(distance - eye.distanceTo(new Vector3(...from))) < 1e-7);
  return eye;
}
function close(value, expected) {
  assert.ok(Math.abs(value - expected) < 1e-7, `Expected ${expected}, got ${value}`);
}

// A wall stays put while the length of the desired camera boom changes.
for (let cm = 200; cm < 1000; cm++) {
  close(clip([post, wall], [0, 1, 0], [0, 1, cm / 100]).z, 1.72);
}
close(clip([{ ...wall, rot: Math.PI / 4 }], [0, 1, 0], [0, 1, 5]).z, 2 - .28 * Math.SQRT2);
close(clip([post], [0, 4, 3], [0, -4, 3]).y, 3.18);
close(clip([post], [.27, 1, 0], [.27, 1, 8]).z, 3 - Math.sqrt(.28 ** 2 - .27 ** 2));
close(clip([wall], [0, 4, 0], [0, 4, 5]).z, 5);
close(clip([wall], [0, 1, 1.8], [0, 1, 5]).z, 1.8);
close(clip([wall], [0, 1, 1.8], [0, 1, 0]).z, 0);
close(clip([wall], [0, 1, 2], [0, 1, 6]).z, 6);
close(clip([wall, post], [0, 1, 0], [0, 1, 5], new Set(['post'])).z, 2.72);

// A third-person skier can ease towards a closer shoulder view in a glade.
// Passing through the same trees on a lift still checks the trunk as a solid.
const pine = { ...post, tree: { x: 0, y: 0, z: 3, apex: 14, stretch: 1 } };
const throughTrees = cameraClipper(() => [pine]);
const branches = {};
const eye = new Vector3(0, 1, 8);
close(throughTrees(0, 1, 0, eye, branches), 8);
assert.ok(branches.fraction > 0 && branches.fraction < .40);
close(throughTrees(0, 1, 0, eye), 2.72);
eye.set(0, 20, 8);
close(throughTrees(0, 20, 0, eye, branches), 8);
close(branches.fraction, 1);
// Mapped deciduous stands use width. Missing crown dimensions still allow trunk contact.
for (const tree of [{ x:0, y:0, z:3, height:14, width:1 }, { x:0, y:0, z:3, height:14 }]) {
  eye.set(0, 1, 8);
  cameraClipper(() => [{ ...post, tree }])(0, 1, 0, eye, branches);
  assert.ok(Number.isFinite(branches.fraction) && branches.fraction > 0 && branches.fraction < .40);
}

// Staggered walking cameras beneath the mature branches only need to avoid
// the real trunk. At crown height, branches can still ease the camera inward.
const matureTree = { ...post, r: .6, maxY: 28, tree: { x:0, y:0, z:3, apex:28, stretch:1, kind:0 } };
const walking = { walking: true };
const aroundTree = cameraClipper(() => [matureTree]);
eye.set(1.5, 1.8, 4.5);
close(aroundTree(1.5, 1.8, 0, eye, walking), 4.5);
close(walking.fraction, 1);
eye.set(1.5, 9, 4.5);
close(aroundTree(1.5, 9, 0, eye, walking), 4.5);
assert.ok(walking.fraction < .40);
eye.set(0, 1.8, 4.5);
close(aroundTree(0, 1.8, 0, eye, walking), 2.22);
close(walking.fraction, 1);
console.log('Camera clears thin posts, rotated walls, overhead structures and occupied station envelopes.');
