import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}));

import { createApp } from '../app.js';

describe('health endpoints', () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it('returns process health without auth', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('bypasses the global api rate limiter', async () => {
    const app = createApp();
    const responses = await Promise.all(Array.from({ length: 305 }, () => request(app).get('/api/health')));

    expect(responses.every((response) => response.status === 200)).toBe(true);
  });

  it('returns readiness when the database query succeeds', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const response = await request(createApp()).get('/api/ready');

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns service unavailable when the database query fails', async () => {
    queryRaw.mockRejectedValueOnce(new Error('db unavailable'));

    const response = await request(createApp()).get('/api/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error' });
  });
});
