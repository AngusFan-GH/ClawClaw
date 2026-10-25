/** A CSS string token, never interpolated as a rule or inserted into the draft. */
export function continuationCssText(text: string): string {
  return `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\r\n?|\n/gu, '\\a ').replace(/\t/gu, '\\9 ')}"`
}

/** Only the mounted, focused public contenteditable may carry inline preview. */
export function continuationSurface(root: HTMLElement | null): HTMLElement | undefined {
  const active = root?.ownerDocument.activeElement
  const editor = active?.closest<HTMLElement>('[contenteditable="true"]')
  if (!root || !editor || !root.contains(editor) || editor.lastElementChild?.tagName !== 'P') return undefined
  const bounds = editor.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0 ? editor : undefined
}
