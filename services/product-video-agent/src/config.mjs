import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PipelineConfigSchema } from './schemas.mjs';

export async function loadPipelineConfig(configPath, projectRoot = process.cwd(), overrides = {}) {
  const absolutePath = resolve(projectRoot, configPath);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  return PipelineConfigSchema.parse({
    ...parsed,
    ...overrides,
  });
}
