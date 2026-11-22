import { describe, expect, test } from 'bun:test';
import { normalizeScore } from './canonical';
import { withAnalysisDeadline } from '../_shared/analysisDeadline';

describe('stored scores and correlation deadlines', () => {
  test('missing stored scores stay unknown rather than becoming zero', () => {
    expect(normalizeScore(null)).toBeNull();
    expect(normalizeScore(undefined)).toBeNull();
    expect(normalizeScore('')).toBeNull();
  });
  test('stored zero and numeric scores retain their real values', () => {
    expect(normalizeScore(0)).toBe(0);
    expect(normalizeScore('39')).toBe(39);
  });
  test('an unfinished request returns before the idle limit', async () => {
    await expect(withAnalysisDeadline(new Promise(() => {}), 10)).rejects.toMatchObject({ code: 'ANALYSIS_TIMEOUT' });
  });
  test('completed and failed queries retain their actual outcomes', async () => {
    expect(await withAnalysisDeadline(Promise.resolve({ count: 12 }), 100)).toEqual({ count: 12 });
    await expect(withAnalysisDeadline(Promise.reject(new Error('source missing')), 100)).rejects.toThrow('source missing');
  });
});