import { Script } from 'node:vm'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { GENUI_LIMITS, type GenuiDiagnostic, type GenuiDocument, type GenuiNode } from './genui-contract.ts'

/** Parse and compile only. Generated code is never executed in the Host. */
export function validateGenuiHtmlScripts(document: GenuiDocument): GenuiDiagnostic[] {
  const diagnostics: GenuiDiagnostic[] = []
  const check = (source: string, path: string, handler = false): void => {
    try { new Script(handler ? `(function(event){\n${source}\n})` : source) }
    catch (cause) {
      diagnostics.push({ path, message: `Invalid JavaScript: ${cause instanceof Error ? cause.message : 'syntax error'}. Provide complete code without placeholders.` })
    }
  }
  const html = (source: string, path: string): void => {
    const visit = (node: DefaultTreeAdapterMap['node']): void => {
      if ('tagName' in node) {
        for (const attr of node.attrs) if (/^on/i.test(attr.name)) check(attr.value, path, true)
        if (node.tagName === 'script') {
          const type = node.attrs.find(attr => attr.name === 'type')?.value.trim().toLowerCase() ?? ''
          if (['', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript', 'module'].includes(type)) {
            if (!node.sourceCodeLocation?.endTag) diagnostics.push({ path, message: 'Unclosed script element. Include the complete script and its closing tag.' })
            else check(node.childNodes.flatMap(child => 'value' in child ? [child.value] : []).join(''), path)
          }
        }
      }
      if ('childNodes' in node) for (const child of node.childNodes) visit(child)
    }
    visit(parseFragment(source, { sourceCodeLocationInfo: true }))
  }
  const visit = (nodes: GenuiNode[], path: string): void => nodes.forEach((node, index) => {
    const at = `${path}[${index}]`
    if (node.type === 'html') html(node.html, `${at}.html`)
    if (node.type === 'card' || node.type === 'row') visit(node.items, `${at}.items`)
  })
  visit(document.items, '$.items')
  return diagnostics.slice(0, GENUI_LIMITS.diagnostics)
}
