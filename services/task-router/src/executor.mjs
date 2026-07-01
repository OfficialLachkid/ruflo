import { spawn } from 'node:child_process';
import process from 'node:process';
import { delimiter, resolve } from 'node:path';
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

function isGitHubAuthHealthCheck(task) {
  const text = lowerText(task);
  const mentionsGitHub = text.includes('github') || text.includes('gh auth');
  const mentionsAuth =
    text.includes('auth') ||
    text.includes('authentication') ||
    text.includes('login') ||
    text.includes('status') ||
    text.includes('health') ||
    text.includes('check');

  return mentionsGitHub && mentionsAuth;
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

  if (isGitHubAuthHealthCheck(task)) {
    return {
      action: 'github_auth_health_check',
      description: 'Check GitHub CLI authentication health on the Mac runtime.',
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

function buildRuntimePath(config) {
  const candidates = [
    config?.env?.PATH || '',
    process.env.PATH || '',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];

  return [...new Set(
    candidates
      .flatMap((entry) => String(entry || '').split(delimiter))
      .map((entry) => entry.trim())
      .filter(Boolean)
  )].join(delimiter);
}

function buildRuntimeEnv(config) {
  return {
    ...process.env,
    ...config.env,
    PATH: buildRuntimePath(config),
  };
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

function parsePsMatches(output, expectedSubstrings = []) {
  const candidates = String(output || '')
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  return candidates.filter((line) => expectedSubstrings.some((pattern) => line.includes(pattern)));
}

async function executeDiscordBotRuntimeHealthCheck(commandRunner, config) {
  const patterns = [
    'services/discord-bot/index.mjs --live',
    'npm run discord:live',
  ];

  const processListResult = await commandRunner('ps', ['-axo', 'pid=,command=']);
  if (processListResult.code !== 0) {
    throw new Error(processListResult.stderr.trim() || 'ps could not inspect the Discord bot runtime.');
  }

  const matches = parsePsMatches(processListResult.stdout, patterns);
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

function parseTailscaleNetworkInterfaces(rawOutput) {
  const line = String(rawOutput || '')
    .split(/\r?\n/u)
    .map((entry) => normalizeWhitespace(entry))
    .find((entry) => entry.startsWith('Network interfaces:'));

  if (!line) {
    return [];
  }

  return line
    .replace('Network interfaces:', '')
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseIfconfigInterface(rawOutput) {
  const lines = String(rawOutput || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const ipv4Line = lines.find((line) => line.startsWith('inet '));
  const ipv6Line = lines.find((line) => line.startsWith('inet6 ') && line.includes('fd7a:'));

  return {
    ipv4: ipv4Line ? normalizeWhitespace(ipv4Line).split(/\s+/u)[1] || '' : '',
    ipv6: ipv6Line ? normalizeWhitespace(ipv6Line).split(/\s+/u)[1] || '' : '',
  };
}

async function executeTailscaleHealthCheck(commandRunner) {
  const processListResult = await commandRunner('ps', ['-axo', 'pid=,command=']);
  if (processListResult.code !== 0) {
    throw new Error(processListResult.stderr.trim() || 'Could not inspect Tailscale processes.');
  }

  const extensionMatches = parsePsMatches(processListResult.stdout, [
    'io.tailscale.ipn.macsys.network-extension',
  ]);
  const nwiResult = await commandRunner('scutil', ['--nwi']);
  if (nwiResult.code !== 0) {
    throw new Error(nwiResult.stderr.trim() || 'Could not inspect network interfaces for Tailscale.');
  }

  const candidateInterfaces = parseTailscaleNetworkInterfaces(nwiResult.stdout)
    .filter((entry) => entry.startsWith('utun'));

  const interfaceReports = [];
  for (const interfaceName of candidateInterfaces) {
    const ifconfigResult = await commandRunner('/sbin/ifconfig', [interfaceName]);
    if (ifconfigResult.code === 0) {
      const parsed = parseIfconfigInterface(ifconfigResult.stdout);
      interfaceReports.push({
        interfaceName,
        ...parsed,
      });
    }
  }

  const primaryInterface = interfaceReports.find((entry) => entry.ipv4.startsWith('100.')) || interfaceReports[0];
  const hostNameResult = await commandRunner('scutil', ['--get', 'LocalHostName']);
  const hostName = hostNameResult.code === 0 ? normalizeWhitespace(hostNameResult.stdout) : '';
  const hasTailscaleIp = Boolean(primaryInterface?.ipv4 && primaryInterface.ipv4.startsWith('100.'));

  return {
    rawStdout: [
      processListResult.stdout,
      nwiResult.stdout,
      interfaceReports.map((entry) => `${entry.interfaceName} ${entry.ipv4} ${entry.ipv6}`).join('\n'),
    ].join('\n'),
    report: {
      state: extensionMatches.length > 0 && hasTailscaleIp ? 'Running' : extensionMatches.length > 0 ? 'Degraded' : 'Stopped',
      backendState: extensionMatches.length > 0 && hasTailscaleIp ? 'Running' : extensionMatches.length > 0 ? 'Degraded' : 'Stopped',
      tailscaleIps: primaryInterface?.ipv4 ? [primaryInterface.ipv4] : [],
      hostName,
      dnsName: '',
      relay: '',
      version: '',
      interfaceName: primaryInterface?.interfaceName || '',
      extensionProcessCount: extensionMatches.length,
    },
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

  const colimaStatusText = normalizeWhitespace(`${colimaStatusResult.stdout}\n${colimaStatusResult.stderr}`);
  const dockerServerVersion = normalizeWhitespace(dockerVersionResult.stdout).replace(/^"|"$/gu, '');
  const dockerContext = normalizeWhitespace(dockerContextResult.stdout);

  return {
    rawStdout: [
      colimaStatusResult.stdout,
      colimaStatusResult.stderr,
      dockerContextResult.stdout,
      dockerVersionResult.stdout,
    ].join('\n'),
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
    state: usePercent,
    mountPoint,
  };
}

function resolveDiskHealthPath(config) {
  return config?.env?.HOME || process.env.HOME || projectRoot;
}

async function executeDiskSpaceHealthCheck(commandRunner, config) {
  const diskResult = await commandRunner('df', ['-k', resolveDiskHealthPath(config)]);
  if (diskResult.code !== 0) {
    throw new Error(diskResult.stderr.trim() || 'Could not inspect disk usage.');
  }

  return {
    rawStdout: diskResult.stdout,
    report: parseDiskUsage(diskResult.stdout),
  };
}

function parseGhAuthStatus(rawOutput) {
  const text = String(rawOutput || '');
  const accountMatch = /Logged in to github\.com account ([^\s(]+)/iu.exec(text);
  const protocolMatch = /Git operations protocol:\s+([^\s]+)/iu.exec(text);

  return {
    state: accountMatch ? 'authenticated' : 'unknown',
    host: 'github.com',
    account: accountMatch ? accountMatch[1] : '',
    gitProtocol: protocolMatch ? protocolMatch[1] : '',
  };
}

async function executeGitHubAuthHealthCheck(commandRunner) {
  const ghResult = await commandRunner('gh', ['auth', 'status', '--hostname', 'github.com']);
  const combinedOutput = `${ghResult.stdout}\n${ghResult.stderr}`;

  if (ghResult.code !== 0) {
    throw new Error(combinedOutput.trim() || 'Could not inspect GitHub auth status.');
  }

  return {
    rawStdout: combinedOutput,
    report: parseGhAuthStatus(combinedOutput),
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

  if (executionPlan.action === 'github_auth_health_check') {
    return [
      commonQueueEvent,
      event(
        'agentResults',
        'task_execution_result',
        `Execution result for ${task.task_id}: GitHub auth is ${report.state || 'unknown'} for ${report.account || 'unknown account'}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state: report.state || 'unknown',
          githubHost: report.host || '',
          githubAccount: report.account || '',
          gitProtocol: report.gitProtocol || '',
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
        env: buildRuntimeEnv(config),
      });

  try {
    const executionState = await executeHealthAction(executionPlan.action, config, { commandRunner });

    return {
      handled: true,
      executionPlan,
      outcome: executionState.outcome,
      executionResult: executionState.executionResult || null,
      outboundEvents: executionState.outcome === 'completed'
        ? buildCompletedEvents(task, executionPlan, executionState.executionResult)
        : buildFailedEvents(task, executionPlan, executionState.error),
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

export async function executeHealthAction(action, config, options = {}) {
  const commandRunner = options.commandRunner
    ? options.commandRunner
    : (command, args) => runProcess(command, args, {
        cwd: projectRoot,
        env: buildRuntimeEnv(config),
      });

  try {
    let executionResult = null;

    if (action === 'ruflo_daemon_health_check') {
      executionResult = await executeRufloDaemonHealthCheck(commandRunner);
    } else if (action === 'discord_bot_runtime_health_check') {
      executionResult = await executeDiscordBotRuntimeHealthCheck(commandRunner, config);
    } else if (action === 'tailscale_health_check') {
      executionResult = await executeTailscaleHealthCheck(commandRunner);
    } else if (action === 'docker_colima_health_check') {
      executionResult = await executeDockerColimaHealthCheck(commandRunner);
    } else if (action === 'ollama_health_check') {
      executionResult = await executeOllamaHealthCheck(commandRunner);
    } else if (action === 'disk_space_health_check') {
      executionResult = await executeDiskSpaceHealthCheck(commandRunner, config);
    } else if (action === 'github_auth_health_check') {
      executionResult = await executeGitHubAuthHealthCheck(commandRunner);
    } else {
      throw new Error(`Unsupported execution action '${action}'.`);
    }

    return {
      outcome: 'completed',
      executionResult,
    };
  } catch (error) {
    return {
      outcome: 'failed',
      error,
    };
  }
}
