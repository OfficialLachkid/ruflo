import { createStableId } from '../ids.mjs';
import { ScriptVariantSchema } from '../schemas.mjs';

const SCRIPT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string' },
    body: { type: 'string' },
    call_to_action: { type: 'string' },
  },
  required: ['hook', 'body', 'call_to_action'],
  additionalProperties: false,
};

const UNSUPPORTED_MARKETING_PATTERNS = [
  { pattern: /\b(our|we|us)\b/iu, issue: 'first-person brand affiliation' },
  { pattern: /\b(?:meet|introducing|introduce)\s+(?:the|this)\b/iu, issue: 'advertorial product introduction' },
  { pattern: /\b(?:buy now|get yours|shop now|check it out|learn more)\b/iu, issue: 'purchase-oriented call to action' },
  { pattern: /\b(?:comment|follow|subscribe|tell us|let us know)\b/iu, issue: 'generic engagement bait' },
  { pattern: /\bperfect\b/iu, issue: 'unsupported promotional superlative' },
  { pattern: /\bversatile tool\b/iu, issue: 'generic promotional description' },
];

const GENERIC_ENGAGEMENT_QUESTION = /\b(?:would you|what would you|what else can you|which one would you)\b/iu;

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

function buildPrompt(product, scriptJob, revisionIssues = []) {
  const targetWords = Math.round(scriptJob.target_duration_seconds * 2.3);
  return [
    'Create one original editorial short-form product-video script as JSON.',
    `Product: ${product.canonical_name}`,
    `Angle: ${scriptJob.angle}`,
    `Target duration: ${scriptJob.target_duration_seconds} seconds, approximately ${targetWords} words.`,
    `Hook goal: ${scriptJob.creative_brief.hook_goal}`,
    'Supported facts:',
    ...scriptJob.creative_brief.key_facts.map((fact) => `- ${fact}`),
    'Restrictions:',
    ...scriptJob.creative_brief.prohibited_claims.map((claim) => `- ${claim}`),
    ...scriptJob.creative_brief.blocked_phrases.map((phrase) => (
      `- Do not use or paraphrase this unsupported capability: ${phrase}`
    )),
    'Editorial direction:',
    ...scriptJob.creative_brief.editorial_direction.map((direction) => `- ${direction}`),
    '- This is faceless entertainment and useful product discovery, not an advertisement.',
    '- Start directly with the problem, visual behavior, or surprising mechanism.',
    '- Do not introduce the item with phrases such as "meet", "introducing", or a marketplace-style product title.',
    `- Do not say the brand or company name "${product.brand}".`,
    '- Treat the product as a third-party item. Never say our, we, or us.',
    '- Every capability and outcome must be directly supported by the facts above.',
    '- Open a curiosity gap, show the visual mechanism, and explain a relatable use case.',
    '- Write conversationally. Do not sound like a specification list or marketplace title.',
    '- Omit model codes, wattage, battery capacity, and secondary specifications unless the editorial direction explicitly requires them.',
    '- The call_to_action JSON field is a compatibility name. Write a factual closing payoff, not a call to action.',
    '- End with a concrete observation, result, limitation, or visual payoff. Do not end with a question.',
    '- Never ask viewers whether they would try, buy, use, or rate the item.',
    '- Do not request comments, follows, subscriptions, or other engagement.',
    '- Avoid promotional words such as perfect and generic descriptions such as versatile tool.',
    '- Prioritize the visually demonstrable product mechanism before technical details.',
    ...(revisionIssues.length > 0 ? [
      'Revision required. The previous draft failed these deterministic checks:',
      ...revisionIssues.map((issue) => `- ${issue}`),
      '- Discard the previous draft and rewrite from scratch.',
      '- The standalone words our, we, and us are forbidden anywhere in the rewrite.',
    ] : []),
    'Return only JSON with string fields: hook, body, call_to_action.',
    'Do not include or speak an affiliate disclosure; the pipeline stores disclosure metadata separately.',
  ].join('\n');
}

export function findScriptQualityIssues(generated, blockedPhrases = [], product = null) {
  const callToAction = generated.callToAction || generated.call_to_action || '';
  const text = `${generated.hook} ${generated.body} ${callToAction}`;
  const patternIssues = UNSUPPORTED_MARKETING_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ issue }) => issue);
  const closingIssues = [
    ...(callToAction.includes('?') ? ['question-style closing line'] : []),
    ...(GENERIC_ENGAGEMENT_QUESTION.test(callToAction) ? ['generic engagement question'] : []),
  ];
  const brandIssue = product?.brand
    && text.toLocaleLowerCase('en-US').includes(product.brand.toLocaleLowerCase('en-US'))
    ? [`brand/company mention: ${product.brand}`]
    : [];
  const blockedPhraseIssues = blockedPhrases
    .filter((phrase) => text.toLocaleLowerCase('en-US').includes(phrase.toLocaleLowerCase('en-US')))
    .map((phrase) => `blocked product claim: ${phrase}`);
  return [...new Set([...patternIssues, ...closingIssues, ...brandIssue, ...blockedPhraseIssues])];
}

function parseGeneratedPayload(responseText) {
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error('Ollama returned a non-JSON script response.');
  }

  for (const key of ['hook', 'body', 'call_to_action']) {
    if (typeof payload?.[key] !== 'string' || !payload[key].trim()) {
      throw new Error(`Ollama script response requires a non-empty string field: ${key}.`);
    }
  }

  return {
    hook: payload.hook.trim(),
    body: payload.body.trim(),
    callToAction: payload.call_to_action.trim(),
  };
}

export class OllamaScriptAdapter {
  constructor(config, options = {}) {
    this.name = 'ollama';
    this.model = config.model;
    this.keepAlive = config.keep_alive;
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
    let generated;
    let qualityIssues = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetchWithTimeout(this.fetchImpl, `${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: buildPrompt(product, scriptJob, qualityIssues),
          stream: false,
          format: SCRIPT_RESPONSE_SCHEMA,
          options: {
            seed: 42 + attempt,
            temperature: 0,
            num_predict: 350,
          },
          keep_alive: this.keepAlive,
        }),
      }, this.timeoutMs);

      if (!response.ok) {
        throw new Error(`Ollama generation failed with HTTP ${response.status}.`);
      }

      const ollamaPayload = await response.json();
      generated = parseGeneratedPayload(ollamaPayload.response);
      qualityIssues = findScriptQualityIssues(
        generated,
        scriptJob.creative_brief.blocked_phrases,
        product,
      );
      if (qualityIssues.length === 0) break;
    }
    if (qualityIssues.length > 0) {
      throw new Error(`Ollama script failed deterministic quality checks: ${qualityIssues.join(', ')}.`);
    }
    const disclosure = scriptJob.creative_brief.disclosure;
    const spokenText = `${generated.hook} ${generated.body} ${generated.callToAction}`;

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
      spoken_text: spokenText,
      generation_provider: this.name,
      model: this.model,
      status: 'awaiting_approval',
      approval_status: 'pending',
      created_at: runAt,
    });
  }
}
