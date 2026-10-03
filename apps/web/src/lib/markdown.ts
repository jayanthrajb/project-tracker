import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import type { TokenizerAndRendererExtension, Tokens } from 'marked';

import type { MentionableUser } from '../types';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'a', 'span', 'ul', 'ol', 'li', 'blockquote'];
const ALLOWED_ATTR = ['href', 'title', 'class', 'data-mention'];

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface MentionToken extends Tokens.Generic {
  type: 'mention';
  raw: string;
  handle: string;
  user: MentionableUser;
}

function mentionExtension(lookup: ReadonlyMap<string, MentionableUser>): TokenizerAndRendererExtension {
  return {
    name: 'mention',
    level: 'inline',
    // Same trigger rule as the API parser: `@` at the start or after whitespace/([{.
    start(src) {
      const match = /(?:^|[\s([{])@[A-Za-z0-9]/.exec(src);
      if (!match) return undefined;
      return match.index + match[0].indexOf('@');
    },
    tokenizer(src) {
      const match = /^@([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(src);
      if (!match) return undefined;
      const handle = match[1].replace(/[._-]+$/, '');
      const user = lookup.get(handle.toLowerCase());
      if (!user) return undefined;
      const token: MentionToken = { type: 'mention', raw: `@${handle}`, handle, user };
      return token;
    },
    renderer(token) {
      const { handle, user } = token as MentionToken;
      return `<span class="mention-chip" data-mention="${escapeHtml(handle.toLowerCase())}" title="${escapeHtml(user.name)}">@${escapeHtml(handle)}</span>`;
    },
  };
}

export function renderMarkdown(body: string, lookup: ReadonlyMap<string, MentionableUser> = new Map()) {
  const marked = new Marked({ gfm: true, breaks: true, async: false });
  marked.use({
    extensions: [mentionExtension(lookup)],
    renderer: {
      // Never pass raw HTML through; show it as literal text instead.
      html(token) {
        return escapeHtml(token.text);
      },
    },
  });
  const html = marked.parse(body) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
