import type { IncomingMessage, ServerResponse } from 'http';
import { getAllSkillConfigs, updateSkillConfig } from '../../utils/skill-config';
import { getManagedInstalledSkillSlugs, getSkillMetadata } from '../../utils/skill-metadata';
import { buildUnifiedSkillList } from '../../utils/skill-list';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

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
      const gatewayStatus = ctx.gatewayManager.getStatus();
      const configsPromise = getAllSkillConfigs();
      const clawhubPromise = ctx.clawHubService.listInstalled().catch(() => []);
      const localInstalledPromise = getManagedInstalledSkillSlugs().catch(() => []);
      const gatewaySkillsPromise =
        gatewayStatus.state === 'running'
          ? ctx.gatewayManager
              .rpc<{ skills?: import('../../utils/skill-list').GatewaySkillStatus[] }>(
                'skills.status',
                undefined,
                3000,
              )
              .then((result) => result.skills || null)
              .catch(() => null)
          : Promise.resolve(null);

      const [configs, clawhubSkills, localInstalledSlugs, gatewaySkills] = await Promise.all([
        configsPromise,
        clawhubPromise,
        localInstalledPromise,
        gatewaySkillsPromise,
      ]);

      const candidateSlugs = new Set<string>();
      for (const slug of localInstalledSlugs) candidateSlugs.add(slug);
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

      sendJson(res, 200, { success: true, results: skills });
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
