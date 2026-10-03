import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentsTab } from './CommentsTab';
import type { CommentsTabProps } from './CommentsTab';
import { api } from '../lib/api';
import type { CommentsPage, ItemComment, MentionableUser } from '../types';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const apiMock = vi.mocked(api);

const directory: MentionableUser[] = [
  { id: 'u1', name: 'Sara Manager', role: 'MANAGER', isActive: true },
  { id: 'u2', name: 'Priya Patel', role: 'DEVELOPER', isActive: true },
  { id: 'u3', name: 'Dev Other', role: 'DEVELOPER', isActive: true },
];

function comment(overrides: Partial<ItemComment> & Pick<ItemComment, 'id' | 'authorId' | 'body'>): ItemComment {
  const author = directory.find((user) => user.id === overrides.authorId) ?? { id: overrides.authorId, name: 'Unknown' };
  return {
    itemId: 'item-1',
    createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    editedAt: null,
    author: { id: author.id, name: author.name },
    ...overrides,
  };
}

let pages: CommentsPage[];
let postHandler: (body: string) => Promise<unknown>;

type ApiFn = typeof api;

function installApi() {
  apiMock.mockImplementation((async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (path.startsWith('/users')) return { users: directory };
    if (method === 'GET' && path.startsWith('/items/item-1/comments')) {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return pages[page - 1];
    }
    if (method === 'POST') return postHandler((JSON.parse(String(init?.body)) as { body: string }).body);
    if (method === 'PATCH') {
      const id = path.split('/').pop() ?? '';
      const existing = pages.flatMap((page) => page.comments).find((entry) => entry.id === id);
      const updated = { ...existing, body: (JSON.parse(String(init?.body)) as { body: string }).body, editedAt: new Date().toISOString() };
      pages = pages.map((page) => ({ ...page, comments: page.comments.map((entry) => (entry.id === id ? (updated as ItemComment) : entry)) }));
      return { comment: updated };
    }
    if (method === 'DELETE') {
      const id = path.split('/').pop() ?? '';
      pages = pages.map((page) => ({ ...page, total: page.total - 1, comments: page.comments.filter((entry) => entry.id !== id) }));
      return undefined;
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  }) as ApiFn);
}

function renderTab(currentUser: CommentsTabProps['currentUser'], props: Partial<CommentsTabProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CommentsTab itemId="item-1" currentUser={currentUser} users={[]} preferredUserIds={new Set()} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

const sara = { id: 'u1', name: 'Sara Manager', role: 'MANAGER' as const };
const priya = { id: 'u2', name: 'Priya Patel', role: 'DEVELOPER' as const };
const devOther = { id: 'u3', name: 'Dev Other', role: 'DEVELOPER' as const };
const admin = { id: 'u9', name: 'Ada Admin', role: 'ADMIN' as const };

beforeEach(() => {
  pages = [
    {
      comments: [
        comment({ id: 'c1', authorId: 'u2', body: 'First from **Priya** cc @sara-manager' }),
        comment({ id: 'c2', authorId: 'u3', body: 'Second from Dev', editedAt: new Date().toISOString() }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    },
  ];
  postHandler = async (body) => {
    const created = comment({ id: 'c-new', authorId: 'u2', body, createdAt: new Date().toISOString() });
    pages = pages.map((page, index) => ({ ...page, total: page.total + 1, comments: index === 0 ? [...page.comments, created] : page.comments }));
    return { comment: created };
  };
  installApi();
});

async function rows() {
  return screen.findAllByTestId('comment');
}

describe('CommentsTab rendering', () => {
  it('shows a loading skeleton, then the thread oldest to newest with metadata', async () => {
    renderTab(priya);
    expect(screen.getByLabelText('Loading comments')).toBeInTheDocument();
    const [first, second] = await rows();
    expect(first).toHaveTextContent('Priya Patel');
    expect(first).toHaveTextContent('PP');
    expect(first).toHaveTextContent('3h ago');
    expect(first.querySelector('time')).toHaveAttribute('title');
    expect(first.querySelector('strong')).toHaveTextContent('Priya');
    expect(first.querySelector('.mention-chip')).toHaveTextContent('@sara-manager');
    expect(first).not.toHaveTextContent('(edited)');
    expect(second).toHaveTextContent('(edited)');
  });

  it('shows a friendly empty state', async () => {
    pages = [{ comments: [], total: 0, page: 1, pageSize: 25 }];
    renderTab(priya);
    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
  });

  it('renders an XSS payload inert in the live DOM', async () => {
    pages = [{
      comments: [comment({ id: 'x', authorId: 'u3', body: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>[x](javascript:alert(1))' })],
      total: 1,
      page: 1,
      pageSize: 25,
    }];
    const { container } = renderTab(priya);
    const [row] = await rows();
    expect(container.querySelector('script, img')).toBeNull();
    const handlerAttributes = Array.from(row.querySelectorAll('*')).flatMap((element) =>
      element.getAttributeNames().filter((name) => name.startsWith('on')),
    );
    expect(handlerAttributes).toEqual([]);
    for (const link of Array.from(row.querySelectorAll('a'))) expect(link.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
    expect(row).toHaveTextContent('<img src=x onerror="window.__pwned=1">');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('paginates with Load more when the backend has more pages', async () => {
    const user = userEvent.setup();
    pages = [
      { comments: [comment({ id: 'p1', authorId: 'u2', body: 'page one' })], total: 2, page: 1, pageSize: 1 },
      { comments: [comment({ id: 'p2', authorId: 'u3', body: 'page two' })], total: 2, page: 2, pageSize: 1 },
    ];
    const onCountChange = vi.fn();
    renderTab(priya, { onCountChange });
    await screen.findByText('page one');
    expect(onCountChange).toHaveBeenLastCalledWith(2);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('page two')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

describe('CommentsTab permissions', () => {
  const buttonsIn = (row: HTMLElement) => within(row).queryAllByRole('button').map((button) => button.textContent);

  it('lets the author edit and delete only their own comment', async () => {
    renderTab(priya);
    const [own, other] = await rows();
    expect(buttonsIn(own)).toEqual(['Edit', 'Delete']);
    expect(buttonsIn(other)).toEqual([]);
  });

  it('gives a non-author developer no edit or delete controls', async () => {
    renderTab({ ...devOther, id: 'u-nobody' });
    for (const row of await rows()) expect(buttonsIn(row)).toEqual([]);
  });

  it('lets a manager or admin delete any comment but not edit others', async () => {
    renderTab(sara);
    for (const row of await rows()) expect(buttonsIn(row)).toEqual(['Delete']);
  });

  it('lets an admin delete any comment', async () => {
    renderTab(admin);
    for (const row of await rows()) expect(buttonsIn(row)).toEqual(['Delete']);
  });

  it('edits inline with Save, updating only the comments query', async () => {
    const user = userEvent.setup();
    const { invalidateSpy } = renderTab(priya);
    const [own] = await rows();
    await user.click(within(own).getByRole('button', { name: 'Edit' }));
    const editor = within(own).getByRole('textbox', { name: 'Edit comment' });
    await user.clear(editor);
    await user.type(editor, 'Updated body');
    await user.click(within(own).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByTestId('comment')[0]).toHaveTextContent('Updated body'));
    expect(apiMock).toHaveBeenCalledWith('/comments/c1', { method: 'PATCH', body: JSON.stringify({ body: 'Updated body' }) });
    expect(screen.getAllByTestId('comment')[0]).toHaveTextContent('(edited)');
    for (const [filters] of invalidateSpy.mock.calls) expect(filters).toEqual({ queryKey: ['comments', 'item-1'], exact: true });
  });

  it('cancels inline edit without saving', async () => {
    const user = userEvent.setup();
    renderTab(priya);
    const [own] = await rows();
    await user.click(within(own).getByRole('button', { name: 'Edit' }));
    await user.click(within(own).getByRole('button', { name: 'Cancel' }));
    expect(within(own).queryByRole('textbox')).toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith(expect.stringMatching(/^\/comments\//), expect.objectContaining({ method: 'PATCH' }));
  });

  it('deletes after confirmation', async () => {
    const user = userEvent.setup();
    renderTab(sara);
    const [, second] = await rows();
    await user.click(within(second).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete comment?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getAllByTestId('comment')).toHaveLength(1));
    expect(apiMock).toHaveBeenCalledWith('/comments/c2', { method: 'DELETE' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('closes the confirmation and shows an error toast when delete fails', async () => {
    const user = userEvent.setup();
    const succeed = apiMock.getMockImplementation();
    apiMock.mockImplementation(((path: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.reject(new Error('Forbidden')) : succeed?.(path, init)) as ApiFn);
    renderTab(sara);
    const [first] = await rows();
    await user.click(within(first).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toast.error).toHaveBeenCalledWith('Forbidden');
    expect(screen.getAllByTestId('comment')).toHaveLength(2);
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderTab(sara);
    const [first] = await rows();
    await user.click(within(first).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByTestId('comment')).toHaveLength(2);
    expect(apiMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('CommentsTab posting', () => {
  it('rejects empty or whitespace-only bodies', async () => {
    const user = userEvent.setup();
    renderTab(priya);
    await rows();
    const composer = screen.getByRole('textbox', { name: 'Add a comment' });
    await user.type(composer, '   ');
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(apiMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
  });

  it('optimistically appends, trims, and refreshes only the comments query on success', async () => {
    const user = userEvent.setup();
    const { invalidateSpy } = renderTab(priya);
    await rows();
    await user.type(screen.getByRole('textbox', { name: 'Add a comment' }), '  hello @sara-manager  ');
    await user.keyboard('{Escape}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(screen.getAllByTestId('comment')).toHaveLength(3));
    expect(apiMock).toHaveBeenCalledWith('/items/item-1/comments', { method: 'POST', body: JSON.stringify({ body: 'hello @sara-manager' }) });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
    expect(screen.getAllByTestId('comment')).toHaveLength(3);
    expect(screen.getAllByTestId('comment')[2]).toHaveTextContent('just now');
    for (const [filters] of invalidateSpy.mock.calls) expect(filters).toEqual({ queryKey: ['comments', 'item-1'], exact: true });
  });

  it('rolls back the optimistic comment and shows an error toast when the API fails', async () => {
    const user = userEvent.setup();
    let reject: (error: Error) => void = () => undefined;
    postHandler = () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
    renderTab(priya);
    await rows();
    const composer = screen.getByRole('textbox', { name: 'Add a comment' });
    await user.type(composer, 'Will fail');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    const optimistic = (await screen.findAllByTestId('comment'))[2];
    expect(optimistic).toHaveTextContent('Will fail');
    expect(optimistic).toHaveTextContent('Sending…');
    expect(composer).toBeDisabled();
    expect(composer).toHaveValue('');

    // Hold any refetch so only the client-side rollback can remove the optimistic comment.
    const settledApi = apiMock.getMockImplementation();
    apiMock.mockImplementation(((path: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' && path.includes('/comments') ? new Promise(() => undefined) : settledApi?.(path, init)) as ApiFn);
    reject(new Error('Server exploded'));

    await waitFor(() => expect(screen.getAllByTestId('comment')).toHaveLength(2));
    expect(screen.queryByText('Will fail', { selector: '.comment-body *' })).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Server exploded');
    expect(composer).toBeEnabled();
    expect(composer).toHaveValue('Will fail');
  });
});
