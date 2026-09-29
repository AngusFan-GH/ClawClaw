import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { applyDesktopVersionRow, DesktopCurrentVersionRow } from '../src/client/desktop-version-row.tsx'

describe('Desktop current version row', () => {
  it('renders the ClawClaw version supplied by the Electron environment', () => {
    const t = vi.fn((_key: string, values?: Record<string, unknown>) => `Current version: ${values?.version as string}`)
    const markup = renderToStaticMarkup(createElement(DesktopCurrentVersionRow, {
      t,
      version: '0.2.2',
    } as never))

    expect(markup).toContain('Current version: 0.2.2')
    expect(t).toHaveBeenCalledWith('general.currentVersion', { version: '0.2.2' })
  })

  it('shadows the upstream DSH version cell without changing the upstream checkout', () => {
    const register = vi.fn((_options: unknown, _component: unknown) => vi.fn())
    const inject = vi.fn((_name: string, install: () => unknown) => install())
    const ctx = { slots: { inject, register } } as unknown as ClientContext

    applyDesktopVersionRow(ctx, '0.2.2')

    expect(inject).toHaveBeenCalledWith('settings.general.item', expect.any(Function))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'settings.general.item',
      id: 'current-version',
      order: 100,
      priority: -100,
      locale: 'settings',
    }), DesktopCurrentVersionRow)
    const options = register.mock.calls[0]?.[0] as { inject: () => unknown }
    expect(options.inject()).toEqual({ version: '0.2.2' })
  })
})
