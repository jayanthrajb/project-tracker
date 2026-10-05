import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { api } from './api';
import { constrainFilters, filterKeys, filterOptions, itemQuery, readItemFilters, readItemSort, viewSort, writeItemFilters } from './itemViewFilters';
import type { ItemViewFilters, SavedView } from './itemViewFilters';
import type { User } from '../types';

export function useSavedViews(user: User, projectId?: string, ownItems = false, defaultActiveStatuses = false) {
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const viewsQuery = useQuery({ queryKey: ['saved-views', user.id], queryFn: () => api<{ views: SavedView[] }>('/views') });
  const views = (viewsQuery.data?.views ?? []).filter((view) => ownItems || !view.projectId || view.projectId === projectId);
  const selected = views.find((view) => view.id === params.get('view'));
  const constrain = (filters: ItemViewFilters) => constrainFilters(filters, projectId);
  const useProjectDefault = Boolean(defaultActiveStatuses && projectId && !ownItems && !params.has('view') && !filterKeys.some((key) => params.has(key)));
  const filters = constrain(useProjectDefault ? { statuses: filterOptions.status.filter((status) => status !== 'DONE') } : readItemFilters(params));
  const sort = readItemSort(params);
  const query = itemQuery(filters, sort, ownItems);
  const initialized = useRef('');
  const context = `${user.id}:${projectId ?? 'my-items'}`;

  useEffect(() => {
    if (!viewsQuery.data) return;
    const firstLoad = initialized.current !== context;
    const id = params.get('view');
    initialized.current = context;
    // Explicit URL filters always win, including item/tab deep links with filters.
    if (filterKeys.some((key) => params.has(key))) return;
    const initial = id ? views.find((view) => view.id === id) : firstLoad ? views.find((view) => view.isDefault && view.userId === user.id) : undefined;
    if (!initial && !useProjectDefault) return;
    setParams((current) => {
      if (filterKeys.some((key) => current.has(key))) return current;
      const next = writeItemFilters(current, constrainFilters(initial?.filtersJson ?? { statuses: filterOptions.status.filter((status) => status !== 'DONE') }, projectId), initial ? viewSort(initial) : 'score-desc');
      if (initial) next.set('view', initial.id);
      return next;
    }, { replace: true });
  }, [context, ownItems, params, projectId, setParams, useProjectDefault, user.id, views, viewsQuery.data]);

  const choose = (view?: SavedView) => {
    setParams((current) => {
      const next = writeItemFilters(current, constrain(view?.filtersJson ?? {}), view ? viewSort(view) : 'score-desc');
      if (view) next.set('view', view.id);
      else next.delete('view');
      return next;
    });
  };
  const change = (nextFilters: ItemViewFilters, nextSort: string = sort) => {
    setParams((current) => writeItemFilters(current, constrain(nextFilters), nextSort), { replace: true });
  };
  const detach = () => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('view');
    return next;
  }, { replace: true });
  const mutation = useMutation({
    mutationFn: async (request: { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: Record<string, unknown> }) => {
      const response = await api<{ view: SavedView } | undefined>(request.path, {
        method: request.method,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      await client.invalidateQueries({ queryKey: ['saved-views', user.id] });
      return response;
    },
  });
  const capture = () => {
    const [field, direction] = sort.split('-');
    return { filtersJson: filters, sortJson: { field, direction } };
  };
  const modified = Boolean(selected && query !== itemQuery(constrain(selected.filtersJson), viewSort(selected), ownItems));
  return { viewsQuery, views, selected, filters, sort, query, modified, choose, change, detach, capture, mutation };
}

export type SavedViewsState = ReturnType<typeof useSavedViews>;
