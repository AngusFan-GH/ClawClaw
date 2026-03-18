import type { Skill } from '../../src/types/skill';
import type { SkillMetadataInfo } from './skill-metadata';

export type SkillMetadataMap = Record<string, SkillMetadataInfo>;
export type SkillConfigMap = Record<string, { apiKey?: string; env?: Record<string, string> }>;

export type GatewaySkillStatus = {
  skillKey: string;
  slug?: string;
  name?: string;
  description?: string;
  disabled?: boolean;
  emoji?: string;
  version?: string;
  author?: string;
  config?: Record<string, unknown>;
  bundled?: boolean;
  always?: boolean;
};

export type ClawHubListResult = {
  slug: string;
  version?: string;
};

function hasLikelyEmoji(value: string): boolean {
  return Array.from(value).some((char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint >= 0x2600;
  });
}

function normalizeSkillIcon(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const icon = (candidate || '').trim();
    if (!icon) continue;
    if (icon.includes('\uFFFD')) continue;
    const hasCjk = /[\u3400-\u9FFF]/.test(icon);
    const looksEmoji = hasLikelyEmoji(icon);
    if (hasCjk && !looksEmoji) continue;
    if (!looksEmoji && icon.length > 2) continue;
    return icon;
  }
  return '\uD83D\uDCE6';
}

function resolveMetadata(
  metadataMap: SkillMetadataMap,
  ...candidates: Array<string | undefined>
): SkillMetadataInfo | undefined {
  for (const candidate of candidates) {
    const key = candidate?.trim();
    if (!key) continue;
    const metadata = metadataMap[key];
    if (metadata) {
      return metadata;
    }
  }
  return undefined;
}

function buildAliases(
  metadataMap: SkillMetadataMap,
  metadata: SkillMetadataInfo | undefined,
  ...candidates: Array<string | undefined>
): string[] {
  const aliases = new Set<string>();

  const pushAlias = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    aliases.add(trimmed);

    const resolved = metadataMap[trimmed];
    const resolvedSlug = resolved?.slug?.trim();
    const resolvedSkillKey = resolved?.skillKey?.trim();
    if (resolvedSlug) aliases.add(resolvedSlug);
    if (resolvedSkillKey) aliases.add(resolvedSkillKey);
  };

  if (metadata) {
    pushAlias(metadata.slug);
    pushAlias(metadata.skillKey);
    pushAlias(metadata.name);
  }
  candidates.forEach(pushAlias);
  return [...aliases];
}

function resolveIdentity(
  metadataMap: SkillMetadataMap,
  ...candidates: Array<string | undefined>
): { id: string; slug: string; aliases: string[]; metadata?: SkillMetadataInfo } {
  const metadata = resolveMetadata(metadataMap, ...candidates);
  const aliases = buildAliases(metadataMap, metadata, ...candidates);
  const slug =
    metadata?.slug?.trim()
    || candidates.map((value) => value?.trim()).find((value) => value && value !== metadata?.skillKey)
    || metadata?.skillKey?.trim()
    || 'unknown-skill';
  const id = metadata?.skillKey?.trim() || candidates.map((value) => value?.trim()).find(Boolean) || slug;
  return { id, slug, aliases, metadata };
}

function pickConfig(configs: SkillConfigMap, aliases: string[]): { apiKey?: string; env?: Record<string, string> } {
  for (const alias of aliases) {
    if (configs[alias]) {
      return configs[alias];
    }
  }
  return {};
}

function pickVersion(installedVersions: Map<string, string>, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const version = installedVersions.get(alias);
    if (version) {
      return version;
    }
  }
  return undefined;
}

function hasAlias(targetAliases: Set<string>, aliases: string[]): boolean {
  return aliases.some((alias) => targetAliases.has(alias));
}

function mergeSkill(target: Skill, patch: Partial<Skill>): Skill {
  return {
    ...target,
    ...patch,
    config: patch.config ? { ...(target.config || {}), ...patch.config } : target.config,
    requirements: patch.requirements || target.requirements,
  };
}

export function buildUnifiedSkillList(input: {
  gatewaySkills?: GatewaySkillStatus[] | null;
  clawhubSkills?: ClawHubListResult[];
  localInstalledSlugs?: string[];
  configs?: SkillConfigMap;
  metadataMap?: SkillMetadataMap;
  gatewayRunning: boolean;
}): Skill[] {
  const configs = input.configs || {};
  const metadataMap = input.metadataMap || {};
  const clawhubSkills = input.clawhubSkills || [];
  const localInstalledSet = new Set(input.localInstalledSlugs || []);
  const installedVersions = new Map(clawhubSkills.map((skill) => [skill.slug, skill.version || '']));
  const skillById = new Map<string, Skill>();
  const aliasIndex = new Map<string, string>();

  const upsert = (identityCandidates: Array<string | undefined>, buildPatch: (base?: Skill) => Partial<Skill>) => {
    const identity = resolveIdentity(metadataMap, ...identityCandidates);
    const existingId =
      identity.aliases.map((alias) => aliasIndex.get(alias)).find(Boolean)
      || skillById.get(identity.id)?.id;
    const existing = existingId ? skillById.get(existingId) : undefined;
    const base: Skill = existing || {
      id: identity.id,
      slug: identity.slug,
      name: identity.metadata?.name || identity.slug,
      description: identity.metadata?.description || '',
      enabled: false,
      runtimeEnabled: false,
      installedOnDisk: false,
      loadedInGateway: false,
      runtimeStatus: input.gatewayRunning ? 'not_loaded' : 'unknown',
      runtimeReason: input.gatewayRunning ? 'not_loaded' : 'gateway_offline',
      runtimeError: undefined,
      icon: normalizeSkillIcon(identity.metadata?.emoji),
      version: '',
      author: undefined,
      config: {},
      primaryEnv: identity.metadata?.primaryEnv,
      requirements: identity.metadata?.requires,
      configurable: Boolean(
        identity.metadata?.primaryEnv ||
        identity.metadata?.requires?.env?.length,
      ),
      isCore: false,
      isBundled: false,
      isPreinstalled: Boolean(identity.metadata?.isProjectBundled),
    };

    const directConfig = pickConfig(configs, identity.aliases);
    const patch = buildPatch(existing);
    const merged = mergeSkill(base, {
      slug: identity.slug,
      primaryEnv: identity.metadata?.primaryEnv ?? base.primaryEnv,
      requirements: identity.metadata?.requires || base.requirements,
      isPreinstalled: Boolean(identity.metadata?.isProjectBundled) || base.isPreinstalled,
      configurable: Boolean(
        identity.metadata?.primaryEnv ||
        identity.metadata?.requires?.env?.length ||
        directConfig.apiKey ||
        Object.keys(directConfig.env || {}).length ||
        base.configurable,
      ),
      config: directConfig,
      ...patch,
    });

    skillById.set(merged.id, merged);
    for (const alias of identity.aliases) {
      aliasIndex.set(alias, merged.id);
    }
  };

  for (const gatewaySkill of input.gatewaySkills || []) {
    const identity = resolveIdentity(metadataMap, gatewaySkill.slug, gatewaySkill.skillKey);
    const aliases = identity.aliases;
    const directConfig = pickConfig(configs, aliases);
    const installedOnDisk =
      Boolean(gatewaySkill.bundled)
      || hasAlias(localInstalledSet, aliases)
      || Boolean(pickVersion(installedVersions, aliases));
    upsert([gatewaySkill.slug, gatewaySkill.skillKey], () => ({
      id: identity.metadata?.skillKey || gatewaySkill.skillKey,
      slug: identity.slug,
      name: gatewaySkill.name || identity.metadata?.name || gatewaySkill.skillKey,
      description: gatewaySkill.description || identity.metadata?.description || '',
      enabled: !gatewaySkill.disabled,
      runtimeEnabled: !gatewaySkill.disabled,
      installedOnDisk,
      loadedInGateway: true,
      runtimeStatus: 'loaded',
      runtimeReason: undefined,
      icon: normalizeSkillIcon(gatewaySkill.emoji, identity.metadata?.emoji),
      version: gatewaySkill.version || pickVersion(installedVersions, aliases) || '',
      author: gatewaySkill.author,
      config: { ...(gatewaySkill.config || {}), ...directConfig },
      isCore: Boolean(gatewaySkill.bundled && gatewaySkill.always),
      isBundled: Boolean(gatewaySkill.bundled && !identity.metadata?.isProjectBundled),
    }));
  }

  for (const clawhubSkill of clawhubSkills) {
    upsert([clawhubSkill.slug], (existing) => ({
      id: existing?.id || resolveIdentity(metadataMap, clawhubSkill.slug).metadata?.skillKey || clawhubSkill.slug,
      slug: resolveIdentity(metadataMap, clawhubSkill.slug).slug,
      name: existing?.name || resolveIdentity(metadataMap, clawhubSkill.slug).metadata?.name || clawhubSkill.slug,
      description:
        existing?.description
        || resolveIdentity(metadataMap, clawhubSkill.slug).metadata?.description
        || 'Recently installed, initializing...',
      installedOnDisk: true,
      version: clawhubSkill.version || existing?.version || '',
      runtimeStatus: existing?.loadedInGateway ? 'loaded' : input.gatewayRunning ? 'not_loaded' : 'unknown',
      runtimeReason: existing?.loadedInGateway ? undefined : input.gatewayRunning ? 'not_loaded' : 'gateway_offline',
      isBundled: existing?.isBundled || false,
    }));
  }

  for (const slug of input.localInstalledSlugs || []) {
    upsert([slug], (existing) => ({
      id: existing?.id || resolveIdentity(metadataMap, slug).metadata?.skillKey || slug,
      slug: resolveIdentity(metadataMap, slug).slug,
      name: existing?.name || resolveIdentity(metadataMap, slug).metadata?.name || slug,
      description:
        existing?.description
        || resolveIdentity(metadataMap, slug).metadata?.description
        || 'Installed locally and awaiting runtime discovery.',
      installedOnDisk: true,
      runtimeStatus: existing?.loadedInGateway ? 'loaded' : input.gatewayRunning ? 'not_loaded' : 'unknown',
      runtimeReason: existing?.loadedInGateway ? undefined : input.gatewayRunning ? 'not_loaded' : 'gateway_offline',
    }));
  }

  return [...skillById.values()].sort((left, right) => {
    if (left.isCore && !right.isCore) return -1;
    if (!left.isCore && right.isCore) return 1;
    return left.name.localeCompare(right.name);
  });
}
