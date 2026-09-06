// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '@/pages/Chat/markdown';

describe('renderMarkdown', () => {
  it('escapes raw HTML to prevent injection', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('never turns text into an anchor href', () => {
    const html = renderMarkdown('[x](javascript:alert(1))');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href=');
  });

  it('applies a small whitelist of inline formatting', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('`code`')).toContain('<code');
  });
});
