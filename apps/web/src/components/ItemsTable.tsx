import { cn, formatDate } from '../lib/utils';
import { priorityColors, riskColors } from '../lib/itemColors';
import type { Item, ItemPriority, ItemStatus, User } from '../types';

export function ItemsTable({
  items,
  users,
  drafts,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDraftChange,
  onRevertRow,
  onOpen,
}: {
  items: Item[];
  users: User[];
  drafts: Record<string, Partial<Item>>;
  selectedIds: Set<string>;
  onToggleSelect: (itemId: string) => void;
  onSelectAll: (checked: boolean) => void;
  onDraftChange: (item: Item, patch: Partial<Item>) => void;
  onRevertRow: (itemId: string) => void;
  onOpen: (item: Item) => void;
}) {
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-3 py-3 font-medium">
              <input type="checkbox" checked={allSelected} onChange={(event) => onSelectAll(event.target.checked)} />
            </th>
            {['Key', 'Title', 'Type', 'Priority', 'Risk', 'Status', 'Assignee', 'Due', 'Score', 'Actions'].map((heading) => (
              <th key={heading} className="px-3 py-3 font-medium">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const draft = drafts[item.id] ?? {};
            const merged = { ...item, ...draft };
            const dirty = Object.keys(draft).length > 0;
            const overdue = merged.status !== 'DONE' && merged.dueDate && new Date(merged.dueDate) < new Date();
            const soon = merged.status !== 'DONE' && merged.dueDate && new Date(merged.dueDate) >= new Date() && (new Date(merged.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 3;
            return (
              <tr
                key={item.id}
                data-row-id={item.id}
                className={cn(
                  'border-t border-slate-200',
                  overdue && 'bg-red-50',
                  soon && !overdue && 'bg-amber-50',
                  dirty && 'bg-blue-50/60 ring-1 ring-inset ring-blue-200',
                )}
              >
                <td className="px-3 py-3 align-top">
                  <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggleSelect(item.id)} />
                </td>
                <td className="px-3 py-3 font-medium">{merged.key}</td>
                <td className="px-3 py-3">
                  <button className="text-left font-medium text-slate-900 hover:underline" onClick={() => onOpen(merged)}>{merged.title}</button>
                  <div className="text-xs text-slate-500">{merged.project.code}</div>
                </td>
                <td className="px-3 py-3">{merged.type}</td>
                <td className="px-3 py-3">
                  <select
                    value={merged.priority}
                    onChange={(event) => onDraftChange(item, { priority: event.target.value as ItemPriority })}
                    className={cn('rounded-full border px-2 py-1 text-xs font-semibold', priorityColors[merged.priority])}
                  >
                    {['P0', 'P1', 'P2', 'P3'].map((option) => <option key={option}>{option}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3"><span className={cn('rounded-full px-2 py-1 text-xs font-semibold', riskColors[merged.risk])}>{merged.risk}</span></td>
                <td className="px-3 py-3">
                  <select value={merged.status} onChange={(event) => onDraftChange(item, { status: event.target.value as ItemStatus })} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    {['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((option) => <option key={option}>{option}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3">
                  <select
                    value={merged.assigneeId ?? ''}
                    onChange={(event) => onDraftChange(item, { assigneeId: event.target.value || null })}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">Unassigned</option>
                    {users.filter((user) => user.isActive ?? true).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3">{formatDate(merged.dueDate)}</td>
                <td className="px-3 py-3 font-semibold">{merged.score}</td>
                <td className="px-3 py-3">
                  {dirty && (
                    <button className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => onRevertRow(item.id)}>
                      Revert
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ItemsBoard({
  items,
  onDropStatus,
  onOpen,
}: {
  items: Item[];
  onDropStatus: (item: Item, status: ItemStatus) => void;
  onOpen: (item: Item) => void;
}) {
  const columns: ItemStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'];
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      {columns.map((status) => (
        <div key={status} className="rounded-2xl border border-slate-200 bg-white p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          const itemId = event.dataTransfer.getData('text/plain');
          const item = items.find((entry) => entry.id === itemId);
          if (item) onDropStatus(item, status);
        }}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">{status.replaceAll('_', ' ')}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{items.filter((item) => item.status === status).length}</span>
          </div>
          <div className="grid gap-3">
            {items.filter((item) => item.status === status).map((item) => (
              <button key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)} className="rounded-xl border border-slate-200 p-3 text-left hover:border-slate-400" onClick={() => onOpen(item)}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">{item.key}</div>
                    <div className="font-medium">{item.title}</div>
                  </div>
                  <span className="rounded-full bg-slate-900 px-2 py-1 text-xs text-white">{item.score}</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">{item.assignee?.name ?? 'Unassigned'} · {formatDate(item.dueDate)}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
