import { spawnSync } from 'node:child_process';

import { ItemPriority, ItemStatus, UserRole } from '@prisma/client';
import type { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { committedStatuses } from '../lib/item-status.js';

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
    where: { status?: { in: ItemStatus[] }; dueDate?: unknown; createdAt?: { gte: Date; lt: Date } };
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
        { status: ItemStatus.BACKLOG, _count: { _all: 3 } },
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
// Set REPORTS_TEST_DATABASE_URL (for example, postgresql:///tracker_backlog_validation) to run SQL fixtures.
// Fixtures shadow tables/types in pg_temp inside a rolled-back transaction, leaving existing data untouched.
const reportsDatabaseUrl = process.env.REPORTS_TEST_DATABASE_URL;

function executeReportSql(query: Prisma.Sql, fixture: string): unknown[] {
  if (!reportsDatabaseUrl) throw new Error('REPORTS_TEST_DATABASE_URL is required');
  const sql = query.text.replace(/\$(\d+)/g, (_placeholder, index: string) => {
    const value: unknown = query.values[Number(index) - 1];
    const literal = value instanceof Date ? value.toISOString() : String(value);
    return `'${literal.replaceAll("'", "''")}'`;
  });
  const result = spawnSync('psql', [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', reportsDatabaseUrl,
  ], {
    input: `
      BEGIN;
      CREATE TEMP TABLE report_fixture_init (id integer);
      SET LOCAL search_path = pg_temp, public;
      CREATE TYPE pg_temp."ItemStatus" AS ENUM ('BACKLOG', 'OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE');
      CREATE TYPE pg_temp."ActivityAction" AS ENUM ('STATUS_CHANGED', 'BULK_UPDATED', 'UPDATED');
      CREATE TEMP TABLE "Item" (
        "id" text, "projectId" text, "status" "ItemStatus",
        "createdAt" timestamp, "startedAt" timestamp, "closedAt" timestamp
      );
      CREATE TEMP TABLE "ActivityLog" (
        "id" text, "itemId" text, "projectId" text, "createdAt" timestamp,
        "field" text, "oldValue" text, "newValue" text, "action" "ActivityAction"
      );
      ${fixture}
      SELECT COALESCE(json_agg(report_row), '[]'::json) FROM (${sql}) report_row;
      ROLLBACK;
    `,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`PostgreSQL report fixture failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim()) as unknown[];
}

describe('project report routes', () => {
  it('returns all six chartable aggregates, including stable status and priority buckets', async () => {
    const { agent, state } = await createHarness();
    state.queryRows.push(
      [{ bucket: '1-7 days', value: 2n }, { bucket: '8-30 days', value: 1n }],
      [{ id: 'item-1', key: 'APP-1', title: 'Overdue item', status: ItemStatus.OPEN, priority: ItemPriority.P1, dueDate: new Date('2026-09-01T00:00:00Z'), assigneeName: 'Ava Developer', createdAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z') }],
      [{ kind: 'creation', bucket: '8-30 days', value: 2n }, { kind: 'activity', bucket: '31+ days', value: 1n }],
      [],
      [{
        bucket: '2026-09-28T00:00:00Z', value: 3n,
        cycleMedian: 1.5, cycleP85: 2.2, cycleSampleCount: 2n, cycleExcludedCount: 1n,
        leadMedian: 3.5, leadP85: 5.6, leadSampleCount: 3n,
      }],
      [{ bucket: '2026-10-01', value: 4n }, { bucket: '2026-10-02', value: 3n }],
    );

    const status = await agent.get(`${reportsPath}/status-breakdown?from=2026-10-01&to=2026-10-02`);
    expect(status.status).toBe(200);
    expect(status.body.items).toEqual(Object.values(ItemStatus).map((bucket) => ({
      bucket,
      value: bucket === ItemStatus.BACKLOG ? 3 : bucket === ItemStatus.OPEN ? 2 : bucket === ItemStatus.DONE ? 1 : 0,
    })));
    expect(state.itemGroupBy.mock.calls[0][0].where.status).toBeUndefined();

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
    for (const [args] of state.itemGroupBy.mock.calls.slice(1)) {
      expect(args.where.status).toEqual({ in: committedStatuses });
    }

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
      points: [{
        bucket: '2026-09-28T00:00:00Z', value: 3,
        cycleTime: { median: 1.5, p85: 2.2, sampleCount: 2, excludedCount: 1 },
        leadTime: { median: 3.5, p85: 5.6, sampleCount: 3 },
      }],
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
    expect(state.queryRaw).toHaveBeenCalledTimes(6);
    for (const [query] of state.queryRaw.mock.calls.filter((_, index) => index !== 4)) {
      expect(query.sql).toMatch(/(?:i\."status"|h\.status) IN \(/);
      for (const status of committedStatuses) expect(query.values).toContain(status);
      expect(query.values).not.toContain(ItemStatus.BACKLOG);
      expect(query.values).not.toContain(ItemStatus.DONE);
      expect(query.sql).not.toContain('<>');
    }
    expect(state.sqlQueries[5]).toContain('FILTER (WHERE h.status IN');
    expect(state.sqlQueries[4]).toContain('FROM "ActivityLog" a');
    expect(state.sqlQueries[4]).toContain('percentile_cont(0.5)');
    expect(state.sqlQueries[4]).toContain('percentile_cont(0.85)');
    expect(state.sqlQueries[4]).toContain('i."closedAt" - i."startedAt"');
    expect(state.sqlQueries[4]).toContain('i."closedAt" - i."createdAt"');
    expect(state.sqlQueries[4]).toContain('/ 86400.0');
    expect(state.sqlQueries[4]).toContain('WHERE i."startedAt" IS NULL');
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
      [{
        bucket: '2026-10-02T00:00:00Z', value: 0n,
        cycleMedian: null, cycleP85: null, cycleSampleCount: 0n, cycleExcludedCount: 0n,
        leadMedian: null, leadP85: null, leadSampleCount: 0n,
      }],
      [{ bucket: '2026-10-02', value: 0n }],
    );
    const status = await agent.get(`${reportsPath}/status-breakdown?from=2026-10-02&to=2026-10-02`);
    const workload = await agent.get(`${reportsPath}/workload?from=2026-10-02&to=2026-10-02`);
    const overdue = await agent.get(`${reportsPath}/overdue?from=2026-10-02&to=2026-10-02`);
    const aging = await agent.get(`${reportsPath}/aging?from=2026-10-02&to=2026-10-02`);
    const throughput = await agent.get(`${reportsPath}/throughput?from=2026-10-02&to=2026-10-02`);
    const burndown = await agent.get(`${reportsPath}/burndown?from=2026-10-02&to=2026-10-02`);

    expect(status.body.items).toHaveLength(Object.values(ItemStatus).length);
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
    expect(throughput.body.points).toEqual([{
      bucket: '2026-10-02T00:00:00Z', value: 0,
      cycleTime: { median: null, p85: null, sampleCount: 0, excludedCount: 0 },
      leadTime: { median: null, p85: null, sampleCount: 0 },
    }]);
    expect(burndown.body.points).toEqual([{ bucket: '2026-10-02', value: 0 }]);
  });

  it.skipIf(!reportsDatabaseUrl)('computes fractional-day even/odd percentiles from seeded PostgreSQL items, independently of completion events', async () => {
    const { agent, state } = await createHarness();
    const fixture = `
      INSERT INTO "Item" VALUES
        ('even-1', 'project-1', 'DONE', '2026-09-30', '2026-10-01', '2026-10-01 12:00'),
        ('even-2', 'project-1', 'DONE', '2026-09-28', '2026-09-30', '2026-10-01 12:00'),
        ('no-start', 'project-1', 'DONE', '2026-09-29 12:00', NULL, '2026-10-01 12:00'),
        ('odd-1', 'project-1', 'DONE', '2026-09-30 12:00', '2026-10-01 12:00', '2026-10-02 12:00'),
        ('odd-2', 'project-1', 'DONE', '2026-09-28 12:00', '2026-09-30 12:00', '2026-10-02 12:00'),
        ('odd-3', 'project-1', 'DONE', '2026-09-26 12:00', '2026-09-28 12:00', '2026-10-02 12:00'),
        ('only-no-start', 'project-1', 'DONE', '2026-10-03 06:00', NULL, '2026-10-03 12:00'),
        ('outside-project', 'project-2', 'DONE', '2026-01-01', '2026-01-01', '2026-10-01'),
        ('outside-range', 'project-1', 'DONE', '2026-01-01', '2026-01-01', '2026-10-05'),
        ('not-closed', 'project-1', 'IN_PROGRESS', '2026-01-01', '2026-01-01', NULL);
      INSERT INTO "ActivityLog" VALUES
        ('log-1', 'even-1', 'project-1', '2026-10-01', 'status', 'IN_REVIEW', 'DONE', 'STATUS_CHANGED'),
        ('log-2', 'even-2', 'project-1', '2026-10-01 12:00', 'status', 'IN_PROGRESS', 'DONE', 'BULK_UPDATED'),
        ('log-3', 'no-start', 'project-1', '2026-10-01 12:00', 'status', 'OPEN', 'DONE', 'STATUS_CHANGED'),
        ('recompleted', 'even-1', 'project-1', '2026-10-02', 'status', 'IN_REVIEW', 'DONE', 'STATUS_CHANGED'),
        ('not-completed', 'odd-1', 'project-1', '2026-10-01', 'status', 'OPEN', 'IN_PROGRESS', 'STATUS_CHANGED'),
        ('wrong-action', 'odd-2', 'project-1', '2026-10-01', 'status', 'OPEN', 'DONE', 'UPDATED'),
        ('wrong-project', 'outside-project', 'project-2', '2026-10-01', 'status', 'OPEN', 'DONE', 'STATUS_CHANGED'),
        ('outside-range', 'outside-range', 'project-1', '2026-10-05', 'status', 'OPEN', 'DONE', 'STATUS_CHANGED');
    `;
    state.queryRaw.mockImplementation(async (query) => executeReportSql(query, fixture));
    const daily = await agent.get(`${reportsPath}/throughput?from=2026-10-01&to=2026-10-04`);
    expect(daily.status).toBe(200);
    expect(daily.body.points).toHaveLength(4);
    expect(daily.body.points[0]).toEqual({
      bucket: '2026-10-01T00:00:00Z', value: 3,
      cycleTime: { median: 1, p85: 1.35, sampleCount: 2, excludedCount: 1 },
      leadTime: { median: 2, p85: 3.05, sampleCount: 3 },
    });
    expect(daily.body.points[1]).toEqual({
      bucket: '2026-10-02T00:00:00Z', value: 1,
      cycleTime: { median: 2, p85: 3.4, sampleCount: 3, excludedCount: 0 },
      leadTime: { median: 4, p85: 5.4, sampleCount: 3 },
    });
    expect(daily.body.points[2]).toEqual({
      bucket: '2026-10-03T00:00:00Z', value: 0,
      cycleTime: { median: null, p85: null, sampleCount: 0, excludedCount: 1 },
      leadTime: { median: 0.25, p85: 0.25, sampleCount: 1 },
    });
    expect(daily.body.points[3]).toEqual({
      bucket: '2026-10-04T00:00:00Z', value: 0,
      cycleTime: { median: null, p85: null, sampleCount: 0, excludedCount: 0 },
      leadTime: { median: null, p85: null, sampleCount: 0 },
    });
    const weekly = await agent.get(`${reportsPath}/throughput?from=2026-10-01&to=2026-10-04&interval=week`);
    expect(weekly.status).toBe(200);
    expect(weekly.body.points).toHaveLength(1);
    expect(weekly.body.points[0].value).toBe(4);
    expect(weekly.body.points[0].cycleTime).toEqual({ median: 1.5, p85: 2.8, sampleCount: 5, excludedCount: 2 });
    expect(weekly.body.points[0].leadTime.median).toBe(2);
    expect(weekly.body.points[0].leadTime.p85).toBeCloseTo(4.2);
    expect(weekly.body.points[0].leadTime.sampleCount).toBe(7);
    expect(state.queryRaw).toHaveBeenCalledTimes(2);
  });

  it.skipIf(!reportsDatabaseUrl)('counts historical committed statuses rather than current status in seeded PostgreSQL burndown', async () => {
    const { agent, state } = await createHarness();
    state.queryRaw.mockImplementation(async (query) => executeReportSql(query, `
      INSERT INTO "Item" VALUES
        ('committed-later', 'project-1', 'OPEN', '2026-10-01', NULL, NULL),
        ('completed', 'project-1', 'DONE', '2026-10-01', NULL, '2026-10-02 12:00'),
        ('backlog', 'project-1', 'BACKLOG', '2026-10-01', NULL, NULL),
        ('returned-backlog', 'project-1', 'BACKLOG', '2026-10-01', NULL, NULL),
        ('other-project', 'project-2', 'OPEN', '2026-10-01', NULL, NULL),
        ('future', 'project-1', 'OPEN', '2026-10-03', NULL, NULL);
      INSERT INTO "ActivityLog" VALUES
        ('log-1', 'committed-later', 'project-1', '2026-10-02', 'status', 'BACKLOG', 'OPEN', 'STATUS_CHANGED'),
        ('log-2', 'completed', 'project-1', '2026-10-02 12:00', 'status', 'IN_REVIEW', 'DONE', 'BULK_UPDATED'),
        ('log-3', 'returned-backlog', 'project-1', '2026-10-02 12:00', 'status', 'BLOCKED', 'BACKLOG', 'STATUS_CHANGED');
    `));
    const response = await agent.get(`${reportsPath}/burndown?from=2026-10-01&to=2026-10-02`);
    expect(response.status).toBe(200);
    expect(response.body.points).toEqual([
      { bucket: '2026-10-01', value: 2 },
      { bucket: '2026-10-02', value: 1 },
    ]);
  });
});
