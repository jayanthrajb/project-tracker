import { UserRole } from '@prisma/client';

import { AppError } from './errors.js';
import { prisma } from './prisma.js';
import type { RequestUser } from '../middleware/auth.js';

export async function findAccessibleItem(itemId: string, user: RequestUser) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: {
      project: {
        select: {
          id: true,
          ownerId: true,
          members: { select: { userId: true } },
        },
      },
    },
  });
  if (!item) throw new AppError(404, 'Item not found');
  if (
    user.role === UserRole.DEVELOPER &&
    item.project.ownerId !== user.id &&
    !item.project.members.some((member) => member.userId === user.id)
  ) {
    throw new AppError(403, 'You cannot access this item');
  }
  return item;
}

export async function assertProjectReadable(projectId: string, user: RequestUser) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, members: { select: { userId: true } } },
  });
  if (!project) throw new AppError(404, 'Project not found');
  if (
    user.role === UserRole.DEVELOPER &&
    project.ownerId !== user.id &&
    !project.members.some((member) => member.userId === user.id)
  ) {
    throw new AppError(403, 'You cannot access this project');
  }
}
