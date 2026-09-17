import type { ReactNode } from 'react'

export function SettingsIconButton({ label, disabled, danger, onClick, children }: {
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return <button type="button" className="dshIntegrationsIconButton" data-danger={danger || undefined}
    title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>
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
