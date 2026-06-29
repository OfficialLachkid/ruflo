#!/usr/bin/env node

import { argv } from 'node:process';
import { loadRuntimeConfig, parseJsonFromString, readJsonInput, readStdin } from '../lib/runtime-config.mjs';

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
    throw new Error('No transcription payload provided. Use --input-file <path> or pipe JSON to stdin.');
  }

  return parseJsonFromString(stdinText);
}

function processTranscriptionRequest(payload, config) {
  const transcript = String(payload.mockTranscript || payload.transcript || '').trim();
  if (transcript) {
    return {
      status: 'completed',
      provider: config.transcription.provider,
      transcript,
      confidence: payload.confidence ?? 0.86,
      warnings: [],
      normalizedAttachmentMetadata: payload.attachments || [],
    };
  }

  return {
    status: 'blocked',
    provider: config.transcription.provider,
    transcript: '',
    confidence: 0,
    warnings: [
      'Local transcription integration is not wired yet.',
      'Use a mock transcript for text-first workflow validation or finish the faster-whisper integration on the Mac.',
    ],
    normalizedAttachmentMetadata: payload.attachments || [],
  };
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node services/transcription-worker/index.mjs [--input-file path]',
      '',
      'Reads a voice-note transcription request payload and returns a phase-1 transcript contract.',
    ].join('\n'));
    return;
  }

  const payload = await loadPayload();
  const config = loadRuntimeConfig();
  const result = processTranscriptionRequest(payload, config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
