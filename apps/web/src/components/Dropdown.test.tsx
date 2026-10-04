import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dropdown } from './Dropdown';

function Harness() {
  const [open, setOpen] = useState(false);
  return <Dropdown open={open} onOpenChange={setOpen} label="Options" trigger="Options">
    <button type="button">First</button>
    <button type="button">Second</button>
    <label>Choice<select><option>A</option><option>B</option></select></label>
  </Dropdown>;
}

afterEach(() => vi.restoreAllMocks());

describe('Dropdown', () => {
  it('shifts away from the left edge, flips above the trigger, and repositions on resize and scroll', async () => {
    let anchor = { x: 4, y: window.innerHeight - 50, width: 80, height: 30 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rect = this.getAttribute('role') === 'dialog' ? { x: 0, y: 0, width: 384, height: 200 } : anchor;
      return { ...rect, top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => rect };
    });
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Options' }));
    const panel = screen.getByRole('dialog', { name: 'Options' });
    expect(panel.style.left).toBe('12px');
    expect(panel.style.top).toBe('-208px');
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();

    anchor = { ...anchor, x: window.innerWidth - 40, y: 20 };
    fireEvent(window, new Event('resize'));
    expect(anchor.x + Number.parseFloat(panel.style.left) + 384).toBe(window.innerWidth - 16);
    expect(panel.style.top).toBe('38px');

    anchor = { ...anchor, x: 0, y: window.innerHeight - 10 };
    fireEvent(document, new Event('scroll'));
    expect(panel.style.left).toBe('16px');
    expect(panel.style.top).toBe('-208px');
  });

  it('preserves arrows, Escape, outside dismissal and focus return without hijacking select keys', async () => {
    const user = userEvent.setup();
    render(<><Harness /><button type="button">Outside</button></>);
    const trigger = screen.getByRole('button', { name: 'Options' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Second' })).toHaveFocus();
    const select = screen.getByRole('combobox', { name: 'Choice' });
    select.focus();
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    fireEvent(select, event);
    expect(event.defaultPrevented).toBe(false);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
