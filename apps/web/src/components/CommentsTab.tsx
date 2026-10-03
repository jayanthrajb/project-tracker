import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

import { ConfirmDialog } from './ConfirmDialog';
import { MentionTextarea } from './MentionTextarea';
import { api } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { buildMentionLookup } from '../lib/mentions';
import { formatRelativeTime, initials } from '../lib/utils';
import type { CommentsPage, ItemComment, MentionableUser, Role } from '../types';

const PAGE_SIZE = 25;
let optimisticSeq = 0;

type CommentsData = InfiniteData<CommentsPage, number>;

export const commentsQueryKey = (itemId: string) => ['comments', itemId] as const;

export interface CommentsTabProps {
  itemId: string;
  currentUser: { id: string; name: string; role: Role };
  users: MentionableUser[];
  preferredUserIds: ReadonlySet<string>;
  onCountChange?: (count: number) => void;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function updatePages(data: CommentsData | undefined, map: (comments: ItemComment[]) => ItemComment[], totalDelta = 0) {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, total: page.total + totalDelta, comments: map(page.comments) })) };
}

function appendComment(data: CommentsData | undefined, comment: ItemComment) {
  if (!data) return data;
  const last = data.pages.length - 1;
  return {
    ...data,
    pages: data.pages.map((page, index) => ({
      ...page,
      total: page.total + 1,
      comments: index === last ? [...page.comments, comment] : page.comments,
    })),
  };
}

function CommentBody({ body, lookup }: { body: string; lookup: ReadonlyMap<string, MentionableUser> }) {
  const html = useMemo(() => renderMarkdown(body, lookup), [body, lookup]);
  // `html` is produced by renderMarkdown, which escapes raw HTML and sanitizes with DOMPurify.
  return <div className="comment-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function CommentsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading comments" className="grid gap-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex animate-pulse gap-3">
          <div className="h-8 w-8 rounded-full bg-slate-200" />
          <div className="grid flex-1 gap-2">
            <div className="h-3 w-40 rounded bg-slate-200" />
            <div className="h-3 w-full rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface CommentRowProps {
  comment: ItemComment;
  canEdit: boolean;
  canDelete: boolean;
  lookup: ReadonlyMap<string, MentionableUser>;
  users: MentionableUser[];
  preferredUserIds: ReadonlySet<string>;
  saving: boolean;
  onSave: (body: string) => Promise<unknown>;
  onDelete: () => void;
}

function CommentRow({ comment, canEdit, canDelete, lookup, users, preferredUserIds, saving, onSave, onDelete }: CommentRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const save = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    if (body === comment.body) {
      setEditing(false);
      return;
    }
    try {
      await onSave(body);
      setEditing(false);
    } catch {
      // Error toast is raised by the mutation; keep the editor open.
    }
  };

  return (
    <li className="flex gap-3" data-testid="comment">
      <div
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700"
      >
        {initials(comment.author.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
          <span className="text-sm font-medium text-slate-900">{comment.author.name}</span>
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
            {formatRelativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && (
            <span title={`Edited ${new Date(comment.editedAt).toLocaleString()}`}>(edited)</span>
          )}
          {comment.pending && <span>Sending…</span>}
          {!comment.pending && !editing && (canEdit || canDelete) && (
            <span className="ml-auto flex gap-2">
              {canEdit && (
                <button type="button" className="hover:text-slate-900" onClick={() => { setDraft(comment.body); setEditing(true); }}>
                  Edit
                </button>
              )}
              {canDelete && (
                <button type="button" className="hover:text-rose-700" onClick={onDelete}>
                  Delete
                </button>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1 grid gap-2">
            <MentionTextarea
              value={draft}
              onChange={setDraft}
              users={users}
              preferredIds={preferredUserIds}
              onSubmit={() => void save()}
              onEscape={() => setEditing(false)}
              disabled={saving}
              ariaLabel="Edit comment"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-slate-300 px-3 py-1 text-xs" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-60"
                disabled={saving || !draft.trim()}
                onClick={() => void save()}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5">
            <CommentBody body={comment.body} lookup={lookup} />
          </div>
        )}
      </div>
    </li>
  );
}

export function CommentsTab({ itemId, currentUser, users, preferredUserIds, onCountChange }: CommentsTabProps) {
  const queryClient = useQueryClient();
  const queryKey = commentsQueryKey(itemId);
  const [body, setBody] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ItemComment | null>(null);

  const comments = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api<CommentsPage>(`/items/${encodeURIComponent(itemId)}/comments?page=${pageParam}&pageSize=${PAGE_SIZE}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined),
  });

  const directory = useQuery({
    queryKey: ['users', 'mentionable'],
    queryFn: () => api<{ users: MentionableUser[] }>('/users?isActive=true&pageSize=100'),
    staleTime: 5 * 60_000,
  });

  const mentionUsers = useMemo(() => {
    const byId = new Map<string, MentionableUser>();
    for (const user of directory.data?.users ?? []) byId.set(user.id, user);
    for (const user of users) byId.set(user.id, { ...byId.get(user.id), ...user });
    return [...byId.values()].filter((user) => user.isActive !== false);
  }, [directory.data, users]);
  const lookup = useMemo(() => buildMentionLookup(mentionUsers), [mentionUsers]);

  const list = useMemo(() => comments.data?.pages.flatMap((page) => page.comments) ?? [], [comments.data]);
  const total = comments.data?.pages[0]?.total;

  useEffect(() => {
    if (total !== undefined) onCountChange?.(total);
  }, [total, onCountChange]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey, exact: true });

  const postComment = useMutation({
    mutationFn: (text: string) =>
      api<{ comment: ItemComment }>(`/items/${encodeURIComponent(itemId)}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) }),
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<CommentsData>(queryKey);
      const now = new Date().toISOString();
      const optimistic: ItemComment = {
        id: `pending-${Date.now()}-${(optimisticSeq += 1)}`,
        itemId,
        authorId: currentUser.id,
        body: text,
        createdAt: now,
        updatedAt: now,
        editedAt: null,
        author: { id: currentUser.id, name: currentUser.name },
        pending: true,
      };
      queryClient.setQueryData<CommentsData>(queryKey, (data) => appendComment(data, optimistic));
      setBody('');
      return { previous, text };
    },
    onError: (error, _text, context) => {
      if (context) {
        queryClient.setQueryData<CommentsData>(queryKey, context.previous);
        setBody((current) => current || context.text);
      }
      toast.error(errorMessage(error, 'Could not post comment'));
    },
    onSettled: () => {
      void invalidate();
    },
  });

  const editComment = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api<{ comment: ItemComment }>(`/comments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ body: text }) }),
    onSuccess: ({ comment }) => {
      queryClient.setQueryData<CommentsData>(queryKey, (data) =>
        updatePages(data, (current) => current.map((entry) => (entry.id === comment.id ? comment : entry))),
      );
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not update comment')),
    onSettled: () => {
      void invalidate();
    },
  });

  const deleteComment = useMutation({
    mutationFn: (id: string) => api<void>(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<CommentsData>(queryKey, (data) =>
        updatePages(data, (current) => current.filter((entry) => entry.id !== id), -1),
      );
      toast.success('Comment deleted');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete comment')),
    onSettled: () => {
      setPendingDelete(null);
      void invalidate();
    },
  });

  const submit = () => {
    const text = body.trim();
    if (!text || postComment.isPending) return;
    postComment.mutate(text);
  };

  const canModerate = currentUser.role === 'ADMIN' || currentUser.role === 'MANAGER';

  return (
    <div className="grid gap-4">
      {comments.isPending ? (
        <CommentsSkeleton />
      ) : comments.isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          Couldn&apos;t load comments.{' '}
          <button type="button" className="underline" onClick={() => void comments.refetch()}>Retry</button>
        </div>
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No comments yet</p>
      ) : (
        <ol className="grid gap-4" aria-label="Comments">
          {list.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              canEdit={comment.authorId === currentUser.id}
              canDelete={comment.authorId === currentUser.id || canModerate}
              lookup={lookup}
              users={mentionUsers}
              preferredUserIds={preferredUserIds}
              saving={editComment.isPending && editComment.variables?.id === comment.id}
              onSave={(text) => editComment.mutateAsync({ id: comment.id, text })}
              onDelete={() => setPendingDelete(comment)}
            />
          ))}
        </ol>
      )}

      {comments.hasNextPage && (
        <button
          type="button"
          className="justify-self-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-60"
          disabled={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          {comments.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}

      <form
        className="grid gap-2 border-t border-slate-200 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <MentionTextarea
          value={body}
          onChange={setBody}
          users={mentionUsers}
          preferredIds={preferredUserIds}
          onSubmit={submit}
          disabled={postComment.isPending}
          placeholder="Write a comment… Use @ to mention someone. Markdown supported."
          ariaLabel="Add a comment"
        />
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Ctrl/⌘ + Enter to send</span>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            disabled={postComment.isPending || !body.trim()}
          >
            {postComment.isPending ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </form>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete comment?"
          message="This comment will be permanently removed."
          confirmLabel="Delete"
          tone="danger"
          busy={deleteComment.isPending}
          onConfirm={() => deleteComment.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
