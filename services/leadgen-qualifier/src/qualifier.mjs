import { spawn } from 'node:child_process';
import { projectRoot } from '../../lib/runtime-config.mjs';

// Qualification is a judgment task, deliberately NOT run on the local
// Ollama model — every judgment-shaped task this pipeline tried on the
// 8B model (directory detection, KvK sanity, niche matching) needed a
// deterministic backstop. Drafting outreach under the operator's name is
// the highest-judgment step in the pipeline, so it runs on Claude via the
// existing Claude Code subscription (claude -p), volume is a handful of
// leads per run, and every draft stays approval-gated in Discord.
const CLAUDE_TIMEOUT_MS = 240000;

const PRODUCT_CONTEXT = `VBJ Services sells to Dutch small/local businesses. Offer priority (operator's explicit ordering — websites require the least delivery work on VBJ's side, so they are the PREFERRED lead offer):
1. Website builder (PREFERRED lead offer) — modern template-based websites for businesses with weak, dated, slow, or defective sites.
2. Website chatbot (ready to sell) — embedded site chatbot, FAQ/support automation, product guidance.
3. n8n workflow automation (sellable with setup work) — self-hosted automation for repetitive processes.
4. Voice receptionist (later-stage/upsell only) — Dutch voice AI answering calls; never the lead offer.
Even when website_builder is the chosen angle, still note in secondary_flags if a chatbot or automation need is visible — those become upsells later.`;

const QUALIFICATION_RULES = `Qualification rules (from the operator's playbook):
- Lead generation is a qualification function: reject weak fits early rather than pass noise to outreach.
- Strong fit signals: weak/dated/slow website, visible site defects, repetitive customer question flows, booking/support/product-guidance needs, limited after-hours response, visible friction that can be named concretely in outreach.
- When judging website_builder fit, name CONCRETE observable defects where you can: slow load (use the measured number), dated design, stale content (e.g. an old copyright year or long-untouched news section), missing/thin mobile experience, broken layout, missing HTTPS. Only claim what you actually observed — never invent a defect. (Note: you see the site as text/markdown; purely visual defects like broken images may not be observable to you — don't guess at them.)
- Weak fit signals: no clear relevance to the offers, huge corporates/chains with in-house teams (e.g. international agencies, national franchises with professional web presences), speculative fit with no visible evidence, no way to personalize outreach with something real.
- The draft must be specific and commercially grounded — name something real observed on their site. Generic "we help businesses grow" messaging is explicitly against the playbook.
- Tone is MANDATORY: courteous and professional at all times. Never disparage or mock their current site — frame observations as opportunity, respectfully. This is non-negotiable in every draft and every future contact.
- Email drafts are in Dutch, short (under 150 words), no false claims, no fake urgency, sign off as "VBJ Services". Sending stays approval-gated; you only draft.`;

// Google PageSpeed Insights (keyless anonymous quota is plenty at a few
// leads per batch). A slow site is itself a sales signal for the
// website-builder offer — the operator's insight: "a website that needs to
// load quite long is also worth it to sell a website to."
const PSI_TIMEOUT_MS = 60000;
const FETCH_TIMING_TIMEOUT_MS = 30000;

async function measureWithLighthouse(url, apiKey) {
  const psiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  psiUrl.searchParams.set('url', url);
  psiUrl.searchParams.set('strategy', 'mobile');
  psiUrl.searchParams.set('category', 'performance');
  // Keyless PSI shares an anonymous quota pool that's often exhausted —
  // a free key (25k/day) makes this reliable: PAGESPEED_API_KEY in
  // config/discord/.env (the runtime env file loadRuntimeConfig reads).
  if (apiKey) {
    psiUrl.searchParams.set('key', apiKey);
  }

  const response = await fetch(psiUrl, { signal: AbortSignal.timeout(PSI_TIMEOUT_MS) });
  if (!response.ok) {
    return null;
  }

  const body = await response.json();
  const lcpMs = body?.lighthouseResult?.audits?.['largest-contentful-paint']?.numericValue;
  const score = body?.lighthouseResult?.categories?.performance?.score;
  if (!Number.isFinite(lcpMs)) {
    return null;
  }

  return {
    method: 'lighthouse',
    lcp_seconds: Math.round(lcpMs / 100) / 10,
    performance_score: Number.isFinite(score) ? Math.round(score * 100) : null,
  };
}

// Fallback when Lighthouse is unavailable: time the raw HTML fetch. Not
// LCP (no rendering, no assets), but "the HTML alone took 4s" is still an
// honest, nameable slowness signal — labeled as such so the prompt and the
// stored data never pass it off as a real LCP.
async function measureWithFetchTiming(url) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMING_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  const ttfbMs = Date.now() - startedAt;
  await response.text();
  const totalMs = Date.now() - startedAt;

  return {
    method: 'fetch_timing',
    ttfb_seconds: Math.round(ttfbMs / 100) / 10,
    html_seconds: Math.round(totalMs / 100) / 10,
  };
}

export async function measurePageSpeed(url, apiKey = process.env.PAGESPEED_API_KEY) {
  try {
    const lighthouse = await measureWithLighthouse(url, apiKey);
    if (lighthouse) {
      return lighthouse;
    }
  } catch {
    // fall through to timing fallback
  }

  try {
    return await measureWithFetchTiming(url);
  } catch {
    return null; // measurement is a bonus signal, never a blocker
  }
}

export function buildQualificationPrompt(lead, pageSpeed = null) {
  let pageSpeedNote = '';
  if (pageSpeed?.method === 'lighthouse') {
    pageSpeedNote = `\nMEASURED PAGE PERFORMANCE (Google Lighthouse, mobile): LCP ${pageSpeed.lcp_seconds}s, performance score ${pageSpeed.performance_score ?? 'n/a'}/100. Rule of thumb: LCP over 2.5s is poor. A slow or dated site is a concrete, nameable signal for the website_builder offer — if it applies, use the real number in the reasoning and draft.\n`;
  } else if (pageSpeed?.method === 'fetch_timing') {
    pageSpeedNote = `\nMEASURED PAGE TIMING (raw HTML fetch, not a full Lighthouse LCP): time-to-first-byte ${pageSpeed.ttfb_seconds}s, full HTML in ${pageSpeed.html_seconds}s. Only treat this as a slowness signal if clearly bad (several seconds); do not present it as an LCP measurement.\n`;
  }

  return buildQualificationPromptBody(lead, pageSpeedNote);
}

function buildQualificationPromptBody(lead, pageSpeedNote) {
  return `You are the lead-qualification step of VBJ Services' sales pipeline.

${PRODUCT_CONTEXT}

${QUALIFICATION_RULES}

THE LEAD (extracted from public web data by a local pipeline; fields may be imperfect):
${JSON.stringify({
    business_name: lead.business_name,
    business_type: lead.business_type,
    services: lead.services,
    website: lead.source_url,
    niche: lead.niche,
    contact_email: lead.contact_email,
    contact_phone: lead.contact_phone,
    kvk_number: lead.kvk_number,
    social_links: lead.social_links,
  }, null, 2)}
${pageSpeedNote}
TASK:
1. Fetch ${lead.source_url} with WebFetch and judge the actual website: does the business look like a fit for one of the offers, and is there something concrete and real to personalize outreach with? Also sanity-check the extraction: if the page is actually a directory/platform/association rather than this business's own site, reject with decision "extraction_error".
2. Decide: "qualified", "rejected", "extraction_error", or "unverifiable".
   Use "unverifiable" when you could not fetch the site at all (403/blocked/timeout) — do NOT reject a possibly-good lead just because our fetch was blocked; that's a retry case, not a verdict on the business.
3. If qualified, pick ONE primary offer angle and write the Dutch outreach email.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{
  "decision": "qualified" | "rejected" | "extraction_error" | "unverifiable",
  "confidence": 0.0-1.0,
  "offer_angle": "website_builder" | "website_chatbot" | "n8n_automation" | null,
  "secondary_flags": ["website_chatbot" | "n8n_automation" | "website_builder", ...] or [],
  "reasoning": "2-4 sentences: why this decision, referencing what you saw on the site",
  "personalization_hook": "the concrete observed detail the draft is built around, or null",
  "draft_subject": "Dutch subject line, or null",
  "draft_body": "Dutch email body, or null"
}`;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`No JSON object in Claude output: ${trimmed.slice(0, 200)}`);
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

export function qualifyLead(lead, config, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const command = config?.env?.CLAUDE_COMMAND || 'claude';
    const model = options.model || config?.env?.CLAUDE_MODEL || 'sonnet';
    const args = [
      '-p',
      buildQualificationPrompt(lead, options.pageSpeed || null),
      '--model', model,
      '--allowedTools', 'WebFetch',
    ];

    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`Qualification timed out after ${CLAUDE_TIMEOUT_MS / 1000}s.`));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(new Error(`Could not start claude: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `claude exited with code ${code}.`));
        return;
      }

      try {
        const parsed = extractJson(stdout);
        if (!['qualified', 'rejected', 'extraction_error', 'unverifiable'].includes(parsed.decision)) {
          throw new Error(`Unexpected decision '${parsed.decision}'.`);
        }
        resolvePromise(parsed);
      } catch (error) {
        rejectPromise(new Error(`Could not parse qualification output: ${error.message}`));
      }
    });
  });
}
