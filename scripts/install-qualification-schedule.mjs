#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.ruv.ruflo.qualification-schedule';

function getNumberArg(flag, fallback, maximum) {
  const index = process.argv.indexOf(flag);
  const raw = index === -1 ? '' : process.argv[index + 1];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${flag} expects an integer between 0 and ${maximum}.`);
  }
  return value;
}

function buildPlist({ nodePath, scriptPath, stdoutPath, stderrPath, hour, minute, limit }) {
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
    <string>--limit</string>
    <string>${limit}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
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
    throw new Error('Qualification schedule installation is supported only on macOS.');
  }
  const config = loadRuntimeConfig();
  const hour = getNumberArg('--hour', 10, 23);
  const minute = getNumberArg('--minute', 30, 59);
  const limit = getNumberArg('--limit', 10, 100);
  const launchAgentsDirectory = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDirectory, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'qualification-schedule.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'qualification-schedule.stderr.log');
  mkdirSync(launchAgentsDirectory, { recursive: true });
  mkdirSync(dirname(stdoutPath), { recursive: true });
  writeFileSync(plistPath, buildPlist({
    nodePath: process.execPath,
    scriptPath: resolve(projectRoot, 'scripts', 'run-lead-qualification.mjs'),
    stdoutPath,
    stderrPath,
    hour,
    minute,
    limit,
  }), 'utf8');

  if (!process.argv.includes('--no-load')) {
    try {
      execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    } catch {
      // Already unloaded.
    }
    execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
  }
  process.stdout.write(`Qualification schedule: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}, limit ${limit}.\n`);
}

main();
