import assert from 'node:assert/strict';
import test from 'node:test';
import {needsFlashReadback} from '../vendor/dirplayer/src/services/flashCaptureDemand.mjs';

test('visible pixel fallback resumes after direct presentation or stage hiding', () => {
  const state = {captureEnabled: true, directCanvas: false};
  assert.equal(needsFlashReadback(state, false, 1), true);
  state.directCanvas = true;
  assert.equal(needsFlashReadback(state, false, 2), false);
  state.captureEnabled = false;
  state.directCanvas = false;
  assert.equal(needsFlashReadback(state, false, 3), false);
  state.captureEnabled = true;
  assert.equal(needsFlashReadback(state, false, 4), true);
});

test('offscreen 3D textures retain their original capture cadence', () => {
  const state = {captureEnabled: false, directCanvas: true};
  assert.equal(needsFlashReadback(state, true, 9), false);
  assert.equal(needsFlashReadback(state, true, 10), true);
  assert.equal(needsFlashReadback({}, false, 1), true);
});
