import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { useErrorMessage, ErrorNote, PageHeader } from '../../components/extras';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import type { Agent, ChannelAccount, Provider } from '../../lib/types';

export default function AgentsPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const agents = useQuery(() => api.agents(), []);
  const providers = useQuery(() => api.providers(), []);
  const channels = useQuery(() => api.channels(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const reload = () => Promise.all([agents.reload()]);
  const selected = agents.data?.find((a) => a.id === selectedId) ?? agents.data?.find((a) => a.isDefault) ?? null;

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const agent = await api.createAgent(newName.trim());
      setNewName(''); setCreating(false); setSelectedId(agent.id); await reload();
    } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('agents.title')} subtitle={t('agents.subtitle')}
        action={<button onClick={() => setCreating(true)} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">+ {t('agents.create')}</button>} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border/60 p-2">
          {agents.data?.map((a) => (
            <button key={a.id} onClick={() => setSelectedId(a.id)}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${selected?.id === a.id ? 'bg-accent' : 'hover:bg-accent/60'}`}>
              <span className="truncate">{a.name}</span>
              {a.isDefault && <span className="rounded bg-primary/15 px-1.5 text-[10px] text-primary">★</span>}
            </button>
          ))}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {selected && (
            <AgentEditor
              key={selected.id}
              agent={selected}
              providers={providers.data ?? []}
              channels={channels.data ?? []}
              onChanged={() => void reload()}
              onRequestDefault={() => api.setDefaultAgent(selected.id).then(() => void reload()).catch((e) => toast.error(errorMessage(e)))}
              onDelete={() => setConfirmId(selected.id)}
            />
          )}
        </div>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setCreating(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder={t('agents.placeholderName')} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="rounded-lg border px-4 py-2 text-sm">{t('common.cancel')}</button>
              <button onClick={() => void create()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{t('common.create')}</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog open={Boolean(confirmId)} title={t('common.delete')} message={t('common.confirmDelete')} variant="destructive"
        onCancel={() => setConfirmId(null)}
        onConfirm={async () => {
          try { await api.deleteAgent(confirmId!); setConfirmId(null); await reload(); } catch (e) { toast.error(errorMessage(e)); setConfirmId(null); }
        }} />
    </div>
  );
}

function AgentEditor({ agent, providers, channels, onChanged, onRequestDefault, onDelete }: {
  agent: Agent; providers: Provider[]; channels: ChannelAccount[]; onChanged: () => void; onRequestDefault: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try { await api.updateAgent(agent.id, patch); onChanged(); } catch (e) { setError(errorMessage(e)); }
  };

  const boundAccounts = new Set(agent.bindings.map((b) => b.accountId));

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <input key={agent.id} defaultValue={agent.name} onBlur={(e) => e.target.value !== agent.name && void save({ name: e.target.value })}
          className="rounded-lg border border-border px-3 py-2 text-base font-semibold" />
        {!agent.isDefault
          ? <button onClick={onRequestDefault} className="text-xs text-primary hover:underline">{t('common.makeDefault')}</button>
          : <span className="text-xs text-primary">★ {t('agents.isDefault')}</span>}
        <button onClick={onDelete} className="ml-auto text-xs text-red-500 hover:underline">{t('common.delete')}</button>
      </div>

      <section>
        <label className="text-xs font-medium text-muted-foreground">{t('agents.systemPrompt')}</label>
        <textarea key={agent.id + '-prompt'} rows={6} defaultValue={agent.systemPrompt} onBlur={(e) => void save({ systemPrompt: e.target.value })}
          placeholder="You are a helpful local agent…" className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted-foreground">{t('agents.providerOverride')}
          <select defaultValue={agent.providerId ?? ''} onChange={(e) => void save({ providerId: e.target.value || null })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
            <option value="">{t('common.default')}</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">{t('agents.modelOverride')}
          <input defaultValue={agent.model ?? ''} onBlur={(e) => void save({ model: e.target.value || null })}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="gpt-4o" />
        </label>
      </section>

      <section>
        <h3 className="text-xs font-medium text-muted-foreground">{t('agents.budgets')}</h3>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField label={t('agents.maxTurns')} value={agent.budget.maxTurns} onCommit={(v) => void save({ budget: { ...agent.budget, maxTurns: v } })} />
          <NumberField label={t('agents.maxToolCalls')} value={agent.budget.maxToolCalls} onCommit={(v) => void save({ budget: { ...agent.budget, maxToolCalls: v } })} />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" defaultChecked={agent.toolPolicy.requireApproval} onChange={(e) => void save({ toolPolicy: { ...agent.toolPolicy, requireApproval: e.target.checked } })} />
          {t('agents.requireApproval')}
        </label>
      </section>

      <section>
        <h3 className="text-xs font-medium text-muted-foreground">{t('agents.bindings')}</h3>
        {channels.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{t('agents.noBinding')}</p>}
        <div className="mt-2 space-y-1">
          {channels.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={boundAccounts.has(c.id)}
                onChange={(e) => {
                  const op = e.target.checked ? api.bindChannel(agent.id, c.adapter, c.id) : api.unbindChannel(agent.id, c.adapter, c.id);
                  void op.then(onChanged).catch((err) => toast.error(errorMessage(err)));
                }} />
              {c.displayName} <span className="text-xs text-muted-foreground">({c.adapter})</span>
            </label>
          ))}
        </div>
      </section>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">{label}
      <input type="number" defaultValue={value} onBlur={(e) => onCommit(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground" />
    </label>
  );
}
