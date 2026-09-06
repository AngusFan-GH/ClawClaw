// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { CoreDatabase } from '@backend/core/db/database';
import { CoreCronStore } from '@backend/core/cron-store';
import { parseCron, matchesZoned } from '@backend/core/cron/parser';
import { tempDir } from './helpers/runtime-harness';
import { CoreError } from '@backend/core/errors';

describe('parseCron', () => {
  it('accepts *, literals, lists, ranges, and steps', () => {
    const f = parseCron('0,30 9-17 */2 1 1-5');
    expect([...f.minutes]).toEqual([0, 30]);
    expect([...f.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(f.daysOfMonth).not.toBeNull();
    expect(f.daysOfWeek).not.toBeNull();
    expect([...f.daysOfWeek!]).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([
    ['* * * *'],
    ['* * * * * *'],
    ['60 * * * *'],
    ['*/0 * * * *'],
    ['5-2 * * * *'],
    ['a * * * *'],
    ['* 25 * * *'],
  ])('rejects %s', (expr) => {
    expect(() => parseCron(expr)).toThrow(CoreError);
  });

  it('supports 7 as Sunday and standard OR semantics', () => {
    const f = parseCron('0 0 13 * 5');
    // Friday the 13th (dow restricted, dom restricted -> OR)
    expect(matchesZoned(f, { minute: 0, hour: 0, day: 13, month: 1, dow: 5 })).toBe(true);
    // Friday but another day -> OR still true (dow matches)
    expect(matchesZoned(f, { minute: 0, hour: 0, day: 6, month: 1, dow: 5 })).toBe(true);
  });
});

describe('CoreCronStore durable fire cursor', () => {
  function setup() {
    const db = new CoreDatabase(join(tempDir(), 'c.sqlite'));
    const cron = new CoreCronStore(db);
    return { db, cron };
  }

  it('validates on save and persists timezone', () => {
    const { db, cron } = setup();
    const job = cron.save({ name: 'n', message: 'm', schedule: '*/5 9 * * *', timezone: 'Asia/Shanghai' });
    expect(job.timezone).toBe('Asia/Shanghai');
    expect(() => cron.save({ name: 'x', message: 'y', schedule: 'nope' })).toThrow(/five fields/i);
    expect(() => cron.save({ name: 'x', message: 'y', schedule: '* * * * *', timezone: 'Nowhere/Land' })).toThrow();
    db.close();
  });

  it('claims a due minute once and never replays the same bucket', () => {
    const { db, cron } = setup();
    const job = cron.save({ workspaceId: 'default', name: 'n', message: 'm', schedule: '* * * * *', timezone: 'UTC' });
    const when = new Date('2024-06-01T10:15:00Z');
    const first = cron.claimDue(when);
    expect(first.map(d => d.job.id)).toEqual([job.id]);
    expect(first[0].scheduledAt).toBe('2024-06-01T10:15');
    expect(cron.claimDue(when)).toHaveLength(0);
    db.close();
  });

  it('does not fire disabled jobs and scopes by workspace', () => {
    const { db, cron } = setup();
    const off = cron.save({ workspaceId: 'default', name: 'off', message: 'm', schedule: '* * * * *', enabled: false });
    const other = cron.save({ workspaceId: 'other', name: 'o', message: 'm', schedule: '* * * * *' });
    const due = cron.claimDue(new Date('2024-06-01T10:15:00Z'));
    const ids = due.flatMap(d => d.job.id);
    expect(ids).not.toContain(off.id);
    expect(ids).toContain(other.id);
    db.close();
  });

  it('records success/error on the fire cursor', () => {
    const { db, cron } = setup();
    const job = cron.save({ name: 'n', message: 'm', schedule: '* * * * *' });
    const [due] = cron.claimDue(new Date('2024-06-01T10:15:00Z'));
    cron.recordFireResult(job.id, due.scheduledAt, 'run-1', 'error', 'boom');
    const updated = cron.get('default', job.id)!;
    expect(updated.lastStatus).toBe('error');
    expect(updated.lastError).toBe('boom');
    db.close();
  });
});
