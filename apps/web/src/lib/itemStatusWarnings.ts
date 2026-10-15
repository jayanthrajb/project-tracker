import type { Item, ItemLink, ItemStatus } from '../types';

export function openBlockingItems(item: Pick<Item, 'blockedBy'>): ItemLink[] {
  return (item.blockedBy ?? []).filter((blocker) => blocker.status !== 'DONE');
}

export function needsBlockedStatusWarning(status: ItemStatus): boolean {
  return status === 'IN_PROGRESS' || status === 'IN_REVIEW';
}

export function blockedStatusMessage(blockers: ItemLink[]): string {
  return `This item is blocked by ${blockers.map((blocker) => `${blocker.key} · ${blocker.title}`).join(', ')}. Continue anyway?`;
}
