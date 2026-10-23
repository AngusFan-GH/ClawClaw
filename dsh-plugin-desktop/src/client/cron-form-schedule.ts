/** Friendly schedule controls projected to and from the persisted five-field Cron expression. */

export type CronScheduleMode = 'once' | 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'interval' | 'custom'
export type CronIntervalUnit = 'minutes' | 'hours'

export interface FriendlyCronSchedule {
  readonly mode: CronScheduleMode
  readonly time: string
  readonly weekdays: readonly string[]
  readonly interval: number
  readonly intervalUnit: CronIntervalUnit
}

const DEFAULT_TIME = '09:00'
const DEFAULT_DAYS = Object.freeze(['1'])

function customSchedule(): FriendlyCronSchedule {
  return { mode: 'custom', time: DEFAULT_TIME, weekdays: DEFAULT_DAYS, interval: 30, intervalUnit: 'minutes' }
}

export function parseFriendlyCronSchedule(expression: string): FriendlyCronSchedule {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return customSchedule()
  const [minute, hour, day, month, weekday] = fields
  if (day !== '*' || month !== '*') return customSchedule()
  const minuteInterval = /^\*\/(\d{1,2})$/.exec(minute ?? '')
  if (minuteInterval !== null && hour === '*' && weekday === '*') {
    const interval = Number(minuteInterval[1])
    if (interval >= 1 && interval <= 59) return { mode: 'interval', time: DEFAULT_TIME, weekdays: DEFAULT_DAYS, interval, intervalUnit: 'minutes' }
  }
  const hourInterval = /^\*\/(\d{1,2})$/.exec(hour ?? '')
  if (hourInterval !== null && minute === '0' && weekday === '*') {
    const interval = Number(hourInterval[1])
    if (interval >= 1 && interval <= 23) return { mode: 'interval', time: DEFAULT_TIME, weekdays: DEFAULT_DAYS, interval, intervalUnit: 'hours' }
  }
  const numericTime = Number.isInteger(Number(minute)) && Number(minute) >= 0 && Number(minute) <= 59
    && Number.isInteger(Number(hour)) && Number(hour) >= 0 && Number(hour) <= 23
  if (!numericTime) return customSchedule()
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const common = { time, interval: 30, intervalUnit: 'minutes' as const }
  if (weekday === '*') return { mode: 'daily', weekdays: DEFAULT_DAYS, ...common }
  if (weekday === '1-5') return { mode: 'weekdays', weekdays: DEFAULT_DAYS, ...common }
  if (weekday === '0,6' || weekday === '6,0') return { mode: 'weekends', weekdays: Object.freeze(['0', '6']), ...common }
  const weekdays = (weekday ?? '').split(',')
  if (weekdays.length > 0 && weekdays.every(value => /^[0-6]$/.test(value))) {
    return { mode: 'weekly', weekdays: Object.freeze([...new Set(weekdays)]), ...common }
  }
  return customSchedule()
}

export interface FriendlyCronInput {
  readonly mode: Exclude<CronScheduleMode, 'once' | 'custom'>
  readonly time: string
  readonly weekdays: readonly string[]
  readonly interval: number
  readonly intervalUnit: CronIntervalUnit
}

export function friendlyCronExpression(input: FriendlyCronInput): string {
  if (input.mode === 'interval') {
    if (!Number.isInteger(input.interval)) throw new TypeError('Interval must be an integer')
    if (input.intervalUnit === 'minutes') {
      if (input.interval < 1 || input.interval > 59) throw new TypeError('Minute interval must be between 1 and 59')
      return `*/${input.interval} * * * *`
    }
    if (input.interval < 1 || input.interval > 23) throw new TypeError('Hour interval must be between 1 and 23')
    return `0 */${input.interval} * * *`
  }
  const match = /^(\d{2}):(\d{2})$/.exec(input.time)
  if (match === null) throw new TypeError('Time must use HH:mm')
  const hour = Number(match[1]); const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new TypeError('Time must be valid')
  if (input.mode === 'daily') return `${minute} ${hour} * * *`
  if (input.mode === 'weekdays') return `${minute} ${hour} * * 1-5`
  if (input.mode === 'weekends') return `${minute} ${hour} * * 0,6`
  const weekdays = [...new Set(input.weekdays)].sort((left, right) => Number(left) - Number(right))
  if (weekdays.length === 0 || !weekdays.every(value => /^[0-6]$/.test(value))) throw new TypeError('Select at least one weekday')
  return `${minute} ${hour} * * ${weekdays.join(',')}`
}

export function localDateTimeInput(date = new Date(Date.now() + 60 * 60 * 1000), timeZone?: string): string {
  if (timeZone !== undefined) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/** Convert a wall-clock input in an explicit zone without silently shifting DST gaps. */
export function zonedDateTimeInstant(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (match === null) throw new TypeError('Select a valid date and time')
  const [, year, month, day, hour, minute] = match
  const naive = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  if (new Date(naive).toISOString().slice(0, 16) !== value) throw new TypeError('Select a valid date and time')
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const wall = (instant: number): string => {
    const parts = Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
  }
  const candidates = new Set<number>()
  // Sample both sides of a transition, including zones with half-hour DST shifts.
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 3_600_000
    const offset = Date.parse(`${wall(sample)}:00Z`) - sample
    const instant = naive - offset
    if (wall(instant) === value) candidates.add(instant)
  }
  if (candidates.size !== 1) throw new TypeError('This local time is missing or ambiguous because of a time-zone transition; choose another time')
  return new Date([...candidates][0]!).toISOString()
}
