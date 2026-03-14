import type { IncomingMessage, ServerResponse } from 'http';
import { listAgentsSnapshot } from '../../utils/agent-config';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

interface GatewayCronJob {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
  delivery?: { mode: string; channel?: string; to?: string };
  sessionTarget?: string;
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDeliveryError?: string;
    lastDurationMs?: number;
  };
}

function isUiManagedAgentTurn(job: GatewayCronJob): boolean {
  return (
    (job.sessionTarget === 'isolated' || !job.sessionTarget)
    && job.payload?.kind === 'agentTurn'
    && (job.delivery?.mode ?? 'none') === 'none'
  );
}

function isEditableUiJob(job: GatewayCronJob): boolean {
  return isUiManagedAgentTurn(job);
}

function clearChannelRequiredError(job: GatewayCronJob): void {
  if (job.state?.lastError?.includes('Channel is required')) {
    job.state.lastError = undefined;
    job.state.lastStatus = 'ok';
  }
}

function clearStaleUiDeliveryError(job: GatewayCronJob): void {
  if (isUiManagedAgentTurn(job)) {
    clearChannelRequiredError(job);
  }
}

async function getCronJobById(ctx: HostApiContext, id: string): Promise<GatewayCronJob | undefined> {
  const result = await ctx.gatewayManager.rpc('cron.list', { includeDisabled: true });
  const data = result as { jobs?: GatewayCronJob[] };
  return (data?.jobs ?? []).find((job) => job.id === id);
}

function resolveAgentName(
  agentId: string | undefined,
  agentNameMap: Map<string, string>,
): string | undefined {
  if (!agentId) {
    return undefined;
  }
  return agentNameMap.get(agentId) || agentId;
}

function transformCronJob(job: GatewayCronJob, agentNameMap: Map<string, string>) {
  const message = job.payload?.message || job.payload?.text || '';
  clearStaleUiDeliveryError(job);
  const uiManaged = isEditableUiJob(job);
  const channelType = job.delivery?.mode === 'announce' ? job.delivery?.channel : undefined;
  const target = channelType
    ? { channelType, channelId: channelType, channelName: channelType }
    : undefined;
  const lastRun = job.state?.lastRunAtMs
    ? {
      time: new Date(job.state.lastRunAtMs).toISOString(),
      success: job.state.lastStatus === 'ok',
      error: job.state.lastDeliveryError || job.state.lastError,
      duration: job.state.lastDurationMs,
    }
    : undefined;
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;

  return {
    id: job.id,
    agentId: job.agentId,
    agentName: resolveAgentName(job.agentId, agentNameMap),
    name: job.name,
    message,
    schedule: job.schedule,
    target,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
    kind: job.payload?.kind ?? 'unknown',
    uiManaged,
    deliveryMode: job.delivery?.mode ?? 'none',
    sessionTarget: job.sessionTarget ?? null,
    readOnlyReason: uiManaged ? undefined : 'advanced-openclaw-job',
  };
}

export async function handleCronRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/cron/jobs' && req.method === 'GET') {
    try {
      const result = await ctx.gatewayManager.rpc('cron.list', { includeDisabled: true });
      const data = result as { jobs?: GatewayCronJob[] };
      const jobs = data?.jobs ?? [];
      const agentSnapshot = await listAgentsSnapshot();
      const agentNameMap = new Map(agentSnapshot.agents.map((agent) => [agent.id, agent.name]));
      sendJson(res, 200, jobs.map((job) => transformCronJob(job, agentNameMap)));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'POST') {
    try {
      const input = await parseJsonBody<{ name: string; message: string; schedule: string; enabled?: boolean }>(req);
      const result = await ctx.gatewayManager.rpc('cron.add', {
        name: input.name,
        schedule: { kind: 'cron', expr: input.schedule },
        payload: { kind: 'agentTurn', message: input.message },
        enabled: input.enabled ?? true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        delivery: { mode: 'none' },
      });
      const agentSnapshot = await listAgentsSnapshot();
      const agentNameMap = new Map(agentSnapshot.agents.map((agent) => [agent.id, agent.name]));
      sendJson(
        res,
        200,
        result && typeof result === 'object'
          ? transformCronJob(result as GatewayCronJob, agentNameMap)
          : result,
      );
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'PUT') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      const input = await parseJsonBody<Record<string, unknown>>(req);
      const current = await getCronJobById(ctx, id);
      if (!current) {
        sendJson(res, 404, { success: false, error: 'Cron job not found' });
        return true;
      }
      if (!isEditableUiJob(current)) {
        sendJson(res, 400, {
          success: false,
          error: 'Advanced OpenClaw jobs cannot be edited from this UI',
        });
        return true;
      }
      const patch = { ...input };
      if (typeof patch.schedule === 'string') {
        patch.schedule = { kind: 'cron', expr: patch.schedule };
      }
      if (typeof patch.message === 'string') {
        patch.payload = { kind: 'agentTurn', message: patch.message };
        delete patch.message;
      }
      patch.delivery = {
        mode: isEditableUiJob(current) ? (current.delivery?.mode ?? 'none') : 'none',
      };
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.update', { id, patch }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.remove', { id }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/toggle' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string; enabled: boolean }>(req);
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.update', { id: body.id, patch: { enabled: body.enabled } }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/trigger' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string }>(req);
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.run', { id: body.id, mode: 'force' }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
