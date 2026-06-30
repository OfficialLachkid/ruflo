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
      payload: { domain: 'infra' },
    },
    {
      timestamp: '2026-06-30T11:06:00.000Z',
      type: 'transcribed_command_accepted',
      payload: { domain: 'infra' },
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
      timestamp: '2026-06-30T11:09:00.000Z',
      type: 'task_execution_finished',
      payload: { outcome: 'completed' },
    },
    {
      timestamp: '2026-06-30T11:10:00.000Z',
      type: 'discord_event_rejected',
      payload: { reason: 'operator_not_allowed' },
    },
  ];

  const summary = summarizeOpsEvents(events, { now, windowHours: 24 });

  assert.equal(summary.totalEvents, 8);
  assert.equal(summary.runtimeReadyCount, 1);
  assert.equal(summary.commandsAccepted, 1);
  assert.equal(summary.transcribedCommandsAccepted, 1);
  assert.equal(summary.voiceNotesReceived, 1);
  assert.equal(summary.transcriptionCompleted, 1);
  assert.equal(summary.transcriptionFailed, 0);
  assert.equal(summary.avgTranscriptionLatencyMs, 6123);
  assert.equal(summary.p95TranscriptionLatencyMs, 6123);
  assert.equal(summary.avgTranscriptionConfidence, 0.92);
  assert.equal(summary.approvalsResolved, 1);
  assert.equal(summary.approvalsApproved, 1);
  assert.equal(summary.approvalsRejected, 0);
  assert.equal(summary.executionsCompleted, 1);
  assert.equal(summary.executionsFailed, 0);
  assert.equal(summary.rejectedEvents, 1);
  assert.deepEqual(summary.topDomains, [['infra', 2]]);
  assert.deepEqual(summary.topRejectionReasons, [['operator_not_allowed', 1]]);
});

test('formatDailySummary renders a human-readable digest', () => {
  const content = formatDailySummary({
    windowHours: 24,
    commandsAccepted: 3,
    transcribedCommandsAccepted: 2,
    voiceNotesReceived: 2,
    approvalsResolved: 2,
    approvalsApproved: 1,
    approvalsRejected: 1,
    transcriptionCompleted: 2,
    transcriptionFailed: 1,
    avgTranscriptionLatencyMs: 6200,
    p95TranscriptionLatencyMs: 7000,
    avgTranscriptionConfidence: 0.88,
    executionsCompleted: 2,
    executionsFailed: 1,
    rejectedEvents: 1,
    topDomains: [['infra', 3]],
    topRejectionReasons: [['operator_not_allowed', 1]],
  });

  assert.match(content, /\*\*Daily Summary\*\*/u);
  assert.match(content, /Commands accepted: 3/u);
  assert.match(content, /Approvals resolved: 2 \(1 approved, 1 rejected\)/u);
  assert.match(content, /Avg confidence: 88%/u);
  assert.match(content, /\*\*Top domains\*\*/u);
  assert.match(content, /infra: 3/u);
  assert.doesNotMatch(content, /```json/u);
});
