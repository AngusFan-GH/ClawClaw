/** Desktop presentation for the pinned Git UI. All colors follow the host theme. */
const anchor = '[data-gitgraph-chip-anchor]'
const dialog = ':is([data-gitgraph-dialog],[data-gitgraph-worktree-dialog],[data-gitgraph-worktree-manager])'
// The pinned package uses CSS modules. Match the semantic suffix rather than its build hash.
const part = (name: string) => {
  const names = name === 'dialogButton' ? [name, 'dialogButtonPrimary'] : [name]
  return `${anchor} :is(${names.flatMap(value => [`[class$="_${value}"]`, `[class*="_${value} "]`]).join(',')})`
}

export const GIT_GRAPH_CSS = `
${anchor} { color:var(--dsw-alias-label-primary);anchor-name:--desktop-git-chip; }
${part('popover')} {
 box-sizing:border-box;width:min(320px,calc(100vw - 32px));max-height:min(440px,calc(100dvh - 160px));
 border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);
 background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent);
 padding:6px;z-index:1001;
}
${part('popoverHero')} {
 position:fixed;position-anchor:--desktop-git-chip;top:calc(anchor(bottom) + 4px);left:anchor(left);
 /* Shrink short menus; the maximum still respects both anchored viewport edges. */
 bottom:16px;height:fit-content;max-height:stretch;position-try-fallbacks:flip-inline;
}
${part('list')} { flex:0 1 auto;min-height:0;max-height:240px; }
${part('backdrop')} { z-index:1000; }
${part('backdrop')}:has(+ ${dialog}) {
 top:var(--dsh-frame-chrome-top,0px);background:var(--dsw-alias-bg-mask-1);
 backdrop-filter:var(--dsw-mask-blur);
}
${anchor} ${dialog} {
 box-sizing:border-box;z-index:1001;width:min(880px,calc(100vw - 48px));
 max-height:calc(100dvh - max(72px,var(--dsh-frame-overlay-top,72px)) - 24px);
 border:0;border-radius:var(--dsw-radius-panel);padding:24px;
 background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
 box-shadow:var(--dsw-elevation-prominent);
}
${anchor} [data-gitgraph-worktree-manager] { width:min(720px,calc(100vw - 48px)); }
${anchor} ${dialog}:has(input):not(:has([class*="_managerList"])) { width:min(480px,calc(100vw - 48px)); }
${part('dialogHeader')} { padding:0;gap:16px;align-items:flex-start; }
${part('dialogHeading')} { min-width:0; }
${part('dialogTitle')} { font-size:16px;font-weight:500;line-height:24px;margin:0 0 6px; }
${part('dialogDescription')} { font-size:13px;line-height:21px;margin:0 0 16px;overflow-wrap:anywhere; }
${part('dialogClose')} { width:28px;height:28px;flex:none;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary); }
${part('dialogField')} { gap:8px;margin-top:8px;font-size:13px; }
${part('dialogField')} input,${part('dialogField')} select {
 box-sizing:border-box;width:100%;min-width:0;height:36px;padding:6px 10px;
 border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);
 background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;
}
${part('dialogField')} input:focus,${part('dialogField')} select:focus { outline:none;box-shadow:none;border-color:var(--dsw-alias-state-business-primary); }
${part('dialogActions')} { gap:8px;margin-top:20px;flex-wrap:wrap; }
${part('dialogButton')} {
 display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;
 min-height:36px;padding:0 14px;border:0.5px solid var(--dsw-alias-border-l3);
 border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);
 font:inherit;font-size:14px;line-height:22px;cursor:pointer;
}
${part('dialogButton')}:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
${part('dialogButtonPrimary')} { border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground); }
${part('dialogButtonPrimary')}:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover); }
${part('dialogButton')}:disabled { opacity:0.4;cursor:default; }
${anchor} :is(button,input,select):focus-visible { outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;box-shadow:none; }
${part('searchBox')} input:focus-visible,${part('dialogField')} :is(input,select):focus-visible { outline:none;box-shadow:none; }
${part('searchBox')} { margin:4px 4px 8px;padding:7px 10px;border-width:1px;border-radius:var(--dsw-radius-md); }
${part('searchBox')}:focus-within { border-color:var(--dsw-alias-state-business-primary); }
${part('item')},${part('footerItem')} { min-height:34px;box-sizing:border-box;padding:8px 10px;border-radius:var(--dsw-radius-md); }
${part('itemName')},${part('footerItem')} { font-size:13px;line-height:20px; }
${part('itemPath')} { font-size:12px;line-height:18px; }
${part('footer')} { margin-top:6px;padding-top:6px;border-color:var(--dsw-alias-border-l1); }
${part('notice')} { font-size:13px;line-height:20px;border-radius:var(--dsw-radius-md);overflow-wrap:anywhere; }
${part('graphBody')} { margin-top:16px;min-height:160px;border-radius:var(--dsw-radius-md);border-color:var(--dsw-alias-border-l1);padding:4px; }
${part('graphSubtitle')} { font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary); }
${part('graphRow')} { gap:12px;padding:10px 12px;border-radius:var(--dsw-radius-sm); }
${part('graphLanes')} { font-size:13px;line-height:20px; }
${part('graphOid')} { min-width:62px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary); }
${part('graphMain')} { gap:5px; }
${part('graphSubject')} { font-size:13px;font-weight:500;line-height:20px; }
${part('graphMeta')} { gap:4px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary); }
${part('graphRef')} { max-width:180px;padding:1px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px; }
${part('graphRefCurrent')} { background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground); }
${part('graphMore')} { min-height:36px;margin-top:12px;font-size:13px;border-radius:var(--dsw-radius-md);border-color:var(--dsw-alias-border-l2); }
${part('graphMore')}:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
${part('managerList')} { margin-top:16px;border-radius:var(--dsw-radius-md);padding:4px;border-color:var(--dsw-alias-border-l1); }
${part('managerRow')} { padding:12px;gap:16px;border-radius:var(--dsw-radius-sm); }
${part('managerInfo')} { gap:6px; }
${part('managerHeadline')} { flex-wrap:wrap;font-size:13px;line-height:20px; }
${part('managerPath')} { font-size:12px;line-height:18px;white-space:normal;overflow-wrap:anywhere; }
${part('managerOid')},${part('managerCheck')} { font-size:12px;line-height:18px; }
${part('managerBadge')} { font-size:11px;line-height:18px;background:var(--dsw-alias-interactive-bg-hover); }
${part('managerCheck')} input { accent-color:var(--dsw-alias-brand-primary); }
${part('managerConfirm')} { flex-wrap:wrap;line-height:20px; }
@media(max-width:640px) {
 ${anchor} ${dialog} { width:calc(100vw - 24px);padding:20px 16px; }
 ${anchor} ${dialog}:has(input):not(:has([class*="_managerList"])) { width:calc(100vw - 24px); }
 ${part('graphRow')} { gap:8px;padding:10px 6px; }
 ${part('graphOid')} { min-width:54px;font-size:11px; }
 ${part('graphLanes')} { max-width:96px;overflow:auto;flex-shrink:0; }
 ${part('graphRef')} { max-width:130px; }
 ${part('managerRow')} { flex-direction:column;gap:12px; }
 ${part('managerActions')} { width:100%;align-items:flex-end; }
}
`

export function installGitGraphStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.desktopGitGraphStyles = ''
  style.textContent = GIT_GRAPH_CSS
  document.head.append(style)
  return () => style.remove()
}
