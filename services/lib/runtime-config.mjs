import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(currentDir, '..', '..');

function splitCsv(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDotEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf8');
  const entries = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  return entries;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolveConfigPath(relativePathWithoutExample, exampleRelativePath) {
  const preferredPath = resolve(projectRoot, relativePathWithoutExample);
  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  return resolve(projectRoot, exampleRelativePath);
}

function resolveEnvFilePath(explicitPath) {
  if (explicitPath) {
    return resolve(projectRoot, explicitPath);
  }

  const primary = resolve(projectRoot, 'config/discord/.env');
  if (existsSync(primary)) {
    return primary;
  }

  return resolve(projectRoot, 'config/discord/.env.example');
}

function substituteEnvPlaceholders(value, env) {
  if (typeof value !== 'string') {
    return value;
  }

  if (env[value]) {
    return env[value];
  }

  return value;
}

export function loadRuntimeConfig(options = {}) {
  const envFilePath = resolveEnvFilePath(options.envFilePath);
  const env = {
    ...parseDotEnvFile(envFilePath),
    ...process.env,
  };

  const channelMapPath = resolveConfigPath('config/discord/channel-map.json', 'config/discord/channel-map.example.json');
  const approvalRulesPath = resolveConfigPath('config/discord/approval-rules.json', 'config/discord/approval-rules.example.json');
  const memoryNamespacesPath = resolve(projectRoot, 'config/runtime/memory-namespaces.json');
  const memoryPromotionRulesPath = resolve(projectRoot, 'config/runtime/memory-promotion-rules.json');

  const channelMap = readJson(channelMapPath);
  const channelIds = Object.fromEntries(
    Object.entries(channelMap.channels || {}).map(([key, value]) => [key, substituteEnvPlaceholders(value, env)])
  );

  return {
    env,
    operatorRoleId: env.DISCORD_OPERATOR_ROLE_ID || '',
    operatorUserIds: splitCsv(env.DISCORD_OPERATOR_USER_IDS || env.DISCORD_ALLOWED_OPERATOR_USER_IDS || ''),
    guildId: substituteEnvPlaceholders(channelMap.guildId, env),
    channelIds,
    approvalRules: readJson(approvalRulesPath),
    memoryNamespaces: readJson(memoryNamespacesPath),
    memoryPromotionRules: readJson(memoryPromotionRulesPath),
    runtimePaths: {
      tmpDir: env.RUNTIME_TMP_DIR || resolve(projectRoot, 'data', 'runtime', 'tmp'),
      logDir: env.RUNTIME_LOG_DIR || resolve(projectRoot, 'data', 'runtime', 'logs'),
    },
    transcription: {
      provider: env.TRANSCRIPTION_PROVIDER || 'local',
      whisperModel: env.WHISPER_MODEL || 'medium',
    },
  };
}

export function readJsonInput(filePath) {
  const absolutePath = resolve(projectRoot, filePath);
  return readJson(absolutePath);
}

export function readStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolvePromise(data));
    process.stdin.on('error', rejectPromise);
  });
}

export function parseJsonFromString(input, fallbackLabel = 'input payload') {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Could not parse ${fallbackLabel} as JSON: ${error.message}`);
  }
}
