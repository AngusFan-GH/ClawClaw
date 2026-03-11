import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, FolderPlus, Trash2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';

interface SecurityPolicy {
  enabled: boolean;
  allowedPaths: string[];
  allowExec: boolean;
}

interface VerifyState {
  ok: boolean;
  issues: string[];
  checks: {
    fsWorkspaceOnly: boolean;
    execDenied: boolean;
    processDenied: boolean;
    elevatedDisabled: boolean;
  };
}

const defaultPolicy: SecurityPolicy = {
  enabled: false,
  allowedPaths: [],
  allowExec: false,
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
  const [applying, setApplying] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy>(defaultPolicy);
  const [verify, setVerify] = useState<VerifyState | null>(null);
  const [lastAppliedAt, setLastAppliedAt] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await hostApiFetch<SecurityPolicy>('/api/security/policy');
      setPolicy({
        enabled: !!data.enabled,
        allowedPaths: compactPaths(data.allowedPaths || []),
        allowExec: !!data.allowExec,
      });
      setVerify(null);
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

  const applyPolicy = useCallback(async () => {
    const normalized = compactPaths(policy.allowedPaths);
    if (policy.enabled && normalized.length === 0) {
      toast.error('启用白名单时必须至少配置一个目录。');
      return;
    }

    setApplying(true);
    try {
      await hostApiFetch('/api/security/policy', {
        method: 'PUT',
        body: JSON.stringify({ ...policy, allowedPaths: normalized }),
      });

      const result = await hostApiFetch<{ success: boolean; verify?: VerifyState }>(
        '/api/security/apply',
        { method: 'POST' }
      );
      setVerify(result.verify ?? null);
      setLastAppliedAt(new Date().toLocaleString());
      toast.success('策略已应用并重启 Gateway');
    } catch (error) {
      toast.error(`应用失败: ${String(error)}`);
    } finally {
      setApplying(false);
    }
  }, [policy]);

  const resetPolicy = useCallback(async () => {
    setApplying(true);
    try {
      await hostApiFetch('/api/security/reset', { method: 'POST' });
      setPolicy(defaultPolicy);
      setVerify(null);
      setLastAppliedAt(new Date().toLocaleString());
      toast.success('已恢复默认策略并重启 Gateway');
    } catch (error) {
      toast.error(`恢复默认失败: ${String(error)}`);
    } finally {
      setApplying(false);
    }
  }, []);

  const hasPaths = policy.allowedPaths.length > 0;

  const summary = useMemo(() => {
    if (!policy.enabled) return '当前：白名单未启用';
    return `当前：已启用白名单（${policy.allowedPaths.length} 个目录）${policy.allowExec ? '，允许 exec/process' : '，已禁用 exec/process'}`;
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
        <p className="text-sm text-muted-foreground mt-1">{summary}</p>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">启用目录白名单</Label>
            <p className="text-xs text-muted-foreground mt-1">开启后仅允许访问你配置的目录。</p>
          </div>
          <Switch
            checked={policy.enabled}
            onCheckedChange={(checked) => setPolicy((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">允许执行命令（高级）</Label>
            <p className="text-xs text-muted-foreground mt-1">
              默认关闭。关闭时自动禁用 exec/process/elevated，安全性更高。
            </p>
          </div>
          <Switch
            checked={policy.allowExec}
            onCheckedChange={(checked) => {
              if (checked) {
                const ok = window.confirm('开启后会放开命令执行能力，存在越权风险。确认继续？');
                if (!ok) return;
              }
              setPolicy((prev) => ({ ...prev, allowExec: checked }));
            }}
          />
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">允许目录（可多选）</Label>
            <p className="text-xs text-muted-foreground mt-1">自动去重并折叠嵌套目录（父目录优先）。</p>
          </div>
          <Button variant="outline" onClick={addDirectory}>
            <FolderPlus className="h-4 w-4 mr-2" />
            添加目录
          </Button>
        </div>

        <div className="space-y-2">
          {!hasPaths ? (
            <div className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">
              暂无目录。
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

      {policy.enabled && !hasPaths && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          启用白名单时必须至少配置一个目录。
        </div>
      )}

      {verify && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            verify.ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className={`h-4 w-4 ${verify.ok ? 'text-green-500' : 'text-red-500'}`} />
            <span className="text-sm font-medium">配置自检：{verify.ok ? '通过' : '失败'}</span>
          </div>
          {!verify.ok && (
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {verify.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" onClick={() => void loadPolicy()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          重新加载
        </Button>
        <Button onClick={() => void applyPolicy()} disabled={applying || (policy.enabled && !hasPaths)}>
          {applying ? '应用中...' : '应用策略'}
        </Button>
        <Button variant="destructive" onClick={() => void resetPolicy()} disabled={applying}>
          恢复默认
        </Button>
        {lastAppliedAt && <span className="text-xs text-muted-foreground self-center">上次应用：{lastAppliedAt}</span>}
      </div>
    </div>
  );
}

export default Security;
