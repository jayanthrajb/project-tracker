import { ItemPriority, ItemStatus, UserRole } from '@prisma/client';
import type { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const credentials = '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK';

function createMockPrisma() {
  const users = [
    { id: 'manager-1', name: 'Sara Manager', email: 'manager@example.com', passwordHash: credentials, role: UserRole.MANAGER, isActive: true },
    { id: 'dev-1', name: 'Ava Developer', email: 'dev@example.com', passwordHash: credentials, role: UserRole.DEVELOPER, isActive: true },
    { id: 'outsider-1', name: 'Outside Developer', email: 'outside@example.com', passwordHash: credentials, role: UserRole.DEVELOPER, isActive: true },
  ];
  const project = { id: 'project-1', ownerId: 'manager-1', members: [{ userId: 'dev-1' }] };
  const queryRows: unknown[][] = [];
  const sqlQueries: string[] = [];
  const itemGroupBy = vi.fn(async (args: {
    by: string[];
    where: { dueDate?: unknown; createdAt?: { gte: Date; lt: Date } };
  }) => {
    if (args.where.dueDate) {
      return [
        { assigneeId: 'dev-1', _count: { _all: 1 } },
        { assigneeId: null, _count: { _all: 1 } },
      ];
    }
    if (args.by.includes('priority')) {
      return [
        { assigneeId: 'dev-1', priority: ItemPriority.P1, _count: { _all: 1 } },
        { assigneeId: 'dev-1', priority: ItemPriority.P2, _count: { _all: 1 } },
        { assigneeId: null, priority: ItemPriority.P0, _count: { _all: 1 } },
      ];
    }
    if (args.by.includes('status')) {
      return [
        { status: ItemStatus.OPEN, _count: { _all: 2 } },
        { status: ItemStatus.DONE, _count: { _all: 1 } },
      ];
    }
    return [
      { assigneeId: 'dev-1', _count: { _all: 2 } },
      { assigneeId: null, _count: { _all: 1 } },
    ];
  });
  const queryRaw = vi.fn(async (query: Prisma.Sql) => {
    sqlQueries.push(query.sql);
    return queryRows.shift() ?? [];
  });
  const prismaMock = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        users.find((user) => user.id === where.id || user.email === where.email) ?? null),
      findMany: vi.fn(async () => [{ id: 'dev-1', name: 'Ava Developer' }]),
    },
    project: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === project.id ? project : null),
    },
    item: { groupBy: itemGroupBy },
    $queryRaw: queryRaw,
  } as unknown as PrismaClient;
  return { prismaMock, itemGroupBy, queryRows, queryRaw, sqlQueries };
}

async function createHarness(email = 'manager@example.com') {
  vi.resetModules();
  const state = createMockPrisma();
  vi.doMock('../lib/prisma.js', () => ({ prisma: state.prismaMock }));
  const { createApp } = await import('../app.js');
  const agent = request.agent(createApp());
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' });
  return { agent, state };
}

const reportsPath = '/api/projects/project-1/reports';

describe('project report routes', () => {
  it('returns all six chartable aggregates, including stable status and priority buckets', async () => {
    const { agent, state } = await createHarness();
    state.queryRows.push(
      [{ bucket: '1-7 days', value: 2n }, { bucket: '8-30 days', value: 1n }],
      [{ id: 'item-1', key: 'APP-1', title: 'Overdue item', status: ItemStatus.OPEN, priority: ItemPriority.P1, dueDate: new Date('2026-09-01T00:00:00Z'), assigneeName: 'Ava Developer', createdAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z') }],
      [{ kind: 'creation', bucket: '8-30 days', value: 2n }, { kind: 'activity', bucket: '31+ days', value: 1n }],
      [],
      [{ bucket: '2026-09-28T00:00:00Z', value: 3n }],
      [{ bucket: '2026-10-01', value: 4n }, { bucket: '2026-10-02', value: 3n }],
    );

    const status = await agent.get(`${reportsPath}/status-breakdown?from=2026-10-01&to=2026-10-02`);
    expect(status.status).toBe(200);
    expect(status.body.items).toEqual([
      { bucket: 'OPEN', value: 2 },
      { bucket: 'IN_PROGRESS', value: 0 },
      { bucket: 'BLOCKED', value: 0 },
      { bucket: 'IN_REVIEW', value: 0 },
      { bucket: 'DONE', value: 1 },
    ]);

    const workload = await agent.get(`${reportsPath}/workload?from=2026-10-01&to=2026-10-02`);
    expect(workload.status).toBe(200);
    expect(workload.body.assignees).toEqual([
      {
        assigneeId: 'dev-1',
        name: 'Ava Developer',
        totalOpen: 2,
        byPriority: [
          { bucket: 'P0', value: 0 },
          { bucket: 'P1', value: 1 },
          { bucket: 'P2', value: 1 },
          { bucket: 'P3', value: 0 },
        ],
        overdue: 1,
      },
      {
        assigneeId: null,
        name: 'Unassigned',
        totalOpen: 1,
        byPriority: [
          { bucket: 'P0', value: 1 },
          { bucket: 'P1', value: 0 },
          { bucket: 'P2', value: 0 },
          { bucket: 'P3', value: 0 },
        ],
        overdue: 1,
      },
    ]);
    expect(state.itemGroupBy.mock.calls[3][0].where.dueDate).toEqual({ lt: new Date('2026-10-02T00:00:00.000Z') });

    const overdue = await agent.get(`${reportsPath}/overdue?from=2026-10-01&to=2026-10-02`);
    expect(overdue.status).toBe(200);
    expect(overdue.body.buckets).toEqual([
      { bucket: '1-7 days', value: 2 },
      { bucket: '8-30 days', value: 1 },
      { bucket: '31+ days', value: 0 },
    ]);
    expect(overdue.body.mostOverdue).toHaveLength(1);
    expect(overdue.body.mostOverdue[0].assigneeName).toBe('Ava Developer');

    const aging = await agent.get(`${reportsPath}/aging?from=2026-10-01&to=2026-10-02`);
    expect(aging.status).toBe(200);
    expect(aging.body.byCreationAge).toEqual([
      { bucket: '1-7 days', value: 0 },
      { bucket: '8-30 days', value: 2 },
      { bucket: '31+ days', value: 0 },
    ]);
    expect(aging.body.byLastActivity).toEqual([
      { bucket: '1-7 days', value: 0 },
      { bucket: '8-30 days', value: 0 },
      { bucket: '31+ days', value: 1 },
    ]);

    const throughput = await agent.get(`${reportsPath}/throughput?from=2026-10-01&to=2026-10-02&interval=week`);
    expect(throughput.status).toBe(200);
    expect(throughput.body).toEqual({
      interval: 'week',
      points: [{ bucket: '2026-09-28T00:00:00Z', value: 3 }],
    });

    const burndown = await agent.get(`${reportsPath}/burndown?from=2026-10-01&to=2026-10-02`);
    expect(burndown.status).toBe(200);
    expect(burndown.body.points).toEqual([
      { bucket: '2026-10-01', value: 4 },
      { bucket: '2026-10-02', value: 3 },
    ]);
    expect(state.sqlQueries.some((sql) => sql.includes("AT TIME ZONE 'UTC'"))).toBe(true);
    expect(state.sqlQueries[5]).toContain('i."createdAt" < s.cutoff');
    expect(state.sqlQueries[5]).toContain('SELECT a."oldValue"');
    expect(state.sqlQueries[5]).toContain('ORDER BY a."createdAt" ASC');
  });

  it('applies default dates, includes both calendar boundaries, and rejects invalid ranges', async () => {
    const { agent, state } = await createHarness();
    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const response = await agent.get(`${reportsPath}/status-breakdown`);
    expect(response.status).toBe(200);
    const defaultWhere = state.itemGroupBy.mock.calls[0][0].where;
    expect(defaultWhere.createdAt?.gte.toISOString()).toBe(new Date(todayStart.getTime() - 29 * 86_400_000).toISOString());
    expect(defaultWhere.createdAt?.lt.toISOString()).toBe(new Date(todayStart.getTime() + 86_400_000).toISOString());

    const bounded = await agent.get(`${reportsPath}/status-breakdown?from=2026-10-01&to=2026-10-02`);
    expect(bounded.status).toBe(200);
    const boundedWhere = state.itemGroupBy.mock.calls[1][0].where;
    expect(boundedWhere.createdAt?.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(boundedWhere.createdAt?.lt.toISOString()).toBe('2026-10-03T00:00:00.000Z');

    const endOnly = await agent.get(`${reportsPath}/status-breakdown?to=2026-10-02`);
    expect(endOnly.status).toBe(200);
    const endOnlyWhere = state.itemGroupBy.mock.calls[2][0].where;
    expect(endOnlyWhere.createdAt?.gte.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    expect(endOnlyWhere.createdAt?.lt.toISOString()).toBe('2026-10-03T00:00:00.000Z');

    const inverted = await agent.get(`${reportsPath}/status-breakdown?from=2026-10-03&to=2026-10-02`);
    const tooLarge = await agent.get(`${reportsPath}/status-breakdown?from=2025-01-01&to=2026-10-02`);
    const invalidDate = await agent.get(`${reportsPath}/status-breakdown?from=2026-02-30&to=2026-03-01`);
    expect(inverted.status).toBe(400);
    expect(tooLarge.status).toBe(400);
    expect(invalidDate.status).toBe(400);
    expect(state.itemGroupBy).toHaveBeenCalledTimes(3);
  });

  it('rejects developers without project membership before querying report data', async () => {
    const { agent, state } = await createHarness('outside@example.com');
    const response = await agent.get(`${reportsPath}/status-breakdown`);
    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('You cannot access this project');
    expect(state.itemGroupBy).not.toHaveBeenCalled();
    expect(state.queryRaw).not.toHaveBeenCalled();
  });

  it('returns well-formed zero buckets and time-series points for empty results', async () => {
    const { agent, state } = await createHarness();
    state.itemGroupBy.mockResolvedValue([]);
    state.queryRows.push(
      [],
      [],
      [],
      [],
      [{ bucket: '2026-10-02T00:00:00Z', value: 0n }],
      [{ bucket: '2026-10-02', value: 0n }],
    );
    const status = await agent.get(`${reportsPath}/status-breakdown?from=2026-10-02&to=2026-10-02`);
    const workload = await agent.get(`${reportsPath}/workload?from=2026-10-02&to=2026-10-02`);
    const overdue = await agent.get(`${reportsPath}/overdue?from=2026-10-02&to=2026-10-02`);
    const aging = await agent.get(`${reportsPath}/aging?from=2026-10-02&to=2026-10-02`);
    const throughput = await agent.get(`${reportsPath}/throughput?from=2026-10-02&to=2026-10-02`);
    const burndown = await agent.get(`${reportsPath}/burndown?from=2026-10-02&to=2026-10-02`);

    expect(status.body.items).toHaveLength(5);
    expect(status.body.items.every((entry: { value: number }) => entry.value === 0)).toBe(true);
    expect(workload.body.assignees).toEqual([{
      assigneeId: null,
      name: 'Unassigned',
      totalOpen: 0,
      byPriority: [
        { bucket: 'P0', value: 0 },
        { bucket: 'P1', value: 0 },
        { bucket: 'P2', value: 0 },
        { bucket: 'P3', value: 0 },
      ],
      overdue: 0,
    }]);
    expect(overdue.body.buckets.map((entry: { value: number }) => entry.value)).toEqual([0, 0, 0]);
    expect(overdue.body.mostOverdue).toEqual([]);
    expect(aging.body.byCreationAge.map((entry: { value: number }) => entry.value)).toEqual([0, 0, 0]);
    expect(aging.body.byLastActivity.map((entry: { value: number }) => entry.value)).toEqual([0, 0, 0]);
    expect(aging.body.staleItems).toEqual([]);
    expect(throughput.body.points).toEqual([{ bucket: '2026-10-02T00:00:00Z', value: 0 }]);
    expect(burndown.body.points).toEqual([{ bucket: '2026-10-02', value: 0 }]);
  });
});
