#!/usr/bin/env node
// Runs one rotation step of the automated lead-generation schedule.
// Installed via scripts/install-leadgen-schedule.mjs as a daily launchd job.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { runLeadgenSearch } from '../services/leadgen-scraper/src/worker.mjs';
import { reportLeadgenRunToDiscord } from '../services/leadgen-scraper/src/discord-report.mjs';

const ROTATION_STATE_PATH = resolve(projectRoot, 'data', 'leadgen', 'rotation-state.json');
const DEFAULT_MAX_RESULTS = 10;

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

function pickNextRotation() {
  const state = loadRotationState();
  // Single run counter drives both wheels: all six niches cycle through a
  // city, then the city advances — so each day is one niche in one city.
  const runCount = Number.isInteger(state.runCount) ? state.runCount + 1 : 0;
  saveRotationState({ runCount, updatedAt: new Date().toISOString() });

  const niche = NICHE_ROTATION[runCount % NICHE_ROTATION.length];
  const location = LOCATION_ROTATION[
    Math.floor(runCount / NICHE_ROTATION.length) % LOCATION_ROTATION.length
  ];
  return { niche, location };
}

async function main() {
  const config = loadRuntimeConfig();
  const { niche, location } = pickNextRotation();
  const query = `${niche.term} ${location}`;

  let result;
  let runError = null;
  try {
    result = await runLeadgenSearch(query, DEFAULT_MAX_RESULTS, config, {
      niche: niche.key,
      location,
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

  await reportLeadgenRunToDiscord(config, {
    title: 'Scheduled Leadgen',
    niche: niche.key,
    query,
    result,
    runError,
  });

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
