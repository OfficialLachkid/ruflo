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

test('buildExecutionPlan recognizes Discord bot runtime health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check the current Discord bot health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'discord_bot_runtime_health_check',
    description: 'Check Discord bot runtime health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes Tailscale health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check the current Tailscale health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'tailscale_health_check',
    description: 'Check Tailscale network status on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes Docker and Colima health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check Docker and Colima health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'docker_colima_health_check',
    description: 'Check Docker and Colima runtime health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes Ollama health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check Ollama health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'ollama_health_check',
    description: 'Check Ollama runtime health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes disk space health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check disk space on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'disk_space_health_check',
    description: 'Check disk space on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes GitHub auth health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check current GitHub auth health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'github_auth_health_check',
    description: 'Check GitHub CLI authentication health on the Mac runtime.',
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

test('executeTask returns completed events for Discord bot runtime health checks', async () => {
  const config = loadRuntimeConfig();
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push({ command, args });
    return {
      code: 0,
      stdout: [
        '12340 npm run discord:live',
        '12345 node services/discord-bot/index.mjs --live',
      ].join('\n'),
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-456',
    full_text: 'Check the current Discord bot health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionPlan.action, 'discord_bot_runtime_health_check');
  assert.equal(result.executionResult.report.state, 'running');
  assert.equal(result.executionResult.report.processCount, 2);
  assert.equal(result.outboundEvents[1].channelKey, 'agentResults');
  assert.equal(result.outboundEvents[1].metadata.processCount, 2);
  assert.equal(calls[0].command, 'ps');
});

test('executeTask returns completed events for Tailscale health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async (command, args) => {
    if (command === 'ps') {
      return {
        code: 0,
        stdout: '894 /Library/SystemExtensions/uuid/io.tailscale.ipn.macsys.network-extension.systemextension/Contents/MacOS/io.tailscale.ipn.macsys.network-extension\n',
        stderr: '',
      };
    }

    if (command === 'scutil' && args[0] === '--nwi') {
      return {
        code: 0,
        stdout: 'Network information\n\nNetwork interfaces: en1 utun4\n',
        stderr: '',
      };
    }

    if (command === '/sbin/ifconfig') {
      return {
        code: 0,
        stdout: 'utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280\n\tinet 100.81.143.122 --> 100.81.143.122 netmask 0xffffffff\n\tinet6 fd7a:115c:a1e0::1737:8f7b prefixlen 48 \n',
        stderr: '',
      };
    }

    if (command === 'scutil' && args[0] === '--get') {
      return {
        code: 0,
        stdout: 'vbj-orchestrator-01\n',
        stderr: '',
      };
    }

    throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
  };

  const result = await executeTask({
    task_id: 'TASK-TS',
    full_text: 'Check the current Tailscale health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'tailscale_health_check');
  assert.equal(result.executionResult.report.backendState, 'Running');
  assert.equal(result.executionResult.report.tailscaleIps[0], '100.81.143.122');
  assert.equal(result.executionResult.report.interfaceName, 'utun4');
});

test('executeTask returns completed events for Docker and Colima health checks', async () => {
  const config = loadRuntimeConfig();
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push({ command, args });

    if (command === 'colima') {
      return {
        code: 0,
        stdout: '',
        stderr: 'time=\"2026-06-30T17:29:58+02:00\" level=info msg=\"colima is running using macOS Virtualization.Framework\"\n',
      };
    }

    if (args[0] === 'context') {
      return {
        code: 0,
        stdout: 'colima\n',
        stderr: '',
      };
    }

    return {
      code: 0,
      stdout: '"29.5.2"\n',
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-DOCKER',
    full_text: 'Check Docker and Colima health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'docker_colima_health_check');
  assert.equal(result.executionResult.report.state, 'running');
  assert.equal(result.executionResult.report.colimaState, 'running');
  assert.equal(result.executionResult.report.dockerContext, 'colima');
  assert.equal(result.executionResult.report.dockerServerVersion, '29.5.2');
  assert.equal(calls[0].command, 'colima');
  assert.equal(calls[1].command, 'docker');
  assert.equal(calls[2].command, 'docker');
});

test('executeTask returns completed events for Ollama health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async () => ({
    code: 0,
    stdout: 'NAME ID SIZE PROCESSOR CONTEXT UNTIL\nllama3 123 4.7 GB 100% / 5m\n',
    stderr: '',
  });

  const result = await executeTask({
    task_id: 'TASK-OLLAMA',
    full_text: 'Check Ollama health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'ollama_health_check');
  assert.equal(result.executionResult.report.state, 'running');
  assert.equal(result.executionResult.report.activeModelCount, 1);
});

test('executeTask returns completed events for disk space health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async () => ({
    code: 0,
    stdout: 'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1 239362496 35323864 181487312 17% 426233 1814873120 0% /System/Volumes/Data\n',
    stderr: '',
  });

  const result = await executeTask({
    task_id: 'TASK-DISK',
    full_text: 'Check disk space on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'disk_space_health_check');
  assert.equal(result.executionResult.report.usePercent, '17%');
  assert.equal(result.executionResult.report.mountPoint, '/System/Volumes/Data');
});

test('executeTask returns completed events for GitHub auth health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async () => ({
    code: 0,
    stdout: 'github.com\n  ✓ Logged in to github.com account vbjservices (/Users/Agent/.config/gh/hosts.yml)\n  - Active account: true\n  - Git operations protocol: https\n',
    stderr: '',
  });

  const result = await executeTask({
    task_id: 'TASK-GH',
    full_text: 'Check current GitHub auth health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'github_auth_health_check');
  assert.equal(result.executionResult.report.state, 'authenticated');
  assert.equal(result.executionResult.report.account, 'vbjservices');
  assert.equal(result.executionResult.report.gitProtocol, 'https');
});
