import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app } from '../host/desktop';

const require = createRequire(import.meta.url); const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
export type CoreSkill = { id: string; slug: string; name: string; description: string; enabled: boolean; installedOnDisk: boolean; isBundled: boolean; sourcePath?: string };
function metadata(path: string, slug: string) { try { const raw = readFileSync(join(path, 'SKILL.md'), 'utf8'); const title = raw.match(/^#\s+(.+)$/m)?.[1] || slug; const description = raw.split('\n').find(x => x.trim() && !x.startsWith('#'))?.trim() || ''; return { name: title, description }; } catch { return { name: slug, description: '' }; } }
export class CoreSkillStore {
  private readonly db: InstanceType<typeof DatabaseSync>; private readonly bundled: string; private readonly installed: string;
  constructor(file = join(app.getPath('userData'), 'clawcore.sqlite')) { this.db = new DatabaseSync(file); this.db.exec('CREATE TABLE IF NOT EXISTS core_skills (id TEXT PRIMARY KEY, data_json TEXT NOT NULL) STRICT;'); this.bundled = join(process.env.CLAWCLAW_APP_ROOT || process.cwd(), 'resources', 'skills'); this.installed = join(app.getPath('userData'), 'skills'); }
  list(): CoreSkill[] { const stored = (this.db.prepare('SELECT data_json FROM core_skills').all() as { data_json: string }[]).map(x => JSON.parse(x.data_json) as CoreSkill); const overrides = new Map(stored.map(x => [x.id, x])); const folders = existsSync(this.bundled) ? readdirSync(this.bundled, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name) : []; const bundled: CoreSkill[] = folders.map(slug => { const path = join(this.bundled, slug); return { id: slug, slug, ...metadata(path, slug), enabled: overrides.get(slug)?.enabled ?? true, installedOnDisk: true, isBundled: true, sourcePath: path }; }); return [...bundled, ...stored.filter(x => !folders.includes(x.id))]; }
  search(query: string): CoreSkill[] { const needle = query.toLowerCase(); return this.list().filter(x => `${x.name} ${x.description} ${x.slug}`.toLowerCase().includes(needle)); }
  setEnabled(id: string, enabled: boolean): CoreSkill { const current = this.list().find(x => x.id === id); if (!current) throw new Error('Skill not found'); const next = { ...current, enabled }; this.db.prepare('INSERT INTO core_skills VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(id, JSON.stringify(next)); return next; }
  install(slug: string): CoreSkill { const source = join(this.bundled, slug); if (!existsSync(source)) throw new Error('This local catalog does not contain the requested skill'); cpSync(source, join(this.installed, slug), { recursive: true, force: true }); return this.setEnabled(slug, true); }
  uninstall(slug: string): void { const target = join(this.installed, slug); if (existsSync(target)) rmSync(target, { recursive: true, force: true }); this.db.prepare('DELETE FROM core_skills WHERE id=?').run(slug); }
  close() { this.db.close(); }
}
