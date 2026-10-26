/** Composer tools share neutral colors; availability does not make them primary actions. */
export const COMPOSER_ACTION_CSS = `
button.dshComposerAction{font-size:13px;line-height:20px;font-weight:500;background:transparent;color:var(--dsw-alias-label-secondary)}
button.dshComposerAction:hover:not(:disabled),button.dshComposerAction[aria-expanded="true"]:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
button.dshComposerAction:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px}
`
