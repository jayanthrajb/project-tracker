import { useId } from 'react';
import { Link } from 'react-router-dom';

import { backlogColor, neutralColor, priorityColors, riskColors } from '../lib/itemColors';
import { cn, formatDate, formatRelativeTime } from '../lib/utils';
import type { ActivityAction, ActivityEntry, MentionableUser } from '../types';

const actionStyles: Record<ActivityAction, { icon: string; color: string }> = {
  CREATED: { icon: '+', color: 'bg-emerald-100 text-emerald-700' },
  UPDATED: { icon: '✎', color: 'bg-slate-100 text-slate-700' },
  STATUS_CHANGED: { icon: '→', color: 'bg-blue-100 text-blue-700' },
  ASSIGNED: { icon: '♙', color: 'bg-violet-100 text-violet-700' },
  COMMENTED: { icon: '☏', color: 'bg-sky-100 text-sky-700' },
  DELETED: { icon: '−', color: 'bg-red-100 text-red-700' },
  IMPORTED: { icon: '↓', color: 'bg-teal-100 text-teal-700' },
  BULK_UPDATED: { icon: '≡', color: 'bg-amber-100 text-amber-700' },
};

const fieldLabels: Record<string, string> = {
  title: 'Title', type: 'Type', description: 'Description', status: 'Status',
  priority: 'Priority', risk: 'Risk', assigneeId: 'Assignee', reporterId: 'Reporter',
  dueDate: 'Due date', estimateHours: 'Estimate', spentHours: 'Time spent',
  tags: 'Tags', closedAt: 'Closed date',
};

const changeActions = new Set<ActivityAction>(['UPDATED', 'STATUS_CHANGED', 'ASSIGNED', 'BULK_UPDATED']);

function groupEntries(entries: ActivityEntry[]) {
  const groups: ActivityEntry[][] = [];
  for (const entry of entries) {
    const group = groups[groups.length - 1];
    const first = group?.[0];
    const gap = first ? new Date(first.createdAt).getTime() - new Date(entry.createdAt).getTime() : Infinity;
    if (first && first.userId === entry.userId && first.itemId === entry.itemId &&
        changeActions.has(first.action) && changeActions.has(entry.action) && gap >= 0 && gap <= 5 * 60_000) {
      group.push(entry);
    } else {
      groups.push([entry]);
    }
  }
  return groups;
}

function ValueChip({ field, value, users }: { field: string | null; value: string | null; users: ReadonlyMap<string, MentionableUser> }) {
  let label = value ?? 'None';
  let color = neutralColor;
  if (field === 'assigneeId' || field === 'reporterId') {
    label = value ? users.get(value)?.name ?? 'Unknown user' : 'Unassigned';
  } else if ((field === 'dueDate' || field === 'closedAt') && value) {
    label = formatDate(value);
  } else if (field === 'tags' && value) {
    try {
      const tags: unknown = JSON.parse(value);
      if (Array.isArray(tags) && tags.every((tag: unknown) => typeof tag === 'string')) label = tags.join(', ') || 'None';
    } catch {
      // Older activity may contain a plain-text value.
    }
  }
  if (field === 'priority' && value && value in priorityColors) color = priorityColors[value as keyof typeof priorityColors];
  if (field === 'risk' && value && value in riskColors) color = riskColors[value as keyof typeof riskColors];
  if (field === 'status' && value === 'BACKLOG') color = `border ${backlogColor}`;
  return <span className={cn('inline-block max-w-full break-words rounded px-1.5 py-0.5 text-xs', color)}>{label}</span>;
}

function Sentence({ entry, users }: { entry: ActivityEntry; users: ReadonlyMap<string, MentionableUser> }) {
  const actor = <strong className="font-medium">{entry.user?.name ?? users.get(entry.userId)?.name ?? 'Unknown user'}</strong>;
  switch (entry.action) {
    case 'CREATED': return <>{actor} created this item</>;
    case 'IMPORTED': return <>{actor} imported this item</>;
    case 'COMMENTED': return <>{actor} commented</>;
    case 'DELETED': return <>{actor} deleted {entry.oldValue ? <strong className="font-medium">{entry.oldValue}</strong> : 'this item'}</>;
    default:
      if (entry.field === 'assigneeId' || entry.action === 'ASSIGNED') {
        return <>{actor} {entry.newValue ? 'assigned this to' : 'unassigned this item'}{' '}
          {entry.newValue && <ValueChip field="assigneeId" value={entry.newValue} users={users} />}
          {entry.action === 'BULK_UPDATED' && ' in a bulk edit'}</>;
      }
      if (!entry.field) return <>{actor} updated this item{entry.action === 'BULK_UPDATED' && ' in a bulk edit'}</>;
      return <>{actor} changed <strong className="font-medium">{fieldLabels[entry.field] ?? 'a field'}</strong> from{' '}
        <ValueChip field={entry.field} value={entry.oldValue} users={users} />{' → '}
        <ValueChip field={entry.field} value={entry.newValue} users={users} />
        {entry.action === 'BULK_UPDATED' && ' in a bulk edit'}</>;
  }
}

function Timestamp({ entry }: { entry: ActivityEntry }) {
  return <time className="whitespace-nowrap text-xs text-slate-500" dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>
    {formatRelativeTime(entry.createdAt)}
  </time>;
}

function ItemLink({ entry, itemLabels }: { entry: ActivityEntry; itemLabels?: ReadonlyMap<string, string> }) {
  if (!entry.itemId) return null;
  return <Link className="text-xs text-slate-500 hover:text-slate-900 hover:underline"
    to={`/projects/${encodeURIComponent(entry.projectId)}?item=${encodeURIComponent(entry.itemId)}&tab=history`}>
    {itemLabels?.get(entry.itemId) ?? 'View item history'}
  </Link>;
}

export function TimelineSkeleton() {
  return <div aria-busy="true" aria-label="Loading activity" className="grid gap-3">
    {[0, 1, 2].map((row) => <div key={row} className="flex animate-pulse gap-2">
      <div className="h-6 w-6 rounded-full bg-slate-200" />
      <div className="h-4 flex-1 rounded bg-slate-100" />
    </div>)}
  </div>;
}

export function Timeline({ entries, users = [], linkItems = false, itemLabels }: {
  entries: ActivityEntry[];
  users?: MentionableUser[];
  linkItems?: boolean;
  itemLabels?: ReadonlyMap<string, string>;
}) {
  const id = useId();
  const directory = new Map(users.map((user) => [user.id, user]));
  if (!entries.length) return <p className="py-6 text-center text-sm text-slate-500">No activity yet</p>;
  return <ol aria-label="Activity timeline" className="grid gap-3 text-sm">
    {groupEntries(entries).map((group) => {
      const entry = group[0];
      const style = actionStyles[entry.action];
      return <li key={entry.id} className="flex min-w-0 gap-2">
        <span aria-hidden="true" className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs', style.color)}>{style.icon}</span>
        <div className="min-w-0 flex-1 break-words">
          {group.length > 1 ? <details>
            <summary className="cursor-pointer" aria-controls={`${id}-${entry.id}`}>
              <strong className="font-medium">{entry.user?.name ?? directory.get(entry.userId)?.name ?? 'Unknown user'}</strong> made {group.length} changes{' · '}
              <Timestamp entry={entry} />
            </summary>
            <ol id={`${id}-${entry.id}`} className="mt-2 grid gap-2 border-l border-slate-200 pl-3">
              {group.map((change) => <li key={change.id}><Sentence entry={change} users={directory} />{' · '}<Timestamp entry={change} /></li>)}
            </ol>
          </details> : <div><Sentence entry={entry} users={directory} />{' · '}<Timestamp entry={entry} /></div>}
          {linkItems && <ItemLink entry={entry} itemLabels={itemLabels} />}
        </div>
      </li>;
    })}
  </ol>;
}
