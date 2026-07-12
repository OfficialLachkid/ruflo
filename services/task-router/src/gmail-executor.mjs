import { createGmailDraft, sendGmailDraft } from '../../gmail/src/send.mjs';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function summarizeSendApproval(task, draft = {}) {
  const to = normalizeWhitespace(draft.to || task?.email_request?.to);
  const subject = normalizeWhitespace(draft.subject || task?.email_request?.subject);
  if (!to && !subject) {
    return 'Approve to send the drafted email.';
  }

  return `Send drafted email to ${to || 'recipient'}: ${subject || 'no subject'}`;
}

function buildPendingSendTask(task, draftResult) {
  return {
    ...task,
    status: 'awaiting_approval',
    approval_required: true,
    approval_reason: 'gmail_send_draft: drafted email is waiting for explicit send approval',
    runtime_action: 'gmail_send_draft',
    automation_type: 'gmail_send_draft',
    gmail_draft: {
      draftId: draftResult.draftId,
      messageId: draftResult.messageId,
      threadId: draftResult.threadId,
      to: draftResult.to,
      subject: draftResult.subject,
      bodyPreview: draftResult.bodyPreview,
    },
    summary: summarizeSendApproval(task, draftResult),
  };
}

export function describeExplicitExecutionAction(task) {
  const action = String(task?.runtime_action || '').trim();
  if (action === 'gmail_create_draft') {
    return {
      action,
      description: 'Create a Gmail draft and hold it for explicit send approval.',
    };
  }

  if (action === 'gmail_send_draft') {
    return {
      action,
      description: 'Send an approved Gmail draft.',
    };
  }

  return null;
}

async function executeGmailCreateDraft(task, config, options = {}) {
  const request = task?.email_request;
  if (!request?.to || !request?.subject || !request?.bodyText) {
    throw new Error('Gmail draft task is missing to, subject, or bodyText fields.');
  }

  const draft = await createGmailDraft(config.env, request, options);
  const pendingApprovalTask = buildPendingSendTask(task, draft);

  return {
    rawStdout: '',
    report: {
      state: 'awaiting_approval',
      awaitingApproval: true,
      awaitingApprovalAction: 'gmail_send_draft',
      severity: 'warning',
      summary: `Gmail draft created for ${draft.to}. Approve to send or reject with revision feedback.`,
      emailTo: draft.to,
      emailSubject: draft.subject,
      emailPreview: draft.bodyPreview,
      gmailDraftId: draft.draftId,
      gmailMessageId: draft.messageId,
      gmailThreadId: draft.threadId,
      pendingApprovalTask,
    },
  };
}

async function executeGmailSendDraftAction(task, config, options = {}) {
  const draftId = normalizeWhitespace(task?.gmail_draft?.draftId);
  if (!draftId) {
    throw new Error('Approved Gmail send task is missing the draft ID.');
  }

  const result = await sendGmailDraft(config.env, draftId, options);
  return {
    rawStdout: '',
    report: {
      state: 'sent',
      severity: 'success',
      summary: `Sent drafted email to ${task?.gmail_draft?.to || task?.email_request?.to || 'recipient'}.`,
      emailTo: task?.gmail_draft?.to || task?.email_request?.to || '',
      emailSubject: task?.gmail_draft?.subject || task?.email_request?.subject || '',
      emailPreview: task?.gmail_draft?.bodyPreview || '',
      gmailDraftId: draftId,
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
    },
  };
}

export async function executeGmailAction(action, task, config, options = {}) {
  if (action === 'gmail_create_draft') {
    return executeGmailCreateDraft(task, config, options);
  }

  if (action === 'gmail_send_draft') {
    return executeGmailSendDraftAction(task, config, options);
  }

  throw new Error(`Unsupported Gmail action '${action}'.`);
}
