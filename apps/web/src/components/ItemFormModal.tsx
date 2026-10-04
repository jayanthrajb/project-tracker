import { Suspense, lazy, useId, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { ConfirmDialog } from './ConfirmDialog';
import { Tabs } from './Tabs';
import type { Item, ItemPriority, ItemRisk, ItemStatus, ItemType, Project, User } from '../types';
import { useFocusTrap } from '../lib/useFocusTrap';
import { cn, formatRelativeTime, toDateInput } from '../lib/utils';
import { filterOptions } from '../lib/itemViewFilters';
import { backlogColor } from '../lib/itemColors';

// Loaded on first activation of the Comments tab so the markdown/sanitizer libraries
// stay out of the initial bundle.
const CommentsTab = lazy(() => import('./CommentsTab').then((module) => ({ default: module.CommentsTab })));
const HistoryTab = lazy(() => import('./HistoryTab').then((module) => ({ default: module.HistoryTab })));
const AttachmentsTab = lazy(() => import('./AttachmentsTab').then((module) => ({ default: module.AttachmentsTab })));

export const ITEM_TABS = ['details', 'comments', 'history', 'attachments'] as const;
export type ItemTab = (typeof ITEM_TABS)[number];

function isItemTab(value: string | null): value is ItemTab {
  return value !== null && (ITEM_TABS as readonly string[]).includes(value);
}

const schema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(2),
  description: z.string(),
  type: z.enum(['TASK', 'BUG', 'RISK', 'ENHANCEMENT']),
  status: z.enum(filterOptions.status),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  assigneeId: z.string(),
  reporterId: z.string().min(1),
  dueDate: z.string(),
  estimateHours: z.number().nullable().optional(),
  spentHours: z.number(),
  tags: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  item?: Item;
  projects: Project[];
  users: User[];
  defaultProjectId?: string;
  currentUser: Pick<User, 'id' | 'name' | 'role'>;
  onClose: () => void;
  onSubmit: (values: {
    projectId: string;
    title: string;
    description: string;
    type: ItemType;
    status: ItemStatus;
    priority: ItemPriority;
    risk: ItemRisk;
    assigneeId: string | null;
    reporterId: string;
    dueDate: string | null;
    estimateHours: number | null;
    spentHours: number;
    tags: string[];
  }) => void;
}

export function ItemFormModal({ item, projects, users, defaultProjectId, currentUser, onClose, onSubmit }: Props) {
  const currentUserId = currentUser.id;
  const dialogRef = useRef<HTMLDivElement>(null);
  const projectHintId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useFocusTrap(dialogRef);

  const tabParam = searchParams.get('tab');
  const activeTab: ItemTab = item && isItemTab(tabParam) ? tabParam : 'details';
  const setActiveTab = (tab: ItemTab) => {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      if (tab === 'details') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  };

  const preferredUserIds = useMemo(() => {
    const project = projects.find((entry) => entry.id === item?.projectId);
    return new Set(project ? [project.ownerId, ...project.members.map((member) => member.user.id)] : []);
  }, [projects, item?.projectId]);

  const form = useForm<FormValues>({
    defaultValues: {
      projectId: item?.projectId ?? defaultProjectId ?? projects[0]?.id ?? '',
      title: item?.title ?? '',
      description: item?.description ?? '',
      type: item?.type ?? 'TASK',
      status: item?.status ?? 'OPEN',
      priority: item?.priority ?? 'P2',
      risk: item?.risk ?? 'MEDIUM',
      assigneeId: item?.assigneeId ?? '',
      reporterId: item?.reporterId ?? currentUserId,
      dueDate: toDateInput(item?.dueDate ?? null),
      estimateHours: item?.estimateHours ?? null,
      spentHours: item?.spentHours ?? 0,
      tags: item?.tags.join(', ') ?? '',
    },
  });

  const isDirty = form.formState.isDirty;
  const requestClose = () => {
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  };

  const detailsForm = (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => {
      const parsed = schema.parse({
        ...values,
        estimateHours: values.estimateHours !== undefined && Number.isNaN(values.estimateHours) ? null : values.estimateHours,
        spentHours: Number.isNaN(values.spentHours) ? 0 : values.spentHours,
      });

      onSubmit({
        ...parsed,
        assigneeId: parsed.assigneeId || null,
        dueDate: parsed.dueDate || null,
        estimateHours: parsed.estimateHours ?? null,
        tags: parsed.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean),
      });
    })}>
      <div className="grid gap-1 border-b border-slate-200 pb-3 text-sm md:col-span-2">
        <label className="grid gap-1">
          <span>Parent project</span>
          <select disabled={Boolean(item)} aria-describedby={item ? projectHintId : undefined} className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50 disabled:text-slate-500" {...form.register('projectId')}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
          </select>
        </label>
        {item && <p id={projectHintId} className="text-xs text-slate-500">Existing items cannot be moved between projects.</p>}
      </div>
      <label className="grid gap-1 text-sm">
        <span>Title</span>
        <input className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('title')} />
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        <span>Description</span>
        <textarea className="min-h-24 rounded-lg border border-slate-300 px-3 py-2" {...form.register('description')} />
      </label>
      {(['type', 'status', 'priority', 'risk'] as const).map((field) => (
        <label key={field} className="grid gap-1 text-sm">
          <span>{field}</span>
          <select className={cn('rounded-lg border border-slate-300 px-3 py-2', field === 'status' && form.watch('status') === 'BACKLOG' && backlogColor)} {...form.register(field)}>
            {(field === 'type' ? ['TASK', 'BUG', 'RISK', 'ENHANCEMENT'] : field === 'status' ? filterOptions.status : field === 'priority' ? ['P0', 'P1', 'P2', 'P3'] : ['LOW', 'MEDIUM', 'HIGH']).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      ))}
      <label className="grid gap-1 text-sm">
        <span>Assignee</span>
        <select className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('assigneeId')}>
          <option value="">Unassigned</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span>Reporter</span>
        <select className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('reporterId')}>
          {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span>Due date (target)</span>
        <input type="date" className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('dueDate')} />
      </label>
      {item && <dl className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm md:col-span-2 md:grid-cols-2">
        <div className="md:col-span-2 text-xs text-slate-500">Actual dates · Read-only, system-set by status transitions</div>
        <div><dt className="font-medium">Actual start</dt><dd>{item.startedAt ? <time dateTime={item.startedAt} title={item.startedAt}>{formatRelativeTime(item.startedAt)}</time> : 'Not started'}</dd></div>
        <div><dt className="font-medium">Actual finish</dt><dd>{item.closedAt ? <time dateTime={item.closedAt} title={item.closedAt}>{formatRelativeTime(item.closedAt)}</time> : 'Not finished'}</dd></div>
      </dl>}
      <label className="grid gap-1 text-sm">
        <span>Estimate hours</span>
        <input type="number" className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('estimateHours', { valueAsNumber: true })} />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Spent hours</span>
        <input type="number" className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('spentHours', { valueAsNumber: true })} />
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        <span>Tags (comma separated)</span>
        <input className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('tags')} />
      </label>
      <div className="md:col-span-2 flex justify-end gap-3">
        <button type="button" onClick={requestClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">Save</button>
      </div>
    </form>
  );

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-modal-title"
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !confirmDiscard) {
            event.preventDefault();
            requestClose();
          }
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="item-modal-title" className="text-lg font-semibold">{item ? `Edit ${item.key}` : 'Create item'}</h3>
          <button type="button" onClick={requestClose} className="text-sm text-slate-500">Close</button>
        </div>
        {item ? (
          <Tabs
            idPrefix={`item-${item.id}`}
            ariaLabel="Item sections"
            activeId={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'details', label: (
                  <>
                    Details
                    {isDirty && (
                      <>
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        <span className="sr-only">(unsaved changes)</span>
                      </>
                    )}
                  </>
                ), content: detailsForm },
              {
                id: 'comments',
                label: (
                  <>
                    Comments
                    {commentCount !== null && (
                      <span className="rounded-full bg-slate-200 px-1.5 text-[11px] font-medium text-slate-700">{commentCount}</span>
                    )}
                  </>
                ),
                content: (
                  <Suspense fallback={<div className="py-6 text-center text-sm text-slate-400">Loading comments…</div>}>
                    <CommentsTab
                      itemId={item.id}
                      projectId={item.projectId}
                      currentUser={currentUser}
                      users={users}
                      preferredUserIds={preferredUserIds}
                      onCountChange={setCommentCount}
                    />
                  </Suspense>
                ),
              },
              { id: 'history', label: 'History', content: <Suspense fallback={<div className="py-6 text-sm text-slate-500">Loading history…</div>}>{item && <HistoryTab itemId={item.id} users={users} />}</Suspense> },
              {
                id: 'attachments',
                label: <>Attachments{attachmentCount !== null && <span className="rounded-full bg-slate-200 px-1.5 text-[11px] font-medium text-slate-700">{attachmentCount}</span>}</>,
                content: <Suspense fallback={<div className="py-6 text-sm text-slate-500">Loading attachments…</div>}><AttachmentsTab key={item.id} item={item} currentUser={currentUser} onCountChange={setAttachmentCount} /></Suspense>,
              },
            ]}
          />
        ) : (
          detailsForm
        )}
      </div>
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="You have unsaved changes in Details. Close without saving?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          tone="danger"
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}
