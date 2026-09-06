import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { useErrorMessage, ErrorNote, PageHeader, Empty } from '../../components/extras';
import type { Skill } from '../../lib/types';

export default function SkillsPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [query, setQuery] = useState('');
  const skills = useQuery(() => (query ? api.searchSkills(query) : api.skills()), [query]);
  const [configSkill, setConfigSkill] = useState<Skill | null>(null);

  const run = async (op: () => Promise<unknown>, success?: string) => {
    try { await op(); await skills.reload(); if (success) toast.success(success); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const installFromFolder = async () => {
    try {
      const result = (await window.desktop.ipcRenderer.invoke('dialog:open', {
        title: t('skills.installFromFolder'),
        properties: ['openDirectory'],
      })) as { filePaths?: string[] } | null;
      const path = result?.filePaths?.[0];
      if (path) await run(() => api.installSkillFromPath(path), t('common.saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('skills.title')}
        subtitle={t('skills.subtitle')}
        action={
          <div className="flex gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('skills.search')}
              className="rounded-lg border border-border px-3 py-1.5 text-sm" />
            <button onClick={() => void installFromFolder()} className="rounded-xl border px-3 py-1.5 text-sm">📁 {t('skills.installFromFolder')}</button>
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {skills.loading && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
        {skills.data && skills.data.length === 0 && <Empty>{t('skills.none')}</Empty>}
        <div className="grid gap-3 md:grid-cols-2">
          {skills.data?.map((s) => (
            <div key={s.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <strong className="text-sm">{s.name}</strong>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{s.source === 'bundled' ? t('skills.bundled') : t('skills.local')}</span>
                <span className="text-[10px] text-muted-foreground">v{s.version}</span>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => void run(() => api.setSkillEnabled(s.slug, e.target.checked))} />
                  {t('skills.enable')}
                </label>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
              <div className="mt-3 flex gap-3 text-xs">
                {s.configurable && <button className="text-primary hover:underline" onClick={() => setConfigSkill(s)}>⚙</button>}
                {s.source === 'bundled' ? (
                  <button className="text-xs text-muted-foreground" title={t('skills.bundledProtected')} disabled>🔒</button>
                ) : (
                  <button className="text-red-500 hover:underline" onClick={() => void run(() => api.uninstallSkill(s.slug), t('common.deleted'))}>{t('skills.uninstall')}</button>
                )}
              </div>
            </div>
          ))}
        </div>
        {skills.error && <div className="mt-3"><ErrorNote>{errorMessage(skills.error)}</ErrorNote></div>}
      </div>

      {configSkill && <ConfigDialog skill={configSkill} onClose={() => setConfigSkill(null)} onSaved={() => { setConfigSkill(null); void skills.reload(); }} />}
    </div>
  );
}

function ConfigDialog({ skill, onClose, onSaved }: { skill: Skill; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [text, setText] = useState(JSON.stringify(skill.config ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      const parsed = JSON.parse(text);
      await api.configureSkill(skill.slug, parsed);
      toast.success(t('common.saved'));
      onSaved();
    } catch (e) {
      setError(e instanceof SyntaxError ? 'Invalid JSON' : errorMessage(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">{skill.name}</h2>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} className="mt-3 w-full rounded-lg border border-border p-3 font-mono text-xs" />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">{t('common.cancel')}</button>
          <button onClick={() => void save()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
