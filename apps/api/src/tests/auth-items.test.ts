import request from 'supertest';
import { ItemPriority, ItemRisk, ItemStatus, ItemType, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

function createMockPrisma() {
  const users = [
    {
      id: 'manager-1',
      name: 'Sara Manager',
      email: 'sara.manager@example.com',
      passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK',
      role: UserRole.MANAGER,
      isActive: true,
      createdAt: new Date(),
    },
    {
      id: 'dev-1',
      name: 'Ava Developer',
      email: 'ava@example.com',
      passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK',
      role: UserRole.DEVELOPER,
      isActive: true,
      createdAt: new Date(),
    },
  ];

  const project = { id: 'project-1', code: 'APP', name: 'App', description: 'App project', status: 'ACTIVE', ownerId: 'manager-1', createdAt: new Date(), updatedAt: new Date() };
  const items: any[] = [];

  return {
    user: {
      findUnique: vi.fn(async ({ where }: any) => users.find((user) => user.id === where.id || user.email === where.email) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const user = { id: `user-${users.length + 1}`, isActive: true, createdAt: new Date(), ...data };
        users.push(user);
        return user;
      }),
    },
    project: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const found = (where.id === project.id || where.code === project.code) ? project : null;
        if (!found) return null;
        if (select?.code) return { code: found.code };
        return found;
      }),
    },
    item: {
      findMany: vi.fn(async ({ where, select }: any) => {
        const filtered = items.filter((item) => !where?.projectId || item.projectId === where.projectId);
        if (select?.key) return filtered.map((item) => ({ key: item.key }));
        return filtered;
      }),
      create: vi.fn(async ({ data }: any) => {
        const assignee = users.find((user) => user.id === data.assigneeId) ?? null;
        const reporter = users.find((user) => user.id === data.reporterId)!;
        const item = {
          id: `item-${items.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          closedAt: data.closedAt ?? null,
          ...data,
          project: { id: project.id, name: project.name, code: project.code },
          assignee,
          reporter,
        };
        items.push(item);
        return item;
      }),
      findUnique: vi.fn(async ({ where }: any) => items.find((item) => item.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const index = items.findIndex((item) => item.id === where.id);
        items[index] = {
          ...items[index],
          ...data,
          assignee: users.find((user) => user.id === (data.assigneeId ?? items[index].assigneeId)) ?? null,
          reporter: users.find((user) => user.id === (data.reporterId ?? items[index].reporterId))!,
          updatedAt: new Date(),
        };
        return items[index];
      }),
      delete: vi.fn(async ({ where }: any) => {
        const index = items.findIndex((item) => item.id === where.id);
        const [removed] = items.splice(index, 1);
        return removed;
      }),
    },
  };
}

describe('auth and items routes', () => {
  it('registers, logs in, and returns the current user', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const agent = request.agent(app);

    const registerResponse = await agent.post('/api/auth/register').send({
      name: 'New User',
      email: 'new.user@example.com',
      password: 'Password123!',
      role: 'DEVELOPER',
    });

    expect(registerResponse.status).toBe(201);

    const loginResponse = await agent.post('/api/auth/login').send({
      email: 'sara.manager@example.com',
      password: 'Password123!',
    });

    expect(loginResponse.status).toBe(200);

    const meResponse = await agent.get('/api/auth/me');
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.email).toBe('sara.manager@example.com');
  });

  it('allows a manager to create, update, and delete an item', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const agent = request.agent(app);

    await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });

    const createResponse = await agent.post('/api/items').send({
      projectId: 'project-1',
      title: 'New item',
      description: 'Track something important',
      type: ItemType.TASK,
      status: ItemStatus.OPEN,
      priority: ItemPriority.P1,
      risk: ItemRisk.MEDIUM,
      assigneeId: 'dev-1',
      reporterId: 'manager-1',
      dueDate: '2026-10-01',
      estimateHours: 5,
      spentHours: 1,
      tags: ['api'],
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.item.key).toBe('APP-1');

    const patchResponse = await agent.patch(`/api/items/${createResponse.body.item.id}`).send({
      status: ItemStatus.BLOCKED,
      reporterId: 'manager-1',
      projectId: 'project-1',
      title: 'New item',
      description: 'Track something important',
      type: ItemType.TASK,
      priority: ItemPriority.P0,
      risk: ItemRisk.HIGH,
      assigneeId: 'dev-1',
      dueDate: '2026-10-01',
      estimateHours: 5,
      spentHours: 2,
      tags: ['api'],
    });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.item.status).toBe(ItemStatus.BLOCKED);

    const deleteResponse = await agent.delete(`/api/items/${createResponse.body.item.id}`);
    expect(deleteResponse.status).toBe(204);
  });

  it('blocks developers from editing items they do not own or report', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const managerAgent = request.agent(app);
    const developerAgent = request.agent(app);

    await managerAgent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const createResponse = await managerAgent.post('/api/items').send({
      projectId: 'project-1',
      title: 'Manager-owned item',
      description: 'Protected item',
      type: ItemType.TASK,
      status: ItemStatus.OPEN,
      priority: ItemPriority.P2,
      risk: ItemRisk.LOW,
      assigneeId: null,
      reporterId: 'manager-1',
      dueDate: '2026-10-01',
      estimateHours: 2,
      spentHours: 0,
      tags: [],
    });

    await developerAgent.post('/api/auth/login').send({ email: 'ava@example.com', password: 'Password123!' });
    const patchResponse = await developerAgent.patch(`/api/items/${createResponse.body.item.id}`).send({ status: ItemStatus.DONE });

    expect(patchResponse.status).toBe(403);
  });
});
