import { buildNoticeDiscordPayload } from '../../discord-bot/src/message-formatting.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
// Discord embed descriptions cap at 4096 chars — cut the lead list there,
// not at an arbitrary row count, so short batches always show everything.
const DESCRIPTION_BUDGET = 3900;

function buildAuthHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

async function discordRequest(token, path, { method = 'POST', body } = {}) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    method,
    headers: buildAuthHeaders(token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function resolveChannelId(config) {
  return config.channelIds.leadGeneration || config.channelIds.agentResults || '';
}

// Posts a "run started" placeholder so there's immediate feedback in the
// channel while the batch runs (20+ minutes at higher caps). Returns the
// message reference for updateLeadgenReport to edit in place, or null when
// Discord isn't configured/reachable — callers treat that as "post a fresh
// message at the end instead", never as a reason to fail the run.
export async function postLeadgenStarted(config, { title, niche, query }) {
  const channelId = resolveChannelId(config);
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return null;
  }

  try {
    const message = await discordRequest(
      config.env.DISCORD_BOT_TOKEN,
      `/channels/${channelId}/messages`,
      {
        body: buildNoticeDiscordPayload({
          title: `${title} — Running`,
          description: `Searching for **${niche}** (query: "${query}")... results will appear here when the batch finishes.`,
          color: 0xFEE75C,
          footerText: 'Ruflo leadgen',
        }),
      },
    );
    return { channelId, messageId: message.id };
  } catch {
    return null;
  }
}

function buildResultDescription({ title, niche, query, result, runError }) {
  if (runError) {
    return `${title} failed for **${niche}** (query: "${query}"): ${runError.message}`;
  }

  const alreadyKnownNote = result?.alreadyKnownCount > 0
    ? ` ${result.alreadyKnownCount} previously-saved lead(s) turned up again and were skipped.`
    : '';
  const searchedNote = result?.searchedCount > 0
    ? ` Searched ${result.searchedCount} candidate(s).`
    : '';

  const header = `${title} for **${niche}** (query: "${query}") found ${result.leadCount} new lead(s), saved ${result.insertedCount} to the leads table.${searchedNote}${alreadyKnownNote}`;

  const leads = result?.leadsPreview || [];
  const lines = [];
  let used = header.length;
  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    const line = lead?.url ? `- [${lead.name}](${lead.url})` : `- ${lead?.name || lead}`;
    if (used + line.length + 1 > DESCRIPTION_BUDGET) {
      lines.push(`...and ${leads.length - i} more (see the leads table)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return lines.length > 0 ? `${header}\n${lines.join('\n')}` : header;
}

// Edits the started-message in place with the final results; posts a fresh
// message when there's no started-message to edit.
export async function reportLeadgenRunToDiscord(config, { title, niche, query, result, runError, startedMessage }) {
  const channelId = startedMessage?.channelId || resolveChannelId(config);
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return null;
  }

  const payload = buildNoticeDiscordPayload({
    title: runError ? `${title} — Failed` : title,
    description: buildResultDescription({ title, niche, query, result, runError }),
    color: runError ? 0xED4245 : 0x57F287,
    footerText: 'Ruflo leadgen',
  });

  if (startedMessage?.messageId) {
    try {
      return await discordRequest(
        config.env.DISCORD_BOT_TOKEN,
        `/channels/${channelId}/messages/${startedMessage.messageId}`,
        { method: 'PATCH', body: payload },
      );
    } catch {
      // fall through to posting a fresh message
    }
  }

  return discordRequest(config.env.DISCORD_BOT_TOKEN, `/channels/${channelId}/messages`, { body: payload });
}
