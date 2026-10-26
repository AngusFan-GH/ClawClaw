/** Connector cards share the Skill library's spacing, typography and theme tokens. */
export const MCP_CARD_CSS = `
.dshMcpPage .dshMcpInstalledList,.dshMcpPage .dshMcpCatalogGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:18px}
.dshMcpPage .dshMcpEmpty{grid-column:1/-1}
.dshMcpPage .dshMcpServerCard,.dshMcpPage .dshMcpCatalogCard{display:flex;box-sizing:border-box;min-width:0;min-height:224px;flex-direction:column;gap:14px;padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:20px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 4px 20px color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);transition:border-color .16s ease,box-shadow .16s ease}
.dshMcpPage .dshMcpServerCard:hover,.dshMcpPage .dshMcpCatalogCard:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 6px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.dshMcpPage .dshMcpServerMain,.dshMcpPage .dshMcpCatalogCard .dshIntegrationsMcpHeader{display:grid;grid-template-columns:52px minmax(0,1fr);align-items:center;gap:12px}
.dshMcpPage .dshMcpGlyph{width:52px;height:52px;border:0;border-radius:15px;background:color-mix(in srgb,var(--dsh-color-primary) 12%,var(--dsw-alias-bg-layer-1));color:var(--dsh-color-accent)}
.dshMcpPage .dshMcpGlyph>svg{width:26px;height:26px}
.dshMcpConnectorIcon{display:flex;align-self:start;width:52px;height:52px}
.dshMcpConnectorIcon .dshSkillsCategoryIcon{width:52px;height:52px;border-radius:15px}
.dshMcpConnectorIcon .dshSkillsCategoryIcon>svg{width:26px;height:26px}
.dshMcpPage .dshMcpIdentity{gap:5px}
.dshMcpPage .dshMcpServerTitle{align-items:flex-start;flex-wrap:wrap;gap:6px}
.dshMcpPage .dshMcpIdentity .dshIntegrationsRowTitle{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;overflow-wrap:anywhere;font-size:16px;font-weight:600;line-height:23px}
.dshMcpPage .dshMcpTransport{align-self:center;font-size:10px;line-height:17px}
.dshMcpCategory,.dshMcpServerId{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;overflow-wrap:anywhere}
.dshMcpPage .dshMcpEndpoint{font-size:11px;line-height:17px}
.dshMcpPage .dshMcpServerStatus{grid-column:1/-1;justify-content:space-between;min-width:0;gap:8px;padding-top:4px}
.dshMcpPage .dshMcpStatus{white-space:normal;font-size:12px;line-height:18px}
.dshMcpPage .dshMcpServerDescription,.dshMcpPage .dshMcpCatalogDescription{display:-webkit-box;margin:0;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:21px;overflow-wrap:anywhere}
.dshMcpPage .dshMcpServerDetails{align-items:flex-start;gap:10px;margin-top:auto;padding:12px 0 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dshMcpPage .dshMcpServerDetails .dshIntegrationsMeta{gap:7px 12px;min-width:0;font-size:11px;line-height:18px;overflow-wrap:anywhere}
.dshMcpPage .dshMcpServerActions{gap:6px;flex-wrap:wrap;justify-content:flex-end}
.dshMcpPage .dshMcpMoreTrigger{width:36px;height:36px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border-color:transparent}
.dshMcpPage .dshMcpServerCard .dshIntegrationsTools{margin:0;padding:0}
.dshMcpPage .dshMcpCatalogCard{min-height:260px;align-self:stretch}
.dshMcpPage .dshMcpCatalogCard .dshIntegrationsMcpHeader{grid-template-columns:52px minmax(0,1fr) auto}
.dshMcpPage .dshMcpCatalogCard .dshIntegrationsMcpHeader>.dshIntegrationsRowActions{grid-column:3;justify-content:flex-end}
.dshMcpPage .dshMcpCatalogCard .dshIntegrationsCommand{min-height:34px;border-radius:9px}
.dshMcpPage .dshMcpCatalogCard .dshIntegrationsTools{margin:0}
.dshMcpPage .dshIntegrationsTools span{border-radius:6px;line-height:17px}
.dshMcpCatalogFooter{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin-top:auto;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}
.dshMcpCatalogRequirement{flex:1 1 auto}
.dshMcpLicense{overflow-wrap:anywhere}
.dshMcpPage .dshMcpCatalogSource{align-self:auto;margin:0;padding:0;font-size:11px}
@container(max-width:700px){
 .dshMcpPage .dshMcpInstalledList,.dshMcpPage .dshMcpCatalogGrid{grid-template-columns:1fr}
 .dshMcpPage .dshMcpServerCard,.dshMcpPage .dshMcpCatalogCard{min-height:0;padding:20px}
 .dshMcpPage .dshMcpServerDetails{flex-direction:row}
}
@container(max-width:400px){
 .dshMcpPage .dshMcpServerCard,.dshMcpPage .dshMcpCatalogCard{padding:16px;border-radius:16px}
 .dshMcpPage .dshMcpServerDetails .dshIntegrationsMeta{flex:1}
 .dshMcpPage .dshMcpServerActions{justify-content:flex-end}
}
@media(prefers-reduced-motion:reduce){.dshMcpPage .dshMcpServerCard,.dshMcpPage .dshMcpCatalogCard{transition:none}}
`
