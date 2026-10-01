import { Router } from 'express';
import { z } from 'zod';

import { assertProjectReadable, findAccessibleItem } from '../lib/access.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const activityRouter = Router();
activityRouter.use(rateLimit({ windowMs: 60_000, max: 120 }), requireAuth);

activityRouter.get('/items/:id/activity', asyncHandler(async (req, res) => {
  const itemId = z.string().min(1).parse(req.params.id);
  const { page, pageSize } = paginationSchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await findAccessibleItem(itemId, req.user);
  const where = { itemId };
  const [activity, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.activityLog.count({ where }),
  ]);
  res.json({ activity, total, page, pageSize });
}));

activityRouter.get('/projects/:id/activity', asyncHandler(async (req, res) => {
  const projectId = z.string().min(1).parse(req.params.id);
  const { page, pageSize } = paginationSchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await assertProjectReadable(projectId, req.user);
  const where = { projectId };
  const [activity, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.activityLog.count({ where }),
  ]);
  res.json({ activity, total, page, pageSize });
}));
