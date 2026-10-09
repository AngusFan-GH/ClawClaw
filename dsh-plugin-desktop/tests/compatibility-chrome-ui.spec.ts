import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installChromeOverlay } from '../src/native-ui/compatibility-chrome/overlay.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('compatibility HTML chrome', () => {
  it('uses the shared fixed titlebar without exposing presentation controls', () => {
    const read = (file: string): string => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    expect(read('native-ui/compatibility-chrome/main.tsx')).toContain('<DesktopFrameTitlebarView')
    const style = read('native-ui/compatibility-chrome/style.css')
    expect(style).toContain('height: 36px')
    expect(style).toContain('padding: 0 8px 0 88px')
    expect(style).toContain('padding: 0 146px 0 8px')
    const view = read('client/DesktopFrameTitlebarView.tsx')
    expect(view).toContain('delay={150}')
    expect(view).toContain('closeDelay={200}')
    expect(view).not.toContain('setMode')
    expect(view).not.toContain('MODE_OPTIONS')
  })

  it('expands only for popup DOM and collapses again after removal or disposal', async () => {
    let popup: object | null = null
    let update: () => void = () => {}
    const disconnect = vi.fn()
    const listeners = new Map<string, (event: unknown) => void>()
    vi.stubGlobal('document', {
      body: {}, querySelector: () => popup,
      addEventListener: (name: string, listener: (event: unknown) => void) => { listeners.set(name, listener) },
      removeEventListener: (name: string) => { listeners.delete(name) },
    })
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { update = callback }
      observe = vi.fn()
      disconnect = disconnect
    })
    const invoke = vi.fn(async () => {})
    const dismiss = vi.fn()
    const failed = vi.fn()
    const dispose = installChromeOverlay(invoke, dismiss, failed)
    expect(invoke).not.toHaveBeenCalled()
    popup = {}
    update()
    update()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('expand')
    popup = null
    update()
    expect(invoke).toHaveBeenLastCalledWith('collapse')
    listeners.get('keydown')?.({ key: 'Escape' })
    expect(dismiss).toHaveBeenCalledOnce()
    popup = {}
    update()
    dispose()
    expect(invoke).toHaveBeenLastCalledWith('collapse')
    expect(disconnect).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
    await Promise.resolve()
    expect(failed).not.toHaveBeenCalled()
  })
})
