import { COMPOSER_ACTION_CSS } from './composer-action-styles.ts'

export const INPUT_ASSISTANCE_CSS = COMPOSER_ACTION_CSS + `
/* Keep suggestions outside the editable line box: a fresh empty root and
   the empty paragraph left after deletion must position the caret identically.
   The placeholder shares the editor's origin and grows the scrollport. */
[data-claw-ai-suggestion] [data-input-scroll] > :has(> [data-composer-placeholder]) {
  display:grid; min-width:0;
}
[data-claw-ai-suggestion] [data-input-scroll] > * > :is([contenteditable="true"], [data-composer-placeholder]) {
  grid-area:1 / 1; min-width:0; align-self:start;
}
[data-claw-ai-suggestion] [data-composer-placeholder] {
  position:static; inset:auto; box-sizing:border-box; padding:4px 8px 0 14px;
  font-family:var(--dsw-font-family); font-size:inherit; line-height:inherit;
  display:block; white-space:pre-wrap; overflow-wrap:anywhere; word-break:normal;
  overflow:visible; text-overflow:clip; -webkit-line-clamp:unset; line-clamp:unset;
}
/* Continuations participate in the real paragraph's wrapping and scrollport,
   while remaining outside editor text/history. */
.dshAiContinuationScope[data-claw-ai-continuation] [contenteditable="true"]:focus > p:last-child::after {
  content:var(--dsh-ai-continuation-text);
  content:var(--dsh-ai-continuation-text) / "";
  font:inherit; line-height:inherit; white-space:inherit; overflow-wrap:inherit; word-break:inherit;
  color:var(--dsw-alias-label-caption); pointer-events:none; user-select:none;
}
button.dshAiOptimizeTrigger { flex:none; white-space:nowrap; }
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
.dshAiOptimizeReasoning summary:focus-visible { outline:2px solid var(--dsw-focus-ring-color,var(--dsh-color-accent)); outline-offset:2px; }
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
