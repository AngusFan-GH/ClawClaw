/**
 * Artifact storage.
 *
 * The renderer only supplies a source path (from the native file picker) or a
 * buffer; the service generates the destination and copies bytes. Metadata
 * stores id/name/MIME/size/hash only — never an absolute path or a secret.
 * Reads happen by artifact id after a canonical containment check.
 */
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CoreDatabase } from './db/database';
import { fail } from './errors';
import { isoNow, newId, sha256 } from './util';
import {
  extMime,
  imageDimensions,
  isAllowedMime,
  isBlockedExecutable,
  isInside,
  isSymlink,
  sanitizeFileName,
  sniffMime,
} from './fs-secure';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 200 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_TEXT_READ_BYTES = 200_000;

interface ArtifactRow {
  id: string;
  workspace_id: string;
  display_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  kind: string;
  storage_rel: string;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactView {
  id: string;
  workspaceId: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  kind: 'image' | 'doc' | 'file';
  width?: number;
  height?: number;
  createdAt: string;
  updatedAt: string;
}

export class ArtifactStore {
  readonly root: string;

  constructor(private readonly ctx: CoreDatabase, dataDir: string) {
    this.root = join(dataDir, 'artifacts');
    mkdirSync(this.root, { recursive: true });
  }

  private get db() {
    return this.ctx.db;
  }

  stageBuffer(workspaceId: string, buffer: Buffer, fileName: string, declaredMime?: string): ArtifactView {
    const safeName = safeNameOrThrow(fileName);
    return this.persist(workspaceId, buffer, safeName, declaredMime);
  }

  stageBase64(workspaceId: string, base64: string, fileName: string, declaredMime?: string): ArtifactView {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      fail('INVALID_ARGUMENT', 'Attachment payload is not valid base64');
    }
    return this.stageBuffer(workspaceId, buffer, fileName, declaredMime);
  }

  /** Copy from a user-picked absolute path. The source must be a regular file. */
  stagePath(workspaceId: string, sourcePath: string): ArtifactView {
    let stat;
    try {
      stat = lstatSync(sourcePath);
    } catch {
      fail('ARTIFACT_PATH_REJECTED', 'The selected file could not be read');
    }
    if (!stat.isFile() || stat.isSymbolicLink()) fail('ARTIFACT_PATH_REJECTED', 'Only regular files can be attached');
    if (stat.size > MAX_FILE_BYTES) fail('ARTIFACT_TOO_LARGE', 'The file exceeds the size limit');
    const buffer = readFileSync(sourcePath);
    return this.stageBuffer(workspaceId, buffer, sourcePath.split(/[\\/]/).pop() || 'file');
  }

  get(workspaceId: string, id: string): ArtifactView | undefined {
    const row = this.db.prepare('SELECT * FROM core_artifact WHERE workspace_id=? AND id=?').get(workspaceId, id) as ArtifactRow | undefined;
    return row ? this.toView(row) : undefined;
  }

  list(workspaceId: string): ArtifactView[] {
    return (this.db.prepare('SELECT * FROM core_artifact WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId) as unknown as ArtifactRow[])
      .map(r => this.toView(r));
  }

  listByIds(workspaceId: string, ids: string[]): ArtifactView[] {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return (this.db.prepare(`SELECT * FROM core_artifact WHERE workspace_id=? AND id IN (${placeholders})`).all(workspaceId, ...ids) as unknown as ArtifactRow[])
      .map(r => this.toView(r));
  }

  /** Absolute path inside the artifact root, validated — used by approved tools. */
  resolvePath(workspaceId: string, id: string): string {
    const row = this.requireRow(workspaceId, id);
    const absolute = resolve(this.root, row.storage_rel);
    if (isSymlink(absolute) || !isInside(this.root, absolute)) fail('ARTIFACT_PATH_REJECTED', 'Artifact path is outside the workspace');
    return absolute;
  }

  readBytes(workspaceId: string, id: string): { view: ArtifactView; buffer: Buffer } {
    const row = this.requireRow(workspaceId, id);
    const absolute = this.resolvePath(workspaceId, id);
    return { view: this.toView(row), buffer: readFileSync(absolute) };
  }

  /** Image read with a hard decode-pixel cap enforced from the header. */
  readImageBase64(workspaceId: string, id: string): { view: ArtifactView; dataUrl: string } {
    const { view, buffer } = this.readBytes(workspaceId, id);
    if (view.kind !== 'image') fail('INVALID_ARGUMENT', 'The artifact is not an image');
    const dims = imageDimensions(buffer, view.mimeType);
    if (dims && dims.width * dims.height > MAX_IMAGE_PIXELS) fail('ARTIFACT_TOO_LARGE', 'Image exceeds the pixel limit');
    return { view, dataUrl: `data:${view.mimeType};base64,${buffer.toString('base64')}` };
  }

  /** Bounded text read for the approved artifact tool; binary yields a digest. */
  readTextForTool(workspaceId: string, idOrRel: string, maxBytes = MAX_TEXT_READ_BYTES): string {
    const byId = this.db.prepare('SELECT * FROM core_artifact WHERE workspace_id=? AND id=?').get(workspaceId, idOrRel) as unknown as ArtifactRow | undefined;
    let absolute: string;
    let name: string;
    if (byId) {
      absolute = this.resolvePath(workspaceId, byId.id);
      name = byId.display_name;
    } else {
      // allow a relative path strictly within the workspace artifact root
      const wsRoot = join(this.root, workspaceId);
      mkdirSync(wsRoot, { recursive: true });
      const candidate = resolve(wsRoot, idOrRel);
      if (isSymlink(candidate) || !isInside(wsRoot, candidate)) fail('ARTIFACT_PATH_REJECTED', 'Path escapes the artifact root');
      absolute = candidate;
      name = idOrRel;
    }
    let stat;
    try { stat = lstatSync(absolute); } catch { fail('ARTIFACT_NOT_FOUND', 'File not found'); }
    if (!stat.isFile() || stat.isSymbolicLink()) fail('ARTIFACT_PATH_REJECTED', 'Not a regular file');
    if (stat.size > maxBytes) fail('ARTIFACT_TOO_LARGE', 'File exceeds the read limit');
    const buffer = readFileSync(absolute);
    const sniffed = sniffMime(buffer);
    const textual = Boolean(sniffed === undefined && /^[\s\S]*$/.test(buffer.toString('utf8')) && looksUtf8(buffer)) || /^text\//.test(extMime(name) || '');
    if (!textual) return `[binary ${stat.size} bytes sha256:${sha256(buffer)}]`;
    return buffer.toString('utf8');
  }

  /** Directory listing scoped to a workspace artifact root (for the fs tool). */
  listDirectoryForTool(workspaceId: string, relativeDir: string, maxEntries = 500): Array<{ name: string; type: 'file' | 'dir'; size: number }> {
    const wsRoot = join(this.root, workspaceId);
    mkdirSync(wsRoot, { recursive: true });
    const target = resolve(wsRoot, relativeDir || '.');
    if (isSymlink(target) || !isInside(wsRoot, target)) fail('ARTIFACT_PATH_REJECTED', 'Directory escapes the artifact root');
    let entries: string[];
    try { entries = readdirSync(target); } catch { fail('ARTIFACT_NOT_FOUND', 'Directory not found'); }
    return entries.slice(0, maxEntries).map(name => {
      const full = join(target, name);
      const s = lstatSync(full);
      return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.isFile() ? s.size : 0 };
    });
  }

  linkToConversation(workspaceId: string, conversationId: string, artifactIds: string[], messageId: string | null = null): void {
    const ts = isoNow();
    for (const artifactId of artifactIds) {
      this.requireRow(workspaceId, artifactId);
      this.db.prepare('INSERT INTO core_artifact_link (id,workspace_id,conversation_id,message_id,artifact_id,created_at) VALUES (?,?,?,?,?,?)')
        .run(newId(), workspaceId, conversationId, messageId, artifactId, ts);
    }
  }

  delete(workspaceId: string, id: string): void {
    const row = this.requireRow(workspaceId, id);
    const absolute = resolve(this.root, row.storage_rel);
    if (isInside(this.root, absolute)) rmSync(absolute, { force: true });
    const dir = resolve(absolute, '..');
    try { if (readdirSync(dir).length === 0) rmSync(dir, { force: true }); } catch { /* ignore */ }
    this.ctx.transaction(() => {
      this.db.prepare('DELETE FROM core_artifact_link WHERE workspace_id=? AND artifact_id=?').run(workspaceId, id);
      this.db.prepare('DELETE FROM core_artifact WHERE workspace_id=? AND id=?').run(workspaceId, id);
    });
  }

  private persist(workspaceId: string, buffer: Buffer, safeName: string, declaredMime?: string): ArtifactView {
    const mime = effectiveMime(buffer, safeName, declaredMime);
    if (!mime || !isAllowedMime(mime) || isBlockedExecutable(safeName, mime)) {
      fail('ARTIFACT_MIME_REJECTED', 'This file type is not allowed');
    }
    if (buffer.byteLength === 0) fail('INVALID_ARGUMENT', 'The attachment is empty');
    if (buffer.byteLength > MAX_FILE_BYTES) fail('ARTIFACT_TOO_LARGE', 'The file exceeds the size limit');
    this.enforceWorkspaceQuota(workspaceId, buffer.byteLength);

    const id = newId();
    const ts = isoNow();
    const rel = join(workspaceId, id, safeName);
    const absolute = resolve(this.root, rel);
    mkdirSync(resolve(absolute, '..'), { recursive: true });
    writeFileSync(absolute, buffer, { mode: 0o600 });
    const dims = mime.startsWith('image/') ? imageDimensions(buffer, mime) : undefined;
    const hash = sha256(buffer);
    const kind: ArtifactView['kind'] = mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'doc' : 'file';

    this.db.prepare(`INSERT INTO core_artifact
      (id,workspace_id,display_name,mime_type,byte_size,sha256,kind,storage_rel,width,height,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, workspaceId, safeName, mime, buffer.byteLength, hash, kind, rel, dims?.width ?? null, dims?.height ?? null, ts, ts);
    return this.toView(this.requireRow(workspaceId, id));
  }

  private enforceWorkspaceQuota(workspaceId: string, incoming: number): void {
    const row = this.db.prepare('SELECT COALESCE(SUM(byte_size),0) total FROM core_artifact WHERE workspace_id=?').get(workspaceId) as unknown as { total: number };
    if (row.total + incoming > MAX_WORKSPACE_BYTES) fail('ARTIFACT_QUOTA_EXCEEDED', 'Workspace storage quota exceeded');
  }

  private requireRow(workspaceId: string, id: string): ArtifactRow {
    const row = this.db.prepare('SELECT * FROM core_artifact WHERE workspace_id=? AND id=?').get(workspaceId, id) as unknown as ArtifactRow | undefined;
    return row ?? fail('ARTIFACT_NOT_FOUND', 'The artifact does not exist');
  }

  private toView(r: ArtifactRow): ArtifactView {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      displayName: r.display_name,
      mimeType: r.mime_type,
      byteSize: r.byte_size,
      sha256: r.sha256,
      kind: r.kind as ArtifactView['kind'],
      width: r.width ?? undefined,
      height: r.height ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

function safeNameOrThrow(fileName: string): string {
  try {
    return sanitizeFileName(fileName);
  } catch {
    fail('ARTIFACT_PATH_REJECTED', 'The file name is invalid');
  }
}

function effectiveMime(buffer: Buffer, fileName: string, declared?: string): string | undefined {
  const sniffed = sniffMime(buffer);
  if (sniffed) return sniffed;
  if (declared && /^[a-z0-9]+\/[a-z0-9.+-]+$/i.test(declared) && isAllowedMime(declared)) return declared;
  return extMime(fileName);
}

function looksUtf8(buffer: Buffer): boolean {
  // Reject NUL bytes and large binary runs for the "text" path.
  if (buffer.includes(0)) return false;
  return true;
}
