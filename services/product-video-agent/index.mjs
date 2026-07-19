#!/usr/bin/env node

import { argv } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from './src/adapters/fixture-adapter.mjs';
import { loadPipelineConfig } from './src/config.mjs';
import { FileProductVideoStateStore } from './src/persistence.mjs';
import { runProductVideoDryRun } from './src/pipeline.mjs';

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
    '  --no-persist          Validate and print the summary without writing state.',
    '  --print-manifest      Print the full review manifest.',
    '  --help                Show this help.',
    '',
    'All marketplace, model, paid TTS, rendering, and publishing calls remain disabled.',
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
  const result = await runProductVideoDryRun({
    adapter,
    config,
    inputFile,
    projectRoot,
    store,
  });

  if (hasFlag('--print-manifest')) {
    process.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({
    run_id: result.manifest.run_id,
    manifest_path: result.persistence?.manifestPath || null,
    product: result.manifest.products[0].canonical_name,
    overall_score: result.manifest.product_scores[0].overall_score,
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
