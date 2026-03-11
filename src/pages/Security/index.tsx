import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  type SecurityPolicy,
  type SecurityRuleKey,
  SECURITY_RULE_DEFINITIONS,
} from '@/shared/security-policy';

const defaultPolicy: SecurityPolicy = {
  prompt: {
    enabled: false,
    deniedPaths: [],
    rules: [],
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

function normalizeLinkedRules(rules: SecurityRuleKey[]): SecurityRuleKey[] {
  const next = new Set<SecurityRuleKey>(rules);
  const hasRuntime = next.has('denyRuntime');
  const hasWrite = next.has('denyWrite');

  if (hasRuntime && hasWrite) {
    next.add('lockPolicy');
  } else {
    next.delete('lockPolicy');
  }

  return Array.from(next);
}

export function Security() {
  const { t } = useTranslation('settings');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy>(defaultPolicy);
  const [savedPolicy, setSavedPolicy] = useState<SecurityPolicy>(defaultPolicy);
  const [lastAppliedAt, setLastAppliedAt] = useState<string | null>(null);
  const autoApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await hostApiFetch<SecurityPolicy>('/api/security/policy');
      const nextPolicy = {
        prompt: {
          enabled: !!data?.prompt?.enabled,
          deniedPaths: compactPaths(data?.prompt?.deniedPaths || []),
          rules: normalizeLinkedRules(Array.isArray(data?.prompt?.rules) ? data.prompt.rules : []),
        },
      };
      setPolicy(nextPolicy);
      setSavedPolicy(nextPolicy);
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
        title: t('security.dialog.selectDeniedDirs'),
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
          deniedPaths: compactPaths([...prev.prompt.deniedPaths, ...selected]),
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
          deniedPaths: prev.prompt.deniedPaths.filter((item) => item !== path),
        },
      }));
  }, []);

  const toggleRule = useCallback((rule: SecurityRuleKey, checked: boolean) => {
    if (rule === 'lockPolicy') {
      setPolicy((prev) => ({
        ...prev,
        prompt: {
          ...prev.prompt,
          rules: checked
            ? normalizeLinkedRules([...prev.prompt.rules, 'lockPolicy', 'denyRuntime', 'denyWrite'])
            : prev.prompt.rules.filter((item) => item !== 'lockPolicy' && item !== 'denyRuntime' && item !== 'denyWrite'),
        },
      }));
      return;
    }

    setPolicy((prev) => ({
      ...prev,
      prompt: {
        ...prev.prompt,
        rules: normalizeLinkedRules(checked
          ? Array.from(new Set([...prev.prompt.rules, rule]))
          : prev.prompt.rules.filter((item) => item !== rule)),
      },
    }));
  }, []);

  const hasConfiguredGuards = policy.prompt.deniedPaths.length > 0 || policy.prompt.rules.length > 0;
  const isDirty = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(savedPolicy),
    [policy, savedPolicy],
  );

  const applyPolicy = useCallback(async () => {
    const payload = {
      prompt: {
        enabled: policy.prompt.enabled,
        deniedPaths: compactPaths(policy.prompt.deniedPaths),
        rules: policy.prompt.rules,
      },
    };

    if (payload.prompt.enabled && payload.prompt.deniedPaths.length === 0 && payload.prompt.rules.length === 0) {
      toast.error(t('security.toasts.enablePromptPolicyFirst'));
      return;
    }

    setApplying(true);
    try {
      await hostApiFetch('/api/security/apply', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSavedPolicy(payload);
      setPolicy(payload);
      setLastAppliedAt(new Date().toLocaleString());
      toast.success(t('security.toasts.applySuccess'));
    } catch (error) {
      toast.error(`${t('security.toasts.applyFailed')}: ${String(error)}`);
    } finally {
      setApplying(false);
    }
  }, [policy, t]);

  const summary = useMemo(() => {
    if (!policy.prompt.enabled) {
      return t('security.summary.disabled');
    }
    return t('security.summary.enabled', {
      count: policy.prompt.deniedPaths.length,
      rules: policy.prompt.rules.length,
    });
  }, [policy.prompt.deniedPaths.length, policy.prompt.enabled, policy.prompt.rules.length, t]);

  const lockPolicyActive = policy.prompt.rules.includes('lockPolicy');
  const detailRules = SECURITY_RULE_DEFINITIONS.filter((rule) => rule.key !== 'lockPolicy');

  useEffect(() => {
    if (loading || applying || !isDirty) {
      return;
    }

    if (autoApplyTimerRef.current) {
      clearTimeout(autoApplyTimerRef.current);
    }

    autoApplyTimerRef.current = setTimeout(() => {
      void applyPolicy();
    }, 350);

    return () => {
      if (autoApplyTimerRef.current) {
        clearTimeout(autoApplyTimerRef.current);
        autoApplyTimerRef.current = null;
      }
    };
  }, [applyPolicy, applying, isDirty, loading]);

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
            onCheckedChange={(checked) => {
              if (checked && !hasConfiguredGuards) {
                setPolicy((prev) => ({
                  ...prev,
                  prompt: {
                    ...prev.prompt,
                    enabled: true,
                    rules: normalizeLinkedRules([...prev.prompt.rules, 'lockPolicy', 'denyRuntime', 'denyWrite']),
                  },
                }));
                toast.message(t('security.toasts.lockPolicyAutoEnabled'));
                return;
              }
              setPolicy((prev) => ({ ...prev, prompt: { ...prev.prompt, enabled: checked } }));
            }}
          />
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>{t('security.sections.directories')}</Label>
              <p className="mt-1 text-sm text-muted-foreground">{t('security.sections.directoriesDesc')}</p>
            </div>
            <Button variant="outline" onClick={addPromptDirs}>
              <FolderPlus className="mr-2 h-4 w-4" />
              {t('security.addDeniedDirectories')}
            </Button>
          </div>

          <div className="space-y-2 max-h-56 overflow-auto pr-1">
          {policy.prompt.deniedPaths.length === 0 ? (
            <div className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
              {t('security.noDeniedDirectory')}
            </div>
          ) : (
            policy.prompt.deniedPaths.map((path) => (
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

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <Label>{t('security.sections.behavior')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">{t('security.sections.behaviorDesc')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('security.rules.lockHint')}</p>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">{t('security.rules.items.lockPolicy.label')}</div>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {t('security.rules.recommended')}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {t('security.rules.items.lockPolicy.description')}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {t('security.rules.items.denyRuntime.label')}
                  </span>
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {t('security.rules.items.denyWrite.label')}
                  </span>
                </div>
              </div>
              <Switch
                checked={lockPolicyActive}
                onCheckedChange={(nextChecked) => toggleRule('lockPolicy', nextChecked)}
              />
            </div>
          </div>

          <div className="grid gap-3">
            {detailRules.map((rule) => {
              const checked = policy.prompt.rules.includes(rule.key);
              const linkedToLock = lockPolicyActive && (rule.key === 'denyRuntime' || rule.key === 'denyWrite');
              return (
                <div
                  key={rule.key}
                  className="flex items-start justify-between gap-4 rounded-lg border p-3 transition-colors hover:border-primary/40"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">{t(`security.rules.items.${rule.key}.label`)}</div>
                      {linkedToLock ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {t('security.rules.linked')}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {t(`security.rules.items.${rule.key}.description`)}
                    </div>
                  </div>
                  <Switch
                    checked={checked}
                    onCheckedChange={(nextChecked) => toggleRule(rule.key, nextChecked)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {applying ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            <span>{t('security.applying')}</span>
          </>
        ) : lastAppliedAt ? (
          <span>{t('security.lastApplied', { time: lastAppliedAt })}</span>
        ) : null}
      </div>
    </div>
  );
}

export default Security;
