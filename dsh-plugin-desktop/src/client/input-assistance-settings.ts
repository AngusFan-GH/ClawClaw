import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
type EnabledForm = ConfigForm<{ enabled: boolean }>
const confirmedSources = new WeakMap<EnabledForm, EnabledForm>()
export function trackConfirmedInputSetting(view: EnabledForm, source: EnabledForm): EnabledForm {
  confirmedSources.set(view, source)
  return view
}
/** Disable immediately, but do not bill a call before the Host confirms enabling. */
export function inputSettingEnabled(form: EnabledForm | undefined): boolean {
  if (form?.getSnapshot().value?.enabled !== true) return false
  const source = confirmedSources.get(form)
  return source === undefined || source.getSnapshot().value?.enabled === true
}
