/** Desktop adapter for the upstream portaled Workspace action menu. */

export interface DefaultWorkspaceMenuLabels {
  readonly anchor: string | undefined
  readonly rename: string
  readonly delete: string
}

/** Hide the destructive row before paint when the default Workspace opens its menu. */
export function installDefaultWorkspaceMenu(
  document: Document,
  labels: () => DefaultWorkspaceMenuLabels,
): () => void {
  let anchor: Element | null = null
  const hidden = new Map<HTMLElement, string>()
  const restore = (): void => {
    for (const [row, display] of hidden) row.style.display = display
    hidden.clear()
  }
  const reconcile = (): void => {
    const copy = labels()
    if (anchor === null || !anchor.isConnected || copy.anchor === undefined
      || anchor.getAttribute('aria-label') !== copy.anchor) {
      restore()
      return
    }
    // Workspace menus have precisely the rename and delete rows. Session
    // menus and other portaled surfaces must keep their own actions intact.
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      if (rows.length !== 2 || rows[0]?.textContent?.trim() !== copy.rename
        || rows[1]?.textContent?.trim() !== copy.delete) continue
      const row = rows[1].parentElement ?? rows[1]
      if (!hidden.has(row)) {
        hidden.set(row, row.style.display)
        row.style.display = 'none'
      }
    }
  }
  const onClick = (event: Event): void => {
    const target = event.target as Element | null
    const button = target?.closest?.('button[aria-label]') ?? null
    if (button !== null) {
      restore()
      anchor = button.closest('[role="treeitem"]') === null ? null : button
      reconcile()
    }
  }
  const observer = new document.defaultView!.MutationObserver(reconcile)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] })
  document.addEventListener('click', onClick, true)
  return () => {
    observer.disconnect()
    document.removeEventListener('click', onClick, true)
    restore()
  }
}
