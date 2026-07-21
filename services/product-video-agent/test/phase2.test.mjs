import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import { executeCaptionTiming } from '../src/adapters/caption-adapter.mjs';
import { compileVerticalFfmpegArgs, executeApprovedRender } from '../src/adapters/render-adapter.mjs';
import { buildProductVideoApprovalCards } from '../src/approval-cards.mjs';
import { buildAssCaptions } from '../src/caption-timing.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { executeApprovedLocalRender, executeApprovedNarration } from '../src/local-assembly.mjs';
import { generateLocalScriptPreview } from '../src/local-preview.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';
import { applyWorkflowApprovalDecision } from '../src/approval-decisions.mjs';
import { evaluateInternalEditorTestAssetGates } from '../src/compliance.mjs';
import { RenderJobSchema } from '../src/schemas.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const inputFile = 'services/product-video-agent/fixtures/example-product.json';
const configFile = 'services/product-video-agent/config.example.json';

async function createDryRun() {
  const config = await loadPipelineConfig(configFile, projectRoot);
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  return runProductVideoDryRun({ adapter, config, inputFile, projectRoot });
}

async function createLocalPreview() {
  const { manifest } = await createDryRun();
  return generateLocalScriptPreview({
    manifest,
    scriptAdapter: {
      async checkReadiness() {
        return { status: 'ready', detail: 'Fixture local model ready.' };
      },
      async generateVariant({ product, scriptJob, runAt }) {
        return {
          script_variant_id: `script-variant-${scriptJob.angle}`,
          product_id: product.product_id,
          angle: scriptJob.angle,
          target_duration_seconds: scriptJob.target_duration_seconds,
          hook: `Hook for ${scriptJob.angle}`,
          body: 'A fixture-only product explanation.',
          call_to_action: 'Review the approved product details.',
          affiliate_disclosure: scriptJob.creative_brief.disclosure,
          spoken_text: `Hook for ${scriptJob.angle}. A fixture-only product explanation. Review the approved product details.`,
          generation_provider: 'fixture-local',
          model: 'fixture-model',
          status: 'awaiting_approval',
          approval_status: 'pending',
          created_at: runAt,
        };
      },
    },
  });
}

test('Phase 2 manifest includes licensed voice, captions, owned media, and workflow approvals', async () => {
  const { manifest } = await createDryRun();
  const ownedAsset = manifest.assets.find((asset) => asset.source_provider === 'orion-owned-fixture');
  const amazonAsset = manifest.assets.find((asset) => asset.source_provider === 'amazon-product-page');
  const ownedApproval = manifest.workflow_approvals.find((item) => item.subject_id === ownedAsset.asset_id);
  const amazonApproval = manifest.workflow_approvals.find((item) => item.subject_id === amazonAsset.asset_id);

  assert.equal(manifest.voice_license.voice_id, 'en_US-ljspeech-high');
  assert.equal(manifest.voice_license.dataset_license, 'public_domain');
  assert.equal(manifest.voice_license.commercial_use_status, 'approved');
  assert.deepEqual(
    manifest.voice_licenses.map((voice) => voice.voice_id),
    ['en_US-ljspeech-high', 'en_US-norman-medium'],
  );
  assert.deepEqual(
    manifest.voice_over_jobs.map((job) => job.voice_profile_id),
    ['us-female-ljspeech', 'us-male-norman', 'us-female-ljspeech'],
  );
  assert.equal(manifest.caption_jobs.length, 3);
  assert.equal(manifest.workflow_approvals.length, 9);
  assert.equal(ownedApproval.state, 'approved');
  assert.equal(amazonApproval.state, 'blocked');
  assert.ok(manifest.gates.eligible_asset_ids.includes(ownedAsset.asset_id));
  assert.ok(manifest.render_jobs.every((job) => job.asset_ids.includes(ownedAsset.asset_id)));
  assert.ok(manifest.render_jobs.every((job) => !job.asset_ids.includes(amazonAsset.asset_id)));
});

test('Discord cards enable script review and disable unsafe asset/render approvals', async () => {
  const { manifest } = await createLocalPreview();
  const cards = buildProductVideoApprovalCards(manifest);
  const scriptCard = cards.find(({ approval }) => approval.stage === 'script');
  const amazonCard = cards.find(({ approval }) => {
    const asset = manifest.assets.find((item) => item.asset_id === approval.subject_id);
    return asset?.source_provider === 'amazon-product-page';
  });
  const renderCard = cards.find(({ approval }) => approval.stage === 'render');

  assert.equal(scriptCard.payload.components[0].components[0].disabled, false);
  assert.equal(scriptCard.event.channelKey, 'orionReview');
  assert.equal(amazonCard.payload.components[0].components[0].disabled, true);
  assert.equal(renderCard.payload.components[0].components[0].disabled, true);
  assert.equal(scriptCard.payload.embeds[0].fields.some((field) => field.name === 'Script Preview'), true);
  assert.equal(scriptCard.payload.embeds[0].fields.some((field) => (
    field.name === 'Publication Disclosure (not narrated)'
  )), true);
  assert.equal(amazonCard.payload.embeds[0].fields.some((field) => field.name === 'Rights'), true);
  assert.equal(renderCard.payload.embeds[0].fields.some((field) => field.name === 'Render Blockers'), true);
});

test('planning-only scripts and blocked asset decisions cannot be approved', async () => {
  const { manifest } = await createDryRun();
  const cards = buildProductVideoApprovalCards(manifest);
  const plannedScriptCard = cards.find(({ approval }) => approval.stage === 'script');
  const blockedAssetApproval = manifest.workflow_approvals.find((approval) => (
    approval.stage === 'asset' && approval.state === 'blocked'
  ));

  assert.equal(plannedScriptCard.payload.components[0].components[0].disabled, true);
  assert.throws(
    () => applyWorkflowApprovalDecision(manifest, {
      taskId: blockedAssetApproval.task_id,
      decision: 'approve',
      actor: 'operator-test',
      reason: 'Should not bypass rights checks.',
      decidedAt: '2026-07-20T01:00:00.000Z',
    }),
    /blocked and cannot be approved/u,
  );
});

test('ASS captions use word-level karaoke timing and bounded groups', () => {
  const ass = buildAssCaptions([
    { start: 0, end: 0.5, word: 'This', probability: 0.99 },
    { start: 0.5, end: 1, word: 'is', probability: 0.98 },
    { start: 1, end: 1.5, word: 'local', probability: 0.97 },
  ], { maxWordsPerLine: 2 });

  assert.match(ass, /\\k50\}This/u);
  assert.match(ass, /PlayResX: 1080/u);
  assert.equal(ass.split('\n').filter((line) => line.startsWith('Dialogue:')).length, 2);
});

test('faster-whisper adapter writes validated word and ASS artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-caption-'));
  const job = {
    caption_job_id: 'caption-test',
    product_id: 'product-test',
    script_job_id: 'script-job-test',
    voice_over_job_id: 'voice-test',
    provider: 'faster_whisper',
    model: 'small.en',
    language: 'en-US',
    audio_path: 'audio/voice.wav',
    words_output_path: 'captions/voice.words.json',
    ass_output_path: 'captions/voice.ass',
    status: 'blocked',
    blockers: ['voice_over_not_complete'],
    words: [],
    duration_seconds: 0,
    execution_plan: {
      executable: '.venv/bin/python',
      args: ['worker.py', '--audio-path', 'audio/voice.wav', '--model', 'small.en', '--word-timestamps'],
      execute: false,
    },
    created_at: '2026-07-20T00:00:00.000Z',
  };
  const completed = await executeCaptionTiming(job, {
    projectRoot: root,
    async runProcess() {
      return {
        stdout: JSON.stringify({
          durationSeconds: 1.2,
          words: [
            { start: 0, end: 0.5, word: 'Local', probability: 0.99 },
            { start: 0.5, end: 1.2, word: 'captions', probability: 0.98 },
          ],
        }),
      };
    },
  });

  assert.equal(completed.status, 'complete');
  assert.equal(completed.words.length, 2);
  assert.match(await readFile(join(root, 'captions/voice.ass'), 'utf8'), /Local/u);
  assert.match(await readFile(join(root, 'captions/voice.words.json'), 'utf8'), /captions/u);
});

test('FFmpeg compiler uses one approved visual, ASS captions, H.264, and AAC', async () => {
  const { manifest } = await createDryRun();
  const job = manifest.render_jobs[0];
  const asset = manifest.assets.find((item) => item.asset_id === job.asset_ids[0]);
  const voiceJob = manifest.voice_over_jobs[0];
  const captionJob = manifest.caption_jobs[0];
  const args = compileVerticalFfmpegArgs({ job, asset, voiceJob, captionJob, projectRoot });

  assert.ok(args.includes('-loop'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.match(args[args.indexOf('-vf') + 1], /ass=filename/u);
  assert.ok(args.includes('-shortest'));
});

test('internal editor-test footage is local-only, watermarked, and never publication eligible', async () => {
  const { manifest } = await createDryRun();
  const ownedAsset = manifest.assets.find((asset) => asset.source_provider === 'orion-owned-fixture');
  const internalAsset = {
    ...ownedAsset,
    source_provider: 'operator-supplied-amazon-test-footage',
    retrieval_method: 'manual_upload',
    rights_status: 'unverified',
    rights_basis: 'unknown',
    rights_evidence: null,
    usage_scope: 'internal_editor_test',
  };
  const gates = await evaluateInternalEditorTestAssetGates([internalAsset], projectRoot);
  const sourceJob = manifest.render_jobs[0];
  const internalJob = RenderJobSchema.parse({
    ...sourceJob,
    render_purpose: 'internal_editor_test',
    publication_eligible: false,
    watermark_required: true,
    asset_ids: [internalAsset.asset_id],
  });
  const voiceJob = { ...manifest.voice_over_jobs[0], status: 'complete', blockers: [] };
  const captionJob = { ...manifest.caption_jobs[0], status: 'complete', blockers: [] };
  const args = compileVerticalFfmpegArgs({
    job: internalJob,
    asset: internalAsset,
    voiceJob,
    captionJob,
    projectRoot,
  });
  const completed = await executeApprovedRender(internalJob, {
    asset: internalAsset,
    voiceJob,
    captionJob,
    projectRoot,
    verifyOutput: false,
    async runProcess() {
      return { stdout: '' };
    },
  });

  assert.equal(gates.eligible.length, 1);
  assert.match(args[args.indexOf('-vf') + 1], /INTERNAL TEST - DO NOT PUBLISH/u);
  assert.equal(completed.publication_eligible, false);
  assert.equal(completed.status, 'complete');
});

test('local narration refuses a pending script before invoking any process', async () => {
  const { manifest } = await createLocalPreview();
  let processCalls = 0;
  await assert.rejects(
    executeApprovedNarration({
      manifest,
      scriptVariantId: manifest.script_variants[0].script_variant_id,
      projectRoot,
      async runProcess() {
        processCalls += 1;
        return { stdout: '' };
      },
    }),
    /script approval is required/u,
  );
  assert.equal(processCalls, 0);
});

test('approved narration unlocks the render card and approved FFmpeg remains non-publishing', async () => {
  const preview = await createLocalPreview();
  const scriptVariant = preview.manifest.script_variants[0];
  const scriptApproval = preview.manifest.workflow_approvals.find((item) => (
    item.stage === 'script' && item.subject_id === scriptVariant.script_variant_id
  ));
  const scriptApproved = applyWorkflowApprovalDecision(preview.manifest, {
    taskId: scriptApproval.task_id,
    decision: 'approve',
    actor: 'operator-test',
    reason: 'Fixture script approved for local renderer validation.',
    decidedAt: '2026-07-20T01:00:00.000Z',
  });
  let processCalls = 0;
  let piperSpokenText = '';
  const narrated = await executeApprovedNarration({
    manifest: scriptApproved,
    scriptVariantId: scriptVariant.script_variant_id,
    projectRoot,
    verifyOutput: false,
    async writeCaptionArtifacts() {},
    async runProcess({ args }) {
      processCalls += 1;
      if (!args.includes('--word-timestamps')) piperSpokenText = args.at(-1);
      return args.includes('--word-timestamps')
        ? {
            stdout: JSON.stringify({
              durationSeconds: 1,
              words: [{ start: 0, end: 1, word: 'Approved', probability: 0.99 }],
            }),
          }
        : { stdout: '' };
    },
  });
  const renderJob = narrated.render_jobs.find((job) => (
    job.voice_over_job_id === narrated.voice_over_jobs.find((job) => (
      job.script_variant_id === scriptVariant.script_variant_id
    )).voice_over_job_id
  ));
  const renderApproval = narrated.workflow_approvals.find((item) => (
    item.stage === 'render' && item.subject_id === renderJob.render_job_id
  ));

  assert.equal(narrated.mode, 'local_narration');
  assert.equal(renderApproval.state, 'pending');
  assert.deepEqual(renderJob.blockers, ['render_approval_pending']);
  assert.equal(processCalls, 2);
  assert.equal(piperSpokenText, scriptVariant.spoken_text);
  assert.doesNotMatch(piperSpokenText, /affiliate links/u);

  const renderApproved = applyWorkflowApprovalDecision(narrated, {
    taskId: renderApproval.task_id,
    decision: 'approve',
    actor: 'operator-test',
    reason: 'Fixture render approved for local validation.',
    decidedAt: '2026-07-20T01:05:00.000Z',
  });
  const rendered = await executeApprovedLocalRender({
    manifest: renderApproved,
    scriptVariantId: scriptVariant.script_variant_id,
    projectRoot,
    config: { render: { executable: 'ffmpeg' } },
    verifyOutput: false,
    async runProcess({ executable }) {
      assert.equal(executable, 'ffmpeg');
      return { stdout: '' };
    },
  });

  assert.equal(rendered.mode, 'local_render');
  assert.equal(rendered.gates.render_ready, true);
  assert.equal(rendered.gates.publish_ready, false);
  assert.equal(rendered.external_calls.local_render, 'local_executed');
});
