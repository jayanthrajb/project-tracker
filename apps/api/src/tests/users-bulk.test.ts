import request from 'supertest';
import { ItemPriority, ItemRisk, ItemStatus, ItemType, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

function createMockPrisma() {
  const users = [
    {
      id: 'admin-1',
      name: 'Alice Admin',
      email: 'alice.admin@example.com',
      passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK',
      role: UserRole.ADMIN,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    },
    {
      id: 'manager-1',
      name: 'Sara Manager',
      email: 'sara.manager@example.com',
      passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK',
      role: UserRole.MANAGER,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    },
    {
      id: 'dev-1',
      name: 'Ava Developer',
      email: 'ava@example.com',
      passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK',
      role: UserRole.DEVELOPER,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    },
  ];

  const items: any[] = [
    {
      id: 'item-1',
      projectId: 'project-1',
      key: 'APP-1',
      type: ItemType.TASK,
      title: 'Manager item',
      description: 'desc',
      status: ItemStatus.OPEN,
      priority: ItemPriority.P2,
      risk: ItemRisk.LOW,
      assigneeId: 'manager-1',
      reporterId: 'manager-1',
      dueDate: null,
      estimateHours: null,
      spentHours: 0,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      closedAt: null,
      project: { id: 'project-1', name: 'App', code: 'APP' },
      assignee: { id: 'manager-1', name: 'Sara Manager', email: 'sara.manager@example.com', role: UserRole.MANAGER },
      reporter: { id: 'manager-1', name: 'Sara Manager', email: 'sara.manager@example.com', role: UserRole.MANAGER },
    },
  ];

  const prisma: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => users.find((user) => user.id === where.id || user.email === where.email) ?? null),
      findMany: vi.fn(async ({ where }: any = {}) => users
        .filter((user) => {
          if (where?.role && user.role !== where.role) return false;
          if (where?.isActive !== undefined && user.isActive !== where.isActive) return false;
          if (where?.OR) {
            const search = where.OR[0].name.contains.toLowerCase();
            return user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search);
          }
          return true;
        })
        .map((user) => ({ ...user, _count: { assignedItems: items.filter((item) => item.assigneeId === user.id).length } }))),
      count: vi.fn(async ({ where }: any = {}) => users.filter((user) => {
        if (where?.role && user.role !== where.role) return false;
        if (where?.isActive !== undefined && user.isActive !== where.isActive) return false;
        return true;
      }).length),
      create: vi.fn(async ({ data }: any) => {
        const user = { id: `user-${users.length + 1}`, createdAt: new Date(), ...data };
        users.push(user);
        return user;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const index = users.findIndex((user) => user.id === where.id);
        if (index < 0) throw new Error('not found');
        users[index] = { ...users[index], ...data };
        return users[index];
      }),
    },
    project: {
      update: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    projectMember: {
      findUnique: vi.fn(async () => null),
    },
    item: {
      groupBy: vi.fn(async () => []),
      count: vi.fn(async ({ where }: any) => items.filter((item) => item.assigneeId === where.assigneeId).length),
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.id?.in) {
          return items.filter((item) => where.id.in.includes(item.id));
        }
        return items;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const index = items.findIndex((item) => item.id === where.id);
        items[index] = { ...items[index], ...data };
        return items[index];
      }),
    },
    $transaction: vi.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(prisma);
    }),
  };

  return prisma;
}

function csrfFrom(setCookie: string[] | string | undefined) {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const token = values.find((value) => value.startsWith('project_tracker_csrf='))?.split(';')[0].split('=')[1];
  return token ? decodeURIComponent(token) : '';
}

describe('users and bulk routes', () => {
  it('returns slim user payload for non-admin list requests', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const agent = request.agent(app);

    const login = await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    expect(login.status).toBe(200);

    const response = await agent.get('/api/users');
    expect(response.status).toBe(200);
    expect(response.body.users[0]).not.toHaveProperty('email');
    expect(response.body.users[0]).toHaveProperty('name');
  });

  it('blocks last active admin from deactivating themselves', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const agent = request.agent(app);

    const login = await agent.post('/api/auth/login').send({ email: 'alice.admin@example.com', password: 'Password123!' });
    const csrf = csrfFrom(login.headers['set-cookie']);

    const response = await agent.delete('/api/users/admin-1').set('x-csrf-token', csrf);
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('last active ADMIN');
  });

  it('fails bulk update atomically when one item is forbidden', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const agent = request.agent(app);

    const login = await agent.post('/api/auth/login').send({ email: 'ava@example.com', password: 'Password123!' });
    const csrf = csrfFrom(login.headers['set-cookie']);

    const response = await agent.patch('/api/items/bulk').set('x-csrf-token', csrf).send({
      updates: [{ id: 'item-1', priority: 'P0' }],
    });

    expect(response.status).toBe(403);
    expect(response.body.error.details.perItem['item-1']).toContain('cannot edit');
  });
});
