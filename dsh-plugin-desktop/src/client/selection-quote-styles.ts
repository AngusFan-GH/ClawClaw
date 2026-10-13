const STYLE_ID = 'clawclaw-selection-quote-styles'

export function installSelectionQuoteStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.clawSelectionQuoteToolbar {
  position: fixed;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  box-sizing: border-box;
  max-width: calc(100vw - 16px);
  overflow-x: auto;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, #171717);
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .14));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .14);
}
.clawSelectionQuoteToolbar button,
.clawSelectionQuoteCard button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0;
}
.clawSelectionQuoteToolbar button { min-height: 30px; padding: 5px 9px; font-size: 12px; }
.clawSelectionQuoteToolbar button:hover,
.clawSelectionQuoteCard button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)); }
.clawSelectionQuoteToolbar button:focus-visible,
.clawSelectionQuoteCard button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #2563eb); outline-offset: 1px; }
.clawSelectionQuoteToolbar svg { width: 14px; height: 14px; flex: none; }
.clawSelectionQuoteOverlay { display: contents; }
.clawSelectionQuoteDivider { width: 1px; height: 18px; background: var(--dsw-alias-border-l2, rgba(0, 0, 0, .14)); }
.clawSelectionQuotePrimary { color: var(--dsw-alias-state-business-primary, #2563eb) !important; }
[data-composer-chip="desktop-selection-quote"] { position: absolute !important; width: 0 !important; height: 0 !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }
[data-composer-card].clawSelectionQuoteComposer { padding-top: calc(12px + var(--claw-selection-quote-height)); }
.clawSelectionQuoteCards {
  position: absolute;
  top: 8px;
  left: 12px;
  right: 12px;
  display: grid;
  gap: 6px;
  max-height: 132px;
  overflow-y: auto;
}
.clawSelectionQuoteCard,
.clawSelectionQuoteHistoryCard {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: start;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .09));
  border-left: 3px solid var(--dsw-alias-state-business-primary, #2563eb);
  border-radius: 6px;
  color: var(--dsw-alias-label-primary, #171717);
  background: var(--dsw-alias-bg-layer-2, #f7f7f7);
}
.clawSelectionQuoteCard > svg,
.clawSelectionQuoteHistoryCard > svg { width: 15px; height: 15px; margin-top: 2px; color: var(--dsw-alias-state-business-primary, #2563eb); }
.clawSelectionQuoteCard span,
.clawSelectionQuoteHistoryCard span { display: block; color: var(--dsw-alias-label-caption, #777); font-size: 11px; line-height: 16px; }
.clawSelectionQuoteCard p,
.clawSelectionQuoteHistoryCard p { display: -webkit-box; margin: 1px 0 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; white-space: pre-wrap; }
.clawSelectionQuoteCard button { width: 26px; height: 26px; padding: 0; color: var(--dsw-alias-label-secondary, #666); }
.clawSelectionQuoteCard button svg { width: 14px; height: 14px; }
.clawSelectionQuoteHistoryRow { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; width: 100%; }
.clawSelectionQuoteHistoryStack { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; max-width: min(80%, 720px); }
.clawSelectionQuoteHistoryCards { display: grid; gap: 6px; width: min(100%, 520px); }
.clawSelectionQuoteHistoryCard { grid-template-columns: 18px minmax(0, 1fr); width: 100%; background: var(--dsw-specific-input-major, #f7f7f7); }
.clawSelectionQuoteHistoryLink { grid-template-columns: 18px minmax(0, 1fr) 18px; border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .09)); font: inherit; letter-spacing: 0; text-align: left; cursor: pointer; }
.clawSelectionQuoteHistoryLink:hover { background: var(--dsw-alias-interactive-bg-hover-solid, #f0f0f0); }
.clawSelectionQuoteHistoryLink:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #2563eb)); outline-offset: 2px; }
.clawSelectionQuoteLocateIcon { align-self: center; color: var(--dsw-alias-label-tertiary, #777) !important; }
.clawSelectionQuoteHistoryBubble { box-sizing: border-box; max-width: 100%; padding: 10px 14px; border-radius: 8px; color: var(--dsw-alias-label-primary, #171717); background: var(--dsw-alias-bg-layer-2, #f2f3f5); white-space: pre-wrap; overflow-wrap: anywhere; }
.clawSelectionQuoteHistoryAttachments { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.clawSelectionQuoteFile { display: flex; align-items: center; gap: 7px; max-width: 260px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.09)); border-radius: 6px; font-size: 12px; }
.clawSelectionQuoteFile svg { width: 18px; height: 18px; flex: none; }
.clawSelectionQuoteReferenceSummary { color: var(--dsw-alias-label-tertiary, #777); font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 18px; }
.clawSelectionQuoteHistoryActions { display: flex; align-items: center; gap: 8px; height: 28px; color: var(--dsw-alias-label-tertiary, #777); }
.clawSelectionQuoteHistoryActions time { margin-right: 12px; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 24px; white-space: nowrap; }
.clawSelectionQuoteHistoryActions button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 6px; border: 0; border-radius: var(--dsw-radius-sm, 6px); color: inherit; background: transparent; cursor: pointer; }
.clawSelectionQuoteHistoryActions button:hover { color: var(--dsw-alias-label-secondary, #555); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
.clawSelectionQuoteHistoryActions button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #2563eb)); outline-offset: 1px; }
.clawSelectionQuoteHistoryActions svg { width: 15px; height: 15px; }
.clawSelectionQuoteSourceMark { border-radius: 2px; color: inherit; background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 16%, transparent); box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 55%, transparent); }
.clawSelectionQuoteSourceFlash { animation: claw-selection-quote-flash 1.5s ease-out; }
@keyframes claw-selection-quote-flash {
  0%, 30% { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 36%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 18%, transparent); }
  100% { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 16%, transparent); box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 55%, transparent); }
}
@media (hover: hover) {
  :is([data-chat-flow-kind='user'], [data-chat-flow-kind='steering']):has(~ :is([data-chat-flow-kind='user'], [data-chat-flow-kind='steering'])) .clawSelectionQuoteHistoryActions { opacity: 0; transition: opacity 80ms ease; }
  :is([data-chat-flow-kind='user'], [data-chat-flow-kind='steering']):has(~ :is([data-chat-flow-kind='user'], [data-chat-flow-kind='steering'])):is(:hover, :focus-within) .clawSelectionQuoteHistoryActions { opacity: 1; }
}
body[data-ds-dark-theme] .clawSelectionQuoteToolbar { box-shadow: 0 8px 24px rgba(0, 0, 0, .4); }
.clawSelectionSideChat { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; font-family: var(--dsw-font-family); letter-spacing: 0; }
.clawSelectionSideChatDraft {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: flex-end;
  min-width: 0;
  min-height: 0;
  padding: 0 8px 4px;
  box-sizing: border-box;
}
.clawSelectionSideChatDraftComposer {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: none;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  padding-top: 8px;
  border: 0;
  border-radius: var(--dsw-radius-panel, 28px);
  color: var(--dsw-alias-label-primary, #171717);
  background: var(--dsw-specific-input-major, #fff);
  box-shadow: var(--dsw-elevation-soft, 0 4px 18px rgba(0, 0, 0, .06));
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
}
.clawSelectionSideChatDraftQuote {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  margin: 0 12px;
  padding: 6px 8px;
  border-left: 3px solid var(--dsw-alias-state-business-primary, #2563eb);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2, #f7f7f7);
}
.clawSelectionSideChatDraftQuote > svg { width: 15px; height: 15px; margin-top: 2px; color: var(--dsw-alias-state-business-primary, #2563eb); }
.clawSelectionSideChatDraftQuote span { color: var(--dsw-alias-label-caption, #777); font-size: 11px; line-height: 16px; }
.clawSelectionSideChatDraftQuote p { display: -webkit-box; margin: 1px 0 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; white-space: pre-wrap; }
.clawSelectionSideChatDraft textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  max-height: 180px;
  margin: 0;
  padding: 4px 12px 0 14px;
  resize: none;
  overflow-y: auto;
  border: 0;
  outline: 0;
  color: var(--dsw-alias-label-primary, #171717);
  background: transparent;
  font-family: var(--dsw-font-family);
  font-size: inherit;
  line-height: inherit;
  letter-spacing: 0;
  caret-color: var(--dsw-alias-state-business-primary, #2563eb);
}
.clawSelectionSideChatDraft textarea::placeholder { color: var(--dsw-alias-label-tertiary, #929292); }
.clawSelectionSideChatDraftActions { display: flex; justify-content: flex-end; min-height: 34px; padding: 2px 8px 6px; }
.clawSelectionSideChatDraftSend {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: #fff;
  background: var(--dsw-alias-button-info-fill, #3964fe);
  cursor: pointer;
  transform: translateY(-2px);
  transition: background-color 100ms ease;
}
.clawSelectionSideChatDraftSend:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, #3158e6); }
.clawSelectionSideChatDraftSend:disabled { opacity: .42; cursor: default; }
.clawSelectionSideChatDraftSend:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #2563eb); outline-offset: 2px; }
.clawSelectionSideChatDraftSend svg { width: 16px; height: 16px; }
.clawSelectionSideChatSpinner { animation: claw-selection-sidechat-spin .8s linear infinite; }
.clawSelectionSideChatDraftError { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 14px; color: var(--dsw-alias-label-error, #b42318); font-size: 12px; line-height: 18px; }
.clawSelectionSideChatDraftError button,
.clawSelectionSideChatExpired button { display: inline-flex; align-items: center; gap: 5px; padding: 4px 7px; border: 0; border-radius: 6px; color: inherit; background: transparent; cursor: pointer; font: inherit; letter-spacing: 0; }
.clawSelectionSideChatDraftError button:hover,
.clawSelectionSideChatExpired button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)); }
.clawSelectionSideChatDraftError svg { width: 13px; height: 13px; }
.clawSelectionSideChatExpired { display: grid; place-content: center; gap: 10px; width: 100%; height: 100%; padding: 24px; box-sizing: border-box; color: var(--dsw-alias-label-secondary, #666); text-align: center; }
.clawSelectionSideChatExpired p { margin: 0; }
.clawSelectionSideChatTabTitle { display: block; min-width: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* A running continuable selection child uses one primary action in the narrow
   Sidebar: Stop. Its Send action returns after streaming has finished. */
[data-sidebar-chat] [data-conversation-session^='selection-sidechat-'] [data-composer-card]
  div:has(> button:nth-of-type(2)) > button:last-of-type { display: none; }
@keyframes claw-selection-sidechat-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .clawSelectionQuoteSourceFlash,
  .clawSelectionSideChatSpinner { animation: none; }
}
@media (max-width: 640px) {
  .clawSelectionQuoteHistoryStack { max-width: 92%; }
  .clawSelectionQuoteCards { left: 8px; right: 8px; }
}
`
  document.head.append(style)
}
