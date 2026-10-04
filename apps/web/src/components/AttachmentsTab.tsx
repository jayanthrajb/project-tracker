import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_FILE_SIZE, allowedMimeTypes } from 'virtual:attachment-constraints';

import { ConfirmDialog } from './ConfirmDialog';
import { ApiError, api, attachmentBlob, uploadAttachment } from '../lib/api';
import { formatRelativeTime } from '../lib/utils';
import type { Item, User } from '../types';

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploaderId: string;
  uploader?: { id: string; name: string };
}

interface Props {
  item: Pick<Item, 'id' | 'assigneeId' | 'reporterId'>;
  currentUser: Pick<User, 'id' | 'role'>;
  onCountChange?: (count: number) => void;
}

interface Upload {
  id: number;
  file: File;
  status: 'queued' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
  valid: boolean;
}

function message(error: unknown, operation: string) {
  if (error instanceof ApiError && error.status === 503) {
    return 'Storage is temporarily unavailable, try again';
  }
  return error instanceof Error ? error.message : `Could not ${operation}`;
}

function fileSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const kind = mimeType.startsWith('image/') ? 'Image'
    : mimeType === 'application/pdf' ? 'PDF'
    : mimeType.includes('spreadsheet') || mimeType.includes('excel') ? 'Spreadsheet'
    : mimeType.includes('presentation') || mimeType.includes('powerpoint') ? 'Presentation'
    : mimeType.includes('csv') ? 'CSV'
    : mimeType.includes('word') || mimeType.includes('rtf') ? 'Document'
    : mimeType.startsWith('text/') ? 'Text' : 'File';
  const icon = kind === 'Image' ? '🖼' : kind === 'Spreadsheet' || kind === 'CSV' ? '📊' : kind === 'Presentation' ? '📽' : kind === 'PDF' ? '📑' : '📄';
  return <span role="img" aria-label={`${kind} file`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-xl">{icon}</span>;
}

function AttachmentsSkeleton() {
  return <div role="status" aria-label="Loading attachments" aria-busy="true" className="grid gap-3">
    <span className="sr-only">Loading attachments…</span>
    {[0, 1, 2].map((row) => <div key={row} className="flex animate-pulse gap-3 rounded-lg border border-slate-200 p-3">
      <div className="h-10 w-10 rounded bg-slate-200" />
      <div className="grid flex-1 gap-2"><div className="h-3 w-40 rounded bg-slate-200" /><div className="h-3 w-2/3 rounded bg-slate-100" /></div>
    </div>)}
  </div>;
}

function Thumbnail({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string>();
  const [previewError, setPreviewError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setPreviewError(undefined);
    void attachmentBlob(attachment.id).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((failure) => {
      if (!cancelled) setPreviewError(message(failure, 'load preview'));
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, attempt]);
  return previewError ? <div className="max-w-48 text-xs text-rose-700"><p role="alert">{previewError}</p><button type="button" aria-label={`Retry preview of ${attachment.filename}`} className="underline" onClick={() => setAttempt((value) => value + 1)}>Retry preview</button></div> : url ? <img src={url} alt={`Preview of ${attachment.filename}`} className="h-14 w-14 rounded object-cover" /> : <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded bg-slate-100 text-xs">Image</span>;
}

export function AttachmentsTab({ item, currentUser, onCountChange }: Props) {
  const client = useQueryClient();
  const queryKey = ['attachments', item.id] as const;
  const [listError, setListError] = useState<string | null>(null);
  const attachments = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const data = await api<{ attachments: Attachment[] }>(`/items/${encodeURIComponent(item.id)}/attachments`);
        setListError(null);
        return data;
      } catch (failure) {
        setListError(failure instanceof ApiError && (failure.status === 404 || failure.status === 405)
          ? 'Attachment list endpoint is unavailable. The server must support GET /items/:id/attachments to list uploaded files.'
          : message(failure, 'load attachments'));
        throw failure;
      }
    },
  });
  const [uploads, setUploads] = useState<Upload[]>([]);
  const queue = useRef<Upload[]>([]);
  const lifecycle = useRef({ active: true, running: false, controller: new AbortController() });
  const sequence = useRef(0);
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const canModerate = currentUser.role === 'ADMIN' || currentUser.role === 'MANAGER';
  const canUpload = canModerate || item.assigneeId === currentUser.id || item.reporterId === currentUser.id;
  const count = attachments.data?.attachments.length;
  useEffect(() => { if (count !== undefined) onCountChange?.(count); }, [count, onCountChange]);
  useEffect(() => {
    const session = { active: true, running: false, controller: new AbortController() };
    lifecycle.current = session;
    queue.current = [];
    setUploads([]);
    return () => {
      session.active = false;
      queue.current = [];
      session.controller.abort();
    };
  }, [item.id]);

  const invalidate = () => {
    void client.invalidateQueries({ queryKey, exact: true });
    void client.invalidateQueries({ queryKey: ['activity', 'items', item.id] });
  };
  const updateUpload = (id: number, changes: Partial<Upload>) => setUploads((entries) => entries.map((entry) => entry.id === id ? { ...entry, ...changes } : entry));
  const drain = async () => {
    const session = lifecycle.current;
    if (session.running || !session.active) return;
    session.running = true;
    try {
      let entry: Upload | undefined;
      while (session.active && (entry = queue.current.shift())) {
        const active = entry;
        updateUpload(active.id, { status: 'uploading', progress: 0, error: undefined });
        try {
          const { attachment } = await uploadAttachment<{ attachment: Attachment }>(item.id, active.file, (progress) => { if (session.active) updateUpload(active.id, { progress }); }, session.controller.signal);
          if (!session.active) return;
          client.setQueryData<{ attachments: Attachment[] }>(queryKey, (data) => ({
            attachments: [...(data?.attachments ?? []).filter((existing) => existing.id !== attachment.id), attachment],
          }));
          updateUpload(active.id, { status: 'done', progress: 100 });
          invalidate();
        } catch (failure) {
          if (session.active) updateUpload(active.id, { status: 'error', error: message(failure, 'upload file') });
        }
      }
    } finally { session.running = false; }
  };
  const addFiles = (files: FileList | File[]) => {
    if (!canUpload) return;
    const entries = Array.from(files).map((file): Upload => {
      const validation = file.size > MAX_FILE_SIZE ? `File exceeds ${fileSize(MAX_FILE_SIZE)} limit` : !allowedMimeTypes.has(file.type.toLowerCase()) ? 'File type is not allowed' : undefined;
      return { id: ++sequence.current, file, status: validation ? 'error' : 'queued', progress: 0, valid: !validation, error: validation };
    });
    setUploads((current) => [...current, ...entries]);
    queue.current.push(...entries.filter((entry) => entry.valid));
    void drain();
  };
  const deletion = useMutation({
    mutationFn: (id: string) => api<void>(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_result, id) => {
      client.setQueryData<{ attachments: Attachment[] }>(queryKey, (data) => data && ({ attachments: data.attachments.filter((entry) => entry.id !== id) }));
      setPendingDelete(null);
      setError(null);
      invalidate();
    },
    onError: (failure) => { setError(message(failure, 'delete file')); setPendingDelete(null); },
  });
  const download = async (attachment: Attachment) => {
    setDownloading(attachment.id);
    setError(null);
    try {
      const blob = await attachmentBlob(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) { setError(message(failure, 'download file')); }
    finally { setDownloading(null); }
  };

  return (
    <div
      role="region"
      aria-label="Attachment panel"
      className="grid gap-4"
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = canUpload ? 'copy' : 'none'; }}
      onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
    >
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {listError || attachments.isError ? (
        <div role="alert">{listError ?? 'Could not load attachments.'} <button type="button" onClick={() => void attachments.refetch()}>Retry</button></div>
      ) : attachments.isPending ? <AttachmentsSkeleton />
      : attachments.data.attachments.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No attachments yet</p> : (
        <ul aria-label="Attachments" className="grid gap-3">
          {attachments.data.attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <FileIcon mimeType={attachment.mimeType} />
              {attachment.mimeType.startsWith('image/') && <Thumbnail attachment={attachment} />}
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{attachment.filename}</p>
                <p className="text-xs text-slate-500">{fileSize(attachment.sizeBytes)} · {attachment.uploader?.name ?? 'Unknown uploader'} · <time dateTime={attachment.createdAt} title={new Date(attachment.createdAt).toLocaleString()}>{formatRelativeTime(attachment.createdAt)}</time></p>
              </div>
              <button type="button" disabled={downloading !== null} onClick={() => void download(attachment)} aria-label={`Download ${attachment.filename}`} className="text-sm underline">{downloading === attachment.id ? 'Downloading…' : 'Download'}</button>
              {(canModerate || attachment.uploaderId === currentUser.id) && <button type="button" disabled={deletion.isPending} onClick={() => setPendingDelete(attachment)} aria-label={`Delete ${attachment.filename}`} className="text-sm text-rose-700">Delete</button>}
            </li>
          ))}
        </ul>
      )}
      {canUpload ? (
        <div
          role="group"
          aria-label="Drop files to attach"
          className="rounded-lg border-2 border-dashed border-slate-300 p-4 text-sm"
        >
          <label className="grid gap-2">Choose files or drop them here
            <input aria-label="Choose attachments" type="file" multiple accept={[...allowedMimeTypes].join(',')} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} />
          </label>
          <p className="mt-2 text-xs text-slate-500">Maximum {fileSize(MAX_FILE_SIZE)} per file. Images, PDF, text, CSV and Office documents.</p>
        </div>
      ) : <p className="text-sm text-slate-500">Only the assignee, reporter, a manager or an admin can upload files.</p>}
      {uploads.length > 0 && <ul aria-label="Upload progress" className="grid gap-2">{uploads.map((entry) => (
        <li key={entry.id} className="text-sm">
          <span>{entry.file.name}: {entry.status === 'done' ? 'Uploaded' : entry.status === 'queued' ? 'Queued' : entry.status === 'uploading' ? entry.progress === 100 ? 'Processing…' : `${entry.progress}%` : 'Failed'}</span>
          {entry.status === 'uploading' && <progress aria-label={`Uploading ${entry.file.name}`} value={entry.progress} max={100} />}
          {entry.error && <p role="alert" className="text-rose-700">{entry.error}</p>}
          {entry.status === 'error' && entry.valid && <button type="button" className="ml-2 underline" aria-label={`Retry ${entry.file.name}`} onClick={() => { updateUpload(entry.id, { status: 'queued', error: undefined }); queue.current.push(entry); void drain(); }}>Retry</button>}
        </li>
      ))}</ul>}
      {pendingDelete && <ConfirmDialog title="Delete attachment?" message={`Permanently remove ${pendingDelete.filename}?`} confirmLabel="Delete" tone="danger" busy={deletion.isPending} onConfirm={() => deletion.mutate(pendingDelete.id)} onCancel={() => setPendingDelete(null)} />}
    </div>
  );
}
