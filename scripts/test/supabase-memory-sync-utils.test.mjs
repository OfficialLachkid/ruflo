import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBridgeRecord,
  createBridgeSyncPlan,
  extractMarkdownSummary,
  extractMarkdownTitle,
} from '../lib/supabase-memory-sync-utils.mjs';

test('extractMarkdownTitle prefers the first markdown heading', () => {
  assert.equal(extractMarkdownTitle('# Bridge Hub\n\nSummary'), 'Bridge Hub');
});

test('extractMarkdownSummary returns the first non-heading line', () => {
  assert.equal(extractMarkdownSummary('# Title\n\nFirst summary line.\n\n- bullet'), 'First summary line.');
});

test('buildBridgeRecord creates a normalized bridge memory record', () => {
  const record = buildBridgeRecord({
    manifestEntry: {
      name: 'patterns.md',
      source: 'C:/Vault/Jacobs-2/90_Ruflo_Bridge/patterns.md',
      sha256: 'ABC123',
      lastWriteTimeUtc: '2026-07-09T10:00:00.000Z',
    },
    content: '# Patterns\n\nUseful bridge summary.',
    sourceDevice: 'mac-mini',
    syncedAtUtc: '2026-07-09T10:30:00.000Z',
  });

  assert.equal(record.record_key, 'bridge:patterns');
  assert.equal(record.memory_namespace, 'bridge');
  assert.equal(record.topic, 'patterns');
  assert.equal(record.title, 'Patterns');
  assert.equal(record.summary, 'Useful bridge summary.');
  assert.equal(record.source_device, 'mac-mini');
});

test('createBridgeSyncPlan separates inserts, updates, and unchanged bridge records', () => {
  const localRecords = [
    {
      record_key: 'bridge:patterns',
      source_sha256: 'NEW',
    },
    {
      record_key: 'bridge:security',
      source_sha256: 'SAME',
    },
    {
      record_key: 'bridge:debugging',
      source_sha256: 'FIRST',
    },
  ];

  const remoteRecords = [
    {
      id: 'record-1',
      record_key: 'bridge:patterns',
      source_sha256: 'OLD',
      version: 3,
    },
    {
      id: 'record-2',
      record_key: 'bridge:security',
      source_sha256: 'SAME',
      version: 2,
    },
  ];

  const plan = createBridgeSyncPlan(localRecords, remoteRecords);

  assert.equal(plan.insertedCount, 1);
  assert.equal(plan.updatedCount, 1);
  assert.equal(plan.unchangedCount, 1);
  assert.equal(plan.upserts.length, 2);
  assert.equal(plan.upserts.find((item) => item.record_key === 'bridge:patterns')?.version, 4);
  assert.equal(plan.upserts.find((item) => item.record_key === 'bridge:debugging')?.version, 1);
});
