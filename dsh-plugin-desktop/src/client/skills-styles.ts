/** Scoped catalog/dialog styles, matching Harness settings typography. */
export const SKILLS_CSS = `
.dshSkillPickerTrigger{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshSkillPickerTrigger:hover:not(:disabled),.dshSkillPickerItem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshSkillPickerTrigger:disabled,.dshSkillPickerItem:disabled{opacity:.5;cursor:default}
.dshSkillPickerTrigger:focus-visible,.dshSkillPickerItem:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshSkillsDialog.dshSkillPicker{width:min(480px,calc(100vw - 32px))}
.dshSkillPickerResults{margin-top:12px;min-height:160px;max-height:360px;overflow:auto;overscroll-behavior:contain}
.dshSkillPickerToolbar{display:flex;align-items:center;gap:8px;min-width:0}.dshSkillPickerToolbar input{box-sizing:border-box;flex:1;min-width:0;height:36px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}.dshSkillPickerToolbar input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshSkillPickerResults>p,.dshSkillPickerError{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dshSkillPickerError{display:flex;align-items:center;gap:12px;margin-top:12px}
.dshSkillPickerItem{display:flex;align-items:flex-start;gap:10px;width:100%;padding:10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:start;cursor:pointer}
.dshSkillPickerItem>svg{flex:none;margin-top:2px}.dshSkillPickerItem>span{display:flex;flex-direction:column;gap:4px;min-width:0;overflow-wrap:anywhere}
.dshSkillPickerItem strong{font-size:14px;font-weight:500;line-height:20px}.dshSkillPickerItem span span{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshSkillsPage{max-width:880px;gap:14px}
.dshSkillsPage .dshIntegrationsHeader{align-items:center}
.dshSkillsPage .dshIntegrationsHeader h2{font-size:18px;line-height:26px}
.dshSkillsTabs{display:flex;gap:22px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshSkillsTabs button{display:flex;align-items:center;gap:7px;position:relative;padding:6px 0 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dshSkillsTabs button[aria-selected=true]{color:var(--dsw-alias-label-primary)}
.dshSkillsTabs button[aria-selected=true]:after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:currentColor}
.dshSkillsTabs button span,.dshSkillsGroup h3 span{font-size:12px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dshSkillsTabs button:focus-visible,.dshSkillsCard:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshSkillsCatalog{display:flex;flex-direction:column;gap:14px;min-width:0}
.dshSkillsToolbar{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.dshSkillsToolbar .dshIntegrationsSearch{flex:1 1 180px;min-width:120px}
.dshSkillsToolbar .dshSkillsPresetMenu{max-width:210px}
.dshSkillsToolbar .dshSkillsPresetMenu button{height:36px;background:var(--dsw-alias-bg-module-platform);border:0}
.dshSkillsToolbar .dshSkillsPresetMenu button span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dshSkillsToolbar>.dshIntegrationsIconButton{flex-shrink:0}
.dshSkillsContext,.dshSkillsDiagnostics{min-width:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.dshSkillsContext summary,.dshSkillsDiagnostics summary{cursor:pointer;overflow-wrap:anywhere;padding:3px 0}
.dshSkillsContext summary:focus-visible,.dshSkillsDiagnostics summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.dshSkillsContextPreset{margin-inline-start:16px}
.dshSkillsContext[open] .dshSkillsFacts,.dshSkillsDiagnostics[open] .dshSkillsFacts{margin-top:10px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dshSkillsDiagnostics .dshSkillsFacts p{margin:5px 0}
.dshSkillsDiagnostics .dshIntegrationsCommand{max-width:100%;white-space:normal;overflow-wrap:anywhere;margin-top:6px}
.dshSkillsGroup{min-width:0}
.dshSkillsGroup h3{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:13px;font-weight:500;line-height:20px}
.dshSkillsGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;list-style:none;margin:0;padding:0}
.dshSkillsGrid li{min-width:0;position:relative}
.dshSkillsCardDelete{position:absolute;top:9px;right:9px}
.dshSkillsCardDelete>span:not([role=tooltip]){display:inline-flex}
.dshSkillsCardDelete [role=tooltip]{display:block;box-sizing:border-box;max-inline-size:calc(100vw - 24px);white-space:normal;overflow-wrap:anywhere;text-align:start;font-size:12px;line-height:18px;padding:6px 10px;border-radius:6px}
.dshSkillsCardDelete .dshIntegrationsIconButton{border:0;border-radius:6px}
.dshSkillsCardDelete .dshIntegrationsIconButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshSkillsDeleteAction{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0;max-width:100%}
.dshSkillsDeleteAction .dshSkillsNote{overflow-wrap:anywhere}
.dshSkillsCard{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;width:100%;height:100%;min-height:120px;padding:12px;text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.dshSkillsCard:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshSkillsCard:disabled{cursor:wait;opacity:.65}
.dshSkillsCardHeading{display:flex;align-items:center;gap:8px;min-width:0;width:100%;padding-right:32px;box-sizing:border-box}
.dshSkillsCardHeading>svg{flex:none;color:var(--dsw-alias-label-secondary)}
.dshSkillsCardHeading strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;line-height:20px}
.dshSkillsReadOnly{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshSkillsSummary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-height:38px;overflow:hidden;overflow-wrap:anywhere;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.dshSkillsBadges{display:flex;flex-wrap:wrap;gap:7px 12px;margin-top:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dshSkillsBadges>span{display:inline-flex;align-items:center;gap:5px}
.dshSkillsBadges>span:before{content:'';width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-border-l2)}
.dshSkillsBadges>span[data-enabled=true]:before{background:var(--dsw-alias-state-success-primary)}
.dshSkillsRecycleList{list-style:none;margin:0;padding:0}
.dshSkillsRecycleList>li{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}
.dshSkillsRecycleList>li>svg{width:16px;height:16px;flex:none;color:var(--dsw-alias-label-secondary)}
.dshSkillsRecycleList>li>div{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0;overflow-wrap:anywhere}
.dshSkillsRecycleList strong{font-size:14px;font-weight:600}
.dshSkillsRecycleList span,.dshSkillsEmpty{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshSkillsDialog{width:min(640px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;color:var(--dsw-alias-label-primary)}
.dshSkillsDialogContent{overflow:auto;min-height:0;overscroll-behavior:contain}
.dshSkillsDialogContent h2{font-size:16px;line-height:24px;overflow-wrap:anywhere}
.dshSkillsDialogContent h2+button{flex:none}
.dshSkillsDialogBody{display:flex;flex-direction:column;gap:18px;min-width:0}
.dshSkillsDialogFooter{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;width:100%}
.dshSkillsDialogFooter>.dshIntegrationsRowActions{margin-left:auto;flex-wrap:wrap;justify-content:flex-end}
.dshSkillsForm{display:flex;flex-direction:column;gap:16px;margin:0;min-width:0}
.dshSkillsForm label{display:flex;flex-direction:column;gap:7px;font-size:13px;line-height:20px}
.dshSkillsForm input:not([type=file]),.dshSkillsForm textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;outline:none}
.dshSkillsForm textarea{resize:vertical;min-height:64px}
.dshSkillsForm input:focus-visible,.dshSkillsForm textarea:focus-visible{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent)}
.dshSkillsForm input:disabled,.dshSkillsForm textarea:disabled{opacity:.6}
.dshSkillsForm textarea.dshSkillsCode{font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:20px}
.dshSkillsFileRow{display:flex;align-items:center;gap:12px;min-width:0}
.dshSkillsFileRow>button{flex:none}
.dshSkillsFileRow>span{min-width:0;overflow-wrap:anywhere;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshSkillsNote{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}
.dshSkillsDescription{margin:0;font-size:13px;line-height:21px;overflow-wrap:anywhere}
.dshSkillsFacts{display:flex;flex-direction:column;gap:10px;margin:0;font-size:12px;line-height:19px}
.dshSkillsFacts>div{display:grid;grid-template-columns:86px minmax(0,1fr);gap:12px}
.dshSkillsFacts dt{color:var(--dsw-alias-label-secondary)}
.dshSkillsFacts dd{margin:0;overflow-wrap:anywhere}
.dshSkillsFacts code{font-family:var(--ds-font-family-code,monospace);font-size:11px}
.dshSkillsInvocation{border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2);padding:4px 0}
.dshSkillsInvocation>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;font-size:13px}
.dshSkillsInstructions h3{margin:0 0 8px;font-size:13px;font-weight:600}
.dshSkillsInstructions pre{margin:0;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:6px;padding:12px;background:var(--dsw-alias-bg-layer-2);font:12px/20px var(--ds-font-family-code,monospace)}
.dshSkillsConfirmation{display:flex;flex-direction:column;gap:10px;width:100%;font-size:13px;line-height:20px}
.dshSkillsConfirmation .dshIntegrationsRowActions{justify-content:flex-end;flex-wrap:wrap}
@container(max-width:540px){.dshSkillsGrid{grid-template-columns:minmax(0,1fr)}.dshSkillsToolbar{flex-wrap:wrap}.dshSkillsToolbar .dshIntegrationsSearch{flex-basis:100%}.dshSkillsToolbar>.dshIntegrationsIconButton{margin-left:auto}.dshSkillsPage .dshIntegrationsHeader{align-items:flex-start}.dshSkillsPage .dshIntegrationsHeader .dshIntegrationsRowActions{width:auto}.dshSkillsCard{min-height:120px}}
@container(max-width:380px){.dshSkillsContextPreset{display:block;margin-inline-start:16px}.dshSkillsToolbar .dshSkillsPresetMenu{max-width:calc(100% - 38px)}.dshSkillsCardHeading{flex-wrap:wrap}.dshSkillsCardHeading strong{flex-basis:calc(100% - 24px)}.dshSkillsReadOnly{margin-inline-start:24px}}
@media(max-width:480px){.dshSkillsFacts>div{grid-template-columns:70px minmax(0,1fr)}.dshSkillsDialogFooter .dshIntegrationsCommand,.dshSkillsDialogFooter .dshIntegrationsDanger{padding:5px 10px}.dshSkillsDialog .dshIntegrationsRowActions{flex-wrap:wrap}}
`
