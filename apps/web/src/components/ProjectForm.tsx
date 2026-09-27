import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { Project, User } from '../types';

const schema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(8),
  description: z.string().min(1),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']),
  ownerId: z.string().min(1),
  memberIds: z.array(z.string()),
});

type FormValues = z.infer<typeof schema>;

export function ProjectForm({
  users,
  project,
  onSubmit,
  onCancel,
}: {
  users: User[];
  project?: Project;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project?.name ?? '',
      code: project?.code ?? '',
      description: project?.description ?? '',
      status: project?.status ?? 'ACTIVE',
      ownerId: project?.ownerId ?? users[0]?.id ?? '',
      memberIds: project?.members.map((member) => member.user.id) ?? [],
    },
  });

  const selected = form.watch('memberIds');

  return (
    <form className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span>Name</span>
          <input className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('name')} />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Code</span>
          <input className="rounded-lg border border-slate-300 px-3 py-2 uppercase" {...form.register('code')} />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span>Description</span>
          <textarea className="min-h-24 rounded-lg border border-slate-300 px-3 py-2" {...form.register('description')} />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Status</span>
          <select className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('status')}>
            {['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'].map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Owner</span>
          <select className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('ownerId')}>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-2 text-sm">
        <span>Members</span>
        <div className="grid gap-2 md:grid-cols-2">
          {users.map((user) => (
            <label key={user.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <input
                type="checkbox"
                checked={selected.includes(user.id)}
                onChange={(event) => {
                  const next = event.target.checked ? [...selected, user.id] : selected.filter((value) => value !== user.id);
                  form.setValue('memberIds', next);
                }}
              />
              <span>{user.name} · {user.role}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">Save project</button>
      </div>
    </form>
  );
}
