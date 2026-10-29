/** CSP does not stop a frame from navigating itself. Keep opaque srcdoc previews local. */
export function blockIsolatedPreviewNavigation(event: {
  url: string
  frame?: { url: string } | null
  initiator?: { url: string } | null
}): boolean {
  return event.url !== 'about:srcdoc'
    && (event.frame?.url === 'about:srcdoc' || event.initiator?.url === 'about:srcdoc')
}
