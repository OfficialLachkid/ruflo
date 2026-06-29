import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { normalizeTaskMessage, parseApprovalResponse } from '../src/router.mjs';

test('normalizeTaskMessage marks production and merge requests as approval-gated', () => {
  const config = loadRuntimeConfig();
  const result = normalizeTaskMessage({
    channelKey: 'commands',
    submittedAt: '2026-06-25T10:00:00.000Z',
    content: 'Deploy the latest router fix to production and merge the PR afterwards.',
    author: { id: 'operator-1', displayName: 'VBJ Services' },
  }, config);

  assert.equal(result.task.domain, 'infra');
  assert.equal(result.task.priority, 'normal');
  assert.equal(result.task.approval_required, true);
  assert.match(result.task.approval_reason, /production_change/u);
  assert.equal(result.writeBackCandidates.some((candidate) => candidate.namespace === 'approvals'), true);
});

test('parseApprovalResponse accepts approve and reject patterns', () => {
  assert.deepEqual(
    parseApprovalResponse({ content: 'approve TASK-202606251000-ABC123' }),
    {
      valid: true,
      decision: 'approve',
      taskId: 'TASK-202606251000-ABC123',
      reason: '',
    }
  );

  assert.deepEqual(
    parseApprovalResponse({ content: 'reject TASK-202606251000-ABC123 because production window is closed' }),
    {
      valid: true,
      decision: 'reject',
      taskId: 'TASK-202606251000-ABC123',
      reason: 'production window is closed',
    }
  );
});
