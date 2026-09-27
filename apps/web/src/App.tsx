import { useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster, toast } from 'react-hot-toast';

import { api } from './lib/api';
import type { ApiError } from './lib/api';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { MyItemsPage } from './pages/MyItemsPage';
import { ImportExportPage } from './pages/ImportExportPage';
import type { Project, User } from './types';

function ProtectedLayout() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => (await api<{ user: User }>('/auth/me')).user,
    retry: false,
  });

  const projects = useQuery({
    queryKey: ['projects-nav'],
    queryFn: () => api<{ projects: Project[]; users: User[] }>('/projects'),
    enabled: session.isSuccess,
  });

  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success('Signed out');
      navigate('/login');
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  const currentProjectId = useMemo(() => {
    const match = location.pathname.match(/\/projects\/([^/]+)/);
    return match?.[1] ?? '';
  }, [location.pathname]);

  if (session.isLoading) return <div className="p-8 text-slate-600">Loading…</div>;
  if (session.isError) return <Navigate to="/login" replace state={{ from: location }} />;
  const currentUser = session.data as User;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Toaster position="top-right" />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Project Tracker</h1>
            <p className="text-sm text-slate-500">Simple attention-first project tracking</p>
          </div>
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  navigate(currentProjectId ? `/projects/${currentProjectId}?search=${encodeURIComponent(search)}` : `/projects?search=${encodeURIComponent(search)}`);
                }
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm lg:max-w-sm"
              placeholder="Search items and press Enter"
            />
            <select
              aria-label="Project switcher"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={currentProjectId}
              onChange={(event) => event.target.value && navigate(`/projects/${event.target.value}`)}
            >
              <option value="">Project switcher</option>
              {projects.data?.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.code} · {project.name}</option>
              ))}
            </select>
            <div className="text-sm text-slate-600">{currentUser.name} · {currentUser.role}</div>
            <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => logout.mutate()}>
              Logout
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-3 px-4 pb-4 text-sm">
          {[
            ['/', 'Dashboard'],
            ['/projects', 'Projects'],
            ['/my-items', 'My Items'],
            ['/import-export', 'Import / Export'],
          ].map(([to, label]) => (
            <NavLink key={to} to={to} end className={({ isActive }) => `rounded-full px-3 py-1.5 ${isActive ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl p-4">
        <Routes>
          <Route path="/" element={<DashboardPage user={currentUser} />} />
          <Route path="/projects" element={<ProjectsPage user={currentUser} />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage user={currentUser} />} />
          <Route path="/my-items" element={<MyItemsPage user={currentUser} />} />
          <Route path="/import-export" element={<ImportExportPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
}
