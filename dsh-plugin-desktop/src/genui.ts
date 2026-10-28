/** Opt-in Host contribution; no upstream client or root layout overrides. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import { GENUI_FORMAT, GENUI_RENDER_TOOL, GENUI_VALIDATE_TOOL, type GenuiSettings } from './genui-contract.ts'
import { genuiText, validateGenuiDocument } from './genui-core.ts'

export const name = 'desktop-genui'
export const inject = ['settings']
export const Config: z<GenuiSettings> = z.object({ enabled: z.boolean().default(false) })
export const GENUI_PROMPT = `ClawClaw supports structured result cards and isolated local interactive snippets through ${GENUI_RENDER_TOOL}.
Use cards only when they improve a comparison, small data summary, or plan; ordinary prose remains appropriate.
Use the conversation language for titles, labels, and content. Do not emit dsh-ui fences.
Independent cards are shown with the answer, outside collapsed tool details. Use optional document.resultId (a nonblank string, max 160 characters) to update an existing result with the same ID within this Turn. Omit resultId for a new independent result; do not reuse IDs for unrelated results. Group related charts in one document. Give a concise useful conclusion or explanation alongside cards, without repeating their data or tool names. Tool success confirms the document was saved, not that you inspected the browser display.
Pass document={format:"${GENUI_FORMAT}",title:"...",items:[...]}.
Supported components (exact field names):
text {type:"text",content:string}; card {type:"card",title:string,items:components}; row {type:"row",items:components};
stat {type:"stat",label:string,value:string|number}; table {type:"table",columns:string[],rows:scalar[][]};
progress {type:"progress",label:string,value:number 0..100}; callout {type:"callout",content:string,tone:"info"|"success"|"warning"|"error"};
steps {type:"steps",steps:string[]}.
html {type:"html",title:string,html:string,fallback:string}. Use only for useful local interactivity (calculators, filters, simulations). Interactive HTML appears directly in the chat answer, without opening a page or tool details. Put html components directly in document.items; do not wrap them in card components or return a file link/code fence instead of rendering. Include a readable fallback describing the initial result and interaction. At most 2 fragments per document, 32 KiB UTF-8 each. Pass an HTML fragment with inline CSS/JavaScript, semantic controls and concise accessible labels. All data and code must be self-contained; use inline SVG/canvas for custom visuals. External scripts, imports, resources, fetch, forms submission, navigation, host APIs, secrets and file access are unavailable. State is local and resets on remount. Never imitate app permission dialogs or claim the snippet executed real operations. Prefer standard components for ordinary tables and charts.
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
      ? 'Display a structured ClawClaw result card or isolated local interactive HTML snippet. Pass a versioned document with title and supported components. Does not execute actions.'
      : 'Validate a ClawClaw structured UI document. Returns exact field diagnostics; does not display a card.',
    parameters: { document: { type: 'json', required: true, description: GENUI_PROMPT } },
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
      const parsed = validateGenuiDocument(args.document)
      if (mode === 'validate') return parsed.ok ? { ok: true, format: GENUI_FORMAT } : parsed
      if (!parsed.ok) throw new TypeError(parsed.diagnostics.map(d => `${d.path}: ${d.message}`).join('\n'))
      return parsed.document
    },
  })
}

export function apply(ctx: Context): void {
  const settings = ctx.settings.register('clawclaw-genui', Config, { applies: 'live' })
  ctx.inject(['tools', 'systemPrompt'], scope => {
    scope.effect(() => {
      let active: Array<() => void> = []
      const clear = (): void => { for (const dispose of active.splice(0).reverse()) dispose() }
      const reconcile = (): void => {
        if (!settings.get().enabled) { clear(); return }
        if (active.length > 0) return
        try {
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
