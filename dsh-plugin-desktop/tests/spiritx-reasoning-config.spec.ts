import { describe, expect, it, vi } from 'vitest'
import { changeReasoningMode, reasoningConfigError, reasoningMode, inferAutomaticReasoning } from '@deepseek-ai/dsh-client-ui-settings-models/reasoning-config'
import { discoverSpiritXModels, loadSpiritXProfile, saveSpiritXModels, syncSpiritXModelProtocols, type SpiritXModelDraft } from '../src/client/spiritx-provisioning.ts'

function fixture(models: SpiritXModelDraft[], advertised: SpiritXModelDraft[]) {
  const profile = { baseURL: 'https://ai.xzinfra.com/spiritx-api/v1', api: 'openai-responses', apiKeyEnv: 'SPIRITX_API_KEY', models }
  const namespaces = [
    { ns: 'llm-pi-ai', revision: 1, value: { providers: { spiritx: profile } } },
    { ns: 'agent-default-model', revision: 1, value: { provider: 'spiritx', model: models[0]?.id } },
  ]
  const discover = vi.fn(async () => ({ ok: true, value: advertised }))
  const mutate = vi.fn(async (ns: string, operations: Array<{ op: string; path: string[]; value?: unknown }>, revision: number) => {
    const namespace = namespaces.find(item => item.ns === ns)!
    expect(revision).toBe(namespace.revision)
    for (const operation of operations) {
      let parent = namespace.value as Record<string, unknown>
      for (const key of operation.path.slice(0, -1)) parent = parent[key] as Record<string, unknown>
      const key = operation.path.at(-1)!
      if (operation.op === 'unset') delete parent[key]
      else parent[key] = structuredClone(operation.value)
    }
    namespace.revision++
    return { ok: true, value: {} }
  })
  const ctx = {
    remote: { settings: { mutate }, llm: { discoverModels: discover } },
    configForms: { describe: () => ({ ensure: async () => {}, getSnapshot: () => ({ view: { namespaces } }) }) },
  } as never
  return { ctx, profile, discover, mutate }
}

describe('shared reasoning configuration', () => {
  it('distinguishes automatic, custom and disabled legacy configurations', () => {
    expect(reasoningMode({})).toBe('auto')
    expect(reasoningMode({ reasoningEfforts: { high: 'high' } })).toBe('custom')
    expect(reasoningMode({ reasoningEfforts: false })).toBe('disabled')
  })

  it('restores automatic inference by removing overrides, defaults and Off behavior', () => {
    expect(changeReasoningMode({ reasoningEfforts: { high: 'high' }, defaultReasoningEffort: 'high', reasoningOff: 'value' }, 'auto'))
      .toEqual({ reasoningMode: 'auto' })
  })

  it('rejects a missing default level and protocol-incompatible Off toggles', () => {
    expect(reasoningConfigError({ reasoningMode: 'custom', reasoningEfforts: { low: 'low' }, defaultReasoningEffort: 'high' })).toBe('default')
    expect(reasoningConfigError({ api: 'openai-responses', reasoningEfforts: { off: null, high: 'high' }, reasoningOff: 'qwen-toggle' })).toBe('off')
    expect(reasoningConfigError({ reasoningMode: 'disabled', defaultReasoningEffort: 'high' })).toBe('default')
  })

  it('updates automatic caches while preserving a provider-default choice', async () => {
    const model: SpiritXModelDraft = { id: 'GLM-5.3', api: 'openai-completions', reasoningMode: 'auto', reasoningEfforts: { high: 'high' }, defaultReasoningEffort: null }
    const f = fixture([model], [{ id: model.id, api: model.api, reasoningEfforts: { low: 'low', high: 'high', max: 'max' } } as SpiritXModelDraft])
    await syncSpiritXModelProtocols(f.ctx)
    expect(f.profile.models[0]).toMatchObject({ reasoningMode: 'auto', reasoningEfforts: { low: 'low', high: 'high', max: 'max' }, defaultReasoningEffort: null })
  })

  it('clears an automatic default if fresh metadata disables reasoning', async () => {
    const model: SpiritXModelDraft = { id: 'GLM-5.3', api: 'openai-completions', reasoningMode: 'auto', reasoningEfforts: { high: 'high' }, defaultReasoningEffort: 'high' }
    const f = fixture([model], [{ id: model.id, api: 'openai-completions', reasoningEfforts: false }])
    await syncSpiritXModelProtocols(f.ctx)
    expect(f.profile.models[0]).toMatchObject({ reasoningMode: 'auto', reasoningEfforts: false, defaultReasoningEffort: null })
  })

  it.each(['custom', 'disabled'] as const)('keeps %s mode stable across save, reload and discovery', async mode => {
    const model: SpiritXModelDraft = { id: 'GLM-5.3', api: 'openai-completions', reasoningMode: mode, reasoningEfforts: mode === 'custom' ? { low: 'vendor-low' } : false, defaultReasoningEffort: mode === 'custom' ? 'low' : null }
    const f = fixture([model], [{ id: model.id, api: 'openai-completions', reasoningEfforts: { high: 'high' } }])
    await expect(saveSpiritXModels(f.ctx, [model])).resolves.toBeUndefined()
    await syncSpiritXModelProtocols(f.ctx)
    const reloaded = await loadSpiritXProfile(f.ctx)
    expect(reloaded.ok && reloaded.value.models[0]).toMatchObject(model)
  })

  it('re-enables automatic inference after a user resets a custom model', async () => {
    const custom: SpiritXModelDraft = { id: 'GLM-5.3', api: 'openai-completions', reasoningMode: 'custom', reasoningEfforts: { low: 'vendor-low' } }
    const f = fixture([custom], [{ id: custom.id, api: 'openai-completions' }])
    await expect(saveSpiritXModels(f.ctx, [changeReasoningMode(custom, 'auto')])).resolves.toBeUndefined()
    expect(f.profile.models[0]).toMatchObject({ reasoningMode: 'auto', reasoningEfforts: { low: 'low', high: 'high', max: 'max' }, defaultReasoningEffort: 'max' })
  })

  it('infers per-model defaults without replacing an explicit server default', async () => {
    const f = fixture([{ id: 'GLM-5.3' }], [{ id: 'GLM-5.3', api: 'openai-completions' }, { id: 'Qwen3.8-27B', api: 'openai-responses' }])
    const discovered = await discoverSpiritXModels(f.ctx)
    expect(discovered.ok && discovered.value.map(model => model.defaultReasoningEffort)).toEqual(['max', 'xhigh'])
  })
})

it('round-trips dynamic levels and parameter mappings without changing them during discovery', async () => {
  const model: SpiritXModelDraft = { id: 'custom-chat', api: 'openai-responses', reasoningMode: 'custom', reasoningEfforts: { ultra: 'ultra', max: 'max' }, reasoningMappings: { ultra: { kind: 'parameters', body: { reasoning: { effort: 'max' }, task_mode: 'delegate' } } }, defaultReasoningEffort: 'ultra' }
  const f = fixture([model], [{ id: model.id, api: 'openai-responses', reasoningEfforts: { low: 'low' } }])
  await expect(saveSpiritXModels(f.ctx, [model])).resolves.toBeUndefined()
  await syncSpiritXModelProtocols(f.ctx)
  const loaded = await loadSpiritXProfile(f.ctx)
  expect(loaded.ok && loaded.value.models[0]).toMatchObject(model)
})


it('refreshes automatic Off dispatch after a protocol or capability change', () => {
  expect(inferAutomaticReasoning({ id: 'DeepSeek-V4-Flash', api: 'openai-completions', reasoningMode: 'auto', reasoningEfforts: { off: 'none', high: 'high' }, reasoningOff: 'value' }))
    .toMatchObject({ reasoningOff: 'deepseek-toggle' })
  expect(inferAutomaticReasoning({ id: 'DeepSeek-V4-Flash', api: 'openai-responses', reasoningMode: 'auto', reasoningEfforts: { off: 'none', high: 'high' }, reasoningOff: 'deepseek-toggle' }))
    .toMatchObject({ reasoningOff: 'value' })
  expect(inferAutomaticReasoning({ id: 'DeepSeek-V4-Flash', api: 'openai-completions', reasoningMode: 'auto', reasoningEfforts: false, reasoningOff: 'value' }))
    .not.toHaveProperty('reasoningOff')
})
