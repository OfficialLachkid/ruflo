import { spawn } from 'node:child_process';
import process from 'node:process';
import { resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';

function event(channelKey, type, body, metadata = {}) {
  return {
    channelKey,
    type,
    body,
    metadata,
  };
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function lowerText(task) {
  return normalizeWhitespace(task.full_text || task.summary || '').toLowerCase();
}

function isRufloDaemonHealthCheck(task) {
  const text = lowerText(task);
  const mentionsRuflo = text.includes('ruflo');
  const mentionsDaemon = text.includes('daemon');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsRuflo && mentionsDaemon && mentionsHealthOrStatus;
}

function isDiscordBotRuntimeHealthCheck(task) {
  const text = lowerText(task);
  const mentionsDiscord = text.includes('discord');
  const mentionsBot = text.includes('bot') || text.includes('vbj orchestrator');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsDiscord && mentionsBot && mentionsHealthOrStatus;
}

function isTailscaleHealthCheck(task) {
  const text = lowerText(task);
  return text.includes('tailscale') && (
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check')
  );
}

function isDockerColimaHealthCheck(task) {
  const text = lowerText(task);
  const mentionsRuntime = text.includes('docker') || text.includes('colima');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsRuntime && mentionsHealthOrStatus;
}

function isOllamaHealthCheck(task) {
  const text = lowerText(task);
  return text.includes('ollama') && (
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check')
  );
}

function isDiskSpaceHealthCheck(task) {
  const text = lowerText(task);
  const mentionsStorage = text.includes('disk') || text.includes('storage');
  const mentionsSpaceOrStatus =
    text.includes('space') ||
    text.includes('capacity') ||
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsStorage && mentionsSpaceOrStatus;
}

export function buildExecutionPlan(task) {
  if (isRufloDaemonHealthCheck(task)) {
    return {
      action: 'ruflo_daemon_health_check',
      description: 'Check Ruflo daemon health on the Mac runtime.',
    };
  }

  if (isDiscordBotRuntimeHealthCheck(task)) {
    return {
      action: 'discord_bot_runtime_health_check',
      description: 'Check Discord bot runtime health on the Mac runtime.',
    };
  }

  if (isTailscaleHealthCheck(task)) {
    return {
      action: 'tailscale_health_check',
      description: 'Check Tailscale network status on the Mac runtime.',
    };
  }

  if (isDockerColimaHealthCheck(task)) {
    return {
      action: 'docker_colima_health_check',
      description: 'Check Docker and Colima runtime health on the Mac runtime.',
    };
  }

  if (isOllamaHealthCheck(task)) {
    return {
      action: 'ollama_health_check',
      description: 'Check Ollama runtime health on the Mac runtime.',
    };
  }

  if (isDiskSpaceHealthCheck(task)) {
    return {
      action: 'disk_space_health_check',
      description: 'Check disk space on the Mac runtime.',
    };
  }

  return null;
}

export function buildExecutionStartedEvents(task, executionPlan) {
  return [
    event(
      'taskQueue',
      'task_queue_update',
      `${task.task_id} is running ${executionPlan.action}.`,
      {
        taskId: task.task_id,
        status: 'running',
        action: executionPlan.action,
      }
    ),
    event(
      'systemLogs',
      'task_execution_started',
      `Started ${executionPlan.action} for ${task.task_id}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
      }
    ),
  ];
}

function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: options.env || process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(new Error(`Could not start command '${command}': ${error.message}`));
    });

    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

export function parseLaunchctlReport(output) {
  const text = String(output || '');

  const readMatch = (pattern) => {
    const match = pattern.exec(text);
    return match ? match[1] : '';
  };

  return {
    state: readMatch(/state = ([^\n]+)/u),
    activeCount: Number.parseInt(readMatch(/active count = (\d+)/u) || '0', 10),
    lastExitCode: Number.parseInt(readMatch(/last exit code = (-?\d+)/u) || '0', 10),
    runs: Number.parseInt(readMatch(/runs = (\d+)/u) || '0', 10),
    stdoutPath: readMatch(/stdout path = ([^\n]+)/u),
    stderrPath: readMatch(/stderr path = ([^\n]+)/u),
  };
}

async function executeRufloDaemonHealthCheck(commandRunner) {
  const uidResult = await commandRunner('id', ['-u']);
  if (uidResult.code !== 0) {
    throw new Error(uidResult.stderr.trim() || 'Could not determine current user ID for launchctl health check.');
  }

  const uid = normalizeWhitespace(uidResult.stdout);
  const launchctlResult = await commandRunner('launchctl', ['print', `gui/${uid}/io.ruv.ruflo.daemon`]);
  if (launchctlResult.code !== 0) {
    throw new Error(launchctlResult.stderr.trim() || 'launchctl could not inspect io.ruv.ruflo.daemon.');
  }

  return {
    rawStdout: launchctlResult.stdout,
    report: parseLaunchctlReport(launchctlResult.stdout),
  };
}

function parsePgrepMatches(output) {
  return String(output || '')
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

async function executeDiscordBotRuntimeHealthCheck(commandRunner, config) {
  const patterns = [
    'services/discord-bot/index.mjs --live',
    'npm run discord:live',
  ];

  const matches = [];
  for (const pattern of patterns) {
    const processMatchResult = await commandRunner('pgrep', ['-fl', pattern]);
    if (processMatchResult.code !== 0 && processMatchResult.code !== 1) {
      throw new Error(processMatchResult.stderr.trim() || 'pgrep could not inspect the Discord bot runtime.');
    }

    for (const match of parsePgrepMatches(processMatchResult.stdout)) {
      if (!matches.includes(match)) {
        matches.push(match);
      }
    }
  }

  return {
    rawStdout: matches.join('\n'),
    report: {
      state: matches.length > 0 ? 'running' : 'not running',
      processCount: matches.length,
      matches,
      logPath: resolve(config.runtimePaths.logDir, 'discord-bot.log'),
    },
  };
}

function parseTailscaleStatus(rawStatusJson) {
  const payload = JSON.parse(rawStatusJson);
  return {
    backendState: payload.BackendState || 'unknown',
    tailscaleIps: Array.isArray(payload.TailscaleIPs) ? payload.TailscaleIPs : [],
    hostName: payload.Self?.HostName || '',
    dnsName: payload.Self?.DNSName || '',
    relay: payload.Self?.Relay || '',
    version: payload.Version || '',
  };
}

async function executeTailscaleHealthCheck(commandRunner) {
  const binaryPath = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  const statusResult = await commandRunner(binaryPath, ['status', '--json']);
  if (statusResult.code !== 0) {
    throw new Error(statusResult.stderr.trim() || 'Could not inspect Tailscale status.');
  }

  return {
    rawStdout: statusResult.stdout,
    report: parseTailscaleStatus(statusResult.stdout),
  };
}

async function executeDockerColimaHealthCheck(commandRunner) {
  const colimaStatusResult = await commandRunner('colima', ['status']);
  if (colimaStatusResult.code !== 0) {
    throw new Error(colimaStatusResult.stderr.trim() || 'Could not inspect Colima status.');
  }

  const dockerContextResult = await commandRunner('docker', ['context', 'show']);
  if (dockerContextResult.code !== 0) {
    throw new Error(dockerContextResult.stderr.trim() || 'Could not inspect Docker context.');
  }

  const dockerVersionResult = await commandRunner('docker', ['info', '--format', '{{json .ServerVersion}}']);
  if (dockerVersionResult.code !== 0) {
    throw new Error(dockerVersionResult.stderr.trim() || 'Could not inspect Docker server info.');
  }

  const colimaStatusText = normalizeWhitespace(colimaStatusResult.stdout);
  const dockerServerVersion = normalizeWhitespace(dockerVersionResult.stdout).replace(/^"|"$/gu, '');
  const dockerContext = normalizeWhitespace(dockerContextResult.stdout);

  return {
    rawStdout: [colimaStatusResult.stdout, dockerContextResult.stdout, dockerVersionResult.stdout].join('\n'),
    report: {
      state: dockerServerVersion ? 'running' : 'not running',
      colimaState: /colima is running/iu.test(colimaStatusText) ? 'running' : 'not running',
      dockerContext,
      dockerServerVersion,
      colimaStatusText,
    },
  };
}

function parseOllamaPs(rawOutput) {
  const lines = String(rawOutput || '')
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const rows = lines.length > 1 ? lines.slice(1) : [];
  return {
    activeModelCount: rows.length,
    activeModels: rows,
  };
}

async function executeOllamaHealthCheck(commandRunner) {
  const ollamaResult = await commandRunner('ollama', ['ps']);
  if (ollamaResult.code !== 0) {
    throw new Error(ollamaResult.stderr.trim() || 'Could not inspect Ollama status.');
  }

  const parsed = parseOllamaPs(ollamaResult.stdout);
  return {
    rawStdout: ollamaResult.stdout,
    report: {
      state: 'running',
      ...parsed,
    },
  };
}

function parseDiskUsage(rawOutput) {
  const lines = String(rawOutput || '')
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const target = lines.at(-1) || '';
  const parts = target.split(/\s+/u);
  if (parts.length < 6) {
    throw new Error('Could not parse disk usage output.');
  }

  const filesystem = parts[0];
  const totalKb = Number.parseInt(parts[1] || '0', 10);
  const usedKb = Number.parseInt(parts[2] || '0', 10);
  const availableKb = Number.parseInt(parts[3] || '0', 10);
  const usePercent = parts[4];
  const mountPoint = parts[parts.length - 1];

  return {
    filesystem,
    totalKb,
    usedKb,
    availableKb,
    usePercent,
    mountPoint,
  };
}

async function executeDiskSpaceHealthCheck(commandRunner) {
  const diskResult = await commandRunner('df', ['-k', '~']);
  if (diskResult.code !== 0) {
    throw new Error(diskResult.stderr.trim() || 'Could not inspect disk usage.');
  }

  return {
    rawStdout: diskResult.stdout,
    report: parseDiskUsage(diskResult.stdout),
  };
}

function buildCompletedEvents(task, executionPlan, executionResult) {
  const report = executionResult.report || {};
  const state = report.state || 'unknown';
  const commonQueueEvent = event(
    'taskQueue',
    'task_queue_update',
    `${task.task_id} completed ${executionPlan.action}.`,
    {
      taskId: task.task_id,
      status: 'completed',
      action: executionPlan.action,
    }
  );
  const commonSystemEvent = event(
    'systemLogs',
    'task_execution_completed',
    `Completed ${executionPlan.action} for ${task.task_id}.`,
    {
      taskId: task.task_id,
      action: executionPlan.action,
      state,
    }
  );

  if (executionPlan.action === 'discord_bot_runtime_health_check') {
    const processCount = Number(report.processCount || 0);
    return [
      commonQueueEvent,
      event(
        'agentResults',
        'task_execution_result',
        `Execution result for ${task.task_id}: Discord bot runtime is ${state}${processCount ? ` (${processCount} process)` : ''}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state,
          processCount,
          logPath: report.logPath || '',
        }
      ),
      commonSystemEvent,
    ];
  }

  if (executionPlan.action === 'tailscale_health_check') {
    return [
      commonQueueEvent,
      event(
        'agentResults',
        'task_execution_result',
        `Execution result for ${task.task_id}: Tailscale is ${report.backendState || 'unknown'} on ${report.hostName || 'this host'}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state: report.backendState || 'unknown',
          tailscaleIp: report.tailscaleIps?.[0] || '',
          dnsName: report.dnsName || '',
          relay: report.relay || '',
          version: report.version || '',
        }
      ),
      commonSystemEvent,
    ];
  }

  if (executionPlan.action === 'docker_colima_health_check') {
    return [
      commonQueueEvent,
      event(
        'agentResults',
        'task_execution_result',
        `Execution result for ${task.task_id}: Docker is ${report.state || 'unknown'} on context ${report.dockerContext || 'unknown'} and Colima is ${report.colimaState || 'unknown'}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state: report.state || 'unknown',
          dockerContext: report.dockerContext || '',
          dockerServerVersion: report.dockerServerVersion || '',
          colimaState: report.colimaState || '',
        }
      ),
      commonSystemEvent,
    ];
  }

  if (executionPlan.action === 'ollama_health_check') {
    return [
      commonQueueEvent,
      event(
        'agentResults',
        'task_execution_result',
        `Execution result for ${task.task_id}: Ollama is ${report.state || 'unknown'} with ${report.activeModelCount || 0} active model${report.activeModelCount === 1 ? '' : 's'}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state: report.state || 'unknown',
          activeModelCount: report.activeModelCount || 0,
        }
      ),
      commonSystemEvent,
    ];
  }

  if (executionPlan.action === 'disk_space_health_check') {
    return [
      commonQueueEvent,
      event(
        'agentResults',
        'task_execution_result',
        `Execution result for ${task.task_id}: Disk usage is ${report.usePercent || 'unknown'} on ${report.mountPoint || 'unknown'}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state: report.usePercent || 'unknown',
          mountPoint: report.mountPoint || '',
          availableKb: report.availableKb || 0,
          totalKb: report.totalKb || 0,
        }
      ),
      commonSystemEvent,
    ];
  }

  return [
    commonQueueEvent,
    event(
      'agentResults',
      'task_execution_result',
      `Execution result for ${task.task_id}: Ruflo daemon state is ${state}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state,
        activeCount: report.activeCount,
        lastExitCode: report.lastExitCode,
        runs: report.runs,
        stdoutPath: report.stdoutPath,
        stderrPath: report.stderrPath,
      }
    ),
    commonSystemEvent,
  ];
}

function buildFailedEvents(task, executionPlan, error) {
  return [
    event(
      'taskQueue',
      'task_queue_update',
      `${task.task_id} failed ${executionPlan.action}.`,
      {
        taskId: task.task_id,
        status: 'failed',
        action: executionPlan.action,
      }
    ),
    event(
      'alerts',
      'task_execution_failed',
      `Execution failed for ${task.task_id}: ${error.message}`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
      }
    ),
    event(
      'systemLogs',
      'task_execution_failed',
      `Failed ${executionPlan.action} for ${task.task_id}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        error: error.message,
      }
    ),
  ];
}

export async function executeTask(task, config, options = {}) {
  const executionPlan = buildExecutionPlan(task);
  if (!executionPlan) {
    return {
      handled: false,
      executionPlan: null,
      outboundEvents: [],
    };
  }

  const commandRunner = options.commandRunner
    ? options.commandRunner
    : (command, args) => runProcess(command, args, {
        cwd: projectRoot,
        env: {
          ...process.env,
          ...config.env,
        },
      });

  try {
    let executionResult = null;

    if (executionPlan.action === 'ruflo_daemon_health_check') {
      executionResult = await executeRufloDaemonHealthCheck(commandRunner);
    } else if (executionPlan.action === 'discord_bot_runtime_health_check') {
      executionResult = await executeDiscordBotRuntimeHealthCheck(commandRunner, config);
    } else if (executionPlan.action === 'tailscale_health_check') {
      executionResult = await executeTailscaleHealthCheck(commandRunner);
    } else if (executionPlan.action === 'docker_colima_health_check') {
      executionResult = await executeDockerColimaHealthCheck(commandRunner);
    } else if (executionPlan.action === 'ollama_health_check') {
      executionResult = await executeOllamaHealthCheck(commandRunner);
    } else if (executionPlan.action === 'disk_space_health_check') {
      executionResult = await executeDiskSpaceHealthCheck(commandRunner);
    } else {
      throw new Error(`Unsupported execution action '${executionPlan.action}'.`);
    }

    return {
      handled: true,
      executionPlan,
      outcome: 'completed',
      executionResult,
      outboundEvents: buildCompletedEvents(task, executionPlan, executionResult),
    };
  } catch (error) {
    return {
      handled: true,
      executionPlan,
      outcome: 'failed',
      error,
      outboundEvents: buildFailedEvents(task, executionPlan, error),
    };
  }
}
