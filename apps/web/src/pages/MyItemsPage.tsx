import { useQuery } from '@tanstack/react-query';

import { ItemFilters } from '../components/ItemFilters';
import { SavedViews } from '../components/SavedViews';
import { api } from '../lib/api';
import { useSavedViews } from '../lib/useSavedViews';
import { formatDate } from '../lib/utils';
import type { Item, Project, User } from '../types';

export function MyItemsPage({ user }: { user: User }) {
  const savedViews = useSavedViews(user, undefined, true);
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: Project[]; users: User[] }>('/projects') });
  const items = useQuery({ queryKey: ['my-items', user.id, savedViews.query], queryFn: () => api<{ items: Item[]; total: number }>(`/items?${savedViews.query}`) });

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
        {items.data?.items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">{item.key} · {item.project.code}</div>
                <div className="font-medium">{item.title}</div>
                <div className="text-sm text-slate-500">{item.status} · {item.priority} · Due {formatDate(item.dueDate)}</div>
              </div>
              <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{item.score}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
