export const INPUT_ASSISTANCE_CSS = `
/* Generated inline content participates in the real paragraph's wrapping,
   auto-height and scrollport, while remaining outside editor text/history. */
/* Lexical leaves a freshly mounted/cleared root childless until its first
   edit. Render there too; continuations always have a paragraph already. */
[data-claw-ai-suggestion] [contenteditable="true"]:empty::after,
[data-claw-ai-suggestion] [contenteditable="true"] > p:last-child::after {
  content:var(--dsh-ai-suggestion-text);
  content:var(--dsh-ai-suggestion-text) / "";
}
.dshAiContinuationScope[data-claw-ai-continuation] [contenteditable="true"]:focus > p:last-child::after {
  content:var(--dsh-ai-continuation-text);
  content:var(--dsh-ai-continuation-text) / "";
}
[data-claw-ai-suggestion] [contenteditable="true"]:empty::after,
[data-claw-ai-suggestion] [contenteditable="true"] > p:last-child::after,
.dshAiContinuationScope[data-claw-ai-continuation] [contenteditable="true"]:focus > p:last-child::after {
  font:inherit; line-height:inherit; white-space:inherit; overflow-wrap:inherit; word-break:inherit;
  color:var(--dsw-alias-label-caption); pointer-events:none; user-select:none;
}
/* The generated suggestion replaces only the visual placeholder. Hide the
   empty paragraph's terminal break so it does not add a blank first line. */
[data-claw-ai-suggestion] [data-composer-placeholder],
[data-claw-ai-suggestion] [contenteditable="true"] > p:only-child > br:only-child { display:none; }
button.dshAiOptimizeTrigger { flex:none; white-space:nowrap; color:var(--dsw-alias-label-secondary); }
.dshAiOptimizeTriggerLabel { display:var(--dsh-composer-model-text-display,inline); }
.dshAiOptimizeTrigger svg { width:14px; height:14px; flex:none; }
@container(max-width:560px) {
  .dshAiOptimizeTrigger { width:28px; padding:0; gap:0; }
  .dshAiOptimizeTriggerLabel { display:none; }
}
.dshAiOptimizeDialog { width:min(720px,100%); max-height:100%; min-height:0; }
.dshAiOptimizeDialogContent { min-height:0; overflow:hidden; }
.dshAiOptimizeDialogContent > :not(:last-child) { flex-shrink:0; }
.dshAiOptimizeDialogContent > :last-child { min-height:0; overflow:auto; overscroll-behavior:contain; }
.dshAiOptimizeDialog > :last-child { flex-shrink:0; }
.dshAiOptimizePreview { display:flex; flex-direction:column; gap:20px; min-width:0; }
.dshAiOptimizeText,.dshAiOptimizeNotes { min-width:0; }
.dshAiOptimizePreview > * + * { border-top:1px solid var(--dsw-alias-border-l2); padding-top:16px; }
.dshAiOptimizeText h3,.dshAiOptimizeNotes h3 { margin:0 0 8px; display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; line-height:20px; color:var(--dsw-alias-label-secondary); }
.dshAiOptimizeText pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font-family:inherit; font-size:14px; line-height:24px; color:var(--dsw-alias-label-primary); }
.dshAiOptimizeNotes ul { margin:0; padding-left:20px; font-size:13px; line-height:22px; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
.dshAiOptimizeReasoning { margin-top:12px; }
.dshAiOptimizeReasoning summary { cursor:pointer; font-size:13px; line-height:20px; color:var(--dsw-alias-label-secondary); }
.dshAiOptimizeReasoning summary:focus-visible { outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary)); outline-offset:2px; }
.dshAiOptimizeReasoning pre { margin-top:8px; color:var(--dsw-alias-label-secondary); }
.dshAiOptimizeProgress { display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:13px; line-height:20px; color:var(--dsw-alias-label-secondary); }
.dshAiOptimizeActions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:8px; width:100%; }
.dshAiOptimizeStatus { display:flex; flex-direction:column; align-items:center; gap:12px; padding:28px 16px; text-align:center; color:var(--dsw-alias-label-secondary); font-size:14px; line-height:22px; }
.dshAiOptimizeStatus p { margin:0; }
.dshAiOptimizeSpinner { animation:dshAiOptimizeSpin 1s linear infinite; }
@keyframes dshAiOptimizeSpin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .dshAiOptimizeSpinner { animation:none; } }
@media(max-width:640px) {
  .dshAiOptimizePreview { gap:16px; }
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
