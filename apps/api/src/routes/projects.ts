import { ProjectStatus, UserRole } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { canManageProjects } from '../lib/permissions.js';
import { requireAuth } from '../middleware/auth.js';
import { storage } from '../lib/storage/index.js';

const projectSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(8).transform((value) => value.toUpperCase()),
  description: z.string().min(1),
  status: z.nativeEnum(ProjectStatus).default(ProjectStatus.ACTIVE),
  ownerId: z.string().min(1),
  memberIds: z.array(z.string()).default([]),
});

const memberSchema = z.object({
  memberIds: z.array(z.string())
});

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

projectsRouter.get('/', asyncHandler(async (_req, res) => {
  const [projects, users] = await Promise.all([
    prisma.project.findMany({
      include: {
        owner: { select: { id: true, name: true, email: true, role: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
        _count: { select: { items: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true } }),
  ]);

  res.json({ projects, users });
}));

projectsRouter.get('/:id', asyncHandler(async (req, res) => {
  const projectId = z.string().parse(req.params.id);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      owner: { select: { id: true, name: true, email: true, role: true } },
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
    },
  });

  if (!project) throw new AppError(404, 'Project not found');
  res.json({ project });
}));

projectsRouter.post('/', asyncHandler(async (req, res) => {
  if (!req.user || !canManageProjects(req.user.role)) {
    throw new AppError(403, 'Only managers and admins can create projects');
  }

  const input = projectSchema.parse(req.body);
  const project = await prisma.project.create({
    data: {
      name: input.name,
      code: input.code,
      description: input.description,
      status: input.status,
      ownerId: input.ownerId,
      members: {
        createMany: {
          data: Array.from(new Set([input.ownerId, ...input.memberIds])).map((userId) => ({ userId })),
        },
      },
    },
    include: {
      owner: { select: { id: true, name: true, email: true, role: true } },
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
    },
  });

  res.status(201).json({ project });
}));

projectsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const projectId = z.string().parse(req.params.id);
  if (!req.user || !canManageProjects(req.user.role)) {
    throw new AppError(403, 'Only managers and admins can update projects');
  }

  const input = projectSchema.partial().parse(req.body);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        code: input.code,
        description: input.description,
        status: input.status,
        ownerId: input.ownerId,
      },
      include: {
        owner: { select: { id: true, name: true, email: true, role: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
      },
    });

    if (input.memberIds) {
      await tx.projectMember.deleteMany({ where: { projectId } });
      await tx.projectMember.createMany({ data: Array.from(new Set([updated.ownerId, ...input.memberIds])).map((userId) => ({ projectId, userId })) });
    }

  });

  const hydrated = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      owner: { select: { id: true, name: true, email: true, role: true } },
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
    },
  });

  res.json({ project: hydrated });
}));

projectsRouter.patch('/:id/members', asyncHandler(async (req, res) => {
  const projectId = z.string().parse(req.params.id);
  if (!req.user || !canManageProjects(req.user.role)) {
    throw new AppError(403, 'Only managers and admins can manage members');
  }

  const input = memberSchema.parse(req.body);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  await prisma.$transaction([
    prisma.projectMember.deleteMany({ where: { projectId } }),
    prisma.projectMember.createMany({ data: Array.from(new Set([project.ownerId, ...input.memberIds])).map((userId) => ({ projectId, userId })) }),
  ]);

  const hydrated = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      owner: { select: { id: true, name: true, email: true, role: true } },
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
    },
  });

  res.json({ project: hydrated });
}));

projectsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const projectId = z.string().parse(req.params.id);
  if (!req.user || req.user.role === UserRole.DEVELOPER) {
    throw new AppError(403, 'Only managers and admins can delete projects');
  }

  const attachments = await prisma.attachment.findMany({
    where: { item: { projectId } },
    select: { storageKey: true },
  });
  await Promise.all(attachments.map((attachment) => storage.delete(attachment.storageKey)));
  await prisma.project.delete({ where: { id: projectId } });
  res.status(204).send();
}));
