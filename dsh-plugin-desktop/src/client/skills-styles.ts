/** Scoped Skills catalog and dialog styles using the host theme tokens. */
export const SKILLS_CSS = `
.dshSkillPickerTrigger{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshSkillPickerTrigger:hover:not(:disabled),.dshSkillPickerItem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshSkillPickerTrigger:disabled,.dshSkillPickerItem:disabled{opacity:.5;cursor:default}
.dshSkillPickerTrigger:focus-visible,.dshSkillPickerItem:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:2px}
.dshSkillsDialog.dshSkillPicker{width:min(560px,calc(100vw - 32px))}
.dshSkillPickerContext{margin:0 0 10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dshSkillPickerResults{margin-top:8px;min-height:140px;max-height:380px;overflow:auto;overscroll-behavior:contain}
.dshSkillPickerToolbar{display:flex;align-items:center;gap:8px;min-width:0}.dshSkillPickerSearch{position:relative;display:flex;align-items:center;flex:1;min-width:0}.dshSkillPickerSearch>svg{position:absolute;left:10px;width:16px;height:16px;color:var(--dsw-alias-label-secondary);pointer-events:none}.dshSkillPickerToolbar input{box-sizing:border-box;width:100%;min-width:0;height:36px;padding:8px 10px 8px 34px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}.dshSkillPickerToolbar input:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:1px}
.dshSkillPickerResults>p,.dshSkillPickerError,.dshSkillPickerConflicts{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshSkillPickerError{display:flex;align-items:center;gap:12px;margin-top:12px}
.dshSkillPickerConflicts{margin:8px 0 0;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.dshSkillPickerItem{display:flex;align-items:flex-start;gap:10px;width:100%;min-height:64px;padding:10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:start;cursor:pointer}
.dshSkillPickerItem>svg{flex:none;margin-top:2px}.dshSkillPickerItem>span{display:flex;flex-direction:column;gap:4px;min-width:0;overflow-wrap:anywhere}
.dshSkillPickerItem strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px}.dshSkillPickerItem span span{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshSkillsPage{max-width:960px;gap:14px}
.dshSkillsDirectories{display:flex;flex-direction:column;gap:10px;padding:0 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshSkillsDirectories[data-open=true]{padding-bottom:14px}.dshSkillsDirectories>header{display:flex;align-items:center;justify-content:space-between;gap:14px}.dshSkillsDirectories>header>div{min-width:0}.dshSkillsDirectories header p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}
.dshSkillsDirectoryToggle{display:inline-flex;align-items:center;gap:7px;padding:5px 0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;cursor:pointer}.dshSkillsDirectoryToggle svg{width:16px;height:16px;transition:transform .15s ease}.dshSkillsDirectoryToggle[aria-expanded=true] svg{transform:rotate(180deg)}.dshSkillsDirectoryToggle small{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary)}.dshSkillsDirectoryToggle:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:2px;border-radius:4px}
.dshSkillsDirectories ul{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}.dshSkillsDirectories li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;min-width:0;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1)}.dshSkillsDirectories li>div{display:grid;grid-template-columns:minmax(190px,220px) max-content minmax(0,1fr);align-items:center;gap:12px;min-width:0}.dshSkillsDirectoryName{min-width:0;font-size:12px;line-height:18px;white-space:nowrap}.dshSkillsDirectories li small{padding:1px 5px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px;white-space:nowrap}.dshSkillsDirectories code{min-width:0;overflow:hidden;font:11px/18px var(--ds-font-family-code,monospace);text-overflow:ellipsis;white-space:nowrap}
.dshSkillsPage{max-width:1120px;gap:24px}
.dshSkillsPage,.dshMcpPage{--dsh-skill-green:#079d79;--dsh-skill-pink:#d8328b;--dsh-skill-blue:#2476d6;--dsh-skill-purple:#7156d9;--dsh-skill-teal:#07959a;--dsh-skill-amber:#a66a09}
.dshSkillsPage .dshIntegrationsHeader{align-items:center}
.dshSkillsPage .dshIntegrationsHeader h2{font-size:22px;line-height:30px;letter-spacing:-.4px}
.dshSkillsTabs{display:flex;gap:28px;border-bottom:0}
.dshSkillsTabs button{display:flex;align-items:center;gap:8px;min-height:40px;padding:4px 0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:17px;font-weight:500;cursor:pointer}
.dshSkillsTabs button[aria-selected=true]{color:var(--dsw-alias-label-primary);font-weight:650}
.dshSkillsTabs button span{padding:2px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dshSkillsTabs button:focus-visible,.dshSkillsCard:focus-visible,.dshSkillsCategories button:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:3px;border-radius:8px}
.dshSkillsCatalog{display:flex;flex-direction:column;gap:20px;min-width:0}
.dshSkillsToolbar{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.dshSkillsToolbar .dshIntegrationsSearch{flex:1 1 180px;min-width:120px}
.dshSkillsToolbar .dshIntegrationsSearch input{border-radius:10px}
.dshSkillsToolbar .dshSkillsPresetMenu{max-width:210px}
.dshSkillsToolbar .dshSkillsPresetMenu button{height:36px;background:var(--dsw-alias-bg-module-platform);border:0;border-radius:8px}
.dshSkillsToolbar .dshSkillsPresetMenu button span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dshSkillsToolbar>.dshIntegrationsIconButton{flex-shrink:0}
.dshSkillsToolbar>.dshSkillsCatalogActions{margin-left:auto;gap:8px}.dshSkillsToolbar>.dshSkillsCatalogActions .dshIntegrationsCommand{white-space:nowrap}
.dshSkillsCategories{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;min-width:0}
.dshSkillsCategories button{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:8px 14px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:20px;cursor:pointer;transition:background .15s ease,color .15s ease}
.dshSkillsCategories button:hover,.dshSkillsCategories button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshSkillsCategories button[aria-pressed=true]{font-weight:600}
.dshSkillsCategories button small{font-size:11px;line-height:16px;font-weight:400;font-variant-numeric:tabular-nums;opacity:.8}
.dshSkillsCategoryBadge{padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dshSkillsDiagnostics{min-width:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.dshSkillsDiagnostics summary{cursor:pointer;overflow-wrap:anywhere;padding:3px 0}
.dshSkillsDiagnostics summary:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:2px;border-radius:4px}
.dshSkillsDiagnostics[open] .dshSkillsFacts{margin-top:10px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dshSkillsDiagnostics .dshSkillsFacts p{margin:5px 0}
.dshSkillsDiagnostics .dshIntegrationsCommand{max-width:100%;white-space:normal;overflow-wrap:anywhere;margin-top:6px}
.dshSkillsGroups{display:flex;flex-direction:column;gap:28px;min-width:0}.dshSkillsGroup{min-width:0}.dshSkillsGroup[data-collapsed=true]{padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshSkillsGroup h3{margin:0 0 12px}.dshSkillsGroup h3 button{display:flex;width:100%;align-items:center;gap:8px;padding:4px 0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;line-height:20px;text-align:left;cursor:pointer}.dshSkillsGroup h3 button>svg{width:14px;height:14px;transition:transform .15s ease}.dshSkillsGroup h3 button[aria-expanded=false]>svg{transform:rotate(-90deg)}.dshSkillsGroup h3 small{font-size:11px;font-weight:400;font-variant-numeric:tabular-nums}.dshSkillsGroup h3 button:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:2px;border-radius:4px}
.dshSkillsGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;list-style:none;margin:0;padding:0}
.dshSkillsGrid li{display:flex;min-width:0;position:relative}
.dshSkillsCardDelete{position:absolute;bottom:14px;right:16px}
.dshSkillsCardDelete>span:not([role=tooltip]){display:inline-flex}
.dshSkillsCardDelete [role=tooltip]{display:block;box-sizing:border-box;max-inline-size:calc(100vw - 24px);white-space:normal;overflow-wrap:anywhere;text-align:start;font-size:12px;line-height:18px;padding:6px 10px;border-radius:6px}
.dshSkillsCardDelete .dshIntegrationsIconButton{border:0;border-radius:8px;width:32px;height:32px}
.dshSkillsCardDelete .dshIntegrationsIconButton:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:2px}
.dshSkillsDeleteAction{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0;max-width:100%}
.dshSkillsDeleteAction .dshSkillsNote{overflow-wrap:anywhere}
.dshSkillsCard{position:relative;display:grid;grid-template-columns:48px minmax(0,1fr);grid-template-rows:auto minmax(40px,1fr) auto;align-items:start;column-gap:16px;row-gap:7px;box-sizing:border-box;width:100%;min-height:172px;padding:24px 22px 20px;text-align:left;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;box-shadow:0 4px 18px color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}
.dshSkillsCard:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);box-shadow:0 6px 22px color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.dshSkillsCard:active:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshSkillsCard:disabled{cursor:wait;opacity:.65}
.dshSkillsCategoryIcon{--dsh-skill-accent:var(--dsh-skill-purple);display:flex;align-items:center;justify-content:center;grid-column:1;grid-row:1/3;width:48px;height:48px;border-radius:15px;color:white;background:linear-gradient(145deg,color-mix(in srgb,var(--dsh-skill-accent) 78%,white),var(--dsh-skill-accent));box-shadow:inset 0 0 0 1px #ffffff30}
.dshSkillsCategoryIcon svg{width:26px;height:26px;stroke-width:1.8}
.dshSkillsCategoryIcon[data-category=office],.dshSkillsCategoryIcon[data-category=learning]{--dsh-skill-accent:var(--dsh-skill-green)}
.dshSkillsCategoryIcon[data-category=content],.dshSkillsCategoryIcon[data-category=design]{--dsh-skill-accent:var(--dsh-skill-pink)}
.dshSkillsCategoryIcon[data-category=data],.dshSkillsCategoryIcon[data-category=development]{--dsh-skill-accent:var(--dsh-skill-blue)}
.dshSkillsCategoryIcon[data-category=business]{--dsh-skill-accent:var(--dsh-skill-teal)}
.dshSkillsCategoryIcon[data-category=finance],.dshSkillsCategoryIcon[data-category=compliance]{--dsh-skill-accent:var(--dsh-skill-amber)}
.dshSkillsCardHeading{display:flex;grid-column:2;flex-direction:column;align-items:flex-start;gap:3px;min-width:0;padding-right:30px}
.dshSkillsCardHeading small{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:15px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.dshSkillsCardHeading strong{display:-webkit-box;min-width:0;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere;font-size:15px;font-weight:600;line-height:22px}
.dshSkillsReadOnly{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshSkillsSummary{grid-column:2;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;font-size:13px;line-height:21px;color:var(--dsw-alias-label-secondary)}
.dshSkillsCardOpen{position:absolute;top:20px;right:18px;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.dshSkillsCardOpen svg{width:16px;height:16px}.dshSkillsCard:hover .dshSkillsCardOpen{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshSkillsBadges{display:flex;grid-column:1/-1;align-self:end;flex-wrap:wrap;gap:5px 12px;min-width:0;padding-top:12px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshSkillsGrid li[data-recyclable=true] .dshSkillsBadges{padding-right:30px}
.dshSkillsBadges>span{display:inline-flex;align-items:center;gap:5px}
.dshSkillsBadges>span[data-enabled]:before{content:'';width:5px;height:5px;flex:none;border-radius:50%;background:var(--dsw-alias-border-l2)}
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
.dshSkillsForm input:focus-visible,.dshSkillsForm textarea:focus-visible{border-color:var(--dsh-color-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsh-color-primary) 15%,transparent)}
.dshSkillsForm input:disabled,.dshSkillsForm textarea:disabled{opacity:.6}
.dshSkillsForm textarea.dshSkillsCode{font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:20px}
.dshSkillsFileRow{display:flex;align-items:center;gap:12px;min-width:0}
.dshSkillsFileRow>button{flex:none}
.dshSkillsForm .dshSkillsFileRow{flex-wrap:wrap}
.dshSkillBundleList{list-style:none;margin:0;padding:0;max-height:220px;overflow:auto;font-size:12px;line-height:20px}
.dshSkillBundleList li{padding:3px 0;overflow-wrap:anywhere}
.dshSkillFiles li button{display:flex;align-items:center;gap:6px;width:100%;padding:6px;border:0;border-radius:4px;background:transparent;color:inherit;text-align:start;font:inherit;cursor:pointer}
.dshSkillFiles li button:hover:not(:disabled),.dshSkillFiles li button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dshSkillFiles li button:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:-2px}
.dshSkillFiles li button:disabled{opacity:.5;cursor:default}.dshSkillFiles code{overflow-wrap:anywhere;min-width:0}.dshSkillFiles li button>span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.dshSkillFiles li small{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary)}
.dshSkillFiles h3{overflow-wrap:anywhere}.dshSkillFiles .dshSkillsFileRow{justify-content:space-between;margin-bottom:8px}
.dshSkillsDetailPanel{display:flex;flex-direction:column;gap:18px;min-width:0}
.dshSkillsFileDialog{width:min(880px,calc(100vw - 32px))}
.dshSkillFiles{min-width:0;container-type:inline-size;font-size:12px;line-height:19px}
.dshSkillFiles input[type=search]{box-sizing:border-box;flex:1;min-width:0;height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}
.dshSkillFiles input:focus-visible,.dshSkillFileTree summary:focus-visible,.dshSkillFilePreview pre:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:-2px}
.dshSkillFileBrowser{display:grid;grid-template-columns:minmax(160px,32%) minmax(0,1fr);height:380px;max-height:55dvh;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;overflow:hidden}
.dshSkillFileTree{min-width:0;overflow:auto;padding:8px;border-right:1px solid var(--dsw-alias-border-l2)}
.dshSkillFileTree ul{list-style:none;margin:0;padding:0}.dshSkillFileTree details>ul{padding-inline-start:12px}
.dshSkillFileTree summary{cursor:pointer;padding:6px 0;overflow-wrap:anywhere}.dshSkillFileTree svg{width:14px;height:14px;flex:none;vertical-align:middle;color:var(--dsw-alias-label-secondary)}.dshSkillFileTree summary svg{margin-inline-end:5px}
.dshSkillFilePreview{min-width:0;min-height:0;display:flex;flex-direction:column;padding:12px;gap:10px;overflow:auto}
.dshSkillFilePreviewHeader{display:flex;align-items:center;gap:8px;min-width:0;flex:none}.dshSkillFilePreviewHeader button{flex:none}
.dshSkillFilePreview pre{margin:0;flex:1;min-height:0;overflow:auto;white-space:pre;font:12px/20px var(--ds-font-family-code,monospace);tab-size:2}
@container(max-width:540px){.dshSkillFileBrowser{grid-template-columns:minmax(0,1fr)}.dshSkillFileBrowser[data-preview=true] .dshSkillFileTree,.dshSkillFileBrowser[data-preview=false] .dshSkillFilePreview{display:none}.dshSkillFileTree{border-right:0}}
.dshSkillsFileRow>span{min-width:0;overflow-wrap:anywhere;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshSkillsNote{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}
.dshSkillsDescription{margin:0;font-size:13px;line-height:21px;overflow-wrap:anywhere}
.dshSkillsFacts{display:flex;flex-direction:column;gap:10px;margin:0;font-size:12px;line-height:19px}
.dshSkillsFacts>div{display:grid;grid-template-columns:86px minmax(0,1fr);gap:12px}
.dshSkillsFacts dt{color:var(--dsw-alias-label-secondary)}
.dshSkillsFacts dd{margin:0;overflow-wrap:anywhere}
.dshSkillsFacts code{font-family:var(--ds-font-family-code,monospace);font-size:11px}
.dshSkillsFacts.dshSkillsDestination>div{grid-template-columns:max-content minmax(0,1fr)}
.dshSkillsDestination dt{white-space:nowrap}
.dshSkillsInvocation{border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2);padding:4px 0}
.dshSkillsInvocation>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;font-size:13px}
.dshSkillsInstructions h3{margin:0 0 8px;font-size:13px;font-weight:600}
.dshSkillsInstructions pre{margin:0;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:6px;padding:12px;background:var(--dsw-alias-bg-layer-2);font:12px/20px var(--ds-font-family-code,monospace)}
.dshSkillsConfirmation{display:flex;flex-direction:column;gap:10px;width:100%;font-size:13px;line-height:20px}
.dshSkillsConfirmation .dshIntegrationsRowActions{justify-content:flex-end;flex-wrap:wrap}
@container(max-width:700px){.dshSkillsToolbar>.dshSkillsCatalogActions{flex-basis:100%;margin-left:0}}
@container(max-width:720px){.dshSkillsGrid{grid-template-columns:minmax(0,1fr)}}
@container(max-width:540px){.dshSkillsToolbar{flex-wrap:wrap}.dshSkillsToolbar .dshIntegrationsSearch{flex-basis:100%}.dshSkillsToolbar>.dshIntegrationsIconButton{margin-left:auto}.dshSkillsPage .dshIntegrationsHeader{align-items:flex-start}.dshSkillsPage .dshIntegrationsHeader .dshIntegrationsRowActions{width:auto}.dshSkillsCategories{gap:4px}.dshSkillsCategories button{padding:7px 10px;font-size:13px}.dshSkillsCard{column-gap:12px;padding:20px 18px 18px;min-height:160px}.dshSkillsCardOpen{top:16px;right:14px}}
@container(max-width:700px){.dshSkillsDirectories li>div{display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:4px 8px}.dshSkillsDirectoryName{flex:0 1 auto}.dshSkillsDirectories li small{flex:none}.dshSkillsDirectories code{flex:0 0 100%;width:auto}}
@container(max-width:540px){.dshSkillsDirectories>header{flex-direction:column}.dshSkillsDirectories>header .dshIntegrationsCommand{align-self:flex-start}.dshSkillsDirectories code{white-space:normal;overflow-wrap:anywhere}}
@container(max-width:380px){.dshSkillsDirectoryName{white-space:normal}}
@container(max-width:380px){.dshSkillsToolbar .dshSkillsPresetMenu{max-width:calc(100% - 38px)}.dshSkillsCard{grid-template-columns:40px minmax(0,1fr)}.dshSkillsCategoryIcon{width:40px;height:40px;border-radius:12px}.dshSkillsCategoryIcon svg{width:23px;height:23px}}
@media(max-width:480px){.dshSkillsFacts>div{grid-template-columns:70px minmax(0,1fr)}.dshSkillsDialogFooter .dshIntegrationsCommand,.dshSkillsDialogFooter .dshIntegrationsDanger{padding:5px 10px}.dshSkillsDialog .dshIntegrationsRowActions{flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){.dshSkillsPage *{transition:none!important}}
`
