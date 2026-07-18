import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { upsertLeads } from '../../../scripts/lib/leadgen-supabase.mjs';

const DEFAULT_MAX_RESULTS = 10;

function resolvePythonBin(config) {
  const configuredBin = config?.env?.LEADGEN_PYTHON_BIN;
  if (configuredBin) {
    return configuredBin;
  }

  const venvPython = resolve(projectRoot, '.venv-leadgen', 'bin', 'python3');
  return existsSync(venvPython) ? venvPython : 'python3';
}

function resolveSearchScriptPath() {
  return resolve(projectRoot, 'services', 'leadgen-scraper', 'search_leads.py');
}

function runPythonSearch(query, max, config) {
  return new Promise((resolvePromise, rejectPromise) => {
    const pythonBin = resolvePythonBin(config);
    const scriptPath = resolveSearchScriptPath();
    const args = [scriptPath, query, '--max', String(max)];

    const child = spawn(pythonBin, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(new Error(`Could not start leadgen search: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `Leadgen search exited with code ${code}.`));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        rejectPromise(new Error(`Could not parse leadgen search output: ${error.message}`));
      }
    });
  });
}

function isUsableLead(record) {
  return Boolean(
    record
    && !record.error
    && record.business_name
    && record.business_name !== 'NA',
  );
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function mapLeadToRow(record, context = {}) {
  return {
    source_url: record.source_url,
    domain: extractDomain(record.source_url),
    business_name: record.business_name,
    business_type: record.business_type || '',
    services: Array.isArray(record.services) ? record.services : [],
    contact_email: record.contact_email || null,
    contact_phone: record.contact_phone || null,
    social_links: Array.isArray(record.social_links) ? record.social_links : [],
    website_quality: record.website_quality || null,
    search_query: context.query || '',
    niche: context.niche || '',
    location: context.location || '',
    status: 'new',
    raw_extraction: record,
  };
}

export async function runLeadgenSearch(query, max, config, options = {}) {
  const boundedMax = Math.min(Math.max(Number(max) || DEFAULT_MAX_RESULTS, 1), 50);
  const records = await runPythonSearch(query, boundedMax, config);
  const usableLeads = (Array.isArray(records) ? records : []).filter(isUsableLead);

  let insertedCount = 0;
  if (usableLeads.length > 0) {
    const rows = usableLeads.map((record) => mapLeadToRow(record, {
      query,
      niche: options.niche || '',
      location: options.location || '',
    }));
    const upserted = await upsertLeads(rows);
    insertedCount = Array.isArray(upserted) ? upserted.length : rows.length;
  }

  return {
    leadCount: usableLeads.length,
    skippedCount: (Array.isArray(records) ? records.length : 0) - usableLeads.length,
    insertedCount,
    // full list, not truncated — the leadCount/insertedCount in Discord
    // messages must match how many names are actually shown, or it reads
    // as a discrepancy. Callers truncate for display if they want to.
    leadsPreview: usableLeads.map((record) => record.business_name),
  };
}
