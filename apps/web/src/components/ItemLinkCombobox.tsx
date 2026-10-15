import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import type { Item } from '../types';

type ItemsResponse = { items: Item[]; total: number; pageSize: number };

export function ItemLinkCombobox({ label, projectId, excludedIds, value, onChange, disabled }: {
  label: string;
  projectId?: string;
  excludedIds: string[];
  value: Item | null;
  onChange: (item: Item | null) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const text = value ? `${value.key} · ${value.title}` : input;
  const query = text.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 275);
    return () => window.clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: ['item-link-search', projectId, debounced],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ search: debounced, searchKeys: 'true', pageSize: '20' });
      if (projectId) params.set('projectId', projectId);
      return api<ItemsResponse>(`/items?${params}`, { signal });
    },
    enabled: open && !value && query.length >= 2 && query === debounced,
  });
  const ready = query.length >= 2 && query === debounced && !value;
  const options = ready ? (results.data?.items ?? []).filter((entry) =>
    !excludedIds.includes(entry.id) && (!projectId || entry.projectId === projectId),
  ) : [];
  const activeIndex = active >= 0 && active < options.length ? active : -1;
  useEffect(() => {
    if (open && activeIndex >= 0) {
      document.getElementById(`${id}-${options[activeIndex].id}`)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [open, activeIndex, id, options]);
  const choose = (entry: Item) => {
    setInput('');
    onChange(entry);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative min-w-0">
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-${options[activeIndex].id}` : undefined}
        aria-describedby={open ? `${id}-status` : undefined}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          onChange(null);
          setInput(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => { if (!value) setOpen(true); }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActive(options.length ? activeIndex < 0
              ? event.key === 'ArrowDown' ? 0 : options.length - 1
              : (activeIndex + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length : -1);
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (activeIndex >= 0) choose(options[activeIndex]);
          }
        }}
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <ul id={`${id}-list`} role="listbox" aria-label={label} className="max-h-48 overflow-auto">
            {options.map((entry, index) => (
              <li
                id={`${id}-${entry.id}`}
                key={entry.id}
                role="option"
                aria-selected={activeIndex === index}
                className={`cursor-pointer px-3 py-2 text-sm ${activeIndex === index ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(entry)}
              >
                {entry.key} · {entry.title} · {entry.status}{!projectId && ` · ${entry.project.code}`}
              </li>
            ))}
          </ul>
          <p id={`${id}-status`} role="status" className="px-3 py-2 text-xs text-slate-500">
            {query.length < 2 ? 'Type at least 2 characters to search.'
              : !ready || results.isFetching ? 'Searching…'
                : results.isError ? 'Could not search items. Edit your search to retry.'
                  : options.length === 0 ? 'No matching items.' : `${options.length} results.`}
            {ready && results.data && results.data.total > results.data.items.length && ' Showing the first 20 matches. Refine your search.'}
          </p>
        </div>
      )}
    </div>
  );
}
