/** Versioned, read-only GenUI vocabulary shared by Host and Client. */
export const GENUI_FORMAT = 'clawclaw.genui/v1'
export const GENUI_ENTRY = 'desktop-genui'
export const GENUI_RENDER_TOOL = 'clawclaw_render_ui'
export const GENUI_VALIDATE_TOOL = 'clawclaw_validate_ui'
export const GENUI_LIMITS = Object.freeze({
  bytes: 64 * 1024, nodes: 200, depth: 8, string: 2000, title: 160,
  rows: 50, columns: 12, steps: 24, diagnostics: 24,
  charts: 8, chartPoints: 60, chartPiePoints: 12, chartSeries: 4, chartValue: 1e15,
})

export interface GenuiSettings { enabled: boolean }
export type GenuiCell = string | number | boolean | null
export type GenuiChart = {
  type: 'chart'
  kind: 'bar' | 'line' | 'pie'
  title: string
  categories: string[]
  series: { name: string; values: (number | null)[] }[]
  unit?: string
}
export type GenuiNode =
  | GenuiChart
  | { type: 'text'; content: string }
  | { type: 'card'; title: string; items: GenuiNode[] }
  | { type: 'row'; items: GenuiNode[] }
  | { type: 'stat'; label: string; value: string | number }
  | { type: 'table'; columns: string[]; rows: GenuiCell[][] }
  | { type: 'progress'; label: string; value: number }
  | { type: 'callout'; content: string; tone: 'info' | 'success' | 'warning' | 'error' }
  | { type: 'steps'; steps: string[] }

export type GenuiDocument = {
  format: typeof GENUI_FORMAT
  title: string
  /** Same ID updates one result within a Turn; omitted IDs create independent results. */
  resultId?: string
  items: GenuiNode[]
}
export type GenuiDiagnostic = { path: string; message: string }
export type GenuiValidation =
  | { ok: true; document: GenuiDocument; diagnostics: [] }
  | { ok: false; diagnostics: GenuiDiagnostic[] }
