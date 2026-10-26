/** Long-term preferences use the same typography and surfaces as desktop settings. */
export const REMINDERS_CSS = `
.dshReminders{gap:var(--dsh-space-6)}
.dshReminders>.dshIntegrationsHeader{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start}
.dshRemindersPanel,.dshRemindersCollection{display:flex;flex-direction:column;gap:14px;min-width:0}
.dshRemindersPanel{padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsh-card-radius);background:var(--dsw-alias-bg-layer-1)}
.dshRemindersPanel h3,.dshRemindersPanel h4,.dshRemindersCollection h3{margin:0;font-size:var(--dsh-section-title-size);font-weight:600;line-height:1.5}
.dshRemindersPanelHeader{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 16px}
.dshRemindersPanelHeader>span{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.dshRemindersInput{box-sizing:border-box;display:block;field-sizing:content;width:100%;min-height:96px;max-height:260px;resize:vertical;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.65}
.dshRemindersInput::placeholder{color:var(--dsw-alias-label-secondary);opacity:1}
.dshRemindersInput:focus-visible{outline:2px solid var(--dsh-color-primary);outline-offset:2px}
.dshRemindersComposerActions{display:flex;align-items:center;justify-content:flex-end;gap:12px}
.dshRemindersTextButton{min-height:32px;padding:4px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dshRemindersTextButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshRemindersTextButton:disabled{opacity:.5;cursor:default}
.dshRemindersSuggestions{display:flex;flex-direction:column;gap:10px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1)}
.dshRemindersSuggestions h4{font-size:13px;font-weight:500}
.dshRemindersSuggestions p{margin:-4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.dshRemindersPresets{display:flex;flex-wrap:wrap;gap:8px}
.dshRemindersPresets button{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:var(--dsh-control-height);padding:6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1.5;text-align:left;overflow-wrap:anywhere}
.dshRemindersPresets button>svg{width:13px;height:13px;flex-shrink:0;color:var(--dsw-alias-label-secondary)}
.dshRemindersPresets button>span{color:var(--dsw-alias-label-secondary);font-size:11px}
.dshRemindersPresets button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.dshRemindersPresets button:disabled{cursor:default;opacity:.55}
.dshRemindersList{display:flex;flex-direction:column;gap:10px}
.dshRemindersRow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:flex-start;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dshRemindersStatus{display:inline-block;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dshRemindersRow[data-enabled=false] .dshRemindersBody p{color:var(--dsw-alias-label-secondary)}
.dshRemindersBody{min-width:0}
.dshRemindersBody p{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.65}
.dshRemindersBody .dshIntegrationsRowActions{margin-top:10px}
@container(max-width:520px){
 .dshRemindersPanel{padding:16px}
 .dshRemindersRow{grid-template-columns:auto minmax(0,1fr);padding:14px}
 .dshRemindersRow>.dshIntegrationsRowActions{grid-column:2;justify-content:flex-end}
}
`
