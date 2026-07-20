#!/usr/bin/env node

import process from 'node:process';
import { projectRoot } from '../services/lib/runtime-config.mjs';
import {
  createScheduledProductVideoJob,
  readScheduledQueue,
  writeScheduledQueue,
} from '../services/product-video-agent/src/scheduled-queue.mjs';

function getArgValue(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

async function main() {
  const action = getArgValue('--action');
  if (!action) throw new Error('--action is required.');
  const queuePath = getArgValue('--queue');
  const queue = await readScheduledQueue(projectRoot, queuePath);
  const job = createScheduledProductVideoJob({
    action,
    input_file: getArgValue('--input-file') || null,
    config_path: getArgValue('--config', 'services/product-video-agent/config.example.json'),
    manifest_path: getArgValue('--manifest') || null,
    script_variant_id: getArgValue('--script-variant-id') || null,
    output_manifest_path: getArgValue('--write-manifest') || null,
    not_before: getArgValue('--not-before') || undefined,
  });
  const absolutePath = await writeScheduledQueue(projectRoot, [...queue, job], queuePath);
  process.stdout.write(`${JSON.stringify({ job, queue_path: absolutePath }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
