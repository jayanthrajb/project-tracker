import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

import { ItemFilters } from '../components/ItemFilters';
import { SavedViews } from '../components/SavedViews';
import { api, ApiError } from '../lib/api';
import { backlogColor } from '../lib/itemColors';
import { canEditItem } from '../lib/itemPermissions';
import { filterOptions } from '../lib/itemViewFilters';
import { useSavedViews } from '../lib/useSavedViews';
import { cn, formatDate } from '../lib/utils';
import type { Item, ItemStatus, Project, User } from '../types';

type ItemsResponse = { items: Item[]; total: number };
type RecentUpdate = { item: Item; query: string; pending: boolean; expiresAt?: number; outsideFilter: boolean };

export function MyItemsPage({ user }: { user: User }) {
  const savedViews = useSavedViews(user, undefined, true);
  const client = useQueryClient();
  const [recent, setRecent] = useState<Record<string, RecentUpdate>>({});
  const queryKey = ['my-items', user.id, savedViews.query] as const;
  const currentQuery = useRef(savedViews.query);
  useEffect(() => { currentQuery.current = savedViews.query; }, [savedViews.query]);
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: Project[]; users: User[] }>('/projects') });
  const items = useQuery({ queryKey, queryFn: () => api<ItemsResponse>(`/items?${savedViews.query}`) });
  useEffect(() => {
    const expirations = Object.values(recent).flatMap((update) => update.expiresAt ? [update.expiresAt] : []);
    if (!expirations.length) return;
    const timer = window.setTimeout(() => {
      setRecent((current) => Object.fromEntries(Object.entries(current).filter(([, update]) => !update.expiresAt || update.expiresAt > Date.now())));
    }, Math.max(0, Math.min(...expirations) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [recent]);

  const updateStatus = useMutation({
    mutationFn: ({ item, status }: { item: Item; status: ItemStatus; query: string; outsideFilter: boolean }) =>
      api<{ item: Item }>(`/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onMutate: async ({ item, status, query, outsideFilter }) => {
      const key = ['my-items', user.id, query] as const;
      await client.cancelQueries({ queryKey: key, exact: true });
      const optimistic = { ...item, status };
      client.setQueryData<ItemsResponse>(key, (current) => current && { ...current, items: current.items.map((entry) => entry.id === item.id ? optimistic : entry) });
      setRecent((current) => ({ ...current, [item.id]: { item: optimistic, query, pending: true, outsideFilter } }));
    },
    onSuccess: ({ item }, request) => {
      setRecent((current) => ({ ...current, [item.id]: { item, query: request.query, pending: false, expiresAt: Date.now() + 5000, outsideFilter: request.outsideFilter } }));
      client.setQueryData<ItemsResponse>(['my-items', user.id, request.query], (current) => current && { ...current, items: current.items.map((entry) => entry.id === item.id ? item : entry) });
      void client.invalidateQueries({ queryKey: ['activity', 'items', item.id] });
      void client.invalidateQueries({ queryKey: ['notifications', user.id, 'unread-count'], exact: true });
    },
    onError: (error: Error, { item, query }) => {
      client.setQueryData<ItemsResponse>(['my-items', user.id, query], (current) => current && { ...current, items: current.items.map((entry) => entry.id === item.id ? item : entry) });
      setRecent((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      toast.error(error instanceof ApiError && error.status === 403
        ? 'You no longer have permission to update this item. Status reverted.'
        : 'Could not update status. Status reverted. Please try again.');
    },
    onSettled: (_data, _error, { query }) => {
      void client.invalidateQueries({ queryKey: ['my-items', user.id, query], exact: true });
      if (currentQuery.current !== query) {
        void client.invalidateQueries({ queryKey: ['my-items', user.id, currentQuery.current], exact: true });
      }
    },
  });

  const visibleItems = (items.data?.items ?? []).map((item) => recent[item.id]?.item ?? item);
  for (const update of Object.values(recent)) {
    if (update.query === savedViews.query && !visibleItems.some((item) => item.id === update.item.id)) visibleItems.push(update.item);
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-2xl font-semibold">My Items</h2>
        <p className="text-sm text-slate-500">Everything assigned to you. Saved views always keep your assignment filter.</p>
      </div>
      <SavedViews state={savedViews} user={user} canShare={user.role !== 'DEVELOPER'} />
      <ItemFilters filters={savedViews.filters} sort={savedViews.sort} onChange={savedViews.change} projects={projects.data?.projects} ownItems />
      {items.isLoading && <p>Loading items…</p>}
      {items.isError && <p role="alert">Could not load your items.</p>}
      <div className="grid gap-3">
        {visibleItems.map((item) => {
          const update = recent[item.id]?.query === savedViews.query ? recent[item.id] : undefined;
          const canUpdate = canEditItem(user, item);
          return (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">{item.key} · {item.project.code}</div>
                <div className="font-medium">{item.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <select aria-label={`Status for ${item.key}`} value={item.status} disabled={!canUpdate || recent[item.id]?.pending}
                    title={!canUpdate ? 'You do not have permission to update this item.' : undefined}
                    className={cn('rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-60', item.status === 'BACKLOG' && backlogColor)}
                    onChange={(event) => {
                      const status = event.target.value as ItemStatus;
                      if (!recent[item.id]?.pending && status !== item.status) updateStatus.mutate({ item, status, query: savedViews.query, outsideFilter: Boolean(savedViews.filters.statuses?.length && !savedViews.filters.statuses.includes(status)) });
                    }}>
                    {filterOptions.status.map((status) => <option key={status}>{status}</option>)}
                  </select>
                  <span>{item.priority} · Due {formatDate(item.dueDate)}</span>
                </div>
                {update && <p role="status" className="mt-1 text-xs text-slate-500">{update.pending ? 'Saving status…' : update.outsideFilter ? 'Status saved. This item no longer matches the status filter and will leave this view shortly.' : 'Status saved.'}</p>}
              </div>
              <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{item.score}</div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
