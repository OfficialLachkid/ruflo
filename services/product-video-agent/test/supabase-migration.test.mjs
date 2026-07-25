import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const migrationPath = resolve(
  projectRoot,
  'supabase/migrations/20260725_create_video_generation_tables.sql',
);

const EXPECTED_TABLES = [
  'video_channels',
  'video_subjects',
  'video_products',
  'video_generations',
  'video_generation_subjects',
  'video_source_snapshots',
  'video_subject_scores',
  'video_assets',
  'video_media_locations',
  'video_script_jobs',
  'video_script_variants',
  'video_script_revisions',
  'video_voice_jobs',
  'video_caption_jobs',
  'video_render_jobs',
  'video_render_clips',
  'video_approvals',
  'video_affiliate_links',
  'video_publications',
  'video_publication_affiliate_links',
  'video_analytics_snapshots',
];

test('video-generation migration creates private multi-lane workflow tables', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  for (const table of EXPECTED_TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'u'));
    assert.match(sql, new RegExp(`'${table}'`, 'u'));
  }

  assert.match(sql, /alter table public\.%I enable row level security/iu);
  assert.match(sql, /revoke all on table public\.%I from anon, authenticated/iu);
  assert.match(sql, /grant all on table public\.%I to postgres, service_role/iu);
  assert.match(sql, /create or replace view public\.video_generation_overview/iu);
  assert.match(sql, /with \(security_invoker = true\)/iu);
  assert.match(sql, /content_lane text not null/iu);
  assert.match(sql, /subject_type text not null/iu);
  assert.match(sql, /subject_id text primary key references public\.video_subjects/iu);
  assert.match(sql, /primary_subject_id text references public\.video_subjects/iu);
  assert.match(sql, /location_type text not null/iu);
  assert.match(sql, /scheduled_for timestamptz/iu);
  assert.doesNotMatch(sql, /\borion_/iu);
});
