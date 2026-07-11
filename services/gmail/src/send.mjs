import { fetchAccessToken } from './oauth.mjs';
import { buildRfc822Message, toBase64Url } from './mime.mjs';

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';

function assertConfigured(gmailConfig) {
  const missing = [];
  if (!gmailConfig.clientId) missing.push('GMAIL_CLIENT_ID');
  if (!gmailConfig.clientSecret) missing.push('GMAIL_CLIENT_SECRET');
  if (!gmailConfig.refreshToken) missing.push('GMAIL_REFRESH_TOKEN');
  if (!gmailConfig.senderEmail) missing.push('GMAIL_SENDER_EMAIL');
  if (missing.length > 0) {
    throw new Error(`Gmail sender is not fully configured. Missing: ${missing.join(', ')}`);
  }
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

export async function sendGmailMessage(gmailConfig, draft, options = {}) {
  assertConfigured(gmailConfig);
  const fetchImpl = options.fetch || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;

  const normalized = normalizeDraft(gmailConfig, draft);
  const rfc822 = buildRfc822Message(normalized);
  const raw = toBase64Url(rfc822);

  if (gmailConfig.draftOnly === true || options.draftOnly === true) {
    const draftResult = await createGmailDraft(gmailConfig, normalized, {
      ...options,
      fetch: fetchImpl,
      fetchAccessToken: fetchAccessTokenImpl,
      __precomputedRaw: raw,
    });
    return { ...draftResult, mode: 'draft_only' };
  }

  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
  const response = await fetchImpl(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  const bodyText = await response.text();
  let payload = {};
  try { payload = JSON.parse(bodyText); } catch { payload = {}; }
  if (!response.ok) {
    throw new Error(`Gmail send failed (${response.status}): ${bodyText || 'no body'}`);
  }
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

export async function createGmailDraft(gmailConfig, draft, options = {}) {
  assertConfigured(gmailConfig);
  const fetchImpl = options.fetch || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;

  const normalized = normalizeDraft(gmailConfig, draft);
  const raw = options.__precomputedRaw || toBase64Url(buildRfc822Message(normalized));

  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
  const response = await fetchImpl(GMAIL_DRAFTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });
  const bodyText = await response.text();
  let payload = {};
  try { payload = JSON.parse(bodyText); } catch { payload = {}; }
  if (!response.ok) {
    throw new Error(`Gmail draft create failed (${response.status}): ${bodyText || 'no body'}`);
  }
  return {
    mode: 'draft_created',
    draftId: payload.id || '',
    messageId: payload.message?.id || '',
    threadId: payload.message?.threadId || '',
    to: normalized.to,
    from: normalized.fromEmail,
    subject: normalized.subject,
    createdAtUtc: new Date().toISOString(),
  };
}
