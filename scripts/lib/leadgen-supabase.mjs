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
  url.searchParams.set('select', 'domain,kvk_number');
  url.searchParams.set('limit', '10000');

  const rows = await fetchJson(url.toString(), {
    headers: createHeaders(config.apiKey),
  });

  return {
    domains: Array.isArray(rows) ? rows.map((row) => row.domain).filter(Boolean) : [],
    kvkNumbers: Array.isArray(rows) ? rows.map((row) => row.kvk_number).filter(Boolean) : [],
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

export async function fetchLeads(filters = {}, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('select', '*');
  url.searchParams.set('order', 'created_at.desc');
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
