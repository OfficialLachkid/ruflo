import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolveInsideRoot } from './paths.mjs';

export function hasVerifiedUsageRights(asset) {
  return asset.rights_status === 'verified'
    && asset.approval_status === 'approved'
    && Boolean(asset.rights_evidence);
}
export function canPlanAssetDownload(asset) {
  return hasVerifiedUsageRights(asset)
    && ['api', 'permitted_download', 'fixture'].includes(asset.retrieval_method);
}

async function inspectLocalAsset(asset, projectRoot) {
  if (!asset.local_path) {
    return { available: false, hashMatches: false };
  }

  try {
    const assetPath = resolveInsideRoot(projectRoot, asset.local_path, 'Asset local_path');
    await access(assetPath);
    if (!asset.content_sha256) {
      return { available: true, hashMatches: false };
    }
    const digest = createHash('sha256').update(await readFile(assetPath)).digest('hex');
    return { available: true, hashMatches: digest === asset.content_sha256 };
  } catch {
    return { available: false, hashMatches: false };
  }
}

export async function evaluateAssetGates(assets, projectRoot) {
  const eligible = [];
  const blocked = [];

  for (const asset of assets) {
    const localAsset = await inspectLocalAsset(asset, projectRoot);
    if (hasVerifiedUsageRights(asset) && localAsset.available && localAsset.hashMatches) {
      eligible.push(asset);
      continue;
    }

    const reasons = [];
    if (asset.rights_status !== 'verified') {
      reasons.push(`rights_status=${asset.rights_status}`);
    }
    if (asset.approval_status !== 'approved') {
      reasons.push(`approval_status=${asset.approval_status}`);
    }
    if (!asset.rights_evidence) {
      reasons.push('rights_evidence_missing');
    }
    if (!localAsset.available) {
      reasons.push('local_asset_missing');
    } else if (!asset.content_sha256) {
      reasons.push('content_hash_missing');
    } else if (!localAsset.hashMatches) {
      reasons.push('content_hash_mismatch');
    }

    blocked.push({ asset, reasons });
  }

  return { eligible, blocked };
}
