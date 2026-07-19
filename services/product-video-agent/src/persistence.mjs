import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveInsideRoot } from './paths.mjs';
import { OutputManifestSchema } from './schemas.mjs';

export class ProductVideoStateStore {
  async saveRun() {
    throw new Error('State stores must implement saveRun().');
  }

  async loadRun() {
    throw new Error('State stores must implement loadRun().');
  }
}

export class FileProductVideoStateStore extends ProductVideoStateStore {
  constructor(options = {}) {
    super();
    this.projectRoot = options.projectRoot || process.cwd();
    this.outputDirectory = options.outputDirectory || 'data/runtime/product-video-agent';
  }

  resolveManifestPath(runId) {
    return resolveInsideRoot(
      this.projectRoot,
      resolve(this.projectRoot, this.outputDirectory, runId, 'manifest.json'),
      'Manifest output path',
    );
  }

  async saveRun(manifest) {
    const parsed = OutputManifestSchema.parse(manifest);
    const manifestPath = this.resolveManifestPath(parsed.run_id);
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return { runId: parsed.run_id, manifestPath, persistence: 'file' };
  }

  async loadRun(runId) {
    const manifestPath = this.resolveManifestPath(runId);
    return OutputManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  }
}

export class SupabaseProductVideoStateStore extends ProductVideoStateStore {
  constructor(options = {}) {
    super();
    this.configured = Boolean(options.supabaseUrl && options.apiKey);
  }

  async saveRun() {
    throw new Error('Supabase product-video persistence is intentionally stubbed for Phase 1.');
  }

  async loadRun() {
    throw new Error('Supabase product-video persistence is intentionally stubbed for Phase 1.');
  }
}
