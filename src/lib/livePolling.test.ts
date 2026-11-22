import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { HOME_POLLING, livePollingInterval } from './livePolling';

const now = Date.parse('2026-11-22T04:01:00Z');
const home = { latitude: 35.4377286, longitude: -119.0252189, detected_at: new Date(now).toISOString() };

describe('home-only live polling', () => {
  test('fresh aircraft near home use 15-second checks', () => {
    assert.equal(livePollingInterval([home], 'rapidapi_adsbx', now), 15_000);
  });
  test('aircraft outside the 3km home area use 60-second checks', () => {
    assert.equal(livePollingInterval([{ ...home, latitude: home.latitude + 0.04 }], 'rapidapi_adsbx', now), 60_000);
    assert.equal(livePollingInterval([{ ...home, latitude: home.latitude + 0.02 }], 'rapidapi_adsbx', now), 15_000);
  });
  test('empty airspace returns to 60 seconds', () => {
    assert.equal(livePollingInterval([], 'rapidapi_adsbx', now), 60_000);
  });
  test('cached positions cannot activate paid fast checks', () => {
    assert.equal(livePollingInterval([home], 'cached', now), 60_000);
  });
  test('stale or unknown-time positions cannot activate fast checks', () => {
    assert.equal(livePollingInterval([{ ...home, detected_at: new Date(now - HOME_POLLING.maxPositionAgeMs - 1).toISOString() }], 'opensky', now), 60_000);
    assert.equal(livePollingInterval([{ ...home, detected_at: undefined }], 'adsb_lol', now), 60_000);
  });
  test('missing coordinates cannot activate fast checks', () => {
    assert.equal(livePollingInterval([{ ...home, latitude: null }], 'rapidapi_adsbx', now), 60_000);
  });
});