// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SPIRITX_ONBOARDING_COPY, SPIRITX_ONBOARDING_SHADOW, spiritXCredentialState } from '../src/client/spiritx-onboarding-state.ts'
import { applySpiritXOnboarding } from '../src/client/spiritx-onboarding.tsx'

describe('SpiritX onboarding', () => {
  it('prompts only while the product credential is missing', () => {
    expect(spiritXCredentialState({ configured: false, writable: true }))
      .toEqual({ kind: 'missing', writable: true })
    expect(spiritXCredentialState({ configured: true, writable: false }))
      .toEqual({ kind: 'configured' })
    expect(spiritXCredentialState({ configured: false, writable: false }))
      .toEqual({ kind: 'unavailable' })
    expect(spiritXCredentialState(undefined)).toEqual({ kind: 'unavailable' })
    expect(spiritXCredentialState({ configured: true, writable: true }, false))
      .toEqual({ kind: 'missing', writable: true })
    expect(spiritXCredentialState({ configured: true, writable: false }, false))
      .toEqual({ kind: 'unavailable' })
  })

  it('skips the key prompt when both the SpiritX profile and credential are configured', async () => {
    const registrations: Array<{ id: string; inject?: () => unknown }> = []
    const ctx = {
      effect: vi.fn((mount: () => unknown) => mount()),
      locale: {
        register: vi.fn(() => vi.fn()),
        bind: vi.fn(() => (key: string) => key),
      },
      slots: {
        inject: vi.fn((_name: string, mount: () => void) => { mount() }),
        register: vi.fn((entry: { id: string; inject?: () => unknown }) => {
          registrations.push(entry)
          return vi.fn()
        }),
      },
      remote: {
        llm: { listConfigurableProviders: vi.fn(async () => ({
          ok: true, value: [{ provider: 'spiritx' }],
        })) },
        credentials: { describe: vi.fn(async () => ({
          ok: true,
          value: { SPIRITX_API_KEY: { configured: true, writable: true } },
        })) },
      },
      configForms: { describe: () => ({
        ensure: vi.fn(async () => {}),
        getSnapshot: () => ({ view: { namespaces: [{ ns: 'llm-pi-ai', value: { providers: { spiritx: {
          apiKeyEnv: 'SPIRITX_API_KEY', api: 'openai-responses', baseURL: 'https://ai.xzinfra.com/spiritx-api/v1',
          models: [{ id: 'chat-first' }],
        } } } }] } }),
      }) },
    } as unknown as ClientContext

    applySpiritXOnboarding(ctx)
    expect(registrations.map(entry => entry.id)).toEqual(['deepseek-official'])
    const credential = registrations.find(entry => entry.id === 'deepseek-official')
    const injected = credential?.inject?.() as { loadCredential: () => Promise<unknown> }

    await expect(injected.loadCredential()).resolves.toEqual({ kind: 'configured' })
    expect(ctx.remote.credentials.describe).toHaveBeenCalledWith(['SPIRITX_API_KEY'])
  })

  it('owns only the credential copy without DeepSeek branding', () => {
    for (const copy of Object.values(SPIRITX_ONBOARDING_COPY)) {
      expect(copy.description).toContain('SpiritX')
      expect(copy.description).not.toContain('DeepSeek')
    }
  })

  it('replaces only the upstream DeepSeek credential step', () => {
    expect(SPIRITX_ONBOARDING_SHADOW).toEqual({
      credential: { id: 'deepseek-official', order: 0, priority: -10 },
    })
  })
})
