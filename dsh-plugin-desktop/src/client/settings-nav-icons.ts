/** Semantic icons for settings pages that the upstream shell treats as unknown ids. */

const STYLE_ID = 'dsh-desktop-settings-nav-icons'
const ICON_ATTRIBUTE = 'data-dsh-settings-icon'

export type DesktopSettingsNavIcon = 'marketplace' | 'skill' | 'mcp' | 'schedule'

export interface DesktopSettingsNavIconEntry {
  readonly icon: DesktopSettingsNavIcon
  readonly labels: readonly string[]
}

const CSS = `
[role=dialog] nav button[${ICON_ATTRIBUTE}]>svg{display:none}
[role=dialog] nav button[${ICON_ATTRIBUTE}]::before{content:"";display:block;flex:0 0 16px;width:16px;height:16px;background:currentColor;mask-position:center;mask-repeat:no-repeat;mask-size:16px 16px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;-webkit-mask-size:16px 16px}
[role=dialog] nav button[${ICON_ATTRIBUTE}=marketplace]::before{mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66 4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66 4.24-4.24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3Crect x='9' y='9' width='6' height='6' rx='1.5' fill='black'/%3E%3C/svg%3E");-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66 4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66 4.24-4.24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3Crect x='9' y='9' width='6' height='6' rx='1.5' fill='black'/%3E%3C/svg%3E")}
[role=dialog] nav button[${ICON_ATTRIBUTE}=skill]::before{mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 2h9l3 3v8.5a6 6 0 0 0-7.5 7.5H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm2 5h6M8 11h4' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='m18 15 .7 1.8L20.5 18l-1.8.7L18 20.5l-.7-1.8-1.8-.7 1.8-.7L18 15Z' fill='black'/%3E%3C/svg%3E");-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 2h9l3 3v8.5a6 6 0 0 0-7.5 7.5H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm2 5h6M8 11h4' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='m18 15 .7 1.8L20.5 18l-1.8.7L18 20.5l-.7-1.8-1.8-.7 1.8-.7L18 15Z' fill='black'/%3E%3C/svg%3E")}
[role=dialog] nav button[${ICON_ATTRIBUTE}=mcp]::before{mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='4' width='18' height='6' rx='2' fill='none' stroke='black' stroke-width='2'/%3E%3Crect x='3' y='14' width='18' height='6' rx='2' fill='none' stroke='black' stroke-width='2'/%3E%3Ccircle cx='7' cy='7' r='1' fill='black'/%3E%3Ccircle cx='7' cy='17' r='1' fill='black'/%3E%3Cpath d='M11 7h6M11 17h6' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E");-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='4' width='18' height='6' rx='2' fill='none' stroke='black' stroke-width='2'/%3E%3Crect x='3' y='14' width='18' height='6' rx='2' fill='none' stroke='black' stroke-width='2'/%3E%3Ccircle cx='7' cy='7' r='1' fill='black'/%3E%3Ccircle cx='7' cy='17' r='1' fill='black'/%3E%3Cpath d='M11 7h6M11 17h6' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E")}
[role=dialog] nav button[${ICON_ATTRIBUTE}=schedule]::before{mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m6 3-3 3m15-3 3 3M7 20l-1 2m11-2 1 2' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3Ccircle cx='12' cy='13' r='7' fill='none' stroke='black' stroke-width='2'/%3E%3Cpath d='M12 9v4l3 2' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m6 3-3 3m15-3 3 3M7 20l-1 2m11-2 1 2' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3Ccircle cx='12' cy='13' r='7' fill='none' stroke='black' stroke-width='2'/%3E%3Cpath d='M12 9v4l3 2' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
`

/** Decorate the settings shell without coupling Desktop to its private CSS modules. */
export function installSemanticSettingsNavIcons(
  entries: readonly DesktopSettingsNavIconEntry[],
  document: Document = globalThis.document,
): () => void {
  const labels = new Map(entries.flatMap(entry => entry.labels.map(label => [label, entry.icon] as const)))
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
  const scan = (): void => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[role="dialog"] nav button')) {
      const label = button.querySelector('span')?.textContent?.trim()
      const icon = label === undefined ? undefined : labels.get(label)
      if (icon === undefined) button.removeAttribute(ICON_ATTRIBUTE)
      else button.setAttribute(ICON_ATTRIBUTE, icon)
    }
  }
  const Observer = document.defaultView?.MutationObserver ?? globalThis.MutationObserver
  const observer = new Observer(scan)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  scan()
  return () => { observer.disconnect(); style.remove() }
}
