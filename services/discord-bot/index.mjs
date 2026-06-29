#!/usr/bin/env node

import { argv } from 'node:process';
import { loadRuntimeConfig, parseJsonFromString, readJsonInput, readStdin } from '../lib/runtime-config.mjs';
import { processDiscordEvent } from './src/intake.mjs';

function getArgValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return argv[index + 1] || '';
}

function hasFlag(flag) {
  return argv.includes(flag);
}

async function loadPayload() {
  const inputFile = getArgValue('--input-file');
  if (inputFile) {
    return readJsonInput(inputFile);
  }

  const stdinText = await readStdin();
  if (!stdinText.trim()) {
    throw new Error('No JSON input provided. Use --input-file <path> or pipe JSON to stdin.');
  }

  return parseJsonFromString(stdinText);
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node services/discord-bot/index.mjs [--input-file path] [--live]',
      '',
      'Use --live to connect to the Discord gateway with the runtime config under config/discord/.env.',
      'Without --live, reads a Discord-style event payload and emits the phase-1 routing result for commands, approvals, or voice note intake.',
    ].join('\n'));
    return;
  }

  const config = loadRuntimeConfig();

  if (hasFlag('--live')) {
    const { runLiveDiscordBot } = await import('./src/live-runtime.mjs');
    await runLiveDiscordBot(config);
    return;
  }

  const payload = await loadPayload();
  const result = processDiscordEvent(payload, config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
