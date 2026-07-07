#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import {
  buildNoticeDiscordPayload,
  buildOutboundEventDiscordPayload,
  upgradeLegacyDiscordPayload,
} from '../services/discord-bot/src/message-formatting.mjs';
import { buildApprovalButtons } from '../services/discord-bot/src/approval-buttons.mjs';
import {
  loadPersistedPendingTasks,
  upsertPersistedPendingTask,
} from '../services/discord-bot/src/pending-task-store.mjs';
import { normalizeTaskMessage } from '../services/task-router/src/router.mjs';
import { classifyMacSyncState, parseRevListCounts } from './lib/mac-sync-worker-utils.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function hasFlag(flag) {
  return process.argv.includes(flag);
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

  return response.status === 204 ? null : response.json();
}

function runCommand(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  }).trim();
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

function buildApprovalMentions(config) {
  if (Array.isArray(config.operatorUserIds) && config.operatorUserIds.length > 0) {
    return config.operatorUserIds.map((userId) => `<@${userId}>`).join(' ');
  }

  if (config.operatorRoleId) {
    return `<@&${config.operatorRoleId}>`;
  }

  return '';
}

function buildMacSyncWatchSummary(gitState) {
  const commitLabel = gitState.behindCount === 1 ? 'commit' : 'commits';
  return `Mac is behind ${gitState.upstreamRef || 'origin/main'} by ${gitState.behindCount} ${commitLabel}. Approve to run the safe sync workflow.`;
}

function buildMacSyncWatchReason(gitState) {
  return `Scheduled detect-only check found the Mac safely behind ${gitState.upstreamRef || 'origin/main'} by ${gitState.behindCount} commit${gitState.behindCount === 1 ? '' : 's'}.`;
}

function hasPendingMacSyncRequest(tasks = []) {
  return tasks.some((task) => task?.automation_type === 'mac_sync_watch');
}

function buildWatchTask(config, gitState) {
  const upstreamRef = gitState.upstreamRef || 'origin/main';
  const normalized = normalizeTaskMessage({
    sourceType: 'scheduled_sync_watch',
    channelKey: 'approvals',
    content: `Sync the Mac mini runtime with the latest changes from ${upstreamRef}.`,
    submittedAt: new Date().toISOString(),
    author: {
      id: 'ruflo-sync-watch',
      username: 'ruflo-sync-watch',
      displayName: 'Ruflo sync watcher',
    },
  }, config);

  normalized.task.summary = buildMacSyncWatchSummary(gitState);
  normalized.task.approval_reason = buildMacSyncWatchReason(gitState);
  normalized.task.status = 'awaiting_approval';
  normalized.task.automation_type = 'mac_sync_watch';
  normalized.task.sync_watch_state = {
    branch: gitState.currentBranch || '',
    upstream: upstreamRef,
    aheadCount: gitState.aheadCount || 0,
    behindCount: gitState.behindCount || 0,
  };

  return normalized.task;
}

function buildApprovalEvent(task) {
  return {
    channelKey: 'approvals',
    type: 'approval_request',
    body: `Approval needed for ${task.task_id}: ${task.summary}`,
    metadata: {
      taskId: task.task_id,
      summary: task.summary,
      approvalReason: task.approval_reason,
      targetAgent: task.target_agent,
      domain: task.domain,
      priority: task.priority,
      submittedBy: task.submitted_by,
      approverMentions: '',
      approverUserIds: [],
      approverRoleIds: [],
      responsePattern: ['approve TASK-123', 'reject TASK-123 because <reason>'],
    },
  };
}

async function postApprovalRequest(config, task) {
  const token = config.env.DISCORD_BOT_TOKEN;
  if (!token || !config.channelIds.approvals) {
    throw new Error('Mac sync watch requires DISCORD_BOT_TOKEN and channelIds.approvals.');
  }

  const approvalEvent = buildApprovalEvent(task);
  approvalEvent.metadata.approverMentions = buildApprovalMentions(config);
  approvalEvent.metadata.approverUserIds = config.operatorUserIds || [];
  approvalEvent.metadata.approverRoleIds = config.operatorRoleId ? [config.operatorRoleId] : [];

  const approvalPayload = upgradeLegacyDiscordPayload(buildOutboundEventDiscordPayload(approvalEvent));
  approvalPayload.components = buildApprovalButtons(task.task_id);

  await sendDiscordApiRequest(
    token,
    `/channels/${config.channelIds.approvals}/messages`,
    approvalPayload
  );

  if (config.channelIds.systemLogs) {
    await sendDiscordApiRequest(
      token,
      `/channels/${config.channelIds.systemLogs}/messages`,
      buildNoticeDiscordPayload({
        title: 'Mac Sync Watch',
        description: `${task.summary} Approval request posted to <#${config.channelIds.approvals}>.`,
      })
    );
  }
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/mac-sync-watch.mjs [--dry-run] [--json] [--no-post]',
      '',
      'Runs a detect-only Mac sync watch:',
      '- fetch origin',
      '- inspect whether the Mac clone is safely behind its upstream',
      '- if safely behind and no pending sync request exists, create an approval-gated sync task',
      '- persist the pending task so the live Discord bot can continue it after approval',
      '- optionally post the approval request into Discord',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Mac sync watch is intended to run on the Mac mini (macOS only).');
  }

  const dryRun = hasFlag('--dry-run');
  const jsonOutput = hasFlag('--json');
  const noPost = hasFlag('--no-post');
  const config = loadRuntimeConfig();

  runCommand('git', ['fetch', 'origin']);

  const gitState = readGitSyncState();
  const syncState = classifyMacSyncState(gitState);
  const existingPendingTasks = loadPersistedPendingTasks(config);
  const existingPendingSyncRequest = hasPendingMacSyncRequest(existingPendingTasks);

  const result = {
    gitState,
    syncState,
    existingPendingSyncRequest,
    createdTaskId: '',
    created: false,
    posted: false,
    summary: '',
  };

  if (!syncState.canPull) {
    result.summary = existingPendingSyncRequest
      ? `${syncState.summary} A pending Mac sync approval request already exists.`
      : syncState.summary;
    process.stdout.write(jsonOutput ? `${JSON.stringify(result)}\n` : `${result.summary}\n`);
    return;
  }

  if (existingPendingSyncRequest) {
    result.summary = `${buildMacSyncWatchSummary(gitState)} A pending Mac sync approval request already exists.`;
    process.stdout.write(jsonOutput ? `${JSON.stringify(result)}\n` : `${result.summary}\n`);
    return;
  }

  const task = buildWatchTask(config, gitState);
  result.createdTaskId = task.task_id;
  result.created = true;
  result.summary = `${task.summary} Created approval task ${task.task_id}.`;

  if (!dryRun) {
    upsertPersistedPendingTask(config, task);
    if (!noPost) {
      await postApprovalRequest(config, task);
      result.posted = true;
    }
  }

  process.stdout.write(jsonOutput ? `${JSON.stringify(result)}\n` : `${result.summary}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
