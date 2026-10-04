import { ActivityFeed } from './ActivityFeed';
import type { MentionableUser } from '../types';

export function HistoryTab({ itemId, users }: { itemId: string; users: MentionableUser[] }) {
  return <ActivityFeed scope="items" id={itemId} users={users} />;
}
