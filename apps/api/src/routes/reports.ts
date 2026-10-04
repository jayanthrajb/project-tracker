import { ItemPriority, ItemStatus, Prisma } from '@prisma/client';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { assertProjectReadable } from '../lib/access.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { committedStatuses } from '../lib/item-status.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

type ReportBucket = '1-7 days' | '8-30 days' | '31+ days';
type TimeSeriesPoint = { bucket: string; value: number };

export type StatusBreakdownResponse = {
  items: { bucket: ItemStatus; value: number }[];
};
export type WorkloadResponse = {
  assignees: {
    assigneeId: string | null;
    name: string;
    totalOpen: number;
    byPriority: { bucket: ItemPriority; value: number }[];
    overdue: number;
  }[];
};
export type ReportItem = {
  id: string;
  key: string;
  title: string;
  status: ItemStatus;
  priority: ItemPriority;
  dueDate: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
};
export type OverdueResponse = {
  buckets: { bucket: ReportBucket; value: number }[];
  mostOverdue: ReportItem[];
};
export type AgingResponse = {
  byCreationAge: { bucket: ReportBucket; value: number }[];
  byLastActivity: { bucket: ReportBucket; value: number }[];
  staleItems: ReportItem[];
};
export type ThroughputResponse = {
  interval: 'day' | 'week';
  points: ThroughputPoint[];
};
/** Percentile durations are measured in fractional days. */
export type DurationMetrics = {
  median: number | null;
  p85: number | null;
  sampleCount: number;
};
export type ThroughputPoint = TimeSeriesPoint & {
  cycleTime?: DurationMetrics & { excludedCount: number };
  leadTime?: DurationMetrics;
};
export type BurndownResponse = { points: TimeSeriesPoint[] };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(datePattern, 'Expected YYYY-MM-DD date').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Expected a valid calendar date');
const rangeQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});
const throughputQuerySchema = rangeQuerySchema.extend({
  interval: z.enum(['day', 'week']).default('day'),
});

type DateRange = { from: Date; to: Date; toExclusive: Date };

function resolveRange(query: z.infer<typeof rangeQuerySchema>): DateRange {
  const today = new Date();
  const defaultTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const to = new Date(`${query.to ?? defaultTo.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const defaultFrom = new Date(to);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const from = new Date(`${query.from ?? defaultFrom.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const toExclusive = new Date(to);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const days = (toExclusive.getTime() - from.getTime()) / 86_400_000;
  if (days <= 0 || days > 366) throw new AppError(400, 'Date range must be valid and no longer than 366 days');
  return { from, to, toExclusive };
}

const reportBuckets: ReportBucket[] = ['1-7 days', '8-30 days', '31+ days'];
const openStatusWhere = { in: committedStatuses };
const committedStatusSql = Prisma.join(committedStatuses.map((status) => Prisma.sql`${status}::"ItemStatus"`));
const priorities = Object.values(ItemPriority);
const statuses = Object.values(ItemStatus);

function countByBucket(rows: { bucket: string; value: number | bigint }[]) {
  const counts = new Map(rows.map((row) => [row.bucket, Number(row.value)]));
  return reportBuckets.map((bucket) => ({ bucket, value: counts.get(bucket) ?? 0 }));
}

export const reportsRouter = Router();
reportsRouter.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'Too many requests, please try again later.')),
}), requireAuth);

reportsRouter.get('/:id/reports/status-breakdown', asyncHandler(async (req, res) => {
  const projectId = z.string().min(1).parse(req.params.id);
  const query = rangeQuerySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertProjectReadable(projectId, req.user);
  const range = resolveRange(query);
  const grouped = await prisma.item.groupBy({
    by: ['status'],
    where: { projectId, createdAt: { gte: range.from, lt: range.toExclusive } },
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
  const response: StatusBreakdownResponse = {
    items: statuses.map((status) => ({ bucket: status, value: counts.get(status) ?? 0 })),
  };
  res.json(response);
}));

reportsRouter.get('/:id/reports/workload', asyncHandler(async (req, res) => {
  const projectId = z.string().min(1).parse(req.params.id);
  const query = rangeQuerySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertProjectReadable(projectId, req.user);
  const range = resolveRange(query);
  const where = {
    projectId,
    status: openStatusWhere,
    createdAt: { gte: range.from, lt: range.toExclusive },
  };
  const [openGroups, priorityGroups, overdueGroups] = await Promise.all([
    prisma.item.groupBy({ by: ['assigneeId'], where, _count: { _all: true } }),
    prisma.item.groupBy({ by: ['assigneeId', 'priority'], where, _count: { _all: true } }),
    prisma.item.groupBy({
      by: ['assigneeId'],
      where: { ...where, dueDate: { lt: range.to } },
      _count: { _all: true },
    }),
  ]);
  const ids = [...new Set(openGroups.map((row) => row.assigneeId).filter((id): id is string => id !== null))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((user) => [user.id, user.name]));
  const openCounts = new Map(openGroups.map((row) => [row.assigneeId, row._count._all]));
  const overdueCounts = new Map(overdueGroups.map((row) => [row.assigneeId, row._count._all]));
  const assignees: WorkloadResponse['assignees'] = openGroups.map(({ assigneeId }) => ({
    assigneeId,
    name: assigneeId === null ? 'Unassigned' : names.get(assigneeId) ?? 'Unknown user',
    totalOpen: openCounts.get(assigneeId) ?? 0,
    byPriority: priorities.map((priority) => ({
      bucket: priority,
      value: priorityGroups.find((row) => row.assigneeId === assigneeId && row.priority === priority)?._count._all ?? 0,
    })),
    overdue: overdueCounts.get(assigneeId) ?? 0,
  }));
  if (!assignees.some((entry) => entry.assigneeId === null)) {
    assignees.push({
      assigneeId: null,
      name: 'Unassigned',
      totalOpen: 0,
      byPriority: priorities.map((priority) => ({ bucket: priority, value: 0 })),
      overdue: 0,
    });
  }
  res.json({ assignees });
}));

reportsRouter.get('/:id/reports/overdue', asyncHandler(async (req, res) => {
  const projectId = z.string().min(1).parse(req.params.id);
  const query = rangeQuerySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertProjectReadable(projectId, req.user);
  const range = resolveRange(query);
  const buckets = await prisma.$queryRaw<{ bucket: string; value: bigint }[]>(Prisma.sql`
    SELECT CASE
      WHEN (${range.to}::timestamptz AT TIME ZONE 'UTC')::date - i."dueDate"::date <= 7 THEN '1-7 days'
      WHEN (${range.to}::timestamptz AT TIME ZONE 'UTC')::date - i."dueDate"::date <= 30 THEN '8-30 days'
      ELSE '31+ days'
    END AS bucket, COUNT(*)::bigint AS value
    FROM "Item" i
    WHERE i."projectId" = ${projectId}
      AND i."status" IN (${committedStatusSql})
      AND i."createdAt" < (${range.toExclusive}::timestamptz AT TIME ZONE 'UTC')
      AND i."dueDate" < (${range.to}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY bucket
  `);
  const mostOverdue = await prisma.$queryRaw<ReportItem[]>(Prisma.sql`
    SELECT i."id", i."key", i."title", i."status", i."priority",
      to_char(i."dueDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "dueDate",
      u."name" AS "assigneeName",
      to_char(i."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      to_char(i."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM "Item" i
    LEFT JOIN "User" u ON u."id" = i."assigneeId"
    WHERE i."projectId" = ${projectId}
      AND i."status" IN (${committedStatusSql})
      AND i."createdAt" < (${range.toExclusive}::timestamptz AT TIME ZONE 'UTC')
      AND i."dueDate" < (${range.to}::timestamptz AT TIME ZONE 'UTC')
    ORDER BY i."dueDate" ASC, i."id" ASC
    LIMIT 10
  `);
  const response: OverdueResponse = {
    buckets: countByBucket(buckets),
    mostOverdue,
  };
  res.json(response);
}));

reportsRouter.get('/:id/reports/aging', asyncHandler(async (req, res) => {
  const projectId = z.string().min(1).parse(req.params.id);
  const query = rangeQuerySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertProjectReadable(projectId, req.user);
  const range = resolveRange(query);
  const buckets = await prisma.$queryRaw<{ kind: string; bucket: string; value: bigint }[]>(Prisma.sql`
    SELECT 'creation' AS kind, CASE
      WHEN CEIL(EXTRACT(EPOCH FROM ((${range.toExclusive}::timestamptz AT TIME ZONE 'UTC') - i."createdAt")) / 86400) <= 7 THEN '1-7 days'
      WHEN CEIL(EXTRACT(EPOCH FROM ((${range.toExclusive}::timestamptz AT TIME ZONE 'UTC') - i."createdAt")) / 86400) <= 30 THEN '8-30 days'
      ELSE '31+ days'
    END AS bucket, COUNT(*)::bigint AS value
    FROM "Item" i
    WHERE i."projectId" = ${projectId} AND i."status" IN (${committedStatusSql})
      AND i."createdAt" < (${range.toExclusive}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY bucket
    UNION ALL
    SELECT 'activity' AS kind, CASE
      WHEN CEIL(EXTRACT(EPOCH FROM ((${range.toExclusive}::timestamptz AT TIME ZONE 'UTC') - i."updatedAt")) / 86400) <= 7 THEN '1-7 days'
      WHEN CEIL(EXTRACT(EPOCH FROM ((${range.toExclusive}::timestamptz AT TIME ZONE 'UTC') - i."updatedAt")) / 86400) <= 30 THEN '8-30 days'
      ELSE '31+ days'
    END AS bucket, COUNT(*)::bigint AS value
    FROM "Item" i
    WHERE i."projectId" = ${projectId} AND i."status" IN (${committedStatusSql})
      AND i."createdAt" < (${range.toExclusive}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY bucket
  `);
  const staleItems = await prisma.$queryRaw<ReportItem[]>(Prisma.sql`
    SELECT i."id", i."key", i."title", i."status", i."priority",
      to_char(i."dueDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "dueDate",
      u."name" AS "assigneeName",
      to_char(i."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      to_char(i."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM "Item" i
    LEFT JOIN "User" u ON u."id" = i."assigneeId"
    WHERE i."projectId" = ${projectId}
      AND i."status" IN (${committedStatusSql})
      AND i."createdAt" < (${range.toExclusive}::timestamptz AT TIME ZONE 'UTC')
      AND i."updatedAt" < (${new Date(range.toExclusive.getTime() - 7 * 86_400_000)}::timestamptz AT TIME ZONE 'UTC')
    ORDER BY i."updatedAt" ASC, i."id" ASC
    LIMIT 10
  `);
  const creationCounts = buckets.filter((row) => row.kind === 'creation');
  const activityCounts = buckets.filter((row) => row.kind === 'activity');
  const response: AgingResponse = {
    byCreationAge: countByBucket(creationCounts),
    byLastActivity: countByBucket(activityCounts),
    staleItems,
  };
  res.json(response);
}));

reportsRouter.get('/:id/reports/throughput', asyncHandler(async (req, res) => {
  const projectId = z.string().min(1).parse(req.params.id);
  const query = throughputQuerySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertProjectReadable(projectId, req.user);
  const range = resolveRange(query);
  const points = await prisma.$queryRaw<{
    bucket: string;
    value: bigint;
    cycleMedian: number | null;
    cycleP85: number | null;
    cycleSampleCount: bigint;
    cycleExcludedCount: bigint;
    leadMedian: number | null;
    leadP85: number | null;
    leadSampleCount: bigint;
  }[]>(Prisma.sql`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${query.interval}, ${range.from}::timestamptz AT TIME ZONE 'UTC'),
        date_trunc(${query.interval}, (${range.toExclusive}::timestamptz AT TIME ZONE 'UTC') - interval '1 millisecond'),
        ('1 ' || ${query.interval})::interval
      ) AS bucket
    ), totals AS (
      SELECT date_trunc(${query.interval}, a."createdAt") AS bucket, COUNT(*)::bigint AS value
      FROM "ActivityLog" a
      WHERE a."projectId" = ${projectId}
        AND a."createdAt" >= (${range.from}::timestamptz AT TIME ZONE 'UTC')
        AND a."createdAt" < (${range.toExclusive}::timestamptz AT TIME ZONE 'UTC')
        AND a."field" = 'status'
        AND a."newValue" = ${ItemStatus.DONE}
        AND a."action" IN ('STATUS_CHANGED'::"ActivityAction", 'BULK_UPDATED'::"ActivityAction")
      GROUP BY bucket
    ), durations AS (
      SELECT date_trunc(${query.interval}, i."closedAt") AS bucket,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (i."closedAt" - i."startedAt")) / 86400.0
        ) AS "cycleMedian",
        percentile_cont(0.85) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (i."closedAt" - i."startedAt")) / 86400.0
        ) AS "cycleP85",
        COUNT(i."startedAt")::bigint AS "cycleSampleCount",
        COUNT(*) FILTER (WHERE i."startedAt" IS NULL)::bigint AS "cycleExcludedCount",
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (i."closedAt" - i."createdAt")) / 86400.0
        ) AS "leadMedian",
        percentile_cont(0.85) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (i."closedAt" - i."createdAt")) / 86400.0
        ) AS "leadP85",
        COUNT(*)::bigint AS "leadSampleCount"
      FROM "Item" i
      WHERE i."projectId" = ${projectId}
        AND i."closedAt" >= (${range.from}::timestamptz AT TIME ZONE 'UTC')
        AND i."closedAt" < (${range.toExclusive}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY bucket
    )
    SELECT to_char(buckets.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket,
      COALESCE(totals.value, 0)::bigint AS value,
      durations."cycleMedian", durations."cycleP85",
      COALESCE(durations."cycleSampleCount", 0)::bigint AS "cycleSampleCount",
      COALESCE(durations."cycleExcludedCount", 0)::bigint AS "cycleExcludedCount",
      durations."leadMedian", durations."leadP85",
      COALESCE(durations."leadSampleCount", 0)::bigint AS "leadSampleCount"
    FROM buckets LEFT JOIN totals USING (bucket) LEFT JOIN durations USING (bucket)
    ORDER BY buckets.bucket
  `);
  const response: ThroughputResponse = {
    interval: query.interval,
    points: points.map((point) => ({
      bucket: point.bucket,
      value: Number(point.value),
      cycleTime: {
        median: point.cycleMedian,
        p85: point.cycleP85,
        sampleCount: Number(point.cycleSampleCount),
        excludedCount: Number(point.cycleExcludedCount),
      },
      leadTime: {
        median: point.leadMedian,
        p85: point.leadP85,
        sampleCount: Number(point.leadSampleCount),
      },
    })),
  };
  res.json(response);
}));

reportsRouter.get('/:id/reports/burndown', asyncHandler(async (req, res) => {
  const projectId = z.string().min(1).parse(req.params.id);
  const query = rangeQuerySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertProjectReadable(projectId, req.user);
  const range = resolveRange(query);
  const points = await prisma.$queryRaw<{ bucket: string; value: bigint }[]>(Prisma.sql`
    WITH days AS (
      SELECT generate_series(
        (${range.from}::timestamptz AT TIME ZONE 'UTC')::date,
        (${range.to}::timestamptz AT TIME ZONE 'UTC')::date,
        interval '1 day'
      )::date AS day
    ), snapshots AS (
      SELECT day, (day + 1)::timestamp AS cutoff
      FROM days
    ), historical_status AS (
      SELECT s.day, i."id",
        COALESCE((
          SELECT a."oldValue"
          FROM "ActivityLog" a
          WHERE a."itemId" = i."id"
            AND a."projectId" = ${projectId}
            AND a."field" = 'status'
            AND a."action" IN ('STATUS_CHANGED'::"ActivityAction", 'BULK_UPDATED'::"ActivityAction")
            AND a."createdAt" >= s.cutoff
          ORDER BY a."createdAt" ASC, a."id" ASC
          LIMIT 1
        ), i."status"::text) AS status
      FROM snapshots s
      JOIN "Item" i ON i."projectId" = ${projectId} AND i."createdAt" < s.cutoff
    )
    SELECT s.day::text AS bucket,
      COUNT(h."id") FILTER (WHERE h.status IN (${Prisma.join(committedStatuses)}))::bigint AS value
    FROM snapshots s
    LEFT JOIN historical_status h ON h.day = s.day
    GROUP BY s.day
    ORDER BY s.day
  `);
  const response: BurndownResponse = {
    points: points.map((point) => ({ bucket: point.bucket, value: Number(point.value) })),
  };
  res.json(response);
}));
