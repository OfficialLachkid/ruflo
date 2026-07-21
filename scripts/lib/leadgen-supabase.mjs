import { loadRuntimeConfig } from '../../services/lib/runtime-config.mjs';
import { createHeaders, fetchJson, getRuntimeApiKey } from './supabase-bridge-api.mjs';

export const DEFAULT_LEADS_TABLE = 'leads';

export function getLeadgenPersistenceConfig() {
  const runtimeConfig = loadRuntimeConfig();
  const env = runtimeConfig.env || {};

  return {
    supabaseUrl: env.SUPABASE_URL || '',
    apiKey: getRuntimeApiKey(env),
    leadsTable: env.LEADGEN_LEADS_TABLE || DEFAULT_LEADS_TABLE,
  };
}

export function isLeadgenPersistenceConfigured(config = getLeadgenPersistenceConfig()) {
  return Boolean(config.supabaseUrl && config.apiKey);
}

export async function upsertLeads(rows, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const nextRows = Array.isArray(rows) ? rows.filter((row) => row?.source_url && row?.domain) : [];
  if (nextRows.length < 1) {
    return [];
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('on_conflict', 'domain');

  return fetchJson(url.toString(), {
    method: 'POST',
    headers: createHeaders(config.apiKey, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(nextRows),
  });
}

export async function fetchExistingLeadKeys(config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('select', 'domain,kvk_number,contact_email,contact_phone,website_quality');
  url.searchParams.set('limit', '10000');

  const rows = await fetchJson(url.toString(), {
    headers: createHeaders(config.apiKey),
  });

  const byDomain = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.domain) {
      byDomain.set(row.domain, row);
    }
  }

  return {
    domains: [...byDomain.keys()],
    kvkNumbers: [...byDomain.values()].map((row) => row.kvk_number).filter(Boolean),
    // Existing values per domain — used so a re-upsert can always carry every
    // optional column (PostgREST bulk upsert requires uniform keys across
    // the whole row array) without a missing new value clobbering a value
    // captured on a previous run.
    byDomain,
  };
}

export async function fetchBlockedDomains(config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL('/rest/v1/blocked_domains', config.supabaseUrl);
  url.searchParams.set('select', 'domain');
  url.searchParams.set('limit', '10000');

  const rows = await fetchJson(url.toString(), {
    headers: createHeaders(config.apiKey),
  });

  return Array.isArray(rows) ? rows.map((row) => row.domain).filter(Boolean) : [];
}

export async function addBlockedDomain(domain, reason, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL('/rest/v1/blocked_domains', config.supabaseUrl);
  url.searchParams.set('on_conflict', 'domain');

  return fetchJson(url.toString(), {
    method: 'POST',
    headers: createHeaders(config.apiKey, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify([{ domain, reason: reason || '' }]),
  });
}

export async function updateLead(id, patch, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('id', `eq.${id}`);

  return fetchJson(url.toString(), {
    method: 'PATCH',
    headers: createHeaders(config.apiKey, {
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(patch),
  });
}

// For rows that should never have been leads at all (directory/aggregator
// noise, not a real single business) — distinct from status transitions
// like rejected_fit/extraction_error, which keep the row as an audit trail
// of a real judgment call made about a real business.
export async function deleteLead(id, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('id', `eq.${id}`);

  return fetchJson(url.toString(), {
    method: 'DELETE',
    headers: createHeaders(config.apiKey, {
      Prefer: 'return=representation',
    }),
  });
}

export async function fetchLeads(filters = {}, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('select', '*');
  url.searchParams.set('order', filters.order === 'oldest' ? 'created_at.asc' : 'created_at.desc');
  url.searchParams.set('limit', String(filters.limit || 100));
  if (filters.status) {
    url.searchParams.set('status', `eq.${filters.status}`);
  }
  if (filters.niche) {
    url.searchParams.set('niche', `eq.${filters.niche}`);
  }

  return fetchJson(url.toString(), {
    headers: createHeaders(config.apiKey),
  });
}
