import { describe, expect, it } from 'vitest';
import { buildChatItems } from '@/pages/Chat/ChatThread';
import { toSanitizedMarkdownHtml } from '@/pages/Chat/markdown';
import { detectTextDirection } from '@/pages/Chat/text-direction';

describe('chat render alignment', () => {
  it('detects rtl text direction like OpenClaw dashboard', () => {
    expect(detectTextDirection('**שלום')).toBe('rtl');
    expect(detectTextDirection('- hello')).toBe('ltr');
  });

  it('falls back to plain text html for oversized markdown bodies', () => {
    const input = `Hello\n\n${'a'.repeat(40_100)}`;
    const html = toSanitizedMarkdownHtml(input);
    expect(html).toContain('markdown-plain-text-fallback');
    expect(html).toContain('Hello');
  });

  it('flattens remote markdown images into plain text labels', () => {
    const html = toSanitizedMarkdownHtml('![Leak](https://example.com/image.png)');
    expect(html).toContain('Leak');
    expect(html).not.toContain('<img');
  });

  it('renders inline data images as markdown-inline-image', () => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////GQAJ+wP/2hN8NwAAAABJRU5ErkJggg==';
    const html = toSanitizedMarkdownHtml(`![Pixel](data:image/png;base64,${base64})`);
    expect(html).toContain('class="markdown-inline-image"');
  });

  it('orders live stream text before tool cards when timestamps overlap', () => {
    const items = buildChatItems({
      messages: [],
      toolMessages: [
        {
          role: 'assistant',
          timestamp: 2_000,
          toolCallId: 'tool-1',
          content: [{ type: 'tool_use', name: 'read_file', arguments: { path: 'README.md' } }],
        },
      ],
      streamSegments: [
        { text: 'Checking the file first.', ts: 2_000 },
      ],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'stream', text: 'Checking the file first.' });
    expect(items[1]).toMatchObject({ kind: 'group', role: 'tool' });
  });

  it('merges pending assistant loading into a single assistant group', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'assistant',
          timestamp: 2_000,
          model: 'minimax/MiniMax-M2.7',
          content: [],
        },
      ],
      toolMessages: [],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: true,
      showThinking: true,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'group', role: 'assistant', hasReadingIndicator: true });
  });

  it('shows assistant loading immediately after send before any stream events arrive', () => {
    const items = buildChatItems({
      messages: [],
      toolMessages: [],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'reading-indicator' });
  });
});
