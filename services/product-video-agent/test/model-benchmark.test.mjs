import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeModelResults } from '../scripts/benchmark-script-models.mjs';

test('model benchmark reports comparable pass rates and timing', () => {
  const summaries = summarizeModelResults([
    { model: 'model-a', status: 'passed', elapsed_ms: 100 },
    { model: 'model-a', status: 'failed', elapsed_ms: 300 },
    { model: 'model-b', status: 'passed', elapsed_ms: 150 },
  ]);

  assert.deepEqual(summaries, [
    {
      model: 'model-a',
      attempts: 2,
      passed: 1,
      failed: 1,
      elapsed_ms: 400,
      pass_rate: 0.5,
      average_elapsed_ms: 200,
    },
    {
      model: 'model-b',
      attempts: 1,
      passed: 1,
      failed: 0,
      elapsed_ms: 150,
      pass_rate: 1,
      average_elapsed_ms: 150,
    },
  ]);
});
