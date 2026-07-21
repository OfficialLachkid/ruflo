import { createStableId } from '../ids.mjs';
import { VoiceOverJobSchema } from '../schemas.mjs';
import { mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveInsideRoot } from '../paths.mjs';
import { runLocalProcess } from '../process-runner.mjs';

export class LocalPiperTtsAdapter {
  constructor(config, profile) {
    this.config = config;
    this.profile = profile;
    this.name = 'piper';
  }

  createJob({ product, scriptJob, voiceLicense, runAt }) {
    const jobId = createStableId('voice', {
      scriptJobId: scriptJob.script_job_id,
      provider: this.name,
      model: this.profile.model,
    });
    const outputPath = `data/runtime/product-video-agent/assets/${jobId}.wav`;

    return VoiceOverJobSchema.parse({
      voice_over_job_id: jobId,
      product_id: product.product_id,
      script_job_id: scriptJob.script_job_id,
      script_variant_id: null,
      provider: this.name,
      voice_profile_id: this.profile.profile_id,
      model: this.profile.model,
      voice: this.profile.voice,
      language: this.profile.language,
      license_record_path: this.profile.license_record_path,
      commercial_use_status: voiceLicense.commercial_use_status,
      output_path: outputPath,
      status: 'blocked',
      blockers: [
        'approved_script_variant_missing',
        ...(voiceLicense.commercial_use_status === 'approved' ? [] : ['voice_commercial_use_not_approved']),
        'local_tts_execution_not_enabled',
      ],
      approval_required: false,
      estimated_cost: 0,
      execution_plan: {
        executable: this.config.executable,
        args: [
          '-m',
          'piper',
          '-m',
          this.profile.model,
          '--data-dir',
          this.config.data_directory,
          '-f',
          outputPath,
          '--',
        ],
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

export async function executeApprovedVoiceOver(jobInput, scriptVariant, options = {}) {
  const job = VoiceOverJobSchema.parse(jobInput);
  if (scriptVariant.status !== 'approved' || scriptVariant.approval_status !== 'approved') {
    throw new Error('Voice synthesis requires an approved script variant.');
  }
  if (job.commercial_use_status !== 'approved') {
    throw new Error('Voice synthesis requires a commercial-use-approved voice record.');
  }

  const projectRoot = options.projectRoot || process.cwd();
  const executable = resolveInsideRoot(projectRoot, job.execution_plan.executable, 'Piper executable');
  const outputPath = resolveInsideRoot(projectRoot, job.output_path, 'Voice output path');
  const args = job.execution_plan.args.map((arg, index, allArgs) => {
    if (allArgs[index - 1] === '--data-dir' || allArgs[index - 1] === '-f') {
      return resolveInsideRoot(projectRoot, arg, 'Piper runtime path');
    }
    return arg;
  });
  args.push(scriptVariant.spoken_text);
  await mkdir(dirname(outputPath), { recursive: true });
  const runProcess = options.runProcess || runLocalProcess;
  await runProcess({ executable, args, cwd: projectRoot });
  if (options.verifyOutput !== false) {
    await access(outputPath);
  }

  return VoiceOverJobSchema.parse({
    ...job,
    script_variant_id: scriptVariant.script_variant_id,
    status: 'complete',
    blockers: [],
  });
}
