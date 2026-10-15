import { DependencyType } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { AppError } from './errors.js';

type RelationClient = Pick<Prisma.TransactionClient, 'item' | 'itemDependency'>;

export async function assertValidParent(
  tx: RelationClient,
  itemId: string | undefined,
  projectId: string,
  parentId: string | null,
) {
  if (!parentId) return;
  if (itemId === parentId) throw new AppError(400, 'An item cannot be its own parent');

  const parent = await tx.item.findUnique({
    where: { id: parentId },
    select: { id: true, projectId: true, parentId: true },
  });
  if (!parent) throw new AppError(400, `Parent item ${parentId} was not found`);
  if (parent.projectId !== projectId) throw new AppError(400, 'Parent and child must belong to the same project');

  const ancestors = new Set<string>();
  let current: { id: string; parentId: string | null } | null = parent;
  while (current) {
    if (current.id === itemId) throw new AppError(400, 'Parent relationship would create a cycle');
    if (ancestors.has(current.id)) throw new AppError(400, 'Parent relationship would create a cycle');
    ancestors.add(current.id);
    if (ancestors.size >= 4) throw new AppError(400, 'Item hierarchy cannot exceed 4 levels');
    current = current.parentId
      ? await tx.item.findUnique({ where: { id: current.parentId }, select: { id: true, parentId: true } })
      : null;
  }

  if (!itemId) return;
  let frontier = [itemId];
  let height = 1;
  while (frontier.length > 0) {
    const descendants = await tx.item.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    if (descendants.length === 0) break;
    height += 1;
    frontier = descendants.map((item) => item.id);
    if (ancestors.size + height > 4) throw new AppError(400, 'Item hierarchy cannot exceed 4 levels');
  }
}

export async function assertNoBlocksCycle(tx: RelationClient, fromId: string, toId: string) {
  if (fromId === toId) throw new AppError(400, 'An item cannot depend on itself');
  const visited = new Set<string>();
  let frontier = [toId];
  while (frontier.length > 0) {
    if (frontier.includes(fromId)) throw new AppError(400, 'BLOCKS dependency would create a cycle');
    const unseen = frontier.filter((id) => !visited.has(id));
    if (unseen.length === 0) return;
    unseen.forEach((id) => visited.add(id));
    const edges = await tx.itemDependency.findMany({
      where: { fromId: { in: unseen }, type: DependencyType.BLOCKS },
      select: { toId: true },
    });
    frontier = edges.map((edge) => edge.toId);
  }
}

export function normalizeDependency(fromId: string, toId: string, type: DependencyType) {
  if (fromId === toId) throw new AppError(400, 'An item cannot depend on itself');
  if (type === DependencyType.RELATES_TO && fromId.localeCompare(toId) > 0) {
    return { fromId: toId, toId: fromId, type };
  }
  return { fromId, toId, type };
}
