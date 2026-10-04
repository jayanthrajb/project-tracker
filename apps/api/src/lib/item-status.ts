import { ItemStatus, type Prisma } from '@prisma/client';

export const committedStatuses: ItemStatus[] = [
  ItemStatus.OPEN,
  ItemStatus.IN_PROGRESS,
  ItemStatus.BLOCKED,
  ItemStatus.IN_REVIEW,
];

export async function itemStartData(
  tx: Prisma.TransactionClient,
  status: ItemStatus | undefined,
  itemId?: string,
): Promise<{ startedAt?: Date | null }> {
  if (!itemId) {
    return { startedAt: status === ItemStatus.IN_PROGRESS ? new Date() : null };
  }
  if (status === ItemStatus.IN_PROGRESS) {
    // A conditional write inside the status transaction preserves the first
    // start even when concurrent requests enter IN_PROGRESS.
    await tx.item.updateMany({
      where: { id: itemId, startedAt: null },
      data: { startedAt: new Date() },
    });
  }
  return {};
}
