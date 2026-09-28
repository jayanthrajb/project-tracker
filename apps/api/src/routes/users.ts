import crypto from 'node:crypto';

import { ItemStatus, Prisma, UserRole } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { hashPassword } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const listUsersQuerySchema = z.object({
  search: z.string().optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return undefined;
    }),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
});

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  password: z.string().min(8).optional(),
  generateTemporaryPassword: z.boolean().optional().default(false),
});

const adminPatchUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
});

const selfPatchUserSchema = z.object({
  name: z.string().min(2).optional(),
  password: z.string().min(8).optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).optional(),
  generateTemporaryPassword: z.boolean().optional().default(false),
});

export const usersRouter = Router();
usersRouter.use(requireAuth);

function createTemporaryPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

async function assertNotLastActiveAdminDemotion(params: {
  actorUserId: string;
  targetUserId: string;
  nextRole?: UserRole;
  nextIsActive?: boolean;
}) {
  const { actorUserId, targetUserId, nextRole, nextIsActive } = params;
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    throw new AppError(404, 'User not found');
  }

  const finalRole = nextRole ?? target.role;
  const finalIsActive = nextIsActive ?? target.isActive;

  const actorIsTarget = actorUserId === targetUserId;
  const actorDropsOwnAdmin = actorIsTarget && target.role === UserRole.ADMIN && (finalRole !== UserRole.ADMIN || !finalIsActive);

  if (!actorDropsOwnAdmin) return;

  const activeAdminCount = await prisma.user.count({
    where: { role: UserRole.ADMIN, isActive: true },
  });

  if (activeAdminCount <= 1) {
    throw new AppError(400, 'You cannot demote or deactivate yourself because you are the last active ADMIN');
  }
}

function toFriendlyUserConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(409, 'Email is already in use');
  }
  throw error;
}

usersRouter.get('/', asyncHandler(async (req, res) => {
  const query = listUsersQuerySchema.parse(req.query);
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        _count: { select: { assignedItems: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const isAdmin = req.user?.role === UserRole.ADMIN;
  const openByAssignee = await prisma.item.groupBy({
    by: ['assigneeId'],
    where: {
      assigneeId: { in: users.map((user) => user.id) },
      status: { not: ItemStatus.DONE },
    },
    _count: { _all: true },
  });
  const openCountMap = new Map(openByAssignee.map((entry) => [entry.assigneeId, entry._count._all]));

  const payload = users.map((user) => {
    if (isAdmin) {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        assignedItemsCount: user._count.assignedItems,
        openAssignedItemsCount: openCountMap.get(user.id) ?? 0,
      };
    }

    return {
      id: user.id,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    };
  });

  res.json({ users: payload, total, page: query.page, pageSize: query.pageSize });
}));

usersRouter.post('/', requireRole(UserRole.ADMIN), asyncHandler(async (req, res) => {
  const input = createUserSchema.parse(req.body);

  const shouldGenerate = input.generateTemporaryPassword || !input.password;
  const password = shouldGenerate ? createTemporaryPassword() : input.password;
  if (!password) throw new AppError(400, 'Password is required');

  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        isActive: true,
        passwordHash: await hashPassword(password),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      user,
      temporaryPassword: shouldGenerate ? password : null,
    });
  } catch (error) {
    toFriendlyUserConflict(error);
  }
}));

usersRouter.patch('/:id', asyncHandler(async (req, res) => {
  const userId = z.string().parse(req.params.id);
  if (!req.user) throw new AppError(401, 'Authentication required');

  const isAdmin = req.user.role === UserRole.ADMIN;
  const isSelf = req.user.id === userId;

  if (!isAdmin && !isSelf) {
    throw new AppError(403, 'Insufficient permissions');
  }

  if (isAdmin) {
    const input = adminPatchUserSchema.parse(req.body);
    await assertNotLastActiveAdminDemotion({
      actorUserId: req.user.id,
      targetUserId: userId,
      nextRole: input.role,
      nextIsActive: input.isActive,
    });

    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          email: input.email,
          role: input.role,
          isActive: input.isActive,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });
      return res.json({ user });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new AppError(404, 'User not found');
      }
      toFriendlyUserConflict(error);
    }
  }

  const input = selfPatchUserSchema.parse(req.body);
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name,
      passwordHash: input.password ? await hashPassword(input.password) : undefined,
    },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  return res.json({ user });
}));

usersRouter.post('/:id/reset-password', requireRole(UserRole.ADMIN), asyncHandler(async (req, res) => {
  const userId = z.string().parse(req.params.id);
  const input = resetPasswordSchema.parse(req.body);

  const shouldGenerate = input.generateTemporaryPassword || !input.password;
  const password = shouldGenerate ? createTemporaryPassword() : input.password;
  if (!password) throw new AppError(400, 'Password is required');

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new AppError(404, 'User not found');
    }
    throw error;
  }

  res.json({ temporaryPassword: shouldGenerate ? password : null, message: 'Password reset successful' });
}));

usersRouter.delete('/:id', requireRole(UserRole.ADMIN), asyncHandler(async (req, res) => {
  const userId = z.string().parse(req.params.id);
  if (!req.user) throw new AppError(401, 'Authentication required');

  await assertNotLastActiveAdminDemotion({
    actorUserId: req.user.id,
    targetUserId: userId,
    nextIsActive: false,
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  if (!user.isActive) {
    const assignedItemsCount = await prisma.item.count({ where: { assigneeId: userId } });
    return res.json({ userId, isActive: false, assignedItemsCount });
  }

  await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
  const assignedItemsCount = await prisma.item.count({ where: { assigneeId: userId } });
  res.json({ userId, isActive: false, assignedItemsCount });
}));
