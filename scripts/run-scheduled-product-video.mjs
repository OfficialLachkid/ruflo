#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { loadPipelineConfig } from '../services/product-video-agent/src/config.mjs';
import { inspectProductVideoResourceAvailability } from '../services/product-video-agent/src/resource-preflight.mjs';
import {
  claimNextScheduledJob,
  readScheduledQueue,
  resolveScheduledJob,
  writeScheduledQueue,
} from '../services/product-video-agent/src/scheduled-queue.mjs';

const execFileAsync = promisify(execFile);

function getArgValue(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function buildJobArgs(job) {
  const base = ['services/product-video-agent/index.mjs', '--config', job.config_path];
  if (job.action === 'local_preview') {
    return [...base, '--execute-local-scripts', ...(job.input_file ? ['--input-file', job.input_file] : [])];
  }
  const actionFlag = job.action === 'approved_narration'
    ? '--execute-approved-narration'
    : '--execute-approved-render';
  return [
    ...base,
    actionFlag,
    job.manifest_path,
    '--script-variant-id',
    job.script_variant_id,
    '--write-manifest',
    job.output_manifest_path,
  ];
}

function deferTime(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function main() {
  const runtimeConfig = loadRuntimeConfig();
  const queuePath = getArgValue('--queue');
  let queue = await readScheduledQueue(projectRoot, queuePath);
  const claim = claimNextScheduledJob(queue);
  if (!claim.job) {
    recordOpsMetric(runtimeConfig, 'orion_schedule_idle', { queuedJobs: queue.length });
    process.stdout.write(`${JSON.stringify({ state: 'idle', queued_jobs: queue.length })}\n`);
    return;
  }

  const pipelineConfig = await loadPipelineConfig(claim.job.config_path, projectRoot);
  const availability = await inspectProductVideoResourceAvailability(pipelineConfig);
  if (availability.status !== 'ready') {
    queue = resolveScheduledJob(claim.queue, claim.job.job_id, {
      status: 'deferred',
      not_before: deferTime(availability.retry_after_minutes),
      updated_at: new Date().toISOString(),
      last_error: availability.reasons.join('; '),
    });
    await writeScheduledQueue(projectRoot, queue, queuePath);
    recordOpsMetric(runtimeConfig, 'orion_schedule_deferred', {
      jobId: claim.job.job_id,
      reasons: availability.reasons,
    });
    process.stdout.write(`${JSON.stringify({ state: 'deferred', ...availability })}\n`);
    return;
  }

  await writeScheduledQueue(projectRoot, claim.queue, queuePath);
  try {
    const result = await execFileAsync(process.execPath, buildJobArgs(claim.job), {
      cwd: projectRoot,
      maxBuffer: 2 * 1024 * 1024,
    });
    queue = resolveScheduledJob(claim.queue, claim.job.job_id, {
      status: 'completed',
      updated_at: new Date().toISOString(),
      last_error: '',
    });
    await writeScheduledQueue(projectRoot, queue, queuePath);
    recordOpsMetric(runtimeConfig, 'orion_schedule_completed', {
      jobId: claim.job.job_id,
      action: claim.job.action,
    });
    process.stdout.write(result.stdout);
  } catch (error) {
    const busy = String(error.stderr || error.message).includes('RUNTIME_RESOURCE_BUSY');
    queue = resolveScheduledJob(claim.queue, claim.job.job_id, {
      status: busy ? 'deferred' : 'failed',
      not_before: busy ? deferTime(pipelineConfig.runtime_safety.defer_minutes) : claim.job.not_before,
      updated_at: new Date().toISOString(),
      last_error: String(error.stderr || error.message).slice(0, 1000),
    });
    await writeScheduledQueue(projectRoot, queue, queuePath);
    recordOpsMetric(runtimeConfig, busy ? 'orion_schedule_deferred' : 'orion_schedule_failed', {
      jobId: claim.job.job_id,
      action: claim.job.action,
      error: String(error.stderr || error.message).slice(0, 300),
    });
    if (!busy) throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`Scheduled O.R.I.O.N. run failed: ${error.stderr || error.message}\n`);
  process.exitCode = 1;
});
