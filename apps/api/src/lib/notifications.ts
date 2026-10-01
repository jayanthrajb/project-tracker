import { ItemStatus, NotificationType } from '@prisma/client';
import type { Item, Prisma } from '@prisma/client';

import { prisma } from './prisma.js';

type NotificationTx = Pick<Prisma.TransactionClient, 'notification'>;

export async function dispatchNotification(
  tx: NotificationTx,
  input: {
    userId: string;
    actorId?: string;
    itemId?: string | null;
    type: NotificationType;
    title: string;
    body: string;
    dedupeKey?: string | null;
  },
) {
  if (input.actorId && input.actorId === input.userId) return;
  await tx.notification.create({
    data: {
      userId: input.userId,
      itemId: input.itemId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      dedupeKey: input.dedupeKey ?? null,
    },
  });
  // TODO: email channel plugs in here
}

export async function notifyItemChanges(
  tx: NotificationTx,
  input: { actorId: string; before: Item; after: Item },
) {
  if (input.before.assigneeId !== input.after.assigneeId && input.after.assigneeId) {
    await dispatchNotification(tx, {
      userId: input.after.assigneeId,
      actorId: input.actorId,
      itemId: input.after.id,
      type: NotificationType.ASSIGNED,
      title: 'Item assigned to you',
      body: input.after.title,
    });
  }
  if (input.before.status !== input.after.status && input.after.assigneeId) {
    await dispatchNotification(tx, {
      userId: input.after.assigneeId,
      actorId: input.actorId,
      itemId: input.after.id,
      type: NotificationType.STATUS_CHANGED,
      title: 'Assigned item status changed',
      body: `${input.after.title}: ${input.before.status} → ${input.after.status}`,
    });
  }
  if (input.before.status !== ItemStatus.BLOCKED && input.after.status === ItemStatus.BLOCKED) {
    await dispatchNotification(tx, {
      userId: input.after.reporterId,
      actorId: input.actorId,
      itemId: input.after.id,
      type: NotificationType.BLOCKED,
      title: 'Reported item is blocked',
      body: input.after.title,
    });
  }
}

export async function notifyItemCreated(
  tx: NotificationTx,
  input: { actorId: string; item: Pick<Item, 'id' | 'title' | 'assigneeId' | 'reporterId'> },
) {
  if (!input.item.assigneeId) return;
  await dispatchNotification(tx, {
    userId: input.item.assigneeId,
    actorId: input.actorId,
    itemId: input.item.id,
    type: NotificationType.ASSIGNED,
    title: 'Item assigned to you',
    body: input.item.title,
  });
}

export async function notifyCommentAdded(
  tx: NotificationTx,
  input: { actorId: string; item: Pick<Item, 'id' | 'title' | 'assigneeId' | 'reporterId'> },
) {
  for (const userId of new Set([input.item.assigneeId, input.item.reporterId].filter((id): id is string => Boolean(id)))) {
    await dispatchNotification(tx, {
      userId,
      actorId: input.actorId,
      itemId: input.item.id,
      type: NotificationType.COMMENT,
      title: 'New comment on an item',
      body: input.item.title,
    });
  }
}

export async function notifyMention(
  tx: NotificationTx,
  input: { actorId: string; userId: string; itemId: string; itemTitle: string },
) {
  await dispatchNotification(tx, {
    userId: input.userId,
    actorId: input.actorId,
    itemId: input.itemId,
    type: NotificationType.MENTIONED,
    title: 'You were mentioned in a comment',
    body: input.itemTitle,
  });
}

export async function deriveDueNotifications(now = new Date()) {
  const soonLimit = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const dueItems = await prisma.item.findMany({
    where: {
      assigneeId: { not: null },
      dueDate: { lte: soonLimit },
      status: { not: ItemStatus.DONE },
    },
    select: { id: true, title: true, dueDate: true, assigneeId: true },
  });
  const data = dueItems.flatMap((item) => {
    if (!item.dueDate || !item.assigneeId) return [];
    const overdue = item.dueDate.getTime() < now.getTime();
    const type = overdue ? NotificationType.OVERDUE : NotificationType.DUE_SOON;
    const dueDateKey = item.dueDate.toISOString().slice(0, 10);
    return [{
      userId: item.assigneeId,
      itemId: item.id,
      type,
      title: overdue ? 'Assigned item is overdue' : 'Assigned item is due soon',
      body: item.title,
      dedupeKey: dueDateKey,
    }];
  });
  if (!data.length) return 0;
  const result = await prisma.notification.createMany({ data, skipDuplicates: true });
  return result.count;
}
