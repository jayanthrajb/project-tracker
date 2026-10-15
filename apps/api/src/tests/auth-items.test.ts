import request from 'supertest';
import { DependencyType, ItemPriority, ItemRisk, ItemStatus, ItemType, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { parseCsvRows } from '../lib/csv.js';

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
  const secondProject = { ...project, id: 'project-2', code: 'OPS', name: 'Ops', nextItemNum: 0 };
  const items: any[] = [];
  const dependencies: Array<{ id: string; fromId: string; toId: string; type: DependencyType; createdAt: Date }> = [];
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
      findMany: vi.fn(async ({ where }: any = {}) => {
        const projects = [project, secondProject];
        return where?.code?.in ? projects.filter((entry) => where.code.in.includes(entry.code)) : projects;
      }),
      update: vi.fn(async ({ where, data, select }: any) => {
        const found = [project, secondProject].find((entry) => entry.id === where.id);
        if (!found) {
          throw new Error('Project not found');
        }
        found.nextItemNum += data.nextItemNum.increment;
        if (select) {
          return { code: found.code, nextItemNum: found.nextItemNum };
        }
        return found;
      }),
      findUnique: vi.fn(async ({ where, select }: any) => {
        const found = [project, secondProject].find((entry) => entry.id === where.id || entry.code === where.code) ?? null;
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
        if (where?.key?.in) return items.filter((item) => where.key.in.includes(item.key));
        if (where?.parentId?.in) return items.filter((item) => where.parentId.in.includes(item.parentId));
        const filtered = items.filter((item) => {
          if (where?.OR) {
            return where.OR.some((clause: any) =>
              (clause.id?.in && clause.id.in.includes(item.id))
              || (clause.parentId?.in && clause.parentId.in.includes(item.parentId)));
          }
          return !where?.projectId || item.projectId === where.projectId;
        });
        if (select?.key && Object.keys(select).length === 1) return filtered.map((item) => ({ key: item.key }));
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
          project: (() => {
            const itemProject = [project, secondProject].find((entry) => entry.id === data.projectId) ?? project;
            return { id: itemProject.id, name: itemProject.name, code: itemProject.code };
          })(),
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
        items.forEach((item) => { if (item.parentId === where.id) item.parentId = null; });
        dependencies.splice(0, dependencies.length, ...dependencies.filter((dependency) =>
          dependency.fromId !== where.id && dependency.toId !== where.id));
        return removed;
      }),
    },
    itemDependency: {
      findMany: vi.fn(async ({ where }: any) => dependencies.filter((dependency) =>
        where?.OR ? where.OR.some((clause: any) =>
          (clause.fromId?.in && clause.fromId.in.includes(dependency.fromId))
          || (clause.toId?.in && clause.toId.in.includes(dependency.toId)))
          : (!where?.fromId || (typeof where.fromId === 'string'
            ? dependency.fromId === where.fromId
            : where.fromId.in.includes(dependency.fromId)))
            && (!where?.toId || dependency.toId === where.toId)
            && (!where?.type || dependency.type === where.type))),
      findUnique: vi.fn(async ({ where }: any) => {
        const dependency = dependencies.find((entry) => entry.id === where.id
          || (entry.fromId === where.fromId_toId_type?.fromId
            && entry.toId === where.fromId_toId_type?.toId
            && entry.type === where.fromId_toId_type?.type));
        return dependency ? {
          ...dependency,
          from: items.find((item) => item.id === dependency.fromId),
          to: items.find((item) => item.id === dependency.toId),
        } : null;
      }),
      upsert: vi.fn(async ({ where, create }: any) => {
        const existing = dependencies.find((dependency) => dependency.fromId === where.fromId_toId_type.fromId
          && dependency.toId === where.fromId_toId_type.toId && dependency.type === where.fromId_toId_type.type);
        if (existing) return existing;
        const dependency = { id: `dependency-${dependencies.length + 1}`, ...create, createdAt: new Date() };
        dependencies.push(dependency);
        return dependency;
      }),
      create: vi.fn(async ({ data }: any) => {
        const dependency = { id: `dependency-${dependencies.length + 1}`, ...data, createdAt: new Date() };
        dependencies.push(dependency);
        return dependency;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const index = dependencies.findIndex((dependency) => dependency.id === where.id);
        return dependencies.splice(index, 1)[0];
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const removed = dependencies.filter((dependency) =>
          (!where.type || dependency.type === where.type)
          && (!where.fromId || dependency.fromId === where.fromId)
          && (!where.OR || where.OR.some((clause: any) =>
            dependency.fromId === clause.fromId || dependency.toId === clause.toId)));
        removed.forEach((dependency) => dependencies.splice(dependencies.indexOf(dependency), 1));
        return { count: removed.length };
      }),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => callback(prisma)),
  };

  return Object.assign(prisma, { activityLogs, notifications, dependencies });
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

  it('validates parent depth and cycles and promotes children when a parent is deleted', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const agent = request.agent(createApp());
    const login = await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const csrf = csrfFrom(login.headers['set-cookie']);
    const makeItem = (title: string, parentId?: string, projectId = 'project-1') =>
      agent.post('/api/items').set('x-csrf-token', csrf).send({
        projectId, title, type: ItemType.TASK, reporterId: 'manager-1', parentId,
      });
    const root = await makeItem('Root');
    const child = await makeItem('Child', root.body.item.id);
    const grandchild = await makeItem('Grandchild', child.body.item.id);
    const fourth = await makeItem('Fourth', grandchild.body.item.id);
    expect([root.status, child.status, grandchild.status, fourth.status]).toEqual([201, 201, 201, 201]);
    expect(child.body.item.parent.key).toBe(root.body.item.key);
    expect(root.body.item.children).toEqual([]);

    const fifth = await makeItem('Fifth', fourth.body.item.id);
    expect(fifth.status).toBe(400);
    expect((await agent.patch(`/api/items/${root.body.item.id}`).set('x-csrf-token', csrf)
      .send({ parentId: child.body.item.id })).status).toBe(400);
    expect((await agent.patch(`/api/items/${root.body.item.id}`).set('x-csrf-token', csrf)
      .send({ parentId: root.body.item.id })).status).toBe(400);
    expect((await agent.patch(`/api/items/${root.body.item.id}`).set('x-csrf-token', csrf)
      .send({ parentId: fourth.body.item.id })).status).toBe(400);
    expect((await makeItem('Cross-project child', root.body.item.id, 'project-2')).status).toBe(400);

    const details = await agent.get('/api/items?projectId=project-1');
    const childRow = details.body.items.find((item: { id: string }) => item.id === child.body.item.id);
    expect(childRow.parent.id).toBe(root.body.item.id);
    expect(details.body.items.find((item: { id: string }) => item.id === root.body.item.id).children)
      .toContainEqual(expect.objectContaining({ id: child.body.item.id }));

    expect((await agent.delete(`/api/items/${root.body.item.id}`).set('x-csrf-token', csrf)).status).toBe(204);
    expect(mockPrisma.item.findUnique).toHaveBeenCalled();
    const promoted = await agent.get('/api/items?projectId=project-1');
    expect(promoted.body.items.find((item: { id: string }) => item.id === child.body.item.id).parentId).toBeNull();
  });

  it('stores dependency direction once, derives blockedBy, and accepts cross-project links', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const agent = request.agent(createApp());
    const login = await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const csrf = csrfFrom(login.headers['set-cookie']);
    const createItem = (projectId: string, title: string) => agent.post('/api/items').set('x-csrf-token', csrf).send({
      projectId, title, type: ItemType.TASK, reporterId: 'manager-1',
    });
    const [first, second] = await Promise.all([
      createItem('project-1', 'First'),
      createItem('project-2', 'Second'),
    ]);
    const linked = await agent.post('/api/items/dependencies').set('x-csrf-token', csrf).send({
      fromId: first.body.item.id, toId: second.body.item.id, type: DependencyType.BLOCKS,
    });
    expect(linked.status).toBe(201);
    expect(mockPrisma.itemDependency.findMany).toHaveBeenCalled();
    const blockingCycle = await agent.post('/api/items/dependencies').set('x-csrf-token', csrf).send({
      fromId: second.body.item.id, toId: first.body.item.id, type: DependencyType.BLOCKS,
    });
    expect(blockingCycle.status).toBe(400);

    const blockedItem = await agent.get('/api/items?projectId=project-2');
    expect(blockedItem.body.items[0].blockedBy).toEqual([expect.objectContaining({
      id: first.body.item.id, projectCode: 'APP',
    })]);
    expect(mockPrisma.itemDependency.findMany).toHaveBeenCalled();

    const self = await agent.post('/api/items/dependencies').set('x-csrf-token', csrf).send({
      fromId: first.body.item.id, toId: first.body.item.id, type: DependencyType.BLOCKS,
    });
    expect(self.status).toBe(400);
    const reverseRelated = await agent.post('/api/items/dependencies').set('x-csrf-token', csrf).send({
      fromId: first.body.item.id, toId: second.body.item.id, type: DependencyType.RELATES_TO,
    });
    const normalizedRelated = await agent.post('/api/items/dependencies').set('x-csrf-token', csrf).send({
      fromId: second.body.item.id, toId: first.body.item.id, type: DependencyType.RELATES_TO,
    });
    expect(reverseRelated.status).toBe(201);
    expect(normalizedRelated.status).toBe(201);
    expect(mockPrisma.dependencies.filter((dependency: { type: DependencyType }) => dependency.type === DependencyType.RELATES_TO))
      .toHaveLength(1);
    const blockingDependency = mockPrisma.dependencies.find((dependency: { type: DependencyType }) => dependency.type === DependencyType.BLOCKS)!;
    expect((await agent.delete(`/api/items/dependencies/${blockingDependency.id}`).set('x-csrf-token', csrf)).status).toBe(204);
    expect(mockPrisma.dependencies.some((dependency: { type: DependencyType }) => dependency.type === DependencyType.BLOCKS)).toBe(false);
  });

  it('round-trips item relationships through key-based CSV and preserves absent columns', async () => {
    vi.resetModules();
    const mockPrisma = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: mockPrisma }));
    const { createApp } = await import('../app.js');
    const agent = request.agent(createApp());
    const login = await agent.post('/api/auth/login').send({ email: 'sara.manager@example.com', password: 'Password123!' });
    const csrf = csrfFrom(login.headers['set-cookie']);
    const csv = [
      'projectCode,Key,title,type,reporterEmail,ParentKey,BlocksKeys,BlockedByKeys,RelatesToKeys',
      'APP,CHILD,Child,TASK,sara.manager@example.com,PARENT,BLOCKER,IGNORED,RELATED',
      'APP,PARENT,Parent,TASK,sara.manager@example.com,,,,',
      'APP,BLOCKER,Blocker,TASK,sara.manager@example.com,,,,',
      'APP,RELATED,Related,TASK,sara.manager@example.com,,,CHILD',
    ].join('\n');
    const imported = await agent.post('/api/items/import').set('x-csrf-token', csrf)
      .attach('file', Buffer.from(csv), { filename: 'items.csv', contentType: 'text/csv' });
    expect(imported.status).toBe(200);
    expect(imported.body.errors).toEqual([]);
    const [child, parent, blocker, related] = imported.body.created;

    const listed = await agent.get('/api/items?projectId=project-1');
    const childResponse = listed.body.items.find((item: { id: string }) => item.id === child.id);
    const blockerResponse = listed.body.items.find((item: { id: string }) => item.id === blocker.id);
    expect(childResponse.parent.key).toBe(parent.key);
    expect(childResponse.blocks[0].key).toBe(blocker.key);
    expect(childResponse.relatesTo).toEqual([expect.objectContaining({ key: related.key })]);
    expect(blockerResponse.blockedBy).toEqual([expect.objectContaining({ id: child.id })]);
    expect(mockPrisma.dependencies).toHaveLength(2);

    const exported = await agent.get('/api/items/export?projectId=project-1');
    expect(exported.status).toBe(200);
    const exportRows = parseCsvRows(exported.text).data;
    const childExport = exportRows.find((row) => row.key === child.key);
    const blockerExport = exportRows.find((row) => row.key === blocker.key);
    expect(childExport).toMatchObject({
      ParentKey: parent.key,
      BlocksKeys: blocker.key,
      RelatesToKeys: related.key,
    });
    expect(blockerExport?.BlockedByKeys).toBe(child.key);

    const absent = [
      'projectCode,Key,title,type,reporterEmail',
      `APP,${child.key},Child,TASK,sara.manager@example.com`,
    ].join('\n');
    const unchanged = await agent.post('/api/items/import').set('x-csrf-token', csrf)
      .attach('file', Buffer.from(absent), { filename: 'items.csv', contentType: 'text/csv' });
    expect(unchanged.body.updatedCount).toBe(1);
    const afterAbsent = await agent.get('/api/items?projectId=project-1');
    expect(afterAbsent.body.items.find((item: { id: string }) => item.id === child.id).parentId).toBe(parent.id);
    expect(mockPrisma.dependencies).toHaveLength(2);

    const blank = [
      'projectCode,Key,title,type,reporterEmail,ParentKey,BlocksKeys,BlockedByKeys,RelatesToKeys',
      `APP,${child.key},Child,TASK,sara.manager@example.com,,,${parent.key},`,
    ].join('\n');
    const cleared = await agent.post('/api/items/import').set('x-csrf-token', csrf)
      .attach('file', Buffer.from(blank), { filename: 'items.csv', contentType: 'text/csv' });
    expect(cleared.body.errors).toEqual([]);
    const afterBlank = await agent.get('/api/items?projectId=project-1');
    expect(afterBlank.body.items.find((item: { id: string }) => item.id === child.id).parentId).toBeNull();
    expect(mockPrisma.dependencies).toHaveLength(0);

    const badKey = [
      'projectCode,Key,title,type,reporterEmail,BlocksKeys',
      `APP,${child.key},Child,TASK,sara.manager@example.com,UNKNOWN-99`,
    ].join('\n');
    const failedLink = await agent.post('/api/items/import').set('x-csrf-token', csrf)
      .attach('file', Buffer.from(badKey), { filename: 'items.csv', contentType: 'text/csv' });
    expect(failedLink.body.errors[0].errors[0]).toContain('UNKNOWN-99');

    const cyclicParents = [
      'projectCode,Key,title,type,reporterEmail,ParentKey',
      'APP,CYCLE-A,Cycle A,TASK,sara.manager@example.com,CYCLE-B',
      'APP,CYCLE-B,Cycle B,TASK,sara.manager@example.com,CYCLE-A',
    ].join('\n');
    const cycleImport = await agent.post('/api/items/import').set('x-csrf-token', csrf)
      .attach('file', Buffer.from(cyclicParents), { filename: 'items.csv', contentType: 'text/csv' });
    expect(cycleImport.body.errors).toEqual([expect.objectContaining({ row: 3 })]);
    expect(cycleImport.body.errors[0].errors[0]).toContain('cycle');

    const deepHierarchy = [
      'projectCode,Key,title,type,reporterEmail,ParentKey',
      'APP,LEVEL-1,Level one,TASK,sara.manager@example.com,',
      'APP,LEVEL-2,Level two,TASK,sara.manager@example.com,LEVEL-1',
      'APP,LEVEL-3,Level three,TASK,sara.manager@example.com,LEVEL-2',
      'APP,LEVEL-4,Level four,TASK,sara.manager@example.com,LEVEL-3',
      'APP,LEVEL-5,Level five,TASK,sara.manager@example.com,LEVEL-4',
    ].join('\n');
    const depthImport = await agent.post('/api/items/import').set('x-csrf-token', csrf)
      .attach('file', Buffer.from(deepHierarchy), { filename: 'items.csv', contentType: 'text/csv' });
    expect(depthImport.body.errors).toEqual([expect.objectContaining({ row: 6 })]);
    expect(depthImport.body.errors[0].errors[0]).toContain('4 levels');
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
    expect(mockPrisma.item.findMany).toHaveBeenCalledWith(expect.objectContaining({
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
