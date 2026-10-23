import type { DesktopLocale, DesktopPlatform, DesktopUpdatePresentation } from './runtime.ts'

export const DESKTOP_LOCALE_READ_CHANNEL = 'dsh-desktop:locale-read'

export const COMPATIBILITY_CHROME_CHANNEL = 'dsh-desktop:compatibility-chrome'
export const COMPATIBILITY_CHROME_STATE = 'dsh-desktop:compatibility-chrome-state'

export type CompatibilityChromeCommand = 'state' | 'check-for-updates' | 'terminal' | 'restart' | 'restart-recovery' | 'reload' | 'developer' | 'expand' | 'collapse' | 'remote-control'

export interface CompatibilityChromeState {
  readonly mode: 'compatibility'
  readonly locale: DesktopLocale
  readonly platform: DesktopPlatform
  readonly version: string
  readonly material: string
  readonly update: DesktopUpdatePresentation
}

export interface CompatibilityChromeBridge {
  invoke(command: CompatibilityChromeCommand): Promise<CompatibilityChromeState | undefined>
  onDismiss(listener: () => void): () => void
  subscribe(listener: (state: CompatibilityChromeState) => void): () => void
}
