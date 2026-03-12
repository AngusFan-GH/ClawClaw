/**
 * Skills Page
 * Browse and manage AI skills
 */
import { useEffect, useState, useCallback, useRef } from 'react';
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
  RefreshCw,
  FolderOpen,
  FileCode,
  Globe,
  Settings2,
  TerminalSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
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



// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onUninstall?: (slug: string) => void;
}

function SkillDetailDialog({ skill, isOpen, onClose, onToggle, onUninstall }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const { fetchSkills } = useSkillsStore();
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [primaryCredential, setPrimaryCredential] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const requiredEnvKeys = getRequiredEnvKeys(skill);
  const showPrimaryCredential = !skill?.isCore;
  const extraEnvKeys = requiredEnvKeys.filter((key) => key !== skill?.primaryEnv);
  const showEnvSection = !skill?.isCore;
  const showConfigEditor = !skill?.isCore;
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
  }, [skill]);

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
      await fetchSkills();

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
                  {skill.isCore ? t('detail.coreSystem') : skill.isBundled ? t('detail.bundled') : t('detail.userInstalled')}
                </Badge>
                {skill.version ? (
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
            {skill.slug && !skill.isBundled && !skill.isCore && (
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
            {!skill.isCore && showConfigEditor && (
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
                onClick={() => onToggle(!skill.enabled)}
              >
                {skill.enabled ? t('detail.disable') : t('detail.enable')}
              </Button>
            )}

            {!skill.isCore && !skill.isBundled && onUninstall && skill.slug && (
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
  onClick: () => void;
  onToggle: (skillId: string, enable: boolean) => void;
}

function SkillGridCard({ skill, onClick, onToggle }: SkillGridCardProps) {
  const { t } = useTranslation('skills');

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
              ) : skill.isBundled ? (
                <Puzzle className="h-3.5 w-3.5 shrink-0 text-blue-500/70" />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge
                variant="secondary"
                className="h-6 rounded-[10px] border-0 bg-black/[0.05] px-2.5 py-0 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]"
              >
                {skill.isCore ? t('detail.coreSystem') : skill.isBundled ? t('detail.bundled') : t('detail.userInstalled')}
              </Badge>
              {skill.version ? (
                <span className="font-mono text-[11px] text-foreground/45">
                  v{skill.version}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0 pl-2 pt-1" onClick={(event) => event.stopPropagation()}>
          <Switch
            checked={skill.enabled}
            onCheckedChange={(checked) => onToggle(skill.id, checked)}
            disabled={skill.isCore}
            className="h-7 w-12 border border-border/70 bg-muted data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted"
          />
        </div>
      </div>

      <p className="mt-4 line-clamp-4 text-[13px] leading-[1.7] text-muted-foreground">
        {skill.description}
      </p>
    </div>
  );
}

interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  isInstalled: boolean;
  isInstallLoading: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}

function MarketplaceSkillCard({
  skill,
  isInstalled,
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
          {isInstalled ? t('detail.userInstalled') : t('marketplace.source')}
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
    enableSkill,
    disableSkill,
    searchResults,
    searchSkills,
    installSkill,
    uninstallSkill,
    searching,
    searchError,
    installing
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [searchQuery, setSearchQuery] = useState('');
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedSource, setSelectedSource] = useState<'all' | 'built-in' | 'marketplace'>('all');
  const marketplaceDiscoveryAttemptedRef = useRef(false);

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

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

  // Fetch skills on mount
  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills, isGatewayRunning]);

  // Filter skills
  const safeSkills = Array.isArray(skills) ? skills : [];
  const filteredSkills = safeSkills.filter((skill) => {
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());

    let matchesSource = true;
    if (selectedSource === 'built-in') {
      matchesSource = !!skill.isBundled;
    } else if (selectedSource === 'marketplace') {
      matchesSource = !skill.isBundled;
    }

    return matchesSearch && matchesSource;
  }).sort((a, b) => {
    // Enabled skills first
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    // Then core/bundled
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    // Finally alphabetical
    return a.name.localeCompare(b.name);
  });

  const sourceStats = {
    all: safeSkills.length,
    builtIn: safeSkills.filter(s => s.isBundled).length,
    marketplace: searchResults.length,
  };
  const enabledSkillsCount = safeSkills.filter((skill) => skill.enabled).length;
  const userSkillsCount = safeSkills.filter((skill) => !skill.isBundled).length;

  // Handle toggle
  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
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
  }, [enableSkill, disableSkill, t]);

  const hasInstalledSkills = safeSkills.some(s => !s.isBundled);

  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const skillsDir = await invokeIpc<string>('openclaw:getSkillsDir');
      if (!skillsDir) {
        throw new Error('Skills directory not available');
      }
      const result = await invokeIpc<string>('shell:openPath', skillsDir);
      if (result) {
        // shell.openPath returns an error string if the path doesn't exist
        if (result.toLowerCase().includes('no such file') || result.toLowerCase().includes('not found') || result.toLowerCase().includes('failed to open')) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  const [skillsDirPath, setSkillsDirPath] = useState('~/.openclaw/skills');

  useEffect(() => {
    invokeIpc<string>('openclaw:getSkillsDir')
      .then((dir) => setSkillsDirPath(dir as string))
      .catch(console.error);
  }, []);


  // Auto-reset when query is cleared
  useEffect(() => {
    if (activeTab === 'marketplace' && marketplaceQuery === '' && marketplaceDiscoveryAttemptedRef.current) {
      void searchSkills('');
    }
  }, [marketplaceQuery, activeTab, searchSkills]);

  useEffect(() => {
    if (activeTab !== 'marketplace') return;
    if (!marketplaceDiscoveryAttemptedRef.current && !marketplaceQuery.trim()) return;

    const timer = window.setTimeout(() => {
      void searchSkills(marketplaceQuery.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeTab, marketplaceQuery, searchSkills]);

  // Handle install
  const handleInstall = useCallback(async (slug: string) => {
    try {
      await installSkill(slug);
      const installedSkill = useSkillsStore.getState().skills.find(
        (skill) => skill.slug === slug || skill.id === slug
      );
      if (installedSkill) {
        await enableSkill(installedSkill.id);
      }
      toast.success(t('toast.installed'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (['installTimeoutError', 'installRateLimitError'].includes(errorMessage)) {
        toast.error(t(`toast.${errorMessage}`, { path: skillsDirPath }), { duration: 10000 });
      } else {
        toast.error(t('toast.failedInstall') + ': ' + errorMessage);
      }
    }
  }, [installSkill, enableSkill, t, skillsDirPath]);

  // Initial marketplace load (Discovery)
  useEffect(() => {
    if (activeTab !== 'marketplace') {
      return;
    }
    if (marketplaceQuery.trim()) {
      return;
    }
    if (searching) {
      return;
    }
    if (marketplaceDiscoveryAttemptedRef.current) {
      return;
    }
    marketplaceDiscoveryAttemptedRef.current = true;
    searchSkills('');
  }, [activeTab, marketplaceQuery, searching, searchSkills]);

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
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 pb-8 pt-10 md:px-8">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="grid grid-cols-2 gap-2.5 lg:max-w-[520px] lg:grid-cols-4 xl:min-w-[520px]">
              <div className="rounded-[10px] border border-border/70 bg-card/85 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-foreground/45">{t('stats.all')}</div>
                <div className="mt-1 text-[23px] font-semibold tracking-tight text-foreground">{safeSkills.length}</div>
              </div>
              <div className="rounded-[10px] border border-border/70 bg-card/85 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-foreground/45">{t('stats.enabled')}</div>
                <div className="mt-1 text-[23px] font-semibold tracking-tight text-foreground">{enabledSkillsCount}</div>
              </div>
              <div className="rounded-[10px] border border-border/70 bg-card/85 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-foreground/45">{t('stats.builtIn')}</div>
                <div className="mt-1 text-[23px] font-semibold tracking-tight text-foreground">{sourceStats.builtIn}</div>
              </div>
              <div className="rounded-[10px] border border-border/70 bg-card/85 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-foreground/45">{t('stats.custom')}</div>
                <div className="mt-1 text-[23px] font-semibold tracking-tight text-foreground">{userSkillsCount}</div>
              </div>
            </div>
          )}
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
        <div className="mb-5 shrink-0 rounded-[10px] border border-border/70 bg-card/85 p-3.5 sm:p-4">
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => { setActiveTab('all'); setSelectedSource('all'); }}
                  className={cn(
                    "rounded-[10px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'all' && selectedSource === 'all'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('filter.all', { count: sourceStats.all })}
                </button>
                <button
                  onClick={() => { setActiveTab('all'); setSelectedSource('built-in'); }}
                  className={cn(
                    "rounded-[10px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'all' && selectedSource === 'built-in'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('filter.builtIn', { count: sourceStats.builtIn })}
                </button>
                <button
                  onClick={() => setActiveTab('marketplace')}
                  className={cn(
                    "rounded-[10px] px-4 py-2 text-[14px] font-medium transition-all",
                    activeTab === 'marketplace'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {t('filter.marketplace', { count: sourceStats.marketplace })}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasInstalledSkills && (
                  <button
                    onClick={handleOpenSkillsFolder}
                    className="h-10 rounded-[10px] border border-border/70 px-4 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-accent/70 hover:text-foreground"
                  >
                    <FolderOpen className="mr-2 inline h-4 w-4" />
                    {t('openFolder')}
                  </button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={fetchSkills}
                  disabled={!isGatewayRunning}
                  className="h-10 w-10 rounded-[10px] border-border/70 bg-transparent shadow-none text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                  title={t('refresh')}
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                </Button>
              </div>
            </div>

            <div className="relative group flex h-11 min-w-0 items-center rounded-[10px] border border-black/8 bg-black/[0.04] px-4 transition-colors focus-within:border-black/12 focus-within:bg-black/[0.06] dark:border-white/10 dark:bg-white/[0.04] dark:focus-within:border-white/15 dark:focus-within:bg-white/[0.06]">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                placeholder={t('search')}
                value={activeTab === 'marketplace' ? marketplaceQuery : searchQuery}
                onChange={(e) => activeTab === 'marketplace' ? setMarketplaceQuery(e.target.value) : setSearchQuery(e.target.value)}
                className="ml-2 w-full bg-transparent text-[14px] font-medium text-foreground outline-none placeholder:text-foreground/45"
              />
              {((activeTab === 'marketplace' && marketplaceQuery) || (activeTab === 'all' && searchQuery)) && (
                <button
                  type="button"
                  onClick={() => activeTab === 'marketplace' ? setMarketplaceQuery('') : setSearchQuery('')}
                  className="ml-1 shrink-0 text-foreground/50 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-1 pb-12 pt-2 min-h-0">
          {error && activeTab === 'all' && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                {['fetchTimeoutError', 'fetchRateLimitError', 'timeoutError', 'rateLimitError'].includes(error)
                  ? t(`toast.${error}`, { path: skillsDirPath })
                  : error}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {activeTab === 'all' && (
              loading && safeSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <LoadingSpinner size="lg" />
                  <p className="mt-4 text-sm">{t('marketplace.searching')}</p>
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                  <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredSkills.map((skill) => (
                    <SkillGridCard
                    key={skill.id}
                    onClick={() => setSelectedSkill(skill)}
                    skill={skill}
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
                          ? t(`toast.${searchError.replace('Error: ', '')}`, { path: skillsDirPath })
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
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <LoadingSpinner size="lg" />
                    <p className="mt-4 text-sm">{t('marketplace.searching')}</p>
                  </div>
                )}

                {searchResults.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {searchResults.map((skill) => {
                      const isInstalled = safeSkills.some(s => s.id === skill.slug || s.name === skill.name);
                      const isInstallLoading = !!installing[skill.slug];

                      return (
                        <MarketplaceSkillCard
                          key={skill.slug}
                          skill={skill}
                          isInstalled={isInstalled}
                          isInstallLoading={isInstallLoading}
                          onOpen={() => invokeIpc('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`)}
                          onInstall={() => handleInstall(skill.slug)}
                          onUninstall={() => handleUninstall(skill.slug)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  !searching && marketplaceQuery && (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                      <Package className="h-10 w-10 mb-4 opacity-50" />
                      <p>{t('marketplace.noResults')}</p>
                    </div>
                  )
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
        onToggle={(enabled) => {
          if (!selectedSkill) return;
          handleToggle(selectedSkill.id, enabled);
          setSelectedSkill({ ...selectedSkill, enabled });
        }}
        onUninstall={handleUninstall}
      />
    </div>
  );
}

export default Skills;
