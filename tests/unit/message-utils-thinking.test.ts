import { describe, expect, it } from 'vitest';
import { extractThinking } from '@/pages/Chat/message-utils';
import { hasVisibleMessageContent } from '@/pages/Chat/chat-thread-view-model';
import type { RawMessage } from '@/stores/chat';

describe('thinking extraction and visibility', () => {
  it('extracts reasoning from antml thinking tags', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '<antml:thinking>step one\nstep two</antml:thinking><final>done</final>',
      timestamp: Date.now(),
    };
    expect(extractThinking(message)).toBe('step one\nstep two');
  });

  it('keeps tool result cards visible even when reasoning display is off', () => {
    const message: RawMessage = {
      role: 'toolResult',
      toolCallId: 'call-1',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: 'done',
        } as unknown as RawMessage['content'][number],
      ] as RawMessage['content'],
      timestamp: Date.now(),
    };
    expect(hasVisibleMessageContent(message, false)).toBe(true);
  });
});
