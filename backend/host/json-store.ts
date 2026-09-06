import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './desktop';
/** Single-writer JSON persistence, compatible with the existing data files. */
export default class JsonStore<T extends object = Record<string, any>> {
  private data: Record<string, any>;
  private readonly path: string;
  private readonly defaults: Record<string, any>;
  constructor(options: { name?: string; cwd?: string; defaults?: T } = {}) {
    const directory = options.cwd || app.getPath('userData');
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, `${options.name || 'config'}.json`);
    this.defaults = structuredClone(options.defaults || {});
    const saved = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : {};
    if (existsSync(this.path) && !existsSync(`${this.path}.pre-tauri.bak`)) copyFileSync(this.path, `${this.path}.pre-tauri.bak`);
    this.data = { ...this.defaults, ...saved };
  }
  get store(): T { return structuredClone(this.data) as T; }
  set store(value: T) { this.data = structuredClone(value); this.persist(); }
  get(key?: string, fallback?: any): any { return key === undefined ? this.store : structuredClone(this.data[key] ?? fallback); }
  set(key: string | Partial<T>, value?: any): void {
    if (typeof key === 'string') this.data[key] = value; else Object.assign(this.data, key);
    this.persist();
  }
  has(key: string): boolean { return Object.hasOwn(this.data, key); }
  delete(key: string): void { delete this.data[key]; this.persist(); }
  clear(): void { this.data = structuredClone(this.defaults); this.persist(); }
  private persist(): void {
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
