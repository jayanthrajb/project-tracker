import { UserRole } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { findAccessibleItem } from '../lib/access.js';
import { recordCommentActivity } from '../lib/activity.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { resolveMentionedUsers } from '../lib/mentions.js';
import { notifyCommentAdded, notifyMention } from '../lib/notifications.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrf } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const commentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
}).strict();
const emptyBodySchema = z.object({}).strict();

export const commentsRouter = Router();
const commentReadRateLimit = rateLimit({ windowMs: 60_000, max: 120 });
const commentWriteRateLimit = rateLimit({ windowMs: 60_000, max: 60 });

commentsRouter.get('/items/:itemId/comments', requireCsrf, commentReadRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const itemId = z.string().min(1).parse(req.params.itemId);
  const { page, pageSize } = paginationSchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  await findAccessibleItem(itemId, req.user);
  const where = { itemId };
  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.comment.count({ where }),
  ]);
  res.json({ comments, total, page, pageSize });
}));

commentsRouter.post('/items/:itemId/comments', requireCsrf, commentWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const itemId = z.string().min(1).parse(req.params.itemId);
  const input = commentSchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const item = await findAccessibleItem(itemId, req.user);
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { itemId, authorId: req.user!.id, body: input.body },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    await recordCommentActivity(tx, {
      userId: req.user!.id,
      itemId,
      projectId: item.projectId,
      commentId: created.id,
    });
    await notifyCommentAdded(tx, { actorId: req.user!.id, item });
    const mentionedUsers = await resolveMentionedUsers(tx, input.body);
    if (mentionedUsers.length) {
      await tx.mention.createMany({
        data: mentionedUsers.map((user) => ({ commentId: created.id, userId: user.id })),
        skipDuplicates: true,
      });
      for (const user of mentionedUsers) {
        await notifyMention(tx, {
          actorId: req.user!.id,
          userId: user.id,
          itemId,
          itemTitle: item.title,
        });
      }
    }
    return created;
  });
  res.status(201).json({ comment });
}));

commentsRouter.patch('/comments/:id', requireCsrf, commentWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const commentId = z.string().min(1).parse(req.params.id);
  const input = commentSchema.parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const existing = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!existing) throw new AppError(404, 'Comment not found');
  if (existing.authorId !== req.user.id) throw new AppError(403, 'Only the author can edit this comment');
  const comment = await prisma.comment.update({
    where: { id: commentId },
    data: { body: input.body, editedAt: new Date() },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
  res.json({ comment });
}));

commentsRouter.delete('/comments/:id', requireCsrf, commentWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const commentId = z.string().min(1).parse(req.params.id);
  emptyBodySchema.parse(req.body ?? {});
  if (!req.user) throw new AppError(401, 'Authentication required');
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AppError(404, 'Comment not found');
  if (
    comment.authorId !== req.user.id &&
    req.user.role !== UserRole.ADMIN &&
    req.user.role !== UserRole.MANAGER
  ) {
    throw new AppError(403, 'You cannot delete this comment');
  }
  await prisma.comment.delete({ where: { id: commentId } });
  res.status(204).send();
}));
