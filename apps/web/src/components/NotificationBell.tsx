import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api } from '../lib/api';
import { findItem } from '../lib/findItem';
import type { Notification, NotificationsPage, NotificationType } from '../lib/notification-types';
import { formatRelativeTime } from '../lib/utils';
import { Dropdown } from './Dropdown';

const icons: Record<NotificationType, string> = {
  COMMENT: '↳', MENTIONED: '@', ASSIGNED: '→', STATUS_CHANGED: '↻', DUE_SOON: '◷', OVERDUE: '!', BLOCKED: '⊘',
};
const tabs: Record<NotificationType, string> = {
  COMMENT: 'comments', MENTIONED: 'comments', ASSIGNED: 'history', STATUS_CHANGED: 'history',
  DUE_SOON: 'details', OVERDUE: 'details', BLOCKED: 'details',
};

export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const countKey = ['notifications', userId, 'unread-count'];
  const count = useQuery({
    queryKey: countKey,
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    enabled: visible,
    staleTime: 60_000,
    refetchInterval: visible ? 60_000 : false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const { refetch: refetchCount } = count;
  useEffect(() => {
    const onVisibilityChange = () => {
      const nextVisible = !document.hidden;
      setVisible(nextVisible);
      if (nextVisible) void refetchCount();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [refetchCount]);

  const notifications = useQuery({
    queryKey: ['notifications', userId, 'list', unreadOnly, page],
    queryFn: () => api<NotificationsPage>(`/notifications?page=${page}&pageSize=25&unreadOnly=${unreadOnly}`),
    enabled: open,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  async function invalidateNotifications() {
    await Promise.all(queryClient.getQueriesData({ queryKey: ['notifications', userId] })
      .map(([queryKey]) => queryClient.invalidateQueries({ queryKey, exact: true })));
  }

  const markAll = useMutation({
    mutationFn: () => api<{ updatedCount: number }>('/notifications/read-all', { method: 'POST', body: '{}' }),
    onSuccess: async () => {
      setError('');
      setPage(1);
      await invalidateNotifications();
    },
    onError: () => setError('Could not mark notifications as read. Please try again.'),
  });
  const select = useMutation({
    mutationFn: async (notification: Notification) => {
      await api<{ success: true }>(`/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'POST', body: '{}' });
      try {
        if (!notification.item) return null;
        const linkedItem = notification.item;
        const { item } = await queryClient.fetchQuery({
          queryKey: ['item', linkedItem.id],
          queryFn: () => findItem(linkedItem.id, { key: linkedItem.key }),
        });
        return `/projects/${encodeURIComponent(item.projectId)}?item=${encodeURIComponent(notification.item.id)}&tab=${tabs[notification.type]}`;
      } finally {
        await invalidateNotifications();
      }
    },
    onSuccess: (destination) => {
      setError('');
      setOpen(false);
      if (destination) navigate(destination);
    },
    onError: () => setError('Could not open this notification. The item may be unavailable; please try again.'),
  });
  const busy = select.isPending || markAll.isPending;
  const unreadCount = count.data?.count ?? 0;

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      label="Notifications"
      trigger={(
        <>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {unreadCount > 0 && <span aria-label={`${unreadCount} unread notifications`} className="absolute -right-2 -top-2 rounded-full bg-slate-800 px-1.5 text-xs text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          {count.isError && <span className="sr-only">Unread count unavailable</span>}
        </>
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="font-semibold">Notifications</h2>
        <button type="button" disabled={busy} onClick={() => markAll.mutate()} className="text-xs text-slate-600 hover:underline disabled:opacity-50">Mark all read</button>
      </div>
      <div className="flex gap-1 border-b border-slate-200 p-2">
        {[true, false].map((filter) => (
          <button
            key={String(filter)}
            type="button"
            aria-pressed={unreadOnly === filter}
            className={`rounded px-3 py-1 text-xs ${unreadOnly === filter ? 'bg-slate-200 text-slate-900' : 'text-slate-500'}`}
            onClick={() => { setUnreadOnly(filter); setPage(1); setError(''); }}
          >{filter ? 'Unread' : 'All'}</button>
        ))}
      </div>
      {count.isError && <div role="alert" className="px-3 py-2 text-xs text-rose-700">Unread count unavailable. <button type="button" onClick={() => void count.refetch()} className="underline">Retry count</button></div>}
      {error && <p role="alert" className="px-3 py-2 text-xs text-rose-700">{error}</p>}
      <div className="max-h-80 overflow-y-auto">
        {notifications.isPending && <p role="status" className="p-4 text-slate-500">Loading notifications…</p>}
        {notifications.isError ? (
          <div role="alert" className="p-4 text-slate-600">Could not load notifications. <button type="button" onClick={() => void notifications.refetch()} className="underline">Retry</button></div>
        ) : notifications.data?.notifications.length === 0 ? (
          <p className="p-4 text-slate-500">{unreadOnly ? "You're all caught up" : 'No notifications yet'}</p>
        ) : notifications.data?.notifications.map((notification) => (
          <button
            key={notification.id}
            type="button"
            disabled={busy}
            onClick={() => { setError(''); select.mutate(notification); }}
            className={`flex w-full gap-3 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50 ${notification.readAt ? '' : 'bg-slate-50'}`}
          >
            <span aria-hidden="true" className="mt-1 w-4 shrink-0 text-center text-slate-500">{icons[notification.type]}</span>
            <span className="min-w-0 flex-1">
              <span className={`block ${notification.readAt ? '' : 'font-semibold'}`}>{notification.title}</span>
              {notification.body && <span className="line-clamp-2 break-words text-xs text-slate-600">{notification.body}</span>}
              {notification.item && <span className="block truncate text-xs text-slate-500">{notification.item.key} · {notification.item.title}</span>}
              <time dateTime={notification.createdAt} title={new Date(notification.createdAt).toLocaleString()} className="block text-xs text-slate-400">{formatRelativeTime(notification.createdAt)}</time>
              {!notification.readAt && <span className="sr-only">Unread</span>}
            </span>
          </button>
        ))}
      </div>
      {notifications.data && notifications.data.total > notifications.data.pageSize && (
        <div className="flex items-center justify-between p-2 text-xs">
          <button type="button" disabled={page === 1 || notifications.isFetching} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {Math.ceil(notifications.data.total / notifications.data.pageSize)}</span>
          <button type="button" disabled={page * notifications.data.pageSize >= notifications.data.total || notifications.isFetching} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </Dropdown>
  );
}
