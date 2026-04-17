/**
 * Skill Config Utilities
 * Direct read/write access to skill configuration in ~/.openclaw/openclaw.json
 * This bypasses the Gateway RPC for faster and more reliable config updates.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { access, cp, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { constants } from 'fs';
import { join } from 'path';
import { getOpenClawDir, getOpenClawSkillsDir, getResourcesDir } from './paths';
import { logger } from './logger';
import {
  readOpenClawConfigRecordRaw,
  updateOpenClawConfigRecord,
} from './openclaw-config';

interface SkillEntry {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
}

interface OpenClawConfig {
  skills?: {
    entries?: Record<string, SkillEntry>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the current OpenClaw config
 */
async function readConfigSnapshot(): Promise<OpenClawConfig> {
  try {
    return await readOpenClawConfigRecordRaw<OpenClawConfig>();
  } catch (err) {
    console.error('Failed to read openclaw config:', err);
    return {};
  }
}

/**
 * Get skill config
 */
export async function getSkillConfig(skillKey: string): Promise<SkillEntry | undefined> {
  const config = await readConfigSnapshot();
  return config.skills?.entries?.[skillKey];
}

/**
 * Update skill config (apiKey and env)
 */
export async function updateSkillConfig(
  skillKey: string,
  updates: { apiKey?: string; env?: Record<string, string> }
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateOpenClawConfigRecord((config) => {
      const typedConfig = config as OpenClawConfig;

      if (!typedConfig.skills) {
        typedConfig.skills = {};
      }
      if (!typedConfig.skills.entries) {
        typedConfig.skills.entries = {};
      }

      const entry = typedConfig.skills.entries[skillKey] || {};

      if (updates.apiKey !== undefined) {
        const trimmed = updates.apiKey.trim();
        if (trimmed) {
          entry.apiKey = trimmed;
        } else {
          delete entry.apiKey;
        }
      }

      if (updates.env !== undefined) {
        const newEnv: Record<string, string> = {};

        for (const [key, value] of Object.entries(updates.env)) {
          const trimmedKey = key.trim();
          if (!trimmedKey) continue;

          const trimmedVal = value.trim();
          if (trimmedVal) {
            newEnv[trimmedKey] = trimmedVal;
          }
        }

        if (Object.keys(newEnv).length > 0) {
          entry.env = newEnv;
        } else {
          delete entry.env;
        }
      }

      typedConfig.skills.entries![skillKey] = entry;
    });
    return { success: true };
  } catch (err) {
    console.error('Failed to update skill config:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Get all skill configs (for syncing to frontend)
 */
export async function getAllSkillConfigs(): Promise<Record<string, SkillEntry>> {
  const config = await readConfigSnapshot();
  return config.skills?.entries || {};
}

/**
 * Extension-hosted built-in skills bundled with ClawClaw that should be
 * pre-deployed to ~/.openclaw/skills/ on first launch. These come from the
 * openclaw package's extensions directory and are available in both dev and
 * packaged builds.
 */
const EXTENSION_BUILTIN_SKILLS = [
  { slug: 'feishu-doc', sourceExtension: 'feishu' },
  { slug: 'feishu-drive', sourceExtension: 'feishu' },
  { slug: 'feishu-perm', sourceExtension: 'feishu' },
  { slug: 'feishu-wiki', sourceExtension: 'feishu' },
] as const;

interface BuiltinSkillCandidate {
  slug: string;
  sourceDir: string;
}

async function discoverProjectBuiltinSkills(): Promise<BuiltinSkillCandidate[]> {
  const projectSkillsRoot = join(getResourcesDir(), 'skills');
  if (!(await fileExists(projectSkillsRoot))) {
    return [];
  }

  const entries = await readdir(projectSkillsRoot, { withFileTypes: true });
  const candidates: BuiltinSkillCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const slug = entry.name.trim();
    if (!slug) {
      continue;
    }

    const sourceDir = join(projectSkillsRoot, slug);
    if (!(await fileExists(join(sourceDir, 'SKILL.md')))) {
      continue;
    }

    candidates.push({ slug, sourceDir });
  }

  return candidates;
}

async function getBuiltinSkillCandidates(): Promise<BuiltinSkillCandidate[]> {
  const openclawDir = getOpenClawDir();
  const extensionCandidates = EXTENSION_BUILTIN_SKILLS
    .map(({ slug, sourceExtension }) => ({
      slug,
      sourceDir: join(openclawDir, 'extensions', sourceExtension, 'skills', slug),
    }))
    .filter(({ sourceDir }) => existsSync(join(sourceDir, 'SKILL.md')));

  const projectCandidates = await discoverProjectBuiltinSkills();
  const deduped = new Map<string, BuiltinSkillCandidate>();

  for (const candidate of extensionCandidates) {
    deduped.set(candidate.slug, candidate);
  }
  for (const candidate of projectCandidates) {
    deduped.set(candidate.slug, candidate);
  }

  return [...deduped.values()];
}

/**
 * Ensure built-in skills are deployed to ~/.openclaw/skills/<slug>/.
 * Sources include packaged OpenClaw extension skills plus any first-party
 * project skills under resources/skills/<slug>/SKILL.md.
 * Skips any skill that already has a SKILL.md present (idempotent).
 * Runs at app startup; all errors are logged and swallowed so they never
 * block the normal startup flow.
 */
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
  const skillsRoot = getOpenClawSkillsDir();
  const builtinSkills = await getBuiltinSkillCandidates();

  for (const { slug, sourceDir } of builtinSkills) {
    const targetDir = join(skillsRoot, slug);
    const targetManifest = join(targetDir, 'SKILL.md');

    if (existsSync(targetManifest)) {
      continue; // already installed
    }

    if (!existsSync(join(sourceDir, 'SKILL.md'))) {
      logger.warn(`Built-in skill source not found, skipping: ${sourceDir}`);
      continue;
    }

    try {
      await mkdir(targetDir, { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true });
      logger.info(`Installed built-in skill: ${slug} -> ${targetDir}`);
    } catch (error) {
      logger.warn(`Failed to install built-in skill ${slug}:`, error);
    }
  }
}
