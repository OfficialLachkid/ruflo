import { assertGmailRuntimeConfig, resolveGmailRuntimeConfig } from './config.mjs';
import { buildRfc822Message, toBase64Url } from './mime.mjs';
import { fetchAccessToken } from './oauth.mjs';

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
const GMAIL_DRAFT_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send';

function normalizeConfigObject(gmailConfig = {}) {
  return {
    clientId: String(gmailConfig.clientId || '').trim(),
    clientSecret: String(gmailConfig.clientSecret || '').trim(),
    refreshToken: String(gmailConfig.refreshToken || '').trim(),
    senderEmail: String(gmailConfig.senderEmail || gmailConfig.fromEmail || '').trim(),
    senderName: String(gmailConfig.senderName || '').trim(),
    loopbackPort: Number.isFinite(gmailConfig.loopbackPort) && gmailConfig.loopbackPort > 0
      ? gmailConfig.loopbackPort
      : 53682,
    redirectUri: String(gmailConfig.redirectUri || '').trim(),
    bccAudit: Array.isArray(gmailConfig.bccAudit) ? gmailConfig.bccAudit.filter(Boolean) : [],
    draftOnly: gmailConfig.draftOnly === true,
  };
}

function resolveInputConfig(envOrConfig) {
  if (envOrConfig?.clientId || envOrConfig?.clientSecret || envOrConfig?.refreshToken || envOrConfig?.senderEmail) {
    return normalizeConfigObject(envOrConfig);
  }

  return resolveGmailRuntimeConfig(envOrConfig || {});
}

function normalizeDraft(gmailConfig, draft) {
  return {
    to: draft.to,
    subject: draft.subject,
    bodyText: draft.bodyText,
    fromEmail: draft.fromEmail || gmailConfig.senderEmail,
    fromName: draft.fromName || gmailConfig.senderName || '',
    replyTo: draft.replyTo || '',
    bcc: draft.bcc && draft.bcc.length > 0 ? draft.bcc : gmailConfig.bccAudit,
  };
}

function previewBody(bodyText) {
  return String(bodyText || '').replace(/\s+/gu, ' ').trim().slice(0, 240);
}

async function readJsonResponse(response) {
  if (typeof response?.text === 'function') {
    const bodyText = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = {};
    }
    return { bodyText, payload };
  }

  if (typeof response?.json === 'function') {
    const payload = await response.json();
    return {
      bodyText: JSON.stringify(payload || {}),
      payload: payload || {},
    };
  }

  return { bodyText: '', payload: {} };
}

async function sendGmailApiRequest(gmailConfig, url, body, options = {}) {
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    const label = options.errorLabel || 'Gmail API request';
    throw new Error(`${label} failed (${response.status}): ${bodyText || 'no body'}`);
  }

  return payload;
}

export async function sendGmailMessage(envOrConfig, draft, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const normalized = normalizeDraft(gmailConfig, draft);
  const raw = toBase64Url(buildRfc822Message(normalized));

  if (gmailConfig.draftOnly === true || options.draftOnly === true) {
    const draftResult = await createGmailDraft(gmailConfig, normalized, {
      ...options,
      fetch: fetchImpl,
      fetchAccessToken: fetchAccessTokenImpl,
      __precomputedRaw: raw,
    });
    return { ...draftResult, mode: 'draft_only' };
  }

  const payload = await sendGmailApiRequest(gmailConfig, GMAIL_SEND_URL, { raw }, {
    fetch: fetchImpl,
    fetchAccessToken: fetchAccessTokenImpl,
    errorLabel: 'Gmail send',
  });

  return {
    mode: 'sent',
    messageId: payload.id || '',
    threadId: payload.threadId || '',
    labelIds: payload.labelIds || [],
    to: normalized.to,
    from: normalized.fromEmail,
    subject: normalized.subject,
    sentAtUtc: new Date().toISOString(),
  };
}

export async function createGmailDraft(envOrConfig, draft, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const normalized = normalizeDraft(gmailConfig, draft);
  const raw = options.__precomputedRaw || toBase64Url(buildRfc822Message(normalized));

  const payload = await sendGmailApiRequest(gmailConfig, GMAIL_DRAFTS_URL, { message: { raw } }, {
    fetch: fetchImpl,
    fetchAccessToken: fetchAccessTokenImpl,
    errorLabel: 'Gmail draft create',
  });

  return {
    mode: 'draft_created',
    draftId: payload.id || '',
    messageId: payload.message?.id || '',
    threadId: payload.message?.threadId || '',
    to: normalized.to,
    from: normalized.fromEmail,
    subject: normalized.subject,
    bodyPreview: previewBody(normalized.bodyText),
    createdAtUtc: new Date().toISOString(),
  };
}

export async function sendGmailDraft(envOrConfig, draftId, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const draftIdentifier = String(draftId || '').trim();
  if (!draftIdentifier) {
    throw new Error('Missing Gmail draft ID.');
  }

  const payload = await sendGmailApiRequest(gmailConfig, GMAIL_DRAFT_SEND_URL, { id: draftIdentifier }, {
    ...options,
    errorLabel: 'Gmail draft send',
  });

  return {
    mode: 'sent',
    draftId: draftIdentifier,
    messageId: String(payload.id || '').trim(),
    threadId: String(payload.threadId || '').trim(),
    labelIds: Array.isArray(payload.labelIds) ? payload.labelIds : [],
  };
}
