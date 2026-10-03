import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ItemPriority, ItemRisk, ItemStatus, ItemType, NotificationType, UserRole } from '@prisma/client';
import type { Prisma, PrismaClient, ViewScope } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
}

interface CommentRecord {
  id: string;
  itemId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
}

interface ViewRecord {
  id: string;
  userId: string;
  name: string;
  scope: ViewScope;
  projectId: string | null;
  filtersJson: Prisma.JsonValue;
  sortJson: Prisma.JsonValue;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface NotificationRecord {
  id: string;
  userId: string;
  itemId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  dedupeKey: string | null;
  createdAt: Date;
}

interface AttachmentRecord {
  id: string;
  itemId: string;
  uploaderId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
}

function createMockPrisma() {
  const users: UserRecord[] = [
    { id: 'admin-1', name: 'Alice Admin', email: 'alice@example.com', passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK', role: UserRole.ADMIN, isActive: true },
    { id: 'manager-1', name: 'Sara Manager', email: 'sara.manager@example.com', passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK', role: UserRole.MANAGER, isActive: true },
    { id: 'dev-1', name: 'Ava Developer', email: 'ava@example.com', passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK', role: UserRole.DEVELOPER, isActive: true },
    { id: 'outsider-1', name: 'Outside Developer', email: 'outside@example.com', passwordHash: '$2b$10$P4RE5ZmznoyvbJtFVjsKhOGsYZsO/biZZGnfmrnM5sV8NR0phYPoK', role: UserRole.DEVELOPER, isActive: true },
  ];
  const item = {
    id: 'item-1',
    projectId: 'project-1',
    key: 'APP-1',
    title: 'Tracked item',
    description: '',
    type: ItemType.TASK,
    status: ItemStatus.OPEN,
    priority: ItemPriority.P2,
    risk: ItemRisk.LOW,
    assigneeId: 'dev-1',
    reporterId: 'manager-1',
    dueDate: null,
    estimateHours: null,
    spentHours: 0,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    closedAt: null,
    project: { id: 'project-1', ownerId: 'manager-1', members: [{ userId: 'dev-1' }] },
  };
  const comments: CommentRecord[] = [];
  const views: ViewRecord[] = [];
  const notifications: NotificationRecord[] = [];
  const attachments: AttachmentRecord[] = [];
  const activity: Array<Record<string, unknown>> = [];
  let idCounter = 0;
  const project = { id: 'project-1', ownerId: 'manager-1' };
  const prismaMock = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        users.find((user) => user.id === where.id || user.email === where.email) ?? null),
      findMany: vi.fn(async () => users.filter((user) => user.isActive).map(({ id, name, email }) => ({ id, name, email }))),
    },
    projectMember: {
      findUnique: vi.fn(async () => ({ projectId: 'project-1', userId: 'dev-1' })),
      findMany: vi.fn(async () => [{ projectId: 'project-1' }]),
    },
    project: {
      findUnique: vi.fn(async () => project),
      findFirst: vi.fn(async () => null),
    },
    item: {
      findUnique: vi.fn(async () => item),
      findMany: vi.fn(async () => []),
    },
    comment: {
      create: vi.fn(async ({ data }: { data: { itemId: string; authorId: string; body: string } }) => {
        idCounter += 1;
        const created = { id: `comment-${idCounter}`, ...data, createdAt: new Date(), updatedAt: new Date(), editedAt: null };
        comments.push(created);
        return { ...created, author: users.find((user) => user.id === data.authorId) };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => comments.find((comment) => comment.id === where.id) ?? null),
      findMany: vi.fn(async () => comments),
      count: vi.fn(async () => comments.length),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { body: string; editedAt: Date } }) => {
        const found = comments.find((comment) => comment.id === where.id);
        if (!found) throw new Error('Comment not found');
        Object.assign(found, data);
        return { ...found, author: users.find((user) => user.id === found.authorId) };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => comments.splice(comments.findIndex((comment) => comment.id === where.id), 1)[0]),
    },
    mention: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    activityLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        activity.push(data);
        return data;
      }),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        activity.push(...data);
        return { count: data.length };
      }),
      findMany: vi.fn(async () => activity),
      count: vi.fn(async () => activity.length),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Omit<NotificationRecord, 'id' | 'createdAt' | 'readAt'> & { readAt?: Date | null } }) => {
        const created = { ...data, id: `notification-${notifications.length + 1}`, createdAt: new Date(), readAt: data.readAt ?? null };
        notifications.push(created);
        return created;
      }),
      findMany: vi.fn(async () => notifications),
      count: vi.fn(async () => notifications.filter((notification) => notification.readAt === null).length),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string; userId: string; readAt?: null }; data: { readAt: Date } }) => {
        const matched = notifications.filter((notification) =>
          notification.userId === where.userId && (!where.id || notification.id === where.id) && (!where.readAt || notification.readAt === null));
        matched.forEach((notification) => { notification.readAt = data.readAt; });
        return { count: matched.length };
      }),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    savedView: {
      findMany: vi.fn(async () => views),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => views.find((view) => view.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<ViewRecord, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const created = { ...data, id: `view-${views.length + 1}`, createdAt: new Date(), updatedAt: new Date() };
        views.push(created);
        return created;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { userId: string; isDefault?: boolean }; data: { isDefault: boolean } }) => {
        const matched = views.filter((view) => view.userId === where.userId && (where.isDefault === undefined || view.isDefault === where.isDefault));
        matched.forEach((view) => { view.isDefault = data.isDefault; });
        return { count: matched.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { isDefault?: boolean } }) => {
        const found = views.find((view) => view.id === where.id);
        if (!found) throw new Error('View not found');
        Object.assign(found, data);
        return found;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => views.splice(views.findIndex((view) => view.id === where.id), 1)[0]),
    },
    attachment: {
      create: vi.fn(async ({ data }: { data: Omit<AttachmentRecord, 'id' | 'createdAt'> }) => {
        const created = { ...data, id: `attachment-${attachments.length + 1}`, createdAt: new Date() };
        attachments.push(created);
        return created;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => attachments.find((attachment) => attachment.id === where.id) ?? null),
      findMany: vi.fn(async () => attachments),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => attachments.splice(attachments.findIndex((attachment) => attachment.id === where.id), 1)[0]),
    },
  };
  const mockClient = prismaMock as unknown as PrismaClient;
  Object.assign(prismaMock, {
    $transaction: vi.fn(async <T>(callback: (transaction: PrismaClient) => Promise<T>): Promise<T> => callback(mockClient)),
  });
  return { prismaMock: mockClient, comments, views, notifications, attachments, activity };
}

function csrfFrom(cookies: string[] | string | undefined) {
  const values = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  const cookie = values.find((value) => value.startsWith('project_tracker_csrf='));
  return cookie ? decodeURIComponent(cookie.split(';')[0].split('=')[1]) : '';
}

async function login(app: Parameters<typeof request.agent>[0], email: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/login').send({ email, password: 'Password123!' });
  return { agent, csrf: csrfFrom(response.headers['set-cookie']) };
}

describe('Phase 2 routes', () => {
  it('creates comments, records mentions, edits only by the author, and skips self-notifications', async () => {
    vi.resetModules();
    const state = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: state.prismaMock }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const manager = await login(app, 'sara.manager@example.com');
    const created = await manager.agent
      .post('/api/items/item-1/comments')
      .set('x-csrf-token', manager.csrf)
      .send({ body: 'Email owner@example.com; @ava @ava `@hidden`' });

    expect(created.status).toBe(201);
    expect(state.comments).toHaveLength(1);
    expect(state.notifications.some((notification) => notification.userId === 'manager-1')).toBe(false);
    expect(state.notifications.some((notification) => notification.userId === 'dev-1' && notification.type === NotificationType.COMMENT)).toBe(true);
    expect(state.notifications.some((notification) => notification.userId === 'dev-1' && notification.type === NotificationType.MENTIONED)).toBe(true);
    expect(state.activity.some((entry) => entry.action === 'COMMENTED')).toBe(true);
    const itemActivity = await manager.agent.get('/api/items/item-1/activity');
    expect(itemActivity.status).toBe(200);
    expect(itemActivity.body.activity).toHaveLength(1);

    const developer = await login(app, 'ava@example.com');
    const forbiddenEdit = await developer.agent
      .patch(`/api/comments/${created.body.comment.id}`)
      .set('x-csrf-token', developer.csrf)
      .send({ body: 'Not the author' });
    expect(forbiddenEdit.status).toBe(403);

    const edited = await manager.agent
      .patch(`/api/comments/${created.body.comment.id}`)
      .set('x-csrf-token', manager.csrf)
      .send({ body: 'Edited body' });
    expect(edited.status).toBe(200);
    expect(edited.body.comment.editedAt).toBeTruthy();
  });

  it('keeps notifications private and restricts due scans to admins', async () => {
    vi.resetModules();
    const state = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: state.prismaMock }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    state.notifications.push({
      id: 'notification-manager',
      userId: 'manager-1',
      itemId: 'item-1',
      type: NotificationType.COMMENT,
      title: 'Comment',
      body: 'A comment was added',
      readAt: null,
      dedupeKey: null,
      createdAt: new Date(),
    });
    const manager = await login(app, 'sara.manager@example.com');
    const notifications = await manager.agent.get('/api/notifications?unreadOnly=true');
    expect(notifications.status).toBe(200);
    expect(notifications.body.notifications).toHaveLength(1);

    const developer = await login(app, 'ava@example.com');
    const forbiddenRead = await developer.agent
      .post('/api/notifications/notification-manager/read')
      .set('x-csrf-token', developer.csrf)
      .send({});
    expect(forbiddenRead.status).toBe(404);

    const deniedScan = await manager.agent
      .post('/api/notifications/scan')
      .set('x-csrf-token', manager.csrf)
      .send({});
    expect(deniedScan.status).toBe(403);
    const admin = await login(app, 'alice@example.com');
    const scan = await admin.agent
      .post('/api/notifications/scan')
      .set('x-csrf-token', admin.csrf)
      .send({});
    expect(scan.status).toBe(200);
  });

  it('limits saved view edits to owners or managers and switches the owner default transactionally', async () => {
    vi.resetModules();
    const state = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: state.prismaMock }));
    const { createApp } = await import('../app.js');
    const app = createApp();
    const manager = await login(app, 'sara.manager@example.com');
    const first = await manager.agent
      .post('/api/views')
      .set('x-csrf-token', manager.csrf)
      .send({ name: 'First', isDefault: true });
    const second = await manager.agent
      .post('/api/views')
      .set('x-csrf-token', manager.csrf)
      .send({ name: 'Shared view', scope: 'SHARED', projectId: 'project-1', isDefault: true });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(state.views.filter((view) => view.isDefault)).toHaveLength(1);
    const invalidFilters = await manager.agent
      .post('/api/views')
      .set('x-csrf-token', manager.csrf)
      .send({ name: 'Invalid', filtersJson: { unsupportedFilter: true } });
    expect(invalidFilters.status).toBe(400);

    const developer = await login(app, 'ava@example.com');
    const denied = await developer.agent
      .patch(`/api/views/${second.body.view.id}`)
      .set('x-csrf-token', developer.csrf)
      .send({ name: 'Changed' });
    expect(denied.status).toBe(403);
  });

  it('validates uploads, enforces item access, and serves and removes files safely', async () => {
    vi.resetModules();
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'project-tracker-uploads-'));
    const previousUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploadDir;
    const state = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: state.prismaMock }));
    try {
      const { createApp } = await import('../app.js');
      const app = createApp();
      const manager = await login(app, 'sara.manager@example.com');
      const invalidType = await manager.agent
        .post('/api/items/item-1/attachments')
        .set('x-csrf-token', manager.csrf)
        .attach('file', Buffer.from('not allowed'), { filename: 'payload.bin', contentType: 'application/octet-stream' });
      expect(invalidType.status).toBe(415);

      const oversized = await manager.agent
        .post('/api/items/item-1/attachments')
        .set('x-csrf-token', manager.csrf)
        .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'large.txt', contentType: 'text/plain' });
      expect(oversized.status).toBe(413);

      const uploaded = await manager.agent
        .post('/api/items/item-1/attachments')
        .set('x-csrf-token', manager.csrf)
        .attach('file', Buffer.from('attachment contents'), { filename: '../../safe?.txt', contentType: 'text/plain' });
      expect(uploaded.status).toBe(201);
      const attachment = state.attachments[0];
      expect(attachment.filename).not.toContain('/');
      expect(await readFile(path.join(uploadDir, attachment.storageKey), 'utf8')).toBe('attachment contents');

      const outsider = await login(app, 'outside@example.com');
      const deniedDownload = await outsider.agent.get(`/api/attachments/${attachment.id}`);
      expect(deniedDownload.status).toBe(403);

      const download = await manager.agent.get(`/api/attachments/${attachment.id}`);
      expect(download.status).toBe(200);
      expect(download.headers['content-type']).toContain('text/plain');
      expect(download.text).toBe('attachment contents');

      const removed = await manager.agent
        .delete(`/api/attachments/${attachment.id}`)
        .set('x-csrf-token', manager.csrf);
      expect(removed.status).toBe(204);
      await expect(readFile(path.join(uploadDir, attachment.storageKey))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = previousUploadDir;
      await rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('returns 503 when attachment storage is unavailable', async () => {
    vi.resetModules();
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'project-tracker-unavailable-'));
    const state = createMockPrisma();
    vi.doMock('../lib/prisma.js', () => ({ prisma: state.prismaMock }));
    const { StorageUnavailableError } = await import('../lib/storage/errors.js');
    const unavailable = () => new StorageUnavailableError(
      'Attachment storage is unavailable. Check the S3 endpoint, bucket, credentials, and bucket permissions, then retry.',
    );
    const storage = {
      save: vi.fn(async () => {
        throw unavailable();
      }),
      createReadStream: vi.fn(async () => {
        throw unavailable();
      }),
      delete: vi.fn(async () => {
        throw unavailable();
      }),
      exists: vi.fn(),
    };
    vi.doMock('../lib/storage/index.js', () => ({ storage }));
    const previousUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploadDir;
    try {
      const { createApp } = await import('../app.js');
      const manager = await login(createApp(), 'sara.manager@example.com');
      const response = await manager.agent
        .post('/api/items/item-1/attachments')
        .set('x-csrf-token', manager.csrf)
        .attach('file', Buffer.from('attachment contents'), { filename: 'notes.txt', contentType: 'text/plain' });

      expect(response.status).toBe(503);
      expect(response.body.error.message).toContain('Check the S3 endpoint');
      expect(storage.save).toHaveBeenCalledOnce();

      state.attachments.push({
        id: 'attachment-unavailable',
        itemId: 'item-1',
        uploaderId: 'manager-1',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 19,
        storageKey: 'items/item-1/attachment-notes.txt',
        createdAt: new Date(),
      });
      const download = await manager.agent.get('/api/attachments/attachment-unavailable');
      expect(download.status).toBe(503);
      const remove = await manager.agent
        .delete('/api/attachments/attachment-unavailable')
        .set('x-csrf-token', manager.csrf);
      expect(remove.status).toBe(503);
      expect(state.attachments).toHaveLength(1);
    } finally {
      if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = previousUploadDir;
      await rm(uploadDir, { recursive: true, force: true });
    }
  });
});
