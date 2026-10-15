import { DependencyType, ItemPriority, ItemRisk, ItemStatus, ItemType, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
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
import { storage } from '../lib/storage/index.js';
import { itemStartData } from '../lib/item-status.js';
import { assertNoBlocksCycle, assertValidParent, normalizeDependency } from '../lib/item-relations.js';
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
  parentId: z.string().nullable().optional(),
});

const querySchema = z.object({
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  mine: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
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
      parentId: z.string().nullable().optional(),
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
type ItemRecord = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

const dependencySchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  type: z.nativeEnum(DependencyType).default(DependencyType.BLOCKS),
});

function itemLink(item: { id: string; key: string; title: string; status: ItemStatus; project: { code: string } }) {
  return { id: item.id, key: item.key, title: item.title, status: item.status, projectCode: item.project.code };
}

async function enrichItems(items: ItemRecord[], user?: { id: string; role: UserRole }) {
  if (items.length === 0) return [];
  const ids = items.map((item) => item.id);
  const [hierarchy, dependencies] = await Promise.all([
    prisma.item.findMany({
      where: { OR: [{ id: { in: ids } }, { parentId: { in: ids } }] },
      select: { id: true, parentId: true, key: true, title: true, status: true, project: { select: { code: true } } },
    }),
    prisma.itemDependency.findMany({
      where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] },
      select: { fromId: true, toId: true, type: true },
    }),
  ]);
  const linkedIds = new Set<string>();
  hierarchy.forEach((item) => {
    linkedIds.add(item.id);
    if (item.parentId) linkedIds.add(item.parentId);
  });
  dependencies.forEach((dependency) => {
    linkedIds.add(dependency.fromId);
    linkedIds.add(dependency.toId);
  });
  const readable = linkedIds.size === 0
    ? []
    : await prisma.item.findMany({
      where: applyReadScope({ id: { in: [...linkedIds] } }, user),
      select: { id: true, key: true, title: true, status: true, project: { select: { code: true } } },
    });
  const readableById = new Map(readable.map((item) => [item.id, itemLink(item)]));
  const parentById = new Map(hierarchy.filter((item) => item.parentId).map((item) => [item.id, item.parentId!]));

  return items.map((item) => {
    const children = hierarchy.filter((candidate) => candidate.parentId === item.id)
      .flatMap((candidate) => readableById.has(candidate.id) ? [readableById.get(candidate.id)!] : []);
    const related = (id: string) => readableById.get(id);
    return {
      ...item,
      parent: parentById.has(item.id) ? related(parentById.get(item.id)!) ?? null : null,
      children,
      blocks: dependencies.filter((dependency) => dependency.type === DependencyType.BLOCKS && dependency.fromId === item.id)
        .flatMap((dependency) => related(dependency.toId) ? [related(dependency.toId)!] : []),
      blockedBy: dependencies.filter((dependency) => dependency.type === DependencyType.BLOCKS && dependency.toId === item.id)
        .flatMap((dependency) => related(dependency.fromId) ? [related(dependency.fromId)!] : []),
      relatesTo: dependencies.filter((dependency) => dependency.type === DependencyType.RELATES_TO
        && (dependency.fromId === item.id || dependency.toId === item.id))
        .flatMap((dependency) => {
          const otherId = dependency.fromId === item.id ? dependency.toId : dependency.fromId;
          return related(otherId) ? [related(otherId)!] : [];
        }),
    };
  });
}

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

  const baseWhere = buildItemWhere(filters);
  if (query.mine) {
    if (!user) throw new AppError(401, 'Authentication required');
    baseWhere.AND = [{ OR: [{ assigneeId: user.id }, { reporterId: user.id }] }];
  }
  const where = applyReadScope(baseWhere, user);
  const rows = await prisma.item.findMany({ where, include: itemInclude });
  const related = await enrichItems(rows, user);
  const enriched = related.map((item) => ({ ...item, score: calculateItemScore(item) }));
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

itemsRouter.post('/dependencies', asyncHandler(async (req, res) => {
  const input = dependencySchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const [from, to] = await Promise.all([
    prisma.item.findUnique({ where: { id: input.fromId } }),
    prisma.item.findUnique({ where: { id: input.toId } }),
  ]);
  if (!from || !to) throw new AppError(404, 'Dependency item not found');
  if (!canEditItem(req.user.id, req.user.role, from)) {
    throw new AppError(403, 'You cannot edit the dependency source item');
  }

  const dependency = await prisma.$transaction(async (tx) => {
    const normalized = normalizeDependency(input.fromId, input.toId, input.type);
    if (normalized.type === DependencyType.BLOCKS) {
      await assertNoBlocksCycle(tx, normalized.fromId, normalized.toId);
    }
    return tx.itemDependency.upsert({
      where: {
        fromId_toId_type: {
          fromId: normalized.fromId,
          toId: normalized.toId,
          type: normalized.type,
        },
      },
      create: normalized,
      update: {},
    });
  });
  res.status(201).json({
    dependency: { id: dependency.id, type: dependency.type, createdAt: dependency.createdAt },
  });
}));

itemsRouter.delete('/dependencies/:id', asyncHandler(async (req, res) => {
  const dependencyId = z.string().min(1).parse(req.params.id);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const dependency = await prisma.itemDependency.findUnique({
    where: { id: dependencyId },
    include: { from: true, to: true },
  });
  if (!dependency) throw new AppError(404, 'Dependency not found');
  if (!canEditItem(req.user.id, req.user.role, dependency.from)
    && !canEditItem(req.user.id, req.user.role, dependency.to)) {
    throw new AppError(403, 'You cannot edit either dependency item');
  }
  await prisma.itemDependency.delete({ where: { id: dependencyId } });
  res.status(204).send();
}));

itemsRouter.post('/', asyncHandler(async (req, res) => {
  const input = itemSchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertCanCreateItem(req.user, input.projectId, input.reporterId, input.assigneeId);

  const item = await prisma.$transaction(async (tx) => {
    await assertValidParent(tx, undefined, input.projectId, input.parentId ?? null);
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
        parentId: input.parentId ?? null,
        closedAt: input.status === ItemStatus.DONE ? new Date() : null,
        ...await itemStartData(tx, input.status),
      },
      include: itemInclude,
    });
    await recordItemCreation(tx, { userId: req.user!.id, item: created });
    await notifyItemCreated(tx, { actorId: req.user!.id, item: created });
    return created;
  });

  const [enriched] = await enrichItems([item], req.user);
  res.status(201).json({ item: { ...enriched, score: calculateItemScore(item) } });
}));

itemsRouter.patch('/bulk', asyncHandler(async (req, res) => {
  const input = bulkUpdateSchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');

  const ids = input.updates.map((entry) => entry.id);
  const existing = await prisma.item.findMany({ where: { id: { in: ids } } });
  const byId = new Map(existing.map((item) => [item.id, item]));
  const errors: Record<string, string> = {};
  let invalidHierarchy = false;

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
      if (update.parentId !== undefined) {
        await assertValidParent(prisma, update.id, nextProjectId, update.parentId);
      }
    } catch (error) {
      errors[update.id] = error instanceof AppError ? error.message : 'Invalid update';
      if (error instanceof AppError && error.statusCode === 400 && update.parentId !== undefined) {
        invalidHierarchy = true;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(invalidHierarchy ? 400 : 403, 'Bulk update rejected', { perItem: errors });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const update of input.updates) {
      const before = await tx.item.findUnique({ where: { id: update.id } });
      if (!before) throw new AppError(404, 'Item not found');
      if (!canEditItem(req.user!.id, req.user!.role, before)) {
        throw new AppError(403, 'You cannot edit this item');
      }
      if (update.parentId !== undefined) {
        await assertValidParent(tx, update.id, before.projectId, update.parentId);
      }
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
          parentId: update.parentId,
          closedAt: update.status ? (update.status === ItemStatus.DONE ? new Date() : null) : undefined,
          ...await itemStartData(tx, update.status, update.id),
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
    items: (await enrichItems(updated, req.user)).map((item) => ({ ...item, score: calculateItemScore(item) })),
  });
}));

itemsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const itemId = z.string().parse(req.params.id);
  const parsed = itemSchema.partial().parse(req.body);
  const fields = Object.keys(req.body);
  const statusOnly = fields.length === 1 && fields[0] === 'status';
  // Partial schemas still apply defaults; status-only updates must not reset other fields.
  const input: typeof parsed = statusOnly ? { status: parsed.status } : parsed;
  const existing = await prisma.item.findUnique({ where: { id: itemId } });
  if (!existing) throw new AppError(404, 'Item not found');
  if (!req.user || !canEditItem(req.user.id, req.user.role, existing)) {
    throw new AppError(403, 'You cannot edit this item');
  }
  if (input.projectId && input.projectId !== existing.projectId) {
    throw new AppError(400, 'Moving items between projects is not supported in Phase 1');
  }

  const nextProjectId = input.projectId ?? existing.projectId;
  const nextReporterId = statusOnly ? req.user.id : input.reporterId ?? existing.reporterId;
  const nextAssigneeId = statusOnly ? undefined : input.assigneeId === undefined ? existing.assigneeId : input.assigneeId;
  await assertCanCreateItem(req.user, nextProjectId, nextReporterId, nextAssigneeId);

  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.item.findUnique({ where: { id: itemId } });
    if (!before) throw new AppError(404, 'Item not found');
    if (!canEditItem(req.user!.id, req.user!.role, before)) {
      throw new AppError(403, 'You cannot edit this item');
    }
    if (input.parentId !== undefined) {
      await assertValidParent(tx, itemId, before.projectId, input.parentId);
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
        parentId: input.parentId,
        closedAt: input.status ? (input.status === ItemStatus.DONE ? new Date() : null) : undefined,
        ...await itemStartData(tx, input.status, itemId),
      },
      include: itemInclude,
    });
    await recordItemChanges(tx, { userId: req.user!.id, before, after });
    await notifyItemChanges(tx, { actorId: req.user!.id, before, after });
    return after;
  });

  const [enriched] = await enrichItems([item], req.user);
  res.json({ item: { ...enriched, score: calculateItemScore(item) } });
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
  await Promise.all(attachments.map((attachment) => storage.delete(attachment.storageKey)));
  await prisma.$transaction((tx) => recordItemDeletion(tx, {
    userId: req.user!.id,
    item: existing,
  }));
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

  const requestedKeys = validRows.map((row) => row.key).filter(Boolean);
  const existingItems = requestedKeys.length > 0
    ? await prisma.item.findMany({ where: { key: { in: requestedKeys } }, include: itemInclude })
    : [];
  const existingByKey = new Map(existingItems.map((item) => [item.key, item]));
  const created: ItemRecord[] = [];
  const updated: ItemRecord[] = [];
  const importedByRow = new Map<number, ItemRecord>();
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
    const existing = data.key ? existingByKey.get(data.key) : undefined;
    if (existing && existing.projectId !== project.id) {
      errors.push({ row: entry.index + 2, errors: [`Key: ${data.key} belongs to another project`] });
      continue;
    }
    if (existing && !canEditItem(req.user.id, req.user.role, existing)) {
      errors.push({ row: entry.index + 2, errors: [`Key: You cannot edit ${data.key}`] });
      continue;
    }
    await assertCanCreateItem(req.user, project.id, reporter.id, assignee?.id ?? null);

    const item = await prisma.$transaction(async (tx) => {
      const fields = {
        type: data.type,
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        risk: data.risk,
        assigneeId: assignee?.id ?? null,
        reporterId: reporter.id,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        estimateHours: data.estimateHours ?? null,
        spentHours: data.spentHours ?? 0,
        tags: data.tags ? data.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
        closedAt: data.status === ItemStatus.DONE ? new Date() : null,
      };
      if (existing) {
        const before = await tx.item.findUnique({ where: { id: existing.id } });
        if (!before || !canEditItem(req.user!.id, req.user!.role, before)) throw new AppError(403, 'You cannot edit this item');
        const imported = await tx.item.update({
          where: { id: existing.id },
          data: { ...fields, ...await itemStartData(tx, data.status, existing.id) },
          include: itemInclude,
        });
        await recordItemChanges(tx, { userId: req.user!.id, before, after: imported });
        await notifyItemChanges(tx, { actorId: req.user!.id, before, after: imported });
        return imported;
      }
      const key = await nextItemKey(tx as typeof prisma, project.id);
      const imported = await tx.item.create({
        data: {
          projectId: project.id,
          key,
          ...fields,
          ...await itemStartData(tx, data.status),
        },
        include: itemInclude,
      });
      await recordItemCreation(tx, { userId: req.user!.id, item: imported, imported: true });
      await notifyItemCreated(tx, { actorId: req.user!.id, item: imported });
      return imported;
    });
    importedByRow.set(entry.index, item);
    if (existing) updated.push(item);
    else created.push(item);
  }

  const relationshipKeys = new Set(validRows.flatMap((row) => [
    ...(row.parentKey ? [row.parentKey] : []),
    ...row.blocksKeys.split(';'),
    ...row.relatesToKeys.split(';'),
  ].map((key) => key.trim()).filter(Boolean)));
  const referencedItems = relationshipKeys.size > 0
    ? await prisma.item.findMany({ where: { key: { in: [...relationshipKeys] } }, include: itemInclude })
    : [];
  const itemByKey = new Map(referencedItems.map((item) => [item.key, item]));
  importedByRow.forEach((item, rowIndex) => {
    const data = normalized.find((entry) => entry.index === rowIndex)?.data;
    if (data?.key) itemByKey.set(data.key, item);
  });

  for (const entry of normalized) {
    const data = entry.data;
    const item = importedByRow.get(entry.index);
    if (!data || !item) continue;
    const rowErrors: string[] = [];
    const parent = data.parentKey.trim() ? itemByKey.get(data.parentKey.trim()) : null;
    if (data.relationshipColumns.parentKey && data.parentKey.trim() && !parent) {
      rowErrors.push(`ParentKey: Unknown item key ${data.parentKey.trim()}`);
    }
    const blocks = data.blocksKeys.split(';').map((key) => key.trim()).filter(Boolean);
    const relates = data.relatesToKeys.split(';').map((key) => key.trim()).filter(Boolean);
    const blockTargets = blocks.map((key) => ({ key, item: itemByKey.get(key) }));
    const relateTargets = relates.map((key) => ({ key, item: itemByKey.get(key) }));
    blockTargets.filter((target) => !target.item).forEach(({ key }) => rowErrors.push(`BlocksKeys: Unknown item key ${key}`));
    relateTargets.filter((target) => !target.item).forEach(({ key }) => rowErrors.push(`RelatesToKeys: Unknown item key ${key}`));
    if (rowErrors.length > 0) {
      errors.push({ row: entry.index + 2, errors: rowErrors });
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const before = await tx.item.findUnique({ where: { id: item.id } });
        if (!before) throw new AppError(404, `Row item ${item.key} not found`);
        if (data.relationshipColumns.parentKey) {
          await assertValidParent(tx, item.id, item.projectId, parent?.id ?? null);
        }
        if (data.relationshipColumns.blocksKeys) {
          await tx.itemDependency.deleteMany({ where: { fromId: item.id, type: DependencyType.BLOCKS } });
          for (const target of blockTargets) {
            if (!target.item) continue;
            const normalized = normalizeDependency(item.id, target.item.id, DependencyType.BLOCKS);
            await assertNoBlocksCycle(tx, normalized.fromId, normalized.toId);
            await tx.itemDependency.create({ data: normalized });
          }
        }
        if (data.relationshipColumns.relatesToKeys) {
          await tx.itemDependency.deleteMany({
            where: { type: DependencyType.RELATES_TO, OR: [{ fromId: item.id }, { toId: item.id }] },
          });
          for (const target of relateTargets) {
            if (!target.item) continue;
            const normalized = normalizeDependency(item.id, target.item.id, DependencyType.RELATES_TO);
            await tx.itemDependency.upsert({
              where: { fromId_toId_type: normalized },
              create: normalized,
              update: {},
            });
          }
        }
        if (data.relationshipColumns.parentKey) {
          const after = await tx.item.update({
            where: { id: item.id },
            data: { parentId: parent?.id ?? null },
          });
          await recordItemChanges(tx, { userId: req.user!.id, before, after });
        }
      });
    } catch (error) {
      errors.push({
        row: entry.index + 2,
        errors: [error instanceof AppError ? error.message : 'Unable to apply item relationships'],
      });
    }
  }

  const importedItems = [...created, ...updated];
  const currentItems = importedItems.length > 0
    ? await prisma.item.findMany({ where: { id: { in: importedItems.map((item) => item.id) } }, include: itemInclude })
    : [];
  const outputItems = await enrichItems(currentItems, req.user);
  const outputById = new Map(outputItems.map((item) => [item.id, item]));
  res.json({
    createdCount: created.length,
    created: created.map((item) => {
      const result = outputById.get(item.id) ?? item;
      return { ...result, score: calculateItemScore(result) };
    }),
    updatedCount: updated.length,
    updated: updated.map((item) => {
      const result = outputById.get(item.id) ?? item;
      return { ...result, score: calculateItemScore(result) };
    }),
    errors,
  });
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
    ParentKey: item.parent?.key ?? '',
    BlocksKeys: item.blocks.map((linked) => linked.key).join(';'),
    BlockedByKeys: item.blockedBy.map((linked) => linked.key).join(';'),
    RelatesToKeys: item.relatesTo.map((linked) => linked.key).join(';'),
  })));

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="items-export.csv"');
  res.send(csv);
}));
