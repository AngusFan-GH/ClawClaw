import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { useErrorMessage, ErrorNote, PageHeader, Empty, StatusBadge } from '../../components/extras';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import type { ChannelAccount, ChannelAdapterMeta } from '../../lib/types';

export default function ChannelsPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const accounts = useQuery(() => api.channels(), []);
  const catalog = useQuery(() => api.channelCatalog(), []);
  const [creating, setCreating] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = () => accounts.reload();
  const run = async (op: () => Promise<unknown>, ok?: string) => {
    try { await op(); await reload(); if (ok) toast.success(ok); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('channels.title')} subtitle={t('channels.subtitle')} />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold">{t('channels.add')}</h2>
          <div className="flex flex-wrap gap-2">
            {catalog.data?.map((a) => (
              <button
                key={a.type}
                disabled={!a.supported}
                onClick={() => setCreating(a.type)}
                title={a.unsupportedReason}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm ${a.supported ? 'hover:bg-accent' : 'cursor-not-allowed opacity-50'}`}
              >
                + {a.label}
                {!a.supported && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('channels.unsupported')}</span>}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-6">
          {accounts.data?.length === 0 && <Empty>{t('channels.noAccounts')}</Empty>}
          <div className="grid gap-3 md:grid-cols-2">
            {accounts.data?.map((acc) => (
              <AccountCard key={acc.id} account={acc} onReload={reload} onDelete={() => setConfirmId(acc.id)} run={run} />
            ))}
          </div>
        </section>
        {accounts.error && <div className="mt-3"><ErrorNote>{errorMessage(accounts.error)}</ErrorNote></div>}
      </div>

      {creating && <CreateDialog type={creating} catalog={catalog.data ?? []} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); void reload(); }} />}
      <ConfirmDialog open={Boolean(confirmId)} title={t('common.delete')} message={t('common.confirmDelete')} variant="destructive"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => { if (confirmId) void run(() => api.deleteChannel(confirmId), t('common.deleted')).then(() => setConfirmId(null)); else setConfirmId(null); }} />
    </div>
  );
}

function AccountCard({ account, onReload, onDelete, run }: {
  account: ChannelAccount; onReload: () => void; onDelete: () => void;
  run: (op: () => Promise<unknown>, ok?: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [testText, setTestText] = useState('Hello from ClawCore');
  const [inbound, setInbound] = useState({ sourceId: 'user-1', idempotencyKey: 'k1', text: 'inbound test' });
  const endpoint = String(account.config.endpointUrl ?? '');

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <strong className="text-sm">{account.displayName}</strong>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{account.adapter}</span>
        <StatusBadge status={account.status} />
        <button onClick={onDelete} className="ml-auto text-xs text-red-500 hover:underline">{t('common.delete')}</button>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{endpoint} · {account.hasSecrets ? '🔑' : ''}</p>
      {account.lastErrorMessage && <p className="mt-1 text-xs text-red-600">{account.lastErrorCode}: {account.lastErrorMessage}</p>}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <button className="rounded-lg border px-3 py-1.5" onClick={() => void run(() => api.connectChannel(account.id))}>🔌 {t('channels.connect')}</button>
        <button className="rounded-lg border px-3 py-1.5" onClick={() => void run(() => api.disconnectChannel(account.id))}>{t('channels.disconnect')}</button>
        <label className="flex items-center gap-1 rounded-lg border px-3 py-1.5">
          <input type="checkbox" checked={account.inboundStarted} onChange={(e) => void run(() => (e.target.checked ? api.startInbound(account.id) : Promise.resolve(api.stopInbound(account.id))))} />
          {t('channels.inbound')}
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <input value={testText} onChange={(e) => setTestText(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border px-2 py-1.5 text-xs" />
        <button className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          onClick={async () => {
            try { const r = await api.sendChannel(account.id, testText); toast.success(r.delivered ? t('channels.delivered') : t('channels.sendFailed')); await onReload(); }
            catch (e) { toast.error(errorMessage(e)); }
          }}>{t('channels.sendTest')}</button>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">{t('channels.testInbound')}</summary>
        <div className="mt-2 grid gap-1">
          <input value={inbound.sourceId} onChange={(e) => setInbound({ ...inbound, sourceId: e.target.value })} placeholder={t('channels.sourceId')} className="rounded border border-border px-2 py-1 text-xs" />
          <input value={inbound.idempotencyKey} onChange={(e) => setInbound({ ...inbound, idempotencyKey: e.target.value })} placeholder={t('channels.idempotencyKey')} className="rounded border border-border px-2 py-1 text-xs" />
          <input value={inbound.text} onChange={(e) => setInbound({ ...inbound, text: e.target.value })} placeholder={t('channels.message')} className="rounded border border-border px-2 py-1 text-xs" />
          <button className="rounded bg-secondary px-3 py-1 text-xs"
            onClick={async () => {
              try { const r = await api.ingest(account.id, inbound); toast.success(r.routed ? t('channels.routed') : r.reason ?? ''); await onReload(); }
              catch (e) { toast.error(errorMessage(e)); }
            }}>→</button>
        </div>
      </details>
    </div>
  );
}

function CreateDialog({ type, catalog, onClose, onSaved }: { type: string; catalog: ChannelAdapterMeta[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const meta = catalog.find((c) => c.type === type);
  const [displayName, setDisplayName] = useState(meta?.label ?? type);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await api.createChannel({ adapter: type, displayName, config, secrets });
      onSaved();
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">{meta?.label ?? type}</h2>
        <label className="mt-3 block text-xs">{t('channels.displayName')}
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
        {meta?.configFields.map((f) => (
          <label key={f.key} className="mt-2 block text-xs">{f.label}
            <input value={config[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} placeholder={f.placeholder} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
          </label>
        ))}
        {meta?.secretFields.map((f) => (
          <label key={f.key} className="mt-2 block text-xs">{f.label}
            <input type="password" value={secrets[f.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
          </label>
        ))}
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">{t('common.cancel')}</button>
          <button onClick={() => void save()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
