import { createHash, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Stable digest of tool arguments for audit; arguments are JSON-sorted by key. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, sortValue((value as Record<string, unknown>)[k])]));
  }
  return value;
}

export function argsDigest(args: unknown): string {
  return sha256(stableJson(args)).slice(0, 16);
}

/**
 * Produce a human-readable, secret-free tool-argument summary for the approval
 * UI and audit log. Values are truncated and any key that looks sensitive is
 * rendered only by length.
 */
export function summarizeArgs(args: Record<string, unknown>, maxValueLength = 200): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (/token|secret|password|cookie|key|authorization/i.test(key)) {
      out[key] = `<secret:${typeof value === 'string' ? value.length : 0}>`;
      continue;
    }
    if (typeof value === 'string') out[key] = value.length > maxValueLength ? `${value.slice(0, maxValueLength)}…(${value.length})` : value;
    else if (value === null || ['number', 'boolean'].includes(typeof value)) out[key] = value;
    else out[key] = stableJson(value).slice(0, maxValueLength);
  }
  return out;
}

/**
 * Conservative token estimate without a model-specific tokenizer. Used for
 * context planning and budget accounting; labelled as an estimate everywhere.
 * ~4 chars/token for mixed CJK/latin input, floored at 1 token per non-empty.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessagesTokens(messages: Array<{ content?: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0);
}

export const isoNow = (): string => new Date().toISOString();

const MIME_TEXT = /^text\//;

/** Cap text reads; binary reads return a digest rather than raw bytes. */
export function looksTextual(mimeType: string | undefined, fileName: string): boolean {
  if (mimeType && MIME_TEXT.test(mimeType)) return true;
  return /\.(txt|md|json|csv|log|yaml|yml|toml|ini|xml|html?|js|ts|py|sh)$/i.test(fileName);
}
