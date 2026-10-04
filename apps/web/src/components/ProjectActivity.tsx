import { ActivityFeed } from './ActivityFeed';
import type { Item, MentionableUser } from '../types';

export function ProjectActivity({ projectId, users, items }: { projectId: string; users: MentionableUser[]; items: Item[] }) {
  return <section aria-label="Recent project activity" className="rounded-2xl border border-slate-200 bg-white p-4">
    <h3 className="mb-3 text-sm font-semibold">Recent activity</h3>
    <div className="max-h-80 overflow-y-auto">
      <ActivityFeed scope="projects" id={projectId} users={users} compact itemLabels={new Map(items.map((item) => [item.id, item.key]))} />
    </div>
  </section>;
}
