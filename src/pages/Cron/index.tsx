import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { useErrorMessage, ErrorNote, PageHeader, Empty } from '../../components/extras';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import type { Agent, CronJob } from '../../lib/types';

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')?.slice(0, 400) ?? ['UTC'];
  } catch {
    return ['UTC'];
  }
})();

export default function CronPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const jobs = useQuery(() => api.cron(), []);
  const agents = useQuery(() => api.agents(), []);
  const [editing, setEditing] = useState<CronJob | 'new' | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const run = async (op: () => Promise<unknown>, ok?: string) => {
    try { await op(); await jobs.reload(); if (ok) toast.success(ok); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('cron.title')} subtitle={t('cron.subtitle')}
        action={<button onClick={() => setEditing('new')} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">+ {t('cron.create')}</button>} />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {jobs.data?.length === 0 && <Empty>{t('cron.none')}</Empty>}
        <div className="grid gap-3">
          {jobs.data?.map((job) => (
            <div key={job.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <strong className="text-sm">{job.name}</strong>
                <code className="rounded bg-muted px-2 py-0.5 text-xs">{job.schedule}</code>
                <span className="text-xs text-muted-foreground">{job.timezone}</span>
                <label className="ml-auto flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={job.enabled} onChange={(e) => void run(() => api.setCronEnabled(job.id, e.target.checked))} />
                  {job.enabled ? t('common.enabled') : t('common.disabled')}
                </label>
              </div>
              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{job.message}</p>
              <div className="mt-2 flex items-center gap-3 text-xs">
                <span className={job.lastStatus === 'error' ? 'text-red-500' : 'text-muted-foreground'}>
                  {t('cron.lastRun')}: {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : t('cron.never')}
                  {job.lastError ? ` · ${job.lastError}` : ''}
                </span>
                <span className="ml-auto flex gap-3">
                  <button className="text-primary hover:underline" onClick={() => void run(() => api.triggerCron(job.id))}>▶ {t('cron.runNow')}</button>
                  <button className="hover:underline" onClick={() => setEditing(job)}>{t('common.edit')}</button>
                  <button className="text-red-500 hover:underline" onClick={() => setConfirmId(job.id)}>{t('common.delete')}</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <JobDialog
          job={editing === 'new' ? null : editing}
          agents={agents.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void jobs.reload(); }}
        />
      )}
      <ConfirmDialog open={Boolean(confirmId)} title={t('common.delete')} message={t('common.confirmDelete')} variant="destructive"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => { if (confirmId) void run(() => api.deleteCron(confirmId), t('common.deleted')).then(() => setConfirmId(null)); else setConfirmId(null); }} />
    </div>
  );
}

function JobDialog({ job, agents, onClose, onSaved }: { job: CronJob | null; agents: Agent[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(job?.name ?? '');
  const [message, setMessage] = useState(job?.message ?? '');
  const [schedule, setSchedule] = useState(job?.schedule ?? '0 9 * * *');
  const [timezone, setTimezone] = useState(job?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [agentId, setAgentId] = useState(job?.agentId ?? agents.find((a) => a.isDefault)?.id ?? '');
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const timezones = useMemo(() => TIMEZONES, []);

  const save = async () => {
    setError(null);
    try {
      await api.saveCron({
        id: job?.id, workspaceId: 'default', name, message, schedule, timezone, enabled,
        agentId: agentId || null,
      });
      onSaved();
    } catch (e) {
      setError(`${t('cron.invalid')}: ${errorMessage(e)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">{job ? t('common.edit') : t('cron.create')}</h2>
        <label className="mt-3 block text-xs">{t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
        <label className="mt-2 block text-xs">{t('cron.message')}
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="text-xs">{t('cron.schedule')}
            <input value={schedule} onChange={(e) => setSchedule(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 font-mono text-sm" />
          </label>
          <label className="text-xs">{t('cron.timezone')}
            <input list="tz-list" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
            <datalist id="tz-list">{timezones.map((z) => <option key={z} value={z} />)}</datalist>
          </label>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('cron.help')}</p>
        <label className="mt-2 block text-xs">Agent
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isDefault ? ' ★' : ''}</option>)}
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t('common.enabled')}
        </label>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">{t('common.cancel')}</button>
          <button onClick={() => void save()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
