import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function fetchJsonWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultProcessListProvider() {
  if (process.platform === 'win32') return '';
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command=']);
  return stdout;
}

export async function inspectProductVideoResourceAvailability(config, options = {}) {
  const reasons = [];
  const endpoint = new URL(config.script.endpoint);
  if (!['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
    reasons.push('ollama_endpoint_not_local');
  } else {
    try {
      const statusUrl = new URL('/api/ps', endpoint);
      const payload = await fetchJsonWithTimeout(
        options.fetchImpl || globalThis.fetch,
        statusUrl.toString(),
        options.timeoutMs || 5_000,
      );
      const loadedModels = (payload.models || []).map((model) => model.name || model.model).filter(Boolean);
      if (loadedModels.length > 0) reasons.push(`ollama_models_loaded=${loadedModels.join(',')}`);
    } catch (error) {
      reasons.push(`ollama_ps_unavailable=${error.message}`);
    }
  }

  try {
    const processList = await (options.processListProvider || defaultProcessListProvider)();
    const patterns = config.runtime_safety.conflicting_process_patterns;
    const activePatterns = patterns.filter((pattern) => processList.toLowerCase().includes(pattern.toLowerCase()));
    if (activePatterns.length > 0) reasons.push(`conflicting_processes=${activePatterns.join(',')}`);
  } catch (error) {
    reasons.push(`process_check_unavailable=${error.message}`);
  }

  return {
    status: reasons.length === 0 ? 'ready' : 'deferred',
    reasons,
    retry_after_minutes: config.runtime_safety.defer_minutes,
    checked_at: options.checkedAt || new Date().toISOString(),
  };
}

export async function assertProductVideoResourcesAvailable(config, options = {}) {
  const report = await inspectProductVideoResourceAvailability(config, options);
  if (report.status !== 'ready') {
    const error = new Error(`[RUNTIME_RESOURCE_BUSY] O.R.I.O.N. resource preflight deferred: ${report.reasons.join('; ')}`);
    error.code = 'RUNTIME_RESOURCE_BUSY';
    error.report = report;
    throw error;
  }
  return report;
}
