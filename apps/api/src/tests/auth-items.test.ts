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

  const project = { id: 'project-1', code: 'APP', name: 'App', description: 'App project', status: 'ACTIVE', ownerId: 'manager-1', nextItemNum: 0, createdAt: new Date(), updatedAt: new Date() };
  const items: any[] = [];
  const activityLogs: any[] = [];
  const notifications: any[] = [];

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => users.find((user) => user.id === where.id || user.email === where.email) ?? null),
      findMany: vi.fn(async ({ where }: any = {}) => users.filter((user) =>
        !where?.email?.in || where.email.in.includes(user.email))),
      create: vi.fn(async ({ data }: any) => {
        const user = { id: `user-${users.length + 1}`, isActive: true, createdAt: new Date(), ...data };
        users.push(user);
        return user;
      }),
    },
    project: {
      findMany: vi.fn(async ({ where }: any = {}) => where?.code?.in
        ? [project].filter((entry) => where.code.in.includes(entry.code))
        : [project]),
      update: vi.fn(async ({ where, data, select }: any) => {
        if (where.id !== project.id) {
          throw new Error('Project not found');
        }
        project.nextItemNum += data.nextItemNum.increment;
        if (select) {
          return { code: project.code, nextItemNum: project.nextItemNum };
        }
        return project;
      }),
      findUnique: vi.fn(async ({ where, select }: any) => {
        const found = (where.id === project.id || where.code === project.code) ? project : null;
        if (!found) return null;
        if (select?.code) return { code: found.code, nextItemNum: found.nextItemNum };
        return found;
      }),
    },
    projectMember: {
      findUnique: vi.fn(async ({ where }: any) => where.projectId_userId.projectId === project.id ? { projectId: project.id, userId: where.projectId_userId.userId } : null),
    },
    activityLog: {
      create: vi.fn(async ({ data }: any) => {
        const entry = { id: `activity-${activityLogs.length + 1}`, createdAt: new Date(), ...data };
        activityLogs.push(entry);
        return entry;
      }),
      createMany: vi.fn(async ({ data }: any) => {
        activityLogs.push(...data.map((entry: any) => ({ id: `activity-${activityLogs.length + 1}`, createdAt: new Date(), ...entry })));
        return { count: data.length };
      }),
      findMany: vi.fn(async ({ where }: any) => activityLogs.filter((entry) => entry.itemId === where.itemId)),
      count: vi.fn(async ({ where }: any) => activityLogs.filter((entry) => entry.itemId === where.itemId).length),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const notification = { id: `notification-${notifications.length + 1}`, createdAt: new Date(), ...data };
        notifications.push(notification);
        return notification;
      }),
    },
    attachment: {
      findMany: vi.fn(async () => []),
    },
    item: {
      findMany: vi.fn(async ({ where, select }: any) => {
        if (where?.id?.in) return items.filter((item) => where.id.in.includes(item.id));
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
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string; startedAt: null };
        data: { startedAt: Date };
      }) => {
        const item = items.find((entry) => entry.id === where.id && entry.startedAt === null);
        if (!item) return { count: 0 };
        item.startedAt = data.startedAt;
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const index = items.findIndex((item) => item.id === where.id);
        const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
        items[index] = {
          ...items[index],
          ...changes,
          assignee: users.find((user) => user.id === (changes.assigneeId ?? items[index].assigneeId)) ?? null,
          reporter: users.find((user) => user.id === (changes.reporterId ?? items[index].reporterId))!,
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
    $transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => callback(prisma)),
  };

  return Object.assign(prisma, { activityLogs, notifications });
}

function csrfFrom(setCookie: string[] | string | undefined) {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const token = values.find((value) => value.startsWith('project_tracker_csrf='))?.split(';')[0].split('=')[1];
  return token ? decodeURIComponent(token) : '';
}

describe('auth and items routes', () => {
  it.each(['single', 'bulk'] as const)('preserves the first start across BLOCKED and re-entry via %s updates', async (path) => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const agent = request.agent(createApp());
    const login = await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const csrf = csrfFrom(login.headers['set-cookie']);
    const created = await agent.post('/api/items').set('x-csrf-token', csrf).send({
      projectId: 'project-1', title: 'Start tracking', type: ItemType.TASK, reporterId: 'manager-1',
    });
    expect(created.status).toBe(201);
    expect(created.body.item.status).toBe(ItemStatus.OPEN);
    expect(created.body.item.startedAt).toBeNull();
    const id: string = created.body.item.id;
    const updateStatus = (status: ItemStatus) => path === 'single'
      ? agent.patch(`/api/items/${id}`).set('x-csrf-token', csrf).send({ status })
      : agent.patch('/api/items/bulk').set('x-csrf-token', csrf).send({ updates: [{ id, status }] });
    const responseItem = (response: request.Response) => path === 'single' ? response.body.item : response.body.items[0];
    const beforeStart = Date.now();
    const started = await updateStatus(ItemStatus.IN_PROGRESS);
    expect(started.status).toBe(200);
    const firstStart: string = responseItem(started).startedAt;
    expect(new Date(firstStart).getTime()).toBeGreaterThanOrEqual(beforeStart);
    expect(new Date(firstStart).getTime()).toBeLessThanOrEqual(Date.now());

    const blocked = await updateStatus(ItemStatus.BLOCKED);
    expect(blocked.status).toBe(200);
    expect(responseItem(blocked).startedAt).toBe(firstStart);
    const reentered = await updateStatus(ItemStatus.IN_PROGRESS);
    expect(reentered.status).toBe(200);
    expect(responseItem(reentered).startedAt).toBe(firstStart);
    const backlog = await updateStatus(ItemStatus.BACKLOG);
    expect(backlog.status).toBe(200);
    expect(responseItem(backlog).startedAt).toBe(firstStart);
  });

  it('initializes starts on direct creation and CSV import and accepts backlog in filters and export', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const agent = request.agent(createApp());
    const login = await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const csrf = csrfFrom(login.headers['set-cookie']);
    const beforeStart = Date.now();
    const created = await agent.post('/api/items').set('x-csrf-token', csrf).send({
      projectId: 'project-1', title: 'Already started', type: ItemType.TASK,
      reporterId: 'manager-1', status: ItemStatus.IN_PROGRESS,
    });
    expect(created.status).toBe(201);
    expect(new Date(created.body.item.startedAt).getTime()).toBeGreaterThanOrEqual(beforeStart);
    const imported = await agent.post('/api/items/import').set('x-csrf-token', csrf)
      .attach('file', Buffer.from(
        'projectCode,title,type,status,reporterEmail\n'
        + 'APP,Started import,TASK,IN_PROGRESS,sara.manager@example.com\n'
        + 'APP,Backlog import,TASK,BACKLOG,sara.manager@example.com\n',
      ), { filename: 'items.csv', contentType: 'text/csv' });
    expect(imported.status).toBe(200);
    expect(imported.body.errors).toEqual([]);
    expect(imported.body.createdCount).toBe(2);
    expect(new Date(imported.body.created[0].startedAt).getTime()).toBeGreaterThanOrEqual(beforeStart);
    expect(new Date(imported.body.created[0].startedAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(imported.body.created[1].status).toBe(ItemStatus.BACKLOG);
    expect(imported.body.created[1].startedAt).toBeNull();
    const filtered = await agent.get('/api/items?status=BACKLOG');
    expect(filtered.status).toBe(200);
    expect(mockPrisma.item.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { status: { in: [ItemStatus.BACKLOG] } },
    }));
    const exported = await agent.get('/api/items/export?status=BACKLOG');
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('BACKLOG');
  });

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
      role: 'ADMIN',
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.user.role).toBe('DEVELOPER');

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

    const loginResponse = await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const csrfToken = csrfFrom(loginResponse.headers['set-cookie']);

    const createResponse = await agent.post('/api/items').set('x-csrf-token', csrfToken).send({
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
    expect(mockPrisma.activityLogs.some((entry: any) => entry.action === 'CREATED')).toBe(true);
    expect(mockPrisma.notifications.some((entry: any) => entry.type === 'ASSIGNED' && entry.userId === 'dev-1')).toBe(true);

    const patchResponse = await agent.patch(`/api/items/${createResponse.body.item.id}`).set('x-csrf-token', csrfToken).send({
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
    expect(mockPrisma.activityLogs.some((entry: any) => entry.action === 'STATUS_CHANGED' && entry.field === 'status')).toBe(true);
    expect(mockPrisma.notifications.some((entry: any) => entry.type === 'STATUS_CHANGED' && entry.userId === 'dev-1')).toBe(true);

    const bulkResponse = await agent.patch('/api/items/bulk').set('x-csrf-token', csrfToken).send({
      updates: [{ id: createResponse.body.item.id, priority: ItemPriority.P3 }],
    });
    expect(bulkResponse.status).toBe(200);
    expect(mockPrisma.activityLogs.some((entry: any) => entry.action === 'BULK_UPDATED' && entry.field === 'priority')).toBe(true);

    const deleteResponse = await agent.delete(`/api/items/${createResponse.body.item.id}`).set('x-csrf-token', csrfToken);
    expect(deleteResponse.status).toBe(204);
    expect(mockPrisma.activityLogs.some((entry: any) => entry.action === 'DELETED' && entry.itemId === null)).toBe(true);
  });

  it('records imported items in the same transaction as CSV import', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const csrfToken = csrfFrom(login.headers['set-cookie']);
    const response = await agent
      .post('/api/items/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', Buffer.from('projectCode,title,type,reporterEmail\nAPP,Imported item,TASK,sara.manager@example.com\n'), {
        filename: 'items.csv',
        contentType: 'text/csv',
      });

    expect(response.status).toBe(200);
    expect(response.body.createdCount).toBe(1);
    expect(mockPrisma.activityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'IMPORTED' }),
    }));
  });

  it('blocks developers from editing items they do not own or report', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const managerAgent = request.agent(app);
    const developerAgent = request.agent(app);

    const managerLogin = await managerAgent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const managerCsrf = csrfFrom(managerLogin.headers['set-cookie']);
    const createResponse = await managerAgent.post('/api/items').set('x-csrf-token', managerCsrf).send({
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

    const developerLogin = await developerAgent.post('/api/auth/login').send({ email: 'ava@example.com', password: 'Password123!' });
    const developerCsrf = csrfFrom(developerLogin.headers['set-cookie']);
    const patchResponse = await developerAgent.patch(`/api/items/${createResponse.body.item.id}`).set('x-csrf-token', developerCsrf).send({ status: ItemStatus.DONE });

    expect(patchResponse.status).toBe(403);
  });
});
