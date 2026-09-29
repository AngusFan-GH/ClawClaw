// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CronSessionLeading, installCronTaskSessionIcons } from '../src/client/cron-task-session-icon.tsx'
import { DesktopFeatureIcon } from '../src/client/desktop-feature-icon.tsx'
import { cronSessionTitle, isCronSessionId, parseCronSessionTitle } from '../src/cron-session-title.ts'

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
})

describe('scheduled task conversation source', () => {
  it('round-trips the durable title marker', () => {
    expect(cronSessionTitle('Daily report')).toBe('[Cron] Daily report')
    expect(cronSessionTitle('[Cron] Daily report')).toBe('[Cron] Daily report')
    expect(parseCronSessionTitle('[Cron] Daily report')).toBe('Daily report')
    expect(isCronSessionId('cron-123')).toBe(true)
  })

  it('registers scheduled task surfaces before the Electron-only client boundary', () => {
    const entry = readFileSync('src/client/index.ts', 'utf8')
    expect(entry.indexOf('applyCronTasksSettings(ctx)')).toBeLessThan(entry.indexOf('if (!environment) return'))
  })

  it('reuses the canonical Automation menu icon for Cron Session rows', () => {
    const leading = CronSessionLeading({ sessionId: 'cron-123' as never })
    expect(leading?.props.children.type).toBe(DesktopFeatureIcon)
    expect(leading?.props.children.props).toMatchObject({
      featureId: 'desktop-automations',
      kind: 'panel',
    })
    expect(CronSessionLeading({ sessionId: 'ordinary-123' as never })).toBeNull()
  })

  it('decorates sidebar titles and migrates existing Cron sessions', async () => {
    const title = document.createElement('span')
    title.className = 'title_hash'
    title.textContent = '[Cron] Daily report'
    const row = document.createElement('div')
    row.className = 'sessionRow_hash'
    row.setAttribute('role', 'treeitem')
    row.setAttribute('aria-selected', 'false')
    row.append(title)
    document.body.append(row)
    const header = document.createElement('span')
    header.className = 'crumb_hash crumbCurrent_hash'
    header.textContent = '[Cron] Daily report'
    document.body.append(header)

    const rename = vi.fn(async () => ({ ok: true }))
    const snapshot = { ids: ['cron-legacy'], byId: { 'cron-legacy': { title: 'Legacy report' } } }
    const dispose = installCronTaskSessionIcons({
      label: 'Scheduled task conversation',
      sessions: {
        list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
        binding: () => ({ session: { rename } }),
      } as never,
    })
    disposers.push(dispose)
    await Promise.resolve()

    expect(title.textContent).toBe('Daily report')
    expect(title.getAttribute('aria-label')).toBe('Scheduled task conversation: Daily report')
    expect(header.textContent).toBe('Daily report')
    expect(header.querySelector('[data-dsh-session-source-icon="cron"]')).not.toBeNull()
    expect(document.head.textContent).not.toContain('text-overflow:ellipsis')
    expect(rename).toHaveBeenCalledWith('[Cron] Legacy report')

    dispose()
    disposers.pop()
    expect(title.textContent).toBe('[Cron] Daily report')
    expect(title.hasAttribute('data-dsh-cron-session')).toBe(false)
    expect(title.getAttribute('aria-label')).toBeNull()
    expect(header.hasAttribute('data-dsh-cron-session')).toBe(false)
    expect(header.textContent).toBe('[Cron] Daily report')
  })
})
