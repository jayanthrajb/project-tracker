import { ItemPriority, ItemRisk, ItemStatus, ItemType } from '@prisma/client';
import { Router } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { buildItemWhere, sortItems } from '../lib/item-filters.js';
import { prisma } from '../lib/prisma.js';
import { calculateItemScore } from '../lib/score.js';
import { normalizeImportRows, parseCsvRows } from '../lib/csv.js';
import { canEditItem } from '../lib/permissions.js';
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
  status: z.union([z.string(), z.array(z.string())]).optional(),
  type: z.union([z.string(), z.array(z.string())]).optional(),
  priority: z.union([z.string(), z.array(z.string())]).optional(),
  risk: z.union([z.string(), z.array(z.string())]).optional(),
  search: z.string().optional(),
  dueBefore: z.string().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(25),
});

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

const itemInclude = {
  project: { select: { id: true, name: true, code: true } },
  assignee: { select: { id: true, name: true, email: true, role: true } },
  reporter: { select: { id: true, name: true, email: true, role: true } },
};

async function nextItemKey(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { code: true } });
  if (!project) throw new AppError(404, 'Project not found');

  const keys = await prisma.item.findMany({ where: { projectId }, select: { key: true } });
  const current = keys.reduce((max, item) => {
    const value = Number(item.key.split('-')[1] ?? 0);
    return Math.max(max, value);
  }, 0);

  return `${project.code}-${current + 1}`;
}

function normalizeQueryArray(value?: string | string[]) {
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(',').filter(Boolean);
}

async function listItems(rawQuery: unknown) {
  const query = querySchema.parse(rawQuery);
  const filters = {
    projectId: query.projectId,
    assigneeId: query.assigneeId,
    statuses: normalizeQueryArray(query.status),
    types: normalizeQueryArray(query.type),
    priorities: normalizeQueryArray(query.priority),
    risks: normalizeQueryArray(query.risk),
    search: query.search,
    dueBefore: query.dueBefore,
  };

  const where = buildItemWhere(filters);
  const rows = await prisma.item.findMany({ where, include: itemInclude });
  const enriched = rows.map((item) => ({ ...item, score: calculateItemScore(item) }));
  const sorted = sortItems(enriched, query.sort);
  const start = (query.page - 1) * query.pageSize;
  const paged = sorted.slice(start, start + query.pageSize);

  return {
    items: paged,
    total: sorted.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

itemsRouter.get('/', asyncHandler(async (req, res) => {
  res.json(await listItems(req.query));
}));

itemsRouter.post('/', asyncHandler(async (req, res) => {
  const input = itemSchema.parse(req.body);
  const key = await nextItemKey(input.projectId);
  const item = await prisma.item.create({
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

  res.status(201).json({ item: { ...item, score: calculateItemScore(item) } });
}));

itemsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const itemId = z.string().parse(req.params.id);
  const input = itemSchema.partial().parse(req.body);
  const existing = await prisma.item.findUnique({ where: { id: itemId } });
  if (!existing) throw new AppError(404, 'Item not found');
  if (!req.user || !canEditItem(req.user.id, req.user.role, existing)) {
    throw new AppError(403, 'You cannot edit this item');
  }

  const item = await prisma.item.update({
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

  res.json({ item: { ...item, score: calculateItemScore(item) } });
}));

itemsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const itemId = z.string().parse(req.params.id);
  const existing = await prisma.item.findUnique({ where: { id: itemId } });
  if (!existing) throw new AppError(404, 'Item not found');
  if (!req.user || !canEditItem(req.user.id, req.user.role, existing)) {
    throw new AppError(403, 'You cannot delete this item');
  }

  await prisma.item.delete({ where: { id: itemId } });
  res.status(204).send();
}));

itemsRouter.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError(400, 'CSV file is required');
  }

  const mapping = req.body.mapping ? JSON.parse(req.body.mapping) : undefined;
  const parsed = parseCsvRows(req.file.buffer.toString('utf-8'));
  const normalized = normalizeImportRows(parsed.data, mapping);
  const errors = normalized.filter((entry) => entry.errors.length > 0).map((entry) => ({ row: entry.index + 2, errors: entry.errors }));

  const created = [];
  for (const entry of normalized) {
    if (!entry.data) continue;

    const [project, assignee, reporter] = await Promise.all([
      prisma.project.findUnique({ where: { code: entry.data.projectCode } }),
      entry.data.assigneeEmail ? prisma.user.findUnique({ where: { email: entry.data.assigneeEmail } }) : Promise.resolve(null),
      prisma.user.findUnique({ where: { email: entry.data.reporterEmail } }),
    ]);

    if (!project || !reporter || (entry.data.assigneeEmail && !assignee)) {
      errors.push({
        row: entry.index + 2,
        errors: [
          !project ? `projectCode: Unknown project ${entry.data.projectCode}` : '',
          !reporter ? `reporterEmail: Unknown user ${entry.data.reporterEmail}` : '',
          entry.data.assigneeEmail && !assignee ? `assigneeEmail: Unknown user ${entry.data.assigneeEmail}` : '',
        ].filter(Boolean),
      });
      continue;
    }

    const item = await prisma.item.create({
      data: {
        projectId: project.id,
        key: await nextItemKey(project.id),
        type: entry.data.type,
        title: entry.data.title,
        description: entry.data.description,
        status: entry.data.status,
        priority: entry.data.priority,
        risk: entry.data.risk,
        assigneeId: assignee?.id ?? null,
        reporterId: reporter.id,
        dueDate: entry.data.dueDate ? new Date(entry.data.dueDate) : null,
        estimateHours: entry.data.estimateHours,
        spentHours: entry.data.spentHours ?? 0,
        tags: entry.data.tags ? entry.data.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
        closedAt: entry.data.status === ItemStatus.DONE ? new Date() : null,
      },
      include: itemInclude,
    });
    created.push({ ...item, score: calculateItemScore(item) });
  }

  res.json({ createdCount: created.length, created, errors });
}));

itemsRouter.get('/export', asyncHandler(async (req, res) => {
  const result = await listItems(req.query);
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
