#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { buildNoticeDiscordPayload } from '../services/discord-bot/src/message-formatting.mjs';
import { evaluateHealthCheckResult } from '../services/discord-bot/src/health-monitor.mjs';
import { executeHealthAction } from '../services/task-router/src/executor.mjs';
import {
  MAC_SYNC_HEALTH_ACTIONS,
  buildMacSyncDescription,
  classifyMacSyncState,
  parseRevListCounts,
  summarizeHealthChecks,
} from './lib/mac-sync-worker-utils.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_BOT_LAUNCH_AGENT = 'io.ruv.ruflo.discord-bot';
const RUFLO_WORKER_SERVICE_LAUNCH_AGENT = 'io.ruv.ruflo.daemon';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalizeHealthChecks(healthChecks = []) {
  return healthChecks.map((check) => ({
    action: check.action || '',
    label: check.label || '',
    severity: check.severity || 'unknown',
    state: check.state || '',
    summary: check.summary || '',
    details: Array.isArray(check.details) ? check.details : [],
    recoveryCommand: check.recoveryCommand || '',
  }));
}

function buildAuthHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

async function sendDiscordApiRequest(token, path, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function runCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  }).trim();
}

function getUserLaunchdDomain() {
  if (typeof process.getuid !== 'function') {
    throw new Error('Could not resolve the current macOS user id for launchctl actions.');
  }

  return `gui/${process.getuid()}`;
}

function restartLaunchAgent(label) {
  runCommand('launchctl', ['kickstart', '-k', `${getUserLaunchdDomain()}/${label}`], {
    cwd: process.env.HOME || projectRoot,
  });
}

function readGitSyncState() {
  const currentBranch = runCommand('git', ['branch', '--show-current']);
  const worktreeStatus = runCommand('git', ['status', '--porcelain']);
  let upstreamRef = '';

  try {
    upstreamRef = runCommand('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  } catch {
    upstreamRef = '';
  }

  let aheadCount = 0;
  let behindCount = 0;
  if (upstreamRef) {
    const counts = parseRevListCounts(runCommand('git', ['rev-list', '--left-right', '--count', `HEAD...${upstreamRef}`]));
    aheadCount = counts.aheadCount;
    behindCount = counts.behindCount;
  }

  return {
    currentBranch,
    upstreamRef,
    isClean: worktreeStatus.length === 0,
    aheadCount,
    behindCount,
  };
}

async function runSyncHealthChecks(config) {
  const checks = [];

  for (const action of MAC_SYNC_HEALTH_ACTIONS) {
    const result = await executeHealthAction(action, config);
    checks.push(evaluateHealthCheckResult(action, result, config));
  }

  return checks;
}

function buildMacSyncResult({
  syncState,
  gitState,
  didPull,
  dryRun,
  restartedDiscordBot,
  restartDiscordBotDeferred,
  restartedRufloWorkerService,
  healthChecks,
}) {
  const normalizedHealthChecks = normalizeHealthChecks(healthChecks);
  const healthSummary = summarizeHealthChecks(normalizedHealthChecks);

  return {
    summary: buildMacSyncDescription({
      syncState,
      didPull,
      dryRun,
      restartedDiscordBot,
      restartDiscordBotDeferred,
      restartedRufloWorkerService,
      healthSummary,
    }),
    dryRun,
    didPull,
    restartedDiscordBot,
    restartDiscordBotDeferred,
    restartedRufloWorkerService,
    syncState,
    gitState,
    healthSummary,
    healthChecks: normalizedHealthChecks,
  };
}

function buildDiscordSyncPayload({
  summary,
  syncState,
  gitState,
  didPull,
  dryRun,
  restartedDiscordBot,
  restartDiscordBotDeferred,
  restartedRufloWorkerService,
  healthSummary,
}) {
  return buildNoticeDiscordPayload({
    title: 'Mac Sync Worker',
    description: summary,
    fields: [
      {
        name: 'Branch',
        value: gitState.currentBranch ? `\`${gitState.currentBranch}\`` : '`unknown`',
        inline: true,
      },
      {
        name: 'Upstream',
        value: gitState.upstreamRef ? `\`${gitState.upstreamRef}\`` : '`none`',
        inline: true,
      },
      {
        name: 'Git State',
        value: `ahead \`${gitState.aheadCount}\` / behind \`${gitState.behindCount}\``,
        inline: true,
      },
      {
        name: 'Sync Status',
        value: `\`${syncState.status}\``,
        inline: true,
      },
      {
        name: 'Pull',
        value: didPull
          ? 'Applied'
          : syncState.blocked
            ? 'Blocked'
            : syncState.canPull
              ? 'Skipped'
              : 'Not needed',
        inline: true,
      },
      {
        name: 'Discord Bot',
        value: restartedDiscordBot
          ? 'Restarted'
          : restartDiscordBotDeferred
            ? 'Deferred'
            : 'Unchanged',
        inline: true,
      },
      {
        name: 'Ruflo Worker Service',
        value: restartedRufloWorkerService ? 'Restarted' : 'Unchanged',
        inline: true,
      },
      {
        name: 'Health',
        value: healthSummary.unhealthyCount > 0
          ? healthSummary.unhealthyChecks.map((check) => `- ${check.label}: ${check.severity} (${check.state || 'unknown'})`).join('\n')
          : `All ${healthSummary.healthyCount} checks healthy.`,
        inline: false,
      },
    ],
    footerText: 'Ruflo safe sync',
  });
}

async function maybePostDiscordSummary(config, payload) {
  if (!config.env.DISCORD_BOT_TOKEN || !config.channelIds.systemLogs) {
    return;
  }

  await sendDiscordApiRequest(
    config.env.DISCORD_BOT_TOKEN,
    `/channels/${config.channelIds.systemLogs}/messages`,
    payload
  );
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/mac-sync-worker.mjs [--dry-run] [--json] [--no-post]',
      '',
      'Runs a safe Mac sync workflow:',
      '- fetch origin',
      '- inspect dirty / ahead / behind state',
      '- fast-forward pull only when safe',
      '- restart the Discord bot after a pull unless deferred for an automation caller',
      '- restart the Ruflo worker service if health shows it unhealthy',
      '- validate post-sync runtime health',
      '- optionally post the result into Discord system logs',
      '- emit structured JSON for automation callers when --json is used',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Mac sync worker is intended to run on the Mac mini (macOS only).');
  }

  const dryRun = hasFlag('--dry-run');
  const jsonOutput = hasFlag('--json');
  const noPost = hasFlag('--no-post');
  const skipDiscordRestart = hasFlag('--skip-discord-restart');
  const config = loadRuntimeConfig();

  runCommand('git', ['fetch', 'origin']);

  const gitState = readGitSyncState();
  const syncState = classifyMacSyncState(gitState);
  let didPull = false;
  let restartedDiscordBot = false;
  let restartDiscordBotDeferred = false;
  let restartedRufloWorkerService = false;

  if (syncState.canPull && !dryRun) {
    runCommand('git', ['pull', '--ff-only']);
    didPull = true;
    if (skipDiscordRestart) {
      restartDiscordBotDeferred = true;
    } else {
      restartLaunchAgent(DISCORD_BOT_LAUNCH_AGENT);
      restartedDiscordBot = true;
    }
  }

  let healthChecks = await runSyncHealthChecks(config);
  const workerCheck = healthChecks.find((check) => check.action === 'ruflo_daemon_health_check');
  const discordCheck = healthChecks.find((check) => check.action === 'discord_bot_runtime_health_check');

  if (!dryRun && discordCheck?.severity !== 'healthy' && !restartedDiscordBot) {
    if (skipDiscordRestart) {
      restartDiscordBotDeferred = true;
    } else {
      restartLaunchAgent(DISCORD_BOT_LAUNCH_AGENT);
      restartedDiscordBot = true;
    }
  }

  if (!dryRun && workerCheck?.severity !== 'healthy') {
    restartLaunchAgent(RUFLO_WORKER_SERVICE_LAUNCH_AGENT);
    restartedRufloWorkerService = true;
  }

  if (!dryRun && (restartedDiscordBot || restartedRufloWorkerService)) {
    healthChecks = await runSyncHealthChecks(config);
  }

  const result = buildMacSyncResult({
    syncState,
    gitState,
    didPull,
    dryRun,
    restartedDiscordBot,
    restartDiscordBotDeferred,
    restartedRufloWorkerService,
    healthChecks,
  });
  const payload = buildDiscordSyncPayload(result);

  process.stdout.write(jsonOutput ? `${JSON.stringify(result)}\n` : `${result.summary}\n`);
  if (!noPost) {
    await maybePostDiscordSummary(config, payload);
  }

  if (result.syncState.blocked) {
    process.exitCode = 2;
    return;
  }

  if (result.healthSummary.unhealthyCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
