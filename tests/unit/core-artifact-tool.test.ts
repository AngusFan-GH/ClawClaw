// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CoreDatabase } from '@backend/core/db/database';
import { ArtifactStore } from '@backend/core/artifact-store';
import { ToolRegistry } from '@backend/core/tools/registry';
import { sanitizeFileName, safeResolve } from '@backend/core/fs-secure';
import { tempDir } from './helpers/runtime-harness';
import { CoreError } from '@backend/core/errors';

function store() {
  const dataDir = tempDir();
  const db = new CoreDatabase(join(dataDir, 'c.sqlite'));
  return { dataDir, db, artifacts: new ArtifactStore(db, dataDir) };
}

describe('sanitizeFileName', () => {
  it('strips path components and traversal', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a/b\\c.txt')).toBe('c.txt');
    expect(() => sanitizeFileName('..')).toThrow();
  });
  it('rejects reserved and control names', () => {
    expect(() => sanitizeFileName('NUL.exe')).toThrow();
  });
  it('safeResolve blocks escape', () => {
    const root = join(tempDir(), 'root');
    mkdirSync(root, { recursive: true });
    expect(() => safeResolve(root, '../../x')).toThrow(/traversal|escapes/);
    expect(() => safeResolve(root, '/etc/passwd')).toThrow(/Absolute/);
  });
});

describe('ArtifactStore', () => {
  it('stages a buffer with metadata only (no absolute path)', () => {
    const t = store();
    const a = t.artifacts.stageBuffer('default', Buffer.from('hello'), 'note.txt', 'text/plain');
    expect(a.displayName).toBe('note.txt');
    expect(a.mimeType).toBe('text/plain');
    expect(a.byteSize).toBe(5);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a)).not.toContain(t.dataDir);
    const back = t.artifacts.readBytes('default', a.id);
    expect(back.buffer.toString()).toBe('hello');
    t.db.close();
  });

  it('rejects executables and oversized files', () => {
    const t = store();
    expect(() => t.artifacts.stageBuffer('default', Buffer.from('MZ'), 'evil.exe')).toThrow(CoreError);
    expect(() => t.artifacts.stageBuffer('default', Buffer.from('x'), 'script.sh')).toThrow(CoreError);
    const big = Buffer.alloc(26 * 1024 * 1024);
    expect(() => t.artifacts.stageBuffer('default', big, 'big.txt')).toThrow(/size limit/i);
    t.db.close();
  });

  it('accepts and dimension-checks images', () => {
    const t = store();
    // 1x1 transparent PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const a = t.artifacts.stageBuffer('default', png, 'pixel.png', 'image/png');
    expect(a.kind).toBe('image');
    expect(a.width).toBe(1);
    expect(a.height).toBe(1);
    const img = t.artifacts.readImageBase64('default', a.id);
    expect(img.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    t.db.close();
  });

  it('isolates workspaces and reads only by id', () => {
    const t = store();
    const a = t.artifacts.stageBuffer('default', Buffer.from('ws1'), 'a.txt');
    expect(t.artifacts.get('other', a.id)).toBeUndefined();
    expect(() => t.artifacts.readBytes('other', a.id)).toThrow(/does not exist/i);
    t.db.close();
  });

  it('refuses to follow a symlink escape for tool reads', () => {
    const t = store();
    const secret = join(t.dataDir, 'secret.txt');
    writeFileSync(secret, 'topsecret');
    const wsRoot = join(t.artifacts.root, 'default');
    mkdirSync(wsRoot, { recursive: true });
    try { symlinkSync(secret, join(wsRoot, 'link.txt')); } catch { /* windows */ }
    expect(() => t.artifacts.readTextForTool('default', 'link.txt')).toThrow();
    t.db.close();
  });
});

describe('sandboxed tools', () => {
  it('getCurrentTime is low-risk/auto and validates timezone', async () => {
    const registry = new ToolRegistry();
    const def = registry.resolve('core.time.getCurrentTime');
    expect(def.risk).toBe('low');
    expect(def.approvalPolicy).toBe('auto');
    const args = def.validate({ timezone: 'Asia/Shanghai' });
    const result = await def.execute(args, {
      workspaceId: 'default', runId: 'r', artifacts: store().artifacts,
      maxArtifactReadBytes: 1000, maxListEntries: 100, now: new Date('2024-01-02T03:04:05Z'),
    });
    expect(result.ok).toBe(true);
    expect(() => def.validate({ timezone: 'Not/A_Zone' })).toThrow(/timezone/i);
  });

  it('readText rejects unknown path and requires an argument', async () => {
    const registry = new ToolRegistry();
    const def = registry.resolve('core.artifact.readText');
    expect(def.risk).toBe('medium');
    expect(def.approvalPolicy).toBe('always');
    expect(() => def.validate({})).toThrow(/artifactId|path/i);
  });

  it('registry rejects unknown tools/versions', () => {
    const registry = new ToolRegistry();
    expect(() => registry.resolve('os.exec')).toThrow(/unknown tool/i);
    expect(() => registry.resolve('core.time.getCurrentTime', 99)).toThrow(/version/);
  });

  it('lists only the three approved tools', () => {
    const names = new ToolRegistry().list().map(t => t.name).sort();
    expect(names).toEqual(['core.artifact.readText', 'core.fs.listDirectory', 'core.time.getCurrentTime']);
  });
});
