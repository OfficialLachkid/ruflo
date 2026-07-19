#!/usr/bin/env node

import { argv } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from './src/adapters/fixture-adapter.mjs';
import { OllamaScriptAdapter } from './src/adapters/ollama-script-adapter.mjs';
import { loadPipelineConfig } from './src/config.mjs';
import { generateLocalScriptPreview } from './src/local-preview.mjs';
import { FileProductVideoStateStore } from './src/persistence.mjs';
import { runProductVideoDryRun } from './src/pipeline.mjs';
import { inspectProductVideoRuntime } from './src/runtime-readiness.mjs';

const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serviceDirectory, '../..');

function getArgValue(flag, fallback = '') {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }

  return argv[index + 1] || fallback;
}

function hasFlag(flag) {
  return argv.includes(flag);
}

function printHelp() {
  process.stdout.write([
    'Usage: node services/product-video-agent/index.mjs [options]',
    '',
    'Options:',
    '  --input-file <path>   Manual/fixture product JSON.',
    '  --config <path>       Local dry-run configuration JSON.',
    '  --output-dir <path>   Override the generated manifest directory.',
    '  --run-at <ISO date>   Override the deterministic run timestamp.',
    '  --doctor              Inspect local Ollama, Piper, and FFmpeg readiness.',
    '  --execute-local-scripts  Generate pending-review scripts with local Ollama.',
    '  --no-persist          Validate and print the summary without writing state.',
    '  --print-manifest      Print the full review manifest.',
    '  --help                Show this help.',
    '',
    'The default dry run makes no model or external calls.',
    'Local script execution is opt-in and cannot trigger TTS, rendering, downloads, or publishing.',
  ].join('\n'));
}

async function main() {
  if (hasFlag('--help')) {
    printHelp();
    return;
  }

  const inputFile = getArgValue(
    '--input-file',
    'services/product-video-agent/fixtures/example-product.json',
  );
  const configPath = getArgValue(
    '--config',
    'services/product-video-agent/config.example.json',
  );
  const runAt = getArgValue('--run-at');
  const outputDirectory = getArgValue('--output-dir');
  const config = await loadPipelineConfig(configPath, projectRoot, {
    ...(runAt ? { run_at: runAt } : {}),
    ...(outputDirectory ? { output_directory: outputDirectory } : {}),
  });
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const store = hasFlag('--no-persist')
    ? null
    : new FileProductVideoStateStore({
      projectRoot,
      outputDirectory: config.output_directory,
    });
  if (hasFlag('--doctor')) {
    const report = await inspectProductVideoRuntime({ config, projectRoot });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const executeLocalScripts = hasFlag('--execute-local-scripts');
  const dryRun = await runProductVideoDryRun({
    adapter,
    config,
    inputFile,
    projectRoot,
    store: executeLocalScripts ? null : store,
  });
  const result = executeLocalScripts
    ? await generateLocalScriptPreview({
      manifest: dryRun.manifest,
      scriptAdapter: new OllamaScriptAdapter(config.script),
      store,
    })
    : dryRun;

  if (hasFlag('--print-manifest')) {
    process.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({
    run_id: result.manifest.run_id,
    mode: result.manifest.mode,
    manifest_path: result.persistence?.manifestPath || null,
    product: result.manifest.products[0].canonical_name,
    overall_score: result.manifest.product_scores[0].overall_score,
    script_variants: result.manifest.script_variants.length,
    publication_targets: result.manifest.content_strategy.platforms,
    render_ready: result.manifest.gates.render_ready,
    publish_ready: result.manifest.gates.publish_ready,
    blocked_asset_ids: result.manifest.gates.blocked_asset_ids,
    incurred_cost: result.manifest.cost.incurred,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
