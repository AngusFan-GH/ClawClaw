export const INPUT_ASSISTANCE_CSS = `
/* Generated inline content participates in the real paragraph's wrapping,
   auto-height and scrollport, while remaining outside editor text/history. */
.dshAiContinuationScope[data-claw-ai-continuation] [contenteditable="true"]:focus > p:last-child::after {
  content:var(--dsh-ai-continuation-text);
  content:var(--dsh-ai-continuation-text) / "";
  font:inherit; line-height:inherit; white-space:inherit; overflow-wrap:inherit; word-break:inherit;
  color:var(--dsw-alias-label-caption); pointer-events:none; user-select:none;
}
.dshAiOptimizeTrigger { flex:none; white-space:nowrap; }
.dshAiOptimizeTriggerLabel { display:var(--dsh-composer-model-text-display,inline); }
.dshAiOptimizeTrigger svg { width:14px; height:14px; flex:none; }
@container(max-width:560px) {
  .dshAiOptimizeTrigger { width:28px; padding:0; gap:0; }
  .dshAiOptimizeTriggerLabel { display:none; }
}
.dshAiOptimizeDialog { width:min(840px,100%); max-height:100%; min-height:0; padding-bottom:20px; }
.dshAiOptimizeDialogContent { min-height:0; overflow:auto; overscroll-behavior:contain; }
.dshAiOptimizeDialog > :last-child { flex-shrink:0; }
.dshAiOptimizePreview { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; min-width:0; }
.dshAiOptimizePane { min-width:0; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; overflow:hidden; }
.dshAiOptimizePane h3,.dshAiOptimizeNotes h3 { margin:0; display:flex; align-items:center; gap:8px; padding:12px 16px; font-size:13px; font-weight:500; line-height:20px; color:var(--dsw-alias-label-secondary); }
.dshAiOptimizePane h3 { border-bottom:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); }
.dshAiOptimizePane pre { margin:0; padding:16px; white-space:pre-wrap; overflow-wrap:anywhere; font-family:inherit; font-size:14px; line-height:24px; color:var(--dsw-alias-label-primary); }
.dshAiOptimizePane[data-result] { border-color:var(--dsw-alias-brand-primary); }
.dshAiOptimizeNotes { grid-column:1/-1; min-width:0; border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
.dshAiOptimizeNotes ul { margin:0; padding:0 20px 16px 36px; font-size:13px; line-height:22px; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
.dshAiOptimizeActions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:8px; width:100%; }
.dshAiOptimizeStatus { display:flex; flex-direction:column; align-items:center; gap:12px; padding:28px 16px; text-align:center; color:var(--dsw-alias-label-secondary); font-size:14px; line-height:22px; }
.dshAiOptimizeStatus p { margin:0; }
.dshAiOptimizeSpinner { animation:dshAiOptimizeSpin 1s linear infinite; }
@keyframes dshAiOptimizeSpin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .dshAiOptimizeSpinner { animation:none; } }
@media(max-width:640px) {
  .dshAiOptimizeDialog { padding-bottom:16px; }
  .dshAiOptimizePreview { grid-template-columns:minmax(0,1fr); gap:12px; }
  .dshAiOptimizePane pre { padding:12px; font-size:13px; line-height:22px; }
  .dshAiOptimizeActions > button { flex:1; min-width:0; }
}
`

export function installInputAssistanceStyles(document: Document = globalThis.document): () => void {
  const id = 'dsh-desktop-input-assistance-styles'
  if (document.getElementById(id)) return () => {}
  const style = document.createElement('style'); style.id = id; style.textContent = INPUT_ASSISTANCE_CSS
  document.head.append(style)
  return () => style.remove()
}
