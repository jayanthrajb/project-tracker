import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

interface DropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger: ReactNode;
  children: ReactNode;
}

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]';

export function Dropdown({ open, onOpenChange, label, trigger, children }: DropdownProps) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

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
        aria-controls={open ? id : undefined}
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
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white text-sm shadow-lg"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
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
