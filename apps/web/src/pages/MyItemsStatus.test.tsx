import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyItemsPage } from './MyItemsPage';
import { api, ApiError } from '../lib/api';
import type * as ApiModule from '../lib/api';
import type { Item, Project, User } from '../types';

vi.mock('../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof ApiModule>(), api: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const apiMock = vi.mocked(api);
const user: User = { id: 'u1', name: 'Dev', email: 'dev@example.com', role: 'DEVELOPER' };
const project: Project = { id: 'p1', name: 'Apollo', code: 'APO', description: '', status: 'ACTIVE', ownerId: 'u2', owner: user, members: [{ user }] };
const item: Item = {
  id: 'i1', projectId: 'p1', key: 'APO-1', title: 'My task', description: '', type: 'TASK', status: 'OPEN', priority: 'P2', risk: 'LOW',
  assigneeId: user.id, reporterId: user.id, assignee: user, reporter: user, project,
  dueDate: null, startedAt: null, closedAt: null, createdAt: '', updatedAt: '', estimateHours: null, spentHours: 0, tags: [], score: 1,
};
let listedItems: Item[];
let projects: Project[];
let resolveUpdate: (response: { item: Item }) => void;
let rejectUpdate: (error: Error) => void;

function mount(url = '/my-items', actor = user) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><MyItemsPage user={actor} /></MemoryRouter></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  listedItems = [item];
  projects = [project];
  vi.clearAllMocks();
  apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Promise<{ item: Item }>((resolve, reject) => { resolveUpdate = resolve; rejectUpdate = reject; });
    if (path === '/projects') return { projects, users: [user] };
    if (path === '/views') return { views: [] };
    if (path.startsWith('/items?')) return { items: listedItems, total: listedItems.length };
    throw new Error(`Unexpected ${path}`);
  }) as typeof api);
});

describe('My Items inline status', () => {
  it('keeps an in-flight item disabled across filter changes and refreshes only the originating and current views', async () => {
    const client = mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    let select = await screen.findByRole('combobox', { name: 'Status for APO-1' });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => expect(select).toHaveValue('IN_PROGRESS'));
    fireEvent.click(screen.getByLabelText('LOW'));
    await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path.startsWith('/items?'))).toHaveLength(2));
    select = await screen.findByRole('combobox', { name: 'Status for APO-1' });
    expect(select).toBeDisabled();
    expect(select).toHaveValue('IN_PROGRESS');
    fireEvent.change(select, { target: { value: 'DONE' } });
    expect(apiMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    listedItems = [{ ...item, status: 'IN_PROGRESS' }];
    resolveUpdate({ item: listedItems[0] });
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveValue('IN_PROGRESS');
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(4));
    const listKeys = invalidate.mock.calls.filter(([options]) => options?.queryKey?.[0] === 'my-items');
    expect(listKeys).toHaveLength(2);
    expect(listKeys.every(([options]) => options?.exact)).toBe(true);
  });

  it('optimistically updates before success, sends only status and invalidates scoped queries', async () => {
    const client = mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const select = await screen.findByRole('combobox', { name: 'Status for APO-1' });
    await waitFor(() => expect(select).toBeEnabled());
    expect(screen.getByLabelText('BACKLOG')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'BACKLOG' } });
    await waitFor(() => expect(select).toHaveValue('BACKLOG'));
    expect(select).toBeDisabled();
    expect(screen.getByText('Saving status…')).toBeInTheDocument();
    const requests = apiMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(requests).toEqual([['/items/i1', { method: 'PATCH', body: '{"status":"BACKLOG"}' }]]);
    listedItems = [{ ...item, status: 'BACKLOG' }];
    resolveUpdate({ item: listedItems[0] });
    await screen.findByText('Status saved.');
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveValue('BACKLOG');
    expect(invalidate.mock.calls.map(([options]) => options)).toEqual(expect.arrayContaining([
      { queryKey: ['activity', 'items', item.id] },
      { queryKey: ['notifications', user.id, 'unread-count'], exact: true },
      { queryKey: ['my-items', user.id, expect.any(String)], exact: true },
    ]));
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it.each([
    [500, 'Could not update status. Status reverted. Please try again.'],
    [403, 'You no longer have permission to update this item. Status reverted.'],
  ])('rolls back optimistic status and explains a %s failure', async (code, message) => {
    mount();
    const select = await screen.findByRole('combobox', { name: 'Status for APO-1' });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => expect(select).toHaveValue('IN_PROGRESS'));
    rejectUpdate(new ApiError('Server error', code));
    await waitFor(() => expect(select).toHaveValue('OPEN'));
    expect(select).toBeEnabled();
    expect(toast.error).toHaveBeenCalledWith(message);
  });

  it('keeps a newly filtered-out row visible with an explanation for five seconds', async () => {
    mount('/my-items?status=OPEN');
    const select = await screen.findByRole('combobox', { name: 'Status for APO-1' });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: 'DONE' } });
    await waitFor(() => expect(select).toHaveValue('DONE'));
    listedItems = [];
    resolveUpdate({ item: { ...item, status: 'DONE' } });
    await screen.findByText(/no longer matches the status filter/);
    await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path.startsWith('/items?'))).toHaveLength(2));
    expect(select).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Status for APO-1' })).not.toBeInTheDocument(), { timeout: 6000 });
  }, 10000);

  it.each(['reporter', 'membership', 'assignee'])('disables developer updates when the API %s requirement is unmet', async (requirement) => {
    if (requirement === 'reporter') listedItems = [{ ...item, reporterId: 'u2' }];
    if (requirement === 'membership') projects = [{ ...project, members: [] }];
    if (requirement === 'assignee') listedItems = [{ ...item, assigneeId: 'u2' }];
    mount();
    const select = await screen.findByRole('combobox', { name: 'Status for APO-1' });
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/projects'));
    expect(select).toBeDisabled();
    expect(apiMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it.each(['ADMIN', 'MANAGER'] as const)('allows %s updates without developer-only restrictions', async (role) => {
    listedItems = [{ ...item, reporterId: 'u2' }];
    projects = [{ ...project, members: [] }];
    mount('/my-items', { ...user, role });
    expect(await screen.findByRole('combobox', { name: 'Status for APO-1' })).toBeEnabled();
  });
});
