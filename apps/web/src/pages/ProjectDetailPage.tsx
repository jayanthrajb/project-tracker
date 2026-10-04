import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import { ItemFormModal } from '../components/ItemFormModal';
import { ItemsBoard, ItemsTable } from '../components/ItemsTable';
import { api } from '../lib/api';
import { findItem } from '../lib/findItem';
import type { ApiError } from '../lib/api';
import type { Item, ItemPriority, ItemStatus, Project, User } from '../types';

const FREEZE_STORAGE_KEY = 'project-tracker.freeze-order-while-editing';
const ProjectActivity = lazy(() => import('../components/ProjectActivity').then((module) => ({ default: module.ProjectActivity })));

type BulkActionType = 'assignee' | 'status' | 'priority' | 'risk' | 'dueDate' | 'addTag' | 'removeTag';

export function ProjectDetailPage({ user }: { user: User }) {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'board'>('table');
  const [activeItem, setActiveItem] = useState<Item | undefined>();
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<Item>>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [freezeOrderWhileEditing, setFreezeOrderWhileEditing] = useState(() => localStorage.getItem(FREEZE_STORAGE_KEY) !== 'false');
  const [bulkActionType, setBulkActionType] = useState<BulkActionType>('status');
  const [bulkActionValue, setBulkActionValue] = useState('IN_PROGRESS');
  const queryClient = useQueryClient();
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';
  const itemParam = searchParams.get('item');

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => api<{ project: Project }>(`/projects/${projectId}`) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: Project[]; users: User[] }>('/projects') });
  const itemsQuery = useQuery({
    queryKey: ['items', projectId, search, status],
    queryFn: () => api<{ items: Item[]; total: number }>(`/items?projectId=${projectId}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&sort=score-desc&pageSize=100`),
  });
  const linkedItem = useQuery({
    queryKey: ['item', itemParam],
    queryFn: () => findItem(itemParam ?? '', { projectId }),
    enabled: Boolean(itemParam && itemsQuery.data && !itemsQuery.data.items.some((entry) => entry.id === itemParam)),
    staleTime: 60_000,
    retry: false,
  });

  const invalidateActivity = (itemIds: string[]) => {
    void queryClient.invalidateQueries({ queryKey: ['activity', 'projects', projectId] });
    for (const id of new Set(itemIds)) {
      void queryClient.invalidateQueries({ queryKey: ['activity', 'items', id] });
      void queryClient.invalidateQueries({ queryKey: ['item', id], exact: true });
    }
  };

  const saveItem = useMutation({
    mutationFn: (payload: { id?: string; body: Record<string, unknown> }) => payload.id
      ? api(`/items/${payload.id}`, { method: 'PATCH', body: JSON.stringify(payload.body) })
      : api('/items', { method: 'POST', body: JSON.stringify(payload.body) }),
    onSuccess: async (_result, payload) => {
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Item saved');
      invalidateActivity(payload.id ? [payload.id] : []);
      closeItemModal();
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  const quickUpdate = useMutation({
    mutationFn: ({ item, patch }: { item: Item; patch: Partial<Item> }) => api(`/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ ...item, ...patch, tags: item.tags }) }),
    onSettled: async (_result, _error, { item }) => {
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      invalidateActivity([item.id]);
    },
  });

  const saveBulk = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(drafts).map(([id, patch]) => ({ id, ...patch }));
      return api<{ items: Item[] }>('/items/bulk', {
        method: 'PATCH',
        body: JSON.stringify({ updates }),
      });
    },
    onSuccess: async () => {
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Saved staged changes');
      invalidateActivity(Object.keys(drafts));
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  useEffect(() => {
    localStorage.setItem(FREEZE_STORAGE_KEY, String(freezeOrderWhileEditing));
  }, [freezeOrderWhileEditing]);

  const draftCount = Object.keys(drafts).length;

  const openItem = (item: Item) => {
    setActiveItem(item);
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.set('item', item.id);
      next.delete('tab');
      return next;
    }, { replace: true });
  };

  function closeItemModal() {
    setActiveItem(undefined);
    setCreating(false);
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.delete('item');
      next.delete('tab');
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (draftCount > 0) {
        event.preventDefault();
        event.returnValue = 'You have unsaved item edits.';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [draftCount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (draftCount > 0) {
          void saveBulk.mutateAsync();
        }
      }

      if (event.key === 'Escape') {
        const active = document.activeElement;
        if (active && active instanceof HTMLSelectElement) {
          const rowId = active.closest('tr')?.getAttribute('data-row-id');
          if (rowId && drafts[rowId]) {
            setDrafts((current) => {
              const next = { ...current };
              delete next[rowId];
              return next;
            });
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draftCount, drafts, saveBulk]);

  const users = projects.data?.users ?? [];
  const items = useMemo(() => itemsQuery.data?.items ?? [], [itemsQuery.data]);

  // Resolve deep links even when the item is outside the filtered/paginated table.
  useEffect(() => {
    if (!itemParam || !itemsQuery.data) return;
    const listed = itemsQuery.data.items.find((entry) => entry.id === itemParam);
    const error = linkedItem.error as ApiError | null;
    if (!listed && linkedItem.isError && (error?.status === 404 || error?.status === 403)) {
      // A failed refetch can retain cached data for a deleted/inaccessible item.
      setActiveItem((current) => current?.id === itemParam ? undefined : current);
      setSearchParams((params) => {
        const next = new URLSearchParams(params);
        next.delete('item');
        next.delete('tab');
        return next;
      }, { replace: true });
      queryClient.removeQueries({ queryKey: ['item', itemParam], exact: true });
      return;
    }
    const linked = listed ?? linkedItem.data?.item;
    if (linked) setActiveItem((current) => current?.id === linked.id ? current : linked);
  }, [itemParam, itemsQuery.data, linkedItem.data, linkedItem.error, linkedItem.isError, queryClient, setSearchParams]);
  const mergedItems = useMemo(
    () => items.map((item) => ({ ...item, ...(drafts[item.id] ?? {}) })),
    [items, drafts],
  );

  const displayedItems = useMemo(() => {
    if (freezeOrderWhileEditing && draftCount > 0) {
      return mergedItems;
    }
    return mergedItems;
  }, [draftCount, freezeOrderWhileEditing, mergedItems]);

  const canCreateItems = user.role !== 'DEVELOPER' || Boolean(projectQuery.data?.project.ownerId === user.id || projectQuery.data?.project.members.some((member) => member.user.id === user.id));

  const stageRowPatch = (item: Item, patch: Partial<Item>) => {
    setDrafts((current) => {
      const next = { ...current };
      const previous = next[item.id] ?? {};
      const merged = { ...previous, ...patch };

      const normalizedEntries = Object.entries(merged).filter(([key, value]) => {
        const original = (item as unknown as Record<string, unknown>)[key];
        return value !== original;
      });

      if (normalizedEntries.length === 0) {
        delete next[item.id];
        return next;
      }

      next[item.id] = Object.fromEntries(normalizedEntries) as Partial<Item>;
      return next;
    });
  };

  const discardAll = () => {
    setDrafts({});
  };

  const applyBulkAction = () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least one row');
      return;
    }

    const selected = items.filter((item) => selectedIds.has(item.id));
    for (const item of selected) {
      switch (bulkActionType) {
        case 'assignee':
          stageRowPatch(item, { assigneeId: bulkActionValue || null });
          break;
        case 'status':
          stageRowPatch(item, { status: bulkActionValue as ItemStatus });
          break;
        case 'priority':
          stageRowPatch(item, { priority: bulkActionValue as ItemPriority });
          break;
        case 'risk':
          stageRowPatch(item, { risk: bulkActionValue as Item['risk'] });
          break;
        case 'dueDate':
          stageRowPatch(item, { dueDate: bulkActionValue || null });
          break;
        case 'addTag': {
          const nextTags = Array.from(new Set([...(item.tags ?? []), bulkActionValue])).filter(Boolean);
          stageRowPatch(item, { tags: nextTags });
          break;
        }
        case 'removeTag': {
          const nextTags = (item.tags ?? []).filter((tag) => tag !== bulkActionValue);
          stageRowPatch(item, { tags: nextTags });
          break;
        }
      }
    }

    toast.success('Bulk draft changes staged');
  };

  if (projectQuery.isLoading || projects.isLoading || itemsQuery.isLoading) return <div>Loading project…</div>;
  const project = projectQuery.data?.project;
  if (!project) return <div>Project not found.</div>;

  return (
    <div className="grid gap-6 pb-24">
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
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <input type="checkbox" checked={freezeOrderWhileEditing} onChange={(event) => setFreezeOrderWhileEditing(event.target.checked)} />
              Freeze order while editing
            </label>
            {freezeOrderWhileEditing && draftCount > 0 && (
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => void itemsQuery.refetch()}>
                Re-sort now
              </button>
            )}
            {canCreateItems && <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => setCreating(true)}>New item</button>}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid min-w-0 gap-4">
      {linkedItem.isError && (linkedItem.error as ApiError).status !== 404 && (linkedItem.error as ApiError).status !== 403 && (
        <div role="alert" className="text-sm text-red-700">Could not open linked item. <button type="button" className="underline" onClick={() => void linkedItem.refetch()}>Retry</button></div>
      )}
      {view === 'table' ? (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{selectedIds.size} selected</span>
              <select className="rounded border border-slate-300 px-2 py-1" value={bulkActionType} onChange={(event) => setBulkActionType(event.target.value as BulkActionType)}>
                <option value="assignee">Assign to</option>
                <option value="status">Set status</option>
                <option value="priority">Set priority</option>
                <option value="risk">Set risk</option>
                <option value="dueDate">Set due date</option>
                <option value="addTag">Add tag</option>
                <option value="removeTag">Remove tag</option>
              </select>
              {bulkActionType === 'assignee' ? (
                <select className="rounded border border-slate-300 px-2 py-1" value={bulkActionValue} onChange={(event) => setBulkActionValue(event.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              ) : bulkActionType === 'status' ? (
                <select className="rounded border border-slate-300 px-2 py-1" value={bulkActionValue} onChange={(event) => setBulkActionValue(event.target.value)}>
                  {['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((option) => <option key={option}>{option}</option>)}
                </select>
              ) : bulkActionType === 'priority' ? (
                <select className="rounded border border-slate-300 px-2 py-1" value={bulkActionValue} onChange={(event) => setBulkActionValue(event.target.value)}>
                  {['P0', 'P1', 'P2', 'P3'].map((option) => <option key={option}>{option}</option>)}
                </select>
              ) : bulkActionType === 'risk' ? (
                <select className="rounded border border-slate-300 px-2 py-1" value={bulkActionValue} onChange={(event) => setBulkActionValue(event.target.value)}>
                  {['LOW', 'MEDIUM', 'HIGH'].map((option) => <option key={option}>{option}</option>)}
                </select>
              ) : bulkActionType === 'dueDate' ? (
                <input className="rounded border border-slate-300 px-2 py-1" type="date" value={bulkActionValue} onChange={(event) => setBulkActionValue(event.target.value)} />
              ) : (
                <input className="rounded border border-slate-300 px-2 py-1" value={bulkActionValue} onChange={(event) => setBulkActionValue(event.target.value)} placeholder="Tag" />
              )}
              <button className="rounded bg-slate-900 px-3 py-1.5 text-white" onClick={applyBulkAction}>Apply to selected</button>
            </div>
          </div>
          <ItemsTable
            items={displayedItems}
            users={users}
            drafts={drafts}
            selectedIds={selectedIds}
            onToggleSelect={(itemId) => {
              setSelectedIds((current) => {
                const next = new Set(current);
                if (next.has(itemId)) next.delete(itemId);
                else next.add(itemId);
                return next;
              });
            }}
            onSelectAll={(checked) => {
              if (checked) {
                setSelectedIds(new Set(displayedItems.map((item) => item.id)));
              } else {
                setSelectedIds(new Set());
              }
            }}
            onDraftChange={stageRowPatch}
            onRevertRow={(itemId) => {
              setDrafts((current) => {
                const next = { ...current };
                delete next[itemId];
                return next;
              });
            }}
            onOpen={openItem}
          />
        </>
      ) : (
        <ItemsBoard items={items} onDropStatus={(item, nextStatus) => quickUpdate.mutate({ item, patch: { status: nextStatus } })} onOpen={openItem} />
      )}
      </div>
      <Suspense fallback={<div className="text-xs text-slate-500">Loading recent activity…</div>}>
        <ProjectActivity projectId={projectId} users={users} items={items} />
      </Suspense>
      </div>

      {draftCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="text-sm font-medium">{draftCount} unsaved change{draftCount === 1 ? '' : 's'}</div>
            <div className="flex gap-2">
              <button className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={discardAll}>Discard all</button>
              <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => saveBulk.mutate()}>
                Save all
              </button>
            </div>
          </div>
        </div>
      )}

      {(activeItem || creating) && (
        <ItemFormModal
          key={activeItem?.id ?? `new-${projectId}`}
          item={activeItem}
          projects={projects.data?.projects ?? []}
          users={users}
          defaultProjectId={projectId}
          currentUser={user}
          onClose={closeItemModal}
          onSubmit={(values) => saveItem.mutate({ id: activeItem?.id, body: values })}
        />
      )}
    </div>
  );
}
