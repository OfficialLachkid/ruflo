import { createStableId } from '../ids.mjs';
import { ScriptVariantSchema } from '../schemas.mjs';

function getLocalEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('Ollama endpoint must be local for tokenless preview execution.');
  }
  return url.toString().replace(/\/$/u, '');
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(product, scriptJob) {
  const targetWords = Math.round(scriptJob.target_duration_seconds * 2.3);
  return [
    'Create one original short-form product-video script as JSON.',
    `Product: ${product.canonical_name}`,
    `Angle: ${scriptJob.angle}`,
    `Target duration: ${scriptJob.target_duration_seconds} seconds, approximately ${targetWords} words.`,
    `Hook goal: ${scriptJob.creative_brief.hook_goal}`,
    'Supported facts:',
    ...scriptJob.creative_brief.key_facts.map((fact) => `- ${fact}`),
    'Restrictions:',
    ...scriptJob.creative_brief.prohibited_claims.map((claim) => `- ${claim}`),
    'Return only JSON with string fields: hook, body, call_to_action.',
    'Do not include an affiliate disclosure; the pipeline appends the approved disclosure.',
  ].join('\n');
}

function parseGeneratedPayload(responseText) {
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error('Ollama returned a non-JSON script response.');
  }

  for (const key of ['hook', 'body', 'call_to_action']) {
    if (!String(payload?.[key] || '').trim()) {
      throw new Error(`Ollama script response is missing ${key}.`);
    }
  }

  return {
    hook: String(payload.hook).trim(),
    body: String(payload.body).trim(),
    callToAction: String(payload.call_to_action).trim(),
  };
}

export class OllamaScriptAdapter {
  constructor(config, options = {}) {
    this.name = 'ollama';
    this.model = config.model;
    this.endpoint = getLocalEndpoint(config.endpoint);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 60_000;
  }

  async checkReadiness() {
    try {
      const response = await fetchWithTimeout(
        this.fetchImpl,
        `${this.endpoint}/api/tags`,
        {},
        Math.min(this.timeoutMs, 5_000),
      );
      if (!response.ok) {
        return { status: 'blocked', detail: `Ollama tags request failed with HTTP ${response.status}.` };
      }

      const payload = await response.json();
      const modelNames = (payload.models || []).flatMap((model) => [model.name, model.model]);
      if (!modelNames.includes(this.model)) {
        return { status: 'blocked', detail: `Configured model ${this.model} is not installed.` };
      }

      return { status: 'ready', detail: `Ollama model ${this.model} is installed locally.` };
    } catch (error) {
      return { status: 'blocked', detail: `Ollama is unavailable: ${error.message}` };
    }
  }

  async generateVariant({ product, scriptJob, runAt }) {
    const response = await fetchWithTimeout(this.fetchImpl, `${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: buildPrompt(product, scriptJob),
        stream: false,
        format: 'json',
        options: {
          seed: 42,
          temperature: 0,
          num_predict: 350,
        },
      }),
    }, this.timeoutMs);

    if (!response.ok) {
      throw new Error(`Ollama generation failed with HTTP ${response.status}.`);
    }

    const ollamaPayload = await response.json();
    const generated = parseGeneratedPayload(ollamaPayload.response);
    const disclosure = scriptJob.creative_brief.disclosure;

    return ScriptVariantSchema.parse({
      script_variant_id: createStableId('script-variant', {
        scriptJobId: scriptJob.script_job_id,
        model: this.model,
      }),
      product_id: product.product_id,
      angle: scriptJob.angle,
      target_duration_seconds: scriptJob.target_duration_seconds,
      hook: generated.hook,
      body: generated.body,
      call_to_action: generated.callToAction,
      affiliate_disclosure: disclosure,
      full_text: `${generated.hook} ${generated.body} ${generated.callToAction} ${disclosure}`,
      generation_provider: this.name,
      model: this.model,
      status: 'awaiting_approval',
      approval_status: 'pending',
      created_at: runAt,
    });
  }
}
