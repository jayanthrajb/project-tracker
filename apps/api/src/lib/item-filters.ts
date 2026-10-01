import { ItemPriority, ItemRisk, ItemStatus, ItemType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export const itemFiltersSchema = z.object({
  projectId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
  unassigned: z.boolean().optional(),
  statuses: z.array(z.nativeEnum(ItemStatus)).optional(),
  types: z.array(z.nativeEnum(ItemType)).optional(),
  priorities: z.array(z.nativeEnum(ItemPriority)).optional(),
  risks: z.array(z.nativeEnum(ItemRisk)).optional(),
  search: z.string().optional(),
  dueBefore: z.union([z.iso.date(), z.iso.datetime({ offset: true })]).optional(),
}).strict();

export type ItemFilterInput = z.infer<typeof itemFiltersSchema>;

export function buildItemWhere(filters: ItemFilterInput): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = {};

  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.unassigned) where.assigneeId = null;
  else if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.statuses?.length) where.status = { in: filters.statuses };
  if (filters.types?.length) where.type = { in: filters.types };
  if (filters.priorities?.length) where.priority = { in: filters.priorities };
  if (filters.risks?.length) where.risk = { in: filters.risks };
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
