const STYLE_ID = 'clawclaw-channel-overview'

const CSS = `
.dim-directoryPathField { position: relative; min-width: 0; }
.dim-directoryPathField .dim-directoryPathInput { width: 100%; box-sizing: border-box; padding-left: 38px; }
.dim-directoryPathControl .ccDirectoryNativePicker { position: absolute; top: 1px; left: 1px; display: grid; place-items: center; width: 36px; min-height: 36px; padding: 0; border: 0; border-radius: 7px 0 0 7px; background: transparent; color: var(--dsw-alias-content-secondary, #686d76); }
.ccDirectoryNativePicker svg { width: 18px; height: 18px; }
.ccChannels { width: min(100%, 880px); padding: 2px 0 36px; color: var(--dsw-alias-content-primary, #16181d); }
.ccChannelsHeader { margin-bottom: 24px; }
.ccChannelsHeader h2, .ccChannelsSection h3 { margin: 0; letter-spacing: 0; }
.ccChannelsHeader h2 { font-size: 22px; line-height: 1.35; font-weight: 600; }
.ccChannelsHeader p, .ccChannelsSectionHeader p { margin: 6px 0 0; color: var(--dsw-alias-content-secondary, #686d76); font-size: 13px; line-height: 1.6; }
.ccChannelsSection { padding-top: 20px; border-top: 1px solid var(--dsw-alias-border-subtle, #eceef1); }
.ccChannelsSection + .ccChannelsSection { margin-top: 24px; }
.ccChannelsSectionHeader { margin-bottom: 12px; }
.ccChannelsSectionHeader h3 { font-size: 16px; line-height: 1.4; font-weight: 600; }
.ccChannelsEmpty { padding: 24px; border: 1px dashed var(--dsw-alias-border-default, #dfe2e7); border-radius: 8px; color: var(--dsw-alias-content-secondary, #686d76); font-size: 16px; }
.ccChannelsGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ccChannelCard { min-width: 0; min-height: 88px; display: grid; grid-template-columns: 44px minmax(0, 1fr) 18px; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-default, #e5e7eb); border-radius: 8px; background: var(--dsw-alias-background-primary, #fff); color: inherit; text-align: left; cursor: pointer; transition: border-color .15s ease, background-color .15s ease; }
.ccChannelCard:hover { border-color: var(--dsw-alias-border-emphasis, #b9bec7); background: var(--dsw-alias-background-secondary, #fafafa); }
.ccChannelCard:disabled { cursor: default; opacity: .68; }
.ccChannelCard:disabled:hover { border-color: var(--dsw-alias-border-default, #e5e7eb); background: var(--dsw-alias-background-primary, #fff); }
.ccChannelCard:focus-visible { outline: 2px solid var(--dsw-alias-interactive-primary, #326cf4); outline-offset: 2px; }
.ccChannelLogo { box-sizing: border-box; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 7px; color: #fff; }
.ccChannelLogo svg { width: 30px; height: 30px; }
.ccChannelLogo[data-tone="feishu"] { background: #fff; border: 1px solid var(--dsw-alias-border-default, #e5e7eb); }
.ccChannelLogo[data-tone="feishu"] svg { width: 38px; height: 38px; }
.ccChannelLogo[data-tone="dingtalk"] { background: #1684fc; }
.ccChannelLogo[data-tone="wecom"] { background: #fff; border: 1px solid var(--dsw-alias-border-default, #e5e7eb); }
.ccChannelLogo[data-tone="wecom"] svg { width: 32px; height: 32px; }
.ccChannelLogo[data-tone="weixin"] { background: #09c866; }
.ccChannelLogo[data-tone="slack"] { background: #4a154b; }
.ccChannelLogo[data-tone="telegram"] { background: #229ed9; }
.ccChannelLogo[data-tone="discord"] { background: #5865f2; }
.ccChannelLogo[data-tone="imessage"] { background: #35c759; }
.ccChannelLogo[data-tone="office"] { background: #167d8d; }
.ccChannelLogo[data-tone="qq"] { background: #1681e8; }
.ccChannelLogo[data-tone="whatsapp"] { background: #25d366; }
.ccChannelCopy { min-width: 0; }
.ccChannelCopy strong { display: block; margin-bottom: 3px; font-size: 15px; line-height: 1.3; }
.ccChannelCopy p { margin: 0; overflow: hidden; color: var(--dsw-alias-content-secondary, #686d76); font-size: 13px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.ccChannelState { display: flex; align-items: center; gap: 6px; margin-top: 5px; color: var(--dsw-alias-content-secondary, #686d76); font-size: 12px; line-height: 1.25; }
.ccChannelDot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #d9dce1; }
.ccChannelDot[data-state="connected"] { background: #16a36a; }
.ccChannelDot[data-state="connecting"] { background: #e3a008; }
.ccChannelDot[data-state="offline"], .ccChannelDot[data-state="error"] { background: #dc5a5a; }
.ccChannelArrow { color: var(--dsw-alias-content-secondary, #686d76); font-size: 24px; font-weight: 300; line-height: 1; }
.ccChannelDetailHeader { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
.ccChannelBack { border: 1px solid var(--dsw-alias-border-default, #dfe2e7); border-radius: 7px; padding: 8px 12px; background: transparent; color: inherit; cursor: pointer; font-size: 15px; }
.ccChannelDetailTitle { margin: 0; font-size: 24px; letter-spacing: 0; }
.ccChannelModes { display: inline-flex; margin-left: auto; padding: 3px; border: 1px solid var(--dsw-alias-border-default, #dfe2e7); border-radius: 8px; background: var(--dsw-alias-background-secondary, #f5f6f7); }
.ccChannelModes button { min-height: 32px; padding: 5px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-content-secondary, #686d76); cursor: pointer; font: inherit; font-size: 14px; }
.ccChannelModes button[data-active="true"] { background: var(--dsw-alias-background-primary, #fff); color: var(--dsw-alias-content-primary, #16181d); box-shadow: 0 1px 3px rgb(0 0 0 / 10%); }
.ccChannelModes button:focus-visible { outline: 2px solid var(--dsw-alias-interactive-primary, #326cf4); outline-offset: 1px; }
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
