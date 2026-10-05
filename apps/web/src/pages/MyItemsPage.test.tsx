import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyItemsPage } from './MyItemsPage';
import { api } from '../lib/api';
import type { SavedView } from '../lib/itemViewFilters';
import type { Item, User } from '../types';

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
  it('applies project saved defaults with shared filter UI while retaining the independent ownership scope', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('Sort')).toHaveValue('dueDate-asc'));
    expect(screen.getByLabelText('OPEN')).toBeChecked();
    expect(screen.getByLabelText('BLOCKED')).toBeChecked();
    expect(screen.queryByLabelText('Assignee')).not.toBeInTheDocument();
    const requests = apiMock.mock.calls.filter(([path]) => path.startsWith('/items?'));
    for (const [path] of requests) {
      const params = new URLSearchParams(path.split('?')[1]);
      expect(params.get('mine')).toBe('true');
    }
    expect(screen.getByTestId('location')).toHaveTextContent('unassigned=true');
    expect(screen.getByTestId('location')).not.toHaveTextContent('mine=');
  });

  describe('My Items ownership membership', () => {
    const rows: Item[] = [
      { id: 'assigned', assigneeId: 'u1', reporterId: 'u2' },
      { id: 'reported', assigneeId: 'u2', reporterId: 'u1' },
      { id: 'foreign', assigneeId: 'u2', reporterId: 'u2' },
    ].map((entry) => ({
      ...entry, key: entry.id, projectId: 'p1', title: entry.id, description: '',
      type: 'TASK', status: 'OPEN', priority: 'P2', risk: 'LOW', assignee: null, reporter: user,
      project: { id: 'p1', name: 'Project', code: 'P' }, tags: [], dueDate: null, startedAt: null,
      closedAt: null, createdAt: '', updatedAt: '', estimateHours: null, spentHours: 0, score: 1,
    }));

    beforeEach(() => {
      views = [];
      apiMock.mockImplementation((async (path: string) => {
        if (path === '/views') return { views };
        if (path === '/projects') return { projects: [], users: [user] };
        if (path.startsWith('/items?')) {
          const params = new URLSearchParams(path.split('?')[1]);
          const items = rows.filter((row) =>
            (params.get('mine') !== 'true' || row.assigneeId === user.id || row.reporterId === user.id)
            && (!params.has('assigneeId') || row.assigneeId === params.get('assigneeId'))
            && (!params.has('status') || params.get('status') === row.status)
            && (!params.has('search') || row.title.includes(params.get('search')!)));
          return { items, total: items.length };
        }
        throw new Error(`Unexpected ${path}`);
      }) as typeof api);
    });

    async function expectRows(expected: string[]) {
      await waitFor(() => {
        const controls = screen.getAllByRole('combobox', { name: /^Status for / });
        expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual(expected.map((id) => `Status for ${id}`));
        for (const control of controls) expect(control).toBeEnabled();
      });
      expect(screen.queryByText('foreign', { selector: '.font-medium' })).not.toBeInTheDocument();
      for (const [path] of apiMock.mock.calls.filter(([path]) => path.startsWith('/items?'))) {
        expect(new URLSearchParams(path.split('?')[1]).get('mine')).toBe('true');
      }
    }

    it('includes assignee-only and reporter-only items, excludes foreign items, and enables every visible status control', async () => {
      mount();
      await expectRows(['assigned', 'reported']);
    });

    it('cannot widen ownership via a hand-edited URL, including mine=false', async () => {
      mount('/my-items?mine=false&assigneeId=u2');
      await expectRows(['reported']);
    });

    it('intersects a selected saved view carrying a foreign assignee with ownership', async () => {
      views = [{ id: 'foreign-view', userId: user.id, name: 'Other assignee', projectId: null, scope: 'PERSONAL', filtersJson: { assigneeId: 'u2' }, sortJson: {}, isDefault: false }];
      mount();
      await expectRows(['assigned', 'reported']);
      const interaction = userEvent.setup();
      await interaction.click(screen.getByRole('button', { name: 'Saved views' }));
      await interaction.click(screen.getByRole('button', { name: 'Other assignee · Personal' }));
      await expectRows(['reported']);
    });

    it('enforces ownership on the first-load default-view path and preserves further filters', async () => {
      views = [{ id: 'default', userId: user.id, name: 'Reported', projectId: null, scope: 'PERSONAL', filtersJson: { assigneeId: 'u2', search: 'reported', statuses: ['OPEN'] }, sortJson: {}, isDefault: true }];
      mount();
      await expectRows(['reported']);
      expect(screen.getByLabelText('Search')).toHaveValue('reported');
      expect(screen.getByLabelText('OPEN')).toBeChecked();
    });
  });

  it('honors explicit URL filters and saves only ordinary server filters, without persisting the ownership scope', async () => {
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
      filtersJson: { unassigned: true, statuses: ['OPEN'], priorities: ['P1'], risks: ['LOW', 'HIGH'], search: 'mine' },
      sortJson: { field: 'key', direction: 'asc' },
    });
  });
});
