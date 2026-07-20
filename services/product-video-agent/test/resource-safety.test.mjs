import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSharedRuntimeLock } from '../../lib/shared-runtime-lock.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { inspectProductVideoResourceAvailability } from '../src/resource-preflight.mjs';
import { resolveFfmpegExecutable } from '../src/runtime-executables.mjs';
import {
  claimNextScheduledJob,
  createScheduledProductVideoJob,
  readScheduledQueue,
  resolveScheduledJob,
  writeScheduledQueue,
} from '../src/scheduled-queue.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

test('shared runtime lock prevents overlapping heavy jobs', async () => {
  const lockDirectory = await mkdtemp(join(tmpdir(), 'orion-shared-lock-'));
  await withSharedRuntimeLock({ owner: 'first-job', lockDirectory }, async () => {
    await assert.rejects(
      withSharedRuntimeLock({ owner: 'second-job', lockDirectory }, async () => {}),
      (error) => error.code === 'RUNTIME_RESOURCE_BUSY' && error.lock.owner === 'first-job',
    );
  });
  await withSharedRuntimeLock({ owner: 'third-job', lockDirectory }, async () => {});
});

test('FFmpeg resolver selects keg-only ffmpeg-full on Apple Silicon', () => {
  const executable = resolveFfmpegExecutable({ executable: 'auto' }, {
    platform: 'darwin',
    environment: {},
    existsSync(candidate) {
      return candidate === '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
    },
  });
  assert.equal(executable, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg');
});

test('resource preflight defers for loaded Ollama models and active leadgen', async () => {
  const config = await loadPipelineConfig(
    'services/product-video-agent/config.example.json',
    projectRoot,
  );
  const report = await inspectProductVideoResourceAvailability(config, {
    checkedAt: '2026-07-20T12:00:00.000Z',
    async fetchImpl(url) {
      assert.equal(url, 'http://127.0.0.1:11434/api/ps');
      return { ok: true, async json() { return { models: [{ name: 'llama3.1:8b' }] }; } };
    },
    async processListProvider() {
      return '123 node scripts/run-scheduled-leadgen.mjs';
    },
  });

  assert.equal(report.status, 'deferred');
  assert.ok(report.reasons.includes('ollama_models_loaded=llama3.1:8b'));
  assert.ok(report.reasons.some((reason) => reason.includes('run-scheduled-leadgen.mjs')));
  assert.equal(report.retry_after_minutes, 30);
});

test('scheduled queue claims and resolves only explicit local actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-schedule-queue-'));
  const now = '2026-07-20T12:00:00.000Z';
  const job = createScheduledProductVideoJob({
    action: 'local_preview',
    input_file: 'fixtures/product.json',
  }, now);
  await writeScheduledQueue(root, [job]);
  const loaded = await readScheduledQueue(root);
  const claim = claimNextScheduledJob(loaded, now);
  const completed = resolveScheduledJob(claim.queue, job.job_id, {
    status: 'completed',
    updated_at: '2026-07-20T12:01:00.000Z',
  });

  assert.equal(claim.job.status, 'running');
  assert.equal(claim.job.attempts, 1);
  assert.equal(completed[0].status, 'completed');
  assert.throws(
    () => createScheduledProductVideoJob({ action: 'approved_render' }, now),
    /require manifest/u,
  );
});
