import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { toast } from 'react-hot-toast';

import { api } from '../lib/api';
import type { ApiError } from '../lib/api';
import type { Project, User } from '../types';

const targets = ['projectCode', 'title', 'description', 'type', 'status', 'priority', 'risk', 'assigneeEmail', 'reporterEmail', 'dueDate', 'estimateHours', 'spentHours', 'tags'];

export function ImportExportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: Project[]; users: User[] }>('/projects') });
  const [exportFilters, setExportFilters] = useState({ projectId: '', status: '', search: '' });
  const exportQuery = new URLSearchParams(
    Object.entries(exportFilters).filter(([, value]) => value),
  ).toString();

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) return null;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mapping', JSON.stringify(mapping));
      return api<{ createdCount: number; errors: { row: number; errors: string[] }[] }>('/items/import', { method: 'POST', body: formData });
    },
    onSuccess: async (data) => {
      if (!data) return;
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Imported ${data.createdCount} rows`);
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr,1fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-2xl font-semibold">CSV import</h2>
        <p className="mt-2 text-sm text-slate-500">Preview columns, adjust mapping, then commit the import.</p>
        <input
          type="file"
          accept=".csv"
          className="mt-4 block text-sm"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            setFile(nextFile);
            if (!nextFile) return;
            Papa.parse<Record<string, string>>(nextFile, {
              header: true,
              skipEmptyLines: true,
              complete: (result) => {
                setPreview(result.data.slice(0, 5));
                const nextHeaders = result.meta.fields ?? [];
                setHeaders(nextHeaders);
                setMapping(Object.fromEntries(nextHeaders.map((header) => [header, header])));
              },
            });
          }}
        />
        {headers.length > 0 && (
          <div className="mt-6 grid gap-3">
            <h3 className="font-semibold">Column mapping</h3>
            {headers.map((header) => (
              <label key={header} className="grid gap-1 text-sm md:grid-cols-[1fr,1fr] md:items-center">
                <span className="font-medium text-slate-600">{header}</span>
                <select className="rounded-lg border border-slate-300 px-3 py-2" value={mapping[header] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value }))}>
                  {targets.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            ))}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr>{headers.map((header) => <th key={header} className="px-3 py-2 text-left">{header}</th>)}</tr></thead>
                <tbody>{preview.map((row, index) => <tr key={index} className="border-t border-slate-200">{headers.map((header) => <td key={header} className="px-3 py-2">{row[header]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <button onClick={() => importMutation.mutate()} className="justify-self-start rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">Import file</button>
            {importMutation.data?.errors?.length ? (
              <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
                <div className="font-semibold">Validation errors</div>
                <ul className="mt-2 list-disc pl-5">
                  {importMutation.data.errors.map((error) => <li key={error.row}>Row {error.row}: {error.errors.join(', ')}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
      <section className="grid gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-2xl font-semibold">CSV export</h2>
          <p className="mt-2 text-sm text-slate-500">Download the current backlog as a CSV.</p>
          <div className="mt-4 grid gap-3">
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={exportFilters.projectId} onChange={(event) => setExportFilters((current) => ({ ...current, projectId: event.target.value }))}>
              <option value="">All projects</option>
              {projects.data?.projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
            </select>
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={exportFilters.status} onChange={(event) => setExportFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">All statuses</option>
              {['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={exportFilters.search} onChange={(event) => setExportFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search text" />
            <a className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm text-white" href={`${import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api'}/items/export${exportQuery ? `?${exportQuery}` : ''}`} target="_blank" rel="noreferrer">Export items</a>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-2xl font-semibold">Available projects</h2>
          <div className="mt-3 grid gap-3 text-sm">
            {projects.data?.projects.map((project) => <div key={project.id} className="rounded-xl bg-slate-50 p-3">{project.code} · {project.name}</div>)}
          </div>
        </div>
      </section>
    </div>
  );
}
