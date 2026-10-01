import { ViewScope } from '@prisma/client';
import type { Prisma, UserRole } from '@prisma/client';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { itemFiltersSchema } from '../lib/item-filters.js';
import { canManageProjects } from '../lib/permissions.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrf } from '../middleware/csrf.js';

const sortSchema = z.record(z.string(), z.json());
const createViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.nativeEnum(ViewScope).default(ViewScope.PERSONAL),
  projectId: z.string().min(1).nullable().optional(),
  filtersJson: itemFiltersSchema.default({}),
  sortJson: sortSchema.default({}),
  isDefault: z.boolean().default(false),
}).strict();
const updateViewSchema = createViewSchema.omit({ isDefault: true }).partial();
const idSchema = z.object({ id: z.string().min(1) });
const emptyBodySchema = z.object({}).strict();

export const viewsRouter = Router();
const viewReadRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'Too many requests, please try again later.')),
});
const viewWriteRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'Too many requests, please try again later.')),
});

async function assertViewProjectAccess(
  projectId: string | null | undefined,
  userId: string,
  role: UserRole,
) {
  if (!projectId || canManageProjects(role)) {
    if (projectId && canManageProjects(role)) {
      const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!exists) throw new AppError(404, 'Project not found');
    }
    return;
  }
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  const project = membership ? null : await prisma.project.findFirst({
    where: { id: projectId, ownerId: userId },
    select: { id: true },
  });
  if (!membership && !project) throw new AppError(403, 'You cannot share a view for this project');
}

viewsRouter.get('/views', requireCsrf, viewReadRateLimit, requireAuth, asyncHandler(async (req, res) => {
  emptyBodySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const memberships = await prisma.projectMember.findMany({
    where: { userId: req.user.id },
    select: { projectId: true },
  });
  const sharedScope = [
    { scope: ViewScope.SHARED, projectId: { in: memberships.map((membership) => membership.projectId) } },
    ...(canManageProjects(req.user.role) ? [{ scope: ViewScope.SHARED, projectId: null }] : []),
  ];
  const views = await prisma.savedView.findMany({
    where: {
      OR: [
        { userId: req.user.id, scope: ViewScope.PERSONAL },
        ...sharedScope,
      ],
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
  res.json({ views });
}));

viewsRouter.post('/views', requireCsrf, viewWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const input = createViewSchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');
  if (input.scope === ViewScope.SHARED && input.projectId === undefined && !canManageProjects(req.user.role)) {
    throw new AppError(403, 'Only managers and admins can create cross-project shared views');
  }
  await assertViewProjectAccess(input.projectId, req.user.id, req.user.role);
  if (input.isDefault) {
    const view = await prisma.$transaction(async (tx) => {
      await tx.savedView.updateMany({ where: { userId: req.user!.id, isDefault: true }, data: { isDefault: false } });
      return tx.savedView.create({
        data: {
          userId: req.user!.id,
          name: input.name,
          scope: input.scope,
          projectId: input.projectId,
          filtersJson: input.filtersJson as Prisma.InputJsonValue,
          sortJson: input.sortJson as Prisma.InputJsonValue,
          isDefault: true,
        },
      });
    });
    res.status(201).json({ view });
    return;
  }
  const view = await prisma.savedView.create({
    data: {
      userId: req.user.id,
      name: input.name,
      scope: input.scope,
      projectId: input.projectId,
      filtersJson: input.filtersJson as Prisma.InputJsonValue,
      sortJson: input.sortJson as Prisma.InputJsonValue,
      isDefault: false,
    },
  });
  res.status(201).json({ view });
}));

viewsRouter.patch('/views/:id', requireCsrf, viewWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const input = updateViewSchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const existing = await prisma.savedView.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Saved view not found');
  if (
    existing.scope === ViewScope.PERSONAL
      ? existing.userId !== req.user.id
      : existing.userId !== req.user.id && !canManageProjects(req.user.role)
  ) {
    throw new AppError(403, 'You cannot edit this saved view');
  }
  const scope = input.scope ?? existing.scope;
  const projectId = input.projectId === undefined ? existing.projectId : input.projectId;
  if (scope === ViewScope.SHARED) {
    if (projectId === null && !canManageProjects(req.user.role)) {
      throw new AppError(403, 'Only managers and admins can create cross-project shared views');
    }
  }
  await assertViewProjectAccess(projectId, req.user.id, req.user.role);
  const data: Prisma.SavedViewUpdateInput = {
    name: input.name,
    scope: input.scope,
    project: projectId === existing.projectId
      ? undefined
      : projectId
        ? { connect: { id: projectId } }
        : { disconnect: true },
    filtersJson: input.filtersJson === undefined ? undefined : input.filtersJson as Prisma.InputJsonValue,
    sortJson: input.sortJson === undefined ? undefined : input.sortJson as Prisma.InputJsonValue,
  };
  const view = await prisma.savedView.update({ where: { id }, data });
  res.json({ view });
}));

viewsRouter.delete('/views/:id', requireCsrf, viewWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const { id } = idSchema.parse(req.params);
  emptyBodySchema.parse(req.body ?? {});
  if (!req.user) throw new AppError(401, 'Authentication required');
  const existing = await prisma.savedView.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Saved view not found');
  if (
    existing.scope === ViewScope.PERSONAL
      ? existing.userId !== req.user.id
      : existing.userId !== req.user.id && !canManageProjects(req.user.role)
  ) {
    throw new AppError(403, 'You cannot delete this saved view');
  }
  await prisma.savedView.delete({ where: { id } });
  res.status(204).send();
}));

viewsRouter.post('/views/:id/set-default', requireCsrf, viewWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const { id } = idSchema.parse(req.params);
  emptyBodySchema.parse(req.body ?? {});
  if (!req.user) throw new AppError(401, 'Authentication required');
  const existing = await prisma.savedView.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Saved view not found');
  if (existing.userId !== req.user.id) {
    throw new AppError(403, 'Only the view owner can set it as their default');
  }
  const view = await prisma.$transaction(async (tx) => {
    await tx.savedView.updateMany({
      where: { userId: req.user!.id, isDefault: true },
      data: { isDefault: false },
    });
    return tx.savedView.update({ where: { id }, data: { isDefault: true } });
  });
  res.json({ view });
}));
