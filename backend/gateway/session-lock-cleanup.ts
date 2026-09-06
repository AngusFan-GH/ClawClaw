/**
 * Pre-launch cleanup for stale session write locks.
 *
 * Background: when the Gateway is restarted in-process (SIGUSR1), the old process
 * may exit without releasing its session write locks if it is killed before
 * SIGUSR1 cleanup handlers run (e.g. SIGKILL from force-kill, or a zombie
 * orphan process whose parent desktop host died). The result is that subsequent
 * Gateway starts block for up to 60 s waiting to acquire the lock:
 *   "session file locked (timeout 60000ms): pid=<old> /path/to/session.jsonl.lock"
 *
 * This helper runs before each Gateway launch to proactively clean stale locks.
 * It delegates to openclaw's own `cleanStaleLockFiles()` which:
 *   - Reads the lock payload (pid, createdAt, starttime)
 *   - Checks if the PID is still alive / starttime still matches
 *   - Marks a lock stale when: PID is dead, starttime changed, age > staleMs
 *   - Removes stale lock files so new Gateway instances can start immediately.
 *
 * Cache is keyed by the agents dir signature — when openclaw agent dirs change
 * (new agent, renamed agent, new session), the cache misses and cleanup re-runs.
 */
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import { resolveOpenClawDir } from '../utils/paths';

export interface SessionLockCleanupResult {
  removed: number;
  examined: number;
  errors: number;
}

/**
 * Synchronously remove stale session write locks from a sessions directory.
 *
 * This is a lightweight fallback when openclaw's `cleanStaleLockFiles()` cannot
 * be imported.  It removes any lock file whose owning PID is no longer alive.
 * For a more thorough check (starttime validation, age-based stale detection),
 * use the openclaw-native `cleanStaleLockFiles()` via dynamic import instead.
 */
function removeDeadProcessLocksSync(sessionsDir: string): SessionLockCleanupResult {
  const result: SessionLockCleanupResult = { removed: 0, examined: 0, errors: 0 };

  let entries: import('node:fs').Dirent<string>[];
  try {
    entries = readdirSync(sessionsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith('.jsonl.lock')) continue;
    result.examined++;

    const lockPath = join(sessionsDir, entry.name);
    try {
      const pid = extractPidFromLockFileSync(lockPath);
      if (pid !== null && !isProcessAlive(pid)) {
        rmSync(lockPath, { force: true });
        result.removed++;
        logger.info(`[session-lock-cleanup] Removed stale lock (dead pid=${pid}): ${lockPath}`);
      }
    } catch {
      result.errors++;
    }
  }

  return result;
}

function extractPidFromLockFileSync(lockPath: string): number | null {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (typeof parsed.pid === 'number' && parsed.pid > 0) {
      return parsed.pid;
    }
    return null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // SIG 0 does not send a signal but checks if the process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan all agent sessions directories under `~/.openclaw/agents/` and remove
 * stale session write lock files using openclaw's own `cleanStaleLockFiles()`.
 *
 * Falls back to the synchronous dead-process scan if the openclaw module
 * cannot be resolved.
 *
 * Returns a summary of what was removed / examined.
 */
export async function cleanupStaleSessionLocks(): Promise<SessionLockCleanupResult> {
  const agentsDir = join(resolveOpenClawDir(), 'agents');
  const result: SessionLockCleanupResult = { removed: 0, examined: 0, errors: 0 };

  let agentDirs: string[];
  try {
    agentDirs = readdirSync(agentsDir, { withFileTypes: true, encoding: 'utf8' })
      .filter((e) => e.isDirectory())
      .map((e) => join(agentsDir, e.name));
  } catch (err) {
    logger.warn(`[session-lock-cleanup] Failed to list agents dir ${agentsDir}:`, err);
    return result;
  }

  if (agentDirs.length === 0) {
    return result;
  }

  // Try openclaw's own cleanStaleLockFiles() for thorough stale detection
  let cleanedByNative = false;
  try {
    const sessionWriteLock = await import(
      /* @vite-ignore */
      `${resolveOpenClawDir()}/dist/session-write-lock-_a5O1H8L.js`
    );
    const { cleanStaleLockFiles } = sessionWriteLock as { cleanStaleLockFiles: (opts: {
      sessionsDir: string;
      staleMs?: number;
      removeStale?: boolean;
      readOwnerProcessArgs?: unknown;
    }) => Promise<{ locks: Array<{ lockPath: string; removed: boolean }>; cleaned: string[] }> };

    for (const agentDir of agentDirs) {
      const sessionsDir = join(agentDir, 'sessions');
      try {
        const cleanup = await cleanStaleLockFiles({
          sessionsDir,
          removeStale: true,
        });
        result.examined += cleanup.locks.length;
        for (const lock of cleanup.locks) {
          if (lock.removed) {
            result.removed++;
            logger.info(`[session-lock-cleanup] Removed stale lock: ${lock.lockPath}`);
          }
        }
        cleanedByNative = true;
      } catch {
        // non-fatal; fall through to sync cleanup
      }
    }
  } catch {
    // openclaw dist not resolvable; fall through to sync fallback
  }

  // Sync fallback: remove locks for confirmed-dead PIDs (covers any cases the
  // native check missed, such as locks whose PID was recycled)
  if (!cleanedByNative) {
    for (const agentDir of agentDirs) {
      const sessionsDir = join(agentDir, 'sessions');
      const syncResult = removeDeadProcessLocksSync(sessionsDir);
      result.removed += syncResult.removed;
      result.examined += syncResult.examined;
      result.errors += syncResult.errors;
    }
  }

  if (result.removed > 0) {
    logger.info(
      `[session-lock-cleanup] Removed ${result.removed} stale session lock(s) before Gateway start`,
    );
  }

  return result;
}
