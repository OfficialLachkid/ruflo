import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PipelineConfigSchema, VoiceLicenseRecordSchema } from './schemas.mjs';

export async function loadPipelineConfig(configPath, projectRoot = process.cwd(), overrides = {}) {
  const absolutePath = resolve(projectRoot, configPath);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  return PipelineConfigSchema.parse({
    ...parsed,
    ...overrides,
  });
}

export async function loadVoiceLicenseRecord(config, projectRoot = process.cwd()) {
  const absolutePath = resolve(projectRoot, config.voice.license_record_path);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  const record = VoiceLicenseRecordSchema.parse(parsed);
  if (record.voice_id !== config.voice.model) {
    throw new Error(`Voice license record ${record.voice_id} does not match configured model ${config.voice.model}.`);
  }
  return record;
}
