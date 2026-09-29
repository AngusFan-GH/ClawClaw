import { useEffect, useMemo, useRef, useState } from 'react'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import FileText from 'lucide-react/dist/esm/icons/file-text.mjs'
// @ts-expect-error package subpath has no declaration file
import Folder from 'lucide-react/dist/esm/icons/folder.mjs'
// @ts-expect-error package subpath has no declaration file
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.mjs'
import { SettingsIconButton } from './settings-controls.tsx'
import type { DesktopSkillFile, DesktopSkillFilePreview } from '../skills-contract.ts'
import type { DesktopSkillsApi } from './skills-api.ts'
import type { DesktopSkillsLocaleKey } from './skills-locales.ts'

interface Directory { directories: Map<string, Directory>; files: DesktopSkillFile[] }
function directoryOf(files: readonly DesktopSkillFile[]): Directory {
  const root: Directory = { directories: new Map(), files: [] }
  for (const file of files) {
    let directory = root
    for (const part of file.path.split('/').slice(0, -1)) {
      if (!directory.directories.has(part)) directory.directories.set(part, { directories: new Map(), files: [] })
      directory = directory.directories.get(part)!
    }
    directory.files.push(file)
  }
  return root
}
export function SkillFiles({ name, api, t }: { name: string; api: DesktopSkillsApi; t: (key: DesktopSkillsLocaleKey) => string }) {
  const [files, setFiles] = useState<readonly DesktopSkillFile[]>()
  const [preview, setPreview] = useState<DesktopSkillFilePreview>()
  const [selected, setSelected] = useState<string>()
  const [listError, setListError] = useState(false)
  const [fileError, setFileError] = useState(false)
  const [reload, setReload] = useState(0)
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const section = useRef<HTMLElement>(null)
  const previousSelection = useRef<string>()
  useEffect(() => {
    const previous = previousSelection.current
    previousSelection.current = selected
    if (!section.current || section.current.getBoundingClientRect().width === 0) return
    if (selected !== undefined && section.current.getBoundingClientRect().width <= 540) section.current.querySelector<HTMLButtonElement>('.dshSkillFilePreviewHeader button')?.focus()
    else if (selected === undefined && previous !== undefined) {
      const button = [...section.current.querySelectorAll<HTMLButtonElement>('.dshSkillFileTree button')].find(item => item.getAttribute('aria-label') === previous)
      if (button && button.getClientRects().length > 0) button.focus()
      else section.current.querySelector<HTMLInputElement>('input')?.focus()
    }
  }, [selected])
  useEffect(() => {
    let active = true
    setFiles(undefined); setListError(false)
    void api.files?.(name).then(value => {
      if (!active) return
      setFiles(value)
      setSelected(current => value.some(file => file.path === current && !file.blocked) ? current : undefined)
    }, () => { if (active) setListError(true) })
    return () => { active = false }
  }, [api, name, reload])
  useEffect(() => {
    let active = true
    setPreview(undefined); setFileError(false)
    if (selected && files) void api.file?.(name, selected).then(value => { if (active) setPreview(value) }, () => { if (active) setFileError(true) })
    return () => { active = false }
  }, [api, name, selected, files, retry])
  const filtered = useMemo(() => files?.filter(file => file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [], [files, query])
  const tree = useMemo(() => directoryOf(filtered), [filtered])
  const branch = (directory: Directory, prefix = '') => <ul>
    {[...directory.directories].sort(([a], [b]) => a.localeCompare(b)).map(([part, child]) => <li key={`${prefix}${part}/`}>
      <details key={`${prefix}${part}:${query !== ''}`} open={query !== '' || undefined}><summary><Folder aria-hidden="true" /><span>{part}</span></summary>{branch(child, `${prefix}${part}/`)}</details>
    </li>)}
    {directory.files.map(file => <li key={file.path}><button type="button" title={file.path} disabled={file.blocked} aria-label={file.path} aria-pressed={selected === file.path} onClick={() => { setSelected(file.path); setRetry(value => value + 1) }}>
      <FileText aria-hidden="true" /><span>{file.path.split('/').at(-1)}</span><small>{file.blocked ? t('skillFileBlocked') : `${Math.ceil(file.size / 1024)} KiB`}</small>
    </button></li>)}
  </ul>
  return <section ref={section} className="dshSkillFiles" aria-label={t('skillFiles')}>
    <div className="dshSkillsFileRow"><input type="search" aria-label={t('searchSkillFiles')} placeholder={t('searchSkillFiles')} value={query} onChange={event => { setQuery(event.target.value) }} />
      <SettingsIconButton label={t('refresh')} onClick={() => { setReload(value => value + 1) }}><RefreshCw /></SettingsIconButton></div>
    {listError && <p role="alert">{t('skillFilesUnavailable')}</p>}
    {!files && !listError && <p role="status">{t('loading')}</p>}
    {files && <div className="dshSkillFileBrowser" data-preview={selected !== undefined}>
      <nav className="dshSkillFileTree" aria-label={t('skillFiles')}>
        {filtered.length === 0 ? <p className="dshSkillsNote">{t('noMatches')}</p> : branch(tree)}
      </nav>
      <div className="dshSkillFilePreview" aria-busy={selected !== undefined && !preview && !fileError}>
        {selected === undefined ? <p className="dshSkillsNote">{t('selectSkillFile')}</p> : <>
          <div className="dshSkillFilePreviewHeader"><SettingsIconButton label={t('backToFiles')} onClick={() => { setSelected(undefined) }}><ArrowLeft /></SettingsIconButton><code>{selected}</code></div>
          {fileError ? <div role="alert"><p>{t('skillFilesUnavailable')}</p><SettingsIconButton label={t('refresh')} onClick={() => { setRetry(value => value + 1) }}><RefreshCw /></SettingsIconButton></div>
            : !preview ? <p role="status">{t('loading')}</p> : preview.unavailable ? <p className="dshSkillsNote">{t('skillFileNoPreview')}</p> : <pre tabIndex={0}>{preview.content}</pre>}
        </>}
      </div>
    </div>}
  </section>
}
