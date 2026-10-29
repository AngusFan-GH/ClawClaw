/** Opt-in Host contribution; no upstream client or root layout overrides. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import { GENUI_FORMAT, GENUI_RENDER_TOOL, GENUI_VALIDATE_TOOL, GENUI_LIMITS, type GenuiSettings } from './genui-contract.ts'
import { genuiPresentationGuard } from './genui-presentation-policy.ts'
import { applyGenuiState } from './genui-state.ts'
import { genuiText, validateGenuiDocument } from './genui-core.ts'

export const name = 'desktop-genui'
export const inject = ['settings']
export const Config: z<GenuiSettings> = z.object({ enabled: z.boolean().default(false) })
export const GENUI_PROMPT = `ClawClaw supports structured result cards and isolated local interactive snippets through ${GENUI_RENDER_TOOL}.
Use cards only when they improve a comparison, small data summary, or plan; ordinary prose remains appropriate.
Presentation routing: for a small calculator, chart, filter or interactive explanation requested in this conversation, call clawclaw_render_ui directly. Inline rendering is the default, including requests that mention HTML. Do not first create an HTML file, start a server, open a browser or run browser automation merely to display or verify this inline result. Use clawclaw_validate_ui for document validation when needed; do not claim visual verification from tool success.
Use a website, standalone-file, export or browser workflow only when the user requests that deliverable or interaction. Researching source data when needed is still allowed; it does not change the requested inline presentation.
Use the conversation language for titles, labels, and content. Do not emit dsh-ui fences.
Independent cards are shown with the answer, outside collapsed tool details. Use optional document.resultId (a nonblank string, max 160 characters) to update an existing result with the same ID within this Turn. Omit resultId for a new independent result; do not reuse IDs for unrelated results. Group related charts in one document. Use a brief conclusion plus one main visual area by default. Keep detailed explanations in the document only when useful; do not repeat card data, code, tool names or implementation progress in the final answer. Never claim the interface is visible solely because validation succeeded. Render success confirms accepted source and metadata, not a painted-client inspection. Describe only what was actually verified.
Pass document_json as one JSON string containing the complete document, for example document_json='{"format":"${GENUI_FORMAT}","title":"Example","items":[{"type":"text","content":"Hello"}]}'. Preserve arrays as JSON arrays inside that string; do not translate arrays into {item:...} objects or XML tags. The legacy document object parameter is accepted for compatibility, but prefer document_json. Supply exactly one of these parameters.
If validation or rendering fails, correct the document and retry inline with document_json. Do not silently replace the requested inline result with an external browser or standalone page.
Supported components (exact field names):
text {type:"text",content:string}; card {type:"card",title:string,items:components}; row {type:"row",items:components};
stat {type:"stat",label:string,value:string|number}; table {type:"table",columns:string[],rows:scalar[][]};
progress {type:"progress",label:string,value:number 0..100}; callout {type:"callout",content:string,tone:"info"|"success"|"warning"|"error"};
steps {type:"steps",steps:string[]}.
html {type:"html",title:string,html:string,fallback:string}. Use for small local calculators, filters or interactive explanations. Render directly in the chat; put html at document.items without an extra card wrapper, file link or code fence. Include a readable fallback. Limit: 2 fragments per document, 32 KiB UTF-8 each. Use self-contained inline CSS/JavaScript and accessible native controls. External resources, network, eval, navigation, file access and business actions are unavailable. Prefer native form controls: ordinary input values can be restored on reopen, except private/password/file/hidden/autocomplete-off fields. Do not promise restoration of every custom interaction or business records. Source is saved with the conversation. Keep responses focused on the result; do not add standalone files, deployment instructions or storage explanations unless requested. Reset clears saved inputs; pause/resume retains them. Prefer standard components for ordinary tables and charts.
chart {type:"chart",kind:"bar"|"line"|"pie",title:string,categories:string[],series:[{name:string,values:(number|null)[]}],unit?:string}.
Charts: at most 8 charts per document, 60 unique categories per chart and 4 uniquely named series; each values array matches categories. Values have magnitude <=1e15. Null is missing data for bar/line (not zero). Pie requires one series of nonnegative numbers, with no nulls, and at most 12 categories. Empty categories are allowed for an honest no-data state. Do not invent, round or reorder source data just to draw a chart. Choose bar for category comparisons, line for ordered trends, pie only for nonnegative parts of one total, preferably at most 5 categories; prefer bar when categories are numerous or values are similar.
Outside isolated html components, HTML, scripts, arbitrary styles, forms, and actions are not supported. HTML snippets cannot perform business actions or call tools. Do not collect credentials.
Limits: 200 components, 8 component levels, 50 table rows, 12 columns, 24 steps, 2000 characters per text and 160 per title/label.
Do not omit source data to fit a limit without explaining the selection. Validate uncertain documents with ${GENUI_VALIDATE_TOOL}, fix reported paths, then render.
Cards describe results; rendering a progress or success card does not execute or prove a task succeeded.`

export function createGenuiTool(mode: 'render' | 'validate', enabled: () => boolean = () => true): ToolDefinition {
  return defineTool({
    name: mode === 'render' ? GENUI_RENDER_TOOL : GENUI_VALIDATE_TOOL,
    description: mode === 'render'
      ? 'Render cards, charts and small interactive HTML directly in this chat. Default for in-conversation visualizations and calculators; no HTML file, server or browser is needed. Pass a versioned document. Does not execute business actions.'
      : 'Validate a ClawClaw structured UI document. Returns exact field diagnostics; does not display a card.',
    parameters: {
      document_json: { type: 'string', description: 'Preferred: complete document serialized as a JSON string. Arrays must stay JSON arrays, e.g. {"format":"clawclaw.genui/v1","title":"Example","items":[{"type":"text","content":"Hello"}]}. ' + GENUI_PROMPT },
      document: { type: 'json', description: 'Legacy document object. Prefer document_json to preserve nested arrays across model transports. Supply only one parameter.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        if (mode === 'render') {
          const parsed = validateGenuiDocument(value)
          if (!parsed.ok) throw new TypeError('Invalid GenUI output')
          return [{ type: 'text', text: genuiText(parsed.document) }]
        }
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
      presentationMeta: (_args, value) => mode === 'render' ? value : null,
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (!enabled()) throw new Error('GenUI is disabled.')
      const retry = 'Retry inline using document_json: serialize the complete document as one JSON string, with items as a JSON array. Do not open a browser as a fallback.'
      let input: unknown = args.document
      let parseError: string | undefined
      if ((args.document_json === undefined) === (args.document === undefined)) parseError = 'Supply exactly one of document_json or document.'
      else if (args.document_json !== undefined || typeof input === 'string') {
        const source = args.document_json ?? input
        if (typeof source !== 'string' || source.length > GENUI_LIMITS.bytes) parseError = 'Expected a bounded JSON document string.'
        else try { input = JSON.parse(source) as unknown } catch { parseError = 'Invalid JSON document string.' }
      }
      const parsed = parseError === undefined ? validateGenuiDocument(input)
        : { ok: false as const, diagnostics: [{ path: '$.document_json', message: parseError }] }
      if (mode === 'validate') return parsed.ok ? { ok: true, format: GENUI_FORMAT, next_step: 'Validation only; nothing has been displayed. Call clawclaw_render_ui now with the same document_json to show it in this conversation. Do not switch to a local browser.' } : { ...parsed, hint: retry }
      if (!parsed.ok) throw new TypeError(parsed.diagnostics.map(d => `${d.path}: ${d.message}`).join('\n') + '\n' + retry)
      return parsed.document
    },
  })
}

export function apply(ctx: Context): void {
  const settings = ctx.settings.register('clawclaw-genui', Config, { applies: 'live' })
  applyGenuiState(ctx, () => settings.get().enabled)
  ctx.inject(['tools', 'systemPrompt'], scope => {
    scope.effect(() => {
      let active: Array<() => void> = []
      const clear = (): void => { for (const dispose of active.splice(0).reverse()) dispose() }
      const reconcile = (): void => {
        if (!settings.get().enabled) { clear(); return }
        if (active.length > 0) return
        try {
          active.push(scope.tools.guard(genuiPresentationGuard))
          active.push(scope.tools.register(createGenuiTool('render', () => settings.get().enabled)))
          active.push(scope.tools.register(createGenuiTool('validate', () => settings.get().enabled)))
          active.push(scope.systemPrompt.section({ name: 'clawclaw:genui',
            order: scope.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'), text: GENUI_PROMPT }))
        } catch (cause) { clear(); throw cause }
      }
      const stop = settings.watch(reconcile)
      try { reconcile() } catch (cause) { stop(); throw cause }
      return () => { stop(); clear() }
    }, 'desktop: optional GenUI tools and prompt')
  })
}
