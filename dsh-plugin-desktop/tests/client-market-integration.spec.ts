// @vitest-environment jsdom

import { Context, type Context as ClientContext } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { applyMarketIntegration, type DesktopMarketControl } from '../src/client/market-integration.tsx'

describe('Desktop plugin market integration', () => {
  it('moves an available market from Settings into the Plugins page for its lifetime', () => {
    const setSettingsVisible = vi.fn()
    const disposers: Array<() => void> = []
    const registrations: Array<Record<string, unknown>> = []
    const ctx = {
      market: {
        version: 1,
        setSettingsVisible,
        settingsVisible: () => false,
        render: vi.fn(),
      },
      locale: {
        register: vi.fn(),
        bind: () => (key: string) => key === 'label' ? 'Plugin Marketplace' : key,
      },
      effect: vi.fn((mount: () => void | (() => void)) => {
        const dispose = mount()
        if (typeof dispose === 'function') disposers.push(dispose)
      }),
      inject: vi.fn((_services: string[], install: (scope: ClientContext) => void) => {
        install(ctx as unknown as ClientContext)
      }),
      slots: {
        inject: vi.fn((_name: string, install: () => () => void) => { disposers.push(install()) }),
        register: vi.fn((definition: Record<string, unknown>) => { registrations.push(definition); return () => {} }),
      },
    } as unknown as ClientContext

    applyMarketIntegration(ctx)

    expect(setSettingsVisible).toHaveBeenCalledWith(false)
    expect(registrations).toEqual([
      expect.objectContaining({
        name: 'plugins.item', id: 'desktop-marketplace', order: 0,
        locale: 'desktop.market-integration',
      }),
    ])

    disposers.reverse().forEach(dispose => { dispose() })
    expect(setSettingsVisible).toHaveBeenLastCalledWith(true)
  })

  it('waits for the optional market service before registering the marketplace item', () => {
    const inject = vi.fn()
    const register = vi.fn()
    applyMarketIntegration({
      effect: vi.fn(), inject, slots: { register }, locale: { register: vi.fn() },
    } as unknown as ClientContext)

    expect(inject).toHaveBeenCalledWith(['market'], expect.any(Function))
    expect(register).not.toHaveBeenCalled()
  })
})

/** Load the installed browser artifact through its public ModuleLoader entry. */
function installedMarketPlugin(): { inject: string[]; apply(ctx: Context): void } {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('dshmarket/package.json')
  const dependencies: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsx,
    'react-dom': ReactDOM,
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  }
  let plugin: ReturnType<typeof installedMarketPlugin> | undefined
  runInNewContext(readFileSync(join(dirname(manifest), 'client/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }: {
      factory(require: (name: string) => unknown): ReturnType<typeof installedMarketPlugin>
    }) {
      plugin = factory(name => {
        if (!(name in dependencies)) throw new Error(`Unmapped market dependency: ${name}`)
        return dependencies[name]
      })
    } },
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    },
    document, sessionStorage, localStorage, navigator, URL, Error,
    getComputedStyle, HTMLElement, Element, Node,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    console,
  })
  if (plugin === undefined) throw new Error('Market artifact did not register')
  return plugin
}

type Contribution = {
  options: { name: string; id?: string; key?: string }
  component(props: Record<string, unknown>): unknown
}

/** Real Cordis service injection with a controllable slot declaration lifetime. */
function marketFixture(initialSlots = ['settings.section', 'plugins.item', 'settings.plugin.item', 'shell.overlay']) {
  const ctx = new Context()
  const available = new Set(initialSlots)
  const entries = new Map<string, Contribution>()
  const subscriptions = new Set<{ name: string; install(): unknown; off?: (() => void) | undefined }>()
  const dictionaries = new Map<string, Record<string, string>>()
  const localeSnapshot = { active: 'en' }
  const slotKey = (name: string, id?: string) => `${name}:${id ?? ''}`
  ctx.provide('slots', {
    register(options: Contribution['options'], component: Contribution['component']) {
      const key = slotKey(options.name, options.id ?? options.key)
      if (entries.has(key)) throw new Error(`Duplicate market contribution: ${key}`)
      entries.set(key, { options, component })
      return () => { entries.delete(key) }
    },
    inject(name: string, install: () => unknown) {
      const subscription = { name, install } as { name: string; install(): unknown; off?: (() => void) | undefined }
      subscriptions.add(subscription)
      if (available.has(name)) subscription.off = install() as (() => void) | undefined
      return () => { subscription.off?.(); subscriptions.delete(subscription) }
    },
  } as never)
  ctx.provide('locale', {
    register(namespace: string, dicts: { en: Record<string, string> }) {
      dictionaries.set(namespace, dicts.en)
      return () => { dictionaries.delete(namespace) }
    },
    bind: (namespace: string) => (key: string) => dictionaries.get(namespace)?.[key] ?? key,
    subscribe: () => () => {},
    getSnapshot: () => localeSnapshot,
  } as never)
  ctx.provide('theme', { getTheme: () => null } as never)
  // The legacy market settings card is still used by older compositions.
  ctx.provide('settingsScope' as never, {} as never)
  return {
    ctx,
    entries,
    entry: (name: string, id: string) => entries.get(slotKey(name, id)),
    market: () => ctx.get('market') as DesktopMarketControl | undefined,
    declare(name: string) {
      available.add(name)
      for (const subscription of subscriptions) {
        if (subscription.name === name) subscription.off = subscription.install() as (() => void) | undefined
      }
    },
    remove(name: string) {
      available.delete(name)
      for (const subscription of subscriptions) {
        if (subscription.name === name) { subscription.off?.(); delete subscription.off }
      }
    },
    async dispose() {
      for (const subscription of [...subscriptions].reverse()) subscription.off?.()
      subscriptions.clear()
      await ctx.fiber.dispose()
    },
  }
}

describe('installed community market client contract', () => {
  it.each(['market-first', 'desktop-first'] as const)('connects the shipped market to Plugins with %s startup', async order => {
    const f = marketFixture()
    try {
      const mountMarket = async () => { await f.ctx.plugin(installedMarketPlugin()) }
      const mountDesktop = async () => { await f.ctx.plugin({ apply: applyMarketIntegration }) }
      if (order === 'market-first') { await mountMarket(); await mountDesktop() }
      else { await mountDesktop(); await mountMarket() }

      await vi.waitFor(() => expect(f.entry('plugins.item', 'desktop-marketplace')).toBeDefined())
      expect(f.market()?.version).toBe(1)
      expect(f.market()?.settingsVisible()).toBe(false)
      expect(f.entry('settings.section', 'market')).toBeUndefined()
      const entry = f.entry('plugins.item', 'desktop-marketplace')!
      const translate = (key: string) => key === 'summary' ? 'Market summary' : key
      expect(entry.component({ view: 'summary', market: f.market(), t: translate })).toBe('Market summary')
      const element = entry.component({ view: 'detail', market: f.market(), t: translate })
      expect(React.isValidElement(element)).toBe(true)

      f.remove('plugins.item')
      expect(f.entry('plugins.item', 'desktop-marketplace')).toBeUndefined()
      expect(f.market()?.settingsVisible()).toBe(true)
      expect(f.entry('settings.section', 'market')).toBeDefined()
      f.declare('plugins.item')
      expect(f.entry('plugins.item', 'desktop-marketplace')).toBeDefined()
      expect(f.entry('settings.section', 'market')).toBeUndefined()
    } finally { await f.dispose() }
  })

  it('keeps the Settings fallback until the Plugins slot becomes available', async () => {
    const f = marketFixture(['settings.section', 'shell.overlay'])
    try {
      await f.ctx.plugin(installedMarketPlugin())
      await f.ctx.plugin({ apply: applyMarketIntegration })
      expect(f.entry('settings.section', 'market')).toBeDefined()
      expect(f.market()?.settingsVisible()).toBe(true)
      f.declare('plugins.item')
      expect(f.entry('plugins.item', 'desktop-marketplace')).toBeDefined()
      expect(f.entry('settings.section', 'market')).toBeUndefined()
    } finally { await f.dispose() }
  })

  it('renders the shipped market and loads its catalog with the pinned host primitives', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const fetchMock = vi.fn(async (path: string | URL | Request) => {
      const body = String(path).includes('/registry')
        ? { registry: { count: 1, categories: { tools: { en: 'Tools', zh: '工具' } }, plugins: [{
          name: 'Desktop market fixture', owner: 'fixture', category: 'tools',
          url: 'https://github.com/fixture/market-plugin', npm: 'desktop-market-fixture',
          description: { en: 'A catalog entry loaded through the market API', zh: '市场目录测试条目' },
        }] } }
        : String(path).includes('/status') ? { version: '1.38.1', pnpm: true, restart: false }
        : { installed: {}, updates: {} }
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const f = marketFixture()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await f.ctx.plugin(installedMarketPlugin())
      await f.ctx.plugin({ apply: applyMarketIntegration })
      await vi.waitFor(() => expect(f.entry('plugins.item', 'desktop-marketplace')).toBeDefined())
      const page = f.entry('plugins.item', 'desktop-marketplace')!
      await React.act(async () => {
        root.render(page.component({ view: 'detail', market: f.market(), t: (key: string) => key }) as React.ReactNode)
      })
      expect(container.querySelector('[data-dsh-market-root]')).not.toBeNull()
      expect(container.textContent).toContain('Desktop market fixture')
      expect(container.textContent).toContain('A catalog entry loaded through the market API')
      expect(fetchMock).toHaveBeenCalledWith('/dsh-market/registry', expect.any(Object))
    } finally {
      await React.act(async () => { root.unmount() })
      container.remove()
      await f.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('honors visibility before Settings exists and never restores a removed market', async () => {
    const f = marketFixture(['settings.plugin.item', 'shell.overlay'])
    try {
      await f.ctx.plugin(installedMarketPlugin())
      const control = f.market()!
      control.setSettingsVisible(false)
      f.declare('settings.section')
      expect(f.entry('settings.section', 'market')).toBeUndefined()
      control.setSettingsVisible(true)
      const legacyEntry = f.entry('settings.section', 'market')!
      const embedded = control.render({ preferredSubsectionId: 'themes' })
      expect(React.isValidElement(embedded)).toBe(true)
      expect((embedded as React.ReactElement).props.preferredSubsectionId).toBe('themes')
      expect((embedded as React.ReactElement).type).toBe((legacyEntry.component({}) as React.ReactElement).type)
      const card = f.entry('settings.plugin.item', 'dsh-market')!.component({}) as React.ReactElement<{ onRemoved(): void }>
      card.props.onRemoved()
      control.setSettingsVisible(false)
      control.setSettingsVisible(true)
      expect(control.settingsVisible()).toBe(false)
      expect(f.entry('settings.section', 'market')).toBeUndefined()
    } finally { await f.dispose() }
  })
})
