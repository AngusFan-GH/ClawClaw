/**
 * Five-field cron parser: minute hour day-of-month month day-of-week.
 *
 * Supports star, literals, comma lists, ranges (a-b), star-step and range-step
 * forms. Parsing fails fast on wrong field count, zero/negative steps,
 * out-of-range values and inverted ranges — bad input is never silently treated
 * as "match everything".
 */
import { CoreError } from '../errors';

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number> | null; // null = '*'
  months: Set<number>;
  daysOfWeek: Set<number> | null; // null = '*', 0-6 (Sunday=0)
  source: string;
}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6],
} as const;

export function parseCron(expression: string): CronFields {
  if (typeof expression !== 'string') throw new CoreError('CRON_EXPRESSION_INVALID', 'Schedule must be a string');
  const parts = expression.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) throw new CoreError('CRON_EXPRESSION_INVALID', 'Schedule must have exactly five fields');
  const [m, h, dom, mon, dow] = parts;
  return {
    source: expression.trim(),
    minutes: parseField(m, RANGES.minute[0], RANGES.minute[1], 'minute'),
    hours: parseField(h, RANGES.hour[0], RANGES.hour[1], 'hour'),
    daysOfMonth: dom === '*' ? null : parseField(dom, RANGES.dayOfMonth[0], RANGES.dayOfMonth[1], 'day of month'),
    months: parseField(mon, RANGES.month[0], RANGES.month[1], 'month'),
    daysOfWeek: dow === '*' ? null : parseDow(dow),
  };
}

function parseField(raw: string, min: number, max: number, label: string): Set<number> {
  const values = new Set<number>();
  for (const chunk of raw.split(',')) {
    let base = chunk;
    let step = 1;
    if (base.includes('/')) {
      const [range, stepRaw] = base.split('/');
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step <= 0) throw new CoreError('CRON_EXPRESSION_INVALID', `Invalid step in ${label}`);
      base = range;
    }
    let lo = min;
    let hi = max;
    if (base !== '*') {
      if (base.includes('-')) {
        const [a, b] = base.split('-');
        lo = Number(a); hi = Number(b);
      } else {
        lo = hi = Number(base);
        if (!Number.isInteger(lo)) throw new CoreError('CRON_EXPRESSION_INVALID', `Invalid value in ${label}`);
      }
    } else if (base === '*' && chunk.includes('/')) {
      lo = min; hi = max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new CoreError('CRON_EXPRESSION_INVALID', `Out-of-range value in ${label}`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  if (values.size === 0) throw new CoreError('CRON_EXPRESSION_INVALID', `Empty ${label} field`);
  return values;
}

function parseDow(raw: string): Set<number> {
  // Accept both 0-6 (Sun=0) and 7 (also Sunday).
  const values = new Set<number>();
  for (const chunk of raw.split(',')) {
    let base = chunk;
    let step = 1;
    if (base.includes('/')) {
      const [range, stepRaw] = base.split('/');
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step <= 0) throw new CoreError('CRON_EXPRESSION_INVALID', 'Invalid step in day of week');
      base = range;
    }
    let lo = 0; let hi = 6;
    if (base !== '*') {
      if (base.includes('-')) {
        const [a, b] = base.split('-');
        lo = dowNumber(a); hi = dowNumber(b);
      } else {
        lo = hi = dowNumber(base);
      }
    }
    if (lo > hi) throw new CoreError('CRON_EXPRESSION_INVALID', 'Inverted day-of-week range');
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

function dowNumber(token: string): number {
  const n = Number(token);
  if (!Number.isInteger(n) || n < 0 || n > 7) throw new CoreError('CRON_EXPRESSION_INVALID', 'Day of week must be 0-7');
  return n === 7 ? 0 : n;
}

/** Match against zoned calendar parts (dow: Sunday=0). */
export function matchesZoned(fields: CronFields, p: { minute: number; hour: number; day: number; month: number; dow: number }): boolean {
  if (!fields.minutes.has(p.minute) || !fields.hours.has(p.hour) || !fields.months.has(p.month)) return false;
  const domMatch = fields.daysOfMonth === null || fields.daysOfMonth.has(p.day);
  const dowMatch = fields.daysOfWeek === null || fields.daysOfWeek.has(p.dow);
  // Standard cron semantics when both are restricted: OR. Otherwise AND.
  if (fields.daysOfMonth === null && fields.daysOfWeek === null) return true;
  if (fields.daysOfMonth !== null && fields.daysOfWeek !== null) return domMatch || dowMatch;
  return domMatch && dowMatch;
}
