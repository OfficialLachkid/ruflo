import { basename } from 'node:path';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function stripMarkdownExtension(fileName) {
  return String(fileName || '').replace(/\.md$/iu, '');
}

function titleFromSlug(slug) {
  return String(slug || '')
    .split(/[-_]/u)
    .map((part) => {
      if (!part) {
        return '';
      }

      const lower = part.toLowerCase();
      return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
    })
    .filter(Boolean)
    .join(' ');
}

export function extractMarkdownTitle(content, fallback = 'Untitled') {
  const lines = String(content || '').split(/\r?\n/u);
  const heading = lines.find((line) => /^#\s+/u.test(line.trim()));
  if (heading) {
    return normalizeWhitespace(heading.replace(/^#\s+/u, ''));
  }

  return fallback;
}

export function extractMarkdownSummary(content) {
  const lines = String(content || '')
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !/^#+\s+/u.test(line))
    .filter((line) => !/^[-*]\s+/u.test(line));

  return lines[0] || '';
}

export function buildBridgeTopicSlug(fileName) {
  return stripMarkdownExtension(basename(fileName)).replace(/\s+/gu, '-').toLowerCase();
}

export function buildBridgeRecord({ manifestEntry, content, sourceDevice = 'unknown-device', syncedAtUtc }) {
  const topic = buildBridgeTopicSlug(manifestEntry?.name || manifestEntry?.source || 'bridge-note.md');
  const title = extractMarkdownTitle(content, titleFromSlug(topic));
  const summary = extractMarkdownSummary(content);

  return {
    record_key: `bridge:${topic}`,
    source_kind: 'vault_bridge_note',
    memory_namespace: 'bridge',
    topic,
    title,
    summary,
    content_markdown: String(content || ''),
    source_path: String(manifestEntry?.source || ''),
    source_sha256: String(manifestEntry?.sha256 || ''),
    source_device: String(sourceDevice || 'unknown-device'),
    review_status: 'active',
    conflict_flag: false,
    metadata: {
      bridgeFileName: String(manifestEntry?.name || ''),
      bridgeTopicLabel: titleFromSlug(topic),
      manifestLastWriteTimeUtc: String(manifestEntry?.lastWriteTimeUtc || ''),
      syncedAtUtc: String(syncedAtUtc || ''),
    },
    updated_at: String(manifestEntry?.lastWriteTimeUtc || syncedAtUtc || new Date().toISOString()),
  };
}

export function createBridgeSyncPlan(localRecords = [], remoteRecords = []) {
  const remoteByKey = new Map(
    remoteRecords
      .filter((record) => record?.record_key)
      .map((record) => [record.record_key, record])
  );

  const upserts = [];
  const unchanged = [];
  let insertedCount = 0;
  let updatedCount = 0;

  for (const localRecord of localRecords) {
    const existingRecord = remoteByKey.get(localRecord.record_key);

    if (!existingRecord) {
      insertedCount += 1;
      upserts.push({
        ...localRecord,
        version: 1,
      });
      continue;
    }

    if (String(existingRecord.source_sha256 || '') === localRecord.source_sha256) {
      unchanged.push({
        record_key: localRecord.record_key,
        version: Number(existingRecord.version || 1),
      });
      continue;
    }

    updatedCount += 1;
    upserts.push({
      ...localRecord,
      id: existingRecord.id,
      version: Math.max(1, Number(existingRecord.version || 1)) + 1,
    });
  }

  return {
    upserts,
    unchanged,
    insertedCount,
    updatedCount,
    unchangedCount: unchanged.length,
    scannedCount: localRecords.length,
  };
}
