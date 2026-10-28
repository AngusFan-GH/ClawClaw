import { GENUI_FORMAT, GENUI_LIMITS, type GenuiCell, type GenuiDiagnostic,
  type GenuiDocument, type GenuiNode, type GenuiValidation } from './genui-contract.ts'

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/** Strict validation: no truncation, speculative repair, or executable fields. */
export function validateGenuiDocument(value: unknown): GenuiValidation {
  const diagnostics: GenuiDiagnostic[] = []
  const error = (path: string, message: string): void => {
    if (diagnostics.length < GENUI_LIMITS.diagnostics) diagnostics.push({ path, message })
  }
  // Bound the tree before stringify/parse; callers may also pass cyclic objects.
  let entries = 0
  let bytes = 0
  const ancestors = new Set<object>()
  function budget(item: unknown, depth: number): boolean {
    if (++entries > 12_000 || depth > GENUI_LIMITS.depth * 3 + 8) return false
    if (typeof item === 'string') bytes += new TextEncoder().encode(item).byteLength
    else if (item !== null && typeof item === 'object') {
      if (ancestors.has(item) || (!Array.isArray(item) && !record(item))) return false
      if (Array.isArray(item)) {
        if (item.length > 12_000 || Object.keys(item).length !== item.length) return false
        for (let i = 0; i < item.length; i++) if (!Object.hasOwn(item, i)) return false
      }
      ancestors.add(item)
      for (const key of Object.keys(item)) {
        bytes += new TextEncoder().encode(key).byteLength
        if (!budget((item as Record<string, unknown>)[key], depth + 1)) return false
      }
      ancestors.delete(item)
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) return false
      bytes += String(item).length
    } else if (item === null || typeof item === 'boolean') bytes += String(item).length
    else return false
    return bytes <= GENUI_LIMITS.bytes
  }
  if (!budget(value, 0)) return { ok: false, diagnostics: [{ path: '$', message: 'Invalid JSON value or document budget exceeded.' }] }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > GENUI_LIMITS.bytes) {
    return { ok: false, diagnostics: [{ path: '$', message: 'Document exceeds the serialized byte limit.' }] }
  }
  function keys(obj: Record<string, unknown>, allowed: string[], path: string): void {
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) error(`${path}.${key}`, 'Unsupported field.')
  }
  function text(item: unknown, path: string, max: number = GENUI_LIMITS.string): string {
    if (typeof item !== 'string' || item.length > max) { error(path, `Expected a string of at most ${max} characters.`); return '' }
    return item
  }
  let count = 0
  let charts = 0
  function children(items: unknown, path: string, depth: number): GenuiNode[] {
    if (!Array.isArray(items) || items.length === 0) { error(path, 'Expected a nonempty component array.'); return [] }
    const nodes: GenuiNode[] = []
    for (let i = 0; i < items.length; i++) {
      if (count >= GENUI_LIMITS.nodes) { error(path, `At most ${GENUI_LIMITS.nodes} components are allowed.`); break }
      const node = component(items[i], `${path}[${i}]`, depth)
      if (node !== undefined) nodes.push(node)
    }
    return nodes
  }
  function component(item: unknown, path: string, depth: number): GenuiNode | undefined {
    count++
    if (depth > GENUI_LIMITS.depth) { error(path, `At most ${GENUI_LIMITS.depth} component levels are allowed.`); return }
    if (!record(item)) { error(path, 'Expected a component object.'); return }
    switch (item.type) {
      case 'text':
        keys(item, ['type', 'content'], path)
        return { type: 'text', content: text(item.content, `${path}.content`) }
      case 'card':
        keys(item, ['type', 'title', 'items'], path)
        return { type: 'card', title: text(item.title, `${path}.title`, GENUI_LIMITS.title), items: children(item.items, `${path}.items`, depth + 1) }
      case 'row':
        keys(item, ['type', 'items'], path)
        return { type: 'row', items: children(item.items, `${path}.items`, depth + 1) }
      case 'stat': {
        keys(item, ['type', 'label', 'value'], path)
        const value = typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : text(item.value, `${path}.value`)
        return { type: 'stat', label: text(item.label, `${path}.label`, GENUI_LIMITS.title), value }
      }
      case 'progress':
        keys(item, ['type', 'label', 'value'], path)
        if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0 || item.value > 100) {
          error(`${path}.value`, 'Expected a finite number between 0 and 100.'); return
        }
        return { type: 'progress', label: text(item.label, `${path}.label`, GENUI_LIMITS.title), value: item.value }
      case 'callout': {
        keys(item, ['type', 'content', 'tone'], path)
        const tone = item.tone ?? 'info'
        if (tone !== 'info' && tone !== 'success' && tone !== 'warning' && tone !== 'error') { error(`${path}.tone`, 'Unsupported callout tone.'); return }
        return { type: 'callout', content: text(item.content, `${path}.content`), tone }
      }
      case 'steps':
        keys(item, ['type', 'steps'], path)
        if (!Array.isArray(item.steps) || item.steps.length === 0 || item.steps.length > GENUI_LIMITS.steps) {
          error(`${path}.steps`, `Expected 1–${GENUI_LIMITS.steps} steps.`); return
        }
        return { type: 'steps', steps: item.steps.map((step, i) => text(step, `${path}.steps[${i}]`)) }
      case 'table': {
        keys(item, ['type', 'columns', 'rows'], path)
        if (!Array.isArray(item.columns) || item.columns.length === 0 || item.columns.length > GENUI_LIMITS.columns) {
          error(`${path}.columns`, `Expected 1–${GENUI_LIMITS.columns} column labels.`); return
        }
        const columns = item.columns.map((column, i) => text(column, `${path}.columns[${i}]`, GENUI_LIMITS.title))
        if (!Array.isArray(item.rows) || item.rows.length > GENUI_LIMITS.rows) { error(`${path}.rows`, `Expected at most ${GENUI_LIMITS.rows} rows.`); return }
        const rows: GenuiCell[][] = []
        for (let r = 0; r < item.rows.length; r++) {
          const row: unknown = item.rows[r]
          if (!Array.isArray(row) || row.length !== columns.length) { error(`${path}.rows[${r}]`, 'Row width must match columns.'); continue }
          rows.push(row.map((cell: unknown, c): GenuiCell => {
            if (cell === null || typeof cell === 'boolean' || typeof cell === 'number' && Number.isFinite(cell)) return cell
            return text(cell, `${path}.rows[${r}][${c}]`)
          }))
        }
        return { type: 'table', columns, rows }
      }
      case 'chart': {
        if (++charts > GENUI_LIMITS.charts) { error(path, `At most ${GENUI_LIMITS.charts} charts are allowed.`); return }
        keys(item, ['type', 'kind', 'title', 'categories', 'series', 'unit'], path)
        const kind = item.kind
        if (kind !== 'bar' && kind !== 'line' && kind !== 'pie') { error(`${path}.kind`, 'Expected bar, line or pie.'); return }
        const title = text(item.title, `${path}.title`, GENUI_LIMITS.title)
        if (!title.trim()) error(`${path}.title`, 'Chart title must not be blank.')
        if (!Array.isArray(item.categories) || item.categories.length > GENUI_LIMITS.chartPoints) {
          error(`${path}.categories`, `Expected at most ${GENUI_LIMITS.chartPoints} category labels.`); return
        }
        if (kind === 'pie' && item.categories.length > GENUI_LIMITS.chartPiePoints) {
          error(`${path}.categories`, `Pie supports at most ${GENUI_LIMITS.chartPiePoints} categories.`); return
        }
        const categories = item.categories.map((category, i) => {
          const label = text(category, `${path}.categories[${i}]`, GENUI_LIMITS.title)
          if (!label.trim()) error(`${path}.categories[${i}]`, 'Category must not be blank.')
          return label
        })
        if (new Set(categories).size !== categories.length) error(`${path}.categories`, 'Category labels must be unique.')
        if (!Array.isArray(item.series) || item.series.length === 0 || item.series.length > GENUI_LIMITS.chartSeries
          || kind === 'pie' && item.series.length !== 1) {
          error(`${path}.series`, kind === 'pie' ? 'Pie requires exactly one series.' : `Expected 1–${GENUI_LIMITS.chartSeries} series.`); return
        }
        const series: { name: string; values: (number | null)[] }[] = []
        for (let s = 0; s < item.series.length; s++) {
          const source: unknown = item.series[s]
          const at = `${path}.series[${s}]`
          if (!record(source)) { error(at, 'Expected a series object.'); continue }
          keys(source, ['name', 'values'], at)
          const name = text(source.name, `${at}.name`, GENUI_LIMITS.title)
          if (!name.trim()) error(`${at}.name`, 'Series name must not be blank.')
          if (!Array.isArray(source.values) || source.values.length !== categories.length) {
            error(`${at}.values`, 'Value count must match category count.'); continue
          }
          const values = source.values.map((value: unknown, i): number | null => {
            if (value === null && kind !== 'pie') return null
            if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > GENUI_LIMITS.chartValue
              || kind === 'pie' && value < 0) {
              error(`${at}.values[${i}]`, kind === 'pie'
                ? `Expected a nonnegative finite number no greater than ${GENUI_LIMITS.chartValue}.`
                : `Expected null or a finite number with magnitude at most ${GENUI_LIMITS.chartValue}.`)
              return null
            }
            return value
          })
          series.push({ name, values })
        }
        if (new Set(series.map(value => value.name)).size !== series.length) error(`${path}.series`, 'Series names must be unique.')
        const unit = item.unit === undefined ? undefined : text(item.unit, `${path}.unit`, 32)
        return { type: 'chart', kind, title, categories, series, ...(unit === undefined ? {} : { unit }) }
      }
      default: error(`${path}.type`, 'Unsupported component type.'); return
    }
  }
  if (!record(value)) return { ok: false, diagnostics: [{ path: '$', message: 'Expected a document object.' }] }
  keys(value, ['format', 'title', 'items', 'resultId'], '$')
  if (value.format !== GENUI_FORMAT) error('$.format', `Expected ${GENUI_FORMAT}.`)
  const title = text(value.title, '$.title', GENUI_LIMITS.title)
  const resultId = value.resultId === undefined ? undefined : text(value.resultId, '$.resultId', GENUI_LIMITS.title)
  if (resultId !== undefined && !resultId.trim()) error('$.resultId', 'Expected a nonblank result ID.')
  const items = children(value.items, '$.items', 1)
  return diagnostics.length === 0 ? { ok: true, document: { format: GENUI_FORMAT, title, items, ...(resultId === undefined ? {} : { resultId }) }, diagnostics: [] } : { ok: false, diagnostics }
}

/** Lossless, human-readable fallback kept in the ordinary durable tool result. */
export function genuiText(document: GenuiDocument): string {
  function lines(node: GenuiNode): string[] {
    switch (node.type) {
      case 'text': case 'callout': return [node.content]
      case 'card': return [node.title, ...node.items.flatMap(lines)]
      case 'row': return node.items.flatMap(lines)
      case 'stat': return [`${node.label}: ${node.value}`]
      case 'progress': return [`${node.label}: ${node.value}%`]
      case 'steps': return node.steps.map((step, i) => `${i + 1}. ${step}`)
      case 'table': return [node.columns.join(' | '), ...node.rows.map(row => row.map(cell => cell === null ? '' : String(cell)).join(' | '))]
      case 'chart': return [node.title + (node.unit ? ` (${node.unit})` : ''),
        node.series.map(series => series.name).join(' | '),
        ...node.categories.map((category, i) => `${category}: ${node.series.map(series => series.values[i] === null ? '—' : String(series.values[i])).join(' | ')}`)]
    }
  }
  return [document.title, ...document.items.flatMap(lines)].filter(Boolean).join('\n')
}
