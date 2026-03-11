import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  FolderPlus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FolderSearch,
  ListChecks,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';

interface SecurityPolicy {
  workspace: {
    enabled: boolean;
    path: string;
    allowExec: boolean;
  };
  prompt: {
    enabled: boolean;
    allowedPaths: string[];
  };
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
  workspace: {
    enabled: false,
    path: '',
    allowExec: false,
  },
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
        workspace: {
          enabled: !!data?.workspace?.enabled,
          path: normalizePath(data?.workspace?.path || ''),
          allowExec: !!data?.workspace?.allowExec,
        },
        prompt: {
          enabled: !!data?.prompt?.enabled,
          allowedPaths: compactPaths(data?.prompt?.allowedPaths || []),
        },
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

  const pickWorkspace = useCallback(async () => {
    try {
      const result = (await invokeIpc('dialog:open', {
        title: '选择工作空间目录（硬限制）',
        properties: ['openDirectory', 'dontAddToRecent'],
      })) as { canceled: boolean; filePaths?: string[] };

      const picked = compactPaths(result.filePaths ?? [])[0];
      if (result.canceled || !picked) return;

      setPolicy((prev) => ({
        ...prev,
        workspace: { ...prev.workspace, path: picked },
      }));
    } catch (error) {
      toast.error(`选择工作空间失败: ${String(error)}`);
    }
  }, []);

  const addPromptDirs = useCallback(async () => {
    try {
      const result = (await invokeIpc('dialog:open', {
        title: '选择允许目录（提示词层，多目录）',
        properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
      })) as { canceled: boolean; filePaths?: string[] };

      const selected = result.filePaths ?? [];
      if (result.canceled || selected.length === 0) return;

      setPolicy((prev) => ({
        ...prev,
        prompt: {
          ...prev.prompt,
          allowedPaths: compactPaths([...prev.prompt.allowedPaths, ...selected]),
        },
      }));
    } catch (error) {
      toast.error(`选择提示词目录失败: ${String(error)}`);
    }
  }, []);

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
    const payload: SecurityPolicy = {
      workspace: {
        enabled: policy.workspace.enabled,
        path: normalizePath(policy.workspace.path),
        allowExec: policy.workspace.allowExec,
      },
      prompt: {
        enabled: policy.prompt.enabled,
        allowedPaths: compactPaths(policy.prompt.allowedPaths),
      },
    };

    if (payload.workspace.enabled && !payload.workspace.path) {
      toast.error('已启用工作空间限制，请先选择一个工作空间目录。');
      return;
    }

    if (payload.prompt.enabled && payload.prompt.allowedPaths.length === 0) {
      toast.error('已启用提示词目录策略，请至少添加一个目录。');
      return;
    }

    setApplying(true);
    try {
      await hostApiFetch('/api/security/policy', {
        method: 'PUT',
        body: JSON.stringify(payload),
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

  const summary = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      policy.workspace.enabled
        ? `硬限制：${policy.workspace.path || '未设置目录'}`
        : '硬限制：未启用'
    );
    parts.push(
      policy.prompt.enabled
        ? `提示词目录：${policy.prompt.allowedPaths.length} 个`
        : '提示词目录：未启用'
    );
    return parts.join(' ｜ ');
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
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" />
          安全策略
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{summary}</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border p-4 space-y-4">
          <div className="flex items-center gap-2 text-base font-medium">
            <FolderSearch className="h-4 w-4" />
            工作空间限制（硬限制，单目录）
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>启用工作空间限制</Label>
              <p className="text-xs text-muted-foreground mt-1">会同步写入 openclaw 配置并限制 workspace。</p>
            </div>
            <Switch
              checked={policy.workspace.enabled}
              onCheckedChange={(checked) =>
                setPolicy((prev) => ({ ...prev, workspace: { ...prev.workspace, enabled: checked } }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label>工作空间目录</Label>
            <div className="rounded-md border p-3 text-xs font-mono break-all text-muted-foreground">
              {policy.workspace.path || '(未设置)'}
            </div>
            <Button variant="outline" onClick={pickWorkspace}>
              选择/更换目录
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>允许执行命令（高级）</Label>
              <p className="text-xs text-muted-foreground mt-1">默认关闭。关闭时自动禁用 exec/process。</p>
            </div>
            <Switch
              checked={policy.workspace.allowExec}
              onCheckedChange={(checked) => {
                if (checked) {
                  const ok = window.confirm('开启后会放开命令执行能力，存在越权风险。确认继续？');
                  if (!ok) return;
                }
                setPolicy((prev) => ({ ...prev, workspace: { ...prev.workspace, allowExec: checked } }));
              }}
            />
          </div>
        </div>

        <div className="rounded-xl border p-4 space-y-4">
          <div className="flex items-center gap-2 text-base font-medium">
            <ListChecks className="h-4 w-4" />
            允许目录策略（提示词层，多目录）
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>启用提示词目录策略</Label>
              <p className="text-xs text-muted-foreground mt-1">
                生成 SECURITY_POLICY.md 并自动注入 AGENTS.md。
              </p>
            </div>
            <Switch
              checked={policy.prompt.enabled}
              onCheckedChange={(checked) =>
                setPolicy((prev) => ({ ...prev, prompt: { ...prev.prompt, enabled: checked } }))
              }
            />
          </div>

          <Button variant="outline" onClick={addPromptDirs}>
            <FolderPlus className="h-4 w-4 mr-2" />
            添加目录（可多选）
          </Button>

          <div className="space-y-2 max-h-56 overflow-auto pr-1">
            {policy.prompt.allowedPaths.length === 0 ? (
              <div className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">暂无目录</div>
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
      </div>

      {(policy.workspace.enabled && !policy.workspace.path) ||
      (policy.prompt.enabled && policy.prompt.allowedPaths.length === 0) ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          已启用的策略存在未配置项，请补齐后再应用。
        </div>
      ) : null}

      {verify && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            verify.ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className={`h-4 w-4 ${verify.ok ? 'text-green-500' : 'text-red-500'}`} />
            <span className="text-sm font-medium">工作空间硬限制自检：{verify.ok ? '通过' : '失败'}</span>
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
        <Button onClick={() => void applyPolicy()} disabled={applying}>
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
