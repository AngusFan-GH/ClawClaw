/**
 * Caches the results of expensive pre-launch maintenance tasks so they are
 * skipped on subsequent starts when the relevant filesystem state has not changed.
 *
 * Cache is keyed by a stable signature of the triggering filesystem paths.
 * If the signature changes (mtime, size, or directory contents), the task
 * re-executes and the cache is updated.
 *
 * Stored at: `app.getPath('userData')/gateway-prelaunch-maintenance-cache.json`
 *
 * Three tasks are cached:
 *   - plugin-maintenance    signature of ~/.openclaw/extensions/
 *   - runtime-deps-cleanup  signature of the current openclaw package
 *   - skills-symlink-cleanup signature of skills dirs
 */
import { app } from 'electron';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const CACHE_SCHEMA_VERSION = 1;
const CACHE_FILE_NAME = 'gateway-prelaunch-maintenance-cache.json';

export type PrelaunchMaintenanceTaskName =
  | 'plugin-maintenance'
  | 'runtime-deps-cleanup'
  | 'skills-symlink-cleanup'
  | 'stale-session-lock-cleanup';

export interface PrelaunchMaintenanceRunResult {
  executed: boolean;
  reason: 'cache-hit' | 'cache-miss' | 'cache-unavailable' | 'task-failed';
}

type CacheKeyInput = string | (() => string);
type MaintenanceTask = () => void | boolean;

interface CacheEntry {
  key: string;
  updatedAt: string;
}

interface CacheFile {
  schemaVersion: number;
  tasks: Partial<Record<PrelaunchMaintenanceTaskName, CacheEntry>>;
}

function getDefaultCachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE_NAME);
}

function emptyCache(): CacheFile {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    tasks: {},
  };
}

function readCache(cachePath: string): CacheFile | null {
  try {
    if (!existsSync(cachePath)) return emptyCache();
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as CacheFile;
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !parsed.tasks) {
      return emptyCache();
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cachePath: string, cache: CacheFile): boolean {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** Stable JSON serialization (key ordering deterministic) for cache key generation. */
export function stableJson(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Signature of a single path: `"dir|file:mtimems:size"` or `"missing"`.
 * Used as a cache key component for path-level changes.
 */
export function pathSignature(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.isDirectory() ? 'dir' : 'file'}:${Math.round(stat.mtimeMs)}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

/**
 * Stable signature of a directory's top-level entries (sorted).
 * Used as a cache key component for directory content changes.
 */
export function directoryChildrenSignature(path: string, maxEntries = 200): string {
  try {
    const entries = readdirSync(path, { withFileTypes: true, encoding: 'utf8' })
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, maxEntries)
      .map((entry) => {
        const childPath = join(path, entry.name);
        return [
          entry.name,
          entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'symlink' : 'file',
          pathSignature(childPath),
        ].join(':');
      });
    return stableJson(entries);
  } catch {
    return 'missing';
  }
}

/**
 * Build a stable JSON cache key from multiple parts.
 * Schema version is included so a version bump invalidates all entries.
 */
export function buildPrelaunchMaintenanceCacheKey(parts: Record<string, unknown>): string {
  return stableJson({
    schemaVersion: CACHE_SCHEMA_VERSION,
    ...parts,
  });
}

/**
 * Run a pre-launch maintenance task, caching the result keyed by a stable
 * filesystem signature.  Subsequent calls with the same key (same filesystem state)
 * return `{ executed: false, reason: 'cache-hit' }` without re-running the task.
 *
 * @param taskName     Identifier for the task (used as cache key)
 * @param cacheKey     Either a string key or a thunk that computes it
 * @param task         The work to perform if the cache is stale
 * @param options.cachePath Override the default cache file path (for tests)
 */
export function runCachedPrelaunchMaintenanceTask(
  taskName: PrelaunchMaintenanceTaskName,
  cacheKey: CacheKeyInput,
  task: MaintenanceTask,
  options: { cachePath?: string } = {},
): PrelaunchMaintenanceRunResult {
  const readCacheKey = (): string => (typeof cacheKey === 'function' ? cacheKey() : cacheKey);
  const cachePath = options.cachePath ?? getDefaultCachePath();
  const cache = readCache(cachePath);
  if (!cache) {
    task();
    return { executed: true, reason: 'cache-unavailable' };
  }

  let initialCacheKey: string;
  try {
    initialCacheKey = readCacheKey();
  } catch {
    task();
    return { executed: true, reason: 'cache-unavailable' };
  }

  if (cache.tasks[taskName]?.key === initialCacheKey) {
    return { executed: false, reason: 'cache-hit' };
  }

  const taskResult = task();
  if (taskResult === false) {
    return { executed: true, reason: 'task-failed' };
  }

  let finalCacheKey: string;
  try {
    finalCacheKey = readCacheKey();
  } catch {
    return { executed: true, reason: 'cache-unavailable' };
  }

  cache.tasks[taskName] = {
    key: finalCacheKey,
    updatedAt: new Date().toISOString(),
  };
  writeCache(cachePath, cache);
  return { executed: true, reason: 'cache-miss' };
}