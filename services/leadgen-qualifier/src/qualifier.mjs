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
- When judging website_builder fit, name CONCRETE observable defects where you can: dated design, stale content (e.g. an old copyright year or long-untouched news section), missing/thin mobile experience, broken layout, missing HTTPS, thin/generic copy. Only claim what you actually observed — never invent a defect. (Note: you see the site as text/markdown, not a rendering — you cannot judge visual polish, animations, layout modernity, or parallax/scroll effects from this; if the fit reasoning would require claiming the site "looks dated" or "looks modern" visually, don't make that specific claim — describe what you can actually observe in the text/structure instead.)
- Page speed (LCP) is a SECONDARY signal, not the primary reason to qualify or reject a website_builder fit — a slow load matters, but a 5-10s LCP alone does not make a strong case on its own, and a fast LCP does not rule out a real fit if the site is otherwise dated or thin. Weigh it alongside the other observable defects above; never lead the reasoning or draft with the LCP number as if it were the main argument.
- Weak fit signals: no clear relevance to the offers, huge corporates/chains with in-house teams (e.g. international agencies, national franchises with professional web presences), speculative fit with no visible evidence, no way to personalize outreach with something real.
- The draft must be specific and commercially grounded — name something real observed on their site. Generic "we help businesses grow" messaging is explicitly against the playbook.
- Tone is MANDATORY: courteous and professional at all times. Never disparage or mock their current site — frame observations as opportunity, respectfully. This is non-negotiable in every draft and every future contact.
- Email drafts are in Dutch, SHORT (under 90 words, 4-6 short sentences) — the recipient should be able to read the whole thing in under 20 seconds. Lead with the one concrete observation, one clear offer, one clear next step. No false claims, no fake urgency, sign off as "VBJ Services". Sending stays approval-gated; you only draft.`;

// Google PageSpeed Insights (keyless anonymous quota is plenty at a few
// leads per batch). A slow site is itself a sales signal for the
// website-builder offer — the operator's insight: "a website that needs to
// load quite long is also worth it to sell a website to."
const PSI_TIMEOUT_MS = 60000;
const FETCH_TIMING_TIMEOUT_MS = 30000;

async function measureWithLighthouse(url, apiKey, strategy) {
  const psiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  psiUrl.searchParams.set('url', url);
  psiUrl.searchParams.set('strategy', strategy);
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

// Lighthouse's mobile strategy runs under Google's standardized throttled
// mobile profile (simulated mid-tier device + slow 4G) — deliberately
// pessimistic to model a real worst-case mobile visitor, not "how fast does
// this feel on a real phone with WiFi." Desktop runs unthrottled. A large
// gap between the two (operator found one 10.1s mobile vs. 2.2s desktop) is
// expected methodology, not a sign either number is wrong — both get passed
// to the qualifier so it isn't drawing a conclusion from mobile alone.
export async function measurePageSpeed(url, apiKey = process.env.PAGESPEED_API_KEY) {
  let mobile = null;
  let desktop = null;

  try {
    mobile = await measureWithLighthouse(url, apiKey, 'mobile');
  } catch {
    // fall through to timing fallback below
  }

  if (mobile) {
    try {
      desktop = await measureWithLighthouse(url, apiKey, 'desktop');
    } catch {
      // desktop is a bonus data point — mobile alone is still usable
    }

    return {
      method: 'lighthouse',
      lcp_seconds: mobile.lcp_seconds,
      performance_score: mobile.performance_score,
      desktop_lcp_seconds: desktop?.lcp_seconds ?? null,
      desktop_performance_score: desktop?.performance_score ?? null,
    };
  }

  try {
    return await measureWithFetchTiming(url);
  } catch {
    return null; // measurement is a bonus signal, never a blocker
  }
}

export function buildQualificationPrompt(lead, pageSpeed = null, renderedSiteText = null) {
  let pageSpeedNote = '';
  if (pageSpeed?.method === 'lighthouse') {
    const desktopPart = Number.isFinite(pageSpeed.desktop_lcp_seconds)
      ? ` Desktop (unthrottled): LCP ${pageSpeed.desktop_lcp_seconds}s, score ${pageSpeed.desktop_performance_score ?? 'n/a'}/100.`
      : '';
    pageSpeedNote = `\nMEASURED PAGE PERFORMANCE (Google Lighthouse). Mobile (throttled to a simulated slow connection/device — deliberately pessimistic, not real-world mobile speed): LCP ${pageSpeed.lcp_seconds}s, performance score ${pageSpeed.performance_score ?? 'n/a'}/100.${desktopPart} A large mobile-vs-desktop gap is expected methodology, not a data error — do not treat the mobile number alone as decisive. Speed is ONE input among several, not the primary driver of website_builder fit — weigh it alongside the other observable defects below, and note explicitly if mobile and desktop tell different stories rather than picking whichever number is more dramatic.\n`;
  } else if (pageSpeed?.method === 'fetch_timing') {
    pageSpeedNote = `\nMEASURED PAGE TIMING (raw HTML fetch, not a full Lighthouse LCP): time-to-first-byte ${pageSpeed.ttfb_seconds}s, full HTML in ${pageSpeed.html_seconds}s. Only treat this as a slowness signal if clearly bad (several seconds); do not present it as an LCP measurement.\n`;
  }

  if (renderedSiteText) {
    pageSpeedNote += `\nRENDERED SITE TEXT (the site blocks plain fetches, so our headless browser rendered it — treat this as the site content; WebFetch will likely 403):\n---\n${renderedSiteText}\n---\n`;
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
      buildQualificationPrompt(lead, options.pageSpeed || null, options.renderedSiteText || null),
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
