import { createHash, randomBytes } from 'node:crypto';

const DOMAIN_KEYWORDS = {
  infra: ['deploy', 'production', 'server', 'host', 'tailscale', 'docker', 'colima', 'restart', 'service', 'mac mini'],
  developer: ['repo', 'code', 'bug', 'fix', 'pr', 'pull request', 'branch', 'refactor', 'test', 'build'],
  sales: ['lead', 'outreach', 'prospect', 'meeting', 'campaign', 'customer', 'client'],
  research: ['research', 'analyze', 'investigate', 'compare', 'evaluate'],
  social: ['post', 'social', 'linkedin', 'twitter', 'x.com', 'instagram'],
};

const TARGET_AGENT_BY_DOMAIN = {
  infra: 'developer-agent',
  developer: 'developer-agent',
  sales: 'sales-agent',
  research: 'research-agent',
  social: 'social-agent',
  general: 'orchestrator',
};

const APPROVAL_KEYWORDS = {
  external_outreach: ['outreach', 'send email', 'email lead', 'contact customer', 'dm', 'message client', 'reach out'],
  production_change: ['deploy', 'production', 'live site', 'restart service', 'change host', 'infra change'],
  destructive_operation: ['delete', 'remove', 'wipe', 'reset', 'drop database', 'destroy'],
  spending_action: ['buy', 'purchase', 'billing', 'pay', 'subscribe', 'upgrade plan'],
  security_sensitive: ['secret', 'token', 'password', 'ssh key', 'credential', 'permission', 'grant access'],
  code_merge: ['merge pr', 'merge pull request', 'merge into main', 'merge branch', 'ship branch'],
};

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function sanitizeCommandLine(value) {
  return normalizeWhitespace(
    String(value || '')
      .replace(/^[-*•]\s+/u, '')
      .replace(/^\d+[.)]\s+/u, '')
  );
}

export function splitCommandMessage(content) {
  const rawLines = String(content || '')
    .split(/\r?\n/u)
    .map((line) => sanitizeCommandLine(line))
    .filter(Boolean);

  if (rawLines.length <= 1) {
    const normalized = sanitizeCommandLine(content);
    return normalized ? [normalized] : [];
  }

  return rawLines;
}

function summarizeText(text) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137)}...`;
}

function inferDomain(text) {
  const lower = text.toLowerCase();

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return domain;
    }
  }

  return 'general';
}

function inferPriority(text) {
  const lower = text.toLowerCase();
  if (/(urgent|asap|immediately|today|critical|blocker)/u.test(lower)) {
    return 'high';
  }
  if (/(whenever|sometime|later|low priority|not urgent)/u.test(lower)) {
    return 'low';
  }

  return 'normal';
}

function buildTaskId(text, submittedAt) {
  const timestamp = new Date(submittedAt || Date.now()).toISOString().replace(/[-:TZ.]/gu, '').slice(0, 12);
  const fingerprint = createHash('sha1').update(text).digest('hex').slice(0, 6).toUpperCase();
  const entropy = randomBytes(2).toString('hex').toUpperCase();
  return `TASK-${timestamp}-${fingerprint}${entropy}`;
}

function detectApproval(text, approvalRules) {
  const lower = text.toLowerCase();
  const matches = [];

  for (const rule of approvalRules.approvalRequiredFor || []) {
    const keywords = APPROVAL_KEYWORDS[rule.rule] || [];
    if (keywords.some((keyword) => lower.includes(keyword))) {
      matches.push(rule);
    }
  }

  return {
    approvalRequired: matches.length > 0,
    matchedRules: matches,
  };
}

function buildWriteBackCandidates(task, promotionRules) {
  const rules = promotionRules.rules || {};
  const defaults = promotionRules.default_candidate_policy || {};
  const candidates = [];

  candidates.push({
    namespace: 'results',
    type: 'normalized_task_summary',
    status: defaults.status || 'pending_review',
    requiresResultInspection: defaults.requires_result_inspection !== false,
    summary: `Normalized ${task.source_type} task ${task.task_id}: ${task.summary}`,
    promoteWhen: rules.results?.promote_when || [],
    doNotPromote: rules.results?.do_not_promote || [],
  });

  if (task.approval_required) {
    candidates.push({
      namespace: 'approvals',
      type: 'approval_request',
      status: 'awaiting_outcome',
      requiresResultInspection: false,
      summary: `Approval required for ${task.task_id}: ${task.approval_reason}`,
      promoteWhen: rules.approvals?.promote_when || [],
      doNotPromote: rules.approvals?.do_not_promote || [],
    });
  }

  if (task.domain === 'infra') {
    candidates.push({
      namespace: 'infra',
      type: 'infra_change_candidate',
      status: defaults.status || 'pending_review',
      requiresResultInspection: true,
      summary: `Infra-affecting task detected for ${task.task_id}: ${task.summary}`,
      promoteWhen: rules.infra?.promote_when || [],
      doNotPromote: rules.infra?.do_not_promote || [],
    });
  }

  return candidates;
}

export function normalizeTaskMessage(message, config) {
  const content = normalizeWhitespace(message.content);
  if (!content) {
    throw new Error('Cannot normalize an empty command message.');
  }

  const submittedAt = message.submittedAt || new Date().toISOString();
  const taskId = buildTaskId(content, submittedAt);
  const domain = inferDomain(content);
  const targetAgent = TARGET_AGENT_BY_DOMAIN[domain] || 'orchestrator';
  const approvalCheck = detectApproval(content, config.approvalRules);
  const matchedRuleDescriptions = approvalCheck.matchedRules.map((rule) => `${rule.rule}: ${rule.description}`);

  const task = {
    task_id: taskId,
    source_type: message.sourceType || 'discord_text_command',
    source_channel: message.channelKey || message.channelName || 'commands',
    submitted_by: message.author?.displayName || message.author?.username || message.author?.id || 'unknown',
    submitted_at: submittedAt,
    summary: summarizeText(content),
    full_text: content,
    target_agent: targetAgent,
    domain,
    priority: inferPriority(content),
    approval_required: approvalCheck.approvalRequired,
    approval_reason: matchedRuleDescriptions.join(' | '),
    status: approvalCheck.approvalRequired ? 'awaiting_approval' : 'queued',
    message_id: message.messageId || null,
  };

  return {
    task,
    writeBackCandidates: buildWriteBackCandidates(task, config.memoryPromotionRules),
  };
}

export function normalizeTaskMessages(message, config) {
  const segments = splitCommandMessage(message.content);
  if (segments.length === 0) {
    throw new Error('Cannot normalize an empty command message.');
  }

  return segments.map((segment, index) => normalizeTaskMessage({
    ...message,
    content: segment,
    submittedAt: message.submittedAt || new Date(Date.now() + index).toISOString(),
  }, config));
}

export function parseApprovalResponse(message) {
  const content = normalizeWhitespace(message.content);
  const approveMatch = /^approve\s+(TASK-[A-Z0-9-]+)$/iu.exec(content);
  if (approveMatch) {
    return {
      valid: true,
      decision: 'approve',
      taskId: approveMatch[1].toUpperCase(),
      reason: '',
    };
  }

  const rejectMatch = /^reject\s+(TASK-[A-Z0-9-]+)(?:\s+because\s+(.+))?$/iu.exec(content);
  if (rejectMatch) {
    return {
      valid: true,
      decision: 'reject',
      taskId: rejectMatch[1].toUpperCase(),
      reason: normalizeWhitespace(rejectMatch[2] || ''),
    };
  }

  return {
    valid: false,
    decision: 'invalid',
    taskId: '',
    reason: 'Approval message must match `approve TASK-123` or `reject TASK-123 because <reason>`.',
  };
}
