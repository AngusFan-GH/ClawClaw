import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react'

/** Shared action semantics for catalogs, forms and their portalled dialogs. */
export function SettingsButton({ variant = 'secondary', className, type = 'button', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const base = variant === 'danger' ? 'dshIntegrationsDanger' : 'dshIntegrationsCommand'
  return <button type={type} className={[base, variant === 'primary' && 'dshCronPrimary', className].filter(Boolean).join(' ')} {...props} />
}

/** Empty and loading views share a readable layout without changing their actions. */
export function SettingsEmptyState({ children, title, icon, action, loading = false, className }: {
  children: ReactNode
  title?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  loading?: boolean
  className?: string
}) {
  return <div className={['dshIntegrationsEmpty', 'dshSettingsEmptyState', className].filter(Boolean).join(' ')}
    role={loading ? 'status' : undefined}>
    {loading && <span className="dshSettingsSpinner" aria-hidden="true" />}
    {icon}
    {title && <h3>{title}</h3>}
    <p>{children}</p>
    {action && <div className="dshSettingsEmptyActions">{action}</div>}
  </div>
}

/** Automatic tab activation follows the same keys as the expert library. */
export function moveSettingsTabFocus<T extends string>(event: KeyboardEvent<HTMLButtonElement>, values: readonly T[], current: T, select: (value: T) => void): void {
  const index = values.indexOf(current)
  let next: number
  if (event.key === 'ArrowRight') next = (index + 1) % values.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + values.length) % values.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = values.length - 1
  else return
  event.preventDefault()
  const value = values[next]
  if (value === undefined) return
  select(value)
  const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons?.[next]?.focus()
}

export function SettingsTabs<T extends string>({ id, label, value, items, onChange }: {
  id: string
  label: string
  value: T
  items: readonly { value: T; label: ReactNode }[]
  onChange: (value: T) => void
}) {
  return <div className="dshSettingsTabs" role="tablist" aria-label={label}>
    {items.map(item => <button key={item.value} type="button" role="tab" id={`${id}-${item.value}`}
      aria-controls={`${id}-panel`} aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1}
      onClick={() => { onChange(item.value) }} onKeyDown={event => { moveSettingsTabFocus(event, items.map(tab => tab.value), value, onChange) }}>
      {item.label}
    </button>)}
  </div>
}

export function SettingsIconButton({ label, disabled, danger, busy = false, onClick, children }: {
  label: string
  disabled?: boolean
  danger?: boolean
  busy?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return <button type="button" className="dshIntegrationsIconButton" data-danger={danger || undefined}
    data-busy={busy || undefined} aria-busy={busy || undefined}
    title={label} aria-label={label} disabled={disabled || busy} onClick={onClick}>{children}</button>
}

export function SettingsToggle({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return <button type="button" role="switch" className="dshIntegrationsToggle" aria-label={label}
    aria-checked={checked} disabled={disabled} onClick={() => { onChange(!checked) }}>
    <span aria-hidden="true" />
  </button>
}
