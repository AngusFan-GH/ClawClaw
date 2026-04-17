import type { IncomingMessage, ServerResponse } from 'http';
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  updateAgentSettings,
} from '../../utils/agent-config';
import { getAgentsConfigSnapshot } from '../../services/config-snapshot';
import { toRuntimeChannelType } from '../../utils/channel-alias';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  ctx.gatewayApplyCoordinator.enqueue({
    source: reason,
    reason,
    requires: 'reload',
    delayMs: 1500,
    skipIfStopped: true,
  });
}

function scheduleGatewayRestart(ctx: HostApiContext, reason: string): void {
  ctx.gatewayApplyCoordinator.enqueue({
    source: reason,
    reason,
    requires: 'restart',
    delayMs: 1500,
    skipIfStopped: true,
  });
}

function normalizeComparableString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeComparableAgentId(value: string | null | undefined): string {
  return normalizeComparableString(value).toLowerCase();
}

export async function handleAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await getAgentsConfigSnapshot()) });
    return true;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ name: string }>(req);
      const snapshot = await createAgent(body.name);
      scheduleGatewayRestart(ctx, 'create-agent');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const body = await parseJsonBody<{ name?: string; model?: string | null }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshotBeforeUpdate = await getAgentsConfigSnapshot();
        const existingAgent = snapshotBeforeUpdate.agents.find((agent) => agent.id === agentId);
        if (!existingAgent) {
          throw new Error(`Agent "${agentId}" not found`);
        }

        const nextName = Object.prototype.hasOwnProperty.call(body, 'name')
          ? normalizeComparableString(body.name)
          : normalizeComparableString(existingAgent.name);
        const nextModel = Object.prototype.hasOwnProperty.call(body, 'model')
          ? normalizeComparableString(body.model)
          : normalizeComparableString(existingAgent.modelRef);

        if (
          nextName === normalizeComparableString(existingAgent.name)
          && nextModel === normalizeComparableString(existingAgent.modelRef)
        ) {
          sendJson(res, 200, { success: true, noChange: true, ...snapshotBeforeUpdate });
          return true;
        }

        const snapshot = await updateAgentSettings(agentId, body);
        scheduleGatewayRestart(ctx, 'update-agent');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const accountId = url.searchParams.get('accountId') || undefined;
        const runtimeChannelType = toRuntimeChannelType(channelType);
        const snapshotBeforeUpdate = await getAgentsConfigSnapshot();
        const existingOwner = accountId
          ? snapshotBeforeUpdate.channelAccountOwners[`${runtimeChannelType}:${accountId.trim() || 'default'}`]
          : snapshotBeforeUpdate.channelOwners[runtimeChannelType];

        if (normalizeComparableAgentId(existingOwner) === normalizeComparableAgentId(agentId)) {
          sendJson(res, 200, { success: true, noChange: true, ...snapshotBeforeUpdate });
          return true;
        }

        const snapshot = await assignChannelToAgent(agentId, channelType, accountId);
        scheduleGatewayRestart(ctx, 'assign-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await deleteAgentConfig(agentId);
        // Deleting an agent still rewrites the shared OpenClaw config through the
        // generic config writer. In current ClawClaw that can surface unrelated
        // gateway.* diffs (for example tailscale) that OpenClaw refuses to hot-reload.
        // Use a normal restart here instead of a reload to avoid 503 apply failures,
        // while still coalescing with other pending changes.
        scheduleGatewayRestart(ctx, 'delete-agent');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const accountId = url.searchParams.get('accountId') || undefined;
        const runtimeChannelType = toRuntimeChannelType(channelType);
        const snapshotBeforeUpdate = await listAgentsSnapshot();
        const existingOwner = accountId
          ? snapshotBeforeUpdate.channelAccountOwners[`${runtimeChannelType}:${accountId.trim() || 'default'}`]
          : snapshotBeforeUpdate.channelOwners[runtimeChannelType];

        if (!existingOwner) {
          sendJson(res, 200, { success: true, noChange: true, ...snapshotBeforeUpdate });
          return true;
        }

        const snapshot = await clearChannelBinding(channelType, agentId, accountId);
        scheduleGatewayRestart(ctx, 'remove-agent-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  return false;
}
