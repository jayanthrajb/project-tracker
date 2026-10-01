import { randomUUID } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { findAccessibleItem } from '../lib/access.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { canEditItem } from '../lib/permissions.js';
import { prisma } from '../lib/prisma.js';
import { localStorage as storage } from '../lib/storage/local.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrf } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype.toLowerCase())) {
      callback(new AppError(415, 'File type is not allowed'));
      return;
    }
    callback(null, true);
  },
});
const idSchema = z.object({ id: z.string().min(1) });
const emptyBodySchema = z.object({}).strict();

function sanitizeFilename(filename: string) {
  const basename = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const sanitized = basename
    .normalize('NFKC')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .trim()
    .slice(0, 180);
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : 'attachment';
}

export const attachmentsRouter = Router();
const attachmentReadRateLimit = rateLimit({ windowMs: 60_000, max: 120 });
const attachmentWriteRateLimit = rateLimit({ windowMs: 60_000, max: 60 });

attachmentsRouter.post('/items/:id/attachments', requireCsrf, attachmentWriteRateLimit, requireAuth, upload.single('file'), asyncHandler(async (req, res) => {
  const { id } = idSchema.parse(req.params);
  if (!req.user) throw new AppError(401, 'Authentication required');
  if (!req.file) throw new AppError(400, 'An allowed file is required');
  emptyBodySchema.parse(req.body ?? {});
  const item = await findAccessibleItem(id, req.user);
  if (!canEditItem(req.user.id, req.user.role, item)) {
    throw new AppError(403, 'You cannot attach files to this item');
  }
  const storageKey = randomUUID();
  await storage.save(storageKey, req.file.buffer);
  try {
    const attachment = await prisma.attachment.create({
      data: {
        itemId: item.id,
        uploaderId: req.user.id,
        filename: sanitizeFilename(req.file.originalname),
        mimeType: req.file.mimetype.toLowerCase(),
        sizeBytes: req.file.size,
        storageKey,
      },
    });
    res.status(201).json({ attachment });
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}));

attachmentsRouter.get('/attachments/:id', requireCsrf, attachmentReadRateLimit, requireAuth, asyncHandler(async (req, res, next) => {
  const { id } = idSchema.parse(req.params);
  emptyBodySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, 'Attachment not found');
  await findAccessibleItem(attachment.itemId, req.user);
  let stream: ReadStream;
  try {
    stream = await storage.createReadStream(attachment.storageKey);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new AppError(404, 'Attachment file not found');
    }
    throw error;
  }
  res.attachment(attachment.filename);
  res.setHeader('Content-Type', attachment.mimeType);
  stream.on('error', (error) => {
    if (res.headersSent) res.destroy(error);
    else next(error);
  });
  stream.pipe(res);
}));

attachmentsRouter.delete('/attachments/:id', requireCsrf, attachmentWriteRateLimit, requireAuth, asyncHandler(async (req, res) => {
  const { id } = idSchema.parse(req.params);
  emptyBodySchema.parse(req.body ?? {});
  if (!req.user) throw new AppError(401, 'Authentication required');
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, 'Attachment not found');
  if (
    attachment.uploaderId !== req.user.id &&
    req.user.role !== 'ADMIN' &&
    req.user.role !== 'MANAGER'
  ) {
    throw new AppError(403, 'You cannot delete this attachment');
  }
  await prisma.attachment.delete({ where: { id } });
  await storage.delete(attachment.storageKey);
  res.status(204).send();
}));
