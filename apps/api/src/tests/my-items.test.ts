import { ItemPriority, ItemRisk, ItemStatus, ItemType, UserRole } from '@prisma/client';
import type { Item } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Item & { project: { ownerId: string; members: { userId: string }[] } };

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'AND' || key === 'OR') {
      const clauses = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
      return key === 'AND' ? clauses.every((clause) => matches(row, clause)) : clauses.some((clause) => matches(row, clause));
    }
    if (value !== null && typeof value === 'object') {
      const filter = value as Record<string, unknown>;
      if ('in' in filter) return (filter.in as unknown[]).includes(row[key]);
      if ('contains' in filter) return String(row[key]).toLowerCase().includes(String(filter.contains).toLowerCase());
      if ('some' in filter) return (row[key] as Record<string, unknown>[]).some((entry) => matches(entry, filter.some as Record<string, unknown>));
      return matches(row[key] as Record<string, unknown>, filter);
    }
    return row[key] === value;
  });
}

function fixture(id: string, assigneeId: string | null, reporterId: string, projectId = 'p1'): Row {
  return {
    id, key: id, projectId, assigneeId, reporterId, title: `Task ${id}`, description: 'Keep this description',
    type: ItemType.TASK, status: ItemStatus.OPEN, priority: ItemPriority.P2, risk: ItemRisk.LOW,
    dueDate: null, startedAt: null, closedAt: null, estimateHours: null, spentHours: 5, tags: ['keep'],
    createdAt: new Date(), updatedAt: new Date(),
    project: { ownerId: 'manager', members: [{ userId: projectId === 'private' ? 'other' : 'dev' }] },
  };
}

async function setup() {
  vi.resetModules();
  const rows = [
    fixture('assigned', 'dev', 'other'),
    fixture('reported', 'other', 'dev'),
    fixture('unassigned', null, 'dev', 'p2'),
    fixture('foreign', 'other', 'other'),
    fixture('private', 'dev', 'dev', 'private'),
  ];
  const users = [
    { id: 'dev', role: UserRole.DEVELOPER, name: 'Dev', email: 'dev@example.com', isActive: true },
    { id: 'other', role: UserRole.DEVELOPER, name: 'Other', email: 'other@example.com', isActive: true },
    { id: 'manager', role: UserRole.MANAGER, name: 'Manager', email: 'manager@example.com', isActive: true },
  ];
  const transaction = {
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users.find((user) => user.id === where.id)) },
    projectMember: { findUnique: vi.fn(async (): Promise<{ projectId: string; userId: string } | null> => ({ projectId: 'p1', userId: 'dev' })) },
    item: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Item> }) => {
        const row = rows.find((entry) => entry.id === where.id)!;
        const updated = { ...row, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
        rows[rows.indexOf(row)] = updated;
        return updated;
      }),
    },
    activityLog: { createMany: vi.fn(async () => ({ count: 1 })) },
    notification: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    ...transaction,
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>): Promise<T> => callback(transaction),
  };
  vi.doMock('../lib/prisma.js', () => ({ prisma }));
  const { createApp } = await import('../app.js');
  const { signToken } = await import('../lib/auth.js');
  const app = createApp();
  const cookie = (id = 'dev', role: UserRole = UserRole.DEVELOPER) =>
    `project_tracker_token=${signToken({ userId: id, role })}; project_tracker_csrf=test-csrf`;
  return { app, cookie, prisma };
}

let state: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { state = await setup(); });

function ids(response: request.Response): string[] {
  return response.body.items.map((item: { id: string }) => item.id).sort();
}

describe('My Items session scope', () => {
  it('excludes items the session user can neither edit nor own, while including assignee OR reporter', async () => {
    const response = await request(state.app).get('/api/items?mine=true').set('Cookie', state.cookie());
    expect(response.status).toBe(200);
    expect(ids(response)).toEqual(['assigned', 'reported', 'unassigned']);
    expect(response.body.total).toBe(3);
    const forbidden = await request(state.app).patch('/api/items/foreign').set('Cookie', state.cookie())
      .set('x-csrf-token', 'test-csrf').send({ status: 'IN_REVIEW' });
    expect(forbidden.status).toBe(403);
  });

  it('resolves ownership from the session, not userId/reporterId input or the token role', async () => {
    const response = await request(state.app).get('/api/items?mine=true&userId=other&reporterId=other')
      .set('Cookie', state.cookie('dev', UserRole.MANAGER));
    expect(ids(response)).toEqual(['assigned', 'reported', 'unassigned']);
    const other = await request(state.app).get('/api/items?mine=true').set('Cookie', state.cookie('other'));
    expect(ids(other)).toEqual([]);
    const manager = await request(state.app).get('/api/items?mine=true').set('Cookie', state.cookie('manager', UserRole.MANAGER));
    expect(ids(manager)).toEqual([]);
  });

  it('intersects conflicting assignee and unassigned filters with ownership rather than widening', async () => {
    const response = await request(state.app).get('/api/items?mine=true&assigneeId=other').set('Cookie', state.cookie());
    expect(ids(response)).toEqual(['reported']);
    const unassigned = await request(state.app).get('/api/items?mine=true&unassigned=true').set('Cookie', state.cookie());
    expect(ids(unassigned)).toEqual(['unassigned']);
  });

  it('composes search OR, project, status, priority and pagination with the ownership OR', async () => {
    const query = '/api/items?mine=true&search=Task&projectId=p1&status=OPEN&priority=P2&sort=key-asc&pageSize=1&page=2';
    const response = await request(state.app).get(query).set('Cookie', state.cookie());
    expect(response.status).toBe(200);
    expect(ids(response)).toEqual(['reported']);
    expect(response.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    const empty = await request(state.app).get('/api/items?mine=true&status=DONE').set('Cookie', state.cookie());
    expect(ids(empty)).toEqual([]);
    expect(empty.body.total).toBe(0);
  });

  it('keeps the existing read scope without mine or with mine=false', async () => {
    for (const suffix of ['', '?mine=false']) {
      const response = await request(state.app).get(`/api/items${suffix}`).set('Cookie', state.cookie());
      expect(ids(response)).toEqual(['assigned', 'foreign', 'reported', 'unassigned']);
    }
  });

  it('requires authentication and rejects invalid mine values', async () => {
    expect((await request(state.app).get('/api/items?mine=true')).status).toBe(401);
    expect((await request(state.app).get('/api/items?mine=other').set('Cookie', state.cookie())).status).toBe(400);
  });

  it.each(['assigned', 'reported', 'unassigned'])('lets the developer update status on the %s row', async (id) => {
    const response = await request(state.app).patch(`/api/items/${id}`).set('Cookie', state.cookie())
      .set('x-csrf-token', 'test-csrf').send({ status: 'IN_REVIEW' });
    expect(response.status).toBe(200);
    expect(response.body.item.status).toBe('IN_REVIEW');
    expect(response.body.item).toMatchObject({ description: 'Keep this description', spentHours: 5, tags: ['keep'] });
  });

  it('still rejects explicit foreign ownership changes and updates outside project membership', async () => {
    for (const body of [{ reporterId: 'other' }, { assigneeId: 'other' }, { title: 'Changed title', status: 'IN_REVIEW' }]) {
      const response = await request(state.app).patch('/api/items/assigned').set('Cookie', state.cookie())
        .set('x-csrf-token', 'test-csrf').send(body);
      expect(response.status).toBe(403);
    }
    state.prisma.projectMember.findUnique.mockResolvedValueOnce(null);
    const response = await request(state.app).patch('/api/items/assigned').set('Cookie', state.cookie())
      .set('x-csrf-token', 'test-csrf').send({ status: 'IN_REVIEW' });
    expect(response.status).toBe(403);
  });
});
