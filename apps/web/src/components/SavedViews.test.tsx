import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemFilters } from './ItemFilters';
import { SavedViews } from './SavedViews';
import { api } from '../lib/api';
import type { SavedView } from '../lib/itemViewFilters';
import { useSavedViews } from '../lib/useSavedViews';
import type { User } from '../types';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
const apiMock = vi.mocked(api);
const user: User = { id: 'u1', name: 'Priya', email: 'priya@example.com', role: 'MANAGER' };
const base: SavedView = { id: 'v1', name: 'Blocked', userId: 'u1', projectId: 'p1', scope: 'PERSONAL', filtersJson: { statuses: ['BLOCKED'], priorities: ['P0', 'P1'], risks: ['HIGH'], assigneeId: 'u1', search: 'urgent' }, sortJson: { field: 'dueDate', direction: 'asc' }, isDefault: false };
let views: SavedView[];

function Harness({ actor }: { actor: User }) {
  const state = useSavedViews(actor, 'p1');
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <SavedViews state={state} user={actor} projectId="p1" canShare />
    <ItemFilters filters={state.filters} sort={state.sort} onChange={state.change} users={[user]} />
    <output data-testid="location">{location.search}</output>
    <output data-testid="query">{state.query}</output>
    <button onClick={() => navigate('/?view=v1&item=i2&tab=comments')}>Incoming saved view</button>
  </>;
}

function mount(url = '/?view=v1', actor = user) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]}><Harness actor={actor} /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  views = [{ ...base }];
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (!init) return { views };
    const body = JSON.parse(String(init.body ?? '{}')) as Partial<SavedView>;
    if (init.method === 'POST' && path === '/views') {
      const created = { ...base, ...body, id: 'v2', isDefault: false };
      views = [...views, created];
      return { view: created };
    }
    if (init.method === 'DELETE') { views = views.filter((view) => view.id !== 'v1'); return undefined; }
    if (path.endsWith('/set-default')) {
      views = views.map((view) => ({ ...view, isDefault: view.id === 'v1' }));
      return { view: views[0] };
    }
    views = views.map((view) => view.id === 'v1' ? { ...view, ...body } : view);
    return { view: views[0] };
  }) as typeof api);
});

describe('SavedViews', () => {
  it('selects URL views and exposes modified/reset/update without losing deep links', async () => {
    const interaction = userEvent.setup();
    mount('/?view=v1&item=i1&tab=history');
    await screen.findByRole('button', { name: 'Rename view' });
    await waitFor(() => expect(screen.getByLabelText('Search')).toHaveValue('urgent'));
    expect(screen.getByLabelText('BLOCKED')).toBeChecked();
    expect(screen.getByLabelText('Sort')).toHaveValue('dueDate-asc');
    await interaction.type(screen.getByLabelText('Search'), ' changed');
    expect(screen.getByText('Modified')).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(screen.getByLabelText('Search')).toHaveValue('urgent');
    await interaction.click(screen.getByLabelText('P0'));
    await interaction.click(screen.getByRole('button', { name: 'Update view' }));
    await waitFor(() => expect(screen.queryByText('Modified')).not.toBeInTheDocument());
    expect(apiMock).toHaveBeenCalledWith('/views/v1', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"priorities":["P1"]') }));
    expect(screen.getByTestId('location')).toHaveTextContent('item=i1&tab=history');
  });

  it('supports save, rename, set-default and confirmed deletion using exact backend payloads', async () => {
    const interaction = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'Rename view' });
    await interaction.click(screen.getByRole('button', { name: 'Set default' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/views/v1/set-default', { method: 'POST', body: '{}' }));
    await interaction.click(screen.getByRole('button', { name: 'Rename view' }));
    await interaction.clear(screen.getByLabelText('View name'));
    await interaction.type(screen.getByLabelText('View name'), 'Important');
    await interaction.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved views' })).toHaveTextContent('Important'));
    await interaction.click(screen.getByRole('button', { name: 'Delete view' }));
    const confirmation = screen.getByRole('alertdialog');
    expect(apiMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
    await interaction.click(within(confirmation).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Search')).toHaveValue('urgent');
    expect(screen.getByTestId('location')).not.toHaveTextContent('view=');
    await interaction.click(screen.getByRole('button', { name: 'Save view' }));
    await interaction.type(screen.getByLabelText('View name'), 'Team urgent');
    await interaction.selectOptions(screen.getByLabelText('Visibility'), 'SHARED');
    await interaction.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('view=v2'));
    const savedBody = apiMock.mock.calls.find(([path, init]) => path === '/views' && init?.method === 'POST')?.[1]?.body;
    expect(JSON.parse(String(savedBody))).toEqual({
      name: 'Team urgent', scope: 'SHARED', projectId: 'p1',
      filtersJson: { ...base.filtersJson, projectId: 'p1' }, sortJson: { field: 'dueDate', direction: 'asc' },
    });
    expect(screen.getByText(/Tag filtering is not supported/)).toBeInTheDocument();
  });

  it('switches via Dropdown and applies the default only once on a filter-free initial URL', async () => {
    const interaction = userEvent.setup();
    views = [{ ...base, isDefault: true }];
    mount('/?item=i1&tab=comments');
    await waitFor(() => expect(screen.getByLabelText('Search')).toHaveValue('urgent'));
    await interaction.click(screen.getByRole('button', { name: 'Saved views' }));
    await interaction.click(screen.getByRole('button', { name: 'All items' }));
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(screen.getByTestId('location')).not.toHaveTextContent('view=');
    await interaction.click(screen.getByRole('button', { name: 'Saved views' }));
    await interaction.click(screen.getByRole('button', { name: 'Blocked · Personal · Default' }));
    expect(screen.getByLabelText('Search')).toHaveValue('urgent');
    expect(screen.getByTestId('location')).toHaveTextContent('tab=comments');
  });

  it('hydrates a new view-only URL after the initial page load', async () => {
    const interaction = userEvent.setup();
    mount('/?search=initial');
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/views'));
    await interaction.click(screen.getByRole('button', { name: 'Incoming saved view' }));
    await waitFor(() => expect(screen.getByLabelText('Search')).toHaveValue('urgent'));
    expect(screen.getByTestId('location')).toHaveTextContent('view=v1&item=i2&tab=comments');
  });

  it('setting a default does not overwrite currently modified URL filters', async () => {
    const interaction = userEvent.setup();
    mount('/?view=v1&search=custom&sort=key-asc');
    await screen.findByRole('button', { name: 'Set default' });
    await interaction.click(screen.getByRole('button', { name: 'Set default' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Set default' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Search')).toHaveValue('custom');
    expect(screen.getByLabelText('Sort')).toHaveValue('key-asc');
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('?view=v1&search=custom&sort=key-asc');
  });

  it('does not replace unknown URL view IDs with the default', async () => {
    views = [{ ...base, isDefault: true }];
    mount('/?view=missing');
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/views'));
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(screen.getByTestId('location')).toHaveTextContent('?view=missing');
  });

  it.each(['/?search=explicit', '/?view=v1&status=OPEN&sort=title-asc'])('honors explicit URL filters instead of defaults: %s', async (url) => {
    const interaction = userEvent.setup();
    views = [{ ...base, isDefault: true }];
    mount(url);
    await interaction.click(screen.getByRole('button', { name: 'Saved views' }));
    await screen.findByRole('button', { name: 'Blocked · Personal · Default' });
    expect(screen.getByLabelText('Search')).toHaveValue(url.includes('search=') ? 'explicit' : '');
    expect(screen.getByTestId('location').textContent).toBe(url.slice(1));
  });

  it('never applies another owner’s default even when a manager can edit that shared view', async () => {
    const interaction = userEvent.setup();
    views = [{ ...base, scope: 'SHARED', userId: 'u2', isDefault: true }];
    mount('/');
    await interaction.click(screen.getByRole('button', { name: 'Saved views' }));
    await screen.findByRole('button', { name: 'Blocked · Shared' });
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(screen.getByTestId('location').textContent).toBe('');
  });

  it.each([
    ['PERSONAL', 'MANAGER', false],
    ['SHARED', 'MANAGER', true],
    ['SHARED', 'ADMIN', true],
    ['SHARED', 'DEVELOPER', false],
  ] as const)('enforces non-owner %s/%s write permissions', async (scope, role, editable) => {
    views = [{ ...base, userId: 'u2', scope }];
    mount('/?view=v1', { ...user, role });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved views' })).toHaveTextContent('Blocked'));
    expect(Boolean(screen.queryByRole('button', { name: 'Rename view' }))).toBe(editable);
    expect(Boolean(screen.queryByRole('button', { name: 'Delete view' }))).toBe(editable);
    expect(screen.queryByRole('button', { name: 'Set default' })).not.toBeInTheDocument();
  });

  it('keeps filters when saving fails and renders the server error inline', async () => {
    const interaction = userEvent.setup();
    apiMock.mockImplementationOnce(async () => ({ views }));
    apiMock.mockRejectedValueOnce(new Error('Cannot save view'));
    mount('/?search=keep');
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/views'));
    await interaction.click(screen.getByRole('button', { name: 'Save view' }));
    await interaction.type(screen.getByLabelText('View name'), 'Failure');
    await interaction.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot save view');
    expect(screen.getByLabelText('Search')).toHaveValue('keep');
    expect(screen.getByLabelText('View name')).toHaveValue('Failure');
  });
});
