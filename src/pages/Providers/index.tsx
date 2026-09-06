import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { openExternal } from '../../lib/ipc';
import { useErrorMessage, ErrorNote, PageHeader } from '../../components/extras';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import type { Provider, Vendor } from '../../lib/types';

export default function ProvidersPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const providers = useQuery(() => api.providers(), []);
  const vendors = useQuery(() => api.providerCatalog(), []);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => { await providers.reload(); };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('providers.title')}
        subtitle={t('providers.subtitle')}
        action={<button onClick={() => setCreating(true)} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">+ {t('providers.add')}</button>}
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
        {providers.loading && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
        {providers.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('providers.noProviders')}</p>}
        {providers.data?.map((p) => (
          <ProviderCard key={p.id} provider={p} onChanged={() => void reload()} onDelete={() => setConfirmId(p.id)} />
        ))}
        {providers.error && <ErrorNote>{errorMessage(providers.error)}</ErrorNote>}
      </div>

      {creating && (
        <ProviderForm
          vendors={vendors.data ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void reload(); }}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirmId)}
        title={t('common.delete')}
        message={t('common.confirmDelete')}
        variant="destructive"
        onCancel={() => setConfirmId(null)}
        onConfirm={async () => {
          if (confirmId) {
            try { await api.deleteProvider(confirmId); toast.success(t('common.deleted')); await reload(); } catch (e) { toast.error(errorMessage(e)); }
          }
          setConfirmId(null);
        }}
      />
    </div>
  );
}

function ProviderCard({ provider, onChanged, onDelete }: { provider: Provider; onChanged: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState(false);
  const [secret, setSecret] = useState('');
  const [validation, setValidation] = useState<{ ok?: boolean; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    try { await api.updateProvider(provider.id, body); onChanged(); } catch (e) { toast.error(errorMessage(e)); }
  };

  const validate = async () => {
    setBusy(true); setValidation(null);
    try {
      const result = await api.validateProvider(provider.id);
      setValidation({ ok: result.ok, message: result.ok ? t('providers.valid') : result.message ?? result.code });
    } catch (e) {
      setValidation({ ok: false, message: errorMessage(e) });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{provider.label}</strong>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{provider.vendorId}</span>
        {provider.isDefault && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{t('common.default')}</span>}
        <button onClick={() => api.setProviderEnabled(provider.id, !provider.enabled).then(onChanged).catch((e) => toast.error(errorMessage(e)))}
          className={`rounded-full px-2 py-0.5 text-xs ${provider.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {provider.enabled ? t('common.enabled') : t('common.disabled')}
        </button>
        <span className="text-xs text-muted-foreground">
          {provider.requiresSecret ? (provider.hasSecret ? t('providers.hasKey') : t('providers.noKey')) : t('providers.localNoKey')}
        </span>
        <div className="ml-auto flex gap-2">
          {!provider.isDefault && <button className="text-xs text-primary hover:underline" onClick={() => api.setDefaultProvider(provider.id).then(onChanged).catch((e) => toast.error(errorMessage(e)))}>{t('common.makeDefault')}</button>}
          <button className="text-xs hover:underline" onClick={() => setEditing((v) => !v)}>{t('common.edit')}</button>
          <button className="text-xs text-red-500 hover:underline" onClick={onDelete}>{t('common.delete')}</button>
        </div>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{provider.baseUrl} · {provider.model ?? '—'}</div>

      {validation && (
        <div className={`mt-2 rounded-lg px-3 py-1.5 text-xs ${validation.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{validation.message}</div>
      )}

      {editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs">{t('providers.label')}
            <input className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm" defaultValue={provider.label}
              onBlur={(e) => e.target.value !== provider.label && void patch({ label: e.target.value })} />
          </label>
          {provider.editableModel && (
            <label className="text-xs">{t('providers.model')}
              <input className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm" defaultValue={provider.model ?? ''}
                onBlur={(e) => e.target.value !== (provider.model ?? '') && void patch({ model: e.target.value })} />
            </label>
          )}
          {provider.editableBaseUrl && (
            <label className="text-xs sm:col-span-2">{t('providers.baseUrl')}
              <input className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm" defaultValue={provider.baseUrl ?? ''}
                onBlur={(e) => e.target.value !== (provider.baseUrl ?? '') && void patch({ baseUrl: e.target.value })} />
            </label>
          )}
        </div>
      )}

      {provider.requiresSecret && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={provider.hasSecret ? '••••••••' : t('providers.apiKey')}
            className="min-w-56 flex-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
          <button disabled={!secret} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
            onClick={async () => { try { await api.setProviderSecret(provider.id, secret); setSecret(''); toast.success(t('common.saved')); onChanged(); } catch (e) { toast.error(errorMessage(e)); } }}>
            {provider.hasSecret ? t('providers.replaceKey') : t('providers.setKey')}
          </button>
          {provider.hasSecret && <button className="text-xs text-red-500 hover:underline" onClick={() => api.deleteProviderSecret(provider.id).then(onChanged).catch((e) => toast.error(errorMessage(e)))}>{t('common.delete')}</button>}
          {provider.keyUrl && <button className="text-xs text-primary hover:underline" onClick={() => openExternal(provider.keyUrl!)}>{t('providers.getKey')} ↗</button>}
        </div>
      )}
      {provider.oauthSupported === false && provider.authMode !== 'local' && <p className="mt-2 text-xs text-amber-600">{t('providers.oauthUnsupported')}</p>}

      <div className="mt-3">
        <button disabled={busy} onClick={() => void validate()} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">{busy ? t('providers.validating') : t('providers.validate')}</button>
      </div>
    </div>
  );
}

function ProviderForm({ vendors, onClose, onSaved }: { vendors: Vendor[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? 'openai');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const vendor = vendors.find((v) => v.id === vendorId);
  const authMode = vendor?.defaultAuthMode ?? 'api_key';

  const save = async () => {
    setError(null);
    try {
      const created = await api.createProvider({
        vendorId,
        label: label || vendor?.label,
        baseUrl: baseUrl || vendor?.defaultBaseUrl || null,
        model: model || vendor?.defaultModel || '',
        authMode,
      });
      if (secret && created.requiresSecret) await api.setProviderSecret(created.id, secret);
      toast.success(t('common.saved'));
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-base font-semibold">{t('providers.add')}</h2>
      <label className="mt-3 block text-xs">{t('providers.vendor')}
        <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setBaseUrl(''); setModel(''); }}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-xs">{t('providers.label')}
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={vendor?.label} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
      </label>
      <label className="mt-2 block text-xs">{t('providers.baseUrl')}
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={vendor?.defaultBaseUrl} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
      </label>
      <label className="mt-2 block text-xs">{t('providers.model')}
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={vendor?.defaultModel} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
      </label>
      {authMode === 'api_key' ? (
        <label className="mt-2 block text-xs">{t('providers.apiKey')}
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t('providers.localNoKey')}</p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">{t('common.cancel')}</button>
        <button onClick={() => void save()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{t('common.save')}</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

