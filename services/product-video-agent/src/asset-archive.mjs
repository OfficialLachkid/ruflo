import { basename, resolve } from 'node:path';
import { archiveVerifiedAsset } from './archive-manager.mjs';
import { resolveInsideRoot } from './paths.mjs';
import { OutputManifestSchema } from './schemas.mjs';

function assetArchivePath(asset) {
  const extension = basename(asset.local_path).includes('.')
    ? basename(asset.local_path).split('.').at(-1)
    : 'bin';
  const directory = asset.usage_scope === 'internal_editor_test'
    ? 'Assets/Internal Tests'
    : 'Assets/Source Media';
  return `${directory}/${asset.product_id}/${asset.content_sha256}.${extension}`;
}

export async function archiveManifestAssets(options) {
  const manifest = OutputManifestSchema.parse(options.manifest);
  const projectRoot = options.projectRoot || process.cwd();
  const referencedAssetIds = new Set(
    manifest.render_jobs.flatMap((job) => job.asset_ids),
  );
  const candidates = manifest.assets.filter((asset) => (
    referencedAssetIds.has(asset.asset_id)
    && asset.approval_status === 'approved'
    && asset.download_status === 'downloaded'
    && asset.local_path
    && asset.content_sha256
  ));
  const archivedLocations = [];

  for (const asset of candidates) {
    archivedLocations.push(await archiveVerifiedAsset({
      asset,
      sourcePath: resolveInsideRoot(
        projectRoot,
        resolve(projectRoot, asset.local_path),
        'Asset archive source path',
      ),
      relativePath: assetArchivePath(asset),
      preferredRoot: options.config?.archive?.preferred_root,
      fallbackRoot: options.config?.archive?.fallback_root,
      deviceId: options.config?.archive?.device_id,
      now: options.now,
    }));
  }

  const archivedIds = new Set(archivedLocations.map((location) => location.asset_id));
  return OutputManifestSchema.parse({
    ...manifest,
    asset_storage_locations: [
      ...manifest.asset_storage_locations.filter((location) => (
        !archivedIds.has(location.asset_id)
      )),
      ...archivedLocations,
    ],
    notes: [
      ...manifest.notes,
      `${archivedLocations.length} referenced source asset(s) were copied and SHA-256 verified in the configured media archive.`,
    ],
  });
}
