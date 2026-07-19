#!/usr/bin/env node
// Qualify-and-draft: reads status='new' leads, has Claude judge fit against
// VBJ's offers (fetching the lead's real site), and for qualified leads with
// a public email creates a Gmail draft routed through the SAME Discord
// approval flow as /email-draft — Approve/Reject buttons in #approvals,
// nothing sends without explicit approval.
//
// Usage:
//   node scripts/run-lead-qualification.mjs --limit 3
//   node scripts/run-lead-qualification.mjs --limit 5 --niche plumbing
//   node scripts/run-lead-qualification.mjs --dry-run   (qualify only, no draft/discord/db writes)

import { createHash, randomBytes } from 'node:crypto';
import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
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
      outboundEvent.metadata = {
        ...outboundEvent.metadata,
        approverMentions: config.operatorRoleId ? [`<@&${config.operatorRoleId}>`] : [],
        approverUserIds: config.operatorUserIds || [],
        approverRoleIds: config.operatorRoleId ? [config.operatorRoleId] : [],
      };
    }

    const body = upgradeLegacyDiscordPayload(buildOutboundEventDiscordPayload(outboundEvent));
    if (outboundEvent.type === 'approval_request' && outboundEvent.metadata?.taskId) {
      body.components = buildApprovalButtons(outboundEvent.metadata.taskId);
    }

    await postToChannel(config, channelId, body);
  }
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
    summary: `Draft outreach to ${lead.business_name} (${qualification.offer_angle})`,
    full_text: `draft email to ${lead.contact_email} subject: ${subject} body: ${bodyText}`,
    target_agent: 'orchestrator',
    domain: 'sales',
    priority: 'normal',
    approval_required: false,
    status: 'queued',
    runtime_action: 'gmail_create_draft',
    email_request: { to: lead.contact_email, subject, bodyText },
    lead_id: lead.id,
    lead_domain: lead.domain,
  };

  const result = await executeTask(task, config);
  if (result.outcome !== 'completed') {
    throw new Error(result.error?.message || 'Gmail draft creation failed.');
  }

  const pendingApprovalTask = result.executionResult?.report?.pendingApprovalTask;
  if (pendingApprovalTask) {
    upsertPersistedPendingTask(config, pendingApprovalTask);
  }

  await dispatchOutboundEvents(config, result.outboundEvents);
  return task.task_id;
}

async function main() {
  const limit = Number(getArgValue('--limit', '3'));
  const niche = getArgValue('--niche', '');
  const dryRun = hasFlag('--dry-run');
  const config = loadRuntimeConfig();

  // Oldest first so the backlog drains in discovery order. (Server-side
  // ascending order — reversing a newest-N window silently skipped the
  // true oldest once the table outgrew the window.)
  const allNew = await fetchLeads({ status: 'new', niche: niche || undefined, limit: 100, order: 'oldest' });
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

    let qualification;
    try {
      qualification = await qualifyLead(lead, config, { pageSpeed });
    } catch (error) {
      outcomes.push({ lead: lead.business_name, error: error.message });
      continue;
    }
    qualification.page_speed = pageSpeed;

    let status;
    let approvalTaskId = null;
    if (qualification.decision === 'qualified') {
      status = lead.contact_email ? 'qualified' : 'qualified_no_email';
    } else if (qualification.decision === 'extraction_error') {
      status = 'extraction_error';
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
      approvalTaskId,
    });
  }

  // Summary goes to #sales-agent (operator request — #lead-generation is
  // for discovery activity; qualification/outreach is the sales side).
  const channelId = config.channelIds.salesAgent
    || config.channelIds.leadGeneration
    || config.channelIds.agentResults;
  if (!dryRun && channelId && config.env.DISCORD_BOT_TOKEN) {
    const lines = outcomes.map((o) => {
      const name = o.sourceUrl ? `[${o.lead}](${o.sourceUrl})` : o.lead;
      if (o.error) return `- ${name}: qualification failed (${o.error.slice(0, 80)})`;
      if (o.draftError) return `- ${name}: qualified but draft failed (${o.draftError.slice(0, 80)})`;
      const angle = o.offer_angle ? ` — ${o.offer_angle}` : '';
      const lcp = Number.isFinite(o.lcp_seconds) ? `, LCP ${o.lcp_seconds}s` : '';
      const age = Number.isFinite(o.leadAgeDays) ? ` (found ${o.leadAgeDays}d ago${lcp})` : '';
      const approval = o.approvalTaskId ? ` (draft awaiting approval: ${o.approvalTaskId})` : '';
      return `- ${name}: **${o.status}**${angle}${age}${approval}`;
    });
    await postToChannel(config, channelId, buildNoticeDiscordPayload({
      title: 'Lead Qualification',
      description: `Qualified ${outcomes.length} lead(s):\n${lines.join('\n')}`,
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
