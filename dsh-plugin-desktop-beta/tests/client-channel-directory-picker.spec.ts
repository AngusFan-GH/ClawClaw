// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

async function pickerComponent(): Promise<React.ComponentType<Record<string, unknown>>> {
  // Exercise the pinned component with the same React/portal dependencies as
  // the channel bundle, without requiring its standalone peer installation.
  const source = readFileSync(new NodeURL('../../channels/dsh-im/node_modules/@xmanrui/dsh-im/plugin-src/client/workspace-directory-picker.js', import.meta.url), 'utf8')
  const { patchChannelDirectoryPicker } = await vi.importActual<{ patchChannelDirectoryPicker: (source: string) => string }>(
    '../../channels/dsh-im/scripts/channel-directory-picker-patch.mjs',
  )
  const Picker = new Function('React', 'createPortal', 'h',
    patchChannelDirectoryPicker(source).replace(/^import .*$/gm, '').replace('export function WorkspaceDirectoryPicker', 'function WorkspaceDirectoryPicker')
      + '\nreturn WorkspaceDirectoryPicker;')(
    React, createPortal, React.createElement,
  ) as React.ComponentType<Record<string, unknown>>
  return Picker
}

it('lets the channel picker toggle hidden directories and select one', async () => {
  const Picker = await pickerComponent()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const home = '/Users/test'
  const hiddenPath = `${home}/.clawclaw`
  const listDirectory = vi.fn(async (path?: string) => ({
    path: path ?? home,
    home,
    crumbs: [{ name: 'test', path: home }],
    entries: [
      { name: 'Projects', path: `${home}/Projects`, hidden: false },
      { name: '.clawclaw', path: hiddenPath, hidden: true },
    ],
  }))
  const pickDirectory = vi.fn()
  const onPicked = vi.fn()
  try {
    await React.act(async () => root.render(React.createElement(Picker, {
      open: true, startPath: home,
      picker: { listDirectory, pickDirectory }, onPicked, onCancel: vi.fn(),
    })))
    const toggle = document.querySelector<HTMLButtonElement>('.dim-directoryHidden')!
    const names = () => [...document.querySelectorAll('.dim-directoryName')].map(row => row.textContent)
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(names()).toEqual(['Projects'])
    await React.act(async () => toggle.click())
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(names()).toEqual(['Projects', '.clawclaw'])
    await React.act(async () => toggle.click())
    expect(names()).toEqual(['Projects'])
    await React.act(async () => toggle.click())
    const hidden = [...document.querySelectorAll<HTMLButtonElement>('.dim-directoryList button')]
      .find(button => button.title === hiddenPath)!
    await React.act(async () => hidden.click())
    const select = document.querySelector<HTMLButtonElement>('.dim-directoryPickerPrimary')!
    expect(select.disabled).toBe(false)
    await React.act(async () => select.click())
    expect(onPicked).toHaveBeenCalledWith(hiddenPath)
    expect(pickDirectory).not.toHaveBeenCalled()
  } finally {
    await React.act(async () => root.unmount())
    container.remove()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
  }
})

it('opens the native picker from the input icon, adopts its path and preserves cancellation', async () => {
  const Picker = await pickerComponent()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let finish: (path: string | null) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const pickDirectory = vi.fn(() => new Promise<string | null>((resolve, reject) => {
    finish = resolve
    fail = reject
  }))
  const listDirectory = vi.fn(async (path?: string) => ({
    path: path ?? '/Users/test', home: '/Users/test', crumbs: [], entries: [],
  }))
  const onCancel = vi.fn()
  try {
    await React.act(async () => root.render(React.createElement(Picker, {
      open: true, picker: { pickDirectory, listDirectory }, onPicked: vi.fn(), onCancel,
    })))
    const button = document.querySelector<HTMLButtonElement>('.ccDirectoryNativePicker')!
    const input = document.querySelector<HTMLInputElement>('.dim-directoryPathInput')!
    expect(button.nextElementSibling).toBe(input)
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.title).toBe('使用系统选择器')
    expect(pickDirectory).not.toHaveBeenCalled()
    await React.act(async () => button.click())
    expect(pickDirectory).toHaveBeenCalledOnce()
    expect(pickDirectory).toHaveBeenLastCalledWith({ showHiddenFiles: false })
    expect(button.disabled).toBe(true)
    expect(input.disabled).toBe(true)
    await React.act(async () => finish('/Volumes/Work'))
    expect(input.value).toBe('/Volumes/Work')
    expect(listDirectory).toHaveBeenLastCalledWith('/Volumes/Work', expect.any(AbortSignal))
    expect(document.querySelector('.dim-directoryHidden')?.getAttribute('aria-pressed')).toBe('false')
    await React.act(async () => document.querySelector<HTMLButtonElement>('.dim-directoryHidden')!.click())
    await React.act(async () => button.click())
    expect(pickDirectory).toHaveBeenLastCalledWith({ showHiddenFiles: true })
    await React.act(async () => finish(null))
    expect(input.value).toBe('/Volumes/Work')
    expect(onCancel).not.toHaveBeenCalled()
    await React.act(async () => document.querySelector<HTMLButtonElement>('.dim-directoryHidden')!.click())
    await React.act(async () => button.click())
    expect(pickDirectory).toHaveBeenLastCalledWith({ showHiddenFiles: false })
    await React.act(async () => fail(new Error('native picker failed')))
    expect(document.querySelector('.dim-directoryPickerError')?.textContent).toContain('native picker failed')
    expect(button.disabled).toBe(false)
    expect(input.value).toBe('/Volumes/Work')
  } finally {
    await React.act(async () => root.unmount())
    container.remove()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
  }
})
