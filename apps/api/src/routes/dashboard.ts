import { ItemStatus } from '@prisma/client';
import { Router } from 'express';

import { asyncHandler } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { calculateItemScore } from '../lib/score.js';
import { requireAuth } from '../middleware/auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', asyncHandler(async (req, res) => {
  const [items, projects] = await Promise.all([
    prisma.item.findMany({
      include: {
        project: { select: { id: true, name: true, code: true } },
        assignee: { select: { id: true, name: true, email: true } },
        reporter: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.project.findMany({
      include: {
        _count: {
          select: {
            items: true,
          },
        },
      },
    }),
  ]);

  const now = new Date();
  const in3Days = new Date(now);
  in3Days.setDate(now.getDate() + 3);
  const staleThreshold = new Date(now);
  staleThreshold.setDate(now.getDate() - 5);

  const scored = items.map((item) => ({ ...item, score: calculateItemScore(item, now) }));
  const active = scored.filter((item) => item.status !== ItemStatus.DONE);

  const overdue = active.filter((item) => item.dueDate && item.dueDate < now);
  const dueSoon = active.filter((item) => item.dueDate && item.dueDate >= now && item.dueDate <= in3Days);
  const blocked = active.filter((item) => item.status === ItemStatus.BLOCKED);
  const needsAttention = active.filter((item) => !item.assigneeId || !item.dueDate);
  const stale = active.filter((item) => item.status === ItemStatus.IN_PROGRESS && item.updatedAt < staleThreshold);
  const myItems = req.user ? active.filter((item) => item.assigneeId === req.user?.id) : [];
  const perProjectOpenCounts = projects.map((project) => ({
    id: project.id,
    name: project.name,
    code: project.code,
    openCount: active.filter((item) => item.projectId === project.id).length,
  }));

  res.json({
    buckets: {
      overdue,
      dueSoon,
      blocked,
      needsAttention,
    },
    summary: {
      totalOpen: active.length,
      totalDone: scored.length - active.length,
      overdue: overdue.length,
      blocked: blocked.length,
      dueSoon: dueSoon.length,
      needsAttention: needsAttention.length,
    },
    myItems: myItems.sort((a, b) => b.score - a.score),
    perProjectOpenCounts,
    stale,
  });
}));
