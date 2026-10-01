import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ActivityAction, ItemPriority, ItemRisk, ItemStatus, ItemType, NotificationType, type Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { recordItemChanges } from '../lib/activity.js';
import { extractMentionHandles, resolveMentionedUsers } from '../lib/mentions.js';
import { dispatchNotification } from '../lib/notifications.js';
import { LocalStorageDriver } from '../lib/storage/local.js';

describe('Phase 2 helpers', () => {
  it('extracts unique mentions while ignoring emails and inline or fenced code', () => {
    const body = [
      'Email owner@example.com; notify @ava and @ava.',
      'Inline `@hidden` should not count.',
      '```ts',
      '@also-hidden',
      '```',
      'A normalized handle: @sara-manager.',
    ].join('\n');

    expect(extractMentionHandles(body)).toEqual(['ava', 'sara-manager']);
  });

  it('resolves active users by email local-part or normalized name and ignores unknown handles', async () => {
    const users = [
      { id: 'ava-id', name: 'Ava Developer', email: 'ava@example.com' },
      { id: 'sara-id', name: 'Sara Manager', email: 'sara.manager@example.com' },
      { id: 'inactive-id', name: 'Inactive User', email: 'inactive@example.com' },
    ];
    const tx = {
      user: { findMany: vi.fn(async () => users.slice(0, 2)) },
    } as unknown as Prisma.TransactionClient;

    const result = await resolveMentionedUsers(tx, '@ava @sara-manager @unknown owner@example.com');

    expect(result.map((user) => user.id)).toEqual(['ava-id', 'sara-id']);
  });

  it('writes one activity row for each changed field', async () => {
    const before: Parameters<typeof recordItemChanges>[1]['before'] = {
      id: 'item-1',
      projectId: 'project-1',
      title: 'Before',
      type: ItemType.TASK,
      description: '',
      status: ItemStatus.OPEN,
      priority: ItemPriority.P2,
      risk: ItemRisk.LOW,
      assigneeId: null,
      reporterId: 'user-1',
      dueDate: null,
      estimateHours: null,
      spentHours: 0,
      tags: [],
      closedAt: null,
    };
    const calls: Array<Array<{ action: ActivityAction; field: string; oldValue: string | null; newValue: string | null }>> = [];
    const tx = {
      activityLog: {
        createMany: vi.fn(async ({ data }: { data: typeof calls[number] }) => {
          calls.push(data);
          return { count: data.length };
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await recordItemChanges(tx, {
      userId: 'user-1',
      before,
      after: { ...before, title: 'After', status: ItemStatus.IN_PROGRESS },
    });

    expect(calls[0]).toHaveLength(2);
    expect(calls[0].map((entry) => entry.action)).toEqual([
      ActivityAction.UPDATED,
      ActivityAction.STATUS_CHANGED,
    ]);
  });

  it('does not notify a user about their own action', async () => {
    const create = vi.fn();
    const tx = { notification: { create } } as unknown as Prisma.TransactionClient;

    await dispatchNotification(tx, {
      userId: 'user-1',
      actorId: 'user-1',
      itemId: 'item-1',
      type: NotificationType.COMMENT,
      title: 'Comment',
      body: 'Comment body',
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('rejects attachment storage keys that escape the configured directory', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'project-tracker-storage-'));
    const storage = new LocalStorageDriver(directory);
    try {
      await expect(storage.createReadStream('../outside.txt')).rejects.toThrow('Invalid storage key');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('deduplicates due notifications across repeated scans', async () => {
    vi.resetModules();
    const rows = new Set<string>();
    const mockPrisma = {
      item: {
        findMany: vi.fn(async () => [{
          id: 'item-1',
          title: 'Due item',
          dueDate: new Date('2026-10-03T00:00:00.000Z'),
          assigneeId: 'user-1',
        }]),
      },
      notification: {
        createMany: vi.fn(async ({ data }: { data: Array<{ userId: string; itemId: string; type: NotificationType; dedupeKey: string }> }) => {
          let count = 0;
          for (const row of data) {
            const key = `${row.userId}:${row.itemId}:${row.type}:${row.dedupeKey}`;
            if (!rows.has(key)) {
              rows.add(key);
              count += 1;
            }
          }
          return { count };
        }),
      },
    };
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { deriveDueNotifications } = await import('../lib/notifications.js');
    const now = new Date('2026-10-01T00:00:00.000Z');

    expect(await deriveDueNotifications(now)).toBe(1);
    expect(await deriveDueNotifications(now)).toBe(0);
  });
});
