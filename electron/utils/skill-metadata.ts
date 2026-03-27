import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parse } from 'yaml';
import { getOpenClawConfigDir, getOpenClawDir, getOpenClawSkillsDir, getResourcesDir } from './paths';

export interface SkillRequirements {
  env?: string[];
  bins?: string[];
  anyBins?: string[];
  config?: string[];
  os?: string[];
}

export interface SkillMetadataInfo {
  slug: string;
  name?: string;
  description?: string;
  skillKey?: string;
  emoji?: string;
  primaryEnv?: string;
  isProjectBundled?: boolean;
  requires: SkillRequirements;
}

type ParsedFrontmatter = {
  name?: string;
  description?: string;
  metadata?: {
    openclaw?: {
      skillKey?: string;
      emoji?: string;
      primaryEnv?: string;
      requires?: SkillRequirements;
    };
    clawdbot?: {
      skillKey?: string;
      emoji?: string;
      primaryEnv?: string;
      requires?: SkillRequirements;
    };
  };
};

function extractFrontmatter(raw: string): string | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] ?? null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

async function readMetadataFromFile(slug: string, filePath: string): Promise<SkillMetadataInfo | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = await readFile(filePath, 'utf-8');
    const frontmatter = extractFrontmatter(raw);
    if (!frontmatter) {
      return null;
    }

    const parsed = parse(frontmatter) as ParsedFrontmatter | null;
    const openclaw = parsed?.metadata?.openclaw || parsed?.metadata?.clawdbot;

    return {
      slug,
      name: parsed?.name,
      description: parsed?.description,
      skillKey: openclaw?.skillKey,
      emoji: openclaw?.emoji,
      primaryEnv: openclaw?.primaryEnv,
      requires: {
        env: normalizeStringList(openclaw?.requires?.env),
        bins: normalizeStringList(openclaw?.requires?.bins),
        anyBins: normalizeStringList(openclaw?.requires?.anyBins),
        config: normalizeStringList(openclaw?.requires?.config),
        os: normalizeStringList(openclaw?.requires?.os),
      },
    };
  } catch {
    return null;
  }
}

async function resolveSkillMetadata(slug: string): Promise<SkillMetadataInfo | null> {
  const managedPath = join(getOpenClawSkillsDir(), slug, 'SKILL.md');
  const workspacePath = join(getOpenClawConfigDir(), 'workspace', 'skills', slug, 'SKILL.md');
  const bundledPath = join(getOpenClawDir(), 'skills', slug, 'SKILL.md');
  const projectBundledPath = join(getResourcesDir(), 'skills', slug, 'SKILL.md');

  const metadata =
    (await readMetadataFromFile(slug, workspacePath)) ||
    (await readMetadataFromFile(slug, managedPath)) ||
    (await readMetadataFromFile(slug, bundledPath)) ||
    (await readMetadataFromFile(slug, projectBundledPath));

  if (!metadata) {
    return null;
  }

  return {
    ...metadata,
    isProjectBundled: existsSync(projectBundledPath),
  };
}

export async function getSkillMetadata(slugs?: string[]): Promise<Record<string, SkillMetadataInfo>> {
  const targetSlugs = new Set<string>();

  if (Array.isArray(slugs) && slugs.length > 0) {
    for (const slug of slugs) {
      if (typeof slug === 'string' && slug.trim()) {
        targetSlugs.add(slug.trim());
      }
    }
  } else {
    const scanDirs = [
      join(getOpenClawConfigDir(), 'workspace', 'skills'),
      getOpenClawSkillsDir(),
      join(getOpenClawDir(), 'skills'),
    ];
    for (const dir of scanDirs) {
      if (!existsSync(dir)) {
        continue;
      }
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          targetSlugs.add(entry.name);
        }
      }
    }
  }

  const metadataEntries = await Promise.all(
    Array.from(targetSlugs).map(async (slug) => [slug, await resolveSkillMetadata(slug)] as const),
  );

  const result: Record<string, SkillMetadataInfo> = {};
  for (const [slug, metadata] of metadataEntries) {
    if (!metadata) {
      continue;
    }
    result[slug] = metadata;
    if (metadata.name && !result[metadata.name]) {
      result[metadata.name] = metadata;
    }
    if (metadata.skillKey && !result[metadata.skillKey]) {
      result[metadata.skillKey] = metadata;
    }
  }

  return result;
}

export async function getManagedInstalledSkillSlugs(): Promise<string[]> {
  const skillsDir = getOpenClawSkillsDir();
  if (!existsSync(skillsDir)) {
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}

export async function getProjectBundledSkillSlugs(): Promise<string[]> {
  const skillsDir = join(getResourcesDir(), 'skills');
  if (!existsSync(skillsDir)) {
    return [];
  }
  const entries = await readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}
