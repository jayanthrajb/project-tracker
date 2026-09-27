import { cn, formatDate } from '../lib/utils';
import type { Item, ItemPriority, ItemStatus, User } from '../types';

const priorityColors: Record<ItemPriority, string> = {
  P0: 'bg-red-100 text-red-700',
  P1: 'bg-orange-100 text-orange-700',
  P2: 'bg-blue-100 text-blue-700',
  P3: 'bg-slate-100 text-slate-700',
};

export function ItemsTable({
  items,
  users,
  onQuickUpdate,
  onOpen,
}: {
  items: Item[];
  users: User[];
  onQuickUpdate: (item: Item, patch: Partial<Item>) => void;
  onOpen: (item: Item) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            {['Key', 'Title', 'Type', 'Priority', 'Risk', 'Status', 'Assignee', 'Due', 'Score'].map((heading) => (
              <th key={heading} className="px-3 py-3 font-medium">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const overdue = item.status !== 'DONE' && item.dueDate && new Date(item.dueDate) < new Date();
            const soon = item.status !== 'DONE' && item.dueDate && new Date(item.dueDate) >= new Date() && (new Date(item.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 3;
            return (
              <tr key={item.id} className={cn('border-t border-slate-200', overdue && 'bg-red-50', soon && !overdue && 'bg-amber-50')}>
                <td className="px-3 py-3 font-medium">{item.key}</td>
                <td className="px-3 py-3">
                  <button className="text-left font-medium text-slate-900 hover:underline" onClick={() => onOpen(item)}>{item.title}</button>
                  <div className="text-xs text-slate-500">{item.project.code}</div>
                </td>
                <td className="px-3 py-3">{item.type}</td>
                <td className="px-3 py-3">
                  <select value={item.priority} onChange={(event) => onQuickUpdate(item, { priority: event.target.value as ItemPriority })} className={cn('rounded-full border px-2 py-1 text-xs font-semibold', priorityColors[item.priority])}>
                    {['P0', 'P1', 'P2', 'P3'].map((option) => <option key={option}>{option}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3"><span className={cn('rounded-full px-2 py-1 text-xs font-semibold', item.risk === 'HIGH' ? 'bg-red-100 text-red-700' : item.risk === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>{item.risk}</span></td>
                <td className="px-3 py-3">
                  <select value={item.status} onChange={(event) => onQuickUpdate(item, { status: event.target.value as ItemStatus })} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    {['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((option) => <option key={option}>{option}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3">
                  <select value={item.assigneeId ?? ''} onChange={(event) => onQuickUpdate(item, { assigneeId: event.target.value || null })} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    <option value="">Unassigned</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3">{formatDate(item.dueDate)}</td>
                <td className="px-3 py-3 font-semibold">{item.score}</td>
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
