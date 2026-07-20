import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolveInsideRoot } from './paths.mjs';
import { RuntimeReadinessReportSchema } from './schemas.mjs';
import { OllamaScriptAdapter } from './adapters/ollama-script-adapter.mjs';
import { loadVoiceLicenseRecords } from './config.mjs';

function runExecutable(executable, args, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: 'ignore' });
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ status: 'blocked', detail: `${executable} readiness check timed out.` });
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ status: 'blocked', detail: `${executable} is unavailable: ${error.message}` });
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code === 0
        ? { status: 'ready', detail: `${executable} is installed.` }
        : { status: 'blocked', detail: `${executable} exited with code ${code}.` });
    });
  });
}

async function checkModelFile(projectRoot, modelPath) {
  try {
    const modelFile = resolveInsideRoot(projectRoot, `${modelPath}.onnx`, 'Piper model path');
    const configFile = resolveInsideRoot(projectRoot, `${modelPath}.onnx.json`, 'Piper model config path');
    await Promise.all([access(modelFile), access(configFile)]);
    return { status: 'ready', detail: `Piper model and config are present at ${modelPath}.` };
  } catch (error) {
    return { status: 'blocked', detail: `Piper model is unavailable: ${error.message}` };
  }
}

async function checkVoiceLicense(config, projectRoot) {
  try {
    const records = await loadVoiceLicenseRecords(config, projectRoot);
    const blocked = records.find((record) => record.commercial_use_status !== 'approved');
    if (blocked) {
      return { status: 'blocked', detail: `Voice ${blocked.voice_id} is not approved for commercial use.` };
    }
    return {
      status: 'ready',
      detail: `${records.length} configured voices have reviewed commercial-use records.`,
    };
  } catch (error) {
    return { status: 'blocked', detail: `Voice license record is unavailable: ${error.message}` };
  }
}

export async function inspectProductVideoRuntime(options) {
  const { config, projectRoot = process.cwd() } = options;
  const ollamaAdapter = options.ollamaAdapter || new OllamaScriptAdapter(config.script);
  const executableCheck = options.executableCheck || runExecutable;
  const modelFileCheck = options.modelFileCheck || checkModelFile;
  const voiceLicenseCheck = options.voiceLicenseCheck || checkVoiceLicense;
  const piperExecutable = resolveInsideRoot(projectRoot, config.voice.executable, 'Piper executable path');
  const captionExecutable = resolveInsideRoot(projectRoot, config.captions.executable, 'Caption executable path');
  const piperModelPaths = config.voice.profiles.map((profile) => (
    `${config.voice.data_directory}/${profile.model}`
  ));
  const [ollama, piper, piperModel, voiceLicense, fasterWhisper, ffmpeg] = await Promise.all([
    ollamaAdapter.checkReadiness(),
    executableCheck(piperExecutable, ['-m', 'piper', '--help']),
    Promise.all(piperModelPaths.map((modelPath) => modelFileCheck(projectRoot, modelPath)))
      .then((checks) => checks.find((check) => check.status === 'blocked') || ({
        status: 'ready',
        detail: `${checks.length} configured Piper models are installed.`,
      })),
    voiceLicenseCheck(config, projectRoot),
    executableCheck(captionExecutable, ['-c', 'import faster_whisper'], 15_000),
    executableCheck('ffmpeg', ['-version']),
  ]);
  const components = {
    ollama,
    piper,
    piper_model: piperModel,
    voice_license: voiceLicense,
    faster_whisper: fasterWhisper,
    ffmpeg,
  };
  const ready = Object.values(components).every((component) => component.status === 'ready');
  const localRenderStackReady = [piper, piperModel, voiceLicense, fasterWhisper, ffmpeg]
    .every((component) => component.status === 'ready');

  return RuntimeReadinessReportSchema.parse({
    checked_at: options.checkedAt || new Date().toISOString(),
    overall: ready ? 'ready' : 'blocked',
    script_generation_ready: ollama.status === 'ready',
    components,
    local_render_stack_ready: localRenderStackReady,
  });
}
