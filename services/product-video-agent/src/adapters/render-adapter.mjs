import { createStableId } from '../ids.mjs';
import { RenderJobSchema } from '../schemas.mjs';
import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveInsideRoot } from '../paths.mjs';
import { runLocalProcess } from '../process-runner.mjs';
import { resolveFfmpegExecutable } from '../runtime-executables.mjs';

export class LocalFfmpegRenderPlanner {
  constructor(config) {
    this.config = config;
    this.name = 'ffmpeg';
  }

  createJob({ product, scriptJob, voiceJob, captionJob, assetGates, runAt }) {
    const executable = resolveFfmpegExecutable(this.config);
    const renderPurpose = this.config.purpose || 'publication_candidate';
    const jobId = createStableId('render', {
      scriptJobId: scriptJob.script_job_id,
      voiceOverJobId: voiceJob.voice_over_job_id,
      captionJobId: captionJob.caption_job_id,
      templateId: this.config.template_id,
      renderPurpose,
      fps: this.config.fps,
    });
    const outputPath = `data/runtime/product-video-agent/renders/${jobId}.mp4`;
    const blockers = [
      'approved_script_variant_missing',
      'voice_over_not_complete',
      'captions_not_complete',
      'render_approval_pending',
      'local_render_execution_not_enabled',
    ];
    const eligibleVisualAssets = assetGates.eligible.filter((asset) => (
      asset.media_type === 'image' || asset.media_type === 'video'
    ));
    const nonVisualAssetIds = assetGates.eligible
      .filter((asset) => asset.media_type !== 'image' && asset.media_type !== 'video')
      .map((asset) => asset.asset_id);
    if (eligibleVisualAssets.length === 0) {
      blockers.push(renderPurpose === 'internal_editor_test'
        ? 'no_approved_internal_test_assets'
        : 'no_rights_verified_local_assets');
    }

    return RenderJobSchema.parse({
      render_job_id: jobId,
      product_id: product.product_id,
      script_job_id: scriptJob.script_job_id,
      voice_over_job_id: voiceJob.voice_over_job_id,
      caption_job_id: captionJob.caption_job_id,
      renderer: this.name,
      render_purpose: renderPurpose,
      publication_eligible: renderPurpose === 'publication_candidate',
      watermark_required: renderPurpose === 'internal_editor_test',
      template_id: this.config.template_id,
      aspect_ratio: '9:16',
      width: 1080,
      height: 1920,
      fps: this.config.fps,
      platform_targets: this.config.platform_targets,
      asset_ids: eligibleVisualAssets.map((asset) => asset.asset_id),
      excluded_asset_ids: [
        ...assetGates.blocked.map(({ asset }) => asset.asset_id),
        ...nonVisualAssetIds,
      ],
      output_path: outputPath,
      status: 'blocked',
      blockers,
      estimated_cost: 0,
      execution_plan: {
        executable,
        args: [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          '<approved-asset-list>',
          '-i',
          voiceJob.output_path,
          '-vf',
          'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass=<approved-word-timed-captions>',
          '-r',
          String(this.config.fps),
          '-c:v',
          'libx264',
          '-c:a',
          'aac',
          outputPath,
        ],
        execute: false,
      },
      created_at: runAt,
    });
  }
}

function escapeFfmpegFilterPath(filePath) {
  return filePath
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
}

export function compileVerticalFfmpegArgs({ job, asset, voiceJob, captionJob, projectRoot }) {
  const assetPath = resolveInsideRoot(projectRoot, asset.local_path, 'Render asset path');
  const voicePath = resolveInsideRoot(projectRoot, voiceJob.output_path, 'Render voice path');
  const captionPath = resolveInsideRoot(projectRoot, captionJob.ass_output_path, 'Render caption path');
  const outputPath = resolveInsideRoot(projectRoot, job.output_path, 'Render output path');
  const visualInput = asset.media_type === 'image'
    ? ['-loop', '1', '-framerate', String(job.fps), '-i', assetPath]
    : ['-stream_loop', '-1', '-i', assetPath];
  const filter = [
    `scale=${job.width}:${job.height}:force_original_aspect_ratio=increase`,
    `crop=${job.width}:${job.height}`,
    `ass=filename='${escapeFfmpegFilterPath(captionPath)}'`,
    ...(job.watermark_required ? [
      "drawtext=text='INTERNAL TEST - DO NOT PUBLISH':fontcolor=white:fontsize=38:box=1:boxcolor=black@0.78:boxborderw=14:x=(w-text_w)/2:y=48",
    ] : []),
  ].join(',');

  return [
    '-y',
    ...visualInput,
    '-i',
    voicePath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    filter,
    '-r',
    String(job.fps),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export async function executeApprovedRender(jobInput, options) {
  const job = RenderJobSchema.parse(jobInput);
  const { asset, voiceJob, captionJob } = options;
  const publicationAssetApproved = job.render_purpose === 'publication_candidate'
    && job.publication_eligible
    && asset.usage_scope === 'publication'
    && asset.rights_status === 'verified'
    && asset.approval_status === 'approved';
  const internalAssetApproved = job.render_purpose === 'internal_editor_test'
    && !job.publication_eligible
    && job.watermark_required
    && asset.usage_scope === 'internal_editor_test'
    && asset.approval_status === 'approved'
    && ['manual_upload', 'fixture'].includes(asset.retrieval_method);
  if (!publicationAssetApproved && !internalAssetApproved) {
    throw new Error('FFmpeg rendering requires an asset approved for the render purpose.');
  }
  if (voiceJob.status !== 'complete') {
    throw new Error('FFmpeg rendering requires a completed voice-over.');
  }
  if (captionJob.status !== 'complete') {
    throw new Error('FFmpeg rendering requires completed word-timed captions.');
  }

  const projectRoot = options.projectRoot || process.cwd();
  const outputPath = resolveInsideRoot(projectRoot, job.output_path, 'Render output path');
  await mkdir(dirname(outputPath), { recursive: true });
  const args = compileVerticalFfmpegArgs({ job, asset, voiceJob, captionJob, projectRoot });
  const runProcess = options.runProcess || runLocalProcess;
  const executable = options.ffmpegExecutable || job.execution_plan.executable;
  await runProcess({ executable, args, cwd: projectRoot });
  if (options.verifyOutput !== false) {
    await access(outputPath);
  }

  return RenderJobSchema.parse({ ...job, status: 'complete', blockers: [] });
}
