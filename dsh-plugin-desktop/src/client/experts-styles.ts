import { installIntegrationsStyles } from './integrations-styles.ts'

const STYLE_ID = 'dsh-expert-center-styles'

const EXPERTS_CSS = `
.dshExpertsPage{box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:40px clamp(24px,5vw,72px) 56px}
.dshExpertsContainer{display:flex;flex-direction:column;gap:20px;width:100%;max-width:880px;min-width:0;box-sizing:border-box;margin:0 auto;color:var(--dsw-alias-label-primary)}
.dshExpertsHeader h2{margin:0;font-size:22px;line-height:1.35;font-weight:600}
.dshExpertsHeader p{max-width:680px;margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.dshExpertsToolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dshExpertsSearch{position:relative;display:flex;align-items:center;flex:1;min-width:220px}
.dshExpertsSearch svg{position:absolute;left:11px;width:15px;height:15px;color:var(--dsw-alias-label-secondary)}
.dshExpertsSearch input{box-sizing:border-box;width:100%;min-height:36px;padding:7px 11px 7px 34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dshExpertsSearch input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.dshExpertsToolbar select{box-sizing:border-box;min-height:36px;padding:7px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.dshExpertsRefresh,.dshExpertsBack,.dshExpertsPrimary,.dshExpertsQuick{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;border-radius:8px}
.dshExpertsRefresh{min-height:32px;padding:5px 13px}
.dshExpertsBack{min-height:32px;padding:5px 13px;border-radius:999px;color:var(--dsw-alias-label-secondary)}
.dshExpertsPrimary{min-height:32px;padding:6px 14px;background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:500}
.dshExpertsPrimary:disabled{opacity:.5;cursor:default}
.dshExpertsNotice{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}
.dshExpertsError{padding:12px 14px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.dshExpertsError button{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer}
.dshExpertsList{display:flex;flex-direction:column;gap:8px}
.dshExpertsRow{display:flex;align-items:center;justify-content:space-between;gap:16px;min-width:0;padding:12px 14px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease,background .15s ease;cursor:pointer}
.dshExpertsRow:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.dshExpertsRowMain{display:flex;flex:1;flex-direction:column;align-items:flex-start;gap:4px;min-width:0}
.dshExpertsRowTitle{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.dshExpertsRowDescription{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.dshExpertsMeta{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:11px}
.dshExpertsMeta>span{display:inline-flex;align-items:center;min-height:20px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2)}
.dshExpertsUnavailable{color:var(--dsw-alias-state-error-primary)}
.dshExpertsDetailHeader{display:flex;align-items:flex-start;gap:16px}
.dshExpertsDetailIcon{flex:0 0 auto;width:56px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.dshExpertsDetailHeader h2{margin:0;font-size:20px;font-weight:600}
.dshExpertsTitle{margin:4px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dshExpertsDescription{margin:6px 0 0;font-size:13px;line-height:1.6;max-width:680px}
.dshExpertsTags{display:flex;flex-wrap:wrap;gap:6px}
.dshExpertsTag{padding:2px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}
.dshExpertsTask{display:flex;flex-direction:column;gap:8px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dshExpertsTask h3{margin:0;font-size:14px}
.dshExpertsPrompt{margin:0;font-size:13px;line-height:1.6;white-space:pre-wrap}
.dshExpertsQuickList{display:flex;flex-direction:column;gap:8px}
.dshExpertsQuick{min-height:36px;padding:8px 12px;text-align:left;border-radius:8px}
.dshExpertsQuick:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshExpertsQuick:disabled{opacity:.5;cursor:default}
.dshExpertsInvalid{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.dshExpertsInvalid h3{margin:0 0 6px;font-size:14px}
.dshExpertsInvalid p{margin:0 0 8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshExpertsInvalid ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
.dshExpertsInvalid li{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.dshExpertsInvalid code{font-family:ui-monospace,monospace;font-size:11px}
`

export function installExpertStyles(document: Document = globalThis.document): () => void {
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  installIntegrationsStyles(document)
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = EXPERTS_CSS
  document.head.append(style)
  return () => { style.remove() }
}
