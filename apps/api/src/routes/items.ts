import { ItemPriority, ItemRisk, ItemStatus, ItemType, UserRole } from '@prisma/client';
import { Router } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { asyncHandler, parseJsonField } from '../lib/http.js';
import { buildItemWhere, itemFiltersSchema, sortItems } from '../lib/item-filters.js';
import { prisma } from '../lib/prisma.js';
import { calculateItemScore } from '../lib/score.js';
import { normalizeImportRows, parseCsvRows } from '../lib/csv.js';
import { canEditItem } from '../lib/permissions.js';
import { recordItemChanges, recordItemCreation, recordItemDeletion } from '../lib/activity.js';
import { notifyItemChanges, notifyItemCreated } from '../lib/notifications.js';
import { localStorage } from '../lib/storage/local.js';
import { requireAuth } from '../middleware/auth.js';

const upload = multer({ storage: multer.memoryStorage() });

const itemSchema = z.object({
  projectId: z.string().min(1),
  type: z.nativeEnum(ItemType),
  title: z.string().min(2),
  description: z.string().default(''),
  status: z.nativeEnum(ItemStatus).default(ItemStatus.OPEN),
  priority: z.nativeEnum(ItemPriority).default(ItemPriority.P2),
  risk: z.nativeEnum(ItemRisk).default(ItemRisk.MEDIUM),
  assigneeId: z.string().nullable().optional(),
  reporterId: z.string().min(1),
  dueDate: z.string().nullable().optional(),
  estimateHours: z.coerce.number().nullable().optional(),
  spentHours: z.coerce.number().min(0).default(0),
  tags: z.array(z.string()).default([]),
});

const querySchema = z.object({
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  unassigned: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  type: z.union([z.string(), z.array(z.string())]).optional(),
  priority: z.union([z.string(), z.array(z.string())]).optional(),
  risk: z.union([z.string(), z.array(z.string())]).optional(),
  search: z.string().optional(),
  dueBefore: z.string().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const bulkUpdateSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().min(1),
      type: z.nativeEnum(ItemType).optional(),
      title: z.string().min(2).optional(),
      description: z.string().optional(),
      status: z.nativeEnum(ItemStatus).optional(),
      priority: z.nativeEnum(ItemPriority).optional(),
      risk: z.nativeEnum(ItemRisk).optional(),
      assigneeId: z.string().nullable().optional(),
      reporterId: z.string().min(1).optional(),
      dueDate: z.string().nullable().optional(),
      estimateHours: z.coerce.number().nullable().optional(),
      spentHours: z.coerce.number().min(0).optional(),
      tags: z.array(z.string()).optional(),
    }),
  ).min(1),
});

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

const itemInclude = {
  project: { select: { id: true, name: true, code: true } },
  assignee: { select: { id: true, name: true, email: true, role: true } },
  reporter: { select: { id: true, name: true, email: true, role: true } },
};

async function nextItemKey(tx: typeof prisma, projectId: string) {
  const project = await tx.project.update({
    where: { id: projectId },
    data: { nextItemNum: { increment: 1 } },
    select: { code: true, nextItemNum: true },
  });
  if (!project) throw new AppError(404, 'Project not found');
  return `${project.code}-${project.nextItemNum}`;
}

async function assertCanCreateItem(
  user: { id: string; role: UserRole },
  projectId: string,
  reporterId: string,
  assigneeId: string | null | undefined,
) {
  if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
    return;
  }

  const membership = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    throw new AppError(403, 'Developers can only create items in projects they belong to');
  }

  if (reporterId !== user.id) {
    throw new AppError(403, 'Developers can only report items as themselves');
  }

  if (assigneeId && assigneeId !== user.id) {
    throw new AppError(403, 'Developers can only self-assign items they create');
  }
}

function normalizeQueryArray(value?: string | string[]) {
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(',').filter(Boolean);
}

function applyReadScope(baseWhere: Record<string, unknown>, user?: { id: string; role: UserRole }) {
  if (!user || user.role !== UserRole.DEVELOPER) {
    return baseWhere;
  }

  return {
    AND: [
      baseWhere,
      {
        project: {
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
      },
    ],
  };
}

async function listItems(rawQuery: unknown, user?: { id: string; role: UserRole }, options?: { exportAll?: boolean }) {
  const query = querySchema.parse(rawQuery);
  const filters = itemFiltersSchema.parse({
    projectId: query.projectId,
    assigneeId: query.assigneeId,
    unassigned: query.unassigned,
    statuses: normalizeQueryArray(query.status),
    types: normalizeQueryArray(query.type),
    priorities: normalizeQueryArray(query.priority),
    risks: normalizeQueryArray(query.risk),
    search: query.search,
    dueBefore: query.dueBefore,
  });

  const where = applyReadScope(buildItemWhere(filters), user);
  const rows = await prisma.item.findMany({ where, include: itemInclude });
  const enriched = rows.map((item) => ({ ...item, score: calculateItemScore(item) }));
  const sorted = sortItems(enriched, query.sort);
  const start = (query.page - 1) * query.pageSize;
  const paged = options?.exportAll ? sorted : sorted.slice(start, start + query.pageSize);

  return {
    items: paged,
    total: sorted.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

itemsRouter.get('/', asyncHandler(async (req, res) => {
  res.json(await listItems(req.query, req.user));
}));

itemsRouter.post('/', asyncHandler(async (req, res) => {
  const input = itemSchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertCanCreateItem(req.user, input.projectId, input.reporterId, input.assigneeId);

  const item = await prisma.$transaction(async (tx) => {
    const key = await nextItemKey(tx as typeof prisma, input.projectId);
    const created = await tx.item.create({
      data: {
        projectId: input.projectId,
        key,
        type: input.type,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        risk: input.risk,
        assigneeId: input.assigneeId || null,
        reporterId: input.reporterId,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        estimateHours: input.estimateHours ?? null,
        spentHours: input.spentHours,
        tags: input.tags,
        closedAt: input.status === ItemStatus.DONE ? new Date() : null,
      },
      include: itemInclude,
    });
    await recordItemCreation(tx, { userId: req.user!.id, item: created });
    await notifyItemCreated(tx, { actorId: req.user!.id, item: created });
    return created;
  });

  res.status(201).json({ item: { ...item, score: calculateItemScore(item) } });
}));

itemsRouter.patch('/bulk', asyncHandler(async (req, res) => {
  const input = bulkUpdateSchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');

  const ids = input.updates.map((entry) => entry.id);
  const existing = await prisma.item.findMany({ where: { id: { in: ids } } });
  const byId = new Map(existing.map((item) => [item.id, item]));
  const errors: Record<string, string> = {};

  for (const update of input.updates) {
    const item = byId.get(update.id);
    if (!item) {
      errors[update.id] = 'Item not found';
      continue;
    }
    if (!canEditItem(req.user.id, req.user.role, item)) {
      errors[update.id] = 'You cannot edit this item';
      continue;
    }

    const nextProjectId = item.projectId;
    const nextReporterId = update.reporterId ?? item.reporterId;
    const nextAssigneeId = update.assigneeId === undefined ? item.assigneeId : update.assigneeId;
    try {
      await assertCanCreateItem(req.user, nextProjectId, nextReporterId, nextAssigneeId);
    } catch (error) {
      errors[update.id] = error instanceof AppError ? error.message : 'Invalid update';
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(403, 'Bulk update rejected', { perItem: errors });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const update of input.updates) {
      const before = await tx.item.findUnique({ where: { id: update.id } });
      if (!before) throw new AppError(404, 'Item not found');
      const after = await tx.item.update({
        where: { id: update.id },
        data: {
          type: update.type,
          title: update.title,
          description: update.description,
          status: update.status,
          priority: update.priority,
          risk: update.risk,
          assigneeId: update.assigneeId === undefined ? undefined : update.assigneeId || null,
          reporterId: update.reporterId,
          dueDate: update.dueDate === undefined ? undefined : update.dueDate ? new Date(update.dueDate) : null,
          estimateHours: update.estimateHours === undefined ? undefined : update.estimateHours,
          spentHours: update.spentHours,
          tags: update.tags,
          closedAt: update.status ? (update.status === ItemStatus.DONE ? new Date() : null) : undefined,
        },
        include: itemInclude,
      });
      await recordItemChanges(tx, { userId: req.user!.id, before, after, bulk: true });
      await notifyItemChanges(tx, { actorId: req.user!.id, before, after });
      results.push(after);
    }
    return results;
  });

  res.json({
    items: updated.map((item) => ({ ...item, score: calculateItemScore(item) })),
  });
}));

itemsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const itemId = z.string().parse(req.params.id);
  const input = itemSchema.partial().parse(req.body);
  const existing = await prisma.item.findUnique({ where: { id: itemId } });
  if (!existing) throw new AppError(404, 'Item not found');
  if (!req.user || !canEditItem(req.user.id, req.user.role, existing)) {
    throw new AppError(403, 'You cannot edit this item');
  }
  if (input.projectId && input.projectId !== existing.projectId) {
    throw new AppError(400, 'Moving items between projects is not supported in Phase 1');
  }

  const nextProjectId = input.projectId ?? existing.projectId;
  const nextReporterId = input.reporterId ?? existing.reporterId;
  const nextAssigneeId = input.assigneeId === undefined ? existing.assigneeId : input.assigneeId;
  await assertCanCreateItem(req.user, nextProjectId, nextReporterId, nextAssigneeId);

  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.item.findUnique({ where: { id: itemId } });
    if (!before) throw new AppError(404, 'Item not found');
    if (!canEditItem(req.user!.id, req.user!.role, before)) {
      throw new AppError(403, 'You cannot edit this item');
    }
    const after = await tx.item.update({
      where: { id: itemId },
      data: {
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        risk: input.risk,
        assigneeId: input.assigneeId === undefined ? undefined : input.assigneeId || null,
        reporterId: input.reporterId,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
        estimateHours: input.estimateHours === undefined ? undefined : input.estimateHours,
        spentHours: input.spentHours,
        tags: input.tags,
        closedAt: input.status ? (input.status === ItemStatus.DONE ? new Date() : null) : undefined,
      },
      include: itemInclude,
    });
    await recordItemChanges(tx, { userId: req.user!.id, before, after });
    await notifyItemChanges(tx, { actorId: req.user!.id, before, after });
    return after;
  });

  res.json({ item: { ...item, score: calculateItemScore(item) } });
}));

itemsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const itemId = z.string().parse(req.params.id);
  const existing = await prisma.item.findUnique({ where: { id: itemId } });
  if (!existing) throw new AppError(404, 'Item not found');
  if (!req.user || !canEditItem(req.user.id, req.user.role, existing)) {
    throw new AppError(403, 'You cannot delete this item');
  }

  const attachments = await prisma.attachment.findMany({
    where: { itemId },
    select: { storageKey: true },
  });
  await prisma.$transaction((tx) => recordItemDeletion(tx, {
    userId: req.user!.id,
    item: existing,
  }));
  await Promise.all(attachments.map((attachment) => localStorage.delete(attachment.storageKey)));
  res.status(204).send();
}));

itemsRouter.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError(400, 'CSV file is required');
  }

  const mapping = req.body.mapping
    ? parseJsonField(req.body.mapping, z.record(z.string(), z.string()), 'mapping')
    : undefined;
  if (!req.user) throw new AppError(401, 'Authentication required');
  const parsed = parseCsvRows(req.file.buffer.toString('utf-8'));
  const normalized = normalizeImportRows(parsed.data, mapping);
  const errors = normalized.filter((entry) => entry.errors.length > 0).map((entry) => ({ row: entry.index + 2, errors: entry.errors }));
  const validRows = normalized.flatMap((entry) => (entry.data ? [entry.data] : []));
  const projectCodes = Array.from(new Set(validRows.map((row) => row.projectCode)));
  const userEmails = Array.from(
    new Set(validRows.flatMap((row) => [row.reporterEmail, row.assigneeEmail].filter(Boolean) as string[])),
  );
  const [projects, users] = await Promise.all([
    prisma.project.findMany({ where: { code: { in: projectCodes } } }),
    prisma.user.findMany({ where: { email: { in: userEmails } } }),
  ]);
  const projectMap = new Map(projects.map((project) => [project.code, project]));
  const userMap = new Map(users.map((user) => [user.email, user]));

  const created = [];
  for (const entry of normalized) {
    const data = entry.data;
    if (!data) continue;

    const project = projectMap.get(data.projectCode) ?? null;
    const assignee = data.assigneeEmail ? (userMap.get(data.assigneeEmail) ?? null) : null;
    const reporter = userMap.get(data.reporterEmail) ?? null;

    if (!project || !reporter || (data.assigneeEmail && !assignee)) {
      errors.push({
        row: entry.index + 2,
        errors: [
          !project ? `projectCode: Unknown project ${data.projectCode}` : '',
          !reporter ? `reporterEmail: Unknown user ${data.reporterEmail}` : '',
          data.assigneeEmail && !assignee ? `assigneeEmail: Unknown user ${data.assigneeEmail}` : '',
        ].filter(Boolean),
      });
      continue;
    }
    await assertCanCreateItem(req.user, project.id, reporter.id, assignee?.id ?? null);

    const item = await prisma.$transaction(async (tx) => {
      const key = await nextItemKey(tx as typeof prisma, project.id);
      const imported = await tx.item.create({
        data: {
          projectId: project.id,
          key,
          type: data.type,
          title: data.title,
          description: data.description,
          status: data.status,
          priority: data.priority,
          risk: data.risk,
          assigneeId: assignee?.id ?? null,
          reporterId: reporter.id,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          estimateHours: data.estimateHours,
          spentHours: data.spentHours ?? 0,
          tags: data.tags ? data.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
          closedAt: data.status === ItemStatus.DONE ? new Date() : null,
        },
        include: itemInclude,
      });
      await recordItemCreation(tx, { userId: req.user!.id, item: imported, imported: true });
      await notifyItemCreated(tx, { actorId: req.user!.id, item: imported });
      return imported;
    });
    created.push({ ...item, score: calculateItemScore(item) });
  }

  res.json({ createdCount: created.length, created, errors });
}));

itemsRouter.get('/export', asyncHandler(async (req, res) => {
  const result = await listItems(req.query, req.user, { exportAll: true });
  const csv = Papa.unparse(result.items.map((item) => ({
    key: item.key,
    projectCode: item.project.code,
    title: item.title,
    description: item.description,
    type: item.type,
    status: item.status,
    priority: item.priority,
    risk: item.risk,
    assignee: item.assignee?.email ?? '',
    reporter: item.reporter.email,
    dueDate: item.dueDate ? item.dueDate.toISOString().slice(0, 10) : '',
    estimateHours: item.estimateHours ?? '',
    spentHours: item.spentHours,
    score: item.score,
    tags: item.tags.join(','),
  })));

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="items-export.csv"');
  res.send(csv);
}));
