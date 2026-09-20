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
