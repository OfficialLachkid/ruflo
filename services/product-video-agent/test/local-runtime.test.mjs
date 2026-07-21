import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import {
  findScriptQualityIssues,
  OllamaScriptAdapter,
} from '../src/adapters/ollama-script-adapter.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { generateLocalScriptPreview } from '../src/local-preview.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';
import { inspectProductVideoRuntime } from '../src/runtime-readiness.mjs';
import { applyOperatorScriptRevision } from '../src/script-revisions.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const inputFile = 'services/product-video-agent/fixtures/example-product.json';
const configFile = 'services/product-video-agent/config.example.json';

async function createDryRun() {
  const config = await loadPipelineConfig(configFile, projectRoot);
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const result = await runProductVideoDryRun({
    adapter,
    config,
    inputFile,
    projectRoot,
  });
  return { config, manifest: result.manifest };
}

test('local preview creates pending short-form scripts without unlocking downstream actions', async () => {
  const { manifest } = await createDryRun();
  const scriptAdapter = {
    async checkReadiness() {
      return { status: 'ready', detail: 'Local fixture model is ready.' };
    },
    async generateVariant({ product, scriptJob, runAt }) {
      return {
        script_variant_id: `script-variant-${scriptJob.angle}`,
        product_id: product.product_id,
        angle: scriptJob.angle,
        target_duration_seconds: scriptJob.target_duration_seconds,
        hook: `Hook for ${scriptJob.angle}`,
        body: 'Supported fixture facts only.',
        call_to_action: 'Review the product details.',
        affiliate_disclosure: scriptJob.creative_brief.disclosure,
        spoken_text: `Hook for ${scriptJob.angle} Supported fixture facts only. Review the product details.`,
        generation_provider: 'fixture-local',
        model: 'fixture-model',
        status: 'awaiting_approval',
        approval_status: 'pending',
        created_at: runAt,
      };
    },
  };
  const result = await generateLocalScriptPreview({ manifest, scriptAdapter });

  assert.equal(result.manifest.mode, 'local_preview');
  assert.equal(result.manifest.script_variants.length, 3);
  assert.ok(result.manifest.script_jobs.every((job) => job.status === 'completed'));
  assert.ok(result.manifest.script_jobs.every((job) => job.model_plan.execute === true));
  assert.ok(result.manifest.script_variants.every((variant) => variant.approval_status === 'pending'));
  assert.ok(result.manifest.voice_over_jobs.every((job) => job.blockers.includes('script_variant_approval_pending')));
  assert.ok(result.manifest.publications.every((publication) => publication.status === 'blocked'));
  assert.equal(result.manifest.external_calls.model, 'local_executed');
  assert.equal(result.manifest.cost.incurred, 0);
});

test('Ollama adapter requires loopback and emits schema-valid pending scripts', async () => {
  const { config, manifest } = await createDryRun();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/api/tags')) {
      return {
        ok: true,
        async json() {
          return { models: [{ name: config.script.model }] };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          response: JSON.stringify({
            hook: 'Still using canned air?',
            body: 'This rechargeable air duster has three modes and USB-C charging.',
            call_to_action: 'Check whether it fits your desk setup.',
          }),
        };
      },
    };
  };
  const adapter = new OllamaScriptAdapter(config.script, { fetchImpl });
  const readiness = await adapter.checkReadiness();
  const variant = await adapter.generateVariant({
    product: manifest.products[0],
    scriptJob: manifest.script_jobs[0],
    runAt: manifest.run_at,
  });
  const requestBody = JSON.parse(requests[1].options.body);

  assert.equal(readiness.status, 'ready');
  assert.equal(variant.approval_status, 'pending');
  assert.doesNotMatch(variant.spoken_text, /affiliate links/u);
  assert.match(variant.affiliate_disclosure, /affiliate links/u);
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.options.seed, 42);
  assert.equal(requestBody.options.temperature, 0);
  assert.equal(requestBody.format.properties.body.type, 'string');
  assert.equal(requestBody.format.additionalProperties, false);
  assert.match(requestBody.prompt, /Never say our, we, or us/u);
  assert.throws(
    () => new OllamaScriptAdapter({ ...config.script, endpoint: 'https://ollama.example.com' }),
    /must be local/u,
  );
});

test('operator revision is audited, narration-only, and resets script approval', async () => {
  const { manifest } = await createDryRun();
  const preview = await generateLocalScriptPreview({
    manifest,
    scriptAdapter: {
      async checkReadiness() {
        return { status: 'ready', detail: 'Fixture model ready.' };
      },
      async generateVariant({ product, scriptJob, runAt }) {
        return {
          script_variant_id: `script-variant-${scriptJob.angle}`,
          product_id: product.product_id,
          angle: scriptJob.angle,
          target_duration_seconds: scriptJob.target_duration_seconds,
          hook: 'Old hook.',
          body: 'Old body.',
          call_to_action: 'Old CTA.',
          affiliate_disclosure: scriptJob.creative_brief.disclosure,
          spoken_text: 'Old hook. Old body. Old CTA.',
          generation_provider: 'fixture-local',
          model: 'fixture-model',
          status: 'awaiting_approval',
          approval_status: 'pending',
          created_at: runAt,
        };
      },
    },
  });
  const selected = preview.manifest.script_variants[1];
  const revised = applyOperatorScriptRevision(preview.manifest, {
    scriptVariantId: selected.script_variant_id,
    content: {
      hook: 'One speaker that splits into two?',
      body: 'Place each half on opposite sides of the room.',
      call_to_action: 'Would you try this?',
    },
    actor: 'operator-test',
    reason: 'Use curiosity and viewer-relevant benefits.',
    revisedAt: '2026-07-21T12:00:00.000Z',
  });
  const variant = revised.script_variants.find((item) => (
    item.script_variant_id === selected.script_variant_id
  ));
  const approval = revised.workflow_approvals.find((item) => (
    item.stage === 'script' && item.subject_id === selected.script_variant_id
  ));

  assert.equal(variant.generation_provider, 'operator_revision');
  assert.equal(variant.spoken_text, 'One speaker that splits into two? Place each half on opposite sides of the room. Would you try this?');
  assert.doesNotMatch(variant.spoken_text, /affiliate/u);
  assert.equal(variant.affiliate_disclosure, manifest.affiliate_links[0].disclosure);
  assert.equal(revised.script_revisions.length, 1);
  assert.equal(approval.state, 'pending');
  assert.throws(
    () => applyOperatorScriptRevision(preview.manifest, {
      scriptVariantId: selected.script_variant_id,
      content: {
        hook: 'One speaker that splits into two?',
        body: 'This content contains affiliate links.',
        call_to_action: 'Would you try this?',
      },
      actor: 'operator-test',
      reason: 'Invalid disclosure-in-narration test.',
      revisedAt: '2026-07-21T12:01:00.000Z',
    }),
    /cannot be narrated/u,
  );
});

test('Ollama adapter retries drafts that imply affiliation or unsupported capabilities', async () => {
  const { config, manifest } = await createDryRun();
  let generationCalls = 0;
  const adapter = new OllamaScriptAdapter(config.script, {
    async fetchImpl() {
      generationCalls += 1;
      const generated = generationCalls === 1
        ? {
            hook: 'Try our seamless speaker.',
            body: 'Connect two devices at once.',
            call_to_action: 'Hear it for yourself.',
          }
        : {
            hook: 'This magnetic speaker splits into two units.',
            body: 'The S11-M provides 20 W total output and Bluetooth 5.3.',
            call_to_action: 'Check the documented specifications.',
          };
      return {
        ok: true,
        async json() {
          return { response: JSON.stringify(generated) };
        },
      };
    },
  });
  manifest.script_jobs[0].creative_brief.blocked_phrases = ['connect two devices'];
  const variant = await adapter.generateVariant({
    product: manifest.products[0],
    scriptJob: manifest.script_jobs[0],
    runAt: manifest.run_at,
  });

  assert.equal(generationCalls, 2);
  assert.deepEqual(findScriptQualityIssues(variant, ['connect two devices']), []);
  assert.match(variant.body, /20 W total output/u);
});

test('Ollama adapter rejects structured fields that are not strings', async () => {
  const { config, manifest } = await createDryRun();
  const adapter = new OllamaScriptAdapter(config.script, {
    async fetchImpl() {
      return {
        ok: true,
        async json() {
          return {
            response: JSON.stringify({
              hook: 'Valid hook.',
              body: { scene: 'Invalid object body.' },
              call_to_action: 'Valid call to action.',
            }),
          };
        },
      };
    },
  });

  await assert.rejects(
    adapter.generateVariant({
      product: manifest.products[0],
      scriptJob: manifest.script_jobs[0],
      runAt: manifest.run_at,
    }),
    /non-empty string field: body/u,
  );
});

test('runtime doctor distinguishes script readiness from full render readiness', async () => {
  const { config } = await createDryRun();
  const report = await inspectProductVideoRuntime({
    config,
    projectRoot,
    checkedAt: '2026-07-20T00:00:00.000Z',
    ollamaAdapter: {
      async checkReadiness() {
        return { status: 'ready', detail: 'Configured model is local.' };
      },
    },
    async executableCheck(executable) {
      return executable === 'ffmpeg'
        ? { status: 'ready', detail: 'ffmpeg is installed.' }
        : { status: 'blocked', detail: 'piper is missing.' };
    },
    async modelFileCheck() {
      return { status: 'blocked', detail: 'Piper model is missing.' };
    },
  });

  assert.equal(report.script_generation_ready, true);
  assert.equal(report.overall, 'blocked');
  assert.equal(report.components.ollama.status, 'ready');
  assert.equal(report.components.piper.status, 'blocked');
});
