/**
 * Local skill library.
 *
 * Catalog sources are exactly two trusted roots: the read-only bundled skills
 * shipped with the app, and a user-controlled local install directory. There is
 * no remote marketplace. Installation COPIES content into app data after
 * validating the manifest and rejecting symlinks/path escape; uninstalling a
 * bundled skill is forbidden (it can only be disabled).
 */
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { resourcesPath } from '../host/desktop';
import type { CoreDatabase } from './db/database';
import { fail } from './errors';
import { isInside } from './fs-secure';
import type { SkillInstruction } from './context/planner';
import { isoNow } from './util';

export interface SkillManifest {
  slug: string;
  name: string;
  description: string;
  version: string;
  tools: string[];
  configSchema: Record<string, unknown> | null;
  instruction: string;
}

export interface SkillView {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  source: 'bundled' | 'local';
  enabled: boolean;
  installedOnDisk: boolean;
  tools: string[];
  configurable: boolean;
  config: Record<string, unknown>;
}

interface OverrideRow {
  slug: string;
  enabled: number;
  config_json: string;
  installed: number;
}

const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class CoreSkillStore {
  readonly bundledRoot: string;
  readonly installedRoot: string;

  constructor(private readonly ctx: CoreDatabase, dataDir: string, bundledRoot = join(resourcesPath, 'skills')) {
    this.bundledRoot = bundledRoot;
    this.installedRoot = join(dataDir, 'skills');
    mkdirSync(this.installedRoot, { recursive: true });
  }

  private get db() {
    return this.ctx.db;
  }

  private overrides(workspaceId: string): Map<string, OverrideRow> {
    const rows = this.db.prepare('SELECT slug,enabled,config_json,installed FROM core_skill WHERE workspace_id=?').all(workspaceId) as unknown as OverrideRow[];
    return new Map(rows.map(r => [r.slug, r]));
  }

  list(workspaceId = 'default'): SkillView[] {
    const overrides = this.overrides(workspaceId);
    const bundled = listSlugs(this.bundledRoot).map(slug => this.viewFor(slug, 'bundled', overrides));
    const local = listSlugs(this.installedRoot)
      .filter(slug => !listSlugs(this.bundledRoot).includes(slug))
      .map(slug => this.viewFor(slug, 'local', overrides));
    return [...bundled, ...local];
  }

  search(workspaceId: string, query: string): SkillView[] {
    const needle = query.trim().toLowerCase();
    const all = this.list(workspaceId);
    if (!needle) return all;
    return all.filter(s => `${s.name} ${s.description} ${s.slug}`.toLowerCase().includes(needle));
  }

  get(workspaceId: string, slug: string): SkillView | undefined {
    const source = this.sourceOf(slug);
    if (!source) return undefined;
    return this.viewFor(slug, source, this.overrides(workspaceId));
  }

  require(workspaceId: string, slug: string): SkillView {
    return this.get(workspaceId, slug) ?? fail('SKILL_NOT_FOUND', 'The skill is not installed');
  }

  /** Enabled skill instructions actually injected into the context plan. */
  enabledInstructions(workspaceId: string): SkillInstruction[] {
    return this.list(workspaceId)
      .filter(s => s.enabled)
      .map(s => {
        const manifest = this.readManifest(s.slug);
        return { id: s.slug, name: manifest?.name ?? s.name, instruction: manifest?.instruction ?? s.description };
      })
      .filter(s => s.instruction.trim().length > 0);
  }

  /** Install (copy) a bundled skill into the user directory. */
  install(workspaceId: string, slug: string): SkillView {
    if (!SLUG_RE.test(slug)) fail('INVALID_ARGUMENT', 'Invalid skill id');
    const source = join(this.bundledRoot, slug);
    if (!isInside(this.bundledRoot, source) || !statSafe(source)?.isDirectory()) {
      fail('SKILL_NOT_FOUND', 'This local catalog does not contain the requested skill');
    }
    return this.installFromDirectory(workspaceId, slug, source);
  }

  /** Install from a user-picked local directory (dialog result). */
  installFromPath(workspaceId: string, sourcePath: string): SkillView {
    const stat = statSafe(sourcePath);
    if (!stat?.isDirectory() || lstatSafe(sourcePath)?.isSymbolicLink()) fail('SKILL_PATH_ESCAPE', 'Skill source must be a real directory');
    const manifest = readManifestFrom(sourcePath) ?? fail('SKILL_INVALID_MANIFEST', 'The folder does not contain a valid SKILL.md');
    const slug = manifest.slug;
    return this.installFromDirectory(workspaceId, slug, sourcePath);
  }

  private installFromDirectory(workspaceId: string, slug: string, source: string): SkillView {
    const manifest = readManifestFrom(source) ?? fail('SKILL_INVALID_MANIFEST', 'The skill manifest is invalid');
    if (!SLUG_RE.test(slug) || manifest.slug !== slug) fail('SKILL_INVALID_MANIFEST', 'Skill id is invalid');
    assertNoSymlinkEscape(source);
    const target = join(this.installedRoot, slug);
    rmSync(target, { recursive: true, force: true });
    copyTreeLimited(source, target);
    const ts = isoNow();
    this.db.prepare(`INSERT INTO core_skill (id,workspace_id,slug,enabled,config_json,installed,installed_path,created_at,updated_at)
      VALUES (?,?,?,1,'{}',1,?,?,?)
      ON CONFLICT(workspace_id,slug) DO UPDATE SET installed=1, updated_at=excluded.updated_at`)
      .run(`${workspaceId}:${slug}`, workspaceId, slug, target, ts, ts);
    return this.require(workspaceId, slug);
  }

  uninstall(workspaceId: string, slug: string): void {
    const source = this.sourceOf(slug);
    if (!source) fail('SKILL_NOT_FOUND', 'The skill is not installed');
    if (source === 'bundled') fail('SKILL_BUNDLED_PROTECTED', 'Bundled skills can be disabled but not removed');
    const target = join(this.installedRoot, slug);
    if (isInside(this.installedRoot, target)) rmSync(target, { recursive: true, force: true });
    this.db.prepare('DELETE FROM core_skill WHERE workspace_id=? AND slug=?').run(workspaceId, slug);
  }

  setEnabled(workspaceId: string, slug: string, enabled: boolean): SkillView {
    this.require(workspaceId, slug);
    const ts = isoNow();
    this.db.prepare(`INSERT INTO core_skill (id,workspace_id,slug,enabled,config_json,installed,installed_path,created_at,updated_at)
      VALUES (?,?,?,?,'{}',0,NULL,?,?)
      ON CONFLICT(workspace_id,slug) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at`)
      .run(`${workspaceId}:${slug}`, workspaceId, slug, enabled ? 1 : 0, ts, ts);
    return this.require(workspaceId, slug);
  }

  configure(workspaceId: string, slug: string, config: Record<string, unknown>): SkillView {
    this.require(workspaceId, slug);
    if (typeof config !== 'object' || config === null) fail('INVALID_ARGUMENT', 'Skill config must be an object');
    const ts = isoNow();
    this.db.prepare(`INSERT INTO core_skill (id,workspace_id,slug,enabled,config_json,installed,installed_path,created_at,updated_at)
      VALUES (?,?,?,1,?,0,NULL,?,?)
      ON CONFLICT(workspace_id,slug) DO UPDATE SET config_json=excluded.config_json, updated_at=excluded.updated_at`)
      .run(`${workspaceId}:${slug}`, workspaceId, slug, JSON.stringify(config), ts, ts);
    return this.require(workspaceId, slug);
  }

  private sourceOf(slug: string): 'bundled' | 'local' | undefined {
    if (statSafe(join(this.bundledRoot, slug))?.isDirectory()) return 'bundled';
    if (statSafe(join(this.installedRoot, slug))?.isDirectory()) return 'local';
    return undefined;
  }

  private readManifest(slug: string): SkillManifest | undefined {
    const source = this.sourceOf(slug);
    const root = source === 'bundled' ? this.bundledRoot : this.installedRoot;
    return readManifestFrom(join(root, slug));
  }

  private viewFor(slug: string, source: 'bundled' | 'local', overrides: Map<string, OverrideRow>): SkillView {
    const manifest = this.readManifest(slug) ?? {
      slug, name: slug, description: '', version: '0.0.0', tools: [], configSchema: null, instruction: '',
    };
    const override = overrides.get(slug);
    return {
      id: slug,
      slug,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      source,
      enabled: override ? override.enabled === 1 : true,
      installedOnDisk: true,
      tools: manifest.tools,
      configurable: Boolean(manifest.configSchema),
      config: override ? safeJson(override.config_json) : {},
    };
  }
}

function listSlugs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && SLUG_RE.test(d.name)).map(d => d.name).sort();
  } catch {
    return [];
  }
}

function statSafe(path: string) {
  try { return statSync(path); } catch { return undefined; }
}
function lstatSafe(path: string) {
  try { return lstatSync(path); } catch { return undefined; }
}

function readManifestFrom(dir: string): SkillManifest | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  } catch {
    return undefined;
  }
  const slug = dir.split(sep).pop() ?? '';
  const parsed = parseSkillMarkdown(raw, slug);
  if (!parsed.name || !parsed.instruction.trim()) return undefined;
  return parsed;
}

/** Minimal, safe frontmatter parser (no YAML dependency / code execution). */
function parseSkillMarkdown(raw: string, slug: string): SkillManifest {
  let frontmatter: Record<string, string> = {};
  const tools: string[] = [];
  let body = raw;
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (match) {
    let listKey = '';
    for (const line of match[1].split(/\r?\n/)) {
      const listItem = /^\s*-\s+(.+)$/.exec(line);
      if (listItem && listKey) { tools.push(listItem[1].trim()); continue; }
      const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (kv) {
        const key = kv[1].trim();
        const value = stripQuotes(kv[2].trim());
        if (key === 'tools') { listKey = 'tools'; continue; }
        listKey = '';
        if (value) frontmatter[key] = value;
      }
    }
    body = match[2];
  }
  const title = frontmatter.name ?? raw.match(/^#\s+(.+)$/m)?.[1] ?? slug;
  const description = frontmatter.description ?? body.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() ?? '';
  let configSchema: Record<string, unknown> | null = null;
  if (frontmatter.configSchema) {
    try { const candidate = JSON.parse(frontmatter.configSchema); if (candidate && typeof candidate === 'object') configSchema = candidate as Record<string, unknown>; } catch { /* ignore */ }
  }
  return {
    slug: frontmatter.id || slug,
    name: title,
    description,
    version: frontmatter.version || '0.0.0',
    tools,
    configSchema,
    instruction: body.trim(),
  };
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

function safeJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as unknown as Record<string, unknown>; } catch { return {}; }
}

/** Reject any symlink under `root` that resolves outside it. */
function assertNoSymlinkEscape(root: string): void {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    for (const name of readdirSync(dir)) {
      if (++seen > MAX_FILES) fail('SKILL_INVALID_MANIFEST', 'Skill contains too many files');
      const full = join(dir, name);
      const st = lstatSafe(full);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        const real = resolve(full);
        if (!isInside(root, real)) fail('SKILL_PATH_ESCAPE', 'A skill symlink escapes its directory');
      } else if (st.isDirectory()) {
        stack.push(full);
      }
    }
  }
}

function copyTreeLimited(source: string, target: string): void {
  let bytes = 0;
  const walk = (from: string, to: string, depth: number): void => {
    if (depth > 12) fail('SKILL_INVALID_MANIFEST', 'Skill directory is too deep');
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      const src = join(from, name);
      const dest = join(to, name);
      const st = lstatSync(src);
      if (st.isSymbolicLink()) fail('SKILL_PATH_ESCAPE', 'Symlinks are not allowed in skills');
      if (st.isDirectory()) { walk(src, dest, depth + 1); continue; }
      if (!st.isFile()) fail('SKILL_INVALID_MANIFEST', 'Unsupported file type in skill');
      bytes += st.size;
      if (bytes > MAX_TOTAL_BYTES) fail('SKILL_INVALID_MANIFEST', 'Skill exceeds the size limit');
      cpSync(src, dest, { force: true });
    }
  };
  walk(source, target, 0);
}
