import type { IncomingMessage, ServerResponse } from 'http';
import { getAllSkillConfigs, updateSkillConfig } from '../../utils/skill-config';
import { getManagedInstalledSkillSlugs, getSkillMetadata } from '../../utils/skill-metadata';
import { buildUnifiedSkillList, summarizeGatewaySkillSources } from '../../utils/skill-list';
import { getSkillsConfigSnapshot } from '../../services/config-snapshot';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

async function buildSkillsSnapshotResponse(agentId?: string) {
  const configSnapshot = await getSkillsConfigSnapshot(agentId);
  const {
    configs,
    localInstalledSlugs,
    metadataMap,
    workspaceDir,
    managedSkillsDir,
  } = configSnapshot;

  const skills = buildUnifiedSkillList({
    gatewaySkills: null,
    clawhubSkills: [],
    localInstalledSlugs,
    configs,
    metadataMap,
    gatewayRunning: false,
  });

  return {
    success: true as const,
    results: skills,
    sourceStats: [] as import('../../../src/types/skill').SkillSourceStat[],
    sourceDirs: summarizeGatewaySkillSources({
      gatewaySkills: null,
      workspaceDir,
      managedSkillsDir,
    }).dirs,
  };
}

async function buildSkillsRuntimeResponse(ctx: HostApiContext, agentId?: string) {
  const gatewayStatus = ctx.gatewayManager.getStatus();
  const shouldIncludeRuntime =
    gatewayStatus.state === 'running'
    && !ctx.gatewayManager.isInStartupStabilizationWindow();

  if (!shouldIncludeRuntime) {
    return {
      success: true as const,
      results: [] as import('../../../src/types/skill').Skill[],
      sourceStats: [] as import('../../../src/types/skill').SkillSourceStat[],
      sourceDirs: [] as import('../../../src/types/skill').SkillSourceDir[],
    };
  }

  const configSnapshot = await getSkillsConfigSnapshot(agentId);
  const gatewayStatusReport = await ctx.gatewayManager
    .rpc<{
      skills?: import('../../utils/skill-list').GatewaySkillStatus[];
      workspaceDir?: string;
      managedSkillsDir?: string;
    }>(
      'skills.status',
      agentId ? { agentId } : {},
      3000,
    )
    .then((result) => ({
      skills: result.skills || null,
      workspaceDir: result.workspaceDir || null,
      managedSkillsDir: result.managedSkillsDir || null,
    }))
    .catch(() => ({ skills: null, workspaceDir: null, managedSkillsDir: null }));

  const {
    configs,
    localInstalledSlugs,
    projectBundledSlugs,
    metadataMap: baseMetadataMap,
    workspaceDir,
    managedSkillsDir,
  } = configSnapshot;
  const gatewaySkills = gatewayStatusReport.skills;
  const effectiveWorkspaceDir = gatewayStatusReport.workspaceDir || workspaceDir;
  const effectiveManagedSkillsDir = gatewayStatusReport.managedSkillsDir || managedSkillsDir;

  const candidateSlugs = new Set<string>();
  for (const slug of localInstalledSlugs) candidateSlugs.add(slug);
  for (const slug of projectBundledSlugs) candidateSlugs.add(slug);
  for (const skill of gatewaySkills || []) {
    if (skill.slug) candidateSlugs.add(skill.slug);
    if (skill.skillKey) candidateSlugs.add(skill.skillKey);
  }
  Object.keys(configs).forEach((key) => candidateSlugs.add(key));

  const metadataKeys = new Set(Object.keys(baseMetadataMap));
  const needsExtraMetadata = Array.from(candidateSlugs).some((slug) => !metadataKeys.has(slug));
  const metadataMap = needsExtraMetadata
    ? {
        ...baseMetadataMap,
        ...(await getSkillMetadata([...candidateSlugs])),
      }
    : baseMetadataMap;

  const skills = buildUnifiedSkillList({
    gatewaySkills,
    clawhubSkills: [],
    localInstalledSlugs,
    configs,
    metadataMap,
    gatewayRunning: true,
  });
  const sourceSummary = summarizeGatewaySkillSources({
    gatewaySkills,
    workspaceDir: effectiveWorkspaceDir,
    managedSkillsDir: effectiveManagedSkillsDir,
  });

  return {
    success: true as const,
    results: skills,
    sourceStats: sourceSummary.stats,
    sourceDirs: sourceSummary.dirs,
  };
}

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      sendJson(res, 200, await updateSkillConfig(body.skillKey, {
        apiKey: body.apiKey,
        env: body.env,
      }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/metadata' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slugs?: string[] }>(req);
      sendJson(res, 200, { success: true, results: await getSkillMetadata(body.slugs) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/local-installed' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await getManagedInstalledSkillSlugs() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/list' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agentId')?.trim() || undefined;
      sendJson(res, 200, await buildSkillsSnapshotResponse(agentId));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/runtime' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agentId')?.trim() || undefined;
      sendJson(res, 200, await buildSkillsRuntimeResponse(ctx, agentId));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      sendJson(res, 200, {
        success: true,
        results: await ctx.clawHubService.search(body),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await ctx.clawHubService.install(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/uninstall' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await ctx.clawHubService.uninstall(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/list' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await ctx.clawHubService.listInstalled() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.slug);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
