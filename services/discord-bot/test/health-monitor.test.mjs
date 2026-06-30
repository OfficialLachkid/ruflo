import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  evaluateHealthCheckResult,
  formatHealthMonitorReport,
  planHealthNotifications,
} from '../src/health-monitor.mjs';

test('evaluateHealthCheckResult marks Discord bot runtime healthy when process matches exist', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('discord_bot_runtime_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'running',
        processCount: 2,
        logPath: '/tmp/discord-bot.log',
      },
    },
  }, config);

  assert.equal(check.severity, 'healthy');
  assert.equal(check.state, 'running');
  assert.match(check.summary, /running with 2 processes/u);
});

test('evaluateHealthCheckResult marks disk usage critical above critical threshold', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('disk_space_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        usePercent: '93%',
        mountPoint: '/System/Volumes/Data',
        availableKb: 1024,
        totalKb: 2048,
      },
    },
  }, config);

  assert.equal(check.severity, 'critical');
  assert.equal(check.state, '93%');
});

test('evaluateHealthCheckResult marks Docker context drift as warning', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('docker_colima_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'running',
        colimaState: 'running',
        dockerContext: 'default',
        dockerServerVersion: '29.5.2',
      },
    },
  }, config);

  assert.equal(check.severity, 'warning');
  assert.match(check.summary, /context is default/u);
});

test('planHealthNotifications emits alert and recovery transitions only', () => {
  const currentChecks = [
    {
      action: 'tailscale_health_check',
      label: 'Tailscale',
      severity: 'critical',
      state: 'Stopped',
      summary: 'Tailscale backend is Stopped.',
      details: [],
    },
    {
      action: 'disk_space_health_check',
      label: 'Disk space',
      severity: 'healthy',
      state: '17%',
      summary: 'Disk usage is healthy.',
      details: [],
    },
  ];

  const previousChecks = {
    tailscale_health_check: {
      severity: 'healthy',
      state: 'Running',
      summary: 'Healthy before.',
    },
    disk_space_health_check: {
      severity: 'warning',
      state: '88%',
      summary: 'Was warning before.',
    },
  };

  const notifications = planHealthNotifications(currentChecks, previousChecks);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].kind, 'alert');
  assert.equal(notifications[0].action, 'tailscale_health_check');
  assert.equal(notifications[1].kind, 'recovery');
  assert.equal(notifications[1].action, 'disk_space_health_check');
});

test('formatHealthMonitorReport renders readable monitor output', () => {
  const content = formatHealthMonitorReport({
    checks: [
      {
        label: 'Discord bot runtime',
        severity: 'healthy',
        state: 'running',
        summary: 'Discord bot runtime is running with 2 processes.',
      },
      {
        label: 'Disk space',
        severity: 'warning',
        state: '88%',
        summary: 'Disk usage is 88% on /System/Volumes/Data.',
      },
    ],
    notifications: [
      {
        kind: 'alert',
        label: 'Disk space',
        severity: 'warning',
      },
    ],
  });

  assert.match(content, /\*\*Runtime Health Monitor\*\*/u);
  assert.match(content, /Checks evaluated: 2/u);
  assert.match(content, /Disk space: warning \(88%\)/u);
  assert.match(content, /Notifications planned: 1/u);
});
