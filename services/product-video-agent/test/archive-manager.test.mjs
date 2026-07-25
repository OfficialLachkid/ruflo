import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveVerifiedMedia, resolveArchiveRoots } from '../src/archive-manager.mjs';

async function createFixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'video-archive-'));
  const sourcePath = join(root, 'render.mp4');
  await writeFile(sourcePath, 'verified render fixture');
  return { root, sourcePath };
}

test('archive manager uses a hash-verified Desktop fallback when the SSD is absent', async () => {
  const { root, sourcePath } = await createFixtureRoot();
  const fallbackRoot = join(root, 'Desktop', 'Video Generation Fallback');
  const result = await archiveVerifiedMedia({
    sourcePath,
    relativePath: 'run-1/renders/render.mp4',
    renderJobId: 'render-job-1',
    preferredRoot: join(root, 'missing-ssd'),
    fallbackRoot,
    now: new Date('2026-07-25T12:00:00.000Z'),
  });

  assert.equal(result.location_type, 'mac_desktop_fallback');
  assert.equal(result.status, 'pending_external_ssd');
  assert.equal(result.source_retained, true);
  assert.equal(result.preferred_root_configured, true);
  assert.equal(await readFile(result.destination_path, 'utf8'), 'verified render fixture');
  assert.match(result.content_sha256, /^[a-f0-9]{64}$/u);
});

test('archive manager prefers a writable SSD and reuses an identical verified copy', async () => {
  const { root, sourcePath } = await createFixtureRoot();
  const preferredRoot = join(root, 'mounted-ssd');
  await mkdir(preferredRoot);
  const options = {
    sourcePath,
    relativePath: 'run-2/renders/render.mp4',
    renderJobId: 'render-job-2',
    preferredRoot,
    fallbackRoot: join(root, 'fallback'),
    now: new Date('2026-07-25T12:00:00.000Z'),
  };
  const first = await archiveVerifiedMedia(options);
  const second = await archiveVerifiedMedia(options);

  assert.equal(first.location_type, 'external_ssd_archive');
  assert.equal(first.status, 'archived');
  assert.equal(first.reused_existing_copy, false);
  assert.equal(second.reused_existing_copy, true);
  assert.equal(second.content_sha256, first.content_sha256);
});

test('archive roots default to one visible Desktop fallback directory', () => {
  const roots = resolveArchiveRoots({
    homeDirectory: '/Users/Agent',
    preferredRoot: null,
    fallbackRoot: null,
  });

  assert.equal(roots.preferredRoot, null);
  assert.match(roots.fallbackRoot.replaceAll('\\', '/'), /\/Users\/Agent\/Desktop\/Video Generation Fallback$/u);
});

test('archive manager rejects paths that escape the selected archive root', async () => {
  const { root, sourcePath } = await createFixtureRoot();
  await assert.rejects(
    archiveVerifiedMedia({
      sourcePath,
      relativePath: '../outside.mp4',
      renderJobId: 'render-job-3',
      fallbackRoot: join(root, 'fallback'),
    }),
    /inside the selected archive root/u,
  );
});
