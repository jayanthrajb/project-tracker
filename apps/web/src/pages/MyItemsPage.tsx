import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { formatDate } from '../lib/utils';
import type { Item, User } from '../types';

export function MyItemsPage({ user }: { user: User }) {
  const items = useQuery({ queryKey: ['my-items', user.id], queryFn: () => api<{ items: Item[]; total: number }>(`/items?assigneeId=${user.id}&sort=score-desc&pageSize=100`) });

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-2xl font-semibold">My Items</h2>
        <p className="text-sm text-slate-500">Everything assigned to you, highest score first.</p>
      </div>
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
