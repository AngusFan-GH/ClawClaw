/** Desktop-owned replacement for the upstream client build version row. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

interface DesktopVersionInjected { readonly version: string }
export type DesktopCurrentVersionRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>
  & InjectFace<DesktopVersionInjected>

export function DesktopCurrentVersionRow({ t, version }: DesktopCurrentVersionRowProps): JSX.Element {
  return <div className="dshDesktopCurrentVersion">{t('general.currentVersion', { version })}</div>
}

/** Shadow the DSH build version with the installed ClawClaw product version. */
export function applyDesktopVersionRow(ctx: ClientContext, version: string): void {
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'current-version',
    order: 100,
    priority: -100,
    locale: 'settings',
    inject: (): DesktopVersionInjected => ({ version }),
  }, DesktopCurrentVersionRow))
}
