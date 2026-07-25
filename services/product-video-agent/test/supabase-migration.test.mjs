import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const migrationPath = resolve(
  projectRoot,
  'supabase/migrations/20260725_create_product_video_tables.sql',
);

const EXPECTED_TABLES = [
  'orion_products',
  'orion_runs',
  'orion_run_products',
  'orion_source_snapshots',
  'orion_product_scores',
  'orion_assets',
  'orion_media_locations',
  'orion_script_jobs',
  'orion_script_variants',
  'orion_script_revisions',
  'orion_voice_jobs',
  'orion_caption_jobs',
  'orion_render_jobs',
  'orion_render_clips',
  'orion_approvals',
  'orion_affiliate_links',
  'orion_publications',
  'orion_analytics_snapshots',
];

test('product-video migration creates private normalized workflow tables', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  for (const table of EXPECTED_TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'u'));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'u'));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`, 'u'));
    assert.match(sql, new RegExp(`grant all on public\\.${table} to postgres, service_role`, 'u'));
  }

  assert.match(sql, /create or replace view public\.orion_product_overview/iu);
  assert.match(sql, /with \(security_invoker = true\)/iu);
  assert.match(sql, /location_type text not null/iu);
  assert.match(sql, /scheduled_for timestamptz/iu);
  assert.doesNotMatch(sql, /\borion_(?:product|run|asset|script|render|publication)_id\b/iu);
});
