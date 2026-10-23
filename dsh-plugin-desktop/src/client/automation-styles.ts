/** Automation surfaces share the host theme and adapt to the panel width. */
export const AUTOMATION_CSS = `
.dshAutomationPage{padding:32px clamp(16px,4vw,56px) 48px}
.dshAutomationPage>.dshCronTasks{max-width:1080px;gap:24px}
.dshCronTasks .dshIntegrationsHeader p{max-width:600px;line-height:1.7}
.dshCronTasks .dshCronPolicyNotice{padding:12px 16px;border-left-width:2px;line-height:1.7}
.dshCronTasks .dshCronToolbar{grid-template-columns:minmax(0,1fr) auto auto;gap:12px}
.dshCronTasks .dshCronList{gap:14px}
.dshCronTasks .dshCronRow{grid-template-columns:minmax(0,1fr) auto;gap:20px;padding:20px;border-radius:12px;align-items:start}
.dshCronTasks .dshCronRow:focus-within{border-color:var(--dsw-alias-border-l2)}
.dshCronTasks .dshCronMain{display:flex;flex-direction:column;align-items:stretch;gap:12px;min-width:0;min-height:44px;border-radius:6px}
.dshCronTasks .dshCronTitle{flex-wrap:wrap;gap:8px 12px;font-size:15px;line-height:1.5}
.dshCronTasks .dshCronTitle strong{overflow:visible;white-space:normal;overflow-wrap:anywhere}
.dshCronTasks .dshCronTitle em{display:inline-flex;align-items:center;gap:7px;flex-shrink:0;padding:3px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400}
.dshCronTasks .dshCronTitle em[data-enabled=true]{color:var(--dsw-alias-label-primary)}
.dshCronPromptPreview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.65}
.dshCronCardMeta{display:flex;flex-wrap:wrap;gap:10px 24px;padding-top:2px}
.dshCronTasks .dshCronSchedule,.dshCronTasks .dshCronNext,.dshCronLatest{display:flex;flex-wrap:wrap;align-items:center;gap:6px;grid-column:auto;grid-row:auto;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dshCronTasks .dshCronSchedule svg{width:14px;height:14px;flex-shrink:0}
.dshCronZone{padding-left:4px}
.dshCronTasks .dshCronNext b,.dshCronLatest b{font-weight:400;color:var(--dsw-alias-label-secondary)}
.dshCronTasks .dshCronNext>span{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dshCronTasks .dshCronRow>.dshIntegrationsRowActions{grid-column:2;gap:8px;flex-wrap:nowrap}
.dshCronTasks .dshCronMoreTrigger{width:36px;height:36px;border-radius:8px}
.dshCronTasks .dshCronSubHeader{display:flex;width:100%;box-sizing:border-box;flex-wrap:wrap;gap:12px}
.dshCronTasks .dshCronBack{min-height:36px;font-size:13px}
.dshCronTasks .dshCronDetail{padding:0;border:0;background:transparent;gap:24px}
.dshCronTasks .dshCronDetailTitle{gap:14px;padding:4px 0 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshCronTasks .dshCronDetailTitle>div{min-width:0}
.dshCronTasks .dshCronDetailTitle h2{font-size:24px;line-height:1.4;overflow-wrap:anywhere}
.dshCronDetailLayout{display:grid;grid-template-columns:minmax(0,280px) minmax(0,1fr);gap:24px;align-items:start}
.dshCronDetailContent{display:flex;flex-direction:column;gap:28px;min-width:0}
.dshCronOverview,.dshCronInstructions,.dshCronHistoryPanel{min-width:0}
.dshCronOverview{padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dshCronOverview h3,.dshCronInstructions h3,.dshCronTasks .dshCronHistoryPanel h3{margin:0;font-size:14px;line-height:1.5;font-weight:600}
.dshCronTasks .dshCronOverview dl{border:0;margin-top:8px}
.dshCronTasks .dshCronOverview dl>div{grid-template-columns:minmax(0,1fr);gap:6px;padding:14px 0}
.dshCronTasks .dshCronOverview dd{font-size:13px;line-height:1.6}
.dshCronTasks .dshCronDetailPrompt{margin:12px 0 0;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);font-size:13px;line-height:1.85;overflow-wrap:anywhere}
.dshCronTasks .dshCronHistoryPanel>header{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;box-sizing:border-box;margin-bottom:12px}
.dshCronHistoryPanel>header>span{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshCronTasks .dshCronHistoryPanel ol{gap:0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden}
.dshCronTasks .dshCronHistoryPanel li{gap:12px;padding:16px;border-radius:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dshCronTasks .dshCronHistoryPanel li:last-child{border-bottom:0}
.dshCronRunBody{flex:1;min-width:0;overflow-wrap:anywhere}
.dshCronRunHeading{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;align-items:center}
.dshCronRunHeading>span{color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.dshCronTasks .dshCronHistoryPanel li p{line-height:1.65}
.dshCronTasks .dshCronOpenSession{min-height:28px;margin-top:4px}
.dshCronTasks button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.dshCronTasks .dshCronEditorBody{display:flex;flex-direction:column;gap:16px;min-width:0;margin:0;padding:0;border:0}
.dshCronTasks .dshIntegrationsError{display:flex;align-items:center;justify-content:space-between;gap:12px;overflow-wrap:anywhere}
.dshCronTasks .dshCronEditor{max-width:800px;width:100%;align-self:center}
.dshCronTasks .dshCronFormSection,.dshCronTasks .dshCronScheduleBuilder{padding:20px;gap:16px}
.dshCronTasks .dshCronEditor textarea{line-height:1.7}
@container(max-width:720px){
 .dshCronDetailLayout{grid-template-columns:minmax(0,1fr)}
 .dshCronTasks .dshCronOverview dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}
 .dshCronTasks .dshCronOverview dl>div:last-child{border-bottom:1px solid var(--dsw-alias-border-l1)}
 .dshCronTasks .dshCronOverview dl>div:nth-last-child(-n+2){border-bottom:0}
}
@container(max-width:720px){
 .dshCronTasks .dshCronToolbar{grid-template-columns:minmax(0,1fr) auto}
 .dshCronTasks .dshCronToolbar p{grid-column:1/-1;grid-row:2;white-space:normal}
 .dshCronTasks .dshCronRow{gap:16px;padding:16px}
 .dshCronZone{display:none}
}
@container(max-width:520px){
 .dshCronTasks .dshCronRow{grid-template-columns:minmax(0,1fr)}
 .dshCronTasks .dshCronRow>.dshIntegrationsRowActions{grid-column:1;justify-content:flex-end}
 .dshCronTasks .dshCronSubHeader>.dshIntegrationsRowActions{width:100%;margin-left:0;flex-wrap:wrap}
 .dshCronTasks .dshCronOverview dl{grid-template-columns:minmax(0,1fr)}
 .dshCronTasks .dshCronOverview dl>div:nth-last-child(2){border-bottom:1px solid var(--dsw-alias-border-l1)}
 .dshCronCardMeta{flex-direction:column;gap:8px}
 .dshCronTasks .dshCronDetailTitle h2{font-size:20px}
}
`
