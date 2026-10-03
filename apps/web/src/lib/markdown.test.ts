import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown';
import { buildMentionLookup } from './mentions';

function toDom(html: string) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

function eventHandlerAttributes(container: HTMLElement) {
  return Array.from(container.querySelectorAll('*')).flatMap((element) =>
    element.getAttributeNames().filter((name) => name.toLowerCase().startsWith('on')),
  );
}

describe('renderMarkdown sanitization', () => {
  const payloads = [
    '<script>window.__xss = true</script>',
    '<img src=x onerror="window.__xss = true">',
    '<svg onload="window.__xss = true"></svg>',
    '<iframe src="javascript:window.__xss = true"></iframe>',
    '<a href="javascript:window.__xss = true">click</a>',
    '[click](javascript:window.__xss=true)',
    '**bold <img src=x onerror=alert(1)>**',
    '<details open ontoggle="window.__xss = true">x</details>',
    '`<script>alert(1)</script>`',
    '```\n<script>alert(1)</script>\n```',
  ];

  it.each(payloads)('renders %s inert', (payload) => {
    const html = renderMarkdown(payload);
    const container = toDom(html);

    expect(container.querySelector('script, img, svg, iframe, details, object, embed, style')).toBeNull();
    expect(eventHandlerAttributes(container)).toEqual([]);
    for (const anchor of Array.from(container.querySelectorAll('a'))) {
      expect(anchor.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i);
    }
    expect(html).not.toMatch(/<script/i);
    // Escaped text like `&lt;img onerror=…&gt;` is fine; a live tag with a handler is not.
    expect(html).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
  });

  it('shows raw HTML as literal text instead of markup', () => {
    const container = toDom(renderMarkdown('<script>alert(1)</script> hello'));
    expect(container.textContent).toContain('<script>alert(1)</script> hello');
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('renderMarkdown formatting', () => {
  it('renders bold, italic, inline code and fenced code blocks', () => {
    const container = toDom(renderMarkdown('**bold** _italic_ `code`\n\n```\nconst a = 1;\n```'));
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('p code')?.textContent).toBe('code');
    expect(container.querySelector('pre code')?.textContent).toContain('const a = 1;');
  });

  it('opens links in a new tab with rel="noopener noreferrer"', () => {
    const container = toDom(renderMarkdown('[docs](https://example.com/docs)'));
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders resolved mentions as chips and leaves unknown handles as text', () => {
    const lookup = buildMentionLookup([{ id: 'u1', name: 'Sara Manager' }]);
    const container = toDom(renderMarkdown('Hi @sara-manager and @nobody, mail me at me@sara-manager.dev', lookup));
    const chips = container.querySelectorAll('.mention-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe('@sara-manager');
    expect(chips[0].getAttribute('data-mention')).toBe('sara-manager');
    expect(container.textContent).toContain('@nobody');
  });

  it('does not turn mentions inside code into chips', () => {
    const lookup = buildMentionLookup([{ id: 'u1', name: 'Sara Manager' }]);
    const container = toDom(renderMarkdown('`@sara-manager`', lookup));
    expect(container.querySelector('.mention-chip')).toBeNull();
  });
});
