import { evaluateAssetGates, evaluateInternalEditorTestAssetGates } from './compliance.mjs';
import { OutputManifestSchema, RenderJobSchema, WorkflowApprovalSchema } from './schemas.mjs';
import { executeApprovedVoiceOver } from './adapters/tts-adapter.mjs';
import { executeCaptionTiming } from './adapters/caption-adapter.mjs';
import { executeApprovedRender } from './adapters/render-adapter.mjs';
import { withLocalMediaJobLock } from './media-job-lock.mjs';
import { resolveFfmpegExecutable } from './runtime-executables.mjs';

function requireApproval(manifest, stage, subjectId) {
  const approval = manifest.workflow_approvals.find((item) => (
    item.stage === stage && item.subject_id === subjectId
  ));
  if (!approval || approval.state !== 'approved') {
    throw new Error(`${stage} approval is required for ${subjectId}.`);
  }
  return approval;
}

function replaceById(items, idKey, replacement) {
  return items.map((item) => item[idKey] === replacement[idKey] ? replacement : item);
}

function findAssemblyBundle(manifest, scriptVariantId) {
  const scriptVariant = manifest.script_variants.find((item) => (
    item.script_variant_id === scriptVariantId
  ));
  if (!scriptVariant) {
    throw new Error(`Script variant ${scriptVariantId} was not found.`);
  }
  const voiceJob = manifest.voice_over_jobs.find((item) => (
    item.script_variant_id === scriptVariant.script_variant_id
  ));
  const captionJob = manifest.caption_jobs.find((item) => (
    item.voice_over_job_id === voiceJob?.voice_over_job_id
  ));
  const renderJob = manifest.render_jobs.find((item) => (
    item.voice_over_job_id === voiceJob?.voice_over_job_id
  ));
  if (!voiceJob || !captionJob || !renderJob) {
    throw new Error('Voice, caption, and render jobs are required for local assembly.');
  }
  return { scriptVariant, voiceJob, captionJob, renderJob };
}

async function findApprovedAsset(manifest, renderJob, projectRoot) {
  const assetGates = renderJob.render_purpose === 'internal_editor_test'
    ? await evaluateInternalEditorTestAssetGates(manifest.assets, projectRoot)
    : await evaluateAssetGates(manifest.assets, projectRoot);
  const eligibleById = new Map(assetGates.eligible.map((asset) => [asset.asset_id, asset]));
  const asset = renderJob.asset_ids.map((assetId) => eligibleById.get(assetId)).find(Boolean);
  if (!asset) {
    throw new Error(renderJob.render_purpose === 'internal_editor_test'
      ? 'No approved, hashed local asset is available for the internal editor test.'
      : 'No rights-verified local visual asset is available for rendering.');
  }
  requireApproval(manifest, 'asset', asset.asset_id);
  return asset;
}

async function executeApprovedNarrationUnlocked(options) {
  const sourceManifest = OutputManifestSchema.parse(options.manifest);
  const projectRoot = options.projectRoot || process.cwd();
  const bundle = findAssemblyBundle(sourceManifest, options.scriptVariantId);
  requireApproval(sourceManifest, 'script', bundle.scriptVariant.script_variant_id);
  if (bundle.scriptVariant.status !== 'approved' || bundle.scriptVariant.approval_status !== 'approved') {
    throw new Error('The selected script variant is not approved in the manifest.');
  }
  await findApprovedAsset(sourceManifest, bundle.renderJob, projectRoot);

  const completedVoiceJob = await executeApprovedVoiceOver(bundle.voiceJob, bundle.scriptVariant, {
    projectRoot,
    runProcess: options.runProcess,
    verifyOutput: options.verifyOutput,
  });
  const completedCaptionJob = await executeCaptionTiming(bundle.captionJob, {
    projectRoot,
    runProcess: options.runProcess,
    maxWordsPerLine: options.maxWordsPerLine,
    expectedText: bundle.scriptVariant.spoken_text,
    writeCaptionArtifacts: options.writeCaptionArtifacts,
  });
  const preparedRenderJob = RenderJobSchema.parse({
    ...bundle.renderJob,
    blockers: ['render_approval_pending'],
  });
  const workflowApprovals = sourceManifest.workflow_approvals.map((approval) => {
    if (approval.stage !== 'render' || approval.subject_id !== bundle.renderJob.render_job_id) {
      return approval;
    }
    return WorkflowApprovalSchema.parse({
      ...approval,
      state: 'pending',
      blocking_reasons: [],
    });
  });

  return OutputManifestSchema.parse({
    ...sourceManifest,
    mode: 'local_narration',
    voice_over_jobs: replaceById(sourceManifest.voice_over_jobs, 'voice_over_job_id', completedVoiceJob),
    caption_jobs: replaceById(sourceManifest.caption_jobs, 'caption_job_id', completedCaptionJob),
    render_jobs: replaceById(sourceManifest.render_jobs, 'render_job_id', preparedRenderJob),
    workflow_approvals: workflowApprovals,
    external_calls: {
      ...sourceManifest.external_calls,
      local_tts: 'local_executed',
      local_caption: 'local_executed',
    },
    notes: [
      ...sourceManifest.notes,
      'Approved narration and word-timed captions completed locally; render approval is now pending.',
    ],
  });
}

async function executeApprovedLocalRenderUnlocked(options) {
  const sourceManifest = OutputManifestSchema.parse(options.manifest);
  const projectRoot = options.projectRoot || process.cwd();
  const bundle = findAssemblyBundle(sourceManifest, options.scriptVariantId);
  requireApproval(sourceManifest, 'script', bundle.scriptVariant.script_variant_id);
  requireApproval(sourceManifest, 'render', bundle.renderJob.render_job_id);
  const asset = await findApprovedAsset(sourceManifest, bundle.renderJob, projectRoot);
  const completedRenderJob = await executeApprovedRender(bundle.renderJob, {
    asset,
    voiceJob: bundle.voiceJob,
    captionJob: bundle.captionJob,
    projectRoot,
    ffmpegExecutable: resolveFfmpegExecutable(options.config || {
      executable: bundle.renderJob.execution_plan.executable,
    }),
    runProcess: options.runProcess,
    verifyOutput: options.verifyOutput,
  });

  return OutputManifestSchema.parse({
    ...sourceManifest,
    mode: bundle.renderJob.render_purpose === 'internal_editor_test'
      ? 'internal_editor_test'
      : 'local_render',
    render_jobs: replaceById(sourceManifest.render_jobs, 'render_job_id', completedRenderJob),
    gates: { ...sourceManifest.gates, render_ready: true },
    external_calls: { ...sourceManifest.external_calls, local_render: 'local_executed' },
    notes: [
      ...sourceManifest.notes,
      bundle.renderJob.render_purpose === 'internal_editor_test'
        ? 'Internal editor-test render completed from a manually supplied local asset with a mandatory do-not-publish watermark.'
        : 'One local render completed from approved narration and a rights-verified local asset.',
      'Publishing remains disabled and separately approval-gated.',
    ],
  });
}

export function executeApprovedNarration(options) {
  return withLocalMediaJobLock(options, () => executeApprovedNarrationUnlocked(options));
}

export function executeApprovedLocalRender(options) {
  return withLocalMediaJobLock(options, () => executeApprovedLocalRenderUnlocked(options));
}
