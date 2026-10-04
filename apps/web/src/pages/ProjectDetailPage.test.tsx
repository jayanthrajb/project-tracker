import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectDetailPage } from './ProjectDetailPage';
import { api, ApiError } from '../lib/api';
import type * as ApiModule from '../lib/api';
import type { ActivityEntry, Item, Project, User } from '../types';

vi.mock('../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof ApiModule>(), api: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const apiMock = vi.mocked(api);
const user: User = { id: 'u1', name: 'Priya', email: 'priya@example.com', role: 'MANAGER' };
const project: Project = { id: 'p1', code: 'APO', name: 'Apollo', description: '', status: 'ACTIVE', ownerId: 'u1', owner: user, members: [] };
const item: Item = {
  id: 'i1', projectId: 'p1', key: 'APO-1', title: 'Listed item', description: '', type: 'TASK', status: 'OPEN', priority: 'P2',
  risk: 'LOW', assigneeId: null, reporterId: 'u1', dueDate: null, estimateHours: null, spentHours: 0, tags: [],
  createdAt: '', updatedAt: '', closedAt: null, score: 1, project, assignee: null, reporter: user,
};
const hiddenItem: Item = { ...item, id: 'i2', key: 'APO-2', title: 'Filtered item' };
const activity: ActivityEntry = {
  id: 'a1', itemId: 'i2', projectId: 'p1', userId: 'u1', user, action: 'CREATED', field: null,
  oldValue: null, newValue: 'Filtered item', createdAt: '2026-10-04T00:00:00Z',
};

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="location">{location.search}</output>
    <button onClick={() => navigate('/projects/p1?item=i2&tab=comments')}>Incoming notification</button>
  </>;
}

function mount(url = '/projects/p1', client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[url]}><Routes>
      <Route path="/projects/:projectId" element={<><ProjectDetailPage user={user} /><Probe /></>} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
  return client;
}

beforeEach(() => {
  localStorage.clear();
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string) => {
    if (path === '/projects') return { projects: [project], users: [user] };
    if (path === '/views') return { views: [] };
    if (path === '/projects/p1') return { project };
    if (path === '/items?projectId=p1&page=1&pageSize=100') return { items: [item, hiddenItem], total: 2, pageSize: 100 };
    if (path.startsWith('/items?')) return { items: [item], total: 1 };
    if (path.startsWith('/projects/p1/activity')) return { activity: [activity], total: 1, page: 1, pageSize: 10 };
    if (path.includes('/activity')) return { activity: [], total: 0, page: 1, pageSize: 25 };
    if (path.includes('/comments')) return { comments: [], total: 0, page: 1, pageSize: 25 };
    if (path.startsWith('/users')) return { users: [user], total: 1 };
    throw new Error(`Unexpected ${path}`);
  }) as typeof api);
});

describe('Project activity integration', () => {
  it('opens and closes an item from saved filters while preserving filters, view, drafts and selection and resetting stale tabs', async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string) => {
      if (path === '/views') return { views: [{
        id: 'v1', name: 'Urgent', scope: 'PERSONAL', userId: user.id, projectId: project.id, isDefault: true,
        filtersJson: { statuses: ['OPEN'], priorities: ['P0'], risks: ['HIGH'], search: 'Listed' },
        sortJson: { field: 'title', direction: 'asc' },
      }] };
      return original(path);
    }) as typeof api);
    const interaction = userEvent.setup();
    mount('/projects/p1?view=v1&status=OPEN&priority=P0&risk=HIGH&search=Listed&sort=title-asc&tab=history');
    const row = (await screen.findByRole('button', { name: 'Listed item' })).closest('tr')!;
    await interaction.click(within(row).getByRole('checkbox'));
    await interaction.selectOptions(within(row).getAllByRole('combobox')[0], 'P1');
    const before = new URLSearchParams(screen.getByTestId('location').textContent ?? '');
    before.delete('tab');
    await interaction.click(screen.getByRole('button', { name: 'Listed item' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent('view=v1');
    expect(screen.getByTestId('location')).not.toHaveTextContent('tab=');
    await interaction.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByTestId('location')).toHaveTextContent('tab=history');
    await interaction.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('location').textContent).toBe(`?${before.toString()}`);
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(within(row).getAllByRole('combobox')[0]).toHaveValue('P1');
    expect(screen.getByLabelText('Freeze order while editing')).toBeChecked();
    const query = apiMock.mock.calls.find(([path]) => path.startsWith('/items?') && path.includes('sort=title-asc'))?.[0];
    const params = new URLSearchParams(query?.split('?')[1]);
    expect(params.get('status')).toBe('OPEN');
    expect(params.get('priority')).toBe('P0');
    expect(params.get('risk')).toBe('HIGH');
    expect(params.get('search')).toBe('Listed');
  });

  it('opens filtered-out items on History from the recent activity feed without losing table drafts', async () => {
    const interaction = userEvent.setup();
    mount();
    const row = (await screen.findByRole('button', { name: 'Listed item' })).closest('tr')!;
    await interaction.selectOptions(within(row).getAllByRole('combobox')[0], 'P0');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    await interaction.click(await screen.findByRole('link', { name: 'View item history' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/items?projectId=p1&page=1&pageSize=100');
    await interaction.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(within(row).getAllByRole('combobox')[0]).toHaveValue('P0');
    expect(screen.getByLabelText('Freeze order while editing')).toBeChecked();
  });

  it('opens a new same-project deep link after initial load and after closing a modal', async () => {
    const interaction = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'Listed item' });
    await interaction.click(screen.getByRole('button', { name: 'Incoming notification' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Comments/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Close' }));
    await interaction.click(screen.getByRole('button', { name: 'Incoming notification' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('restores a filtered-out History deep link on first load', async () => {
    mount('/projects/p1?search=Listed&item=i2&tab=history');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent('search=Listed&item=i2&tab=history');
  });

  it('removes stale deep links only when the linked item is deleted or inaccessible', async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string) => {
      if (path === '/items?projectId=p1&page=1&pageSize=100') throw new ApiError('Not found', 404);
      return original(path);
    }) as typeof api);
    mount('/projects/p1?search=Listed&item=i2&tab=history');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?search=Listed'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('item=');
  });

  it.each([403, 404])('closes and evicts a cached linked item after a confirmed %s refetch error', async (status) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['item', 'i2'], { item: hiddenItem });
    mount('/projects/p1?search=Listed&item=i2&tab=history', client);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string) => {
      if (path === '/items?projectId=p1&page=1&pageSize=100') throw new ApiError('Unavailable', status);
      return original(path);
    }) as typeof api);
    await client.invalidateQueries({ queryKey: ['item', 'i2'], exact: true });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?search=Listed'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.getQueryData(['item', 'i2'])).toBeUndefined();
  });
});
