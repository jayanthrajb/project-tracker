import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '../lib/api';
import type * as ApiModule from '../lib/api';
import { buildReportCsv } from '../lib/reportCsv';
import type { AgingResponse, BurndownResponse, OverdueResponse, StatusBreakdownResponse, ThroughputResponse, WorkloadResponse } from '../../../api/src/routes/reports.js';
import type { Item, Project, User } from '../types';
import ReportsPage from './ReportsPage';

vi.mock('../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof ApiModule>(), api: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const apiMock = vi.mocked(api);

const user: User = { id: 'u1', name: 'Priya', email: 'priya@example.com', role: 'MANAGER' };
const project: Project = { id: 'p1', code: 'APO', name: 'Apollo', description: '', status: 'ACTIVE', ownerId: 'u1', owner: user, members: [] };
const item: Item = {
  id: 'i1', projectId: 'p1', key: 'APO-1', title: 'Overdue bug', description: '', type: 'BUG', status: 'OPEN', priority: 'P1',
  risk: 'LOW', assigneeId: null, reporterId: 'u1', dueDate: '2026-09-01T00:00:00.000Z', estimateHours: null, spentHours: 0, tags: [],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', closedAt: null, startedAt: null, score: 1,
  project: { id: 'p1', name: 'Apollo', code: 'APO' }, assignee: null, reporter: user,
};

const statusData: StatusBreakdownResponse = {
  items: [
    { bucket: 'OPEN', value: 2 }, { bucket: 'IN_PROGRESS', value: 1 }, { bucket: 'BLOCKED', value: 0 },
    { bucket: 'IN_REVIEW', value: 0 }, { bucket: 'DONE', value: 1 },
  ],
};
const workloadData: WorkloadResponse = {
  assignees: [
    { assigneeId: 'u1', name: 'Priya', totalOpen: 2, byPriority: [{ bucket: 'P0', value: 0 }, { bucket: 'P1', value: 1 }, { bucket: 'P2', value: 1 }, { bucket: 'P3', value: 0 }], overdue: 1 },
    { assigneeId: null, name: 'Unassigned', totalOpen: 1, byPriority: [{ bucket: 'P0', value: 1 }, { bucket: 'P1', value: 0 }, { bucket: 'P2', value: 0 }, { bucket: 'P3', value: 0 }], overdue: 0 },
  ],
};
const overdueData: OverdueResponse = {
  buckets: [{ bucket: '1-7 days', value: 1 }, { bucket: '8-30 days', value: 0 }, { bucket: '31+ days', value: 1 }],
  mostOverdue: [{ id: item.id, key: item.key, title: item.title, status: item.status, priority: item.priority, dueDate: item.dueDate, assigneeName: null, createdAt: item.createdAt, updatedAt: item.updatedAt }],
};
const agingData: AgingResponse = {
  byCreationAge: [{ bucket: '1-7 days', value: 0 }, { bucket: '8-30 days', value: 1 }, { bucket: '31+ days', value: 1 }],
  byLastActivity: [{ bucket: '1-7 days', value: 1 }, { bucket: '8-30 days', value: 0 }, { bucket: '31+ days', value: 1 }],
  staleItems: [{ id: item.id, key: item.key, title: item.title, status: item.status, priority: item.priority, dueDate: item.dueDate, assigneeName: null, createdAt: item.createdAt, updatedAt: item.updatedAt }],
};
const throughputData: ThroughputResponse = { interval: 'day', points: [{ bucket: '2026-10-01T00:00:00Z', value: 2 }, { bucket: '2026-10-02T00:00:00Z', value: 0 }] };
const burndownData: BurndownResponse = { points: [{ bucket: '2026-10-01', value: 5 }, { bucket: '2026-10-02', value: 3 }] };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function mount(url = '/projects/p1/reports?from=2026-10-01&to=2026-10-04') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/projects/:projectId/reports" element={<><ReportsPage user={user} /><LocationProbe /></>} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
  return client;
}

function zeroData() {
  return {
    status: { items: statusData.items.map((entry) => ({ ...entry, value: 0 })) } satisfies StatusBreakdownResponse,
    workload: { assignees: workloadData.assignees.map((entry) => ({ ...entry, totalOpen: 0, overdue: 0, byPriority: entry.byPriority.map((priority) => ({ ...priority, value: 0 })) })) } satisfies WorkloadResponse,
    overdue: { buckets: overdueData.buckets.map((entry) => ({ ...entry, value: 0 })), mostOverdue: [] } satisfies OverdueResponse,
    aging: { byCreationAge: agingData.byCreationAge.map((entry) => ({ ...entry, value: 0 })), byLastActivity: agingData.byLastActivity.map((entry) => ({ ...entry, value: 0 })), staleItems: [] } satisfies AgingResponse,
    throughput: { interval: 'day', points: throughputData.points.map((entry) => ({ ...entry, value: 0 })) } satisfies ThroughputResponse,
    burndown: { points: burndownData.points.map((entry) => ({ ...entry, value: 0 })) } satisfies BurndownResponse,
  };
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string) => {
    if (path === '/projects') return { projects: [project], users: [user] };
    if (path === '/projects/p1') return { project };
    if (path.startsWith('/projects/p1/reports/status-breakdown')) return statusData;
    if (path.startsWith('/projects/p1/reports/workload')) return workloadData;
    if (path.startsWith('/projects/p1/reports/overdue')) return overdueData;
    if (path.startsWith('/projects/p1/reports/aging')) return agingData;
    if (path.startsWith('/projects/p1/reports/throughput')) return throughputData;
    if (path.startsWith('/projects/p1/reports/burndown')) return burndownData;
    if (path.startsWith('/items?')) return { items: [item], total: 1, pageSize: 100 };
    throw new Error(`Unexpected API request: ${path}`);
  }) as typeof api);
});

describe('ReportsPage', () => {
  it('shows per-bucket median/p85 durations, sample counts and missing-start caveats without changing the chart', async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string) => {
      if (path.includes('/reports/throughput')) return {
        interval: 'day', points: [
          { bucket: '2026-10-01T00:00:00Z', value: 3, cycleTime: { median: 1.5, p85: 2.8, sampleCount: 2, excludedCount: 1 }, leadTime: { median: 4.2, p85: 6.7, sampleCount: 3 } },
          { bucket: '2026-10-02T00:00:00Z', value: 1, cycleTime: { median: null, p85: null, sampleCount: 0, excludedCount: 1 }, leadTime: { median: 0, p85: 0, sampleCount: 1 } },
        ],
      } satisfies ThroughputResponse;
      return original(path);
    }) as typeof api);
    mount();
    const table = await screen.findByRole('table', { name: 'Cycle and lead time by bucket' });
    for (const heading of ['Cycle median', 'Cycle p85', 'Lead median', 'Lead p85']) expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument();
    for (const value of ['1.50', '2.80', '4.20', '6.70']) expect(within(table).getByText(value)).toBeInTheDocument();
    expect(within(table).getByText('Cycle: 2; lead: 3')).toBeInTheDocument();
    expect(within(table).getAllByText(/1 completed items excluded from cycle time: missing actual start/)).toHaveLength(2);
    expect(within(table).getAllByText('No data')).toHaveLength(2);
    expect(within(table).getAllByText('0.00')).toHaveLength(2);
    expect(await screen.findByRole('img', { name: 'Completed items per time bucket' })).toBeInTheDocument();
  });

  it('renders all six reports, preserves both aging measures, and exposes chart alternatives', async () => {
    mount();
    expect(await screen.findByRole('img', { name: 'Items by status' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Items by status data' })).toBeInTheDocument();
    expect(screen.getByText('Priya')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Overdue items by age' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Age since creation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Time since last activity' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Open item age since creation' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Open item time since last activity' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Completed items per time bucket' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Remaining open items over time' })).toBeInTheDocument();
    for (const endpoint of ['status-breakdown', 'workload', 'overdue', 'aging', 'throughput', 'burndown']) {
      expect(apiMock).toHaveBeenCalledWith(expect.stringContaining(`/reports/${endpoint}?from=2026-10-01&to=2026-10-04`));
    }

    await userEvent.setup().click(screen.getByRole('button', { name: /APO-1 · Overdue bug/ }));
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Edit APO-1');
  });

  it('renders each report empty state without rendering zero-valued charts', async () => {
    const empty = zeroData();
    apiMock.mockImplementation((async (path: string) => {
      if (path === '/projects') return { projects: [project], users: [user] };
      if (path === '/projects/p1') return { project };
      if (path.includes('/status-breakdown')) return empty.status;
      if (path.includes('/workload')) return empty.workload;
      if (path.includes('/overdue')) return empty.overdue;
      if (path.includes('/aging')) return empty.aging;
      if (path.includes('/throughput')) return empty.throughput;
      if (path.includes('/burndown')) return empty.burndown;
      throw new Error(`Unexpected API request: ${path}`);
    }) as typeof api);
    mount();
    expect(await screen.findAllByText('No report data for this date range.')).toHaveLength(6);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('isolates a failed endpoint to its card while rendering the other five reports', async () => {
    apiMock.mockImplementation((async (path: string) => {
      if (path.includes('/status-breakdown')) throw new ApiError('Database unavailable', 503);
      if (path === '/projects') return { projects: [project], users: [user] };
      if (path === '/projects/p1') return { project };
      if (path.includes('/workload')) return workloadData;
      if (path.includes('/overdue')) return overdueData;
      if (path.includes('/aging')) return agingData;
      if (path.includes('/throughput')) return throughputData;
      if (path.includes('/burndown')) return burndownData;
      throw new Error(`Unexpected API request: ${path}`);
    }) as typeof api);
    mount();
    const statusCard = (await screen.findByRole('heading', { name: 'Status breakdown' })).closest('section')!;
    expect(await within(statusCard).findByRole('alert')).toHaveTextContent('Database unavailable');
    expect(within(statusCard).getByRole('button', { name: 'Retry status breakdown' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Remaining open items over time' })).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Overdue items by age' })).toBeInTheDocument();
  });

  it('updates URL-backed dates and refetches all report queries; interval remains backend-compatible', async () => {
    mount();
    await screen.findByRole('img', { name: 'Items by status' });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-02' } });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('from=2026-10-02'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/reports/status-breakdown?from=2026-10-02&to=2026-10-04')));
    await userEvent.setup().selectOptions(screen.getByLabelText('Throughput interval'), 'week');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('interval=week'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/reports/throughput?from=2026-10-02&to=2026-10-04&interval=week')));
  });

  it('shows a useful access-denied message instead of an unhandled error', async () => {
    apiMock.mockImplementation((async (path: string) => {
      if (path.includes('/status-breakdown')) throw new ApiError('You cannot access this project', 403);
      if (path === '/projects') return { projects: [project], users: [user] };
      if (path === '/projects/p1') return { project };
      if (path.includes('/workload')) return workloadData;
      if (path.includes('/overdue')) return overdueData;
      if (path.includes('/aging')) return agingData;
      if (path.includes('/throughput')) return throughputData;
      if (path.includes('/burndown')) return burndownData;
      throw new Error(`Unexpected API request: ${path}`);
    }) as typeof api);
    mount();
    const statusCard = (await screen.findByRole('heading', { name: 'Status breakdown' })).closest('section')!;
    expect(await within(statusCard).findByRole('alert')).toHaveTextContent("You don't have access to this project's reports.");
    expect(await screen.findByRole('img', { name: 'Remaining open items over time' })).toBeInTheDocument();
  });

  it('exports correctly quoted CSV content and identifies the report, project, and date range', () => {
    const csv = buildReportCsv('status-breakdown', 'APO', { from: '2026-10-01', to: '2026-10-04' }, ['status', 'count'], [
      { status: 'IN_REVIEW', count: 2 },
      { status: 'DONE', count: 0 },
    ]);
    expect(csv.filename).toBe('status-breakdown-APO-2026-10-01-to-2026-10-04.csv');
    expect(csv.content).toBe('status,count\r\nIN_REVIEW,2\r\nDONE,0');
  });
});
