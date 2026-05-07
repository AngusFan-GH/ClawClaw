import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChatItems, extractToolCards, normalizeMessage } from '@/pages/Chat/chat-thread-view-model';
import { extractText } from '@/pages/Chat/message-utils';
import { toSanitizedMarkdownHtml } from '@/pages/Chat/markdown';
import { detectTextDirection } from '@/pages/Chat/text-direction';

describe('chat render alignment', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

    const flowItems = items.filter((item) => item.kind !== 'divider');
    expect(flowItems).toHaveLength(2);
    expect(flowItems[0]).toMatchObject({ kind: 'stream', text: 'Checking the file first.' });
    expect(flowItems[1]).toMatchObject({ kind: 'group', role: 'tool' });
  });

  it('interleaves multiple live stream segments with tool cards like OpenClaw dashboard', () => {
    const items = buildChatItems({
      messages: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      toolMessages: [
        {
          role: 'assistant',
          timestamp: 2_000,
          toolCallId: 'tool-1',
          content: [{ type: 'tool_use', name: 'read_file', arguments: { path: 'README.md' } }],
        },
        {
          role: 'assistant',
          timestamp: 3_000,
          toolCallId: 'tool-2',
          content: [{ type: 'tool_use', name: 'write_file', arguments: { path: 'out.md' } }],
        },
      ],
      streamSegments: [
        { text: 'First thought.', ts: 2_000 },
        { text: 'Second thought.', ts: 3_000 },
      ],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const flowItems = items.filter((item) => item.kind !== 'divider');
    expect(flowItems).toHaveLength(4);
    expect(flowItems[0]).toMatchObject({ kind: 'stream', text: 'First thought.' });
    expect(flowItems[1]).toMatchObject({ kind: 'group', role: 'tool' });
    expect(flowItems[2]).toMatchObject({ kind: 'stream', text: 'Second thought.' });
    expect(flowItems[3]).toMatchObject({ kind: 'group', role: 'tool' });
  });

  it('merges tool call and result blocks into one OpenClaw-style tool card', () => {
    const cards = extractToolCards({
      role: 'assistant',
      timestamp: 2_000,
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'README.md' } },
        { type: 'tool_result', id: 'tool-1', name: 'read_file', text: 'file contents' },
      ],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: 'tool:tool-1',
      name: 'read_file',
      inputText: '{\n  "path": "README.md"\n}',
      outputText: 'file contents',
    });
  });

  it('lifts canvas preview from tool output onto nearest assistant message', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'assistant',
          timestamp: 2_000,
          content: 'Here is the chart.',
        },
      ],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      toolMessages: [
        {
          role: 'toolresult',
          timestamp: 2_001,
          toolName: 'canvas',
          content: JSON.stringify({
            kind: 'canvas',
            view: { url: '/__openclaw__/canvas/documents/doc-1/index.html', id: 'doc-1' },
            presentation: { title: 'Chart' },
          }),
        },
      ],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: false,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const assistantGroup = items.find((item) => item.kind === 'group' && item.role === 'assistant');
    expect(assistantGroup).toBeTruthy();
    const content = assistantGroup?.kind === 'group'
      ? assistantGroup.messages[0].message.content
      : null;
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'canvas',
        preview: expect.objectContaining({ kind: 'canvas', viewId: 'doc-1', title: 'Chart' }),
      }),
    ]));
  });

  it('expands assistant MEDIA references into attachments like OpenClaw dashboard', () => {
    const normalized = normalizeMessage({
      role: 'assistant',
      content: 'Audio ready MEDIA:/tmp/answer.mp3',
    });

    expect(normalized.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'Audio ready' }),
      expect.objectContaining({
        type: 'attachment',
        attachment: expect.objectContaining({
          url: '/tmp/answer.mp3',
          kind: 'audio',
          label: 'answer.mp3',
          mimeType: 'audio/mpeg',
        }),
      }),
    ]));
  });

  it('preserves relative assistant MEDIA references as text like OpenClaw dashboard', () => {
    const normalized = normalizeMessage({
      role: 'assistant',
      content: 'Created MEDIA:reports/answer.pdf',
    });

    expect(normalized.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'Created MEDIA:reports/answer.pdf',
      }),
    ]);
  });

  it('renders a live streaming assistant snapshot instead of a blank loading state', () => {
    const items = buildChatItems({
      messages: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      toolMessages: [],
      streamSegments: [],
      streamingMessage: {
        role: 'assistant',
        timestamp: 2_000,
        content: [{ type: 'text', text: '正在查询并下载可蓝矿业资料...' }],
      },
      streamingStartedAt: 2_000,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const flowItems = items.filter((item) => item.kind !== 'divider');
    expect(flowItems).toHaveLength(1);
    expect(flowItems[0]).toMatchObject({
      kind: 'stream',
      text: '正在查询并下载可蓝矿业资料...',
    });
  });

  it('matches OpenClaw dashboard by ignoring non-numeric chat timestamps', () => {
    const now = Date.UTC(2026, 3, 26, 1, 20, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const normalized = normalizeMessage({
      role: 'assistant',
      timestamp: '2026-04-26T01:20:00-04:00',
      content: 'working...',
    });

    expect(normalized.timestamp).toBe(now);
  });

  it('keeps commentary text visible after history reload for tool-use turns', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'assistant',
          timestamp: 2_000,
          content: [
            {
              type: 'text',
              text: 'I will inspect the file first.',
              textSignature: JSON.stringify({ v: 1, phase: 'commentary' }),
            },
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'read',
              arguments: { path: 'README.md' },
            },
          ],
        },
      ],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      toolMessages: [],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const assistantGroup = items.find((item) => item.kind === 'group' && item.role === 'assistant');
    expect(assistantGroup).toBeTruthy();
    const message = assistantGroup && assistantGroup.kind === 'group'
      ? assistantGroup.messages[0].message
      : null;
    expect(message).toMatchObject({ role: 'assistant' });
    expect(extractText(message)).toBe('I will inspect the file first.');
  });

  it('does not show a duplicate loading indicator while live stream content is visible', () => {
    const items = buildChatItems({
      messages: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      toolMessages: [],
      streamSegments: [{ text: 'Streaming answer.', ts: 2_000 }],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    expect(items.some((item) => item.kind === 'reading-indicator')).toBe(false);
    expect(items.some((item) => item.kind === 'stream')).toBe(true);
  });

  it('keeps assistant loading visible after live tool calls like OpenClaw dashboard', () => {
    const items = buildChatItems({
      messages: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      toolMessages: [
        {
          role: 'assistant',
          timestamp: 2_000,
          toolCallId: 'tool-1',
          content: [{ type: 'tool_use', name: 'read_file', arguments: { path: 'README.md' } }],
        },
      ],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const flowItems = items.filter((item) => item.kind !== 'divider');
    expect(flowItems).toHaveLength(2);
    expect(flowItems[0]).toMatchObject({ kind: 'group', role: 'tool' });
    expect(flowItems[1]).toMatchObject({ kind: 'reading-indicator' });
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

    const flowItems = items.filter((item) => item.kind !== 'divider');
    expect(flowItems).toHaveLength(1);
    expect(flowItems[0]).toMatchObject({ kind: 'group', role: 'assistant', hasReadingIndicator: true });
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

  it('does not inject date dividers for live-only items', () => {
    const items = buildChatItems({
      messages: [],
      pendingUserMessage: {
        role: 'user',
        timestamp: 2_000,
        content: 'hello',
      },
      pendingAssistantMessage: null,
      toolMessages: [],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    expect(items.some((item) => item.kind === 'divider')).toBe(false);
    expect(items[0]).toMatchObject({ kind: 'group', role: 'user' });
  });

  it('does not append a duplicate pending user message after history catches up', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'user',
          timestamp: 2_000,
          content: 'hello',
          id: 'history-user-1',
        },
        {
          role: 'assistant',
          timestamp: 2_001,
          content: 'hi',
          id: 'history-assistant-1',
        },
      ],
      pendingUserMessage: {
        role: 'user',
        timestamp: 1_999,
        content: 'hello',
        id: 'pending-user-1',
      },
      pendingAssistantMessage: null,
      toolMessages: [],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: false,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const userGroups = items.filter((item) => item.kind === 'group' && item.role === 'user');
    expect(userGroups).toHaveLength(1);
  });

  it('keeps a newly sent duplicate-text pending user message visible before history can confirm the same send', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'user',
          timestamp: 2_000,
          content: '123',
          id: 'history-user-1',
        },
      ],
      pendingUserMessage: {
        role: 'user',
        timestamp: 2_001,
        content: '123',
        id: 'pending-user-1',
        idempotencyKey: 'send-2',
      },
      pendingAssistantMessage: null,
      toolMessages: [],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const userGroups = items.filter((item) => item.kind === 'group' && item.role === 'user');
    expect(userGroups).toHaveLength(2);
  });

  it('keeps a duplicate-text pending user message visible after sending stops until history confirms the newer send', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'user',
          timestamp: 2_000,
          content: '123',
          id: 'history-user-1',
          idempotencyKey: 'send-1',
        },
      ],
      pendingUserMessage: {
        role: 'user',
        timestamp: 2_030,
        content: '123',
        id: 'pending-user-2',
        idempotencyKey: 'send-2',
      },
      pendingAssistantMessage: null,
      toolMessages: [],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: false,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const userGroups = items.filter((item) => item.kind === 'group' && item.role === 'user');
    expect(userGroups).toHaveLength(2);
  });

  it('hides the pending user message once history includes the same idempotency key', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'user',
          timestamp: 2_000,
          content: '123',
          id: 'history-user-1',
          idempotencyKey: 'send-1',
        },
      ],
      pendingUserMessage: {
        role: 'user',
        timestamp: 1_999,
        content: '123',
        id: 'pending-user-1',
        idempotencyKey: 'send-1',
      },
      pendingAssistantMessage: null,
      toolMessages: [],
      streamSegments: [],
      streamingMessage: null,
      streamingStartedAt: 0,
      sessionKey: 'agent:main',
      sending: true,
      pendingFinal: false,
      showThinking: true,
      locale: 'en',
    });

    const userGroups = items.filter((item) => item.kind === 'group' && item.role === 'user');
    expect(userGroups).toHaveLength(1);
  });
});
