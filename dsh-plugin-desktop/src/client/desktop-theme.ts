/** Product accents are independent of the host's monochrome brand color.
 * Neutrals and semantic status colors continue to follow the host appearance.
 * Both html and body markers are used by supported DSH hosts and portal roots.
 */
export const DESKTOP_THEME_CSS = `
:root{--dsh-color-primary:#1677ff;--dsh-color-primary-hover:#4096ff;--dsh-color-primary-active:#0958d9;--dsh-color-accent:#0958d9;--dsh-color-on-primary:#fff;--dsh-color-logo-surface:#fff}
:root[data-ds-dark-theme],body[data-ds-dark-theme]{--dsh-color-primary:#1668dc;--dsh-color-primary-hover:#3c89e8;--dsh-color-primary-active:#1554ad;--dsh-color-accent:#69b1ff}
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
