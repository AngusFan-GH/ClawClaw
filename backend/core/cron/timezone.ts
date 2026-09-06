/**
 * Timezone helpers for cron scheduling. Jobs store an IANA zone (or an explicit
 * local-zone marker); matching uses the wall-clock components in that zone.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  dow: number; // 0=Sunday
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimezone(zone: string): boolean {
  if (zone === 'local') return true;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, zone: string): ZonedParts {
  const effective = zone === 'local' ? localTimezone() : zone;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: effective,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    dow: dowMap[map.weekday] ?? 0,
  };
}

/** Stable minute bucket in the job's zone, used as the durable fire cursor. */
export function minuteKey(parts: ZonedParts): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}
