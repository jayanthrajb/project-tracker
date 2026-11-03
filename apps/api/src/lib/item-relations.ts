import { DependencyType, ItemStatus, ItemType } from '@prisma/client';
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

type CloseClient = Pick<Prisma.TransactionClient, 'item' | 'itemDependency'>;
type StatusOverrides = ReadonlyMap<string, ItemStatus>;

/**
 * Returns a message per item that cannot move to DONE because a child or a
 * BLOCKS source is still open. `nextStatus` supplies statuses changing in the
 * same batch, so closing a parent together with its children is allowed.
 */
export async function findCloseViolations(
  tx: CloseClient,
  itemIds: string[],
  nextStatus: StatusOverrides = new Map(),
) {
  const violations = new Map<string, string>();
  if (itemIds.length === 0) return violations;
  const [items, children, blockers] = await Promise.all([
    tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, key: true } }),
    tx.item.findMany({ where: { parentId: { in: itemIds } }, select: { id: true, key: true, status: true, parentId: true } }),
    tx.itemDependency.findMany({
      where: { toId: { in: itemIds }, type: DependencyType.BLOCKS },
      select: { toId: true, from: { select: { id: true, key: true, status: true } } },
    }),
  ]);
  const isOpen = (entry: { id: string; status: ItemStatus }) => (nextStatus.get(entry.id) ?? entry.status) !== ItemStatus.DONE;
  for (const item of items) {
    const openChildren = children.filter((child) => child.parentId === item.id && isOpen(child)).map((child) => child.key);
    const openBlockers = blockers.filter((edge) => edge.toId === item.id && isOpen(edge.from)).map((edge) => edge.from.key);
    if (openChildren.length === 0 && openBlockers.length === 0) continue;
    const reasons = [
      openChildren.length > 0 ? `open child items ${openChildren.join(', ')}` : '',
      openBlockers.length > 0 ? `open blockers ${openBlockers.join(', ')}` : '',
    ].filter(Boolean);
    violations.set(item.id, `Cannot close ${item.key}: ${reasons.join(' and ')}. Close them first.`);
  }
  return violations;
}

export async function assertCanClose(tx: CloseClient, itemId: string, nextStatus?: StatusOverrides) {
  const message = (await findCloseViolations(tx, [itemId], nextStatus)).get(itemId);
  if (message) throw new AppError(400, message);
}

type LinkEnd = { key: string; status: ItemStatus };

export function assertCanAddChild(parent: LinkEnd, child: LinkEnd) {
  if (parent.status === ItemStatus.DONE && child.status !== ItemStatus.DONE) {
    throw new AppError(400, `Cannot add open item ${child.key} under closed item ${parent.key}. Reopen ${parent.key} first.`);
  }
}

export function assertCanAddBlocker(blocker: LinkEnd, blocked: LinkEnd) {
  if (blocked.status === ItemStatus.DONE && blocker.status !== ItemStatus.DONE) {
    throw new AppError(400, `Cannot make open item ${blocker.key} block closed item ${blocked.key}. Reopen ${blocked.key} first.`);
  }
}

export function assertEpicTopLevel(type: ItemType, parentId: string | null | undefined) {
  if (type === ItemType.EPIC && parentId) {
    throw new AppError(400, 'An epic is a top-level item and cannot have a parent');
  }
}
