import type { Prisma } from '@prisma/client';

export function extractMentionHandles(body: string) {
  const visibleText = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
  const handles = new Set<string>();
  const mentionPattern = /(?:^|[\s([{])@([A-Za-z0-9][A-Za-z0-9._-]*)\b/g;
  for (const match of visibleText.matchAll(mentionPattern)) {
    handles.add(match[1].toLowerCase());
  }
  return [...handles];
}

function nameSlug(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function resolveMentionedUsers(
  tx: Pick<Prisma.TransactionClient, 'user'>,
  body: string,
) {
  const handles = extractMentionHandles(body);
  if (!handles.length) return [];
  const users = await tx.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true },
  });
  return users.filter((user) => {
    const localPart = user.email.slice(0, user.email.indexOf('@')).toLowerCase();
    return handles.includes(localPart) || handles.includes(nameSlug(user.name));
  });
}
