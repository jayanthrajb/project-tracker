import type { Item, User } from '../types';

export function canEditItem(user: Pick<User, 'id' | 'role'>, item: Pick<Item, 'assigneeId' | 'reporterId'>) {
  return user.role === 'ADMIN' || user.role === 'MANAGER'
    || item.assigneeId === user.id || item.reporterId === user.id;
}
