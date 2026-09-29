/** Place the selected plugin market inside the rc.2 Plugins manager. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'

export const DESKTOP_MARKET_INTEGRATION_LOCALE_NAMESPACE = 'desktop.market-integration'

export interface DesktopMarketControl {
  readonly version: 1
  setSettingsVisible(visible: boolean): void
  settingsVisible(): boolean
  render(props?: { readonly preferredSubsectionId?: string }): unknown
}

interface MarketIntegrationInjected { readonly market: DesktopMarketControl }
type MarketIntegrationProps = PropsRuntime<'plugins.item'>
  & PropsLocale<'desktop.market-integration'>
  & InjectFace<MarketIntegrationInjected>

const zh = {
  label: '插件市场',
  summary: '发现、搜索并安装社区插件。',
} as const

type MarketIntegrationLocaleKey = keyof typeof zh

const en: Record<MarketIntegrationLocaleKey, string> = {
  label: 'Plugin Marketplace',
  summary: 'Discover, search, and install community plugins.',
}

function PluginMarketplace({ view, market, t }: MarketIntegrationProps): ReactNode {
  if (view === 'summary') return t('summary')
  return market.render() as ReactNode
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional market UI published by the selected Desktop market bundle. */
    market: DesktopMarketControl
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop.market-integration': MarketIntegrationLocaleKey
  }
}

/** Register the market only when the selected provider publishes its client service. */
export function applyMarketIntegration(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(DESKTOP_MARKET_INTEGRATION_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: market integration dictionaries',
  )
  ctx.inject(['market'], (scope: ClientContext) => {
    scope.effect(() => {
      scope.market.setSettingsVisible(false)
      return () => { scope.market.setSettingsVisible(true) }
    }, 'dsh-plugin-desktop: move market out of Settings')
    scope.slots.inject('plugins.item', () => scope.slots.register({
      name: 'plugins.item',
      id: 'desktop-marketplace',
      order: 0,
      label: () => scope.locale.bind(DESKTOP_MARKET_INTEGRATION_LOCALE_NAMESPACE)('label'),
      locale: DESKTOP_MARKET_INTEGRATION_LOCALE_NAMESPACE,
      inject: () => ({ market: scope.market }),
    }, PluginMarketplace))
  })
}
