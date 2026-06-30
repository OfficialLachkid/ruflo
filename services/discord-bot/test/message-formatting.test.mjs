import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOutboundEventMessage } from '../src/message-formatting.mjs';

test('formatOutboundEventMessage renders parsed task previews in human-readable form', () => {
  const message = formatOutboundEventMessage({
    type: 'parsed_task_preview',
    body: 'Parsed TASK-123 for developer-agent: Check daemon health',
    metadata: {
      task: {
        task_id: 'TASK-123',
        target_agent: 'developer-agent',
        domain: 'infra',
        priority: 'normal',
        status: 'queued',
        summary: 'Check daemon health',
        approval_required: false,
      },
    },
  });

  assert.match(message, /\*\*Parsed Task\*\*/u);
  assert.match(message, /Task: `TASK-123`/u);
  assert.match(message, /Agent: `developer-agent`/u);
  assert.doesNotMatch(message, /```json/u);
});

test('formatOutboundEventMessage renders approval requests with guidance', () => {
  const message = formatOutboundEventMessage({
    type: 'approval_request',
    body: 'Approval needed for TASK-123: Deploy the latest fix.',
    metadata: {
      taskId: 'TASK-123',
      approvalReason: 'production_change: deploy to production',
    },
  });

  assert.match(message, /\*\*Approval Needed\*\*/u);
  assert.match(message, /Task: `TASK-123`/u);
  assert.match(message, /Action: use the buttons below/u);
});

test('formatOutboundEventMessage renders execution results without raw JSON', () => {
  const message = formatOutboundEventMessage({
    type: 'task_execution_result',
    body: 'Execution result for TASK-123: Ruflo daemon state is running.',
    metadata: {
      taskId: 'TASK-123',
      action: 'ruflo_daemon_health_check',
      state: 'running',
      activeCount: 1,
      runs: 2,
      lastExitCode: 0,
    },
  });

  assert.match(message, /\*\*Execution Result\*\*/u);
  assert.match(message, /State: `running`/u);
  assert.doesNotMatch(message, /```json/u);
});
