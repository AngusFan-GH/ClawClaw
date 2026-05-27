/**
 * Pre-launch cleanup for stray skill symlinks under OpenClaw skill roots.
 *
 * Background: since openclaw commit 253e159700 ("fix: harden workspace skill
 * path containment"), the Gateway rejects any candidate under a skills root
 * whose realpath escapes that root, logging a noisy
 *   `Skipping escaped skill path outside its configured root.
 *    reason=symlink-escape source=openclaw-managed ...`
 * warning per offending entry on every start.
 *
 * Common offenders are one-shot install scripts that drop symlinks into:
 *   - ~/.openclaw/skills/<name> -> ~/.agents/skills/<name>
 *   - ~/.openclaw/workspace/skills/<name> -> ~/.openclaw/workspace/.agents/skills/<name>
 *   - ~/.openclaw/skills/<name> -> ~/workspace/<repo>/skills/<name>
 *
 * This helper is invoked before each Gateway launch to remove those
 * specific symlinks.  Scope is intentionally narrow:
 *   - source dirs: ~/.openclaw/skills and ~/.openclaw/workspace/skills
 *   - target dirs: anything outside the matching managed skills root
 *
 * Removal uses fs.rmSync({ force: true, recursive: true }) rather than
 * fs.unlinkSync so that directory symlinks and Windows junctions are deleted
 * correctly.  unlinkSync raises EPERM on those on Windows.
 *
 * This is a transitional workaround.  Once openclaw/openclaw#59219 lands and
 * the loader stops rejecting managed-source symlinks whose realpath escapes
 * the managed root, this helper can be removed entirely.
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  type Dirent,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getOpenClawConfigDir, getOpenClawResolvedDir, getOpenClawSkillsDir } from '../utils/paths';
import { logger } from '../utils/logger';

export interface CleanupOptions {
  skillsDir?: string;
  agentsDir?: string;
  workspaceSkillsDir?: string;
  workspaceAgentsDir?: string;
}

export interface CleanupResult {
  removed: string[];
  examined: number;
  failed?: number;
}

export interface PluginRuntimeDepsCleanupOptions {
  runtimeDepsDir?: string;
  currentOpenClawDir?: string;
}

function defaultSkillsDir(): string {
  return getOpenClawSkillsDir();
}

function defaultAgentsDir(): string {
  return path.join(homedir(), '.agents', 'skills');
}

function defaultWorkspaceSkillsDir(): string {
  return path.join(getOpenClawConfigDir(), 'workspace', 'skills');
}

function defaultWorkspaceAgentsDir(): string {
  return path.join(getOpenClawConfigDir(), 'workspace', '.agents', 'skills');
}

function defaultPluginRuntimeDepsDir(): string {
  return path.join(getOpenClawConfigDir(), 'plugin-runtime-deps');
}

function recordCleanupFailure(result: CleanupResult): void {
  result.failed = (result.failed ?? 0) + 1;
}

/**
 * Resolve the agents skills directory to its real path.  When the directory
 * itself does not exist yet (fresh install), fall back to realpath'ing its
 * parent and re-appending the basename.
 */
function resolveAgentsRealRoot(agentsDir: string): string {
  if (existsSync(agentsDir)) {
    try {
      return realpathSync(agentsDir);
    } catch {
      // fall through
    }
  }
  const parent = path.dirname(agentsDir);
  const tail = path.basename(agentsDir);
  if (parent && parent !== agentsDir && existsSync(parent)) {
    try {
      return path.join(realpathSync(parent), tail);
    } catch {
      // fall through
    }
  }
  return path.resolve(agentsDir);
}

function normalizeForCompare(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(normalizeForCompare(parent), normalizeForCompare(child));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveSymlinkTarget(linkPath: string): string | null {
  try {
    const target = readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), target);
  } catch {
    return null;
  }
}

function looksLikeOpenClawPackagePath(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, '/');
  return /\/node_modules(?:\/\.pnpm\/[^/]+\/node_modules)?\/openclaw(?:\/|$)/.test(normalized);
}

function resolveCurrentOpenClawRoots(currentOpenClawDir: string): string[] {
  const roots = new Set<string>([path.resolve(currentOpenClawDir)]);
  try {
    roots.add(realpathSync(currentOpenClawDir));
  } catch {
    // fall through
  }
  return Array.from(roots);
}

/**
 * Remove stale OpenClaw plugin runtime dependency cache roots.
 *
 * After app upgrades or worktree switches, `~/.openclaw/plugin-runtime-deps/openclaw-*`
 * symlink trees can point at an old `node_modules/openclaw` path.  The Gateway may
 * then spend time opening/copying old runtime files during plugin setup, blocking RPC.
 *
 * Scope is narrow: only immediate cache roots named `openclaw-*` are removed, and only
 * when a symlink inside points at an OpenClaw package path outside the current bundled
 * package.  The cache is regenerated by OpenClaw on demand.
 */
export function cleanupStalePluginRuntimeDeps(
  opts: PluginRuntimeDepsCleanupOptions = {},
): CleanupResult {
  const runtimeDepsDir = opts.runtimeDepsDir ?? defaultPluginRuntimeDepsDir();
  const currentRoots = resolveCurrentOpenClawRoots(opts.currentOpenClawDir ?? getOpenClawResolvedDir());
  const result: CleanupResult = { removed: [], examined: 0 };

  if (!existsSync(runtimeDepsDir)) {
    return result;
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(runtimeDepsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch (err) {
    logger.warn(`[plugin-runtime-deps-cleanup] Failed to list ${runtimeDepsDir}:`, err);
    recordCleanupFailure(result);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('openclaw-')) {
      continue;
    }

    const cacheRoot = path.join(runtimeDepsDir, entry.name);
    const { stale, examined } = scanRuntimeDepsRootForStaleOpenClawSymlink(cacheRoot, currentRoots);
    result.examined += examined;
    if (!stale) {
      continue;
    }

    try {
      rmSync(cacheRoot, { force: true, recursive: true });
      result.removed.push(entry.name);
    } catch (err) {
      logger.warn(`[plugin-runtime-deps-cleanup] Failed to remove ${cacheRoot}:`, err);
      recordCleanupFailure(result);
    }
  }

  if (result.removed.length > 0) {
    logger.info(
      `[plugin-runtime-deps-cleanup] Removed stale runtime cache root(s): ${result.removed.join(', ')}`,
    );
  }

  return result;
}

function scanRuntimeDepsRootForStaleOpenClawSymlink(
  cacheRoot: string,
  currentOpenClawRoots: string[],
): { stale: boolean; examined: number } {
  const stack = [cacheRoot];
  let examined = 0;
  const maxEntries = 5000;

  while (stack.length > 0 && examined < maxEntries) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (examined >= maxEntries) break;
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      let isSymlink = entry.isSymbolicLink();
      if (!isSymlink) {
        try {
          isSymlink = lstatSync(entryPath).isSymbolicLink();
        } catch {
          continue;
        }
      }
      if (!isSymlink) continue;

      examined++;
      const target = resolveSymlinkTarget(entryPath);
      if (!target || !looksLikeOpenClawPackagePath(target)) {
        continue;
      }

      const pointsAtCurrentOpenClaw = currentOpenClawRoots.some((root) => isInside(root, target));
      if (!pointsAtCurrentOpenClaw) {
        return { stale: true, examined };
      }
    }
  }

  return { stale: false, examined };
}

function cleanupSkillsDir(skillsDir: string, agentsDir: string): CleanupResult {
  const result: CleanupResult = { removed: [], examined: 0 };
  if (!existsSync(skillsDir)) {
    return result;
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch (err) {
    logger.warn(`[skills-cleanup] Failed to list ${skillsDir}:`, err);
    recordCleanupFailure(result);
    return result;
  }

  const agentsRealRoot = resolveAgentsRealRoot(agentsDir);
  const skillsRealRoot = resolveAgentsRealRoot(skillsDir);

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry.name);

    let isSymlink = entry.isSymbolicLink();
    if (!isSymlink) {
      try {
        isSymlink = lstatSync(entryPath).isSymbolicLink();
      } catch {
        continue;
      }
    }
    if (!isSymlink) continue;

    result.examined++;

    let realTarget: string;
    try {
      realTarget = realpathSync(entryPath);
    } catch {
      continue;
    }

    if (isInside(skillsRealRoot, realTarget)) continue;

    try {
      rmSync(entryPath, { force: true, recursive: true });
      result.removed.push(entry.name);
    } catch (err) {
      logger.warn(`[skills-cleanup] Failed to remove ${entryPath}:`, err);
      recordCleanupFailure(result);
    }
  }

  if (result.removed.length > 0) {
    logger.info(
      `[skills-cleanup] Removed stray skill symlink(s) from ${skillsDir} that escaped ` +
        `managed root ${skillsRealRoot} (workaround for openclaw/openclaw#59219): ` +
        result.removed.join(', '),
    );
  }

  return result;
}

/**
 * Remove stray symlinks under both ~/.openclaw/skills and
 * ~/.openclaw/workspace/skills whose real targets escape the managed root.
 */
export function cleanupAgentsSymlinkedSkills(opts: CleanupOptions = {}): CleanupResult {
  const roots = [
    {
      skillsDir: opts.skillsDir ?? defaultSkillsDir(),
      agentsDir: opts.agentsDir ?? defaultAgentsDir(),
    },
    {
      skillsDir: opts.workspaceSkillsDir ?? defaultWorkspaceSkillsDir(),
      agentsDir: opts.workspaceAgentsDir ?? defaultWorkspaceAgentsDir(),
    },
  ];

  const result: CleanupResult = { removed: [], examined: 0 };
  const seenRoots = new Set<string>();

  for (const root of roots) {
    const rootKey = `${path.resolve(root.skillsDir)}\0${path.resolve(root.agentsDir)}`;
    if (seenRoots.has(rootKey)) continue;
    seenRoots.add(rootKey);

    const rootResult = cleanupSkillsDir(root.skillsDir, root.agentsDir);
    result.removed.push(...rootResult.removed);
    result.examined += rootResult.examined;
    if (rootResult.failed) {
      result.failed = (result.failed ?? 0) + rootResult.failed;
    }
  }

  return result;
}