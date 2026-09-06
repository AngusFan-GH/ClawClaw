import { create } from 'zustand';
import { api } from '../lib/api';
import { onEvent } from '../lib/ipc';
import { newId } from '../lib/id';
import type { ConversationSummary, Message, RunEvent, ToolInvocation } from '../lib/types';

interface ActiveRun {
  id: string;
  status: string;
  streaming: string;
  reasoning: string;
  pending: ToolInvocation[];
  error?: string;
}

interface ChatState {
  ready: boolean;
  conversations: ConversationSummary[];
  currentId: string | null;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  active: ActiveRun | null;

  init(): Promise<void>;
  refreshConversations(): Promise<void>;
  select(id: string): Promise<void>;
  newChat(): void;
  loadOlder(): Promise<void>;
  send(text: string, attachments?: string[]): Promise<void>;
  stop(): Promise<void>;
  approve(toolCallId: string): Promise<void>;
  deny(toolCallId: string, reason?: string): Promise<void>;
  removeConversation(id: string): Promise<void>;
}

let subscribed = false;

export const useChat = create<ChatState>((set, get) => {
  const applyEvent = async (event: RunEvent) => {
    const state = get();
    const active = state.active;
    if (!active || event.runId !== active.id) return;

    switch (event.type) {
      case 'message.delta': {
        const text = (event.payload as { text?: string }).text ?? '';
        set({ active: { ...active, streaming: active.streaming + text } });
        break;
      }
      case 'reasoning.delta': {
        const text = (event.payload as { text?: string }).text ?? '';
        set({ active: { ...active, reasoning: active.reasoning + text } });
        break;
      }
      case 'tool.requested':
      case 'approval.required':
      case 'tool.approved':
      case 'tool.denied':
      case 'tool.started':
      case 'tool.completed':
      case 'tool.failed': {
        const pending = await api.invocations(active.id).catch(() => []);
        set({ active: { ...active, pending: pending.filter((p) => p.status === 'requested') } });
        break;
      }
      case 'run.status': {
        const status = (event.payload as { to?: string }).to;
        if (status) set({ active: { ...active, status } });
        break;
      }
      case 'run.completed':
      case 'run.failed':
      case 'run.cancelled': {
        const failed = event.type === 'run.failed' ? (event.payload as { message?: string }).message : undefined;
        set({ active: null });
        if (state.currentId) await get().select(state.currentId);
        await get().refreshConversations();
        if (failed) set({ active: null });
        break;
      }
      default:
        break;
    }
  };

  const subscribe = () => {
    if (subscribed) return;
    subscribed = true;
    onEvent('core:run:event', (...args) => {
      void applyEvent(args[0] as RunEvent);
    });
  };

  return {
    ready: false,
    conversations: [],
    currentId: null,
    messages: [],
    hasMore: false,
    loading: false,
    active: null,

    async init() {
      subscribe();
      await get().refreshConversations();
      set({ ready: true });
    },

    async refreshConversations() {
      const conversations = await api.conversations();
      set({ conversations });
    },

    newChat() {
      set({ currentId: null, messages: [], hasMore: false, active: null });
    },

    async select(id) {
      set({ loading: true, currentId: id });
      const page = await api.conversationPage(id, { limit: 50 });
      set({ messages: page.messages, hasMore: page.hasMore, loading: false, active: null });
    },

    async loadOlder() {
      const { currentId, messages, hasMore } = get();
      if (!currentId || !hasMore || !messages.length) return;
      const beforeSeq = messages[0].seq;
      const page = await api.conversationPage(currentId, { beforeSeq, limit: 50 });
      set({ messages: [...page.messages, ...messages], hasMore: page.hasMore });
    },

    async send(text, attachments) {
      const trimmed = text.trim();
      if (!trimmed || get().active) return;
      const conversationId = get().currentId ?? newId();
      const optimistic: Message = {
        id: newId(), workspaceId: 'default', conversationId, seq: Number.MAX_SAFE_INTEGER,
        role: 'user', content: trimmed, createdAt: new Date().toISOString(), artifactIds: attachments,
      };
      set((s) => ({
        currentId: conversationId,
        messages: [...s.messages, optimistic],
        active: { id: '', status: 'queued', streaming: '', reasoning: '', pending: [] },
      }));

      try {
        const result = await api.send({
          workspaceId: 'default',
          conversationId,
          message: trimmed,
          idempotencyKey: newId(),
          attachments: attachments ?? [],
        });
        set({ active: { id: result.run.id, status: result.run.status, streaming: '', reasoning: '', pending: [] } });
        await get().refreshConversations();
      } catch (error) {
        set({
          active: null,
          messages: get().messages.filter((m) => m.id !== optimistic.id),
        });
        throw error;
      }
    },

    async stop() {
      const active = get().active;
      if (active?.id) await api.cancelRun(active.id).catch(() => undefined);
    },

    async approve(toolCallId) {
      const active = get().active;
      if (!active) return;
      await api.resolveApproval(active.id, toolCallId, true);
    },

    async deny(toolCallId, reason) {
      const active = get().active;
      if (!active) return;
      await api.resolveApproval(active.id, toolCallId, false, reason);
    },

    async removeConversation(id) {
      await api.deleteConversation(id);
      if (get().currentId === id) get().newChat();
      await get().refreshConversations();
    },
  };
});
