import { describe, test, expect } from 'bun:test';
import { prepareTerrain, elevationValue, terrainKey } from './terrainBatch';
import { deriveAgl, judge } from './agl';
import { altitudeRule } from './farAltitudeRules';
import { policyMatches, repeatedPositions } from './policyAltitudeRules';
const point = { lat: 35.4377286, lon: -119.0252189, altitudeFt: 800 };
describe('Bounded terrain lookup', () => {
  test('600 sightings resolve with at most eight concurrent lookups', async () => {
    let active = 0, max = 0, calls = 0;
    const result = await prepareTerrain(Array.from({ length: 600 }, (_, i) => ({ lat: 35 + i / 10000, lon: -119 })), {
      lookup: async () => { calls++; active++; max = Math.max(max, active); await new Promise(r => setTimeout(r, 1)); active--; return 400; },
    });
    expect(calls).toBe(600); expect(max).toBe(8); expect(result.resolved).toBe(600);
  });
  test('same exact coordinate is fetched once but adjacent terrain is not merged', async () => {
    let calls = 0;
    const adjacent = { ...point, lat: point.lat + 0.0001 };
    const result = await prepareTerrain([point, point, adjacent], { lookup: async () => ++calls * 100 });
    expect(calls).toBe(2); expect(result.values.get(terrainKey(point))).toBe(100); expect(result.values.get(terrainKey(adjacent))).toBe(200);
  });
  test('hung lookups finish on the shared budget and remain unknown', async () => {
    const result = await prepareTerrain(Array.from({ length: 600 }, (_, i) => ({ lat: 35 + i / 10000, lon: -119 })), {
      lookup: () => new Promise(() => {}), budgetMs: 25, requestMs: 25,
    });
    expect(result.attempted).toBeLessThanOrEqual(16); expect(result.resolved).toBe(0); expect(result.deferred).toBeGreaterThan(580);
    expect([...result.values.values()].every(v => v === null)).toBe(true);
  });
  test('terrain errors do not wipe successful results', async () => {
    const result = await prepareTerrain([point, { lat: 36, lon: -119 }], { lookup: async p => { if (p.lat === 36) throw new Error('offline'); return 400; } });
    expect(result.values.get(terrainKey(point))).toBe(400); expect(result.resolved).toBe(1);
  });
  test('null and invalid elevation cannot become sea-level terrain', () => {
    expect(elevationValue(null)).toBeNull(); expect(elevationValue('')).toBeNull(); expect(elevationValue(-1000000)).toBeNull(); expect(elevationValue(0)).toBe(0);
  });
});
describe('Separate MSL and AGL', () => {
  test('800 ft MSL minus 400 ft terrain yields 400 ft AGL without changing original', () => {
    const result = deriveAgl(point, 400, null);
    expect(result.agl_ft).toBe(400); expect(result.msl_ft).toBe(800); expect(point.altitudeFt).toBe(800); expect(result.margin_ft).toBe(300);
  });
  test('local QNH 30.12 adds 200 ft then subtracts terrain', () => {
    const result = deriveAgl(point, 400, 30.12);
    expect(result.qnh_correction_ft).toBe(200); expect(result.agl_ft).toBe(600); expect(result.margin_ft).toBe(150);
  });
  test('unverified GNSS datum cannot replace pressure altitude', () => {
    expect(deriveAgl({ ...point, geoAltitudeFt: 1800 }, 400, null).agl_ft).toBe(400);
  });
  test('missing terrain remains unknown, never a zero or cleared result', () => {
    const result = deriveAgl(point, null, null); expect(result.agl_ft).toBeNull(); expect(judge(result.agl_ft, 300, 500)).toBe('unknown');
  });
});
describe('FAA rule selection', () => {
  test('1000 ft congested-area and 500 ft other-area screening differ', () => {
    expect(altitudeRule(600, 150, true, '4').citation).toBe('14 CFR 91.119(b)');
    expect(altitudeRule(600, 150, false, '4').citation).toBeNull();
    expect(altitudeRule(200, 150, false, '4').citation).toBe('14 CFR 91.119(c)');
  });
  test('helicopter low flights route to helicopter provision without disappearing', () => {
    const result = altitudeRule(200, 150, true, '6'); expect(result.status).toBe('below'); expect(result.citation).toBe('14 CFR 91.119(d)(1)');
  });
  test('uncertainty crossing 500 ft is borderline, not below', () => {
    expect(altitudeRule(400, 150, false, '4').status).toBe('borderline'); expect(altitudeRule(null, 150, true).status).toBe('unknown');
  });
});
const flight = { icao: 'abcdef', timestamp: '2026-11-22T06:30:00.000Z', lat: 35.4, lon: -118.8, altitude: 2200, ground_speed: 20, agl: { agl_ft: 1000, margin_ft: 150 } };
describe('Policy altitude and repetition', () => {
  test('mountain night screening uses 2000 ft AGL, not MSL', () => {
    expect(policyMatches('B-401', flight)).toBe(true); expect(policyMatches('B-401', { ...flight, agl: { agl_ft: 1900, margin_ft: 150 } })).toBe(false);
  });
  test('low/slow uses upper AGL under 500 and ground speed under 30', () => {
    expect(policyMatches('C-100-HOVER', { ...flight, agl: { agl_ft: 200, margin_ft: 150 } })).toBe(true);
    expect(policyMatches('C-100-HOVER', { ...flight, ground_speed: 30, agl: { agl_ft: 200, margin_ft: 150 } })).toBe(false);
  });
  test('authorization screening uses late-night AGL 600–1800 but does not assert missing dispatch', () => {
    expect(policyMatches('A-401', flight)).toBe(true); expect(policyMatches('A-401', { ...flight, agl: { agl_ft: 1801, margin_ft: 150 } })).toBe(false);
  });
  test('transport screening uses 5000–12000 MSL and ground speed above 130', () => {
    expect(policyMatches('B-1102', { ...flight, altitude: 5000, ground_speed: 131 })).toBe(true);
    expect(policyMatches('B-1102', { ...flight, altitude: 4999, ground_speed: 131 })).toBe(false);
  });
  test('six duplicate polls cannot manufacture repeated independent positions', () => {
    expect(repeatedPositions(Array.from({ length: 6 }, () => flight))).toHaveLength(0);
    expect(repeatedPositions(Array.from({ length: 6 }, (_, i) => ({ ...flight, timestamp: `2026-11-22T06:30:0${i}.000Z` })))).toHaveLength(6);
  });
});
