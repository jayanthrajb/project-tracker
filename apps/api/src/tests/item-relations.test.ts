import { DependencyType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { assertNoBlocksCycle, assertValidParent, normalizeDependency } from '../lib/item-relations.js';

type TreeItem = { id: string; projectId: string; parentId: string | null };
type Edge = { fromId: string; toId: string; type: DependencyType };

function relationClient(items: TreeItem[], edges: Edge[] = []) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  return {
    item: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => itemMap.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { parentId: { in: string[] } } }) =>
        [...itemMap.values()].filter((item) => where.parentId.in.includes(item.parentId ?? ''))),
    },
    itemDependency: {
      findMany: vi.fn(async ({ where }: { where: { fromId: { in: string[] }; type: DependencyType } }) =>
        edges.filter((edge) => where.fromId.in.includes(edge.fromId) && edge.type === where.type)),
    },
  } as unknown as Parameters<typeof assertValidParent>[0];
}

describe('item relationship validation', () => {
  it('accepts same-project parents and rejects cross-project parents', async () => {
    const client = relationClient([
      { id: 'parent', projectId: 'p1', parentId: null },
      { id: 'child', projectId: 'p1', parentId: null },
    ]);

    await expect(assertValidParent(client, 'child', 'p1', 'parent')).resolves.toBeUndefined();
    await expect(assertValidParent(client, 'child', 'p2', 'parent')).rejects.toThrow('same project');
  });

  it.each([
    ['direct', [
      { id: 'a', projectId: 'p1', parentId: null },
      { id: 'b', projectId: 'p1', parentId: 'a' },
    ], 'b'],
    ['indirect', [
      { id: 'a', projectId: 'p1', parentId: null },
      { id: 'b', projectId: 'p1', parentId: 'a' },
      { id: 'c', projectId: 'p1', parentId: 'b' },
    ], 'c'],
  ])('rejects %s hierarchy cycles', async (_label, items, parentId) => {
    const client = relationClient(items);
    await expect(assertValidParent(client, 'a', 'p1', parentId)).rejects.toThrow('cycle');
  });

  it('rejects a fifth hierarchy level', async () => {
    const client = relationClient([
      { id: 'one', projectId: 'p1', parentId: null },
      { id: 'two', projectId: 'p1', parentId: 'one' },
      { id: 'three', projectId: 'p1', parentId: 'two' },
      { id: 'four', projectId: 'p1', parentId: 'three' },
    ]);
    await expect(assertValidParent(client, undefined, 'p1', 'four')).rejects.toThrow('4 levels');
  });

  it('rejects direct and indirect BLOCKS cycles', async () => {
    const indirect = relationClient([], [
      { fromId: 'a', toId: 'b', type: DependencyType.BLOCKS },
      { fromId: 'b', toId: 'c', type: DependencyType.BLOCKS },
    ]);
    await expect(assertNoBlocksCycle(indirect, 'c', 'a')).rejects.toThrow('cycle');
    await expect(assertNoBlocksCycle(indirect, 'a', 'a')).rejects.toThrow('itself');
  });

  it('normalizes RELATES_TO in either direction to one stored pair', () => {
    expect(normalizeDependency('item-b', 'item-a', DependencyType.RELATES_TO))
      .toEqual(normalizeDependency('item-a', 'item-b', DependencyType.RELATES_TO));
  });
});
