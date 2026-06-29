import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  buildExecutionPlan,
  buildExecutionStartedEvents,
  executeTask,
  parseLaunchctlReport,
} from '../src/executor.mjs';

test('buildExecutionPlan recognizes Ruflo daemon health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check the current Ruflo daemon health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'ruflo_daemon_health_check',
    description: 'Check Ruflo daemon health on the Mac runtime.',
  });
});

test('parseLaunchctlReport extracts daemon state fields', () => {
  const report = parseLaunchctlReport(`
gui/502/io.ruv.ruflo.daemon = {
  active count = 0
  state = not running
  stdout path = /tmp/out.log
  stderr path = /tmp/err.log
  runs = 7
  last exit code = 0
}
`);

  assert.equal(report.state, 'not running');
  assert.equal(report.activeCount, 0);
  assert.equal(report.lastExitCode, 0);
  assert.equal(report.runs, 7);
  assert.equal(report.stdoutPath, '/tmp/out.log');
  assert.equal(report.stderrPath, '/tmp/err.log');
});

test('buildExecutionStartedEvents marks task as running', () => {
  const events = buildExecutionStartedEvents(
    { task_id: 'TASK-123' },
    { action: 'ruflo_daemon_health_check' }
  );

  assert.equal(events[0].channelKey, 'taskQueue');
  assert.equal(events[0].metadata.status, 'running');
  assert.equal(events[1].channelKey, 'systemLogs');
});

test('executeTask returns completed events for daemon health checks', async () => {
  const config = loadRuntimeConfig();
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push({ command, args });

    if (command === 'id') {
      return { code: 0, stdout: '502\n', stderr: '' };
    }

    return {
      code: 0,
      stdout: `
gui/502/io.ruv.ruflo.daemon = {
  active count = 1
  state = running
  stdout path = /tmp/out.log
  stderr path = /tmp/err.log
  runs = 12
  last exit code = 0
}
`,
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-123',
    full_text: 'Check the current Ruflo daemon health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionPlan.action, 'ruflo_daemon_health_check');
  assert.equal(result.executionResult.report.state, 'running');
  assert.equal(result.outboundEvents[0].channelKey, 'taskQueue');
  assert.equal(result.outboundEvents[1].channelKey, 'agentResults');
  assert.equal(calls[0].command, 'id');
  assert.equal(calls[1].command, 'launchctl');
});
