import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RefreshButton } from '@/components/common/RefreshButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import {
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
  type SecurityPolicySnapshot,
  type SecurityRuntimeState,
  type SecurityRuleKey,
  SECURITY_RULE_DEFINITIONS,
  compactSecurityPaths,
  getManagedToolDenyForRules,
  normalizeSecurityRules,
} from '@/shared/security-policy';

const GATEWAY_RESTART_POLL_INTERVAL_MS = 1500;
const GATEWAY_RESTART_TIMEOUT_MS = 60_000;

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function Security() {
  const { t } = useTranslation('settings');
  const interruptActiveRunForPolicyChange = useChatStore((state) => state.interruptActiveRunForPolicyChange);
  const gatewayRefreshStatus = useGatewayStore((s) => s.refreshStatus);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_SECURITY_POLICY);
  const [savedPolicy, setSavedPolicy] = useState<SecurityPolicy>(DEFAULT_SECURITY_POLICY);
  const [runtime, setRuntime] = useState<SecurityRuntimeState>({
    toolDeny: [],
    activeRules: [],
    activeManagedDeny: [],
    expectedManagedDeny: [],
    extraToolDeny: [],
    managedInSync: true,
  });
  const [appliedAt, setAppliedAt] = useState<number>(0);
  const [gatewayReady, setGatewayReady] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await hostApiFetch<SecurityPolicySnapshot & { appliedAt?: number }>('/api/security/policy');
      const nextPolicy = data?.policy ?? DEFAULT_SECURITY_POLICY;
      setPolicy(nextPolicy);
      setSavedPolicy(nextPolicy);
      setRuntime(data?.runtime ?? {
        toolDeny: [],
        activeRules: [],
        activeManagedDeny: [],
        expectedManagedDeny: [],
        extraToolDeny: [],
        managedInSync: true,
      });
      setAppliedAt(data?.appliedAt ?? 0);
    } catch (error) {
      toast.error(`${t('security.toasts.loadFailed')}: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  // Poll gateway status until fullReady after apply/reset
  const pollGatewayUntilReady = useCallback((startedAt: number) => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      void gatewayRefreshStatus().then((status) => {
        if (!status) {
          // status fetch failed, keep polling
          timeoutId = setTimeout(tick, GATEWAY_RESTART_POLL_INTERVAL_MS);
          return;
        }
        if (status.fullReady && status.state === 'running') {
          setGatewayReady(true);
          return;
        }
        if (Date.now() - startedAt > GATEWAY_RESTART_TIMEOUT_MS) {
          setGatewayReady(false);
          toast.error(t('security.toasts.gatewayRestartTimeout'));
          return;
        }
        timeoutId = setTimeout(tick, GATEWAY_RESTART_POLL_INTERVAL_MS);
      });
    };

    timeoutId = setTimeout(tick, GATEWAY_RESTART_POLL_INTERVAL_MS);
    return () => clearTimeout(timeoutId);
  }, [gatewayRefreshStatus, t]);

  useEffect(() => {
    if (!applying) {
      setGatewayReady(false);
      return;
    }
    const cleanup = pollGatewayUntilReady(Date.now());
    return cleanup;
  }, [applying, pollGatewayUntilReady]);

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
          deniedPaths: compactSecurityPaths([...prev.prompt.deniedPaths, ...selected]),
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
        deniedPaths: compactSecurityPaths(policy.prompt.deniedPaths),
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
    setGatewayReady(false);
    try {
      const interrupted = await interruptActiveRunForPolicyChange(t('security.toasts.interrupted'));
      if (interrupted) {
        toast.message(t('security.toasts.interrupted'));
      }
      const response = await hostApiFetch<{
        snapshot?: SecurityPolicySnapshot;
        appliedAt?: number;
        sync?: { failures: { workspace: string; error: string }[] };
      }>('/api/security/apply', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const nextSnapshot = response.snapshot;
      const nextPolicy = nextSnapshot?.policy ?? payload;
      setSavedPolicy(nextPolicy);
      setPolicy(nextPolicy);
      setRuntime(nextSnapshot?.runtime ?? runtime);
      const newAppliedAt = response.appliedAt ?? Date.now();
      setAppliedAt(newAppliedAt);

      // Sync denied paths to gateway manager for runtime path enforcement
      const pathsToBlock = nextPolicy.prompt.enabled ? nextPolicy.prompt.deniedPaths : [];
      try {
        await invokeIpc('security:updateDeniedPaths', pathsToBlock);
      } catch {
        // Non-fatal: the path block is also written to workspace artifacts as a fallback
      }

      // Surface sync failures
      if (response.sync?.failures?.length) {
        toast.warning(t('security.toasts.syncPartialFailed', { count: response.sync.failures.length }), {
          description: response.sync.failures.map((f) => f.workspace).join(', '),
        });
      }

      toast.success(t('security.toasts.applySuccess'));
    } catch (error) {
      toast.error(`${t('security.toasts.applyFailed')}: ${String(error)}`);
    } finally {
      // Note: applying=true keeps the polling alive until gateway becomes ready.
      // The useEffect above handles the transition when applying goes false.
    }
  }, [interruptActiveRunForPolicyChange, policy, runtime, t]);

  const resetPolicy = useCallback(async () => {
    setResetConfirmOpen(false);
    setApplying(true);
    setGatewayReady(false);
    try {
      const interrupted = await interruptActiveRunForPolicyChange(t('security.toasts.interrupted'));
      if (interrupted) {
        toast.message(t('security.toasts.interrupted'));
      }
      const response = await hostApiFetch<{
        snapshot?: SecurityPolicySnapshot;
        appliedAt?: number;
        sync?: { failures: { workspace: string; error: string }[] };
      }>('/api/security/reset', {
        method: 'POST',
      });
      const nextSnapshot = response.snapshot;
      setPolicy(nextSnapshot?.policy ?? DEFAULT_SECURITY_POLICY);
      setSavedPolicy(nextSnapshot?.policy ?? DEFAULT_SECURITY_POLICY);
      setRuntime(nextSnapshot?.runtime ?? {
        toolDeny: [],
        activeRules: [],
        activeManagedDeny: [],
        expectedManagedDeny: [],
        extraToolDeny: [],
        managedInSync: true,
      });
      const newAppliedAt = response.appliedAt ?? Date.now();
      setAppliedAt(newAppliedAt);

      // Clear all denied paths on reset
      try {
        await invokeIpc('security:updateDeniedPaths', []);
      } catch {
        // Non-fatal
      }

      if (response.sync?.failures?.length) {
        toast.warning(t('security.toasts.syncPartialFailed', { count: response.sync.failures.length }), {
          description: response.sync.failures.map((f) => f.workspace).join(', '),
        });
      }

      toast.success(t('security.toasts.resetSuccess'));
    } catch (error) {
      toast.error(`${t('security.toasts.resetFailed')}: ${String(error)}`);
    } finally {
      // applying=true keeps gateway polling active
    }
  }, [interruptActiveRunForPolicyChange, t]);

  // Mark gateway as ready once it is running
  useEffect(() => {
    if (applying && gatewayStatus.fullReady && gatewayStatus.state === 'running') {
      setGatewayReady(true);
    }
  }, [applying, gatewayStatus.fullReady, gatewayStatus.state]);

  const summary = useMemo(() => {
    if (!policy.prompt.enabled) {
      return t('security.summary.disabled');
    }
    return t('security.summary.enabled', {
      count: policy.prompt.deniedPaths.length,
      rules: policy.prompt.rules.length,
    });
  }, [policy.prompt.deniedPaths.length, policy.prompt.enabled, policy.prompt.rules.length, t]);

  const draftManagedDeny = useMemo(
    () => getManagedToolDenyForRules(policy.prompt.rules),
    [policy.prompt.rules]
  );
  const runtimeManagedDeny = runtime.activeManagedDeny;
  const runtimeExtraDeny = runtime.extraToolDeny;
  const hasRuntimeDrift = !isDirty && (!runtime.managedInSync || runtimeExtraDeny.length > 0);
  const runtimeStatusKey = isDirty
    ? 'security.runtimePreview.unsaved'
    : hasRuntimeDrift
      ? 'security.runtimePreview.outOfSync'
      : 'security.runtimePreview.inSync';

  const applyButtonLabel = applying
    ? gatewayReady
      ? t('security.apply')
      : t('security.applyingGateway')
    : t('security.apply');

  const rulesAlwaysActiveWarning = !policy.prompt.enabled && policy.prompt.rules.length > 0;

  return (
    <div className="-m-6 h-[calc(100vh-2.5rem)] overflow-hidden dark:bg-background">
      <ConfirmDialog
        open={resetConfirmOpen}
        title={t('security.resetConfirm.title')}
        message={t('security.resetConfirm.message')}
        confirmLabel={t('security.actions.reset')}
        variant="destructive"
        onConfirm={resetPolicy}
        onCancel={() => setResetConfirmOpen(false)}
      />

      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-8 md:px-8 md:py-10">
        <div className="mb-4 shrink-0">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <PageHeader
              title={<span className="inline-flex items-center gap-2">{t('security.title')}</span>}
              subtitle={summary}
              className="mb-0"
            />

            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              {appliedAt > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('security.lastApplied')}: {formatRelativeTime(appliedAt)}
                </span>
              )}
              <RefreshButton
                label={t('security.actions.reload')}
                loading={loading}
                onClick={() => void loadPolicy()}
                disabled={applying}
              />
              <Button variant="outline" onClick={() => setResetConfirmOpen(true)} disabled={applying}>
                {t('security.actions.reset')}
              </Button>
              <Button
                onClick={() => void applyPolicy()}
                disabled={applying || !isDirty}
                title={applying && !gatewayReady ? t('security.applyingGatewayHint') : undefined}
              >
                {applyButtonLabel}
              </Button>
            </div>
          </div>

          {isDirty ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {t('security.pendingNotice')}
            </div>
          ) : null}

          {rulesAlwaysActiveWarning ? (
            <div className="mt-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('security.rulesAlwaysActiveWarning')}</span>
            </div>
          ) : null}
        </div>

        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2 pb-6">
          <div className="space-y-4">
            {loading ? (
              <>
                <section className="rounded-xl border bg-card px-4 py-4 md:px-5 animate-pulse">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="h-5 w-28 rounded bg-muted" />
                      <div className="h-4 w-80 max-w-[70vw] rounded bg-muted" />
                    </div>
                    <div className="h-6 w-11 rounded-full bg-muted" />
                  </div>
                </section>

                <section className="rounded-xl border bg-card px-4 py-4 md:px-5 animate-pulse">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="h-5 w-24 rounded bg-muted" />
                      <div className="h-4 w-96 max-w-[75vw] rounded bg-muted" />
                    </div>
                    <div className="h-9 w-32 rounded-xl bg-muted" />
                  </div>
                  <div className="mt-4 h-12 rounded-lg bg-muted/80" />
                </section>

                <section className="rounded-xl border bg-card px-4 py-4 md:px-5 animate-pulse">
                  <div className="space-y-2">
                    <div className="h-5 w-24 rounded bg-muted" />
                    <div className="h-4 w-96 max-w-[75vw] rounded bg-muted" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    {Array.from({ length: SECURITY_RULE_DEFINITIONS.length }).map((_, index) => (
                      <div key={`security-rule-skeleton-${index}`} className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
                        <div className="space-y-2">
                          <div className="h-4 w-32 rounded bg-muted" />
                          <div className="h-4 w-72 max-w-[60vw] rounded bg-muted" />
                        </div>
                        <div className="h-6 w-11 rounded-full bg-muted" />
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <>
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
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                    {t('security.directorySoftLimitNote')}
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
                      <Button variant="dangerGhost" size="icon" className="h-8 w-8 rounded-[10px]" onClick={() => removePromptDir(path)}>
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
                  const isHighDanger = rule.key === 'denyRuntime' || rule.key === 'denyWrite';
                  return (
                    <div
                      key={rule.key}
                      className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 transition-colors hover:border-primary/40 ${
                        isHighDanger && checked ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20' : ''
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-medium flex items-center gap-2">
                          {isHighDanger && checked && (
                            <span className="inline-flex items-center rounded-md border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                              {t('security.highDanger')}
                            </span>
                          )}
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

              <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-3">
                <div className="text-sm font-medium">{t('security.runtimePreview.title')}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t(runtimeStatusKey)}</div>

                {isDirty ? (
                  <>
                    <div className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('security.runtimePreview.draftTitle')}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {draftManagedDeny.length > 0 ? (
                        draftManagedDeny.map((entry) => (
                          <code
                            key={entry}
                            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                          >
                            {entry}
                          </code>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t('security.runtimePreview.none')}
                        </span>
                      )}
                    </div>
                  </>
                ) : hasRuntimeDrift ? (
                  <>
                    <div className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('security.runtimePreview.runtimeTitle')}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {runtimeManagedDeny.length > 0 ? (
                        runtimeManagedDeny.map((entry) => (
                          <code
                            key={`runtime-${entry}`}
                            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                          >
                            {entry}
                          </code>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t('security.runtimePreview.none')}
                        </span>
                      )}
                    </div>

                    {runtimeExtraDeny.length > 0 ? (
                      <>
                        <div className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t('security.runtimePreview.extraTitle')}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {runtimeExtraDeny.map((entry) => (
                            <code
                              key={`extra-${entry}`}
                              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                            >
                              {entry}
                            </code>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('security.runtimePreview.runtimeTitle')}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {runtimeManagedDeny.length > 0 ? (
                        runtimeManagedDeny.map((entry) => (
                          <code
                            key={`runtime-${entry}`}
                            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                          >
                            {entry}
                          </code>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t('security.runtimePreview.none')}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Security;