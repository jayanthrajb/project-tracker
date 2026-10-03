import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';

import { findAccessibleItem } from '../lib/access.js';
import { AppError } from '../lib/errors.js';
import { env } from '../lib/env.js';
import { asyncHandler } from '../lib/http.js';
import { canEditItem } from '../lib/permissions.js';
import { prisma } from '../lib/prisma.js';
import { storage } from '../lib/storage/index.js';
import { StorageObjectNotFoundError, StorageUnavailableError } from '../lib/storage/errors.js';
import { createS3StorageKey, S3StorageDriver, sanitizeFilename } from '../lib/storage/s3.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrf } from '../middleware/csrf.js';

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
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, _file, callback) => {
      const filename = randomUUID();
      temporaryUploadPaths.set(req, path.join(os.tmpdir(), filename));
      callback(null, filename);
    },
  }),
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
const temporaryUploadPaths = new WeakMap<object, string>();

export const attachmentsRouter = Router();
const attachmentReadRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'Too many requests, please try again later.')),
});
const attachmentWriteRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'Too many requests, please try again later.')),
});

attachmentsRouter.post('/items/:id/attachments', requireCsrf, attachmentWriteRateLimit, requireAuth, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'An allowed file is required');
  const file = req.file;
  const temporaryFilePath = temporaryUploadPaths.get(req);
  if (!temporaryFilePath) throw new AppError(500, 'Unable to resolve temporary upload file');
  try {
    const { id } = idSchema.parse(req.params);
    if (!req.user) throw new AppError(401, 'Authentication required');
    emptyBodySchema.parse(req.body ?? {});
    const item = await findAccessibleItem(id, req.user);
    if (!canEditItem(req.user.id, req.user.role, item)) {
      throw new AppError(403, 'You cannot attach files to this item');
    }
    const storageKey = createS3StorageKey(item.id, file.originalname);
    await storage.save(storageKey, createReadStream(temporaryFilePath), file.size);
    try {
      const attachment = await prisma.attachment.create({
        data: {
          itemId: item.id,
          uploaderId: req.user.id,
          filename: sanitizeFilename(file.originalname),
          mimeType: file.mimetype.toLowerCase(),
          sizeBytes: file.size,
          storageKey,
        },
      });
      res.status(201).json({ attachment });
    } catch (error) {
      await storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  } finally {
    temporaryUploadPaths.delete(req);
    await rm(temporaryFilePath, { force: true });
  }
}));

attachmentsRouter.get('/attachments/:id', requireCsrf, attachmentReadRateLimit, requireAuth, asyncHandler(async (req, res, next) => {
  const { id } = idSchema.parse(req.params);
  emptyBodySchema.parse(req.query);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, 'Attachment not found');
  await findAccessibleItem(attachment.itemId, req.user);
  if (env.S3_USE_PRESIGNED_URLS && storage.createPresignedDownloadUrl) {
    return res.redirect(
      302,
      await storage.createPresignedDownloadUrl(attachment.storageKey, {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      }),
    );
  }

  let stream: Readable;
  try {
    stream = await storage.createReadStream(attachment.storageKey);
  } catch (error) {
    if (
      error instanceof StorageObjectNotFoundError ||
      (error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw new AppError(404, 'Attachment file not found');
    }
    throw error;
  }
  res.attachment(attachment.filename);
  res.setHeader('Content-Type', attachment.mimeType);
  stream.on('error', (error) => {
    const streamError =
      storage instanceof S3StorageDriver && !(error instanceof StorageUnavailableError)
        ? new StorageUnavailableError(
            'Attachment storage is unavailable. Check the S3 endpoint, bucket, credentials, and bucket permissions, then retry.',
            { cause: error },
          )
        : error;
    if (res.headersSent) res.destroy(streamError);
    else next(streamError);
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
  await storage.delete(attachment.storageKey);
  await prisma.attachment.delete({ where: { id } });
  res.status(204).send();
}));
