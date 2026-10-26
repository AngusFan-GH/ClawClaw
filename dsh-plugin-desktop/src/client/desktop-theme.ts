/** Product accents are independent of the host's monochrome brand color.
 * Neutrals and semantic status colors continue to follow the host appearance.
 * Both html and body markers are used by supported DSH hosts and portal roots.
 */
export const DESKTOP_UI_METRICS = Object.freeze({ controlHeight: 36, controlRadius: 8, cardRadius: 12, dialogRadius: 16, controlFontSize: 13 })
export const DESKTOP_ACTION_COLORS = Object.freeze({ primary: '#1668dc', hover: '#1b6fde', active: '#0958d9' })

export const DESKTOP_THEME_CSS = `
:root{--dsh-color-primary:${DESKTOP_ACTION_COLORS.primary};--dsh-color-primary-hover:${DESKTOP_ACTION_COLORS.hover};--dsh-color-primary-active:${DESKTOP_ACTION_COLORS.active};--dsh-color-accent:#0958d9;--dsh-color-on-primary:#fff;--dsh-color-logo-surface:#fff}
:root{--dsh-control-height:${DESKTOP_UI_METRICS.controlHeight}px;--dsh-control-radius:${DESKTOP_UI_METRICS.controlRadius}px;--dsh-card-radius:${DESKTOP_UI_METRICS.cardRadius}px;--dsh-dialog-radius:${DESKTOP_UI_METRICS.dialogRadius}px;--dsh-control-font-size:${DESKTOP_UI_METRICS.controlFontSize}px;--dsh-page-title-size:22px;--dsh-section-title-size:14px;--dsh-page-width:1120px;--dsh-form-width:880px;--dsh-space-1:4px;--dsh-space-2:8px;--dsh-space-3:12px;--dsh-space-4:16px;--dsh-space-6:24px;--dsh-space-8:32px;--dsh-card-shadow:none;--dsh-card-hover-shadow:0 2px 8px #0000000a;--dsh-duration-fast:150ms}
:root[data-ds-dark-theme],body[data-ds-dark-theme]{--dsh-color-accent:#69b1ff}
/* Published DSH controls in General, Models and Plugins consume these host
 * tokens rather than desktop tokens. Bind them at the control, so its own
 * appearance and portal location resolve against the current theme. Keep
 * host branding and neutral surfaces outside controls unchanged.
 */
:where(button,[role="button"],[role="switch"],[role="checkbox"],[role="radio"],input[type="checkbox"],input[type="radio"]){
  --dsw-alias-brand-primary:var(--dsh-color-primary);
  --dsw-alias-button-primary-fill:var(--dsh-color-primary);
  --dsw-alias-button-primary-hover:var(--dsh-color-primary-hover);
  --dsw-alias-label-primary-foreground:var(--dsh-color-on-primary);
  --dsw-focus-ring-color:var(--dsh-color-accent);
  --dsw-radius-md:var(--dsh-control-radius);
}
:where([role="dialog"]){--dsw-radius-panel:var(--dsh-dialog-radius)}
:where(.dshIntegrations,.dshDesktopSettings,.aag-section,.ccChannels,.ccChannelDetail){scrollbar-color:var(--dsw-alias-label-tertiary) transparent}
:where(.dshIntegrations,.dshDesktopSettings,.aag-section,.ccChannels,.ccChannelDetail) :where(button,input,textarea,select,[tabindex]):focus-visible{outline:2px solid var(--dsh-color-accent);outline-offset:2px}
@media(prefers-reduced-motion:reduce){
 :where(.dshIntegrations,.dshDesktopSettings,.aag-section,.ccChannels,.ccChannelDetail) :where(button,input,textarea,select,svg){transition:none!important;animation:none!important}
}
`

const STYLE_ID = 'clawclaw-desktop-theme'

export function installDesktopTheme(document: Document = globalThis.document): () => void {
  if (document.getElementById(STYLE_ID)) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = DESKTOP_THEME_CSS
  document.head.append(style)
  return () => { style.remove() }
}
