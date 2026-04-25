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

  it('renders only assistant final_answer text from OpenClaw phased blocks', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I will inspect the file.',
          textSignature: JSON.stringify({ v: 1, phase: 'commentary' }),
        },
        {
          type: 'text',
          text: '这是最终回答。',
          textSignature: JSON.stringify({ v: 1, phase: 'final_answer' }),
        },
      ],
    };

    expect(extractText(message)).toBe('这是最终回答。');
  });

  it('renders commentary-only assistant messages before tool calls', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I will inspect the file.',
          textSignature: JSON.stringify({ v: 1, phase: 'commentary' }),
        },
      ],
    };

    expect(extractText(message)).toBe('I will inspect the file.');
  });

  it('renders assistant messages explicitly marked as commentary', () => {
    const message: RawMessage = {
      role: 'assistant',
      phase: 'commentary',
      content: 'Checking context before answering.',
    };

    expect(extractText(message)).toBe('Checking context before answering.');
  });

  it('does not fall back to unphased legacy text when final_answer is empty', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Legacy answer' },
        {
          type: 'text',
          text: '   ',
          textSignature: JSON.stringify({ v: 1, id: 'msg_final', phase: 'final_answer' }),
        },
      ],
    };

    expect(extractText(message)).toBe('');
  });

  it('falls back to unphased legacy assistant text', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Legacy answer' }],
    };

    expect(extractText(message)).toBe('Legacy answer');
  });

  it('does not mix unphased legacy text into final_answer output', () => {
    const message: RawMessage = {
      role: 'assistant',
      phase: 'final_answer',
      content: [
        { type: 'text', text: 'Legacy answer' },
        {
          type: 'text',
          text: 'Actual final answer',
          textSignature: JSON.stringify({ v: 1, id: 'msg_final', phase: 'final_answer' }),
        },
      ],
    };

    expect(extractText(message)).toBe('Actual final answer');
  });
});
