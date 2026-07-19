import { access } from 'node:fs/promises';
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

async function hasLocalAsset(asset, projectRoot) {
  if (!asset.local_path) {
    return false;
  }

  try {
    const assetPath = resolveInsideRoot(projectRoot, asset.local_path, 'Asset local_path');
    await access(assetPath);
    return true;
  } catch {
    return false;
  }
}

export async function evaluateAssetGates(assets, projectRoot) {
  const eligible = [];
  const blocked = [];

  for (const asset of assets) {
    const locallyAvailable = await hasLocalAsset(asset, projectRoot);
    if (hasVerifiedUsageRights(asset) && locallyAvailable) {
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
    if (!locallyAvailable) {
      reasons.push('local_asset_missing');
    }

    blocked.push({ asset, reasons });
  }

  return { eligible, blocked };
}
