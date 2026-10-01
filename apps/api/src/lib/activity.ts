import { ActivityAction, type Item, type Prisma } from '@prisma/client';

type ItemSnapshot = Pick<Item, 'id' | 'projectId' | 'title' | 'type' | 'description' | 'status' | 'priority' | 'risk' | 'assigneeId' | 'reporterId' | 'dueDate' | 'estimateHours' | 'spentHours' | 'tags' | 'closedAt'>;

function valueAsString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

export async function recordItemChanges(
  tx: Prisma.TransactionClient,
  input: { userId: string; before: ItemSnapshot; after: ItemSnapshot; bulk?: boolean },
) {
  const fields: Array<keyof ItemSnapshot> = [
    'title', 'type', 'description', 'status', 'priority', 'risk', 'assigneeId',
    'reporterId', 'dueDate', 'estimateHours', 'spentHours', 'tags', 'closedAt',
  ];
  const changed = fields.flatMap((field) => {
    const oldValue = valueAsString(input.before[field]);
    const newValue = valueAsString(input.after[field]);
    if (oldValue === newValue) return [];
    const action = input.bulk
      ? ActivityAction.BULK_UPDATED
      : field === 'status'
        ? ActivityAction.STATUS_CHANGED
        : field === 'assigneeId'
          ? ActivityAction.ASSIGNED
          : ActivityAction.UPDATED;
    return [{
      itemId: input.after.id,
      projectId: input.after.projectId,
      userId: input.userId,
      action,
      field,
      oldValue,
      newValue,
    }];
  });
  if (changed.length) await tx.activityLog.createMany({ data: changed });
}

export async function recordItemCreation(
  tx: Prisma.TransactionClient,
  input: { userId: string; item: ItemSnapshot; imported?: boolean },
) {
  await tx.activityLog.create({
    data: {
      itemId: input.item.id,
      projectId: input.item.projectId,
      userId: input.userId,
      action: input.imported ? ActivityAction.IMPORTED : ActivityAction.CREATED,
      field: null,
      oldValue: null,
      newValue: input.item.title,
    },
  });
}

export async function recordItemDeletion(
  tx: Prisma.TransactionClient,
  input: { userId: string; item: Pick<Item, 'id' | 'projectId' | 'title'> },
) {
  await tx.activityLog.create({
    data: {
      itemId: null,
      projectId: input.item.projectId,
      userId: input.userId,
      action: ActivityAction.DELETED,
      field: null,
      oldValue: input.item.title,
      newValue: null,
    },
  });
  await tx.item.delete({ where: { id: input.item.id } });
}

export async function recordCommentActivity(
  tx: Prisma.TransactionClient,
  input: { userId: string; itemId: string; projectId: string; commentId: string },
) {
  await tx.activityLog.create({
    data: {
      itemId: input.itemId,
      projectId: input.projectId,
      userId: input.userId,
      action: ActivityAction.COMMENTED,
      field: 'commentId',
      oldValue: null,
      newValue: input.commentId,
    },
  });
}
