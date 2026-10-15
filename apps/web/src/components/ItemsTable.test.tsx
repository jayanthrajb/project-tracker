import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ItemsTable } from './ItemsTable';
import type { Item, User } from '../types';

const user: User = { id: 'u1', name: 'Dev', email: 'dev@example.com', role: 'DEVELOPER' };
const item: Item = {
  id: 'i1', projectId: 'p1', key: 'APO-1', type: 'TASK', title: 'My task', description: '', status: 'OPEN', priority: 'P2', risk: 'LOW',
  assigneeId: 'u1', reporterId: 'u1', assignee: user, reporter: user, project: { id: 'p1', name: 'Apollo', code: 'APO' },
  dueDate: null, estimateHours: null, spentHours: 0, tags: [], createdAt: '', updatedAt: '', closedAt: null, startedAt: null, score: 1,
  blockedBy: [
    { id: 'b1', key: 'BET-1', title: 'Open blocker', status: 'OPEN', projectCode: 'BET' },
    { id: 'b2', key: 'BET-2', title: 'Done blocker', status: 'DONE', projectCode: 'BET' },
  ],
};

describe('ItemsTable blocked status warning', () => {
  it('warns before staging a committed status while open blockers remain', async () => {
    const onDraftChange = vi.fn();
    render(<ItemsTable
      items={[item]}
      users={[user]}
      drafts={{}}
      selectedIds={new Set()}
      onToggleSelect={vi.fn()}
      onSelectAll={vi.fn()}
      onDraftChange={onDraftChange}
      onRevertRow={vi.fn()}
      onOpen={vi.fn()}
    />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Status for APO-1' }), { target: { value: 'IN_PROGRESS' } });
    const warning = screen.getByRole('alertdialog', { name: 'Proceed with blocked item?' });
    expect(warning).toHaveTextContent('BET-1 · Open blocker');
    expect(warning).not.toHaveTextContent('BET-2 · Done blocker');
    expect(onDraftChange).not.toHaveBeenCalled();
    await userEvent.click(within(warning).getByRole('button', { name: 'Proceed' }));
    expect(onDraftChange).toHaveBeenCalledWith(item, { status: 'IN_PROGRESS' });
  });
});
