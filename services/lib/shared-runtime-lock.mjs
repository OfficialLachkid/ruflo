import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const DEFAULT_STALE_MS = 6 * 60 * 60 * 1_000;

export class RuntimeResourceBusyError extends Error {
  constructor(message, lock = null) {
    super(message);
    this.name = 'RuntimeResourceBusyError';
    this.code = 'RUNTIME_RESOURCE_BUSY';
    this.lock = lock;
  }
}

export function resolveSharedRuntimeLockPath(options = {}) {
  const directory = options.lockDirectory
    || process.env.RUFLO_SHARED_LOCK_DIR
    || resolve(homedir(), 'Library', 'Application Support', 'Ruflo', 'locks');
  return resolve(directory, `${options.resource || 'local-ai-heavy'}.lock`);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function readLock(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

async function reclaimIfStale(lockPath, staleMs) {
  const [lock, lockStat] = await Promise.all([readLock(lockPath), stat(lockPath)]);
  const processGone = lock?.pid && !isProcessAlive(Number(lock.pid));
  const expired = Date.now() - lockStat.mtimeMs > staleMs;
  if (processGone || expired) {
    await rm(lockPath, { force: true });
    return true;
  }
  throw new RuntimeResourceBusyError(
    `[RUNTIME_RESOURCE_BUSY] Shared runtime resource is held by ${lock?.owner || 'another job'}.`,
    lock,
  );
}

async function acquireLock(lockPath, options) {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    return await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await reclaimIfStale(lockPath, options.staleMs || DEFAULT_STALE_MS);
    return open(lockPath, 'wx');
  }
}

export async function withSharedRuntimeLock(options, operation) {
  const lockPath = resolveSharedRuntimeLockPath(options);
  const handle = await acquireLock(lockPath, options);
  const record = {
    resource: options.resource || 'local-ai-heavy',
    owner: options.owner || 'unknown-job',
    pid: process.pid,
    started_at: new Date().toISOString(),
  };
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    return await operation({ lockPath, record });
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
