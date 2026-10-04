import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityFeed } from './ActivityFeed';
import { api } from '../lib/api';
import type { ActivityEntry } from '../types';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
const apiMock = vi.mocked(api);
const activity: ActivityEntry = {
  id: 'a1', itemId: 'i1', projectId: 'p1', userId: 'u1', user: { id: 'u1', name: 'Priya' },
  action: 'ASSIGNED', field: 'assigneeId', oldValue: null, newValue: 'u2', createdAt: '2026-10-04T00:00:00Z',
};

function mount(props: Partial<Parameters<typeof ActivityFeed>[0]> = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<QueryClientProvider client={client}><MemoryRouter><ActivityFeed scope="items" id="i1" {...props} /></MemoryRouter></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/users')) return { users: [{ id: 'u2', name: 'Meena', isActive: false }], total: 1 };
    const params = new URLSearchParams(path.split('?')[1]);
    const page = Number(params.get('page'));
    const pageSize = Number(params.get('pageSize'));
    return { activity: page === 1 ? [activity] : [{ ...activity, id: 'a2', action: 'IMPORTED', field: null }], total: pageSize + 1, page, pageSize };
  }) as typeof api);
});

describe('ActivityFeed', () => {
  it('loads newest-first pages and resolves inactive assignees using the shared cache', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['users', 'mentionable'], { users: [{ id: 'u2', name: 'Meena', isActive: false }] });
    mount({}, client);
    expect(screen.getByLabelText('Loading activity')).toBeInTheDocument();
    expect(await screen.findByText('Meena')).toBeInTheDocument();
    expect(apiMock.mock.calls.some(([path]) => path.startsWith('/users'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/items/i1/activity?page=2&pageSize=25'));
    expect(await screen.findByText(/imported this item/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('fetches all directory pages and gives project activity item history links', async () => {
    apiMock.mockImplementation((async (path: string) => {
      if (path === '/users?page=1&pageSize=100') return { users: [{ id: 'u1', name: 'Priya' }], total: 2 };
      if (path === '/users?page=2&pageSize=100') return { users: [{ id: 'u2', name: 'Meena' }], total: 2 };
      return { activity: [activity], total: 1, page: 1, pageSize: 10 };
    }) as typeof api);
    mount({ scope: 'projects', id: 'p1', compact: true });
    expect(await screen.findByText('Meena')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/projects/p1/activity?page=1&pageSize=10');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/projects/p1?item=i1&tab=history');
  });

  it('has empty and retryable error states', async () => {
    apiMock.mockRejectedValueOnce(new Error('Network error'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load activity');
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
    apiMock.mockResolvedValue({ activity: [], total: 0, page: 1, pageSize: 25 });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });
});
