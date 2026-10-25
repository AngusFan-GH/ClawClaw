import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Settings from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Config as OptimizationConfig } from '../src/ai-draft-optimization.ts'
import { Config as ContinuationConfig } from '../src/ai-continuation.ts'
import { Config as SuggestionConfig } from '../src/input-suggestions.ts'

describe('AI assistance settings describe boundary', () => {
  it.each([
    { Config: OptimizationConfig, id: 'desktop-ai-draft-optimization', enabled: true },
    { Config: OptimizationConfig, id: 'desktop-ai-draft-optimization', enabled: false, override: { enabled: false } },
    { Config: ContinuationConfig, id: 'desktop-ai-continuation', enabled: false },
    { Config: SuggestionConfig, id: 'desktop-input-suggestions', enabled: false },
  ])('exposes Loader-resolved defaults to the Client form for $id: $enabled', async ({ Config, id, enabled, ...options }) => {
    const root = new Context()
    const entries: Array<Record<string, unknown>> = []
    let described: Array<{ ns: string; value: unknown }> = []
    try {
      await root.plugin({ name: 'settings-test-providers', apply(ctx: Context) {
        ctx.provide('configEditor', {
          entries: () => entries,
          configuration: () => entries.map(entry => ({ entry, inherited: {}, override: {} })),
        } as never)
        ctx.provide('profileContext', { home: join(tmpdir(), 'claw-assist-unused-settings-home') } as never)
        ctx.provide('loader', { await: async () => {} } as never)
      } })
      await root.plugin(Settings)
      await root.plugin({ name: id, inject: ['settings'], Config, apply(ctx: Context) {
        entries.push({ id, options: { id, config: options.override ?? {} }, fiber: ctx.fiber })
        ctx.settings.register(`test-${id}`, z.object({ enabled: z.boolean().default(id === 'desktop-ai-draft-optimization') }), { applies: 'live' })
      } }, options.override ?? {})
      await root.plugin({ name: 'settings-test-reader', inject: ['settings'], apply(ctx: Context) {
        described = ctx.settings.describe()
      } })
      // This is the actual value ConfigForms consumes, not scope.get(), which
      // applies legacy registration defaults a second time and hid the defect.
      expect(described.find(section => section.ns === id)?.value).toEqual({ enabled })
    } finally { await root.fiber.dispose() }
  })
})
