const STYLE_ID = 'clawclaw-channel-overview'

export const CSS = `
/* Fallback accents also support this package outside the desktop shell. */
.ccChannels,.ccChannelDetail{--cc-channel-primary:var(--dsh-color-primary,#1677ff);--cc-channel-accent:var(--dsh-color-accent,#0958d9)}
[data-ds-dark-theme] .ccChannels,[data-ds-dark-theme] .ccChannelDetail{--cc-channel-primary:var(--dsh-color-primary,#1668dc);--cc-channel-accent:var(--dsh-color-accent,#69b1ff)}
.ccChannelDetail .dim-page{--dim-blue:var(--cc-channel-accent);--dsw-alias-state-business-primary:var(--cc-channel-primary)}

.dim-directoryPathField { position: relative; min-width: 0; }
.dim-directoryPathField .dim-directoryPathInput { width: 100%; box-sizing: border-box; padding-left: 38px; }
.dim-directoryPathControl .ccDirectoryNativePicker { position: absolute; top: 1px; left: 1px; display: grid; place-items: center; width: 36px; min-height: 36px; padding: 0; border: 0; border-radius: 7px 0 0 7px; background: transparent; color: var(--dsw-alias-label-secondary, #686d76); }
.ccDirectoryNativePicker svg { width: 18px; height: 18px; }
.ccChannels { width: min(100%, 880px); padding: 2px 0 36px; color: var(--dsw-alias-label-primary, #16181d); }
.ccChannelsHeader { margin-bottom: 24px; }
.ccChannelsHeader h2, .ccChannelsSection h3 { margin: 0; letter-spacing: 0; }
.ccChannelsHeader h2 { font-size: 22px; line-height: 1.35; font-weight: 600; }
.ccChannelsHeader p, .ccChannelsSectionHeader p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary, #686d76); font-size: 13px; line-height: 1.6; }
.ccChannelsSection { padding-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1, #eceef1); }
.ccChannelsSection + .ccChannelsSection { margin-top: 24px; }
.ccChannelsSectionHeader { margin-bottom: 12px; }
.ccChannelsSectionHeader h3 { font-size: 16px; line-height: 1.4; font-weight: 600; }
.ccChannelsEmpty { padding: 24px; border: 1px dashed var(--dsw-alias-border-l2, #dfe2e7); border-radius: 8px; color: var(--dsw-alias-label-secondary, #686d76); font-size: 16px; }
.ccChannelsGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ccChannelCard { min-width: 0; min-height: 88px; display: grid; grid-template-columns: 44px minmax(0, 1fr) 18px; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; text-align: left; cursor: pointer; transition: border-color .15s ease, background-color .15s ease; }
.ccChannelCard:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2, #b9bec7); background: var(--dsw-alias-interactive-bg-hover, #fafafa); }
.ccChannelCard:disabled { cursor: default; opacity: .68; }
.ccChannelCard:disabled:hover { border-color: var(--dsw-alias-border-l2, #e5e7eb); background: var(--dsw-alias-bg-layer-1, #fff); }
.ccChannelCard:focus-visible { outline: 2px solid var(--cc-channel-accent); outline-offset: 2px; }
.ccChannelLogo { box-sizing: border-box; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 7px; background: var(--dsh-color-logo-surface, #fff); border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.ccChannelLogo img, .ccChannelLogo svg { display: block; width: 32px; height: 32px; object-fit: contain; }
.ccChannelCopy { min-width: 0; }
.ccChannelCopy strong { display: block; margin-bottom: 3px; font-size: 15px; line-height: 1.3; }
.ccChannelCopy p { margin: 0; overflow: hidden; color: var(--dsw-alias-label-secondary, #686d76); font-size: 13px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.ccChannelState { display: flex; align-items: center; gap: 6px; margin-top: 5px; color: var(--dsw-alias-label-secondary, #686d76); font-size: 12px; line-height: 1.25; }
.ccChannelDot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #8f959e); }
.ccChannelDot[data-state="connected"] { background: var(--dsw-alias-state-success-primary, #16a36a); }
.ccChannelDot[data-state="connecting"] { background: var(--dsw-alias-state-warn-primary, #e3a008); }
.ccChannelDot[data-state="offline"], .ccChannelDot[data-state="error"] { background: var(--dsw-alias-state-error-primary, #dc5a5a); }
.ccChannelArrow { color: var(--dsw-alias-label-secondary, #686d76); font-size: 24px; font-weight: 300; line-height: 1; }
.ccChannelDetailHeader { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
.ccChannelBack { border: 1px solid var(--dsw-alias-border-l2, #dfe2e7); border-radius: 7px; padding: 8px 12px; background: transparent; color: inherit; cursor: pointer; font-size: 15px; }
.ccChannelDetailTitle { margin: 0; font-size: 24px; letter-spacing: 0; }
.ccChannelModes { display: inline-flex; margin-left: auto; padding: 3px; border: 1px solid var(--dsw-alias-border-l2, #dfe2e7); border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover, #f5f6f7); }
.ccChannelModes button { min-height: 32px; padding: 5px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #686d76); cursor: pointer; font: inherit; font-size: 14px; }
.ccChannelModes button[data-active="true"] { background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #16181d); box-shadow: 0 1px 3px rgb(0 0 0 / 10%); }
.ccChannelModes button:focus-visible { outline: 2px solid var(--cc-channel-accent); outline-offset: 1px; }
.ccChannelDetail .dim-title, .ccChannelDetail .dim-rail, .ccChannelDetail .dim-divider { display: none !important; }
.ccChannelDetail .dim-layout { display: block !important; }
.ccChannelDetail .dim-panel { width: 100% !important; max-width: none !important; padding: 0 !important; }
@media (max-width: 760px) {
  .ccChannelsGrid { grid-template-columns: minmax(0, 1fr); }
  .ccChannelCard { min-height: 88px; padding: 14px 16px; }
  .ccChannelDetailHeader { align-items: flex-start; flex-wrap: wrap; }
  .ccChannelModes { width: 100%; margin-left: 0; }
  .ccChannelModes button { flex: 1; }
}
`

export function installClawClawChannelStyles() {
  if (document.getElementById(STYLE_ID)) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
  return () => style.remove()
}
