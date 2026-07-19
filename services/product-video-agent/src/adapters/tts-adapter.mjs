import { createStableId } from '../ids.mjs';
import { VoiceOverJobSchema } from '../schemas.mjs';

export class LocalPiperTtsAdapter {
  constructor(config) {
    this.config = config;
    this.name = 'piper';
  }

  createJob({ product, scriptJob, runAt }) {
    const jobId = createStableId('voice', {
      scriptJobId: scriptJob.script_job_id,
      provider: this.name,
      model: this.config.model,
    });
    const outputPath = `data/runtime/product-video-agent/assets/${jobId}.wav`;

    return VoiceOverJobSchema.parse({
      voice_over_job_id: jobId,
      product_id: product.product_id,
      script_job_id: scriptJob.script_job_id,
      script_variant_id: null,
      provider: this.name,
      model: this.config.model,
      voice: this.config.voice,
      language: this.config.language,
      output_path: outputPath,
      status: 'blocked',
      blockers: ['approved_script_variant_missing', 'local_tts_execution_not_enabled'],
      approval_required: false,
      estimated_cost: 0,
      execution_plan: {
        executable: 'piper',
        args: ['--model', this.config.model, '--output_file', outputPath],
        input: 'approved_script_text',
        execute: false,
      },
      created_at: runAt,
    });
  }
}
export class PaidTtsStubAdapter {
  constructor() {
    this.name = 'paid_stub';
  }

  createJob() {
    throw new Error('Paid TTS is disabled and requires explicit spending approval.');
  }
}
