import { UserRole } from '@prisma/client';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { deriveDueNotifications } from '../lib/notifications.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrf } from '../middleware/csrf.js';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  unreadOnly: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});
const paramsSchema = z.object({ id: z.string().min(1) });
const emptyBodySchema = z.object({}).strict();

export const notificationsRouter = Router();
const notificationReadRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'Too many requests, please try again later.')),
});
const notificationWriteRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'Too many requests, please try again later.')),
});

notificationsRouter.get('/notifications/unread-count', requireCsrf, notificationReadRateLimit, requireAuth, asyncHandler(async (req, res) => {
  emptyBodySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const count = await prisma.notification.count({ where: { userId: req.user.id, readAt: null } });
  res.json({ count });
}));

notificationsRouter.get('/notifications', requireCsrf, notificationReadRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const { page, pageSize, unreadOnly } = listSchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const where = { userId: req.user.id, ...(unreadOnly ? { readAt: null } : {}) };
  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: { item: { select: { id: true, key: true, title: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  res.json({ notifications, total, page, pageSize });
}));

notificationsRouter.post('/notifications/read-all', requireCsrf, notificationWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  emptyBodySchema.parse(req.body ?? {});
  if (!req.user) throw new AppError(401, 'Authentication required');
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ updatedCount: result.count });
}));

notificationsRouter.post('/notifications/:id/read', requireCsrf, notificationWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  emptyBodySchema.parse(req.body ?? {});
  if (!req.user) throw new AppError(401, 'Authentication required');
  const result = await prisma.notification.updateMany({
    where: { id, userId: req.user.id },
    data: { readAt: new Date() },
  });
  if (!result.count) throw new AppError(404, 'Notification not found');
  res.json({ success: true });
}));

notificationsRouter.post('/notifications/scan', requireCsrf, notificationWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  emptyBodySchema.parse(req.body ?? {});
  if (!req.user || req.user.role !== UserRole.ADMIN) {
    throw new AppError(403, 'Only admins can scan due notifications');
  }
  const createdCount = await deriveDueNotifications();
  res.json({ createdCount });
}));
