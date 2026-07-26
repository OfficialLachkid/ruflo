#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import { OllamaScriptAdapter } from '../src/adapters/ollama-script-adapter.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { withLocalMediaJobLock } from '../src/media-job-lock.mjs';
import { resolveInsideRoot } from '../src/paths.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';
import { inspectProductVideoResourceAvailability } from '../src/resource-preflight.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '../../..');

function getArgValue(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function parseList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function summarizeModelResults(results) {
  const byModel = new Map();
  for (const result of results) {
    const summary = byModel.get(result.model) || {
      model: result.model,
      attempts: 0,
      passed: 0,
      failed: 0,
      elapsed_ms: 0,
    };
    summary.attempts += 1;
    summary.elapsed_ms += result.elapsed_ms;
    if (result.status === 'passed') summary.passed += 1;
    else summary.failed += 1;
    byModel.set(result.model, summary);
  }
  return [...byModel.values()].map((summary) => ({
    ...summary,
    pass_rate: summary.attempts === 0 ? 0 : summary.passed / summary.attempts,
    average_elapsed_ms: summary.attempts === 0
      ? 0
      : Math.round(summary.elapsed_ms / summary.attempts),
  }));
}

async function buildCases(config, fixturePaths) {
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const cases = [];
  for (const fixturePath of fixturePaths) {
    const { manifest } = await runProductVideoDryRun({
      adapter,
      config,
      inputFile: fixturePath,
      projectRoot,
    });
    for (const scriptJob of manifest.script_jobs) {
      cases.push({
        fixture: fixturePath,
        product: manifest.products[0],
        scriptJob,
        runAt: manifest.run_at,
      });
    }
  }
  return cases;
}

async function benchmarkModel(model, cases, config) {
  const adapter = new OllamaScriptAdapter({
    ...config.script,
    model,
    keep_alive: '0s',
  }, { timeoutMs: 180_000 });
  const readiness = await adapter.checkReadiness();
  if (readiness.status !== 'ready') {
    throw new Error(readiness.detail);
  }

  const results = [];
  for (const benchmarkCase of cases) {
    const startedAt = Date.now();
    try {
      const variant = await adapter.generateVariant({
        product: benchmarkCase.product,
        scriptJob: benchmarkCase.scriptJob,
        runAt: benchmarkCase.runAt,
      });
      results.push({
        model,
        fixture: benchmarkCase.fixture,
        product_id: benchmarkCase.product.product_id,
        product_name: benchmarkCase.product.canonical_name,
        angle: benchmarkCase.scriptJob.angle,
        status: 'passed',
        elapsed_ms: Date.now() - startedAt,
        script: {
          hook: variant.hook,
          body: variant.body,
          closing_line: variant.call_to_action,
          spoken_text: variant.spoken_text,
        },
        error: null,
      });
    } catch (error) {
      results.push({
        model,
        fixture: benchmarkCase.fixture,
        product_id: benchmarkCase.product.product_id,
        product_name: benchmarkCase.product.canonical_name,
        angle: benchmarkCase.scriptJob.angle,
        status: 'failed',
        elapsed_ms: Date.now() - startedAt,
        script: null,
        error: error.message,
      });
    }
  }
  return results;
}

async function main() {
  const models = parseList(getArgValue(
    '--models',
    'llama3.1:8b,qwen3.5:9b-q4_K_M',
  ));
  const fixturePaths = parseList(getArgValue(
    '--fixtures',
    [
      'services/product-video-agent/fixtures/example-product.json',
      'services/product-video-agent/fixtures/cyboris-s11-amazon-nl.json',
    ].join(','),
  ));
  const outputPath = resolveInsideRoot(
    projectRoot,
    getArgValue(
      '--output',
      'data/runtime/product-video-agent/model-benchmarks/latest.json',
    ),
    'Model benchmark output path',
  );
  const config = await loadPipelineConfig(
    getArgValue('--config', 'services/product-video-agent/config.example.json'),
    projectRoot,
  );
  const resourceState = await inspectProductVideoResourceAvailability(config);
  if (resourceState.status !== 'ready') {
    throw new Error(`Model benchmark preflight failed: ${resourceState.reasons.join(', ')}`);
  }

  const cases = await buildCases(config, fixturePaths);
  const results = await withLocalMediaJobLock({ projectRoot }, async () => {
    const collected = [];
    for (const model of models) {
      collected.push(...await benchmarkModel(model, cases, config));
    }
    return collected;
  });
  const report = {
    benchmark_version: '1.0.0',
    created_at: new Date().toISOString(),
    deterministic_seeds: '42-49',
    temperature: 0.2,
    context_tokens: 4096,
    thinking: false,
    fixtures: fixturePaths,
    models,
    summaries: summarizeModelResults(results),
    results,
    decision_rule: [
      'Do not select a model only by pass rate; review every passed script for factuality and editorial tone.',
      'Keep the deterministic fail-closed gate enabled for every model.',
      'Delete an older model only after confirming no other Mac workflow references it.',
    ],
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    output_path: outputPath,
    summaries: report.summaries,
  }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
