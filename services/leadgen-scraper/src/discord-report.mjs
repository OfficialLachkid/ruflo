import { buildNoticeDiscordPayload } from '../../discord-bot/src/message-formatting.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISPLAY_LIMIT = 10;

function buildAuthHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

async function postToDiscord(token, channelId, payload) {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

// Shared by scripts/run-scheduled-leadgen.mjs (the real 07:00 daily job) and
// scripts/run-manual-leadgen.mjs (ad-hoc runs) so both post the same way —
// direct REST call, independent of the live bot process, since a one-off
// script has no gateway connection to dispatch through.
export async function reportLeadgenRunToDiscord(config, { title, niche, query, result, runError }) {
  const channelId = config.channelIds.leadGeneration || config.channelIds.agentResults;
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return null;
  }

  const shownLeads = result?.leadsPreview?.slice(0, DISPLAY_LIMIT) || [];
  const hiddenCount = (result?.leadsPreview?.length || 0) - shownLeads.length;
  const formatLead = (lead) => (
    lead?.url ? `- [${lead.name}](${lead.url})` : `- ${lead?.name || lead}`
  );
  const previewText = shownLeads.length > 0
    ? `\n${shownLeads.map(formatLead).join('\n')}${hiddenCount > 0 ? `\n...and ${hiddenCount} more` : ''}`
    : '';

  const alreadyKnownNote = result?.alreadyKnownCount > 0
    ? ` ${result.alreadyKnownCount} previously-saved lead(s) turned up again and were skipped.`
    : '';
  const searchedNote = result?.searchedCount > 0
    ? ` Searched ${result.searchedCount} candidate(s).`
    : '';

  const description = runError
    ? `${title} failed for **${niche}** (query: "${query}"): ${runError.message}`
    : `${title} for **${niche}** (query: "${query}") found ${result.leadCount} new lead(s), saved ${result.insertedCount} to the leads table.${searchedNote}${alreadyKnownNote}${previewText}`;

  return postToDiscord(
    config.env.DISCORD_BOT_TOKEN,
    channelId,
    buildNoticeDiscordPayload({
      title: runError ? `${title} — Failed` : title,
      description,
      color: runError ? 0xED4245 : 0x57F287,
      footerText: 'Ruflo leadgen',
    }),
  );
}
