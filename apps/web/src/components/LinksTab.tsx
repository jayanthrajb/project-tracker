import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../lib/api';
import type { Item, ItemLink } from '../types';

type ItemsResponse = { items: Item[]; total: number; pageSize: number };
type DependencyType = 'BLOCKS' | 'RELATES_TO';
type EditableGroup = 'blocks' | 'relatesTo';
type Operation =
  | { kind: 'parent'; childId: string; parentId: string | null }
  | { kind: 'add-dependency'; targetId: string; type: DependencyType }
  | { kind: 'remove-dependency'; targetId: string; type: DependencyType };

async function loadItems() {
  const items: Item[] = [];
  let total = 0;
  let page = 1;
  do {
    const result = await api<ItemsResponse>(`/items?page=${page}&pageSize=100`);
    items.push(...result.items);
    total = result.total;
    if (!result.items.length) break;
    page += 1;
  } while ((page - 1) * 100 < total);
  return items;
}

function listIds(data: unknown) {
  if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items)) return [];
  return data.items.flatMap((entry) => entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string' ? [entry.id] : []);
}

async function invalidateAffected(client: ReturnType<typeof useQueryClient>, ids: string[]) {
  const affected = new Set(ids);
  const invalidations: Promise<void>[] = [];
  for (const id of affected) {
    invalidations.push(client.invalidateQueries({ queryKey: ['item-links', id], exact: true }));
    invalidations.push(client.invalidateQueries({ queryKey: ['item', id], exact: true }));
  }
  for (const prefix of [['items'], ['my-items']] as const) {
    for (const [queryKey, data] of client.getQueriesData({ queryKey: prefix })) {
      if (listIds(data).some((id) => affected.has(id))) {
        invalidations.push(client.invalidateQueries({ queryKey, exact: true }));
      }
    }
  }
  await Promise.all(invalidations);
}

export function LinksTab({ item }: { item: Item }) {
  const client = useQueryClient();
  const [selection, setSelection] = useState<Record<'parent' | 'child' | EditableGroup, string>>({
    parent: '', child: '', blocks: '', relatesTo: '',
  });
  const [error, setError] = useState<string | null>(null);
  const itemsQuery = useQuery({
    queryKey: ['item-links', item.id],
    queryFn: loadItems,
  });
  const mutation = useMutation({
    mutationFn: async (operation: Operation) => {
      if (operation.kind === 'parent') {
        await api(`/items/${encodeURIComponent(operation.childId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ parentId: operation.parentId }),
        });
        return { affected: [item.id, operation.childId], selection: operation.childId === item.id ? 'parent' as const : 'child' as const };
      }
      const { dependency } = await api<{ dependency: { id: string } }>('/items/dependencies', {
        method: 'POST',
        body: JSON.stringify({ fromId: item.id, toId: operation.targetId, type: operation.type }),
      });
      if (operation.kind === 'remove-dependency') {
        await api(`/items/dependencies/${encodeURIComponent(dependency.id)}`, { method: 'DELETE' });
      }
      return { affected: [item.id, operation.targetId], selection: operation.type === 'BLOCKS' ? 'blocks' as const : 'relatesTo' as const };
    },
    onSuccess: async (result) => {
      setError(null);
      setSelection((current) => ({ ...current, [result.selection]: '' }));
      await invalidateAffected(client, result.affected);
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : 'Could not update item links'),
  });

  const current = itemsQuery.data?.find((entry) => entry.id === item.id) ?? item;
  const allItems = itemsQuery.data ?? [];
  const sameProject = allItems.filter((entry) => entry.projectId === item.projectId && entry.id !== item.id);
  const parentIds = new Set(current.children?.map((child) => child.id) ?? []);
  const childOptions = sameProject.filter((entry) => !parentIds.has(entry.id));
  const parentOptions = sameProject;
  const targetItems = allItems.filter((entry) => entry.id !== item.id);
  const linkTarget = (link: ItemLink) => {
    const target = allItems.find((entry) => entry.id === link.id);
    const projectId = target?.projectId ?? item.projectId;
    return `/projects/${encodeURIComponent(projectId)}?item=${encodeURIComponent(link.id)}`;
  };
  const renderLinks = (links: ItemLink[] | undefined, group: 'parent' | 'children' | 'blocks' | 'blockedBy' | 'relatesTo') => (
    links?.length ? (
      <ul className="grid gap-2">
        {links.map((link) => (
          <li key={link.id} className="flex flex-wrap items-center gap-x-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <Link className="font-medium text-slate-900 hover:underline" to={linkTarget(link)}>{link.key} · {link.title}</Link>
            <span className="text-slate-500">{link.status}</span>
            {link.projectCode !== item.project.code && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{link.projectCode}</span>}
            {group === 'children' && <button type="button" className="ml-auto text-xs text-rose-700 underline" disabled={mutation.isPending} aria-label={`Remove child ${link.key}`} onClick={() => mutation.mutate({ kind: 'parent', childId: link.id, parentId: null })}>Remove</button>}
            {(group === 'blocks' || group === 'relatesTo') && <button type="button" className="ml-auto text-xs text-rose-700 underline" disabled={mutation.isPending} aria-label={`Remove ${group === 'blocks' ? 'blocks' : 'relates to'} ${link.key}`} onClick={() => mutation.mutate({ kind: 'remove-dependency', targetId: link.id, type: group === 'blocks' ? 'BLOCKS' : 'RELATES_TO' })}>Remove</button>}
          </li>
        ))}
      </ul>
    ) : null
  );
  const selectClasses = 'min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm';

  return (
    <div className="grid gap-5">
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {itemsQuery.isPending ? <p role="status" className="py-6 text-center text-sm text-slate-500">Loading links…</p>
        : itemsQuery.isError ? <div role="alert" className="text-sm text-rose-700">Could not load item links. <button type="button" className="underline" onClick={() => void itemsQuery.refetch()}>Retry</button></div>
          : <>
            <section className="grid gap-2">
              <h4 className="font-medium">Parent</h4>
              {renderLinks(current.parent ? [current.parent] : [], 'parent') ?? <p className="text-sm text-slate-500">No parent</p>}
              <div className="flex flex-wrap gap-2">
                <select aria-label="Parent item" className={selectClasses} value={selection.parent} onChange={(event) => setSelection((value) => ({ ...value, parent: event.target.value }))}>
                  <option value="">Choose a parent</option>
                  {parentOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.key} · {entry.title} · {entry.status}</option>)}
                </select>
                <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled={!selection.parent || mutation.isPending} onClick={() => mutation.mutate({ kind: 'parent', childId: item.id, parentId: selection.parent })}>Set parent</button>
                {current.parent && <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: 'parent', childId: item.id, parentId: null })}>Clear parent</button>}
              </div>
            </section>
            <section className="grid gap-2">
              <h4 className="font-medium">Children</h4>
              {renderLinks(current.children, 'children')}
              <div className="flex flex-wrap gap-2">
                <select aria-label="Child item" className={selectClasses} value={selection.child} onChange={(event) => setSelection((value) => ({ ...value, child: event.target.value }))}>
                  <option value="">Choose a child</option>
                  {childOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.key} · {entry.title} · {entry.status}</option>)}
                </select>
                <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled={!selection.child || mutation.isPending} onClick={() => mutation.mutate({ kind: 'parent', childId: selection.child, parentId: item.id })}>Add child</button>
              </div>
            </section>
            {([
              ['blocks', 'Blocks', 'BLOCKS'],
              ['blockedBy', 'Blocked by', null],
              ['relatesTo', 'Relates to', 'RELATES_TO'],
            ] as const).map(([group, label, type]) => {
              const links = current[group] ?? [];
              const linkedIds = new Set(links.map((link) => link.id));
              return (
                <section key={group} aria-label={label} className="grid gap-2">
                  <h4 className="font-medium">{label}</h4>
                  {renderLinks(links, group)}
                  {type && <div className="flex flex-wrap gap-2">
                    <select aria-label={`${label} item`} className={selectClasses} value={selection[group as EditableGroup]} onChange={(event) => setSelection((value) => ({ ...value, [group]: event.target.value }))}>
                      <option value="">Choose an item</option>
                      {targetItems.filter((entry) => !linkedIds.has(entry.id)).map((entry) => <option key={entry.id} value={entry.id}>{entry.key} · {entry.title} · {entry.status} · {entry.project.code}</option>)}
                    </select>
                    <button type="button" aria-label={`Add ${label.toLowerCase()} link`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled={!selection[group as EditableGroup] || mutation.isPending} onClick={() => mutation.mutate({ kind: 'add-dependency', targetId: selection[group as EditableGroup], type })}>Add</button>
                  </div>}
                </section>
              );
            })}
          </>}
    </div>
  );
}
