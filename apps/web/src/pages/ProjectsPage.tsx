import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import { api } from '../lib/api';
import type { ApiError } from '../lib/api';
import { ProjectForm } from '../components/ProjectForm';
import type { Project, User } from '../types';

export function ProjectsPage({ user }: { user: User }) {
  const [editing, setEditing] = useState<Project | undefined>();
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const search = (searchParams.get('search') ?? '').toLowerCase();

  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: Project[]; users: User[] }>('/projects') });

  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => editing
      ? api(`/projects/${editing.id}`, { method: 'PATCH', body: JSON.stringify(values) })
      : api('/projects', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['projects-nav'] });
      toast.success(editing ? 'Project updated' : 'Project created');
      setShowForm(false);
      setEditing(undefined);
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  const filtered = useMemo(() => (projects.data?.projects ?? []).filter((project) =>
    !search || project.name.toLowerCase().includes(search) || project.code.toLowerCase().includes(search) || project.description.toLowerCase().includes(search)
  ), [projects.data, search]);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Projects</h2>
          <p className="text-sm text-slate-500">Manage project metadata and team membership.</p>
        </div>
        {user.role !== 'DEVELOPER' && <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white" onClick={() => { setEditing(undefined); setShowForm(true); }}>New project</button>}
      </div>
      {showForm && projects.data && <ProjectForm users={projects.data.users} project={editing} onCancel={() => { setShowForm(false); setEditing(undefined); }} onSubmit={(values) => mutation.mutate(values)} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((project) => (
          <div key={project.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">{project.code}</div>
                <h3 className="text-lg font-semibold">{project.name}</h3>
                <p className="mt-2 text-sm text-slate-600">{project.description}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{project.status}</span>
            </div>
            <div className="mt-4 text-sm text-slate-500">Owner: {project.owner.name}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {project.members.map((member) => <span key={member.user.id} className="rounded-full bg-slate-100 px-2 py-1 text-xs">{member.user.name}</span>)}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Link className="text-sm font-medium text-slate-900 underline" to={`/projects/${project.id}`}>Open project</Link>
              {user.role !== 'DEVELOPER' && <button className="text-sm text-slate-600" onClick={() => { setEditing(project); setShowForm(true); }}>Edit</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
