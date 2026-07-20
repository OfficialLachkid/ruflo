#!/usr/bin/env node

import { argv } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from './src/adapters/fixture-adapter.mjs';
import { OllamaScriptAdapter } from './src/adapters/ollama-script-adapter.mjs';
import { loadPipelineConfig } from './src/config.mjs';
import { generateLocalScriptPreview } from './src/local-preview.mjs';
import { FileProductVideoStateStore } from './src/persistence.mjs';
import { runProductVideoDryRun } from './src/pipeline.mjs';
import { inspectProductVideoRuntime } from './src/runtime-readiness.mjs';
import { buildProductVideoApprovalCards } from './src/approval-cards.mjs';
import { executeApprovedLocalRender, executeApprovedNarration } from './src/local-assembly.mjs';
import { resolveInsideRoot } from './src/paths.mjs';
import { applyWorkflowApprovalDecision } from './src/approval-decisions.mjs';
import {
  assertProductVideoResourcesAvailable,
  inspectProductVideoResourceAvailability,
} from './src/resource-preflight.mjs';
import { withSharedRuntimeLock } from '../lib/shared-runtime-lock.mjs';

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
    '  --resource-preflight  Check that Ollama and conflicting heavy jobs are idle.',
    '  --execute-local-scripts  Generate pending-review scripts with local Ollama.',
    '  --approval-cards     Print Discord card payloads without sending them.',
    '  --manifest <path>     Existing manifest used to regenerate approval cards.',
    '  --decide-workflow <manifest>  Apply an operator approval decision locally.',
    '  --task-id <id>        Workflow task ID for a decision.',
    '  --decision <value>    approve or reject.',
    '  --actor <name>        Operator identity recording the decision.',
    '  --reason <text>       Required rejection reason; optional approval note.',
    '  --execute-approved-narration <manifest>  Run Piper and caption timing.',
    '  --execute-approved-render <manifest>  Execute one fully approved local render.',
    '  --script-variant-id <id>  Approved script variant to render.',
    '  --write-manifest <path>  Write the updated manifest inside the repository.',
    '  --no-persist          Validate and print the summary without writing state.',
    '  --print-manifest      Print the full review manifest.',
    '  --help                Show this help.',
    '',
    'The default dry run makes no model or external calls.',
    'Local script execution is opt-in and cannot trigger TTS, rendering, downloads, or publishing.',
    'Approved rendering still requires approved manifest records and never publishes.',
  ].join('\n'));
}

async function writeOrPrintManifest(manifest) {
  const outputPath = getArgValue('--write-manifest');
  if (!outputPath) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return null;
  }
  const absolutePath = resolveInsideRoot(projectRoot, outputPath, 'Output manifest path');
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ manifest_path: absolutePath, mode: manifest.mode }, null, 2)}\n`);
  return absolutePath;
}

async function runResourceGuarded(config, owner, operation) {
  return withSharedRuntimeLock({ owner }, async () => {
    await assertProductVideoResourcesAvailable(config);
    return operation();
  });
}

async function main() {
  if (hasFlag('--help')) {
    printHelp();
    return;
  }

  const decisionManifestPath = getArgValue('--decide-workflow');
  if (decisionManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, decisionManifestPath, 'Decision manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const decided = applyWorkflowApprovalDecision(manifest, {
      taskId: getArgValue('--task-id'),
      decision: getArgValue('--decision'),
      actor: getArgValue('--actor'),
      reason: getArgValue('--reason'),
      decidedAt: getArgValue('--decided-at', new Date().toISOString()),
    });
    await writeOrPrintManifest(decided);
    return;
  }

  const existingManifestPath = getArgValue('--manifest');
  if (hasFlag('--approval-cards') && existingManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, existingManifestPath, 'Approval-card manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const cards = buildProductVideoApprovalCards(manifest);
    process.stdout.write(`${JSON.stringify(cards.map(({ approval, payload }) => ({ approval, payload })), null, 2)}\n`);
    return;
  }

  const narrationManifestPath = getArgValue('--execute-approved-narration');
  const renderManifestPath = getArgValue('--execute-approved-render');
  if (narrationManifestPath || renderManifestPath) {
    const inputPath = narrationManifestPath || renderManifestPath;
    const manifestPath = resolveInsideRoot(projectRoot, inputPath, 'Approved manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const scriptVariantId = getArgValue('--script-variant-id');
    if (!scriptVariantId) {
      throw new Error('--script-variant-id is required for local narration or rendering.');
    }
    const config = await loadPipelineConfig(
      getArgValue('--config', 'services/product-video-agent/config.example.json'),
      projectRoot,
    );
    const result = await runResourceGuarded(
      config,
      narrationManifestPath ? 'orion-approved-narration' : 'orion-approved-render',
      () => narrationManifestPath
        ? executeApprovedNarration({ manifest, scriptVariantId, projectRoot })
        : executeApprovedLocalRender({ manifest, scriptVariantId, projectRoot, config }),
    );
    await writeOrPrintManifest(result);
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
  if (hasFlag('--resource-preflight')) {
    const report = await inspectProductVideoResourceAvailability(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'ready') process.exitCode = 75;
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
    ? await runResourceGuarded(config, 'orion-local-script-preview', () => (
      generateLocalScriptPreview({
        manifest: dryRun.manifest,
        scriptAdapter: new OllamaScriptAdapter(config.script),
        store,
      })
    ))
    : dryRun;

  if (hasFlag('--approval-cards')) {
    const cards = buildProductVideoApprovalCards(result.manifest);
    process.stdout.write(`${JSON.stringify(cards.map(({ approval, payload }) => ({
      approval,
      payload,
    })), null, 2)}\n`);
    return;
  }

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
    workflow_approvals: result.manifest.workflow_approvals.length,
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
