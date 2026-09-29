import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { Item, ItemPriority, ItemRisk, ItemStatus, ItemType, Project, User } from '../types';
import { toDateInput } from '../lib/utils';

const schema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(2),
  description: z.string(),
  type: z.enum(['TASK', 'BUG', 'RISK', 'ENHANCEMENT']),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE']),
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
  currentUserId: string;
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

export function ItemFormModal({ item, projects, users, defaultProjectId, currentUserId, onClose, onSubmit }: Props) {
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

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{item ? `Edit ${item.key}` : 'Create item'}</h3>
          <button onClick={onClose} className="text-sm text-slate-500">Close</button>
        </div>
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
          <label className="grid gap-1 text-sm">
            <span>Project</span>
            <select className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('projectId')}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
            </select>
          </label>
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
              <select className="rounded-lg border border-slate-300 px-3 py-2" {...form.register(field)}>
                {(field === 'type' ? ['TASK', 'BUG', 'RISK', 'ENHANCEMENT'] : field === 'status' ? ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'] : field === 'priority' ? ['P0', 'P1', 'P2', 'P3'] : ['LOW', 'MEDIUM', 'HIGH']).map((option) => (
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
            <span>Due date</span>
            <input type="date" className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('dueDate')} />
          </label>
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
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
