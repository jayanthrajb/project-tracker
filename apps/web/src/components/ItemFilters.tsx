import { filterOptions, sortOptions } from '../lib/itemViewFilters';
import type { ItemViewFilters } from '../lib/itemViewFilters';
import type { Project, User } from '../types';

export function ItemFilters({ filters, sort, onChange, users = [], projects, ownItems = false, searchPlaceholder = 'Search items' }: {
  filters: ItemViewFilters;
  sort: string;
  onChange: (filters: ItemViewFilters, sort?: string) => void;
  users?: User[];
  projects?: Project[];
  ownItems?: boolean;
  searchPlaceholder?: string;
}) {
  const enums = [
    ['status', 'Status', 'statuses'],
    ['priority', 'Priority', 'priorities'],
    ['risk', 'Risk', 'risks'],
    ['type', 'Type', 'types'],
  ] as const;
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="grid gap-1">Search
        <input className="rounded-lg border border-slate-300 px-3 py-2" value={filters.search ?? ''} placeholder={searchPlaceholder} onChange={(event) => onChange({ ...filters, search: event.target.value || undefined })} />
      </label>
      {enums.map(([key, label, field]) => (
        <fieldset key={key} className="rounded-lg border border-slate-300 px-2 py-1">
          <legend>{label}</legend>
          <div className="flex flex-wrap gap-2">
            {filterOptions[key].map((option) => (
              <label key={option} className="flex items-center gap-1">
                <input type="checkbox" checked={(filters[field] as readonly string[] | undefined)?.includes(option) ?? false} onChange={(event) => {
                  const values = new Set<string>(filters[field]);
                  if (event.target.checked) values.add(option);
                  else values.delete(option);
                  onChange({ ...filters, [field]: values.size ? [...values] : undefined });
                }} />{option}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {!ownItems && <label className="grid gap-1">Assignee
        <select className="rounded-lg border border-slate-300 px-3 py-2" value={filters.unassigned ? '__unassigned' : filters.assigneeId ?? ''} onChange={(event) => onChange({ ...filters, assigneeId: event.target.value && event.target.value !== '__unassigned' ? event.target.value : undefined, unassigned: event.target.value === '__unassigned' ? true : undefined })}>
          <option value="">Anyone</option><option value="__unassigned">Unassigned</option>
          {users.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          {filters.assigneeId && !users.some((entry) => entry.id === filters.assigneeId) && <option value={filters.assigneeId}>{filters.assigneeId}</option>}
        </select>
      </label>}
      {projects && <label className="grid gap-1">Project
        <select value={filters.projectId ?? ''} className="rounded-lg border border-slate-300 px-3 py-2" onChange={(event) => onChange({ ...filters, projectId: event.target.value || undefined })}>
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          {filters.projectId && !projects.some((project) => project.id === filters.projectId) && <option value={filters.projectId}>{filters.projectId}</option>}
        </select>
      </label>}
      <label className="grid gap-1">Due before
        <input className="rounded-lg border border-slate-300 px-3 py-2" type="date" value={filters.dueBefore?.slice(0, 10) ?? ''} onChange={(event) => onChange({ ...filters, dueBefore: event.target.value || undefined })} />
      </label>
      <label className="grid gap-1">Sort
        <select className="rounded-lg border border-slate-300 px-3 py-2" value={sort} onChange={(event) => onChange(filters, event.target.value)}>
          {sortOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
  );
}
