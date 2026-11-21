import { describe, expect, test } from 'bun:test';
import { buildRawRows, saveRawResponse } from './rawDetections';

describe('independent raw feed', () => {
  test('raw JSON has no added flags, scores or FAA substitutions', async () => {
    const original = { hex: 'abc123', r: 'N912KC', flight: '  EXACT  ', ownOp: 'Feed owner', alt_baro: 0, gs: 0, mil: false, nested: { absent: null, value: 9 } };
    const rows = await buildRawRows('rapidapi_adsbx', { ac: [original], now: 123 }, '2026-11-21T10:16:00Z');
    expect(JSON.parse(rows[0].payload_json)).toEqual(original);
    expect(rows[0].registration).toBe('N912KC');
    expect(rows[0].callsign).toBe('  EXACT  ');
    expect(rows[0].received_at).toBe('2026-11-21T10:16:00Z');
    expect(rows[0].response_metadata).toEqual({ now: 123 });
    const changed = await buildRawRows('rapidapi_adsbx', { ac: [{ ...original, nested: { absent: null, value: 10 } }] }, '2026-11-21T10:16:00Z');
    expect(changed[0].sha256_hash).not.toBe(rows[0].sha256_hash);
  });
  test('ground contacts, missing positions and duplicates are all preserved', async () => {
    const contact = { hex: 'ABC000', gnd: true, alt_baro: 'ground', lat: 0, lon: null };
    const rows = await buildRawRows('adsb_lol', { ac: [contact, contact, { hex: '~abc123' }] }, '2026-11-21T10:16:00Z');
    expect(rows.length).toBe(3);
    expect(rows.map(r => r.record_index)).toEqual([0, 1, 2]);
    expect(rows[0].latitude).toBe(0);
    expect(rows[0].longitude).toBeNull();
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(rows[0].poll_id).toBe(rows[1].poll_id);
  });
  test('OpenSky arrays and observation times remain unchanged without inferred registration', async () => {
    const state = ['abcd12', 'N913KC ', 'US', 123, 124, null, null, 0, true, 0, null, 0, null, 0, '4414'];
    const rows = await buildRawRows('opensky', { time: 125, states: [state] }, '2026-11-21T10:16:00Z');
    expect(JSON.parse(rows[0].payload_json)).toEqual(state);
    expect(rows[0].registration).toBeNull();
    expect(rows[0].callsign).toBe('N913KC ');
  });
  test('identical observations in separate polls are independent receipts', async () => {
    const response = { ac: [{ hex: 'abcd12' }] };
    const first = await buildRawRows('rapidapi_adsbx', response, '2026-11-21T10:16:00Z');
    const second = await buildRawRows('rapidapi_adsbx', response, '2026-11-21T10:17:00Z');
    expect(first[0].poll_id).not.toBe(second[0].poll_id);
    expect(first[0].sha256_hash).toBe(second[0].sha256_hash);
  });
  test('raw write failure returns explicit status without interrupting the existing path or retrying', async () => {
    let calls = 0;
    const result = await saveRawResponse('rapidapi_adsbx', { ac: [{ hex: 'abcd12' }] }, '2026-11-21T10:16:00Z', async () => { calls++; throw new Error('unavailable'); });
    expect(calls).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.error).not.toBeNull();
  });
  test('200-record batches retain every observation and count confirmed inserts', async () => {
    const sizes: number[] = [];
    const result = await saveRawResponse('rapidapi_adsbx', { ac: Array.from({ length: 201 }, (_, n) => ({ hex: String(n) })) }, '2026-11-21T10:16:00Z', async (_query, params) => {
      const rows = JSON.parse(String(params[0])); sizes.push(rows.length); return { rowCount: rows.length };
    });
    expect(sizes).toEqual([200, 1]);
    expect(result.inserted).toBe(201);
    expect(result.error).toBeNull();
  });
});