import { createStableId } from '../ids.mjs';
import { RenderJobSchema } from '../schemas.mjs';

export class LocalFfmpegRenderPlanner {
  constructor(config) {
    this.config = config;
    this.name = 'ffmpeg';
}
  createJob({ product, scriptJob, voiceJob, assetGates, runAt }) {
    const jobId = createStableId('render', {
      scriptJobId: scriptJob.script_job_id,
      templateId: this.config.template_id,
    });
    const outputPath = `data/runtime/product-video-agent/renders/${jobId}.mp4`;
    const blockers = ['approved_script_variant_missing', 'voice_over_not_complete', 'local_render_execution_not_enabled'];
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
      renderer: this.name,
      template_id: this.config.template_id,
      aspect_ratio: '9:16',
      width: 1080,
      height: 1920,
      fps: this.config.fps,
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
          'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,subtitles=<approved-captions>',
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
