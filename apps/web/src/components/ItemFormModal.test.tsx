import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemFormModal } from './ItemFormModal';
import { ApiError, api, uploadAttachment } from '../lib/api';
import type * as ApiModule from '../lib/api';
import type { Item, Project, User } from '../types';
import { formatRelativeTime } from '../lib/utils';

vi.mock('../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof ApiModule>(), api: vi.fn(), uploadAttachment: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const apiMock = vi.mocked(api);

const manager: User = { id: 'u1', name: 'Sara Manager', email: 'sara@example.com', role: 'MANAGER' };
const project: Project = {
  id: 'p1', name: 'Apollo', code: 'APO', description: '', status: 'ACTIVE', ownerId: 'u1', owner: manager, members: [{ user: manager }],
};
const item: Item = {
  id: 'i1', projectId: 'p1', key: 'APO-1', type: 'TASK', title: 'Ship it', description: 'Desc', status: 'OPEN', priority: 'P2', risk: 'MEDIUM',
  assigneeId: null, reporterId: 'u1', dueDate: null, estimateHours: null, spentHours: 0, tags: ['a'], createdAt: '', updatedAt: '', closedAt: null, startedAt: null,
  score: 1, project: { id: 'p1', name: 'Apollo', code: 'APO' }, assignee: null, reporter: manager,
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderModal(initialEntry = '/projects/p1', overrides: Partial<Parameters<typeof ItemFormModal>[0]> = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <button type="button">outside</button>
        <ItemFormModal item={item} projects={[project]} users={[manager]} currentUser={manager} onClose={onClose} onSubmit={onSubmit} {...overrides} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose, onSubmit };
}

beforeEach(() => {
  apiMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/users')) return { users: [] };
    if (path.startsWith('/items/i1/comments')) return { comments: [], total: 4, page: 1, pageSize: 25 };
    if (path.startsWith('/items/i1/activity')) return { activity: [], total: 0, page: 1, pageSize: 25 };
    if (path === '/items/i1/attachments') return { attachments: [] };
    throw new Error(`Unexpected ${path}`);
  }) as typeof api);
});

describe('ItemFormModal tabs', () => {
  it('locks the parent project when editing and retains it in the submitted item', async () => {
    const { onSubmit } = renderModal();
    const select = screen.getByRole('combobox', { name: 'Parent project' });
    expect(select).toBeDisabled();
    expect(select).toHaveValue('p1');
    expect(select).toHaveAccessibleDescription('Existing items cannot be moved between projects.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' })));
  });

  it('allows choosing a parent project when creating an item', async () => {
    const other = { ...project, id: 'p2', code: 'BET', name: 'Beta' };
    renderModal('/projects/p1', { item: undefined, projects: [project, other] });
    const select = screen.getByRole('combobox', { name: 'Parent project' });
    expect(select).toBeEnabled();
    await userEvent.setup().selectOptions(select, 'p2');
    expect(select).toHaveValue('p2');
    expect(screen.queryByText('Existing items cannot be moved between projects.')).not.toBeInTheDocument();
  });

  it('offers BACKLOG before OPEN and shows null actual dates as explicit read-only states', () => {
    renderModal();
    const status = screen.getByLabelText('status');
    expect(Array.from((status as HTMLSelectElement).options).map((option) => option.value)).toEqual(['BACKLOG', 'OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE']);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByText('Not finished')).toBeInTheDocument();
    expect(screen.getByText(/Read-only, system-set/)).toBeInTheDocument();
    expect(screen.getByLabelText('Due date (target)')).toHaveAttribute('type', 'date');
    expect(document.querySelector('[name="startedAt"], [name="closedAt"]')).toBeNull();
  });

  it('renders relative actual dates with exact timestamps and never submits them', async () => {
    const startedAt = '2026-10-01T12:34:56.000Z';
    const closedAt = '2026-10-03T16:00:00.000Z';
    const { onSubmit } = renderModal('/projects/p1', { item: { ...item, status: 'BACKLOG', startedAt, closedAt } });
    for (const value of [startedAt, closedAt]) {
      expect(screen.getByTitle(value)).toHaveTextContent(formatRelativeTime(value));
      expect(screen.getByTitle(value).tagName).toBe('TIME');
    }
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ status: 'BACKLOG' });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('startedAt');
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('closedAt');
  });

  it('shows four tabs with Details selected and does not fetch comments up front', () => {
    renderModal();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Details', 'Comments', 'History', 'Attachments']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel');
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id);
    expect(screen.getByLabelText('Title')).toHaveValue('Ship it');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('lazy-loads comments on first activation, shows the count badge and syncs ?tab=', async () => {
    const user = userEvent.setup();
    renderModal('/projects/p1?search=foo');
    await user.click(screen.getByRole('tab', { name: /Comments/ }));
    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/items/i1/comments?page=1&pageSize=25');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Comments/ })).toHaveTextContent('Comments4'));
    expect(screen.getByTestId('location')).toHaveTextContent('?search=foo&tab=comments');
  });

  it('restores the active tab from a deep link', async () => {
    renderModal('/projects/p1?item=i1&tab=history');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/items/i1/activity?page=1&pageSize=25');
  });

  it('ignores unknown tab values', () => {
    renderModal('/projects/p1?tab=bogus');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  });

  it('supports roving arrow-key navigation between tabs', async () => {
    const user = userEvent.setup();
    renderModal();
    screen.getByRole('tab', { name: 'Details' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: /Attachments/ })).toHaveFocus();
    expect(screen.getByRole('tab', { name: /Attachments/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('No attachments yet')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /Attachments/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps unsaved Details edits when switching tabs and saves all fields in one submit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Renamed');
    await user.click(screen.getByRole('tab', { name: 'History' }));
    await user.click(screen.getByRole('tab', { name: /Details/ }));
    expect(screen.getByLabelText('Title')).toHaveValue('Renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: 'Renamed', projectId: 'p1', status: 'OPEN', tags: ['a'], assigneeId: null });
  });

  it('lazy-loads attachments, derives its badge from cached list data and preserves Details edits', async () => {
    const user = userEvent.setup();
    renderModal('/projects/p1?search=foo');
    expect(apiMock).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Title'), '!');
    await user.click(screen.getByRole('tab', { name: 'Attachments' }));
    expect(await screen.findByText('No attachments yet')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/items/i1/attachments');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Attachments/ })).toHaveTextContent('Attachments0'));
    expect(screen.getByTestId('location')).toHaveTextContent('?search=foo&tab=attachments');
    await user.click(screen.getByRole('tab', { name: /Details/ }));
    expect(screen.getByLabelText('Title')).toHaveValue('Ship it!');
    expect(screen.getByRole('tab', { name: /Attachments/ })).toHaveTextContent('Attachments0');
  });

  it('updates the attachment badge after upload and retains it when switching tabs', async () => {
    const user = userEvent.setup();
    const saved = { id: 'a1', filename: 'notes.pdf', mimeType: 'application/pdf', sizeBytes: 4, createdAt: '2026-01-01T12:00:00Z', uploaderId: 'u1' };
    let uploaded = false;
    apiMock.mockImplementation((async () => ({ attachments: uploaded ? [saved] : [] })) as typeof api);
    vi.mocked(uploadAttachment).mockImplementation(async () => { uploaded = true; return { attachment: saved }; });
    renderModal();
    await user.click(screen.getByRole('tab', { name: /Attachments/ }));
    await screen.findByText('No attachments yet');
    await user.upload(screen.getByLabelText('Choose attachments'), new File(['data'], 'notes.pdf', { type: 'application/pdf' }));
    await screen.findByText('notes.pdf');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Attachments/ })).toHaveTextContent('Attachments1'));
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByRole('tab', { name: /Attachments/ })).toHaveTextContent('Attachments1');
  });

  it('does not show a total badge for uploads when the server list never succeeded', async () => {
    const user = userEvent.setup();
    apiMock.mockRejectedValue(new ApiError('Not found', 404));
    vi.mocked(uploadAttachment).mockResolvedValue({ attachment: { id: 'a1', filename: 'notes.pdf', mimeType: 'application/pdf', sizeBytes: 4, createdAt: '2026-01-01T12:00:00Z', uploaderId: 'u1' } });
    renderModal('/projects/p1?tab=attachments');
    await screen.findByText(/Attachment list endpoint is unavailable/);
    await user.upload(screen.getByLabelText('Choose attachments'), new File(['data'], 'notes.pdf', { type: 'application/pdf' }));
    await screen.findByText('notes.pdf');
    expect(screen.getByRole('tab', { name: 'Attachments' })).toHaveTextContent(/^Attachments$/);
    expect(screen.getByText(/Showing known uploaded files only/)).toBeInTheDocument();
    expect(screen.getByText(/Attachment list endpoint is unavailable/)).toBeInTheDocument();
  });
});

describe('ItemFormModal behaviour', () => {
  it('traps focus inside the dialog', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let index = 0; index < 25; index += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('closes on Escape when there are no unsaved changes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('warns before discarding unsaved Details changes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.type(screen.getByLabelText('Title'), '!');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.keyboard('{Escape}');
    expect(confirm).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows only the Details form when creating an item', () => {
    renderModal('/projects/p1', { item: undefined });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Create item' })).toBeInTheDocument();
  });
});
