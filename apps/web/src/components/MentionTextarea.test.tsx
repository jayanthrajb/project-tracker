import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MentionTextarea } from './MentionTextarea';
import type { MentionableUser } from '../types';

const users: MentionableUser[] = [
  { id: 'u1', name: 'Sara Manager', role: 'MANAGER', isActive: true },
  { id: 'u2', name: 'Priya Patel', role: 'DEVELOPER', isActive: true },
  { id: 'u3', name: 'Pat Outsider', role: 'DEVELOPER', isActive: true },
  { id: 'u4', name: 'Paul Inactive', role: 'DEVELOPER', isActive: false },
];

function Harness({ onSubmit = vi.fn(), preferred = new Set<string>(), onOuterKeyDown = vi.fn() }: {
  onSubmit?: () => void;
  preferred?: ReadonlySet<string>;
  onOuterKeyDown?: (key: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div onKeyDown={(event) => onOuterKeyDown(event.key)}>
      <MentionTextarea value={value} onChange={setValue} users={users} preferredIds={preferred} onSubmit={onSubmit} ariaLabel="Add a comment" />
    </div>
  );
}

// Same trigger/handle pattern as extractMentionHandles in apps/api/src/lib/mentions.ts.
// (Inlined because the web Docker build only copies apps/web.)
function extractMentionHandles(body: string) {
  return [...body.matchAll(/(?:^|[\s([{])@([A-Za-z0-9][A-Za-z0-9._-]*)\b/g)].map((match) => match[1].toLowerCase());
}

const textbox = () => screen.getByRole('textbox', { name: 'Add a comment' }) as HTMLTextAreaElement;

describe('MentionTextarea', () => {
  it('opens on @ and lists only active users', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(textbox(), 'Hello @');
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Pat Outsider'),
      expect.stringContaining('Priya Patel'),
      expect.stringContaining('Sara Manager'),
    ]);
  });

  it('filters candidates as the user types', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(textbox(), '@pri');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Priya Patel');
  });

  it('prefers project members over other active users', async () => {
    const user = userEvent.setup();
    render(<Harness preferred={new Set(['u1'])} />);
    await user.type(textbox(), '@');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Sara Manager');
  });

  it('inserts the name-slug token the API mention parser resolves', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(textbox(), 'cc @sar');
    await user.keyboard('{Enter}');
    expect(textbox().value).toBe('cc @sara-manager ');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(extractMentionHandles(textbox().value)).toEqual(['sara-manager']);
  });

  it('supports ArrowDown/ArrowUp navigation and Tab to select', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(textbox(), '@');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(textbox()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
    await user.keyboard('{Tab}');
    expect(textbox().value).toBe('@priya-patel ');
    expect(textbox()).toHaveFocus();
  });

  it('dismisses on Escape without bubbling, then lets Enter type a newline', async () => {
    const user = userEvent.setup();
    const onOuterKeyDown = vi.fn();
    render(<Harness onOuterKeyDown={onOuterKeyDown} />);
    await user.type(textbox(), '@sa');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onOuterKeyDown).not.toHaveBeenCalledWith('Escape');
    await user.keyboard('r{Enter}');
    expect(textbox().value).toBe('@sar\n');
  });

  it('does not hijack normal typing such as email addresses or plain Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(textbox(), 'mail me@sara');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}x');
    expect(textbox().value).toBe('mail me@sara\nx');
  });

  it('submits on Ctrl+Enter and Cmd+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(textbox(), 'hi');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(textbox().value).toBe('hi');
  });
});
