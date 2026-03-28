import { describe, expect, it } from 'vitest';
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
});
