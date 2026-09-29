import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

import { api } from '../lib/api';
import type { ApiError } from '../lib/api';
import type { Role, User } from '../types';

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'DEVELOPER'];

export function AdminUsersPage({ currentUser }: { currentUser: User }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [createForm, setCreateForm] = useState({ name: '', email: '', role: 'DEVELOPER' as Role, password: '' });
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (roleFilter) params.set('role', roleFilter);
    if (activeFilter) params.set('isActive', activeFilter);
    params.set('pageSize', '100');
    return params.toString();
  }, [activeFilter, roleFilter, search]);

  const usersQuery = useQuery({
    queryKey: ['admin-users', queryString],
    queryFn: () => api<{ users: User[] }>(`/users?${queryString}`),
    enabled: currentUser.role === 'ADMIN',
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
    await queryClient.invalidateQueries({ queryKey: ['projects-nav'] });
  };

  const createUser = useMutation({
    mutationFn: () => api<{ temporaryPassword: string | null }>('/users', {
      method: 'POST',
      body: JSON.stringify({
        name: createForm.name,
        email: createForm.email,
        role: createForm.role,
        ...(createForm.password ? { password: createForm.password } : { generateTemporaryPassword: true }),
      }),
    }),
    onSuccess: async (response) => {
      setTempPassword(response.temporaryPassword);
      setCreateForm({ name: '', email: '', role: 'DEVELOPER', password: '' });
      await refresh();
      toast.success('User created');
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await refresh();
      toast.success('User updated');
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  const deactivateUser = useMutation({
    mutationFn: (id: string) => api<{ assignedItemsCount: number }>(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: async (response) => {
      await refresh();
      toast.success(`User deactivated. Assigned items remaining: ${response.assignedItemsCount}`);
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => api<{ temporaryPassword: string | null }>(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ generateTemporaryPassword: true }) }),
    onSuccess: (response) => {
      setTempPassword(response.temporaryPassword);
      toast.success('Password reset');
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  if (currentUser.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }

  const users = usersQuery.data?.users ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-2xl font-semibold">Admin · Users</h2>
        <p className="text-sm text-slate-500">Manage users, roles, status, and password resets.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">All roles</option>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
            <option value="">All users</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                {['Name', 'Email', 'Role', 'Status', 'Assigned/Open', 'Created', 'Actions'].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium">{user.name}</td>
                  <td className="px-3 py-2">{user.email}</td>
                  <td className="px-3 py-2">
                    <select
                      value={user.role}
                      className="rounded border border-slate-300 px-2 py-1"
                      onChange={(event) => updateUser.mutate({ id: user.id, body: { role: event.target.value } })}
                    >
                      {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">{user.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="px-3 py-2">{user.assignedItemsCount ?? 0} / {user.openAssignedItemsCount ?? 0}</td>
                  <td className="px-3 py-2">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => resetPassword.mutate(user.id)}>Reset password</button>
                      {user.isActive ? (
                        <button
                          className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700"
                          onClick={() => {
                            if (window.confirm(`Deactivate ${user.name}?`)) deactivateUser.mutate(user.id);
                          }}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700" onClick={() => updateUser.mutate({ id: user.id, body: { isActive: true } })}>Activate</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-lg font-semibold">Create user</h3>
        <div className="grid gap-2 md:grid-cols-5">
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Name" value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} />
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Email" value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} />
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={createForm.role} onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value as Role }))}>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Initial password (optional)" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} />
          <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => createUser.mutate()}>
            Create
          </button>
        </div>
        {tempPassword && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            Temporary password (shown once): <span className="font-mono">{tempPassword}</span>
            <button className="ml-2 rounded border border-slate-300 px-2 py-1 text-xs" onClick={async () => {
              await navigator.clipboard.writeText(tempPassword);
              toast.success('Copied temporary password');
            }}>
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
