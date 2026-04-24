import { describe, expect, it } from 'vitest';
import { extractText } from '@/pages/Chat/message-utils';
import type { RawMessage } from '@/stores/chat';

describe('chat message sanitize', () => {
  it('strips leading system event lines from user-visible text', () => {
    const message: RawMessage = {
      role: 'user',
      content: 'System: [2026-04-17 17:22 GMT+8] Model override not allowed for this agent; reverted to minimax-portal/MiniMax-M2.7.\n\n测试',
    };

    expect(extractText(message)).toBe('测试');
  });

  it('strips leading timestamp prefixes from user-visible text', () => {
    const message: RawMessage = {
      role: 'user',
      content: '[Fri 2026-04-17 17:22 GMT+8] 测试',
    };

    expect(extractText(message)).toBe('测试');
  });

  it('strips timestamps that become leading after system event cleanup', () => {
    const message: RawMessage = {
      role: 'user',
      content: 'System: [2026-04-17 17:22 GMT+8] Model override not allowed for this agent; reverted to minimax-portal/MiniMax-M2.7.\n\n[Fri 2026-04-17 17:22 GMT+8] 测试',
    };

    expect(extractText(message)).toBe('测试');
  });

  it('strips gateway media attachment refs from user-visible text while preserving body', () => {
    const message: RawMessage = {
      role: 'user',
      content: '分析\n[media attached: /Users/angusfan/.openclaw/media/outbound/example.md (text/markdown) | /Users/angusfan/.openclaw/media/outbound/example.md]\n[media attached: /Users/angusfan/.openclaw/media/outbound/example.png (image/png) | /Users/angusfan/.openclaw/media/outbound/example.png]',
    };

    expect(extractText(message)).toBe('分析');
  });
});
