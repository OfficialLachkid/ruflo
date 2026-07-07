export const MAC_SYNC_HEALTH_ACTIONS = [
  'ruflo_daemon_health_check',
  'discord_bot_runtime_health_check',
  'tailscale_health_check',
  'docker_colima_health_check',
  'ollama_health_check',
];

export function parseRevListCounts(output) {
  const raw = String(output || '').trim();
  const [aheadRaw = '0', behindRaw = '0'] = raw.split(/\s+/u);
  const aheadCount = Number.parseInt(aheadRaw, 10);
  const behindCount = Number.parseInt(behindRaw, 10);

  return {
    aheadCount: Number.isFinite(aheadCount) ? aheadCount : 0,
    behindCount: Number.isFinite(behindCount) ? behindCount : 0,
  };
}

export function classifyMacSyncState({
  currentBranch,
  upstreamRef,
  isClean,
  aheadCount,
  behindCount,
}) {
  if (!upstreamRef) {
    return {
      status: 'blocked_no_upstream',
      summary: `Branch ${currentBranch || 'unknown'} has no upstream tracking branch.`,
      canPull: false,
      blocked: true,
    };
  }

  if (!isClean) {
    return {
      status: 'blocked_dirty',
      summary: 'Local worktree is dirty, so automated pull is blocked.',
      canPull: false,
      blocked: true,
    };
  }

  if (aheadCount > 0 && behindCount > 0) {
    return {
      status: 'blocked_diverged',
      summary: `Local branch has diverged from ${upstreamRef}.`,
      canPull: false,
      blocked: true,
    };
  }

  if (aheadCount > 0) {
    return {
      status: 'blocked_ahead',
      summary: `Local branch is ahead of ${upstreamRef}.`,
      canPull: false,
      blocked: true,
    };
  }

  if (behindCount > 0) {
    return {
      status: 'behind',
      summary: `Local branch is behind ${upstreamRef} by ${behindCount} commit${behindCount === 1 ? '' : 's'}.`,
      canPull: true,
      blocked: false,
    };
  }

  return {
    status: 'up_to_date',
    summary: `Local branch is up to date with ${upstreamRef}.`,
    canPull: false,
    blocked: false,
  };
}

export function summarizeHealthChecks(checks = []) {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  const unhealthyChecks = normalizedChecks.filter((check) => check?.severity !== 'healthy');
  const healthyChecks = normalizedChecks.filter((check) => check?.severity === 'healthy');

  return {
    totalChecks: normalizedChecks.length,
    healthyCount: healthyChecks.length,
    unhealthyCount: unhealthyChecks.length,
    unhealthyChecks,
  };
}

export function buildMacSyncDescription({
  syncState,
  didPull,
  dryRun,
  restartedDiscordBot,
  restartDiscordBotDeferred,
  restartedRufloWorkerService,
  healthSummary,
}) {
  const parts = [];

  if (dryRun) {
    parts.push('Dry run completed.');
  }

  parts.push(syncState?.summary || 'Sync state evaluated.');

  if (didPull) {
    parts.push('Fast-forward pull applied.');
  }

  if (restartedDiscordBot) {
    parts.push('Discord bot restarted.');
  }

  if (restartDiscordBotDeferred) {
    parts.push('Discord bot restart deferred until completion reporting.');
  }

  if (restartedRufloWorkerService) {
    parts.push('Ruflo worker service restarted.');
  }

  if (healthSummary) {
    if (healthSummary.unhealthyCount > 0) {
      parts.push(`${healthSummary.unhealthyCount} health check${healthSummary.unhealthyCount === 1 ? '' : 's'} still unhealthy.`);
    } else {
      parts.push(`All ${healthSummary.healthyCount} health checks are healthy.`);
    }
  }

  return parts.join(' ');
}
