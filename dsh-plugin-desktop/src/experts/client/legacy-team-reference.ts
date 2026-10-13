const LEGACY_TEAM_REFERENCE_SELECTOR = 'button[data-ref-chip="file"][title^="@专家团："]'
const TEAM_REFERENCE_MARKER = 'data-aag-team-reference'

/** Neutralize persisted team mentions produced before team-specific submission text existed. */
export function installLegacyTeamReferenceGuard(root: Document = document): () => void {
  const changed = new Map<HTMLButtonElement, { disabled: boolean; title: string }>()
  const reconcile = (): void => {
    for (const button of root.querySelectorAll<HTMLButtonElement>(LEGACY_TEAM_REFERENCE_SELECTOR)) {
      if (changed.has(button)) continue
      changed.set(button, { disabled: button.disabled, title: button.title })
      button.disabled = true
      button.title = button.title.slice(1)
      button.setAttribute(TEAM_REFERENCE_MARKER, 'legacy')
    }
  }
  reconcile()
  const observer = new MutationObserver(reconcile)
  observer.observe(root.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const [button, previous] of changed) {
      if (!button.isConnected || button.getAttribute(TEAM_REFERENCE_MARKER) !== 'legacy') continue
      button.disabled = previous.disabled
      button.title = previous.title
      button.removeAttribute(TEAM_REFERENCE_MARKER)
    }
    changed.clear()
  }
}
