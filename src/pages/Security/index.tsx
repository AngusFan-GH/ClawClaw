import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface SecurityPolicy {
  prompt: {
    enabled: boolean;
    allowedPaths: string[];
  };
}

const defaultPolicy: SecurityPolicy = {
  prompt: {
    enabled: false,
    allowedPaths: [],
  },
};

function normalizePath(value: string): string {
  return value.trim().replace(/[\\/]+$/, '');
}

function compactPaths(paths: string[]): string[] {
  const deduped = Array.from(new Set(paths.map((p) => normalizePath(p)).filter(Boolean))).sort(
    (a, b) => a.length - b.length
  );

  const result: string[] = [];
  for (const current of deduped) {
    const currentLower = current.toLowerCase();
    const covered = result.some((base) => {
      const baseLower = base.toLowerCase();
      return (
        currentLower === baseLower ||
        currentLower.startsWith(`${baseLower}\\`) ||
        currentLower.startsWith(`${baseLower}/`)
      );
    });
    if (!covered) {
      result.push(current);
    }
  }
  return result;
}

export function Security() {
  const { t } = useTranslation('settings');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy>(defaultPolicy);
  const [lastAppliedAt, setLastAppliedAt] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await hostApiFetch<SecurityPolicy>('/api/security/policy');
      setPolicy({
        prompt: {
          enabled: !!data?.prompt?.enabled,
          allowedPaths: compactPaths(data?.prompt?.allowedPaths || []),
        },
      });
    } catch (error) {
      toast.error(`${t('security.toasts.loadFailed')}: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const addPromptDirs = useCallback(async () => {
    try {
      const result = (await invokeIpc('dialog:open', {
        title: t('security.dialog.selectAllowedDirs'),
        properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
      })) as { canceled: boolean; filePaths?: string[] };

      const selected = result.filePaths ?? [];
      if (result.canceled || selected.length === 0) {
        return;
      }

      setPolicy((prev) => ({
        ...prev,
        prompt: {
          ...prev.prompt,
          allowedPaths: compactPaths([...prev.prompt.allowedPaths, ...selected]),
        },
      }));
    } catch (error) {
      toast.error(`${t('security.toasts.selectDirectoryFailed')}: ${String(error)}`);
    }
  }, [t]);

  const removePromptDir = useCallback((path: string) => {
    setPolicy((prev) => ({
      ...prev,
      prompt: {
        ...prev.prompt,
        allowedPaths: prev.prompt.allowedPaths.filter((item) => item !== path),
      },
    }));
  }, []);

  const applyPolicy = useCallback(async () => {
    const payload = {
      prompt: {
        enabled: policy.prompt.enabled,
        allowedPaths: compactPaths(policy.prompt.allowedPaths),
      },
    };

    if (payload.prompt.enabled && payload.prompt.allowedPaths.length === 0) {
      toast.error(t('security.toasts.enableDirectoryPolicyFirst'));
      return;
    }

    setApplying(true);
    try {
      await hostApiFetch('/api/security/apply', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setLastAppliedAt(new Date().toLocaleString());
      toast.success(t('security.toasts.applySuccess'));
    } catch (error) {
      toast.error(`${t('security.toasts.applyFailed')}: ${String(error)}`);
    } finally {
      setApplying(false);
    }
  }, [policy, t]);

  const resetPolicy = useCallback(async () => {
    setApplying(true);
    try {
      await hostApiFetch('/api/security/reset', { method: 'POST' });
      setPolicy(defaultPolicy);
      setLastAppliedAt(new Date().toLocaleString());
      toast.success(t('security.toasts.resetSuccess'));
    } catch (error) {
      toast.error(`${t('security.toasts.resetFailed')}: ${String(error)}`);
    } finally {
      setApplying(false);
    }
  }, [t]);

  const summary = useMemo(() => {
    if (!policy.prompt.enabled) {
      return t('security.summary.disabled');
    }
    return t('security.summary.enabled', { count: policy.prompt.allowedPaths.length });
  }, [policy.prompt.allowedPaths.length, policy.prompt.enabled, t]);

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground flex items-center gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        {t('security.loading')}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" />
          {t('security.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{summary}</p>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>{t('security.enableDirectoryPolicy')}</Label>
          </div>
          <Switch
            checked={policy.prompt.enabled}
            onCheckedChange={(checked) =>
              setPolicy((prev) => ({ ...prev, prompt: { ...prev.prompt, enabled: checked } }))
            }
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={addPromptDirs}>
            <FolderPlus className="h-4 w-4 mr-2" />
            {t('security.addAllowedDirectories')}
          </Button>
        </div>

        <div className="space-y-2 max-h-56 overflow-auto pr-1">
          {policy.prompt.allowedPaths.length === 0 ? (
            <div className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
              {t('security.noAllowedDirectory')}
            </div>
          ) : (
            policy.prompt.allowedPaths.map((path) => (
              <div key={path} className="flex items-center justify-between rounded-lg border p-2">
                <code className="text-xs break-all">{path}</code>
                <Button variant="ghost" size="icon" onClick={() => removePromptDir(path)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" onClick={() => void loadPolicy()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('security.actions.reload')}
        </Button>
        <Button onClick={() => void applyPolicy()} disabled={applying}>
          {applying ? t('security.applying') : t('security.apply')}
        </Button>
        <Button variant="destructive" onClick={() => void resetPolicy()} disabled={applying}>
          {t('security.actions.reset')}
        </Button>
        {lastAppliedAt && <span className="text-xs text-muted-foreground self-center">{t('security.lastApplied', { time: lastAppliedAt })}</span>}
      </div>
    </div>
  );
}

export default Security;
