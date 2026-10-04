import { useInfiniteQuery } from '@tanstack/react-query';

import { Timeline, TimelineSkeleton } from './Timeline';
import { api } from '../lib/api';
import { useUserDirectory } from '../lib/useUserDirectory';
import type { ActivityPage, MentionableUser } from '../types';

export function ActivityFeed({ scope, id, users = [], compact = false, itemLabels }: {
  scope: 'items' | 'projects';
  id: string;
  users?: MentionableUser[];
  compact?: boolean;
  itemLabels?: ReadonlyMap<string, string>;
}) {
  const pageSize = compact ? 10 : 25;
  const activity = useInfiniteQuery({
    queryKey: ['activity', scope, id, pageSize],
    queryFn: ({ pageParam }) => api<ActivityPage>(`/${scope}/${encodeURIComponent(id)}/activity?page=${pageParam}&pageSize=${pageSize}`),
    initialPageParam: 1,
    getNextPageParam: (page) => page.page * page.pageSize < page.total ? page.page + 1 : undefined,
  });
  const directory = useUserDirectory();
  const entries = activity.data?.pages.flatMap((page) => page.activity) ?? [];
  const mergedUsers = new Map((directory.data?.users ?? []).map((user) => [user.id, user]));
  for (const user of users) mergedUsers.set(user.id, user);
  return <div className="grid gap-3">
    {activity.isPending ? <TimelineSkeleton /> : (!activity.isError || activity.data) && <Timeline entries={entries} users={[...mergedUsers.values()]} linkItems={scope === 'projects'} itemLabels={itemLabels} />}
    {activity.isError && <div role="alert" className="text-sm text-red-700">
      Could not load activity. <button type="button" className="underline" onClick={() => void activity.refetch()}>Retry</button>
    </div>}
    {directory.isError && <p role="status" className="text-xs text-slate-500">Some user names could not be loaded.</p>}
    {activity.hasNextPage && <button type="button" className="justify-self-start rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-60"
      disabled={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>
      {activity.isFetchingNextPage ? 'Loading…' : 'Load more'}
    </button>}
  </div>;
}
