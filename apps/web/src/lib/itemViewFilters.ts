import { z } from 'zod';

import type { ItemPriority, ItemRisk, ItemStatus, ItemType, User } from '../types';

export interface ItemViewFilters {
  projectId?: string;
  assigneeId?: string;
  unassigned?: boolean;
  statuses?: ItemStatus[];
  types?: ItemType[];
  priorities?: ItemPriority[];
  risks?: ItemRisk[];
  search?: string;
  dueBefore?: string;
}

export interface SavedView {
  id: string;
  userId: string;
  name: string;
  scope: 'PERSONAL' | 'SHARED';
  projectId: string | null;
  filtersJson: ItemViewFilters;
  sortJson: { field?: string; direction?: string };
  isDefault: boolean;
}

export const filterOptions = {
  status: ['BACKLOG', 'OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'],
  type: ['TASK', 'BUG', 'RISK', 'ENHANCEMENT'],
  priority: ['P0', 'P1', 'P2', 'P3'],
  risk: ['LOW', 'MEDIUM', 'HIGH'],
} as const;
export const sortOptions = ['score-desc', 'score-asc', 'dueDate-asc', 'dueDate-desc', 'updatedAt-desc', 'title-asc', 'key-asc'] as const;
export const filterKeys = ['projectId', 'assigneeId', 'unassigned', 'status', 'type', 'priority', 'risk', 'search', 'dueBefore', 'sort'] as const;
const dueBeforeSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

function list<T extends string>(params: URLSearchParams, key: string, options: readonly T[]): T[] | undefined {
  const supplied = params.getAll(key).flatMap((value) => value.split(','));
  const values = options.filter((option) => supplied.includes(option));
  return values.length ? values : undefined;
}

export function readItemFilters(params: URLSearchParams): ItemViewFilters {
  const filters: ItemViewFilters = {};
  const statuses = list(params, 'status', filterOptions.status);
  const types = list(params, 'type', filterOptions.type);
  const priorities = list(params, 'priority', filterOptions.priority);
  const risks = list(params, 'risk', filterOptions.risk);
  if (statuses) filters.statuses = statuses;
  if (types) filters.types = types;
  if (priorities) filters.priorities = priorities;
  if (risks) filters.risks = risks;
  for (const key of ['projectId', 'assigneeId', 'search'] as const) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  if (params.get('unassigned') === 'true') {
    filters.unassigned = true;
    delete filters.assigneeId;
  }
  const due = params.get('dueBefore');
  const parsedDue = dueBeforeSchema.safeParse(due);
  if (parsedDue.success) {
    filters.dueBefore = parsedDue.data.length === 10 ? parsedDue.data : new Date(parsedDue.data).toISOString();
  }
  return filters;
}

export function readItemSort(params: URLSearchParams) {
  return sortOptions.find((sort) => sort === params.get('sort')) ?? 'score-desc';
}

export function viewSort(view: SavedView) {
  const value = `${view.sortJson.field ?? 'score'}-${view.sortJson.direction ?? 'desc'}`;
  return sortOptions.find((sort) => sort === value) ?? 'score-desc';
}

export function writeItemFilters(params: URLSearchParams, filters: ItemViewFilters, sort: string): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of filterKeys) next.delete(key);
  for (const key of ['projectId', 'assigneeId', 'search', 'dueBefore'] as const) {
    if (filters[key]) next.set(key, filters[key]);
  }
  if (filters.unassigned) {
    next.delete('assigneeId');
    next.set('unassigned', 'true');
  }
  for (const [key, values] of [
    ['status', filters.statuses], ['type', filters.types], ['priority', filters.priorities], ['risk', filters.risks],
  ] as const) {
    if (values?.length) next.set(key, [...new Set(values)].sort().join(','));
  }
  next.set('sort', sortOptions.find((option) => option === sort) ?? 'score-desc');
  return next;
}

export function constrainFilters(filters: ItemViewFilters, projectId?: string) {
  const next = { ...filters };
  if (projectId) next.projectId = projectId;
  return next;
}

export function itemQuery(filters: ItemViewFilters, sort: string, ownItems = false) {
  const canonical = readItemFilters(writeItemFilters(new URLSearchParams(), filters, sort));
  const params = writeItemFilters(new URLSearchParams(), canonical, sort);
  params.set('pageSize', '100');
  if (ownItems) params.set('mine', 'true');
  return params.toString();
}

export function canEditView(view: SavedView, user: User) {
  return view.userId === user.id || (view.scope === 'SHARED' && user.role !== 'DEVELOPER');
}
