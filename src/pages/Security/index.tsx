import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  type SecurityPolicy,
  type SecurityRuleKey,
  SECURITY_RULE_DEFINITIONS,
  normalizeSecurityRules,
} from '@/shared/security-policy';

const defaultPolicy: SecurityPolicy = {
  prompt: {
    enabled: false,
    deniedPaths: [],
    rules: [],
  },
};

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) {
    return `${trimmed[0].toUpperCase()}:\\`;
  }
  if (trimmed === '/' || trimmed === '\\') {
    return trimmed;
  }
  return trimmed.replace(/[\\/]+$/, '');
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
          rules: normalizeSecurityRules(
            Array.isArray(data?.prompt?.rules) ? data.prompt.rules : []
          ),
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
    setPolicy((prev) => ({
      ...prev,
      prompt: {
        ...prev.prompt,
        rules: normalizeSecurityRules(
          checked
            ? Array.from(new Set([...prev.prompt.rules, rule]))
            : prev.prompt.rules.filter((item) => item !== rule)
        ),
      },
    }));
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(savedPolicy),
    [policy, savedPolicy]
  );

  const applyPolicy = useCallback(async () => {
    const payload = {
      prompt: {
        enabled: policy.prompt.enabled,
        deniedPaths: compactPaths(policy.prompt.deniedPaths),
        rules: policy.prompt.rules,
      },
    };

    if (
      payload.prompt.enabled &&
      payload.prompt.deniedPaths.length === 0 &&
      payload.prompt.rules.length === 0
    ) {
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
        <LoadingIcon className="h-4 w-4" />
        {t('security.loading')}
      </div>
    );
  }

  return (
    <div className="-m-6 h-[calc(100vh-2.5rem)] overflow-hidden dark:bg-background">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-8 md:px-8 md:py-10">
        <PageHeader
          title={<span className="inline-flex items-center gap-2">{t('security.title')}</span>}
          subtitle={summary}
          className="mb-5"
        />

        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2 pb-6">
          <div className="space-y-4">
            <section className="rounded-xl border bg-card px-4 py-4 md:px-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label className="text-base">{t('security.enableDirectoryPolicy')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('security.enableDirectoryPolicyDesc')}
                  </p>
                </div>
                <Switch
                  checked={policy.prompt.enabled}
                  onCheckedChange={(checked) => {
                    setPolicy((prev) => ({ ...prev, prompt: { ...prev.prompt, enabled: checked } }));
                  }}
                />
              </div>
            </section>

            <section className="rounded-xl border bg-card px-4 py-4 md:px-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label className="text-base">{t('security.sections.directories')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('security.sections.directoriesDesc')}
                  </p>
                </div>
                <Button variant="outline" onClick={addPromptDirs}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  {t('security.addDeniedDirectories')}
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                {policy.prompt.deniedPaths.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    {t('security.noDeniedDirectory')}
                  </div>
                ) : (
                  policy.prompt.deniedPaths.map((path) => (
                    <div
                      key={path}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3"
                    >
                      <code className="min-w-0 flex-1 break-all text-xs">{path}</code>
                      <Button variant="ghost" size="icon" onClick={() => removePromptDir(path)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border bg-card px-4 py-4 md:px-5">
              <div className="space-y-1">
                <Label className="text-base">{t('security.sections.behavior')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('security.sections.behaviorDesc')}
                </p>
              </div>

              <div className="mt-4 grid gap-3">
                {SECURITY_RULE_DEFINITIONS.map((rule) => {
                  const checked = policy.prompt.rules.includes(rule.key);
                  return (
                    <div
                      key={rule.key}
                      className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3 transition-colors hover:border-primary/40"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-medium">
                          {t(`security.rules.items.${rule.key}.label`)}
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
            </section>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {applying ? (
              <>
                <LoadingIcon className="h-3.5 w-3.5" />
                <span>{t('security.applying')}</span>
              </>
            ) : lastAppliedAt ? (
              <span>{t('security.lastApplied', { time: lastAppliedAt })}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Security;
