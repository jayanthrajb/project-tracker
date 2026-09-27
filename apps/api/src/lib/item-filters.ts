import { ItemStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface ItemFilterInput {
  projectId?: string;
  assigneeId?: string;
  statuses?: string[];
  types?: string[];
  priorities?: string[];
  risks?: string[];
  search?: string;
  dueBefore?: string;
}

export function buildItemWhere(filters: ItemFilterInput): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = {};

  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.statuses?.length) where.status = { in: filters.statuses as ItemStatus[] };
  if (filters.types?.length) where.type = { in: filters.types as any };
  if (filters.priorities?.length) where.priority = { in: filters.priorities as any };
  if (filters.risks?.length) where.risk = { in: filters.risks as any };
  if (filters.dueBefore) where.dueDate = { lte: new Date(filters.dueBefore) };
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export function sortItems<T extends { score: number; dueDate: Date | null; updatedAt: Date; createdAt: Date; key: string; title: string }>(
  items: T[],
  sort: string | undefined,
) {
  const copy = [...items];
  switch (sort) {
    case 'dueDate-asc':
      copy.sort((a, b) => (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER));
      break;
    case 'dueDate-desc':
      copy.sort((a, b) => (b.dueDate?.getTime() ?? 0) - (a.dueDate?.getTime() ?? 0));
      break;
    case 'updatedAt-desc':
      copy.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      break;
    case 'title-asc':
      copy.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'key-asc':
      copy.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
      break;
    case 'score-asc':
      copy.sort((a, b) => a.score - b.score);
      break;
    case 'score-desc':
    default:
      copy.sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime());
      break;
  }
  return copy;
}

export function isAttentionItem(status: ItemStatus, assigneeId: string | null, dueDate: Date | null) {
  return status !== ItemStatus.DONE && (!assigneeId || !dueDate);
}
