import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_SIZE } from 'virtual:attachment-constraints';

import { AttachmentsTab } from './AttachmentsTab';
import type { Attachment } from './AttachmentsTab';
import { ApiError, api, attachmentBlob } from '../lib/api';
import type * as ApiModule from '../lib/api';

vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof ApiModule>(),
  api: vi.fn(),
  attachmentBlob: vi.fn(),
}));

class UploadTransport {
  static instances: UploadTransport[] = [];
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  withCredentials = false;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  constructor() { UploadTransport.instances.push(this); }
  finish(status: number, data: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(data);
    this.onload?.();
  }
}

const uploader = { id: 'u1', role: 'DEVELOPER' as const };
const item = { id: 'i1', assigneeId: 'u1', reporterId: 'u2' };
const attachment: Attachment = {
  id: 'a1', filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 2048,
  createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(), uploaderId: 'u1', uploader: { id: 'u1', name: 'Dev One' },
};
let list: Attachment[];
function setup(currentUser: Parameters<typeof AttachmentsTab>[0]['currentUser'] = uploader) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const count = vi.fn();
  const view = render(<QueryClientProvider client={client}><AttachmentsTab item={item} currentUser={currentUser} onCountChange={count} /></QueryClientProvider>);
  return { ...view, client, invalidate, count };
}
const pdf = (name = 'new.pdf') => new File(['content'], name, { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks();
  list = [attachment];
  UploadTransport.instances = [];
  vi.stubGlobal('XMLHttpRequest', UploadTransport);
  document.cookie = 'project_tracker_csrf=csrf%20token; path=/';
  vi.mocked(api).mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/items/i1/attachments') return { attachments: list };
    if (init?.method === 'DELETE') { list = list.filter((entry) => `/attachments/${entry.id}` !== path); return undefined; }
    throw new Error(`Unexpected request ${path}`);
  }) as typeof api);
  vi.mocked(attachmentBlob).mockResolvedValue(new Blob(['file'], { type: 'application/pdf' }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = 'project_tracker_csrf=; Max-Age=0; path=/'; });

describe('AttachmentsTab', () => {
  it('lists metadata and reports the cached attachment count', async () => {
    const { count } = setup();
    expect(screen.getByLabelText('Loading attachments')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Attachments' })).toHaveTextContent('2.0 KB · Dev One');
    expect(screen.getByRole('img', { name: 'PDF file' })).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toHaveAttribute('title', new Date(attachment.createdAt).toLocaleString());
    await waitFor(() => expect(count).toHaveBeenCalledWith(1));
  });

  it('rejects oversized and unsupported files before creating any upload transport', async () => {
    setup();
    const large = pdf('large.pdf');
    Object.defineProperty(large, 'size', { value: MAX_FILE_SIZE + 1 });
    fireEvent.change(screen.getByLabelText('Choose attachments'), { target: { files: [large, new File(['x'], 'bad.exe', { type: 'application/octet-stream' })] } });
    expect(await screen.findByText(/File exceeds/)).toBeInTheDocument();
    expect(screen.getByText('File type is not allowed')).toBeInTheDocument();
    expect(UploadTransport.instances).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
  });

  it('accepts the server size limit exactly', () => {
    setup();
    const file = pdf();
    Object.defineProperty(file, 'size', { value: MAX_FILE_SIZE });
    fireEvent.change(screen.getByLabelText('Choose attachments'), { target: { files: [file] } });
    expect(UploadTransport.instances).toHaveLength(1);
  });

  it('uploads dropped files sequentially with real progress, CSRF, credentials and scoped invalidation', async () => {
    const { client, invalidate, count } = setup();
    client.setQueryData(['activity', 'items', 'i1', 25], { activity: [] });
    client.setQueryData(['activity', 'items', 'other', 25], { activity: [] });
    client.setQueryData(['activity', 'projects', 'p1', 25], { activity: [] });
    await screen.findByText('report.pdf');
    fireEvent.dragOver(screen.getByRole('region', { name: 'Attachment panel' }), { dataTransfer: { dropEffect: 'none' } });
    fireEvent.drop(screen.getByRole('region', { name: 'Attachment panel' }), { dataTransfer: { files: [pdf('one.pdf'), pdf('two.pdf')] } });
    expect(UploadTransport.instances).toHaveLength(1);
    const first = UploadTransport.instances[0];
    expect(first.open).toHaveBeenCalledWith('POST', expect.stringContaining('/items/i1/attachments'));
    expect(first.withCredentials).toBe(true);
    expect(first.setRequestHeader).toHaveBeenCalledWith('x-csrf-token', 'csrf token');
    expect(first.setRequestHeader).not.toHaveBeenCalledWith('Content-Type', expect.anything());
    expect((first.send.mock.calls[0][0] as FormData).get('file')).toBeInstanceOf(File);
    first.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Uploading one.pdf' })).toHaveAttribute('value', '50'));
    list = [...list, { ...attachment, id: 'a2', filename: 'one.pdf' }];
    first.finish(201, { attachment: list[1] });
    await waitFor(() => expect(UploadTransport.instances).toHaveLength(2));
    expect(await screen.findByText('one.pdf')).toBeInTheDocument();
    list = [...list, { ...attachment, id: 'a3', filename: 'two.pdf' }];
    UploadTransport.instances[1].finish(201, { attachment: list[2] });
    expect(await screen.findByText('two.pdf')).toBeInTheDocument();
    await waitFor(() => expect(count).toHaveBeenLastCalledWith(3));
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      ['attachments', 'i1'], ['activity', 'items', 'i1'], ['attachments', 'i1'], ['activity', 'items', 'i1'],
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['activity', 'items', 'i1'] });
    expect(client.getQueryState(['activity', 'items', 'i1', 25])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['activity', 'items', 'other', 25])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['activity', 'projects', 'p1', 25])?.isInvalidated).toBe(false);
  });

  it('shows a distinct storage outage and retries only the failed file', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Choose attachments'), { target: { files: [pdf()] } });
    UploadTransport.instances[0].finish(503, { error: { message: 'Storage offline' } });
    expect(await screen.findByText('Storage is temporarily unavailable, try again')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry new.pdf' }));
    expect(UploadTransport.instances).toHaveLength(2);
    list = [...list, { ...attachment, id: 'a2', filename: 'new.pdf' }];
    UploadTransport.instances[1].finish(201, { attachment: list[1] });
    expect(await screen.findByText('new.pdf')).toBeInTheDocument();
  });

  it('continues the queue after a failure and does not mistake a normal rejection for a storage outage', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Choose attachments'), { target: { files: [pdf('rejected.pdf'), pdf('next.pdf')] } });
    UploadTransport.instances[0].finish(403, { error: { message: 'You cannot attach files to this item' } });
    expect(await screen.findByText('You cannot attach files to this item')).toBeInTheDocument();
    expect(screen.queryByText('Storage is temporarily unavailable, try again')).not.toBeInTheDocument();
    expect(UploadTransport.instances).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Retry rejected.pdf' })).toBeInTheDocument();
  });

  it.each([
    { id: 'other', role: 'DEVELOPER' as const, deleteAllowed: false, uploadAllowed: false },
    { id: 'u1', role: 'DEVELOPER' as const, deleteAllowed: true, uploadAllowed: true },
    { id: 'u2', role: 'DEVELOPER' as const, deleteAllowed: false, uploadAllowed: true },
    { id: 'other', role: 'MANAGER' as const, deleteAllowed: true, uploadAllowed: true },
    { id: 'other', role: 'ADMIN' as const, deleteAllowed: true, uploadAllowed: true },
  ])('matches uploader/moderator delete and assignee/reporter edit permissions: $id $role', async (user) => {
    setup(user);
    await screen.findByText('report.pdf');
    expect(Boolean(screen.queryByRole('button', { name: 'Delete report.pdf' }))).toBe(user.deleteAllowed);
    expect(Boolean(screen.queryByLabelText('Choose attachments'))).toBe(user.uploadAllowed);
    if (!user.uploadAllowed) {
      fireEvent.drop(screen.getByRole('region', { name: 'Attachment panel' }), { dataTransfer: { files: [pdf()] } });
      expect(UploadTransport.instances).toHaveLength(0);
    }
  });

  it('confirms before deleting and updates the list and count only after success', async () => {
    const { count } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete report.pdf' }));
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete attachment?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete report.pdf' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No attachments yet')).toBeInTheDocument();
    await waitFor(() => expect(count).toHaveBeenLastCalledWith(0));
    expect(api).toHaveBeenCalledWith('/attachments/a1', { method: 'DELETE' });
  });

  it('keeps the list when storage is unavailable during delete', async () => {
    setup();
    await screen.findByText('report.pdf');
    vi.mocked(api).mockRejectedValueOnce(new ApiError('Offline', 503));
    await userEvent.click(screen.getByRole('button', { name: 'Delete report.pdf' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Storage is temporarily unavailable, try again')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('reports storage outages during authenticated download', async () => {
    setup();
    vi.mocked(attachmentBlob).mockRejectedValueOnce(new ApiError('Offline', 503));
    await userEvent.click(await screen.findByRole('button', { name: 'Download report.pdf' }));
    expect(attachmentBlob).toHaveBeenCalledWith('a1');
    expect(await screen.findByText('Storage is temporarily unavailable, try again')).toBeInTheDocument();
  });

  it('downloads the authenticated blob with its original filename and releases the URL', async () => {
    const create = vi.fn(() => 'blob:download');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('report.pdf');
      expect(this.href).toBe('blob:download');
      expect(document.body).toContainElement(this);
    });
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Download report.pdf' }));
    expect(click).toHaveBeenCalledOnce();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:download'));
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('uses the real authenticated download endpoint (without /download) and exposes its 503 status', async () => {
    const actual = await vi.importActual<typeof ApiModule>('../lib/api');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['content']) });
    vi.stubGlobal('fetch', fetchMock);
    await actual.attachmentBlob('a/1');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/attachments\/a%2F1$/), {
      credentials: 'include', headers: { 'x-csrf-token': 'csrf token' }, redirect: 'error',
    });
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: 'Storage offline' } }) });
    await expect(actual.attachmentBlob('a1')).rejects.toMatchObject({ status: 503, message: 'Storage offline' });
  });

  it('refuses direct storage redirects and explains the API proxy requirement', async () => {
    const actual = await vi.importActual<typeof ApiModule>('../lib/api');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(actual.attachmentBlob('a1')).rejects.toThrow(/Direct storage redirects are not allowed/);
  });

  it('preserves an unavailable list endpoint error after a successful upload populates cache', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Not found', 404));
    const { client, count } = setup();
    expect(await screen.findByText(/Attachment list endpoint is unavailable/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose attachments'), { target: { files: [pdf()] } });
    UploadTransport.instances[0].finish(201, { attachment: { ...attachment, id: 'new', filename: 'new.pdf' } });
    await waitFor(() => expect(count).toHaveBeenLastCalledWith(1));
    expect(client.getQueryData(['attachments', 'i1'])).toMatchObject({ attachments: [{ filename: 'new.pdf' }] });
    expect(screen.getByText(/Attachment list endpoint is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument();
    expect(screen.queryByText('No attachments yet')).not.toBeInTheDocument();
    vi.mocked(api).mockResolvedValue({ attachments: [{ ...attachment, id: 'new', filename: 'new.pdf' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('new.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/Attachment list endpoint is unavailable/)).not.toBeInTheDocument();
  });

  it('loads image thumbnails through the authenticated API and revokes object URLs on unmount', async () => {
    list = [{ ...attachment, mimeType: 'image/png', filename: 'picture.png' }];
    const create = vi.fn(() => 'blob:preview');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(<QueryClientProvider client={client}><AttachmentsTab item={item} currentUser={uploader} /></QueryClientProvider>);
    expect(await screen.findByRole('img', { name: 'Preview of picture.png' })).toHaveAttribute('src', 'blob:preview');
    expect(attachmentBlob).toHaveBeenCalledWith('a1');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:preview');
  });

  it('surfaces thumbnail storage outages and supports retry through the API proxy', async () => {
    list = [{ ...attachment, mimeType: 'image/png', filename: 'picture.png' }];
    vi.mocked(attachmentBlob).mockRejectedValueOnce(new ApiError('Offline', 503));
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn(); });
    setup();
    expect(await screen.findByText('Storage is temporarily unavailable, try again')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry preview of picture.png' }));
    expect(await screen.findByRole('img', { name: 'Preview of picture.png' })).toHaveAttribute('src', 'blob:preview');
    expect(attachmentBlob).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Storage is temporarily unavailable, try again')).not.toBeInTheDocument();
  });

  it('aborts the active upload and clears queued files when the panel closes', async () => {
    const { unmount } = setup();
    fireEvent.change(screen.getByLabelText('Choose attachments'), { target: { files: [pdf('one.pdf'), pdf('two.pdf')] } });
    const active = UploadTransport.instances[0];
    unmount();
    expect(active.abort).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(UploadTransport.instances).toHaveLength(1);
  });

  it('does not upload queued files to a newly navigated item', async () => {
    const { rerender, client } = setup();
    fireEvent.change(screen.getByLabelText('Choose attachments'), { target: { files: [pdf('old.pdf'), pdf('queued.pdf')] } });
    const old = UploadTransport.instances[0];
    vi.mocked(api).mockResolvedValue({ attachments: [] });
    rerender(<QueryClientProvider client={client}><AttachmentsTab item={{ ...item, id: 'i2' }} currentUser={uploader} /></QueryClientProvider>);
    expect(old.abort).toHaveBeenCalledOnce();
    await screen.findByText('No attachments yet');
    expect(UploadTransport.instances).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Choose attachments'), { target: { files: [pdf('new-item.pdf')] } });
    expect(UploadTransport.instances).toHaveLength(2);
    expect(UploadTransport.instances[1].open).toHaveBeenCalledWith('POST', expect.stringContaining('/items/i2/attachments'));
    expect(screen.queryByText(/queued.pdf/)).not.toBeInTheDocument();
  });
});
