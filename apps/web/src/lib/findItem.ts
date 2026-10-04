import { api, ApiError } from './api';
import type { Item } from '../types';

// The API exposes a paginated list, not a single-item GET endpoint.
export async function findItem(itemId: string, options: { projectId?: string; key?: string } = {}): Promise<{ item: Item }> {
  let page = 1;
  let total: number;
  do {
    const params = new URLSearchParams();
    if (options.projectId) params.set('projectId', options.projectId);
    if (options.key) params.set('search', options.key);
    params.set('page', String(page));
    params.set('pageSize', '100');
    const result = await api<{ items: Item[]; total: number; pageSize: number }>(`/items?${params}`);
    const item = result.items.find((entry) => entry.id === itemId);
    if (item) return { item };
    total = result.total;
    if (!result.items.length) break;
    page += 1;
  } while ((page - 1) * 100 < total);
  throw new ApiError('Item not found or inaccessible', 404);
}
