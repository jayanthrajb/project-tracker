import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import { ItemFormModal } from '../components/ItemFormModal';
import { ItemsBoard, ItemsTable } from '../components/ItemsTable';
import { api } from '../lib/api';
import type { ApiError } from '../lib/api';
import type { Item, Project, User } from '../types';

export function ProjectDetailPage({ user }: { user: User }) {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'board'>('table');
  const [activeItem, setActiveItem] = useState<Item | undefined>();
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => api<{ project: Project }>(`/projects/${projectId}`) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: Project[]; users: User[] }>('/projects') });
  const itemsQuery = useQuery({
    queryKey: ['items', projectId, search, status],
    queryFn: () => api<{ items: Item[]; total: number }>(`/items?projectId=${projectId}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&sort=score-desc&pageSize=100`),
  });

  const saveItem = useMutation({
    mutationFn: (payload: { id?: string; body: Record<string, unknown> }) => payload.id
      ? api(`/items/${payload.id}`, { method: 'PATCH', body: JSON.stringify(payload.body) })
      : api('/items', { method: 'POST', body: JSON.stringify(payload.body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Item saved');
      setActiveItem(undefined);
      setCreating(false);
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  const quickUpdate = useMutation({
    mutationFn: ({ item, patch }: { item: Item; patch: Partial<Item> }) => api(`/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ ...item, ...patch, tags: item.tags }) }),
    onMutate: async ({ item, patch }) => {
      await queryClient.cancelQueries({ queryKey: ['items', projectId, search, status] });
      const previous = queryClient.getQueryData<{ items: Item[]; total: number }>(['items', projectId, search, status]);
      if (previous) {
        queryClient.setQueryData(['items', projectId, search, status], {
          ...previous,
          items: previous.items.map((row) => row.id === item.id ? { ...row, ...patch } : row),
        });
      }
      return { previous };
    },
    onError: (error: ApiError, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['items', projectId, search, status], context.previous);
      toast.error(error.message);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const users = projects.data?.users ?? [];
  const filteredItems = useMemo(() => itemsQuery.data?.items ?? [], [itemsQuery.data]);
  const canCreateItems = user.role !== 'DEVELOPER' || projectQuery.data?.project.members.some((member) => member.user.id === user.id);

  if (projectQuery.isLoading || projects.isLoading || itemsQuery.isLoading) return <div>Loading project…</div>;
  const project = projectQuery.data?.project;
  if (!project) return <div>Project not found.</div>;

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs text-slate-500">{project.code}</div>
            <h2 className="text-2xl font-semibold">{project.name}</h2>
            <p className="mt-2 text-sm text-slate-600">{project.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={search} onChange={(event) => setSearchParams((params) => { const next = new URLSearchParams(params); next.set('search', event.target.value); return next; })} placeholder="Search in project" />
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={status} onChange={(event) => setSearchParams((params) => { const next = new URLSearchParams(params); if (event.target.value) next.set('status', event.target.value); else next.delete('status'); return next; })}>
              <option value="">All statuses</option>
              {['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((option) => <option key={option}>{option}</option>)}
            </select>
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => setView(view === 'table' ? 'board' : 'table')}>{view === 'table' ? 'Board view' : 'Table view'}</button>
            {canCreateItems && <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => setCreating(true)}>New item</button>}
          </div>
        </div>
      </div>
      {view === 'table' ? (
        <ItemsTable items={filteredItems} users={users} onQuickUpdate={(item, patch) => quickUpdate.mutate({ item, patch })} onOpen={setActiveItem} />
      ) : (
        <ItemsBoard items={filteredItems} onDropStatus={(item, nextStatus) => quickUpdate.mutate({ item, patch: { status: nextStatus } })} onOpen={setActiveItem} />
      )}
      {(activeItem || creating) && (
        <ItemFormModal
          item={activeItem}
          projects={projects.data?.projects ?? []}
          users={users}
          defaultProjectId={projectId}
          currentUserId={user.id}
          onClose={() => { setActiveItem(undefined); setCreating(false); }}
          onSubmit={(values) => saveItem.mutate({ id: activeItem?.id, body: values })}
        />
      )}
    </div>
  );
}
