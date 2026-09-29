import { ItemStatus } from '@prisma/client';
import type { ItemPriority, ItemRisk } from '@prisma/client';

const priorityWeight: Record<ItemPriority, number> = {
  P0: 10,
  P1: 6,
  P2: 3,
  P3: 1,
};

const riskWeight: Record<ItemRisk, number> = {
  HIGH: 5,
  MEDIUM: 3,
  LOW: 1,
};

export interface ScoreInput {
  priority: ItemPriority;
  risk: ItemRisk;
  status: ItemStatus;
  createdAt: Date;
  dueDate: Date | null;
}

export function calculateItemScore(item: ScoreInput, now = new Date()): number {
  if (item.status === ItemStatus.DONE) {
    return 0;
  }

  const createdAt = new Date(item.createdAt);
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const overdueDays = item.dueDate
    ? Math.max(0, Math.floor((now.getTime() - new Date(item.dueDate).getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  const score =
    priorityWeight[item.priority] * 3 +
    riskWeight[item.risk] * 2 +
    overdueDays +
    ageDays / 7 +
    (item.status === ItemStatus.BLOCKED ? 8 : 0);

  return Number(score.toFixed(2));
}
