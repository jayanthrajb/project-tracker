import type { MentionableUser } from '../types';

// Must stay in sync with apps/api/src/lib/mentions.ts: the API resolves `@handle`
// against the email local-part or this normalized name slug.
export function nameSlug(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function mentionHandle(user: Pick<MentionableUser, 'name' | 'email'>) {
  const slug = nameSlug(user.name);
  if (slug) return slug;
  const localPart = user.email ? user.email.slice(0, user.email.indexOf('@')).toLowerCase() : '';
  return HANDLE_PATTERN.test(localPart) ? localPart : '';
}

export function mentionToken(user: Pick<MentionableUser, 'name' | 'email'>) {
  const handle = mentionHandle(user);
  return handle ? `@${handle}` : '';
}

export interface MentionQuery {
  start: number;
  query: string;
}

// Mirrors the API's trigger rule: `@` must be at the start or follow whitespace/([{.
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s([{])@([A-Za-z0-9._-]*)$/.exec(before);
  if (!match) return null;
  return { start: caret - match[1].length - 1, query: match[1] };
}

export function filterMentionCandidates(
  users: MentionableUser[],
  query: string,
  preferredIds: ReadonlySet<string>,
  limit = 8,
) {
  const needle = query.toLowerCase();
  return users
    .filter((user) => user.isActive !== false && mentionHandle(user))
    .filter((user) => !needle || mentionHandle(user).includes(needle) || user.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const preferred = Number(preferredIds.has(b.id)) - Number(preferredIds.has(a.id));
      return preferred || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function insertMention(text: string, mention: MentionQuery, user: MentionableUser, caret: number) {
  const token = `${mentionToken(user)} `;
  const nextText = text.slice(0, mention.start) + token + text.slice(caret);
  return { text: nextText, caret: mention.start + token.length };
}

export function buildMentionLookup(users: MentionableUser[]) {
  const lookup = new Map<string, MentionableUser>();
  for (const user of users) {
    if (user.isActive === false) continue;
    const slug = nameSlug(user.name);
    if (slug) lookup.set(slug, user);
    if (user.email) {
      const localPart = user.email.slice(0, user.email.indexOf('@')).toLowerCase();
      if (localPart) lookup.set(localPart, user);
    }
  }
  return lookup;
}
