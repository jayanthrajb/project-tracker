import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Timeline } from './Timeline';
import type { ActivityEntry } from '../types';

const users = [{ id: 'priya', name: 'Priya' }, { id: 'meena', name: 'Meena' }];

export function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'a1', itemId: 'i1', projectId: 'p1', userId: 'priya', user: { id: 'priya', name: 'Priya' },
    action: 'UPDATED', field: 'priority', oldValue: 'P2', newValue: 'P0',
    createdAt: '2026-10-04T00:00:00.000Z', ...overrides,
  };
}

describe('Timeline', () => {
  it('renders readable sentences and names, not identity or comment IDs', () => {
    render(<Timeline users={users} entries={[
      entry(),
      entry({ id: 'a2', action: 'ASSIGNED', field: 'assigneeId', newValue: 'meena', oldValue: null, createdAt: '2026-10-03T23:00:00Z' }),
      entry({ id: 'a3', action: 'CREATED', field: null, newValue: 'Title' }),
      entry({ id: 'a4', action: 'COMMENTED', field: 'commentId', newValue: 'private-comment-id' }),
      entry({ id: 'a5', action: 'IMPORTED', field: null }),
      entry({ id: 'a6', action: 'BULK_UPDATED', field: 'status', oldValue: 'OPEN', newValue: 'DONE' }),
      entry({ id: 'a7', action: 'DELETED', itemId: null, oldValue: 'Old item' }),
    ]} />);
    const rows = within(screen.getByRole('list', { name: 'Activity timeline' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Priya changed Priority from P2 → P0');
    expect(screen.getByText('P0')).toHaveClass('bg-red-100', 'text-red-700');
    expect(rows[1]).toHaveTextContent('Priya assigned this to Meena');
    expect(rows[2]).toHaveTextContent('Priya created this item');
    expect(rows[3]).toHaveTextContent('Priya commented');
    expect(rows[4]).toHaveTextContent('Priya imported this item');
    expect(rows[5]).toHaveTextContent('Priya changed Status from OPEN → DONE in a bulk edit');
    expect(rows[6]).toHaveTextContent('Priya deleted Old item');
    expect(screen.queryByText('meena')).not.toBeInTheDocument();
    expect(screen.queryByText('private-comment-id')).not.toBeInTheDocument();
    expect(rows[0].querySelector('time')).toHaveAttribute('title', new Date('2026-10-04T00:00:00Z').toLocaleString());
  });

  it('groups consecutive changes within five minutes and expands their details', async () => {
    const user = userEvent.setup();
    const { container } = render(<Timeline users={users} entries={[
      entry(),
      entry({ id: 'a2', field: 'risk', oldValue: 'LOW', newValue: 'HIGH', createdAt: '2026-10-03T23:59:00Z' }),
      entry({ id: 'a3', action: 'BULK_UPDATED', field: 'assigneeId', newValue: 'meena', createdAt: '2026-10-03T23:58:00Z' }),
      entry({ id: 'a4', field: 'status', oldValue: 'OPEN', newValue: 'DONE', createdAt: '2026-10-03T23:55:00Z' }),
    ]} />);
    const summary = container.querySelector('summary');
    expect(summary).toHaveTextContent('Priya made 4 changes');
    expect(screen.getByText('P0')).not.toBeVisible();
    await user.click(summary!);
    expect(screen.getByText('P0')).toBeVisible();
    expect(screen.getByText('HIGH')).toHaveClass('bg-red-100');
    expect(screen.getByText('Meena')).toBeVisible();
  });

  it('does not group across users, items, non-change actions, or the five-minute boundary', () => {
    const { container } = render(<Timeline users={users} entries={[
      entry(),
      entry({ id: 'a2', createdAt: '2026-10-03T23:54:59Z' }),
      entry({ id: 'a3', userId: 'meena', user: null, createdAt: '2026-10-03T23:54:58Z' }),
      entry({ id: 'a4', itemId: 'i2', userId: 'meena', user: null, createdAt: '2026-10-03T23:54:57Z' }),
      entry({ id: 'a5', itemId: 'i2', userId: 'meena', user: null, action: 'COMMENTED', createdAt: '2026-10-03T23:54:56Z' }),
    ]} />);
    expect(container.querySelector('summary')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('links project entries to History and handles unknown/deleted users safely', () => {
    render(<MemoryRouter><Timeline linkItems users={[]} entries={[
      entry({ userId: 'missing-user-id', user: null, field: 'reporterId', oldValue: null, newValue: 'missing-assignee-id' }),
    ]} /></MemoryRouter>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/projects/p1?item=i1&tab=history');
    expect(screen.getAllByText('Unknown user')).toHaveLength(2);
    expect(screen.queryByText('missing-assignee-id')).not.toBeInTheDocument();
  });
});
