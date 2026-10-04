import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import type { Notification, NotificationType } from '../lib/notification-types';
import { NotificationBell } from './NotificationBell';

vi.mock('../lib/api', async () => ({ ...await vi.importActual('../lib/api'), api: vi.fn() }));
const apiMock = vi.mocked(api);
let entries: Notification[];
let count: number;
let failure: 'count' | 'list' | 'read' | 'item' | 'all' | undefined;

function notification(type: NotificationType = 'COMMENT', overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notification-1', type, title: 'An update', body: 'Please review',
    createdAt: new Date(Date.now() - 3600_000).toISOString(), readAt: null,
    item: { id: 'item-1', key: 'DEMO-1', title: 'Fix the bug' }, ...overrides,
  };
}

function Location() {
  const location = useLocation();
  return <output aria-label="Location">{location.pathname}{location.search}</output>;
}

function renderBell(userId = 'user-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationBell userId={userId} />
        <button type="button">Outside</button>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, invalidateSpy };
}

function callsFor(prefix: string) {
  return apiMock.mock.calls.filter(([path]) => path.startsWith(prefix));
}

async function openBell() {
  await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  await screen.findByRole('button', { name: /An update/ });
}

beforeEach(() => {
  apiMock.mockReset();
  entries = [notification()];
  count = 3;
  failure = undefined;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/notifications/unread-count') {
      if (failure === 'count') throw new Error('Offline');
      return { count };
    }
    if (path.startsWith('/notifications?')) {
      if (failure === 'list') throw new Error('Offline');
      const params = new URLSearchParams(path.split('?')[1]);
      const filtered = params.get('unreadOnly') === 'true' ? entries.filter((entry) => !entry.readAt) : entries;
      return { notifications: filtered, total: filtered.length, page: Number(params.get('page')), pageSize: 25 };
    }
    if (path === '/notifications/read-all' && init?.method === 'POST') {
      if (failure === 'all') throw new Error('Offline');
      entries = entries.map((entry) => ({ ...entry, readAt: new Date().toISOString() }));
      count = 0;
      return { updatedCount: entries.length };
    }
    if (path.endsWith('/read') && init?.method === 'POST') {
      if (failure === 'read') throw new Error('Offline');
      entries = entries.map((entry) => ({ ...entry, readAt: new Date().toISOString() }));
      count = 0;
      return { success: true };
    }
    if (path.startsWith('/items?')) {
      if (failure === 'item') throw new Error('Unavailable');
      return { items: [{ id: 'item-1', projectId: 'project-1' }], total: 1, page: 1, pageSize: 100 };
    }
    throw new Error(`Unexpected request ${path}`);
  }) as typeof api);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationBell', () => {
  it('fetches the list only when open, caps the badge, and switches between unread and all', async () => {
    count = 12;
    entries.push(notification('ASSIGNED', { id: 'read', title: 'Already read', readAt: new Date().toISOString() }));
    renderBell();
    expect(await screen.findByText('9+')).toHaveAttribute('aria-label', '12 unread notifications');
    expect(callsFor('/notifications?')).toHaveLength(0);
    await openBell();
    expect(screen.getByText('1h ago')).toBeInTheDocument();
    expect(screen.getByText('Please review')).toHaveClass('line-clamp-2');
    expect(screen.queryByText('Already read')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('Already read')).toBeInTheDocument();
    expect(callsFor('/notifications?').at(-1)?.[0]).toContain('unreadOnly=false');
    await userEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await waitFor(() => expect(screen.queryByText('Already read')).not.toBeInTheDocument());
    expect(callsFor('/notifications?').at(-1)?.[0]).toContain('unreadOnly=true');
  });

  it('does not render a zero badge', async () => {
    count = 0;
    renderBell();
    await waitFor(() => expect(callsFor('/notifications/unread-count')).toHaveLength(1));
    expect(screen.queryByLabelText(/unread notifications/)).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it.each([
    ['COMMENT', 'comments'], ['MENTIONED', 'comments'], ['ASSIGNED', 'history'],
    ['STATUS_CHANGED', 'history'], ['DUE_SOON', 'details'], ['OVERDUE', 'details'], ['BLOCKED', 'details'],
  ] as const)('marks %s read, resolves the project, and navigates to %s', async (type, tab) => {
    entries = [notification(type)];
    const { invalidateSpy, queryClient } = renderBell();
    queryClient.setQueryData(['items'], { unrelated: true });
    await openBell();
    await userEvent.click(screen.getByRole('button', { name: /An update/ }));
    await waitFor(() => expect(screen.getByLabelText('Location')).toHaveTextContent(`/projects/project-1?item=item-1&tab=${tab}`));
    expect(callsFor('/notifications/notification-1/read')).toEqual([['/notifications/notification-1/read', { method: 'POST', body: '{}' }]]);
    expect(callsFor('/items?')).toEqual([['/items?search=DEMO-1&page=1&pageSize=100']]);
    expect(apiMock.mock.calls.findIndex(([path]) => path.endsWith('/read'))).toBeLessThan(apiMock.mock.calls.findIndex(([path]) => path.startsWith('/items?')));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus();
    expect(invalidateSpy.mock.calls.length).toBeGreaterThan(0);
    for (const [options] of invalidateSpy.mock.calls) {
      expect(options?.exact).toBe(true);
      expect(options?.queryKey?.slice(0, 2)).toEqual(['notifications', 'user-1']);
    }
    expect(queryClient.getQueryState(['items'])?.isInvalidated).toBe(false);
  });

  it('marks a deleted-item notification read and closes without item lookup or navigation', async () => {
    entries = [notification('COMMENT', { item: null })];
    renderBell();
    await openBell();
    await userEvent.click(screen.getByRole('button', { name: /An update/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsFor('/notifications/notification-1/read')).toHaveLength(1);
    expect(callsFor('/items?')).toHaveLength(0);
    expect(screen.getByLabelText('Location')).toHaveTextContent('/');
  });

  it('finds an exact item ID across paginated key-search results and caches the resolved item', async () => {
    const original = apiMock.getMockImplementation();
    apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path.startsWith('/items?')) {
        const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
        return {
          items: [{ id: page === 1 ? 'other-item' : 'item-1', projectId: page === 1 ? 'wrong-project' : 'project-1' }],
          total: 101, page, pageSize: 100,
        };
      }
      return original?.(path, init);
    }) as typeof api);
    const { queryClient } = renderBell();
    await openBell();
    await userEvent.click(screen.getByRole('button', { name: /An update/ }));
    await waitFor(() => expect(screen.getByLabelText('Location')).toHaveTextContent('/projects/project-1?item=item-1&tab=comments'));
    expect(callsFor('/items?')).toEqual([
      ['/items?search=DEMO-1&page=1&pageSize=100'],
      ['/items?search=DEMO-1&page=2&pageSize=100'],
    ]);
    expect(queryClient.getQueryData(['item', 'item-1'])).toEqual({ item: { id: 'item-1', projectId: 'project-1' } });
  });

  it('shows a recoverable error without navigation when the item is absent from search results', async () => {
    const original = apiMock.getMockImplementation();
    apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path.startsWith('/items?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      return original?.(path, init);
    }) as typeof api);
    renderBell();
    await openBell();
    await userEvent.click(screen.getByRole('button', { name: /An update/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toHaveTextContent('/');
    expect(callsFor('/notifications/notification-1/read')).toHaveLength(1);
  });

  it('marks all read, refreshes scoped caches and removes the badge', async () => {
    renderBell();
    await openBell();
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.queryByLabelText(/unread notifications/)).not.toBeInTheDocument();
    expect(callsFor('/notifications/read-all')).toEqual([['/notifications/read-all', { method: 'POST', body: '{}' }]]);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('An update')).toBeInTheDocument();
  });

  it('supports Escape, outside dismissal, arrow navigation, and natural Tab without trapping focus', async () => {
    renderBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    await screen.findByText('An update');
    expect(screen.getByRole('button', { name: 'Mark all read' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Unread' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'All' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await openBell();
    await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openBell();
    screen.getByRole('button', { name: /An update/ }).focus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['read', 'item', 'all'] as const)('handles %s failures without navigation and allows retry', async (kind) => {
    renderBell();
    await openBell();
    failure = kind;
    await userEvent.click(screen.getByRole('button', { name: kind === 'all' ? 'Mark all read' : /An update/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(kind === 'all' ? 'Could not mark' : 'Could not open');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toHaveTextContent('/');
    if (kind === 'read') expect(callsFor('/items?')).toHaveLength(0);
    failure = undefined;
    if (kind === 'item') {
      await userEvent.click(screen.getByRole('button', { name: 'All' }));
      await screen.findByText('An update');
    }
    await userEvent.click(screen.getByRole('button', { name: kind === 'all' ? 'Mark all read' : /An update/ }));
    if (kind === 'all') expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    else await waitFor(() => expect(screen.getByLabelText('Location')).toHaveTextContent('/projects/project-1'));
  });

  it('shows list and count failures with independent retry actions', async () => {
    failure = 'count';
    renderBell();
    await screen.findByText('Unread count unavailable');
    failure = 'list';
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Could not load notifications.')).toBeInTheDocument();
    failure = undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('An update')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry count' }));
    expect(await screen.findByLabelText('3 unread notifications')).toBeInTheDocument();
  });

  it('polls the count every minute, pauses hidden documents, and refetches immediately on visibility', async () => {
    vi.useFakeTimers();
    const result = renderBell();
    const flush = async () => {
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1);
      });
    };
    await flush();
    expect(callsFor('/notifications/unread-count')).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(callsFor('/notifications/unread-count')).toHaveLength(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => { fireEvent(document, new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(callsFor('/notifications/unread-count')).toHaveLength(2);
    expect(callsFor('/notifications?')).toHaveLength(0);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => { fireEvent(document, new Event('visibilitychange')); });
    await flush();
    expect(callsFor('/notifications/unread-count')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    await flush();
    expect(callsFor('/notifications?')).toHaveLength(1);
    act(() => { fireEvent(window, new Event('focus')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(callsFor('/notifications?')).toHaveLength(1);
    expect(callsFor('/notifications/unread-count')).toHaveLength(5);
    result.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(callsFor('/notifications/unread-count')).toHaveLength(5);
  });

  it('does not request unread counts while initially hidden', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    renderBell();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(callsFor('/notifications/unread-count')).toHaveLength(0);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(callsFor('/notifications/unread-count')).toHaveLength(1);
  });
});
