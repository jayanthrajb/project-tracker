import { Suspense, lazy, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import { ItemFormModal } from '../components/ItemFormModal';
import { api, ApiError } from '../lib/api';
import { buildReportCsv, downloadReportCsv } from '../lib/reportCsv';
import { findItem } from '../lib/findItem';
import type { AgingResponse, BurndownResponse, OverdueResponse, ReportItem, StatusBreakdownResponse, ThroughputResponse, WorkloadResponse } from '../../../api/src/routes/reports.js';
import type { Item, Project, User } from '../types';

const BarChart = lazy(() => import('../components/charts/BarChart').then((module) => ({ default: module.BarChart })));
const LineChart = lazy(() => import('../components/charts/LineChart').then((module) => ({ default: module.LineChart })));
const chartFallback = <div className="h-56 animate-pulse rounded-lg bg-slate-100" aria-label="Loading chart" />;
const inputClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60';

function utcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDate(date);
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && utcDate(date) === value;
}

function defaultRange() {
  const to = utcDate(new Date());
  return { from: shiftDate(to, -29), to };
}

function readRange(params: URLSearchParams) {
  const fallback = defaultRange();
  const to = params.get('to') ?? fallback.to;
  return { from: params.get('from') ?? shiftDate(to, -29), to };
}

function validRange({ from, to }: { from: string; to: string }) {
  if (!isDate(from) || !isDate(to)) return false;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  return days > 0 && days <= 366;
}

function presetRange(preset: string) {
  const to = utcDate(new Date());
  if (preset === 'quarter') {
    const now = new Date(`${to}T00:00:00.000Z`);
    const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    return { from: utcDate(new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1))), to };
  }
  const days = Number(preset);
  return { from: shiftDate(to, -(days - 1)), to };
}

function activePreset(range: { from: string; to: string }) {
  for (const preset of ['7', '30', '90', 'quarter']) {
    const candidate = presetRange(preset);
    if (candidate.from === range.from && candidate.to === range.to) return preset;
  }
  return 'custom';
}

function dateLabel(value: string) {
  return value.slice(0, 10);
}

function isEmptyStatus(data: StatusBreakdownResponse) {
  return data.items.every((entry) => entry.value === 0);
}

function isEmptyWorkload(data: WorkloadResponse) {
  return data.assignees.every((entry) => entry.totalOpen === 0);
}

function isEmptyOverdue(data: OverdueResponse) {
  return data.mostOverdue.length === 0 && data.buckets.every((entry) => entry.value === 0);
}

function isEmptyAging(data: AgingResponse) {
  return data.staleItems.length === 0 && [...data.byCreationAge, ...data.byLastActivity].every((entry) => entry.value === 0);
}

function isEmptyTimeSeries(points: { value: number }[]) {
  return points.length === 0 || points.every((point) => point.value === 0);
}

function errorMessage(error: Error) {
  if (error instanceof ApiError && error.status === 403) return "You don't have access to this project's reports.";
  if (error instanceof ApiError && error.status === 401) return 'Sign in to view project reports.';
  return error.message || 'Could not load this report.';
}

function ReportCard({
  title,
  description,
  loading,
  error,
  empty,
  retry,
  exportReport,
  controls,
  children,
}: {
  title: string;
  description: string;
  loading: boolean;
  error: Error | null;
  empty: boolean;
  retry: () => void;
  exportReport: () => void;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby={`report-${title}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`report-${title}`} className="font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <button type="button" className={buttonClass} disabled={loading || Boolean(error)} onClick={exportReport}>Export CSV</button>
        </div>
      </div>
      <div className="mt-4">
        {loading ? (
          <div role="status" aria-label={`Loading ${title}`} className="h-56 animate-pulse rounded-lg bg-slate-100" />
        ) : error ? (
          <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
            <p>{errorMessage(error)}</p>
            <button type="button" className="mt-2 underline" onClick={retry}>Retry {title.toLowerCase()}</button>
          </div>
        ) : empty ? (
          <p className="rounded-lg bg-slate-50 p-8 text-center text-sm text-slate-500">No report data for this date range.</p>
        ) : children}
      </div>
    </section>
  );
}

function exportRows(report: string, project: string, range: { from: string; to: string }, fields: string[], rows: Record<string, string | number | null>[]) {
  const csv = buildReportCsv(report, project, range, fields, rows);
  downloadReportCsv(csv.filename, csv.content);
}

function reportItemsCsv(section: string, items: ReportItem[]) {
  return items.map((item) => ({
    section,
    itemKey: item.key,
    title: item.title,
    status: item.status,
    priority: item.priority,
    assignee: item.assigneeName,
    dueDate: item.dueDate?.slice(0, 10) ?? '',
    createdAt: item.createdAt.slice(0, 10),
    updatedAt: item.updatedAt.slice(0, 10),
  }));
}

export default function ReportsPage({ user }: { user: User }) {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const range = useMemo(() => readRange(searchParams), [searchParams]);
  const rangeIsValid = validRange(range);
  const interval = searchParams.get('interval') === 'week' ? 'week' : 'day';
  const reportQuery = new URLSearchParams({ from: range.from, to: range.to });
  const intervalQuery = new URLSearchParams({ from: range.from, to: range.to, interval });
  const enabled = Boolean(projectId) && rangeIsValid;
  const paramsKey = `${range.from}:${range.to}`;

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => api<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}`) });
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: Project[]; users: User[] }>('/projects') });
  const statusQuery = useQuery({ queryKey: ['reports', projectId, 'status-breakdown', paramsKey], queryFn: () => api<StatusBreakdownResponse>(`/projects/${encodeURIComponent(projectId)}/reports/status-breakdown?${reportQuery}`), enabled, retry: false });
  const workloadQuery = useQuery({ queryKey: ['reports', projectId, 'workload', paramsKey], queryFn: () => api<WorkloadResponse>(`/projects/${encodeURIComponent(projectId)}/reports/workload?${reportQuery}`), enabled, retry: false });
  const overdueQuery = useQuery({ queryKey: ['reports', projectId, 'overdue', paramsKey], queryFn: () => api<OverdueResponse>(`/projects/${encodeURIComponent(projectId)}/reports/overdue?${reportQuery}`), enabled, retry: false });
  const agingQuery = useQuery({ queryKey: ['reports', projectId, 'aging', paramsKey], queryFn: () => api<AgingResponse>(`/projects/${encodeURIComponent(projectId)}/reports/aging?${reportQuery}`), enabled, retry: false });
  const throughputQuery = useQuery({ queryKey: ['reports', projectId, 'throughput', paramsKey, interval], queryFn: () => api<ThroughputResponse>(`/projects/${encodeURIComponent(projectId)}/reports/throughput?${intervalQuery}`), enabled, retry: false });
  const burndownQuery = useQuery({ queryKey: ['reports', projectId, 'burndown', paramsKey], queryFn: () => api<BurndownResponse>(`/projects/${encodeURIComponent(projectId)}/reports/burndown?${reportQuery}`), enabled, retry: false });

  const updateParams = (values: Record<string, string | null>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    const missing = !searchParams.has('from') || !searchParams.has('to');
    const invalidInterval = searchParams.has('interval') && !['day', 'week'].includes(searchParams.get('interval') ?? '');
    if (missing || invalidInterval) {
      updateParams({
        from: searchParams.get('from') ?? range.from,
        to: searchParams.get('to') ?? range.to,
        interval: invalidInterval ? 'day' : searchParams.get('interval'),
      });
    }
  }, [range.from, range.to, searchParams]);

  const itemId = searchParams.get('item');
  const itemQuery = useQuery({
    queryKey: ['report-item', projectId, itemId],
    queryFn: () => findItem(itemId ?? '', { projectId }),
    enabled: Boolean(itemId),
    retry: false,
  });
  const activeItem: Item | undefined = itemQuery.data?.item;
  const closeItem = () => updateParams({ item: null, tab: null });
  const saveItem = useMutation({
    mutationFn: (values: Record<string, unknown>) => activeItem
      ? api(`/items/${encodeURIComponent(activeItem.id)}`, { method: 'PATCH', body: JSON.stringify(values) })
      : Promise.resolve(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reports', projectId] });
      closeItem();
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  const project = projectQuery.data?.project;
  const projectName = project?.code ?? projectId;
  const setDateRange = (next: { from: string; to: string }) => updateParams({ from: next.from, to: next.to });

  return (
    <div className="grid gap-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500">{project?.code ?? 'Project'}</p>
            <h2 className="text-2xl font-semibold">Reports{project ? ` · ${project.name}` : ''}</h2>
            <p className="mt-1 text-sm text-slate-500">Project trends and workload for the selected date range.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-slate-600">
              Date range
              <select aria-label="Date range preset" className={inputClass} value={activePreset(range)} onChange={(event) => {
                if (event.target.value !== 'custom') setDateRange(presetRange(event.target.value));
              }}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="quarter">This quarter</option>
                <option value="custom">Custom range</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-600">From
              <input aria-label="From date" type="date" className={inputClass} value={range.from} onChange={(event) => setDateRange({ ...range, from: event.target.value })} />
            </label>
            <label className="grid gap-1 text-xs text-slate-600">To
              <input aria-label="To date" type="date" className={inputClass} value={range.to} onChange={(event) => setDateRange({ ...range, to: event.target.value })} />
            </label>
          </div>
        </div>
        {!rangeIsValid && <p role="alert" className="mt-3 text-sm text-red-700">Choose valid dates in order, no more than 366 days apart.</p>}
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportCard title="Status breakdown" description="Items created in this range, by current status." loading={statusQuery.isLoading} error={statusQuery.error} empty={!statusQuery.data || isEmptyStatus(statusQuery.data)} retry={() => void statusQuery.refetch()} exportReport={() => {
          if (statusQuery.data) exportRows('status-breakdown', projectName, range, ['status', 'count'], statusQuery.data.items.map((entry) => ({ status: entry.bucket, count: entry.value })));
        }}>
          {statusQuery.data && <Suspense fallback={chartFallback}><BarChart data={statusQuery.data.items.map((entry) => ({ label: entry.bucket, value: entry.value }))} ariaLabel="Items by status" /></Suspense>}
        </ReportCard>

        <ReportCard title="Workload by assignee" description="Open items by priority; includes overdue totals and unassigned work." loading={workloadQuery.isLoading} error={workloadQuery.error} empty={!workloadQuery.data || isEmptyWorkload(workloadQuery.data)} retry={() => void workloadQuery.refetch()} exportReport={() => {
          if (workloadQuery.data) exportRows('workload-by-assignee', projectName, range, ['assignee', 'totalOpen', 'P0', 'P1', 'P2', 'P3', 'overdue'], workloadQuery.data.assignees.map((entry) => ({
            assignee: entry.name, totalOpen: entry.totalOpen, ...Object.fromEntries(entry.byPriority.map((priority) => [priority.bucket, priority.value])), overdue: entry.overdue,
          })));
        }}>
          {workloadQuery.data && <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-slate-500"><tr>{['Assignee', 'Open', 'P0', 'P1', 'P2', 'P3', 'Overdue'].map((label) => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
              <tbody>{workloadQuery.data.assignees.map((entry) => <tr key={entry.assigneeId ?? 'unassigned'} className="border-t border-slate-100">
                <th scope="row" className="px-2 py-2 font-medium">{entry.name}</th>
                <td className="px-2 py-2">{entry.totalOpen}</td>
                {(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => <td key={priority} className="px-2 py-2">{entry.byPriority.find((value) => value.bucket === priority)?.value ?? 0}</td>)}
                <td className="px-2 py-2">{entry.overdue}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </ReportCard>

        <ReportCard title="Overdue summary" description="Open items past due, grouped by age; click an item to open it." loading={overdueQuery.isLoading} error={overdueQuery.error} empty={!overdueQuery.data || isEmptyOverdue(overdueQuery.data)} retry={() => void overdueQuery.refetch()} exportReport={() => {
          if (overdueQuery.data) exportRows('overdue-summary', projectName, range, ['section', 'bucket', 'count', 'itemKey', 'title', 'status', 'priority', 'assignee', 'dueDate', 'createdAt', 'updatedAt'], [
            ...overdueQuery.data.buckets.map((entry) => ({ section: 'bucket', bucket: entry.bucket, count: entry.value, itemKey: '', title: '', status: '', priority: '', assignee: '', dueDate: '', createdAt: '', updatedAt: '' })),
            ...reportItemsCsv('most-overdue-item', overdueQuery.data.mostOverdue).map((entry) => ({ ...entry, section: 'item', bucket: '', count: '' })),
          ]);
        }}>
          {overdueQuery.data && <div className="grid gap-4">
            <Suspense fallback={chartFallback}><BarChart data={overdueQuery.data.buckets.map((entry) => ({ label: entry.bucket, value: entry.value }))} ariaLabel="Overdue items by age" /></Suspense>
            <ul className="divide-y divide-slate-100">
              {overdueQuery.data.mostOverdue.map((item) => <li key={item.id} className="py-2">
                <button type="button" className="text-left text-sm font-medium text-slate-800 underline decoration-slate-300 underline-offset-2" onClick={() => updateParams({ item: item.id, tab: null })}>{item.key} · {item.title}</button>
                <p className="text-xs text-slate-500">Due {item.dueDate?.slice(0, 10) ?? 'date unknown'} · {item.assigneeName ?? 'Unassigned'}</p>
              </li>)}
            </ul>
          </div>}
        </ReportCard>

        <ReportCard title="Aging items" description="Creation age and time since last activity are shown separately." loading={agingQuery.isLoading} error={agingQuery.error} empty={!agingQuery.data || isEmptyAging(agingQuery.data)} retry={() => void agingQuery.refetch()} exportReport={() => {
          if (agingQuery.data) exportRows('aging-items', projectName, range, ['section', 'bucket', 'count', 'itemKey', 'title', 'status', 'priority', 'assignee', 'dueDate', 'createdAt', 'updatedAt'], [
            ...agingQuery.data.byCreationAge.map((entry) => ({ section: 'age since creation', bucket: entry.bucket, count: entry.value, itemKey: '', title: '', status: '', priority: '', assignee: '', dueDate: '', createdAt: '', updatedAt: '' })),
            ...agingQuery.data.byLastActivity.map((entry) => ({ section: 'time since last activity', bucket: entry.bucket, count: entry.value, itemKey: '', title: '', status: '', priority: '', assignee: '', dueDate: '', createdAt: '', updatedAt: '' })),
            ...reportItemsCsv('stale item', agingQuery.data.staleItems).map((entry) => ({ ...entry, section: 'stale item', bucket: '', count: '' })),
          ]);
        }}>
          {agingQuery.data && <div className="grid gap-5">
            <div><h4 className="mb-2 text-sm font-medium">Age since creation</h4><Suspense fallback={chartFallback}><BarChart data={agingQuery.data.byCreationAge.map((entry) => ({ label: entry.bucket, value: entry.value }))} ariaLabel="Open item age since creation" /></Suspense></div>
            <div><h4 className="mb-2 text-sm font-medium">Time since last activity</h4><Suspense fallback={chartFallback}><BarChart data={agingQuery.data.byLastActivity.map((entry) => ({ label: entry.bucket, value: entry.value }))} ariaLabel="Open item time since last activity" /></Suspense></div>
            {agingQuery.data.staleItems.length > 0 && <ul className="divide-y divide-slate-100">{agingQuery.data.staleItems.map((item) => <li key={item.id} className="py-2 text-sm">{item.key} · {item.title}<span className="block text-xs text-slate-500">Last activity {item.updatedAt.slice(0, 10)}</span></li>)}</ul>}
          </div>}
        </ReportCard>

        <ReportCard title="Throughput / velocity" description="Completed items per time bucket." loading={throughputQuery.isLoading} error={throughputQuery.error} empty={!throughputQuery.data || isEmptyTimeSeries(throughputQuery.data.points)} retry={() => void throughputQuery.refetch()} controls={<label className="flex items-center gap-2 text-xs text-slate-600">Bucket
          <select aria-label="Throughput interval" className={inputClass} value={interval} onChange={(event) => updateParams({ interval: event.target.value })}>
            <option value="day">Day</option><option value="week">Week</option>
          </select>
        </label>} exportReport={() => {
          if (throughputQuery.data) exportRows('throughput-velocity', projectName, range, ['bucket', 'completed'], throughputQuery.data.points.map((point) => ({ bucket: dateLabel(point.bucket), completed: point.value })));
        }}>
          {throughputQuery.data && <Suspense fallback={chartFallback}><BarChart data={throughputQuery.data.points.map((point) => ({ label: dateLabel(point.bucket), value: point.value }))} ariaLabel="Completed items per time bucket" /></Suspense>}
        </ReportCard>

        <ReportCard title="Burndown" description="Remaining open items by day across the selected range." loading={burndownQuery.isLoading} error={burndownQuery.error} empty={!burndownQuery.data || isEmptyTimeSeries(burndownQuery.data.points)} retry={() => void burndownQuery.refetch()} exportReport={() => {
          if (burndownQuery.data) exportRows('burndown', projectName, range, ['date', 'remainingOpen'], burndownQuery.data.points.map((point) => ({ date: dateLabel(point.bucket), remainingOpen: point.value })));
        }}>
          {burndownQuery.data && <Suspense fallback={chartFallback}><LineChart data={burndownQuery.data.points.map((point) => ({ label: dateLabel(point.bucket), value: point.value }))} ariaLabel="Remaining open items over time" /></Suspense>}
        </ReportCard>
      </div>

      {itemId && itemQuery.isError && <p role="alert" className="text-sm text-red-700">Could not open this item. {itemQuery.error.message} <button type="button" className="underline" onClick={() => void itemQuery.refetch()}>Retry</button></p>}
      {activeItem && projectsQuery.data && <ItemFormModal
        item={activeItem}
        projects={projectsQuery.data.projects}
        users={projectsQuery.data.users}
        defaultProjectId={projectId}
        currentUser={user}
        onClose={closeItem}
        onSubmit={(values) => saveItem.mutate(values)}
      />}
    </div>
  );
}
