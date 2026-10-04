import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findItem } from './findItem';
import { api } from './api';
import type * as ApiModule from './api';

vi.mock('./api', async (importOriginal) => ({ ...await importOriginal<typeof ApiModule>(), api: vi.fn() }));
const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
});

describe('findItem through the existing list endpoint', () => {
  it('uses the notification key as search and checks the exact ID', async () => {
    apiMock.mockResolvedValue({ items: [{ id: 'other' }, { id: 'target', projectId: 'p1' }], total: 2 });
    expect(await findItem('target', { key: 'APO-1' })).toEqual({ item: { id: 'target', projectId: 'p1' } });
    expect(apiMock).toHaveBeenCalledWith('/items?search=APO-1&page=1&pageSize=100');
  });

  it('finds deep-linked project items beyond the first hundred', async () => {
    apiMock.mockResolvedValueOnce({ items: [{ id: 'other' }], total: 101 })
      .mockResolvedValueOnce({ items: [{ id: 'target', projectId: 'p1' }], total: 101 });
    expect(await findItem('target', { projectId: 'p1' })).toEqual({ item: { id: 'target', projectId: 'p1' } });
    expect(apiMock).toHaveBeenCalledWith('/items?projectId=p1&page=2&pageSize=100');
  });

  it('returns a not-found error for deleted or inaccessible items and stops on empty pages', async () => {
    apiMock.mockResolvedValue({ items: [], total: 1000 });
    await expect(findItem('deleted', { projectId: 'p1' })).rejects.toMatchObject({ status: 404 });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('propagates network errors rather than treating the deep link as stale', async () => {
    apiMock.mockRejectedValue(new Error('Network unavailable'));
    await expect(findItem('target')).rejects.toThrow('Network unavailable');
  });
});
