import { describe, expect, it } from 'vitest'
import { friendlyCronExpression, parseFriendlyCronSchedule } from '../src/client/cron-form-schedule.ts'

describe('friendly Cron schedule form', () => {
  it('builds common schedules from a time picker', () => {
    expect(friendlyCronExpression({ mode: 'daily', time: '09:30', weekdays: ['1'], interval: 30, intervalUnit: 'minutes' })).toBe('30 9 * * *')
    expect(friendlyCronExpression({ mode: 'weekdays', time: '08:05', weekdays: ['1'], interval: 30, intervalUnit: 'minutes' })).toBe('5 8 * * 1-5')
    expect(friendlyCronExpression({ mode: 'weekly', time: '17:45', weekdays: ['5', '1', '3'], interval: 30, intervalUnit: 'minutes' })).toBe('45 17 * * 1,3,5')
    expect(friendlyCronExpression({ mode: 'weekends', time: '10:00', weekdays: [], interval: 30, intervalUnit: 'minutes' })).toBe('0 10 * * 0,6')
    expect(friendlyCronExpression({ mode: 'interval', time: '09:00', weekdays: [], interval: 15, intervalUnit: 'minutes' })).toBe('*/15 * * * *')
    expect(friendlyCronExpression({ mode: 'interval', time: '09:00', weekdays: [], interval: 2, intervalUnit: 'hours' })).toBe('0 */2 * * *')
  })

  it('recognizes common schedules and preserves unsupported expressions as custom', () => {
    expect(parseFriendlyCronSchedule('30 9 * * *')).toMatchObject({ mode: 'daily', time: '09:30' })
    expect(parseFriendlyCronSchedule('5 8 * * 1-5')).toMatchObject({ mode: 'weekdays', time: '08:05' })
    expect(parseFriendlyCronSchedule('45 17 * * 1,3,5')).toMatchObject({ mode: 'weekly', time: '17:45', weekdays: ['1', '3', '5'] })
    expect(parseFriendlyCronSchedule('0 10 * * 0,6')).toMatchObject({ mode: 'weekends', time: '10:00' })
    expect(parseFriendlyCronSchedule('0 */2 * * *')).toMatchObject({ mode: 'interval', interval: 2, intervalUnit: 'hours' })
  })
})

// One-time inputs must use the selected IANA zone, independent of the machine zone.
describe('one-time wall-clock scheduling', () => {
  it('converts explicit zones and round-trips the displayed input', async () => {
    const { zonedDateTimeInstant, localDateTimeInput } = await import('../src/client/cron-form-schedule.ts')
    expect(zonedDateTimeInstant('2027-01-10T09:30', 'Asia/Shanghai')).toBe('2027-01-10T01:30:00.000Z')
    expect(zonedDateTimeInstant('2027-01-10T09:30', 'America/New_York')).toBe('2027-01-10T14:30:00.000Z')
    expect(zonedDateTimeInstant('2027-01-10T09:30', 'Asia/Kathmandu')).toBe('2027-01-10T03:45:00.000Z')
    expect(localDateTimeInput(new Date('2027-01-10T01:30:59Z'), 'Asia/Shanghai')).toBe('2027-01-10T09:30')
  })
  it('rejects invalid dates, zones, and nonexistent or ambiguous DST times', async () => {
    const { zonedDateTimeInstant } = await import('../src/client/cron-form-schedule.ts')
    expect(() => zonedDateTimeInstant('2027-02-30T09:30', 'UTC')).toThrow()
    expect(() => zonedDateTimeInstant('', 'UTC')).toThrow()
    expect(() => zonedDateTimeInstant('2027-01-10T09:30', 'Invalid/Zone')).toThrow()
    expect(() => zonedDateTimeInstant('2027-03-14T02:30', 'America/New_York')).toThrow(/missing or ambiguous/)
    expect(() => zonedDateTimeInstant('2027-11-07T01:30', 'America/New_York')).toThrow(/missing or ambiguous/)
  })
})
