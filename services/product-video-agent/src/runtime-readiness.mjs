import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolveInsideRoot } from './paths.mjs';
import { RuntimeReadinessReportSchema } from './schemas.mjs';
import { OllamaScriptAdapter } from './adapters/ollama-script-adapter.mjs';
import { loadVoiceLicenseRecord } from './config.mjs';

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
    const record = await loadVoiceLicenseRecord(config, projectRoot);
    if (record.commercial_use_status !== 'approved') {
      return { status: 'blocked', detail: `Voice ${record.voice_id} is not approved for commercial use.` };
    }
    return {
      status: 'ready',
      detail: `Voice ${record.voice_id} has a reviewed commercial-use record (${record.dataset_license}).`,
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
  const piperModelPath = `${config.voice.data_directory}/${config.voice.model}`;
  const [ollama, piper, piperModel, voiceLicense, fasterWhisper, ffmpeg] = await Promise.all([
    ollamaAdapter.checkReadiness(),
    executableCheck(piperExecutable, ['-m', 'piper', '--help']),
    modelFileCheck(projectRoot, piperModelPath),
    voiceLicenseCheck(config, projectRoot),
    executableCheck(captionExecutable, ['-c', 'import faster_whisper']),
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
