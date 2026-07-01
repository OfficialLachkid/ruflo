import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHealthNotificationDiscordPayload,
  buildOutboundEventDiscordPayload,
  formatOutboundEventMessage,
} from '../src/message-formatting.mjs';

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

test('buildOutboundEventDiscordPayload renders parsed task previews as embed cards', () => {
  const payload = buildOutboundEventDiscordPayload({
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
        submitted_by: 'Lachkid',
      },
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Parsed Task · TASK-123/u);
  assert.match(payload.embeds[0].description, /Check daemon health/u);
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

test('buildOutboundEventDiscordPayload renders execution results as embed cards', () => {
  const payload = buildOutboundEventDiscordPayload({
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

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Execution Result · TASK-123/u);
  assert.match(payload.embeds[0].description, /Ruflo daemon state is running/u);
});

test('formatOutboundEventMessage renders GitHub auth metadata cleanly', () => {
  const message = formatOutboundEventMessage({
    type: 'task_execution_result',
    body: 'Execution result for TASK-456: GitHub auth is authenticated for vbjservices.',
    metadata: {
      taskId: 'TASK-456',
      action: 'github_auth_health_check',
      state: 'authenticated',
      githubHost: 'github.com',
      githubAccount: 'vbjservices',
      gitProtocol: 'https',
    },
  });

  assert.match(message, /GitHub Host: `github\.com`/u);
  assert.match(message, /GitHub Account: `vbjservices`/u);
  assert.match(message, /Git Protocol: `https`/u);
});

test('buildOutboundEventDiscordPayload renders approval requests as a pinged embed payload', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'approval_request',
    body: 'Approval needed for TASK-789: Deploy latest runtime patch.',
    metadata: {
      taskId: 'TASK-789',
      summary: 'Deploy latest runtime patch.',
      targetAgent: 'developer-agent',
      domain: 'infra',
      priority: 'high',
      submittedBy: 'Lachkid',
      approvalReason: 'production_change: deploy to production',
      approverMentions: '<@374565340644114433>',
      approverUserIds: ['374565340644114433'],
      approverRoleIds: [],
    },
  });

  assert.equal(payload.content, '<@374565340644114433>');
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Approval Needed/u);
  assert.match(payload.embeds[0].description, /Deploy latest runtime patch/u);
  assert.equal(payload.allowed_mentions.users[0], '374565340644114433');
});

test('buildHealthNotificationDiscordPayload renders alert cards with recovery guidance', () => {
  const payload = buildHealthNotificationDiscordPayload({
    kind: 'alert',
    label: 'Tailscale',
    severity: 'warning',
    state: 'Degraded',
    summary: 'Tailscale backend is degraded.',
    details: ['IP missing'],
    recoveryCommand: 'open -a Tailscale',
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Runtime Health Alert · Tailscale/u);
  assert.match(payload.embeds[0].description, /degraded/u);
});
