import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
const blocker = { id: 'blocker', key: 'BET-1', title: 'Blocking item', status: 'OPEN' as const, projectCode: 'BET' };
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
    if (path === '/items?page=1&pageSize=100') return { items: candidates, total: candidates.length, pageSize: 100 };
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
  });

  it('keeps blockedBy read-only', async () => {
    setup();
    const group = await screen.findByRole('region', { name: 'Blocked by' });
    expect(within(group).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers only same-project items in the parent picker', async () => {
    setup();
    const picker = await screen.findByRole('combobox', { name: 'Parent item' });
    expect(Array.from((picker as HTMLSelectElement).options).map((option) => option.value)).toEqual(['', 'parent', 'child', 'same-project-choice']);
    expect(Array.from((picker as HTMLSelectElement).options).some((option) => option.value === 'item')).toBe(false);
  });

  it('shows a rejected API message without clearing the dependency input', async () => {
    apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === '/items?page=1&pageSize=100') return { items: candidates, total: candidates.length, pageSize: 100 };
      if (path === '/items/dependencies' && init?.method === 'POST') throw new ApiError('Blocking cycle detected', 400);
      throw new Error(`Unexpected request ${path}`);
    }) as typeof api);
    const user = userEvent.setup();
    setup();
    const picker = await screen.findByRole('combobox', { name: 'Blocks item' });
    await user.selectOptions(picker, 'other-target');
    await user.click(screen.getByRole('button', { name: 'Add blocks link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blocking cycle detected');
    expect(picker).toHaveValue('other-target');
  });

  it('invalidates only link and list queries containing the affected items', async () => {
    const { client, invalidate } = setup();
    await screen.findByRole('link', { name: 'BET-1 · Blocking item' });
    client.setQueryData(['items', 'matching'], { items: [makeItem()] });
    client.setQueryData(['items', 'unrelated'], { items: [makeItem({ id: 'unrelated' })] });
    client.setQueryData(['my-items', 'u1', 'matching'], { items: [makeItem({ id: 'same-project-choice', key: 'APO-4' })] });
    client.setQueryData(['my-items', 'u1', 'unrelated'], { items: [makeItem({ id: 'unrelated' })] });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Blocks item' }), 'same-project-choice');
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
