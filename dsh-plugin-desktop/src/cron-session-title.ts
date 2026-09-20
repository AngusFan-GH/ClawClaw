/** Durable marker used to distinguish scheduled-task conversations from ordinary sessions. */
export const CRON_SESSION_TITLE_PREFIX = '[Cron] '

export function cronSessionTitle(title: string): string {
  return `${CRON_SESSION_TITLE_PREFIX}${parseCronSessionTitle(title) ?? title}`
}

export function parseCronSessionTitle(title: string): string | undefined {
  if (!title.startsWith(CRON_SESSION_TITLE_PREFIX)) return undefined
  const value = title.slice(CRON_SESSION_TITLE_PREFIX.length).trim()
  return value || undefined
}

export function isCronSessionId(sessionId: string): boolean {
  return sessionId.startsWith('cron-')
}
