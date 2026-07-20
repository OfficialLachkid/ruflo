import process from 'node:process';
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

// Posts a "queued" placeholder for a run that hasn't started yet, so a
// multi-niche sweep shows its whole plan in order upfront. Returns the
// message reference for later edits, or null when Discord isn't
// configured/reachable — callers treat that as "post a fresh message at
// the end instead", never as a reason to fail the run.
export async function postLeadgenQueued(config, { title, niche, query }) {
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
          title: `${title} — Queued`,
          description: `**${niche}** (query: "${query}") is queued.`,
          color: 0x99AAB5,
          footerText: 'Ruflo leadgen',
        }),
      },
    );
    return { channelId, messageId: message.id };
  } catch {
    return null;
  }
}

// Flips a queued message to "Running (X min)" and keeps the elapsed-minutes
// counter ticking via an in-place edit once a minute (one API call/min —
// negligible against Discord's rate limits). Returns a stop() function;
// always call it before the final report edit.
export function beginLeadgenProgress(config, message, { title, niche, query }) {
  if (!message?.messageId || !config.env.DISCORD_BOT_TOKEN) {
    return { stop: () => {} };
  }

  const startedAtMs = Date.now();
  const editRunning = async () => {
    const elapsedMinutes = Math.floor((Date.now() - startedAtMs) / 60000);
    try {
      await discordRequest(
        config.env.DISCORD_BOT_TOKEN,
        `/channels/${message.channelId}/messages/${message.messageId}`,
        {
          method: 'PATCH',
          body: buildNoticeDiscordPayload({
            title: `${title} — Running`,
            description: `Searching for **${niche}** (query: "${query}")... running for ${elapsedMinutes} min. Results will appear here when the batch finishes.`,
            color: 0xFEE75C,
            footerText: 'Ruflo leadgen',
          }),
        },
      );
    } catch {
      // A missed progress tick is not worth failing anything over.
    }
  };

  editRunning();
  const timer = setInterval(editRunning, 60000);
  // Don't let the ticker keep the process alive if something else exits.
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop: () => clearInterval(timer),
  };
}

// Back-compat single-shot "started" message for callers that don't use the
// queued flow.
export async function postLeadgenStarted(config, { title, niche, query }) {
  const message = await postLeadgenQueued(config, { title, niche, query });
  return message;
}

function buildSweepOverviewDescription({ location, statuses }) {
  const completed = statuses.filter((s) => s.state === 'completed').length;
  const running = statuses.find((s) => s.state === 'running');
  const queued = statuses.filter((s) => s.state === 'queued').length;
  const failed = statuses.filter((s) => s.state === 'failed').length;

  const lines = statuses.map((s) => {
    if (s.state === 'completed') {
      return `✅ ${s.niche} — ${s.leadCount} new (${s.durationMinutes} min)`;
    }
    if (s.state === 'failed') {
      return `❌ ${s.niche} — failed`;
    }
    if (s.state === 'running') {
      return `🔄 ${s.niche} — running`;
    }
    return `⏳ ${s.niche} — queued`;
  });

  const headline = `**${location}** — ${completed}/${statuses.length} complete`
    + (running ? `, running: ${running.niche}` : '')
    + (queued > 0 ? `, ${queued} queued` : '')
    + (failed > 0 ? `, ${failed} failed` : '');

  return `${headline}\n${lines.join('\n')}`;
}

// One pinned-style overview message per sweep: posted before the first
// niche starts, edited in place at every niche transition so the channel
// always shows how far the day's sweep is at a glance.
export async function postSweepOverview(config, { location, statuses }) {
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
          title: 'Daily Leadgen Sweep',
          description: buildSweepOverviewDescription({ location, statuses }),
          color: 0x5865F2,
          footerText: 'Ruflo leadgen sweep',
        }),
      },
    );
    return { channelId, messageId: message.id };
  } catch {
    return null;
  }
}

export async function updateSweepOverview(config, message, { location, statuses }) {
  if (!message?.messageId || !config.env.DISCORD_BOT_TOKEN) {
    return null;
  }

  try {
    return await discordRequest(
      config.env.DISCORD_BOT_TOKEN,
      `/channels/${message.channelId}/messages/${message.messageId}`,
      {
        method: 'PATCH',
        body: buildNoticeDiscordPayload({
          title: 'Daily Leadgen Sweep',
          description: buildSweepOverviewDescription({ location, statuses }),
          color: statuses.every((s) => s.state === 'completed') ? 0x57F287 : 0x5865F2,
          footerText: 'Ruflo leadgen sweep',
        }),
      },
    );
  } catch {
    return null;
  }
}

function buildResultDescription({ title, niche, query, result, runError, durationMinutes }) {
  if (runError) {
    return `${title} failed for **${niche}** (query: "${query}"): ${runError.message}`;
  }

  const alreadyKnownNote = result?.alreadyKnownCount > 0
    ? ` ${result.alreadyKnownCount} previously-saved lead(s) turned up again and were skipped.`
    : '';
  const searchedNote = result?.searchedCount > 0
    ? ` Searched ${result.searchedCount} candidate(s).`
    : '';
  const durationNote = Number.isFinite(durationMinutes)
    ? ` Took ${durationMinutes} min.`
    : '';

  const header = `${title} for **${niche}** (query: "${query}") found ${result.leadCount} new lead(s), saved ${result.insertedCount} to the leads table.${searchedNote}${alreadyKnownNote}${durationNote}`;

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
export async function reportLeadgenRunToDiscord(config, { title, niche, query, result, runError, startedMessage, durationMinutes }) {
  const channelId = startedMessage?.channelId || resolveChannelId(config);
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return null;
  }

  const payload = buildNoticeDiscordPayload({
    title: runError ? `${title} — Failed` : title,
    description: buildResultDescription({ title, niche, query, result, runError, durationMinutes }),
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

  // A Discord post failing here must never take down the sweep — the actual
  // work (search, extraction, Supabase save) is already done by this point;
  // losing the notification is a cosmetic miss, not a reason to abandon the
  // remaining niches. (Root cause of the 2026-07-20 sweep dying after one
  // Discord blip: this call used to be unguarded.)
  try {
    return await discordRequest(config.env.DISCORD_BOT_TOKEN, `/channels/${channelId}/messages`, { body: payload });
  } catch (error) {
    process.stderr.write(`Discord report post failed (non-fatal): ${error.message}\n`);
    return null;
  }
}
