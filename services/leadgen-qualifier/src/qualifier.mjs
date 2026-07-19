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

const PRODUCT_CONTEXT = `VBJ Services sells to Dutch small/local businesses:
1. Website chatbot (ready to sell) — embedded site chatbot, FAQ/support automation, product guidance.
2. n8n workflow automation (sellable with setup work) — self-hosted automation for repetitive processes.
3. Website builder (fast turnaround) — modern template-based websites for businesses with weak or dated sites.
4. Voice receptionist (later-stage/upsell only) — Dutch voice AI answering calls; never the lead offer.`;

const QUALIFICATION_RULES = `Qualification rules (from the operator's playbook):
- Lead generation is a qualification function: reject weak fits early rather than pass noise to outreach.
- Strong fit signals: repetitive customer question flows, booking/support/product-guidance needs, weak or dated website, limited after-hours response, visible friction that can be named concretely in outreach.
- Weak fit signals: no clear relevance to the offers, huge corporates/chains with in-house teams (e.g. international agencies, national franchises with professional web presences), speculative fit with no visible evidence, no way to personalize outreach with something real.
- The draft must be specific and commercially grounded — name something real observed on their site. Generic "we help businesses grow" messaging is explicitly against the playbook.
- Email drafts are in Dutch, short (under 150 words), no false claims, no fake urgency, sign off as "VBJ Services". Sending stays approval-gated; you only draft.`;

export function buildQualificationPrompt(lead) {
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

TASK:
1. Fetch ${lead.source_url} with WebFetch and judge the actual website: does the business look like a fit for one of the offers, and is there something concrete and real to personalize outreach with? Also sanity-check the extraction: if the page is actually a directory/platform/association rather than this business's own site, reject with decision "extraction_error".
2. Decide: "qualified", "rejected", or "extraction_error".
3. If qualified, pick ONE primary offer angle and write the Dutch outreach email.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{
  "decision": "qualified" | "rejected" | "extraction_error",
  "confidence": 0.0-1.0,
  "offer_angle": "website_chatbot" | "n8n_automation" | "website_builder" | null,
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
      buildQualificationPrompt(lead),
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
        if (!['qualified', 'rejected', 'extraction_error'].includes(parsed.decision)) {
          throw new Error(`Unexpected decision '${parsed.decision}'.`);
        }
        resolvePromise(parsed);
      } catch (error) {
        rejectPromise(new Error(`Could not parse qualification output: ${error.message}`));
      }
    });
  });
}
