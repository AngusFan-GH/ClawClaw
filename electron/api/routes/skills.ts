import type { IncomingMessage, ServerResponse } from 'http';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { getOpenClawSkillsDir } from '../../utils/paths';
import { getAllSkillConfigs, updateSkillConfig } from '../../utils/skill-config';
import {
  getManagedInstalledSkillSlugs,
  getProjectBundledSkillSlugs,
  getSkillMetadata,
} from '../../utils/skill-metadata';
import { buildUnifiedSkillList, summarizeGatewaySkillSources } from '../../utils/skill-list';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const resolveFallbackSkillDirs = async (agentId?: string): Promise<{
    workspaceDir: string | null;
    managedSkillsDir: string | null;
  }> => {
    try {
      const snapshot = await listAgentsSnapshot();
      const selected =
        (agentId ? snapshot.agents.find((agent) => agent.id === agentId) : undefined)
        || snapshot.agents.find((agent) => agent.id === snapshot.defaultAgentId)
        || snapshot.agents[0];
      return {
        workspaceDir: selected?.workspace || null,
        managedSkillsDir: getOpenClawSkillsDir(),
      };
    } catch {
      return {
        workspaceDir: null,
        managedSkillsDir: getOpenClawSkillsDir(),
      };
    }
  };

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
      const gatewayStatus = ctx.gatewayManager.getStatus();
      const configsPromise = getAllSkillConfigs();
      const clawhubPromise = ctx.clawHubService.listInstalled().catch(() => []);
      const localInstalledPromise = getManagedInstalledSkillSlugs().catch(() => []);
      const projectBundledPromise = getProjectBundledSkillSlugs().catch(() => []);
      const fallbackDirsPromise = resolveFallbackSkillDirs(agentId);
      const gatewaySkillsPromise =
        gatewayStatus.state === 'running'
          ? ctx.gatewayManager
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
              .catch(() => ({ skills: null, workspaceDir: null, managedSkillsDir: null }))
          : Promise.resolve({ skills: null, workspaceDir: null, managedSkillsDir: null });

      const [configs, clawhubSkills, localInstalledSlugs, projectBundledSlugs, gatewayStatusReport, fallbackDirs] = await Promise.all([
        configsPromise,
        clawhubPromise,
        localInstalledPromise,
        projectBundledPromise,
        gatewaySkillsPromise,
        fallbackDirsPromise,
      ]);
      const gatewaySkills = gatewayStatusReport.skills;
      const effectiveWorkspaceDir = gatewayStatusReport.workspaceDir || fallbackDirs.workspaceDir;
      const effectiveManagedSkillsDir = gatewayStatusReport.managedSkillsDir || fallbackDirs.managedSkillsDir;

      const candidateSlugs = new Set<string>();
      for (const slug of localInstalledSlugs) candidateSlugs.add(slug);
      for (const slug of projectBundledSlugs) candidateSlugs.add(slug);
      for (const skill of clawhubSkills) candidateSlugs.add(skill.slug);
      for (const skill of gatewaySkills || []) {
        if (skill.slug) candidateSlugs.add(skill.slug);
        if (skill.skillKey) candidateSlugs.add(skill.skillKey);
      }
      Object.keys(configs).forEach((key) => candidateSlugs.add(key));

      const metadataMap = await getSkillMetadata([...candidateSlugs]);
      const skills = buildUnifiedSkillList({
        gatewaySkills,
        clawhubSkills,
        localInstalledSlugs,
        configs,
        metadataMap,
        gatewayRunning: gatewayStatus.state === 'running',
      });
      const sourceSummary = summarizeGatewaySkillSources({
        gatewaySkills,
        workspaceDir: effectiveWorkspaceDir,
        managedSkillsDir: effectiveManagedSkillsDir,
      });

      sendJson(res, 200, {
        success: true,
        results: skills,
        sourceStats: sourceSummary.stats,
        sourceDirs: sourceSummary.dirs,
      });
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
