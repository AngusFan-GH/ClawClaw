// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { act, createElement } from 'react'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ReasoningConfiguration } from '@deepseek-ai/dsh-client-ui-settings-models/reasoning-config'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Exercise the published generic editor entry, including its shared validation wrapper. */
function genericEditor() {
  const require = createRequire(import.meta.url)
  const source = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-settings-models/client'), 'utf8')
    .replace('exports.apply = apply;', 'exports.testEditor = ModelReasoningEfforts; exports.testValidate = validateReasoningEfforts; exports.testAdopt = adopt; exports.apply = apply;')
  let definition: { factory: (require: (id: string) => unknown) => Record<string, unknown> } | undefined
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (value: typeof definition) => { definition = value } } } })
  const exports = definition!.factory(id => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === '@deepseek-ai/dsh-client-ui-primitives' || id === '@deepseek-ai/dsh-client-store') return {}
    throw new Error(`Unexpected generic editor dependency ${id}`)
  })
  return exports as unknown as {
    testEditor: React.ComponentType<{ model: ReasoningConfiguration; levels: string[]; disabled: boolean; t: (key: string) => string; onChange: (model: ReasoningConfiguration) => void }>
    testAdopt: (candidate: Record<string, unknown>) => ReasoningConfiguration
    testValidate: (models: ReasoningConfiguration[]) => { index: number; key: string } | undefined
  }
}

describe('published generic reasoning editor', () => {
  it('uses the shared three modes and emits a per-model default', async () => {
    const generic = genericEditor()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const change = vi.fn()
    try {
      await act(async () => { root.render(createElement(generic.testEditor, {
        model: { reasoningMode: 'custom', reasoningEfforts: { low: 'low', high: 'high' }, defaultReasoningEffort: null },
        levels: ['off', 'low', 'high'], disabled: false, t: key => key, onChange: change,
      })) })
      const modes = host.querySelector<HTMLSelectElement>('[aria-label="reasoningEditor_mode"]')!
      expect([...modes.options].map(option => option.value)).toEqual(['auto', 'custom', 'disabled'])
      const defaults = host.querySelector<HTMLSelectElement>('[aria-label="reasoningEditor_default"]')!
      await act(async () => { defaults.value = 'high'; defaults.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(change).toHaveBeenCalledWith(expect.objectContaining({ defaultReasoningEffort: 'high' }))
      await act(async () => { modes.value = 'disabled'; modes.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ reasoningMode: 'disabled', reasoningEfforts: false, defaultReasoningEffort: null }))
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })

  it('automatically recognizes the same Qwen levels and default in a custom API row', async () => {
    const generic = genericEditor()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(createElement(generic.testEditor, {
        model: { id: 'Qwen3.8-27B', api: 'openai-responses' }, levels: ['off', 'low', 'medium', 'high', 'xhigh'],
        disabled: false, t: key => key, onChange: () => {},
      })) })
      expect(host.querySelector<HTMLSelectElement>('[aria-label="reasoningEditor_default"]')!.value).toBe('xhigh')
      expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(input => input.closest('label')!.textContent)).toEqual(['low', 'medium', 'xhigh'])
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })

  it('retains disclosed API capabilities when adopting a custom model', () => {
    expect(genericEditor().testAdopt({ id: 'future-chat', api: 'openai-completions', reasoningEfforts: { high: 'vendor-high' } }))
      .toMatchObject({ api: 'openai-completions', reasoningMode: 'auto', reasoningEfforts: { high: 'vendor-high' } })
  })

  it('checks a default against the selected model levels before writing', () => {
    const generic = genericEditor()
    expect(generic.testValidate([{ reasoningMode: 'custom', reasoningEfforts: { low: 'low' }, defaultReasoningEffort: 'high' }]))
      .toMatchObject({ index: 0 })
    expect(generic.testValidate([{ reasoningMode: 'disabled', reasoningEfforts: false, defaultReasoningEffort: null }])).toBeUndefined()
  })
})


it('renders a model-specific level and edits its parameter mapping in the generic editor', async () => {
  const generic = genericEditor()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const change = vi.fn()
  try {
    await act(async () => { root.render(createElement(generic.testEditor, {
      model: { reasoningMode: 'custom', reasoningEfforts: { ultra: 'ultra' }, defaultReasoningEffort: 'ultra' },
      levels: ['low', 'high'], disabled: false, t: key => key, onChange: change,
    })) })
    expect(host.querySelector<HTMLSelectElement>('[aria-label="reasoningEditor_default"]')!.value).toBe('ultra')
    expect(host.textContent).toContain('ultra')
    expect([...host.querySelectorAll('.modelReasoningEditorRow')].map(row => row.querySelector('label')?.textContent)).toEqual(['ultra'])
    expect(host.querySelector('details')?.open).toBe(false)
    const mapping = host.querySelector<HTMLSelectElement>('[aria-label="reasoningEditor_mapping · ultra"]')!
    expect([...mapping.options].map(option => option.value)).toEqual(['effort', 'number', 'budget', 'toggle', 'parameters'])
    await act(async () => { mapping.value = 'number'; mapping.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ reasoningMappings: { ultra: { kind: 'number', path: '', value: 1 } } }))
    expect(generic.testValidate([{ reasoningMode: 'custom', reasoningEfforts: { ultra: 'ultra' }, defaultReasoningEffort: 'ultra' }])).toBeUndefined()
  } finally {
    await act(async () => { root.unmount() })
    host.remove()
  }
})
