#!/usr/bin/env node
// Runs the daily automated lead-generation sweep: ALL niches, one city per
// day, city advancing daily. Installed via scripts/install-leadgen-schedule.mjs
// as a daily 07:00 launchd job.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { runLeadgenSearch } from '../services/leadgen-scraper/src/worker.mjs';
import { withSharedRuntimeLock } from '../services/lib/shared-runtime-lock.mjs';
import {
  beginLeadgenProgress,
  postLeadgenQueued,
  postSweepOverview,
  reportLeadgenRunToDiscord,
  updateSweepOverview,
} from '../services/leadgen-scraper/src/discord-report.mjs';

const ROTATION_STATE_PATH = resolve(projectRoot, 'data', 'leadgen', 'rotation-state.json');
// DuckDuckGo returns ~30-40 results per query in practice, so 50 is
// effectively "everything the search engine will give us".
const MAX_RESULTS_PER_NICHE = 50;

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

// One fixed national query saturates fast — a 50-candidate re-run of
// "loodgieters Nederland" produced exactly 1 new (junk) lead once the
// known-domain skip was active. City-level queries surface local
// businesses the national query never ranks. Major cities + provincial
// capitals first; smaller towns (Heemskerk, Castricum, ...) are the
// planned next tier once these saturate.
const LOCATION_ROTATION = [
  'Amsterdam',
  'Rotterdam',
  'Den Haag',
  'Utrecht',
  'Eindhoven',
  'Groningen',
  'Tilburg',
  'Almere',
  'Breda',
  'Nijmegen',
  'Arnhem',
  'Haarlem',
  'Amersfoort',
  'Apeldoorn',
  "'s-Hertogenbosch",
  'Zwolle',
  'Leiden',
  'Maastricht',
  'Leeuwarden',
  'Assen',
  'Middelburg',
  'Lelystad',
];

function loadRotationState() {
  if (!existsSync(ROTATION_STATE_PATH)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(ROTATION_STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveRotationState(state) {
  mkdirSync(dirname(ROTATION_STATE_PATH), { recursive: true });
  writeFileSync(ROTATION_STATE_PATH, JSON.stringify(state, null, 2));
}

function pickNextCity() {
  const state = loadRotationState();
  // dayCount advances once per daily sweep; every niche runs every day.
  const dayCount = Number.isInteger(state.dayCount) ? state.dayCount + 1 : 0;
  saveRotationState({ dayCount, updatedAt: new Date().toISOString() });
  return LOCATION_ROTATION[dayCount % LOCATION_ROTATION.length];
}

async function runNiche(config, niche, location, queuedMessage) {
  const query = `${niche.term} ${location}`;
  const startedAtMs = Date.now();
  const progress = beginLeadgenProgress(config, queuedMessage, {
    title: 'Scheduled Leadgen',
    niche: niche.key,
    query,
  });

  let result;
  let runError = null;
  try {
    result = await runLeadgenSearch(query, MAX_RESULTS_PER_NICHE, config, {
      niche: niche.key,
      // Stored as "City, Country" so the format survives international
      // expansion; the search query itself stays "<term> <city>".
      location: `${location}, Nederland`,
    });
  } catch (error) {
    runError = error;
  } finally {
    progress.stop();
  }
  const durationMinutes = Math.max(1, Math.round((Date.now() - startedAtMs) / 60000));

  recordOpsMetric(config, 'scheduled_leadgen_run', {
    niche: niche.key,
    query,
    leadCount: result?.leadCount ?? 0,
    insertedCount: result?.insertedCount ?? 0,
    error: runError?.message || '',
  });

  await reportLeadgenRunToDiscord(config, {
    title: 'Scheduled Leadgen',
    niche: niche.key,
    query,
    result,
    runError,
    startedMessage: queuedMessage,
    durationMinutes,
  });

  return { niche: niche.key, query, result, runError, durationMinutes };
}

async function main() {
  const config = loadRuntimeConfig();
  const location = pickNextCity();
  const outcomes = [];

  // One overview message tracks the whole sweep (X/6 complete, what's
  // running, what's queued), then the per-niche plan is posted upfront as
  // queued messages, in order — each flips to "Running (X min)" when its
  // turn comes and is edited in place with results.
  const statuses = NICHE_ROTATION.map((niche) => ({ niche: niche.key, state: 'queued' }));
  const overviewMessage = await postSweepOverview(config, { location, statuses });

  const queuedMessages = [];
  for (const niche of NICHE_ROTATION) {
    queuedMessages.push(await postLeadgenQueued(config, {
      title: 'Scheduled Leadgen',
      niche: niche.key,
      query: `${niche.term} ${location}`,
    }));
  }

  // Sequential on purpose: one Ollama model instance, one Playwright at a
  // time — parallel niches would fight over the same 16GB.
  for (let i = 0; i < NICHE_ROTATION.length; i += 1) {
    statuses[i].state = 'running';
    await updateSweepOverview(config, overviewMessage, { location, statuses });

    const outcome = await runNiche(config, NICHE_ROTATION[i], location, queuedMessages[i]);
    outcomes.push(outcome);

    statuses[i].state = outcome.runError ? 'failed' : 'completed';
    statuses[i].leadCount = outcome.result?.leadCount ?? 0;
    statuses[i].durationMinutes = outcome.durationMinutes;
    await updateSweepOverview(config, overviewMessage, { location, statuses });
  }

  const failures = outcomes.filter((outcome) => outcome.runError);
  process.stdout.write(`${JSON.stringify(
    outcomes.map(({ niche, query, result, runError }) => ({
      niche,
      query,
      leadCount: result?.leadCount ?? 0,
      insertedCount: result?.insertedCount ?? 0,
      alreadyKnownCount: result?.alreadyKnownCount ?? 0,
      searchedCount: result?.searchedCount ?? 0,
      error: runError?.message || undefined,
    })),
    null,
    2,
  )}\n`);

  if (failures.length > 0) {
    process.stderr.write(`${failures.length} niche run(s) failed.\n`);
    process.exitCode = 1;
  }
}

withSharedRuntimeLock({ owner: 'scheduled-leadgen' }, main).catch((error) => {
  process.stderr.write(`Scheduled leadgen sweep failed: ${error.message}\n`);
  process.exitCode = 1;
});
