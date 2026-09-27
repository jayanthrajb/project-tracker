import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { formatDate } from '../lib/utils';
import type { DashboardResponse, User } from '../types';

const bucketMeta = [
  { key: 'overdue', label: 'Overdue', tone: 'bg-red-50 border-red-200 text-red-700' },
  { key: 'dueSoon', label: 'Due in 3 days', tone: 'bg-amber-50 border-amber-200 text-amber-700' },
  { key: 'blocked', label: 'Blocked', tone: 'bg-red-50 border-red-200 text-red-700' },
  { key: 'needsAttention', label: 'Needs attention', tone: 'bg-amber-50 border-amber-200 text-amber-700' },
] as const;

export function DashboardPage({ user }: { user: User }) {
  const [activeBucket, setActiveBucket] = useState<keyof DashboardResponse['buckets']>('overdue');
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardResponse>('/dashboard') });
  const items = useMemo(() => dashboard.data?.buckets[activeBucket] ?? [], [dashboard.data, activeBucket]);

  if (dashboard.isLoading) return <div>Loading dashboard…</div>;

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {bucketMeta.map((bucket) => (
          <button key={bucket.key} onClick={() => setActiveBucket(bucket.key)} className={`rounded-2xl border p-5 text-left ${bucket.tone} ${activeBucket === bucket.key ? 'ring-2 ring-slate-900' : ''}`}>
            <div className="text-sm font-medium">{bucket.label}</div>
            <div className="mt-2 text-3xl font-semibold">{dashboard.data?.summary[bucket.key] ?? 0}</div>
          </button>
        ))}
      </section>
      <section className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{bucketMeta.find((bucket) => bucket.key === activeBucket)?.label}</h2>
            <span className="text-sm text-slate-500">Sorted for attention</span>
          </div>
          <div className="grid gap-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">{item.key} · {item.project.code}</div>
                    <div className="font-medium">{item.title}</div>
                    <div className="text-sm text-slate-500">{item.assignee?.name ?? 'Unassigned'} · Due {formatDate(item.dueDate)}</div>
                  </div>
                  <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">Score {item.score}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">My items</h2>
            <div className="mt-3 grid gap-3">
              {dashboard.data?.myItems.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="font-medium">{item.title}</div>
                  <div className="text-slate-500">{item.project.code} · {item.status} · {item.score}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-slate-500">Logged in as {user.name}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">Per-project open counts</h2>
            <div className="mt-3 grid gap-3">
              {dashboard.data?.perProjectOpenCounts.map((project) => (
                <div key={project.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
                  <span>{project.code} · {project.name}</span>
                  <span className="font-semibold">{project.openCount}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">Stale in progress</h2>
            <div className="mt-3 grid gap-3">
              {dashboard.data?.stale.map((item) => (
                <div key={item.id} className="rounded-xl bg-amber-50 p-3 text-sm">
                  <div className="font-medium">{item.title}</div>
                  <div className="text-amber-800">Updated {formatDate(item.updatedAt)}</div>
                </div>
              ))}
              {!dashboard.data?.stale.length && <div className="text-sm text-slate-500">No stale work right now.</div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
