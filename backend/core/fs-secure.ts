/**
 * Secure filesystem helpers shared by the artifact store and the sandboxed
 * tools. All containment checks compare canonical (realpath) locations so
 * symlink/junction traversal cannot escape the workspace root.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { resolve, sep, parse } from 'node:path';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
// eslint-disable-next-line no-control-regex
const NAME_CONTROL = new RegExp('[\x00-\x1f\x7f\x80-\x9f]', 'g');
const NAME_STRIP = /[\\/:*?"<>|^]/g;

export function sanitizeFileName(input: string): string {
  let name = (input ?? '').normalize('NFC');
  // Take only the final path component; reject any traversal outright.
  name = name.split(/[\\/]/).pop() ?? name;
  name = name.replace(NAME_STRIP, '_').replace(NAME_CONTROL, '').replace(/\.+$/g, '');
  if (WINDOWS_RESERVED.test(name)) throw new Error('Reserved file name');
  if (name === '.' || name === '..' || name.length === 0) throw new Error('Invalid file name');
  if (name.length > 180) {
    const ext = parse(name).ext.slice(0, 16);
    name = `${name.slice(0, 150)}${ext}`;
  }
  return name;
}

/** True when `candidate` is `root` itself or strictly inside it (canonical compare). */
export function isInside(root: string, candidate: string): boolean {
  const rootReal = realpathSafe(root);
  const targetReal = realpathSafe(resolve(candidate));
  return targetReal === rootReal || targetReal.startsWith(rootReal + sep);
}

/** Resolve a relative segment against root, rejecting any escape (incl. via `..`). */
export function safeResolve(root: string, relative: string): string {
  const normalized = (relative ?? '').replace(/\\/g, '/');
  if (/(^|\/)\.\.(\/|$)/.test(normalized)) throw new Error('Path traversal rejected');
  if (normalized.startsWith('/')) throw new Error('Absolute paths are rejected');
  const target = resolve(root, normalized);
  if (!isInside(root, target)) throw new Error('Path escapes the workspace root');
  return target;
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  csv: 'text/csv', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml',
  log: 'text/plain', xml: 'application/xml', html: 'text/html', htm: 'text/html',
};

const BLOCKED_EXT = new Set([
  'exe', 'dll', 'so', 'dylib', 'app', 'bat', 'cmd', 'com', 'ps1', 'sh', 'msi', 'scr', 'jar',
  'appimage', 'deb', 'rpm', 'pkg', 'vbs', 'js', 'mjs', 'cjs', 'wasm', 'bin', 'sys', 'drv',
]);

export function extMime(fileName: string): string | undefined {
  const ext = parse(fileName).ext.slice(1).toLowerCase();
  return EXT_MIME[ext];
}

export function isBlockedExecutable(fileName: string, mime?: string): boolean {
  const ext = parse(fileName).ext.slice(1).toLowerCase();
  if (BLOCKED_EXT.has(ext)) return true;
  if (mime && /(x-executable|x-pie-executable|x-msdownload|x-sh|x-shellscript)/i.test(mime)) return true;
  return false;
}

/** Sniff a small prefix to confirm declared image/pdf types. Returns a MIME or undefined. */
export function sniffMime(buf: Buffer): string | undefined {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return undefined;
}

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'application/yaml', 'application/xml', 'text/html',
  'application/octet-stream',
]);

export function isAllowedMime(mime: string | undefined): boolean {
  return Boolean(mime && ALLOWED_MIME.has(mime));
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Parse image dimensions from headers without a full decoder. */
export function imageDimensions(buf: Buffer, mime: string): ImageDimensions | undefined {
  try {
    if (mime === 'image/png' && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/gif' && buf.length >= 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === 'image/jpeg') return jpegSize(buf);
    if (mime === 'image/webp') return webpSize(buf);
  } catch {
    return undefined;
  }
  return undefined;
}

function jpegSize(buf: Buffer): ImageDimensions | undefined {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) { offset += 1; continue; }
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

function webpSize(buf: Buffer): ImageDimensions | undefined {
  const format = buf.toString('ascii', 12, 16);
  if (format === 'VP8 ' && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L' && buf.length >= 25) {
    const b0 = buf.readUInt32LE(21);
    return { width: 1 + (b0 & 0x3fff), height: 1 + ((b0 >> 14) & 0x3fff) };
  }
  if (format === 'VP8X' && buf.length >= 30) {
    return {
      width: 1 + ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) >>> 0),
      height: 1 + ((buf[27] | (buf[28] << 8) | (buf[29] << 16)) >>> 0),
    };
  }
  return undefined;
}
