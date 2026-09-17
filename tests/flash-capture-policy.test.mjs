import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureDimensions,
  captureRate,
  createCaptureSchedule,
  shouldCapture,
  recordCapture,
} from '../vendor/dirplayer/src/services/flashCapturePolicy.js';

test('capture uses logical requested pixels with the SWF native size as its floor', () => {
  assert.deepEqual(
    captureDimensions(800, 600, 800, 600, 1600, 1200),
    {width: 800, height: 600},
    'a DPR-2 1600x1200 backing canvas must still upload 800x600',
  );
  assert.deepEqual(captureDimensions(75, 39, 75, 39, 150, 78), {width: 75, height: 39});
  assert.deepEqual(captureDimensions(20, 10, 75, 39, 40, 20), {width: 75, height: 39});
});

test('capture rate follows the slower Director or authored SWF cadence', () => {
  assert.equal(captureRate(50, 12), 12);
  assert.equal(captureRate(10, 12), 10);
  assert.equal(captureRate(50, 0), 50);
  assert.equal(captureRate(0, 12), 12);
  assert.equal(captureRate(0, 0), 24);
  assert.equal(captureRate(999, 0), 999, 'no optional cap leaves the producer rate unchanged');
  assert.equal(captureRate(30, 40, 1), 1);
  assert.equal(captureRate(30, 40, 0), 30);
  assert.equal(captureRate(30, 40), 30);
});

test('raising a live cap schedules the next readback at the new authored deadline', () => {
  const schedule = createCaptureSchedule();
  recordCapture(schedule, 0, captureRate(30, 40, 1));
  assert.equal(shouldCapture(schedule, 32, captureRate(30, 40, 0)), false);
  assert.equal(shouldCapture(schedule, 34, captureRate(30, 40, 0)), true);
});

test('deadline pacing neither oversamples nor burst-repays missed SWF frames', () => {
  const schedule = createCaptureSchedule();
  assert.equal(shouldCapture(schedule, 0, 12), true);
  recordCapture(schedule, 0, 12);
  assert.equal(shouldCapture(schedule, 82, 12), false);
  assert.equal(shouldCapture(schedule, 84, 12), true);
  recordCapture(schedule, 84, 12);
  assert.equal(shouldCapture(schedule, 85, 12), false);

  // A long main-thread stall skips the missed slots and schedules one future
  // sample. It must not issue catch-up reads on successive RAF callbacks.
  assert.equal(shouldCapture(schedule, 500, 12), true);
  recordCapture(schedule, 500, 12);
  assert.equal(shouldCapture(schedule, 501, 12), false);
  assert.equal(shouldCapture(schedule, 582, 12), false);
  assert.equal(shouldCapture(schedule, 584, 12), true);
});

test('a frame mutation is visible by the next authored capture slot', () => {
  const schedule = createCaptureSchedule();
  recordCapture(schedule, 0, 12);
  assert.equal(shouldCapture(schedule, 82, 12), false);
  assert.equal(shouldCapture(schedule, 84, 12), true,
    'periodic capture bounds explicit frame/setVariable changes to one SWF frame');
});
