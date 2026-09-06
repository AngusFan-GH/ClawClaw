import { invokeIpc } from './api-client';
import { subscribeHostEvent } from './host-events';

const activeCoreRunIds = new Set<string>();

export type CoreRunEvent = {
  eventId: string;
  runId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: unknown;
};

export type CoreChatInput = {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  message: string;
  idempotencyKey: string;
  providerAccountId?: string;
  systemPrompt?: string;
};

export async function startCoreChat(input: CoreChatInput): Promise<{ run: { id: string }; created: boolean }> {
  const created = await invokeIpc('core:chat:send', input) as { run: { id: string }; created: boolean };
  activeCoreRunIds.add(created.run.id);
  return created;
}

export async function getCoreRunEvents(runId: string, afterSequence?: number): Promise<CoreRunEvent[]> {
  return await invokeIpc('core:run:getEvents', runId, afterSequence) as CoreRunEvent[];
}

export async function getCoreConversationMessages(workspaceId: string, conversationId: string) {
  return await invokeIpc('core:conversation:messages', workspaceId, conversationId) as Array<{
    id: string; role: 'user' | 'assistant' | 'system' | 'tool'; content: string; createdAt: string;
  }>;
}

export async function listCoreConversations(workspaceId: string) {
  return await invokeIpc('core:conversation:list', workspaceId) as Array<{ id: string; updatedAt: string; lastMessagePreview: string }>;
}

export async function deleteCoreConversation(workspaceId: string, conversationId: string): Promise<void> {
  await invokeIpc('core:conversation:delete', workspaceId, conversationId);
}

export function subscribeCoreRun(runId: string, handler: (event: CoreRunEvent) => void): () => void {
  return subscribeHostEvent<CoreRunEvent>('core:run:event', (event) => {
    if (event.runId === runId) {
      if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') activeCoreRunIds.delete(runId);
      handler(event);
    }
  });
}

export function isCoreRun(runId: string | null | undefined): boolean { return Boolean(runId && activeCoreRunIds.has(runId)); }
export async function cancelCoreRun(runId: string, reason?: string): Promise<void> {
  await invokeIpc('core:run:cancel', runId, reason);
  activeCoreRunIds.delete(runId);
}
export async function resolveCoreToolApproval(runId: string, approved: boolean): Promise<void> {
  await invokeIpc('core:run:resolveToolApproval', runId, approved);
}
