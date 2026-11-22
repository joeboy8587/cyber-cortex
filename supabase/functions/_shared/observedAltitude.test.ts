import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { observedAltitude, extendAltitudeRange } from './observedAltitude.ts';
test('exclude strictly above 60000, retain the boundary', () => {
  assert.equal(observedAltitude(60000), 60000);
  assert.equal(observedAltitude(60001), null);
  assert.equal(observedAltitude(99999), null);
});
test('missing and ground text never become a measured zero', () => {
  for (const value of [null, undefined, '', 'ground', false, NaN, Infinity]) assert.equal(observedAltitude(value), null);
  assert.equal(observedAltitude(0), 0);
  assert.equal(observedAltitude(-25), -25);
});
test('ranges preserve actual zero and ignore sentinel values', () => {
  const range = extendAltitudeRange(extendAltitudeRange({ min: null, max: null }, 0), '400');
  assert.deepEqual(extendAltitudeRange(range, 99999), { min: 0, max: 400 });
  assert.deepEqual(extendAltitudeRange({ min: null, max: null }, null), { min: null, max: null });
});