import { GENUI_CHART_DARK, GENUI_CHART_LIGHT } from './genui-chart-options.ts'

/** Compact result surfaces using the same neutrals and action accent as Desktop. */
export const GENUI_STYLES = `
.clawGenuiResults{display:grid;gap:16px;min-width:0}
.clawGenui{min-width:0;display:grid;gap:20px;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsh-card-radius,12px);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6;overflow-wrap:anywhere}
.clawGenui.clawGenuiInline{padding:0;border:0;border-radius:0;background:transparent}
.clawGenui h3,.clawGenui h4,.clawGenui p{margin:0;white-space:pre-wrap}
.clawGenui>h3{font-size:1.1em;font-weight:600;line-height:1.5;padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.clawGenui h4{font-size:1em;font-weight:600}
.clawGenuiCard{display:grid;gap:14px;min-width:0;padding:16px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.clawGenuiCard .clawGenuiCard{padding:0;background:transparent}
.clawGenuiRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;min-width:0;align-items:start}
.clawGenuiRow:has(>.clawGenuiChart){grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.clawGenuiStat{display:grid;gap:6px;min-width:0;padding:14px 16px;background:var(--dsw-alias-bg-layer-2);border-radius:10px}
.clawGenuiStat span{color:var(--dsw-alias-label-secondary);font-size:.95em}.clawGenuiStat strong{font-size:2em;line-height:1.2;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.clawGenuiProgress{display:grid;gap:8px}.clawGenuiProgressLabel{display:flex;justify-content:space-between;gap:16px}.clawGenuiProgressValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.clawGenuiProgress progress{display:block;appearance:none;width:100%;height:6px;border:0;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);accent-color:var(--dsh-color-primary)}
.clawGenuiProgress progress::-webkit-progress-bar{background:var(--dsw-alias-bg-layer-2);border-radius:999px}.clawGenuiProgress progress::-webkit-progress-value{background:var(--dsh-color-primary);border-radius:999px}.clawGenuiProgress progress::-moz-progress-bar{background:var(--dsh-color-primary);border-radius:999px}
.clawGenuiCallout{--claw-tone:var(--dsh-color-primary);border-left:2px solid var(--claw-tone);padding:10px 14px;border-radius:0 8px 8px 0;background:var(--dsw-alias-bg-layer-2);white-space:pre-wrap}.clawGenuiCallout[data-tone=success]{--claw-tone:var(--dsw-alias-state-success-primary,var(--dsh-color-primary))}.clawGenuiCallout[data-tone=warning]{--claw-tone:var(--dsw-alias-state-warn-primary,#ad6800)}.clawGenuiCallout[data-tone=error]{--claw-tone:var(--dsw-alias-state-error-primary,#cf1322)}.clawGenuiTone span{display:inline-flex;align-items:center;justify-content:center;min-width:16px;color:var(--claw-tone);font-weight:600}
.clawGenuiTone{font-size:.9em;font-weight:500;color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.clawGenui ol{margin:0;padding-left:24px}.clawGenui li{white-space:pre-wrap}.clawGenui li+li{margin-top:8px}.clawGenui li::marker{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.clawGenuiTable{min-width:0;max-height:360px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;scrollbar-color:var(--dsw-alias-label-tertiary) transparent}
.clawGenui :is(button,summary,[tabindex]):focus-visible{outline:2px solid var(--dsh-color-accent,var(--dsh-color-primary));outline-offset:-2px}
.clawGenui table{border-collapse:separate;border-spacing:0;width:100%;text-align:left;font-size:inherit}.clawGenui th,.clawGenui td{padding:10px 14px;min-width:80px;max-width:360px;white-space:pre-wrap;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}
.clawGenui thead th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:.95em;font-weight:500}.clawGenui tbody tr:last-child>*{border-bottom:0}.clawGenui tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover)}
.clawGenui [data-numeric=true]{text-align:right;font-variant-numeric:tabular-nums}.clawGenui th button{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px;width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;text-align:inherit;cursor:pointer}.clawGenui [data-numeric=true] button{justify-content:flex-end}
.clawGenuiSort{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary)}.clawGenui th[aria-sort=ascending] .clawGenuiSort,.clawGenui th[aria-sort=descending] .clawGenuiSort{color:var(--dsh-color-primary)}
.clawGenuiFallback{white-space:pre-wrap;overflow-wrap:anywhere}.clawGenuiDiagnostic{font-size:.9em;color:var(--dsw-alias-label-secondary)}
.clawGenuiChart{margin:0;min-width:0;${GENUI_CHART_LIGHT.colors.map((value, i) => `--claw-chart-color-${i + 1}:${value}`).join(';')}}
:is(body,html)[data-ds-dark-theme] .clawGenuiChart{${GENUI_CHART_DARK.colors.map((value, i) => `--claw-chart-color-${i + 1}:${value}`).join(';')}}
.clawGenuiChart figcaption{font-weight:600}.clawGenuiChartLegendGroup{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.clawGenuiChartLegend{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:.9em;cursor:pointer}
.clawGenuiChartLegend:hover{background:var(--dsw-alias-interactive-bg-hover)}.clawGenuiChartLegend[aria-pressed=false]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}.clawGenuiChartLegend[aria-pressed=false] span{opacity:.35}
.clawGenuiHtml{min-width:0}.clawGenuiHtmlToolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.clawGenuiHtmlToolbar h4{margin-right:auto}.clawGenuiHtmlToolbar button{min-height:32px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}.clawGenuiHtmlToolbar button:hover{background:var(--dsw-alias-interactive-bg-hover)}.clawGenuiHtml iframe{display:block;margin-top:8px;border-radius:8px}.clawGenuiHtml summary{cursor:pointer;padding:8px 0;color:var(--dsw-alias-label-secondary)}
.clawGenuiChartScroll{max-height:440px;overflow:auto;min-width:0;scrollbar-color:var(--dsw-alias-label-tertiary) transparent}.clawGenuiChartNote{margin-top:8px!important;font-size:.95em;color:var(--dsw-alias-label-secondary)}.clawGenuiChartLegendValue{font-variant-numeric:tabular-nums;font-size:.95em}.clawGenuiChartRestore{min-height:32px;padding:4px 0;border:0;background:transparent;color:var(--dsh-color-primary);font:inherit;cursor:pointer}.clawGenuiChartRestore:hover{text-decoration:underline}
.clawGenuiChartData summary{cursor:pointer;padding:8px 0;color:var(--dsw-alias-label-secondary);font-size:.95em}.clawGenuiChartData[open] summary{margin-bottom:4px}
@media(max-width:560px){.clawGenui{padding:14px;gap:16px}.clawGenui th,.clawGenui td{padding:8px 10px}.clawGenuiCard{padding:12px}}
`
