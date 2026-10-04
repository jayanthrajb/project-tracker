import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface DropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  keepMounted?: boolean;
}

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]';

export function Dropdown({ open, onOpenChange, label, trigger, children, keepMounted = false }: DropdownProps) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!root.current || !button.current || !panel.current) return;
      const inset = 16;
      panel.current.style.maxHeight = `${Math.max(0, window.innerHeight - inset * 2)}px`;
      const anchor = button.current.getBoundingClientRect();
      const origin = root.current.getBoundingClientRect();
      const bounds = panel.current.getBoundingClientRect();
      const left = Math.max(inset, Math.min(anchor.right - bounds.width, window.innerWidth - inset - bounds.width));
      const below = anchor.bottom + 8;
      const above = anchor.top - 8 - bounds.height;
      const preferredTop = below + bounds.height > window.innerHeight - inset ? above : below;
      const top = Math.max(inset, Math.min(preferredTop, window.innerHeight - inset - bounds.height));
      panel.current.style.left = `${left - origin.left}px`;
      panel.current.style.top = `${top - origin.top}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      observer?.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(focusable)?.focus();
    const close = () => {
      onOpenChange(false);
      button.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && (document.activeElement === document.body || root.current?.contains(document.activeElement))) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open || keepMounted ? id : undefined}
        aria-haspopup="dialog"
        className="relative rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-600"
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) onOpenChange(true);
            else panel.current?.querySelector<HTMLElement>(focusable)?.focus();
          }
        }}
      >
        {trigger}
      </button>
      {(open || keepMounted) && (
        <div
          ref={panel}
          hidden={!open}
          id={id}
          role="dialog"
          aria-label={label}
          className="absolute z-40 w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow-lg"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) return;
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(focusable));
            const index = controls.indexOf(document.activeElement as HTMLElement);
            if (index < 0 || controls.length === 0) return;
            event.preventDefault();
            controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length].focus();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
