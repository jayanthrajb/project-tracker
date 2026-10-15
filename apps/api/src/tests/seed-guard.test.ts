import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertSeedAllowed } from '../../prisma/seed-guard.js';

function database() {
  const delegate = (count: number) => ({
    count: vi.fn().mockResolvedValue(count),
    deleteMany: vi.fn(),
  });
  return {
    projectMember: delegate(12),
    item: delegate(20),
    project: delegate(3),
    user: delegate(6),
    itemDependency: delegate(4),
    activityLog: delegate(30),
    comment: delegate(8),
    mention: delegate(2),
    notification: delegate(5),
    savedView: delegate(1),
    attachment: delegate(7),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('seed safety guard', () => {
  it.each([
    [{ NODE_ENV: 'production' }, []],
    [{ NODE_ENV: 'production' }, ['--force']],
    [{ NODE_ENV: 'production', SEED_FORCE: 'true' }, ['--force']],
  ] as const)('refuses production without accessing the database (%j, %j)', async (env, args) => {
    const prisma = database();

    await expect(assertSeedAllowed(prisma, env, args)).rejects.toThrow(
      'Seeding is disabled in production. There is no override.',
    );
    for (const table of Object.values(prisma)) {
      expect(table.count).not.toHaveBeenCalled();
      expect(table.deleteMany).not.toHaveBeenCalled();
    }
  });

  it.each([{}, { SEED_FORCE: 'false' }, { SEED_FORCE: 'TRUE' }])(
    'refuses without explicit confirmation, printing counts without deleting (%j)',
    async (env) => {
      const prisma = database();
      const output = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(assertSeedAllowed(prisma, env, ['--force=false'])).rejects.toThrow(
        'SEED_FORCE=true npm run db:seed',
      );
      for (const [name, table] of Object.entries(prisma)) {
        expect(table.count).toHaveBeenCalledOnce();
        expect(output).toHaveBeenCalledWith(`${name}: ${await table.count.mock.results[0].value}`);
        expect(table.deleteMany).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    [{ NODE_ENV: 'development' }, ['--force']],
    [{ NODE_ENV: 'test', SEED_FORCE: 'true' }, []],
    [{ SEED_FORCE: 'true' }, []],
  ] as const)('allows explicitly confirmed non-production seeding (%j, %j)', async (env, args) => {
    const prisma = database();

    await expect(assertSeedAllowed(prisma, env, args)).resolves.toBeUndefined();
    for (const table of Object.values(prisma)) {
      expect(table.count).not.toHaveBeenCalled();
      expect(table.deleteMany).not.toHaveBeenCalled();
    }
  });

  it('fails closed if a preview count cannot be read', async () => {
    const prisma = database();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    prisma.item.count.mockRejectedValue(new Error('Database unavailable'));

    await expect(assertSeedAllowed(prisma, {}, [])).rejects.toThrow('Database unavailable');
    for (const table of Object.values(prisma)) {
      expect(table.deleteMany).not.toHaveBeenCalled();
    }
  });
});
