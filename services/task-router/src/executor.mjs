import { spawn } from 'node:child_process';
import process from 'node:process';
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

export function buildExecutionPlan(task) {
  if (isRufloDaemonHealthCheck(task)) {
    return {
      action: 'ruflo_daemon_health_check',
      description: 'Check Ruflo daemon health on the Mac runtime.',
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

function buildCompletedEvents(task, executionPlan, executionResult) {
  const report = executionResult.report || {};
  const state = report.state || 'unknown';

  return [
    event(
      'taskQueue',
      'task_queue_update',
      `${task.task_id} completed ${executionPlan.action}.`,
      {
        taskId: task.task_id,
        status: 'completed',
        action: executionPlan.action,
      }
    ),
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
    event(
      'systemLogs',
      'task_execution_completed',
      `Completed ${executionPlan.action} for ${task.task_id}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state,
      }
    ),
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
