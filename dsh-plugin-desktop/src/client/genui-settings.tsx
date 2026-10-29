import { useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { GENUI_ENTRY, type GenuiSettings } from '../genui-contract.ts'

export const GENUI_SETTINGS_ZH = {
  title: '可视化回答',
  description: '在对话中用卡片、表格、图表和交互内容展示回答。关闭后显示文字结果。',
  failed: '未能保存设置，请重试。',
}
export const GENUI_SETTINGS_EN: Record<keyof typeof GENUI_SETTINGS_ZH, string> = {
  title: 'Visual responses',
  description: 'Display responses in chat with cards, tables, charts and interactive content. Turn off to show text results.',
  failed: 'Could not save this setting. Please try again.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.genui': keyof typeof GENUI_SETTINGS_ZH }
}

export function GenuiSettingsRow({ settings, t }: {
  settings: ConfigForm<GenuiSettings>
  t: (key: keyof typeof GENUI_SETTINGS_ZH) => string
}) {
  const snapshot = useSyncExternalStore(listener => settings.subscribe(listener), () => settings.getSnapshot(), () => settings.getSnapshot())
  const pending = useRef(false)
  const [requested, setRequested] = useState<boolean>()
  const busy = requested !== undefined
  const [failed, setFailed] = useState(false)
  if (snapshot.status !== 'ready' || snapshot.value === undefined) return null
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
    padding: '16px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l2)' }} aria-busy={busy}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, lineHeight: '20px' }}>{t('title')}</div>
      <div style={{ marginTop: 4, color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px' }}>{t('description')}</div>
      {failed && <div role="alert" style={{ marginTop: 4, fontSize: 12, lineHeight: '18px',
        color: 'var(--dsw-alias-state-error-primary)' }}>{t('failed')}</div>}
    </div>
    <Switch label={t('title')} checked={requested ?? snapshot.value.enabled} disabled={busy || !snapshot.writable}
      onChange={enabled => {
        if (pending.current) return
        pending.current = true
        setRequested(enabled)
        setFailed(false)
        void (async () => {
          try { if (!await settings.set('enabled', enabled)) setFailed(true) }
          catch { setFailed(true) }
          finally { pending.current = false; setRequested(undefined) }
        })()
      }} />
  </div>
}

/** The General settings row edits the same confirmed Host preference as rendering. */
export function applyGenuiSettings(ctx: Context): void {
  ctx.inject(['slots', 'configForms', 'locale'], scope => {
    const settings = scope.configForms.get<GenuiSettings>(GENUI_ENTRY)
    scope.effect(() => scope.locale.register('desktop.genui', { zh: GENUI_SETTINGS_ZH, en: GENUI_SETTINGS_EN }), 'desktop: GenUI settings locale')
    scope.slots.inject('settings.general.item', () => scope.slots.register({
      name: 'settings.general.item', id: GENUI_ENTRY, order: 35, locale: 'desktop.genui',
      inject: () => ({ settings }),
    }, GenuiSettingsRow))
  })
}
