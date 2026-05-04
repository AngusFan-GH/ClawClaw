import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';

export async function handleRuntimeApplyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/runtime/apply-plan' && req.method === 'GET') {
    sendJson(res, 200, { success: true, plan: ctx.runtimeApplyPlan.snapshot() });
    return true;
  }

  if (url.pathname === '/api/runtime/apply' && req.method === 'POST') {
    try {
      const result = await ctx.runtimeApplyPlan.apply();
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error), plan: ctx.runtimeApplyPlan.snapshot() });
    }
    return true;
  }

  if (url.pathname === '/api/runtime/apply-plan' && req.method === 'DELETE') {
    sendJson(res, 200, { success: true, plan: ctx.runtimeApplyPlan.discard() });
    return true;
  }

  return false;
}
