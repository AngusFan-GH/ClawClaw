import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { toOpenClawChannelType, toUiChannelType } from '../../utils/channel-alias';
import { getOpenClawConfigDir } from '../../utils/paths';
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
  delivery?: { mode: string; channel?: string; to?: string; accountId?: string };
  sessionTarget?: string;
  state: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDeliveryError?: string;
    lastDurationMs?: number;
  };
}

interface GatewayCronDelivery {
  mode: string;
  channel?: string;
  to?: string;
  accountId?: string;
}

interface CronRunLogEntry {
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
}

interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
}

interface CronSessionFallbackMessage {
  id: string;
  role: 'assistant' | 'system';
  content: string;
  timestamp: number;
  isError?: boolean;
}

function isUiManagedAgentTurn(job: GatewayCronJob): boolean {
  return (
    (job.sessionTarget === 'isolated' || !job.sessionTarget)
    && job.payload?.kind === 'agentTurn'
    && ['none', 'announce'].includes(job.delivery?.mode ?? 'none')
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

function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[2] !== 'cron') return null;

  const agentId = parts[1] || 'main';
  const jobId = parts[3];
  if (!jobId) return null;

  if (parts.length === 4) {
    return { agentId, jobId };
  }

  if (parts.length === 6 && parts[4] === 'run' && parts[5]) {
    return { agentId, jobId, runSessionId: parts[5] };
  }

  return null;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function buildCronRunMessage(entry: CronRunLogEntry, index: number): CronSessionFallbackMessage | null {
  const timestamp = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
  if (!timestamp) return null;

  const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
  const error = typeof entry.error === 'string' ? entry.error.trim() : '';
  let content = summary || error;

  if (!content) {
    content = status === 'error'
      ? 'Scheduled task failed.'
      : 'Scheduled task completed.';
  }

  if (status === 'error' && !content.toLowerCase().startsWith('run failed:')) {
    content = `Run failed: ${content}`;
  }

  const meta: string[] = [];
  const duration = formatDuration(entry.durationMs);
  if (duration) meta.push(`Duration: ${duration}`);
  if (entry.provider && entry.model) {
    meta.push(`Model: ${entry.provider}/${entry.model}`);
  } else if (entry.model) {
    meta.push(`Model: ${entry.model}`);
  }
  if (meta.length > 0) {
    content = `${content}\n\n${meta.join(' | ')}`;
  }

  return {
    id: `cron-run-${entry.sessionId ?? entry.ts ?? index}`,
    role: status === 'error' ? 'system' : 'assistant',
    content,
    timestamp,
    ...(status === 'error' ? { isError: true } : {}),
  };
}

async function readCronRunLog(jobId: string): Promise<CronRunLogEntry[]> {
  const logPath = join(getOpenClawConfigDir(), 'cron', 'runs', `${jobId}.jsonl`);
  const raw = await readFile(logPath, 'utf8').catch(() => '');
  if (!raw.trim()) return [];

  const entries: CronRunLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CronRunLogEntry;
      if (!entry || entry.jobId !== jobId) continue;
      if (entry.action && entry.action !== 'finished') continue;
      entries.push(entry);
    } catch {
      // Ignore malformed log lines.
    }
  }
  return entries;
}

async function readSessionStoreEntry(
  agentId: string,
  sessionKey: string,
): Promise<Record<string, unknown> | undefined> {
  const storePath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const raw = await readFile(storePath, 'utf8').catch(() => '');
  if (!raw.trim()) return undefined;

  try {
    const store = JSON.parse(raw) as Record<string, unknown>;
    const directEntry = store[sessionKey];
    if (directEntry && typeof directEntry === 'object') {
      return directEntry as Record<string, unknown>;
    }

    const sessions = (store as { sessions?: unknown }).sessions;
    if (Array.isArray(sessions)) {
      const arrayEntry = sessions.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as Record<string, unknown>;
        return record.key === sessionKey || record.sessionKey === sessionKey;
      });
      if (arrayEntry && typeof arrayEntry === 'object') {
        return arrayEntry as Record<string, unknown>;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildCronSessionFallbackMessages(params: {
  sessionKey: string;
  job?: Pick<GatewayCronJob, 'name' | 'payload' | 'state'>;
  runs: CronRunLogEntry[];
  sessionEntry?: { label?: string; updatedAt?: number };
  limit?: number;
}): CronSessionFallbackMessage[] {
  const parsed = parseCronSessionKey(params.sessionKey);
  if (!parsed) return [];

  const matchingRuns = params.runs
    .filter((entry) => {
      if (!parsed.runSessionId) return true;
      return entry.sessionId === parsed.runSessionId
        || entry.sessionKey === `${params.sessionKey}`;
    })
    .sort((a, b) => {
      const left = normalizeTimestampMs(a.ts) ?? normalizeTimestampMs(a.runAtMs) ?? 0;
      const right = normalizeTimestampMs(b.ts) ?? normalizeTimestampMs(b.runAtMs) ?? 0;
      return left - right;
    });

  const messages: CronSessionFallbackMessage[] = [];
  const prompt = params.job?.payload?.message || params.job?.payload?.text || '';
  const taskName = params.job?.name?.trim()
    || params.sessionEntry?.label?.replace(/^Cron:\s*/, '').trim()
    || '';
  const firstRelevantTimestamp = matchingRuns.length > 0
    ? (normalizeTimestampMs(matchingRuns[0]?.runAtMs) ?? normalizeTimestampMs(matchingRuns[0]?.ts))
    : (normalizeTimestampMs(params.job?.state?.runningAtMs) ?? params.sessionEntry?.updatedAt);

  if (taskName || prompt) {
    const lines = [taskName ? `Scheduled task: ${taskName}` : 'Scheduled task'];
    if (prompt) lines.push(`Prompt: ${prompt}`);
    messages.push({
      id: `cron-meta-${parsed.jobId}`,
      role: 'system',
      content: lines.join('\n'),
      timestamp: Math.max(0, (firstRelevantTimestamp ?? Date.now()) - 1),
    });
  }

  matchingRuns.forEach((entry, index) => {
    const message = buildCronRunMessage(entry, index);
    if (message) messages.push(message);
  });

  if (matchingRuns.length === 0) {
    const runningAt = normalizeTimestampMs(params.job?.state?.runningAtMs);
    if (runningAt) {
      messages.push({
        id: `cron-running-${parsed.jobId}`,
        role: 'system',
        content: 'This scheduled task is still running in OpenClaw, but no chat transcript is available yet.',
        timestamp: runningAt,
      });
    } else if (messages.length === 0) {
      messages.push({
        id: `cron-empty-${parsed.jobId}`,
        role: 'system',
        content: 'No chat transcript is available for this scheduled task yet.',
        timestamp: params.sessionEntry?.updatedAt ?? Date.now(),
      });
    }
  }

  const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit))
    : messages.length;
  return messages.slice(-limit);
}

async function getCronJobById(ctx: HostApiContext, id: string): Promise<GatewayCronJob | undefined> {
  const jobs = await listCronJobs(ctx);
  return jobs.find((job) => job.id === id);
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
  const gatewayDelivery = normalizeCronDelivery(job.delivery);
  const channelType = gatewayDelivery.channel ? toUiChannelType(gatewayDelivery.channel) : undefined;
  const delivery = channelType
    ? { ...gatewayDelivery, channel: channelType }
    : gatewayDelivery;
  const target = channelType
    ? {
        channelType,
        channelId: delivery.accountId || gatewayDelivery.channel || channelType,
        channelName: getDisplayChannelName(channelType),
        ...(delivery.to ? { recipient: delivery.to } : {}),
      }
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
    delivery,
    sessionTarget: job.sessionTarget ?? null,
    readOnlyReason: uiManaged ? undefined : 'advanced-openclaw-job',
  };
}

async function listCronJobs(ctx: HostApiContext): Promise<GatewayCronJob[]> {
  try {
    const result = await ctx.gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000);
    const data = result as { jobs?: GatewayCronJob[] };
    return data?.jobs ?? (Array.isArray(result) ? result as GatewayCronJob[] : []);
  } catch {
    const cronJsonPath = join(getOpenClawConfigDir(), 'cron', 'cron.json');
    const raw = await readFile(cronJsonPath, 'utf-8').catch(() => '');
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw) as GatewayCronJob[] | { jobs?: GatewayCronJob[] };
    return Array.isArray(parsed) ? parsed : (parsed.jobs ?? []);
  }
}

function buildCronUpdatePatch(input: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...input };
  if (typeof patch.schedule === 'string') {
    patch.schedule = { kind: 'cron', expr: patch.schedule };
  }
  if (typeof patch.message === 'string') {
    patch.payload = { kind: 'agentTurn', message: patch.message };
    delete patch.message;
  }
  if (typeof patch.agentId === 'string') {
    const normalizedAgentId = patch.agentId.trim();
    patch.agentId = normalizedAgentId || 'main';
  }
  if ('delivery' in patch) {
    patch.delivery = normalizeCronDelivery(patch.delivery);
  }
  return patch;
}

function normalizeCronDelivery(input: unknown): GatewayCronDelivery {
  if (!input || typeof input !== 'object') {
    return { mode: 'none' };
  }

  const delivery = input as Record<string, unknown>;
  const mode = typeof delivery.mode === 'string' && delivery.mode.trim() === 'announce'
    ? 'announce'
    : 'none';

  if (mode === 'none') {
    return { mode: 'none' };
  }

  const channel = typeof delivery.channel === 'string' ? delivery.channel.trim() : '';
  const to = typeof delivery.to === 'string' ? delivery.to.trim() : '';
  const accountId = typeof delivery.accountId === 'string' ? delivery.accountId.trim() : '';

  return {
    mode: 'announce',
    ...(channel ? { channel: toOpenClawChannelType(channel) } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function getDisplayChannelName(channelType: string): string {
  return toUiChannelType(channelType);
}

export async function handleCronRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/cron/session-history' && req.method === 'GET') {
    const sessionKey = url.searchParams.get('sessionKey')?.trim() || '';
    const parsedSession = parseCronSessionKey(sessionKey);
    if (!parsedSession) {
      sendJson(res, 400, { success: false, error: `Invalid cron sessionKey: ${sessionKey}` });
      return true;
    }

    const rawLimit = Number(url.searchParams.get('limit') || '200');
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
      : 200;

    try {
      const [jobs, runs, sessionEntry] = await Promise.all([
        listCronJobs(ctx).catch(() => [] as GatewayCronJob[]),
        readCronRunLog(parsedSession.jobId),
        readSessionStoreEntry(parsedSession.agentId, sessionKey),
      ]);

      const job = jobs.find((item) => item.id === parsedSession.jobId);
      const messages = buildCronSessionFallbackMessages({
        sessionKey,
        job,
        runs,
        sessionEntry: sessionEntry ? {
          label: typeof sessionEntry.label === 'string' ? sessionEntry.label : undefined,
          updatedAt: normalizeTimestampMs(sessionEntry.updatedAt),
        } : undefined,
        limit,
      });

      sendJson(res, 200, { messages });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'GET') {
    try {
      const jobs = await listCronJobs(ctx);
      const jobsToRepairDelivery = jobs.filter((job) => (
        isUiManagedAgentTurn(job)
        && job.delivery?.mode === 'announce'
        && !job.delivery?.channel
      ));
      if (jobsToRepairDelivery.length > 0) {
        void (async () => {
          for (const job of jobsToRepairDelivery) {
            try {
              await ctx.gatewayManager.rpc('cron.update', {
                id: job.id,
                patch: { delivery: { mode: 'none' } },
              });
            } catch {
              // ignore per-job repair failure
            }
          }
        })();
        for (const job of jobsToRepairDelivery) {
          job.delivery = { mode: 'none' };
          clearChannelRequiredError(job);
        }
      }
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
      const input = await parseJsonBody<{
        name: string;
        message: string;
        schedule: string;
        enabled?: boolean;
        agentId?: string;
        delivery?: GatewayCronDelivery;
        sessionTarget?: string;
      }>(req);
      const agentId = typeof input.agentId === 'string' && input.agentId.trim()
        ? input.agentId.trim()
        : 'main';
      const delivery = normalizeCronDelivery(input.delivery);
      const sessionTarget = typeof input.sessionTarget === 'string' ? input.sessionTarget.trim() : '';
      const result = await ctx.gatewayManager.rpc('cron.add', {
        name: input.name,
        schedule: { kind: 'cron', expr: input.schedule },
        payload: { kind: 'agentTurn', message: input.message },
        enabled: input.enabled ?? true,
        wakeMode: 'next-heartbeat',
        sessionTarget: sessionTarget || 'isolated',
        agentId,
        delivery,
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
      const requestedKeys = Object.keys(input);
      const deliveryRepairOnly = requestedKeys.length > 0 && requestedKeys.every(
        (key) => key === 'delivery' || key === 'sessionTarget',
      );
      if (!isEditableUiJob(current) && !deliveryRepairOnly) {
        sendJson(res, 400, {
          success: false,
          error: 'Advanced OpenClaw jobs cannot be edited from this UI',
        });
        return true;
      }
      const patch = buildCronUpdatePatch(input);
      const hasDelivery = Object.prototype.hasOwnProperty.call(patch, 'delivery');
      const hasSessionTarget = Object.prototype.hasOwnProperty.call(patch, 'sessionTarget');
      if (!hasDelivery && isEditableUiJob(current)) {
        patch.delivery = {
          mode: current.delivery?.mode ?? 'none',
        };
      }
      if (hasSessionTarget) {
        const nextSessionTarget = typeof patch.sessionTarget === 'string' ? patch.sessionTarget.trim() : '';
        patch.sessionTarget = nextSessionTarget || 'isolated';
      }
      const result = await ctx.gatewayManager.rpc('cron.update', { id, patch });
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
      const result = await ctx.gatewayManager.rpc('cron.update', { id: body.id, patch: { enabled: body.enabled } });
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
