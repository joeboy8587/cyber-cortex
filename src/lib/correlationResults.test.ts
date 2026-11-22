import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { unwrapCorrelationResult } from './correlationResults';

describe('correlation result handling', () => {
  test('a timeout never becomes a completed zero-result scan', () => {
    assert.throws(() => unwrapCorrelationResult({ data: null, nonFatal: true, timedOut: true }));
    assert.throws(() => unwrapCorrelationResult({ data: { count: 0 }, complete: false }));
  });
  test('completed results and actual zeros unwrap without changing counts', () => {
    assert.deepEqual(unwrapCorrelationResult({ data: { count: 12 } }), { count: 12 });
    assert.deepEqual(unwrapCorrelationResult({ data: { count: 0 } }), { count: 0 });
  });
  test('source failures cannot be reported as successful analysis', () => {
    assert.throws(() => unwrapCorrelationResult({ data: { error: 'source missing', count: 0 } }));
  });
});