#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.ruv.ruflo.daemon';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function resolveNpmCliPath() {
  const candidates = [
    resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(dirname(process.execPath), '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(dirname(process.execPath), '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];

  try {
    const npmRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (npmRoot) {
      candidates.push(resolve(npmRoot, 'npm', 'bin', 'npm-cli.js'));
    }
  } catch {
    // Fall back to Node-adjacent candidates.
  }

  const npmCliPath = candidates.find((candidatePath) => existsSync(candidatePath));
  if (!npmCliPath) {
    throw new Error('Could not resolve npm-cli.js for the Ruflo daemon LaunchAgent.');
  }

  return npmCliPath;
}

function buildPlistContent({
  nodePath,
  nodeBinDir,
  npmCliPath,
  launchWorkingDirectory,
  workspaceRoot,
  stdoutPath,
  stderrPath,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${launchWorkingDirectory}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${npmCliPath}</string>
    <string>exec</string>
    <string>--yes</string>
    <string>--package</string>
    <string>@claude-flow/cli@latest</string>
    <string>--</string>
    <string>claude-flow</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
    <string>--quiet</string>
    <string>--workspace</string>
    <string>${workspaceRoot}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>
  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>
</dict>
</plist>
`;
}

function loadLaunchAgent(plistPath) {
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Already unloaded or not present.
  }

  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
}

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-ruflo-daemon-launch-agent.mjs [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.ruv.ruflo.daemon.plist and loads it by default.',
      'The LaunchAgent uses RunAtLoad + KeepAlive so the Ruflo daemon auto-starts and relaunches on exit.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Ruflo daemon LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(projectRoot, '.claude-flow', 'logs', 'supervisor.out.log');
  const stderrPath = resolve(projectRoot, '.claude-flow', 'logs', 'supervisor.err.log');
  const nodePath = process.execPath;
  const nodeBinDir = dirname(nodePath);
  const npmCliPath = resolveNpmCliPath();
  const launchWorkingDirectory = homedir();

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));
  ensureDirectory(config.runtimePaths.logDir);

  writeFileSync(plistPath, buildPlistContent({
    nodePath,
    nodeBinDir,
    npmCliPath,
    launchWorkingDirectory,
    workspaceRoot: projectRoot,
    stdoutPath,
    stderrPath,
  }), 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

main();
