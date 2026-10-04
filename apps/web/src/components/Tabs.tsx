import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { cn } from '../lib/utils';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  content: ReactNode;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  idPrefix: string;
  ariaLabel: string;
  className?: string;
}

// Accessible tabs (WAI-ARIA tabs pattern, automatic activation). Panels are mounted on
// first activation and kept mounted afterwards so their state survives tab switches.
export function Tabs<T extends string>({ tabs, activeId, onChange, idPrefix, ariaLabel, className }: TabsProps<T>) {
  const [visited, setVisited] = useState<ReadonlySet<T>>(() => new Set([activeId]));
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());
  if (!visited.has(activeId)) setVisited(new Set([...visited, activeId]));

  const tabId = (id: T) => `${idPrefix}-tab-${id}`;
  const panelId = (id: T) => `${idPrefix}-panel-${id}`;

  const select = (id: T) => {
    onChange(id);
    tabRefs.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    select(tabs[next].id);
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label={ariaLabel} className="flex gap-1 border-b border-slate-200">
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
                selected ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelId(tab.id)}
          aria-labelledby={tabId(tab.id)}
          hidden={tab.id !== activeId}
          tabIndex={0}
          className="pt-4 focus:outline-none"
        >
          {visited.has(tab.id) ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
