import { createStableId } from '../ids.mjs';
import { RenderJobSchema } from '../schemas.mjs';
import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveInsideRoot } from '../paths.mjs';
import { runLocalProcess } from '../process-runner.mjs';

export class LocalFfmpegRenderPlanner {
  constructor(config) {
    this.config = config;
    this.name = 'ffmpeg';
  }

  createJob({ product, scriptJob, voiceJob, captionJob, assetGates, runAt }) {
    const jobId = createStableId('render', {
      scriptJobId: scriptJob.script_job_id,
      templateId: this.config.template_id,
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
      blockers.push('no_rights_verified_local_assets');
    }

    return RenderJobSchema.parse({
      render_job_id: jobId,
      product_id: product.product_id,
      script_job_id: scriptJob.script_job_id,
      voice_over_job_id: voiceJob.voice_over_job_id,
      caption_job_id: captionJob.caption_job_id,
      renderer: this.name,
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
        executable: 'ffmpeg',
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
  if (asset.rights_status !== 'verified' || asset.approval_status !== 'approved') {
    throw new Error('FFmpeg rendering requires a rights-verified, approved asset.');
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
  await runProcess({ executable: 'ffmpeg', args, cwd: projectRoot });
  if (options.verifyOutput !== false) {
    await access(outputPath);
  }

  return RenderJobSchema.parse({ ...job, status: 'complete', blockers: [] });
}
