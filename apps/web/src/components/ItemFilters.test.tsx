import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ItemFilters } from './ItemFilters';
import type { ItemViewFilters } from '../lib/itemViewFilters';

function Harness({ initial = {} }: { initial?: ItemViewFilters }) {
  const [filters, setFilters] = useState(initial);
  const [sort, setSort] = useState('score-desc');
  return <><ItemFilters filters={filters} sort={sort} onChange={(next, nextSort) => {
    setFilters(next);
    if (nextSort) setSort(nextSort);
  }} /><output data-testid="filters">{JSON.stringify(filters)}</output></>;
}

describe('ItemFilters', () => {
  it('keeps frequent controls visible and exposes other filters through the keyboard-accessible dropdown', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByLabelText('Search')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Status' })).toBeVisible();
    expect(screen.getByLabelText('Sort')).toBeVisible();
    expect(screen.getByLabelText('P0')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'More filters' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const panel = screen.getByRole('dialog', { name: 'More filters' });
    expect(within(panel).getByLabelText('P0')).toHaveFocus();
    await user.click(within(panel).getByLabelText('P0'));
    await user.click(within(panel).getByLabelText('HIGH'));
    await user.click(within(panel).getByLabelText('BUG'));
    await user.selectOptions(within(panel).getByLabelText('Assignee'), '__unassigned');
    await user.type(within(panel).getByLabelText('Due before'), '2026-10-05');
    expect(JSON.parse(screen.getByTestId('filters').textContent ?? '{}')).toEqual({
      priorities: ['P0'], risks: ['HIGH'], types: ['BUG'], unassigned: true, dueBefore: '2026-10-05',
    });
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(within(trigger).getByLabelText('5 active filters')).toHaveTextContent('5');
  });

  it('clears filters without changing sort and removes the collapsed active count', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ search: 'urgent', statuses: ['OPEN'], priorities: ['P0'], risks: ['HIGH'] }} />);
    expect(screen.getByLabelText('2 active filters')).toHaveTextContent('2');
    await user.selectOptions(screen.getByLabelText('Sort'), 'title-asc');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByTestId('filters')).toHaveTextContent('{}');
    expect(screen.getByLabelText('Sort')).toHaveValue('title-asc');
    expect(screen.queryByLabelText('2 active filters')).not.toBeInTheDocument();
  });
});
