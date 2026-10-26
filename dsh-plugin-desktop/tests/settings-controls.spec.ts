// @vitest-environment jsdom
import { act, createElement, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { SettingsButton, SettingsIconButton } from '../src/client/settings-controls.tsx'

it('keeps ordinary actions from submitting forms and blocks busy refresh actions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const submit = vi.fn()
  const refresh = vi.fn()
  try {
    await act(async () => { root.render(createElement('form', { onSubmit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submit() } },
      createElement(SettingsButton, null, 'Cancel'),
      createElement(SettingsButton, { type: 'submit', variant: 'primary' }, 'Save'),
      createElement(SettingsIconButton, { label: 'Refresh', busy: true, onClick: refresh, children: 'Refresh' }))) })
    const buttons = host.querySelectorAll('button')
    await act(async () => { buttons[0]!.click() })
    expect(submit).not.toHaveBeenCalled()
    await act(async () => { buttons[1]!.click() })
    expect(submit).toHaveBeenCalledOnce()
    expect(buttons[2]!.getAttribute('aria-busy')).toBe('true')
    await act(async () => { buttons[2]!.click() })
    expect(refresh).not.toHaveBeenCalled()
  } finally {
    await act(async () => { root.unmount() })
    host.remove()
    vi.unstubAllGlobals()
  }
})
