#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.ruv.ruflo.product-video-schedule';
const DEFAULT_HOURS = [1, 13, 17, 21];

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getHours() {
  const raw = getArgValue('--hours');
  const values = raw ? raw.split(',').map(Number) : DEFAULT_HOURS;
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 23)) {
    throw new Error('--hours expects comma-separated hours between 0 and 23.');
  }
  return [...new Set(values)].sort((left, right) => left - right);
}

function getMinute() {
  const value = Number(getArgValue('--minute') || 0);
  if (!Number.isInteger(value) || value < 0 || value > 59) {
    throw new Error('--minute expects an integer between 0 and 59.');
  }
  return value;
}

function scheduleEntries(hours, minute) {
  return hours.map((hour) => `  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>`).join('\n');
}

function buildPlist({ nodePath, scriptPath, stdoutPath, stderrPath, hours, minute }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${scheduleEntries(hours, minute)}
  </array>
  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>
  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>
</dict>
</plist>
`;
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('O.R.I.O.N. schedule installation is supported only on macOS.');
  }
  const config = loadRuntimeConfig();
  const hours = getHours();
  const minute = getMinute();
  const launchAgentsDirectory = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDirectory, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'product-video-schedule.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'product-video-schedule.stderr.log');
  mkdirSync(launchAgentsDirectory, { recursive: true });
  if (!existsSync(dirname(stdoutPath))) mkdirSync(dirname(stdoutPath), { recursive: true });
  writeFileSync(plistPath, buildPlist({
    nodePath: process.execPath,
    scriptPath: resolve(projectRoot, 'scripts', 'run-scheduled-product-video.mjs'),
    stdoutPath,
    stderrPath,
    hours,
    minute,
  }), 'utf8');

  if (!hasFlag('--no-load')) {
    try {
      execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    } catch {
      // Already unloaded.
    }
    execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Schedule: ${hours.map((hour) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).join(', ')} local time.`,
    'Busy checks defer work to a later scheduled window.',
    `Load state: ${hasFlag('--no-load') ? 'written only' : 'loaded'}.`,
  ].join('\n'));
}

main();
