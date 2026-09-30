/** Expert center presentation; reuses the shared integrations tokens and classes. */

const STYLE_ID = 'dsh-desktop-experts-styles'

const CSS = `
.dshExperts{gap:16px}
.dshExpertsToolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.dshExpertsToolbar>.dshIntegrationsSearch{flex:1 1 220px;min-width:180px}
.dshExpertsCategories{display:flex;flex-wrap:wrap;gap:6px}
.dshExpertsCategories button{min-height:28px;padding:4px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px}
.dshExpertsCategories button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshExpertsCategories button[data-active=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dshExpertsGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:12px;margin:0;padding:0;list-style:none}
.dshExpertsCard{display:flex;flex-direction:column;gap:9px;box-sizing:border-box;min-width:0;padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease,background .15s ease}
.dshExpertsCard:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.dshExpertsCard[data-status=invalid]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,var(--dsw-alias-border-l1))}
.dshExpertsCardHead{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dshExpertsStatus{display:inline-flex;align-items:center;min-height:20px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.dshExpertsStatus[data-status=available]{color:var(--dsw-alias-state-success-primary)}
.dshExpertsStatus[data-status=invalid],.dshExpertsStatus[data-status=unavailable]{color:var(--dsw-alias-state-warning-primary)}
.dshExpertsVersion,.dshExpertsHint{color:var(--dsw-alias-label-secondary);font-size:11px}
.dshExpertsCardTitle{display:flex;flex-direction:column;gap:3px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;text-align:start}
.dshExpertsCardTitle strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.dshExpertsCardTitle span{color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
.dshExpertsCardTitle:hover strong{color:var(--dsw-alias-brand-primary)}
.dshExpertsCardTitle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:6px}
.dshExpertsDescription{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;overflow-wrap:anywhere}
.dshExpertsTags{display:flex;flex-wrap:wrap;gap:5px;margin:0;padding:0;list-style:none}
.dshExpertsTags li{max-width:100%;padding:1px 8px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.dshExpertsReason{margin:0;color:var(--dsw-alias-state-warning-primary);font-size:11px;line-height:1.5;overflow-wrap:anywhere}
.dshExpertsCardActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:4px}
.dshExpertsStart[disabled]{cursor:default;opacity:.45}
.dshExpertsEmpty{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.dshExpertsEmpty p{margin:0}
.dshExpertsNotice{display:flex;align-items:center;gap:8px;margin:0;padding:9px 12px;border-left:3px solid var(--dsw-alias-brand-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dshExpertsNotice[data-kind=error]{border-left-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dshExpertsDetailHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dshExpertsDetailHead h2{margin:0;font-size:22px;font-weight:600}
.dshExpertsDetailTitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}
.dshExpertsFacts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px 18px;margin:0;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dshExpertsFacts>div{display:flex;flex-direction:column;gap:3px;min-width:0}
.dshExpertsFacts dt{color:var(--dsw-alias-label-secondary);font-size:11px}
.dshExpertsFacts dd{margin:0;font-size:12px;overflow-wrap:anywhere}
.dshExpertsEntry{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.dshExpertsEntry h3,.dshExpertsQuick h3{margin:0;font-size:14px;font-weight:600}
.dshExpertsPrompt{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.dshExpertsQuick{display:flex;flex-direction:column;gap:8px}
.dshExpertsQuick ul{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.dshExpertsQuickTask{max-width:100%;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;text-align:start}
.dshExpertsQuickTask:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary)}
.dshExpertsQuickTask:disabled{cursor:default;opacity:.45}
.dshExpertsBadge{display:inline-flex;align-items:center;gap:6px;max-width:220px;padding:2px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px;white-space:nowrap}
.dshExpertsBadgeLabel{color:var(--dsw-alias-label-secondary)}
.dshExpertsBadgeName{overflow:hidden;color:var(--dsw-alias-label-primary);text-overflow:ellipsis}
@container(max-width:520px){.dshExpertsGrid{grid-template-columns:1fr}.dshExpertsToolbar{align-items:stretch;flex-direction:column}}
`

export function installExpertStyles(document: Document = globalThis.document): () => void {
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
  return () => { style.remove() }
}
