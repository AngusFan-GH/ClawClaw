import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, FolderPlus, Trash2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';

type SecurityMode = 'workspace-only' | 'strict-sandbox';

interface SecurityPolicy {
  enabled: boolean;
  mode: SecurityMode;
  allowedPaths: string[];
}

interface AppliedSnapshot {
  enabled: boolean;
  mode: SecurityMode;
  allowedPaths: string[];
  harden?: {
    fsWorkspaceOnly: boolean;
    denyExecProcess: boolean;
    disableElevated: boolean;
  };
}

const defaultPolicy: SecurityPolicy = {
  enabled: false,
  mode: 'workspace-only',
  allowedPaths: [],
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
    if (!covered) result.push(current);
  }
  return result;
}

export function Security() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy>(defaultPolicy);
  const [lastApplied, setLastApplied] = useState<AppliedSnapshot | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await hostApiFetch<SecurityPolicy>('/api/security/policy');
      setPolicy({
        enabled: !!data.enabled,
        mode: data.mode === 'strict-sandbox' ? 'strict-sandbox' : 'workspace-only',
        allowedPaths: compactPaths(data.allowedPaths || []),
      });
    } catch (error) {
      toast.error(`加载安全策略失败: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const addDirectory = useCallback(async () => {
    try {
      const result = (await invokeIpc('dialog:open', {
        title: '选择允许 OpenClaw 访问的目录',
        properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
      })) as { canceled: boolean; filePaths?: string[] };

      const selected = result.filePaths ?? [];
      if (result.canceled || selected.length === 0) return;

      setPolicy((prev) => ({
        ...prev,
        allowedPaths: compactPaths([...prev.allowedPaths, ...selected]),
      }));
    } catch (error) {
      toast.error(`选择目录失败: ${String(error)}`);
    }
  }, []);

  const removeDirectory = useCallback((path: string) => {
    setPolicy((prev) => ({
      ...prev,
      allowedPaths: prev.allowedPaths.filter((item) => item !== path),
    }));
  }, []);

  const savePolicy = useCallback(async () => {
    setSaving(true);
    try {
      const payload: SecurityPolicy = {
        ...policy,
        allowedPaths: compactPaths(policy.allowedPaths),
      };
      await hostApiFetch('/api/security/policy', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setPolicy(payload);
      toast.success('安全策略已保存');
    } catch (error) {
      toast.error(`保存失败: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [policy]);

  const applyPolicy = useCallback(async () => {
    setApplying(true);
    try {
      await hostApiFetch('/api/security/policy', {
        method: 'PUT',
        body: JSON.stringify({
          ...policy,
          allowedPaths: compactPaths(policy.allowedPaths),
        }),
      });

      const applyResult = await hostApiFetch<{ success: boolean; applied?: AppliedSnapshot }>(
        '/api/security/apply',
        { method: 'POST' }
      );
      if (applyResult.applied) {
        setLastApplied(applyResult.applied);
      }
      toast.success('策略已应用并重启 Gateway');
    } catch (error) {
      toast.error(`应用失败: ${String(error)}`);
    } finally {
      setApplying(false);
    }
  }, [policy]);

  const hasPaths = policy.allowedPaths.length > 0;
  const canApply = policy.enabled ? hasPaths : true;

  const modeDescription = useMemo(() => {
    if (policy.mode === 'strict-sandbox') {
      return '严格沙箱：工具运行在容器中，仅挂载你选择的目录（更安全，兼容性要求更高）';
    }
    return '工作区限制：仅限制文件工具到允许目录（兼容性更好）';
  }, [policy.mode]);

  const effectivePreview = useMemo(() => {
    const allowedPaths = compactPaths(policy.allowedPaths);
    const enabled = policy.enabled && allowedPaths.length > 0;
    return {
      enabled,
      mode: policy.mode,
      allowedPaths,
      harden: {
        fsWorkspaceOnly: enabled,
        denyExecProcess: enabled,
        disableElevated: enabled,
      },
      workspace: enabled ? allowedPaths[0] : '(未启用)',
      sandboxBinds:
        enabled && policy.mode === 'strict-sandbox'
          ? allowedPaths.map((hostPath, index) => `${hostPath}:/allowed/${index}:rw`)
          : [],
    };
  }, [policy]);

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground flex items-center gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        加载安全策略中...
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" />
          安全策略
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          控制 OpenClaw 可访问的本地目录范围。建议先从“工作区限制”模式开始。
        </p>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">启用目录访问限制</Label>
            <p className="text-xs text-muted-foreground mt-1">关闭后，不会向 openclaw.json 写入新的限制策略。</p>
          </div>
          <Switch
            checked={policy.enabled}
            onCheckedChange={(checked) => setPolicy((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base">防护模式</Label>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={policy.mode === 'workspace-only' ? 'default' : 'outline'}
              onClick={() => setPolicy((prev) => ({ ...prev, mode: 'workspace-only' }))}
            >
              工作区限制（推荐起步）
            </Button>
            <Button
              variant={policy.mode === 'strict-sandbox' ? 'default' : 'outline'}
              onClick={() => setPolicy((prev) => ({ ...prev, mode: 'strict-sandbox' }))}
            >
              严格沙箱（高安全）
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{modeDescription}</p>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">允许目录（可多选）</Label>
            <p className="text-xs text-muted-foreground mt-1">
              自动去重并折叠嵌套目录（父目录优先）。
            </p>
          </div>
          <Button variant="outline" onClick={addDirectory}>
            <FolderPlus className="h-4 w-4 mr-2" />
            添加目录
          </Button>
        </div>

        <div className="space-y-2">
          {policy.allowedPaths.length === 0 ? (
            <div className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">
              还没有允许目录。至少添加一个目录后再启用策略。
            </div>
          ) : (
            policy.allowedPaths.map((path) => (
              <div key={path} className="flex items-center justify-between rounded-lg border p-3">
                <code className="text-xs break-all">{path}</code>
                <Button variant="ghost" size="icon" onClick={() => removeDirectory(path)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <Label className="text-base">策略预览（应用后）</Label>
        <div className="text-sm space-y-1 text-muted-foreground">
          <p>状态：{effectivePreview.enabled ? '启用' : '未启用'}</p>
          <p>模式：{effectivePreview.mode === 'strict-sandbox' ? '严格沙箱' : '工作区限制'}</p>
          <p>Workspace：{effectivePreview.workspace}</p>
          <p>
            硬化开关：
            fs.workspaceOnly={String(effectivePreview.harden.fsWorkspaceOnly)}，deny(exec/process)
            ={String(effectivePreview.harden.denyExecProcess)}，elevated.disabled=
            {String(effectivePreview.harden.disableElevated)}
          </p>
          {effectivePreview.sandboxBinds.length > 0 && (
            <div>
              <p>Sandbox binds：</p>
              <ul className="list-disc pl-5">
                {effectivePreview.sandboxBinds.map((bind) => (
                  <li key={bind} className="break-all font-mono text-xs">
                    {bind}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {lastApplied && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 space-y-2">
          <Label className="text-base">最近一次生效快照</Label>
          <p className="text-sm text-muted-foreground">
            状态：{lastApplied.enabled ? '启用' : '未启用'} / 模式：
            {lastApplied.mode === 'strict-sandbox' ? '严格沙箱' : '工作区限制'}
          </p>
          {lastApplied.allowedPaths.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {lastApplied.allowedPaths.map((p) => (
                <li key={p} className="break-all font-mono">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {policy.enabled && !hasPaths && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5" />
          启用了限制但未配置任何目录。请先添加允许目录。
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => void loadPolicy()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          重新加载
        </Button>
        <Button onClick={() => void savePolicy()} disabled={saving}>
          {saving ? '保存中...' : '保存策略'}
        </Button>
        <Button onClick={() => void applyPolicy()} disabled={!canApply || applying}>
          {applying ? '应用中...' : '应用并重启 Gateway'}
        </Button>
      </div>
    </div>
  );
}

export default Security;
