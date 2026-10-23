import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it('presents the search picker with a shared icon and current interface language', () => {
  let active = 'zh'
  let contribution: { name: string, label(): string, description(): string, icon: unknown, ui: { kind: string } } | undefined
  const searchIcon = () => null
  const commandUi = { register(value: typeof contribution) { contribution = value; return () => {} } }
  const locale = { getSnapshot: () => ({ active }) }
  const services = { commandUi, locale }
  let plugin: { apply(ctx: unknown): void } | undefined

  runInNewContext(readFileSync(require.resolve('dsh-free-search/client'), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }: { factory: (require: (id: string) => unknown) => typeof plugin }) {
      plugin = factory(id => id === '@deepseek-ai/dsh-client-ui-primitives' ? { IconSearchOutlineRegular: searchIcon } : {})
    } } },
  })
  plugin!.apply({
    slots: { inject() {} },
    inject(_names: string[], callback: (ctx: unknown) => void) {
      callback({ get: (name: keyof typeof services) => services[name], effect: (run: () => unknown) => run() })
    },
  })

  expect(contribution!.name).toBe('search-engine')
  expect(contribution!.icon).toBe(searchIcon)
  expect(contribution!.ui.kind).toBe('popupSelect')
  expect(contribution!.label()).toBe('搜索引擎')
  expect(contribution!.description()).toBe('切换搜索引擎')
  active = 'en'
  expect(contribution!.label()).toBe('Search engine')
  expect(contribution!.description()).toBe('Switch web search engine')
  active = 'zh'
  expect(contribution!.description()).toBe('切换搜索引擎')
})
