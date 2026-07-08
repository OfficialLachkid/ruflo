#!/usr/bin/env node

import process from 'node:process';

const STATUS_COLOR = {
  success: 0x57F287,
  failure: 0xED4245,
  cancelled: 0x95A5A6,
  skipped: 0xFEE75C,
};

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function shortSha(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 7) : '';
}

function buildCommitUrl(sha, repository) {
  const normalizedSha = env('CI_SHA', env('GITHUB_SHA', sha));
  const normalizedRepository = repository || env('CI_REPOSITORY', env('GITHUB_REPOSITORY'));
  const serverUrl = env('GITHUB_SERVER_URL');
  return normalizedSha && normalizedRepository && serverUrl
    ? `${serverUrl}/${normalizedRepository}/commit/${normalizedSha}`
    : '';
}

function buildRunUrl() {
  const explicit = env('CI_RUN_URL');
  if (explicit) {
    return explicit;
  }

  const serverUrl = env('GITHUB_SERVER_URL');
  const repository = env('GITHUB_REPOSITORY');
  const runId = env('GITHUB_RUN_ID');
  return serverUrl && repository && runId
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : '';
}

function buildPayload() {
  const status = env('CI_STATUS', 'unknown').toLowerCase();
  const workflowName = env('CI_WORKFLOW_NAME', 'Ruflo CI');
  const jobName = env('CI_JOB_NAME', 'Runtime Validation');
  const repository = env('CI_REPOSITORY', env('GITHUB_REPOSITORY', 'unknown'));
  const refName = env('CI_REF_NAME', env('GITHUB_REF_NAME', 'unknown'));
  const sha = env('CI_SHA', env('GITHUB_SHA'));
  const eventName = env('CI_EVENT_NAME', env('GITHUB_EVENT_NAME', 'unknown'));
  const actor = env('CI_ACTOR', env('GITHUB_ACTOR', 'unknown'));
  const prNumber = env('CI_PR_NUMBER');
  const runUrl = buildRunUrl();
  const runNumber = env('GITHUB_RUN_NUMBER');
  const commitUrl = buildCommitUrl(sha, repository);

  const fields = [
    { name: 'Workflow', value: `\`${workflowName}\``, inline: true },
    { name: 'Job', value: `\`${jobName}\``, inline: true },
    { name: 'Status', value: `\`${status}\``, inline: true },
    { name: 'Repository', value: `\`${repository}\``, inline: true },
    { name: 'Ref', value: `\`${refName}\``, inline: true },
    { name: 'Event', value: `\`${eventName}\``, inline: true },
    { name: 'Actor', value: `\`${actor}\``, inline: true },
    {
      name: 'Commit',
      value: sha
        ? commitUrl
          ? `[\`${shortSha(sha)}\`](${commitUrl})`
          : `\`${shortSha(sha)}\``
        : '`unknown`',
      inline: true,
    },
  ];

  if (prNumber) {
    fields.push({ name: 'PR', value: `#${prNumber}`, inline: true });
  }

  if (runNumber) {
    fields.push({ name: 'Run', value: `#${runNumber}`, inline: true });
  }

  if (runUrl) {
    fields.push({ name: 'Details', value: runUrl, inline: false });
  }

  return {
    embeds: [
      {
        color: STATUS_COLOR[status] || 0x5865F2,
        title: `GitHub CI ${status.toUpperCase()} - ${repository}`,
        description: `${workflowName} finished for \`${refName}\`.`,
        fields,
        footer: {
          text: 'Ruflo GitHub CI',
        },
      },
    ],
  };
}

async function main() {
  const webhookUrl = env('DISCORD_WEBHOOK_URL');
  if (!webhookUrl) {
    process.stdout.write('DISCORD_WEBHOOK_URL is not set. Skipping Discord CI notification.\n');
    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildPayload()),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord webhook post failed (${response.status}): ${errorText}`);
  }

  process.stdout.write('Posted CI result to Discord webhook.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
