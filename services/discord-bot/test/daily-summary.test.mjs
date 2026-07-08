import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDailySummary, summarizeOpsEvents } from '../src/daily-summary.mjs';

test('summarizeOpsEvents aggregates workflow, transcription, approval, and execution metrics', () => {
  const now = '2026-06-30T12:00:00.000Z';
  const events = [
    {
      timestamp: '2026-06-30T11:00:00.000Z',
      type: 'discord_runtime_ready',
      payload: {},
    },
    {
      timestamp: '2026-06-30T11:05:00.000Z',
      type: 'command_accepted',
      payload: { domain: 'infra', estimatedInputTokens: 18, estimatedCostUsd: 0 },
    },
    {
      timestamp: '2026-06-30T11:05:01.000Z',
      type: 'source_acknowledged',
      payload: { route: 'command', latencyMs: 1800 },
    },
    {
      timestamp: '2026-06-30T11:06:00.000Z',
      type: 'transcribed_command_accepted',
      payload: { domain: 'infra', estimatedInputTokens: 22, estimatedCostUsd: 0 },
    },
    {
      timestamp: '2026-06-30T11:07:00.000Z',
      type: 'voice_note_received',
      payload: {},
    },
    {
      timestamp: '2026-06-30T11:07:04.000Z',
      type: 'voice_transcription_completed',
      payload: { latencyMs: 6123, confidence: 0.92 },
    },
    {
      timestamp: '2026-06-30T11:08:00.000Z',
      type: 'approval_button_resolution',
      payload: { decision: 'approve' },
    },
    {
      timestamp: '2026-06-30T11:08:00.000Z',
      type: 'approval_decision_received',
      payload: { decision: 'approve', approvalWaitMs: 120000 },
    },
    {
      timestamp: '2026-06-30T11:13:00.000Z',
      type: 'approval_decision_received',
      payload: {
        decision: 'approve',
        approvalWaitMs: 3600000,
        automationType: 'mac_sync_watch',
        countTowardHumanTaskLatency: false,
      },
    },
    {
      timestamp: '2026-06-30T11:09:00.000Z',
      type: 'task_execution_finished',
      payload: { outcome: 'completed', action: 'ruflo_daemon_health_check', durationMs: 3200 },
    },
    {
      timestamp: '2026-06-30T11:05:00.000Z',
      type: 'task_state_changed',
      payload: { taskId: 'TASK-1', status: 'queued' },
    },
    {
      timestamp: '2026-06-30T11:06:00.000Z',
      type: 'task_state_changed',
      payload: { taskId: 'TASK-2', status: 'awaiting_approval' },
    },
    {
      timestamp: '2026-06-30T11:07:00.000Z',
      type: 'task_state_changed',
      payload: { taskId: 'TASK-3', status: 'running', domain: 'infra', action: 'ruflo_daemon_health_check', queueDwellMs: 45000 },
    },
    {
      timestamp: '2026-06-30T11:10:00.000Z',
      type: 'discord_event_rejected',
      payload: { reason: 'operator_not_allowed' },
    },
    {
      timestamp: '2026-06-30T11:11:00.000Z',
      type: 'health_monitor_alert_emitted',
      payload: { action: 'tailscale_health_check' },
    },
    {
      timestamp: '2026-06-30T11:12:00.000Z',
      type: 'health_monitor_recovered',
      payload: { action: 'tailscale_health_check' },
    },
  ];

  const summary = summarizeOpsEvents(events, { now, windowHours: 24 });

  assert.equal(summary.totalEvents, 16);
  assert.equal(summary.runtimeReadyCount, 1);
  assert.equal(summary.commandsAccepted, 1);
  assert.equal(summary.transcribedCommandsAccepted, 1);
  assert.equal(summary.avgCommandAckLatencyMs, 1800);
  assert.equal(summary.p95CommandAckLatencyMs, 1800);
  assert.equal(summary.voiceNotesReceived, 1);
  assert.equal(summary.transcriptionCompleted, 1);
  assert.equal(summary.transcriptionFailed, 0);
  assert.equal(summary.avgTranscriptionLatencyMs, 6123);
  assert.equal(summary.p95TranscriptionLatencyMs, 6123);
  assert.equal(summary.avgTranscriptionConfidence, 0.92);
  assert.equal(summary.approvalsResolved, 1);
  assert.equal(summary.approvalsApproved, 1);
  assert.equal(summary.approvalsRejected, 0);
  assert.equal(summary.automationApprovalsResolved, 1);
  assert.equal(summary.avgApprovalWaitMs, 120000);
  assert.equal(summary.p95ApprovalWaitMs, 120000);
  assert.equal(summary.executionsCompleted, 1);
  assert.equal(summary.executionsFailed, 0);
  assert.equal(summary.rejectedEvents, 1);
  assert.equal(summary.tasksAwaitingApproval, 1);
  assert.equal(summary.tasksQueued, 1);
  assert.equal(summary.tasksRunning, 1);
  assert.equal(summary.oldestAwaitingApprovalMs, 54 * 60 * 1000);
  assert.equal(summary.oldestQueuedMs, 55 * 60 * 1000);
  assert.equal(summary.oldestRunningMs, 53 * 60 * 1000);
  assert.equal(summary.avgQueueDwellMs, 45000);
  assert.equal(summary.estimatedInputTokens, 40);
  assert.equal(summary.avgEstimatedTokensPerAcceptedCommand, 20);
  assert.equal(summary.estimatedPaidCostUsd, 0);
  assert.deepEqual(summary.topDomains, [['infra', 2]]);
  assert.deepEqual(summary.topRejectionReasons, [['operator_not_allowed', 1]]);
  assert.deepEqual(summary.avgQueueDwellByDomain, [['infra', 45000]]);
  assert.deepEqual(summary.avgQueueDwellByAction, [['ruflo_daemon_health_check', 45000]]);
  assert.deepEqual(summary.avgExecutionDurationByAction, [['ruflo_daemon_health_check', 3200]]);
  assert.deepEqual(summary.alertCountByComponent, [['tailscale_health_check', 1]]);
  assert.deepEqual(summary.recoveryCountByComponent, [['tailscale_health_check', 1]]);
});

test('formatDailySummary renders a human-readable digest', () => {
  const content = formatDailySummary({
    windowHours: 24,
    totalEvents: 12,
    runtimeReadyCount: 1,
    commandsAccepted: 3,
    transcribedCommandsAccepted: 2,
    avgCommandAckLatencyMs: 1800,
    p95CommandAckLatencyMs: 2500,
    voiceNotesReceived: 2,
    approvalsResolved: 2,
    approvalsApproved: 1,
    approvalsRejected: 1,
    automationApprovalsResolved: 1,
    tasksAwaitingApproval: 1,
    tasksQueued: 2,
    tasksRunning: 1,
    transcriptionCompleted: 2,
    transcriptionFailed: 1,
    avgTranscriptionLatencyMs: 6200,
    p95TranscriptionLatencyMs: 7000,
    avgTranscriptionConfidence: 0.88,
    avgApprovalWaitMs: 125000,
    p95ApprovalWaitMs: 240000,
    oldestAwaitingApprovalMs: 240000,
    oldestQueuedMs: 180000,
    oldestRunningMs: 60000,
    avgQueueDwellMs: 45000,
    executionsCompleted: 2,
    executionsFailed: 1,
    rejectedEvents: 1,
    estimatedInputTokens: 240,
    avgEstimatedTokensPerAcceptedCommand: 48,
    estimatedPaidCostUsd: 0,
    topDomains: [['infra', 3]],
    topRejectionReasons: [['operator_not_allowed', 1]],
    avgQueueDwellByDomain: [['infra', 45000]],
    avgQueueDwellByAction: [['ruflo_daemon_health_check', 45000]],
    avgExecutionDurationByAction: [['ruflo_daemon_health_check', 3200]],
    alertCountByComponent: [['tailscale_health_check', 2]],
    recoveryCountByComponent: [['tailscale_health_check', 1]],
  });

  assert.match(content, /\*\*Daily Summary\*\*/u);
  assert.match(content, /Total tracked events: 12/u);
  assert.match(content, /Runtime reconnects: 1/u);
  assert.match(content, /Commands accepted: 3/u);
  assert.match(content, /Avg command ack: 2s/u);
  assert.match(content, /Approvals resolved: 2 \(1 approved, 1 rejected\)/u);
  assert.match(content, /Automation approvals resolved: 1/u);
  assert.match(content, /Awaiting approval now: 1/u);
  assert.match(content, /Avg approval wait: 2m/u);
  assert.match(content, /Oldest awaiting approval: 4m/u);
  assert.match(content, /Avg queue dwell: 45s/u);
  assert.match(content, /Estimated intake tokens: 240/u);
  assert.match(content, /Avg confidence: 88%/u);
  assert.match(content, /\*\*Top domains\*\*/u);
  assert.match(content, /infra: 3/u);
  assert.match(content, /\*\*Alert count by component\*\*/u);
  assert.doesNotMatch(content, /```json/u);
});
