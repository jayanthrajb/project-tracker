import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinksTab } from './LinksTab';
import { ApiError, api } from '../lib/api';
import type * as ApiModule from '../lib/api';
import type { Item, User } from '../types';

vi.mock('../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof ApiModule>(), api: vi.fn() }));

const apiMock = vi.mocked(api);
const manager: User = { id: 'u1', name: 'Sara', email: 'sara@example.com', role: 'MANAGER' };
const parent = { id: 'parent', key: 'APO-1', title: 'Parent item', status: 'OPEN' as const, projectCode: 'APO' };
const child = { id: 'child', key: 'APO-2', title: 'Child item', status: 'IN_PROGRESS' as const, projectCode: 'APO' };
const blocker = { id: 'blocker', key: 'BET-1', title: 'Blocking item', status: 'OPEN' as const, projectCode: 'BET', projectId: 'p2' };
const related = { id: 'related', key: 'BET-2', title: 'Related item', status: 'DONE' as const, projectCode: 'BET' };

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item', projectId: 'p1', key: 'APO-3', type: 'TASK', title: 'Current item', description: '', status: 'OPEN',
    priority: 'P2', risk: 'MEDIUM', assigneeId: null, reporterId: 'u1', dueDate: null, estimateHours: null,
    spentHours: 0, tags: [], createdAt: '', updatedAt: '', closedAt: null, startedAt: null, score: 1,
    project: { id: 'p1', name: 'Apollo', code: 'APO' }, assignee: null, reporter: manager,
    parent, children: [child], blocks: [blocker], blockedBy: [parent], relatesTo: [related],
    ...overrides,
  };
}

const candidates = [
  makeItem(),
  makeItem({ id: parent.id, projectId: 'p1', key: parent.key, title: parent.title, parent: null, children: [], blocks: [], blockedBy: [], relatesTo: [] }),
  makeItem({ id: child.id, projectId: 'p1', key: child.key, title: child.title, parent: null, children: [], blocks: [], blockedBy: [], relatesTo: [] }),
  makeItem({ id: blocker.id, projectId: 'p2', key: blocker.key, title: blocker.title, project: { id: 'p2', name: 'Beta', code: 'BET' }, parent: null, children: [], blocks: [], blockedBy: [], relatesTo: [] }),
  makeItem({ id: related.id, projectId: 'p2', key: related.key, title: related.title, project: { id: 'p2', name: 'Beta', code: 'BET' }, parent: null, children: [], blocks: [], blockedBy: [], relatesTo: [] }),
  makeItem({ id: 'other-target', projectId: 'p2', key: 'BET-3', title: 'Another Beta item', project: { id: 'p2', name: 'Beta', code: 'BET' }, parent: null, children: [], blocks: [], blockedBy: [], relatesTo: [] }),
  makeItem({ id: 'same-project-choice', projectId: 'p1', key: 'APO-4', title: 'Another item', parent: null, children: [], blocks: [], blockedBy: [], relatesTo: [] }),
];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(<QueryClientProvider client={client}><MemoryRouter><LinksTab item={makeItem()} /></MemoryRouter></QueryClientProvider>);
  return { ...view, client, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path.startsWith('/items?')) {
      const params = new URLSearchParams(path.split('?')[1]);
      if (params.has('id')) return { items: [makeItem()], total: 1, pageSize: 1 };
      return { items: candidates, total: candidates.length, pageSize: 20 };
    }
    if (init?.method === 'PATCH' || init?.method === 'DELETE') return undefined;
    if (path === '/items/dependencies' && init?.method === 'POST') return { dependency: { id: 'dep-1' } };
    throw new Error(`Unexpected request ${path}`);
  }) as typeof api);
});

describe('LinksTab', () => {
  it('renders the parent, children, and all dependency groups with cross-project codes', async () => {
    setup();
    expect(await screen.findAllByRole('link', { name: 'APO-1 · Parent item' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'APO-2 · Child item' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'BET-1 · Blocking item' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'BET-2 · Related item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Blocks')).toBeInTheDocument();
    expect(screen.getByLabelText('Blocked by')).toBeInTheDocument();
    expect(screen.getByLabelText('Relates to')).toBeInTheDocument();
    expect(screen.getAllByText('BET')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'BET-1 · Blocking item' })).toHaveAttribute('href', '/projects/p2?item=blocker');
  });

  it('keeps blockedBy read-only', async () => {
    setup();
    const group = await screen.findByRole('region', { name: 'Blocked by' });
    expect(within(group).queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens with one bounded current-item lookup, never paging through the table', async () => {
    setup();
    await screen.findByRole('combobox', { name: 'Parent item' });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/items?id=item&pageSize=1');
  });

  it('requires two characters and debounces the complete query into one bounded request', async () => {
    setup();
    const picker = await screen.findByRole('combobox', { name: 'Parent item' });
    apiMock.mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.change(picker, { target: { value: 'A' } });
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(apiMock).not.toHaveBeenCalled();
      fireEvent.change(picker, { target: { value: 'AP' } });
      await act(async () => { vi.advanceTimersByTime(200); });
      fireEvent.change(picker, { target: { value: 'APO-4' } });
      await act(async () => { vi.advanceTimersByTime(274); });
      expect(apiMock).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(apiMock).toHaveBeenCalledWith('/items?search=APO-4&searchKeys=true&pageSize=20&projectId=p1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByRole('option', { name: /APO-4/ })).toBeInTheDocument();
  });

  it.each([
    ['Parent item', ['APO-2', 'APO-4'], 'p1'],
    ['Child item', ['APO-1', 'APO-4'], 'p1'],
    ['Blocks item', ['APO-1', 'APO-2', 'BET-2', 'BET-3', 'APO-4'], null],
    ['Relates to item', ['APO-1', 'APO-2', 'BET-1', 'BET-3', 'APO-4'], null],
  ])('scopes and excludes existing links from %s', async (label, keys, projectId) => {
    setup();
    await userEvent.type(await screen.findByRole('combobox', { name: label }), 'item');
    await screen.findByRole('option', { name: /APO-4/ });
    expect(screen.getAllByRole('option').map((option) => option.textContent?.split(' · ')[0])).toEqual(keys);
    const path = apiMock.mock.calls.find(([url]) => url.includes('search='))?.[0] ?? '';
    expect(new URLSearchParams(path.split('?')[1]).get('projectId')).toBe(projectId);
    if (!projectId) expect(screen.getByRole('option', { name: /BET-3/ })).toHaveTextContent('OPEN · BET');
  });

  it.each([
    ['Parent item', 'Set parent', '/items/item', { parentId: 'same-project-choice' }],
    ['Child item', 'Add child', '/items/same-project-choice', { parentId: 'item' }],
    ['Blocks item', 'Add blocks link', '/items/dependencies', { fromId: 'item', toId: 'same-project-choice', type: 'BLOCKS' }],
    ['Relates to item', 'Add relates to link', '/items/dependencies', { fromId: 'item', toId: 'same-project-choice', type: 'RELATES_TO' }],
  ])('selects and confirms the correct mutation for %s', async (label, button, path, body) => {
    const user = userEvent.setup();
    setup();
    const picker = await screen.findByRole('combobox', { name: label });
    await user.type(picker, 'Another');
    await user.click(await screen.findByRole('option', { name: /APO-4/ }));
    await user.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(path, { method: path === '/items/dependencies' ? 'POST' : 'PATCH', body: JSON.stringify(body) }));
    await waitFor(() => expect(picker).toHaveValue(''));
  });

  it('shows a rejected API message without clearing the dependency input', async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === '/items/dependencies' && init?.method === 'POST') throw new ApiError('Blocking cycle detected', 400);
      return original(path, init);
    }) as typeof api);
    const user = userEvent.setup();
    setup();
    const picker = await screen.findByRole('combobox', { name: 'Blocks item' });
    await user.type(picker, 'Another');
    await user.click(await screen.findByRole('option', { name: /BET-3/ }));
    await user.click(screen.getByRole('button', { name: 'Add blocks link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blocking cycle detected');
    expect(picker).toHaveValue('BET-3 · Another Beta item');
    expect(screen.getByRole('button', { name: 'Add blocks link' })).toBeEnabled();
  });

  it('announces truncated and empty results, and hides old matches while the query changes', async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path.includes('search=')) return { items: candidates, total: 100, pageSize: 20 };
      return original(path, init);
    }) as typeof api);
    const user = userEvent.setup();
    setup();
    const picker = await screen.findByRole('combobox', { name: 'Blocks item' });
    await user.type(picker, 'Another');
    await screen.findByRole('option', { name: /APO-4/ });
    expect(screen.getByRole('status')).toHaveTextContent('Showing the first 20 matches. Refine your search.');
    await user.clear(picker);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Type at least 2 characters');
    apiMock.mockResolvedValue({ items: [], total: 0, pageSize: 20 });
    await user.type(picker, 'missing');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No matching items.'));
  });

  it('navigates suggestions using arrows and Enter without submitting a form', async () => {
    const user = userEvent.setup();
    setup();
    const picker = await screen.findByRole('combobox', { name: 'Child item' });
    await user.type(picker, 'Another');
    await screen.findByRole('option', { name: /APO-4/ });
    await user.keyboard('{ArrowUp}');
    const activeId = picker.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(picker).toHaveValue('APO-4 · Another item');
    expect(picker).toHaveFocus();
    expect(picker).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('invalidates only link and list queries containing the affected items', async () => {
    const { client, invalidate } = setup();
    await screen.findByRole('link', { name: 'BET-1 · Blocking item' });
    client.setQueryData(['items', 'matching'], { items: [makeItem()] });
    client.setQueryData(['items', 'unrelated'], { items: [makeItem({ id: 'unrelated' })] });
    client.setQueryData(['my-items', 'u1', 'matching'], { items: [makeItem({ id: 'same-project-choice', key: 'APO-4' })] });
    client.setQueryData(['my-items', 'u1', 'unrelated'], { items: [makeItem({ id: 'unrelated' })] });
    await userEvent.type(screen.getByRole('combobox', { name: 'Blocks item' }), 'Another');
    await userEvent.click(await screen.findByRole('option', { name: /APO-4/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add blocks link' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['items', 'matching'], exact: true }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['items', 'matching'], exact: true });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['items', 'unrelated'], exact: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['my-items', 'u1', 'matching'], exact: true });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['my-items', 'u1', 'unrelated'], exact: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['item-links', 'item'], exact: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['item-links', 'same-project-choice'], exact: true });
  });

  it('uses the returned dependency ID to remove editable links', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Remove blocks BET-1' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/items/dependencies/dep-1', { method: 'DELETE' }));
  });
});
