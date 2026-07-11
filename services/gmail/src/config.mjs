export function resolveGmailConfig(runtimeConfig) {
  const gmail = runtimeConfig?.gmail || {};
  return {
    clientId: gmail.clientId || '',
    clientSecret: gmail.clientSecret || '',
    refreshToken: gmail.refreshToken || '',
    senderEmail: gmail.senderEmail || '',
    senderName: gmail.senderName || '',
    loopbackPort: Number.isFinite(gmail.loopbackPort) && gmail.loopbackPort > 0 ? gmail.loopbackPort : 53682,
    bccAudit: Array.isArray(gmail.bccAudit) ? gmail.bccAudit : [],
    draftOnly: gmail.draftOnly === true,
  };
}

export function summarizeGmailReadiness(gmailConfig) {
  const missing = [];
  if (!gmailConfig.clientId) missing.push('GMAIL_CLIENT_ID');
  if (!gmailConfig.clientSecret) missing.push('GMAIL_CLIENT_SECRET');
  if (!gmailConfig.refreshToken) missing.push('GMAIL_REFRESH_TOKEN');
  if (!gmailConfig.senderEmail) missing.push('GMAIL_SENDER_EMAIL');
  return {
    ready: missing.length === 0,
    missing,
    senderEmail: gmailConfig.senderEmail,
    draftOnly: gmailConfig.draftOnly === true,
  };
}
