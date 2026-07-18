#!/usr/bin/env node
// Runs one rotation step of the automated lead-generation schedule.
// Installed via scripts/install-leadgen-schedule.mjs as a daily launchd job.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { buildNoticeDiscordPayload } from '../services/discord-bot/src/message-formatting.mjs';
import { runLeadgenSearch } from '../services/leadgen-scraper/src/worker.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const ROTATION_STATE_PATH = resolve(projectRoot, 'data', 'leadgen', 'rotation-state.json');
const DEFAULT_MAX_RESULTS = 10;
const LOCATION = 'Nederland'; // Dutch, not English "Netherlands" — matches the query in Dutch

// Dutch search terms — this targets the Dutch market, so the query itself is
// in Dutch to get relevant local results (matches the "loodgieter Rotterdam"
// test that worked well during development).
const NICHE_ROTATION = [
  { key: 'electricians', term: 'elektriciens' },
  { key: 'plumbing', term: 'loodgieters' },
  { key: 'real_estate', term: 'makelaars' },
  { key: 'recruitment_agencies', term: 'recruitmentbureaus' },
  { key: 'clinics', term: 'klinieken' },
  { key: 'liquor_stores', term: 'slijterijen' },
];

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

function loadRotationState() {
  if (!existsSync(ROTATION_STATE_PATH)) {
    return { lastIndex: -1 };
  }

  try {
    return JSON.parse(readFileSync(ROTATION_STATE_PATH, 'utf8'));
  } catch {
    return { lastIndex: -1 };
  }
}

function saveRotationState(state) {
  mkdirSync(dirname(ROTATION_STATE_PATH), { recursive: true });
  writeFileSync(ROTATION_STATE_PATH, JSON.stringify(state, null, 2));
}

function pickNextNiche() {
  const state = loadRotationState();
  const nextIndex = (state.lastIndex + 1) % NICHE_ROTATION.length;
  saveRotationState({ lastIndex: nextIndex, updatedAt: new Date().toISOString() });
  return NICHE_ROTATION[nextIndex];
}

async function main() {
  const config = loadRuntimeConfig();
  const niche = pickNextNiche();
  const query = `${niche.term} ${LOCATION}`;

  let result;
  let runError = null;
  try {
    result = await runLeadgenSearch(query, DEFAULT_MAX_RESULTS, config, {
      niche: niche.key,
      location: LOCATION,
    });
  } catch (error) {
    runError = error;
  }

  recordOpsMetric(config, 'scheduled_leadgen_run', {
    niche: niche.key,
    query,
    leadCount: result?.leadCount ?? 0,
    insertedCount: result?.insertedCount ?? 0,
    error: runError?.message || '',
  });

  const channelId = config.channelIds.agentResults;
  if (channelId && config.env.DISCORD_BOT_TOKEN) {
    const DISPLAY_LIMIT = 10;
    const shownNames = result?.leadsPreview?.slice(0, DISPLAY_LIMIT) || [];
    const hiddenCount = (result?.leadsPreview?.length || 0) - shownNames.length;
    const previewText = shownNames.length > 0
      ? `\n${shownNames.map((name) => `- ${name}`).join('\n')}${hiddenCount > 0 ? `\n...and ${hiddenCount} more` : ''}`
      : '';

    const description = runError
      ? `Scheduled leadgen run failed for **${niche.key}** (query: "${query}"): ${runError.message}`
      : `Scheduled leadgen run for **${niche.key}** (query: "${query}") found ${result.leadCount} lead(s), saved ${result.insertedCount} to the leads table.${previewText}`;

    await postToDiscord(
      config.env.DISCORD_BOT_TOKEN,
      channelId,
      buildNoticeDiscordPayload({
        title: runError ? 'Scheduled Leadgen — Failed' : 'Scheduled Leadgen',
        description,
        color: runError ? 0xED4245 : 0x57F287,
        footerText: 'Ruflo scheduled leadgen',
      }),
    );
  }

  if (runError) {
    process.stderr.write(`${runError.message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${JSON.stringify({ niche: niche.key, query, ...result }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Scheduled leadgen run failed: ${error.message}\n`);
  process.exitCode = 1;
});
