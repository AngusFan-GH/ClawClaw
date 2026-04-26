export type ChatTimestamp = number | string;

export function normalizeChatTimestampMs(timestamp: unknown): number | null {
  if (typeof timestamp === 'number') {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    return timestamp < 1e12 ? timestamp * 1000 : timestamp;
  }

  if (typeof timestamp !== 'string') return null;
  const trimmed = timestamp.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }

  // Match OpenClaw dashboard chat rendering: chat message timestamps are
  // expected to be numeric epoch values. Do not parse ISO/wall-clock strings
  // here; doing so can shift offset-bearing runtime strings into the browser's
  // local timezone and make in-progress messages display several hours off.
  return null;
}

export function normalizeChatTimestampForKey(timestamp: unknown): string | null {
  const ms = normalizeChatTimestampMs(timestamp);
  return ms == null ? null : String(ms);
}
