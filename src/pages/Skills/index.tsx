/**
 * Skills Page
 * Browse and manage AI skills
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Puzzle,
  Lock,
  Package,
  X,
  AlertCircle,
  Plus,
  Key,
  Trash2,
  FolderOpen,
  FileCode,
  Globe,
  Settings2,
  TerminalSquare,
  ChevronDown,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner, PageLoader } from '@/components/common/LoadingSpinner';
import { RefreshButton } from '@/components/common/RefreshButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import type { MarketplaceSkill, Skill } from '@/types/skill';
import { useTranslation } from 'react-i18next';

function getRequiredEnvKeys(skill: Skill | null): string[] {
  if (!skill) {
    return [];
  }
  const keys = new Set(skill.requirements?.env || []);
  if (skill.primaryEnv) {
    keys.add(skill.primaryEnv);
  }
  return Array.from(keys);
}

function getPlaintextApiKey(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getSkillSourceLabel(t: ReturnType<typeof useTranslation>['t'], skill: Skill): string {
  if (skill.isCore) {
    return t('detail.coreSystem');
  }
  if (skill.isBundled) {
    return t('detail.bundled');
  }
  if (skill.isPreinstalled) {
    return t('detail.preinstalled');
  }
  return t('detail.userInstalled');
}

function resolveSkillIcon(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const icon = (candidate || '').trim();
    if (!icon) continue;
    if (icon.includes('\uFFFD')) continue;
    const hasCjk = /[\u3400-\u9FFF]/.test(icon);
    const hasEmoji = Array.from(icon).some((char) => (char.codePointAt(0) ?? 0) >= 0x2600);
    if (hasCjk && !hasEmoji) continue;
    if (!hasEmoji && icon.length > 2) continue;
    return icon;
  }
  return '🧩';
}

function getMissingRequirementCount(skill: Skill): number {
  return (
    (skill.missing?.env?.length || 0)
    + (skill.missing?.bins?.length || 0)
    + (skill.missing?.anyBins?.length || 0)
    + (skill.missing?.config?.length || 0)
    + (skill.missing?.os?.length || 0)
  );
}

function getSkillStatusMeta(
  t: ReturnType<typeof useTranslation>['t'],
  skill: Skill,
): { label: string; className: string; reason?: string } {
  if (skill.disabled) {
    return {
      label: t('status.disabled'),
      className: 'bg-muted text-muted-foreground',
    };
  }
  if (skill.eligible) {
    return {
      label: t('status.ready'),
      className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }
  const missingCount = getMissingRequirementCount(skill);
  const reason = skill.blockedByAllowlist
    ? t('status.reasonBlocked')
    : missingCount > 0
      ? t('status.reasonMissing', { count: missingCount })
      : undefined;
  return {
    label: t('status.needsSetup'),
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    reason,
  };
}

function isUserManagedSkill(skill: Skill | undefined): skill is Skill {
  return Boolean(
    skill
    && !skill.isCore
    && !skill.isBundled
    && !skill.isPreinstalled
    && skill.installedOnDisk !== false
  );
}

function resolveInstalledMarketplaceSkill(
  installedSkills: Skill[],
  marketplaceSkill: MarketplaceSkill,
): Skill | undefined {
  const slug = marketplaceSkill.slug.trim().toLowerCase();
  const name = marketplaceSkill.name.trim().toLowerCase();

  const direct = installedSkills.find((skill) => {
    if (!isUserManagedSkill(skill)) return false;
    const skillSlug = (skill.slug || '').trim().toLowerCase();
    const skillId = (skill.id || '').trim().toLowerCase();
    return skillSlug === slug || skillId === slug;
  });
  if (direct) return direct;

  // Fallback for canonicalized slug / skillKey mapping mismatches.
  return installedSkills.find((skill) => {
    if (!isUserManagedSkill(skill)) return false;
    return (skill.name || '').trim().toLowerCase() === name;
  });
}



// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  canToggle: boolean;
  onUninstall?: (slug: string) => void;
}

function SkillDetailDialog({ skill, isOpen, onClose, onToggle, canToggle, onUninstall }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const { currentAgentId, fetchSkills } = useSkillsStore();
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [primaryCredential, setPrimaryCredential] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const requiredEnvKeys = getRequiredEnvKeys(skill);
  const showPrimaryCredential = !skill?.isCore;
  const extraEnvKeys = requiredEnvKeys.filter((key) => key !== skill?.primaryEnv);
  const showEnvSection = !skill?.isCore;
  const requirementItems = [
    ...(skill?.requirements?.bins?.map((item) => ({ label: t('detail.requiresBins'), value: item })) || []),
    ...(skill?.requirements?.anyBins?.map((item) => ({ label: t('detail.requiresAnyBin'), value: item })) || []),
    ...(skill?.requirements?.config?.map((item) => ({ label: t('detail.requiresGatewayConfig'), value: item })) || []),
    ...(skill?.requirements?.os?.map((item) => ({ label: t('detail.supportedOs'), value: item })) || []),
  ];

  // Initialize config from skill
  useEffect(() => {
    if (!skill) return;

    const configEnv = (skill.config?.env as Record<string, unknown> | undefined) || {};
    const primaryValue = skill.primaryEnv
      ? String(configEnv[skill.primaryEnv] ?? getPlaintextApiKey(skill.config?.apiKey))
      : getPlaintextApiKey(skill.config?.apiKey);
    setPrimaryCredential(primaryValue);

    const envKeySet = new Set(extraEnvKeys);
    Object.keys(configEnv).forEach((key) => {
      if (key !== skill.primaryEnv) {
        envKeySet.add(key);
      }
    });

    const vars = Array.from(envKeySet).map((key) => ({
      key,
      value: String(configEnv[key] ?? ''),
    }));
    setEnvVars(vars);
  }, [extraEnvKeys, skill]);

  const handleOpenClawhub = async () => {
    if (!skill?.slug) return;
    await invokeIpc('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`);
  };

  const handleOpenEditor = async () => {
    if (!skill?.slug) return;
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-readme', {
        method: 'POST',
        body: JSON.stringify({ slug: skill.slug }),
      });
      if (result.success) {
        toast.success(t('toast.openedEditor'));
      } else {
        toast.error(result.error || t('toast.failedEditor'));
      }
    } catch (err) {
      toast.error(t('toast.failedEditor') + ': ' + String(err));
    }
  };

  const handleOpenSkillDirectory = async () => {
    if (!skill?.sourcePath) return;
    const result = await invokeIpc<string>('shell:openPath', skill.sourcePath);
    if (result) {
      toast.error(t('toast.failedOpenFolder') + ': ' + result);
    }
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...envVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEnvVars(newVars);
  };

  const handleRemoveEnv = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const handleSaveConfig = async () => {
    if (isSaving || !skill) return;
    setIsSaving(true);
    try {
      // Build env object, filtering out empty keys
      const envObj = envVars.reduce((acc, curr) => {
        const key = curr.key.trim();
        const value = curr.value.trim();
        if (key) {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);

      const trimmedPrimaryCredential = primaryCredential.trim();
      if (skill.primaryEnv) {
        if (trimmedPrimaryCredential) {
          envObj[skill.primaryEnv] = trimmedPrimaryCredential;
        } else {
          delete envObj[skill.primaryEnv];
        }
      }

      // Use direct file access instead of Gateway RPC for reliability
      const result = await invokeIpc<{ success: boolean; error?: string }>(
        'skill:updateConfig',
        {
          skillKey: skill.id,
          apiKey: showPrimaryCredential ? trimmedPrimaryCredential : undefined,
          env: envObj // Empty object will clear all env vars
        }
      ) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Refresh skills from gateway to get updated config
      await fetchSkills(currentAgentId || undefined, { includeRuntime: true });

      toast.success(t('detail.configSaved'));
    } catch (err) {
      toast.error(t('toast.failedSave') + ': ' + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!skill) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="flex w-full flex-col border-l border-black/10 bg-card p-0 dark:border-white/10 dark:bg-card sm:max-w-[460px]"
        side="right"
      >
        <div className="border-b border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.32),rgba(243,241,233,0.96))] px-5 pb-4 pt-4 dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(36,36,34,0.96),rgba(26,26,25,1))]">
          <div className="flex items-center gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] border border-black/6 bg-white/90 text-[30px] dark:border-white/10 dark:bg-card">
              <span>{resolveSkillIcon(skill.icon)}</span>
              {skill.isCore && (
                <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-[10px] border border-black/5 bg-card dark:border-white/10 dark:bg-card">
                  <Lock className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[26px] font-semibold tracking-tight text-foreground">
                  {skill.name}
                </h2>
                <Badge variant="secondary" className="rounded-[10px] border-0 bg-black/[0.05] px-2.5 py-1 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                  {getSkillSourceLabel(t, skill)}
                </Badge>
                {skill.version && !skill.isBundled && !skill.isPreinstalled ? (
                  <span className="font-mono text-[11px] text-foreground/45">v{skill.version}</span>
                ) : null}
              </div>
            </div>
          </div>

          {skill.description && (
            <p className="mt-4 text-[14px] leading-[1.6] text-foreground/68">
              {skill.description}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {/* Primary credential */}
            {skill.sourcePath && (
              <section className="rounded-[10px] border border-black/8 bg-white/35 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
                  <FolderOpen className="h-3.5 w-3.5 text-blue-500" />
                  {t('detail.location')}
                </h3>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-[12px] font-medium text-foreground/55">{t('detail.source')}</div>
                    <div className="text-[13px] font-medium text-foreground">
                      {t(`folderMenu.${skill.sourceKey || 'extra'}`)}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[12px] font-medium text-foreground/55">{t('detail.skillDirectory')}</div>
                    <button
                      type="button"
                      onClick={() => void handleOpenSkillDirectory()}
                      className="block w-full rounded-[10px] border border-black/6 bg-muted/55 px-3 py-2 text-left transition-colors hover:bg-muted/75 dark:border-white/8 dark:bg-muted/30 dark:hover:bg-muted/45"
                    >
                      <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-blue-600 dark:text-blue-400">
                        <FolderOpen className="h-3.5 w-3.5" />
                        {t('detail.openSkillDirectory')}
                      </div>
                      <div className="break-all font-mono text-[12px] text-foreground/78">
                        {skill.sourceFilePath}
                      </div>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {!skill.isCore && showPrimaryCredential && (
              <section className="rounded-[10px] border border-black/8 bg-white/35 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
                  <Key className="h-3.5 w-3.5 text-blue-500" />
                  {skill.primaryEnv || t('detail.apiKey')}
                </div>
                <Input
                  placeholder={skill.primaryEnv || t('detail.apiKeyPlaceholder', 'Enter API Key (optional)')}
                  value={primaryCredential}
                  onChange={(e) => setPrimaryCredential(e.target.value)}
                  type="password"
                  className="h-[42px] rounded-[10px] border-black/10 bg-muted/70 font-mono text-[13px] text-foreground placeholder:text-foreground/40 transition-all focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-white/10 dark:bg-muted/40"
                />
                <p className="mt-2 text-[12px] font-medium leading-[1.5] text-foreground/50">
                  {skill.primaryEnv
                    ? t('detail.primaryEnvDesc', { env: skill.primaryEnv })
                    : t('detail.apiKeyDesc', 'The primary API key for this skill. Leave blank if not required or configured elsewhere.')}
                </p>
              </section>
            )}

            {/* Environment variables */}
            {!skill.isCore && showEnvSection && (
              <section className="rounded-[10px] border border-black/8 bg-white/35 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
                      <Settings2 className="h-3.5 w-3.5 text-blue-500" />
                      {t('detail.envVars')}
                      {envVars.length > 0 && (
                        <Badge variant="secondary" className="ml-1 h-5 rounded-[10px] bg-black/10 px-1.5 py-0 text-[10px] text-foreground dark:bg-white/10">
                          {envVars.length}
                        </Badge>
                      )}
                    </h3>
                  </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-[10px] px-2.5 text-[12px] font-semibold text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={handleAddEnv}
                    >
                      <Plus className="h-3 w-3" strokeWidth={3} />
                      {t('detail.addVariable', 'Add Variable')}
                    </Button>
                </div>

                <div className="space-y-2">
                  {envVars.length === 0 && (
                    <div className="flex items-center rounded-[10px] border border-black/5 bg-muted/70 px-4 py-3 text-[13px] font-medium italic text-foreground/50 dark:border-white/5 dark:bg-muted/40">
                      {t('detail.noEnvVars', 'No environment variables configured.')}
                    </div>
                  )}

                  {envVars.map((env, index) => (
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-2" key={index}>
                      <Input
                        value={env.key}
                        onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)}
                        className="h-[40px] rounded-[10px] border-black/10 bg-muted/70 font-mono text-[13px] text-foreground focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-white/10 dark:bg-muted/40"
                        placeholder={t('detail.keyPlaceholder', 'Key')}
                      />
                      <Input
                        value={env.value}
                        onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)}
                        className="h-[40px] rounded-[10px] border-black/10 bg-muted/70 font-mono text-[13px] text-foreground focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-white/10 dark:bg-muted/40"
                        placeholder={t('detail.valuePlaceholder', 'Value')}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 rounded-[10px] text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleRemoveEnv(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!skill.isCore && requirementItems.length > 0 && (
              <section className="rounded-[10px] border border-black/8 bg-white/35 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
                  <TerminalSquare className="h-3.5 w-3.5 text-blue-500" />
                  {t('detail.requirements')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {requirementItems.map((item) => (
                    <Badge
                      key={`${item.label}-${item.value}`}
                      variant="secondary"
                      className="rounded-[10px] border-0 bg-black/[0.05] px-3 py-1 text-[11px] font-medium text-foreground/75 dark:bg-white/[0.08]"
                    >
                      {item.label}: {item.value}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            {/* External Links */}
            {skill.slug && !skill.isBundled && !skill.isPreinstalled && !skill.isCore && (
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="h-8 rounded-[10px] border-black/10 bg-transparent px-3 text-[11px] font-medium text-foreground/70 shadow-none hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5" onClick={handleOpenClawhub}>
                  <Globe className="h-[12px] w-[12px]" />
                  ClawHub
                </Button>
                <Button variant="outline" size="sm" className="h-8 rounded-[10px] border-black/10 bg-transparent px-3 text-[11px] font-medium text-foreground/70 shadow-none hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5" onClick={handleOpenEditor}>
                  <FileCode className="h-[12px] w-[12px]" />
                  {t('detail.openManual')}
                </Button>
              </div>
            )}
          </div>

        </div>

        <div className="border-t border-black/6 bg-card/95 px-5 py-4 backdrop-blur dark:border-white/8 dark:bg-card/95">
          <div className="flex items-center gap-3">
            {!skill.isCore && (showPrimaryCredential || showEnvSection) && (
              <Button
                onClick={handleSaveConfig}
                className={cn(
                  "h-[42px] flex-1 rounded-[10px] border border-transparent text-[13px] font-semibold transition-all",
                  "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
                disabled={isSaving}
              >
                {isSaving ? t('detail.saving') : t('detail.saveConfig')}
              </Button>
            )}

            {!skill.isCore && (
              <Button
                variant="outline"
                className="h-[42px] flex-1 rounded-[10px] border-black/20 bg-transparent text-[13px] font-semibold text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/20 dark:hover:bg-white/5"
                onClick={() => onToggle(Boolean(skill.disabled))}
                disabled={!canToggle}
              >
                {skill.disabled ? t('detail.enable') : t('detail.disable')}
              </Button>
            )}

            {!skill.isCore && !skill.isBundled && !skill.isPreinstalled && onUninstall && skill.slug && (
              <Button
                variant="outline"
                className="h-[42px] rounded-[10px] border-destructive/25 bg-transparent px-4 text-[13px] font-semibold text-destructive transition-colors hover:bg-destructive/10"
                onClick={() => {
                  onUninstall(skill.slug!);
                  onClose();
                }}
              >
                {t('detail.uninstall')}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface SkillGridCardProps {
  skill: Skill;
  isGatewayRunning: boolean;
  onClick: () => void;
  onToggle: (skillId: string, enable: boolean) => void;
}

function SkillGridCard({ skill, isGatewayRunning, onClick, onToggle }: SkillGridCardProps) {
  const { t } = useTranslation('skills');
  const statusMeta = getSkillStatusMeta(t, skill);
  const isEnabled = !skill.disabled;
  const canToggle = isGatewayRunning && !skill.isCore;

  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex h-full flex-col rounded-xl border border-border/70 bg-card/85 px-4 py-3.5 text-left transition-colors duration-200 hover:border-primary/35 hover:bg-accent/45"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-card text-[21px] transition-colors duration-200 group-hover:border-primary/25">
            {resolveSkillIcon(skill.icon)}
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="mb-1 flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-foreground">{skill.name}</h3>
              {skill.isCore ? (
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge
                variant="secondary"
                className="h-6 rounded-[10px] border-0 bg-black/[0.05] px-2.5 py-0 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]"
              >
                {getSkillSourceLabel(t, skill)}
              </Badge>
              <Badge
                variant="secondary"
                className={cn(
                  'h-6 rounded-[10px] border-0 px-2.5 py-0 text-[10px] font-medium',
                  statusMeta.className,
                )}
              >
                {statusMeta.label}
              </Badge>
              {skill.version && !skill.isBundled && !skill.isPreinstalled ? (
                <span className="font-mono text-[11px] text-foreground/45">
                  v{skill.version}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0 pl-2 pt-1" onClick={(event) => event.stopPropagation()}>
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => onToggle(skill.id, checked)}
            disabled={!canToggle}
            className="h-7 w-12 border border-border/70 bg-muted data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted"
          />
        </div>
      </div>

      <p className="mt-4 line-clamp-4 text-[13px] leading-[1.7] text-muted-foreground">
        {skill.description}
      </p>
      {statusMeta.reason ? (
        <p className="mt-3 text-[12px] font-medium text-muted-foreground">{statusMeta.reason}</p>
      ) : null}
    </div>
  );
}

interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  isInstalled: boolean;
  installedSkill?: Skill;
  isInstallLoading: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}

function MarketplaceSkillCard({
  skill,
  isInstalled,
  installedSkill,
  isInstallLoading,
  onOpen,
  onInstall,
  onUninstall,
}: MarketplaceSkillCardProps) {
  const { t } = useTranslation('skills');

  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex h-full flex-col rounded-xl border border-border/70 bg-card/85 px-4 py-3.5 text-left transition-colors duration-200 hover:border-primary/35 hover:bg-accent/45"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-lg transition-colors duration-200 group-hover:border-primary/25">
            {resolveSkillIcon(skill.icon, skill.emoji)}
          </div>
          <div className="min-w-0 pt-0.5">
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-foreground">{skill.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              {skill.author && <span className="text-muted-foreground">{skill.author}</span>}
              {skill.version && (
                <span className="font-mono text-[11px] text-foreground/45">
                  v{skill.version}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 line-clamp-4 text-[13px] leading-[1.7] text-muted-foreground">
        {skill.description}
      </p>

      <div
        className="mt-4 flex items-center justify-between gap-3 border-t border-black/5 pt-3 dark:border-white/5"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[12px] font-medium text-foreground/65 dark:bg-white/[0.06]">
          {isInstalled && installedSkill ? getSkillSourceLabel(t, installedSkill) : t('marketplace.source')}
        </span>
        {isInstalled ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={onUninstall}
            disabled={isInstallLoading}
            className="h-8 rounded-[10px] px-4 text-xs font-medium shadow-none"
          >
            {isInstallLoading ? (
              <span className="inline-flex items-center gap-2">
                <LoadingSpinner size="sm" />
                {t('marketplace.uninstalling')}
              </span>
            ) : (
              <>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {t('marketplace.uninstall')}
              </>
            )}
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={onInstall}
            disabled={isInstallLoading}
            className="h-8 rounded-[10px] px-4 text-xs font-medium shadow-none"
          >
            {isInstallLoading ? (
              <span className="inline-flex items-center gap-2">
                <LoadingSpinner size="sm" />
                {t('marketplace.installing')}
              </span>
            ) : (
              t('marketplace.install')
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Skills() {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    currentAgentId: skillsAgentId,
    enableSkill,
    disableSkill,
    searchResults,
    searchSkills,
    installSkill,
    uninstallSkill,
    sourceDirs,
    searching,
    searchError,
    installing
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const agents = useAgentsStore((state) => state.agents);
  const defaultAgentId = useAgentsStore((state) => state.defaultAgentId);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const chatAgentId = useChatStore((state) => state.currentAgentId);
  const [searchQuery, setSearchQuery] = useState('');
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'needs-setup' | 'disabled' | 'preinstalled' | 'marketplace'>('all');
  const [marketplaceSearchPerformed, setMarketplaceSearchPerformed] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(chatAgentId || defaultAgentId || 'main');
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);
  const preferredAgentId = chatAgentId || defaultAgentId || skillsAgentId || 'main';
  const agentOptions = useMemo(
    () => agents.length > 0
      ? agents.map((agent) => ({
          id: agent.gateway.id,
          name: agent.gateway.name,
        }))
      : [{ id: preferredAgentId, name: preferredAgentId === 'main' ? 'Main' : preferredAgentId }],
    [agents, preferredAgentId]
  );
  const selectedAgentName =
    agentOptions.find((agent) => agent.id === selectedAgentId)?.name
    || selectedAgentId
    || preferredAgentId;
  const managedSkillsDirPath =
    sourceDirs.find((dir) => dir.key === 'managed')?.path || '~/.openclaw/skills';
  const agentSelect = (
    <div ref={agentMenuRef} className="relative min-w-[220px] lg:min-w-[250px]">
      <button
        type="button"
        onClick={() => setAgentMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={agentMenuOpen}
        aria-label={t('agentLabel')}
        className={cn(
          'inline-flex h-[54px] w-full items-center gap-3 rounded-[16px] border border-border/70 bg-card/90 px-3 shadow-sm backdrop-blur-sm transition-all',
          'hover:-translate-y-px hover:border-primary/20 hover:bg-card hover:shadow-[0_10px_28px_rgba(15,23,42,0.10)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25'
        )}
      >
        <span className="shrink-0 rounded-[10px] bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
          {t('agentLabel')}
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-foreground">
          {selectedAgentName}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', agentMenuOpen && 'rotate-180')} />
      </button>
      {agentMenuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-[90] w-full overflow-hidden rounded-[16px] border border-black/10 bg-card/95 p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.18)] ring-1 ring-white/60 backdrop-blur-xl dark:border-white/10 dark:ring-white/10"
        >
          <div className="max-h-56 overflow-y-auto pr-0.5">
            {agentOptions.map((agent) => {
              const selected = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    setAgentMenuOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[13px] transition-colors',
                    selected
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'text-foreground hover:bg-black/5 dark:hover:bg-white/5'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  {selected ? (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );

  // Debounce the gateway warning to avoid flickering during brief restarts (like skill toggles)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isGatewayRunning) {
      // Wait 1.5s before showing the warning
      timer = setTimeout(() => {
        setShowGatewayWarning(true);
      }, 1500);
    } else {
      // Use setTimeout to avoid synchronous setState in effect
      timer = setTimeout(() => {
        setShowGatewayWarning(false);
      }, 0);
    }
    return () => clearTimeout(timer);
  }, [isGatewayRunning]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const selectedExists = agentOptions.some((agent) => agent.id === selectedAgentId);
    if (!selectedAgentId || !selectedExists) {
      setSelectedAgentId(preferredAgentId);
    }
  }, [agentOptions, preferredAgentId, selectedAgentId]);

  useEffect(() => {
    if (!folderMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!folderMenuRef.current?.contains(event.target as Node)) {
        setFolderMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFolderMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [folderMenuOpen]);

  useEffect(() => {
    if (!agentMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!agentMenuRef.current?.contains(event.target as Node)) {
        setAgentMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAgentMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [agentMenuOpen]);

  // Fetch skills for the selected agent view
  useEffect(() => {
    if (!selectedAgentId) return;
    void fetchSkills(selectedAgentId, { includeRuntime: true });
  }, [fetchSkills, selectedAgentId]);

  // Filter skills
  const safeSkills = Array.isArray(skills) ? skills : [];
  const filteredSkills = safeSkills.filter((skill) => {
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());

    let matchesTab = true;
    if (activeTab === 'ready') {
      matchesTab = Boolean(!skill.disabled && skill.eligible);
    } else if (activeTab === 'needs-setup') {
      matchesTab = Boolean(!skill.disabled && !skill.eligible);
    } else if (activeTab === 'disabled') {
      matchesTab = Boolean(skill.disabled);
    } else if (activeTab === 'preinstalled') {
      matchesTab = Boolean(skill.isPreinstalled);
    }

    return matchesSearch && matchesTab;
  }).sort((a, b) => {
    // Ready first, then needs-setup, then disabled
    const aWeight = a.disabled ? 2 : a.eligible ? 0 : 1;
    const bWeight = b.disabled ? 2 : b.eligible ? 0 : 1;
    if (aWeight !== bWeight) return aWeight - bWeight;
    // Then core/bundled
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    // Finally alphabetical
    return a.name.localeCompare(b.name);
  });

  const tabStats = {
    all: safeSkills.length,
    ready: safeSkills.filter((s) => !s.disabled && s.eligible).length,
    'needs-setup': safeSkills.filter((s) => !s.disabled && !s.eligible).length,
    disabled: safeSkills.filter((s) => Boolean(s.disabled)).length,
    preinstalled: safeSkills.filter((s) => Boolean(s.isPreinstalled)).length,
    marketplace: searchResults.length,
  };

  // Handle toggle
  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
    if (!isGatewayRunning) {
      toast.error(t('toast.gatewayRequired'));
      return;
    }
    try {
      if (enable) {
        await enableSkill(skillId);
        toast.success(t('toast.enabled'));
      } else {
        await disableSkill(skillId);
        toast.success(t('toast.disabled'));
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [disableSkill, enableSkill, isGatewayRunning, t]);

  const hasFolderEntries = sourceDirs.length > 0;

  const handleOpenSkillsFolder = useCallback(async (path: string) => {
    try {
      if (!path) {
        throw new Error('Skills directory not available');
      }
      const result = await invokeIpc<string>('shell:openPath', path);
      if (result) {
        // shell.openPath returns an error string if the path doesn't exist
        if (result.toLowerCase().includes('no such file') || result.toLowerCase().includes('not found') || result.toLowerCase().includes('failed to open')) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
      setFolderMenuOpen(false);
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  const handleMarketplaceSearch = useCallback(() => {
    if (!marketplaceQuery.trim()) {
      return;
    }
    setMarketplaceSearchPerformed(true);
    void searchSkills(marketplaceQuery.trim());
  }, [marketplaceQuery, searchSkills]);

  // Handle install
  const handleInstall = useCallback(async (slug: string) => {
    try {
      await installSkill(slug);
      let enabled = false;
      if (isGatewayRunning) {
        const installedSkill = useSkillsStore.getState().skills.find(
          (skill) => skill.slug === slug || skill.id === slug
        );
        if (installedSkill) {
          try {
            await enableSkill(installedSkill.id);
            enabled = true;
          } catch (enableError) {
            toast.error(
              `${t('toast.failedEnableAfterInstall')}: ${
                enableError instanceof Error ? enableError.message : String(enableError)
              }`
            );
          }
        }
      }
      toast.success(enabled ? t('toast.installed') : t('toast.installedOnly'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (['installTimeoutError', 'installRateLimitError'].includes(errorMessage)) {
        toast.error(t(`toast.${errorMessage}`, { path: managedSkillsDirPath }), { duration: 10000 });
      } else {
        toast.error(t('toast.failedInstall') + ': ' + errorMessage);
      }
    }
  }, [installSkill, enableSkill, isGatewayRunning, managedSkillsDirPath, t]);

  // Handle uninstall
  const handleUninstall = useCallback(async (slug: string) => {
    try {
      await uninstallSkill(slug);
      toast.success(t('toast.uninstalled'));
    } catch (err) {
      toast.error(t('toast.failedUninstall') + ': ' + String(err));
    }
  }, [uninstallSkill, t]);

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 pb-6 pt-6 sm:px-6 md:px-8 md:pb-8 md:pt-8">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={agentSelect}
        />

        {/* Gateway Warning */}
        {showGatewayWarning && (
          <div className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
              {t('gatewayWarning')}
            </span>
          </div>
        )}

        {/* Sub Navigation and Actions */}
        <div className="mb-5 shrink-0 rounded-[14px] border border-border/70 bg-card/85 p-3.5 sm:p-4">
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button
                  onClick={() => setActiveTab('all')}
                  className={cn(
                    "rounded-[12px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'all'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('filter.all', { count: tabStats.all })}
                </button>
                <button
                  onClick={() => setActiveTab('preinstalled')}
                  className={cn(
                    "rounded-[12px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'preinstalled'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('filter.preinstalled', { count: tabStats.preinstalled })}
                </button>
                <button
                  onClick={() => setActiveTab('ready')}
                  className={cn(
                    "rounded-[12px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'ready'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('filter.ready', { count: tabStats.ready })}
                </button>
                <button
                  onClick={() => setActiveTab('needs-setup')}
                  className={cn(
                    "rounded-[12px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'needs-setup'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('filter.needsSetup', { count: tabStats['needs-setup'] })}
                </button>
                <button
                  onClick={() => setActiveTab('disabled')}
                  className={cn(
                    "rounded-[12px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'disabled'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('filter.disabled', { count: tabStats.disabled })}
                </button>
                <button
                  onClick={() => setActiveTab('marketplace')}
                  className={cn(
                    "rounded-[12px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'marketplace'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('tabs.marketplace')}
                </button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                <div className="relative" ref={folderMenuRef}>
                  <button
                    type="button"
                    onClick={() => hasFolderEntries && setFolderMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={folderMenuOpen}
                    disabled={!hasFolderEntries}
                    className="group inline-flex h-10 items-center rounded-[14px] border border-black/10 bg-gradient-to-b from-white/95 to-white/70 px-4 text-[13px] font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-px hover:border-black/15 hover:bg-white hover:shadow-[0_8px_22px_rgba(15,23,42,0.10)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:from-white/[0.09] dark:to-white/[0.04] dark:hover:border-white/15 dark:hover:bg-white/[0.10]"
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {t('openFolder')}
                    <ChevronDown className={cn('ml-2 h-4 w-4 text-muted-foreground transition-transform group-hover:scale-110', folderMenuOpen && 'rotate-180')} />
                  </button>
                  {folderMenuOpen && (
                    <div className="absolute right-0 z-[90] mt-2 w-[360px] max-w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-[18px] border border-black/10 bg-card/95 p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.18)] ring-1 ring-white/60 backdrop-blur-xl dark:border-white/10 dark:ring-white/10">
                      <div className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                        {t('folderMenu.title')}
                      </div>
                      {sourceDirs.map((dir, index) => (
                        <button
                          key={`${dir.key}:${dir.path}`}
                          type="button"
                          onClick={() => void handleOpenSkillsFolder(dir.path)}
                          className="flex w-full items-start gap-3 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                              <span className="truncate">
                                {(() => {
                                  const key = `folderMenu.${dir.key}`;
                                  const translated = t(key);
                                  return translated === key ? dir.label : translated;
                                })()}
                              </span>
                              <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-semibold text-foreground/60 dark:bg-white/[0.08] dark:text-foreground/60">
                                #{index + 1}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {dir.path}
                            </span>
                          </span>
                        </button>
                      ))}
                      <div className="border-t border-border/60 px-3 pb-2 pt-2 text-[11px] leading-5 text-muted-foreground">
                        {t('folderMenu.hint')}
                      </div>
                    </div>
                  )}
                </div>
                <RefreshButton
                  label={t('refresh')}
                  loading={loading}
                  mode="icon"
                  onClick={() => void fetchSkills(selectedAgentId, { includeRuntime: true })}
                />
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <div className="relative group flex h-11 min-w-0 flex-1 items-center rounded-[12px] border border-black/8 bg-black/[0.04] px-4 transition-colors focus-within:border-black/12 focus-within:bg-black/[0.06] dark:border-white/10 dark:bg-white/[0.04] dark:focus-within:border-white/15 dark:focus-within:bg-white/[0.06]">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  placeholder={activeTab === 'marketplace' ? t('searchMarketplace') : t('search')}
                  value={activeTab === 'marketplace' ? marketplaceQuery : searchQuery}
                  onChange={(e) => activeTab === 'marketplace' ? setMarketplaceQuery(e.target.value) : setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (activeTab === 'marketplace' && e.key === 'Enter') {
                      e.preventDefault();
                      handleMarketplaceSearch();
                    }
                  }}
                  className="ml-2 w-full bg-transparent text-[14px] font-medium text-foreground outline-none placeholder:text-foreground/45"
                />
                {((activeTab === 'marketplace' && marketplaceQuery) || (activeTab !== 'marketplace' && searchQuery)) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTab === 'marketplace') {
                        setMarketplaceQuery('');
                        setMarketplaceSearchPerformed(false);
                        return;
                      }
                      setSearchQuery('');
                    }}
                    className="ml-1 shrink-0 text-foreground/50 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {activeTab === 'marketplace' && (
                <Button
                  type="button"
                  onClick={handleMarketplaceSearch}
                  disabled={!marketplaceQuery.trim() || searching}
                  className="h-11 rounded-[12px] px-4 text-[13px] font-semibold"
                >
                  {t('searchButton')}
                </Button>
              )}
            </div>

          </div>
        </div>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto px-0 pb-10 pt-1 sm:px-1 md:pt-2">
          {error && activeTab !== 'marketplace' && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                {['fetchTimeoutError', 'fetchRateLimitError', 'timeoutError', 'rateLimitError'].includes(error)
                  ? t(`toast.${error}`, { path: managedSkillsDirPath })
                  : error}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {activeTab !== 'marketplace' && (
              loading && safeSkills.length === 0 ? (
                <PageLoader
                  compact
                  title={t('loadingTitle', '正在加载技能')}
                  description={t('loadingDescription', '正在同步已安装技能和运行状态，请稍候。')}
                />
              ) : filteredSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                  <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {filteredSkills.map((skill) => (
                    <SkillGridCard
                      key={skill.id}
                      onClick={() => setSelectedSkill(skill)}
                      skill={skill}
                      isGatewayRunning={isGatewayRunning}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              )
            )}

            {activeTab === 'marketplace' && (
              <div className="mt-2 flex flex-col gap-4">
                {searchError && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-destructive">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      <span>
                        {['searchTimeoutError', 'searchRateLimitError', 'timeoutError', 'rateLimitError'].includes(searchError.replace('Error: ', ''))
                          ? t(`toast.${searchError.replace('Error: ', '')}`, { path: managedSkillsDirPath })
                          : t('marketplace.searchError')}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 rounded-[10px] border-destructive/30 bg-transparent px-3 text-xs font-medium text-destructive shadow-none hover:bg-destructive/10"
                      onClick={() => invokeIpc('shell:openExternal', 'https://clawhub.ai')}
                    >
                      {t('marketplace.openWebsite')}
                    </Button>
                  </div>
                )}

                {activeTab === 'marketplace' && marketplaceQuery && searching && (
                  <PageLoader
                    compact
                    title={t('marketplace.searchingTitle')}
                    description={t('marketplace.searchingDescription')}
                  />
                )}

                {searchResults.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                    {searchResults.map((skill) => {
                      const installedSkill = resolveInstalledMarketplaceSkill(safeSkills, skill);
                      const isInstalled = Boolean(installedSkill);
                      const isInstallLoading = !!installing[skill.slug];

                      return (
                        <MarketplaceSkillCard
                          key={skill.slug}
                          skill={skill}
                          isInstalled={isInstalled}
                          installedSkill={installedSkill}
                          isInstallLoading={isInstallLoading}
                          onOpen={() => invokeIpc('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`)}
                          onInstall={() => handleInstall(skill.slug)}
                          onUninstall={() => handleUninstall(skill.slug)}
                        />
                      );
                    })}
                    </div>
                ) : marketplaceSearchPerformed ? (
                  !searching && (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                      <Package className="h-10 w-10 mb-4 opacity-50" />
                      <p>{t('marketplace.noResults')}</p>
                    </div>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Package className="h-10 w-10 mb-4 opacity-50" />
                    <p>{t('marketplace.emptyPrompt')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        skill={selectedSkill}
        isOpen={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        canToggle={Boolean(isGatewayRunning && !selectedSkill?.isCore)}
        onToggle={(enabled) => {
          if (!selectedSkill) return;
          handleToggle(selectedSkill.id, enabled);
          setSelectedSkill({ ...selectedSkill, enabled, disabled: !enabled });
        }}
        onUninstall={handleUninstall}
      />
    </div>
  );
}

export default Skills;
