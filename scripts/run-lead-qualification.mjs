#!/usr/bin/env node
// Qualify-and-draft: reads status='new' leads, has Claude judge fit against
// VBJ's offers (fetching the lead's real site), and for qualified leads with
// a public email creates a Gmail draft routed through the same Discord
// approval flow as /email-draft — Approve/Reject buttons in #outreach-agent
// (draft + approval merged into one message), nothing sends without
// explicit approval.
//
// Usage:
//   node scripts/run-lead-qualification.mjs --limit 3
//   node scripts/run-lead-qualification.mjs --limit 5 --niche plumbing
//   node scripts/run-lead-qualification.mjs --dry-run   (qualify only, no draft/discord/db writes)
//   node scripts/run-lead-qualification.mjs --no-screenshot   (skip the playwright-cli visual step, text-only judgment)

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { fetchLeads, updateLead } from './lib/leadgen-supabase.mjs';
import { measurePageSpeed, qualifyLead } from '../services/leadgen-qualifier/src/qualifier.mjs';
import { executeTask } from '../services/task-router/src/executor.mjs';
import { upsertPersistedPendingTask } from '../services/discord-bot/src/pending-task-store.mjs';
import {
  buildNoticeDiscordPayload,
  buildOutboundEventDiscordPayload,
  upgradeLegacyDiscordPayload,
} from '../services/discord-bot/src/message-formatting.mjs';
import { buildApprovalButtons } from '../services/discord-bot/src/approval-buttons.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function getArgValue(flag, fallbackValue = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallbackValue : (process.argv[index + 1] || fallbackValue);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

// Headless-browser render for sites that 403 plain fetches — one page, one
// attempt, hard timeout, no crawling. Used only in --retry-unreachable mode.
function renderPageText(url) {
  const venvPython = resolve(projectRoot, '.venv-leadgen', 'bin', 'python3');
  const script = resolve(projectRoot, 'services', 'leadgen-scraper', 'render_page.py');
  const result = spawnSync(existsSync(venvPython) ? venvPython : 'python3', [script, url], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 90000,
  });

  const text = String(result.stdout || '').trim();
  return result.status === 0 && text ? text : null;
}

function buildTaskId(text) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, '').slice(0, 12);
  const fingerprint = createHash('sha1').update(text).digest('hex').slice(0, 6).toUpperCase();
  return `TASK-${timestamp}-${fingerprint}${randomBytes(2).toString('hex').toUpperCase()}`;
}

async function postToChannel(config, channelId, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Discord post failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

// Mirrors the live bot's fanOutOutboundEvents closely enough for this
// standalone script: resolve channel by key, format the event, attach
// Approve/Reject buttons on approval requests.
async function dispatchOutboundEvents(config, outboundEvents = []) {
  for (const outboundEvent of outboundEvents) {
    const channelId = config.channelIds[outboundEvent.channelKey];
    if (!channelId) {
      continue;
    }

    if (outboundEvent.type === 'approval_request') {
      // approverMentions must be a joined string (it becomes the message's
      // `content` verbatim) — this previously stayed an array and only
      // "worked" by accident, since a single-element array stringifies to
      // its bare element; it also never included operatorUserIds at all, so
      // the individual operator (lachkid) was never actually pinged here,
      // only the operator role — unlike #approvals, which pings both.
      const roleMentions = config.operatorRoleId ? [`<@&${config.operatorRoleId}>`] : [];
      const userMentions = (config.operatorUserIds || []).map((userId) => `<@${userId}>`);
      outboundEvent.metadata = {
        ...outboundEvent.metadata,
        approverMentions: [...roleMentions, ...userMentions].join(' '),
        approverUserIds: config.operatorUserIds || [],
        approverRoleIds: config.operatorRoleId ? [config.operatorRoleId] : [],
      };
    }

    const body = upgradeLegacyDiscordPayload(buildOutboundEventDiscordPayload(outboundEvent));
    if (outboundEvent.type === 'approval_request' && outboundEvent.metadata?.taskId) {
      body.components = buildApprovalButtons(outboundEvent.metadata.taskId, {
        isEmailAction: Boolean(outboundEvent.metadata?.emailTo),
      });
    }

    await postToChannel(config, channelId, body);
  }
}

// executeTask() for gmail_create_draft returns a redundant pair for lead
// outreach: an 'agentResults' notice ("Gmail draft created for X") and a
// separate 'approvals' request with Approve/Reject buttons — the approval
// embed already carries the full draft (To/Subject/Body), so the notice is
// dropped here and the approval alone is redirected into #outreach-agent.
// That gives one message with the draft AND the buttons instead of two
// messages split across two channels (operator request, 2026-07-20).
// Falls back to the original 'approvals' channel key if DISCORD_OUTREACH_
// AGENT_CHANNEL_ID isn't configured yet, so nothing silently stops posting.
async function dispatchLeadOutreachEvents(config, outboundEvents = []) {
  const hasOutreachChannel = Boolean(config.channelIds.outreachAgent);
  const merged = outboundEvents
    .filter((outboundEvent) => outboundEvent.channelKey !== 'agentResults')
    .map((outboundEvent) => (
      outboundEvent.type === 'approval_request' && hasOutreachChannel
        ? { ...outboundEvent, channelKey: 'outreachAgent' }
        : outboundEvent
    ));

  await dispatchOutboundEvents(config, merged);
}

async function createDraftWithApproval(config, lead, qualification) {
  const subject = String(qualification.draft_subject || '').trim();
  const bodyText = String(qualification.draft_body || '').trim();
  const task = {
    task_id: buildTaskId(`${lead.id}:${subject}`),
    source_type: 'lead_qualification',
    source_channel: 'leadGeneration',
    submitted_by: 'lead-qualifier',
    submitted_at: new Date().toISOString(),
    summary: lead.source_url
      ? `Draft outreach to [${lead.business_name}](${lead.source_url}) (${qualification.offer_angle})`
      : `Draft outreach to ${lead.business_name} (${qualification.offer_angle})`,
    full_text: `draft email to ${lead.contact_email} subject: ${subject} body: ${bodyText}`,
    target_agent: 'outreach-agent',
    domain: 'sales',
    priority: 'normal',
    approval_required: false,
    status: 'queued',
    runtime_action: 'gmail_create_draft',
    email_request: { to: lead.contact_email, subject, bodyText },
    lead_id: lead.id,
    lead_domain: lead.domain,
    lead_business_name: lead.business_name,
    lead_source_url: lead.source_url || '',
  };

  const result = await executeTask(task, config);
  if (result.outcome !== 'completed') {
    throw new Error(result.error?.message || 'Gmail draft creation failed.');
  }

  const pendingApprovalTask = result.executionResult?.report?.pendingApprovalTask;
  if (pendingApprovalTask) {
    upsertPersistedPendingTask(config, pendingApprovalTask);
  }

  await dispatchLeadOutreachEvents(config, result.outboundEvents);
  return task.task_id;
}

async function main() {
  const limit = Number(getArgValue('--limit', '3'));
  const niche = getArgValue('--niche', '');
  const dryRun = hasFlag('--dry-run');
  const retryUnreachable = hasFlag('--retry-unreachable');
  const noScreenshot = hasFlag('--no-screenshot');
  const config = loadRuntimeConfig();

  // Oldest first so the backlog drains in discovery order. (Server-side
  // ascending order — reversing a newest-N window silently skipped the
  // true oldest once the table outgrew the window.)
  const allNew = await fetchLeads({
    status: retryUnreachable ? 'site_unreachable' : 'new',
    niche: niche || undefined,
    limit: 100,
    order: 'oldest',
  });
  const batch = allNew.slice(0, Math.max(1, Math.min(limit, 10)));

  if (batch.length === 0) {
    process.stdout.write('No leads with status=new to qualify.\n');
    return;
  }

  const outcomes = [];
  for (const lead of batch) {
    // Slow site = concrete website-builder signal; measured before the
    // judgment call so the real number can land in the draft.
    const pageSpeed = await measurePageSpeed(
      lead.source_url,
      config.env.PAGESPEED_API_KEY || process.env.PAGESPEED_API_KEY,
    );

    // In retry mode the site blocked plain fetches last time — render it
    // once with a real browser and hand the text to the qualifier.
    const renderedSiteText = retryUnreachable ? renderPageText(lead.source_url) : null;

    let qualification;
    try {
      qualification = await qualifyLead(lead, config, { pageSpeed, renderedSiteText, enableScreenshot: !noScreenshot });
    } catch (error) {
      // sourceUrl must be included here too — omitting it silently drops the
      // markdown link for every errored lead in the summary message (this is
      // exactly what happened during the ENOENT-broken run: every one of the
      // 10 leads hit this path, so the whole summary showed plain text names).
      outcomes.push({ lead: lead.business_name, sourceUrl: lead.source_url, error: error.message });
      continue;
    }
    qualification.page_speed = pageSpeed;

    let status;
    let approvalTaskId = null;
    if (qualification.decision === 'qualified') {
      status = lead.contact_email ? 'qualified' : 'qualified_no_email';
    } else if (qualification.decision === 'extraction_error') {
      status = 'extraction_error';
    } else if (qualification.decision === 'unverifiable') {
      // Site blocked our fetch — parked for retry, not a verdict on the
      // business. Left as 'new' would retry immediately (and hammer a site
      // that's rate-limiting us); a distinct status lets a later pass
      // re-queue these deliberately.
      status = 'site_unreachable';
    } else {
      status = 'rejected_fit';
    }

    if (!dryRun && status === 'qualified') {
      try {
        approvalTaskId = await createDraftWithApproval(config, lead, qualification);
      } catch (error) {
        outcomes.push({ lead: lead.business_name, decision: qualification.decision, draftError: error.message });
        status = 'qualified_draft_failed';
      }
    }

    if (!dryRun) {
      await updateLead(lead.id, {
        status,
        qualification: { ...qualification, approval_task_id: approvalTaskId, qualified_by: 'claude' },
        qualified_at: new Date().toISOString(),
      });
    }

    recordOpsMetric(config, 'lead_qualification', {
      leadId: lead.id,
      domain: lead.domain,
      decision: qualification.decision,
      status,
      offerAngle: qualification.offer_angle || '',
      approvalTaskId: approvalTaskId || '',
      dryRun,
    });

    outcomes.push({
      lead: lead.business_name,
      domain: lead.domain,
      sourceUrl: lead.source_url,
      leadAgeDays: Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000),
      decision: qualification.decision,
      status,
      offer_angle: qualification.offer_angle,
      confidence: qualification.confidence,
      lcp_seconds: pageSpeed?.lcp_seconds ?? null,
      screenshot_reviewed: qualification.screenshot_reviewed ?? null,
      reasoning: qualification.reasoning || '',
      approvalTaskId,
    });
  }

  // Summary goes to #lead-qualification-agent (operator request — #lead-
  // generation is for discovery activity; qualification/outreach is the
  // sales side). Per-lead drafts + approvals go to #outreach-agent instead,
  // via dispatchLeadOutreachEvents above.
  const channelId = config.channelIds.leadQualificationAgent
    || config.channelIds.leadGeneration
    || config.channelIds.agentResults;
  if (!dryRun && channelId && config.env.DISCORD_BOT_TOKEN) {
    // A per-lead list alone forces the operator to read every line to find
    // out why "10 qualified" produced only 3 drafts — a rollup up front
    // answers that at a glance (operator feedback, 2026-07-21).
    const draftCount = outcomes.filter((o) => o.approvalTaskId).length;
    const noEmailCount = outcomes.filter((o) => o.status === 'qualified_no_email').length;
    const draftFailedCount = outcomes.filter((o) => o.status === 'qualified_draft_failed').length;
    const rejectedCount = outcomes.filter((o) => o.status === 'rejected_fit').length;
    const unreachableCount = outcomes.filter((o) => o.status === 'site_unreachable').length;
    const extractionErrorCount = outcomes.filter((o) => o.status === 'extraction_error').length;
    const failedCount = outcomes.filter((o) => o.error).length;

    const rollupParts = [
      draftCount > 0 ? `**${draftCount}** draft(s) awaiting approval in #outreach-agent` : '',
      noEmailCount > 0 ? `**${noEmailCount}** qualified but no email found (no draft possible)` : '',
      draftFailedCount > 0 ? `**${draftFailedCount}** qualified but draft creation failed` : '',
      rejectedCount > 0 ? `**${rejectedCount}** rejected — weak fit` : '',
      unreachableCount > 0 ? `**${unreachableCount}** site unreachable (parked for retry)` : '',
      extractionErrorCount > 0 ? `**${extractionErrorCount}** extraction error` : '',
      failedCount > 0 ? `**${failedCount}** qualification call failed (timeout/error — stays \`new\`, retried in a future run)` : '',
    ].filter(Boolean);

    const lines = outcomes.map((o) => {
      const name = o.sourceUrl ? `[${o.lead}](${o.sourceUrl})` : o.lead;
      if (o.error) return `- ${name}: qualification failed (${o.error.slice(0, 80)})`;
      if (o.draftError) return `- ${name}: qualified but draft failed (${o.draftError.slice(0, 80)})`;
      const angle = o.offer_angle ? ` — ${o.offer_angle}` : '';
      const lcp = Number.isFinite(o.lcp_seconds) ? `, LCP ${o.lcp_seconds}s` : '';
      const age = Number.isFinite(o.leadAgeDays) ? ` (found ${o.leadAgeDays}d ago${lcp})` : '';
      const approval = o.approvalTaskId ? ` (draft awaiting approval: ${o.approvalTaskId})` : '';
      // rejected_fit and extraction_error otherwise give no clue why —
      // operator feedback (2026-07-22): "rejected_fit doesn't explain why."
      const why = (o.status === 'rejected_fit' || o.status === 'extraction_error') && o.reasoning
        ? ` — ${o.reasoning.slice(0, 200)}`
        : '';
      return `- ${name}: **${o.status}**${angle}${age}${approval}${why}`;
    });
    await postToChannel(config, channelId, buildNoticeDiscordPayload({
      title: 'Lead Qualification',
      description: `Processed ${outcomes.length} lead(s) — ${rollupParts.join(', ')}.\n\n${lines.join('\n')}`,
      color: 0x5865F2,
      footerText: 'Ruflo lead qualification',
    }));
  }

  process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Lead qualification failed: ${error.message}\n`);
  process.exitCode = 1;
});
