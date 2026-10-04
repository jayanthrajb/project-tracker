import { describe, expect, it } from 'vitest';

import { canEditView, constrainFilters, itemQuery, readItemFilters, readItemSort, viewSort, writeItemFilters } from './itemViewFilters';
import type { SavedView } from './itemViewFilters';
import type { User } from '../types';

const user: User = { id: 'u1', name: 'User', email: 'user@example.com', role: 'MANAGER' };
const view: SavedView = { id: 'v1', userId: 'u2', name: 'View', projectId: null, scope: 'PERSONAL', filtersJson: {}, sortJson: {}, isDefault: false };

describe('saved filter serialization', () => {
  it('captures all accepted filters, canonicalizes comma lists, and keeps unrelated deep-link parameters', () => {
    const params = new URLSearchParams('status=OPEN,BLOCKED,OPEN&priority=P1,P0&type=BUG&risk=HIGH&assigneeId=u1&search=two+words&projectId=p1&dueBefore=2026-10-05&tags=urgent&item=i1&tab=history&view=v1');
    const filters = readItemFilters(params);
    const next = writeItemFilters(params, filters, 'dueDate-asc');
    expect(filters).toEqual({ statuses: ['OPEN', 'BLOCKED'], priorities: ['P0', 'P1'], types: ['BUG'], risks: ['HIGH'], assigneeId: 'u1', search: 'two words', projectId: 'p1', dueBefore: '2026-10-05' });
    expect(next.get('status')).toBe('BLOCKED,OPEN');
    expect(next.get('item')).toBe('i1');
    expect(next.get('tab')).toBe('history');
    expect(next.get('view')).toBe('v1');
    expect(itemQuery(filters, 'dueDate-asc')).not.toContain('tags');
    expect(itemQuery(filters, 'dueDate-asc')).toContain('pageSize=100');
  });

  it('normalizes invalid enums/sorts and keeps ownership separate from ordinary filters', () => {
    expect(readItemFilters(new URLSearchParams('status=invalid,OPEN&unassigned=true&assigneeId=u2&dueBefore=bad'))).toEqual({ statuses: ['OPEN'], unassigned: true });
    const mine = new URLSearchParams(itemQuery({ assigneeId: 'u2' }, 'score-desc', true));
    expect(mine.get('mine')).toBe('true');
    expect(mine.get('assigneeId')).toBe('u2');
    expect(new URLSearchParams(itemQuery({}, 'score-desc')).has('mine')).toBe(false);
    expect(constrainFilters({ projectId: 'p2' }, 'p1')).toEqual({ projectId: 'p1' });
    expect(readItemSort(new URLSearchParams('sort=priority-asc'))).toBe('score-desc');
    expect(readItemFilters(new URLSearchParams('dueBefore=2026-02-31'))).toEqual({});
    expect(itemQuery({ dueBefore: '2026-10-05T12:00:00+02:00' }, 'score-desc')).toBe(itemQuery({ dueBefore: '2026-10-05T10:00:00.000Z' }, 'score-desc'));
  });

  it('reads the seed field/direction shape and safely falls back for unsupported seed sorts', () => {
    expect(viewSort({ ...view, sortJson: { field: 'dueDate', direction: 'asc' } })).toBe('dueDate-asc');
    expect(viewSort({ ...view, sortJson: { field: 'priority', direction: 'asc' } })).toBe('score-desc');
    expect(viewSort({ ...view, sortJson: { field: 'updatedAt', direction: 'asc' } })).toBe('score-desc');
  });

  it.each(['2026-02-30', '2026-02-30T12:00:00Z', '2026-10-05T24:00:00Z', '2026-10-05T12:00:00', '2026-10-05T12:00:00+0200'])('rejects invalid dueBefore values using the exact server ISO constraint: %s', (dueBefore) => {
    expect(readItemFilters(new URLSearchParams({ dueBefore }))).toEqual({});
  });

  it('matches personal vs shared write permissions, including manager limits', () => {
    expect(canEditView(view, user)).toBe(false);
    expect(canEditView({ ...view, scope: 'SHARED' }, user)).toBe(true);
    expect(canEditView({ ...view, scope: 'SHARED' }, { ...user, role: 'DEVELOPER' })).toBe(false);
    expect(canEditView({ ...view, userId: 'u1' }, { ...user, role: 'DEVELOPER' })).toBe(true);
  });
});
