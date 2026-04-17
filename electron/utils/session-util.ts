type JsonRecord = Record<string, unknown>;

/**
 * Parse sessions.json supporting both formats:
 * - Object keyed: { "agent:xxx:yyy": { ... } }
 * - Array style: { sessions: [...] }
 */
export function extractSessionRecords(store: JsonRecord): JsonRecord[] {
  const directEntries = Object.entries(store)
    .filter(([key, value]) => key !== 'sessions' && value && typeof value === 'object')
    .map(([, value]) => value as JsonRecord);

  const arrayEntries = Array.isArray(store.sessions)
    ? store.sessions.filter((entry): entry is JsonRecord => Boolean(entry && typeof entry === 'object'))
    : [];

  return [...directEntries, ...arrayEntries];
}
