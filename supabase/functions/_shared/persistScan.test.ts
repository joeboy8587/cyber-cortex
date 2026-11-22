import { test, expect } from 'bun:test';
import { persistScan } from './persistScan';
test('600 findings save in three batches of 200', async () => {
  const batches: number[] = [];
  const result = await persistScan(Array.from({ length: 600 }, (_, i) => i), async rows => {
    batches.push(rows.length); return { inserted: rows.length, error: null };
  }, Date.now() + 100_000);
  expect(batches).toEqual([200, 200, 200]); expect(result.inserted).toBe(600); expect(result.error).toBeNull();
});
test('a later failed save preserves the successful count and stops', async () => {
  let calls = 0;
  const result = await persistScan(Array.from({ length: 600 }, (_, i) => i), async rows => {
    calls++; if (calls === 2) throw new Error('network'); return { inserted: rows.length, error: null };
  }, Date.now() + 100_000);
  expect(result.inserted).toBe(200); expect(result.error).toContain('could not be confirmed'); expect(calls).toBe(2);
});
test('near deadline no new saving request starts', async () => {
  let calls = 0;
  const result = await persistScan([1], async () => { calls++; return { inserted: 1, error: null }; }, Date.now() + 1000);
  expect(calls).toBe(0); expect(result.inserted).toBe(0); expect(result.error).toContain('budget');
});
