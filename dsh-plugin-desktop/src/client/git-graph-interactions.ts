/** Keyboard behavior for the pinned Git dialogs, without changing upstream files. */
const DIALOGS = '[data-gitgraph-dialog],[data-gitgraph-worktree-dialog],[data-gitgraph-worktree-manager]'

export function installGitGraphInteractions(document: Document = globalThis.document): () => void {
  const observed = new Set<HTMLElement>()
  const update = (): void => {
    for (const dialog of document.querySelectorAll<HTMLElement>(DIALOGS)) {
      if (observed.has(dialog)) continue
      observed.add(dialog)
      dialog.setAttribute('aria-modal', 'true')
      if (!dialog.contains(document.activeElement)) {
        dialog.querySelector<HTMLElement>('input,select,[class*="_dialogClose"],[class*="_dialogButton"]:not([class*="Primary"])')?.focus()
      }
    }
    for (const dialog of observed) if (!dialog.isConnected) observed.delete(dialog)
  }
  const keydown = (event: KeyboardEvent): void => {
    const dialog = document.querySelector<HTMLElement>(DIALOGS)
    const surface = dialog ?? document.querySelector<HTMLElement>('[data-gitgraph-popover]')
    if (!surface || event.defaultPrevented || event.isComposing) return
    if (event.key === 'Escape') {
      const backdrop = surface.previousElementSibling
      if (!(backdrop instanceof HTMLElement) || !backdrop.className.includes('backdrop')) return
      event.preventDefault(); event.stopPropagation(); backdrop.click()
      document.querySelector<HTMLElement>('[data-gitgraph-chip]')?.focus()
    } else if (event.key === 'Tab' && dialog) {
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        .sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      const first = controls[0]; const last = controls.at(-1)
      if (first && (!dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last))) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus()
      }
    }
  }
  const observer = new MutationObserver(update)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('keydown', keydown, true)
  update()
  return () => {
    observer.disconnect(); document.removeEventListener('keydown', keydown, true)
    for (const dialog of observed) dialog.removeAttribute('aria-modal')
    observed.clear()
  }
}
