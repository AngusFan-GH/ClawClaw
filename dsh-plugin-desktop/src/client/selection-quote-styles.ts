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
@media (prefers-reduced-motion: reduce) {
  .clawSelectionQuoteSourceFlash { animation: none; }
}
@media (max-width: 640px) {
  .clawSelectionQuoteHistoryStack { max-width: 92%; }
  .clawSelectionQuoteCards { left: 8px; right: 8px; }
}
.clawSideChat { display: grid; grid-template-rows: minmax(0,1fr) auto; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary, #171717); background: var(--dsw-alias-bg-base, #fff); }
.clawSideChatQuote span, .clawSideChatAnswerLabel span { color: var(--dsw-alias-label-tertiary, #777); font-size: 11px; line-height: 16px; }
.clawSideChatScroll { min-height: 0; overflow: auto; padding: 14px 14px 20px; }
.clawSideChatQuote { display: grid; grid-template-columns: 18px minmax(0,1fr); gap: 8px; padding: 10px 11px; border-left: 3px solid var(--dsw-alias-state-business-primary, #2563eb); border-radius: 4px; background: var(--dsw-specific-input-major, #f7f7f7); }
.clawSideChatQuote > svg, .clawSideChatAnswerLabel > svg { width: 15px; height: 15px; margin-top: 2px; color: var(--dsw-alias-state-business-primary, #2563eb); }
.clawSideChatQuote p, .clawSideChatError p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 20px; }
.clawSideChatSuggestions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
.clawSideChatSuggestions button, .clawSideChatError button { padding: 5px 9px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1)); border-radius: 6px; color: inherit; background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.clawSideChatSuggestions button:hover, .clawSideChatError button:hover, .clawSideChatAnswerLabel button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
.clawSideChatSuggestions button:focus-visible, .clawSideChatError button:focus-visible, .clawSideChatAnswerLabel button:focus-visible, .clawSideChat > form button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #2563eb)); outline-offset: 1px; }
.clawSideChatTurn { display: grid; gap: 8px; margin-top: 18px; }
.clawSideChatQuestion { justify-self: end; max-width: 86%; margin: 0; padding: 7px 10px; border-radius: 8px 8px 2px 8px; background: var(--dsw-alias-bg-layer-2, #eef2ff); font-size: 13px; line-height: 19px; }
.clawSideChatAnswer { padding: 10px 11px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.09)); border-radius: 7px; background: var(--dsw-alias-bg-base, #fff); }
.clawSideChatAnswerLabel { display: flex; align-items: center; gap: 6px; }
.clawSideChatAnswerLabel button { display: inline-flex; margin-left: auto; padding: 4px; border: 0; border-radius: 4px; color: var(--dsw-alias-label-tertiary, #777); background: transparent; cursor: pointer; }
.clawSideChatAnswerLabel button svg { width: 14px; height: 14px; }
.clawSideChatAnswerBody { margin-top: 5px; overflow-wrap: anywhere; }
.clawSideChatThinking { display: flex; align-items: center; gap: 4px; margin-top: 18px; color: var(--dsw-alias-label-secondary, #666); font-size: 12px; }
.clawSideChatThinking span { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: claw-sidechat-thinking 1.2s ease-in-out infinite; }
.clawSideChatThinking span:nth-child(2) { animation-delay: .15s; }.clawSideChatThinking span:nth-child(3) { margin-right: 4px; animation-delay: .3s; }
.clawSideChatError { margin-top: 16px; padding: 10px; border: 1px solid color-mix(in srgb, #dc2626 24%, transparent); border-radius: 6px; color: #b91c1c; background: color-mix(in srgb, #dc2626 6%, transparent); }
.clawSideChatError button { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; }.clawSideChatError button svg { width: 13px; height: 13px; }
.clawSideChat > form { margin: 0; padding: 10px 12px 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.09)); }
.clawSideChat > form textarea { box-sizing: border-box; width: 100%; min-height: 70px; resize: none; padding: 9px 10px; border: 0; outline: 0; color: inherit; background: transparent; font: inherit; font-size: 13px; line-height: 19px; }
.clawSideChat > form > div { display: flex; align-items: center; justify-content: flex-end; }
.clawSideChat > form button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: 6px; color: #fff; background: var(--dsw-alias-state-business-primary, #2563eb); cursor: pointer; }.clawSideChat > form button:disabled { opacity: .35; cursor: default; }.clawSideChat > form button svg { width: 15px; height: 15px; }
.clawSideChatEmpty { display: grid; place-content: center; justify-items: center; gap: 8px; height: 100%; padding: 24px; color: var(--dsw-alias-label-tertiary, #777); text-align: center; }.clawSideChatEmpty svg { width: 22px; height: 22px; }.clawSideChatEmpty p { margin: 0; font-size: 12px; line-height: 18px; }
@keyframes claw-sidechat-thinking { 0%,80%,100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
`
  document.head.append(style)
}
