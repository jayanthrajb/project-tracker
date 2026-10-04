import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyItemsPage } from './MyItemsPage';
import { api } from '../lib/api';
import type { SavedView } from '../lib/itemViewFilters';
import type { User } from '../types';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
const apiMock = vi.mocked(api);
const user: User = { id: 'u1', name: 'Priya', email: 'priya@example.com', role: 'DEVELOPER' };
let views: SavedView[];
function Probe() { return <output data-testid="location">{useLocation().search}</output>; }
function mount(url = '/my-items') {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]}><MyItemsPage user={user} /><Probe /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  views = [{ id: 'v1', userId: user.id, name: 'Unassigned urgent', projectId: 'p1', scope: 'PERSONAL', filtersJson: { unassigned: true, assigneeId: 'u2', statuses: ['OPEN', 'BLOCKED'], priorities: ['P0'], risks: ['HIGH'] }, sortJson: { field: 'dueDate', direction: 'asc' }, isDefault: true }];
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/views' && init?.method === 'POST') return { view: { ...views[0], id: 'v2', ...JSON.parse(String(init.body)) as Partial<SavedView> } };
    if (path === '/views') return { views };
    if (path === '/projects') return { projects: [], users: [user] };
    if (path.startsWith('/items?')) return { items: [], total: 0 };
    throw new Error(`Unexpected ${path}`);
  }) as typeof api);
});

describe('My Items saved views', () => {
  it('applies project saved defaults with shared filter UI while enforcing ownership over unassigned filters', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('Sort')).toHaveValue('dueDate-asc'));
    expect(screen.getByLabelText('OPEN')).toBeChecked();
    expect(screen.getByLabelText('BLOCKED')).toBeChecked();
    expect(screen.queryByLabelText('Assignee')).not.toBeInTheDocument();
    const requests = apiMock.mock.calls.filter(([path]) => path.startsWith('/items?'));
    for (const [path] of requests) {
      const params = new URLSearchParams(path.split('?')[1]);
      expect(params.get('assigneeId')).toBe(user.id);
      expect(params.has('unassigned')).toBe(false);
    }
    expect(screen.getByTestId('location')).toHaveTextContent('assigneeId=u1');
  });

  it('honors explicit URL filters, overrides a foreign assignee, and saves only valid server filters', async () => {
    const interaction = userEvent.setup();
    mount('/my-items?assigneeId=u2&unassigned=true&status=OPEN&priority=P1&risk=LOW&search=mine&sort=key-asc&tags=urgent');
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => path.startsWith('/items?'))).toBe(true));
    expect(screen.getByLabelText('Search')).toHaveValue('mine');
    expect(screen.getByLabelText('Sort')).toHaveValue('key-asc');
    await interaction.click(screen.getByLabelText('HIGH'));
    await interaction.click(screen.getByRole('button', { name: 'Save view' }));
    expect(screen.queryByLabelText('Visibility')).not.toBeInTheDocument();
    await interaction.type(screen.getByLabelText('View name'), 'Mine');
    await interaction.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/views', expect.objectContaining({ method: 'POST' })));
    const body = apiMock.mock.calls.find(([path, init]) => path === '/views' && init?.method === 'POST')?.[1]?.body;
    expect(JSON.parse(String(body))).toEqual({
      name: 'Mine', scope: 'PERSONAL', projectId: null,
      filtersJson: { assigneeId: 'u1', statuses: ['OPEN'], priorities: ['P1'], risks: ['LOW', 'HIGH'], search: 'mine' },
      sortJson: { field: 'key', direction: 'asc' },
    });
  });
});
