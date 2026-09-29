import { UserRole, type Item } from '@prisma/client';

export function canManageProjects(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}

export function canEditItem(userId: string, role: UserRole, item: Pick<Item, 'assigneeId' | 'reporterId'>) {
  if (role === UserRole.ADMIN || role === UserRole.MANAGER) {
    return true;
  }

  return item.assigneeId === userId || item.reporterId === userId;
}
